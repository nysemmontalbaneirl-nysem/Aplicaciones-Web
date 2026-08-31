import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { pool } from "../db";

export const dashboardRouter = Router();

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

interface Alerta {
  tipo: string;
  mensaje: string;
}

// GET /api/dashboard/resumen -> pantalla de inicio. Abierta a cualquier
// usuario logueado (no exige un permiso especifico, como Trabajadores),
// pero todo lo que devuelve viene filtrado a los proyectos del usuario
// (igual que el resto del sistema) y el costo de la planilla solo se
// incluye si el usuario tiene permiso de ver boletas o reportes - no tiene
// sentido mostrarle montos de sueldos a alguien que no puede ver boletas.
dashboardRouter.get(
  "/resumen",
  asyncHandler(async (req: Request, res: Response) => {
    const usuario = req.usuario!;
    const esAdmin = usuario.rol === "ADMIN";
    const puedeVerMontos = usuario.permisos.includes("*") || usuario.permisos.includes("boletas.ver") || usuario.permisos.includes("reportes.ver");

    const filtroProyecto = esAdmin ? "" : "AND c.proyecto = ANY($1::text[])";
    const valoresProyecto = esAdmin ? [] : [usuario.proyectos];

    const trabajadoresResult = await pool.query(
      `SELECT COUNT(*) FROM contratos c WHERE c.estado = 'HABIL' ${filtroProyecto}`,
      valoresProyecto
    );
    const trabajadores_activos = Number(trabajadoresResult.rows[0].count);

    const proyectosResult = esAdmin
      ? await pool.query("SELECT COUNT(*) FROM proyectos WHERE estado = 'ACTIVO'")
      : await pool.query(
          "SELECT COUNT(*) FROM proyectos WHERE estado = 'ACTIVO' AND nombre = ANY($1::text[])",
          [usuario.proyectos]
        );
    const proyectos_activos = Number(proyectosResult.rows[0].count);

    const periodoResult = await pool.query(
      "SELECT * FROM periodos_planilla ORDER BY anio DESC, mes DESC, quincena NULLS FIRST LIMIT 1"
    );
    const periodo = periodoResult.rows[0] ?? null;

    let periodo_actual = null;
    const alertas: Alerta[] = [];

    if (periodo) {
      const tareoResult = await pool.query(
        `SELECT COUNT(DISTINCT a.contrato_id) FROM asistencia_periodo a
         JOIN contratos c ON c.id = a.contrato_id
         WHERE a.periodo_id = $1 ${esAdmin ? "" : "AND c.proyecto = ANY($2::text[])"}`,
        esAdmin ? [periodo.id] : [periodo.id, usuario.proyectos]
      );
      const trabajadores_con_tareo = Number(tareoResult.rows[0].count);

      let costo_total_ingresos: number | null = null;
      if (puedeVerMontos) {
        const costoResult = await pool.query(
          `SELECT COALESCE(SUM(d.total_ingresos), 0) AS total FROM detalle_planilla d
           JOIN contratos c ON c.id = d.contrato_id
           WHERE d.periodo_id = $1 ${esAdmin ? "" : "AND c.proyecto = ANY($2::text[])"}`,
          esAdmin ? [periodo.id] : [periodo.id, usuario.proyectos]
        );
        costo_total_ingresos = Number(costoResult.rows[0].total);
      }

      periodo_actual = {
        id: periodo.id,
        anio: periodo.anio,
        mes: periodo.mes,
        quincena: periodo.quincena,
        tipo: periodo.tipo,
        fecha_inicio: periodo.fecha_inicio,
        fecha_fin: periodo.fecha_fin,
        estado: periodo.estado,
        trabajadores_con_tareo,
        costo_total_ingresos,
      };

      if (periodo.estado === "ABIERTO" && trabajadores_con_tareo === 0) {
        alertas.push({
          tipo: "SIN_TAREO",
          mensaje: `El periodo de ${MESES[periodo.mes - 1]} ${periodo.anio} todavia no tiene tareo cargado.`,
        });
      }
    }

    if (esAdmin) {
      const sinResponsable = await pool.query(
        `SELECT p.nombre FROM proyectos p
         WHERE p.estado = 'ACTIVO'
           AND NOT EXISTS (
             SELECT 1 FROM usuario_proyecto up
             JOIN usuarios u ON u.id = up.usuario_id
             WHERE up.proyecto_id = p.id AND u.rol = 'RESPONSABLE_PLANILLA' AND u.activo
           )
         ORDER BY p.nombre`
      );
      for (const fila of sinResponsable.rows) {
        alertas.push({
          tipo: "PROYECTO_SIN_RESPONSABLE",
          mensaje: `El proyecto "${fila.nombre}" no tiene ningun Encargado de planilla activo asignado.`,
        });
      }
    }

    res.json({ trabajadores_activos, proyectos_activos, periodo_actual, alertas });
  })
);
