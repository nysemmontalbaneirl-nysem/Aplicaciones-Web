// Se ejecuta UNA sola vez despues de correr toda la suite de pruebas. Borra
// la base de datos de pruebas para no dejar basura en el servidor de
// Postgres (la proxima corrida la vuelve a crear desde cero de todos modos).
import { Client } from "pg";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const HOST = process.env.DB_HOST ?? "localhost";
const PORT = Number(process.env.DB_PORT ?? 5432);
const USER = process.env.DB_USER ?? "postgres";
const PASSWORD = process.env.DB_PASSWORD ?? "postgres";
const DB_NAME = "planilla_test_jest";

export default async function globalTeardown(): Promise<void> {
  const admin = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: "postgres" });
  await admin.connect();
  try {
    // Con force se corta cualquier conexion que haya quedado abierta a la
    // base de pruebas (ej. el pool de pg que crea src/db.ts al importar la
    // app) para poder borrarla sin que quede colgado el DROP DATABASE.
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
