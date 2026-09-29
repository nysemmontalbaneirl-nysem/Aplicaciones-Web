import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { ErrorValidacion } from "../validaciones";
import { registrarBitacora } from "../bitacora";
import { tieneAccesoProyecto } from "../permisos";

export const periodosRouter = Router();

// Ronda C: cada periodo ahora puede pertenecer a un proyecto especifico
// (periodos_planilla.proyecto, migracion_028). NULL = periodo "legado/todos
// los proyectos" - asi quedan TODOS los periodos creados antes de esta
// migracion, de forma permanente (decision confirmada con el usuario).
//
// Un ADMIN ve y puede crear periodos de cualquier proyecto, o sin proyecto
// (legado). Un usuario no-ADMIN (ej. RESPONSABLE_PLANILLA) solo ve los
// periodos legado mas los de sus propios proyectos asignados (igual
// criterio que ya se usa para filtrar contratos/tareo de ese mismo
// usuario), y - decision confirmada con el usuario - ya NO puede crear un
// periodo sin proyecto: siempre tiene que elegir uno de sus proyectos
// asignados. Esto no le quita acceso a nada que ya pudiera hacer antes: un
// periodo sin proyecto que ya exista lo sigue viendo y usando igual que
// hoy (solo puede actuar sobre los contratos de sus proyectos dentro de
// el, eso no cambia).
periodosRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const esAdmin = req.usuario!.rol === "ADMIN";
  const resultado = await pool.query(
    `SELECT * FROM periodos_planilla
     ${esAdmin ? "" : "WHERE proyecto IS NULL OR proyecto = ANY($1::text[])"}
     ORDER BY anio DESC, mes DESC, quincena NULLS FIRST`,
    esAdmin ? [] : [req.usuario!.proyectos]
  );
  res.json(resultado.rows);
}));

// Crear/eliminar un periodo LEGADO (proyecto=NULL) afecta potencialmente a
// TODOS los proyectos - por eso, a diferencia de tareo/contratos, para ese
// caso no alcanza con tieneAccesoProyecto (no hay un proyecto puntual que
// validar). Bug real corregido en su momento: esta ruta no tenia NINGUN
// control de rol antes (cualquier usuario logueado, incluido un Tareador,
// podia crear o borrar periodos de planilla).
periodosRouter.post("/", requierePermiso("periodos.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!b.anio || !b.mes || !b.fecha_inicio || !b.fecha_fin) {
      throw new ErrorValidacion("anio, mes, fecha_inicio y fecha_fin son obligatorios");
    }
    const proyecto = (b.proyecto ?? "").toString().trim() || null;
    if (proyecto) {
      if (!tieneAccesoProyecto(req.usuario!, proyecto)) {
        return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
      }
    } else if (req.usuario!.rol !== "ADMIN") {
      // Decision confirmada con el usuario (Ronda C): solo el Administrador
      // puede crear un periodo "legado" (sin proyecto, que en la practica
      // aplica a todos) - un usuario restringido a sus propios proyectos
      // siempre tiene que elegir uno.
      return res.status(403).json({
        error: "Solo un Administrador puede crear un periodo sin proyecto. Elige uno de tus proyectos asignados.",
      });
    }
    // dias_periodo se calcula SIEMPRE en el servidor a partir de las fechas
    // reales (fecha_fin - fecha_inicio + 1, dias calendario inclusive), sin
    // importar lo que mande el cliente. Bug real corregido: antes se
    // guardaba fijo en 30 (tanto en el frontend como el default del
    // backend), lo que hacia mal el prorrateo de sueldo de Empleados y la
    // asignacion familiar en cualquier mes de 28, 29 o 31 dias.
    const resultado = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
       VALUES ($1,$2,$3,$4,$5,$6, ($6::date - $5::date + 1), $7)
       RETURNING *`,
      [
        b.anio,
        b.mes,
        b.quincena ?? null,
        b.tipo ?? "MENSUAL",
        b.fecha_inicio,
        b.fecha_fin,
        proyecto,
      ]
    );
    await registrarBitacora(req.usuario!.id, "CREAR_PERIODO", "periodos_planilla", resultado.rows[0].id, {
      proyecto,
    });
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    if ((err as { code?: string }).code === "23505") {
      // Cubre dos indices unicos distintos: el de anio/mes/tipo/quincena
      // (MENSUAL y QUINCENAL) y el indice parcial por fechas para SEMANAL
      // (migracion_018), ambos ahora incluyen el proyecto (migracion_028) -
      // el mensaje se deja generico para ambos casos.
      return res.status(409).json({
        error: "Ya existe un periodo con esas mismas fechas/anio/mes/quincena/tipo para ese proyecto",
      });
    }
    throw err;
  }
}));

// Edita un periodo que TODAVIA esta ABIERTO (sin planilla calculada) - si
// ya esta CALCULADO, hay que reabrirlo primero (POST /:id/reabrir, mas
// abajo) para no editar fechas/proyecto por debajo de boletas ya generadas
// sin que nadie se de cuenta. Permite corregir un error al crear el
// periodo (fechas mal puestas, proyecto equivocado) sin tener que borrarlo
// y crear uno nuevo.
periodosRouter.put("/:id", requierePermiso("periodos.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const actual = await cliente.query("SELECT * FROM periodos_planilla WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (actual.rowCount === 0) {
      await cliente.query("ROLLBACK");
      return res.status(404).json({ error: "Periodo no encontrado" });
    }
    if (actual.rows[0].estado !== "ABIERTO") {
      await cliente.query("ROLLBACK");
      return res.status(400).json({
        error: "Solo se puede editar un periodo en estado ABIERTO. Reabrelo primero si ya esta CALCULADO.",
      });
    }

    const b = req.body;
    const fechaInicio = b.fecha_inicio ?? actual.rows[0].fecha_inicio;
    const fechaFin = b.fecha_fin ?? actual.rows[0].fecha_fin;
    const proyecto = b.proyecto !== undefined ? (b.proyecto ?? "").toString().trim() || null : actual.rows[0].proyecto;

    if (proyecto) {
      if (!tieneAccesoProyecto(req.usuario!, proyecto)) {
        await cliente.query("ROLLBACK");
        return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
      }
    } else if (req.usuario!.rol !== "ADMIN") {
      await cliente.query("ROLLBACK");
      return res.status(403).json({
        error: "Solo un Administrador puede dejar un periodo sin proyecto. Elige uno de tus proyectos asignados.",
      });
    }

    // Si el periodo va a quedar (o ya estaba) asignado a un proyecto
    // especifico, no puede tener tareo cargado de un contrato de OTRO
    // proyecto - eso dejaria datos de una obra distinta "escondidos" dentro
    // de un periodo que ya deberia ser exclusivo de otra. Se revisa
    // asistencia_periodo (ahi quedan sincronizados tanto el Tareo Diario
    // como la carga por Excel/manual, ver recalcularAsistenciaDesdeTareoDiario
    // y guardarAsistencia) en vez de tareo_diario, que no existe para la
    // carga en bloque.
    if (proyecto) {
      const otrosProyectos = await cliente.query(
        `SELECT DISTINCT c.proyecto
         FROM asistencia_periodo a
         JOIN contratos c ON c.id = a.contrato_id
         WHERE a.periodo_id = $1 AND c.proyecto <> $2`,
        [req.params.id, proyecto]
      );
      if ((otrosProyectos.rowCount ?? 0) > 0) {
        await cliente.query("ROLLBACK");
        const lista = otrosProyectos.rows.map((r) => r.proyecto).join(", ");
        return res.status(400).json({
          error:
            `Este periodo ya tiene tareo cargado de contratos de otro(s) proyecto(s) (${lista}), ` +
            `que quedarian fuera de "${proyecto}". Quita ese tareo (pestana Tareo) antes de asignarle este proyecto.`,
        });
      }
    }

    try {
      const resultado = await cliente.query(
        `UPDATE periodos_planilla
         SET fecha_inicio = $1, fecha_fin = $2, dias_periodo = ($2::date - $1::date + 1), proyecto = $3
         WHERE id = $4
         RETURNING *`,
        [fechaInicio, fechaFin, proyecto, req.params.id]
      );
      await cliente.query("COMMIT");
      await registrarBitacora(req.usuario!.id, "EDITAR_PERIODO", "periodos_planilla", Number(req.params.id), {
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        proyecto,
      });
      res.json(resultado.rows[0]);
    } catch (err) {
      await cliente.query("ROLLBACK");
      if ((err as { code?: string }).code === "23505") {
        return res.status(409).json({
          error: "Ya existe un periodo con esas mismas fechas/anio/mes/quincena/tipo para ese proyecto",
        });
      }
      throw err;
    }
  } finally {
    cliente.release();
  }
}));

// Solo se puede eliminar un periodo que todavia no tiene planilla calculada,
// para no perder resultados ya generados. Desde que un periodo puede tener
// proyecto (Ronda C), tambien se exige tieneAccesoProyecto para uno
// especifico de un proyecto - antes de esto no hacia falta (un periodo era
// siempre global). Uno legado (proyecto NULL) se mantiene igual que antes:
// cualquiera con el permiso puede eliminarlo, sin chequeo de proyecto.
periodosRouter.delete("/:id", requierePermiso("periodos.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  const periodo = await pool.query("SELECT proyecto FROM periodos_planilla WHERE id = $1", [req.params.id]);
  if (periodo.rowCount === 0) {
    return res.status(404).json({ error: "Periodo no encontrado" });
  }
  if (periodo.rows[0].proyecto && !tieneAccesoProyecto(req.usuario!, periodo.rows[0].proyecto)) {
    return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
  }
  const resultado = await pool.query(
    "DELETE FROM periodos_planilla WHERE id = $1 AND estado = 'ABIERTO' RETURNING id",
    [req.params.id]
  );
  if (resultado.rowCount === 0) {
    return res.status(400).json({
      error: "Solo se puede eliminar un periodo en estado ABIERTO (sin planilla calculada), o no existe",
    });
  }
  await registrarBitacora(req.usuario!.id, "ELIMINAR_PERIODO", "periodos_planilla", Number(req.params.id), {});
  res.status(204).send();
}));
