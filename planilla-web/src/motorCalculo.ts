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
  TablaSalarialMensual,
  TasasAFPMensuales,
} from "./tipos";

const CATEGORIAS_CONSTRUCCION_CIVIL: CategoriaOcupacional[] = [
  "OPERARIO",
  "OFICIAL",
  "PEON",
  "OPERARIO_EP",
  "OPERARIO_EM",
  "OPERARIO_TP",
];

export function esConstruccionCivil(categoria: CategoriaOcupacional): boolean {
  return CATEGORIAS_CONSTRUCCION_CIVIL.includes(categoria);
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Jornal/sueldo diario del trabajador (equivalente a la columna CG de PLANTILLA). */
export function calcularJornalDiario(
  contrato: Contrato,
  tablaCategorias: TablaSalarialMensual,
  diasPeriodo: number
): number {
  if (contrato.categoria_ocupacional === "EMPLEADO") {
    // Sueldo mensual fijo prorrateado sobre los dias REALES del periodo (28,
    // 29, 30 o 31), no sobre 30 fijo. Verificado contra boleta real de
    // Empleado de julio (31 dias): Sueldo Basico 80.65 = 2500/31, no
    // 2500/30=83.33. Asi, un mes trabajado completo siempre paga el sueldo
    // exacto sin importar cuantos dias tenga ese mes calendario.
    return (contrato.sueldo_base ?? 0) / diasPeriodo;
  }
  const config = tablaCategorias[contrato.categoria_ocupacional];
  if (!config) {
    throw new Error(
      `No hay jornal configurado para la categoria '${contrato.categoria_ocupacional}' en tabla_salarial_mensual para este periodo`
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

/**
 * Importe de horas extra. El recargo depende del regimen laboral (verificado
 * contra la tabla salarial real de la empresa, hoja AFPS-SALARIOS):
 * - Construccion civil (OPERARIO/OFICIAL/PEON/EP/EM/TP): 60% las 2 primeras
 *   horas, 100% el excedente (convenio colectivo de construccion civil).
 * - Regimen general (R_GENERAL/PEON_A y demas fuera de construccion civil):
 *   25% las 2 primeras horas, 35% el excedente (recargo legal estandar).
 * Los campos horas_extra_25/horas_extra_35/horas_extra_100 son los mismos
 * 3 "tramos" de horas para ambos regimenes; solo cambia el % aplicado.
 */
export function calcularHorasExtra(
  jornalDiario: number,
  asistencia: AsistenciaEntrada,
  categoria: CategoriaOcupacional
): number {
  const jornalHora = jornalDiario / 8;
  const [recargoTramo1, recargoTramo2, recargoTramo3] = esConstruccionCivil(categoria)
    ? [1.6, 2.0, 2.0]
    : [1.25, 1.35, 2.0];
  const importeTramo1 = jornalHora * recargoTramo1 * asistencia.horas_extra_25;
  const importeTramo2 = jornalHora * recargoTramo2 * asistencia.horas_extra_35;
  const importeTramo3 = jornalHora * recargoTramo3 * asistencia.horas_extra_100;
  return redondear(importeTramo1 + importeTramo2 + importeTramo3);
}

/**
 * Asignacion familiar: 10% de la Remuneracion Minima Vital (RMV), solo
 * aplica a EMPLEADO (regimen general). Los trabajadores de construccion
 * civil NO la reciben - en su lugar tienen la asignacion por escolaridad
 * (ver calcularAsignacionEscolar). Verificado contra boletas reales: el
 * total de ingresos de obreros con hijos cuadra exacto sin esta linea.
 *
 * Se calcula SIEMPRE como 10% de parametros.remuneracion_minima_vital, no
 * se lee de un campo aparte (asignacion_familiar) que haya que editar a
 * mano cada vez que sube la RMV - mismo motivo que el factor de
 * gratificacion de construccion civil.
 */
export function calcularAsignacionFamiliar(
  contrato: Contrato,
  numeroHijos: number,
  asistencia: AsistenciaEntrada,
  parametros: ParametrosNormativos,
  diasPeriodo: number
): number {
  if (esConstruccionCivil(contrato.categoria_ocupacional)) return 0;
  if (numeroHijos < 1) return 0;
  const proporcion = Math.min(asistencia.dias_trabajados / diasPeriodo, 1);
  // parametros.remuneracion_minima_vital viene de una columna NUMERIC de
  // Postgres (el driver "pg" la entrega como string) - Number() evita el
  // mismo bug de concatenacion de texto ya corregido antes en otros campos.
  const asignacionFamiliarCompleta = Number(parametros.remuneracion_minima_vital) * 0.1;
  return redondear(asignacionFamiliarCompleta * proporcion);
}

/**
 * Asignacion por escolaridad (solo construccion civil): 30 jornales basicos
 * al ano por cada hijo (Resolucion Directoral N°100-72-DPRTESS), es decir
 * jornal/12 por dia trabajado y por hijo. Verificado exacto contra boletas
 * reales (Oficial 1 hijo, Operario Equipo Pesado 3 hijos).
 */
export function calcularAsignacionEscolar(
  jornalDiario: number,
  numeroHijos: number,
  asistencia: AsistenciaEntrada,
  categoria: CategoriaOcupacional
): number {
  if (!esConstruccionCivil(categoria) || numeroHijos < 1) return 0;
  // A diferencia de vacaciones/CTS/movilidad, la tasa diaria NO se redondea
  // antes de multiplicar - verificado contra boletas reales (redondear aqui
  // producia una diferencia sistematica de unos centimos).
  const escolaridadDiaria = jornalDiario / 12;
  return redondear(escolaridadDiaria * asistencia.dias_trabajados * numeroHijos);
}

/**
 * Bonificacion por Alta Especializacion (BAE): solo operarios especializados
 * (OPERARIO_EP/EM/TP), porcentaje del jornal segun tabla_categorias.bae.
 * Verificado exacto contra boleta real de Operario Equipo Pesado (BAE 10%).
 */
export function calcularBonificacionBAE(
  contrato: Contrato,
  jornalDiario: number,
  asistencia: AsistenciaEntrada,
  tablaCategorias: TablaSalarialMensual
): number {
  if (!esConstruccionCivil(contrato.categoria_ocupacional)) return 0;
  const config = tablaCategorias[contrato.categoria_ocupacional];
  if (!config || !config.bae) return 0;
  const baeDiaria = redondear(jornalDiario * config.bae);
  return redondear(baeDiaria * asistencia.dias_trabajados);
}

/**
 * Bonificacion por movilidad acumulada (solo construccion civil): monto fijo
 * por dia EFECTIVAMENTE trabajado (no se paga en dominicales/feriados no
 * laborados), tomado de tabla_categorias.movilidad_acumulada. Verificado
 * contra boletas reales: usa los dias trabajados redondeados al entero mas
 * cercano (22.94 -> 23, 21.88 -> 22, 24.00 -> 24).
 */
export function calcularBonificacionMovilidad(
  contrato: Contrato,
  asistencia: AsistenciaEntrada,
  tablaCategorias: TablaSalarialMensual
): number {
  if (!esConstruccionCivil(contrato.categoria_ocupacional)) return 0;
  const config = tablaCategorias[contrato.categoria_ocupacional];
  if (!config || !config.movilidad_acumulada) return 0;
  const diasRedondeados = Math.round(asistencia.dias_trabajados);
  return redondear(config.movilidad_acumulada * diasRedondeados);
}

/** Bonificacion Unificada de Construccion (BUC) - solo categorias de construccion civil. */
export function calcularBonificacionBUC(
  contrato: Contrato,
  jornalDiario: number,
  asistencia: AsistenciaEntrada,
  tablaCategorias: TablaSalarialMensual
): number {
  if (!esConstruccionCivil(contrato.categoria_ocupacional)) return 0;
  const config = tablaCategorias[contrato.categoria_ocupacional];
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
 * Remuneracion computable "regular" para gratificacion y CTS: el sueldo de
 * un mes COMPLETO (30 dias), no el del periodo que se esta calculando.
 * BUG REAL corregido: antes se usaba sueldoBasico/BUC ya prorrateados por
 * los dias_trabajados del periodo actual, asi que un trabajador con
 * asistencia parcial en el mes de pago (ej. 15 de 30 dias) recibia la
 * mitad de gratificacion/CTS que le correspondia. La ley solo prorratea
 * la gratificacion/CTS por los MESES de antiguedad en el semestre
 * (calcularMesesEnSemestre), no por la asistencia del mes de pago.
 */
function calcularRemuneracionComputableRegular(
  contrato: Contrato,
  jornalDiario: number,
  numeroHijos: number,
  parametros: ParametrosNormativos,
  tablaCategorias: TablaSalarialMensual
): number {
  // Para EMPLEADO, jornalDiario ahora se calcula sobre los dias reales del
  // periodo (ver calcularJornalDiario), no sobre 30 fijo - por eso aqui se
  // usa el sueldo_base directo en vez de jornalDiario*30 (que daria un
  // monto distinto segun el mes tenga 28, 30 o 31 dias, cuando la "remuneracion
  // regular" para gratificacion/CTS debe ser siempre el sueldo mensual completo).
  const sueldoBasicoRegular =
    contrato.categoria_ocupacional === "EMPLEADO"
      ? Number(contrato.sueldo_base ?? 0)
      : redondear(jornalDiario * 30);
  const config = tablaCategorias[contrato.categoria_ocupacional];
  const bucRegular =
    esConstruccionCivil(contrato.categoria_ocupacional) && config
      ? redondear(jornalDiario * config.buc * 30)
      : 0;
  // Asignacion familiar = 10% de la RMV (ver calcularAsignacionFamiliar).
  // parametros.remuneracion_minima_vital viene de una columna NUMERIC de
  // Postgres, que el driver "pg" entrega como string; sin el Number() aca,
  // la suma de abajo hace concatenacion de texto en vez de suma (bug real
  // ya visto antes: producia gratificacion/CTS = NaN para cualquier
  // trabajador con hijos).
  const asignacionFamiliarRegular = numeroHijos >= 1 ? Number(parametros.remuneracion_minima_vital) * 0.1 : 0;
  return sueldoBasicoRegular + bucRegular + asignacionFamiliarRegular;
}

/**
 * Gratificacion (Fiestas Patrias / Navidad).
 *
 * Construccion civil (RD N°777-87-DR-LIM): NO es un pago unico en julio o
 * diciembre. Se devenga y paga EN CADA PERIODO, en proporcion a los dias
 * trabajados + dominicales + feriados de ese periodo, usando una tasa
 * diaria = jornal basico x 40/210 (40 jornales basicos repartidos entre 210
 * dias = 30 dias x 7 meses). Verificado exacto contra la tabla salarial de
 * la Federacion de Trabajadores (Operario 89.30 -> 17.01/dia, Oficial
 * 69.75 -> 13.29/dia, Peon 62.80 -> 11.96/dia) y contra boletas reales de
 * las 4 categorias de obrero.
 *
 * IMPORTANTE: el factor se CALCULA a partir del jornal basico de la tabla
 * salarial del periodo, no se lee de un campo aparte que haya que editar a
 * mano - asi no se puede quedar desactualizado ni en 0 por olvido al cargar
 * una tabla salarial nueva (bug real encontrado: el campo
 * tabla_categorias.gratificacion_diaria por defecto queda en 0 en
 * categorias/periodos nuevos si el administrador no lo llena aparte).
 *
 * EMPLEADO (regimen general): se mantiene la formula anterior, pago unico
 * en julio/diciembre = (remuneracion computable / 6) x meses completos
 * laborados en el semestre.
 */
export function calcularGratificacion(
  contrato: Contrato,
  asistencia: AsistenciaEntrada,
  jornalDiario: number,
  remuneracionComputable: number,
  mes: number,
  anio: number,
  fechaIngreso: string
): number {
  if (esConstruccionCivil(contrato.categoria_ocupacional)) {
    const gratificacionDiaria = redondear(jornalDiario * (40 / 210));
    const diasComputables = asistencia.dias_trabajados + asistencia.dias_dominical + asistencia.dias_feriado;
    return redondear(gratificacionDiaria * diasComputables);
  }

  if (mes !== 7 && mes !== 12) return 0;
  const mesesComputables =
    mes === 7
      ? calcularMesesEnSemestre(fechaIngreso, anio, 1, 6)
      : calcularMesesEnSemestre(fechaIngreso, anio, 7, 12);
  if (mesesComputables === 0) return 0;
  return redondear((remuneracionComputable / 6) * mesesComputables);
}

/**
 * Bonificacion Extraordinaria Ley N°29351/30334: 9% de la gratificacion, se
 * paga en efectivo AL TRABAJADOR en vez de que ese 9% vaya a EsSalud (la
 * gratificacion esta exonerada de ese aporte). Aplica a cualquier categoria
 * que reciba gratificacion. Verificado exacto (9.00%) contra las 5 boletas
 * reales, incluyendo la de un Empleado (regimen general).
 */
export function calcularBonificacionExtraordinaria(gratificacion: number): number {
  if (gratificacion <= 0) return 0;
  return redondear(gratificacion * 0.09);
}

/**
 * CTS (Compensacion por Tiempo de Servicios).
 *
 * Construccion civil (RSD N°450-90-2SD-NEC): NO es un deposito semestral en
 * mayo/noviembre. Es el 15% de los jornales basicos (dias trabajados) que
 * se va devengando EN CADA PERIODO, y se paga recien en la liquidacion al
 * cese del trabajador (por eso en el sistema se acumula como una linea mas
 * de la boleta, igual que hace la empresa). Verificado exacto contra las
 * boletas reales usando la tasa 15% redondeada a 2 decimales (ej. jornal
 * 89.30 -> 13.40/dia, no 13.395/dia).
 *
 * EMPLEADO (regimen general): se mantiene la formula anterior, deposito en
 * mayo/noviembre = remuneracion computable/12 x meses del semestre + 1/6 de
 * la gratificacion del semestre.
 */
export function calcularCTS(
  contrato: Contrato,
  jornalDiario: number,
  asistencia: AsistenciaEntrada,
  remuneracionComputable: number,
  gratificacionSemestre: number,
  mes: number,
  anio: number,
  fechaIngreso: string
): number {
  if (esConstruccionCivil(contrato.categoria_ocupacional)) {
    const ctsDiaria = redondear(jornalDiario * 0.15);
    return redondear(ctsDiaria * asistencia.dias_trabajados);
  }

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

/**
 * Vacaciones (compensacion vacacional, solo construccion civil): 10% del
 * jornal basico por dia trabajado (RSD N°450-90-2SD-NEC), devengado cada
 * periodo igual que la CTS. Verificado exacto contra las boletas reales.
 * EMPLEADO: el modulo de record de vacaciones (gozadas/truncas) del regimen
 * general todavia no esta implementado (queda en 0, como antes).
 */
export function calcularVacaciones(
  contrato: Contrato,
  jornalDiario: number,
  asistencia: AsistenciaEntrada
): number {
  if (!esConstruccionCivil(contrato.categoria_ocupacional)) return 0;
  const vacacionesDiaria = redondear(jornalDiario * 0.10);
  return redondear(vacacionesDiaria * asistencia.dias_trabajados);
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
  parametros: ParametrosNormativos,
  afpTasas: TasasAFPMensuales
): DetalleAportePension {
  if (contrato.sistema_pension === "ONP") {
    const onp = redondear(remuneracionAfecta * parametros.tasa_onp);
    return { total: onp, onp, aporteObligatorio: 0, comisionFlujo: 0, primaSeguro: 0 };
  }
  if (!contrato.afp_nombre) {
    throw new Error(`Contrato ${contrato.id} tiene sistema_pension=AFP sin afp_nombre`);
  }
  const tasas = afpTasas[contrato.afp_nombre];
  if (!tasas) {
    throw new Error(`No hay tasas AFP configuradas para '${contrato.afp_nombre}' en tasas_afp_mensuales para este periodo`);
  }
  const aporteObligatorio = redondear(remuneracionAfecta * tasas.aporte_obligatorio);
  // La comision de flujo (% sobre la remuneracion del periodo) SOLO aplica
  // a afiliados en modalidad Flujo puro (sistema_comision = "F"). En Saldo
  // la AFP cobra directo del fondo acumulado (no es un descuento de
  // planilla, y este sistema no tiene ese saldo); en Mixta la tasa de
  // flujo va bajando por cronograma hasta llegar a 0% - sin esa tabla no se
  // puede calcular con certeza, asi que tambien se deja en 0. Verificado
  // contra boletas reales: "Comisión Mixta/Flujo" sale en blanco.
  const comisionFlujo =
    contrato.sistema_comision === "F" ? redondear(remuneracionAfecta * tasas.comision_flujo) : 0;
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

/**
 * "Fondo Capacitacion" (campo senati) - aporte del empleador sobre
 * construccion civil. Base verificada contra boletas reales = jornal +
 * dominical + feriado (SIN horas extra, BUC, BAE ni vacaciones) - distinta
 * a la base amplia (remuneracionAfecta) que se usa para pension/EsSalud.
 */
export function calcularSenati(
  contrato: Contrato,
  sueldoBasico: number,
  remuneracionDominical: number,
  remuneracionFeriado: number,
  parametros: ParametrosNormativos
): number {
  if (!esConstruccionCivil(contrato.categoria_ocupacional)) return 0;
  const base = sueldoBasico + remuneracionDominical + remuneracionFeriado;
  return redondear(base * parametros.tasa_senati);
}

/**
 * CONAFOVICER - descuento al trabajador de construccion civil (no EMPLEADO).
 * Base verificada contra boletas reales = jornal + dominical (SIN feriado,
 * horas extra, BUC, BAE ni vacaciones).
 */
export function calcularConafovicer(
  contrato: Contrato,
  sueldoBasico: number,
  remuneracionDominical: number,
  parametros: ParametrosNormativos
): number {
  if (!esConstruccionCivil(contrato.categoria_ocupacional)) return 0;
  const base = sueldoBasico + remuneracionDominical;
  return redondear(base * parametros.tasa_conafovicer);
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

/**
 * Cuota sindical: NO es un porcentaje del sueldo - es una tarifa FIJA
 * semanal que se define por proyecto/obra (ver proyectos.cuota_sindical_semanal
 * en el catalogo de Proyectos). Se divide entre 6 dias para la tarifa
 * diaria y se multiplica por los dias trabajados del periodo. Solo se
 * descuenta a los trabajadores marcados como sindicalizados. Verificado
 * exacto contra boletas reales de 3 proyectos distintos (P012=S/15/semana,
 * P009=S/10/semana, P013=S/20/semana).
 */
export function calcularCuotaSindical(
  contrato: Contrato,
  asistencia: AsistenciaEntrada,
  cuotaSindicalSemanal: number
): number {
  if (!contrato.sindicalizado || !cuotaSindicalSemanal) return 0;
  const cuotaDiaria = cuotaSindicalSemanal / 6;
  return redondear(cuotaDiaria * asistencia.dias_trabajados);
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
  tablaCategorias: TablaSalarialMensual,
  afpTasas: TasasAFPMensuales,
  diasPeriodo: number,
  mes: number,
  anio: number,
  cuotaSindicalSemanal: number
): ResultadoCalculoLinea {
  const jornalDiario = calcularJornalDiario(contrato, tablaCategorias, diasPeriodo);
  const sueldoBasico = calcularSueldoBasico(jornalDiario, asistencia, contrato.categoria_ocupacional);
  const remDominical = calcularRemuneracionDominical(jornalDiario, asistencia);
  const remFeriado = calcularRemuneracionFeriado(jornalDiario, asistencia);
  const importeHorasExtra = calcularHorasExtra(jornalDiario, asistencia, contrato.categoria_ocupacional);
  const asignacionFamiliar = calcularAsignacionFamiliar(
    contrato,
    numeroHijos,
    asistencia,
    parametros,
    diasPeriodo
  );
  const bonificacionBUC = calcularBonificacionBUC(contrato, jornalDiario, asistencia, tablaCategorias);
  const asignacionEscolaridad = calcularAsignacionEscolar(jornalDiario, numeroHijos, asistencia, contrato.categoria_ocupacional);
  const bonificacionBAE = calcularBonificacionBAE(contrato, jornalDiario, asistencia, tablaCategorias);
  const bonificacionMovilidad = calcularBonificacionMovilidad(contrato, asistencia, tablaCategorias);

  // Remuneracion computable del periodo actual (solo para mostrar en el detalle)
  const remuneracionComputable = sueldoBasico + remDominical + asignacionFamiliar + bonificacionBUC;
  // Para EMPLEADO (regimen general), gratificacion/CTS usan el sueldo de un
  // mes COMPLETO, no el de este periodo (que puede estar prorrateado por
  // dias trabajados/faltas) - ver calcularRemuneracionComputableRegular.
  // Construccion civil no usa este valor (ver calcularGratificacion/CTS).
  const remuneracionComputableRegular = calcularRemuneracionComputableRegular(
    contrato,
    jornalDiario,
    numeroHijos,
    parametros,
    tablaCategorias
  );
  const gratificacion = calcularGratificacion(
    contrato,
    asistencia,
    jornalDiario,
    remuneracionComputableRegular,
    mes,
    anio,
    contrato.fecha_ingreso
  );
  const bonificacionExtraordinaria = calcularBonificacionExtraordinaria(gratificacion);
  const cts = calcularCTS(
    contrato,
    jornalDiario,
    asistencia,
    remuneracionComputableRegular,
    gratificacion,
    mes,
    anio,
    contrato.fecha_ingreso
  );
  const vacaciones = calcularVacaciones(contrato, jornalDiario, asistencia);

  const totalIngresos = redondear(
    sueldoBasico +
      remDominical +
      remFeriado +
      importeHorasExtra +
      asignacionFamiliar +
      asignacionEscolaridad +
      bonificacionBUC +
      bonificacionBAE +
      bonificacionMovilidad +
      gratificacion +
      bonificacionExtraordinaria +
      cts +
      vacaciones
  );

  // Base afecta a aportes/descuentos = ingresos regulares, sin CTS,
  // gratificacion, movilidad, escolaridad ni bonif. extraordinaria
  // (inafectas). Vacaciones y BAE SI son computables - verificado contra
  // el descuento AFP/ONP real de las boletas.
  const remuneracionAfecta = redondear(
    sueldoBasico +
      remDominical +
      remFeriado +
      importeHorasExtra +
      asignacionFamiliar +
      bonificacionBUC +
      bonificacionBAE +
      vacaciones
  );

  const aportePension = calcularAportePension(contrato, remuneracionAfecta, parametros, afpTasas);
  const descuentoSindicato = calcularCuotaSindical(contrato, asistencia, cuotaSindicalSemanal);
  const conafovicer = calcularConafovicer(contrato, sueldoBasico, remDominical, parametros);
  const renta5ta = calcularRenta5ta(contrato, remuneracionAfecta, parametros);
  const otrosDescuentos = 0;

  const totalDescuentos = redondear(
    aportePension.total + descuentoSindicato + conafovicer + renta5ta + otrosDescuentos
  );

  const essalud = calcularEssalud(remuneracionAfecta, parametros);
  const sctr = calcularSCTR(contrato, remuneracionAfecta, parametros);
  const senati = calcularSenati(contrato, sueldoBasico, remDominical, remFeriado, parametros);
  // Poliza de vida (D.Leg. N°688 / convenio EsSalud+Vida): es un aporte
  // INTEGRO del empleador - esta prohibido descontarselo al trabajador. Se
  // reclasifico aqui (antes se restaba de total_descuentos por error).
  // parametros.seguro_vida_ley viene de una columna NUMERIC de Postgres (el
  // driver "pg" la entrega como string); sin el Number() aca, la suma de
  // total_aportes_empleador mas abajo hace concatenacion de texto en vez de
  // suma (mismo patron de bug ya corregido antes en asignacion_familiar).
  const seguroVida = contrato.poliza_seguro ? Number(parametros.seguro_vida_ley) : 0;

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
      asignacion_escolaridad: asignacionEscolaridad,
      bonificacion_buc: bonificacionBUC,
      bonificacion_bae: bonificacionBAE,
      bonificacion_movilidad: bonificacionMovilidad,
      otras_bonificaciones: 0,
      gratificacion,
      bonificacion_extraordinaria: bonificacionExtraordinaria,
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
        total_aportes_empleador: redondear(essalud + sctr + senati + seguroVida),
      },
    },
  };
}
