import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";

export const bitacoraRouter = Router();

// GET /api/bitacora?pagina=1&accion=X&usuario_id=X&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Solo ADMIN: la bitacora es informacion de auditoria interna.
bitacoraRouter.get(
  "/",
  requierePermiso("bitacora.ver"),
  asyncHandler(async (req: Request, res: Response) => {
    const porPagina = 50;
    const pagina = Math.max(1, Number(req.query.pagina) || 1);

    const condiciones: string[] = [];
    const valores: unknown[] = [];

    if (req.query.accion) {
      valores.push(req.query.accion);
      condiciones.push(`b.accion = $${valores.length}`);
    }
    if (req.query.usuario_id) {
      valores.push(req.query.usuario_id);
      condiciones.push(`b.usuario_id = $${valores.length}`);
    }
    if (req.query.desde) {
      valores.push(req.query.desde);
      condiciones.push(`b.fecha >= $${valores.length}`);
    }
    if (req.query.hasta) {
      valores.push(req.query.hasta);
      condiciones.push(`b.fecha < ($${valores.length}::date + interval '1 day')`);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

    const total = await pool.query(`SELECT count(*) FROM bitacora_planilla b ${where}`, valores);

    valores.push(porPagina, (pagina - 1) * porPagina);
    const filas = await pool.query(
      `SELECT b.id, b.accion, b.tabla_afectada, b.registro_id, b.detalle, b.fecha,
              u.nombre AS usuario_nombre, u.correo AS usuario_correo
       FROM bitacora_planilla b
       LEFT JOIN usuarios u ON u.id = b.usuario_id
       ${where}
       ORDER BY b.fecha DESC
       LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
      valores
    );

    res.json({
      pagina,
      por_pagina: porPagina,
      total: Number(total.rows[0].count),
      registros: filas.rows,
    });
  })
);

// GET /api/bitacora/acciones -> lista de valores distintos de "accion" ya
// registrados, para armar el filtro en la pantalla sin hardcodearlos ahi.
bitacoraRouter.get(
  "/acciones",
  requierePermiso("bitacora.ver"),
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query(`SELECT DISTINCT accion FROM bitacora_planilla ORDER BY accion`);
    res.json(r.rows.map((f) => f.accion));
  })
);
