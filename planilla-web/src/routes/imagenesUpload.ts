import multer from "multer";
import { Request, Response } from "express";

// Configuracion compartida de multer para subir imagenes (logo de la
// empresa, firma escaneada del trabajador) - mismo patron ya usado para el
// certificado de Tareo Diario (ver uploadCertificado en routes/planilla.ts):
// memoria (no disco, se guarda como BYTEA en Postgres), 5MB, solo
// JPG/PNG/WEBP.
export const MIMES_IMAGEN_VALIDOS = ["image/jpeg", "image/png", "image/webp"];

export const uploadImagen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, MIMES_IMAGEN_VALIDOS.includes(file.mimetype)),
});

// Convierte el error de multer por tamaño excedido en un 400 legible (el
// fileFilter, en cambio, no lanza error - simplemente deja req.file
// indefinido, y cada ruta valida "si no vino el archivo" con su propio
// mensaje). Mismo criterio exacto que manejarErrorMulter en routes/planilla.ts.
export function manejarErrorMulterImagen(err: unknown, _req: Request, res: Response, next: (err?: unknown) => void) {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "La imagen supera el tamaño máximo permitido (5 MB)" });
  }
  next(err);
}
