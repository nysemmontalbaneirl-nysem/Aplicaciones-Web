// Utilidades puras de vigencia de contrato (interseccion entre el rango
// fecha_ingreso..fecha_cese de un contrato y un rango de fechas cualquiera:
// un periodo de planilla, un tramo de mes, etc).
//
// Migracion 048 (reconstruida desde backend_dist de produccion, ver
// RECONSTRUCCION_BRECHAS.md): este modulo no existia como archivo propio en
// este arbol - "fechaFueraDeVigencia" se habia reconstruido antes (parche
// #44/46) como una funcion local dentro de routes/planilla.ts, sin este
// modulo compartido ni traslapaVigencia/rangoVigenciaEnPeriodo, que hacian
// falta para el catalogo de feriados (obtenerFeriadosVigentes) y el
// prorrateo del dominical.

function soloFecha(fecha: string | Date): string {
  if (fecha instanceof Date) return fecha.toISOString().slice(0, 10);
  return String(fecha ?? "").slice(0, 10);
}

/**
 * true si el contrato (fechaIngreso..fechaCese, fechaCese null = sigue
 * vigente) tiene algun dia en comun con [periodoInicio, periodoFin].
 */
export function traslapaVigencia(
  fechaIngreso: string | Date,
  fechaCese: string | Date | null,
  periodoInicio: string | Date,
  periodoFin: string | Date
): boolean {
  const ingreso = soloFecha(fechaIngreso);
  const inicio = soloFecha(periodoInicio);
  const fin = soloFecha(periodoFin);
  if (ingreso > fin) return false;
  if (fechaCese) {
    const cese = soloFecha(fechaCese);
    if (cese < inicio) return false;
  }
  return true;
}

export interface RangoVigencia {
  desde: string;
  hasta: string;
}

/**
 * Rango exacto de dias validos dentro del periodo (interseccion entre la
 * vigencia del contrato y el periodo), o null si no hay ningun traslape.
 */
export function rangoVigenciaEnPeriodo(
  fechaIngreso: string | Date,
  fechaCese: string | Date | null,
  periodoInicio: string | Date,
  periodoFin: string | Date
): RangoVigencia | null {
  if (!traslapaVigencia(fechaIngreso, fechaCese, periodoInicio, periodoFin)) return null;
  const ingreso = soloFecha(fechaIngreso);
  const inicio = soloFecha(periodoInicio);
  const fin = soloFecha(periodoFin);
  const desde = ingreso > inicio ? ingreso : inicio;
  const cese = fechaCese ? soloFecha(fechaCese) : null;
  const hasta = cese && cese < fin ? cese : fin;
  return { desde, hasta };
}

/**
 * true si una fecha puntual cae fuera del rango de vigencia del contrato
 * (es decir, antes de fecha_ingreso o despues de fecha_cese) - usado para
 * rechazar/avisar dia por dia en el Tareo Diario.
 */
export function fechaFueraDeVigencia(
  fecha: string | Date,
  fechaIngreso: string | Date,
  fechaCese: string | Date | null
): boolean {
  const f = soloFecha(fecha);
  if (f < soloFecha(fechaIngreso)) return true;
  if (fechaCese && f > soloFecha(fechaCese)) return true;
  return false;
}
