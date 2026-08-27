import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requiereRol } from "../authMiddleware";
import { pool } from "../db";
import { ErrorValidacion } from "../validaciones";
import { registrarBitacora } from "../bitacora";

export const rolesRouter = Router();

// Gestionar roles (y con eso, que puede hacer cada uno) queda SIEMPRE
// restringido a ADMIN de forma fija, sin pasar por el sistema de permisos
// configurable. Si se pudiera delegar este permiso a un rol personalizado,
// ese rol podria crear un rol nuevo con todos los permisos y asignarselo a
// si mismo (o a otro usuario) - un camino directo para escalar privilegios.
rolesRouter.use(requiereRol("ADMIN"));

function codigoDesdeNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes (despues de normalize NFD)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

// GET /api/roles -> catalogo de roles con sus permisos y cuantos usuarios los usan
// (el conteo se usa en el frontend para avisar antes de borrar un rol en uso).
rolesRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query(
      `SELECT r.codigo, r.nombre, r.descripcion, r.protegido,
              COALESCE(array_agg(rp.permiso_codigo) FILTER (WHERE rp.permiso_codigo IS NOT NULL), '{}') AS permisos,
              (SELECT COUNT(*) FROM usuarios u WHERE u.rol = r.codigo) AS usuarios_count
       FROM roles r
       LEFT JOIN rol_permiso rp ON rp.rol_codigo = r.codigo
       GROUP BY r.codigo
       ORDER BY r.protegido DESC, r.nombre ASC`
    );
    res.json(r.rows.map((f) => ({ ...f, usuarios_count: Number(f.usuarios_count) })));
  })
);

// GET /api/roles/permisos-disponibles -> catalogo fijo de permisos (para armar el checklist)
rolesRouter.get(
  "/permisos-disponibles",
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query("SELECT codigo, nombre, grupo, orden FROM permisos_catalogo ORDER BY orden ASC");
    res.json(r.rows);
  })
);

// POST /api/roles  body: { nombre, descripcion?, permisos: string[] }
rolesRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const b = req.body as { nombre?: string; descripcion?: string; permisos?: string[] };
      if (!b.nombre?.trim()) throw new ErrorValidacion("nombre es obligatorio");
      const codigo = codigoDesdeNombre(b.nombre);
      if (!codigo) throw new ErrorValidacion("El nombre debe tener al menos una letra o numero");

      const permisos = Array.isArray(b.permisos) ? b.permisos : [];

      const cliente = await pool.connect();
      try {
        await cliente.query("BEGIN");
        const r = await cliente.query(
          "INSERT INTO roles (codigo, nombre, descripcion, protegido) VALUES ($1,$2,$3,false) RETURNING codigo, nombre, descripcion, protegido",
          [codigo, b.nombre.trim(), b.descripcion?.trim() || null]
        );
        if (permisos.length > 0) {
          await cliente.query(
            `INSERT INTO rol_permiso (rol_codigo, permiso_codigo)
             SELECT $1, codigo FROM permisos_catalogo WHERE codigo = ANY($2::text[])`,
            [codigo, permisos]
          );
        }
        await cliente.query("COMMIT");
        await registrarBitacora(req.usuario!.id, "CREAR_ROL", "roles", null, {
          codigo,
          nombre: r.rows[0].nombre,
          permisos,
        });
        res.status(201).json({ ...r.rows[0], permisos, usuarios_count: 0 });
      } catch (err) {
        await cliente.query("ROLLBACK");
        throw err;
      } finally {
        cliente.release();
      }
    } catch (err) {
      if (err instanceof ErrorValidacion) {
        return res.status(400).json({ error: err.message });
      }
      if ((err as { code?: string }).code === "23505") {
        return res.status(409).json({ error: "Ya existe un rol con ese nombre" });
      }
      throw err;
    }
  })
);

// PUT /api/roles/:codigo  body: { nombre?, descripcion?, permisos? }
rolesRouter.put(
  "/:codigo",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const existente = await pool.query("SELECT * FROM roles WHERE codigo = $1", [req.params.codigo]);
      if (existente.rowCount === 0) {
        return res.status(404).json({ error: "Rol no encontrado" });
      }
      if (existente.rows[0].protegido) {
        return res.status(409).json({ error: "Este rol tiene acceso total y no se puede modificar." });
      }

      const b = req.body as { nombre?: string; descripcion?: string; permisos?: string[] };

      const cliente = await pool.connect();
      try {
        await cliente.query("BEGIN");
        const r = await cliente.query(
          `UPDATE roles SET nombre = COALESCE($1, nombre), descripcion = $2 WHERE codigo = $3
           RETURNING codigo, nombre, descripcion, protegido`,
          [b.nombre?.trim() || null, b.descripcion?.trim() || null, req.params.codigo]
        );

        if (Array.isArray(b.permisos)) {
          await cliente.query("DELETE FROM rol_permiso WHERE rol_codigo = $1", [req.params.codigo]);
          if (b.permisos.length > 0) {
            await cliente.query(
              `INSERT INTO rol_permiso (rol_codigo, permiso_codigo)
               SELECT $1, codigo FROM permisos_catalogo WHERE codigo = ANY($2::text[])`,
              [req.params.codigo, b.permisos]
            );
          }
        }

        await cliente.query("COMMIT");
        await registrarBitacora(req.usuario!.id, "EDICION_ROL", "roles", null, {
          codigo: req.params.codigo,
          nombre: r.rows[0].nombre,
          permisos: b.permisos,
        });

        const permisosActuales = await pool.query("SELECT permiso_codigo FROM rol_permiso WHERE rol_codigo = $1", [
          req.params.codigo,
        ]);
        res.json({ ...r.rows[0], permisos: permisosActuales.rows.map((f) => f.permiso_codigo) });
      } catch (err) {
        await cliente.query("ROLLBACK");
        throw err;
      } finally {
        cliente.release();
      }
    } catch (err) {
      if (err instanceof ErrorValidacion) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  })
);

// DELETE /api/roles/:codigo
rolesRouter.delete(
  "/:codigo",
  asyncHandler(async (req: Request, res: Response) => {
    const existente = await pool.query("SELECT protegido FROM roles WHERE codigo = $1", [req.params.codigo]);
    if (existente.rowCount === 0) {
      return res.status(404).json({ error: "Rol no encontrado" });
    }
    if (existente.rows[0].protegido) {
      return res.status(409).json({ error: "Este rol tiene acceso total y no se puede eliminar." });
    }
    try {
      await pool.query("DELETE FROM roles WHERE codigo = $1", [req.params.codigo]);
    } catch (err) {
      if ((err as { code?: string }).code === "23503") {
        return res.status(409).json({
          error: "Hay usuarios con este rol. Cambia su rol antes de eliminarlo.",
        });
      }
      throw err;
    }
    await registrarBitacora(req.usuario!.id, "ELIMINAR_ROL", "roles", null, { codigo: req.params.codigo });
    res.status(204).send();
  })
);
