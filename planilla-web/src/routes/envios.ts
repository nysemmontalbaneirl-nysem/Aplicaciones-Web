import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { enviarCorreo } from "../correo";
import { DetalleBoletaPdf, generarPdfBoleta } from "../boletaPdf";
import { registrarBitacora } from "../bitacora";

export const enviosRouter = Router();

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
];

interface ErrorEnvio {
  dni: string;
  nombre: string;
  motivo: string;
}

// POST /api/periodos/:id/boletas/enviar-correo  body: { detalle_ids: number[] }
// Envia por correo, en PDF, las boletas seleccionadas (el ADMIN o el
// Encargado de planilla elige cuales desde la pestaña Boletas). Solo manda
// las que pertenecen a ese periodo Y a un proyecto que el usuario tenga
// asignado (mismo filtro que el resto del sistema) - asi no se puede pedir
// por id una boleta de un proyecto ajeno.
enviosRouter.post(
  "/:id/boletas/enviar-correo",
  requierePermiso("boletas.enviar"),
  asyncHandler(async (req: Request, res: Response) => {
    const detalleIds = req.body?.detalle_ids;
    if (!Array.isArray(detalleIds) || detalleIds.length === 0) {
      return res.status(400).json({ error: "detalle_ids debe ser un arreglo con al menos un id" });
    }

    const periodoResult = await pool.query("SELECT * FROM periodos_planilla WHERE id = $1", [req.params.id]);
    const periodo = periodoResult.rows[0];
    if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

    const esAdmin = req.usuario!.rol === "ADMIN";
    const filas = await pool.query(
      `SELECT d.*, e.apellidos_nombres, e.numero_documento, e.numero_hijos, e.correo,
              c.proyecto, c.categoria_ocupacional, c.sistema_pension, c.afp_nombre, c.cuspp, c.fecha_ingreso
       FROM detalle_planilla d
       JOIN contratos c ON c.id = d.contrato_id
       JOIN empleados e ON e.id = c.empleado_id
       WHERE d.periodo_id = $1 AND d.id = ANY($2::int[])
       ${esAdmin ? "" : "AND c.proyecto = ANY($3::text[])"}`,
      esAdmin ? [req.params.id, detalleIds] : [req.params.id, detalleIds, req.usuario!.proyectos]
    );

    const errores: ErrorEnvio[] = [];
    let enviados = 0;
    const enviadosDetalle: Array<{ dni: string; nombre: string; correo: string }> = [];

    for (const fila of filas.rows) {
      if (!fila.correo?.trim()) {
        errores.push({
          dni: fila.numero_documento,
          nombre: fila.apellidos_nombres,
          motivo: "No tiene un correo registrado (pestaña Trabajadores)",
        });
        continue;
      }
      try {
        const pdf = await generarPdfBoleta(fila as DetalleBoletaPdf, periodo);
        const nombreArchivo = `Boleta_${MESES[periodo.mes - 1]}_${periodo.anio}_${fila.numero_documento}.pdf`;
        await enviarCorreo({
          para: fila.correo.trim(),
          asunto: `Boleta de pago - ${MESES[periodo.mes - 1]} ${periodo.anio}`,
          textoPlano:
            `Hola ${fila.apellidos_nombres},\n\n` +
            `Adjunto tu boleta de pago de ${MESES[periodo.mes - 1]} ${periodo.anio}.\n\n` +
            `Este es un correo automatico, no respondas a este mensaje.`,
          adjuntos: [{ nombreArchivo, contenido: pdf }],
        });
        enviados++;
        enviadosDetalle.push({ dni: fila.numero_documento, nombre: fila.apellidos_nombres, correo: fila.correo });
      } catch (err) {
        errores.push({
          dni: fila.numero_documento,
          nombre: fila.apellidos_nombres,
          motivo: (err as Error).message,
        });
      }
    }

    const idsEncontrados = new Set(filas.rows.map((f) => f.id));
    for (const id of detalleIds) {
      if (!idsEncontrados.has(id)) {
        errores.push({ dni: "", nombre: `(id ${id})`, motivo: "No encontrada en este periodo o sin acceso" });
      }
    }

    await registrarBitacora(req.usuario!.id, "ENVIO_BOLETA_CORREO", "detalle_planilla", periodo.id, {
      periodo: `${periodo.mes}/${periodo.anio}`,
      enviados: enviadosDetalle,
      errores,
    });

    res.json({ enviados, errores });
  })
);
