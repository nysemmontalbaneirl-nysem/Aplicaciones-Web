import bcrypt from "bcryptjs";
import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requiereRol } from "../authMiddleware";
import { pool } from "../db";
import { ErrorValidacion } from "../validaciones";
import { registrarBitacora } from "../bitacora";

export const usuariosRouter = Router();

// Toda esta pestana es solo para ADMIN.
usuariosRouter.use(requiereRol("ADMIN"));

async function esRolValido(rol: string): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM roles WHERE codigo = $1", [rol]);
  return (r.rowCount ?? 0) > 0;
}

usuariosRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query(
      `SELECT u.id, u.nombre, u.correo, u.rol, u.activo, u.creado_en,
              COALESCE(array_agg(p.nombre) FILTER (WHERE p.nombre IS NOT NULL), '{}') AS proyectos
       FROM usuarios u
       LEFT JOIN usuario_proyecto up ON up.usuario_id = u.id
       LEFT JOIN proyectos p ON p.id = up.proyecto_id
       GROUP BY u.id
       ORDER BY u.nombre ASC`
    );
    res.json(r.rows);
  })
);

usuariosRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const b = req.body as {
        nombre?: string;
        correo?: string;
        password?: string;
        rol?: string;
        proyecto_ids?: number[];
      };
      if (!b.nombre?.trim()) throw new ErrorValidacion("nombre es obligatorio");
      if (!b.correo?.trim()) throw new ErrorValidacion("correo es obligatorio");
      if (!b.password || b.password.length < 8) {
        throw new ErrorValidacion("password es obligatorio y debe tener al menos 8 caracteres");
      }
      const rol = (b.rol ?? "TAREADOR").toUpperCase();
      if (!(await esRolValido(rol))) {
        throw new ErrorValidacion(`rol invalido: no existe un rol con el codigo "${rol}"`);
      }

      const hash = await bcrypt.hash(b.password, 10);
      const cliente = await pool.connect();
      try {
        await cliente.query("BEGIN");
        const r = await cliente.query(
          "INSERT INTO usuarios (nombre, correo, password_hash, rol) VALUES ($1,$2,$3,$4) RETURNING id, nombre, correo, rol, activo",
          [b.nombre.trim(), b.correo.trim().toLowerCase(), hash, rol]
        );
        const usuarioId = r.rows[0].id;
        for (const proyectoId of b.proyecto_ids ?? []) {
          await cliente.query(
            "INSERT INTO usuario_proyecto (usuario_id, proyecto_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [usuarioId, proyectoId]
          );
        }
        await cliente.query("COMMIT");
        await registrarBitacora(req.usuario!.id, "CREAR_USUARIO", "usuarios", usuarioId, {
          nombre: r.rows[0].nombre,
          correo: r.rows[0].correo,
          rol: r.rows[0].rol,
        });
        res.status(201).json(r.rows[0]);
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
        return res.status(409).json({ error: "Ya existe un usuario con ese correo" });
      }
      throw err;
    }
  })
);

usuariosRouter.put(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const b = req.body as {
        nombre?: string;
        rol?: string;
        activo?: boolean;
        password?: string;
        proyecto_ids?: number[];
      };
      const rol = b.rol ? b.rol.toUpperCase() : undefined;
      if (rol && !(await esRolValido(rol))) {
        throw new ErrorValidacion(`rol invalido: no existe un rol con el codigo "${rol}"`);
      }
      if (b.password && b.password.length < 8) {
        throw new ErrorValidacion("password debe tener al menos 8 caracteres");
      }

      const cliente = await pool.connect();
      try {
        await cliente.query("BEGIN");

        const anterior = await cliente.query("SELECT nombre, rol, activo FROM usuarios WHERE id = $1", [
          req.params.id,
        ]);

        if (b.password) {
          const hash = await bcrypt.hash(b.password, 10);
          await cliente.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [hash, req.params.id]);
        }
        const r = await cliente.query(
          `UPDATE usuarios SET
             nombre = COALESCE($1, nombre),
             rol = COALESCE($2, rol),
             activo = COALESCE($3, activo)
           WHERE id = $4
           RETURNING id, nombre, correo, rol, activo`,
          [b.nombre ?? null, rol ?? null, b.activo ?? null, req.params.id]
        );
        if (r.rowCount === 0) {
          await cliente.query("ROLLBACK");
          return res.status(404).json({ error: "Usuario no encontrado" });
        }

        if (b.proyecto_ids) {
          await cliente.query("DELETE FROM usuario_proyecto WHERE usuario_id = $1", [req.params.id]);
          for (const proyectoId of b.proyecto_ids) {
            await cliente.query(
              "INSERT INTO usuario_proyecto (usuario_id, proyecto_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
              [req.params.id, proyectoId]
            );
          }
        }

        await cliente.query("COMMIT");
        await registrarBitacora(req.usuario!.id, "EDICION_USUARIO", "usuarios", Number(req.params.id), {
          antes: anterior.rows[0],
          despues: { nombre: r.rows[0].nombre, rol: r.rows[0].rol, activo: r.rows[0].activo },
          password_cambiada: !!b.password,
        });
        res.json(r.rows[0]);
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
