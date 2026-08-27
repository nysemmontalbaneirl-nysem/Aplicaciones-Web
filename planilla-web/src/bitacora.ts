// =========================================================================
// Bitacora de auditoria: quien hizo que accion sensible, y cuando.
// La tabla bitacora_planilla ya existia en el esquema desde el inicio del
// proyecto, pero ninguna ruta escribia en ella todavia - por eso hoy no
// quedaba registro de quien cambiaba una tasa, borraba un trabajador, o
// recalculaba un periodo ya cerrado. Este modulo centraliza el "como se
// escribe" para que cada ruta solo tenga que llamar a registrarBitacora().
// =========================================================================

import { pool } from "./db";

export async function registrarBitacora(
  usuarioId: number | undefined,
  accion: string,
  tablaAfectada: string,
  registroId: number | null,
  detalle: Record<string, unknown>
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO bitacora_planilla (usuario_id, accion, tabla_afectada, registro_id, detalle)
       VALUES ($1, $2, $3, $4, $5)`,
      [usuarioId ?? null, accion, tablaAfectada, registroId, JSON.stringify(detalle)]
    );
  } catch (err) {
    // La bitacora es un registro complementario: si por algun motivo falla
    // (ej. un problema pasajero de conexion), no debe tumbar la accion real
    // que el usuario esta tratando de hacer. Se deja constancia en el log
    // del servidor para poder investigar despues.
    console.error("No se pudo escribir en la bitacora de auditoria:", err);
  }
}
