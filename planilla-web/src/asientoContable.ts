// =========================================================================
// Asiento contable consolidado del periodo (provision de planilla).
//
// Arma, para un periodo ya calculado, un asiento UNICO que junta los 3
// grupos de movimientos que hoy el usuario arma a mano en Excel:
//   - Ingresos de cada trabajador (sueldo, gratificacion, CTS, etc.): una
//     linea al Debe por cada concepto x proyecto con monto distinto de cero.
//   - Aportes patronales (EsSalud, SCTR, SENATI, seguro de vida): una linea
//     al Debe (gasto) y una al Haber (pasivo por pagar) por el mismo monto.
//   - Retenciones al trabajador (ONP, AFP por administradora, Renta 5ta,
//     CONAFOVICER, cuota sindical) y el Neto a pagar: solo Haber.
//
// La cuenta contable de cada linea sale de mapeo_cuentas_contables (tabla
// que el usuario llena desde Configuracion -> "Configurar por proyecto").
// Si falta configurar la cuenta de algun concepto/proyecto que SI tuvo
// monto en el periodo, este modulo NO adivina ni omite la linea: la reporta
// en "faltantes" para que la ruta responda 400 con el detalle completo (ver
// routes/exportaciones.ts) - el mismo criterio que ya usa el sistema para
// errores fila-por-fila en la carga masiva (routes/planilla.ts).
//
// Formato de las 16 columnas y los valores fijos (TIPO_DOC, LUGAR,
// COD_LIBRO, COD_MOVIM, ESTADO, MONTO_EXTR) confirmados contra un asiento
// real ya contabilizado por el usuario. El texto de DETALLE de esa
// referencia no sigue un patron reproducible con formula (a veces es el
// nombre de la cuenta, a veces solo el nombre de la administradora AFP, con
// inconsistencias propias del llenado manual) - en vez de perseguir ese
// texto exacto, aqui se usa "nombre del concepto - nombre del proyecto",
// que es predecible y suficiente para identificar cada linea. La
// verificacion contra el archivo real compara TOTALES por cuenta (Debe ==
// Haber), no el texto literal de cada linea.
//
// Reconstruido desde backend_dist/asientoContable.js (brecha #5 de
// RECONSTRUCCION_BRECHAS.md) - nunca aparecio como parche .patch en este
// arbol.
// =========================================================================

import { pool } from "./db";
import { obtenerAportes, obtenerConceptos } from "./routes/conceptos";
import { esConstruccionCivil } from "./motorCalculo";
import { AlcanceDeclaracionMensual, obtenerDetalleEmpleadosDelMes, rangoDelMes, resolverCabecerasObreros } from "./planillaMensual";

function num(valor: unknown): number {
  return Number(valor) || 0;
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** 'YYYY-MM-DD' (string o Date de pg) -> 'DD/MM/YYYY', igual formato que el asiento modelo. */
function fechaDDMMYYYY(valor: unknown): string {
  const iso = valor instanceof Date ? valor.toISOString() : String(valor);
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

// Mapa concepto de ingreso -> columna de detalle_planilla que lo alimenta.
// HORAS_EXTRA_CONSTRUCCION/HORAS_EXTRA_GENERAL comparten la misma columna
// (importe_horas_extra): motorCalculo.ts ya calcula un solo monto de horas
// extra por boleta, con la formula que corresponda segun la categoria del
// trabajador (ver esConstruccionCivil) - aqui se le asigna ese monto al
// concepto que corresponda a esa misma categoria, sin duplicar ni inventar
// un concepto nuevo.
const COLUMNA_INGRESO: Record<string, string> = {
  SUELDO_BASICO: "sueldo_basico",
  REM_DOMINICAL: "remuneracion_dominical",
  REM_FERIADO: "remuneracion_feriado",
  SOBRETASA_DOMINICAL: "sobretasa_dominical",
  SOBRETASA_FERIADO: "sobretasa_feriado",
  ASIGNACION_FAMILIAR: "asignacion_familiar",
  ASIGNACION_ESCOLARIDAD: "asignacion_escolaridad",
  BUC: "bonificacion_buc",
  BAE: "bonificacion_bae",
  MOVILIDAD: "bonificacion_movilidad",
  CONDICION_TRABAJO: "condicion_trabajo",
  // migracion 030: descanso medico por enfermedad/licencia por paternidad
  // ahora SI se pagan de verdad - sin este mapeo, el asiento contable
  // quedaria descuadrado apenas hubiera un monto en estas 2 columnas
  // (mismo bug real ya encontrado antes con CONDICION_TRABAJO).
  // migracion 038: el concepto se dividio en 2 (DESCANSO_MEDICO <=20/año,
  // INCAPACIDAD_ENFERMEDAD 21+) - ver el comentario completo en motorCalculo.ts.
  DESCANSO_MEDICO: "subsidio_enfermedad",
  INCAPACIDAD_ENFERMEDAD: "incapacidad_enfermedad",
  LICENCIA_PATERNIDAD: "licencia_paternidad",
  GRATIFICACION: "gratificacion",
  BONIFICACION_EXTRAORDINARIA: "bonificacion_extraordinaria",
  CTS: "cts",
  VACACIONES: "vacaciones",
};

export interface LineaAsientoContable {
  CODIGO: string;
  D_H: "D" | "H";
  FECHA: string;
  IMPORTE: number;
  CODIGO_PRO: string;
  NRO_DOC: string;
  TIPO_DOC: string;
  ECPN: string;
  EFE: string;
  DETALLE: string;
  MONTO_EXTR: string;
  LUGAR: string;
  GLOSA: string;
  COD_LIBRO: string;
  COD_MOVIM: string;
  ESTADO: string;
}

export interface FaltanteAsientoContable {
  concepto_codigo: string;
  concepto_nombre: string;
  proyecto_id: number;
  proyecto_nombre: string;
  tipo_movimiento: "DEBE" | "HABER";
  motivo: string;
}

export interface ResultadoAsientoContable {
  lineas: LineaAsientoContable[];
  faltantes: FaltanteAsientoContable[];
  totalDebe: number;
  totalHaber: number;
}

interface FilaDetalleAsiento {
  proyecto: string;
  categoria_ocupacional: string;
  sistema_pension: string | null;
  afp_nombre: string | null;
  [columna: string]: unknown;
}

interface FilaConceptoPersonalizadoAsiento {
  concepto_codigo: string;
  monto: string | number;
  proyecto: string;
}

/**
 * Arma el asiento contable a partir de filas YA obtenidas (de
 * detalle_planilla/detalle_planilla_conceptos, por periodo de pago, o de
 * detalle_planilla_mensual/detalle_planilla_conceptos_mensual, Ronda E por
 * mes calendario consolidado - mismas columnas, ver migracion 034) y de la
 * fecha/numero de documento ya resueltos por el llamador (un periodo de pago
 * usa su fecha_inicio; la consolidacion mensual usa el ultimo dia del mes).
 * Extraido para que generarAsientoContable y generarAsientoContableMensual
 * compartan exactamente la misma logica de acumulacion/mapeo contable sin
 * duplicarla.
 */
async function construirAsiento(
  fecha: string,
  nroDoc: string,
  detalleFilas: FilaDetalleAsiento[],
  conceptosPersonalizadosFilas: FilaConceptoPersonalizadoAsiento[]
): Promise<ResultadoAsientoContable> {
  const empresaR = await pool.query("SELECT ruc FROM datos_empresa ORDER BY id LIMIT 1");
  const ruc = (empresaR.rows[0]?.ruc as string) ?? "";

  const proyectosR = await pool.query("SELECT id, nombre FROM proyectos");
  const proyectoIdPorNombre = new Map<string, number>();
  const proyectoNombrePorId = new Map<number, string>();
  for (const fila of proyectosR.rows) {
    proyectoIdPorNombre.set(fila.nombre, fila.id);
    proyectoNombrePorId.set(fila.id, fila.nombre);
  }

  const [conceptos, aportes] = await Promise.all([obtenerConceptos(), obtenerAportes()]);

  // montos[proyecto_id]['DEBE'|'HABER'][concepto_codigo] = monto acumulado
  const montos = new Map<number, { DEBE: Map<string, number>; HABER: Map<string, number> }>();
  const faltantesIntegridad: FaltanteAsientoContable[] = [];

  function acumular(proyectoId: number, movimiento: "DEBE" | "HABER", codigo: string, monto: number): void {
    if (monto === 0) return;
    if (!montos.has(proyectoId)) montos.set(proyectoId, { DEBE: new Map(), HABER: new Map() });
    const bucket = montos.get(proyectoId)![movimiento];
    bucket.set(codigo, redondear((bucket.get(codigo) ?? 0) + monto));
  }

  for (const fila of detalleFilas) {
    const proyectoId = proyectoIdPorNombre.get(fila.proyecto);
    if (proyectoId === undefined) continue; // no deberia pasar: todo contrato tiene un proyecto valido

    // 1) Ingresos: solo Debe.
    for (const [codigoConcepto, columna] of Object.entries(COLUMNA_INGRESO)) {
      acumular(proyectoId, "DEBE", codigoConcepto, num(fila[columna]));
    }
    // El dominical proporcional (migracion 023) se acumula bajo el MISMO
    // codigo REM_DOMINICAL (no tiene concepto ni cuenta contable propios):
    // comparte codigo PLAME, cuenta contable y afectacion con REM_DOMINICAL,
    // asi que el usuario no necesita configurar una cuenta contable nueva
    // por cada proyecto para que el asiento cuadre - ver la nota en
    // motorCalculo.ts (calcularLineaPlanilla, montosPorConcepto.REM_DOMINICAL).
    acumular(proyectoId, "DEBE", "REM_DOMINICAL", num(fila.remuneracion_dominical_proporcional));

    const codigoHorasExtra = esConstruccionCivil(fila.categoria_ocupacional as never)
      ? "HORAS_EXTRA_CONSTRUCCION"
      : "HORAS_EXTRA_GENERAL";
    acumular(proyectoId, "DEBE", codigoHorasExtra, num(fila.importe_horas_extra));

    // 2) Aportes patronales: Debe (gasto) y Haber (pasivo), mismo monto.
    const aportesPatronales: Array<[string, number]> = [
      ["ESSALUD", num(fila.essalud)],
      ["SCTR", num(fila.sctr)],
      ["SENATI", num(fila.senati)],
      ["SEGURO_VIDA", num(fila.seguro_vida)],
    ];
    for (const [codigo, monto] of aportesPatronales) {
      acumular(proyectoId, "DEBE", codigo, monto);
      acumular(proyectoId, "HABER", codigo, monto);
    }

    // 3) Retenciones al trabajador: solo Haber.
    acumular(proyectoId, "HABER", "CUOTA_SINDICAL", num(fila.descuento_sindicato));
    acumular(proyectoId, "HABER", "CONAFOVICER", num(fila.conafovicer));
    acumular(proyectoId, "HABER", "RENTA_5TA", num(fila.renta_5ta));
    if (fila.sistema_pension === "ONP") {
      acumular(proyectoId, "HABER", "ONP", num(fila.aporte_pension));
    } else if (fila.afp_nombre) {
      acumular(proyectoId, "HABER", `AFP_${fila.afp_nombre}`, num(fila.aporte_pension));
    } else if (num(fila.aporte_pension) !== 0) {
      // Dato inconsistente (AFP sin administradora): se reporta como
      // faltante de datos, no de mapeo, para que el usuario lo corrija en
      // el contrato antes de intentar de nuevo.
      faltantesIntegridad.push({
        concepto_codigo: "APORTE_PENSION",
        concepto_nombre: "Aporte de pension",
        proyecto_id: proyectoId,
        proyecto_nombre: fila.proyecto,
        tipo_movimiento: "HABER",
        motivo: "Contrato AFP sin administradora (afp_nombre) definida - corregir el contrato antes de generar el asiento.",
      });
    }
    // 4) Neto a pagar: solo Haber, balancea el asiento.
    acumular(proyectoId, "HABER", "NETO_A_PAGAR", num(fila.neto_pagar));
  }

  // 5) Conceptos PERSONALIZADOS (migracion 033, Ronda D "formula propia"):
  // sus montos no viven en columnas propias de detalle_planilla (catalogo
  // abierto), sino en detalle_planilla_conceptos - se acumulan aparte con
  // un loop generico por concepto_codigo, en vez de con el mapeo fijo
  // COLUMNA_INGRESO de arriba. El "tipo" del concepto (INGRESO/APORTE/
  // DESCUENTO, del catalogo conceptos_planilla) decide el tratamiento
  // contable, igual criterio que ya usa motorCalculo.ts para el calculo:
  // INGRESO = solo Debe (como los demas ingresos), DESCUENTO = solo Haber
  // (retencion al trabajador), APORTE = Debe (gasto) + Haber (pasivo),
  // igual que ESSALUD/SCTR/SENATI/SEGURO_VIDA arriba.
  for (const fila of conceptosPersonalizadosFilas) {
    const proyectoId = proyectoIdPorNombre.get(fila.proyecto);
    if (proyectoId === undefined) continue;
    const monto = num(fila.monto);
    const tipo = conceptos[fila.concepto_codigo]?.tipo ?? "INGRESO";
    if (tipo === "INGRESO") {
      acumular(proyectoId, "DEBE", fila.concepto_codigo, monto);
    } else if (tipo === "DESCUENTO") {
      acumular(proyectoId, "HABER", fila.concepto_codigo, monto);
    } else {
      acumular(proyectoId, "DEBE", fila.concepto_codigo, monto);
      acumular(proyectoId, "HABER", fila.concepto_codigo, monto);
    }
  }

  // Resuelve el mapeo configurado (concepto x proyecto x movimiento -> cuenta).
  const mapeoR = await pool.query(
    `SELECT m.concepto_codigo, m.proyecto_id, m.tipo_movimiento, pc.codigo AS cuenta_codigo, pc.denominacion AS cuenta_denominacion
     FROM mapeo_cuentas_contables m
     JOIN plan_cuentas pc ON pc.id = m.cuenta_id`
  );
  const mapeo = new Map<string, { codigo: string; denominacion: string }>();
  for (const fila of mapeoR.rows) {
    mapeo.set(`${fila.concepto_codigo}|${fila.proyecto_id}|${fila.tipo_movimiento}`, {
      codigo: fila.cuenta_codigo,
      denominacion: fila.cuenta_denominacion,
    });
  }

  function nombreConcepto(codigo: string): string {
    return conceptos[codigo]?.nombre ?? aportes[codigo]?.nombre ?? codigo;
  }

  const glosa = `POR LA PROVISION DE LA PLANILLA DE SUELDOS CORRESPONDIENTE A ${nroDoc}`;
  const lineas: LineaAsientoContable[] = [];
  const faltantesMapeo: FaltanteAsientoContable[] = [];
  let totalDebe = 0;
  let totalHaber = 0;

  const proyectosOrdenados = [...montos.keys()].sort((a, b) => a - b);
  for (const proyectoId of proyectosOrdenados) {
    const proyectoNombre = proyectoNombrePorId.get(proyectoId) ?? `Proyecto ${proyectoId}`;
    const bucket = montos.get(proyectoId)!;
    for (const movimiento of ["DEBE", "HABER"] as const) {
      const entradas = [...bucket[movimiento].entries()].sort(([a], [b]) => a.localeCompare(b));
      for (const [codigoConcepto, monto] of entradas) {
        if (monto === 0) continue;
        const cuenta = mapeo.get(`${codigoConcepto}|${proyectoId}|${movimiento}`);
        if (!cuenta) {
          faltantesMapeo.push({
            concepto_codigo: codigoConcepto,
            concepto_nombre: nombreConcepto(codigoConcepto),
            proyecto_id: proyectoId,
            proyecto_nombre: proyectoNombre,
            tipo_movimiento: movimiento,
            motivo: "Falta configurar la cuenta contable de este concepto para este proyecto (Configuracion -> Configurar por proyecto).",
          });
          continue;
        }
        lineas.push({
          CODIGO: cuenta.codigo,
          D_H: movimiento === "DEBE" ? "D" : "H",
          FECHA: fecha,
          IMPORTE: monto,
          CODIGO_PRO: ruc,
          NRO_DOC: nroDoc,
          TIPO_DOC: "00",
          ECPN: "",
          EFE: "",
          DETALLE: `${nombreConcepto(codigoConcepto)} - ${proyectoNombre}`,
          MONTO_EXTR: "0",
          LUGAR: "01",
          GLOSA: glosa,
          COD_LIBRO: "05",
          COD_MOVIM: "M",
          ESTADO: "1",
        });
        if (movimiento === "DEBE") totalDebe = redondear(totalDebe + monto);
        else totalHaber = redondear(totalHaber + monto);
      }
    }
  }

  return {
    lineas,
    faltantes: [...faltantesIntegridad, ...faltantesMapeo],
    totalDebe,
    totalHaber,
  };
}

const COLUMNAS_FILA_DETALLE = `c.proyecto, c.categoria_ocupacional, c.sistema_pension, c.afp_nombre,
            d.sueldo_basico, d.remuneracion_dominical, d.remuneracion_dominical_proporcional, d.remuneracion_feriado,
            d.sobretasa_dominical, d.sobretasa_feriado, d.importe_horas_extra,
            d.asignacion_familiar, d.asignacion_escolaridad, d.bonificacion_buc, d.bonificacion_bae,
            d.bonificacion_movilidad, d.condicion_trabajo, d.subsidio_enfermedad, d.incapacidad_enfermedad, d.licencia_paternidad,
            d.gratificacion, d.bonificacion_extraordinaria, d.cts, d.vacaciones,
            d.aporte_pension, d.descuento_sindicato, d.seguro_vida, d.conafovicer, d.renta_5ta,
            d.essalud, d.sctr, d.senati, d.neto_pagar`;

/** Genera el asiento contable consolidado de un periodo de pago ya calculado. */
export async function generarAsientoContable(periodoId: number): Promise<ResultadoAsientoContable> {
  const periodoR = await pool.query("SELECT * FROM periodos_planilla WHERE id = $1", [periodoId]);
  if (periodoR.rowCount === 0) {
    // NOTA: la ruta (routes/exportaciones.ts) ya verifica esto antes de
    // llamar aqui y responde 404 directamente - este throw es solo un
    // resguardo defensivo si la funcion se llamara desde otro lado.
    throw new Error("Periodo no encontrado");
  }
  const periodo = periodoR.rows[0];
  const fecha = fechaDDMMYYYY(periodo.fecha_inicio);
  const nroDoc = `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}`;

  const detalleR = await pool.query(
    `SELECT ${COLUMNAS_FILA_DETALLE}
     FROM detalle_planilla d
     JOIN contratos c ON c.id = d.contrato_id
     WHERE d.periodo_id = $1 AND c.categoria_ocupacional <> 'EVENTUAL'`,
    [periodoId]
  );
  const conceptosPersonalizadosR = await pool.query(
    `SELECT dpc.concepto_codigo, dpc.monto, c.proyecto
     FROM detalle_planilla_conceptos dpc
     JOIN detalle_planilla d ON d.id = dpc.detalle_id
     JOIN contratos c ON c.id = d.contrato_id
     WHERE d.periodo_id = $1 AND c.categoria_ocupacional <> 'EVENTUAL'`,
    [periodoId]
  );

  return construirAsiento(fecha, nroDoc, detalleR.rows as FilaDetalleAsiento[], conceptosPersonalizadosR.rows as FilaConceptoPersonalizadoAsiento[]);
}

/**
 * Genera el asiento contable consolidado de una declaracion MENSUAL (Ronda E
 * + unificacion Reportes/Planilla Mensual) - por un proyecto o por TODA la
 * empresa (alcance.proyecto = null). Junta obreros ya consolidados
 * (detalle_planilla_mensual/detalle_planilla_conceptos_mensual, de cada
 * proyecto en el alcance) y empleados de ese mismo mes (detalle_planilla/
 * detalle_planilla_conceptos, via su propio periodo MENSUAL).
 * construirAsiento ya agrupa cada linea por el proyecto REAL de cada fila
 * (c.proyecto), asi que combinar varios proyectos/obreros+empleados en un
 * solo llamado produce automaticamente un asiento correctamente desglosado
 * por proyecto, sin cambios en esa funcion. La fecha del asiento es el
 * ULTIMO dia calendario del mes (mismo criterio contable de "provision al
 * cierre del mes" que ya usaba la version por proyecto).
 */
export async function generarAsientoContableMensual(alcance: AlcanceDeclaracionMensual): Promise<ResultadoAsientoContable> {
  const { hasta } = rangoDelMes(alcance.anio, alcance.mes);
  const fecha = fechaDDMMYYYY(hasta);
  const nroDoc = `${alcance.anio}-${String(alcance.mes).padStart(2, "0")}`;

  const cabeceras = await resolverCabecerasObreros(alcance);
  const cabeceraIds = cabeceras.map((c) => c.id);

  const obrerosR = await pool.query(
    `SELECT ${COLUMNAS_FILA_DETALLE}
     FROM detalle_planilla_mensual d
     JOIN contratos c ON c.id = d.contrato_id
     WHERE d.planilla_mensual_id = ANY($1::int[])`,
    [cabeceraIds]
  );
  const conceptosPersonalizadosObrerosR = await pool.query(
    `SELECT dpc.concepto_codigo, dpc.monto, c.proyecto
     FROM detalle_planilla_conceptos_mensual dpc
     JOIN detalle_planilla_mensual d ON d.id = dpc.detalle_id
     JOIN contratos c ON c.id = d.contrato_id
     WHERE d.planilla_mensual_id = ANY($1::int[])`,
    [cabeceraIds]
  );

  const empleadosR = await obtenerDetalleEmpleadosDelMes(alcance);
  const empleadosContratoIds = empleadosR.map((f: { contrato_id: number }) => f.contrato_id);
  const conceptosPersonalizadosEmpleadosR =
    empleadosContratoIds.length === 0
      ? { rows: [] }
      : await pool.query(
          `SELECT dpc.concepto_codigo, dpc.monto, c.proyecto
           FROM detalle_planilla_conceptos dpc
           JOIN detalle_planilla d ON d.id = dpc.detalle_id
           JOIN contratos c ON c.id = d.contrato_id
           WHERE d.contrato_id = ANY($1::int[]) AND d.periodo_id IN (
             SELECT id FROM periodos_planilla WHERE tipo = 'MENSUAL' AND anio = $2 AND mes = $3
           )`,
          [empleadosContratoIds, alcance.anio, alcance.mes]
        );

  return construirAsiento(
    fecha,
    nroDoc,
    [...(obrerosR.rows as FilaDetalleAsiento[]), ...(empleadosR as unknown as FilaDetalleAsiento[])],
    [...(conceptosPersonalizadosObrerosR.rows as FilaConceptoPersonalizadoAsiento[]), ...(conceptosPersonalizadosEmpleadosR.rows as FilaConceptoPersonalizadoAsiento[])]
  );
}
