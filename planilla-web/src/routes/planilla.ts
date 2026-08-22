import { Router, Request, Response } from "express";
import { pool } from "../db";
import { calcularLineaPlanilla } from "../motorCalculo";
import { Contrato, ParametrosNormativos } from "../tipos";
import { ErrorValidacion, validarListaAsistencia } from "../validaciones";

export const planillaRouter = Router();

async function obtenerPeriodo(periodoId: string) {
  const r = await pool.query("SELECT * FROM periodos_planilla WHERE id = $1", [periodoId]);
  return r.rows[0] ?? null;
}

async function obtenerParametros(anio: number): Promise<ParametrosNormativos> {
  const r = await pool.query("SELECT * FROM parametros_normativos WHERE anio = $1", [anio]);
  if (r.rowCount === 0) {
    throw new ErrorValidacion(`No hay parametros_normativos configurados para el anio ${anio}`);
  }
  return r.rows[0] as ParametrosNormativos;
}

// GET /api/periodos/:id/planilla -> planilla ya calculada de ese periodo
planillaRouter.get("/:id/planilla", async (req: Request, res: Response) => {
  const periodo = await obtenerPeriodo(req.params.id);
  if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

  const resultado = await pool.query(
    `SELECT d.*, e.apellidos_nombres, e.numero_documento, c.proyecto, c.categoria_ocupacional
     FROM detalle_planilla d
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     WHERE d.periodo_id = $1
     ORDER BY e.apellidos_nombres ASC`,
    [req.params.id]
  );
  res.json({ periodo, detalle: resultado.rows });
});

// POST /api/periodos/:id/calcular  body: { asistencias: AsistenciaEntrada[] }
planillaRouter.post("/:id/calcular", async (req: Request, res: Response) => {
  const cliente = await pool.connect();
  try {
    const periodo = await obtenerPeriodo(req.params.id);
    if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

    const asistencias = validarListaAsistencia(req.body.asistencias);
    const parametros = await obtenerParametros(periodo.anio);

    const contratoIds = asistencias.map((a) => a.contrato_id);
    const contratosResult = await pool.query(
      `SELECT c.*, e.numero_hijos
       FROM contratos c JOIN empleados e ON e.id = c.empleado_id
       WHERE c.id = ANY($1::int[])`,
      [contratoIds]
    );
    const contratosPorId = new Map<number, Contrato & { numero_hijos: number }>();
    for (const fila of contratosResult.rows) {
      contratosPorId.set(fila.id, fila);
    }

    await cliente.query("BEGIN");

    const lineasCalculadas = [];
    for (const asistencia of asistencias) {
      const contrato = contratosPorId.get(asistencia.contrato_id);
      if (!contrato) {
        throw new ErrorValidacion(`contrato_id ${asistencia.contrato_id} no existe`);
      }

      const { detalle } = calcularLineaPlanilla(
        contrato,
        contrato.numero_hijos,
        asistencia,
        parametros,
        periodo.dias_periodo,
        periodo.mes,
        periodo.anio
      );

      const r = await cliente.query(
        `INSERT INTO detalle_planilla (
           periodo_id, contrato_id, dias_trabajados, dias_dominical, dias_feriado, dias_falta,
           horas_extra_25, horas_extra_35, horas_extra_100, jornal_diario, sueldo_basico,
           remuneracion_dominical, remuneracion_feriado, importe_horas_extra, asignacion_familiar,
           bonificacion_buc, otras_bonificaciones, gratificacion, cts, vacaciones, total_ingresos,
           aporte_pension, descuento_sindicato, seguro_vida, conafovicer, renta_5ta,
           otros_descuentos, total_descuentos, essalud, sctr, senati, neto_pagar, detalle_json
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
           $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
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
           bonificacion_buc = EXCLUDED.bonificacion_buc,
           otras_bonificaciones = EXCLUDED.otras_bonificaciones,
           gratificacion = EXCLUDED.gratificacion,
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
          detalle.bonificacion_buc,
          detalle.otras_bonificaciones,
          detalle.gratificacion,
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
    }

    await cliente.query(
      "UPDATE periodos_planilla SET estado = 'CALCULADO' WHERE id = $1",
      [periodo.id]
    );

    await cliente.query("COMMIT");
    res.json({ periodo_id: periodo.id, trabajadores_calculados: lineasCalculadas.length, detalle: lineasCalculadas });
  } catch (err) {
    await cliente.query("ROLLBACK");
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  } finally {
    cliente.release();
  }
});
