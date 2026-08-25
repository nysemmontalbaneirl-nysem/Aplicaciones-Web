import { Router, Request, Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { asyncHandler } from "../asyncHandler";
import { requiereRol } from "../authMiddleware";
import { pool } from "../db";
import { calcularLineaPlanilla } from "../motorCalculo";
import { obtenerConceptos } from "./conceptos";
import { tieneAccesoProyecto } from "../permisos";
import { Contrato, ParametrosNormativos, TablaSalarialMensual, TasasAFPMensuales } from "../tipos";
import { ErrorValidacion } from "../validaciones";

export const planillaRouter = Router();

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

// GET /api/periodos/:id/planilla?q=texto -> boletas ya calculadas de ese
// periodo (usado por la pestana Boletas). q filtra por DNI o nombre.
// TAREADOR no tiene acceso a boletas; RESPONSABLE_PLANILLA solo ve las de
// sus proyectos asignados.
planillaRouter.get(
  "/:id/planilla",
  requiereRol("ADMIN", "RESPONSABLE_PLANILLA"),
  asyncHandler(async (req: Request, res: Response) => {
  const periodo = await obtenerPeriodo(req.params.id);
  if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

  const q = (req.query.q as string | undefined)?.trim();
  const condiciones = ["d.periodo_id = $1"];
  const valores: unknown[] = [req.params.id];
  if (q) {
    valores.push(`%${q}%`);
    condiciones.push(`(e.numero_documento ILIKE $${valores.length} OR e.apellidos_nombres ILIKE $${valores.length})`);
  }
  if (req.usuario!.rol !== "ADMIN") {
    valores.push(req.usuario!.proyectos);
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
  res.json({ periodo, detalle: resultado.rows });
}));

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
}

async function guardarAsistencia(periodoId: string, fila: FilaAsistencia) {
  await pool.query(
    `INSERT INTO asistencia_periodo (
       periodo_id, contrato_id, dias_trabajados, dias_dominical, dias_feriado,
       dias_falta, horas_extra_25, horas_extra_35, horas_extra_100
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (periodo_id, contrato_id) DO UPDATE SET
       dias_trabajados = EXCLUDED.dias_trabajados,
       dias_dominical = EXCLUDED.dias_dominical,
       dias_feriado = EXCLUDED.dias_feriado,
       dias_falta = EXCLUDED.dias_falta,
       horas_extra_25 = EXCLUDED.horas_extra_25,
       horas_extra_35 = EXCLUDED.horas_extra_35,
       horas_extra_100 = EXCLUDED.horas_extra_100,
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
  res.status(204).send();
}));

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
  requiereRol("ADMIN", "RESPONSABLE_PLANILLA"),
  asyncHandler(async (req: Request, res: Response) => {
  const cliente = await pool.connect();
  try {
    const periodo = await obtenerPeriodo(req.params.id);
    if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

    const esAdminCalculo = req.usuario!.rol === "ADMIN";
    const asistenciaResult = await pool.query(
      `SELECT a.contrato_id, a.dias_trabajados, a.dias_dominical, a.dias_feriado, a.dias_falta,
              a.horas_extra_25, a.horas_extra_35, a.horas_extra_100,
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

    for (let i = 0; i < asistenciaResult.rows.length; i++) {
      const fila = asistenciaResult.rows[i];
      const contrato = fila as Contrato & { numero_hijos: number; numero_documento: string; apellidos_nombres: string };
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
    res.json({
      periodo_id: periodo.id,
      trabajadores_calculados: lineasCalculadas.length,
      detalle: lineasCalculadas,
      errores: erroresCalculo,
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
