import { Router, Request, Response } from "express";
import ExcelJS from "exceljs";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { generarLineasREM } from "../plame";
import { generarCSVAFPnet } from "../afpnet";
import { generarAsientoContable, LineaAsientoContable } from "../asientoContable";
import { obtenerLogoEmpresa } from "./empresa";
import { insertarLogoEnHoja } from "../reportesLogo";

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

const COLUMNAS_ASIENTO = [
  "CODIGO", "D_H", "FECHA", "IMPORTE", "CODIGO_PRO", "NRO_DOC", "TIPO_DOC",
  "ECPN", "EFE", "DETALLE", "MONTO_EXTR", "LUGAR", "GLOSA", "COD_LIBRO", "COD_MOVIM", "ESTADO",
] as const;

// GET /api/periodos/:id/exportar/asiento-contable -> Excel del asiento
// contable consolidado del periodo (provision de planilla). Si falta
// configurar la cuenta de algun concepto/proyecto con monto en el periodo,
// responde 400 con la lista completa de lo que falta en vez de generar un
// asiento incompleto o descuadrado (ver asientoContable.ts).
exportacionesRouter.get("/:id/exportar/asiento-contable", requierePermiso("exportaciones.descargar"), asyncHandler(async (req: Request, res: Response) => {
  const periodo = await obtenerPeriodo(req.params.id);
  if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

  const resultado = await generarAsientoContable(periodo.id);
  if (resultado.faltantes.length > 0) {
    return res.status(400).json({
      error: "Faltan cuentas contables por configurar antes de poder generar el asiento",
      faltantes: resultado.faltantes,
    });
  }

  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet(`Asiento ${periodo.anio}-${String(periodo.mes).padStart(2, "0")}`);
  insertarLogoEnHoja(workbook, hoja, await obtenerLogoEmpresa());
  hoja.addRow([...COLUMNAS_ASIENTO]);
  hoja.getRow(1).font = { bold: true };
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS_ASIENTO.length } };
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  for (const linea of resultado.lineas) {
    hoja.addRow(COLUMNAS_ASIENTO.map((col) => linea[col as keyof LineaAsientoContable]));
  }
  hoja.columns.forEach((col) => {
    col.width = 16;
  });
  hoja.getColumn(10).width = 40; // DETALLE
  hoja.getColumn(13).width = 55; // GLOSA

  const nombreArchivo = `AsientoContable_${periodo.anio}${String(periodo.mes).padStart(2, "0")}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
  await workbook.xlsx.write(res);
  res.end();
}));
