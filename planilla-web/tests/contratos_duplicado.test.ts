// Prueba de la alerta de contrato HABIL duplicado (ver routes/contratos.ts):
// si un trabajador ya tiene un contrato HABIL, crear otro sin confirmar
// responde 409 pidiendo confirmacion; con confirmar_duplicado=true si
// continua. Usa la misma app y base de datos de pruebas que
// autorizacion.test.ts (ver tests/globalSetup.ts).
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let empleadoId: number;

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  if (r.status !== 200) {
    throw new Error(`No se pudo iniciar sesion como admin: ${r.status} ${JSON.stringify(r.body)}`);
  }
  tokenAdmin = r.body.token as string;

  const eResult = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '88880020', 'PRUEBA CONTRATO DUPLICADO', 0) RETURNING id`
  );
  empleadoId = eResult.rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [empleadoId]);
  await pool.query("DELETE FROM empleados WHERE id = $1", [empleadoId]);
  await pool.end();
});

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

function datosContrato(proyecto: string, fechaIngreso: string) {
  return {
    empleado_id: empleadoId,
    proyecto,
    categoria_ocupacional: "PEON",
    sistema_pension: "ONP",
    fecha_ingreso: fechaIngreso,
  };
}

describe("POST /api/contratos - alerta de contrato HABIL duplicado", () => {
  it("crea el primer contrato sin problema", async () => {
    const r = await request(app).post("/api/contratos").set(auth()).send(datosContrato("Proyecto A", "2026-01-01"));
    expect(r.status).toBe(201);
  });

  it("responde 409 pidiendo confirmacion al crear un segundo contrato HABIL sin confirmar", async () => {
    const r = await request(app).post("/api/contratos").set(auth()).send(datosContrato("Proyecto B", "2026-02-01"));
    expect(r.status).toBe(409);
    expect(r.body.requiere_confirmacion).toBe(true);
    expect(r.body.contratos_habiles).toHaveLength(1);
    expect(r.body.contratos_habiles[0].proyecto).toBe("Proyecto A");
  });

  it("crea el segundo contrato si se manda confirmar_duplicado=true", async () => {
    const r = await request(app)
      .post("/api/contratos")
      .set(auth())
      .send({ ...datosContrato("Proyecto B", "2026-02-01"), confirmar_duplicado: true });
    expect(r.status).toBe(201);

    const habiles = await pool.query("SELECT proyecto FROM contratos WHERE empleado_id = $1 AND estado = 'HABIL'", [
      empleadoId,
    ]);
    expect(habiles.rowCount).toBe(2);
  });
});
