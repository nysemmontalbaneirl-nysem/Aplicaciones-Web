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
// CORRECCIONES DE LA MIGRACION 035 (17/09/2026): al comparar este generador
// contra el catalogo oficial Tabla 22 y contra el sistema Excel/VBA legado
// de la empresa (ver docs/referencia-excel-legado/hallazgos-analisis-legado.md)
// se confirmo que varios conceptos SI se calculan y SI se pagan (entran a
// total_ingresos/neto_pagar) pero nunca se declaraban aqui:
//   - BUC: el codigo "0314" que se usaba SI es un codigo real del catalogo,
//     pero corresponde a "Bonificacion especial por trabajo agrario - Ley
//     31110 (BETA)", sin relacion con construccion civil. Corregido a
//     "0311" ("Bonificacion Unificada de Construccion").
//   - Asignacion por escolaridad (0211), Movilidad (0909), Vacaciones
//     (0117, "compensacion vacacional") y Bonificacion Extraordinaria Ley
//     29351/30334 (0313, "proporcional"): no tenian codigo_plame ni estaban
//     conectados aqui - ahora si se declaran.
//   - Horas extra: el monto ya se calculaba (importe_horas_extra) pero
//     nunca se emitia. Confirmado con el usuario: solo existen codigos
//     SUNAT para 25% (0105) y 35% (0106) - el convenio de construccion
//     civil paga 60%/100%, y el tramo de 100% de regimen general tampoco
//     tiene codigo propio, asi que todo lo que no sea el tramo1 de regimen
//     general (25% real) se declara bajo 0106. Ver calcularLineasHorasExtra.
//   - Subsidio por enfermedad (916->0916) y licencia por paternidad
//     (907->0907): les faltaba el 0 inicial (formato de 3 digitos en vez de
//     4), lo que generaba una linea mal formada.
// BAE (Bonificacion por Alta Especializacion) queda pendiente: no se
// encontro en el catalogo ninguna descripcion que coincida con este
// concepto especifico de JHCR - no se declara hasta que el usuario
// confirme el codigo.
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
//
// IMPORTANTE: valida cada archivo nuevo contra el detalle de una planilla
// real ya declarada antes de confiar en el, sobre todo si cambian las
// categorias o conceptos usados (por ejemplo con EMPLEADO/EVENTUAL, que no
// estaban presentes en la muestra revisada).
// =========================================================================

import { pool } from "./db";
import { obtenerConceptos } from "./routes/conceptos";
import { esConstruccionCivil, obtenerFactor } from "./motorCalculo";
import { CategoriaOcupacional } from "./tipos";

export const CONCEPTO = {
  REMUNERACION_BASICA: "0121",
  DESCANSO_FERIADO: "0115",
  HORAS_EXTRA_25: "0105",
  HORAS_EXTRA_35: "0106",
  ASIGNACION_FAMILIAR: "0201",
  ASIGNACION_ESCOLARIDAD: "0211", // migracion 035
  BUC_CONSTRUCCION: "0311", // migracion 035: corregido de "0314" (bonificacion agraria, otro concepto)
  MOVILIDAD: "0909", // migracion 035
  VACACIONES: "0117", // migracion 035: "compensacion vacacional"
  BONIFICACION_EXTRAORDINARIA: "0313", // migracion 035: "proporcional" (Ley 29351/30334)
  GRATIFICACION: "0406", // Ley 29351 - confirmado real, reemplaza el generico 0401
  CTS: "0904",

  AFP_APORTE_OBLIGATORIO: "0608",
  AFP_COMISION: "0601",
  AFP_PRIMA_SEGURO: "0606",
  CONAFOVICER: "0602",
  RENTA_5TA: "0605",
  CUOTA_SINDICAL: "0702",

  // Migracion 030: descanso medico por enfermedad y licencia por
  // paternidad AHORA SI se pagan (antes eran puramente informativos, sin
  // linea en el PLAME). Codigos confirmados en docs/tabla22_plame.json
  // (catalogo oficial SUNAT, TABLA22.xls) - no hay un codigo especifico de
  // "paternidad" en el catalogo, se usa 0907 "LICENCIA CON GOCE DE HABER"
  // (el que mas se ajusta, confirmado con el usuario).
  SUBSIDIO_INCAPACIDAD_ENFERMEDAD: "0916", // migracion 035: corregido de "916" (le faltaba el 0 inicial)
  LICENCIA_CON_GOCE_DE_HABER: "0907", // migracion 035: corregido de "907"

  // Codigos oficiales del catalogo, pendientes de confirmar en la practica (ver nota arriba)
  ONP: "0607",
  POLIZA_SEGURO_688: "0803",
  ESSALUD: "0804",
  SCTR_ESSALUD: "0806",
  SENATI: "0807",
} as const;

interface FilaExportacion {
  numero_documento: string;
  categoria_ocupacional: CategoriaOcupacional;
  sueldo_basico: string;
  remuneracion_dominical: string;
  // NOTA (recon 19/46): igual criterio que en afpnet.ts - estos 3 campos son
  // de la infraestructura de "dominical proporcional/sobretasa" (migraciones
  // 022/023/026), que NO existe en detalle_planilla (boleta por periodo de
  // pago) en este arbol - ver RECONSTRUCCION_BRECHAS.md punto 4. Opcionales:
  // generarLineasREM (por periodo) no los selecciona (num() los trata como
  // 0); generarLineasREMMensual (Ronda E) si, porque detalle_planilla_mensual
  // nace ya con esas columnas.
  remuneracion_dominical_proporcional?: string;
  sobretasa_dominical?: string;
  sobretasa_feriado?: string;
  remuneracion_feriado: string;
  horas_extra_25: string;
  horas_extra_35: string;
  horas_extra_100: string;
  jornal_diario: string;
  asignacion_familiar: string;
  asignacion_escolaridad: string;
  bonificacion_buc: string;
  bonificacion_movilidad: string;
  vacaciones: string;
  bonificacion_extraordinaria: string;
  subsidio_enfermedad: string;
  licencia_paternidad: string;
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

function num(valor: string | number | undefined): number {
  return Number(valor) || 0;
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
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

interface CodigosPlame {
  CODIGO_SUELDO_BASICO: string;
  CODIGO_DESCANSO_FERIADO: string;
  CODIGO_SOBRETASA_FERIADO_DESCANSO: string;
  CODIGO_ASIGNACION_FAMILIAR: string;
  CODIGO_ASIGNACION_ESCOLARIDAD: string;
  CODIGO_BUC: string;
  CODIGO_MOVILIDAD: string;
  CODIGO_VACACIONES: string;
  CODIGO_BONIFICACION_EXTRAORDINARIA: string;
  CODIGO_GRATIFICACION: string;
  CODIGO_CTS: string;
  CODIGO_SUBSIDIO_ENFERMEDAD: string;
  CODIGO_LICENCIA_PATERNIDAD: string;
  // Horas extra: 2 codigos fijos (0105/0106), no editables desde
  // Configuracion como los demas - ver calcularLineasHorasExtra. Los
  // factores SI son editables (HORAS_EXTRA_CONSTRUCCION/GENERAL), por eso
  // se resuelven aqui junto con los codigos.
  FACTORES_HORAS_EXTRA_CONSTRUCCION: [number, number, number];
  FACTORES_HORAS_EXTRA_GENERAL: [number, number, number];
}

/**
 * Resuelve los codigos PLAME editables desde Configuracion (migracion 019)
 * para los conceptos de INGRESO. Se usa el valor de CONCEPTO como respaldo
 * si la fila no trajera un codigo_plame. Compartido entre la exportacion por
 * periodo de pago y la exportacion mensual consolidada (Ronda E): el
 * catalogo de codigos PLAME es el mismo, sin importar de que tabla salga
 * cada monto.
 *
 * NOTA (recon 19/46): el parche original tambien resolvia codigos PLAME
 * configurables para los DESCUENTOS/APORTES (CUOTA_SINDICAL, CONAFOVICER,
 * RENTA_5TA, ONP) via un "obtenerAportes()" - un catalogo/pantalla de
 * Configuracion paralelo al de "Conceptos de ingreso" que no existe en este
 * arbol (no llego como parte de ningun parche recuperado). Esos 4 codigos se
 * mantienen con su valor fijo de CONCEPTO.*, igual que antes de este parche.
 */
async function resolverCodigosPlame(): Promise<CodigosPlame> {
  const conceptos = await obtenerConceptos();
  const codigoConcepto = (codigo: string, respaldo: string): string => conceptos[codigo]?.codigo_plame ?? respaldo;

  return {
    CODIGO_SUELDO_BASICO: codigoConcepto("SUELDO_BASICO", CONCEPTO.REMUNERACION_BASICA),
    CODIGO_DESCANSO_FERIADO: codigoConcepto("REM_FERIADO", CONCEPTO.DESCANSO_FERIADO),
    // NOTA (recon 19/46): CONCEPTO no tiene un codigo propio de "sobretasa
    // por feriado/dominical no laborado" (esa infraestructura, migraciones
    // 022/023/026, tampoco existe - ver RECONSTRUCCION_BRECHAS.md punto 4).
    // Se usa el mismo codigo que DESCANSO_FERIADO como respaldo: en el
    // periodo de pago el monto de sobretasa siempre es 0 (no se selecciona,
    // ver FilaExportacion), y en la Planilla Mensual Consolidada, mientras
    // no exista esa infraestructura, tambien sera 0 - no tiene efecto
    // practico todavia, pero deja el codigo correcto el dia que se
    // reconstruya esa brecha.
    CODIGO_SOBRETASA_FERIADO_DESCANSO: codigoConcepto("SOBRETASA_FERIADO", CONCEPTO.DESCANSO_FERIADO),
    CODIGO_ASIGNACION_FAMILIAR: codigoConcepto("ASIGNACION_FAMILIAR", CONCEPTO.ASIGNACION_FAMILIAR),
    CODIGO_ASIGNACION_ESCOLARIDAD: codigoConcepto("ASIGNACION_ESCOLARIDAD", CONCEPTO.ASIGNACION_ESCOLARIDAD),
    CODIGO_BUC: codigoConcepto("BUC", CONCEPTO.BUC_CONSTRUCCION),
    CODIGO_MOVILIDAD: codigoConcepto("MOVILIDAD", CONCEPTO.MOVILIDAD),
    CODIGO_VACACIONES: codigoConcepto("VACACIONES", CONCEPTO.VACACIONES),
    CODIGO_BONIFICACION_EXTRAORDINARIA: codigoConcepto("BONIFICACION_EXTRAORDINARIA", CONCEPTO.BONIFICACION_EXTRAORDINARIA),
    CODIGO_GRATIFICACION: codigoConcepto("GRATIFICACION", CONCEPTO.GRATIFICACION),
    CODIGO_CTS: codigoConcepto("CTS", CONCEPTO.CTS),
    CODIGO_SUBSIDIO_ENFERMEDAD: codigoConcepto("SUBSIDIO_ENFERMEDAD", CONCEPTO.SUBSIDIO_INCAPACIDAD_ENFERMEDAD),
    CODIGO_LICENCIA_PATERNIDAD: codigoConcepto("LICENCIA_PATERNIDAD", CONCEPTO.LICENCIA_CON_GOCE_DE_HABER),
    FACTORES_HORAS_EXTRA_CONSTRUCCION: [
      obtenerFactor(conceptos, "HORAS_EXTRA_CONSTRUCCION", "factor1"),
      obtenerFactor(conceptos, "HORAS_EXTRA_CONSTRUCCION", "factor2"),
      obtenerFactor(conceptos, "HORAS_EXTRA_CONSTRUCCION", "factor3"),
    ],
    FACTORES_HORAS_EXTRA_GENERAL: [
      obtenerFactor(conceptos, "HORAS_EXTRA_GENERAL", "factor1"),
      obtenerFactor(conceptos, "HORAS_EXTRA_GENERAL", "factor2"),
      obtenerFactor(conceptos, "HORAS_EXTRA_GENERAL", "factor3"),
    ],
  };
}

/**
 * Lineas PLAME de horas extra a partir de las horas ya acumuladas por tramo
 * (horas_extra_25/35/100, mismos "tramos" que motorCalculo.ts usa para
 * calcular el importe combinado - ver calcularHorasExtra) y del jornal
 * diario ya guardado en el detalle. Confirmado con el usuario (17/09/2026):
 * el catalogo SUNAT solo tiene codigo para el recargo de 25% (0105) y de
 * 35% (0106) - construccion civil paga 60%/100% (sin codigo propio) y el
 * tramo de 100% de regimen general tampoco lo tiene, asi que TODO lo que no
 * sea el tramo1 de regimen general (que si es 25% real) se declara bajo
 * 0106, igual criterio que el usuario ya aplica a mano en su declaracion.
 */
function calcularLineasHorasExtra(fila: FilaExportacion, codigos: CodigosPlame): Array<[string, number]> {
  const jornalHora = num(fila.jornal_diario) / 8;
  const esConstruccion = esConstruccionCivil(fila.categoria_ocupacional);
  const [r1, r2, r3] = esConstruccion ? codigos.FACTORES_HORAS_EXTRA_CONSTRUCCION : codigos.FACTORES_HORAS_EXTRA_GENERAL;
  const importeTramo1 = redondear(jornalHora * r1 * num(fila.horas_extra_25));
  const importeTramo2 = redondear(jornalHora * r2 * num(fila.horas_extra_35));
  const importeTramo3 = redondear(jornalHora * r3 * num(fila.horas_extra_100));

  if (esConstruccion) {
    return [[CONCEPTO.HORAS_EXTRA_35, redondear(importeTramo1 + importeTramo2 + importeTramo3)]];
  }
  return [
    [CONCEPTO.HORAS_EXTRA_25, importeTramo1],
    [CONCEPTO.HORAS_EXTRA_35, redondear(importeTramo2 + importeTramo3)],
  ];
}

/**
 * Arma las lineas .rem a partir de filas YA obtenidas (de detalle_planilla o
 * de detalle_planilla_mensual - mismas columnas, ver migracion 034) y de los
 * montos de conceptos personalizados ya agrupados por DNI+codigo PLAME.
 * Extraido para que generarLineasREM (por periodo de pago) y
 * generarLineasREMMensual (Ronda E, por mes calendario consolidado) compartan
 * exactamente la misma logica de formateo/reglas, sin duplicarla.
 */
function construirLineasREM(
  filas: FilaExportacion[],
  personalizadosRows: { numero_documento: string; codigo_plame: string; monto: string }[],
  codigos: CodigosPlame
): string[] {
  const {
    CODIGO_SUELDO_BASICO,
    CODIGO_DESCANSO_FERIADO,
    CODIGO_SOBRETASA_FERIADO_DESCANSO,
    CODIGO_ASIGNACION_FAMILIAR,
    CODIGO_ASIGNACION_ESCOLARIDAD,
    CODIGO_BUC,
    CODIGO_MOVILIDAD,
    CODIGO_VACACIONES,
    CODIGO_BONIFICACION_EXTRAORDINARIA,
    CODIGO_GRATIFICACION,
    CODIGO_CTS,
    CODIGO_SUBSIDIO_ENFERMEDAD,
    CODIGO_LICENCIA_PATERNIDAD,
  } = codigos;

  // Conceptos PERSONALIZADOS (migracion 033, Ronda D "formula propia"): sus
  // montos viven en detalle_planilla_conceptos (catalogo abierto), no en
  // columnas fijas. Solo se declaran los que tengan codigo_plame configurado
  // (igual criterio que CONDICION_TRABAJO arriba: si no tiene codigo_plame,
  // se entiende que el usuario decidio no declararlo). Se agrupan por DNI y
  // por codigo PLAME (por si 2 conceptos personalizados distintos comparten
  // el mismo codigo, sus montos se suman en una sola linea).
  const personalizadosPorDni = new Map<string, Map<string, number>>();
  for (const fila of personalizadosRows) {
    const porCodigo = personalizadosPorDni.get(fila.numero_documento) ?? new Map<string, number>();
    porCodigo.set(fila.codigo_plame, redondear((porCodigo.get(fila.codigo_plame) ?? 0) + num(fila.monto)));
    personalizadosPorDni.set(fila.numero_documento, porCodigo);
  }

  const lineas: string[] = [];

  for (const fila of filas) {
    const dni = fila.numero_documento;
    const aporteDetalle = fila.detalle_json?.aporte_pension_detalle;
    const sobretasa = num(fila.sobretasa_dominical) + num(fila.sobretasa_feriado);

    const candidatas: Array<[string, number]> = [
      [CODIGO_SUELDO_BASICO, num(fila.sueldo_basico)],
      [
        CODIGO_DESCANSO_FERIADO,
        num(fila.remuneracion_dominical) + num(fila.remuneracion_dominical_proporcional) + num(fila.remuneracion_feriado),
      ],
      [CODIGO_SOBRETASA_FERIADO_DESCANSO, sobretasa],
      [CODIGO_ASIGNACION_FAMILIAR, num(fila.asignacion_familiar)],
      [CODIGO_ASIGNACION_ESCOLARIDAD, num(fila.asignacion_escolaridad)],
      [CODIGO_BUC, num(fila.bonificacion_buc)],
      [CODIGO_MOVILIDAD, num(fila.bonificacion_movilidad)],
      [CODIGO_VACACIONES, num(fila.vacaciones)],
      [CODIGO_BONIFICACION_EXTRAORDINARIA, num(fila.bonificacion_extraordinaria)],
      [CODIGO_SUBSIDIO_ENFERMEDAD, num(fila.subsidio_enfermedad)],
      [CODIGO_LICENCIA_PATERNIDAD, num(fila.licencia_paternidad)],
      [CODIGO_GRATIFICACION, num(fila.gratificacion)],
      [CODIGO_CTS, num(fila.cts)],

      [CONCEPTO.CUOTA_SINDICAL, num(fila.descuento_sindicato)],
      [CONCEPTO.CONAFOVICER, num(fila.conafovicer)],
      [CONCEPTO.RENTA_5TA, num(fila.renta_5ta)],
      ...calcularLineasHorasExtra(fila, codigos),
    ];

    // BAE (bonificacion_bae) NO se incluye: pendiente de que el usuario
    // confirme bajo que codigo PLAME declararlo (ver nota en CONCEPTO /
    // migracion 035) - no hay un candidato claro en el catalogo Tabla 22.

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

    const personalizados = personalizadosPorDni.get(dni);
    if (personalizados) {
      for (const [codigoPlame, monto] of personalizados) {
        candidatas.push([codigoPlame, monto]);
      }
    }

    for (const [codigo, monto] of candidatas) {
      const linea = lineaRem(dni, codigo, monto, monto);
      if (linea) lineas.push(linea);
    }
  }

  return lineas;
}

// Columnas comunes a ambas variantes (periodo de pago y mensual consolidada).
const COLUMNAS_FILA_EXPORTACION = `sueldo_basico, remuneracion_dominical, remuneracion_feriado,
            horas_extra_25, horas_extra_35, horas_extra_100, jornal_diario,
            asignacion_familiar, asignacion_escolaridad, bonificacion_buc,
            bonificacion_movilidad, vacaciones, bonificacion_extraordinaria,
            subsidio_enfermedad, licencia_paternidad,
            gratificacion, cts, aporte_pension, descuento_sindicato,
            conafovicer, renta_5ta, seguro_vida, essalud, sctr, senati,
            detalle_json`;

// Solo para la variante MENSUAL (Ronda E): detalle_planilla_mensual nace ya
// con las columnas de "dominical proporcional/sobretasa" (ver schema.sql),
// a diferencia de detalle_planilla (ver NOTA en FilaExportacion arriba).
const COLUMNAS_FILA_EXPORTACION_MENSUAL = `${COLUMNAS_FILA_EXPORTACION},
            remuneracion_dominical_proporcional, sobretasa_dominical, sobretasa_feriado`;

/**
 * Genera las lineas del archivo .rem para un periodo de pago ya calculado.
 * Excluye EVENTUAL: no esta en planilla (ver motorCalculo.ts), asi que no
 * corresponde declararlo en el T-Registro/PDT.
 */
export async function generarLineasREM(periodoId: number): Promise<string[]> {
  const codigos = await resolverCodigosPlame();

  const resultado = await pool.query<FilaExportacion>(
    `SELECT e.numero_documento, c.sistema_pension, c.categoria_ocupacional, d.${COLUMNAS_FILA_EXPORTACION}
     FROM detalle_planilla d
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     WHERE d.periodo_id = $1 AND c.categoria_ocupacional <> 'EVENTUAL'
     ORDER BY e.numero_documento`,
    [periodoId]
  );

  // Conceptos PERSONALIZADOS (migracion 033, Ronda D "formula propia"): sus
  // montos viven en detalle_planilla_conceptos (catalogo abierto), no en
  // columnas fijas. Solo se declaran los que tengan codigo_plame configurado
  // (igual criterio que CONDICION_TRABAJO arriba: si no tiene codigo_plame,
  // se entiende que el usuario decidio no declararlo). Se agrupan por DNI y
  // por codigo PLAME (por si 2 conceptos personalizados distintos comparten
  // el mismo codigo, sus montos se suman en una sola linea).
  const personalizadosResult = await pool.query<{ numero_documento: string; codigo_plame: string; monto: string }>(
    `SELECT e.numero_documento, cp.codigo_plame, dpc.monto
     FROM detalle_planilla_conceptos dpc
     JOIN detalle_planilla d ON d.id = dpc.detalle_id
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     JOIN conceptos_planilla cp ON cp.codigo = dpc.concepto_codigo
     WHERE d.periodo_id = $1 AND c.categoria_ocupacional <> 'EVENTUAL' AND cp.codigo_plame IS NOT NULL`,
    [periodoId]
  );

  return construirLineasREM(resultado.rows, personalizadosResult.rows, codigos);
}

/**
 * Genera las lineas del archivo .rem para una Planilla Mensual Consolidada ya
 * calculada (Ronda E, migracion 034) - equivalente a generarLineasREM pero
 * leyendo de detalle_planilla_mensual/detalle_planilla_conceptos_mensual en
 * vez de detalle_planilla/detalle_planilla_conceptos. Aplica solo a obreros
 * (construccion civil): esta tabla nunca tiene EVENTUAL ni EMPLEADO (ver
 * consolidarPlanillaMensual en planillaMensual.ts), asi que no hace falta
 * repetir aqui el filtro por categoria_ocupacional.
 */
export async function generarLineasREMMensual(planillaMensualId: number): Promise<string[]> {
  const codigos = await resolverCodigosPlame();

  const resultado = await pool.query<FilaExportacion>(
    `SELECT e.numero_documento, c.sistema_pension, c.categoria_ocupacional, d.${COLUMNAS_FILA_EXPORTACION_MENSUAL}
     FROM detalle_planilla_mensual d
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     WHERE d.planilla_mensual_id = $1
     ORDER BY e.numero_documento`,
    [planillaMensualId]
  );

  const personalizadosResult = await pool.query<{ numero_documento: string; codigo_plame: string; monto: string }>(
    `SELECT e.numero_documento, cp.codigo_plame, dpc.monto
     FROM detalle_planilla_conceptos_mensual dpc
     JOIN detalle_planilla_mensual d ON d.id = dpc.detalle_id
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     JOIN conceptos_planilla cp ON cp.codigo = dpc.concepto_codigo
     WHERE d.planilla_mensual_id = $1 AND cp.codigo_plame IS NOT NULL`,
    [planillaMensualId]
  );

  return construirLineasREM(resultado.rows, personalizadosResult.rows, codigos);
}
