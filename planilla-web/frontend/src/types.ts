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

export interface TasasAFPFondo {
  aporte_obligatorio: number;
  comision_flujo: number;
  prima_seguro: number;
}

export interface CategoriaConfig {
  buc: number;
  jornal_basico: number;
  bae: number;
  movilidad_acumulada: number;
  gratificacion_diaria: number;
}

// Valores de frecuencia ANUAL
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

// Tasas AFP y tabla salarial: frecuencia MENSUAL
export interface ParametrosMensuales {
  anio: number;
  mes: number;
  afp_tasas: Record<string, TasasAFPFondo>;
  tabla_categorias: Record<string, CategoriaConfig>;
}

export interface PeriodoMensual {
  anio: number;
  mes: number;
}

// migracion_044 (Ronda 4, "piso de EsSalud mensual"): override puntual de la
// RMV para un mes especifico. Un mes sin fila aqui usa el valor anual de
// ParametrosNormativos.remuneracion_minima_vital.
export interface RmvMensual {
  anio: number;
  mes: number;
  remuneracion_minima_vital: number;
}

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
  direccion?: string | null;
  ubigeo?: string | null;
  entidad_bancaria?: string | null;
  cuenta_bancaria?: string | null;
  estado: "ACTIVO" | "INACTIVO";
  // Campos T-Registro (SUNAT) agregados en la migracion_016 - todos
  // opcionales/nulables, se llenan de a poco desde el formulario de alta.
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
  // Firma escaneada (migracion 031) - solo de referencia visual en la
  // Boleta, no reemplaza el espacio de firma fisica. El binario nunca
  // viaja por JSON, solo metadata + un booleano de presencia; la imagen se
  // sirve por GET /api/empleados/:id/firma.
  firma_mime?: string | null;
  firma_nombre?: string | null;
  tiene_firma?: boolean;
  // Migracion 041: apellido paterno/materno/nombres por separado - solo se
  // usan para el archivo oficial de AFPnet (exige estas 3 columnas
  // separadas). Opcionales y no retroactivos; "apellidos_nombres" sigue
  // siendo el campo que se usa en el resto del sistema.
  apellido_paterno?: string | null;
  apellido_materno?: string | null;
  nombres?: string | null;
}

export interface Contrato {
  id: number;
  empleado_id: number;
  apellidos_nombres?: string;
  numero_documento?: string;
  proyecto: string;
  grupo: string | null;
  ocupacion?: string | null;
  categoria_ocupacional: CategoriaOcupacional;
  sistema_pension: "AFP" | "ONP";
  afp_nombre: string | null;
  cuspp?: string | null;
  sistema_comision?: string | null;
  fecha_ingreso: string;
  fecha_cese: string | null;
  sueldo_base: number | null;
  sindicalizado: boolean;
  poliza_seguro: boolean;
  sctr_salud: boolean;
  essalud_vida?: boolean;
  domiciliado?: boolean;
  estado: "HABIL" | "CESADO";
  // Campos T-Registro (SUNAT) agregados en la migracion_016.
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

// Un item generico de catalogo (codigo + nombre) tal como los devuelve
// GET /api/catalogos - la mayoria de los catalogos SUNAT son solo esto.
export interface CatalogoItem {
  codigo: string;
  nombre: string;
}

export interface CatalogoUbigeoProvincia extends CatalogoItem {
  departamento_codigo: string;
}

export interface CatalogoUbigeoDistrito extends CatalogoItem {
  provincia_codigo: string;
}

// Respuesta completa de GET /api/catalogos: todas las tablas catalogo_*
// que agrego la migracion_016 (Anexo 2 SUNAT T-Registro), para armar los
// desplegables del alta de trabajador.
export interface Catalogos {
  tipo_documento: CatalogoItem[];
  nacionalidad: CatalogoItem[];
  tipo_trabajador: CatalogoItem[];
  grado_instruccion: CatalogoItem[];
  regimen_pensionario: CatalogoItem[];
  tipo_contrato: CatalogoItem[];
  periodicidad: CatalogoItem[];
  eps: CatalogoItem[];
  tipo_pago: CatalogoItem[];
  motivo_baja: CatalogoItem[];
  categoria_ocupacional_sunat: CatalogoItem[];
  regimen_salud: CatalogoItem[];
  regimen_laboral: CatalogoItem[];
  situacion_especial: CatalogoItem[];
  banco: CatalogoItem[];
  ubigeo_departamento: CatalogoItem[];
  ubigeo_provincia: CatalogoUbigeoProvincia[];
  ubigeo_distrito: CatalogoUbigeoDistrito[];
}

export interface PeriodoPlanilla {
  id: number;
  anio: number;
  mes: number;
  quincena: number | null;
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string;
  dias_periodo: number;
  estado: string;
  // Proyecto/obra al que pertenece este periodo (Ronda C). null = periodo
  // legado/todos los proyectos.
  proyecto: string | null;
}

export interface DetalleAportePension {
  total: number;
  onp: number;
  aporteObligatorio: number;
  comisionFlujo: number;
  primaSeguro: number;
}

export interface DetallePlanilla {
  id: number;
  contrato_id: number;
  apellidos_nombres: string;
  numero_documento: string;
  numero_hijos: number;
  proyecto: string;
  categoria_ocupacional: CategoriaOcupacional;
  sistema_pension: "AFP" | "ONP";
  afp_nombre: string | null;
  cuspp: string | null;
  // Firma escaneada del trabajador (migracion 031) - solo un booleano de
  // presencia (el binario nunca viaja en este listado); la imagen se sirve
  // por GET /api/empleados/:id/firma, pero esta vista no trae empleado_id -
  // se usa GET /api/contratos/:id/firma (resuelve el empleado internamente).
  tiene_firma?: boolean;
  fecha_ingreso: string;
  // Solo si el trabajador ceso en algun momento (contratos.fecha_cese, no
  // necesariamente dentro de este periodo puntual) - se muestra en la
  // boleta cuando esta presente (pedido explicito del usuario, sept. 2026).
  fecha_cese: string | null;

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
  // Descanso Medico" (<=20/año); dias_incapacidad_enfermedad = bucket
  // "Incapacidad por Enfermedad" (21+).
  dias_subsidio_enfermedad: number;
  dias_incapacidad_enfermedad: number;
  dias_subsidio_maternidad: number;
  dias_licencia_paternidad: number;

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
  // Migracion 030 (corregido en 038): pago REAL de dias_subsidio_enfermedad
  // (bucket <=20/año)/dias_incapacidad_enfermedad (bucket 21+)/
  // dias_licencia_paternidad (antes, migracion 027, esos campos eran
  // puramente informativos). dias_subsidio_maternidad se mantiene sin pago
  // (solo informativo).
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

  essalud: number;
  sctr: number;
  senati: number;

  neto_pagar: number;
  detalle_json: {
    remuneracion_computable?: number;
    remuneracion_afecta?: number;
    aporte_pension_detalle?: DetalleAportePension;
    total_aportes_empleador?: number;
  };
}

export interface AsistenciaEntrada {
  contrato_id: number;
  dias_trabajados: number;
  dias_dominical: number;
  dias_feriado: number;
  dias_falta: number;
  horas_extra_25: number;
  horas_extra_35: number;
  horas_extra_100: number;
  // Agregados desde el Tareo Diario (migracion 017) - solo informativos,
  // no afectan ningun monto calculado todavia.
  dias_subsidio_enfermedad?: number;
  dias_incapacidad_enfermedad?: number;
  dias_subsidio_maternidad?: number;
  dias_licencia_paternidad?: number;
}

export interface AsistenciaTareo extends AsistenciaEntrada {
  numero_documento: string;
  apellidos_nombres: string;
  proyecto: string;
  categoria_ocupacional: CategoriaOcupacional;
}

// ---------------------------------------------------------------------
// Tareo Diario (migracion 017): registro dia por dia, ademas del Excel
// agregado y la edicion manual de totales de arriba.
// ---------------------------------------------------------------------
// Migracion 038: "SUBSIDIO_ENFERMEDAD" se renombro a "DESCANSO_MEDICO" (ver
// el comentario completo en routes/planilla.ts, backend).
export type TipoDiaEspecial =
  | "FALTA"
  | "DESCANSO_MEDICO"
  | "SUBSIDIO_MATERNIDAD"
  | "LICENCIA_PATERNIDAD";

export interface TareoDiarioFila {
  fecha: string; // YYYY-MM-DD
  // Migracion 040: null representa un campo TODAVIA NO digitado por el
  // usuario (se muestra vacio en la grilla, a pedido explicito del usuario -
  // antes se mostraba "0" y habia que borrarlo a mano antes de escribir). Se
  // envia tal cual al guardar - el backend ya trata null igual que 0
  // (routes/planilla.ts, ver validacion de CAMPOS_HORAS/CAMPOS_MINUTOS).
  horas_normales: number | null;
  minutos_normales: number | null;
  horas_dominical: number | null;
  minutos_dominical: number | null;
  horas_feriado: number | null;
  minutos_feriado: number | null;
  horas_extra_tramo1: number | null;
  minutos_extra_tramo1: number | null;
  horas_extra_tramo2: number | null;
  minutos_extra_tramo2: number | null;
  horas_extra_tramo3: number | null;
  minutos_extra_tramo3: number | null;
  tipo_dia_especial: TipoDiaEspecial | null;
}

// GET /api/conceptos/horas-extra -> multiplicadores reales por regimen, para
// etiquetar dinamicamente las columnas de horas extra (60%/100%/100% en
// construccion civil, 25%/35%/100% en regimen general).
export interface FactorHorasExtra {
  factor1: number | null;
  factor2: number | null;
  factor3: number | null;
}

export interface FactoresHorasExtra {
  construccion: FactorHorasExtra;
  general: FactorHorasExtra;
}

// Codigo de rol (roles.codigo): ADMIN, RESPONSABLE_PLANILLA, TAREADOR, o
// cualquier rol nuevo que el Administrador cree desde la pestaña Roles.
export type RolUsuario = string;

export interface Usuario {
  id: number;
  nombre: string;
  correo: string;
  rol: RolUsuario;
  activo: boolean;
  proyectos: string[];
  // Codigos de permisos_catalogo que tiene su rol. ["*"] = acceso a todo
  // (rol protegido, ej. ADMIN). Viene calculado desde el login.
  permisos: string[];
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

export function tienePermiso(usuario: Usuario, codigo: string): boolean {
  return usuario.permisos.includes("*") || usuario.permisos.includes(codigo);
}

// Mismo criterio que motorCalculo.ts (backend) para saber si a un trabajador
// le corresponde el regimen de construccion civil (60%/100%/100% en horas
// extra) o el regimen general (25%/35%/100%). Se usa solo para mostrar la
// etiqueta correcta en la pantalla de Tareo Diario - el monto real siempre
// lo calcula el backend.
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

// Convierte un multiplicador (ej. 1.6) al % de recargo que se muestra al
// usuario (ej. "60%"). Redondea porque los factores pueden venir como string
// desde Postgres (NUMERIC).
export function porcentajeRecargo(factor: number | null | undefined): string {
  if (factor === null || factor === undefined) return "?";
  return `${Math.round((Number(factor) - 1) * 100)}%`;
}

// ---------------------------------------------------------------------
// Planilla Mensual (Ronda E, migracion_034 + unificacion Reportes/Planilla
// Mensual, 22/09/2026): junta el Tareo Diario de todas las quincenas/
// semanas de un mes calendario en un solo calculo, para declarar PLAME/
// AFPnet/Asiento Contable por MES en vez de por periodo de pago. Desde la
// unificacion trabaja siempre por un ALCANCE {anio, mes, proyecto?}, en 2
// modalidades: "Por proyecto" (obreros consolidados de ese proyecto MAS los
// empleados de regimen general de ese mismo proyecto/mes, que no requieren
// consolidarse) o "Todos los proyectos" (junta obreros de CADA proyecto con
// periodos ese mes mas empleados de TODOS los proyectos - solo ADMIN). Ver
// src/planillaMensual.ts (backend).
// ---------------------------------------------------------------------
export interface CabeceraObrerosConsolidados {
  id: number;
  proyecto: string;
  calculado_en: string;
  calculado_por: number | null;
}

// Espejo de DetallePlanilla (mismas columnas de asistencia/ingresos/
// descuentos/aportes), con el contrato/trabajador ya unido. Una fila puede
// venir de un OBRERO ya consolidado (detalle_planilla_mensual) o de un
// EMPLEADO de regimen general (su propia boleta MENSUAL, detalle_planilla,
// leida tal cual sin consolidar) - ver obtenerVistaMensual en planillaMensual.ts.
export interface DetalleTrabajadorMensualFila {
  contrato_id: number;
  numero_documento: string;
  apellidos_nombres: string;
  categoria_ocupacional: CategoriaOcupacional;
  proyecto: string;
  tipo_trabajador: "OBRERO" | "EMPLEADO";
  // Solo los OBREROS tienen planilla_mensual_id (vienen de una consolidacion
  // ya guardada); los EMPLEADOS siempre traen null aca (nunca se "consolidan").
  planilla_mensual_id: number | null;

  dias_trabajados: number;
  dias_dominical: number;
  dias_dominical_no_laborado: number;
  dias_feriado: number;
  dias_falta: number;
  horas_extra_25: number;
  horas_extra_35: number;
  horas_extra_100: number;
  dias_subsidio_enfermedad: number;
  dias_incapacidad_enfermedad: number;
  dias_subsidio_maternidad: number;
  dias_licencia_paternidad: number;

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

  essalud: number;
  sctr: number;
  senati: number;

  neto_pagar: number;

  // Migracion 037: montos de conceptos PERSONALIZADOS (formula propia, ver
  // Configuracion) ya calculados para este mes - antes se guardaban pero
  // nunca se volvian a leer para esta pantalla.
  conceptos_personalizados?: { codigo: string; nombre: string; tipo: "INGRESO" | "APORTE" | "DESCUENTO"; monto: number }[];
}

export interface DiagnosticoAfpnetMensual {
  trabajadores_consolidados: number;
  por_sistema_pension: { sistema_pension: string; total: number }[];
}

// Migracion 042: un periodo MENSUAL (de empleados) que todavia no paso por
// "Calcular" en la pantalla Periodos - sus boletas podrian no estar completas.
export interface PeriodoMensualEmpleadosNoCalculado {
  id: number;
  proyecto: string | null;
  fecha_inicio: string;
  fecha_fin: string;
}

// Respuesta de GET /api/planilla-mensual (unificacion 22/09/2026) - siempre
// 200, con arreglos vacios si nunca se toco este mes/proyecto (antes 404).
export interface VistaDeclaracionMensual {
  anio: number;
  mes: number;
  proyecto: string | null;
  cabeceras_obreros: CabeceraObrerosConsolidados[];
  detalle: DetalleTrabajadorMensualFila[];
  avisos_periodos_empleados_no_calculados: PeriodoMensualEmpleadosNoCalculado[];
  // Migracion 041: advertencias del archivo oficial de AFPnet (apellidos
  // referenciales incompletos en Trabajadores, o tipo de documento sin
  // mapeo confirmado a AFPnet) - no bloquean la descarga, ver afpnetExcel.ts.
  avisos_datos_afpnet: string[];
  // Migracion 043: diagnostico de Sistema de Pension, visible siempre al
  // cargar la pantalla (ver el comentario completo en el backend,
  // obtenerDiagnosticoAfpnetMensual en afpnetExcel.ts).
  diagnostico_afpnet: DiagnosticoAfpnetMensual;
}

export interface AvisoRecalculoPosteriorMensual {
  periodo_id: number;
  anio: number;
  mes: number;
  quincena: number | null;
  tipo: string;
  calculado_en: string;
  proyecto: string;
}

export interface PeriodoIncluidoConsolidacion {
  id: number;
  tipo: string;
  quincena: number | null;
  fecha_inicio: string;
  fecha_fin: string;
  estado: string;
  proyecto: string;
}

// Respuesta de POST /api/planilla-mensual/consolidar - un proyecto (el
// pedido) o TODOS los proyectos con periodos ese mes (proyecto=null,
// consolida cada uno y suma los resultados).
export interface ResultadoConsolidacionMensual {
  anio: number;
  mes: number;
  proyecto: string | null;
  proyectos_consolidados: string[];
  trabajadores_consolidados: number;
  periodos_incluidos: PeriodoIncluidoConsolidacion[];
  avisos_recalculo_posterior: AvisoRecalculoPosteriorMensual[];
  avisos_periodos_no_calculados: (Omit<PeriodoIncluidoConsolidacion, "estado">)[];
  errores: { contrato_id: number; dni: string; nombre: string; motivo: string; proyecto: string }[];
}

// Migracion 042: una fila del historial de meses ya consolidados (GET
// /planilla-mensual/historial), para no tener que ir probando proyecto por
// proyecto y mes por mes en el selector de arriba.
export interface FilaHistorialConsolidacion {
  id: number;
  proyecto: string;
  anio: number;
  mes: number;
  calculado_en: string;
  calculado_por_nombre: string | null;
  trabajadores_consolidados: number;
}

export interface Proyecto {
  id: number;
  nombre: string;
  ubicacion: string | null;
  estado: "ACTIVO" | "CERRADO";
  // Valor de respaldo/por defecto (migracion_029): se usa solo si una
  // categoria de este proyecto todavia no tiene su propio monto en
  // CuotaSindicalCategoria - el monto real se administra en Configuracion
  // -> Cuota sindical.
  cuota_sindical_semanal: number;
  // Cada proyecto/obra es su propio establecimiento SUNAT (migracion_016).
  codigo_establecimiento?: string | null;
  tipo_establecimiento?: "DOMICILIO FISCAL" | "ESTABLECIMIENTO ANEXO";
  // Migracion_042: ubicacion geografica (catalogo UBIGEO), opcional -
  // decide si un feriado REGIONAL/LOCAL aplica a este proyecto.
  ubigeo_departamento_codigo?: string | null;
  ubigeo_provincia_codigo?: string | null;
  ubigeo_distrito_codigo?: string | null;
}

// Cuota sindical por proyecto y categoria (migracion_029): valor FIJO (no
// varia por mes/anio), se edita a mano cuando cambie el convenio.
export interface CuotaSindicalCategoria {
  id: number;
  proyecto_id: number;
  categoria: CategoriaOcupacional;
  monto_semanal: number;
}

// Horario de proyecto + tasa de tramo3 de horas extra (migracion_045,
// "Control de Asistencia Diaria" - Ronda 1). hora_ingreso/hora_salida/
// minutos_refrigerio/sabado todavia no entran a ningun calculo (quedan
// guardados para el futuro importador de marcaciones biometricas - Ronda
// 2/3). tasa_tramo3 SI se usa desde ya: es el MULTIPLICADOR del valor hora
// (ej. 1.60 = 60% de recargo) para las horas de tramo3 (mas de 6 horas
// extra acumuladas en el dia) de este proyecto; null = usa el recargo
// general de la empresa.
export interface HorarioProyecto {
  proyecto_id: number;
  proyecto_nombre?: string;
  hora_ingreso: string;
  hora_salida: string;
  minutos_refrigerio: number;
  hora_ingreso_sabado: string | null;
  hora_salida_sabado: string | null;
  tasa_tramo3: number | null;
}

// Importacion de marcaciones biometricas (migracion_046, Ronda 2 - puente
// practico). Ver el comentario equivalente en el backend (src/tipos.ts).
export interface ImportacionMarcaciones {
  id: number;
  periodo_id: number;
  nombre_archivo: string | null;
  importado_en: string;
  total_marcaciones: number;
  total_dias: number;
  total_errores: number;
  errores: { fila: number; dni: string; motivo: string }[];
  aplicado_en: string | null;
}

export interface MarcacionCruda {
  hora: string;
  tipo: "ENTRADA" | "SALIDA" | null;
}

export interface ImportacionMarcacionesDetalle {
  id: number;
  contrato_id: number;
  numero_documento: string;
  apellidos_nombres: string;
  fecha: string;
  hora_ingreso_real: string | null;
  hora_salida_real: string | null;
  horas_normales: number;
  minutos_normales: number;
  horas_dominical: number;
  minutos_dominical: number;
  horas_feriado: number;
  minutos_feriado: number;
  horas_extra_tramo1: number;
  minutos_extra_tramo1: number;
  horas_extra_tramo2: number;
  minutos_extra_tramo2: number;
  horas_extra_tramo3: number;
  minutos_extra_tramo3: number;
  marcas: MarcacionCruda[];
  aplicado: boolean;
  // Migracion 047: minutos de "llegada anticipada" (marca de ingreso antes
  // de la hora programada) y si ya se confirmo pagarlos como hora extra.
  minutos_llegada_anticipada: number;
  anticipacion_pagada: boolean;
}

export interface EntradaBitacora {
  id: number;
  accion: string;
  tabla_afectada: string | null;
  registro_id: number | null;
  detalle: Record<string, unknown>;
  fecha: string;
  usuario_nombre: string | null;
  usuario_correo: string | null;
}

export interface RespuestaBitacora {
  pagina: number;
  por_pagina: number;
  total: number;
  registros: EntradaBitacora[];
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
  // Logo de la empresa (migracion 031) - el binario nunca viaja por JSON,
  // solo metadata + un booleano de presencia; la imagen se sirve por
  // GET /api/empresa/logo.
  logo_mime?: string | null;
  logo_nombre?: string | null;
  tiene_logo?: boolean;
  // Firma escaneada del EMPLEADOR (migracion 031, pedido adicional) - misma
  // logica que el logo: el binario nunca viaja por JSON, la imagen se sirve
  // por GET /api/empresa/firma-empleador. Se muestra en la Boleta junto al
  // nombre de representante_legal (arriba).
  firma_empleador_mime?: string | null;
  firma_empleador_nombre?: string | null;
  tiene_firma_empleador?: boolean;
}

// Catalogo configurable de conceptos de planilla (pestana Configuracion),
// siguiendo el modelo de la Tabla 22 de SUNAT. afecto_renta5ta en null
// significa "no aplica" (ver GRATIFICACION/BONIFICACION_EXTRAORDINARIA):
// su efecto en Renta de 5ta ya esta incorporado en la formula anual de
// Empleado, sumarlos aqui tambien duplicaria la retencion.
export interface ConceptoPlanilla {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  orden: number;
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
  // Migracion 039: interruptor activo/inactivo por concepto (ver
  // estaActivo en motorCalculo.ts). SUELDO_BASICO no se puede desactivar.
  activo: boolean;
}

export interface PeriodoVacacional {
  fecha_inicio: string;
  fecha_fin: string;
  dias_computables: number;
  dias_ganados: number;
  cumplio_record: boolean;
}

export interface GoceVacaciones {
  id: number;
  contrato_id: number;
  fecha_inicio: string;
  fecha_fin: string;
  dias: number;
  observaciones: string | null;
  creado_en: string;
  boleta_id: number | null;
  remuneracion_vacacional: number | null;
  boleta_neto_pagar: number | null;
}

export interface BoletaVacaciones {
  id: number;
  goce_id: number;
  contrato_id: number;
  fecha_inicio: string;
  fecha_fin: string;
  dias: number;
  remuneracion_vacacional: number;
  aporte_pension: number;
  essalud: number;
  sctr: number;
  neto_pagar: number;
  detalle_json: {
    aporte_pension_detalle?: DetalleAportePension;
  };
  generado_en: string;
}

export interface BoletaVacacionesRespuesta {
  boleta: BoletaVacaciones;
  contrato: {
    id: number;
    numero_documento: string;
    apellidos_nombres: string;
    proyecto: string;
    categoria_ocupacional: CategoriaOcupacional;
    sistema_pension: "AFP" | "ONP";
    afp_nombre: string | null;
    cuspp: string | null;
    numero_hijos: number;
  };
}

export interface RecordVacacional {
  contrato: {
    id: number;
    numero_documento: string;
    apellidos_nombres: string;
    proyecto: string;
    fecha_ingreso: string;
    fecha_cese: string | null;
  };
  umbral_dias_record: number;
  periodos: PeriodoVacacional[];
  total_ganado: number;
  total_gozado: number;
  saldo_pendiente: number;
  goces: GoceVacaciones[];
}

// limites_tareo (migracion 040, ampliada en migracion 043): fila unica,
// editable desde Configuracion -> "Limites de tareo". Domingo (por dia de
// la semana) y las columnas de Feriado trabajado quedan sin limite. Cada
// concepto (Jornal normal, y cada tramo de horas extra) tiene su propio
// limite independiente - ver el comentario completo en la migracion SQL y
// en routes/planilla.ts.
export interface LimitesTareo {
  // Firma indice (ademas de los 16 campos explicitos de abajo): permite
  // construir el nombre de columna dinamicamente a partir de un concepto
  // (ej. `horas_max_${concepto.clave}_${tipoDia}`) sin pelear con el
  // chequeo de tipos, tanto en TareoDiario.tsx (bloqueo preventivo) como en
  // Configuracion.tsx (formulario de edicion).
  [campo: string]: number;
  horas_max_normal_lun_vie: number;
  minutos_max_normal_lun_vie: number;
  horas_max_normal_sabado: number;
  minutos_max_normal_sabado: number;
  horas_max_tramo1_lun_vie: number;
  minutos_max_tramo1_lun_vie: number;
  horas_max_tramo1_sabado: number;
  minutos_max_tramo1_sabado: number;
  horas_max_tramo2_lun_vie: number;
  minutos_max_tramo2_lun_vie: number;
  horas_max_tramo2_sabado: number;
  minutos_max_tramo2_sabado: number;
  horas_max_tramo3_lun_vie: number;
  minutos_max_tramo3_lun_vie: number;
  horas_max_tramo3_sabado: number;
  minutos_max_tramo3_sabado: number;
}

// Un concepto de Jornal/Horas extra con limite independiente en
// LimitesTareo - clave usada para armar los nombres de columna
// (horas_max_<clave>_lun_vie, etc.) tanto en TareoDiario.tsx (bloqueo
// preventivo) como en Configuracion.tsx (formulario de edicion).
export type ClaveConceptoLimiteTareo = "normal" | "tramo1" | "tramo2" | "tramo3";
