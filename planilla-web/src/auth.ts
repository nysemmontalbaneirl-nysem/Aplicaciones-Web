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
}

export function firmarToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

export function verificarToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}
