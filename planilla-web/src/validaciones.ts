import { AsistenciaEntrada, CategoriaOcupacional, SistemaPension } from "./tipos";

export class ErrorValidacion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorValidacion";
  }
}

const CATEGORIAS_VALIDAS: CategoriaOcupacional[] = [
  "OPERARIO",
  "OFICIAL",
  "PEON",
  "EMPLEADO",
  "EVENTUAL",
  "OPERARIO_EP",
  "OPERARIO_EM",
  "OPERARIO_TP",
];

const SISTEMAS_PENSION_VALIDOS: SistemaPension[] = ["AFP", "ONP"];

export function validarNumeroDocumento(valor: unknown): string {
  if (typeof valor !== "string" || !/^\d{8,15}$/.test(valor)) {
    throw new ErrorValidacion(
      "numero_documento debe ser una cadena numerica de 8 a 15 digitos"
    );
  }
  return valor;
}

export function validarApellidosNombres(valor: unknown): string {
  if (typeof valor !== "string" || valor.trim().length < 3) {
    throw new ErrorValidacion("apellidos_nombres es obligatorio (min. 3 caracteres)");
  }
  return valor.trim();
}

export function validarCategoriaOcupacional(valor: unknown): CategoriaOcupacional {
  if (typeof valor !== "string" || !CATEGORIAS_VALIDAS.includes(valor as CategoriaOcupacional)) {
    throw new ErrorValidacion(
      `categoria_ocupacional invalida. Valores permitidos: ${CATEGORIAS_VALIDAS.join(", ")}`
    );
  }
  return valor as CategoriaOcupacional;
}

export function validarSistemaPension(valor: unknown): SistemaPension {
  if (typeof valor !== "string" || !SISTEMAS_PENSION_VALIDOS.includes(valor as SistemaPension)) {
    throw new ErrorValidacion("sistema_pension debe ser 'AFP' o 'ONP'");
  }
  return valor as SistemaPension;
}

export function validarFecha(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || isNaN(Date.parse(valor))) {
    throw new ErrorValidacion(`${campo} debe ser una fecha valida (YYYY-MM-DD)`);
  }
  return valor;
}

const SEXOS_VALIDOS = ["M", "F"];
const ESTADOS_CIVILES_VALIDOS = ["SOLTERO", "CASADO", "VIUDO", "DIVORCIADO", "CONVIVIENTE"];

// Los siguientes validan valores opcionales del alta de trabajador
// (T-Registro): si no vienen, se guarda NULL. Si vienen, deben ser uno de
// los valores permitidos por el CHECK correspondiente en la base de datos
// - se valida aca tambien para devolver un mensaje 400 claro en vez de que
// el error crudo de Postgres llegue al usuario.
export function validarSexo(valor: unknown): string | null {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor !== "string" || !SEXOS_VALIDOS.includes(valor)) {
    throw new ErrorValidacion(`sexo invalido. Valores permitidos: ${SEXOS_VALIDOS.join(", ")}`);
  }
  return valor;
}

export function validarEstadoCivil(valor: unknown): string | null {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor !== "string" || !ESTADOS_CIVILES_VALIDOS.includes(valor)) {
    throw new ErrorValidacion(
      `estado_civil invalido. Valores permitidos: ${ESTADOS_CIVILES_VALIDOS.join(", ")}`
    );
  }
  return valor;
}

// Los codigos de catalogo (T3, T4, T8, T11, T12, etc.) llegan del
// desplegable del frontend, ya validados visualmente contra la lista
// oficial - aca solo se normaliza vacio/undefined a NULL. La existencia
// real del codigo la garantiza la FK en la base de datos (ver
// mensajeErrorCatalogo mas abajo para el mensaje amigable si de todas
// formas llega un codigo que no existe, ej. por un catalogo desactualizado
// en el navegador del usuario).
export function codigoOpcional(valor: unknown): string | null {
  if (valor === undefined || valor === null || valor === "") return null;
  return String(valor);
}

// Traduce los errores de Postgres mas comunes al guardar campos con
// catalogo (FK inexistente = 23503, CHECK violado = 23503/23514) a un
// mensaje legible. Devuelve null si el error no es de este tipo (para que
// el caller lo relance tal cual).
export function mensajeErrorCatalogo(err: unknown): string | null {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code === "23503") {
    return `El codigo de catalogo enviado no existe (restriccion: ${e.constraint ?? "clave foranea"}). Puede que el desplegable este desactualizado - recargue la pagina.`;
  }
  if (e.code === "23514") {
    return `Un valor enviado no cumple el formato esperado (restriccion: ${e.constraint ?? "check"}).`;
  }
  return null;
}

export function validarMontoPositivo(valor: unknown, campo: string): number {
  const n = Number(valor);
  if (Number.isNaN(n) || n < 0) {
    throw new ErrorValidacion(`${campo} debe ser un numero mayor o igual a 0`);
  }
  return n;
}

export function validarAsistenciaEntrada(valor: unknown): AsistenciaEntrada {
  if (typeof valor !== "object" || valor === null) {
    throw new ErrorValidacion("Cada entrada de asistencia debe ser un objeto");
  }
  const v = valor as Record<string, unknown>;
  const contrato_id = Number(v.contrato_id);
  if (!Number.isInteger(contrato_id) || contrato_id <= 0) {
    throw new ErrorValidacion("contrato_id invalido en la entrada de asistencia");
  }
  return {
    contrato_id,
    dias_trabajados: validarMontoPositivo(v.dias_trabajados ?? 0, "dias_trabajados"),
    dias_dominical: validarMontoPositivo(v.dias_dominical ?? 0, "dias_dominical"),
    dias_feriado: validarMontoPositivo(v.dias_feriado ?? 0, "dias_feriado"),
    dias_falta: validarMontoPositivo(v.dias_falta ?? 0, "dias_falta"),
    horas_extra_25: validarMontoPositivo(v.horas_extra_25 ?? 0, "horas_extra_25"),
    horas_extra_35: validarMontoPositivo(v.horas_extra_35 ?? 0, "horas_extra_35"),
    horas_extra_100: validarMontoPositivo(v.horas_extra_100 ?? 0, "horas_extra_100"),
  };
}

export function validarListaAsistencia(valor: unknown): AsistenciaEntrada[] {
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new ErrorValidacion("Se requiere un arreglo 'asistencias' con al menos un registro");
  }
  return valor.map(validarAsistenciaEntrada);
}
