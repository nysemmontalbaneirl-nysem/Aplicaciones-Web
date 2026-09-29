import { Router, Request, Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import {
  calcularLineaPlanilla,
  calcularTramosMes,
  diasEntreFechas,
  esConstruccionCivil,
  periodoCruzaMes,
  ResultadoCalculoLinea,
  sumarResultadosLinea,
} from "../motorCalculo";
import { obtenerConceptos } from "./conceptos";
import { tieneAccesoProyecto } from "../permisos";
import { AsistenciaEntrada, Contrato, ParametrosNormativos, TablaSalarialMensual, TasasAFPMensuales } from "../tipos";
import { ErrorValidacion } from "../validaciones";
import { registrarBitacora } from "../bitacora";
import { generarPdfTabla } from "../pdfTabla";
import { DetalleBoletaPdf, generarPdfBoletas, generarZipBoletas } from "../boletaPdf";
import { obtenerDatosEmpresaBoleta } from "./empresa";

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

export async function obtenerTablaCategorias(anio: number, mes: number): Promise<TablaSalarialMensual> {
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
            c.cuspp, c.fecha_ingreso, c.fecha_cese,
            (e.firma_archivo IS NOT NULL) AS tiene_firma
     FROM detalle_planilla d
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     WHERE ${condiciones.join(" AND ")}
     ORDER BY e.apellidos_nombres ASC`,
    valores
  );
  return { periodo, detalle: resultado.rows };
}

// Adjunta los montos de conceptos PERSONALIZADOS (formula propia, "Ronda D",
// migracion 033) a cada fila de detalle (por id de detalle_planilla o de
// detalle_planilla_mensual). Estos montos se calculan y se guardan UNA sola
// vez al calcular/consolidar (con la formula vigente en ese momento) y no se
// recalculan despues aunque el concepto cambie de formula o se desactive -
// misma foto historica que el resto de detalle_planilla.
// NOTA (recon 23/46): la definicion original (version de un solo argumento)
// de esta funcion no llego en ninguno de los 46 parches recuperados - se
// reconstruyo aqui a partir del contexto disponible en el parche que la
// modifica (b2d02632, migracion 037) mas los usos ya existentes en
// planillaMensual.ts/db871772 y el test nuevo de ese mismo parche
// (tests/planilla_mensual_conceptos_personalizados.test.ts), que fijan la
// forma exacta del resultado esperado (conceptos_personalizados: {codigo,
// nombre, tipo, monto}[] por fila). Ver RECONSTRUCCION_BRECHAS.md.
export async function agregarConceptosPersonalizadosBatch<T extends { id: number }>(
  filas: T[],
  tablaDetalleConceptos: "detalle_planilla_conceptos" | "detalle_planilla_conceptos_mensual" = "detalle_planilla_conceptos"
): Promise<T[]> {
  if (filas.length === 0) return filas;
  const detalleIds = filas.map((f) => f.id);
  // tablaDetalleConceptos: la Planilla Mensual Consolidada (Ronda E) guarda
  // sus montos personalizados en su propia tabla espejo
  // (detalle_planilla_conceptos_mensual, referenciando detalle_planilla_mensual.id)
  // en vez de detalle_planilla_conceptos - el nombre de la tabla viene
  // fijo de una lista blanca (nunca interpolado desde el usuario), asi que
  // no hay riesgo de inyeccion SQL al armarlo en el string de la query.
  const r = await pool.query<{ detalle_id: number; codigo: string; nombre: string; tipo: "INGRESO" | "APORTE" | "DESCUENTO"; monto: string }>(
    `SELECT dpc.detalle_id, cp.codigo, cp.nombre, cp.tipo, dpc.monto
     FROM ${tablaDetalleConceptos} dpc
     JOIN conceptos_planilla cp ON cp.codigo = dpc.concepto_codigo
     WHERE dpc.detalle_id = ANY($1::int[])
     ORDER BY cp.orden`,
    [detalleIds]
  );
  const porDetalle = new Map<number, { codigo: string; nombre: string; tipo: "INGRESO" | "APORTE" | "DESCUENTO"; monto: number }[]>();
  for (const fila of r.rows) {
    const lista = porDetalle.get(fila.detalle_id) ?? [];
    lista.push({ codigo: fila.codigo, nombre: fila.nombre, tipo: fila.tipo, monto: Number(fila.monto) });
    porDetalle.set(fila.detalle_id, lista);
  }
  return filas.map((fila) => ({ ...fila, conceptos_personalizados: porDetalle.get(fila.id) ?? [] }));
}

// Adjunta firma_archivo/firma_mime a cada fila (por contrato_id -> empleado)
// SOLO para las filas que efectivamente se van a convertir en PDF (boletas/
// pdf, boletas/zip) - migracion 031. No se agrega a obtenerDetallePeriodo
// de arriba porque esa funcion tambien alimenta /planilla, /planilla/excel
// y /planilla/pdf (el resumen tabular), que no necesitan la imagen y no
// deben cargarla en cada listado.
async function agregarFirmasBatch<T extends { contrato_id: number }>(filas: T[]): Promise<T[]> {
  if (filas.length === 0) return filas;
  const contratoIds = filas.map((f) => f.contrato_id);
  const r = await pool.query(
    `SELECT c.id AS contrato_id, e.firma_archivo, e.firma_mime
     FROM contratos c JOIN empleados e ON e.id = c.empleado_id
     WHERE c.id = ANY($1::int[])`,
    [contratoIds]
  );
  const porContrato = new Map(r.rows.map((row) => [row.contrato_id, row]));
  return filas.map((fila) => ({ ...fila, ...(porContrato.get(fila.contrato_id) ?? {}) }));
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

// Filtra el listado de boletas de un periodo (ya resuelto por
// obtenerDetallePeriodo, que ya aplica el acceso por proyecto del usuario)
// por una lista opcional de ids separados por coma (?ids=12,15,20) - si no
// se manda "ids", se exportan TODAS las boletas del periodo (respetando el
// mismo filtro ?q= que ya usan los demas exportes de este archivo).
function filtrarPorIds<T extends { id: number }>(detalle: T[], idsParam: string | undefined): T[] {
  if (!idsParam || !idsParam.trim()) return detalle;
  const ids = new Set(
    idsParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n))
  );
  return detalle.filter((d) => ids.has(d.id));
}

// GET /api/periodos/:id/boletas/pdf?ids=1,2,3&q=texto -> descarga UN SOLO
// PDF con las boletas seleccionadas (o todas las del periodo si no se
// manda "ids"), cada una en su propio formato completo de boleta de pago
// (no el resumen tabular de /planilla/pdf de mas arriba). Pedido explicito
// del usuario (sept. 2026): antes solo se podia "Imprimir seleccionadas"
// desde el navegador (window.print()), sin poder guardar un archivo PDF
// real de esas boletas.
planillaRouter.get(
  "/:id/boletas/pdf",
  requierePermiso("boletas.ver"),
  asyncHandler(async (req: Request, res: Response) => {
    const datos = await obtenerDetallePeriodo(req.params.id, req.query.q as string | undefined, req.usuario!);
    if (!datos) return res.status(404).json({ error: "Periodo no encontrado" });
    const { periodo, detalle } = datos;

    let filas = filtrarPorIds(detalle, req.query.ids as string | undefined);
    if (filas.length === 0) {
      return res.status(400).json({ error: "No hay boletas para exportar (revisa la seleccion o el periodo)" });
    }
    filas = await agregarFirmasBatch(filas);
    const datosEmpresa = await obtenerDatosEmpresaBoleta();

    const buffer = await generarPdfBoletas(filas as unknown as DetalleBoletaPdf[], periodo, datosEmpresa);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="boletas_${periodo.mes}_${periodo.anio}.pdf"`);
    res.send(buffer);
  })
);

// GET /api/periodos/:id/boletas/zip?ids=1,2,3&q=texto -> descarga un ZIP
// con un PDF POR TRABAJADOR (mismo criterio que ids/q de la ruta de
// arriba). Pedido explicito del usuario (sept. 2026): poder guardar las
// boletas de un periodo en archivos PDF individuales, comprimidos en un
// solo ZIP, en vez de descargarlas una por una o solo poder enviarlas por
// correo.
planillaRouter.get(
  "/:id/boletas/zip",
  requierePermiso("boletas.ver"),
  asyncHandler(async (req: Request, res: Response) => {
    const datos = await obtenerDetallePeriodo(req.params.id, req.query.q as string | undefined, req.usuario!);
    if (!datos) return res.status(404).json({ error: "Periodo no encontrado" });
    const { periodo, detalle } = datos;

    let filas = filtrarPorIds(detalle, req.query.ids as string | undefined);
    if (filas.length === 0) {
      return res.status(400).json({ error: "No hay boletas para exportar (revisa la seleccion o el periodo)" });
    }
    filas = await agregarFirmasBatch(filas);
    const datosEmpresa = await obtenerDatosEmpresaBoleta();

    const buffer = await generarZipBoletas(filas as unknown as DetalleBoletaPdf[], periodo, datosEmpresa);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="boletas_${periodo.mes}_${periodo.anio}.zip"`);
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
  // Subconjunto de dias_subsidio_enfermedad que cuenta como "dia
  // computable" para Gratificacion/Vacaciones/CTS/Asignacion por
  // Escolaridad, topado a 60 dias/año por contrato (migracion 032). Mismo
  // criterio opcional que los demas campos agregados desde Tareo Diario:
  // solo lo calcula agregarTareoDiario; la edicion manual de totales no lo
  // toca. Ver el comentario completo en tipos.ts
  // (AsistenciaEntrada.dias_subsidio_enfermedad_computable).
  dias_subsidio_enfermedad_computable?: number | null;
  // Migracion 038: subconjunto del dia 21 en adelante (por año calendario y
  // por contrato) de dias marcados "DESCANSO_MEDICO" - se paga como
  // subsidio de EsSalud, no como dia normal de trabajo (ver el comentario
  // completo en agregarTareoDiario, mas abajo). Mismo criterio opcional que
  // los demas campos agregados desde Tareo Diario.
  dias_incapacidad_enfermedad?: number | null;
}

async function guardarAsistencia(periodoId: string, fila: FilaAsistencia) {
  await pool.query(
    `INSERT INTO asistencia_periodo (
       periodo_id, contrato_id, dias_trabajados, dias_dominical, dias_feriado,
       dias_falta, horas_extra_25, horas_extra_35, horas_extra_100,
       dias_subsidio_enfermedad, dias_subsidio_maternidad, dias_licencia_paternidad,
       dias_subsidio_enfermedad_computable, dias_incapacidad_enfermedad
     -- El "0" de respaldo en cada COALESCE debe llevar el cast ::numeric:
     -- sin el, Postgres infiere el TIPO del parametro ($10-$14) a partir del
     -- literal "0" (entero) en vez de la columna destino (numeric), y luego
     -- rechaza cualquier valor con decimales con "invalid input syntax for
     -- integer" - el destino real de la columna no importa para esto, el
     -- tipo del parametro ya quedo fijado como integer desde el parseo de
     -- la sentencia.
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,0::numeric),COALESCE($11,0::numeric),COALESCE($12,0::numeric),COALESCE($13,0::numeric),COALESCE($14,0::numeric))
     ON CONFLICT (periodo_id, contrato_id) DO UPDATE SET
       dias_trabajados = EXCLUDED.dias_trabajados,
       dias_dominical = EXCLUDED.dias_dominical,
       dias_feriado = EXCLUDED.dias_feriado,
       dias_falta = EXCLUDED.dias_falta,
       horas_extra_25 = EXCLUDED.horas_extra_25,
       horas_extra_35 = EXCLUDED.horas_extra_35,
       horas_extra_100 = EXCLUDED.horas_extra_100,
       -- $10/$11/$12/$13/$14 en null = "no tocar" (lo manda la edicion manual
       -- de totales, que no conoce estos campos); un numero explicito
       -- (incluido 0) si viene, por ejemplo, del recalculo desde tareo_diario.
       dias_subsidio_enfermedad = COALESCE($10, asistencia_periodo.dias_subsidio_enfermedad),
       dias_subsidio_maternidad = COALESCE($11, asistencia_periodo.dias_subsidio_maternidad),
       dias_licencia_paternidad = COALESCE($12, asistencia_periodo.dias_licencia_paternidad),
       dias_subsidio_enfermedad_computable = COALESCE($13, asistencia_periodo.dias_subsidio_enfermedad_computable),
       dias_incapacidad_enfermedad = COALESCE($14, asistencia_periodo.dias_incapacidad_enfermedad),
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
      fila.dias_subsidio_enfermedad_computable ?? null,
      fila.dias_incapacidad_enfermedad ?? null,
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
  // Ronda C: un periodo especifico de un proyecto no puede recibir tareo de
  // un contrato de OTRO proyecto (un periodo legado, proyecto NULL, sigue
  // aceptando cualquiera).
  if (periodo.proyecto && contratoResult.rows[0].proyecto !== periodo.proyecto) {
    return res.status(400).json({
      error:
        `Este periodo es especifico del proyecto "${periodo.proyecto}" y el contrato pertenece a ` +
        `"${contratoResult.rows[0].proyecto}".`,
    });
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

// Migracion 038: "SUBSIDIO_ENFERMEDAD" se renombro a "DESCANSO_MEDICO" (el
// nombre real de lo que se marca en el Tareo Diario: un dia de descanso
// medico por enfermedad, sin importar si termina pagandose como dia normal
// -primeros 20 dias/año- o como incapacidad subsidiada por EsSalud -del 21
// en adelante-, division que ahora se resuelve automaticamente en
// agregarTareoDiario, ver routes/planilla.ts mas abajo). No existe un tipo
// de dia separado para "incapacidad": es el MISMO dia marcado el que, segun
// el acumulado del año, se paga de una forma u otra.
const TIPOS_DIA_ESPECIAL = [
  "FALTA",
  "DESCANSO_MEDICO",
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

// Nombres de los campos de horas/minutos de FilaTareoDiario - se usan para
// validar que sean enteros antes de guardarlos (tareo_diario los tiene como
// columnas INT; ver PUT /:id/tareo-diario/:contratoId).
const CAMPOS_HORAS = [
  "horas_normales",
  "horas_dominical",
  "horas_feriado",
  "horas_extra_tramo1",
  "horas_extra_tramo2",
  "horas_extra_tramo3",
] as const satisfies readonly (keyof FilaTareoDiario)[];
const CAMPOS_MINUTOS = [
  "minutos_normales",
  "minutos_dominical",
  "minutos_feriado",
  "minutos_extra_tramo1",
  "minutos_extra_tramo2",
  "minutos_extra_tramo3",
] as const satisfies readonly (keyof FilaTareoDiario)[];

function redondear2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Normaliza una fecha de columna DATE (que pg puede devolver como objeto
 * Date, o ya como string en algunos drivers/consultas) al formato
 * "YYYY-MM-DD" que esperan periodoCruzaMes/calcularTramosMes/diasEntreFechas
 * (motorCalculo.ts, Ronda 3). El servidor corre en UTC (confirmado), asi
 * que toISOString() no desfasa el dia.
 */
export function fechaISO(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * Suma todas las filas de tareo_diario de un contrato, en el rango
 * [fechaDesde, fechaHasta], en los totales que espera asistencia_periodo.
 * Los conceptos que hoy se guardan en "dias" (jornal normal, dominical,
 * feriado) se obtienen dividiendo el total de horas entre 8 (jornada
 * estandar) - mismo criterio que ya tolera dias_trabajados fraccionario en
 * el resto del sistema (ver comentarios de motorCalculo.ts sobre dias
 * redondeados).
 *
 * NOTA (recon 11/46): separada de recalcularAsistenciaDesdeTareoDiario para
 * que el tramo-por-tramo de un periodo que cruza de mes (Ronda 3, ver
 * calcularTramosMes en motorCalculo.ts) pueda pedir el tareo diario de SOLO
 * un tramo a la vez, sin tener que releer el periodo completo cada vez.
 */
export async function agregarTareoDiario(
  periodoId: string | number,
  contratoId: number,
  fechaDesde: string,
  fechaHasta: string
): Promise<Omit<AsistenciaEntrada, "contrato_id">> {
  const r = await pool.query(
    `SELECT horas_normales, minutos_normales, horas_dominical, minutos_dominical,
            horas_feriado, minutos_feriado, horas_extra_tramo1, minutos_extra_tramo1,
            horas_extra_tramo2, minutos_extra_tramo2, horas_extra_tramo3, minutos_extra_tramo3,
            tipo_dia_especial
     FROM tareo_diario WHERE periodo_id = $1 AND contrato_id = $2 AND fecha BETWEEN $3 AND $4`,
    [periodoId, contratoId, fechaDesde, fechaHasta]
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
      case "DESCANSO_MEDICO":
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

  // Migracion 032: tope de 60 dias/año calendario por CONTRATO para que un
  // dia de descanso medico cuente como "dia computable" en Gratificacion/
  // Vacaciones/CTS/Asignacion por Escolaridad (eje LEGAL DISTINTO al tope de
  // 20 dias/año de la migracion 038 sobre quien PAGA el dia, ver abajo - no
  // confundir). Se cuentan los dias de DESCANSO_MEDICO ya marcados en OTROS
  // periodos del MISMO año calendario de fechaDesde (fuera del rango
  // [fechaDesde, fechaHasta] que se esta procesando aqui, para no contar dos
  // veces los de este mismo tramo/periodo), y se topa lo que este periodo
  // puede aportar para que el acumulado del año no supere 60.
  // Simplificacion documentada: si un periodo cruzara de año calendario
  // (caso muy raro en quincenal/semanal), se usa el año de fechaDesde para
  // todo el rango. Esta MISMA consulta (diasYaMarcadosEnElAnio) tambien se
  // reutiliza abajo para la division de 20 dias (migracion 038) - es el
  // mismo acumulado anual de dias marcados, con un tope distinto cada vez.
  const anioVigente = Number(fechaDesde.slice(0, 4));
  let diasSubsidioEnfermedadComputable = 0;
  // Migracion 038: division automatica entre "Dias de Descanso Medico"
  // (primeros 20 dias/año por contrato, a cargo del EMPLEADOR, casilla PLAME
  // 0121 - se paga y se afecta a aportes igual que un dia normal de
  // trabajo, confirmado con el usuario) y "Dias por Incapacidad por
  // Enfermedad" (del dia 21 en adelante, subsidiados por EsSalud
  // directamente al trabajador fuera de planilla, casilla PLAME 0916 -
  // mismas afectaciones que ya tenia el concepto antes de esta migracion).
  // Antes de esta migracion, el sistema BLOQUEABA el registro de mas de 20
  // dias/año (ver el bloqueo ya eliminado en PUT /:id/tareo-diario/:contratoId)
  // y, por un error de diseño de la migracion 030 original, TODOS los dias
  // marcados (incluidos los primeros 20) se calculaban con el tratamiento
  // tributario del dia 21+ - bug real reportado por el usuario en
  // produccion. Ahora la division es automatica: no se le pide al usuario
  // elegir un tipo de dia distinto para el dia 21, se resuelve aqui con el
  // mismo acumulado anual por contrato que ya usa el tope de 60 dias
  // computable de arriba (misma consulta, tope distinto: 20 en vez de 60).
  let diasDescansoMedicoNormal = diasSubsidioEnfermedad;
  let diasIncapacidadEnfermedad = 0;
  if (diasSubsidioEnfermedad > 0) {
    const acreditadosResult = await pool.query(
      `SELECT COUNT(*)::int AS dias FROM tareo_diario
       WHERE contrato_id = $1 AND tipo_dia_especial = 'DESCANSO_MEDICO'
         AND EXTRACT(YEAR FROM fecha) = $2
         AND fecha NOT BETWEEN $3 AND $4`,
      [contratoId, anioVigente, fechaDesde, fechaHasta]
    );
    const diasYaMarcadosEnElAnio = Number(acreditadosResult.rows[0]?.dias ?? 0);
    diasSubsidioEnfermedadComputable = Math.max(0, Math.min(diasSubsidioEnfermedad, 60 - diasYaMarcadosEnElAnio));

    const cupoNormalDisponible = Math.max(0, 20 - diasYaMarcadosEnElAnio);
    diasDescansoMedicoNormal = Math.min(diasSubsidioEnfermedad, cupoNormalDisponible);
    diasIncapacidadEnfermedad = diasSubsidioEnfermedad - diasDescansoMedicoNormal;
  }

  return {
    dias_trabajados: redondear2(horasNormales / 8),
    dias_dominical: redondear2(horasDominical / 8),
    dias_feriado: redondear2(horasFeriado / 8),
    dias_falta: diasFalta,
    horas_extra_25: redondear2(horasTramo1),
    horas_extra_35: redondear2(horasTramo2),
    horas_extra_100: redondear2(horasTramo3),
    // Ver comentario de la migracion 038 arriba: dias_subsidio_enfermedad
    // (nombre de columna/campo sin cambios, por compatibilidad) pasa a
    // representar SOLO el bucket "Dias de Descanso Medico" (<=20/año,
    // concepto DESCANSO_MEDICO); el resto del dia 21 en adelante va en el
    // campo nuevo dias_incapacidad_enfermedad (concepto INCAPACIDAD_ENFERMEDAD).
    dias_subsidio_enfermedad: diasDescansoMedicoNormal,
    dias_incapacidad_enfermedad: diasIncapacidadEnfermedad,
    dias_subsidio_maternidad: diasSubsidioMaternidad,
    dias_licencia_paternidad: diasLicenciaPaternidad,
    dias_subsidio_enfermedad_computable: diasSubsidioEnfermedadComputable,
  };
}

/**
 * Envoltorio de agregarTareoDiario que cubre el periodo COMPLETO (fecha_inicio
 * a fecha_fin de periodos_planilla) y guarda el resultado en
 * asistencia_periodo via guardarAsistencia() - el mismo flujo que usan la
 * carga por Excel y la edicion manual de totales.
 */
async function recalcularAsistenciaDesdeTareoDiario(periodoId: string, contratoId: number) {
  const periodo = await obtenerPeriodo(periodoId);
  if (!periodo) return;
  const valores = await agregarTareoDiario(periodoId, contratoId, fechaISO(periodo.fecha_inicio), fechaISO(periodo.fecha_fin));
  await guardarAsistencia(periodoId, { contrato_id: contratoId, ...valores });
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
    // Ronda C: un periodo especifico de un proyecto (periodo.proyecto no
    // nulo) no puede recibir tareo de un contrato de OTRO proyecto - un
    // periodo legado (proyecto NULL) sigue aceptando cualquiera, igual que
    // siempre.
    if (periodo.proyecto && proyecto !== periodo.proyecto) {
      return res.status(400).json({
        error: `Este periodo es especifico del proyecto "${periodo.proyecto}" y el contrato pertenece a "${proyecto}".`,
      });
    }

    const dias = (req.body?.dias ?? []) as FilaTareoDiario[];
    if (!Array.isArray(dias)) {
      return res.status(400).json({ error: "El campo 'dias' debe ser un arreglo" });
    }
    // Error real visto en produccion: un valor decimal (ej. "1.13", probablemente
    // alguien escribiendo "1 hora 13 minutos" en el campo de horas) llegaba
    // hasta el INSERT y Postgres lo rechazaba con un mensaje crudo ("la sintaxis
    // de entrada no es valida para integer") porque las columnas horas_*/minutos_*
    // de tareo_diario son INT. Se valida aqui antes de tocar la base de datos,
    // para devolver un error claro en vez de ese 500 crudo.
    for (const d of dias) {
      if (!d.fecha || Number.isNaN(Date.parse(d.fecha))) {
        return res.status(400).json({ error: `Fecha invalida: ${d.fecha}` });
      }
      if (d.tipo_dia_especial && !TIPOS_DIA_ESPECIAL.includes(d.tipo_dia_especial)) {
        return res.status(400).json({ error: `tipo_dia_especial invalido: ${d.tipo_dia_especial}` });
      }
      for (const campo of CAMPOS_HORAS) {
        const v = d[campo];
        if (v === undefined || v === null) continue;
        if (!Number.isInteger(v) || v < 0) {
          return res.status(400).json({
            error: `El campo "${campo}" debe ser un numero entero de horas (valor recibido: ${v}) en la fecha ${d.fecha.slice(0, 10)}`,
          });
        }
      }
      for (const campo of CAMPOS_MINUTOS) {
        const v = d[campo];
        if (v === undefined || v === null) continue;
        if (!Number.isInteger(v) || v < 0 || v > 59) {
          return res.status(400).json({
            error: `El campo "${campo}" debe ser un numero entero de minutos entre 0 y 59 (valor recibido: ${v}) en la fecha ${d.fecha.slice(0, 10)}`,
          });
        }
      }
    }

    // Migracion 040: limites configurables de horas/minutos por dia
    // (Configuracion -> Limites de tareo), a pedido explicito del usuario -
    // se valida la SUMA de TODAS las columnas de horas (y, por separado, de
    // minutos) de cada dia contra el limite del tipo de dia que corresponda.
    // Domingo queda sin limite (no forma parte de "lunes a viernes"/"sabado"
    // en el pedido original - ya se paga aparte como "domingo trabajado").
    const limitesResult = await pool.query("SELECT * FROM limites_tareo WHERE id = 1");
    const limites = limitesResult.rows[0];
    for (const d of dias) {
      const diaSemana = new Date(d.fecha.slice(0, 10) + "T00:00:00Z").getUTCDay(); // 0=domingo .. 6=sabado
      if (diaSemana === 0) continue;
      const esSabado = diaSemana === 6;
      const horasMax = Number(esSabado ? limites.horas_max_sabado : limites.horas_max_lun_vie);
      const minutosMax = Number(esSabado ? limites.minutos_max_sabado : limites.minutos_max_lun_vie);
      const sumaHoras = CAMPOS_HORAS.reduce((acc, campo) => acc + Number(d[campo] ?? 0), 0);
      const sumaMinutos = CAMPOS_MINUTOS.reduce((acc, campo) => acc + Number(d[campo] ?? 0), 0);
      const etiquetaDia = esSabado ? "sabado" : "dia (lunes a viernes)";
      if (sumaHoras > horasMax) {
        return res.status(400).json({
          error:
            `El ${etiquetaDia} ${d.fecha.slice(0, 10)} suma ${sumaHoras} horas entre todos los campos de ese dia, ` +
            `y el limite configurado es ${horasMax} horas (Configuracion -> Limites de tareo).`,
        });
      }
      if (sumaMinutos > minutosMax) {
        return res.status(400).json({
          error:
            `El ${etiquetaDia} ${d.fecha.slice(0, 10)} suma ${sumaMinutos} minutos entre todos los campos de ese dia, ` +
            `y el limite configurado es ${minutosMax} minutos (Configuracion -> Limites de tareo).`,
        });
      }
    }

    // Migracion 038: ANTES de esta migracion, aqui se BLOQUEABA el registro
    // completo si el contrato superaba 20 dias/año de "SUBSIDIO_ENFERMEDAD"
    // marcados (D.S. 009-97-SA) - por un error de diseño de la migracion 030
    // original, ese bloqueo ademas escondia un bug real: los dias 1-20
    // (pagados por el EMPLEADOR, como un dia normal de trabajo) se
    // calculaban con el tratamiento tributario del dia 21+ (subsidiado por
    // EsSalud, fuera de planilla), reportado por el usuario en produccion.
    // Ahora el dia 21 en adelante SI se puede registrar: se guarda con el
    // mismo tipo de dia especial ("DESCANSO_MEDICO", ver TIPOS_DIA_ESPECIAL),
    // y es agregarTareoDiario (mas abajo, al calcular la planilla) quien
    // divide automaticamente, por contrato y por año calendario, cuantos de
    // esos dias se pagan como "Dias de Descanso Medico" (primeros 20,
    // casilla PLAME 0121) y cuantos como "Dias por Incapacidad por
    // Enfermedad" (del 21 en adelante, casilla PLAME 0916) - ver el
    // comentario completo alli. Ya no hace falta bloquear nada aqui.
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

      // Ronda C: un periodo especifico de un proyecto no puede recibir
      // tareo de un contrato de OTRO proyecto (un periodo legado, proyecto
      // NULL, sigue aceptando cualquiera).
      if (periodo.proyecto && contrato.proyecto !== periodo.proyecto) {
        errores.push({
          fila: numeroFila,
          dni,
          motivo: `Este periodo es especifico del proyecto '${periodo.proyecto}' y el contrato pertenece a '${contrato.proyecto}'`,
        });
        continue;
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
              a.dias_subsidio_enfermedad, a.dias_incapacidad_enfermedad, a.dias_subsidio_maternidad, a.dias_licencia_paternidad,
              a.dias_subsidio_enfermedad_computable,
              c.*, e.numero_hijos, e.numero_documento, e.apellidos_nombres,
              -- migracion_029: cuota_sindical_categoria (proyecto+categoria) tiene
              -- prioridad; si esa combinacion todavia no esta configurada, se cae
              -- al valor unico legado de proyectos.cuota_sindical_semanal (nunca
              -- se deja de descontar por accidente por una combinacion sin
              -- configurar, ej. un proyecto recien creado).
              COALESCE(csc.monto_semanal, p.cuota_sindical_semanal, 0) AS cuota_sindical_semanal
       FROM asistencia_periodo a
       JOIN contratos c ON c.id = a.contrato_id
       JOIN empleados e ON e.id = c.empleado_id
       LEFT JOIN proyectos p ON p.nombre = c.proyecto
       LEFT JOIN cuota_sindical_categoria csc ON csc.proyecto_id = p.id AND csc.categoria = c.categoria_ocupacional
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

    // Ronda 3: si el periodo cruza de mes calendario (tipico en quincenas/
    // semanas, ej. 24/08-06/09), el calculo de cada contrato CON Tareo
    // Diario cargado se parte en tramos de mes calendario - cada uno con su
    // propia tabla salarial/tasas AFP - y se suman (ver
    // periodoCruzaMes/calcularTramosMes/sumarResultadosLinea en
    // motorCalculo.ts). Un contrato sin Tareo Diario (solo carga en bloque,
    // sin fecha por dia) no tiene forma de saber que parte de su asistencia
    // cae en cada tramo, asi que sigue usando el comportamiento anterior
    // (una sola tabla, la del mes de inicio) y se avisa para revisar a mano.
    const fechaInicioPeriodo = fechaISO(periodo.fecha_inicio);
    const fechaFinPeriodo = fechaISO(periodo.fecha_fin);
    const cruzaMes = periodoCruzaMes(fechaInicioPeriodo, fechaFinPeriodo);
    const tramosPeriodo = cruzaMes ? calcularTramosMes(fechaInicioPeriodo, fechaFinPeriodo) : [];
    const contratosConTareoDiarioResult = cruzaMes
      ? await pool.query("SELECT DISTINCT contrato_id FROM tareo_diario WHERE periodo_id = $1", [periodo.id])
      : { rows: [] as { contrato_id: number }[] };
    const contratosConTareoDiario = new Set(contratosConTareoDiarioResult.rows.map((f) => f.contrato_id));
    // Cache de parametros/tabla salarial/tasas AFP por tramo de mes, para no
    // volver a consultarlos por cada trabajador que toque el mismo tramo.
    const cacheConfigTramo = new Map<
      string,
      { parametros: ParametrosNormativos; tablaCategorias: TablaSalarialMensual; afpTasas: TasasAFPMensuales }
    >();
    async function obtenerConfigTramo(anio: number, mes: number) {
      const clave = `${anio}-${mes}`;
      let config = cacheConfigTramo.get(clave);
      if (!config) {
        config = {
          parametros: await obtenerParametros(anio),
          tablaCategorias: await obtenerTablaCategorias(anio, mes),
          afpTasas: await obtenerAfpTasas(anio, mes),
        };
        cacheConfigTramo.set(clave, config);
      }
      return config;
    }
    // Puramente informativo (Ronda 3): un contrato con tareo cargado solo
    // en bloque (sin fecha por dia) en un periodo que cruza de mes - no se
    // puede saber que parte de su asistencia corresponde a cada tramo, asi
    // que se calcula con una sola tabla (la del mes de inicio) y se avisa
    // para revisar a mano si el jornal/tabla cambio de un mes a otro.
    const avisosCruceMes: Array<{ contrato_id: number; dni: string; nombre: string; mensaje: string }> = [];

    // NOTA (recon 31/46): el parche original (migracion 042, "ambito
    // geografico de feriados") agregaba aqui un aviso informativo
    // avisosUbicacionFeriados, calculado consultando la tabla
    // "dias_feriados" (columna "ambito", REGIONAL/LOCAL) y comparandola
    // contra la ubicacion UBIGEO del proyecto. Se omite por completo: la
    // tabla "dias_feriados" (el catalogo de feriados en si, con su propia
    // pantalla CRUD dentro de Configuracion) NUNCA existio en este arbol -
    // ninguno de los 46 parches recuperados la crea, y el feriado se
    // registra hoy a mano por el tareador (horas_feriado/minutos_feriado
    // en el Tareo Diario), sin un calendario central. Sin esa tabla, el
    // resto de este parche (ambito NACIONAL/REGIONAL/LOCAL, deteccion
    // automatica de que feriado aplica a que proyecto) no tiene ninguna
    // base sobre la que reconstruirse - ver RECONSTRUCCION_BRECHAS.md
    // punto 15. Se conservan unicamente las columnas UBIGEO agregadas a
    // "proyectos" (schema.sql/routes/proyectos.ts/Proyectos.tsx), que no
    // dependen de "dias_feriados" y quedan listas para cuando ese catalogo
    // se reconstruya en el futuro.
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
    // Dias de subsidio/licencia cargados via Tareo Diario para este periodo.
    // Desde la migracion 025 SI entran al motor de calculo (dias computables
    // de la gratificacion, ver calcularGratificacion en motorCalculo.ts) y
    // desde la migracion 030 (corregida en la 038) el descanso
    // medico/incapacidad/licencia por paternidad SI se pagan de verdad, con
    // la division automatica de 20 dias/año ya aplicada - este aviso queda
    // como informativo/de revision, no indica que algo quedo sin calcular.
    const avisosSubsidio: Array<{
      contrato_id: number;
      dni: string;
      nombre: string;
      dias_subsidio_enfermedad: number;
      dias_incapacidad_enfermedad: number;
      dias_subsidio_maternidad: number;
      dias_licencia_paternidad: number;
    }> = [];
    // Puramente informativo (migracion_018): un contrato de regimen general
    // (EMPLEADO, no construccion civil) quedo con tareo en un periodo que
    // NO es MENSUAL. El regimen general esta pensado para pagarse siempre
    // por mes calendario completo - un periodo semanal/quincenal para ese
    // regimen no ajusta el prorrateo de asignacion familiar ni la
    // compuerta de gratificacion/CTS por mes (mes===7/12, mes===5/11), asi
    // que el monto calculado podria no ser el correcto. No se bloquea ni
    // se cambia ningun monto: solo se avisa para que se revise a mano.
    const avisosRegimen: Array<{
      contrato_id: number;
      dni: string;
      nombre: string;
      mensaje: string;
    }> = [];

    for (let i = 0; i < asistenciaResult.rows.length; i++) {
      const fila = asistenciaResult.rows[i];
      const contrato = fila as Contrato & { numero_hijos: number; numero_documento: string; apellidos_nombres: string };

      if (!esConstruccionCivil(contrato.categoria_ocupacional) && periodo.tipo !== "MENSUAL") {
        avisosRegimen.push({
          contrato_id: contrato.id,
          dni: contrato.numero_documento,
          nombre: contrato.apellidos_nombres,
          mensaje:
            "Trabajador de regimen general en un periodo no mensual: revisar a mano la asignacion familiar, gratificacion y CTS de este periodo.",
        });
      }

      const diasSubsidioEnfermedad = Number(fila.dias_subsidio_enfermedad) || 0;
      const diasIncapacidadEnfermedad = Number(fila.dias_incapacidad_enfermedad) || 0;
      const diasSubsidioMaternidad = Number(fila.dias_subsidio_maternidad) || 0;
      const diasLicenciaPaternidad = Number(fila.dias_licencia_paternidad) || 0;
      if (diasSubsidioEnfermedad > 0 || diasIncapacidadEnfermedad > 0 || diasSubsidioMaternidad > 0 || diasLicenciaPaternidad > 0) {
        avisosSubsidio.push({
          contrato_id: contrato.id,
          dni: contrato.numero_documento,
          nombre: contrato.apellidos_nombres,
          dias_subsidio_enfermedad: diasSubsidioEnfermedad,
          dias_incapacidad_enfermedad: diasIncapacidadEnfermedad,
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
        // Migracion 030: dias_subsidio_maternidad se pasa solo para dejar
        // completa la interfaz AsistenciaEntrada (se mantiene puramente
        // informativo, ver avisosSubsidio mas arriba) - dias_subsidio_enfermedad
        // y dias_licencia_paternidad si generan pago (calcularLineaPlanilla).
        dias_subsidio_enfermedad: diasSubsidioEnfermedad,
        // Migracion 038: dia 21 en adelante (por año calendario y por
        // contrato) de dias marcados "DESCANSO_MEDICO" - se paga como
        // incapacidad subsidiada por EsSalud, no como dia normal de
        // trabajo. Ver el comentario completo en agregarTareoDiario.
        dias_incapacidad_enfermedad: diasIncapacidadEnfermedad,
        dias_subsidio_maternidad: diasSubsidioMaternidad,
        dias_licencia_paternidad: diasLicenciaPaternidad,
        // Migracion 032: version topada (60 dias/año/contrato) de
        // dias_subsidio_enfermedad, usada en los "dias computables" de
        // Gratificacion/Vacaciones/CTS/Asignacion por Escolaridad - ver el
        // comentario completo en tipos.ts. La calcula agregarTareoDiario;
        // en el path sin tareo diario (carga en bloque) esta columna nunca
        // se toca y queda en su DEFAULT 0.
        dias_subsidio_enfermedad_computable: Number(fila.dias_subsidio_enfermedad_computable) || 0,
      };

      await cliente.query(`SAVEPOINT trabajador_${i}`);
      try {
        let resultado: ResultadoCalculoLinea;
        // EVENTUAL nunca se parte en tramos: es un monto pactado fijo por
        // una tarea puntual (ver calcularLineaEventual), no un sueldo que
        // dependa de la tabla salarial del mes - partirlo duplicaria el
        // monto pactado si el contrato tuviera tareo diario cargado.
        if (cruzaMes && contrato.categoria_ocupacional !== "EVENTUAL" && contratosConTareoDiario.has(contrato.id)) {
          const resultadosTramos: ResultadoCalculoLinea[] = [];
          for (const tramo of tramosPeriodo) {
            const { parametros: parametrosTramo, tablaCategorias: tablaTramo, afpTasas: afpTramo } =
              await obtenerConfigTramo(tramo.anio, tramo.mes);
            const valoresTramo = await agregarTareoDiario(periodo.id, contrato.id, tramo.desde, tramo.hasta);
            const asistenciaTramo = { contrato_id: contrato.id, ...valoresTramo };
            const diasPeriodoTramo = diasEntreFechas(tramo.desde, tramo.hasta);
            resultadosTramos.push(
              calcularLineaPlanilla(
                contrato,
                contrato.numero_hijos,
                asistenciaTramo,
                parametrosTramo,
                tablaTramo,
                afpTramo,
                diasPeriodoTramo,
                tramo.mes,
                tramo.anio,
                Number(fila.cuota_sindical_semanal),
                conceptos,
                periodo.tipo
              )
            );
          }
          resultado = sumarResultadosLinea(resultadosTramos);
        } else {
          if (cruzaMes && contrato.categoria_ocupacional !== "EVENTUAL" && !contratosConTareoDiario.has(contrato.id)) {
            avisosCruceMes.push({
              contrato_id: contrato.id,
              dni: contrato.numero_documento,
              nombre: contrato.apellidos_nombres,
              mensaje:
                "Este periodo cruza de mes calendario y este trabajador no tiene Tareo Diario cargado (solo tareo en bloque): " +
                "se calculo con una sola tabla salarial (la del mes de inicio del periodo). Revisar a mano si la tabla salarial " +
                "cambio de un mes a otro dentro de este periodo.",
            });
          }
          resultado = calcularLineaPlanilla(
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
            conceptos,
            periodo.tipo
          );
        }
        const { detalle } = resultado;

        const r = await cliente.query(
          `INSERT INTO detalle_planilla (
             periodo_id, contrato_id, dias_trabajados, dias_dominical, dias_feriado, dias_falta,
             horas_extra_25, horas_extra_35, horas_extra_100, jornal_diario, sueldo_basico,
             remuneracion_dominical, remuneracion_feriado, importe_horas_extra, asignacion_familiar,
             asignacion_escolaridad, bonificacion_buc, bonificacion_bae, bonificacion_movilidad,
             otras_bonificaciones, gratificacion, bonificacion_extraordinaria, cts, vacaciones,
             total_ingresos, aporte_pension, descuento_sindicato, seguro_vida, conafovicer, renta_5ta,
             otros_descuentos, total_descuentos, essalud, sctr, senati, neto_pagar, detalle_json,
             subsidio_enfermedad, licencia_paternidad,
             dias_subsidio_enfermedad, dias_subsidio_maternidad, dias_licencia_paternidad,
             dias_subsidio_enfermedad_computable,
             dias_incapacidad_enfermedad, incapacidad_enfermedad
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
             $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45
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
             subsidio_enfermedad = EXCLUDED.subsidio_enfermedad,
             licencia_paternidad = EXCLUDED.licencia_paternidad,
             dias_subsidio_enfermedad = EXCLUDED.dias_subsidio_enfermedad,
             dias_subsidio_maternidad = EXCLUDED.dias_subsidio_maternidad,
             dias_licencia_paternidad = EXCLUDED.dias_licencia_paternidad,
             dias_subsidio_enfermedad_computable = EXCLUDED.dias_subsidio_enfermedad_computable,
             dias_incapacidad_enfermedad = EXCLUDED.dias_incapacidad_enfermedad,
             incapacidad_enfermedad = EXCLUDED.incapacidad_enfermedad,
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
            detalle.subsidio_enfermedad,
            detalle.licencia_paternidad,
            detalle.dias_subsidio_enfermedad,
            detalle.dias_subsidio_maternidad,
            detalle.dias_licencia_paternidad,
            detalle.dias_subsidio_enfermedad_computable,
            detalle.dias_incapacidad_enfermedad,
            detalle.incapacidad_enfermedad,
          ]
        );
        lineasCalculadas.push(r.rows[0]);

        // Migracion 033 (Ronda D - "Conceptos con formula propia"): los
        // montos de conceptos PERSONALIZADOS no viven en columnas propias
        // de detalle_planilla (catalogo abierto), sino en la tabla generica
        // detalle_planilla_conceptos. Recalcular reemplaza por completo las
        // filas anteriores de este detalle (borra + reinserta), mismo
        // criterio que el resto del recalculo de este sistema.
        const detalleIdPersonalizados = r.rows[0].id;
        await cliente.query(`DELETE FROM detalle_planilla_conceptos WHERE detalle_id = $1`, [detalleIdPersonalizados]);
        for (const cp of resultado.conceptosPersonalizados ?? []) {
          await cliente.query(
            `INSERT INTO detalle_planilla_conceptos (detalle_id, concepto_codigo, monto) VALUES ($1, $2, $3)`,
            [detalleIdPersonalizados, cp.codigo, cp.monto]
          );
        }
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
      avisos_regimen: avisosRegimen,
      avisos_cruce_mes: avisosCruceMes,
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
