import { Router, Request, Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { calcularLineaPlanilla } from "../motorCalculo";
import { obtenerConceptos } from "./conceptos";
import { tieneAccesoProyecto } from "../permisos";
import { Contrato, ParametrosNormativos, TablaSalarialMensual, TasasAFPMensuales } from "../tipos";
import { ErrorValidacion } from "../validaciones";
import { registrarBitacora } from "../bitacora";
import { generarPdfTabla } from "../pdfTabla";

export const planillaRouter = Router();

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

const uploadTareo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function obtenerPeriodo(periodoId: string) {
  const r = await pool.query("SELECT * FROM periodos_planilla WHERE id = $1", [periodoId]);
  return r.rows[0] ?? null;
}

export async function obtenerParametros(anio: number): Promise<ParametrosNormativos> {
  const r = await pool.query("SELECT * FROM parametros_normativos WHERE anio = $1", [anio]);
  if (r.rowCount === 0) {
    throw new ErrorValidacion(`No hay parametros_normativos configurados para el anio ${anio}`);
  }
  return r.rows[0] as ParametrosNormativos;
}

async function obtenerTablaCategorias(anio: number, mes: number): Promise<TablaSalarialMensual> {
  const r = await pool.query(
    "SELECT categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria FROM tabla_salarial_mensual WHERE anio = $1 AND mes = $2",
    [anio, mes]
  );
  if (r.rowCount === 0) {
    throw new ErrorValidacion(
      `No hay tabla_salarial_mensual configurada para ${mes}/${anio}. Configurala en la pestana Parametros.`
    );
  }
  const tabla: TablaSalarialMensual = {};
  for (const fila of r.rows) {
    tabla[fila.categoria] = {
      jornal_basico: Number(fila.jornal_basico),
      buc: Number(fila.buc),
      bae: Number(fila.bae),
      movilidad_acumulada: Number(fila.movilidad_acumulada),
      gratificacion_diaria: Number(fila.gratificacion_diaria),
    };
  }
  return tabla;
}

export async function obtenerAfpTasas(anio: number, mes: number): Promise<TasasAFPMensuales> {
  const r = await pool.query(
    "SELECT afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio FROM tasas_afp_mensuales WHERE anio = $1 AND mes = $2",
    [anio, mes]
  );
  if (r.rowCount === 0) {
    throw new ErrorValidacion(
      `No hay tasas_afp_mensuales configuradas para ${mes}/${anio}. Configuralas en la pestana Parametros.`
    );
  }
  const tasas = {} as TasasAFPMensuales;
  for (const fila of r.rows) {
    (tasas as Record<string, unknown>)[fila.afp_nombre] = {
      comision_flujo: Number(fila.comision_flujo),
      prima_seguro: Number(fila.prima_seguro),
      aporte_obligatorio: Number(fila.aporte_obligatorio),
    };
  }
  return tasas;
}

// Trae el periodo y sus boletas calculadas, con el mismo filtro de texto
// (DNI o nombre) y el mismo recorte por proyectos del usuario que usa tanto
// la vista en pantalla (Boletas.tsx) como las descargas de Excel/PDF, para
// que "lo que ves es lo que exportas".
async function obtenerDetallePeriodo(periodoId: string, q: string | undefined, usuario: NonNullable<Request["usuario"]>) {
  const periodo = await obtenerPeriodo(periodoId);
  if (!periodo) return null;

  const condiciones = ["d.periodo_id = $1"];
  const valores: unknown[] = [periodoId];
  if (q && q.trim()) {
    valores.push(`%${q.trim()}%`);
    condiciones.push(`(e.numero_documento ILIKE $${valores.length} OR e.apellidos_nombres ILIKE $${valores.length})`);
  }
  if (usuario.rol !== "ADMIN") {
    valores.push(usuario.proyectos);
    condiciones.push(`c.proyecto = ANY($${valores.length}::text[])`);
  }

  const resultado = await pool.query(
    `SELECT d.*, e.apellidos_nombres, e.numero_documento, e.numero_hijos,
            c.proyecto, c.categoria_ocupacional, c.sistema_pension, c.afp_nombre,
            c.cuspp, c.fecha_ingreso
     FROM detalle_planilla d
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     WHERE ${condiciones.join(" AND ")}
     ORDER BY e.apellidos_nombres ASC`,
    valores
  );
  return { periodo, detalle: resultado.rows };
}

function aportesEmpleadorDe(fila: Record<string, unknown>): number {
  const json = fila.detalle_json as Record<string, unknown> | string | null | undefined;
  const detalleJson = typeof json === "string" ? JSON.parse(json) : json ?? {};
  return Number((detalleJson as { total_aportes_empleador?: number }).total_aportes_empleador ?? 0);
}

// GET /api/periodos/:id/planilla?q=texto -> boletas ya calculadas de ese
// periodo (usado por la pestana Boletas). q filtra por DNI o nombre.
// TAREADOR no tiene acceso a boletas; RESPONSABLE_PLANILLA solo ve las de
// sus proyectos asignados.
planillaRouter.get(
  "/:id/planilla",
  requierePermiso("boletas.ver"),
  asyncHandler(async (req: Request, res: Response) => {
  const datos = await obtenerDetallePeriodo(req.params.id, req.query.q as string | undefined, req.usuario!);
  if (!datos) return res.status(404).json({ error: "Periodo no encontrado" });
  res.json(datos);
}));

// Descargas del mismo listado de boletas de un periodo (resumen por
// trabajador: ingresos, descuentos, aportes del empleador y neto), en Excel
// y PDF - lo que el usuario llama "planilla de tal mes" para revisar quien
// esta en ese periodo y sus totales, sin entrar boleta por boleta.
planillaRouter.get(
  "/:id/planilla/excel",
  requierePermiso("boletas.ver"),
  asyncHandler(async (req: Request, res: Response) => {
    const datos = await obtenerDetallePeriodo(req.params.id, req.query.q as string | undefined, req.usuario!);
    if (!datos) return res.status(404).json({ error: "Periodo no encontrado" });
    const { periodo, detalle } = datos;

    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet(`Planilla ${MESES[periodo.mes - 1]} ${periodo.anio}`);
    hoja.columns = [
      { header: "DNI", key: "dni", width: 14 },
      { header: "Apellidos y nombres", key: "nombres", width: 34 },
      { header: "Categoria", key: "categoria", width: 14 },
      { header: "Proyecto", key: "proyecto", width: 22 },
      { header: "Total ingresos", key: "ingresos", width: 16 },
      { header: "Total descuentos", key: "descuentos", width: 16 },
      { header: "Total aportes", key: "aportes", width: 16 },
      { header: "Neto a pagar", key: "neto", width: 16 },
    ];
    hoja.getRow(1).font = { bold: true };
    hoja.getColumn("dni").numFmt = "@";
    for (const col of ["ingresos", "descuentos", "aportes", "neto"]) {
      hoja.getColumn(col).numFmt = "#,##0.00";
    }

    let totIngresos = 0, totDescuentos = 0, totAportes = 0, totNeto = 0;
    for (const d of detalle) {
      const aportes = aportesEmpleadorDe(d);
      totIngresos += Number(d.total_ingresos);
      totDescuentos += Number(d.total_descuentos);
      totAportes += aportes;
      totNeto += Number(d.neto_pagar);
      hoja.addRow({
        dni: d.numero_documento,
        nombres: d.apellidos_nombres,
        categoria: d.categoria_ocupacional,
        proyecto: d.proyecto,
        ingresos: Number(d.total_ingresos),
        descuentos: Number(d.total_descuentos),
        aportes,
        neto: Number(d.neto_pagar),
      });
    }
    const filaTotales = hoja.addRow({
      nombres: "TOTALES",
      ingresos: totIngresos,
      descuentos: totDescuentos,
      aportes: totAportes,
      neto: totNeto,
    });
    filaTotales.font = { bold: true };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="planilla_${periodo.mes}_${periodo.anio}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  })
);

planillaRouter.get(
  "/:id/planilla/pdf",
  requierePermiso("boletas.ver"),
  asyncHandler(async (req: Request, res: Response) => {
    const datos = await obtenerDetallePeriodo(req.params.id, req.query.q as string | undefined, req.usuario!);
    if (!datos) return res.status(404).json({ error: "Periodo no encontrado" });
    const { periodo, detalle } = datos;

    let totIngresos = 0, totDescuentos = 0, totAportes = 0, totNeto = 0;
    const filas = detalle.map((d) => {
      const aportes = aportesEmpleadorDe(d);
      totIngresos += Number(d.total_ingresos);
      totDescuentos += Number(d.total_descuentos);
      totAportes += aportes;
      totNeto += Number(d.neto_pagar);
      return [
        d.numero_documento,
        d.apellidos_nombres,
        d.categoria_ocupacional,
        d.proyecto,
        Number(d.total_ingresos).toFixed(2),
        Number(d.total_descuentos).toFixed(2),
        aportes.toFixed(2),
        Number(d.neto_pagar).toFixed(2),
      ];
    });

    const buffer = await generarPdfTabla({
      titulo: `Planilla ${MESES[periodo.mes - 1]} ${periodo.anio}`,
      subtitulo: `${detalle.length} trabajador(es) · Generado el ${new Date().toLocaleDateString("es-PE")}`,
      columnas: [
        { titulo: "DNI", ancho: 60 },
        { titulo: "Apellidos y nombres", ancho: 150 },
        { titulo: "Categoria", ancho: 70 },
        { titulo: "Proyecto", ancho: 90 },
        { titulo: "Ingresos", ancho: 65, align: "right" },
        { titulo: "Descuentos", ancho: 65, align: "right" },
        { titulo: "Aportes", ancho: 65, align: "right" },
        { titulo: "Neto", ancho: 65, align: "right" },
      ],
      filas,
      filaTotales: [
        "", "TOTALES", "", "",
        totIngresos.toFixed(2), totDescuentos.toFixed(2), totAportes.toFixed(2), totNeto.toFixed(2),
      ],
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="planilla_${periodo.mes}_${periodo.anio}.pdf"`);
    res.send(buffer);
  })
);

const COLUMNAS_TAREO = [
  "DNI",
  "PROYECTO",
  "DIAS_TRABAJADOS",
  "DIAS_DOMINICAL",
  "DIAS_FERIADO",
  "DIAS_FALTA",
  "HORAS_EXTRA_25",
  "HORAS_EXTRA_35",
  "HORAS_EXTRA_100",
];

// GET /api/periodos/:id/tareo/plantilla -> descarga un .xlsx con el DNI y
// proyecto de cada trabajador habil, listo para llenar y volver a subir.
// El DNI se guarda como texto (no como numero) para que Excel no le borre
// los ceros a la izquierda.
planillaRouter.get("/:id/tareo/plantilla", asyncHandler(async (req: Request, res: Response) => {
  const periodo = await obtenerPeriodo(req.params.id);
  if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

  const esAdmin = req.usuario!.rol === "ADMIN";
  const contratosResult = await pool.query(
    `SELECT e.numero_documento, e.apellidos_nombres, c.proyecto
     FROM contratos c JOIN empleados e ON e.id = c.empleado_id
     WHERE c.estado = 'HABIL' ${esAdmin ? "" : "AND c.proyecto = ANY($1::text[])"}
     ORDER BY e.apellidos_nombres ASC`,
    esAdmin ? [] : [req.usuario!.proyectos]
  );

  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Tareo");
  hoja.columns = COLUMNAS_TAREO.map((nombre) => ({ header: nombre, key: nombre, width: 18 }));
  hoja.getColumn("DNI").numFmt = "@"; // formato texto, evita que se pierdan los ceros a la izquierda

  for (const c of contratosResult.rows) {
    const fila = hoja.addRow({ DNI: c.numero_documento, PROYECTO: c.proyecto });
    fila.getCell("DNI").numFmt = "@";
    fila.getCell("DNI").value = c.numero_documento; // valor de texto explicito
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="tareo_plantilla_${periodo.mes}_${periodo.anio}.xlsx"`
  );
  await workbook.xlsx.write(res);
  res.end();
}));

interface FilaAsistencia {
  contrato_id: number;
  dias_trabajados: number;
  dias_dominical: number;
  dias_feriado: number;
  dias_falta: number;
  horas_extra_25: number;
  horas_extra_35: number;
  horas_extra_100: number;
  // Agregados desde el Tareo Diario (migracion 017). Se dejan opcionales
  // (undefined/null = "no tocar") para que la edicion manual de totales de
  // /:id/tareo (que no conoce estos campos) nunca borre por accidente lo que
  // ya se calculo desde tareo_diario - ver comentario en el INSERT/UPDATE.
  dias_subsidio_enfermedad?: number | null;
  dias_subsidio_maternidad?: number | null;
  dias_licencia_paternidad?: number | null;
}

async function guardarAsistencia(periodoId: string, fila: FilaAsistencia) {
  await pool.query(
    `INSERT INTO asistencia_periodo (
       periodo_id, contrato_id, dias_trabajados, dias_dominical, dias_feriado,
       dias_falta, horas_extra_25, horas_extra_35, horas_extra_100,
       dias_subsidio_enfermedad, dias_subsidio_maternidad, dias_licencia_paternidad
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,0),COALESCE($11,0),COALESCE($12,0))
     ON CONFLICT (periodo_id, contrato_id) DO UPDATE SET
       dias_trabajados = EXCLUDED.dias_trabajados,
       dias_dominical = EXCLUDED.dias_dominical,
       dias_feriado = EXCLUDED.dias_feriado,
       dias_falta = EXCLUDED.dias_falta,
       horas_extra_25 = EXCLUDED.horas_extra_25,
       horas_extra_35 = EXCLUDED.horas_extra_35,
       horas_extra_100 = EXCLUDED.horas_extra_100,
       -- $10/$11/$12 en null = "no tocar" (lo manda la edicion manual de
       -- totales, que no conoce estos campos); un numero explicito (incluido
       -- 0) si viene, por ejemplo, del recalculo desde tareo_diario.
       dias_subsidio_enfermedad = COALESCE($10, asistencia_periodo.dias_subsidio_enfermedad),
       dias_subsidio_maternidad = COALESCE($11, asistencia_periodo.dias_subsidio_maternidad),
       dias_licencia_paternidad = COALESCE($12, asistencia_periodo.dias_licencia_paternidad),
       actualizado_en = now()`,
    [
      periodoId,
      fila.contrato_id,
      fila.dias_trabajados,
      fila.dias_dominical,
      fila.dias_feriado,
      fila.dias_falta,
      fila.horas_extra_25,
      fila.horas_extra_35,
      fila.horas_extra_100,
      fila.dias_subsidio_enfermedad ?? null,
      fila.dias_subsidio_maternidad ?? null,
      fila.dias_licencia_paternidad ?? null,
    ]
  );
}

// GET /api/periodos/:id/tareo -> tareo ya guardado para ese periodo (solo
// trabajadores que tienen una fila cargada, no toda la planilla).
planillaRouter.get("/:id/tareo", asyncHandler(async (req: Request, res: Response) => {
  const periodo = await obtenerPeriodo(req.params.id);
  if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

  const esAdmin = req.usuario!.rol === "ADMIN";
  const resultado = await pool.query(
    `SELECT a.*, e.numero_documento, e.apellidos_nombres, c.proyecto, c.categoria_ocupacional
     FROM asistencia_periodo a
     JOIN contratos c ON c.id = a.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     WHERE a.periodo_id = $1 ${esAdmin ? "" : "AND c.proyecto = ANY($2::text[])"}
     ORDER BY e.apellidos_nombres ASC`,
    esAdmin ? [req.params.id] : [req.params.id, req.usuario!.proyectos]
  );
  res.json({ periodo, tareo: resultado.rows });
}));

// PUT /api/periodos/:id/tareo  body: FilaAsistencia -> agrega o edita un
// trabajador puntual (para el caso de agregar a mano a alguien que no
// vino en el archivo).
planillaRouter.put("/:id/tareo", asyncHandler(async (req: Request, res: Response) => {
  const periodo = await obtenerPeriodo(req.params.id);
  if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

  const b = req.body as Partial<FilaAsistencia>;
  if (!b.contrato_id) {
    return res.status(400).json({ error: "contrato_id es obligatorio" });
  }

  const contratoResult = await pool.query("SELECT proyecto FROM contratos WHERE id = $1", [b.contrato_id]);
  if (contratoResult.rowCount === 0) {
    return res.status(404).json({ error: "El contrato no existe" });
  }
  if (!tieneAccesoProyecto(req.usuario!, contratoResult.rows[0].proyecto)) {
    return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
  }

  await guardarAsistencia(req.params.id, {
    contrato_id: b.contrato_id,
    dias_trabajados: b.dias_trabajados ?? 0,
    dias_dominical: b.dias_dominical ?? 0,
    dias_feriado: b.dias_feriado ?? 0,
    dias_falta: b.dias_falta ?? 0,
    horas_extra_25: b.horas_extra_25 ?? 0,
    horas_extra_35: b.horas_extra_35 ?? 0,
    horas_extra_100: b.horas_extra_100 ?? 0,
  });
  res.status(204).send();
}));

// DELETE /api/periodos/:id/tareo/:contratoId -> quita un trabajador del
// tareo de ese periodo (no borra el contrato, solo su fila de asistencia).
planillaRouter.delete("/:id/tareo/:contratoId", asyncHandler(async (req: Request, res: Response) => {
  const contratoResult = await pool.query("SELECT proyecto FROM contratos WHERE id = $1", [req.params.contratoId]);
  if (contratoResult.rowCount === 0) {
    return res.status(404).json({ error: "El contrato no existe" });
  }
  if (!tieneAccesoProyecto(req.usuario!, contratoResult.rows[0].proyecto)) {
    return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
  }

  const resultado = await pool.query(
    "DELETE FROM asistencia_periodo WHERE periodo_id = $1 AND contrato_id = $2 RETURNING id",
    [req.params.id, req.params.contratoId]
  );
  if (resultado.rowCount === 0) {
    return res.status(404).json({ error: "No hay tareo cargado para ese trabajador en este periodo" });
  }
  await registrarBitacora(req.usuario!.id, "QUITAR_TRABAJADOR_TAREO", "asistencia_periodo", null, {
    periodo_id: req.params.id,
    contrato_id: req.params.contratoId,
  });
  res.status(204).send();
}));

// -----------------------------------------------------------------------
// Tareo diario (migracion 017): registro dia por dia por trabajador, ademas
// de la carga por Excel/CSV y la edicion manual de totales de arriba. Se
// guarda en tareo_diario y desde ahi se recalculan los totales de
// asistencia_periodo (dias_trabajados, horas_extra_25/35/100, dias_falta y
// los 3 campos de subsidio/licencia) via recalcularAsistenciaDesdeTareoDiario,
// reutilizando guardarAsistencia - el motor de calculo (motorCalculo.ts)
// sigue leyendo solo de asistencia_periodo, sin ningun cambio.
// -----------------------------------------------------------------------

const TIPOS_DIA_ESPECIAL = [
  "FALTA",
  "SUBSIDIO_ENFERMEDAD",
  "SUBSIDIO_MATERNIDAD",
  "LICENCIA_PATERNIDAD",
] as const;
type TipoDiaEspecial = (typeof TIPOS_DIA_ESPECIAL)[number];

interface FilaTareoDiario {
  fecha: string;
  horas_normales?: number;
  minutos_normales?: number;
  horas_dominical?: number;
  minutos_dominical?: number;
  horas_feriado?: number;
  minutos_feriado?: number;
  horas_extra_tramo1?: number;
  minutos_extra_tramo1?: number;
  horas_extra_tramo2?: number;
  minutos_extra_tramo2?: number;
  horas_extra_tramo3?: number;
  minutos_extra_tramo3?: number;
  tipo_dia_especial?: TipoDiaEspecial | null;
}

function redondear2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Suma todas las filas de tareo_diario de un contrato en un periodo y
 * actualiza asistencia_periodo con los totales resultantes, via la misma
 * guardarAsistencia() que usan la carga por Excel y la edicion manual. Los
 * conceptos que hoy se guardan en "dias" (jornal normal, dominical, feriado)
 * se obtienen dividiendo el total de horas entre 8 (jornada estandar) -
 * mismo criterio que ya tolera dias_trabajados fraccionario en el resto del
 * sistema (ver comentarios de motorCalculo.ts sobre dias redondeados).
 */
async function recalcularAsistenciaDesdeTareoDiario(periodoId: string, contratoId: number) {
  const r = await pool.query(
    `SELECT horas_normales, minutos_normales, horas_dominical, minutos_dominical,
            horas_feriado, minutos_feriado, horas_extra_tramo1, minutos_extra_tramo1,
            horas_extra_tramo2, minutos_extra_tramo2, horas_extra_tramo3, minutos_extra_tramo3,
            tipo_dia_especial
     FROM tareo_diario WHERE periodo_id = $1 AND contrato_id = $2`,
    [periodoId, contratoId]
  );

  let horasNormales = 0;
  let horasDominical = 0;
  let horasFeriado = 0;
  let horasTramo1 = 0;
  let horasTramo2 = 0;
  let horasTramo3 = 0;
  let diasFalta = 0;
  let diasSubsidioEnfermedad = 0;
  let diasSubsidioMaternidad = 0;
  let diasLicenciaPaternidad = 0;

  for (const fila of r.rows) {
    switch (fila.tipo_dia_especial as TipoDiaEspecial | null) {
      case "FALTA":
        diasFalta += 1;
        continue;
      case "SUBSIDIO_ENFERMEDAD":
        diasSubsidioEnfermedad += 1;
        continue;
      case "SUBSIDIO_MATERNIDAD":
        diasSubsidioMaternidad += 1;
        continue;
      case "LICENCIA_PATERNIDAD":
        diasLicenciaPaternidad += 1;
        continue;
    }
    horasNormales += Number(fila.horas_normales) + Number(fila.minutos_normales) / 60;
    horasDominical += Number(fila.horas_dominical) + Number(fila.minutos_dominical) / 60;
    horasFeriado += Number(fila.horas_feriado) + Number(fila.minutos_feriado) / 60;
    horasTramo1 += Number(fila.horas_extra_tramo1) + Number(fila.minutos_extra_tramo1) / 60;
    horasTramo2 += Number(fila.horas_extra_tramo2) + Number(fila.minutos_extra_tramo2) / 60;
    horasTramo3 += Number(fila.horas_extra_tramo3) + Number(fila.minutos_extra_tramo3) / 60;
  }

  await guardarAsistencia(periodoId, {
    contrato_id: contratoId,
    dias_trabajados: redondear2(horasNormales / 8),
    dias_dominical: redondear2(horasDominical / 8),
    dias_feriado: redondear2(horasFeriado / 8),
    dias_falta: diasFalta,
    horas_extra_25: redondear2(horasTramo1),
    horas_extra_35: redondear2(horasTramo2),
    horas_extra_100: redondear2(horasTramo3),
    dias_subsidio_enfermedad: diasSubsidioEnfermedad,
    dias_subsidio_maternidad: diasSubsidioMaternidad,
    dias_licencia_paternidad: diasLicenciaPaternidad,
  });
}

async function verificarAccesoContrato(req: Request, contratoId: string): Promise<string | null> {
  const contratoResult = await pool.query("SELECT proyecto FROM contratos WHERE id = $1", [contratoId]);
  if (contratoResult.rowCount === 0) return null;
  return contratoResult.rows[0].proyecto as string;
}

// GET /api/periodos/:id/tareo-diario/:contratoId -> dias ya cargados para
// ese trabajador en ese periodo (el frontend arma la grilla completa del
// mes usando periodo.fecha_inicio/fecha_fin y rellena con esto).
planillaRouter.get(
  "/:id/tareo-diario/:contratoId",
  asyncHandler(async (req: Request, res: Response) => {
    const periodo = await obtenerPeriodo(req.params.id);
    if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

    const proyecto = await verificarAccesoContrato(req, req.params.contratoId);
    if (proyecto === null) return res.status(404).json({ error: "El contrato no existe" });
    if (!tieneAccesoProyecto(req.usuario!, proyecto)) {
      return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    }

    const r = await pool.query(
      `SELECT fecha, horas_normales, minutos_normales, horas_dominical, minutos_dominical,
              horas_feriado, minutos_feriado, horas_extra_tramo1, minutos_extra_tramo1,
              horas_extra_tramo2, minutos_extra_tramo2, horas_extra_tramo3, minutos_extra_tramo3,
              tipo_dia_especial
       FROM tareo_diario
       WHERE periodo_id = $1 AND contrato_id = $2
       ORDER BY fecha`,
      [req.params.id, req.params.contratoId]
    );
    res.json({ periodo, dias: r.rows });
  })
);

// PUT /api/periodos/:id/tareo-diario/:contratoId  body: { dias: FilaTareoDiario[] }
// Guarda de una vez todos los dias editados de la grilla (evita 30+ llamadas
// de red) y recalcula los totales de asistencia_periodo para ese trabajador.
planillaRouter.put(
  "/:id/tareo-diario/:contratoId",
  asyncHandler(async (req: Request, res: Response) => {
    const periodo = await obtenerPeriodo(req.params.id);
    if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

    const proyecto = await verificarAccesoContrato(req, req.params.contratoId);
    if (proyecto === null) return res.status(404).json({ error: "El contrato no existe" });
    if (!tieneAccesoProyecto(req.usuario!, proyecto)) {
      return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    }

    const dias = (req.body?.dias ?? []) as FilaTareoDiario[];
    if (!Array.isArray(dias)) {
      return res.status(400).json({ error: "El campo 'dias' debe ser un arreglo" });
    }
    for (const d of dias) {
      if (!d.fecha || Number.isNaN(Date.parse(d.fecha))) {
        return res.status(400).json({ error: `Fecha invalida: ${d.fecha}` });
      }
      if (d.tipo_dia_especial && !TIPOS_DIA_ESPECIAL.includes(d.tipo_dia_especial)) {
        return res.status(400).json({ error: `tipo_dia_especial invalido: ${d.tipo_dia_especial}` });
      }
    }

    const cliente = await pool.connect();
    try {
      await cliente.query("BEGIN");
      for (const d of dias) {
        await cliente.query(
          `INSERT INTO tareo_diario (
             periodo_id, contrato_id, fecha, horas_normales, minutos_normales,
             horas_dominical, minutos_dominical, horas_feriado, minutos_feriado,
             horas_extra_tramo1, minutos_extra_tramo1, horas_extra_tramo2, minutos_extra_tramo2,
             horas_extra_tramo3, minutos_extra_tramo3, tipo_dia_especial
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (periodo_id, contrato_id, fecha) DO UPDATE SET
             horas_normales = EXCLUDED.horas_normales,
             minutos_normales = EXCLUDED.minutos_normales,
             horas_dominical = EXCLUDED.horas_dominical,
             minutos_dominical = EXCLUDED.minutos_dominical,
             horas_feriado = EXCLUDED.horas_feriado,
             minutos_feriado = EXCLUDED.minutos_feriado,
             horas_extra_tramo1 = EXCLUDED.horas_extra_tramo1,
             minutos_extra_tramo1 = EXCLUDED.minutos_extra_tramo1,
             horas_extra_tramo2 = EXCLUDED.horas_extra_tramo2,
             minutos_extra_tramo2 = EXCLUDED.minutos_extra_tramo2,
             horas_extra_tramo3 = EXCLUDED.horas_extra_tramo3,
             minutos_extra_tramo3 = EXCLUDED.minutos_extra_tramo3,
             tipo_dia_especial = EXCLUDED.tipo_dia_especial,
             actualizado_en = now()`,
          [
            req.params.id,
            req.params.contratoId,
            d.fecha,
            d.horas_normales ?? 0,
            d.minutos_normales ?? 0,
            d.horas_dominical ?? 0,
            d.minutos_dominical ?? 0,
            d.horas_feriado ?? 0,
            d.minutos_feriado ?? 0,
            d.horas_extra_tramo1 ?? 0,
            d.minutos_extra_tramo1 ?? 0,
            d.horas_extra_tramo2 ?? 0,
            d.minutos_extra_tramo2 ?? 0,
            d.horas_extra_tramo3 ?? 0,
            d.minutos_extra_tramo3 ?? 0,
            d.tipo_dia_especial ?? null,
          ]
        );
      }
      await cliente.query("COMMIT");
    } catch (err) {
      await cliente.query("ROLLBACK");
      throw err;
    } finally {
      cliente.release();
    }

    await recalcularAsistenciaDesdeTareoDiario(req.params.id, Number(req.params.contratoId));
    await registrarBitacora(req.usuario!.id, "TAREO_DIARIO", "tareo_diario", null, {
      periodo_id: req.params.id,
      contrato_id: req.params.contratoId,
      dias_guardados: dias.length,
    });
    res.status(204).send();
  })
);

// DELETE /api/periodos/:id/tareo-diario/:contratoId/:fecha -> borra un dia
// puntual y recalcula los totales del trabajador para ese periodo.
planillaRouter.delete(
  "/:id/tareo-diario/:contratoId/:fecha",
  asyncHandler(async (req: Request, res: Response) => {
    const proyecto = await verificarAccesoContrato(req, req.params.contratoId);
    if (proyecto === null) return res.status(404).json({ error: "El contrato no existe" });
    if (!tieneAccesoProyecto(req.usuario!, proyecto)) {
      return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    }

    const resultado = await pool.query(
      "DELETE FROM tareo_diario WHERE periodo_id = $1 AND contrato_id = $2 AND fecha = $3 RETURNING id",
      [req.params.id, req.params.contratoId, req.params.fecha]
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: "No hay tareo diario guardado para esa fecha" });
    }

    await recalcularAsistenciaDesdeTareoDiario(req.params.id, Number(req.params.contratoId));
    res.status(204).send();
  })
);

interface ErrorFilaTareo {
  fila: number;
  dni: string;
  motivo: string;
}

// Convierte el valor de una celda de exceljs a texto plano (maneja texto
// enriquecido, formulas ya calculadas, numeros y fechas).
function celdaATexto(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "object") {
    if ("text" in valor) return String((valor as { text: unknown }).text ?? "");
    if ("result" in valor) return String((valor as { result: unknown }).result ?? "");
  }
  return String(valor);
}

async function leerFilasXlsx(buffer: Buffer): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const hoja = workbook.worksheets[0];
  if (!hoja) return [];

  const encabezados: string[] = [];
  hoja.getRow(1).eachCell((cell, colNumber) => {
    encabezados[colNumber] = celdaATexto(cell.value).trim().toUpperCase();
  });

  const filas: Record<string, string>[] = [];
  hoja.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    let tieneAlgo = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const nombreCol = encabezados[colNumber];
      if (!nombreCol) return;
      const texto = celdaATexto(cell.value).trim();
      if (texto) tieneAlgo = true;
      obj[nombreCol] = texto;
    });
    if (tieneAlgo) filas.push(obj);
  });
  return filas;
}

// POST /api/periodos/:id/tareo/importar  (multipart, campo "archivo" = .xlsx o .csv con encabezado)
// Columnas: DNI, PROYECTO (opcional, solo si el DNI tiene mas de un contrato habil),
// DIAS_TRABAJADOS, DIAS_DOMINICAL, DIAS_FERIADO, DIAS_FALTA,
// HORAS_EXTRA_25, HORAS_EXTRA_35, HORAS_EXTRA_100
// Guarda directamente cada fila valida en asistencia_periodo (no hace
// falta incluir a todos los trabajadores: alcanza con los que trabajaron
// ese periodo - los que no aparecen en el archivo simplemente no quedan
// en el tareo de este periodo).
planillaRouter.post(
  "/:id/tareo/importar",
  uploadTareo.single("archivo"),
  asyncHandler(async (req: Request, res: Response) => {
    const periodo = await obtenerPeriodo(req.params.id);
    if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });
    if (!req.file) {
      return res.status(400).json({ error: "Falta el archivo (campo 'archivo')" });
    }

    const esExcel = /\.xlsx$/i.test(req.file.originalname);

    let filas: Record<string, string>[];
    try {
      filas = esExcel
        ? await leerFilasXlsx(req.file.buffer)
        : parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    } catch (err) {
      return res.status(400).json({ error: `No se pudo leer el archivo: ${(err as Error).message}` });
    }

    const esAdminImportar = req.usuario!.rol === "ADMIN";
    const contratosResult = await pool.query(
      `SELECT c.id, c.proyecto, e.numero_documento
       FROM contratos c JOIN empleados e ON e.id = c.empleado_id
       WHERE c.estado = 'HABIL' ${esAdminImportar ? "" : "AND c.proyecto = ANY($1::text[])"}`,
      esAdminImportar ? [] : [req.usuario!.proyectos]
    );
    const contratosPorDni = new Map<string, { id: number; proyecto: string }[]>();
    for (const fila of contratosResult.rows) {
      const lista = contratosPorDni.get(fila.numero_documento) ?? [];
      lista.push({ id: fila.id, proyecto: fila.proyecto });
      contratosPorDni.set(fila.numero_documento, lista);
    }

    function num(valor: string): number {
      const v = (valor ?? "").trim().replace(",", ".");
      if (!v) return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    }

    const errores: ErrorFilaTareo[] = [];
    let guardados = 0;

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const numeroFila = i + 2;
      const dni = (fila.DNI ?? "").trim();
      if (!dni) {
        errores.push({ fila: numeroFila, dni, motivo: "DNI vacio" });
        continue;
      }
      const candidatos = contratosPorDni.get(dni);
      if (!candidatos || candidatos.length === 0) {
        errores.push({ fila: numeroFila, dni, motivo: "No existe un contrato habil con ese DNI" });
        continue;
      }
      let contrato = candidatos[0];
      if (candidatos.length > 1) {
        const proyecto = (fila.PROYECTO ?? "").trim();
        if (!proyecto) {
          errores.push({
            fila: numeroFila,
            dni,
            motivo: `DNI con ${candidatos.length} contratos habiles activos: agrega la columna PROYECTO para identificar cual`,
          });
          continue;
        }
        const encontrado = candidatos.find((c) => c.proyecto.toLowerCase() === proyecto.toLowerCase());
        if (!encontrado) {
          errores.push({ fila: numeroFila, dni, motivo: `No se encontro un contrato habil en el proyecto '${proyecto}'` });
          continue;
        }
        contrato = encontrado;
      }

      const valores = {
        dias_trabajados: num(fila.DIAS_TRABAJADOS ?? ""),
        dias_dominical: num(fila.DIAS_DOMINICAL ?? ""),
        dias_feriado: num(fila.DIAS_FERIADO ?? ""),
        dias_falta: num(fila.DIAS_FALTA ?? ""),
        horas_extra_25: num(fila.HORAS_EXTRA_25 ?? ""),
        horas_extra_35: num(fila.HORAS_EXTRA_35 ?? ""),
        horas_extra_100: num(fila.HORAS_EXTRA_100 ?? ""),
      };
      const campoInvalido = Object.entries(valores).find(([, v]) => Number.isNaN(v));
      if (campoInvalido) {
        errores.push({ fila: numeroFila, dni, motivo: `Valor invalido en la columna ${campoInvalido[0].toUpperCase()}` });
        continue;
      }

      await guardarAsistencia(req.params.id, { contrato_id: contrato.id, ...valores });
      guardados++;
    }

    res.json({ guardados, errores });
  })
);

// POST /api/periodos/:id/calcular -> calcula la planilla de este periodo a
// partir del tareo ya guardado en asistencia_periodo (pestana Tareo). Solo
// se calculan los trabajadores que tienen tareo cargado, no toda la
// planilla.
// TAREADOR solo carga tareo, no calcula. RESPONSABLE_PLANILLA calcula solo
// los trabajadores de sus proyectos asignados (no toca boletas de otros
// proyectos que haya calculado otro responsable en el mismo periodo).
planillaRouter.post(
  "/:id/calcular",
  requierePermiso("planilla.calcular"),
  asyncHandler(async (req: Request, res: Response) => {
  const cliente = await pool.connect();
  try {
    const periodo = await obtenerPeriodo(req.params.id);
    if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

    const esAdminCalculo = req.usuario!.rol === "ADMIN";
    const asistenciaResult = await pool.query(
      `SELECT a.contrato_id, a.dias_trabajados, a.dias_dominical, a.dias_feriado, a.dias_falta,
              a.horas_extra_25, a.horas_extra_35, a.horas_extra_100,
              a.dias_subsidio_enfermedad, a.dias_subsidio_maternidad, a.dias_licencia_paternidad,
              c.*, e.numero_hijos, e.numero_documento, e.apellidos_nombres,
              COALESCE(p.cuota_sindical_semanal, 0) AS cuota_sindical_semanal
       FROM asistencia_periodo a
       JOIN contratos c ON c.id = a.contrato_id
       JOIN empleados e ON e.id = c.empleado_id
       LEFT JOIN proyectos p ON p.nombre = c.proyecto
       WHERE a.periodo_id = $1 ${esAdminCalculo ? "" : "AND c.proyecto = ANY($2::text[])"}`,
      esAdminCalculo ? [req.params.id] : [req.params.id, req.usuario!.proyectos]
    );
    if (asistenciaResult.rowCount === 0) {
      throw new ErrorValidacion(
        esAdminCalculo
          ? "No hay tareo cargado para este periodo. Ve a la pestana Tareo y sube el archivo antes de calcular."
          : "No hay tareo cargado para tus proyectos en este periodo."
      );
    }

    const parametros = await obtenerParametros(periodo.anio);
    const tablaCategorias = await obtenerTablaCategorias(periodo.anio, periodo.mes);
    const afpTasas = await obtenerAfpTasas(periodo.anio, periodo.mes);
    const conceptos = await obtenerConceptos();

    await cliente.query("BEGIN");

    // Deja detalle_planilla en sincronia exacta con el tareo actual: borra
    // boletas de trabajadores que ya no estan en el tareo de este periodo
    // (ej. quedaron de un calculo anterior con otra lista de trabajadores).
    // Si el usuario no es ADMIN, esta limpieza se limita a sus proyectos
    // para no tocar boletas de otros proyectos calculadas por otro
    // responsable en el mismo periodo.
    await cliente.query(
      `DELETE FROM detalle_planilla d
       USING contratos c
       WHERE d.contrato_id = c.id
         AND d.periodo_id = $1
         AND d.contrato_id NOT IN (SELECT contrato_id FROM asistencia_periodo WHERE periodo_id = $1)
         ${esAdminCalculo ? "" : "AND c.proyecto = ANY($2::text[])"}`,
      esAdminCalculo ? [periodo.id] : [periodo.id, req.usuario!.proyectos]
    );

    const lineasCalculadas = [];
    const erroresCalculo: Array<{ contrato_id: number; dni: string; nombre: string; motivo: string }> = [];
    // Puramente informativo: dias de subsidio/licencia cargados via Tareo
    // Diario para este periodo, que el motor de calculo (mas abajo) NO usa
    // para ningun monto ni aporte todavia (ver migracion_017_tareo_diario.sql).
    // Se avisa aqui para que el responsable los revise a mano.
    const avisosSubsidio: Array<{
      contrato_id: number;
      dni: string;
      nombre: string;
      dias_subsidio_enfermedad: number;
      dias_subsidio_maternidad: number;
      dias_licencia_paternidad: number;
    }> = [];

    for (let i = 0; i < asistenciaResult.rows.length; i++) {
      const fila = asistenciaResult.rows[i];
      const contrato = fila as Contrato & { numero_hijos: number; numero_documento: string; apellidos_nombres: string };

      const diasSubsidioEnfermedad = Number(fila.dias_subsidio_enfermedad) || 0;
      const diasSubsidioMaternidad = Number(fila.dias_subsidio_maternidad) || 0;
      const diasLicenciaPaternidad = Number(fila.dias_licencia_paternidad) || 0;
      if (diasSubsidioEnfermedad > 0 || diasSubsidioMaternidad > 0 || diasLicenciaPaternidad > 0) {
        avisosSubsidio.push({
          contrato_id: contrato.id,
          dni: contrato.numero_documento,
          nombre: contrato.apellidos_nombres,
          dias_subsidio_enfermedad: diasSubsidioEnfermedad,
          dias_subsidio_maternidad: diasSubsidioMaternidad,
          dias_licencia_paternidad: diasLicenciaPaternidad,
        });
      }

      const asistencia = {
        contrato_id: fila.contrato_id,
        dias_trabajados: Number(fila.dias_trabajados),
        dias_dominical: Number(fila.dias_dominical),
        dias_feriado: Number(fila.dias_feriado),
        dias_falta: Number(fila.dias_falta),
        horas_extra_25: Number(fila.horas_extra_25),
        horas_extra_35: Number(fila.horas_extra_35),
        horas_extra_100: Number(fila.horas_extra_100),
      };

      await cliente.query(`SAVEPOINT trabajador_${i}`);
      try {
        const { detalle } = calcularLineaPlanilla(
          contrato,
          contrato.numero_hijos,
          asistencia,
          parametros,
          tablaCategorias,
          afpTasas,
          periodo.dias_periodo,
          periodo.mes,
          periodo.anio,
          Number(fila.cuota_sindical_semanal),
          conceptos
        );

        const r = await cliente.query(
          `INSERT INTO detalle_planilla (
             periodo_id, contrato_id, dias_trabajados, dias_dominical, dias_feriado, dias_falta,
             horas_extra_25, horas_extra_35, horas_extra_100, jornal_diario, sueldo_basico,
             remuneracion_dominical, remuneracion_feriado, importe_horas_extra, asignacion_familiar,
             asignacion_escolaridad, bonificacion_buc, bonificacion_bae, bonificacion_movilidad,
             otras_bonificaciones, gratificacion, bonificacion_extraordinaria, cts, vacaciones,
             total_ingresos, aporte_pension, descuento_sindicato, seguro_vida, conafovicer, renta_5ta,
             otros_descuentos, total_descuentos, essalud, sctr, senati, neto_pagar, detalle_json
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
             $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37
           )
           ON CONFLICT (periodo_id, contrato_id) DO UPDATE SET
             dias_trabajados = EXCLUDED.dias_trabajados,
             dias_dominical = EXCLUDED.dias_dominical,
             dias_feriado = EXCLUDED.dias_feriado,
             dias_falta = EXCLUDED.dias_falta,
             horas_extra_25 = EXCLUDED.horas_extra_25,
             horas_extra_35 = EXCLUDED.horas_extra_35,
             horas_extra_100 = EXCLUDED.horas_extra_100,
             jornal_diario = EXCLUDED.jornal_diario,
             sueldo_basico = EXCLUDED.sueldo_basico,
             remuneracion_dominical = EXCLUDED.remuneracion_dominical,
             remuneracion_feriado = EXCLUDED.remuneracion_feriado,
             importe_horas_extra = EXCLUDED.importe_horas_extra,
             asignacion_familiar = EXCLUDED.asignacion_familiar,
             asignacion_escolaridad = EXCLUDED.asignacion_escolaridad,
             bonificacion_buc = EXCLUDED.bonificacion_buc,
             bonificacion_bae = EXCLUDED.bonificacion_bae,
             bonificacion_movilidad = EXCLUDED.bonificacion_movilidad,
             otras_bonificaciones = EXCLUDED.otras_bonificaciones,
             gratificacion = EXCLUDED.gratificacion,
             bonificacion_extraordinaria = EXCLUDED.bonificacion_extraordinaria,
             cts = EXCLUDED.cts,
             vacaciones = EXCLUDED.vacaciones,
             total_ingresos = EXCLUDED.total_ingresos,
             aporte_pension = EXCLUDED.aporte_pension,
             descuento_sindicato = EXCLUDED.descuento_sindicato,
             seguro_vida = EXCLUDED.seguro_vida,
             conafovicer = EXCLUDED.conafovicer,
             renta_5ta = EXCLUDED.renta_5ta,
             otros_descuentos = EXCLUDED.otros_descuentos,
             total_descuentos = EXCLUDED.total_descuentos,
             essalud = EXCLUDED.essalud,
             sctr = EXCLUDED.sctr,
             senati = EXCLUDED.senati,
             neto_pagar = EXCLUDED.neto_pagar,
             detalle_json = EXCLUDED.detalle_json,
             calculado_en = now()
           RETURNING *`,
          [
            periodo.id,
            detalle.contrato_id,
            detalle.dias_trabajados,
            detalle.dias_dominical,
            detalle.dias_feriado,
            detalle.dias_falta,
            detalle.horas_extra_25,
            detalle.horas_extra_35,
            detalle.horas_extra_100,
            detalle.jornal_diario,
            detalle.sueldo_basico,
            detalle.remuneracion_dominical,
            detalle.remuneracion_feriado,
            detalle.importe_horas_extra,
            detalle.asignacion_familiar,
            detalle.asignacion_escolaridad,
            detalle.bonificacion_buc,
            detalle.bonificacion_bae,
            detalle.bonificacion_movilidad,
            detalle.otras_bonificaciones,
            detalle.gratificacion,
            detalle.bonificacion_extraordinaria,
            detalle.cts,
            detalle.vacaciones,
            detalle.total_ingresos,
            detalle.aporte_pension,
            detalle.descuento_sindicato,
            detalle.seguro_vida,
            detalle.conafovicer,
            detalle.renta_5ta,
            detalle.otros_descuentos,
            detalle.total_descuentos,
            detalle.essalud,
            detalle.sctr,
            detalle.senati,
            detalle.neto_pagar,
            JSON.stringify(detalle.detalle_json),
          ]
        );
        lineasCalculadas.push(r.rows[0]);
      } catch (errFila) {
        if (errFila instanceof ErrorValidacion) throw errFila;
        await cliente.query(`ROLLBACK TO SAVEPOINT trabajador_${i}`);
        erroresCalculo.push({
          contrato_id: contrato.id,
          dni: contrato.numero_documento,
          nombre: contrato.apellidos_nombres,
          motivo: (errFila as Error).message,
        });
      }
    }

    await cliente.query(
      "UPDATE periodos_planilla SET estado = 'CALCULADO' WHERE id = $1",
      [periodo.id]
    );

    await cliente.query("COMMIT");
    await registrarBitacora(req.usuario!.id, "CALCULO_PLANILLA", "periodos_planilla", periodo.id, {
      anio: periodo.anio,
      mes: periodo.mes,
      estado_anterior: periodo.estado,
      recalculo: periodo.estado === "CALCULADO",
      trabajadores_calculados: lineasCalculadas.length,
      errores: erroresCalculo.length,
    });
    res.json({
      periodo_id: periodo.id,
      trabajadores_calculados: lineasCalculadas.length,
      detalle: lineasCalculadas,
      errores: erroresCalculo,
      avisos_subsidio: avisosSubsidio,
    });
  } catch (err) {
    await cliente.query("ROLLBACK");
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  } finally {
    cliente.release();
  }
}));
