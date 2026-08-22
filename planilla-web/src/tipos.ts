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
}

export interface PeriodoPlanilla {
  id: number;
  anio: number;
  mes: number;
  quincena: number | null;
  tipo: "MENSUAL" | "QUINCENAL";
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
  detalle_json: Record<string, unknown>;
}
