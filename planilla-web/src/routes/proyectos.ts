import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requiereRol } from "../authMiddleware";
import { pool } from "../db";
import { ErrorValidacion } from "../validaciones";

export const proyectosRouter = Router();

proyectosRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query("SELECT * FROM proyectos ORDER BY nombre ASC");
    res.json(r.rows);
  })
);

proyectosRouter.post(
  "/",
  requiereRol("ADMIN"),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const b = req.body;
      if (!b.nombre?.trim()) throw new ErrorValidacion("nombre es obligatorio");
      const r = await pool.query(
        "INSERT INTO proyectos (nombre, ubicacion, cuota_sindical_semanal) VALUES ($1, $2, $3) RETURNING *",
        [b.nombre.trim(), b.ubicacion ?? null, b.cuota_sindical_semanal ?? 0]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      if (err instanceof ErrorValidacion) {
        return res.status(400).json({ error: err.message });
      }
      if ((err as { code?: string }).code === "23505") {
        return res.status(409).json({ error: "Ya existe un proyecto con ese nombre" });
      }
      throw err;
    }
  })
);

proyectosRouter.put(
  "/:id",
  requiereRol("ADMIN"),
  asyncHandler(async (req: Request, res: Response) => {
    const b = req.body;
    const r = await pool.query(
      "UPDATE proyectos SET nombre = $1, ubicacion = $2, estado = $3, cuota_sindical_semanal = $4 WHERE id = $5 RETURNING *",
      [b.nombre, b.ubicacion ?? null, b.estado ?? "ACTIVO", b.cuota_sindical_semanal ?? 0, req.params.id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Proyecto no encontrado" });
    }
    res.json(r.rows[0]);
  })
);
