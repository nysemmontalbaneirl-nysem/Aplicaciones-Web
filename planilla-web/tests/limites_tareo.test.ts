// Migracion 040: limites configurables de horas/minutos por dia para el
// Tareo Diario (Configuracion -> "Limites de tareo"), a pedido explicito
// del usuario ya trabajando en produccion. Por defecto: lunes a viernes
// 0-8 horas / 0-30 minutos; sabado 0-5 horas / 0-30 minutos; domingo sin
// limite (se paga aparte como "domingo trabajado").
//
// Migracion 043 (REPORTE DE INCONSISTENCIA, sept. 2026): el limite dejo de
// validarse contra la SUMA de todas las columnas de horas del dia (lo que
// bloqueaba registrar horas extra en cuanto el jornal normal ya llegaba al
// tope) y paso a ser INDEPENDIENTE por concepto: "Jornal normal" tiene su
// propio limite, y cada tramo de horas extra (1/2/3) tiene el suyo propio,
// configurable por separado. Ademas, Feriado trabajado quedo, igual que
// Domingo, totalmente exento de cualquier limite (confirmado con el
// usuario via AskUserQuestion).
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

// Valores por defecto de las 16 columnas de limites_tareo (migracion 043).
const LIMITES_DEFECTO = {
  horas_max_normal_lun_vie: 8,
  minutos_max_normal_lun_vie: 30,
  horas_max_normal_sabado: 5,
  minutos_max_normal_sabado: 30,
  horas_max_tramo1_lun_vie: 4,
  minutos_max_tramo1_lun_vie: 0,
  horas_max_tramo1_sabado: 4,
  minutos_max_tramo1_sabado: 0,
  horas_max_tramo2_lun_vie: 4,
  minutos_max_tramo2_lun_vie: 0,
  horas_max_tramo2_sabado: 4,
  minutos_max_tramo2_sabado: 0,
  horas_max_tramo3_lun_vie: 4,
  minutos_max_tramo3_lun_vie: 0,
  horas_max_tramo3_sabado: 4,
  minutos_max_tramo3_sabado: 0,
};

async function restaurarLimitesDefecto() {
  await request(app).put("/api/conceptos/limites-tareo").set(auth()).send(LIMITES_DEFECTO);
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
  await restaurarLimitesDefecto();

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
  it("GET trae los valores por defecto (16 campos: jornal normal + 3 tramos de horas extra, por lun-vie/sabado)", async () => {
    const r = await request(app).get("/api/conceptos/limites-tareo").set(auth());
    expect(r.status).toBe(200);
    expect(r.body).toEqual(LIMITES_DEFECTO);
  });

  it("PUT con un valor fuera de rango (25 horas) se rechaza con 400", async () => {
    const r = await request(app)
      .put("/api/conceptos/limites-tareo")
      .set(auth())
      .send({ ...LIMITES_DEFECTO, horas_max_normal_lun_vie: 25 });
    expect(r.status).toBe(400);
  });

  it("PUT con valores validos actualiza los campos enviados", async () => {
    const r = await request(app)
      .put("/api/conceptos/limites-tareo")
      .set(auth())
      .send({ ...LIMITES_DEFECTO, horas_max_normal_lun_vie: 9, horas_max_tramo1_lun_vie: 6 });
    expect(r.status).toBe(200);
    expect(r.body.horas_max_normal_lun_vie).toBe(9);
    expect(r.body.horas_max_tramo1_lun_vie).toBe(6);

    // Restaura los valores por defecto para no afectar el resto de esta suite.
    const restaurar = await request(app)
      .put("/api/conceptos/limites-tareo")
      .set(auth())
      .send(LIMITES_DEFECTO);
    expect(restaurar.status).toBe(200);
  });
});

describe("PUT /api/periodos/:id/tareo-diario/:contratoId respeta los limites por concepto (migracion 043)", () => {
  it("lunes con 8 horas normales (limite exacto de jornal normal) se guarda sin problema", async () => {
    // 2026-02-02 es lunes.
    const r = await guardarDia({ fecha: "2026-02-02", horas_normales: 8, minutos_normales: 0 });
    expect(r.status).toBe(204);
  });

  it("lunes con 9 horas normales (excede el limite de 8 del jornal normal) se rechaza con 400 mencionando 'Jornal normal'", async () => {
    const r = await guardarDia({ fecha: "2026-02-02", horas_normales: 9, minutos_normales: 0 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Jornal normal/);
  });

  it("lunes con 40 minutos de jornal normal (excede el limite de 30 minutos) se rechaza", async () => {
    const r = await guardarDia({ fecha: "2026-02-02", horas_normales: 4, minutos_normales: 40 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/minutos/);
  });

  it("CAMBIO DE COMPORTAMIENTO (motivo de esta mejora): lunes con 6 horas de jornal normal + 3 horas de extra tramo 1 se guarda sin problema", async () => {
    // Antes de esta correccion, la suma (6+3=9) hubiera excedido el limite
    // combinado de 8 y se hubiera rechazado. Ahora cada concepto se valida
    // por separado: 6 <= 8 (jornal normal) y 3 <= 4 (tramo 1), ambos dentro
    // de su propio limite.
    const r = await guardarDia({
      fecha: "2026-02-02",
      horas_normales: 6,
      minutos_normales: 0,
      horas_extra_tramo1: 3,
      minutos_extra_tramo1: 0,
    });
    expect(r.status).toBe(204);
  });

  it("lunes con 8 horas de jornal normal + 4 horas de tramo 1 (cada una en su propio limite exacto) se guarda sin problema", async () => {
    const r = await guardarDia({
      fecha: "2026-02-02",
      horas_normales: 8,
      minutos_normales: 0,
      horas_extra_tramo1: 4,
      minutos_extra_tramo1: 0,
    });
    expect(r.status).toBe(204);
  });

  it("lunes con 5 horas de tramo 1 (excede el limite propio de 4 horas del tramo 1) se rechaza mencionando 'tramo 1'", async () => {
    const r = await guardarDia({
      fecha: "2026-02-02",
      horas_extra_tramo1: 5,
      minutos_extra_tramo1: 0,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/tramo 1/);
  });

  it("lunes con 5 horas de tramo 2 (excede el limite propio de 4 horas del tramo 2) se rechaza mencionando 'tramo 2'", async () => {
    const r = await guardarDia({
      fecha: "2026-02-02",
      horas_extra_tramo2: 5,
      minutos_extra_tramo2: 0,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/tramo 2/);
  });

  it("lunes con 4 horas en cada uno de los 3 tramos de extra simultaneamente (cada uno en su propio limite exacto) se guarda sin problema", async () => {
    const r = await guardarDia({
      fecha: "2026-02-02",
      horas_extra_tramo1: 4,
      minutos_extra_tramo1: 0,
      horas_extra_tramo2: 4,
      minutos_extra_tramo2: 0,
      horas_extra_tramo3: 4,
      minutos_extra_tramo3: 0,
    });
    expect(r.status).toBe(204);
  });

  it("Feriado trabajado con 20 horas en un dia de semana (excederia cualquier limite combinado anterior) se guarda sin problema - feriado esta totalmente exento de limite", async () => {
    const r = await guardarDia({ fecha: "2026-02-02", horas_feriado: 20, minutos_feriado: 0 });
    expect(r.status).toBe(204);
  });

  it("sabado con 5 horas normales (limite exacto de jornal normal) se guarda sin problema", async () => {
    // 2026-02-07 es sabado.
    const r = await guardarDia({ fecha: "2026-02-07", horas_normales: 5, minutos_normales: 0 });
    expect(r.status).toBe(204);
  });

  it("sabado con 6 horas normales (excede el limite de 5 del jornal normal) se rechaza con 400 mencionando 'Jornal normal'", async () => {
    const r = await guardarDia({ fecha: "2026-02-07", horas_normales: 6, minutos_normales: 0 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Jornal normal/);
  });

  it("domingo sin limite: 10 horas de domingo trabajado se guardan sin problema (comportamiento sin cambios)", async () => {
    // 2026-02-01 es domingo.
    const r = await guardarDia({ fecha: "2026-02-01", horas_dominical: 10, minutos_dominical: 0 });
    expect(r.status).toBe(204);
  });

  it("cambiar el limite del tramo 1 (lun-vie) a 6 horas permite guardar un lunes con 5 horas de tramo 1 que antes se hubiera rechazado", async () => {
    const cambio = await request(app)
      .put("/api/conceptos/limites-tareo")
      .set(auth())
      .send({ ...LIMITES_DEFECTO, horas_max_tramo1_lun_vie: 6 });
    expect(cambio.status).toBe(200);

    const r = await guardarDia({
      fecha: "2026-02-09",
      horas_extra_tramo1: 5,
      minutos_extra_tramo1: 0,
    });
    expect(r.status).toBe(204);

    // Restaura los valores por defecto.
    await restaurarLimitesDefecto();
  });
});
