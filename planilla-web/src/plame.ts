// =========================================================================
// Exportacion de archivos planos PLAME (T-Registro / PDT Planilla Electronica)
// Regimen: CONSTRUCCION CIVIL (JHCR).
//
// Formato del archivo .rem: una linea por cada concepto con valor distinto
// de cero, pipe-delimitado:
//   tipo_planilla(2) | DNI(8) | codigo_concepto(4) | devengado(0.00) | percibido(0.00)
//
// CODIGOS VALIDADOS el 22/08/2026 contra 2 archivos .rem REALES, ya
// generados y aceptados por SUNAT, de esta misma empresa (regimen
// construccion civil, confirmado por el usuario):
//   0121 remuneracion basica | 0201 asignacion familiar | 0406 gratificacion
//   (Ley 29351, NO 0401 generico) | 0904 CTS | 0608 SPP aporte obligatorio |
//   0601 SPP comision | 0606 SPP prima de seguro | 0602 CONAFOVICER |
//   0605 renta 5ta.
//
// PENDIENTE DE VALIDAR (no aparecen en los archivos reales de esta empresa,
// pero SI son codigos oficiales del catalogo SUNAT - se omiten aqui hasta
// que el usuario confirme si deben declararse):
//   - ONP (0607): ningun trabajador de la muestra esta afiliado a ONP,
//     asi que no se pudo confirmar el codigo en la practica.
//   - ESSALUD regular 9% (0804), poliza de seguro D.Leg 688 (0803) y
//     SENATI (0807): ausentes en ambos archivos reales revisados. Puede
//     ser que se declaren en otro sitio o que sea un vacio de la plantilla
//     original - por eso este generador tampoco los emite por ahora.
//   - "0314" (usado por la empresa real para lo que aqui es BUC/bonificacion
//     unificada de construccion): este codigo NO aparece en el catalogo
//     oficial de la Tabla 22 que se encontro en el Excel (que solo llega
//     hasta 0313 antes de saltar a la serie 0400) - aun asi, como aparece
//     en 2 archivos reales aceptados por SUNAT con montos consistentes con
//     el BUC (32%/30% del jornal), se usa aqui con alta confianza pero
//     sigue sin poder confirmarse contra el catalogo oficial.
//
// IMPORTANTE: valida cada archivo nuevo contra el detalle de una planilla
// real ya declarada antes de confiar en el, sobre todo si cambian las
// categorias o conceptos usados (por ejemplo con EMPLEADO/EVENTUAL, que no
// estaban presentes en la muestra revisada).
// =========================================================================

import { pool } from "./db";

export const CONCEPTO = {
  REMUNERACION_BASICA: "0121",
  DESCANSO_FERIADO: "0115",
  HORAS_EXTRA_25: "0105",
  HORAS_EXTRA_35: "0106",
  ASIGNACION_FAMILIAR: "0201",
  BUC_CONSTRUCCION: "0314", // ver nota arriba: no esta en el catalogo oficial, pero confirmado en archivos reales
  GRATIFICACION: "0406", // Ley 29351 - confirmado real, reemplaza el generico 0401
  CTS: "0904",

  AFP_APORTE_OBLIGATORIO: "0608",
  AFP_COMISION: "0601",
  AFP_PRIMA_SEGURO: "0606",
  CONAFOVICER: "0602",
  RENTA_5TA: "0605",
  CUOTA_SINDICAL: "0702",

  // Codigos oficiales del catalogo, pendientes de confirmar en la practica (ver nota arriba)
  ONP: "0607",
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
    ];

    // AFP: confirmado en archivos reales. ONP: sin confirmar (ver cabecera del archivo) -
    // se emite igual porque omitirlo dejaria a los trabajadores por ONP sin ningun
    // concepto de pension declarado, lo cual es claramente peor que usar el codigo
    // oficial del catalogo aunque no se haya visto en la practica todavia.
    if (fila.sistema_pension === "ONP") {
      candidatas.push([CONCEPTO.ONP, num(fila.aporte_pension)]);
    } else if (aporteDetalle) {
      candidatas.push([CONCEPTO.AFP_APORTE_OBLIGATORIO, aporteDetalle.aporteObligatorio]);
      candidatas.push([CONCEPTO.AFP_COMISION, aporteDetalle.comisionFlujo]);
      candidatas.push([CONCEPTO.AFP_PRIMA_SEGURO, aporteDetalle.primaSeguro]);
    }

    // NO se incluyen POLIZA_SEGURO_688 (0803), ESSALUD (0804) ni SENATI (0807):
    // ausentes en los 2 archivos reales revisados de esta empresa. Si el
    // usuario confirma que si deben declararse, agregar aqui:
    //   [CONCEPTO.POLIZA_SEGURO_688, num(fila.seguro_vida)],
    //   [CONCEPTO.ESSALUD, num(fila.essalud)],
    //   [CONCEPTO.SENATI, num(fila.senati)],

    for (const [codigo, monto] of candidatas) {
      const linea = lineaRem(dni, codigo, monto, monto);
      if (linea) lineas.push(linea);
    }
  }

  return lineas;
}
