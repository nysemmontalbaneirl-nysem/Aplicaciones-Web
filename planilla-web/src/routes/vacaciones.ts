import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requiereRol } from "../authMiddleware";
import { tieneAccesoProyecto } from "../permisos";
import { pool } from "../db";
import { ErrorValidacion } from "../validaciones";
import { calcularBoletaVacaciones } from "../motorCalculo";
import { obtenerAfpTasas, obtenerParametros } from "./planilla";
import { TasasAFPMensuales } from "../tipos";

export const vacacionesRouter = Router();

// Record vacacional minimo exigido por el D.Leg. 713 para jornada de 6
// dias por semana (confirmado con el usuario para sus Empleados
// administrativos). Si en el futuro hay trabajadores con jornada de 5
// dias, este umbral tendria que ser 210 y ser configurable por contrato.
const UMBRAL_DIAS_RECORD = 260;
const DIAS_POR_ANIO_COMPLETO = 30;

function redondear(v: number): number {
  return Math.round(v * 100) / 100;
}

// Genera los periodos vacacionales (aniversario a aniversario) desde la
// fecha de ingreso hasta la fecha de corte (hoy, o la fecha de cese).
function generarPeriodosVacacionales(fechaIngreso: Date, fechaCorte: Date): { inicio: Date; fin: Date }[] {
  const periodos: { inicio: Date; fin: Date }[] = [];
  let inicio = new Date(fechaIngreso);
  while (inicio < fechaCorte) {
    const fin = new Date(inicio);
    fin.setUTCFullYear(fin.getUTCFullYear() + 1);
    fin.setUTCDate(fin.getUTCDate() - 1);
    periodos.push({ inicio: new Date(inicio), fin: fin < fechaCorte ? fin : fechaCorte });
    inicio = new Date(inicio);
    inicio.setUTCFullYear(inicio.getUTCFullYear() + 1);
  }
  return periodos;
}

async function obtenerContratoOFallar(contratoId: string) {
  const r = await pool.query(
    `SELECT c.*, e.apellidos_nombres, e.numero_documento, e.numero_hijos
     FROM contratos c JOIN empleados e ON e.id = c.empleado_id
     WHERE c.id = $1`,
    [contratoId]
  );
  if (r.rowCount === 0) {
    throw Object.assign(new Error("Contrato no encontrado"), { status: 404 });
  }
  return r.rows[0];
}

// GET /api/vacaciones/:contratoId -> record vacacional completo: periodos
// anuales con dias computables/ganados, total ganado, total gozado, saldo
// pendiente, y el historial de goces registrados.
vacacionesRouter.get(
  "/:contratoId",
  requiereRol("ADMIN", "RESPONSABLE_PLANILLA"),
  asyncHandler(async (req: Request, res: Response) => {
    let contrato;
    try {
      contrato = await obtenerContratoOFallar(req.params.contratoId);
    } catch (err) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    if (!tieneAccesoProyecto(req.usuario!, contrato.proyecto)) {
      return res.status(403).json({ error: "No tienes acceso a este proyecto" });
    }

    const fechaIngreso = new Date(contrato.fecha_ingreso);
    const fechaCorte = contrato.fecha_cese ? new Date(contrato.fecha_cese) : new Date();

    const asistenciaResult = await pool.query(
      `SELECT a.dias_trabajados, a.dias_dominical, a.dias_feriado, p.fecha_inicio
       FROM asistencia_periodo a
       JOIN periodos_planilla p ON p.id = a.periodo_id
       WHERE a.contrato_id = $1
       ORDER BY p.fecha_inicio ASC`,
      [req.params.contratoId]
    );

    const periodosVacacionales = generarPeriodosVacacionales(fechaIngreso, fechaCorte);
    const periodos = periodosVacacionales.map(({ inicio, fin }) => {
      let diasComputables = 0;
      for (const fila of asistenciaResult.rows) {
        const fechaTareo = new Date(fila.fecha_inicio);
        if (fechaTareo >= inicio && fechaTareo <= fin) {
          diasComputables += Number(fila.dias_trabajados) + Number(fila.dias_dominical) + Number(fila.dias_feriado);
        }
      }
      const diasGanados = redondear(
        Math.min(DIAS_POR_ANIO_COMPLETO, (DIAS_POR_ANIO_COMPLETO * Math.min(diasComputables, UMBRAL_DIAS_RECORD)) / UMBRAL_DIAS_RECORD)
      );
      return {
        fecha_inicio: inicio.toISOString().slice(0, 10),
        fecha_fin: fin.toISOString().slice(0, 10),
        dias_computables: redondear(diasComputables),
        dias_ganados: diasGanados,
        cumplio_record: diasComputables >= UMBRAL_DIAS_RECORD,
      };
    });

    const totalGanado = redondear(periodos.reduce((suma, p) => suma + p.dias_ganados, 0));

    const goceResult = await pool.query(
      `SELECT g.*, b.id AS boleta_id, b.remuneracion_vacacional, b.neto_pagar AS boleta_neto_pagar
       FROM vacaciones_goce g
       LEFT JOIN boletas_vacaciones b ON b.goce_id = g.id
       WHERE g.contrato_id = $1
       ORDER BY g.fecha_inicio DESC`,
      [req.params.contratoId]
    );
    const totalGozado = goceResult.rows.reduce((suma, g) => suma + Number(g.dias), 0);

    res.json({
      contrato: {
        id: contrato.id,
        numero_documento: contrato.numero_documento,
        apellidos_nombres: contrato.apellidos_nombres,
        proyecto: contrato.proyecto,
        fecha_ingreso: contrato.fecha_ingreso,
        fecha_cese: contrato.fecha_cese,
      },
      umbral_dias_record: UMBRAL_DIAS_RECORD,
      periodos,
      total_ganado: totalGanado,
      total_gozado: totalGozado,
      saldo_pendiente: redondear(totalGanado - totalGozado),
      goces: goceResult.rows,
    });
  })
);

// POST /api/vacaciones/:contratoId/goce  body: { fecha_inicio, fecha_fin, observaciones? }
vacacionesRouter.post(
  "/:contratoId/goce",
  requiereRol("ADMIN", "RESPONSABLE_PLANILLA"),
  asyncHandler(async (req: Request, res: Response) => {
    let contrato;
    try {
      contrato = await obtenerContratoOFallar(req.params.contratoId);
    } catch (err) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    if (!tieneAccesoProyecto(req.usuario!, contrato.proyecto)) {
      return res.status(403).json({ error: "No tienes acceso a este proyecto" });
    }

    if (contrato.categoria_ocupacional !== "EMPLEADO") {
      return res.status(400).json({
        error: "El registro de goce de vacaciones solo aplica a la categoria EMPLEADO (regimen general)",
      });
    }

    const b = req.body;
    let goce;
    try {
      if (!b.fecha_inicio || !b.fecha_fin) {
        throw new ErrorValidacion("fecha_inicio y fecha_fin son obligatorios");
      }
      const inicio = new Date(b.fecha_inicio);
      const fin = new Date(b.fecha_fin);
      const dias = Math.round((fin.getTime() - inicio.getTime()) / 86400000) + 1;
      if (!Number.isFinite(dias) || dias <= 0) {
        throw new ErrorValidacion("El rango de fechas no es valido (fecha_fin debe ser posterior a fecha_inicio)");
      }

      const r = await pool.query(
        `INSERT INTO vacaciones_goce (contrato_id, fecha_inicio, fecha_fin, dias, observaciones)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.params.contratoId, b.fecha_inicio, b.fecha_fin, dias, b.observaciones ?? null]
      );
      goce = r.rows[0];

      // Cada goce registrado genera de inmediato su propia boleta de
      // vacaciones (separada de la planilla mensual, segun lo pedido).
      const anio = inicio.getUTCFullYear();
      const mes = inicio.getUTCMonth() + 1;
      const parametros = await obtenerParametros(anio);
      const afpTasas =
        contrato.sistema_pension === "AFP" ? await obtenerAfpTasas(anio, mes) : ({} as TasasAFPMensuales);
      const detalle = calcularBoletaVacaciones(contrato, contrato.numero_hijos ?? 0, dias, parametros, afpTasas);

      const br = await pool.query(
        `INSERT INTO boletas_vacaciones
           (goce_id, contrato_id, fecha_inicio, fecha_fin, dias, remuneracion_vacacional, aporte_pension, essalud, sctr, neto_pagar, detalle_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          goce.id,
          req.params.contratoId,
          b.fecha_inicio,
          b.fecha_fin,
          dias,
          detalle.remuneracionVacacional,
          detalle.aportePension.total,
          detalle.essalud,
          detalle.sctr,
          detalle.netoPagar,
          JSON.stringify({ aporte_pension_detalle: detalle.aportePension }),
        ]
      );

      res.status(201).json({ ...goce, boleta: br.rows[0] });
    } catch (err) {
      // Si la boleta no se pudo generar (ej. faltan parametros_normativos
      // del anio), no dejamos un goce huerfano sin su boleta.
      if (goce) {
        await pool.query("DELETE FROM vacaciones_goce WHERE id = $1", [goce.id]);
      }
      if (err instanceof ErrorValidacion) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  })
);

// GET /api/vacaciones/:contratoId/goce/:goceId/boleta -> boleta de
// vacaciones ya generada, con el detalle necesario para imprimirla.
vacacionesRouter.get(
  "/:contratoId/goce/:goceId/boleta",
  requiereRol("ADMIN", "RESPONSABLE_PLANILLA"),
  asyncHandler(async (req: Request, res: Response) => {
    let contrato;
    try {
      contrato = await obtenerContratoOFallar(req.params.contratoId);
    } catch (err) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    if (!tieneAccesoProyecto(req.usuario!, contrato.proyecto)) {
      return res.status(403).json({ error: "No tienes acceso a este proyecto" });
    }

    const r = await pool.query(
      `SELECT * FROM boletas_vacaciones WHERE goce_id = $1 AND contrato_id = $2`,
      [req.params.goceId, req.params.contratoId]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "No hay boleta de vacaciones para ese registro" });
    }

    res.json({
      boleta: r.rows[0],
      contrato: {
        id: contrato.id,
        numero_documento: contrato.numero_documento,
        apellidos_nombres: contrato.apellidos_nombres,
        proyecto: contrato.proyecto,
        categoria_ocupacional: contrato.categoria_ocupacional,
        sistema_pension: contrato.sistema_pension,
        afp_nombre: contrato.afp_nombre,
        cuspp: contrato.cuspp,
        numero_hijos: contrato.numero_hijos,
      },
    });
  })
);

// DELETE /api/vacaciones/:contratoId/goce/:goceId
vacacionesRouter.delete(
  "/:contratoId/goce/:goceId",
  requiereRol("ADMIN", "RESPONSABLE_PLANILLA"),
  asyncHandler(async (req: Request, res: Response) => {
    let contrato;
    try {
      contrato = await obtenerContratoOFallar(req.params.contratoId);
    } catch (err) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    if (!tieneAccesoProyecto(req.usuario!, contrato.proyecto)) {
      return res.status(403).json({ error: "No tienes acceso a este proyecto" });
    }

    await pool.query("DELETE FROM vacaciones_goce WHERE id = $1 AND contrato_id = $2", [
      req.params.goceId,
      req.params.contratoId,
    ]);
    res.status(204).end();
  })
);
