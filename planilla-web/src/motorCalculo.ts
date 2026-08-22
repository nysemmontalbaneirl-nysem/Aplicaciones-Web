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
  "OPERARIO_EP",
  "OPERARIO_EM",
  "OPERARIO_TP",
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
 * Cuenta cuantos meses calendario estuvo activo el contrato dentro de un
 * semestre [anio-inicioMes-01 .. anio-finMes-fin de mes], contando desde el
 * mayor entre fecha_ingreso y el inicio del semestre. Si el trabajador
 * ingreso despues de terminado el semestre, retorna 0 (no le corresponde
 * nada de ese periodo). Resultado acotado entre 0 y 6.
 */
export function calcularMesesEnSemestre(
  fechaIngreso: string,
  anio: number,
  inicioMes: number,
  finMes: number
): number {
  const ingreso = new Date(fechaIngreso);
  const inicioSemestre = new Date(anio, inicioMes - 1, 1);
  const finSemestre = new Date(anio, finMes - 1, 1);

  if (ingreso > finSemestre) return 0;

  const inicioComputo = ingreso > inicioSemestre ? ingreso : inicioSemestre;
  const meses =
    (finSemestre.getFullYear() - inicioComputo.getFullYear()) * 12 +
    (finSemestre.getMonth() - inicioComputo.getMonth()) +
    1;
  return Math.max(0, Math.min(6, meses));
}

/**
 * Gratificacion (Fiestas Patrias / Navidad).
 * Formula legal: (remuneracion computable / 6) x meses completos laborados
 * en el semestre (jul-dic o ene-jun). Se calcula solo cuando el periodo
 * corresponde a julio o diciembre; el resto de meses retorna 0.
 * mesesComputables se calcula segun la fecha de ingreso real del contrato
 * (un trabajador que ingreso el mismo mes de pago no tiene meses del
 * semestre anterior, por lo que le corresponde 0).
 */
export function calcularGratificacion(
  remuneracionComputable: number,
  mes: number,
  anio: number,
  fechaIngreso: string
): number {
  if (mes !== 7 && mes !== 12) return 0;
  const mesesComputables =
    mes === 7
      ? calcularMesesEnSemestre(fechaIngreso, anio, 1, 6)
      : calcularMesesEnSemestre(fechaIngreso, anio, 7, 12);
  if (mesesComputables === 0) return 0;
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
  anio: number,
  fechaIngreso: string
): number {
  if (mes !== 5 && mes !== 11) return 0;
  // Semestre CTS mayo: nov(anio-1) a abr(anio). Semestre CTS noviembre: may-oct(anio).
  const mesesComputables =
    mes === 5
      ? calcularMesesEnSemestre(fechaIngreso, anio - 1, 11, 12) +
        calcularMesesEnSemestre(fechaIngreso, anio, 1, 4)
      : calcularMesesEnSemestre(fechaIngreso, anio, 5, 10);
  if (mesesComputables === 0) return 0;
  const base = (remuneracionComputable / 12) * Math.min(6, mesesComputables);
  const sextaGrati = gratificacionSemestre / 6;
  return redondear(base + sextaGrati);
}

export interface DetalleAportePension {
  total: number;
  onp: number;
  aporteObligatorio: number;
  comisionFlujo: number;
  primaSeguro: number;
}

/** Aporte a pension (ONP 13%, o AFP: aporte obligatorio + comision + prima de seguro), desglosado. */
export function calcularAportePension(
  contrato: Contrato,
  remuneracionAfecta: number,
  parametros: ParametrosNormativos
): DetalleAportePension {
  if (contrato.sistema_pension === "ONP") {
    const onp = redondear(remuneracionAfecta * parametros.tasa_onp);
    return { total: onp, onp, aporteObligatorio: 0, comisionFlujo: 0, primaSeguro: 0 };
  }
  if (!contrato.afp_nombre) {
    throw new Error(`Contrato ${contrato.id} tiene sistema_pension=AFP sin afp_nombre`);
  }
  const tasas = parametros.afp_tasas[contrato.afp_nombre];
  if (!tasas) {
    throw new Error(`No hay tasas configuradas para la AFP '${contrato.afp_nombre}'`);
  }
  const aporteObligatorio = redondear(remuneracionAfecta * tasas.aporte_obligatorio);
  const comisionFlujo = redondear(remuneracionAfecta * tasas.comision_flujo);
  const primaSeguro = redondear(remuneracionAfecta * tasas.prima_seguro);
  const total = redondear(aporteObligatorio + comisionFlujo + primaSeguro);
  return { total, onp: 0, aporteObligatorio, comisionFlujo, primaSeguro };
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
  mes: number,
  anio: number
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
  const gratificacion = calcularGratificacion(remuneracionComputable, mes, anio, contrato.fecha_ingreso);
  const cts = calcularCTS(remuneracionComputable, gratificacion, mes, anio, contrato.fecha_ingreso);
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
  // PENDIENTE: en el Excel real (hoja AFPS-SALARIOS, columnas Z:AB "CUOTA SINDICATO")
  // la cuota sindical NO es un porcentaje del sueldo - es un monto FIJO semanal
  // que ademas varia por proyecto (ej. P006=S/.10/semana, P010=S/.20/semana,
  // dividido entre 6 dias -> tarifa diaria). El 2% de aqui es un placeholder
  // temporal, no confiable. Falta que el usuario defina la tarifa por proyecto
  // antes de usar este descuento en un calculo real.
  const descuentoSindicato = contrato.sindicalizado ? redondear(remuneracionAfecta * 0.02) : 0; // VALIDAR tasa real
  const seguroVida = contrato.poliza_seguro ? parametros.seguro_vida_ley : 0;
  const conafovicer = calcularConafovicer(contrato, remuneracionAfecta, parametros);
  const renta5ta = calcularRenta5ta(contrato, remuneracionAfecta, parametros);
  const otrosDescuentos = 0;

  const totalDescuentos = redondear(
    aportePension.total + descuentoSindicato + seguroVida + conafovicer + renta5ta + otrosDescuentos
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
      aporte_pension: aportePension.total,
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
        aporte_pension_detalle: aportePension,
        total_aportes_empleador: redondear(essalud + sctr + senati),
      },
    },
  };
}
