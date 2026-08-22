// =========================================================================
// Exportacion de archivos planos PLAME (T-Registro / PDT Planilla Electronica)
//
// Formato y codigos de concepto confirmados contra:
//  1) La hoja "Tablas" del archivo Excel original (Tabla 22 oficial SUNAT:
//     "Ingresos, tributos y descuentos") - catalogo completo de codigos.
//  2) La macro Generatxt.bas (Sub informacion_REM) que genera el .rem real.
//  3) Datos de muestra reales encontrados en el propio archivo Excel.
//
// Formato del archivo .rem: una linea por cada concepto con valor distinto
// de cero, pipe-delimitado:
//   tipo_planilla(2) | DNI(8) | codigo_concepto(4) | devengado(0.00) | percibido(0.00)
//
// IMPORTANTE: valida el primer archivo generado contra un PLAME ya
// declarado y aceptado por SUNAT antes de usarlo en produccion. El
// desglose de SCTR (0805 pensiones / 0806 essalud) esta simplificado:
// aqui se envia todo bajo 0806, VALIDAR si tu caso requiere separarlo.
// =========================================================================

import { pool } from "./db";

export const CONCEPTO = {
  REMUNERACION_BASICA: "0121",
  DESCANSO_FERIADO: "0115",
  HORAS_EXTRA_25: "0105",
  HORAS_EXTRA_35: "0106",
  ASIGNACION_FAMILIAR: "0201",
  BUC_CONSTRUCCION: "0311",
  GRATIFICACION: "0401",
  CTS: "0904",

  ONP: "0607",
  AFP_APORTE_OBLIGATORIO: "0608",
  AFP_COMISION: "0601",
  AFP_PRIMA_SEGURO: "0606",
  CONAFOVICER: "0602",
  RENTA_5TA: "0605",
  CUOTA_SINDICAL: "0702",

  POLIZA_SEGURO_688: "0803",
  ESSALUD: "0804",
  SCTR_ESSALUD: "0806",
  SENATI: "0807",
} as const;

interface FilaExportacion {
  numero_documento: string;
  sueldo_basico: string;
  remuneracion_dominical: string;
  remuneracion_feriado: string;
  importe_horas_extra: string;
  asignacion_familiar: string;
  bonificacion_buc: string;
  gratificacion: string;
  cts: string;
  aporte_pension: string;
  sistema_pension: "AFP" | "ONP";
  descuento_sindicato: string;
  conafovicer: string;
  renta_5ta: string;
  seguro_vida: string;
  essalud: string;
  sctr: string;
  senati: string;
  detalle_json: { aporte_pension_detalle?: { aporteObligatorio: number; comisionFlujo: number; primaSeguro: number } };
}

function num(valor: string | number): number {
  return Number(valor) || 0;
}

function formateaMonto(valor: number): string {
  return valor.toFixed(2);
}

/** Codigo de tipo de planilla usado como primer campo de cada linea (fijo en "01" salvo que definas otros regimenes). */
const TIPO_PLANILLA = "01";

function lineaRem(dni: string, codigo: string, devengado: number, percibido: number): string | null {
  if (devengado === 0 && percibido === 0) return null;
  return `${TIPO_PLANILLA}|${dni.padStart(8, "0")}|${codigo}|${formateaMonto(devengado)}|${formateaMonto(percibido)}|`;
}

/** Genera las lineas del archivo .rem para un periodo ya calculado. */
export async function generarLineasREM(periodoId: number): Promise<string[]> {
  const resultado = await pool.query<FilaExportacion>(
    `SELECT e.numero_documento, c.sistema_pension,
            d.sueldo_basico, d.remuneracion_dominical, d.remuneracion_feriado,
            d.importe_horas_extra, d.asignacion_familiar, d.bonificacion_buc,
            d.gratificacion, d.cts, d.aporte_pension, d.descuento_sindicato,
            d.conafovicer, d.renta_5ta, d.seguro_vida, d.essalud, d.sctr, d.senati,
            d.detalle_json
     FROM detalle_planilla d
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     WHERE d.periodo_id = $1
     ORDER BY e.numero_documento`,
    [periodoId]
  );

  const lineas: string[] = [];

  for (const fila of resultado.rows) {
    const dni = fila.numero_documento;
    const aporteDetalle = fila.detalle_json?.aporte_pension_detalle;

    const candidatas: Array<[string, number]> = [
      [CONCEPTO.REMUNERACION_BASICA, num(fila.sueldo_basico)],
      [CONCEPTO.DESCANSO_FERIADO, num(fila.remuneracion_dominical) + num(fila.remuneracion_feriado)],
      [CONCEPTO.ASIGNACION_FAMILIAR, num(fila.asignacion_familiar)],
      [CONCEPTO.BUC_CONSTRUCCION, num(fila.bonificacion_buc)],
      [CONCEPTO.GRATIFICACION, num(fila.gratificacion)],
      [CONCEPTO.CTS, num(fila.cts)],

      [CONCEPTO.CUOTA_SINDICAL, num(fila.descuento_sindicato)],
      [CONCEPTO.CONAFOVICER, num(fila.conafovicer)],
      [CONCEPTO.RENTA_5TA, num(fila.renta_5ta)],

      [CONCEPTO.POLIZA_SEGURO_688, num(fila.seguro_vida)],
      [CONCEPTO.ESSALUD, num(fila.essalud)],
      [CONCEPTO.SCTR_ESSALUD, num(fila.sctr)],
      [CONCEPTO.SENATI, num(fila.senati)],
    ];

    if (fila.sistema_pension === "ONP") {
      candidatas.push([CONCEPTO.ONP, num(fila.aporte_pension)]);
    } else if (aporteDetalle) {
      candidatas.push([CONCEPTO.AFP_APORTE_OBLIGATORIO, aporteDetalle.aporteObligatorio]);
      candidatas.push([CONCEPTO.AFP_COMISION, aporteDetalle.comisionFlujo]);
      candidatas.push([CONCEPTO.AFP_PRIMA_SEGURO, aporteDetalle.primaSeguro]);
    }

    for (const [codigo, monto] of candidatas) {
      const linea = lineaRem(dni, codigo, monto, monto);
      if (linea) lineas.push(linea);
    }
  }

  return lineas;
}
