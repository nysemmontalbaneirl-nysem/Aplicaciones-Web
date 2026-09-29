import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { uploadImagen, manejarErrorMulterImagen } from "./imagenesUpload";

export const empresaRouter = Router();

// Columnas de datos_empresa SIN el logo_archivo (BYTEA) - se usa en el GET
// general para no mandar la imagen completa (podria ser pesada) cada vez
// que se carga la pantalla "Empresa"/cualquier lugar que solo necesita los
// datos de texto. "tiene_logo" (booleano) es lo unico que se agrega sobre
// el logo, igual criterio que "tiene_certificado" en tareo_diario.
const COLUMNAS_EMPRESA_SIN_LOGO = `
  id, ruc, razon_social, nombre_comercial, domicilio_fiscal, ubigeo,
  actividad_economica, tipo_empresa, regimen_laboral, representante_legal,
  telefono, correo, actualizado_en,
  logo_mime, logo_nombre, (logo_archivo IS NOT NULL) AS tiene_logo
`;

empresaRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query(`SELECT ${COLUMNAS_EMPRESA_SIN_LOGO} FROM datos_empresa ORDER BY id LIMIT 1`);
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "No hay datos de la empresa configurados todavia" });
    }
    res.json(r.rows[0]);
  })
);

// Trae el logo (buffer + mime) del unico registro de datos_empresa, o null
// si todavia no se configuro ninguno - se reutiliza desde boletaPdf
// (envios.ts, routes/planilla.ts) y desde los reportes Excel (reportes.ts,
// exportaciones.ts) para no repetir esta consulta en cada lugar.
export async function obtenerLogoEmpresa(): Promise<{ buffer: Buffer; mime: string } | null> {
  const r = await pool.query(
    "SELECT logo_archivo, logo_mime FROM datos_empresa WHERE logo_archivo IS NOT NULL ORDER BY id LIMIT 1"
  );
  if (r.rowCount === 0) return null;
  return { buffer: r.rows[0].logo_archivo as Buffer, mime: r.rows[0].logo_mime as string };
}

// POST /api/empresa/logo (multipart, campo "archivo") - sube/reemplaza el
// logo. Requiere que ya exista el registro de datos_empresa (se crea al
// guardar el formulario por primera vez, PUT /) - igual que el certificado
// de Tareo Diario, que exige guardar el dia antes de poder adjuntar la foto.
empresaRouter.post(
  "/logo",
  requierePermiso("empresa.editar"),
  uploadImagen.single("archivo"),
  manejarErrorMulterImagen,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({
        error: "Falta la imagen o el formato no es válido (debe ser JPG, PNG o WEBP)",
      });
    }
    const existente = await pool.query("SELECT id FROM datos_empresa ORDER BY id LIMIT 1");
    if (existente.rowCount === 0) {
      return res.status(400).json({
        error: "Primero guarda los datos de la empresa (formulario de arriba) antes de subir el logo",
      });
    }
    await pool.query(
      `UPDATE datos_empresa
       SET logo_archivo = $1, logo_mime = $2, logo_nombre = $3, actualizado_en = now()
       WHERE id = $4`,
      [req.file.buffer, req.file.mimetype, req.file.originalname.slice(0, 200), existente.rows[0].id]
    );
    res.status(204).send();
  })
);

// GET /api/empresa/logo -> la imagen misma (no JSON), para <img src=...> en
// la Boleta y en la pantalla Empresa. Acepta el token por query (?token=,
// ver authMiddleware) porque un <img> normal no puede mandar el header
// Authorization.
empresaRouter.get(
  "/logo",
  asyncHandler(async (_req: Request, res: Response) => {
    const logo = await obtenerLogoEmpresa();
    if (!logo) {
      return res.status(404).json({ error: "No hay logo configurado todavia" });
    }
    res.setHeader("Content-Type", logo.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", 'inline; filename="logo"');
    res.send(logo.buffer);
  })
);

// DELETE /api/empresa/logo -> quita el logo guardado (para poder subir otro).
empresaRouter.delete(
  "/logo",
  requierePermiso("empresa.editar"),
  asyncHandler(async (_req: Request, res: Response) => {
    const resultado = await pool.query(
      `UPDATE datos_empresa
       SET logo_archivo = NULL, logo_mime = NULL, logo_nombre = NULL, actualizado_en = now()
       WHERE logo_archivo IS NOT NULL
       RETURNING id`
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: "No hay logo guardado" });
    }
    res.status(204).send();
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

    // RETURNING de la lista explicita SIN logo_archivo (en vez de "*"): el
    // logo se administra por su propia ruta (POST/GET/DELETE /logo, arriba)
    // y no debe viajar entero cada vez que se guarda este formulario.
    if (existente.rowCount === 0) {
      const r = await pool.query(
        `INSERT INTO datos_empresa (${columnas.join(", ")})
         VALUES (${columnas.map((_, i) => `$${i + 1}`).join(", ")})
         RETURNING id, ${columnas.join(", ")}, actualizado_en, logo_mime, logo_nombre, (logo_archivo IS NOT NULL) AS tiene_logo`,
        valores
      );
      return res.json(r.rows[0]);
    }

    const r = await pool.query(
      `UPDATE datos_empresa SET ${columnas.map((c, i) => `${c} = $${i + 1}`).join(", ")}, actualizado_en = now()
       WHERE id = $${columnas.length + 1}
       RETURNING id, ${columnas.join(", ")}, actualizado_en, logo_mime, logo_nombre, (logo_archivo IS NOT NULL) AS tiene_logo`,
      [...valores, existente.rows[0].id]
    );
    res.json(r.rows[0]);
  })
);
