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

interface FilaAFPnet {
  numero_documento: string;
  apellidos_nombres: string;
  cuspp: string | null;
  afp_nombre: string | null;
  proyecto: string;
  sueldo_basico: string;
  remuneracion_dominical: string;
  remuneracion_feriado: string;
  bonificacion_buc: string;
  asignacion_familiar: string;
  detalle_json: { aporte_pension_detalle?: { aporteObligatorio: number; comisionFlujo: number; primaSeguro: number } };
}

function num(valor: string | number): number {
  return Number(valor) || 0;
}

function csvEscape(valor: string | number): string {
  const texto = String(valor);
  if (texto.includes(",") || texto.includes('"') || texto.includes("\n")) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/** Genera el CSV de aportes AFP de un periodo, opcionalmente filtrado por proyecto. */
export async function generarCSVAFPnet(periodoId: number, proyecto?: string): Promise<string> {
  const condiciones = ["d.periodo_id = $1", "c.sistema_pension = 'AFP'"];
  const valores: unknown[] = [periodoId];
  if (proyecto) {
    valores.push(proyecto);
    condiciones.push(`c.proyecto = $${valores.length}`);
  }

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

  const filas = resultado.rows.map((f) => {
    const remuneracionAfecta =
      num(f.sueldo_basico) + num(f.remuneracion_dominical) + num(f.remuneracion_feriado) +
      num(f.bonificacion_buc) + num(f.asignacion_familiar);
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

  return [encabezado, ...filas].join("\n");
}
