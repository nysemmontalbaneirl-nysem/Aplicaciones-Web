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
  estado: "ACTIVO" | "INACTIVO";
}

export interface Contrato {
  id: number;
  empleado_id: number;
  apellidos_nombres?: string;
  numero_documento?: string;
  proyecto: string;
  grupo: string | null;
  categoria_ocupacional: CategoriaOcupacional;
  sistema_pension: "AFP" | "ONP";
  afp_nombre: string | null;
  cuspp?: string | null;
  fecha_ingreso: string;
  fecha_cese: string | null;
  sueldo_base: number | null;
  sindicalizado: boolean;
  poliza_seguro: boolean;
  sctr_salud: boolean;
  estado: "HABIL" | "CESADO";
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
  fecha_ingreso: string;

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
}

export interface AsistenciaTareo extends AsistenciaEntrada {
  numero_documento: string;
  apellidos_nombres: string;
  proyecto: string;
  categoria_ocupacional: CategoriaOcupacional;
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

export interface Proyecto {
  id: number;
  nombre: string;
  ubicacion: string | null;
  estado: "ACTIVO" | "CERRADO";
  cuota_sindical_semanal: number;
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
