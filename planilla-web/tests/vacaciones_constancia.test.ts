// Prueba de la constancia de vacaciones en PDF (ver routes/vacaciones.ts:
// GET /vacaciones/:contratoId/constancia.pdf). Usa la misma app y base de
// datos de pruebas que autorizacion.test.ts.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let empleadoId: number;
let contratoId: number;

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '99990040', 'PRUEBA CONSTANCIA VACACIONES', 0) RETURNING id`
  );
  empleadoId = e.rows[0].id;
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado, sueldo_base)
     VALUES ($1, 'Proyecto Vacaciones', 'EMPLEADO', 'ONP', '2020-01-01', 'HABIL', 2000) RETURNING id`,
    [empleadoId]
  );
  contratoId = c.rows[0].id;

  // Un goce sin boleta asociada (LEFT JOIN) para probar tambien esa fila de
  // la tabla de "Historial de vacaciones tomadas" del PDF.
  await pool.query(
    `INSERT INTO vacaciones_goce (contrato_id, fecha_inicio, fecha_fin, dias, observaciones)
     VALUES ($1, '2026-01-05', '2026-02-03', 30, 'Vacaciones de prueba')`,
    [contratoId]
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM contratos WHERE id = $1", [contratoId]);
  await pool.query("DELETE FROM empleados WHERE id = $1", [empleadoId]);
  await pool.end();
});

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

describe("GET /api/vacaciones/:contratoId/constancia.pdf", () => {
  it("descarga un PDF valido con el record vacacional del trabajador", async () => {
    const r = await request(app)
      .get(`/api/vacaciones/${contratoId}/constancia.pdf`)
      .set(auth())
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.body.slice(0, 4).toString()).toBe("%PDF");
    expect(r.body.length).toBeGreaterThan(500);
  });

  it("404 si el contrato no existe", async () => {
    const r = await request(app).get("/api/vacaciones/999999/constancia.pdf").set(auth());
    expect(r.status).toBe(404);
  });

  it("requiere sesion activa (sin token -> 401)", async () => {
    const r = await request(app).get(`/api/vacaciones/${contratoId}/constancia.pdf`);
    expect(r.status).toBe(401);
  });
});
