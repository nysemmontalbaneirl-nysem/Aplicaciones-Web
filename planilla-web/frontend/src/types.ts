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
  bonificacion_buc: number;
  otras_bonificaciones: number;
  gratificacion: number;
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

// ADMIN: acceso total. RESPONSABLE_PLANILLA: tareo/calculo/boletas solo de
// sus proyectos asignados. TAREADOR: solo carga tareo de sus proyectos.
export type RolUsuario = "ADMIN" | "RESPONSABLE_PLANILLA" | "TAREADOR";

export interface Usuario {
  id: number;
  nombre: string;
  correo: string;
  rol: RolUsuario;
  activo: boolean;
  proyectos: string[];
}

export interface Proyecto {
  id: number;
  nombre: string;
  ubicacion: string | null;
  estado: "ACTIVO" | "CERRADO";
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
