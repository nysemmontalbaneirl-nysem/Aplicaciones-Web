import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { uploadImagen, manejarErrorMulterImagen } from "./imagenesUpload";
import { DatosEmpresaBoleta } from "../boletaPdf";

export const empresaRouter = Router();

// Columnas de datos_empresa SIN los archivos BYTEA (logo_archivo,
// firma_empleador_archivo) - se usa en el GET general para no mandar las
// imagenes completas (podrian ser pesadas) cada vez que se carga la
// pantalla "Empresa"/cualquier lugar que solo necesita los datos de texto.
// "tiene_logo"/"tiene_firma_empleador" (booleanos) son lo unico que se
// agrega sobre esas 2 imagenes, igual criterio que "tiene_certificado" en
// tareo_diario.
const COLUMNAS_EMPRESA_SIN_ARCHIVOS = `
  id, ruc, razon_social, nombre_comercial, domicilio_fiscal, ubigeo,
  actividad_economica, tipo_empresa, regimen_laboral, representante_legal,
  telefono, correo, actualizado_en,
  logo_mime, logo_nombre, (logo_archivo IS NOT NULL) AS tiene_logo,
  firma_empleador_mime, firma_empleador_nombre,
  (firma_empleador_archivo IS NOT NULL) AS tiene_firma_empleador
`;

empresaRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query(`SELECT ${COLUMNAS_EMPRESA_SIN_ARCHIVOS} FROM datos_empresa ORDER BY id LIMIT 1`);
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "No hay datos de la empresa configurados todavia" });
    }
    res.json(r.rows[0]);
  })
);

// Trae el logo (buffer + mime) del unico registro de datos_empresa, o null
// si todavia no se configuro ninguno - se reutiliza desde los reportes
// Excel (reportes.ts, exportaciones.ts). Para la generacion de la Boleta
// (envios.ts, routes/planilla.ts) se usa obtenerDatosEmpresaBoleta() de
// abajo, que trae logo + firma del empleador + representante legal en una
// sola consulta.
export async function obtenerLogoEmpresa(): Promise<{ buffer: Buffer; mime: string } | null> {
  const r = await pool.query(
    "SELECT logo_archivo, logo_mime FROM datos_empresa WHERE logo_archivo IS NOT NULL ORDER BY id LIMIT 1"
  );
  if (r.rowCount === 0) return null;
  return { buffer: r.rows[0].logo_archivo as Buffer, mime: r.rows[0].logo_mime as string };
}

// Trae en una sola consulta todo lo que la Boleta necesita a nivel empresa
// (no por trabajador): el logo, la firma escaneada del empleador y el
// nombre del representante legal (para imprimir debajo de esa firma) -
// pedido explicito del usuario. Se reutiliza desde envios.ts y
// routes/planilla.ts (boletas/pdf, boletas/zip) para no repetir la consulta
// ni tener que resolver cada dato por separado.
export async function obtenerDatosEmpresaBoleta(): Promise<DatosEmpresaBoleta> {
  const r = await pool.query(
    "SELECT logo_archivo, firma_empleador_archivo, representante_legal FROM datos_empresa ORDER BY id LIMIT 1"
  );
  const fila = r.rows[0];
  return {
    logo: fila?.logo_archivo ?? null,
    firmaEmpleador: fila?.firma_empleador_archivo ?? null,
    representanteLegal: fila?.representante_legal ?? null,
  };
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

// Firma escaneada del EMPLEADOR (la empresa) - pedido explicito del
// usuario para que aparezca en la Boleta junto a la firma del trabajador.
// Mismo patron exacto que el logo (arriba): BYTEA en datos_empresa,
// multipart, requiere que ya exista el registro (PUT / de mas abajo).
empresaRouter.post(
  "/firma-empleador",
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
        error: "Primero guarda los datos de la empresa (formulario de arriba) antes de subir la firma",
      });
    }
    await pool.query(
      `UPDATE datos_empresa
       SET firma_empleador_archivo = $1, firma_empleador_mime = $2, firma_empleador_nombre = $3, actualizado_en = now()
       WHERE id = $4`,
      [req.file.buffer, req.file.mimetype, req.file.originalname.slice(0, 200), existente.rows[0].id]
    );
    res.status(204).send();
  })
);

// GET /api/empresa/firma-empleador -> la imagen misma, para <img src=...>
// en la Boleta y en la pantalla Empresa (?token= por query, igual que /logo).
empresaRouter.get(
  "/firma-empleador",
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query(
      "SELECT firma_empleador_archivo, firma_empleador_mime FROM datos_empresa WHERE firma_empleador_archivo IS NOT NULL ORDER BY id LIMIT 1"
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "No hay firma del empleador configurada todavia" });
    }
    res.setHeader("Content-Type", r.rows[0].firma_empleador_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", 'inline; filename="firma-empleador"');
    res.send(r.rows[0].firma_empleador_archivo);
  })
);

// DELETE /api/empresa/firma-empleador -> quita la firma guardada.
empresaRouter.delete(
  "/firma-empleador",
  requierePermiso("empresa.editar"),
  asyncHandler(async (_req: Request, res: Response) => {
    const resultado = await pool.query(
      `UPDATE datos_empresa
       SET firma_empleador_archivo = NULL, firma_empleador_mime = NULL, firma_empleador_nombre = NULL, actualizado_en = now()
       WHERE firma_empleador_archivo IS NOT NULL
       RETURNING id`
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: "No hay firma del empleador guardada" });
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

    // RETURNING de la lista explicita SIN los archivos BYTEA (en vez de
    // "*"): el logo y la firma del empleador se administran por sus
    // propias rutas (POST/GET/DELETE /logo y /firma-empleador, arriba) y no
    // deben viajar enteros cada vez que se guarda este formulario.
    const retorno = `id, ${columnas.join(", ")}, actualizado_en,
      logo_mime, logo_nombre, (logo_archivo IS NOT NULL) AS tiene_logo,
      firma_empleador_mime, firma_empleador_nombre,
      (firma_empleador_archivo IS NOT NULL) AS tiene_firma_empleador`;

    if (existente.rowCount === 0) {
      const r = await pool.query(
        `INSERT INTO datos_empresa (${columnas.join(", ")})
         VALUES (${columnas.map((_, i) => `$${i + 1}`).join(", ")})
         RETURNING ${retorno}`,
        valores
      );
      return res.json(r.rows[0]);
    }

    const r = await pool.query(
      `UPDATE datos_empresa SET ${columnas.map((c, i) => `${c} = $${i + 1}`).join(", ")}, actualizado_en = now()
       WHERE id = $${columnas.length + 1}
       RETURNING ${retorno}`,
      [...valores, existente.rows[0].id]
    );
    res.json(r.rows[0]);
  })
);
