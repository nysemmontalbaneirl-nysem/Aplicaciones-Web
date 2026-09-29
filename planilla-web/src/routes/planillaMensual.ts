// =========================================================================
// Rutas de "Planilla Mensual Consolidada" (Ronda E, migracion_034).
//
// Junta el Tareo Diario de todas las quincenas/semanas de un
// {proyecto, anio, mes} en un solo calculo mensual, para poder declarar
// PLAME/AFPnet/Asiento Contable por MES CALENDARIO en vez de por periodo de
// pago. Ver src/planillaMensual.ts para el motor de consolidacion. Aplica
// solo a obreros (construccion civil) - Empleados ya declaran por su propio
// periodo MENSUAL, que ya cubre el mes calendario completo.
//
// Todas las rutas exigen el permiso "planilla_mensual.gestionar" (nuevo,
// migracion_034, otorgado por defecto a RESPONSABLE_PLANILLA; ADMIN ya tiene
// acceso total via el comodin "*"). Un usuario no-ADMIN solo puede
// consolidar/leer/descargar la Planilla Mensual de sus propios proyectos
// asignados (tieneAccesoProyecto), mismo criterio que el resto del sistema.
// =========================================================================

import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { tieneAccesoProyecto } from "../permisos";
import { ErrorValidacion } from "../validaciones";
import {
  consolidarPlanillaMensual,
  listarHistorialConsolidaciones,
  obtenerPlanillaMensual,
  obtenerPlanillaMensualPorId,
} from "../planillaMensual";
import { generarLineasREMMensual } from "../plame";
import { generarCSVAFPnetMensual } from "../afpnet";
import { generarFilasAFPnetExcel, construirWorkbookAFPnetExcel } from "../afpnetExcel";

// NOTA (recon 19/46): el parche original tambien agregaba
// GET /:id/exportar/asiento-contable (Excel del asiento contable mensual,
// usando generarAsientoContableMensual de "../asientoContable"). Se omite
// por completo esa ruta: "src/asientoContable.ts" no existe en este arbol
// (ver RECONSTRUCCION_BRECHAS.md punto 5 - confirmado ausente ya 2 veces
// antes, en el patch 15/46). Si ese modulo se reconstruye alguna vez, esta
// ruta (y su equivalente por periodo de pago) se pueden agregar de nuevo
// siguiendo el mismo patron de REM/AFPnet de aqui abajo.

export const planillaMensualRouter = Router();

// Al igual que el resto de las rutas de este proyecto, ErrorValidacion NO se
// traduce a 400 automaticamente en ningun middleware global - cada ruta la
// atrapa y responde 400 ella misma (ver app.ts: el manejador de errores de
// mas abajo solo sabe responder 500 generico). Se sigue ese mismo patron aqui.
function responderErrorValidacion(res: Response, err: unknown): boolean {
  if (err instanceof ErrorValidacion) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

/**
 * Cabecera de una Planilla Mensual ya consolidada, validando acceso por
 * proyecto. Devuelve "no_encontrada" (404) o "sin_acceso" (403) en vez de
 * lanzar, para que cada ruta responda el codigo correcto sin depender de un
 * middleware de errores que traduzca excepciones (este proyecto no tiene
 * uno - ver nota de responderErrorValidacion arriba).
 */
async function obtenerCabeceraConAcceso(
  req: Request,
  id: number
): Promise<
  | { tipo: "ok"; cabecera: { id: number; proyecto: string; anio: number; mes: number } }
  | { tipo: "no_encontrada" }
  | { tipo: "sin_acceso" }
> {
  const cabecera = await obtenerPlanillaMensualPorId(id);
  if (!cabecera) return { tipo: "no_encontrada" };
  if (!tieneAccesoProyecto(req.usuario!, cabecera.proyecto)) return { tipo: "sin_acceso" };
  return { tipo: "ok", cabecera };
}

// POST /api/planilla-mensual/consolidar { proyecto, anio, mes } -> consolida
// (o re-consolida) la Planilla Mensual de ese {proyecto, anio, mes}.
planillaMensualRouter.post(
  "/consolidar",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const proyecto = (req.body.proyecto ?? "").toString().trim();
      const anio = Number(req.body.anio);
      const mes = Number(req.body.mes);
      if (!proyecto || !anio || !mes) {
        throw new ErrorValidacion("proyecto, anio y mes son obligatorios");
      }
      if (!tieneAccesoProyecto(req.usuario!, proyecto)) {
        return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
      }
      const resultado = await consolidarPlanillaMensual(proyecto, anio, mes, req.usuario!.id);
      res.json(resultado);
    } catch (err) {
      if (responderErrorValidacion(res, err)) return;
      throw err;
    }
  })
);

// GET /api/planilla-mensual/historial -> lista TODOS los meses/proyectos ya
// consolidados (sin necesidad de ir probando proyecto por proyecto y mes
// por mes en el selector de abajo). ADMIN ve todos los proyectos; el resto
// de roles solo los que ya tiene asignados (mismo criterio que el resto de
// esta pantalla). Debe declararse ANTES de "GET /:id/..." mas abajo para
// que Express no confunda "historial" con un :id.
planillaMensualRouter.get(
  "/historial",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const proyectosPermitidos = req.usuario!.rol === "ADMIN" ? null : req.usuario!.proyectos;
    const historial = await listarHistorialConsolidaciones(proyectosPermitidos);
    res.json(historial);
  })
);

// GET /api/planilla-mensual?proyecto=...&anio=...&mes=... -> lee la Planilla
// Mensual ya consolidada de ese mes (cabecera + detalle por trabajador), o
// 404 si nunca se consolido.
planillaMensualRouter.get(
  "/",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const proyecto = typeof req.query.proyecto === "string" ? req.query.proyecto.trim() : "";
    const anio = Number(req.query.anio);
    const mes = Number(req.query.mes);
    if (!proyecto || !anio || !mes) {
      return res.status(400).json({ error: "proyecto, anio y mes son obligatorios" });
    }
    if (!tieneAccesoProyecto(req.usuario!, proyecto)) {
      return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    }
    const consolidado = await obtenerPlanillaMensual(proyecto, anio, mes);
    if (!consolidado) {
      return res.status(404).json({ error: "Este mes todavia no se ha consolidado para este proyecto." });
    }
    // Migracion 041: advertencias del archivo oficial de AFPnet (apellidos
    // referenciales incompletos, o tipo de documento sin mapeo confirmado) -
    // se recalculan en cada carga de esta pantalla (no solo al consolidar),
    // porque dependen de datos de Trabajadores que pueden corregirse en
    // cualquier momento sin necesidad de volver a consolidar el mes.
    const { advertencias: avisosDatosAfpnet } = await generarFilasAFPnetExcel(consolidado.planillaMensual.id, anio, mes);
    res.json({ ...consolidado, avisos_datos_afpnet: avisosDatosAfpnet });
  })
);

// GET /api/planilla-mensual/:id/exportar/rem -> archivo .rem para PLAME/T-Registro
planillaMensualRouter.get(
  "/:id/exportar/rem",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const acceso = await obtenerCabeceraConAcceso(req, Number(req.params.id));
    if (acceso.tipo === "sin_acceso") return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    if (acceso.tipo === "no_encontrada") return res.status(404).json({ error: "Planilla Mensual no encontrada" });
    const cabecera = acceso.cabecera;

    const lineas = await generarLineasREMMensual(cabecera.id);
    const contenido = lineas.join("\r\n") + "\r\n";
    const nombreArchivo = `${cabecera.anio}${String(cabecera.mes).padStart(2, "0")}_mensual.rem`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
    res.send(contenido);
  })
);

// GET /api/planilla-mensual/:id/exportar/afpnet -> CSV para digitar en AFPnet
planillaMensualRouter.get(
  "/:id/exportar/afpnet",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const acceso = await obtenerCabeceraConAcceso(req, Number(req.params.id));
    if (acceso.tipo === "sin_acceso") return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    if (acceso.tipo === "no_encontrada") return res.status(404).json({ error: "Planilla Mensual no encontrada" });
    const cabecera = acceso.cabecera;

    const csv = await generarCSVAFPnetMensual(cabecera.id);
    const nombreArchivo = `AFPnet_${cabecera.anio}${String(cabecera.mes).padStart(2, "0")}_mensual_${cabecera.proyecto}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
    res.send("﻿" + csv); // BOM para que Excel detecte UTF-8 correctamente
  })
);

// GET /api/planilla-mensual/:id/exportar/afpnet-excel -> Excel OFICIAL para
// subir directamente al portal de AFPnet (migracion 041, ver afpnetExcel.ts).
// A diferencia de /exportar/afpnet (CSV simplificado, uso interno/manual),
// este es el archivo con la estructura de 17 columnas que AFPnet exige.
planillaMensualRouter.get(
  "/:id/exportar/afpnet-excel",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const acceso = await obtenerCabeceraConAcceso(req, Number(req.params.id));
    if (acceso.tipo === "sin_acceso") return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    if (acceso.tipo === "no_encontrada") return res.status(404).json({ error: "Planilla Mensual no encontrada" });
    const cabecera = acceso.cabecera;

    const { filas, advertencias } = await generarFilasAFPnetExcel(cabecera.id, cabecera.anio, cabecera.mes);
    if (filas.length === 0) {
      return res.status(400).json({
        error:
          advertencias.length > 0
            ? `Ningun trabajador quedo incluido en el archivo: los ${advertencias.length} trabajador(es) con Sistema de Pension = AFP de este proyecto/mes fueron excluidos por advertencias - revisa la lista de advertencias que se muestra arriba, en esta misma pantalla.`
            : `No se encontro ningun trabajador con Sistema de Pension = AFP en la Planilla Mensual Consolidada de "${cabecera.proyecto}" (${cabecera.mes}/${cabecera.anio}). Verifica que haya trabajadores consolidados este mes para este proyecto y que su contrato tenga el Sistema de Pension configurado como AFP (no ONP).`,
        advertencias,
      });
    }
    const workbook = construirWorkbookAFPnetExcel(filas);
    const nombreArchivo = `AFPnet_Oficial_${cabecera.anio}${String(cabecera.mes).padStart(2, "0")}_${cabecera.proyecto}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

