import { Router, Request, Response } from "express";
import { pool } from "../db";
import { ErrorValidacion } from "../validaciones";

export const parametrosRouter = Router();

parametrosRouter.get("/", async (_req: Request, res: Response) => {
  const resultado = await pool.query(
    "SELECT * FROM parametros_normativos ORDER BY anio DESC"
  );
  res.json(resultado.rows);
});

parametrosRouter.get("/:anio", async (req: Request, res: Response) => {
  const resultado = await pool.query(
    "SELECT * FROM parametros_normativos WHERE anio = $1",
    [req.params.anio]
  );
  if (resultado.rowCount === 0) {
    return res.status(404).json({ error: `No hay parametros configurados para el anio ${req.params.anio}` });
  }
  res.json(resultado.rows[0]);
});

// Crea el registro de un anio nuevo, opcionalmente copiando los valores de otro anio como base
parametrosRouter.post("/", async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!b.anio) throw new ErrorValidacion("anio es obligatorio");

    if (b.copiar_de_anio) {
      const base = await pool.query("SELECT * FROM parametros_normativos WHERE anio = $1", [
        b.copiar_de_anio,
      ]);
      if (base.rowCount === 0) {
        throw new ErrorValidacion(`No existe el anio base ${b.copiar_de_anio} para copiar`);
      }
      const p = base.rows[0];
      const resultado = await pool.query(
        `INSERT INTO parametros_normativos
          (anio, uit, tasa_essalud, tasa_onp, tasa_senati, tasa_conafovicer, tasa_sctr_salud,
           asignacion_familiar, seguro_vida_ley, afp_tasas, tabla_categorias)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          b.anio, p.uit, p.tasa_essalud, p.tasa_onp, p.tasa_senati, p.tasa_conafovicer,
          p.tasa_sctr_salud, p.asignacion_familiar, p.seguro_vida_ley, p.afp_tasas, p.tabla_categorias,
        ]
      );
      return res.status(201).json(resultado.rows[0]);
    }

    const resultado = await pool.query(
      `INSERT INTO parametros_normativos
        (anio, uit, tasa_essalud, tasa_onp, tasa_senati, tasa_conafovicer, tasa_sctr_salud,
         asignacion_familiar, seguro_vida_ley, afp_tasas, tabla_categorias)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        b.anio,
        b.uit ?? 0,
        b.tasa_essalud ?? 0.09,
        b.tasa_onp ?? 0.13,
        b.tasa_senati ?? 0.0075,
        b.tasa_conafovicer ?? 0.02,
        b.tasa_sctr_salud ?? 0.0155,
        b.asignacion_familiar ?? 0,
        b.seguro_vida_ley ?? 5,
        JSON.stringify(b.afp_tasas ?? {}),
        JSON.stringify(b.tabla_categorias ?? {}),
      ]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    if ((err as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "Ya existen parametros configurados para ese anio" });
    }
    throw err;
  }
});

parametrosRouter.put("/:anio", async (req: Request, res: Response) => {
  const b = req.body;
  const resultado = await pool.query(
    `UPDATE parametros_normativos SET
      uit = $1, tasa_essalud = $2, tasa_onp = $3, tasa_senati = $4, tasa_conafovicer = $5,
      tasa_sctr_salud = $6, asignacion_familiar = $7, seguro_vida_ley = $8,
      afp_tasas = $9, tabla_categorias = $10
     WHERE anio = $11
     RETURNING *`,
    [
      b.uit,
      b.tasa_essalud,
      b.tasa_onp,
      b.tasa_senati,
      b.tasa_conafovicer,
      b.tasa_sctr_salud,
      b.asignacion_familiar,
      b.seguro_vida_ley,
      JSON.stringify(b.afp_tasas ?? {}),
      JSON.stringify(b.tabla_categorias ?? {}),
      req.params.anio,
    ]
  );
  if (resultado.rowCount === 0) {
    return res.status(404).json({ error: `No hay parametros configurados para el anio ${req.params.anio}` });
  }
  res.json(resultado.rows[0]);
});
