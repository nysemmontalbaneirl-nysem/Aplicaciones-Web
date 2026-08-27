import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { RolUsuario } from "./tipos";

dotenv.config();

function obtenerSecreto(): string {
  const valor = process.env.JWT_SECRET;
  if (!valor) {
    throw new Error(
      "Falta la variable de entorno JWT_SECRET en .env (usada para firmar las sesiones de login)."
    );
  }
  return valor;
}
const JWT_SECRET = obtenerSecreto();

export interface TokenPayload {
  id: number;
  nombre: string;
  correo: string;
  rol: RolUsuario;
  // Nombres de los proyectos a los que tiene acceso (vacio/ignorado si rol === "ADMIN",
  // que tiene acceso a todos).
  proyectos: string[];
  // Codigos de permisos_catalogo que tiene su rol (ver rol_permiso). Si el
  // rol es "protegido" (ADMIN), viene como ["*"] = acceso a todo. Se
  // calcula al hacer login (routes/auth.ts); si el Administrador cambia los
  // permisos de un rol, los usuarios de ese rol lo ven recien al volver a
  // iniciar sesion (igual que ya pasa hoy con los proyectos asignados).
  permisos: string[];
}

export function firmarToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

export function verificarToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}
