import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { generarLineasREM } from "../plame";
import { generarCSVAFPnet } from "../afpnet";

export const exportacionesRouter = Router();

async function obtenerPeriodo(periodoId: string) {
  const r = await pool.query("SELECT * FROM periodos_planilla WHERE id = $1", [periodoId]);
  return r.rows[0] ?? null;
}

// Bug real corregido: estas dos rutas no tenian NINGUN control de rol antes
// - un Tareador (o cualquier usuario logueado) podia descargar el archivo
// REM/AFPnet completo, con sueldos y datos de pension de TODA la planilla.
// Mismo criterio que Reportes (ver routes/reportes.ts): ADMIN + RESPONSABLE_PLANILLA.

// GET /api/periodos/:id/exportar/rem -> archivo .rem para PLAME/T-Registro
exportacionesRouter.get("/:id/exportar/rem", requierePermiso("exportaciones.descargar"), asyncHandler(async (req: Request, res: Response) => {
  const periodo = await obtenerPeriodo(req.params.id);
  if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

  const lineas = await generarLineasREM(periodo.id);
  const contenido = lineas.join("\r\n") + "\r\n";
  const nombreArchivo = `${periodo.anio}${String(periodo.mes).padStart(2, "0")}.rem`;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
  res.send(contenido);
}));

// GET /api/periodos/:id/exportar/afpnet?proyecto=... -> CSV para digitar en AFPnet
exportacionesRouter.get("/:id/exportar/afpnet", requierePermiso("exportaciones.descargar"), asyncHandler(async (req: Request, res: Response) => {
  const periodo = await obtenerPeriodo(req.params.id);
  if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

  const proyecto = typeof req.query.proyecto === "string" ? req.query.proyecto : undefined;
  const csv = await generarCSVAFPnet(periodo.id, proyecto);
  const nombreArchivo = `AFPnet_${periodo.anio}${String(periodo.mes).padStart(2, "0")}${proyecto ? `_${proyecto}` : ""}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
  res.send("﻿" + csv); // BOM para que Excel detecte UTF-8 correctamente
}));
