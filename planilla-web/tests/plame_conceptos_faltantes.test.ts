// Pruebas de la migracion 035: varios conceptos que SI se calculan y SI se
// pagan (BUC, Asignacion por escolaridad, Vacaciones, Movilidad,
// Bonificacion Extraordinaria, Horas Extra) nunca se declaraban en el
// archivo PLAME/.rem porque su codigo_plame estaba vacio o -en el caso del
// BUC y de los subsidios (ver tests/subsidio_enfermedad_paternidad.test.ts)-
// tenian un codigo incorrecto o mal formado. Ver src/plame.ts y
// sql/migracion_035_correccion_codigos_plame.sql.
//
// Reportado por el usuario (CPC responsable de las declaraciones) tras
// revisar el .rem real de la Planilla Mensual Consolidada de un proyecto.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { generarLineasREM } from "../src/plame";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
const empleadosCreados: number[] = [];
const contratosCreados: number[] = [];
let periodoId: number;
let proyectoId: number;

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

async function crearContratoPeon(dni: string, nombre: string, numeroHijos: number): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, $3) RETURNING id`,
    [dni, nombre, numeroHijos]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto PLAME Faltantes', 'PEON', 'ONP', '2026-04-01', 'HABIL') RETURNING id`,
    [empleadoId]
  );
  const contratoId = c.rows[0].id as number;
  contratosCreados.push(contratoId);
  return contratoId;
}

async function crearContratoEmpleado(dni: string, nombre: string): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, 0) RETURNING id`,
    [dni, nombre]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado, sueldo_base)
     VALUES ($1, 'Proyecto PLAME Faltantes', 'EMPLEADO', 'ONP', '2026-01-01', 'HABIL', 3100) RETURNING id`,
    [empleadoId]
  );
  const contratoId = c.rows[0].id as number;
  contratosCreados.push(contratoId);
  return contratoId;
}

async function cargarTareoYCalcular(
  contratoId: number,
  extra: { horas_extra_25?: number; horas_extra_35?: number; horas_extra_100?: number }
) {
  const editar = await request(app)
    .put(`/api/periodos/${periodoId}/tareo`)
    .set(auth())
    .send({
      contrato_id: contratoId,
      dias_trabajados: 24,
      dias_dominical: 0,
      dias_feriado: 0,
      dias_falta: 0,
      horas_extra_25: extra.horas_extra_25 ?? 0,
      horas_extra_35: extra.horas_extra_35 ?? 0,
      horas_extra_100: extra.horas_extra_100 ?? 0,
    });
  expect(editar.status).toBe(204);
}

async function obtenerDetalle(contratoId: number) {
  const r = await pool.query("SELECT * FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2", [
    periodoId,
    contratoId,
  ]);
  return r.rows[0];
}

async function obtenerFactoresHorasExtra(codigo: "HORAS_EXTRA_CONSTRUCCION" | "HORAS_EXTRA_GENERAL") {
  const r = await pool.query("SELECT factor1, factor2, factor3 FROM conceptos_planilla WHERE codigo = $1", [codigo]);
  return [Number(r.rows[0].factor1), Number(r.rows[0].factor2), Number(r.rows[0].factor3)] as [number, number, number];
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
     VALUES (2026, 4, 'MENSUAL', '2026-04-01', '2026-04-30', 30) RETURNING id`
  );
  periodoId = p.rows[0].id as number;

  const proy = await pool.query(
    `INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto PLAME Faltantes', 'Lima') RETURNING id`
  );
  proyectoId = proy.rows[0].id;

  // Tabla salarial de abril-2026 para PEON, con BUC y movilidad > 0 (para
  // que esos 2 conceptos tengan monto real que declarar).
  await pool.query(
    `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
     VALUES (2026, 4, 'PEON', 60, 0.30, 0, 8, 12)`
  );
  await pool.query(
    `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, aporte_obligatorio, comision_flujo, prima_seguro)
     VALUES (2026, 4, 'INTEGRA', 0.0155, 0.0137, 0.10)`
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2026 AND mes = 4");
  await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = 2026 AND mes = 4");
  for (const id of contratosCreados) {
    await pool.query("DELETE FROM contratos WHERE id = $1", [id]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM proyectos WHERE id = $1", [proyectoId]);
  await pool.end();
});

describe("Conceptos de construccion civil (BUC, Escolaridad, Movilidad, Vacaciones, Bonificacion Extraordinaria) ahora SI se declaran en el .rem", () => {
  let contratoId: number;

  it("calcula montos > 0 para los 5 conceptos (precondicion de la prueba)", async () => {
    contratoId = await crearContratoPeon("77792001", "PRUEBA PLAME CONCEPTOS FALTANTES", 1);
    await cargarTareoYCalcular(contratoId, { horas_extra_25: 2, horas_extra_35: 1, horas_extra_100: 1 });

    const calcular = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
    expect(calcular.status).toBe(200);
    expect(calcular.body.errores).toEqual([]);

    const detalle = await obtenerDetalle(contratoId);
    expect(Number(detalle.bonificacion_buc)).toBeGreaterThan(0);
    expect(Number(detalle.asignacion_escolaridad)).toBeGreaterThan(0);
    expect(Number(detalle.bonificacion_movilidad)).toBeGreaterThan(0);
    expect(Number(detalle.vacaciones)).toBeGreaterThan(0);
    expect(Number(detalle.bonificacion_extraordinaria)).toBeGreaterThan(0);
  });

  it("BUC aparece bajo el codigo corregido 0311, NO bajo el codigo incorrecto anterior 0314", async () => {
    const detalle = await obtenerDetalle(contratoId);
    const lineas = await generarLineasREM(periodoId);
    const monto = Number(detalle.bonificacion_buc).toFixed(2);

    expect(lineas.find((l) => l.includes(`|77792001|0311|${monto}|${monto}|`))).toBeDefined();
    expect(lineas.find((l) => l.includes("|77792001|0314|"))).toBeUndefined();
  });

  it("Asignacion por escolaridad aparece bajo 0211", async () => {
    const detalle = await obtenerDetalle(contratoId);
    const lineas = await generarLineasREM(periodoId);
    const monto = Number(detalle.asignacion_escolaridad).toFixed(2);
    expect(lineas.find((l) => l.includes(`|77792001|0211|${monto}|${monto}|`))).toBeDefined();
  });

  it("Movilidad aparece bajo 0909", async () => {
    const detalle = await obtenerDetalle(contratoId);
    const lineas = await generarLineasREM(periodoId);
    const monto = Number(detalle.bonificacion_movilidad).toFixed(2);
    expect(lineas.find((l) => l.includes(`|77792001|0909|${monto}|${monto}|`))).toBeDefined();
  });

  it("Vacaciones aparece bajo 0117", async () => {
    const detalle = await obtenerDetalle(contratoId);
    const lineas = await generarLineasREM(periodoId);
    const monto = Number(detalle.vacaciones).toFixed(2);
    expect(lineas.find((l) => l.includes(`|77792001|0117|${monto}|${monto}|`))).toBeDefined();
  });

  it("Bonificacion Extraordinaria (Ley 29351/30334) aparece bajo 0313", async () => {
    const detalle = await obtenerDetalle(contratoId);
    const lineas = await generarLineasREM(periodoId);
    const monto = Number(detalle.bonificacion_extraordinaria).toFixed(2);
    expect(lineas.find((l) => l.includes(`|77792001|0313|${monto}|${monto}|`))).toBeDefined();
  });

  it("Horas extra de construccion civil (60%/100%, sin codigo SUNAT propio): TODO se declara bajo 0106, nada bajo 0105", async () => {
    const detalle = await obtenerDetalle(contratoId);
    const lineas = await generarLineasREM(periodoId);
    const [r1, r2, r3] = await obtenerFactoresHorasExtra("HORAS_EXTRA_CONSTRUCCION");
    const jornalHora = Number(detalle.jornal_diario) / 8;
    const montoEsperado = redondear(
      jornalHora * r1 * Number(detalle.horas_extra_25) +
        jornalHora * r2 * Number(detalle.horas_extra_35) +
        jornalHora * r3 * Number(detalle.horas_extra_100)
    ).toFixed(2);

    expect(lineas.find((l) => l.includes(`|77792001|0106|${montoEsperado}|${montoEsperado}|`))).toBeDefined();
    expect(lineas.find((l) => l.includes("|77792001|0105|"))).toBeUndefined();
  });
});

describe("Horas extra de regimen general (EMPLEADO): 25% real bajo 0105, el resto (35%/100%) bajo 0106", () => {
  let contratoId: number;

  it("calcula y declara el tramo1 (25%) por separado del resto", async () => {
    contratoId = await crearContratoEmpleado("77792002", "PRUEBA PLAME HORAS EXTRA EMPLEADO");
    await cargarTareoYCalcular(contratoId, { horas_extra_25: 2, horas_extra_35: 1, horas_extra_100: 1 });

    const calcular = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
    expect(calcular.status).toBe(200);
    expect(calcular.body.errores).toEqual([]);

    const detalle = await obtenerDetalle(contratoId);
    const lineas = await generarLineasREM(periodoId);
    const [r1, r2, r3] = await obtenerFactoresHorasExtra("HORAS_EXTRA_GENERAL");
    const jornalHora = Number(detalle.jornal_diario) / 8;
    const tramo1 = redondear(jornalHora * r1 * Number(detalle.horas_extra_25)).toFixed(2);
    const tramo2y3 = redondear(
      jornalHora * r2 * Number(detalle.horas_extra_35) + jornalHora * r3 * Number(detalle.horas_extra_100)
    ).toFixed(2);

    expect(lineas.find((l) => l.includes(`|77792002|0105|${tramo1}|${tramo1}|`))).toBeDefined();
    expect(lineas.find((l) => l.includes(`|77792002|0106|${tramo2y3}|${tramo2y3}|`))).toBeDefined();
  });
});
