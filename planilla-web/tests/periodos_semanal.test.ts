// Pruebas de periodos SEMANALES (y QUINCENALES con fechas libres), agregados
// ademas del unico tipo que se podia crear hasta ahora (MENSUAL). Verifica:
// - Que se puedan crear varios periodos SEMANALES en el mismo mes con fechas
//   libres (POST /api/periodos), y que el calculo de gratificacion/CTS/
//   vacaciones de un obrero de jornal (construccion civil) se acumule de
//   forma independiente por periodo, en proporcion exacta a los dias
//   trabajados de CADA periodo, sin que calcular un periodo afecte a otro
//   ya calculado del mismo trabajador en el mismo mes (motorCalculo.ts no
//   se toco: esto prueba en runtime lo que ya se confirmo leyendo el codigo).
// - Que el nuevo indice unico parcial (migracion_018) rechace crear dos
//   periodos SEMANALES con el mismo rango exacto de fechas, y acepte uno
//   con fechas distintas.
// - Que ahora se pueda crear un periodo QUINCENAL con fechas no estandar
//   (no necesariamente 1-15/16-fin de mes).
// - Que /calcular avise (avisos_regimen, sin alterar ningun monto) cuando
//   un trabajador de regimen general (no construccion civil) queda en un
//   periodo no mensual, y que NO avise para obreros de construccion civil.
// Reutiliza el mes de Feb-2026 para los periodos que se calculan, porque
// schema.sql ya trae parametros normativos/tabla salarial reales seedeados
// para ese mes (igual que tareo_diario.test.ts). Los periodos que solo se
// crean para probar la unicidad/validacion (sin calcular) usan Marzo-2026
// para no competir por las mismas fechas con los periodos que si se calculan.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
const empleadosCreados: number[] = [];
const periodosCreados: number[] = [];

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;
});

afterAll(async () => {
  for (const id of periodosCreados) {
    await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [id]);
    await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [id]);
    await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [id]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [id]);
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.end();
});

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

async function crearContrato(dni: string, nombre: string, categoria: string): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, 0) RETURNING id`,
    [dni, nombre]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Periodos Semanales', $2, 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId, categoria]
  );
  return c.rows[0].id as number;
}

async function crearPeriodo(body: Record<string, unknown>) {
  const r = await request(app).post("/api/periodos").set(auth()).send(body);
  if (r.status === 201) periodosCreados.push(r.body.id);
  return r;
}

async function fijarAsistencia(periodoId: number, contratoId: number, diasTrabajados: number) {
  const r = await request(app)
    .put(`/api/periodos/${periodoId}/tareo`)
    .set(auth())
    .send({
      contrato_id: contratoId,
      dias_trabajados: diasTrabajados,
      dias_dominical: 0,
      dias_feriado: 0,
      dias_falta: 0,
      horas_extra_25: 0,
      horas_extra_35: 0,
      horas_extra_100: 0,
    });
  expect(r.status).toBe(204);
}

async function calcular(periodoId: number) {
  const r = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
  expect(r.status).toBe(200);
  expect(r.body.errores).toEqual([]);
  return r;
}

async function obtenerDetalle(periodoId: number, contratoId: number) {
  const r = await pool.query(
    "SELECT gratificacion, cts, vacaciones, sueldo_basico, total_ingresos FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2",
    [periodoId, contratoId]
  );
  return r.rows[0];
}

describe("Periodos SEMANALES: calculo independiente por periodo (sin doble conteo)", () => {
  it("gratificacion/CTS/vacaciones escalan en proporcion exacta a los dias trabajados de CADA semana, sin interferir entre si", async () => {
    const contratoId = await crearContrato("77780001", "PRUEBA SEMANAL PEON", "PEON");

    const semanaA = await crearPeriodo({
      anio: 2026,
      mes: 2,
      tipo: "SEMANAL",
      fecha_inicio: "2026-02-01",
      fecha_fin: "2026-02-07",
    });
    expect(semanaA.status).toBe(201);
    expect(semanaA.body.dias_periodo).toBe(7);

    const semanaB = await crearPeriodo({
      anio: 2026,
      mes: 2,
      tipo: "SEMANAL",
      fecha_inicio: "2026-02-08",
      fecha_fin: "2026-02-14",
    });
    expect(semanaB.status).toBe(201);

    await fijarAsistencia(semanaA.body.id, contratoId, 3);
    await fijarAsistencia(semanaB.body.id, contratoId, 6); // el doble de dias que la semana A

    await calcular(semanaA.body.id);
    await calcular(semanaB.body.id);

    const detalleA = await obtenerDetalle(semanaA.body.id, contratoId);
    const detalleB = await obtenerDetalle(semanaB.body.id, contratoId);

    // El jornal diario de PEON no cambia entre estas dos semanas (mismo
    // anio/mes -> misma tabla_salarial_mensual), asi que con el doble de
    // dias trabajados, cada concepto debe ser (aprox) el doble - si un
    // periodo estuviera arrastrando o pisando datos del otro, esto fallaria.
    for (const campo of ["gratificacion", "cts", "vacaciones", "sueldo_basico"] as const) {
      const diferencia = Math.abs(Number(detalleB[campo]) - 2 * Number(detalleA[campo]));
      expect(diferencia).toBeLessThanOrEqual(0.02);
    }

    // Volver a calcular la semana A (ej. una correccion) no debe alterar en
    // absoluto la boleta ya calculada de la semana B del mismo trabajador.
    const detalleBAntes = await obtenerDetalle(semanaB.body.id, contratoId);
    await calcular(semanaA.body.id);
    const detalleBDespues = await obtenerDetalle(semanaB.body.id, contratoId);
    expect(detalleBDespues).toEqual(detalleBAntes);
  });
});

describe("Indice unico parcial para SEMANAL (migracion_018)", () => {
  it("rechaza (409) crear dos periodos SEMANALES con el mismo rango exacto de fechas, y acepta uno con fechas distintas", async () => {
    const primero = await crearPeriodo({
      anio: 2026,
      mes: 3,
      tipo: "SEMANAL",
      fecha_inicio: "2026-03-02",
      fecha_fin: "2026-03-08",
    });
    expect(primero.status).toBe(201);

    const duplicado = await crearPeriodo({
      anio: 2026,
      mes: 3,
      tipo: "SEMANAL",
      fecha_inicio: "2026-03-02",
      fecha_fin: "2026-03-08",
    });
    expect(duplicado.status).toBe(409);

    const distinto = await crearPeriodo({
      anio: 2026,
      mes: 3,
      tipo: "SEMANAL",
      fecha_inicio: "2026-03-09",
      fecha_fin: "2026-03-15",
    });
    expect(distinto.status).toBe(201);
  });
});

describe("Periodos QUINCENALES con fechas no estandar", () => {
  it("crea un periodo quincenal cuyo rango no es 1-15/16-fin de mes, calculando dias_periodo desde las fechas reales", async () => {
    const quincena = await crearPeriodo({
      anio: 2026,
      mes: 3,
      quincena: 1,
      tipo: "QUINCENAL",
      fecha_inicio: "2026-03-01",
      fecha_fin: "2026-03-10", // 10 dias, no los 15 "estandar"
    });
    expect(quincena.status).toBe(201);
    expect(quincena.body.dias_periodo).toBe(10);
    expect(quincena.body.tipo).toBe("QUINCENAL");
  });
});

describe("Aviso informativo de regimen general en periodo no mensual", () => {
  it("avisa (sin cambiar montos) cuando un trabajador de regimen general queda en un periodo SEMANAL, pero no para un obrero de construccion civil", async () => {
    const contratoGeneral = await crearContrato("77780002", "PRUEBA SEMANAL REGIMEN GENERAL", "R_GENERAL");
    const contratoObrero = await crearContrato("77780003", "PRUEBA SEMANAL OBRERO", "OFICIAL");

    const semana = await crearPeriodo({
      anio: 2026,
      mes: 2,
      tipo: "SEMANAL",
      fecha_inicio: "2026-02-23",
      fecha_fin: "2026-02-28",
    });
    expect(semana.status).toBe(201);

    await fijarAsistencia(semana.body.id, contratoGeneral, 4);
    await fijarAsistencia(semana.body.id, contratoObrero, 4);

    const r = await calcular(semana.body.id);

    const avisoGeneral = r.body.avisos_regimen.find(
      (a: { contrato_id: number }) => a.contrato_id === contratoGeneral
    );
    expect(avisoGeneral).toBeDefined();

    const avisoObrero = r.body.avisos_regimen.find(
      (a: { contrato_id: number }) => a.contrato_id === contratoObrero
    );
    expect(avisoObrero).toBeUndefined();

    // El aviso es puramente informativo: el trabajador de regimen general
    // igual queda con una boleta calculada con normalidad.
    const detalleGeneral = await obtenerDetalle(semana.body.id, contratoGeneral);
    expect(Number(detalleGeneral.sueldo_basico)).toBeGreaterThan(0);
  });
});
