import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { pool } from "../db";
import {
  ErrorValidacion,
  validarApellidosNombres,
  validarNumeroDocumento,
} from "../validaciones";

export const empleadosRouter = Router();

empleadosRouter.get("/", asyncHandler(async (_req: Request, res: Response) => {
  const resultado = await pool.query(
    "SELECT * FROM empleados ORDER BY apellidos_nombres ASC"
  );
  res.json(resultado.rows);
}));

empleadosRouter.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const resultado = await pool.query("SELECT * FROM empleados WHERE id = $1", [
    req.params.id,
  ]);
  if (resultado.rowCount === 0) {
    return res.status(404).json({ error: "Empleado no encontrado" });
  }
  res.json(resultado.rows[0]);
}));

empleadosRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const numero_documento = validarNumeroDocumento(b.numero_documento);
    const apellidos_nombres = validarApellidosNombres(b.apellidos_nombres);

    const resultado = await pool.query(
      `INSERT INTO empleados
        (tipo_documento, numero_documento, apellidos_nombres, fecha_nacimiento,
         grado_instruccion, numero_hijos, celular, correo, direccion, ubigeo,
         entidad_bancaria, cuenta_bancaria)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        b.tipo_documento ?? "1",
        numero_documento,
        apellidos_nombres,
        b.fecha_nacimiento ?? null,
        b.grado_instruccion ?? null,
        b.numero_hijos ?? 0,
        b.celular ?? null,
        b.correo ?? null,
        b.direccion ?? null,
        b.ubigeo ?? null,
        b.entidad_bancaria ?? null,
        b.cuenta_bancaria ?? null,
      ]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    if ((err as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "Ya existe un empleado con ese numero_documento" });
    }
    throw err;
  }
}));

empleadosRouter.put("/:id", asyncHandler(async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const apellidos_nombres = validarApellidosNombres(b.apellidos_nombres);

    const resultado = await pool.query(
      `UPDATE empleados SET
        apellidos_nombres = $1, fecha_nacimiento = $2, grado_instruccion = $3,
        numero_hijos = $4, celular = $5, correo = $6, direccion = $7, ubigeo = $8,
        entidad_bancaria = $9, cuenta_bancaria = $10, estado = $11, actualizado_en = now()
       WHERE id = $12
       RETURNING *`,
      [
        apellidos_nombres,
        b.fecha_nacimiento ?? null,
        b.grado_instruccion ?? null,
        b.numero_hijos ?? 0,
        b.celular ?? null,
        b.correo ?? null,
        b.direccion ?? null,
        b.ubigeo ?? null,
        b.entidad_bancaria ?? null,
        b.cuenta_bancaria ?? null,
        b.estado ?? "ACTIVO",
        req.params.id,
      ]
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }
    res.json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
}));
