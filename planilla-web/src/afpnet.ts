// =========================================================================
// Exportacion para AFPnet.
//
// El Excel original (Modulo_AFPnet.bas) NO genera el archivo plano oficial
// de la SBS - genera un Excel filtrado por proyecto con CUSPP y montos de
// aporte, pensado para digitar/subir manualmente en el portal de AFPnet.
// Replicamos ese mismo enfoque (confirmado con el usuario), como CSV
// (Excel lo abre nativamente) en vez de generar el layout binario SBS,
// que no esta documentado en las macros disponibles.
// =========================================================================

import { pool } from "./db";
import { AlcanceDeclaracionMensual, obtenerDetalleEmpleadosDelMes, resolverCabecerasObreros } from "./planillaMensual";

export interface FilaAFPnet {
  numero_documento: string;
  apellidos_nombres: string;
  cuspp: string | null;
  afp_nombre: string | null;
  proyecto: string;
  sueldo_basico: string;
  remuneracion_dominical: string;
  // NOTA (recon 19/46): remuneracion_dominical_proporcional/sobretasa_dominical/
  // sobretasa_feriado son parte de la infraestructura de "dominical
  // proporcional / feriado no laborado" (migraciones 022/023/026), que NO
  // existe todavia en detalle_planilla (boleta por periodo de pago) en este
  // arbol reconstruido - ver RECONSTRUCCION_BRECHAS.md punto 4. Por eso son
  // opcionales aqui: generarCSVAFPnet (por periodo) no los selecciona y
  // quedan undefined (num() los trata como 0); generarCSVAFPnetMensual (Ronda
  // E) si los selecciona, porque detalle_planilla_mensual es una tabla NUEVA
  // que ya nace con esas columnas (ver migracion 034 en schema.sql).
  remuneracion_dominical_proporcional?: string;
  remuneracion_feriado: string;
  sobretasa_dominical?: string;
  sobretasa_feriado?: string;
  bonificacion_buc: string;
  asignacion_familiar: string;
  detalle_json: { aporte_pension_detalle?: { aporteObligatorio: number; comisionFlujo: number; primaSeguro: number } };
}

function num(valor: string | number | undefined): number {
  return Number(valor) || 0;
}

/**
 * Base imponible ("remuneracion afecta") sobre la que se calculan los
 * aportes de AFP - se usa tanto para el CSV simplificado (mas abajo) como
 * para el archivo Excel OFICIAL de AFPnet (ver afpnetExcel.ts, columna
 * "Remuneracion asegurable"), confirmado explicitamente con el usuario que
 * debe ser la misma formula en ambos.
 */
export function calcularRemuneracionAfectaAfp(f: FilaAFPnet): number {
  return (
    num(f.sueldo_basico) +
    num(f.remuneracion_dominical) +
    num(f.remuneracion_dominical_proporcional) +
    num(f.remuneracion_feriado) +
    num(f.sobretasa_dominical) +
    num(f.sobretasa_feriado) +
    num(f.bonificacion_buc) +
    num(f.asignacion_familiar)
  );
}

function csvEscape(valor: string | number): string {
  const texto = String(valor);
  if (texto.includes(",") || texto.includes('"') || texto.includes("\n")) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

// Columnas comunes para la variante MENSUAL (Ronda E, migracion 034), que
// si tiene las columnas de "dominical proporcional/sobretasa" porque
// detalle_planilla_mensual nace ya con ellas (ver schema.sql).
const COLUMNAS_FILA_AFPNET_MENSUAL = `e.numero_documento, e.apellidos_nombres, c.cuspp, c.afp_nombre, c.proyecto,
            d.sueldo_basico, d.remuneracion_dominical, d.remuneracion_dominical_proporcional, d.remuneracion_feriado,
            d.sobretasa_dominical, d.sobretasa_feriado,
            d.bonificacion_buc, d.asignacion_familiar, d.detalle_json`;

/**
 * Arma el CSV a partir de filas YA obtenidas (de detalle_planilla o de
 * detalle_planilla_mensual - mismas columnas, ver migracion 034). Extraido
 * para que generarCSVAFPnet (por periodo de pago) y generarCSVAFPnetMensual
 * (Ronda E, por mes calendario consolidado) compartan la misma logica de
 * calculo/formato sin duplicarla.
 */
function construirCSVAFPnet(filas: FilaAFPnet[]): string {
  const encabezado = [
    "DNI",
    "Apellidos y nombres",
    "CUSPP",
    "AFP",
    "Proyecto",
    "Remuneracion afecta",
    "Aporte obligatorio",
    "Comision",
    "Prima de seguro",
    "Total aporte AFP",
  ].join(",");

  const filasCsv = filas.map((f) => {
    const remuneracionAfecta = calcularRemuneracionAfectaAfp(f);
    const d = f.detalle_json?.aporte_pension_detalle;
    const total = (d?.aporteObligatorio ?? 0) + (d?.comisionFlujo ?? 0) + (d?.primaSeguro ?? 0);

    return [
      csvEscape(f.numero_documento),
      csvEscape(f.apellidos_nombres),
      csvEscape(f.cuspp ?? ""),
      csvEscape(f.afp_nombre ?? ""),
      csvEscape(f.proyecto),
      remuneracionAfecta.toFixed(2),
      (d?.aporteObligatorio ?? 0).toFixed(2),
      (d?.comisionFlujo ?? 0).toFixed(2),
      (d?.primaSeguro ?? 0).toFixed(2),
      total.toFixed(2),
    ].join(",");
  });

  return [encabezado, ...filasCsv].join("\n");
}

/** Genera el CSV de aportes AFP de un periodo de pago, opcionalmente filtrado por proyecto. */
export async function generarCSVAFPnet(periodoId: number, proyecto?: string): Promise<string> {
  // EVENTUAL no esta en planilla (ver motorCalculo.ts) y no aporta a
  // pension, asi que se excluye aunque su contrato tenga sistema_pension AFP.
  const condiciones = ["d.periodo_id = $1", "c.sistema_pension = 'AFP'", "c.categoria_ocupacional <> 'EVENTUAL'"];
  const valores: unknown[] = [periodoId];
  if (proyecto) {
    valores.push(proyecto);
    condiciones.push(`c.proyecto = $${valores.length}`);
  }

  // NOTA (recon 19/46): a diferencia de la variante mensual, aqui NO se
  // seleccionan remuneracion_dominical_proporcional/sobretasa_dominical/
  // sobretasa_feriado - detalle_planilla (boleta por periodo de pago) no
  // tiene esas columnas todavia en este arbol (ver comentario en FilaAFPnet).
  // construirCSVAFPnet las trata como 0 automaticamente (num() de undefined).
  const resultado = await pool.query<FilaAFPnet>(
    `SELECT e.numero_documento, e.apellidos_nombres, c.cuspp, c.afp_nombre, c.proyecto,
            d.sueldo_basico, d.remuneracion_dominical, d.remuneracion_feriado,
            d.bonificacion_buc, d.asignacion_familiar, d.detalle_json
     FROM detalle_planilla d
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     WHERE ${condiciones.join(" AND ")}
     ORDER BY e.apellidos_nombres`,
    valores
  );

  return construirCSVAFPnet(resultado.rows);
}

/**
 * Genera el CSV de aportes AFP de una declaracion MENSUAL (Ronda E +
 * unificacion Reportes/Planilla Mensual, 22/09/2026) - por un proyecto o por
 * TODA la empresa (alcance.proyecto = null). Junta obreros ya consolidados
 * (detalle_planilla_mensual, de cada proyecto en el alcance) y empleados de
 * ese mismo mes (detalle_planilla, via su propio periodo MENSUAL) - ambos
 * filtrados a sistema_pension = 'AFP' (los aportes ONP no van en este archivo).
 *
 * Nota heredada (bug real de produccion, corregido 21/09/2026): el filtro de
 * proyecto para obreros se resuelve por planilla_mensual.proyecto (columna
 * de la propia cabecera, ver resolverCabecerasObreros), nunca por
 * "c.proyecto" del contrato individual - evita excluir en silencio a un
 * trabajador cuyo contrato tuviera el proyecto desactualizado despues de
 * consolidar. Para empleados, en cambio, SI se filtra por c.proyecto (su
 * propio criterio, ver obtenerDetalleEmpleadosDelMes) porque ahi no existe
 * ninguna cabecera equivalente que fije el proyecto de antemano.
 */
export async function generarCSVAFPnetMensual(alcance: AlcanceDeclaracionMensual): Promise<string> {
  const cabeceras = await resolverCabecerasObreros(alcance);
  const cabeceraIds = cabeceras.map((c) => c.id);

  const obrerosResultado = await pool.query<FilaAFPnet>(
    `SELECT ${COLUMNAS_FILA_AFPNET_MENSUAL}
     FROM detalle_planilla_mensual d
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     WHERE d.planilla_mensual_id = ANY($1::int[]) AND c.sistema_pension = 'AFP'
     ORDER BY e.apellidos_nombres`,
    [cabeceraIds]
  );

  const empleados = (await obtenerDetalleEmpleadosDelMes(alcance)) as unknown as (FilaAFPnet & { sistema_pension: string })[];
  const empleadosAfp = empleados.filter((f) => f.sistema_pension === "AFP");

  return construirCSVAFPnet([...obrerosResultado.rows, ...empleadosAfp]);
}
