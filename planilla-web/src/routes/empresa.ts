import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";

export const empresaRouter = Router();

empresaRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query("SELECT * FROM datos_empresa ORDER BY id LIMIT 1");
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "No hay datos de la empresa configurados todavia" });
    }
    res.json(r.rows[0]);
  })
);

empresaRouter.put(
  "/",
  requierePermiso("empresa.editar"),
  asyncHandler(async (req: Request, res: Response) => {
    const b = req.body;
    const existente = await pool.query("SELECT id FROM datos_empresa ORDER BY id LIMIT 1");

    const columnas = [
      "ruc",
      "razon_social",
      "nombre_comercial",
      "domicilio_fiscal",
      "ubigeo",
      "actividad_economica",
      "tipo_empresa",
      "regimen_laboral",
      "representante_legal",
      "telefono",
      "correo",
    ] as const;
    const valores = columnas.map((c) => b[c] ?? null);

    if (existente.rowCount === 0) {
      const r = await pool.query(
        `INSERT INTO datos_empresa (${columnas.join(", ")}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
        valores
      );
      return res.json(r.rows[0]);
    }

    const r = await pool.query(
      `UPDATE datos_empresa SET ${columnas.map((c, i) => `${c} = $${i + 1}`).join(", ")}, actualizado_en = now()
       WHERE id = $${columnas.length + 1} RETURNING *`,
      [...valores, existente.rows[0].id]
    );
    res.json(r.rows[0]);
  })
);
