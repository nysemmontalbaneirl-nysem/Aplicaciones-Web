// Se ejecuta UNA sola vez antes de correr toda la suite de pruebas (ver
// "globalSetup" en jest.config.js). Prepara una base de datos de pruebas
// desde cero (nunca toca la base real) con datos fijos y conocidos: 2
// proyectos distintos y un usuario de cada rol, para poder probar tanto el
// control por rol como el control por proyecto.
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const HOST = process.env.DB_HOST ?? "localhost";
const PORT = Number(process.env.DB_PORT ?? 5432);
const USER = process.env.DB_USER ?? "postgres";
const PASSWORD = process.env.DB_PASSWORD ?? "postgres";
const DB_NAME = "planilla_test_jest";

export const CLAVE_PRUEBA = "ClavePrueba123!";

export default async function globalSetup(): Promise<void> {
  // Conecta a la base "postgres" (siempre existe) solo para poder recrear
  // planilla_test_jest desde cero en cada corrida.
  const admin = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: "postgres" });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  } finally {
    await admin.end();
  }

  const schemaSql = readFileSync(path.join(__dirname, "..", "sql", "schema.sql"), "utf-8");
  const db = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: DB_NAME });
  await db.connect();
  try {
    await db.query(schemaSql);

    await db.query(`INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto A', 'Lima'), ('Proyecto B', 'Lima')`);

    const hash = await bcrypt.hash(CLAVE_PRUEBA, 10);
    await db.query(
      `INSERT INTO usuarios (nombre, correo, password_hash, rol, activo) VALUES
        ('Admin Prueba', 'admin@prueba.local', $1, 'ADMIN', true),
        ('Responsable A Prueba', 'responsable-a@prueba.local', $1, 'RESPONSABLE_PLANILLA', true),
        ('Tareador A Prueba', 'tareador-a@prueba.local', $1, 'TAREADOR', true),
        ('Responsable B Prueba', 'responsable-b@prueba.local', $1, 'RESPONSABLE_PLANILLA', true),
        ('Usuario Inactivo Prueba', 'inactivo@prueba.local', $1, 'RESPONSABLE_PLANILLA', false)`,
      [hash]
    );

    // Responsable/Tareador de "Proyecto A" solo tienen asignado ese proyecto;
    // Responsable de "Proyecto B" solo el suyo - asi se puede probar que
    // cada uno NO puede tocar los datos del otro.
    await db.query(`
      INSERT INTO usuario_proyecto (usuario_id, proyecto_id)
      SELECT u.id, p.id FROM usuarios u, proyectos p
      WHERE (u.correo = 'responsable-a@prueba.local' AND p.nombre = 'Proyecto A')
         OR (u.correo = 'tareador-a@prueba.local' AND p.nombre = 'Proyecto A')
         OR (u.correo = 'responsable-b@prueba.local' AND p.nombre = 'Proyecto B')
    `);

    // Un empleado/contrato en cada proyecto, para las pruebas de acceso por proyecto.
    await db.query(`
      INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
      VALUES ('1', '10000001', 'TRABAJADOR PROYECTO A', 0), ('1', '10000002', 'TRABAJADOR PROYECTO B', 0)
    `);
    await db.query(`
      INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, sindicalizado, poliza_seguro, sctr_salud)
      SELECT e.id, 'Proyecto A', 'PEON', 'ONP', '2026-01-02', false, false, false
      FROM empleados e WHERE e.numero_documento = '10000001'
    `);
    await db.query(`
      INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, sindicalizado, poliza_seguro, sctr_salud)
      SELECT e.id, 'Proyecto B', 'PEON', 'ONP', '2026-01-02', false, false, false
      FROM empleados e WHERE e.numero_documento = '10000002'
    `);

    // Un periodo ABIERTO, para las pruebas de calcular/exportar/eliminar periodo.
    await db.query(`
      INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
      VALUES (2026, 3, 'MENSUAL', '2026-03-01', '2026-03-31', 31)
    `);
  } finally {
    await db.end();
  }
}
