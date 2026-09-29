// =========================================================================
// Rutas de "Planilla Mensual" (Ronda E, migracion_034 + unificacion
// Reportes/Planilla Mensual, 22/09/2026).
//
// Junta el Tareo Diario de todas las quincenas/semanas de un mes calendario
// en un solo calculo mensual, para poder declarar PLAME/AFPnet/Asiento
// Contable por mes en vez de por periodo de pago. Ver src/planillaMensual.ts
// para el motor de consolidacion/vista.
//
// Desde la unificacion del 22/09/2026, toda esta pantalla trabaja siempre
// con un ALCANCE {anio, mes, proyecto?} (query params en vez de un
// planilla_mensual_id en la URL), en 2 modalidades:
//   - "Por proyecto" (?proyecto=Nombre): incluye a los obreros YA
//     consolidados de ese proyecto/mes MAS los empleados (regimen general)
//     de ese mismo proyecto/mes (que no necesitan "consolidarse" - su propio
//     periodo MENSUAL ya cubre el mes completo).
//   - "Todos los proyectos" (sin ?proyecto=): junta obreros de CADA proyecto
//     con periodos ese mes MAS empleados de TODOS los proyectos, en una
//     sola vista/archivo - coincide con como se declara PLAME/AFPnet de
//     verdad ante SUNAT/AFP (una vez por RUC al mes). Restringido a ADMIN:
//     un RESPONSABLE_PLANILLA solo tiene sentido de negocio para "por
//     proyecto" (los proyectos que ya tiene asignados).
//
// Todas las rutas exigen el permiso "planilla_mensual.gestionar" (otorgado
// por defecto a RESPONSABLE_PLANILLA; ADMIN ya tiene acceso total via el
// comodin "*").
// =========================================================================

import { Router, Request, Response, NextFunction } from "express";
import ExcelJS from "exceljs";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { tieneAccesoProyecto } from "../permisos";
import { ErrorValidacion } from "../validaciones";
import {
  AlcanceDeclaracionMensual,
  consolidarMes,
  listarHistorialConsolidaciones,
  obtenerVistaMensual,
} from "../planillaMensual";
import { generarLineasREMMensual } from "../plame";
import { generarCSVAFPnetMensual } from "../afpnet";
import { generarFilasAFPnetExcel, construirWorkbookAFPnetExcel, obtenerDiagnosticoAfpnetMensual } from "../afpnetExcel";
import { generarAsientoContableMensual, LineaAsientoContable } from "../asientoContable";
import { obtenerLogoEmpresa } from "./empresa";
import { insertarLogoEnHoja } from "../reportesLogo";

export const planillaMensualRouter = Router();

// Bug real de produccion (21/09/2026): descargas financieras nunca deben
// quedar "congeladas" en la cache del navegador - ver el historial completo
// de este bug en versiones anteriores de este archivo (git log).
planillaMensualRouter.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

function responderErrorValidacion(res: Response, err: unknown): boolean {
  if (err instanceof ErrorValidacion) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

/**
 * Resuelve {anio, mes, proyecto} desde query/body y valida acceso: con
 * proyecto, el criterio de siempre (tieneAccesoProyecto); sin proyecto
 * ("todos los proyectos"), exige ADMIN - un RESPONSABLE_PLANILLA nunca
 * deberia poder generar una declaracion de TODA la empresa, solo de sus
 * proyectos asignados.
 */
function resolverAlcanceConAcceso(
  req: Request,
  origen: Record<string, unknown>
): { tipo: "ok"; alcance: AlcanceDeclaracionMensual } | { tipo: "invalido"; error: string } | { tipo: "sin_acceso" } {
  const anio = Number(origen.anio);
  const mes = Number(origen.mes);
  const proyectoRaw = typeof origen.proyecto === "string" ? origen.proyecto.trim() : "";
  const proyecto = proyectoRaw || null;
  if (!anio || !mes) {
    return { tipo: "invalido", error: "anio y mes son obligatorios" };
  }
  if (proyecto) {
    if (!tieneAccesoProyecto(req.usuario!, proyecto)) return { tipo: "sin_acceso" };
  } else if (req.usuario!.rol !== "ADMIN") {
    return { tipo: "sin_acceso" };
  }
  return { tipo: "ok", alcance: { anio, mes, proyecto } };
}

// POST /api/planilla-mensual/consolidar { proyecto?, anio, mes } -> consolida
// (obreros) el mes pedido: un proyecto, o TODOS (proyecto ausente, solo ADMIN).
planillaMensualRouter.post(
  "/consolidar",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const acceso = resolverAlcanceConAcceso(req, req.body);
    if (acceso.tipo === "sin_acceso") {
      return res
        .status(403)
        .json({ error: req.body?.proyecto ? "No tienes acceso a ese proyecto" : "Solo un administrador puede consolidar todos los proyectos a la vez" });
    }
    if (acceso.tipo === "invalido") return res.status(400).json({ error: acceso.error });
    try {
      const resultado = await consolidarMes(acceso.alcance.anio, acceso.alcance.mes, acceso.alcance.proyecto, req.usuario!.id);
      res.json(resultado);
    } catch (err) {
      if (responderErrorValidacion(res, err)) return;
      throw err;
    }
  })
);

// GET /api/planilla-mensual/historial -> lista TODOS los meses/proyectos de
// OBREROS ya consolidados (los empleados no se "consolidan", asi que no
// aparecen aqui - sus boletas ya calculadas se ven directo en la vista
// mensual normal). ADMIN ve todos los proyectos; el resto de roles solo los
// que ya tiene asignados.
planillaMensualRouter.get(
  "/historial",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const proyectosPermitidos = req.usuario!.rol === "ADMIN" ? null : req.usuario!.proyectos;
    const historial = await listarHistorialConsolidaciones(proyectosPermitidos);
    res.json(historial);
  })
);

// GET /api/planilla-mensual?anio=&mes=&proyecto=(opcional) -> vista
// combinada (obreros consolidados + empleados) de ese mes. Sin proyecto =
// vista de toda la empresa (solo ADMIN). Siempre responde 200 (con arreglos
// vacios si no hay nada) - permite distinguir "nunca se toco este mes/
// proyecto" de "se toco pero no hay nada que mostrar" desde el propio
// contenido de la respuesta, sin depender de un 404.
planillaMensualRouter.get(
  "/",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const acceso = resolverAlcanceConAcceso(req, req.query as Record<string, unknown>);
    if (acceso.tipo === "sin_acceso") {
      return res
        .status(403)
        .json({ error: req.query.proyecto ? "No tienes acceso a ese proyecto" : "Solo un administrador puede ver la declaracion de todos los proyectos" });
    }
    if (acceso.tipo === "invalido") return res.status(400).json({ error: acceso.error });

    const vista = await obtenerVistaMensual(acceso.alcance);
    // Migracion 041/043: advertencias y diagnostico del archivo de AFPnet -
    // se recalculan en cada carga de esta pantalla (no solo al consolidar),
    // porque dependen de datos de Trabajadores que pueden corregirse en
    // cualquier momento sin necesidad de volver a consolidar el mes.
    const { advertencias: avisosDatosAfpnet } = await generarFilasAFPnetExcel(acceso.alcance);
    const diagnosticoAfpnet = await obtenerDiagnosticoAfpnetMensual(acceso.alcance);
    res.json({ ...vista, avisos_datos_afpnet: avisosDatosAfpnet, diagnostico_afpnet: diagnosticoAfpnet });
  })
);

// GET /api/planilla-mensual/exportar/rem?anio=&mes=&proyecto= -> archivo
// .rem para PLAME/T-Registro (obreros consolidados + empleados del mes).
planillaMensualRouter.get(
  "/exportar/rem",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const acceso = resolverAlcanceConAcceso(req, req.query as Record<string, unknown>);
    if (acceso.tipo === "sin_acceso") return res.status(403).json({ error: "No tienes acceso a esta declaracion" });
    if (acceso.tipo === "invalido") return res.status(400).json({ error: acceso.error });
    const { anio, mes, proyecto } = acceso.alcance;

    const lineas = await generarLineasREMMensual(acceso.alcance);
    const contenido = lineas.join("\r\n") + "\r\n";
    const nombreArchivo = proyecto
      ? `${anio}${String(mes).padStart(2, "0")}_mensual.rem`
      : `${anio}${String(mes).padStart(2, "0")}_empresa.rem`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
    res.send(contenido);
  })
);

// GET /api/planilla-mensual/exportar/afpnet?anio=&mes=&proyecto= -> CSV para
// digitar en AFPnet (obreros consolidados + empleados del mes).
planillaMensualRouter.get(
  "/exportar/afpnet",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const acceso = resolverAlcanceConAcceso(req, req.query as Record<string, unknown>);
    if (acceso.tipo === "sin_acceso") return res.status(403).json({ error: "No tienes acceso a esta declaracion" });
    if (acceso.tipo === "invalido") return res.status(400).json({ error: acceso.error });
    const { anio, mes, proyecto } = acceso.alcance;

    const csv = await generarCSVAFPnetMensual(acceso.alcance);
    const nombreArchivo = `AFPnet_${anio}${String(mes).padStart(2, "0")}_mensual_${proyecto ?? "TODOS"}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
    res.send("﻿" + csv); // BOM para que Excel detecte UTF-8 correctamente
  })
);

// GET /api/planilla-mensual/exportar/afpnet-excel?anio=&mes=&proyecto= ->
// Excel OFICIAL para subir directamente al portal de AFPnet.
planillaMensualRouter.get(
  "/exportar/afpnet-excel",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const acceso = resolverAlcanceConAcceso(req, req.query as Record<string, unknown>);
    if (acceso.tipo === "sin_acceso") return res.status(403).json({ error: "No tienes acceso a esta declaracion" });
    if (acceso.tipo === "invalido") return res.status(400).json({ error: acceso.error });
    const { anio, mes, proyecto } = acceso.alcance;

    const { filas, advertencias } = await generarFilasAFPnetExcel(acceso.alcance);
    // No entregar nunca un .xlsx "valido" pero sin ninguna fila (confirmado
    // en produccion 19/09/2026): se distinguen los 2 unicos motivos posibles.
    if (filas.length === 0) {
      const diagnostico = await obtenerDiagnosticoAfpnetMensual(acceso.alcance);
      const desglose = diagnostico.por_sistema_pension.map((f) => `${f.sistema_pension}: ${f.total}`).join(", ") || "ninguno";
      return res.status(400).json({
        error:
          advertencias.length > 0
            ? `Ningun trabajador quedo incluido en el archivo: los ${advertencias.length} trabajador(es) con Sistema de Pension = AFP de esta declaracion fueron excluidos por advertencias - revisa la lista de advertencias que se muestra arriba, en esta misma pantalla.`
            : `No se encontro ningun trabajador con Sistema de Pension = AFP en esta declaracion (${mes}/${anio}${proyecto ? `, ${proyecto}` : ", todos los proyectos"}). ` +
              `Se encontraron ${diagnostico.trabajadores_consolidados} trabajador(es) en total, por Sistema de Pension: ${desglose}. ` +
              (diagnostico.trabajadores_consolidados > 0
                ? `Si esperaba encontrar trabajadores AFP aqui, revise el campo "Sistema de Pension" de sus contratos (Trabajadores > editar) - si son ONP, es correcto que no aparezcan en este archivo.`
                : `Verifique que este mes/proyecto tenga trabajadores consolidados (boton "Consolidar mes") o empleados calculados en su periodo mensual.`),
        advertencias,
        diagnostico,
      });
    }
    const workbook = construirWorkbookAFPnetExcel(filas);
    const nombreArchivo = `AFPnet_Oficial_${anio}${String(mes).padStart(2, "0")}_${proyecto ?? "TODOS"}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

const COLUMNAS_ASIENTO = [
  "CODIGO", "D_H", "FECHA", "IMPORTE", "CODIGO_PRO", "NRO_DOC", "TIPO_DOC",
  "ECPN", "EFE", "DETALLE", "MONTO_EXTR", "LUGAR", "GLOSA", "COD_LIBRO", "COD_MOVIM", "ESTADO",
] as const;

// GET /api/planilla-mensual/exportar/asiento-contable?anio=&mes=&proyecto=
// -> Excel del asiento contable consolidado del mes. Si falta configurar la
// cuenta de algun concepto/proyecto con monto en el mes, responde 400 con la
// lista completa de lo que falta.
planillaMensualRouter.get(
  "/exportar/asiento-contable",
  requierePermiso("planilla_mensual.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const acceso = resolverAlcanceConAcceso(req, req.query as Record<string, unknown>);
    if (acceso.tipo === "sin_acceso") return res.status(403).json({ error: "No tienes acceso a esta declaracion" });
    if (acceso.tipo === "invalido") return res.status(400).json({ error: acceso.error });
    const { anio, mes, proyecto } = acceso.alcance;

    const resultado = await generarAsientoContableMensual(acceso.alcance);
    if (resultado.faltantes.length > 0) {
      return res.status(400).json({
        error: "Faltan cuentas contables por configurar antes de poder generar el asiento",
        faltantes: resultado.faltantes,
      });
    }

    const workbook = new ExcelJS.Workbook();
    const nroDoc = `${anio}-${String(mes).padStart(2, "0")}`;
    const hoja = workbook.addWorksheet(`Asiento Mensual ${nroDoc}`);
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

    const nombreArchivo = `AsientoContable_${anio}${String(mes).padStart(2, "0")}_${proyecto ?? "empresa"}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

