// =========================================================================
// Planilla Mensual Consolidada (migracion 034, "Ronda E").
//
// Junta el Tareo Diario de todas las quincenas/semanas de un
// {proyecto, anio, mes} en un solo calculo mensual, para poder declarar
// PLAME/AFPnet/Asiento Contable por MES CALENDARIO (hoy cada exportacion
// sale de un solo periodo de pago - ver plame.ts/afpnet.ts/
// asientoContable.ts). Aplica SOLO a obreros (categorias de construccion
// civil, ver esConstruccionCivil): el periodo MENSUAL de Empleados ya
// cubre el mes calendario completo, confirmado con el usuario - no
// necesita este mecanismo.
//
// Es un calculo ADICIONAL: NO modifica ni reemplaza detalle_planilla (las
// boletas por periodo de pago, que se le siguen pagando al trabajador tal
// cual). Es "foto historica" igual que el resto del sistema: una vez
// consolidado un mes, no se recalcula solo si se corrige una quincena
// despues - se avisa (avisos_recalculo_posterior), el usuario decide si
// vuelve a presionar "Consolidar".
//
// Decisiones de diseño confirmadas con el usuario (ver
// docs/plan_planilla_mensual_consolidada.md):
//   1) Empleados: no aplica, su periodo MENSUAL ya cubre el mes completo.
//   2) Trabajador que cambia de proyecto a mitad de mes: se reparte entre
//      los 2 proyectos. Como los periodos ya son por proyecto (Ronda C,
//      migracion 028) y el Tareo Diario se carga POR PERIODO, esto se
//      resuelve solo: consolidar el proyecto A solo suma los periodos de
//      A, consolidar el proyecto B solo suma los de B - cada consolidacion
//      ya trae unicamente los dias que le corresponden a ese proyecto.
//   3) Recalculo de una quincena despues de consolidar el mes: no se
//      actualiza sola (foto historica), se avisa.
//   4) La Planilla Mensual se puede ver/descargar como su propio reporte,
//      ademas de servir de base a los 3 archivos finales.
//
// Como se calcula cada trabajador:
//   1) Se buscan los periodos QUINCENAL/SEMANAL de ese proyecto cuyo rango
//      de fechas toque el mes pedido (parcial o completo).
//   2) Para cada uno, se llama a agregarTareoDiario() (Ronda 3,
//      routes/planilla.ts) acotado a la INTERSECCION entre las fechas del
//      periodo y las del mes calendario - exactamente el mismo criterio
//      que ya usa Ronda 3 para partir un periodo que cruza de mes, pero
//      aplicado entre periodos en vez de dentro de un periodo.
//   3) Los resultados (dias/horas) se SUMAN campo a campo (son conteos,
//      libres de sumar sin duplicar nada).
//   4) Se corre calcularLineaPlanilla() UNA sola vez sobre esa asistencia
//      ya consolidada, con la tabla salarial/tasas AFP/parametros del mes
//      pedido (ya no hace falta partir en tramos: por construccion, todo
//      el rango YA es un solo mes calendario).
//
// Puntos finos ya verificados contra el motor de calculo existente
// (motorCalculo.ts) antes de escribir este modulo:
//   - tipoPeriodo="MENSUAL" es OBLIGATORIO en esta unica llamada: es lo
//     unico que decide el divisor del aporte fijo de EsSalud+Vida
//     (obtenerDivisorEssaludVida) - pasar QUINCENAL/SEMANAL aqui pagaria
//     de menos ese aporte (dividiria entre 2 o 4 sin necesidad).
//   - condicion_trabajo (migracion 026) es, confirmado con el usuario, un
//     monto MENSUAL completo -> corre exactamente una vez por mes en este
//     mecanismo (a diferencia del calculo por periodo, donde hoy se paga
//     una vez POR QUINCENA - eso es un comportamiento ya existente de las
//     boletas normales, que esta ronda no toca).
//   - jornalDiario de un obrero sale de tablaCategorias (no de diasPeriodo),
//     y gratificacion/CTS/vacaciones/BUC/BAE/movilidad son lineales en la
//     asistencia consolidada - sumar los dias de 2 quincenas y calcular una
//     sola vez da el mismo total que calcular 2 veces y sumar, siempre que
//     ambas quincenas caigan en el MISMO mes calendario (que es justamente
//     la interseccion que se usa en el paso 2 de arriba).
// =========================================================================

import { pool } from "./db";
import { calcularLineaPlanilla, esConstruccionCivil, ResultadoCalculoLinea } from "./motorCalculo";
import { obtenerConceptos } from "./routes/conceptos";
import { agregarTareoDiario, fechaISO, obtenerAfpTasas, obtenerParametros, obtenerTablaCategorias } from "./routes/planilla";
import {
  AsistenciaEntrada,
  AvisoRecalculoPosteriorMensual,
  Contrato,
  ParametrosNormativos,
  PeriodoPlanilla,
  TablaSalarialMensual,
  TasasAFPMensuales,
} from "./tipos";
import { ErrorValidacion } from "./validaciones";

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Ultimo dia calendario (28-31) de un mes dado. */
function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Rango exacto 'YYYY-MM-01'..'YYYY-MM-DD' (ultimo dia) de un mes calendario, mas su cantidad de dias. */
export function rangoDelMes(anio: number, mes: number): { desde: string; hasta: string; dias: number } {
  const dias = ultimoDiaDelMes(anio, mes);
  const mm = String(mes).padStart(2, "0");
  return { desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-${String(dias).padStart(2, "0")}`, dias };
}

// Los campos de asistencia (Omit<AsistenciaEntrada, "contrato_id">) son
// todos conteos de dias/horas - libres de sumar campo a campo entre
// periodos sin duplicar nada (a diferencia de jornal_diario/
// condicion_trabajo/seguro_vida en detalle_planilla, que son montos fijos
// y NO deben sumarse - ver sumarResultadosLinea en motorCalculo.ts. Esos 3
// no aplican aca: jornal_diario/condicion_trabajo/seguro_vida se resuelven
// UNA sola vez, dentro de la unica llamada a calcularLineaPlanilla).
//
// NOTA (recon 19/46): el parche original tambien sumaba "dias_feriado_trabajado"
// y "dias_dominical_no_laborado" - campos de la infraestructura de "dominical
// proporcional/feriado no laborado" (migraciones 022/023/026) que no existe
// en AsistenciaEntrada en este arbol - ver RECONSTRUCCION_BRECHAS.md punto 4.
// Se omiten aqui, igual criterio que en formulas.ts (VARIABLES_FORMULA) y
// motorCalculo.ts.
const CAMPOS_ASISTENCIA_SUMABLES = [
  "dias_trabajados",
  "dias_dominical",
  "dias_feriado",
  "dias_falta",
  "horas_extra_25",
  "horas_extra_35",
  "horas_extra_100",
  "dias_subsidio_enfermedad",
  "dias_subsidio_maternidad",
  "dias_licencia_paternidad",
  "dias_subsidio_enfermedad_computable",
] as const satisfies readonly (keyof Omit<AsistenciaEntrada, "contrato_id">)[];

function sumarAsistencias(valores: Omit<AsistenciaEntrada, "contrato_id">[]): Omit<AsistenciaEntrada, "contrato_id"> {
  const base = {} as Record<(typeof CAMPOS_ASISTENCIA_SUMABLES)[number], number>;
  for (const campo of CAMPOS_ASISTENCIA_SUMABLES) base[campo] = 0;
  for (const valor of valores) {
    for (const campo of CAMPOS_ASISTENCIA_SUMABLES) {
      base[campo] = redondear(base[campo] + (Number(valor[campo]) || 0));
    }
  }
  return base;
}

/** Periodos QUINCENAL/SEMANAL de un proyecto cuyo rango de fechas toca (parcial o completo) un mes calendario. */
export async function obtenerPeriodosDelMes(proyecto: string, anio: number, mes: number): Promise<PeriodoPlanilla[]> {
  const { desde, hasta } = rangoDelMes(anio, mes);
  const r = await pool.query(
    `SELECT * FROM periodos_planilla
     WHERE proyecto = $1 AND tipo IN ('QUINCENAL', 'SEMANAL')
       AND fecha_inicio <= $3 AND fecha_fin >= $2
     ORDER BY fecha_inicio`,
    [proyecto, desde, hasta]
  );
  return r.rows as PeriodoPlanilla[];
}

export interface ResultadoConsolidacion {
  planilla_mensual_id: number;
  proyecto: string;
  anio: number;
  mes: number;
  trabajadores_consolidados: number;
  periodos_incluidos: { id: number; tipo: string; quincena: number | null; fecha_inicio: string; fecha_fin: string }[];
  avisos_recalculo_posterior: AvisoRecalculoPosteriorMensual[];
  errores: { contrato_id: number; dni: string; nombre: string; motivo: string }[];
}

type FilaContratoConsolidacion = Contrato & {
  numero_hijos: number;
  numero_documento: string;
  apellidos_nombres: string;
  cuota_sindical_semanal: string | number;
};

/**
 * Consolida (o re-consolida) la Planilla Mensual de un {proyecto, anio, mes}.
 * Reemplaza por completo el detalle anterior de esa misma cabecera (foto
 * nueva), sin tocar detalle_planilla (boletas por periodo de pago).
 */
export async function consolidarPlanillaMensual(
  proyecto: string,
  anio: number,
  mes: number,
  usuarioId: number
): Promise<ResultadoConsolidacion> {
  const { desde, hasta, dias: diasDelMes } = rangoDelMes(anio, mes);

  const periodos = await obtenerPeriodosDelMes(proyecto, anio, mes);
  if (periodos.length === 0) {
    throw new ErrorValidacion(
      `No hay periodos QUINCENAL/SEMANAL del proyecto "${proyecto}" que toquen ${mes}/${anio}. ` +
        `Este mecanismo aplica solo a obreros (construccion civil): revisa que los periodos de ese mes tengan ` +
        `este proyecto asignado (pantalla Periodos).`
    );
  }
  const periodoIds = periodos.map((p) => p.id);

  // Aviso (no bloquea): alguna quincena usada aqui se volvio a calcular
  // DESPUES de la ultima vez que se consolido este mismo mes.
  const anteriorResult = await pool.query<{ calculado_en: string }>(
    "SELECT calculado_en FROM planilla_mensual WHERE proyecto = $1 AND anio = $2 AND mes = $3",
    [proyecto, anio, mes]
  );
  const calculadoEnAnterior = anteriorResult.rows[0]?.calculado_en ?? null;
  const avisosRecalculoPosterior: AvisoRecalculoPosteriorMensual[] = [];
  if (calculadoEnAnterior) {
    const recalculadosResult = await pool.query(
      `SELECT DISTINCT p.id, p.anio, p.mes, p.quincena, p.tipo, dp.calculado_en
       FROM detalle_planilla dp
       JOIN periodos_planilla p ON p.id = dp.periodo_id
       WHERE dp.periodo_id = ANY($1::int[]) AND dp.calculado_en > $2`,
      [periodoIds, calculadoEnAnterior]
    );
    for (const fila of recalculadosResult.rows) {
      avisosRecalculoPosterior.push({
        periodo_id: fila.id,
        anio: fila.anio,
        mes: fila.mes,
        quincena: fila.quincena,
        tipo: fila.tipo,
        calculado_en: fila.calculado_en,
      });
    }
  }

  // Trabajadores con algun dia de Tareo Diario cargado en este rango, en
  // estos periodos (mismo criterio que "hay tareo cargado" del calculo por
  // periodo, pero acotado a las fechas del mes, no del periodo completo).
  const contratosResult = await pool.query<{ contrato_id: number }>(
    `SELECT DISTINCT contrato_id FROM tareo_diario WHERE periodo_id = ANY($1::int[]) AND fecha BETWEEN $2 AND $3`,
    [periodoIds, desde, hasta]
  );
  const contratoIds = contratosResult.rows.map((f) => f.contrato_id);

  const errores: ResultadoConsolidacion["errores"] = [];
  const lineas: { contrato: FilaContratoConsolidacion; resultado: ResultadoCalculoLinea }[] = [];

  if (contratoIds.length > 0) {
    const parametros: ParametrosNormativos = await obtenerParametros(anio);
    const tablaCategorias: TablaSalarialMensual = await obtenerTablaCategorias(anio, mes);
    const afpTasas: TasasAFPMensuales = await obtenerAfpTasas(anio, mes);
    const conceptos = await obtenerConceptos();

    const contratosInfoResult = await pool.query(
      `SELECT c.*, e.numero_hijos, e.numero_documento, e.apellidos_nombres,
              COALESCE(csc.monto_semanal, p.cuota_sindical_semanal, 0) AS cuota_sindical_semanal
       FROM contratos c
       JOIN empleados e ON e.id = c.empleado_id
       LEFT JOIN proyectos p ON p.nombre = c.proyecto
       LEFT JOIN cuota_sindical_categoria csc ON csc.proyecto_id = p.id AND csc.categoria = c.categoria_ocupacional
       WHERE c.id = ANY($1::int[])
       ORDER BY e.apellidos_nombres`,
      [contratoIds]
    );

    for (const filaRaw of contratosInfoResult.rows) {
      const contrato = filaRaw as FilaContratoConsolidacion;

      // Aplica solo a obreros (construccion civil) - confirmado con el
      // usuario (ver cabecera de este archivo). Un contrato de regimen
      // general que por error tuviera tareo diario cargado en un periodo
      // QUINCENAL/SEMANAL de este proyecto simplemente no se consolida
      // aqui (su periodo MENSUAL ya lo cubre por su cuenta).
      if (!esConstruccionCivil(contrato.categoria_ocupacional)) continue;

      try {
        const valoresPorPeriodo: Omit<AsistenciaEntrada, "contrato_id">[] = [];
        for (const periodo of periodos) {
          const inicioPeriodo = fechaISO(periodo.fecha_inicio);
          const finPeriodo = fechaISO(periodo.fecha_fin);
          const periodoDesde = inicioPeriodo > desde ? inicioPeriodo : desde;
          const periodoHasta = finPeriodo < hasta ? finPeriodo : hasta;
          if (periodoDesde > periodoHasta) continue; // este periodo no toca el mes (no deberia pasar, ya filtrado arriba)
          valoresPorPeriodo.push(await agregarTareoDiario(periodo.id, contrato.id, periodoDesde, periodoHasta));
        }
        const asistenciaSumada = sumarAsistencias(valoresPorPeriodo);
        const asistencia: AsistenciaEntrada = { contrato_id: contrato.id, ...asistenciaSumada };

        const resultado = calcularLineaPlanilla(
          contrato,
          contrato.numero_hijos,
          asistencia,
          parametros,
          tablaCategorias,
          afpTasas,
          diasDelMes,
          mes,
          anio,
          Number(contrato.cuota_sindical_semanal),
          conceptos,
          "MENSUAL"
        );
        lineas.push({ contrato, resultado });
      } catch (e) {
        errores.push({
          contrato_id: contrato.id,
          dni: contrato.numero_documento,
          nombre: contrato.apellidos_nombres,
          motivo: (e as Error).message,
        });
      }
    }
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    const cabeceraResult = await cliente.query<{ id: number }>(
      `INSERT INTO planilla_mensual (proyecto, anio, mes, calculado_en, calculado_por)
       VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (proyecto, anio, mes) DO UPDATE SET calculado_en = now(), calculado_por = $4
       RETURNING id`,
      [proyecto, anio, mes, usuarioId]
    );
    const planillaMensualId = cabeceraResult.rows[0].id;

    // Foto nueva: se reemplaza por completo el detalle anterior de esta
    // misma cabecera (mismo criterio que el recalculo de un periodo normal).
    await cliente.query("DELETE FROM detalle_planilla_mensual WHERE planilla_mensual_id = $1", [planillaMensualId]);

    for (const { contrato, resultado } of lineas) {
      const d = resultado.detalle;
      // NOTA (recon 19/46): dias_dominical_no_laborado, remuneracion_dominical_proporcional,
      // sobretasa_dominical, sobretasa_feriado y condicion_trabajo son parte de la
      // infraestructura de "dominical proporcional/feriado no laborado/condicion de
      // trabajo" (migraciones 022/023/026), que no existe en DetallePlanilla/ResultadoCalculoLinea
      // en este arbol - ver RECONSTRUCCION_BRECHAS.md punto 4. Se omiten de la lista de
      // columnas explicita (quedan en su DEFAULT 0 de la tabla, ver schema.sql) en vez
      // de intentar leerlas de "d", que no las tiene.
      const r = await cliente.query<{ id: number }>(
        `INSERT INTO detalle_planilla_mensual (
           planilla_mensual_id, contrato_id, dias_trabajados, dias_dominical,
           dias_feriado, dias_falta, horas_extra_25, horas_extra_35, horas_extra_100,
           dias_subsidio_enfermedad, dias_subsidio_maternidad, dias_licencia_paternidad, dias_subsidio_enfermedad_computable,
           jornal_diario, sueldo_basico, remuneracion_dominical, remuneracion_feriado,
           importe_horas_extra, asignacion_familiar, asignacion_escolaridad,
           bonificacion_buc, bonificacion_bae, bonificacion_movilidad,
           subsidio_enfermedad, licencia_paternidad, otras_bonificaciones, gratificacion, bonificacion_extraordinaria,
           cts, vacaciones, total_ingresos, aporte_pension, descuento_sindicato, seguro_vida, conafovicer, renta_5ta,
           otros_descuentos, total_descuentos, essalud, sctr, senati, neto_pagar, detalle_json
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
           $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43
         )
         RETURNING id`,
        [
          planillaMensualId,
          contrato.id,
          d.dias_trabajados,
          d.dias_dominical,
          d.dias_feriado,
          d.dias_falta,
          d.horas_extra_25,
          d.horas_extra_35,
          d.horas_extra_100,
          d.dias_subsidio_enfermedad,
          d.dias_subsidio_maternidad,
          d.dias_licencia_paternidad,
          d.dias_subsidio_enfermedad_computable,
          d.jornal_diario,
          d.sueldo_basico,
          d.remuneracion_dominical,
          d.remuneracion_feriado,
          d.importe_horas_extra,
          d.asignacion_familiar,
          d.asignacion_escolaridad,
          d.bonificacion_buc,
          d.bonificacion_bae,
          d.bonificacion_movilidad,
          d.subsidio_enfermedad,
          d.licencia_paternidad,
          d.otras_bonificaciones,
          d.gratificacion,
          d.bonificacion_extraordinaria,
          d.cts,
          d.vacaciones,
          d.total_ingresos,
          d.aporte_pension,
          d.descuento_sindicato,
          d.seguro_vida,
          d.conafovicer,
          d.renta_5ta,
          d.otros_descuentos,
          d.total_descuentos,
          d.essalud,
          d.sctr,
          d.senati,
          d.neto_pagar,
          JSON.stringify(d.detalle_json ?? {}),
        ]
      );
      const detalleId = r.rows[0].id;
      for (const cp of resultado.conceptosPersonalizados ?? []) {
        await cliente.query(
          `INSERT INTO detalle_planilla_conceptos_mensual (detalle_id, concepto_codigo, monto) VALUES ($1, $2, $3)`,
          [detalleId, cp.codigo, cp.monto]
        );
      }
    }

    await cliente.query("COMMIT");

    return {
      planilla_mensual_id: planillaMensualId,
      proyecto,
      anio,
      mes,
      trabajadores_consolidados: lineas.length,
      periodos_incluidos: periodos.map((p) => ({
        id: p.id,
        tipo: p.tipo,
        quincena: p.quincena,
        fecha_inicio: fechaISO(p.fecha_inicio),
        fecha_fin: fechaISO(p.fecha_fin),
      })),
      avisos_recalculo_posterior: avisosRecalculoPosterior,
      errores,
    };
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }
}

/** Lee una Planilla Mensual ya consolidada (cabecera + detalle por trabajador), o null si nunca se consolido. */
export async function obtenerPlanillaMensual(proyecto: string, anio: number, mes: number) {
  const cabeceraResult = await pool.query(
    "SELECT * FROM planilla_mensual WHERE proyecto = $1 AND anio = $2 AND mes = $3",
    [proyecto, anio, mes]
  );
  if (cabeceraResult.rowCount === 0) return null;
  const planillaMensual = cabeceraResult.rows[0];

  const detalleResult = await pool.query(
    `SELECT d.*, e.numero_documento, e.apellidos_nombres, c.categoria_ocupacional, c.proyecto
     FROM detalle_planilla_mensual d
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     WHERE d.planilla_mensual_id = $1
     ORDER BY e.apellidos_nombres`,
    [planillaMensual.id]
  );

  return { planillaMensual, detalle: detalleResult.rows };
}

/** Cabecera por id (usada por las rutas de exportacion: REM/AFPnet/Asiento mensual). */
export async function obtenerPlanillaMensualPorId(id: number) {
  const r = await pool.query("SELECT * FROM planilla_mensual WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}
