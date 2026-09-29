import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { ErrorValidacion, mensajeErrorCatalogo } from "../validaciones";

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
  requierePermiso("proyectos.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const b = req.body;
      if (!b.nombre?.trim()) throw new ErrorValidacion("nombre es obligatorio");
      const r = await pool.query(
        `INSERT INTO proyectos (
          nombre, ubicacion, cuota_sindical_semanal, codigo_establecimiento, tipo_establecimiento,
          ubigeo_departamento_codigo, ubigeo_provincia_codigo, ubigeo_distrito_codigo
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          b.nombre.trim(),
          b.ubicacion ?? null,
          b.cuota_sindical_semanal ?? 0,
          b.codigo_establecimiento ?? "0000",
          b.tipo_establecimiento ?? "ESTABLECIMIENTO ANEXO",
          b.ubigeo_departamento_codigo || null,
          b.ubigeo_provincia_codigo || null,
          b.ubigeo_distrito_codigo || null,
        ]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      if (err instanceof ErrorValidacion) {
        return res.status(400).json({ error: err.message });
      }
      if ((err as { code?: string }).code === "23505") {
        return res.status(409).json({ error: "Ya existe un proyecto con ese nombre" });
      }
      const mensajeCatalogo = mensajeErrorCatalogo(err);
      if (mensajeCatalogo) {
        return res.status(400).json({ error: mensajeCatalogo });
      }
      throw err;
    }
  })
);

proyectosRouter.put(
  "/:id",
  requierePermiso("proyectos.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const b = req.body;
      const r = await pool.query(
        `UPDATE proyectos SET
          nombre = $1, ubicacion = $2, estado = $3, cuota_sindical_semanal = $4,
          codigo_establecimiento = $5, tipo_establecimiento = $6,
          ubigeo_departamento_codigo = $7, ubigeo_provincia_codigo = $8, ubigeo_distrito_codigo = $9
         WHERE id = $10
         RETURNING *`,
        [
          b.nombre,
          b.ubicacion ?? null,
          b.estado ?? "ACTIVO",
          b.cuota_sindical_semanal ?? 0,
          b.codigo_establecimiento ?? "0000",
          b.tipo_establecimiento ?? "ESTABLECIMIENTO ANEXO",
          b.ubigeo_departamento_codigo || null,
          b.ubigeo_provincia_codigo || null,
          b.ubigeo_distrito_codigo || null,
          req.params.id,
        ]
      );
      if (r.rowCount === 0) {
        return res.status(404).json({ error: "Proyecto no encontrado" });
      }
      res.json(r.rows[0]);
    } catch (err) {
      const mensajeCatalogo = mensajeErrorCatalogo(err);
      if (mensajeCatalogo) {
        return res.status(400).json({ error: mensajeCatalogo });
      }
      throw err;
    }
  })
);
