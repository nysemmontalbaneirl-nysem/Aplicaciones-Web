import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { pool } from "../db";
import { ErrorValidacion } from "../validaciones";

export const parametrosRouter = Router();

// ==========================================================================
// Tasas AFP y tabla salarial: frecuencia MENSUAL.
// IMPORTANTE: estas rutas van ANTES de "/:anio" a proposito - de lo
// contrario Express interpretaria "mensual" como si fuera un valor de :anio.
// ==========================================================================

// Lista los periodos (anio,mes) que ya tienen tasas AFP/tabla salarial configuradas
parametrosRouter.get("/mensual", asyncHandler(async (_req: Request, res: Response) => {
  const resultado = await pool.query(
    `SELECT DISTINCT anio, mes FROM (
       SELECT anio, mes FROM tasas_afp_mensuales
       UNION
       SELECT anio, mes FROM tabla_salarial_mensual
     ) t
     ORDER BY anio DESC, mes DESC`
  );
  res.json(resultado.rows);
}));

// POST /api/parametros/mensual  body: { anio, mes, copiar_de_anio, copiar_de_mes }
// Crea un mes nuevo copiando las tasas AFP y tabla salarial de otro mes.
parametrosRouter.post("/mensual", asyncHandler(async (req: Request, res: Response) => {
  const { anio, mes, copiar_de_anio, copiar_de_mes } = req.body;
  if (!anio || !mes) {
    return res.status(400).json({ error: "anio y mes son obligatorios" });
  }
  if (!copiar_de_anio || !copiar_de_mes) {
    return res.status(400).json({ error: "copiar_de_anio y copiar_de_mes son obligatorios" });
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query(
      `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
       SELECT $1, $2, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio
       FROM tasas_afp_mensuales WHERE anio = $3 AND mes = $4
       ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`,
      [anio, mes, copiar_de_anio, copiar_de_mes]
    );
    await cliente.query(
      `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
       SELECT $1, $2, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria
       FROM tabla_salarial_mensual WHERE anio = $3 AND mes = $4
       ON CONFLICT (anio, mes, categoria) DO NOTHING`,
      [anio, mes, copiar_de_anio, copiar_de_mes]
    );
    await cliente.query("COMMIT");
    res.status(201).json({ anio, mes });
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
}));

// GET /api/parametros/mensual/:anio/:mes -> { afp_tasas: {...}, tabla_categorias: {...} }
parametrosRouter.get("/mensual/:anio/:mes", asyncHandler(async (req: Request, res: Response) => {
  const { anio, mes } = req.params;

  const afpResult = await pool.query(
    "SELECT afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio FROM tasas_afp_mensuales WHERE anio = $1 AND mes = $2",
    [anio, mes]
  );
  const salarialResult = await pool.query(
    "SELECT categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria FROM tabla_salarial_mensual WHERE anio = $1 AND mes = $2",
    [anio, mes]
  );

  const afp_tasas: Record<string, unknown> = {};
  for (const fila of afpResult.rows) {
    afp_tasas[fila.afp_nombre] = {
      comision_flujo: Number(fila.comision_flujo),
      prima_seguro: Number(fila.prima_seguro),
      aporte_obligatorio: Number(fila.aporte_obligatorio),
    };
  }
  const tabla_categorias: Record<string, unknown> = {};
  for (const fila of salarialResult.rows) {
    tabla_categorias[fila.categoria] = {
      jornal_basico: Number(fila.jornal_basico),
      buc: Number(fila.buc),
      bae: Number(fila.bae),
      movilidad_acumulada: Number(fila.movilidad_acumulada),
      gratificacion_diaria: Number(fila.gratificacion_diaria),
    };
  }

  res.json({ anio: Number(anio), mes: Number(mes), afp_tasas, tabla_categorias });
}));

// PUT /api/parametros/mensual/:anio/:mes  body: { afp_tasas: {...}, tabla_categorias: {...} }
// Upsert de cada AFP/categoria presente en el body (no borra las que no se mencionen).
parametrosRouter.put("/mensual/:anio/:mes", asyncHandler(async (req: Request, res: Response) => {
  const anio = Number(req.params.anio);
  const mes = Number(req.params.mes);
  const { afp_tasas, tabla_categorias } = req.body as {
    afp_tasas?: Record<string, { comision_flujo: number; prima_seguro: number; aporte_obligatorio: number }>;
    tabla_categorias?: Record<
      string,
      { jornal_basico: number; buc: number; bae: number; movilidad_acumulada: number; gratificacion_diaria: number }
    >;
  };

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    for (const [afpNombre, t] of Object.entries(afp_tasas ?? {})) {
      await cliente.query(
        `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (anio, mes, afp_nombre) DO UPDATE SET
           comision_flujo = EXCLUDED.comision_flujo,
           prima_seguro = EXCLUDED.prima_seguro,
           aporte_obligatorio = EXCLUDED.aporte_obligatorio`,
        [anio, mes, afpNombre, t.comision_flujo, t.prima_seguro, t.aporte_obligatorio]
      );
    }

    for (const [categoria, c] of Object.entries(tabla_categorias ?? {})) {
      await cliente.query(
        `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (anio, mes, categoria) DO UPDATE SET
           jornal_basico = EXCLUDED.jornal_basico,
           buc = EXCLUDED.buc,
           bae = EXCLUDED.bae,
           movilidad_acumulada = EXCLUDED.movilidad_acumulada,
           gratificacion_diaria = EXCLUDED.gratificacion_diaria`,
        [
          anio,
          mes,
          categoria,
          c.jornal_basico,
          c.buc,
          c.bae ?? 0,
          c.movilidad_acumulada ?? 0,
          c.gratificacion_diaria ?? 0,
        ]
      );
    }

    await cliente.query("COMMIT");
    res.json({ anio, mes, afp_tasas, tabla_categorias });
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
}));

// ==========================================================================
// Parametros ANUALES (UIT, RMV, ESSALUD, ONP, SENATI, CONAFOVICER, SCTR,
// asignacion familiar, seguro vida)
// ==========================================================================

parametrosRouter.get("/", asyncHandler(async (_req: Request, res: Response) => {
  const resultado = await pool.query(
    "SELECT * FROM parametros_normativos ORDER BY anio DESC"
  );
  res.json(resultado.rows);
}));

parametrosRouter.get("/:anio", asyncHandler(async (req: Request, res: Response) => {
  const resultado = await pool.query(
    "SELECT * FROM parametros_normativos WHERE anio = $1",
    [req.params.anio]
  );
  if (resultado.rowCount === 0) {
    return res.status(404).json({ error: `No hay parametros configurados para el anio ${req.params.anio}` });
  }
  res.json(resultado.rows[0]);
}));

// Crea el registro de un anio nuevo, opcionalmente copiando los valores de otro anio como base
parametrosRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
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
          (anio, uit, remuneracion_minima_vital, tasa_essalud, tasa_onp, tasa_senati,
           tasa_conafovicer, tasa_sctr_salud, asignacion_familiar, seguro_vida_ley)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          b.anio, p.uit, p.remuneracion_minima_vital, p.tasa_essalud, p.tasa_onp, p.tasa_senati,
          p.tasa_conafovicer, p.tasa_sctr_salud, p.asignacion_familiar, p.seguro_vida_ley,
        ]
      );
      return res.status(201).json(resultado.rows[0]);
    }

    const resultado = await pool.query(
      `INSERT INTO parametros_normativos
        (anio, uit, remuneracion_minima_vital, tasa_essalud, tasa_onp, tasa_senati,
         tasa_conafovicer, tasa_sctr_salud, asignacion_familiar, seguro_vida_ley)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        b.anio,
        b.uit ?? 0,
        b.remuneracion_minima_vital ?? 0,
        b.tasa_essalud ?? 0.09,
        b.tasa_onp ?? 0.13,
        b.tasa_senati ?? 0.0075,
        b.tasa_conafovicer ?? 0.02,
        b.tasa_sctr_salud ?? 0.0155,
        b.asignacion_familiar ?? 0,
        b.seguro_vida_ley ?? 5,
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
}));

parametrosRouter.put("/:anio", asyncHandler(async (req: Request, res: Response) => {
  const b = req.body;
  const resultado = await pool.query(
    `UPDATE parametros_normativos SET
      uit = $1, remuneracion_minima_vital = $2, tasa_essalud = $3, tasa_onp = $4,
      tasa_senati = $5, tasa_conafovicer = $6, tasa_sctr_salud = $7,
      asignacion_familiar = $8, seguro_vida_ley = $9
     WHERE anio = $10
     RETURNING *`,
    [
      b.uit,
      b.remuneracion_minima_vital,
      b.tasa_essalud,
      b.tasa_onp,
      b.tasa_senati,
      b.tasa_conafovicer,
      b.tasa_sctr_salud,
      b.asignacion_familiar,
      b.seguro_vida_ley,
      req.params.anio,
    ]
  );
  if (resultado.rowCount === 0) {
    return res.status(404).json({ error: `No hay parametros configurados para el anio ${req.params.anio}` });
  }
  res.json(resultado.rows[0]);
}));
