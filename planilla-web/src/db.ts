import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Sin esto, un error en una conexion ociosa del pool (ej. se corta la red,
// o el servidor la cierra) queda como un evento 'error' sin nadie
// escuchandolo, lo que Node.js trata como fatal y tumba todo el proceso.
pool.on("error", (err) => {
  console.error("Error inesperado en una conexion inactiva de PostgreSQL:", err);
});

export async function verificarConexion(): Promise<void> {
  const cliente = await pool.connect();
  try {
    await cliente.query("SELECT 1");
  } finally {
    cliente.release();
  }
}
