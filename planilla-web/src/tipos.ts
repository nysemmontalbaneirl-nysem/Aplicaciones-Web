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

export interface PeriodoPlanilla {
  id: number;
  anio: number;
  mes: number;
  quincena: number | null;
  tipo: "MENSUAL" | "QUINCENAL" | "SEMANAL";
  fecha_inicio: string;
  fecha_fin: string;
  dias_periodo: number;
  estado: "ABIERTO" | "CALCULADO" | "CERRADO" | "DECLARADO";
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
}

export type ConceptosPlanilla = Record<string, ConceptoPlanilla>;

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
  detalle_json: Record<string, unknown>;
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
  cuota_sindical_semanal: number;
  // Cada proyecto/obra es su propio establecimiento SUNAT (migracion_016).
  codigo_establecimiento?: string | null;
  tipo_establecimiento?: "DOMICILIO FISCAL" | "ESTABLECIMIENTO ANEXO";
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
}
