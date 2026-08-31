// Pruebas de la correccion de un cese ya registrado (ver routes/contratos.ts):
// - PUT /:id/cese corrige fecha/motivo sin cambiar el estado (sigue CESADO).
// - POST /:id/anular-cese deshace el cese por completo (vuelve a HABIL),
//   avisando (409 + confirmar_duplicado) si ya existe otro contrato HABIL
//   para el mismo empleado (ej. ya hubo un reingreso posterior).
// Usa la misma app y base de datos de pruebas que autorizacion.test.ts. Cada
// escenario usa su propio empleado para que un contrato HABIL que quede de
// un caso no contamine la verificacion "ya tiene otro HABIL" de otro caso.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
const empleadosCreados: number[] = [];

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;
});

afterAll(async () => {
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [id]);
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.end();
});

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

async function crearEmpleado(dni: string, nombre: string): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, 0) RETURNING id`,
    [dni, nombre]
  );
  const id = e.rows[0].id as number;
  empleadosCreados.push(id);
  return id;
}

async function crearContratoHabil(empleadoId: number, proyecto: string, fechaIngreso: string): Promise<number> {
  const r = await request(app).post("/api/contratos").set(auth()).send({
    empleado_id: empleadoId,
    proyecto,
    categoria_ocupacional: "PEON",
    sistema_pension: "ONP",
    fecha_ingreso: fechaIngreso,
    confirmar_duplicado: true,
  });
  expect(r.status).toBe(201);
  return r.body.id;
}

describe("PUT /api/contratos/:id/cese - corregir fecha/motivo de un cese ya registrado", () => {
  let empleadoId: number;
  let contratoId: number;

  beforeAll(async () => {
    empleadoId = await crearEmpleado("88880030", "PRUEBA CORRECCION CESE");
    contratoId = await crearContratoHabil(empleadoId, "Proyecto Correccion 1", "2026-01-01");
    const rCese = await request(app)
      .post(`/api/contratos/${contratoId}/cese`)
      .set(auth())
      .send({ fecha_cese: "2026-03-15", motivo_baja_codigo: "01" });
    expect(rCese.status).toBe(200);
  });

  it("400 si el contrato no esta cesado (todavia HABIL)", async () => {
    const otroHabil = await crearContratoHabil(empleadoId, "Proyecto Correccion 2", "2026-01-01");
    const r = await request(app)
      .put(`/api/contratos/${otroHabil}/cese`)
      .set(auth())
      .send({ fecha_cese: "2026-03-01", motivo_baja_codigo: "01" });
    expect(r.status).toBe(400);
  });

  it("corrige la fecha y el motivo sin cambiar el estado (sigue CESADO)", async () => {
    const r = await request(app)
      .put(`/api/contratos/${contratoId}/cese`)
      .set(auth())
      .send({ fecha_cese: "2026-03-20", motivo_baja_codigo: "03" });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe("CESADO");
    expect(r.body.fecha_cese?.slice(0, 10)).toBe("2026-03-20");
    expect(r.body.motivo_baja_codigo).toBe("03");
  });

  it("404 si el contrato no existe", async () => {
    const r = await request(app)
      .put(`/api/contratos/999999/cese`)
      .set(auth())
      .send({ fecha_cese: "2026-03-01" });
    expect(r.status).toBe(404);
  });

  it("requiere sesion activa (sin token -> 401)", async () => {
    const r = await request(app).put(`/api/contratos/${contratoId}/cese`).send({ fecha_cese: "2026-03-01" });
    expect(r.status).toBe(401);
  });
});

describe("POST /api/contratos/:id/anular-cese - deshacer un cese registrado por error", () => {
  it("400 si el contrato no esta cesado", async () => {
    const empleadoId = await crearEmpleado("88880031", "PRUEBA ANULAR CESE 1");
    const habil = await crearContratoHabil(empleadoId, "Proyecto Anular 1", "2026-01-01");
    const r = await request(app).post(`/api/contratos/${habil}/anular-cese`).set(auth()).send({});
    expect(r.status).toBe(400);
  });

  it("vuelve el contrato a HABIL y borra fecha_cese/motivo_baja_codigo", async () => {
    const empleadoId = await crearEmpleado("88880032", "PRUEBA ANULAR CESE 2");
    const contratoId = await crearContratoHabil(empleadoId, "Proyecto Anular 2", "2026-01-01");
    const rCese = await request(app)
      .post(`/api/contratos/${contratoId}/cese`)
      .set(auth())
      .send({ fecha_cese: "2026-02-10", motivo_baja_codigo: "01" });
    expect(rCese.status).toBe(200);

    const r = await request(app).post(`/api/contratos/${contratoId}/anular-cese`).set(auth()).send({});
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe("HABIL");
    expect(r.body.fecha_cese).toBeNull();
    expect(r.body.motivo_baja_codigo).toBeNull();
  });

  it("responde 409 pidiendo confirmacion si el trabajador ya tiene otro contrato HABIL", async () => {
    // Contrato A: se cesa. Contrato B: reingreso posterior (queda HABIL).
    const empleadoId = await crearEmpleado("88880033", "PRUEBA ANULAR CESE 3");
    const contratoA = await crearContratoHabil(empleadoId, "Proyecto Anular 3A", "2026-01-01");
    await request(app)
      .post(`/api/contratos/${contratoA}/cese`)
      .set(auth())
      .send({ fecha_cese: "2026-02-01", motivo_baja_codigo: "01" });
    await crearContratoHabil(empleadoId, "Proyecto Anular 3B", "2026-02-15");

    const r = await request(app).post(`/api/contratos/${contratoA}/anular-cese`).set(auth()).send({});
    expect(r.status).toBe(409);
    expect(r.body.requiere_confirmacion).toBe(true);
    expect(r.body.contratos_habiles[0].proyecto).toBe("Proyecto Anular 3B");
  });

  it("anula el cese de todas formas si se manda confirmar_duplicado=true", async () => {
    const empleadoId = await crearEmpleado("88880034", "PRUEBA ANULAR CESE 4");
    const contratoA = await crearContratoHabil(empleadoId, "Proyecto Anular 4A", "2026-01-01");
    await request(app)
      .post(`/api/contratos/${contratoA}/cese`)
      .set(auth())
      .send({ fecha_cese: "2026-02-01", motivo_baja_codigo: "01" });
    await crearContratoHabil(empleadoId, "Proyecto Anular 4B", "2026-02-15");

    const r = await request(app)
      .post(`/api/contratos/${contratoA}/anular-cese`)
      .set(auth())
      .send({ confirmar_duplicado: true });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe("HABIL");

    const habiles = await pool.query(
      "SELECT id FROM contratos WHERE empleado_id = $1 AND estado = 'HABIL'",
      [empleadoId]
    );
    expect(habiles.rowCount).toBe(2);
  });

  it("404 si el contrato no existe", async () => {
    const r = await request(app).post(`/api/contratos/999999/anular-cese`).set(auth()).send({});
    expect(r.status).toBe(404);
  });

  it("requiere sesion activa (sin token -> 401)", async () => {
    const r = await request(app).post(`/api/contratos/1/anular-cese`).send({});
    expect(r.status).toBe(401);
  });
});
