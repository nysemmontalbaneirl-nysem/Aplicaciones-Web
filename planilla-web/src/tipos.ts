// Tipos alineados 1:1 con sql/schema.sql

export type CategoriaOcupacional =
  | "OPERARIO"
  | "OFICIAL"
  | "PEON"
  | "EMPLEADO"
  | "EVENTUAL"
  | "OPERARIO_EP"
  | "OPERARIO_EM"
  | "OPERARIO_TP"
  | "PEON_A"
  | "R_GENERAL";

export type SistemaPension = "AFP" | "ONP";
export type NombreAFP = "INTEGRA" | "PRIMA" | "PROFUTURO" | "HABITAT";
export type SistemaComision = "F" | "S" | "M"; // Flujo | Saldo | Mixta

export interface Empleado {
  id: number;
  tipo_documento: string;
  numero_documento: string;
  apellidos_nombres: string;
  fecha_nacimiento: string | null;
  grado_instruccion: string | null;
  numero_hijos: number;
  celular: string | null;
  correo: string | null;
  direccion: string | null;
  ubigeo: string | null;
  entidad_bancaria: string | null;
  cuenta_bancaria: string | null;
  estado: "ACTIVO" | "INACTIVO";
  // Campos T-Registro (migracion_016) - datos que exige SUNAT ademas de
  // los que ya usaba el sistema. Todos opcionales/nulables: se llenan de a
  // poco desde el formulario de alta, no son retroactivos a empleados ya
  // cargados.
  sexo?: "M" | "F" | null;
  estado_civil?: string | null;
  nacionalidad_codigo?: string | null;
  pais_emisor_documento_codigo?: string | null;
  grado_instruccion_codigo?: string | null;
  entidad_bancaria_codigo?: string | null;
  discapacidad?: boolean;
  segunda_direccion?: string | null;
  direccion_essalud?: string | null;
  ubigeo_departamento_codigo?: string | null;
  ubigeo_provincia_codigo?: string | null;
  ubigeo_distrito_codigo?: string | null;
  // Firma escaneada (migracion 031) - el binario (firma_archivo) NUNCA
  // viaja en este tipo/por JSON (ver COLUMNAS_EMPLEADO_SIN_FIRMA en
  // routes/empleados.ts); solo su metadata y un booleano de presencia. La
  // imagen misma se sirve por GET /api/empleados/:id/firma.
  firma_mime?: string | null;
  firma_nombre?: string | null;
  tiene_firma?: boolean;
  // Migracion 041: apellido paterno/materno/nombres por separado, a pedido
  // explicito del usuario para poder declarar el archivo oficial de AFPnet
  // (exige estos 3 datos en columnas separadas, ver src/afpnetExcel.ts).
  // "apellidos_nombres" sigue siendo el campo maestro para todo lo demas
  // (boletas, reportes, tareo, etc.) - estos 3 son ADICIONALES, opcionales,
  // y no retroactivos (empleados ya cargados quedan en null hasta que se
  // editen a mano).
  apellido_paterno?: string | null;
  apellido_materno?: string | null;
  nombres?: string | null;
}

export interface Contrato {
  id: number;
  empleado_id: number;
  proyecto: string;
  grupo: string | null;
  categoria_ocupacional: CategoriaOcupacional;
  ocupacion: string | null;
  sistema_pension: SistemaPension;
  afp_nombre: NombreAFP | null;
  cuspp: string | null;
  sistema_comision: SistemaComision | null;
  fecha_ingreso: string;
  fecha_cese: string | null;
  sueldo_base: number | null;
  viaticos: number;
  sindicalizado: boolean;
  poliza_seguro: boolean;
  sctr_salud: boolean;
  essalud_vida: boolean;
  domiciliado: boolean;
  estado: "HABIL" | "CESADO";
  // Campos T-Registro (migracion_016), ver nota en Empleado arriba.
  categoria_ocupacional_sunat_codigo?: string | null;
  tipo_trabajador_codigo?: string | null;
  regimen_laboral_codigo?: string | null;
  tipo_contrato_codigo?: string | null;
  tipo_pago_codigo?: string | null;
  periodicidad_codigo?: string | null;
  motivo_baja_codigo?: string | null;
  situacion_especial_codigo?: string | null;
  jornada_laboral?: string | null;
  regimen_salud_codigo?: string | null;
  eps_codigo?: string | null;
}

export type TipoPeriodo = "MENSUAL" | "QUINCENAL" | "SEMANAL";

export interface PeriodoPlanilla {
  id: number;
  anio: number;
  mes: number;
  quincena: number | null;
  tipo: TipoPeriodo;
  fecha_inicio: string;
  fecha_fin: string;
  dias_periodo: number;
  estado: "ABIERTO" | "CALCULADO" | "CERRADO" | "DECLARADO";
  // Proyecto/obra al que pertenece este periodo (migracion_028, Ronda C).
  // NULL = periodo legado/todos los proyectos (todos los periodos creados
  // antes de esta migracion quedan asi, de forma permanente).
  proyecto: string | null;
}

export interface TasasAFPFondo {
  comision_flujo: number;
  prima_seguro: number;
  aporte_obligatorio: number;
}

export interface CategoriaConfig {
  buc: number;
  jornal_basico: number;
  bae: number;
  movilidad_acumulada: number;
  gratificacion_diaria: number;
}

// Valores de frecuencia ANUAL (UIT, RMV, ESSALUD, ONP, etc.)
export interface ParametrosNormativos {
  id: number;
  anio: number;
  uit: number;
  remuneracion_minima_vital: number;
  tasa_essalud: number;
  tasa_onp: number;
  tasa_senati: number;
  tasa_conafovicer: number;
  tasa_sctr_salud: number;
  asignacion_familiar: number;
  seguro_vida_ley: number;
}

// Tasas AFP y tabla salarial son de frecuencia MENSUAL (cambian mes a mes)
export type TasasAFPMensuales = Record<NombreAFP, TasasAFPFondo>;
export type TablaSalarialMensual = Record<string, CategoriaConfig>;

// Catalogo configurable de conceptos de planilla y su afectacion a
// aportes/descuentos (ver sql/migracion_014_conceptos_planilla.sql).
// afecto_renta5ta es NULL en GRATIFICACION y BONIFICACION_EXTRAORDINARIA
// (no aplica: su efecto en Renta 5ta ya esta incorporado en la formula
// anual de Empleado, sumarlos aqui tambien duplicaria la retencion).
export interface ConceptoPlanilla {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  orden: number;
  // Backfill de migracion 019 (no se reconstruyo como parche independiente
  // - gap conocido): codigo PLAME editable por concepto desde Configuracion.
  // NULL = ese concepto no se declara aparte en el PLAME/REM.
  codigo_plame: string | null;
  factor1: number | null;
  factor1_etiqueta: string | null;
  factor2: number | null;
  factor2_etiqueta: string | null;
  factor3: number | null;
  factor3_etiqueta: string | null;
  afecto_essalud: boolean;
  afecto_sctr: boolean;
  afecto_senati: boolean;
  afecto_onp: boolean;
  afecto_afp: boolean;
  afecto_renta5ta: boolean | null;
  afecto_conafovicer: boolean;

  // migracion 033 ("Ronda D"): conceptos NUEVOS con formula propia. En los
  // 14+ conceptos originales, es_personalizado es false y formula/vigente_*
  // son null - su calculo sigue fijo en motorCalculo.ts, sin cambios.
  tipo: "INGRESO" | "APORTE" | "DESCUENTO";
  formula: string | null;
  es_personalizado: boolean;
  estado: "ACTIVO" | "PENDIENTE_DESARROLLO";
  activo: boolean;
  creado_en: string;
  vigente_desde: string | null;
  vigente_hasta: string | null;
}

export type ConceptosPlanilla = Record<string, ConceptoPlanilla>;

// Fila de detalle_planilla_conceptos (migracion 033): monto de un concepto
// PERSONALIZADO en una boleta ya calculada. Ver src/formulas.ts.
export interface DetallePlanillaConcepto {
  id: number;
  detalle_id: number;
  concepto_codigo: string;
  monto: number;
}

// Entrada de asistencia que llega desde el frontend (tareo del mes) para un contrato
export interface AsistenciaEntrada {
  contrato_id: number;
  dias_trabajados: number;
  dias_dominical: number;
  dias_feriado: number;
  dias_falta: number;
  horas_extra_25: number;
  horas_extra_35: number;
  horas_extra_100: number;
  // Migracion 030 (backfill de migracion 027, que no llego a reconstruirse
  // como parche independiente - ver nota en el commit): dias_subsidio_maternidad
  // se mantiene puramente informativo (no genera pago), dias_subsidio_enfermedad
  // y dias_licencia_paternidad ahora SI generan pago (ver
  // calcularSubsidioEnfermedad/calcularLicenciaPaternidad en motorCalculo.ts).
  // Migracion 038: este campo se renombro de significado (no de nombre, por
  // compatibilidad de columna/codigo) - pasa a representar SOLO el
  // subconjunto "Dias de Descanso Medico" (primeros 20 dias/año calendario
  // por CONTRATO, a cargo del EMPLEADOR, D.S. 009-97-SA, concepto
  // DESCANSO_MEDICO, casilla PLAME 0121) de los dias marcados
  // "DESCANSO_MEDICO" en el Tareo Diario. El resto (dia 21 en adelante) va
  // en dias_incapacidad_enfermedad (ver abajo). Antes de esta migracion el
  // sistema bloqueaba cargar mas de 20 dias/año (por eso este campo nunca
  // superaba 20) y ademas los calculaba TODOS con el tratamiento tributario
  // del dia 21+ por error (bug real reportado por el usuario) - ahora la
  // division es automatica (agregarTareoDiario, routes/planilla.ts) y ya no
  // hay bloqueo de carga.
  dias_subsidio_enfermedad: number;
  // Migracion 038: dias marcados "DESCANSO_MEDICO" que, por superar el
  // acumulado de 20 dias/año calendario por CONTRATO, se pagan como
  // "Incapacidad por Enfermedad" (subsidiados por EsSalud directamente al
  // trabajador, fuera de planilla en la practica pero declarados en el
  // PLAME bajo la casilla 0916, concepto INCAPACIDAD_ENFERMEDAD) en vez de
  // como dia normal de trabajo. Se calcula automaticamente en
  // agregarTareoDiario a partir del mismo acumulado anual que topa
  // dias_subsidio_enfermedad a 20 - ver el comentario completo alli.
  dias_incapacidad_enfermedad: number;
  dias_subsidio_maternidad: number;
  dias_licencia_paternidad: number;
  // Migracion 032: subconjunto de (dias_subsidio_enfermedad +
  // dias_incapacidad_enfermedad, es decir TODOS los dias marcados
  // "DESCANSO_MEDICO" sin importar quien los paga) que cuenta como "dia
  // computable" para Gratificacion/Vacaciones/CTS/Asignacion por
  // Escolaridad de construccion civil, topado a 60 dias por año calendario
  // por CONTRATO ("descansos medicos debidamente acreditados hasta por un
  // periodo de 60 dias al año" - RSD N°450-90-2SD-NEC). Es un tope DISTINTO
  // del de 20 dias/año de arriba (ese es sobre QUIEN PAGA el dia, este es
  // sobre la ELEGIBILIDAD para beneficios sociales) - ambos ejes son
  // legalmente independientes y se calculan por separado en
  // agregarTareoDiario.
  dias_subsidio_enfermedad_computable: number;
}

export interface DetallePlanilla {
  id: number;
  periodo_id: number;
  contrato_id: number;

  dias_trabajados: number;
  dias_dominical: number;
  dias_feriado: number;
  dias_falta: number;
  horas_extra_25: number;
  horas_extra_35: number;
  horas_extra_100: number;
  // Backfill de migracion 027 (ver nota en el commit de migracion 030):
  // foto historica, puramente informativa - dias_subsidio_maternidad NUNCA
  // genera pago; dias_subsidio_enfermedad/dias_licencia_paternidad SI
  // (migracion 030, ver subsidio_enfermedad/licencia_paternidad mas abajo).
  // Migracion 038: dias_subsidio_enfermedad = solo el bucket "Dias de
  // Descanso Medico" (<=20/año, concepto DESCANSO_MEDICO); ver el
  // comentario completo en AsistenciaEntrada.
  dias_subsidio_enfermedad: number;
  // Migracion 038: bucket "Dias por Incapacidad por Enfermedad" (dia 21 en
  // adelante, concepto INCAPACIDAD_ENFERMEDAD) - ver AsistenciaEntrada.
  dias_incapacidad_enfermedad: number;
  dias_subsidio_maternidad: number;
  dias_licencia_paternidad: number;
  // Migracion 032: subconjunto de dias_subsidio_enfermedad efectivamente
  // usado como "dia computable" en Gratificacion/Vacaciones/CTS/Asignacion
  // por Escolaridad (topado a 60 dias/año/contrato) - foto historica para
  // trazabilidad, ver el comentario completo en AsistenciaEntrada.
  dias_subsidio_enfermedad_computable: number;

  jornal_diario: number;
  sueldo_basico: number;
  remuneracion_dominical: number;
  remuneracion_feriado: number;
  importe_horas_extra: number;
  asignacion_familiar: number;
  asignacion_escolaridad: number;
  bonificacion_buc: number;
  bonificacion_bae: number;
  bonificacion_movilidad: number;
  // Migracion 030: pago REAL de los dias de arriba (dias_subsidio_enfermedad/
  // dias_licencia_paternidad) - antes (migracion 027) esos campos eran
  // puramente informativos. Migracion 038: subsidio_enfermedad = jornal_diario
  // x dias_subsidio_enfermedad (solo el bucket <=20 dias/año, concepto
  // DESCANSO_MEDICO - afecto a todos los aportes, igual que un dia normal de
  // trabajo); sin tope para licencia_paternidad. dias_subsidio_maternidad NO
  // tiene equivalente pagado: se mantiene puramente informativo (lo paga
  // EsSalud desde el dia 1, nunca por planilla).
  subsidio_enfermedad: number;
  // Migracion 038: pago del bucket "Dias por Incapacidad por Enfermedad"
  // (dia 21 en adelante, concepto INCAPACIDAD_ENFERMEDAD, casilla PLAME
  // 0916) = jornal_diario x dias_incapacidad_enfermedad. Mantiene las
  // mismas afectaciones que tenia el concepto SUBSIDIO_ENFERMEDAD original
  // antes de esta migracion (SI SCTR/AFP, NO EsSalud/SENATI/ONP/Renta5ta/
  // Conafovicer) - confirmado con el usuario.
  incapacidad_enfermedad: number;
  licencia_paternidad: number;
  otras_bonificaciones: number;
  gratificacion: number;
  bonificacion_extraordinaria: number;
  cts: number;
  vacaciones: number;
  total_ingresos: number;

  aporte_pension: number;
  descuento_sindicato: number;
  seguro_vida: number;
  conafovicer: number;
  renta_5ta: number;
  otros_descuentos: number;
  total_descuentos: number;

  // Ronda 4 (migracion_044, "piso de EsSalud mensual"): "essalud" es el
  // aporte FINAL, ya con el ajuste de piso mensual aplicado si
  // correspondio; "essalud_base" es el 9% de la remuneracion afecta SIN
  // ajustar. Se guardan ambos porque el ajuste de un periodo depende de
  // los demas periodos del MISMO mes calendario del mismo contrato (ver
  // calcularAjustePisoEssaludMensual en motorCalculo.ts / ajustarPisoEssaludDelMes
  // en routes/planilla.ts) - sin essalud_base no se podria recalcular el
  // acumulado del mes sin arrastrar un ajuste ya aplicado antes.
  essalud: number;
  essalud_base: number;
  sctr: number;
  senati: number;

  neto_pagar: number;
  detalle_json: Record<string, unknown>;
}

// ---------------------------------------------------------------------
// Planilla Mensual Consolidada (migracion 034, "Ronda E"): junta el Tareo
// Diario de todas las quincenas/semanas de un {proyecto, anio, mes} en un
// solo calculo mensual, para declarar PLAME/AFPnet/Asiento Contable por mes
// calendario. Aplica solo a obreros (construccion civil) - Empleados ya
// declaran por su periodo MENSUAL tal cual, sin cambios. Es un calculo
// ADICIONAL: no modifica ni reemplaza detalle_planilla (boletas por
// periodo de pago).
// ---------------------------------------------------------------------
export interface PlanillaMensual {
  id: number;
  proyecto: string;
  anio: number;
  mes: number;
  calculado_en: string;
  calculado_por: number | null;
  creado_en: string;
}

// Espejo de DetallePlanilla, con planilla_mensual_id en vez de periodo_id -
// mismas columnas de asistencia/ingresos/descuentos/aportes.
export interface DetallePlanillaMensual {
  id: number;
  planilla_mensual_id: number;
  contrato_id: number;

  dias_trabajados: number;
  dias_dominical: number;
  dias_dominical_no_laborado: number;
  dias_feriado: number;
  dias_falta: number;
  horas_extra_25: number;
  horas_extra_35: number;
  horas_extra_100: number;
  dias_subsidio_enfermedad: number;
  // Migracion 038: ver el comentario completo en DetallePlanilla.
  dias_incapacidad_enfermedad: number;
  dias_subsidio_maternidad: number;
  dias_licencia_paternidad: number;
  dias_subsidio_enfermedad_computable: number;

  jornal_diario: number;
  sueldo_basico: number;
  remuneracion_dominical: number;
  remuneracion_dominical_proporcional: number;
  remuneracion_feriado: number;
  sobretasa_dominical: number;
  sobretasa_feriado: number;
  importe_horas_extra: number;
  asignacion_familiar: number;
  asignacion_escolaridad: number;
  bonificacion_buc: number;
  bonificacion_bae: number;
  bonificacion_movilidad: number;
  condicion_trabajo: number;
  subsidio_enfermedad: number;
  incapacidad_enfermedad: number;
  licencia_paternidad: number;
  otras_bonificaciones: number;
  gratificacion: number;
  bonificacion_extraordinaria: number;
  cts: number;
  vacaciones: number;
  total_ingresos: number;

  aporte_pension: number;
  descuento_sindicato: number;
  seguro_vida: number;
  conafovicer: number;
  renta_5ta: number;
  otros_descuentos: number;
  total_descuentos: number;

  // Ver el comentario completo junto a estos 2 campos en DetallePlanilla.
  essalud: number;
  essalud_base: number;
  sctr: number;
  senati: number;

  neto_pagar: number;
  detalle_json: Record<string, unknown>;

  conceptos_personalizados?: { codigo: string; nombre: string; tipo: "INGRESO" | "APORTE" | "DESCUENTO"; monto: number }[];
}

// Aviso devuelto por POST /api/planilla-mensual/consolidar cuando una
// quincena usada en la consolidacion se recalculo DESPUES de la ultima vez
// que se consolido este mes (foto historica: no se recalcula sola, solo
// avisa - el usuario decide si vuelve a presionar "Consolidar").
export interface AvisoRecalculoPosteriorMensual {
  periodo_id: number;
  anio: number;
  mes: number;
  quincena: number | null;
  tipo: TipoPeriodo;
  calculado_en: string;
}

// Codigo de rol (roles.codigo): ADMIN, RESPONSABLE_PLANILLA, TAREADOR, o
// cualquier rol nuevo que el Administrador cree desde la pestaña Roles.
// Ya no es una union fija: los roles son configurables (ver routes/roles.ts).
export type RolUsuario = string;

export interface Usuario {
  id: number;
  nombre: string;
  correo: string;
  rol: RolUsuario;
  activo: boolean;
}

export interface Rol {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  protegido: boolean;
  permisos: string[];
  usuarios_count: number;
}

export interface PermisoCatalogo {
  codigo: string;
  nombre: string;
  grupo: string;
  orden: number;
}

export interface Proyecto {
  id: number;
  nombre: string;
  ubicacion: string | null;
  estado: "ACTIVO" | "CERRADO";
  // Valor de respaldo/por defecto (migracion_029): se usa solo si una
  // categoria de este proyecto todavia no tiene su propio monto en
  // cuota_sindical_categoria (ver esa tabla, mas abajo) - ej. un proyecto
  // recien creado. El monto real por categoria se administra en
  // Configuracion -> Cuota sindical.
  cuota_sindical_semanal: number;
  // Cada proyecto/obra es su propio establecimiento SUNAT (migracion_016).
  codigo_establecimiento?: string | null;
  tipo_establecimiento?: "DOMICILIO FISCAL" | "ESTABLECIMIENTO ANEXO";
  // Migracion_042: ubicacion geografica (catalogo UBIGEO ya existente),
  // opcional - se usa para decidir si un feriado REGIONAL/LOCAL aplica a
  // este proyecto. Un proyecto sin esto configurado solo recibe los
  // feriados NACIONAL (comportamiento seguro por defecto).
  ubigeo_departamento_codigo?: string | null;
  ubigeo_provincia_codigo?: string | null;
  ubigeo_distrito_codigo?: string | null;
}

// Cuota sindical por proyecto y categoria (migracion_029): el monto SEMANAL
// que acuerda el sindicato varia por categoria del trabajador (peon/
// oficial/operario), no solo por proyecto - antes el sistema solo tenia el
// valor unico de Proyecto.cuota_sindical_semanal. Es un valor FIJO (no
// varia por mes/anio, a diferencia de tasas_afp_mensuales/
// tabla_salarial_mensual): se edita a mano cuando cambie el convenio.
export interface CuotaSindicalCategoria {
  id: number;
  proyecto_id: number;
  categoria: CategoriaOcupacional;
  monto_semanal: number;
}

// Horario de proyecto + tasa de tramo3 de horas extra (migracion_045,
// "Control de Asistencia Diaria" - Ronda 1). hora_ingreso/hora_salida/
// minutos_refrigerio/hora_ingreso_sabado/hora_salida_sabado quedan
// guardados para el futuro importador de marcaciones biometricas (Ronda
// 2/3) - todavia no entran a ningun calculo. tasa_tramo3 SI se usa desde
// ya en calcularHorasExtra (motorCalculo.ts): es el MULTIPLICADOR del
// valor hora (misma convencion que conceptos_planilla.factor1/2/3, ej.
// 1.60 = 60% de recargo) para las horas de tramo3 (mas de 6 horas extra
// acumuladas en el dia) de ESTE proyecto; null = usa el factor3 general de
// la empresa (HORAS_EXTRA_CONSTRUCCION/GENERAL), sin cambios.
export interface HorarioProyecto {
  proyecto_id: number;
  // Solo viene en la respuesta de GET /api/conceptos/horarios-proyecto (para
  // mostrar la tabla editable por proyecto); no se envia ni se usa en el PUT.
  proyecto_nombre?: string;
  hora_ingreso: string;
  hora_salida: string;
  minutos_refrigerio: number;
  hora_ingreso_sabado: string | null;
  hora_salida_sabado: string | null;
  tasa_tramo3: number | null;
}

export interface DatosEmpresa {
  id: number;
  ruc: string;
  razon_social: string;
  nombre_comercial: string | null;
  domicilio_fiscal: string | null;
  ubigeo: string | null;
  actividad_economica: string | null;
  tipo_empresa: string | null;
  regimen_laboral: string | null;
  representante_legal: string | null;
  telefono: string | null;
  correo: string | null;
  // Logo de la empresa (migracion 031) - el binario (logo_archivo) NUNCA
  // viaja en este tipo/por JSON (ver COLUMNAS_EMPRESA_SIN_LOGO en
  // routes/empresa.ts); solo su metadata y un booleano de presencia. La
  // imagen misma se sirve por GET /api/empresa/logo.
  logo_mime?: string | null;
  logo_nombre?: string | null;
  tiene_logo?: boolean;
}
