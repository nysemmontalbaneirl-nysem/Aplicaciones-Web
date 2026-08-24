import bcrypt from "bcryptjs";
import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { firmarToken } from "../auth";
import { requiereLogin } from "../authMiddleware";
import { pool } from "../db";
import { ErrorValidacion } from "../validaciones";

export const authRouter = Router();

// POST /api/auth/login  body: { correo, password }
authRouter.post(
  "/login",
  asyncHandler(async (req: Request, res: Response) => {
    const { correo, password } = req.body as { correo?: string; password?: string };
    if (!correo || !password) {
      return res.status(400).json({ error: "correo y password son obligatorios" });
    }

    const r = await pool.query(
      "SELECT id, nombre, correo, password_hash, rol, activo FROM usuarios WHERE correo = $1",
      [correo.trim().toLowerCase()]
    );
    const usuario = r.rows[0];
    // Mensaje generico a proposito: no revelar si el correo existe o no.
    if (!usuario || !usuario.activo) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }
    const coincide = await bcrypt.compare(password, usuario.password_hash);
    if (!coincide) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }

    const payload = { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo, rol: usuario.rol };
    const token = firmarToken(payload);
    res.json({ token, usuario: payload });
  })
);

// GET /api/auth/me -> datos del usuario logueado (para restaurar sesion al recargar)
authRouter.get(
  "/me",
  requiereLogin,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ usuario: req.usuario });
  })
);

// POST /api/auth/cambiar-password  body: { password_actual, password_nueva }
authRouter.post(
  "/cambiar-password",
  requiereLogin,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { password_actual, password_nueva } = req.body as {
        password_actual?: string;
        password_nueva?: string;
      };
      if (!password_actual || !password_nueva) {
        throw new ErrorValidacion("password_actual y password_nueva son obligatorios");
      }
      if (password_nueva.length < 8) {
        throw new ErrorValidacion("La nueva contraseña debe tener al menos 8 caracteres");
      }

      const r = await pool.query("SELECT password_hash FROM usuarios WHERE id = $1", [req.usuario!.id]);
      if (r.rowCount === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }
      const coincide = await bcrypt.compare(password_actual, r.rows[0].password_hash);
      if (!coincide) {
        return res.status(401).json({ error: "La contraseña actual no es correcta." });
      }

      const nuevoHash = await bcrypt.hash(password_nueva, 10);
      await pool.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [nuevoHash, req.usuario!.id]);
      res.status(204).send();
    } catch (err) {
      if (err instanceof ErrorValidacion) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  })
);
