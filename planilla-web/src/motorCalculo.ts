// =========================================================================
// Motor de calculo de planilla
// Reconstruido a partir del analisis de la hoja PLANTILLA y las macros
// BUSCARV2/BUSCARV3 del archivo Excel original (regimen Construccion Civil
// + Empleados). Los porcentajes y montos base salen de parametros_normativos
// (tabla en BD), NO estan escritos a fuego aqui, para que se puedan ajustar
// sin tocar codigo cuando cambie la norma o las tablas salariales.
//
// IMPORTANTE: antes de usar en produccion, valida los resultados de este
// motor contra 1-2 planillas reales ya calculadas en el Excel (mismo mes,
// mismos trabajadores) y ajusta las funciones marcadas con "// VALIDAR".
// =========================================================================

import {
  AsistenciaEntrada,
  CategoriaOcupacional,
  Contrato,
  DetallePlanilla,
  ParametrosNormativos,
} from "./tipos";

const CATEGORIAS_CONSTRUCCION_CIVIL: CategoriaOcupacional[] = [
  "OPERARIO",
  "OFICIAL",
  "PEON",
  "OPERARIO EP",
];

function esConstruccionCivil(categoria: CategoriaOcupacional): boolean {
  return CATEGORIAS_CONSTRUCCION_CIVIL.includes(categoria);
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Jornal/sueldo diario del trabajador (equivalente a la columna CG de PLANTILLA). */
export function calcularJornalDiario(
  contrato: Contrato,
  parametros: ParametrosNormativos
): number {
  if (contrato.categoria_ocupacional === "EMPLEADO") {
    // Sueldo mensual fijo prorrateado sobre 30 dias
    return (contrato.sueldo_base ?? 0) / 30;
  }
  const config = parametros.tabla_categorias[contrato.categoria_ocupacional];
  if (!config) {
    throw new Error(
      `No hay jornal configurado para la categoria '${contrato.categoria_ocupacional}' en parametros_normativos.tabla_categorias`
    );
  }
  return config.jornal_basico;
}

/** Sueldo/salario base del periodo = dias trabajados x jornal diario. */
export function calcularSueldoBasico(
  jornalDiario: number,
  asistencia: AsistenciaEntrada,
  categoria: CategoriaOcupacional
): number {
  if (categoria === "EVENTUAL") {
    // El eventual cobra el sueldo pactado completo si estuvo habil, sin prorrateo por dia
    return redondear(jornalDiario * 30);
  }
  return redondear(jornalDiario * asistencia.dias_trabajados);
}

/** Remuneracion por dia(s) de descanso dominical, pagado al mismo jornal. */
export function calcularRemuneracionDominical(
  jornalDiario: number,
  asistencia: AsistenciaEntrada
): number {
  // VALIDAR: regla estandar = jornal/6 por cada 6 dias trabajados. Aqui se
  // paga directo por los dias dominicales registrados en el tareo.
  return redondear(jornalDiario * asistencia.dias_dominical);
}

/** Remuneracion por feriados no laborados. */
export function calcularRemuneracionFeriado(
  jornalDiario: number,
  asistencia: AsistenciaEntrada
): number {
  return redondear(jornalDiario * asistencia.dias_feriado);
}

/** Importe de horas extra: 25% las 2 primeras horas, 35% el resto, 100% feriado/nocturno excedente. */
export function calcularHorasExtra(
  jornalDiario: number,
  asistencia: AsistenciaEntrada
): number {
  const jornalHora = jornalDiario / 8;
  const importe25 = jornalHora * 1.25 * asistencia.horas_extra_25;
  const importe35 = jornalHora * 1.35 * asistencia.horas_extra_35;
  const importe100 = jornalHora * 2.0 * asistencia.horas_extra_100;
  return redondear(importe25 + importe35 + importe100);
}

/** Asignacion familiar: monto fijo mensual si tiene >=1 hijo, prorrateado por dias trabajados. */
export function calcularAsignacionFamiliar(
  contrato: Contrato,
  numeroHijos: number,
  asistencia: AsistenciaEntrada,
  parametros: ParametrosNormativos,
  diasPeriodo: number
): number {
  if (numeroHijos < 1) return 0;
  const proporcion = Math.min(asistencia.dias_trabajados / diasPeriodo, 1);
  return redondear(parametros.asignacion_familiar * proporcion);
}

/** Bonificacion Unificada de Construccion (BUC) - solo categorias de construccion civil. */
export function calcularBonificacionBUC(
  contrato: Contrato,
  jornalDiario: number,
  asistencia: AsistenciaEntrada,
  parametros: ParametrosNormativos
): number {
  if (!esConstruccionCivil(contrato.categoria_ocupacional)) return 0;
  const config = parametros.tabla_categorias[contrato.categoria_ocupacional];
  if (!config) return 0;
  return redondear(jornalDiario * config.buc * asistencia.dias_trabajados);
}

/**
 * Gratificacion (Fiestas Patrias / Navidad).
 * Formula legal: (remuneracion computable / 6) x meses completos laborados
 * en el semestre (jul-dic o ene-jun). Se calcula solo cuando el periodo
 * corresponde a julio o diciembre; el resto de meses retorna 0.
 * VALIDAR: aqui se asume el semestre completo (6/6) como caso simple;
 * ajustar mesesComputables segun fecha de ingreso real del trabajador.
 */
export function calcularGratificacion(
  remuneracionComputable: number,
  mes: number,
  mesesComputables: number = 6
): number {
  if (mes !== 7 && mes !== 12) return 0;
  return redondear((remuneracionComputable / 6) * mesesComputables);
}

/**
 * CTS (Compensacion por Tiempo de Servicios), depositada en mayo y noviembre.
 * Formula legal simplificada: remuneracion computable / 12 x meses del
 * semestre + 1/6 de la gratificacion del semestre.
 * VALIDAR contra el detalle real de RECORD_DIAS_CTS del Excel.
 */
export function calcularCTS(
  remuneracionComputable: number,
  gratificacionSemestre: number,
  mes: number,
  mesesComputables: number = 6
): number {
  if (mes !== 5 && mes !== 11) return 0;
  const base = (remuneracionComputable / 12) * mesesComputables;
  const sextaGrati = gratificacionSemestre / 6;
  return redondear(base + sextaGrati);
}

/** Aporte a pension (ONP 13%, o AFP: aporte obligatorio + comision + prima de seguro). */
export function calcularAportePension(
  contrato: Contrato,
  remuneracionAfecta: number,
  parametros: ParametrosNormativos
): number {
  if (contrato.sistema_pension === "ONP") {
    return redondear(remuneracionAfecta * parametros.tasa_onp);
  }
  if (!contrato.afp_nombre) {
    throw new Error(`Contrato ${contrato.id} tiene sistema_pension=AFP sin afp_nombre`);
  }
  const tasas = parametros.afp_tasas[contrato.afp_nombre];
  if (!tasas) {
    throw new Error(`No hay tasas configuradas para la AFP '${contrato.afp_nombre}'`);
  }
  const total =
    remuneracionAfecta * tasas.aporte_obligatorio +
    remuneracionAfecta * tasas.comision_flujo +
    remuneracionAfecta * tasas.prima_seguro;
  return redondear(total);
}

/** Aporte ESSALUD a cargo del empleador (informativo, no se descuenta al trabajador). */
export function calcularEssalud(
  remuneracionAfecta: number,
  parametros: ParametrosNormativos
): number {
  return redondear(remuneracionAfecta * parametros.tasa_essalud);
}

/** SCTR salud - solo si el contrato lo tiene activado y es categoria de riesgo. */
export function calcularSCTR(
  contrato: Contrato,
  remuneracionAfecta: number,
  parametros: ParametrosNormativos
): number {
  if (!contrato.sctr_salud) return 0;
  return redondear(remuneracionAfecta * parametros.tasa_sctr_salud);
}

/** SENATI - aporte del empleador sobre remuneracion de construccion civil. */
export function calcularSenati(
  contrato: Contrato,
  remuneracionAfecta: number,
  parametros: ParametrosNormativos
): number {
  if (!esConstruccionCivil(contrato.categoria_ocupacional)) return 0;
  return redondear(remuneracionAfecta * parametros.tasa_senati);
}

/** CONAFOVICER - descuento al trabajador de construccion civil (no EMPLEADO). */
export function calcularConafovicer(
  contrato: Contrato,
  remuneracionAfecta: number,
  parametros: ParametrosNormativos
): number {
  if (!esConstruccionCivil(contrato.categoria_ocupacional)) return 0;
  return redondear(remuneracionAfecta * parametros.tasa_conafovicer);
}

/**
 * Renta de 5ta categoria - simplificado, solo aplica a categoria EMPLEADO.
 * Proyecta la remuneracion mensual a 12 meses + 2 gratificaciones, resta 7 UIT,
 * y aplica los tramos vigentes. Es una aproximacion: para un calculo exacto
 * se requiere el acumulado real ano a la fecha (ingresos ya pagados).
 * VALIDAR contra la columna "Dscto Renta 5ta" del Excel.
 */
export function calcularRenta5ta(
  contrato: Contrato,
  remuneracionMensual: number,
  parametros: ParametrosNormativos
): number {
  if (contrato.categoria_ocupacional !== "EMPLEADO") return 0;

  const proyeccionAnual = remuneracionMensual * 12 + remuneracionMensual * 2; // + 2 gratificaciones
  const uit = parametros.uit;
  const baseImponible = proyeccionAnual - 7 * uit;
  if (baseImponible <= 0) return 0;

  let impuestoAnual = 0;
  let restante = baseImponible;

  const tramos = [
    { limite: 5 * uit, tasa: 0.08 },
    { limite: 20 * uit - 5 * uit, tasa: 0.14 },
    { limite: 35 * uit - 20 * uit, tasa: 0.17 },
    { limite: 45 * uit - 35 * uit, tasa: 0.2 },
    { limite: Infinity, tasa: 0.3 },
  ];

  for (const tramo of tramos) {
    if (restante <= 0) break;
    const montoEnTramo = Math.min(restante, tramo.limite);
    impuestoAnual += montoEnTramo * tramo.tasa;
    restante -= montoEnTramo;
  }

  return redondear(impuestoAnual / 14); // se prorratea entre 12 sueldos + 2 gratificaciones
}

export interface ResultadoCalculoLinea {
  detalle: Omit<DetallePlanilla, "id" | "periodo_id" | "detalle_json"> & {
    detalle_json: Record<string, unknown>;
  };
}

/** Calcula la linea completa de planilla de un trabajador para un periodo. */
export function calcularLineaPlanilla(
  contrato: Contrato,
  numeroHijos: number,
  asistencia: AsistenciaEntrada,
  parametros: ParametrosNormativos,
  diasPeriodo: number,
  mes: number
): ResultadoCalculoLinea {
  const jornalDiario = calcularJornalDiario(contrato, parametros);
  const sueldoBasico = calcularSueldoBasico(jornalDiario, asistencia, contrato.categoria_ocupacional);
  const remDominical = calcularRemuneracionDominical(jornalDiario, asistencia);
  const remFeriado = calcularRemuneracionFeriado(jornalDiario, asistencia);
  const importeHorasExtra = calcularHorasExtra(jornalDiario, asistencia);
  const asignacionFamiliar = calcularAsignacionFamiliar(
    contrato,
    numeroHijos,
    asistencia,
    parametros,
    diasPeriodo
  );
  const bonificacionBUC = calcularBonificacionBUC(contrato, jornalDiario, asistencia, parametros);

  // Remuneracion computable para gratificacion/CTS (sin horas extra ni bonos esporadicos)
  const remuneracionComputable = sueldoBasico + remDominical + asignacionFamiliar + bonificacionBUC;
  const gratificacion = calcularGratificacion(remuneracionComputable, mes);
  const cts = calcularCTS(remuneracionComputable, gratificacion, mes);
  const vacaciones = 0; // TODO: calcular record de vacaciones truncas/gozadas (Fase 2)

  const totalIngresos = redondear(
    sueldoBasico +
      remDominical +
      remFeriado +
      importeHorasExtra +
      asignacionFamiliar +
      bonificacionBUC +
      gratificacion +
      cts +
      vacaciones
  );

  // Base afecta a aportes/descuentos = ingresos regulares, sin CTS ni gratificacion (inafectas)
  const remuneracionAfecta = redondear(
    sueldoBasico + remDominical + remFeriado + importeHorasExtra + asignacionFamiliar + bonificacionBUC
  );

  const aportePension = calcularAportePension(contrato, remuneracionAfecta, parametros);
  const descuentoSindicato = contrato.sindicalizado ? redondear(remuneracionAfecta * 0.02) : 0; // VALIDAR tasa real
  const seguroVida = contrato.poliza_seguro ? parametros.seguro_vida_ley : 0;
  const conafovicer = calcularConafovicer(contrato, remuneracionAfecta, parametros);
  const renta5ta = calcularRenta5ta(contrato, remuneracionAfecta, parametros);
  const otrosDescuentos = 0;

  const totalDescuentos = redondear(
    aportePension + descuentoSindicato + seguroVida + conafovicer + renta5ta + otrosDescuentos
  );

  const essalud = calcularEssalud(remuneracionAfecta, parametros);
  const sctr = calcularSCTR(contrato, remuneracionAfecta, parametros);
  const senati = calcularSenati(contrato, remuneracionAfecta, parametros);

  const netoPagar = redondear(totalIngresos - totalDescuentos);

  return {
    detalle: {
      contrato_id: contrato.id,
      dias_trabajados: asistencia.dias_trabajados,
      dias_dominical: asistencia.dias_dominical,
      dias_feriado: asistencia.dias_feriado,
      dias_falta: asistencia.dias_falta,
      horas_extra_25: asistencia.horas_extra_25,
      horas_extra_35: asistencia.horas_extra_35,
      horas_extra_100: asistencia.horas_extra_100,
      jornal_diario: redondear(jornalDiario),
      sueldo_basico: sueldoBasico,
      remuneracion_dominical: remDominical,
      remuneracion_feriado: remFeriado,
      importe_horas_extra: importeHorasExtra,
      asignacion_familiar: asignacionFamiliar,
      bonificacion_buc: bonificacionBUC,
      otras_bonificaciones: 0,
      gratificacion,
      cts,
      vacaciones,
      total_ingresos: totalIngresos,
      aporte_pension: aportePension,
      descuento_sindicato: descuentoSindicato,
      seguro_vida: seguroVida,
      conafovicer,
      renta_5ta: renta5ta,
      otros_descuentos: otrosDescuentos,
      total_descuentos: totalDescuentos,
      essalud,
      sctr,
      senati,
      neto_pagar: netoPagar,
      detalle_json: {
        remuneracion_computable: remuneracionComputable,
        remuneracion_afecta: remuneracionAfecta,
      },
    },
  };
}
