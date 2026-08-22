import { Router, Request, Response } from "express";
import { pool } from "../db";
import { ErrorValidacion } from "../validaciones";

export const periodosRouter = Router();

periodosRouter.get("/", async (_req: Request, res: Response) => {
  const resultado = await pool.query(
    "SELECT * FROM periodos_planilla ORDER BY anio DESC, mes DESC, quincena NULLS FIRST"
  );
  res.json(resultado.rows);
});

periodosRouter.post("/", async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!b.anio || !b.mes || !b.fecha_inicio || !b.fecha_fin) {
      throw new ErrorValidacion("anio, mes, fecha_inicio y fecha_fin son obligatorios");
    }
    const resultado = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        b.anio,
        b.mes,
        b.quincena ?? null,
        b.tipo ?? "MENSUAL",
        b.fecha_inicio,
        b.fecha_fin,
        b.dias_periodo ?? 30,
      ]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    if ((err as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "Ya existe un periodo con ese anio/mes/quincena/tipo" });
    }
    throw err;
  }
});

// Solo se puede eliminar un periodo que todavia no tiene planilla calculada,
// para no perder resultados ya generados.
periodosRouter.delete("/:id", async (req: Request, res: Response) => {
  const resultado = await pool.query(
    "DELETE FROM periodos_planilla WHERE id = $1 AND estado = 'ABIERTO' RETURNING id",
    [req.params.id]
  );
  if (resultado.rowCount === 0) {
    return res.status(400).json({
      error: "Solo se puede eliminar un periodo en estado ABIERTO (sin planilla calculada), o no existe",
    });
  }
  res.status(204).send();
});
