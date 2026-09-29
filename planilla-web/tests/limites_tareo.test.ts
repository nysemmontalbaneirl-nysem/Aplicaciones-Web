// Migracion 040: limites configurables de horas/minutos por dia para el
// Tareo Diario (Configuracion -> "Limites de tareo"), a pedido explicito
// del usuario ya trabajando en produccion. Por defecto: lunes a viernes
// 0-8 horas / 0-30 minutos; sabado 0-5 horas / 0-30 minutos; domingo sin
// limite (se paga aparte como "domingo trabajado"). El limite se valida
// contra la SUMA de TODAS las columnas de horas (y, por separado, de
// minutos) de cada dia - confirmado explicitamente por el usuario
// ("Todas las horas del dia").
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let periodoId: number;
let proyectoId: number;
let contratoId: number;
const empleadosCreados: number[] = [];
const contratosCreados: number[] = [];

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
     VALUES (2026, 2, 'MENSUAL', '2026-02-01', '2026-02-28', 28) RETURNING id`
  );
  periodoId = p.rows[0].id as number;

  const proy = await pool.query(
    `INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Limites Tareo', 'Lima') RETURNING id`
  );
  proyectoId = proy.rows[0].id as number;

  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '77796001', 'PRUEBA LIMITES TAREO', 0) RETURNING id`
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);

  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Limites Tareo', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId]
  );
  contratoId = c.rows[0].id as number;
  contratosCreados.push(contratoId);
});

afterAll(async () => {
  // Restaura los limites por defecto (defensivo, por si algun expect de
  // arriba fallo antes de que el propio test los restaurara).
  await pool.query(
    `UPDATE limites_tareo SET horas_max_lun_vie = 8, minutos_max_lun_vie = 30, horas_max_sabado = 5, minutos_max_sabado = 30 WHERE id = 1`
  );

  await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  for (const id of contratosCreados) {
    await pool.query("DELETE FROM contratos WHERE id = $1", [id]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM proyectos WHERE id = $1", [proyectoId]);
  await pool.end();
});

function guardarDia(dia: Record<string, unknown>) {
  return request(app)
    .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
    .set(auth())
    .send({ dias: [dia] });
}

describe("GET/PUT /api/conceptos/limites-tareo", () => {
  it("GET trae los valores por defecto (8/30 lun-vie, 5/30 sabado)", async () => {
    const r = await request(app).get("/api/conceptos/limites-tareo").set(auth());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      horas_max_lun_vie: 8,
      minutos_max_lun_vie: 30,
      horas_max_sabado: 5,
      minutos_max_sabado: 30,
    });
  });

  it("PUT con un valor fuera de rango (25 horas) se rechaza con 400", async () => {
    const r = await request(app)
      .put("/api/conceptos/limites-tareo")
      .set(auth())
      .send({ horas_max_lun_vie: 25, minutos_max_lun_vie: 30, horas_max_sabado: 5, minutos_max_sabado: 30 });
    expect(r.status).toBe(400);
  });

  it("PUT con valores validos actualiza los 4 campos", async () => {
    const r = await request(app)
      .put("/api/conceptos/limites-tareo")
      .set(auth())
      .send({ horas_max_lun_vie: 9, minutos_max_lun_vie: 30, horas_max_sabado: 5, minutos_max_sabado: 30 });
    expect(r.status).toBe(200);
    expect(r.body.horas_max_lun_vie).toBe(9);

    // Restaura el valor por defecto (8) para no afectar el resto de esta suite.
    const restaurar = await request(app)
      .put("/api/conceptos/limites-tareo")
      .set(auth())
      .send({ horas_max_lun_vie: 8, minutos_max_lun_vie: 30, horas_max_sabado: 5, minutos_max_sabado: 30 });
    expect(restaurar.status).toBe(200);
  });
});

describe("PUT /api/periodos/:id/tareo-diario/:contratoId respeta los limites de horas/minutos por dia", () => {
  it("lunes con 8 horas normales (limite exacto) se guarda sin problema", async () => {
    // 2026-02-02 es lunes.
    const r = await guardarDia({ fecha: "2026-02-02", horas_normales: 8, minutos_normales: 0 });
    expect(r.status).toBe(204);
  });

  it("lunes con 9 horas normales (excede el limite de 8) se rechaza con 400", async () => {
    const r = await guardarDia({ fecha: "2026-02-02", horas_normales: 9, minutos_normales: 0 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/8 horas/);
  });

  it("lunes con 6 horas normales + 3 horas extra (suma 9, excede 8) se rechaza - el limite es sobre TODAS las columnas de horas del dia", async () => {
    const r = await guardarDia({
      fecha: "2026-02-02",
      horas_normales: 6,
      minutos_normales: 0,
      horas_extra_tramo1: 3,
      minutos_extra_tramo1: 0,
    });
    expect(r.status).toBe(400);
  });

  it("lunes con 40 minutos entre 2 columnas (excede el limite de 30 minutos) se rechaza", async () => {
    const r = await guardarDia({
      fecha: "2026-02-02",
      horas_normales: 4,
      minutos_normales: 20,
      horas_feriado: 0,
      minutos_feriado: 20,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/minutos/);
  });

  it("sabado con 5 horas normales (limite exacto) se guarda sin problema", async () => {
    // 2026-02-07 es sabado.
    const r = await guardarDia({ fecha: "2026-02-07", horas_normales: 5, minutos_normales: 0 });
    expect(r.status).toBe(204);
  });

  it("sabado con 6 horas normales (excede el limite de 5) se rechaza con 400", async () => {
    const r = await guardarDia({ fecha: "2026-02-07", horas_normales: 6, minutos_normales: 0 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/5 horas/);
  });

  it("domingo sin limite: 10 horas de domingo trabajado se guardan sin problema", async () => {
    // 2026-02-01 es domingo.
    const r = await guardarDia({ fecha: "2026-02-01", horas_dominical: 10, minutos_dominical: 0 });
    expect(r.status).toBe(204);
  });

  it("cambiar el limite de lunes-viernes a 12 horas permite guardar un lunes con 10 horas que antes se hubiera rechazado", async () => {
    const cambio = await request(app)
      .put("/api/conceptos/limites-tareo")
      .set(auth())
      .send({ horas_max_lun_vie: 12, minutos_max_lun_vie: 30, horas_max_sabado: 5, minutos_max_sabado: 30 });
    expect(cambio.status).toBe(200);

    const r = await guardarDia({ fecha: "2026-02-09", horas_normales: 10, minutos_normales: 0 });
    expect(r.status).toBe(204);

    // Restaura el valor por defecto.
    await request(app)
      .put("/api/conceptos/limites-tareo")
      .set(auth())
      .send({ horas_max_lun_vie: 8, minutos_max_lun_vie: 30, horas_max_sabado: 5, minutos_max_sabado: 30 });
  });
});
