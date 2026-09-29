import { Router, Request, Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import {
  calcularAjustePisoEssaludMensual,
  calcularDiasDominicalProporcional,
  calcularLineaPlanilla,
  calcularPisoEssaludMensual,
  calcularTramosMes,
  DiaCrudoDominical,
  diasEntreFechas,
  esConstruccionCivil,
  periodoCruzaMes,
  redondear,
  ResultadoCalculoLinea,
  sumarResultadosLinea,
} from "../motorCalculo";
import { PoolClient } from "pg";
import { obtenerConceptos, filaAHorarioProyecto } from "./conceptos";
import { tieneAccesoProyecto } from "../permisos";
import { rangoVigenciaEnPeriodo } from "../vigenciaContrato";
import {
  AsistenciaEntrada,
  Contrato,
  HorarioProyecto,
  ParametrosNormativos,
  TablaSalarialMensual,
  TasasAFPMensuales,
} from "../tipos";
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

// migracion_044 (Ronda 4, "piso de EsSalud mensual"): la RMV puede tener un
// valor propio para un mes especifico (tabla rmv_mensual), pensado para
// cuando el gobierno la modifica a mitad de año. Si el mes pedido no tiene
// fila en rmv_mensual, se usa el valor anual de parametros_normativos tal
// cual (comportamiento identico al de antes de esta migracion - por eso
// "mes" es obligatorio pero no requiere sembrar nada para que todo lo
// existente siga funcionando igual). Se resuelve aqui, en un solo lugar,
// para que TODO lo que use la RMV (piso de EsSalud, Asignacion Familiar)
// quede correcto automaticamente para el mes que corresponda.
export async function obtenerParametros(anio: number, mes: number): Promise<ParametrosNormativos> {
  const r = await pool.query("SELECT * FROM parametros_normativos WHERE anio = $1", [anio]);
  if (r.rowCount === 0) {
    throw new ErrorValidacion(`No hay parametros_normativos configurados para el anio ${anio}`);
  }
  const parametros = r.rows[0] as ParametrosNormativos;
  const rmvMes = await pool.query(
    "SELECT remuneracion_minima_vital FROM rmv_mensual WHERE anio = $1 AND mes = $2",
    [anio, mes]
  );
  if (rmvMes.rowCount) {
    parametros.remuneracion_minima_vital = Number(rmvMes.rows[0].remuneracion_minima_vital);
  }
  return parametros;
}

/**
 * Ronda 4 ("piso de EsSalud mensual"), migracion_044.
 *
 * Se llama justo despues de guardar detalle_planilla de UN periodo (dentro
 * de la misma transaccion/SAVEPOINT del trabajador en /calcular). Reune
 * TODOS los periodos de pago ya calculados de ese mismo contrato que caen
 * en el mismo mes calendario - agrupando por periodos_planilla.anio/mes (la
 * misma etiqueta que ya usa el resto del sistema para resolver la tabla
 * salarial de un periodo que no cruza de mes; una quincena que cruza de mes
 * sigue etiquetada con el mes de su fecha_inicio, igual que siempre - no se
 * vuelve a partir por dias aqui, seria la Opcion A del piso de EsSalud que
 * no se implemento) -, recalcula la distribucion correcta con
 * calcularAjustePisoEssaludMensual, y actualiza en la base de datos
 * CUALQUIER periodo de ese conjunto cuyo essalud final haya cambiado -
 * incluido, si corresponde, uno DISTINTO al que se acaba de calcular (esto
 * es lo que produce la correccion en cascada: si se recalcula una quincena
 * anterior despues de que una posterior ya tenia el ajuste, la posterior se
 * corrige sola aqui, sin que el usuario tenga que reabrirla a mano).
 *
 * Solo toca la columna essalud y detalle_json.total_aportes_empleador (por
 * delta, para no tener que conocer el resto de las bases de ese periodo) -
 * nunca recalcula el resto de una boleta ajena a la que se esta calculando.
 */
async function ajustarPisoEssaludDelMes(
  cliente: PoolClient,
  contratoId: number,
  anio: number,
  mes: number,
  parametrosDelMes: ParametrosNormativos
): Promise<{ periodoId: number; essaludAnterior: number; essaludNuevo: number }[]> {
  const pisoMensual = calcularPisoEssaludMensual(parametrosDelMes);
  const filas = await cliente.query<{
    id: number;
    essalud: string;
    essalud_base: string;
    detalle_json: Record<string, unknown> | null;
    fecha_fin: string;
  }>(
    `SELECT dp.id, dp.essalud, dp.essalud_base, dp.detalle_json, pp.fecha_fin
     FROM detalle_planilla dp
     JOIN periodos_planilla pp ON pp.id = dp.periodo_id
     WHERE dp.contrato_id = $1 AND pp.anio = $2 AND pp.mes = $3`,
    [contratoId, anio, mes]
  );
  if (filas.rowCount === 0) return [];

  const nuevos = calcularAjustePisoEssaludMensual(
    filas.rows.map((f) => ({
      periodoId: f.id as number,
      essaludBase: Number(f.essalud_base),
      fechaFin: fechaISO(f.fecha_fin),
    })),
    pisoMensual
  );

  const cambios: { periodoId: number; essaludAnterior: number; essaludNuevo: number }[] = [];
  for (const fila of filas.rows) {
    const essaludNuevo = nuevos.get(fila.id)!;
    const essaludAnterior = Number(fila.essalud);
    if (redondear(essaludNuevo) === redondear(essaludAnterior)) continue;
    const detalleJson = (fila.detalle_json ?? {}) as { total_aportes_empleador?: number };
    const totalAnterior = Number(detalleJson.total_aportes_empleador ?? 0);
    const totalNuevo = redondear(totalAnterior - essaludAnterior + essaludNuevo);
    await cliente.query(
      `UPDATE detalle_planilla
       SET essalud = $1, detalle_json = jsonb_set(detalle_json, '{total_aportes_empleador}', to_jsonb($2::numeric))
       WHERE id = $3`,
      [essaludNuevo, totalNuevo, fila.id]
    );
    cambios.push({ periodoId: fila.id, essaludAnterior, essaludNuevo });
  }
  return cambios;
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

// Filtros opcionales que aceptan tanto la vista en pantalla (Boletas.tsx)
// como las descargas de Excel/PDF/boletas, para que "lo que ves es lo que
// exportas": "q" (DNI o nombre, ya existia) y, desde la mejora "Boletas"
// (sept. 2026), "calculadoDesde"/"calculadoHasta" - el usuario confirmo
// que "Periodo creado" en su pedido se refiere a la fecha en que se
// CALCULO cada boleta (detalle_planilla.calculado_en), no a cuando se dio
// de alta el periodo en si.
interface FiltrosDetallePeriodo {
  q?: string;
  calculadoDesde?: string;
  calculadoHasta?: string;
}

function filtrosDetallePeriodoDeQuery(query: Request["query"]): FiltrosDetallePeriodo {
  return {
    q: query.q as string | undefined,
    calculadoDesde: query.calculado_desde as string | undefined,
    calculadoHasta: query.calculado_hasta as string | undefined,
  };
}

// Trae el periodo y sus boletas calculadas, con los mismos filtros (texto,
// rango de fecha de calculo) y el mismo recorte por proyectos del usuario
// que usa tanto la vista en pantalla como las descargas de Excel/PDF/
// boletas, para que "lo que ves es lo que exportas".
async function obtenerDetallePeriodo(periodoId: string, filtros: FiltrosDetallePeriodo, usuario: NonNullable<Request["usuario"]>) {
  const periodo = await obtenerPeriodo(periodoId);
  if (!periodo) return null;

  const condiciones = ["d.periodo_id = $1"];
  const valores: unknown[] = [periodoId];
  if (filtros.q && filtros.q.trim()) {
    valores.push(`%${filtros.q.trim()}%`);
    condiciones.push(`(e.numero_documento ILIKE $${valores.length} OR e.apellidos_nombres ILIKE $${valores.length})`);
  }
  if (filtros.calculadoDesde) {
    valores.push(filtros.calculadoDesde);
    condiciones.push(`d.calculado_en >= $${valores.length}::date`);
  }
  if (filtros.calculadoHasta) {
    valores.push(filtros.calculadoHasta);
    // Limite superior EXCLUSIVO del dia siguiente: "calculado_en" es un
    // TIMESTAMPTZ (trae hora), asi que comparar con "<= fecha::date" dejaria
    // fuera cualquier calculo hecho despues de la medianoche de ese mismo
    // dia - el usuario espera que "hasta el 22/09" incluya TODO el 22/09.
    condiciones.push(`d.calculado_en < ($${valores.length}::date + INTERVAL '1 day')`);
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

// Cuenta TODAS las boletas de un periodo (sin busqueda ni rango de fecha de
// calculo, solo el recorte por proyectos del usuario) - permite al
// frontend distinguir "este periodo no tiene ninguna boleta calculada
// todavia" de "la busqueda/rango no encontro nada dentro de un periodo que
// SI tiene boletas" (pedido explicito del usuario, mejora "Boletas").
async function contarBoletasPeriodo(periodoId: string, usuario: NonNullable<Request["usuario"]>): Promise<number> {
  const condiciones = ["d.periodo_id = $1"];
  const valores: unknown[] = [periodoId];
  if (usuario.rol !== "ADMIN") {
    valores.push(usuario.proyectos);
    condiciones.push(`c.proyecto = ANY($${valores.length}::text[])`);
  }
  const r = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM detalle_planilla d
     JOIN contratos c ON c.id = d.contrato_id
     WHERE ${condiciones.join(" AND ")}`,
    valores
  );
  return r.rows[0].total as number;
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
  const datos = await obtenerDetallePeriodo(req.params.id, filtrosDetallePeriodoDeQuery(req.query), req.usuario!);
  if (!datos) return res.status(404).json({ error: "Periodo no encontrado" });
  const totalBoletasPeriodo = await contarBoletasPeriodo(req.params.id, req.usuario!);
  res.json({ ...datos, total_boletas_periodo: totalBoletasPeriodo });
}));

// Descargas del mismo listado de boletas de un periodo (resumen por
// trabajador: ingresos, descuentos, aportes del empleador y neto), en Excel
// y PDF - lo que el usuario llama "planilla de tal mes" para revisar quien
// esta en ese periodo y sus totales, sin entrar boleta por boleta.
planillaRouter.get(
  "/:id/planilla/excel",
  requierePermiso("boletas.ver"),
  asyncHandler(async (req: Request, res: Response) => {
    const datos = await obtenerDetallePeriodo(req.params.id, filtrosDetallePeriodoDeQuery(req.query), req.usuario!);
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
    const datos = await obtenerDetallePeriodo(req.params.id, filtrosDetallePeriodoDeQuery(req.query), req.usuario!);
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
    const datos = await obtenerDetallePeriodo(req.params.id, filtrosDetallePeriodoDeQuery(req.query), req.usuario!);
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
    const datos = await obtenerDetallePeriodo(req.params.id, filtrosDetallePeriodoDeQuery(req.query), req.usuario!);
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

// Conceptos con limite INDEPENDIENTE en limites_tareo (migracion 043): cada
// uno se valida por separado contra su propia columna horas_max_<clave>_*/
// minutos_max_<clave>_* (ver PUT /:id/tareo-diario/:contratoId, mas abajo).
// Domingo trabajado y Feriado trabajado NO tienen limite (a proposito, no
// estan en esta lista) - mismo criterio confirmado con el usuario que ya
// aplicaba a Domingo por dia de la semana.
const CONCEPTOS_LIMITE_TAREO: {
  clave: "normal" | "tramo1" | "tramo2" | "tramo3";
  campoHoras: keyof FilaTareoDiario;
  campoMinutos: keyof FilaTareoDiario;
  etiqueta: string;
}[] = [
  { clave: "normal", campoHoras: "horas_normales", campoMinutos: "minutos_normales", etiqueta: "Jornal normal" },
  { clave: "tramo1", campoHoras: "horas_extra_tramo1", campoMinutos: "minutos_extra_tramo1", etiqueta: "Horas extra tramo 1 (60%)" },
  { clave: "tramo2", campoHoras: "horas_extra_tramo2", campoMinutos: "minutos_extra_tramo2", etiqueta: "Horas extra tramo 2 (100%)" },
  { clave: "tramo3", campoHoras: "horas_extra_tramo3", campoMinutos: "minutos_extra_tramo3", etiqueta: "Horas extra tramo 3 (100%)" },
];

// NOTA (recon 44/46): fechaFueraDeVigencia/diaTieneDatos son 2 utilidades
// que ningun parche de los 46 recuperados llega a DEFINIR (grep confirma
// que solo se usan, nunca se declaran) - deben venir de un parche anterior
// a este que no llego a reconstruirse, mismo patron ya visto en otras
// brechas de este documento. A diferencia de esos casos (donde la logica
// real era una caja negra), aqui la semantica queda inequivoca por el
// nombre y los comentarios que las rodean en el propio parche: se
// reconstruyen con esa semantica.
function fechaFueraDeVigencia(fecha: string, fechaIngreso: unknown, fechaCese: unknown): boolean {
  const f = fecha.slice(0, 10);
  if (f < fechaISO(fechaIngreso)) return true;
  if (fechaCese && f > fechaISO(fechaCese)) return true;
  return false;
}

function diaTieneDatos(d: FilaTareoDiario): boolean {
  if (d.tipo_dia_especial) return true;
  return [...CAMPOS_HORAS, ...CAMPOS_MINUTOS].some((campo) => Number(d[campo] ?? 0) > 0);
}

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

// Catalogo de feriados vigentes para un contrato en el RANGO dado
// (interseccion con la vigencia del contrato, igual criterio que el resto
// del prorrateo) - se usa para el feriado no laborado (migracion 022), para
// clasificar dias feriados en el dominical proporcional (migracion 023), y
// (importacion de marcaciones) para clasificar una marcacion de un dia
// feriado sin tener que replicar esta consulta.
//
// Migracion 042 (ambito geografico): un feriado NACIONAL siempre cuenta. Uno
// REGIONAL/LOCAL solo cuenta si el PROYECTO de este periodo
// (periodos_planilla.proyecto -> proyectos.nombre) tiene configurada la
// ubicacion correspondiente y coincide con la del feriado. Se resuelve con
// un JOIN NULL-safe en la misma consulta: un periodo legado (proyecto NULL)
// o un proyecto sin ubicacion configurada simplemente no matchea nunca la
// condicion REGIONAL/LOCAL, y solo recibe los feriados NACIONAL -
// comportamiento "seguro por defecto" confirmado con el usuario.
//
// Migracion 048 (reconstruida desde backend_dist, ver RECONSTRUCCION_BRECHAS.md):
// esta funcion (junto con el resto de este bloque) reemplaza el stub
// "esFeriado = false" que dejaron los parches 42-45/46 mientras el catalogo
// dias_feriados no existia (ver los puntos 4/4.1/15 de ese documento).
export async function obtenerFeriadosVigentes(
  periodoId: string | number,
  contratoId: number,
  fechaDesde: string,
  fechaHasta: string
): Promise<Set<string>> {
  const contratoResult = await pool.query(
    "SELECT fecha_ingreso, fecha_cese FROM contratos WHERE id = $1",
    [contratoId]
  );
  if (contratoResult.rowCount === 0) return new Set();
  const { fecha_ingreso, fecha_cese } = contratoResult.rows[0];
  const rango = rangoVigenciaEnPeriodo(fecha_ingreso, fecha_cese, fechaDesde, fechaHasta);
  if (!rango) return new Set();
  const feriadosResult = await pool.query(
    `SELECT df.fecha
     FROM dias_feriados df
     LEFT JOIN periodos_planilla pp ON pp.id = $3
     LEFT JOIN proyectos p ON p.nombre = pp.proyecto
     WHERE df.fecha BETWEEN $1 AND $2
       AND (
         df.ambito = 'NACIONAL'
         OR (
           df.ambito = 'REGIONAL'
           AND p.ubigeo_departamento_codigo IS NOT NULL
           AND p.ubigeo_departamento_codigo = df.ubigeo_departamento_codigo
         )
         OR (
           df.ambito = 'LOCAL'
           AND p.ubigeo_provincia_codigo IS NOT NULL
           AND p.ubigeo_provincia_codigo = df.ubigeo_provincia_codigo
           AND (df.ubigeo_distrito_codigo IS NULL OR df.ubigeo_distrito_codigo = p.ubigeo_distrito_codigo)
         )
       )`,
    [rango.desde, rango.hasta, periodoId]
  );
  return new Set(feriadosResult.rows.map((f) => fechaISO(f.fecha)));
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
 * Migracion 022 (feriado no laborado, reconstruida desde backend_dist en la
 * migracion 048): ademas acredita automaticamente el pago del feriado NO
 * laborado (D.Leg. 713 - el feriado se paga se trabaje o no) por cada fecha
 * del periodo registrada en dias_feriados para la que este contrato NO
 * tenga horas de "Feriado trabajado" cargadas ese dia - asi el usuario no
 * tiene que tocar el Tareo Diario para esos dias. Si el dia tiene FALTA,
 * SUBSIDIO o LICENCIA marcado explicitamente, no se acredita nada
 * automatico: se respeta lo que ya se cargo y se evita pagar doble.
 * dias_feriado_trabajado (subconjunto SI trabajado, usado para la
 * sobretasa) sigue viniendo solo de las horas de "Feriado trabajado";
 * dias_feriado pasa a ser el TOTAL a pagar = trabajado + no laborado
 * acreditado aqui. Una fecha feriado con una fila en 0 (el Tareo Diario
 * siempre pre-llena una fila por cada dia del periodo) SI cuenta como "no
 * laborado" - basta con que esa fecha no tenga horas de feriado trabajadas
 * Y no tenga una marca explicita de FALTA/SUBSIDIO/LICENCIA ese dia.
 *
 * Migracion 023 (dominical proporcional, reconstruida en la misma
 * migracion 048): ademas arma, dia por dia, la lista cruda que necesita
 * calcularDiasDominicalProporcional (motorCalculo.ts) para el dominical
 * proporcional (D.Leg. 713 - descanso semanal no laborado). Reglas de
 * conteo por dia (confirmadas con el usuario): FALTA=0h; SUBSIDIO/LICENCIA=
 * 8h fijas; un dia feriado (trabajado o no, segun el catalogo dias_feriados
 * o con horas_feriado cargadas)=8h fijas; jornal normal=horas reales; dia
 * sin registro=0h (no se agrega nada a la lista). El resultado
 * (dias_dominical_no_laborado) es independiente de dias_dominical (domingo
 * SI trabajado, sin cambios de la migracion 022).
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
  const feriadosVigentes = await obtenerFeriadosVigentes(periodoId, contratoId, fechaDesde, fechaHasta);
  const r = await pool.query(
    `SELECT fecha, horas_normales, minutos_normales, horas_dominical, minutos_dominical,
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

  const fechasConRegistro = new Set<string>();
  // Fechas feriado con horas de "Feriado trabajado" > 0 ese dia especifico
  // (ya se pagan via diasFeriadoTrabajado mas abajo) y fechas con una marca
  // explicita de FALTA/SUBSIDIO/LICENCIA (el feriado NO se autocredita ahi,
  // se respeta lo que ya se cargo) - las dos se usan despues del loop para
  // decidir que feriados del catalogo faltan por acreditar como "no
  // laborados", sin depender de si la fecha tiene o no una fila en
  // tareo_diario.
  const feriadosConHorasTrabajadas = new Set<string>();
  const fechasConMarcaEspecial = new Set<string>();
  const diasCrudos: DiaCrudoDominical[] = [];

  for (const fila of r.rows) {
    const fecha = fechaISO(fila.fecha);
    fechasConRegistro.add(fecha);
    const diaSemana = new Date(fecha + "T00:00:00Z").getUTCDay(); // 0=domingo

    switch (fila.tipo_dia_especial as TipoDiaEspecial | null) {
      case "FALTA":
        fechasConMarcaEspecial.add(fecha);
        diasFalta += 1;
        if (diaSemana !== 0) diasCrudos.push({ fecha, horasJornada: 0, domingoTrabajado: false });
        continue;
      case "DESCANSO_MEDICO":
        fechasConMarcaEspecial.add(fecha);
        diasSubsidioEnfermedad += 1;
        if (diaSemana !== 0) diasCrudos.push({ fecha, horasJornada: 8, domingoTrabajado: false });
        continue;
      case "SUBSIDIO_MATERNIDAD":
        fechasConMarcaEspecial.add(fecha);
        diasSubsidioMaternidad += 1;
        if (diaSemana !== 0) diasCrudos.push({ fecha, horasJornada: 8, domingoTrabajado: false });
        continue;
      case "LICENCIA_PATERNIDAD":
        fechasConMarcaEspecial.add(fecha);
        diasLicenciaPaternidad += 1;
        if (diaSemana !== 0) diasCrudos.push({ fecha, horasJornada: 8, domingoTrabajado: false });
        continue;
    }

    const horasFeriadoDia = Number(fila.horas_feriado) + Number(fila.minutos_feriado) / 60;
    horasNormales += Number(fila.horas_normales) + Number(fila.minutos_normales) / 60;
    horasDominical += Number(fila.horas_dominical) + Number(fila.minutos_dominical) / 60;
    horasFeriado += horasFeriadoDia;
    horasTramo1 += Number(fila.horas_extra_tramo1) + Number(fila.minutos_extra_tramo1) / 60;
    horasTramo2 += Number(fila.horas_extra_tramo2) + Number(fila.minutos_extra_tramo2) / 60;
    horasTramo3 += Number(fila.horas_extra_tramo3) + Number(fila.minutos_extra_tramo3) / 60;

    if (horasFeriadoDia > 0) feriadosConHorasTrabajadas.add(fecha);

    if (diaSemana === 0) {
      diasCrudos.push({ fecha, horasJornada: 0, domingoTrabajado: Number(fila.horas_dominical) > 0 });
    } else if (feriadosVigentes.has(fecha) || horasFeriadoDia > 0) {
      // Un dia feriado (trabajado o no) cuenta 8h fijas para el dominical
      // proporcional, sin importar las horas reales trabajadas ese dia
      // puntual - confirmado explicitamente con el usuario.
      diasCrudos.push({ fecha, horasJornada: 8, domingoTrabajado: false });
    } else {
      diasCrudos.push({
        fecha,
        horasJornada: Number(fila.horas_normales) + Number(fila.minutos_normales) / 60,
        domingoTrabajado: false,
      });
    }
  }

  const diasFeriadoTrabajado = redondear2(horasFeriado / 8);
  let diasFeriadoNoLaborado = 0;
  for (const feriado of feriadosVigentes) {
    // Ya se pago como feriado trabajado (horas_feriado > 0 ese dia), o el
    // dia tiene una marca explicita (FALTA/SUBSIDIO/LICENCIA) que ya se
    // proceso aparte arriba - en ambos casos no se autocredita nada mas.
    if (feriadosConHorasTrabajadas.has(feriado) || fechasConMarcaEspecial.has(feriado)) continue;
    diasFeriadoNoLaborado += 1;
    // La fila cruda del dominical proporcional para esta fecha SOLO se
    // agrega aqui si no habia ninguna fila en tareo_diario - si SI habia
    // fila (el caso mas comun: una fila en 0 porque nadie trabajo ese
    // feriado), el loop de arriba ya la agrego a diasCrudos (rama
    // "feriadosVigentes.has") y agregarla de nuevo aqui duplicaria la fecha
    // en el calculo semanal.
    if (!fechasConRegistro.has(feriado)) {
      if (new Date(feriado + "T00:00:00Z").getUTCDay() !== 0) {
        diasCrudos.push({ fecha: feriado, horasJornada: 8, domingoTrabajado: false });
      }
    }
  }

  const diasDominicalNoLaborado = calcularDiasDominicalProporcional(diasCrudos);

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
    dias_feriado: redondear2(diasFeriadoTrabajado + diasFeriadoNoLaborado),
    dias_feriado_trabajado: diasFeriadoTrabajado,
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
    dias_dominical_no_laborado: diasDominicalNoLaborado,
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

/**
 * Valida y guarda de una vez un arreglo de dias de tareo diario para UN
 * contrato en UN periodo - extraido de PUT /:id/tareo-diario/:contratoId
 * (Ronda 2, importacion de marcaciones biometricas) para poder reutilizar
 * EXACTAMENTE la misma validacion (formato, limites de tareo, vigencia del
 * contrato) desde la ruta que aplica una importacion ya revisada, sin
 * duplicar esta logica ni arriesgar que las dos vias diverjan con el
 * tiempo. Lanza ErrorValidacion (mensaje ya listo para mostrar al usuario)
 * si algo no pasa la validacion; no hace nada mas (no recalcula
 * asistencia_periodo ni registra bitacora - eso queda a cargo de quien
 * llama, que sabe si es una edicion manual o una importacion aplicada).
 */
async function validarYGuardarDiasTareoDiario(
  periodoId: string | number,
  contratoId: string | number,
  dias: FilaTareoDiario[]
): Promise<void> {
  // Error real visto en produccion: un valor decimal (ej. "1.13", probablemente
  // alguien escribiendo "1 hora 13 minutos" en el campo de horas) llegaba
  // hasta el INSERT y Postgres lo rechazaba con un mensaje crudo ("la sintaxis
  // de entrada no es valida para integer") porque las columnas horas_*/minutos_*
  // de tareo_diario son INT. Se valida aqui antes de tocar la base de datos,
  // para devolver un error claro en vez de ese 500 crudo.
  for (const d of dias) {
    if (!d.fecha || Number.isNaN(Date.parse(d.fecha))) {
      throw new ErrorValidacion(`Fecha invalida: ${d.fecha}`);
    }
    if (d.tipo_dia_especial && !TIPOS_DIA_ESPECIAL.includes(d.tipo_dia_especial)) {
      throw new ErrorValidacion(`tipo_dia_especial invalido: ${d.tipo_dia_especial}`);
    }
    for (const campo of CAMPOS_HORAS) {
      const v = d[campo];
      if (v === undefined || v === null) continue;
      if (!Number.isInteger(v) || v < 0) {
        throw new ErrorValidacion(
          `El campo "${campo}" debe ser un numero entero de horas (valor recibido: ${v}) en la fecha ${d.fecha.slice(0, 10)}`
        );
      }
    }
    for (const campo of CAMPOS_MINUTOS) {
      const v = d[campo];
      if (v === undefined || v === null) continue;
      if (!Number.isInteger(v) || v < 0 || v > 59) {
        throw new ErrorValidacion(
          `El campo "${campo}" debe ser un numero entero de minutos entre 0 y 59 (valor recibido: ${v}) en la fecha ${d.fecha.slice(0, 10)}`
        );
      }
    }
  }

  // Migracion 040 (ampliada en migracion 043): limites configurables de
  // horas/minutos por dia (Configuracion -> Limites de tareo), a pedido
  // explicito del usuario. Cada CONCEPTO tiene su propio limite
  // independiente (antes todos compartian un solo tope combinado - la
  // suma de TODAS las columnas de horas del dia -, lo que bloqueaba
  // registrar horas extra en cuanto el jornal normal ya llegaba al
  // limite). Domingo (por dia de la semana) y las columnas de Feriado
  // trabajado quedan SIN limite (se pagan aparte).
  const limitesResult = await pool.query("SELECT * FROM limites_tareo WHERE id = 1");
  const limites = limitesResult.rows[0] as Record<string, unknown>;
  for (const d of dias) {
    const diaSemana = new Date(d.fecha.slice(0, 10) + "T00:00:00Z").getUTCDay(); // 0=domingo .. 6=sabado
    if (diaSemana === 0) continue;
    const esSabado = diaSemana === 6;
    const tipoDia = esSabado ? "sabado" : "lun_vie";
    const etiquetaDia = esSabado ? "sabado" : "dia (lunes a viernes)";
    for (const c of CONCEPTOS_LIMITE_TAREO) {
      const horas = Number(d[c.campoHoras] ?? 0);
      const minutos = Number(d[c.campoMinutos] ?? 0);
      const horasMax = Number(limites[`horas_max_${c.clave}_${tipoDia}`]);
      const minutosMax = Number(limites[`minutos_max_${c.clave}_${tipoDia}`]);
      if (horas > horasMax) {
        throw new ErrorValidacion(
          `El ${etiquetaDia} ${d.fecha.slice(0, 10)}: "${c.etiqueta}" tiene ${horas} horas, ` +
            `y el limite configurado para ese concepto es ${horasMax} horas (Configuracion -> Limites de tareo).`
        );
      }
      if (minutos > minutosMax) {
        throw new ErrorValidacion(
          `El ${etiquetaDia} ${d.fecha.slice(0, 10)}: "${c.etiqueta}" tiene ${minutos} minutos, ` +
            `y el limite configurado para ese concepto es ${minutosMax} minutos (Configuracion -> Limites de tareo).`
        );
      }
    }
  }

  // Corrige un error real reportado en produccion: el sistema permitia
  // registrar tareo (dias laborados) fuera de la vigencia real del
  // contrato (antes de su fecha_ingreso, o despues de su fecha_cese). Se
  // rechaza el request completo (nada se guarda) si algun dia fuera de
  // vigencia trae datos reales - los dias fuera de vigencia en 0/vacios
  // (ej. la grilla del frontend, que siempre cubre todo el periodo) no
  // se rechazan, para no romper el guardado normal de los dias que si
  // son validos.
  const contratoVigenciaResult = await pool.query(
    "SELECT fecha_ingreso, fecha_cese FROM contratos WHERE id = $1",
    [contratoId]
  );
  const { fecha_ingreso, fecha_cese } = contratoVigenciaResult.rows[0];
  const diasFueraDeVigenciaConDatos = dias.filter(
    (d) => fechaFueraDeVigencia(d.fecha, fecha_ingreso, fecha_cese) && diaTieneDatos(d)
  );
  if (diasFueraDeVigenciaConDatos.length > 0) {
    const fechasTexto = diasFueraDeVigenciaConDatos.map((d) => d.fecha.slice(0, 10)).join(", ");
    throw new ErrorValidacion(
      `No se puede registrar tareo fuera de la vigencia del contrato ` +
        `(ingreso: ${fechaISO(fecha_ingreso)}` +
        `${fecha_cese ? `, cese: ${fechaISO(fecha_cese)}` : ""}). ` +
        `Dias en conflicto: ${fechasTexto}`
    );
  }

  // Migracion 038: el dia 21 en adelante de "DESCANSO_MEDICO" SI se puede
  // registrar aqui (ver el comentario completo, antes ubicado en este mismo
  // punto, ahora en el bloque equivalente de tests/tareo_diario.test.ts) -
  // es agregarTareoDiario quien divide automaticamente, al calcular la
  // planilla, cuantos de esos dias se pagan como "Descanso Medico" (<=20)
  // y cuantos como "Incapacidad por Enfermedad" (21+). Nada que bloquear aqui.
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
          periodoId,
          contratoId,
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
}

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

    // Ronda 2 (importacion de marcaciones biometricas): la validacion
    // (formato, limites de tareo, vigencia del contrato) y el guardado en si
    // se extrajeron a validarYGuardarDiasTareoDiario (mas arriba) para poder
    // reutilizarlos EXACTAMENTE igual desde la ruta que aplica una
    // importacion ya revisada, sin duplicar esta logica.
    try {
      await validarYGuardarDiasTareoDiario(req.params.id, req.params.contratoId, dias);
    } catch (err) {
      if (err instanceof ErrorValidacion) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
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

// ===========================================================================
// Importacion de marcaciones biometricas (migracion_046, "Control de
// Asistencia Diaria" - Ronda 2, puente practico). Mientras el usuario
// compra/verifica su propio equipo biometrico, llena a mano una plantilla
// Excel/CSV con 1 fila por cada marcacion individual (DNI, nombre, fecha,
// hora, tipo ENTRADA/SALIDA - el mismo formato crudo que exporta un lector
// de huella real). El sistema:
//   1) agrupa las marcas por contrato+dia y toma la primera y la ultima
//      marca del dia (hora_ingreso_real/hora_salida_real) - el refrigerio
//      es un descuento fijo automatico (no hace falta marcar la salida a
//      almorzar, regla de negocio ya confirmada);
//   2) compara ese rango contra el horario configurado del proyecto
//      (horarios_proyecto, migracion 045: lunes-viernes o sabado) para
//      calcular horas normales y horas extra tramo1 (primeras 2h)/tramo2
//      (siguientes 4h)/tramo3 (resto, sin limite) - un domingo o un
//      feriado (catalogo dias_feriados) trabajado se acredita completo a
//      "Domingo trabajado"/"Feriado trabajado" sin dividir en tramos,
//      igual que ya funciona hoy la carga manual de esos conceptos;
//   3) deja todo en importaciones_marcaciones(_detalle) para una pantalla
//      de revision manual - NADA se aplica al Tareo Diario todavia;
//   4) solo al aprobar (POST .../aplicar) se escribe en tareo_diario,
//      reusando la MISMA validacion que la edicion manual (limites de
//      tareo, vigencia del contrato) via validarYGuardarDiasTareoDiario.
//
// Supuesto documentado (a confirmar con el usuario en la practica, con
// datos reales del equipo cuando llegue): el tiempo trabajado se calcula
// como (ultima marca - primera marca - minutos_refrigerio), sin distinguir
// si la persona llego mas temprano de lo programado o se quedo mas tarde -
// ambos casos hoy se tratan igual (todo lo que exceda la jornada
// programada neta se acredita como hora extra). Si en la practica el
// usuario no quiere pagar como extra una llegada anticipada no autorizada,
// esto se ajusta en la pantalla de revision antes de aplicar (o se afina
// el calculo en una ronda futura).
// ===========================================================================

const uploadMarcaciones = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const COLUMNAS_PLANTILLA_MARCACION = ["DNI", "PROYECTO", "NOMBRE", "FECHA", "HORA", "TIPO"];

// GET /api/periodos/:id/marcaciones/plantilla -> descarga un .xlsx con DNI,
// PROYECTO y NOMBRE ya resueltos por el sistema para cada trabajador habil
// en el alcance de este periodo (mismo patron que /tareo/plantilla) - asi
// la columna PROYECTO (necesaria solo cuando un DNI tiene mas de un
// contrato habil activo, para desambiguar) queda completada de una vez,
// sin que el usuario tenga que escribirla ni adivinarla a mano. Dos filas
// de ejemplo por trabajador (ENTRADA/SALIDA) para completar FECHA/HORA -
// se duplica ese par de filas por cada dia adicional que se quiera cargar.
planillaRouter.get(
  "/:id/marcaciones/plantilla",
  asyncHandler(async (req: Request, res: Response) => {
    const periodo = await obtenerPeriodo(req.params.id);
    if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

    const esAdmin = req.usuario!.rol === "ADMIN";
    const condiciones: string[] = ["c.estado = 'HABIL'"];
    const params: unknown[] = [];
    if (!esAdmin) {
      params.push(req.usuario!.proyectos);
      condiciones.push(`c.proyecto = ANY($${params.length}::text[])`);
    }
    if (periodo.proyecto) {
      params.push(periodo.proyecto);
      condiciones.push(`c.proyecto = $${params.length}`);
    }
    const contratosResult = await pool.query(
      `SELECT e.numero_documento, e.apellidos_nombres, c.proyecto
       FROM contratos c JOIN empleados e ON e.id = c.empleado_id
       WHERE ${condiciones.join(" AND ")}
       ORDER BY e.apellidos_nombres ASC`,
      params
    );

    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet("Marcaciones");
    hoja.columns = COLUMNAS_PLANTILLA_MARCACION.map((nombre) => ({ header: nombre, key: nombre, width: 18 }));
    hoja.getColumn("DNI").numFmt = "@"; // texto - evita que Excel borre ceros a la izquierda
    hoja.getColumn("FECHA").numFmt = "@";
    hoja.getColumn("HORA").numFmt = "@";

    for (const c of contratosResult.rows) {
      for (const tipo of ["ENTRADA", "SALIDA"] as const) {
        const fila = hoja.addRow({
          DNI: c.numero_documento,
          PROYECTO: c.proyecto,
          NOMBRE: c.apellidos_nombres,
          FECHA: "",
          HORA: "",
          TIPO: tipo,
        });
        fila.getCell("DNI").numFmt = "@";
        fila.getCell("DNI").value = c.numero_documento;
      }
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="marcaciones_plantilla_${periodo.mes}_${periodo.anio}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

type ClaveColumnaMarcacion = "dni" | "fecha" | "hora" | "nombre" | "tipo" | "proyecto";

// Alias de encabezado aceptados (en mayusculas) para el mapeo AUTOMATICO de
// columnas - el formato exacto que exportara el equipo biometrico real
// todavia no se conoce, asi que se acepta un rango razonable de nombres en
// vez de exigir uno solo (principio de diseño ya acordado para esta
// ronda). Si el archivo no trae ninguno de estos para una columna
// obligatoria (DNI/FECHA/HORA), se puede indicar el mapeo exacto a mano
// con el campo de formulario "mapeo" (JSON con el nombre de columna TAL
// CUAL aparece en el archivo, ej. {"dni":"NUM_DOC","fecha":"DIA","hora":"HORA_MARCA"}).
const ALIAS_COLUMNA_MARCACION: Record<ClaveColumnaMarcacion, string[]> = {
  dni: ["DNI", "DOCUMENTO", "NUMERO_DOCUMENTO", "NRO_DOCUMENTO", "N_DOCUMENTO", "CEDULA"],
  fecha: ["FECHA", "DATE", "DIA"],
  hora: ["HORA", "HORA_MARCACION", "HORA_MARCA", "TIME", "MARCACION"],
  nombre: ["NOMBRE", "NOMBRES", "APELLIDOS_NOMBRES", "TRABAJADOR", "APELLIDOS Y NOMBRES"],
  tipo: ["TIPO", "TIPO_MARCACION", "E/S", "ENTRADA/SALIDA", "EVENTO"],
  proyecto: ["PROYECTO", "OBRA"],
};

function detectarColumna(encabezados: string[], alias: string[]): string | null {
  return alias.find((a) => encabezados.includes(a)) ?? null;
}

interface MapeoColumnasMarcacion {
  dni: string;
  fecha: string;
  hora: string;
  nombre: string | null;
  tipo: string | null;
  proyecto: string | null;
}

function resolverMapeoColumnas(
  encabezados: string[],
  mapeoManual: Partial<Record<ClaveColumnaMarcacion, string>> | null
): MapeoColumnasMarcacion {
  const col = (clave: ClaveColumnaMarcacion): string | null => {
    const manual = mapeoManual?.[clave]?.trim().toUpperCase();
    if (manual && encabezados.includes(manual)) return manual;
    return detectarColumna(encabezados, ALIAS_COLUMNA_MARCACION[clave]);
  };
  const dni = col("dni");
  const fecha = col("fecha");
  const hora = col("hora");
  if (!dni || !fecha || !hora) {
    throw new ErrorValidacion(
      `No se pudieron identificar las columnas obligatorias (DNI, FECHA, HORA) en el archivo. ` +
        `Columnas encontradas: ${encabezados.join(", ") || "(ninguna)"}. ` +
        `Si el archivo usa otros nombres de columna, reenvia indicando el campo "mapeo" (JSON) con el nombre exacto de cada una.`
    );
  }
  return { dni, fecha, hora, nombre: col("nombre"), tipo: col("tipo"), proyecto: col("proyecto") };
}

// Interpreta una fecha ya convertida a texto (ver celdaATexto) en varios
// formatos razonables - devuelve "YYYY-MM-DD" o null si no se pudo leer.
function parsearFechaMarcacion(texto: string): string | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// Interpreta una hora ya convertida a texto en varios formatos razonables
// (HH:MM, HH:MM:SS, o una fecha/hora completa - asi puede llegar si Excel
// termino guardando la celda como un valor de hora real en vez de texto).
// Devuelve minutos totales desde medianoche, o null si no se pudo leer.
function parsearHoraMarcacion(texto: string): number | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h <= 23 && min <= 59) return h * 60 + min;
    return null;
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.getUTCHours() * 60 + d.getUTCMinutes();
  return null;
}

function minutosATexto(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function textoAMinutos(horaHHMM: string): number {
  const [h, m] = horaHHMM.split(":").map(Number);
  return h * 60 + (m || 0);
}

interface DiaMarcacionCalculado {
  dia: FilaTareoDiario;
  minutosLlegadaAnticipada: number;
}

// Calcula jornal normal/extra (o feriado/dominical) de UN dia a partir de
// la marca mas temprana y mas tardia, comparadas contra el horario
// configurado del proyecto.
//
// Pregunta del usuario (26/09): si alguien marca su ingreso ANTES de la
// hora de ingreso programada, ¿ese tiempo se paga como hora extra
// automaticamente? Se acordo que NO por defecto - ese tiempo se marca
// como "llegada anticipada" (minutosLlegadaAnticipada) y queda EXCLUIDO
// del calculo (ni como jornal normal, ni como hora extra) hasta que la
// persona que revisa la importacion lo CONFIRME explicitamente como hora
// extra a pagar (parametro incluirAnticipacionComoExtra, ver el toggle en
// PUT /:id/marcaciones/:importacionId/detalle/:detalleId). Una llegada
// TARDE (despues de la hora de ingreso programada) nunca se trata como
// extra - simplemente reduce el jornal normal de ese dia, igual que una
// salida temprana; solo la salida DESPUES de la hora programada genera
// hora extra automatica, sin necesitar confirmacion (ese es el caso
// esperado/normal de sobretiempo).
function calcularJornadaDesdeMarcas(
  minIngresoReal: number,
  maxSalidaReal: number,
  diaSemana: number, // 0=domingo .. 6=sabado (getUTCDay())
  esFeriado: boolean,
  horario: HorarioProyecto,
  incluirAnticipacionComoExtra: boolean
): DiaMarcacionCalculado {
  const trabajadoBruto = Math.max(0, maxSalidaReal - minIngresoReal);
  const dia: FilaTareoDiario = { fecha: "" }; // el llamador completa "fecha"

  if (esFeriado) {
    // Feriado trabajado: se acredita completo, sin dividir en tramos -
    // mismo criterio que ya usa hoy la carga manual de "Feriado trabajado".
    const netos = Math.max(0, trabajadoBruto - horario.minutos_refrigerio);
    dia.horas_feriado = Math.floor(netos / 60);
    dia.minutos_feriado = netos % 60;
    return { dia, minutosLlegadaAnticipada: 0 };
  }
  if (diaSemana === 0) {
    // Domingo trabajado: igual, se acredita completo sin tramos (el
    // domingo es el dia de descanso; el trabajo excepcional se paga
    // aparte via REM_DOMINICAL/sobretasa, no como "hora extra").
    const netos = Math.max(0, trabajadoBruto - horario.minutos_refrigerio);
    dia.horas_dominical = Math.floor(netos / 60);
    dia.minutos_dominical = netos % 60;
    return { dia, minutosLlegadaAnticipada: 0 };
  }

  const esSabado = diaSemana === 6;
  const usaHorarioSabado = esSabado && horario.hora_ingreso_sabado && horario.hora_salida_sabado;
  const ingresoProg = textoAMinutos(usaHorarioSabado ? horario.hora_ingreso_sabado! : horario.hora_ingreso);
  const salidaProg = textoAMinutos(usaHorarioSabado ? horario.hora_salida_sabado! : horario.hora_salida);

  // "Normal" cubre solo la interseccion entre lo realmente marcado y la
  // ventana programada: una llegada tarde o una salida temprana SI reduce
  // el jornal normal (nadie discute eso); una llegada anticipada NO se
  // acredita aqui - queda aparte, pendiente de confirmacion (ver abajo).
  const ingresoEfectivoNormal = Math.max(minIngresoReal, ingresoProg);
  const salidaEfectivaNormal = Math.min(maxSalidaReal, salidaProg);
  const normalBruto = Math.max(0, salidaEfectivaNormal - ingresoEfectivoNormal);
  const normalNeto = Math.max(0, normalBruto - horario.minutos_refrigerio);

  const minutosLlegadaAnticipada = Math.max(0, ingresoProg - minIngresoReal);
  const minutosSalidaTardia = Math.max(0, maxSalidaReal - salidaProg);
  const extraMin = minutosSalidaTardia + (incluirAnticipacionComoExtra ? minutosLlegadaAnticipada : 0);

  const tramo1 = Math.min(extraMin, 120);
  const restoTrasTramo1 = extraMin - tramo1;
  const tramo2 = Math.min(restoTrasTramo1, 240);
  const tramo3 = restoTrasTramo1 - tramo2;

  dia.horas_normales = Math.floor(normalNeto / 60);
  dia.minutos_normales = normalNeto % 60;
  dia.horas_extra_tramo1 = Math.floor(tramo1 / 60);
  dia.minutos_extra_tramo1 = tramo1 % 60;
  dia.horas_extra_tramo2 = Math.floor(tramo2 / 60);
  dia.minutos_extra_tramo2 = tramo2 % 60;
  dia.horas_extra_tramo3 = Math.floor(tramo3 / 60);
  dia.minutos_extra_tramo3 = tramo3 % 60;

  return { dia, minutosLlegadaAnticipada };
}

interface ErrorFilaMarcacion {
  fila: number;
  dni: string;
  motivo: string;
}

// POST /api/periodos/:id/marcaciones/importar
// multipart: campo "archivo" (.xlsx o .csv con encabezado, 1 fila por cada
// marcacion individual) + campo opcional "mapeo" (JSON) para forzar a mano
// el nombre de columna de dni/fecha/hora/nombre/tipo/proyecto cuando el
// archivo no usa ninguno de los alias reconocidos automaticamente.
planillaRouter.post(
  "/:id/marcaciones/importar",
  uploadMarcaciones.single("archivo"),
  asyncHandler(async (req: Request, res: Response) => {
    const periodo = await obtenerPeriodo(req.params.id);
    if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });
    if (!req.file) {
      return res.status(400).json({ error: "Falta el archivo (campo 'archivo')" });
    }

    let mapeoManual: Partial<Record<ClaveColumnaMarcacion, string>> | null = null;
    if (req.body?.mapeo) {
      try {
        mapeoManual = JSON.parse(req.body.mapeo);
      } catch {
        return res.status(400).json({ error: "El campo 'mapeo' debe ser un JSON valido" });
      }
    }

    const esExcel = /\.xlsx$/i.test(req.file.originalname);
    let filas: Record<string, string>[];
    try {
      filas = esExcel
        ? await leerFilasXlsx(req.file.buffer)
        : (parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<
            string,
            string
          >[]);
    } catch (err) {
      return res.status(400).json({ error: `No se pudo leer el archivo: ${(err as Error).message}` });
    }
    // csv-parse no fuerza mayusculas en los encabezados (a diferencia de
    // leerFilasXlsx) - se normaliza aqui para que el mapeo por alias
    // funcione igual para ambos formatos.
    if (!esExcel) {
      filas = filas.map((fila) => {
        const normalizada: Record<string, string> = {};
        for (const [clave, valor] of Object.entries(fila)) {
          normalizada[clave.trim().toUpperCase()] = String(valor ?? "").trim();
        }
        return normalizada;
      });
    }
    if (filas.length === 0) {
      return res.status(400).json({ error: "El archivo no tiene filas de datos" });
    }

    const encabezados = Object.keys(filas[0]);
    let mapeo: MapeoColumnasMarcacion;
    try {
      mapeo = resolverMapeoColumnas(encabezados, mapeoManual);
    } catch (err) {
      if (err instanceof ErrorValidacion) return res.status(400).json({ error: err.message });
      throw err;
    }

    const esAdminImportar = req.usuario!.rol === "ADMIN";
    const contratosResult = await pool.query(
      `SELECT c.id, c.proyecto, c.fecha_ingreso, c.fecha_cese, e.numero_documento, e.apellidos_nombres
       FROM contratos c JOIN empleados e ON e.id = c.empleado_id
       WHERE c.estado = 'HABIL' ${esAdminImportar ? "" : "AND c.proyecto = ANY($1::text[])"}`,
      esAdminImportar ? [] : [req.usuario!.proyectos]
    );
    const contratosPorDni = new Map<
      string,
      { id: number; proyecto: string; fecha_ingreso: string; fecha_cese: string | null; apellidos_nombres: string }[]
    >();
    for (const fila of contratosResult.rows) {
      const lista = contratosPorDni.get(fila.numero_documento) ?? [];
      lista.push({
        id: fila.id,
        proyecto: fila.proyecto,
        fecha_ingreso: fila.fecha_ingreso,
        fecha_cese: fila.fecha_cese,
        apellidos_nombres: fila.apellidos_nombres,
      });
      contratosPorDni.set(fila.numero_documento, lista);
    }

    const errores: ErrorFilaMarcacion[] = [];
    // Marcas validas agrupadas por "contratoId|fecha".
    const marcasPorDia = new Map<string, { minutos: number; tipo: "ENTRADA" | "SALIDA" | null }[]>();
    const infoPorClave = new Map<string, { contratoId: number; fecha: string }>();
    const contratosVistos = new Map<number, { proyecto: string; apellidos_nombres: string; numero_documento: string }>();

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const numeroFila = i + 2;
      const dni = (fila[mapeo.dni] ?? "").trim();
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
        const proyecto = mapeo.proyecto ? (fila[mapeo.proyecto] ?? "").trim() : "";
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

      if (periodo.proyecto && contrato.proyecto !== periodo.proyecto) {
        errores.push({
          fila: numeroFila,
          dni,
          motivo: `Este periodo es especifico del proyecto '${periodo.proyecto}' y el contrato pertenece a '${contrato.proyecto}'`,
        });
        continue;
      }

      const fecha = parsearFechaMarcacion(fila[mapeo.fecha] ?? "");
      if (!fecha) {
        errores.push({ fila: numeroFila, dni, motivo: `Fecha invalida: '${fila[mapeo.fecha]}'` });
        continue;
      }
      if (fecha < fechaISO(periodo.fecha_inicio) || fecha > fechaISO(periodo.fecha_fin)) {
        errores.push({
          fila: numeroFila,
          dni,
          motivo: `La fecha ${fecha} no cae dentro del periodo (${fechaISO(periodo.fecha_inicio)} al ${fechaISO(periodo.fecha_fin)})`,
        });
        continue;
      }
      if (fechaFueraDeVigencia(fecha, contrato.fecha_ingreso, contrato.fecha_cese)) {
        errores.push({
          fila: numeroFila,
          dni,
          motivo: `El ${fecha} esta fuera de la vigencia del contrato (ingreso: ${fechaISO(contrato.fecha_ingreso)}${
            contrato.fecha_cese ? `, cese: ${fechaISO(contrato.fecha_cese)}` : ""
          })`,
        });
        continue;
      }
      const minutos = parsearHoraMarcacion(fila[mapeo.hora] ?? "");
      if (minutos === null) {
        errores.push({ fila: numeroFila, dni, motivo: `Hora invalida: '${fila[mapeo.hora]}'` });
        continue;
      }
      const tipoTexto = mapeo.tipo ? (fila[mapeo.tipo] ?? "").trim().toUpperCase() : "";
      const tipo: "ENTRADA" | "SALIDA" | null = tipoTexto.startsWith("E") ? "ENTRADA" : tipoTexto.startsWith("S") ? "SALIDA" : null;

      const clave = `${contrato.id}|${fecha}`;
      const lista = marcasPorDia.get(clave) ?? [];
      lista.push({ minutos, tipo });
      marcasPorDia.set(clave, lista);
      infoPorClave.set(clave, { contratoId: contrato.id, fecha });
      contratosVistos.set(contrato.id, {
        proyecto: contrato.proyecto,
        apellidos_nombres: contrato.apellidos_nombres,
        numero_documento: dni,
      });
    }

    if (marcasPorDia.size === 0) {
      return res.status(400).json({ error: "Ninguna fila del archivo se pudo procesar", errores });
    }

    // Horario efectivo (con los mismos defaults que Configuracion ->
    // "Horario / Tramo 3 por proyecto") de cada proyecto involucrado.
    const proyectosInvolucrados = [...new Set([...contratosVistos.values()].map((c) => c.proyecto))];
    const horariosResult = await pool.query(
      `SELECT p.id AS proyecto_id, p.nombre AS proyecto_nombre, h.hora_ingreso, h.hora_salida, h.minutos_refrigerio,
              h.hora_ingreso_sabado, h.hora_salida_sabado, h.tasa_tramo3
       FROM proyectos p
       LEFT JOIN horarios_proyecto h ON h.proyecto_id = p.id
       WHERE p.nombre = ANY($1::text[])`,
      [proyectosInvolucrados]
    );
    const horarioPorProyecto = new Map<string, HorarioProyecto>(
      horariosResult.rows.map((fila) => [fila.proyecto_nombre as string, filaAHorarioProyecto(fila)])
    );

    // Catalogo de feriados vigentes por contrato (una consulta por contrato
    // involucrado, cubriendo todo el periodo) - migracion 048, reconstruida
    // desde backend_dist (ver RECONSTRUCCION_BRECHAS.md). Antes de esta
    // migracion, la tabla "dias_feriados" no existia todavia y esta
    // clasificacion se omitia (ningun dia importado se marcaba como
    // feriado); ahora se clasifica automaticamente igual que en el resto
    // del sistema.
    const feriadosPorContrato = new Map<number, Set<string>>();
    await Promise.all(
      [...contratosVistos.keys()].map(async (contratoId) => {
        feriadosPorContrato.set(
          contratoId,
          await obtenerFeriadosVigentes(req.params.id, contratoId, fechaISO(periodo.fecha_inicio), fechaISO(periodo.fecha_fin))
        );
      })
    );

    interface DiaCalculado {
      contratoId: number;
      fecha: string;
      horaIngresoReal: string;
      horaSalidaReal: string;
      marcas: { hora: string; tipo: "ENTRADA" | "SALIDA" | null }[];
      dia: FilaTareoDiario;
      minutosLlegadaAnticipada: number;
    }
    const diasCalculados: DiaCalculado[] = [];

    for (const [clave, marcas] of marcasPorDia) {
      const { contratoId, fecha } = infoPorClave.get(clave)!;
      const minutosOrdenados = marcas.map((m) => m.minutos).sort((a, b) => a - b);
      const minIngreso = minutosOrdenados[0];
      const maxSalida = minutosOrdenados[minutosOrdenados.length - 1];
      const contratoInfo = contratosVistos.get(contratoId)!;
      const horario: HorarioProyecto =
        horarioPorProyecto.get(contratoInfo.proyecto) ??
        filaAHorarioProyecto({ proyecto_id: 0, hora_ingreso: null, hora_salida: null, minutos_refrigerio: null, tasa_tramo3: null });

      const diaSemana = new Date(fecha + "T00:00:00Z").getUTCDay(); // 0=domingo .. 6=sabado
      const esFeriado = feriadosPorContrato.get(contratoId)?.has(fecha) ?? false;

      // Al importar, la llegada anticipada (si la hay) NUNCA se acredita
      // como hora extra todavia (incluirAnticipacionComoExtra=false) - eso
      // requiere que la persona que revisa la confirme explicitamente
      // despues, via PUT .../detalle/:id (ver calcularJornadaDesdeMarcas).
      const { dia, minutosLlegadaAnticipada } = calcularJornadaDesdeMarcas(
        minIngreso,
        maxSalida,
        diaSemana,
        esFeriado,
        horario,
        false
      );
      dia.fecha = fecha;

      diasCalculados.push({
        contratoId,
        fecha,
        horaIngresoReal: minutosATexto(minIngreso),
        horaSalidaReal: minutosATexto(maxSalida),
        marcas: marcas
          .slice()
          .sort((a, b) => a.minutos - b.minutos)
          .map((m) => ({ hora: minutosATexto(m.minutos), tipo: m.tipo })),
        dia,
        minutosLlegadaAnticipada,
      });
    }

    const cliente = await pool.connect();
    let importacionId: number;
    try {
      await cliente.query("BEGIN");
      const cabecera = await cliente.query(
        `INSERT INTO importaciones_marcaciones
           (periodo_id, nombre_archivo, importado_por, total_marcaciones, total_dias, total_errores, errores_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          req.params.id,
          req.file.originalname,
          req.usuario!.id,
          filas.length,
          diasCalculados.length,
          errores.length,
          JSON.stringify(errores),
        ]
      );
      importacionId = cabecera.rows[0].id;
      for (const d of diasCalculados) {
        await cliente.query(
          `INSERT INTO importaciones_marcaciones_detalle (
             importacion_id, contrato_id, fecha, hora_ingreso_real, hora_salida_real,
             horas_normales, minutos_normales, horas_dominical, minutos_dominical,
             horas_feriado, minutos_feriado, horas_extra_tramo1, minutos_extra_tramo1,
             horas_extra_tramo2, minutos_extra_tramo2, horas_extra_tramo3, minutos_extra_tramo3,
             marcas_json, minutos_llegada_anticipada, anticipacion_pagada
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [
            importacionId,
            d.contratoId,
            d.fecha,
            d.horaIngresoReal,
            d.horaSalidaReal,
            d.dia.horas_normales ?? 0,
            d.dia.minutos_normales ?? 0,
            d.dia.horas_dominical ?? 0,
            d.dia.minutos_dominical ?? 0,
            d.dia.horas_feriado ?? 0,
            d.dia.minutos_feriado ?? 0,
            d.dia.horas_extra_tramo1 ?? 0,
            d.dia.minutos_extra_tramo1 ?? 0,
            d.dia.horas_extra_tramo2 ?? 0,
            d.dia.minutos_extra_tramo2 ?? 0,
            d.dia.horas_extra_tramo3 ?? 0,
            d.dia.minutos_extra_tramo3 ?? 0,
            JSON.stringify(d.marcas),
            d.minutosLlegadaAnticipada,
            false,
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

    await registrarBitacora(req.usuario!.id, "IMPORTACION_MARCACIONES", "importaciones_marcaciones", importacionId, {
      periodo_id: req.params.id,
      nombre_archivo: req.file.originalname,
      total_marcaciones: filas.length,
      total_dias: diasCalculados.length,
      total_errores: errores.length,
    });

    res.status(201).json({
      importacion_id: importacionId,
      total_marcaciones: filas.length,
      total_dias: diasCalculados.length,
      total_errores: errores.length,
      errores,
    });
  })
);

// GET /api/periodos/:id/marcaciones -> lista (cabeceras) de las
// importaciones ya hechas en este periodo, mas recientes primero - para que
// el usuario pueda volver a revisar/aplicar una importacion anterior sin
// tener que volver a subir el archivo.

// Correccion (post-recon 048): "errores_json" (guardado en
// importaciones_marcaciones al importar, ver POST /importar de arriba) se
// devolvia completo, sin filtrar por proyecto - a diferencia de "detalle",
// que si se filtra. Si quien importo el archivo fue un ADMIN (alcance de
// TODA la empresa - periodo.proyecto nulo), esa lista puede traer errores
// de filas con DNIs de OTROS proyectos (ambiguedad entre proyectos, "no se
// encontro un contrato habil en el proyecto X", etc.). Un Tareador limitado
// a un solo proyecto que revisa esa misma importacion no deberia ver datos
// de empleados de proyectos que no le pertenecen. Se conservan los errores
// SIN DNI (estructurales - "DNI vacio", no identifican a nadie) y los que
// tengan un DNI con al menos un contrato en un proyecto accesible para este
// usuario; el resto se oculta. Un ADMIN ve la lista completa, sin cambios.
async function filtrarErroresPorAcceso(
  erroresJson: unknown,
  usuario: NonNullable<Request["usuario"]>
): Promise<unknown> {
  if (usuario.rol === "ADMIN" || !Array.isArray(erroresJson)) return erroresJson;
  const errores = erroresJson as { dni?: string }[];
  const dnisDelArchivo = [...new Set(errores.map((e) => (e.dni ?? "").trim()).filter((dni) => dni.length > 0))];
  let dnisVisibles = new Set<string>();
  if (dnisDelArchivo.length > 0) {
    const visiblesResult = await pool.query(
      `SELECT DISTINCT e.numero_documento
       FROM contratos c JOIN empleados e ON e.id = c.empleado_id
       WHERE e.numero_documento = ANY($1::text[]) AND c.proyecto = ANY($2::text[])`,
      [dnisDelArchivo, usuario.proyectos]
    );
    dnisVisibles = new Set(visiblesResult.rows.map((r) => r.numero_documento));
  }
  return errores.filter((e) => {
    const dni = (e.dni ?? "").trim();
    return dni.length === 0 || dnisVisibles.has(dni);
  });
}

planillaRouter.get(
  "/:id/marcaciones",
  asyncHandler(async (req: Request, res: Response) => {
    const r = await pool.query(
      `SELECT * FROM importaciones_marcaciones WHERE periodo_id = $1 ORDER BY importado_en DESC`,
      [req.params.id]
    );
    res.json(
      await Promise.all(
        r.rows.map(async (f) => ({
          id: f.id,
          periodo_id: f.periodo_id,
          nombre_archivo: f.nombre_archivo,
          importado_en: f.importado_en,
          total_marcaciones: f.total_marcaciones,
          total_dias: f.total_dias,
          total_errores: f.total_errores,
          errores: await filtrarErroresPorAcceso(f.errores_json, req.usuario!),
          aplicado_en: f.aplicado_en,
        }))
      )
    );
  })
);

// GET /api/periodos/:id/marcaciones/:importacionId -> el detalle ya
// calculado de una importacion, para la pantalla de revision manual.
planillaRouter.get(
  "/:id/marcaciones/:importacionId",
  asyncHandler(async (req: Request, res: Response) => {
    const cabeceraResult = await pool.query(
      `SELECT * FROM importaciones_marcaciones WHERE id = $1 AND periodo_id = $2`,
      [req.params.importacionId, req.params.id]
    );
    if (cabeceraResult.rowCount === 0) {
      return res.status(404).json({ error: "Importacion no encontrada" });
    }
    const cabecera = cabeceraResult.rows[0];

    const esAdmin = req.usuario!.rol === "ADMIN";
    const detalleResult = await pool.query(
      `SELECT d.*, c.proyecto, e.numero_documento, e.apellidos_nombres
       FROM importaciones_marcaciones_detalle d
       JOIN contratos c ON c.id = d.contrato_id
       JOIN empleados e ON e.id = c.empleado_id
       WHERE d.importacion_id = $1 ${esAdmin ? "" : "AND c.proyecto = ANY($2::text[])"}
       ORDER BY e.apellidos_nombres, d.fecha`,
      esAdmin ? [req.params.importacionId] : [req.params.importacionId, req.usuario!.proyectos]
    );

    const erroresVisibles = await filtrarErroresPorAcceso(cabecera.errores_json, req.usuario!);

    res.json({
      importacion: {
        id: cabecera.id,
        periodo_id: cabecera.periodo_id,
        nombre_archivo: cabecera.nombre_archivo,
        importado_en: cabecera.importado_en,
        total_marcaciones: cabecera.total_marcaciones,
        total_dias: cabecera.total_dias,
        total_errores: cabecera.total_errores,
        errores: erroresVisibles,
        aplicado_en: cabecera.aplicado_en,
      },
      detalle: detalleResult.rows.map((f) => ({
        id: f.id,
        contrato_id: f.contrato_id,
        numero_documento: f.numero_documento,
        apellidos_nombres: f.apellidos_nombres,
        fecha: fechaISO(f.fecha),
        hora_ingreso_real: f.hora_ingreso_real,
        hora_salida_real: f.hora_salida_real,
        horas_normales: f.horas_normales,
        minutos_normales: f.minutos_normales,
        horas_dominical: f.horas_dominical,
        minutos_dominical: f.minutos_dominical,
        horas_feriado: f.horas_feriado,
        minutos_feriado: f.minutos_feriado,
        horas_extra_tramo1: f.horas_extra_tramo1,
        minutos_extra_tramo1: f.minutos_extra_tramo1,
        horas_extra_tramo2: f.horas_extra_tramo2,
        minutos_extra_tramo2: f.minutos_extra_tramo2,
        horas_extra_tramo3: f.horas_extra_tramo3,
        minutos_extra_tramo3: f.minutos_extra_tramo3,
        marcas: f.marcas_json,
        aplicado: f.aplicado,
        minutos_llegada_anticipada: f.minutos_llegada_anticipada,
        anticipacion_pagada: f.anticipacion_pagada,
      })),
    });
  })
);

// PUT /api/periodos/:id/marcaciones/:importacionId/detalle/:detalleId
// body: { anticipacion_pagada: boolean } - confirma o retira el pago de la
// "llegada anticipada" de ese dia como hora extra (ver calcularJornadaDesdeMarcas
// y el comentario del 26/09 sobre esta decision). Recalcula el desglose de
// horas de ese dia entero (no solo el campo de anticipacion) porque el
// tramo1/2/3 depende de si esos minutos entran o no al total de extra.
planillaRouter.put(
  "/:id/marcaciones/:importacionId/detalle/:detalleId",
  asyncHandler(async (req: Request, res: Response) => {
    if (typeof req.body?.anticipacion_pagada !== "boolean") {
      return res.status(400).json({ error: "Falta 'anticipacion_pagada' (boolean)" });
    }
    const anticipacionPagada = req.body.anticipacion_pagada as boolean;

    const filaResult = await pool.query(
      `SELECT d.*, c.proyecto
       FROM importaciones_marcaciones_detalle d
       JOIN importaciones_marcaciones im ON im.id = d.importacion_id
       JOIN contratos c ON c.id = d.contrato_id
       WHERE d.id = $1 AND d.importacion_id = $2 AND im.periodo_id = $3`,
      [req.params.detalleId, req.params.importacionId, req.params.id]
    );
    if (filaResult.rowCount === 0) {
      return res.status(404).json({ error: "No se encontro esa fila de la importacion" });
    }
    const fila = filaResult.rows[0];
    // Correccion (post-recon 048): esta ruta nunca validaba que el usuario
    // tuviera acceso al proyecto del contrato de esta fila - un Tareador
    // limitado a un proyecto podia confirmar/retirar el pago de la "llegada
    // anticipada" (y por lo tanto cambiar el monto de horas extra) de un
    // contrato de OTRO proyecto, con solo conocer/adivinar el :detalleId.
    // Mismo criterio de acceso que el resto de rutas de marcaciones de este
    // archivo (ver /aplicar, mas abajo).
    if (!tieneAccesoProyecto(req.usuario!, fila.proyecto)) {
      return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    }
    if (fila.aplicado) {
      return res.status(400).json({
        error: "Esta fila ya se aplico al Tareo Diario - no se puede modificar. Reabra el periodo si necesita corregirla.",
      });
    }

    const minutosIngresoReal = fila.hora_ingreso_real ? textoAMinutos(String(fila.hora_ingreso_real).slice(0, 5)) : null;
    const minutosSalidaReal = fila.hora_salida_real ? textoAMinutos(String(fila.hora_salida_real).slice(0, 5)) : null;
    if (minutosIngresoReal === null || minutosSalidaReal === null) {
      return res.status(400).json({ error: "Esta fila no tiene hora de ingreso/salida registrada" });
    }

    const fecha = fechaISO(fila.fecha);
    const diaSemana = new Date(fecha + "T00:00:00Z").getUTCDay();
    // Migracion 048 (reconstruida desde backend_dist, ver
    // RECONSTRUCCION_BRECHAS.md): clasifica la fecha contra el catalogo real
    // de dias_feriados (con el mismo criterio de vigencia/ambito que el
    // resto del sistema), igual que la importacion masiva de arriba.
    const esFeriado = (await obtenerFeriadosVigentes(req.params.id, fila.contrato_id, fecha, fecha)).has(fecha);

    const horarioResult = await pool.query(
      `SELECT p.id AS proyecto_id, h.hora_ingreso, h.hora_salida, h.minutos_refrigerio,
              h.hora_ingreso_sabado, h.hora_salida_sabado, h.tasa_tramo3
       FROM proyectos p
       LEFT JOIN horarios_proyecto h ON h.proyecto_id = p.id
       WHERE p.nombre = $1`,
      [fila.proyecto]
    );
    const horario: HorarioProyecto =
      (horarioResult.rowCount ?? 0) > 0
        ? filaAHorarioProyecto(horarioResult.rows[0])
        : filaAHorarioProyecto({ proyecto_id: 0, hora_ingreso: null, hora_salida: null, minutos_refrigerio: null, tasa_tramo3: null });

    const { dia, minutosLlegadaAnticipada } = calcularJornadaDesdeMarcas(
      minutosIngresoReal,
      minutosSalidaReal,
      diaSemana,
      esFeriado,
      horario,
      anticipacionPagada
    );

    await pool.query(
      `UPDATE importaciones_marcaciones_detalle SET
         horas_normales = $1, minutos_normales = $2, horas_dominical = $3, minutos_dominical = $4,
         horas_feriado = $5, minutos_feriado = $6, horas_extra_tramo1 = $7, minutos_extra_tramo1 = $8,
         horas_extra_tramo2 = $9, minutos_extra_tramo2 = $10, horas_extra_tramo3 = $11, minutos_extra_tramo3 = $12,
         minutos_llegada_anticipada = $13, anticipacion_pagada = $14
       WHERE id = $15`,
      [
        dia.horas_normales ?? 0,
        dia.minutos_normales ?? 0,
        dia.horas_dominical ?? 0,
        dia.minutos_dominical ?? 0,
        dia.horas_feriado ?? 0,
        dia.minutos_feriado ?? 0,
        dia.horas_extra_tramo1 ?? 0,
        dia.minutos_extra_tramo1 ?? 0,
        dia.horas_extra_tramo2 ?? 0,
        dia.minutos_extra_tramo2 ?? 0,
        dia.horas_extra_tramo3 ?? 0,
        dia.minutos_extra_tramo3 ?? 0,
        minutosLlegadaAnticipada,
        anticipacionPagada,
        req.params.detalleId,
      ]
    );

    res.json({
      id: Number(req.params.detalleId),
      horas_normales: dia.horas_normales ?? 0,
      minutos_normales: dia.minutos_normales ?? 0,
      horas_dominical: dia.horas_dominical ?? 0,
      minutos_dominical: dia.minutos_dominical ?? 0,
      horas_feriado: dia.horas_feriado ?? 0,
      minutos_feriado: dia.minutos_feriado ?? 0,
      horas_extra_tramo1: dia.horas_extra_tramo1 ?? 0,
      minutos_extra_tramo1: dia.minutos_extra_tramo1 ?? 0,
      horas_extra_tramo2: dia.horas_extra_tramo2 ?? 0,
      minutos_extra_tramo2: dia.minutos_extra_tramo2 ?? 0,
      horas_extra_tramo3: dia.horas_extra_tramo3 ?? 0,
      minutos_extra_tramo3: dia.minutos_extra_tramo3 ?? 0,
      minutos_llegada_anticipada: minutosLlegadaAnticipada,
      anticipacion_pagada: anticipacionPagada,
    });
  })
);

// POST /api/periodos/:id/marcaciones/:importacionId/aplicar
// body opcional: { contrato_ids?: number[] } (por defecto, todos los dias
// todavia no aplicados de esta importacion). Escribe cada contrato en
// tareo_diario reusando la MISMA validacion que la edicion manual del
// Tareo Diario (validarYGuardarDiasTareoDiario) - si un contrato falla la
// validacion (ej. un dia excede el limite configurado), se reporta su
// error y se sigue con los demas, sin perder lo que si se pudo aplicar.
planillaRouter.post(
  "/:id/marcaciones/:importacionId/aplicar",
  asyncHandler(async (req: Request, res: Response) => {
    const periodo = await obtenerPeriodo(req.params.id);
    if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

    const cabeceraResult = await pool.query(
      `SELECT * FROM importaciones_marcaciones WHERE id = $1 AND periodo_id = $2`,
      [req.params.importacionId, req.params.id]
    );
    if (cabeceraResult.rowCount === 0) {
      return res.status(404).json({ error: "Importacion no encontrada" });
    }

    const contratoIdsFiltro = Array.isArray(req.body?.contrato_ids)
      ? (req.body.contrato_ids as number[])
      : null;

    const detalleResult = await pool.query(
      `SELECT * FROM importaciones_marcaciones_detalle
       WHERE importacion_id = $1 AND aplicado = false
       ORDER BY contrato_id, fecha`,
      [req.params.importacionId]
    );
    const filasPorContrato = new Map<number, typeof detalleResult.rows>();
    for (const fila of detalleResult.rows) {
      if (contratoIdsFiltro && !contratoIdsFiltro.includes(fila.contrato_id)) continue;
      const lista = filasPorContrato.get(fila.contrato_id) ?? [];
      lista.push(fila);
      filasPorContrato.set(fila.contrato_id, lista);
    }

    const aplicados: number[] = [];
    const errores: { contrato_id: number; motivo: string }[] = [];

    for (const [contratoId, filas] of filasPorContrato) {
      const proyecto = await verificarAccesoContrato(req, String(contratoId));
      if (proyecto === null) {
        errores.push({ contrato_id: contratoId, motivo: "El contrato ya no existe" });
        continue;
      }
      if (!tieneAccesoProyecto(req.usuario!, proyecto)) {
        errores.push({ contrato_id: contratoId, motivo: "No tienes acceso a ese proyecto" });
        continue;
      }
      if (periodo.proyecto && proyecto !== periodo.proyecto) {
        errores.push({
          contrato_id: contratoId,
          motivo: `Este periodo es especifico del proyecto '${periodo.proyecto}' y el contrato pertenece a '${proyecto}'`,
        });
        continue;
      }

      const dias: FilaTareoDiario[] = filas.map((f) => ({
        fecha: fechaISO(f.fecha),
        horas_normales: f.horas_normales,
        minutos_normales: f.minutos_normales,
        horas_dominical: f.horas_dominical,
        minutos_dominical: f.minutos_dominical,
        horas_feriado: f.horas_feriado,
        minutos_feriado: f.minutos_feriado,
        horas_extra_tramo1: f.horas_extra_tramo1,
        minutos_extra_tramo1: f.minutos_extra_tramo1,
        horas_extra_tramo2: f.horas_extra_tramo2,
        minutos_extra_tramo2: f.minutos_extra_tramo2,
        horas_extra_tramo3: f.horas_extra_tramo3,
        minutos_extra_tramo3: f.minutos_extra_tramo3,
      }));

      try {
        await validarYGuardarDiasTareoDiario(req.params.id, contratoId, dias);
      } catch (err) {
        if (err instanceof ErrorValidacion) {
          errores.push({ contrato_id: contratoId, motivo: err.message });
          continue;
        }
        throw err;
      }

      await recalcularAsistenciaDesdeTareoDiario(req.params.id, contratoId);
      await pool.query(
        `UPDATE importaciones_marcaciones_detalle SET aplicado = true
         WHERE importacion_id = $1 AND contrato_id = $2`,
        [req.params.importacionId, contratoId]
      );
      aplicados.push(contratoId);
    }

    if (aplicados.length > 0) {
      await pool.query(
        `UPDATE importaciones_marcaciones SET aplicado_en = now(), aplicado_por = $2
         WHERE id = $1 AND aplicado_en IS NULL`,
        [req.params.importacionId, req.usuario!.id]
      );
      await registrarBitacora(req.usuario!.id, "IMPORTACION_MARCACIONES_APLICADA", "tareo_diario", null, {
        periodo_id: req.params.id,
        importacion_id: req.params.importacionId,
        contratos_aplicados: aplicados,
      });
    }

    res.json({ aplicados, errores });
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
      `SELECT a.contrato_id, a.dias_trabajados, a.dias_dominical, a.dias_dominical_no_laborado, a.dias_feriado,
              a.dias_feriado_trabajado, a.dias_falta,
              a.horas_extra_25, a.horas_extra_35, a.horas_extra_100,
              a.dias_subsidio_enfermedad, a.dias_incapacidad_enfermedad, a.dias_subsidio_maternidad, a.dias_licencia_paternidad,
              a.dias_subsidio_enfermedad_computable,
              c.*, e.numero_hijos, e.numero_documento, e.apellidos_nombres,
              -- migracion_029: cuota_sindical_categoria (proyecto+categoria) tiene
              -- prioridad; si esa combinacion todavia no esta configurada, se cae
              -- al valor unico legado de proyectos.cuota_sindical_semanal (nunca
              -- se deja de descontar por accidente por una combinacion sin
              -- configurar, ej. un proyecto recien creado).
              COALESCE(csc.monto_semanal, p.cuota_sindical_semanal, 0) AS cuota_sindical_semanal,
              -- migracion_045: recargo de tramo3 de horas extra pactado por el
              -- proyecto (NULL si el proyecto no tiene uno propio configurado -
              -- calcularHorasExtra usa el recargo general de la empresa en ese caso).
              h.tasa_tramo3 AS tasa_tramo3_proyecto
       FROM asistencia_periodo a
       JOIN contratos c ON c.id = a.contrato_id
       JOIN empleados e ON e.id = c.empleado_id
       LEFT JOIN proyectos p ON p.nombre = c.proyecto
       LEFT JOIN cuota_sindical_categoria csc ON csc.proyecto_id = p.id AND csc.categoria = c.categoria_ocupacional
       LEFT JOIN horarios_proyecto h ON h.proyecto_id = p.id
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

    const parametros = await obtenerParametros(periodo.anio, periodo.mes);
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
          parametros: await obtenerParametros(anio, mes),
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
    // Ronda 4 ("piso de EsSalud mensual"): informativo, nunca bloquea - ver
    // ajustarPisoEssaludDelMes. Se llena cuando el ajuste de piso de este
    // mes calendario quedo en un periodo DISTINTO al que se acaba de
    // calcular (correccion en cascada de un periodo ya cerrado).
    const avisosEssalud: Array<{
      contrato_id: number;
      dni: string;
      nombre: string;
      mensaje: string;
    }> = [];

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
        dias_dominical_no_laborado: Number(fila.dias_dominical_no_laborado),
        dias_feriado: Number(fila.dias_feriado),
        dias_feriado_trabajado: Number(fila.dias_feriado_trabajado),
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

      // Migracion 045: NULL (proyecto sin tasa propia configurada) se deja
      // en undefined a proposito - calcularHorasExtra usa entonces el
      // recargo general de la empresa, exactamente igual que antes.
      const tasaTramo3Proyecto = fila.tasa_tramo3_proyecto != null ? Number(fila.tasa_tramo3_proyecto) : undefined;

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
                periodo.tipo,
                tasaTramo3Proyecto
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
            periodo.tipo,
            tasaTramo3Proyecto
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
             dias_incapacidad_enfermedad, incapacidad_enfermedad, essalud_base
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
             $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46
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
             essalud_base = EXCLUDED.essalud_base,
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
            detalle.essalud_base,
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

        // Ronda 4 ("piso de EsSalud mensual"): reconcilia el aporte de
        // EsSalud de TODOS los periodos de este contrato en periodo.anio/mes
        // (incluido el que se acaba de guardar). Puede corregir en cascada
        // un periodo DISTINTO ya calculado antes (ver el comentario de la
        // funcion) - por eso se refleja tanto en la fila que se acaba de
        // insertar (lineasCalculadas) como en un aviso si el ajuste quedo en
        // otro periodo.
        const cambiosEssalud = await ajustarPisoEssaludDelMes(
          cliente,
          contrato.id,
          periodo.anio,
          periodo.mes,
          parametros
        );
        for (const cambio of cambiosEssalud) {
          if (cambio.periodoId === r.rows[0].id) {
            // La propia fila que se acaba de insertar: refleja el valor
            // final ya reconciliado en la respuesta de este /calcular.
            r.rows[0].essalud = cambio.essaludNuevo;
            continue;
          }
          avisosEssalud.push({
            contrato_id: contrato.id,
            dni: contrato.numero_documento,
            nombre: contrato.apellidos_nombres,
            mensaje:
              `Se ajusto automaticamente el aporte EsSalud de otro periodo de ${MESES[periodo.mes - 1]} ${periodo.anio} ` +
              `ya calculado (de S/ ${cambio.essaludAnterior.toFixed(2)} a S/ ${cambio.essaludNuevo.toFixed(2)}) ` +
              `para mantener el piso legal mensual (9% de la RMV vigente ese mes).`,
          });
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
      avisos_essalud: avisosEssalud,
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
