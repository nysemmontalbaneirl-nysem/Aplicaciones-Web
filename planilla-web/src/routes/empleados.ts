import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import {
  codigoOpcional,
  ErrorValidacion,
  mensajeErrorCatalogo,
  validarApellidosNombres,
  validarEstadoCivil,
  validarNumeroDocumento,
  validarSexo,
} from "../validaciones";

export const empleadosRouter = Router();

// entidad_bancaria, grado_instruccion y ubigeo (texto libre, historicos) se
// mantienen sincronizados automaticamente con el nombre oficial del
// catalogo cuando el formulario envia el *_codigo correspondiente - asi
// ningun reporte/exportacion que todavia lea el texto libre se queda con
// un dato desactualizado, y el usuario no tiene que digitar dos veces lo
// mismo. Si no se envia el codigo, el texto libre no se toca (se puede
// seguir editando a mano como antes).
async function resolverNombreCatalogo(tabla: string, codigo: string | null): Promise<string | null> {
  if (!codigo) return null;
  const r = await pool.query(`SELECT nombre FROM ${tabla} WHERE codigo = $1`, [codigo]);
  return r.rows[0]?.nombre ?? null;
}

async function componerUbigeoTexto(
  depCodigo: string | null,
  provCodigo: string | null,
  distCodigo: string | null
): Promise<string | null> {
  if (!depCodigo && !provCodigo && !distCodigo) return null;
  const partes: string[] = [];
  if (depCodigo) partes.push((await resolverNombreCatalogo("catalogo_ubigeo_departamento", depCodigo)) ?? depCodigo);
  if (provCodigo) partes.push((await resolverNombreCatalogo("catalogo_ubigeo_provincia", provCodigo)) ?? provCodigo);
  if (distCodigo) partes.push((await resolverNombreCatalogo("catalogo_ubigeo_distrito", distCodigo)) ?? distCodigo);
  return partes.join(" / ");
}

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

empleadosRouter.post("/", requierePermiso("empleados.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const numero_documento = validarNumeroDocumento(b.numero_documento);
    const apellidos_nombres = validarApellidosNombres(b.apellidos_nombres);
    const sexo = validarSexo(b.sexo);
    const estado_civil = validarEstadoCivil(b.estado_civil);
    const grado_instruccion_codigo = codigoOpcional(b.grado_instruccion_codigo);
    const entidad_bancaria_codigo = codigoOpcional(b.entidad_bancaria_codigo);
    const nacionalidad_codigo = codigoOpcional(b.nacionalidad_codigo) ?? "9589"; // PERU por defecto
    const pais_emisor_documento_codigo = codigoOpcional(b.pais_emisor_documento_codigo);
    const ubigeo_departamento_codigo = codigoOpcional(b.ubigeo_departamento_codigo);
    const ubigeo_provincia_codigo = codigoOpcional(b.ubigeo_provincia_codigo);
    const ubigeo_distrito_codigo = codigoOpcional(b.ubigeo_distrito_codigo);

    // El texto libre historico (grado_instruccion/entidad_bancaria/ubigeo)
    // se rellena a partir del catalogo si el formulario ya no lo manda,
    // para no perder el dato en pantallas/reportes que aun lo leen.
    const grado_instruccion = b.grado_instruccion ?? (await resolverNombreCatalogo("catalogo_grado_instruccion", grado_instruccion_codigo));
    const entidad_bancaria = b.entidad_bancaria ?? (await resolverNombreCatalogo("catalogo_banco", entidad_bancaria_codigo));
    const ubigeo = b.ubigeo ?? (await componerUbigeoTexto(ubigeo_departamento_codigo, ubigeo_provincia_codigo, ubigeo_distrito_codigo));

    const resultado = await pool.query(
      `INSERT INTO empleados
        (tipo_documento, numero_documento, apellidos_nombres, fecha_nacimiento,
         grado_instruccion, numero_hijos, celular, correo, direccion, ubigeo,
         entidad_bancaria, cuenta_bancaria,
         sexo, estado_civil, nacionalidad_codigo, pais_emisor_documento_codigo,
         grado_instruccion_codigo, entidad_bancaria_codigo, discapacidad,
         segunda_direccion, direccion_essalud,
         ubigeo_departamento_codigo, ubigeo_provincia_codigo, ubigeo_distrito_codigo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING *`,
      [
        b.tipo_documento ?? "1",
        numero_documento,
        apellidos_nombres,
        b.fecha_nacimiento ?? null,
        grado_instruccion ?? null,
        b.numero_hijos ?? 0,
        b.celular ?? null,
        b.correo ?? null,
        b.direccion ?? null,
        ubigeo ?? null,
        entidad_bancaria ?? null,
        b.cuenta_bancaria ?? null,
        sexo,
        estado_civil,
        nacionalidad_codigo,
        pais_emisor_documento_codigo,
        grado_instruccion_codigo,
        entidad_bancaria_codigo,
        b.discapacidad ?? false,
        b.segunda_direccion ?? null,
        b.direccion_essalud ?? null,
        ubigeo_departamento_codigo,
        ubigeo_provincia_codigo,
        ubigeo_distrito_codigo,
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
    const mensajeCatalogo = mensajeErrorCatalogo(err);
    if (mensajeCatalogo) {
      return res.status(400).json({ error: mensajeCatalogo });
    }
    throw err;
  }
}));

empleadosRouter.put("/:id", requierePermiso("empleados.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const apellidos_nombres = validarApellidosNombres(b.apellidos_nombres);
    const sexo = validarSexo(b.sexo);
    const estado_civil = validarEstadoCivil(b.estado_civil);
    const grado_instruccion_codigo = codigoOpcional(b.grado_instruccion_codigo);
    const entidad_bancaria_codigo = codigoOpcional(b.entidad_bancaria_codigo);
    const nacionalidad_codigo = codigoOpcional(b.nacionalidad_codigo) ?? "9589";
    const pais_emisor_documento_codigo = codigoOpcional(b.pais_emisor_documento_codigo);
    const ubigeo_departamento_codigo = codigoOpcional(b.ubigeo_departamento_codigo);
    const ubigeo_provincia_codigo = codigoOpcional(b.ubigeo_provincia_codigo);
    const ubigeo_distrito_codigo = codigoOpcional(b.ubigeo_distrito_codigo);

    const grado_instruccion = b.grado_instruccion ?? (await resolverNombreCatalogo("catalogo_grado_instruccion", grado_instruccion_codigo));
    const entidad_bancaria = b.entidad_bancaria ?? (await resolverNombreCatalogo("catalogo_banco", entidad_bancaria_codigo));
    const ubigeo = b.ubigeo ?? (await componerUbigeoTexto(ubigeo_departamento_codigo, ubigeo_provincia_codigo, ubigeo_distrito_codigo));

    const resultado = await pool.query(
      `UPDATE empleados SET
        apellidos_nombres = $1, fecha_nacimiento = $2, grado_instruccion = $3,
        numero_hijos = $4, celular = $5, correo = $6, direccion = $7, ubigeo = $8,
        entidad_bancaria = $9, cuenta_bancaria = $10, estado = $11, actualizado_en = now(),
        sexo = $12, estado_civil = $13, nacionalidad_codigo = $14, pais_emisor_documento_codigo = $15,
        grado_instruccion_codigo = $16, entidad_bancaria_codigo = $17, discapacidad = $18,
        segunda_direccion = $19, direccion_essalud = $20,
        ubigeo_departamento_codigo = $21, ubigeo_provincia_codigo = $22, ubigeo_distrito_codigo = $23
       WHERE id = $24
       RETURNING *`,
      [
        apellidos_nombres,
        b.fecha_nacimiento ?? null,
        grado_instruccion ?? null,
        b.numero_hijos ?? 0,
        b.celular ?? null,
        b.correo ?? null,
        b.direccion ?? null,
        ubigeo ?? null,
        entidad_bancaria ?? null,
        b.cuenta_bancaria ?? null,
        b.estado ?? "ACTIVO",
        sexo,
        estado_civil,
        nacionalidad_codigo,
        pais_emisor_documento_codigo,
        grado_instruccion_codigo,
        entidad_bancaria_codigo,
        b.discapacidad ?? false,
        b.segunda_direccion ?? null,
        b.direccion_essalud ?? null,
        ubigeo_departamento_codigo,
        ubigeo_provincia_codigo,
        ubigeo_distrito_codigo,
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
    const mensajeCatalogo = mensajeErrorCatalogo(err);
    if (mensajeCatalogo) {
      return res.status(400).json({ error: mensajeCatalogo });
    }
    throw err;
  }
}));
