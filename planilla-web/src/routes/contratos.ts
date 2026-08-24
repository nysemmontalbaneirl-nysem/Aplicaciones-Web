import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { pool } from "../db";
import {
  ErrorValidacion,
  validarCategoriaOcupacional,
  validarFecha,
  validarSistemaPension,
} from "../validaciones";

export const contratosRouter = Router();

contratosRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const { empleado_id, estado } = req.query;
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (empleado_id) {
    valores.push(empleado_id);
    condiciones.push(`c.empleado_id = $${valores.length}`);
  }
  if (estado) {
    valores.push(estado);
    condiciones.push(`c.estado = $${valores.length}`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const resultado = await pool.query(
    `SELECT c.*, e.apellidos_nombres, e.numero_documento
     FROM contratos c JOIN empleados e ON e.id = c.empleado_id
     ${where}
     ORDER BY c.fecha_ingreso DESC`,
    valores
  );
  res.json(resultado.rows);
}));

contratosRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const categoria_ocupacional = validarCategoriaOcupacional(b.categoria_ocupacional);
    const sistema_pension = validarSistemaPension(b.sistema_pension);
    const fecha_ingreso = validarFecha(b.fecha_ingreso, "fecha_ingreso");

    if (!b.empleado_id) {
      throw new ErrorValidacion("empleado_id es obligatorio");
    }
    if (sistema_pension === "AFP" && !b.afp_nombre) {
      throw new ErrorValidacion("afp_nombre es obligatorio cuando sistema_pension = AFP");
    }
    if (categoria_ocupacional === "EMPLEADO" && !b.sueldo_base) {
      throw new ErrorValidacion("sueldo_base es obligatorio para la categoria EMPLEADO");
    }

    const resultado = await pool.query(
      `INSERT INTO contratos
        (empleado_id, proyecto, grupo, categoria_ocupacional, ocupacion, sistema_pension,
         afp_nombre, cuspp, sistema_comision, fecha_ingreso, sueldo_base, viaticos,
         sindicalizado, poliza_seguro, sctr_salud, essalud_vida, domiciliado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        b.empleado_id,
        b.proyecto ?? "",
        b.grupo ?? null,
        categoria_ocupacional,
        b.ocupacion ?? null,
        sistema_pension,
        b.afp_nombre ?? null,
        b.cuspp ?? null,
        b.sistema_comision ?? null,
        fecha_ingreso,
        b.sueldo_base ?? null,
        b.viaticos ?? 0,
        b.sindicalizado ?? false,
        b.poliza_seguro ?? false,
        b.sctr_salud ?? false,
        b.essalud_vida ?? false,
        b.domiciliado ?? true,
      ]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
}));

contratosRouter.put("/:id", asyncHandler(async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const categoria_ocupacional = validarCategoriaOcupacional(b.categoria_ocupacional);
    const sistema_pension = validarSistemaPension(b.sistema_pension);
    const fecha_ingreso = validarFecha(b.fecha_ingreso, "fecha_ingreso");

    if (sistema_pension === "AFP" && !b.afp_nombre) {
      throw new ErrorValidacion("afp_nombre es obligatorio cuando sistema_pension = AFP");
    }
    if (categoria_ocupacional === "EMPLEADO" && !b.sueldo_base) {
      throw new ErrorValidacion("sueldo_base es obligatorio para la categoria EMPLEADO");
    }

    const resultado = await pool.query(
      `UPDATE contratos SET
        proyecto = $1, grupo = $2, categoria_ocupacional = $3, ocupacion = $4,
        sistema_pension = $5, afp_nombre = $6, cuspp = $7, sistema_comision = $8,
        fecha_ingreso = $9, sueldo_base = $10, viaticos = $11, sindicalizado = $12,
        poliza_seguro = $13, sctr_salud = $14, essalud_vida = $15, domiciliado = $16
       WHERE id = $17
       RETURNING *`,
      [
        b.proyecto ?? "",
        b.grupo ?? null,
        categoria_ocupacional,
        b.ocupacion ?? null,
        sistema_pension,
        b.afp_nombre ?? null,
        b.cuspp ?? null,
        b.sistema_comision ?? null,
        fecha_ingreso,
        b.sueldo_base ?? null,
        b.viaticos ?? 0,
        b.sindicalizado ?? false,
        b.poliza_seguro ?? false,
        b.sctr_salud ?? false,
        b.essalud_vida ?? false,
        b.domiciliado ?? true,
        req.params.id,
      ]
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    res.json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
}));

contratosRouter.post("/:id/cese", asyncHandler(async (req: Request, res: Response) => {
  try {
    const fecha_cese = validarFecha(req.body.fecha_cese, "fecha_cese");
    const resultado = await pool.query(
      `UPDATE contratos SET fecha_cese = $1, estado = 'CESADO' WHERE id = $2 RETURNING *`,
      [fecha_cese, req.params.id]
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    res.json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
}));
