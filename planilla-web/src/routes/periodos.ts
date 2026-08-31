import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { ErrorValidacion } from "../validaciones";
import { registrarBitacora } from "../bitacora";

export const periodosRouter = Router();

periodosRouter.get("/", asyncHandler(async (_req: Request, res: Response) => {
  const resultado = await pool.query(
    "SELECT * FROM periodos_planilla ORDER BY anio DESC, mes DESC, quincena NULLS FIRST"
  );
  res.json(resultado.rows);
}));

// Crear/eliminar un periodo afecta a TODOS los proyectos (un periodo no es
// especifico de una obra) - por eso, a diferencia de tareo/contratos, aqui
// no aplica tieneAccesoProyecto, solo el rol. Bug real corregido: estas dos
// rutas no tenian NINGUN control de rol antes (cualquier usuario logueado,
// incluido un Tareador, podia crear o borrar periodos de planilla).
periodosRouter.post("/", requierePermiso("periodos.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!b.anio || !b.mes || !b.fecha_inicio || !b.fecha_fin) {
      throw new ErrorValidacion("anio, mes, fecha_inicio y fecha_fin son obligatorios");
    }
    // dias_periodo se calcula SIEMPRE en el servidor a partir de las fechas
    // reales (fecha_fin - fecha_inicio + 1, dias calendario inclusive), sin
    // importar lo que mande el cliente. Bug real corregido: antes se
    // guardaba fijo en 30 (tanto en el frontend como el default del
    // backend), lo que hacia mal el prorrateo de sueldo de Empleados y la
    // asignacion familiar en cualquier mes de 28, 29 o 31 dias.
    const resultado = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo)
       VALUES ($1,$2,$3,$4,$5,$6, ($6::date - $5::date + 1))
       RETURNING *`,
      [
        b.anio,
        b.mes,
        b.quincena ?? null,
        b.tipo ?? "MENSUAL",
        b.fecha_inicio,
        b.fecha_fin,
      ]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    if ((err as { code?: string }).code === "23505") {
      // Cubre dos indices unicos distintos: el de anio/mes/tipo/quincena
      // (MENSUAL y QUINCENAL) y el indice parcial por fechas para SEMANAL
      // (migracion_018) - el mensaje se deja generico para ambos casos.
      return res.status(409).json({ error: "Ya existe un periodo con esas mismas fechas/anio/mes/quincena/tipo" });
    }
    throw err;
  }
}));

// Solo se puede eliminar un periodo que todavia no tiene planilla calculada,
// para no perder resultados ya generados.
periodosRouter.delete("/:id", requierePermiso("periodos.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  const resultado = await pool.query(
    "DELETE FROM periodos_planilla WHERE id = $1 AND estado = 'ABIERTO' RETURNING id",
    [req.params.id]
  );
  if (resultado.rowCount === 0) {
    return res.status(400).json({
      error: "Solo se puede eliminar un periodo en estado ABIERTO (sin planilla calculada), o no existe",
    });
  }
  await registrarBitacora(req.usuario!.id, "ELIMINAR_PERIODO", "periodos_planilla", Number(req.params.id), {});
  res.status(204).send();
}));
