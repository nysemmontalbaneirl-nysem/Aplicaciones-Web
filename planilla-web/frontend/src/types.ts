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
// Planilla Mensual Consolidada (Ronda E, migracion_034): junta el Tareo
// Diario de todas las quincenas/semanas de un {proyecto, anio, mes} en un
// solo calculo mensual, para declarar PLAME/AFPnet/Asiento Contable por MES
// CALENDARIO. Aplica solo a obreros (construccion civil) - Empleados ya
// declaran por su propio periodo MENSUAL. Ver src/planillaMensual.ts (backend).
// ---------------------------------------------------------------------
export interface PlanillaMensualCabecera {
  id: number;
  proyecto: string;
  anio: number;
  mes: number;
  calculado_en: string;
  calculado_por: number | null;
  creado_en: string;
}

// Espejo de DetallePlanilla (mismas columnas de asistencia/ingresos/
// descuentos/aportes), con el contrato/trabajador ya unido - ver
// obtenerPlanillaMensual en planillaMensual.ts.
export interface DetallePlanillaMensualFila {
  id: number;
  planilla_mensual_id: number;
  contrato_id: number;
  numero_documento: string;
  apellidos_nombres: string;
  categoria_ocupacional: CategoriaOcupacional;
  proyecto: string;

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

export interface PlanillaMensualConsolidada {
  planillaMensual: PlanillaMensualCabecera;
  detalle: DetallePlanillaMensualFila[];
}

export interface AvisoRecalculoPosteriorMensual {
  periodo_id: number;
  anio: number;
  mes: number;
  quincena: number | null;
  tipo: string;
  calculado_en: string;
}

export interface ResultadoConsolidacion {
  planilla_mensual_id: number;
  proyecto: string;
  anio: number;
  mes: number;
  trabajadores_consolidados: number;
  periodos_incluidos: { id: number; tipo: string; quincena: number | null; fecha_inicio: string; fecha_fin: string }[];
  avisos_recalculo_posterior: AvisoRecalculoPosteriorMensual[];
  errores: { contrato_id: number; dni: string; nombre: string; motivo: string }[];
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
}

// Cuota sindical por proyecto y categoria (migracion_029): valor FIJO (no
// varia por mes/anio), se edita a mano cuando cambie el convenio.
export interface CuotaSindicalCategoria {
  id: number;
  proyecto_id: number;
  categoria: CategoriaOcupacional;
  monto_semanal: number;
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
