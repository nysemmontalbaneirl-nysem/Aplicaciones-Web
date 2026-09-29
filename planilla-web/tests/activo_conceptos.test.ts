// Migracion 039, requerimiento funcional 3: interruptor "Activo" para
// conceptos de codigo fijo (Configuracion -> "Conceptos de ingreso"),
// implementado via conceptos_planilla.activo (columna ya existente desde la
// migracion 033, hasta ahora solo leida para conceptos personalizados) +
// estaActivo() en motorCalculo.ts, gateando el calculo de cada concepto
// hardcodeado. SUELDO_BASICO queda explicitamente protegido (no se puede
// apagar, ni en el motor de calculo -no lee este flag- ni en la API).
//
// Estas pruebas usan MOVILIDAD (bonificacion fija por dia trabajado, solo
// construccion civil - PEON tiene S/8.60/dia en la tabla salarial de
// prueba de 02/2026) porque es facil de aislar: activarlo/desactivarlo no
// afecta ningun otro concepto ni aporte.
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
    `INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Activo Conceptos', 'Lima') RETURNING id`
  );
  proyectoId = proy.rows[0].id as number;

  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '77795001', 'PRUEBA INTERRUPTOR ACTIVO', 0) RETURNING id`
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);

  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Activo Conceptos', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId]
  );
  contratoId = c.rows[0].id as number;
  contratosCreados.push(contratoId);

  // Migracion 040: 15 dias LABORABLES (lunes a viernes) elegidos a mano -
  // un rango calendario naive caeria en sabado, y el limite configurable de
  // tareo (max 5h/dia sabado) rechazaria un sabado con 8h.
  const DIAS_HABILES = [
    "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06",
    "2026-02-09", "2026-02-10", "2026-02-11", "2026-02-12", "2026-02-13",
    "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
  ];
  const dias = DIAS_HABILES.map((fecha) => ({ fecha, horas_normales: 8 }));
  const guardado = await request(app)
    .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
    .set(auth())
    .send({ dias });
  expect(guardado.status).toBe(204);
});

afterAll(async () => {
  // Restaura MOVILIDAD activo (defensivo: si algun expect de arriba fallo
  // antes de la restauracion explicita del propio test, esto evita dejar
  // el concepto apagado para el resto de la suite).
  await pool.query(`UPDATE conceptos_planilla SET activo = true WHERE codigo = 'MOVILIDAD'`);

  await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoId]);
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

async function calcularYLeerDetalle(): Promise<any> {
  const calculo = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
  expect(calculo.status).toBe(200);
  expect(calculo.body.errores).toEqual([]);
  const detalle = await pool.query(
    "SELECT sueldo_basico, bonificacion_movilidad, total_ingresos FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2",
    [periodoId, contratoId]
  );
  return detalle.rows[0];
}

describe("Interruptor Activo/Inactivo de conceptos de codigo fijo (migracion 039)", () => {
  let totalConMovilidad: number;
  let sueldoBasico: number;

  it("con MOVILIDAD activo (default), la boleta paga la bonificacion por movilidad", async () => {
    const fila = await calcularYLeerDetalle();
    expect(Number(fila.bonificacion_movilidad)).toBeGreaterThan(0);
    totalConMovilidad = Number(fila.total_ingresos);
    sueldoBasico = Number(fila.sueldo_basico);
  });

  it("PUT /api/conceptos/MOVILIDAD {activo:false} lo desactiva y su monto pasa a 0 sin afectar otros conceptos", async () => {
    const apagar = await request(app).put("/api/conceptos/MOVILIDAD").set(auth()).send({ activo: false });
    expect(apagar.status).toBe(200);
    expect(apagar.body.activo).toBe(false);

    const fila = await calcularYLeerDetalle();
    expect(Number(fila.bonificacion_movilidad)).toBe(0);
    expect(Number(fila.sueldo_basico)).toBeCloseTo(sueldoBasico, 2);
    expect(Number(fila.total_ingresos)).toBeCloseTo(totalConMovilidad - 8.6 * 15, 1);
  });

  it("PUT /api/conceptos/MOVILIDAD {activo:true} lo reactiva y vuelve a pagarse", async () => {
    const reactivar = await request(app).put("/api/conceptos/MOVILIDAD").set(auth()).send({ activo: true });
    expect(reactivar.status).toBe(200);
    expect(reactivar.body.activo).toBe(true);

    const fila = await calcularYLeerDetalle();
    expect(Number(fila.bonificacion_movilidad)).toBeGreaterThan(0);
    expect(Number(fila.total_ingresos)).toBeCloseTo(totalConMovilidad, 1);
  });

  it("PUT /api/conceptos/SUELDO_BASICO {activo:false} se rechaza (400) - el sueldo/jornal basico siempre se calcula", async () => {
    const r = await request(app).put("/api/conceptos/SUELDO_BASICO").set(auth()).send({ activo: false });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/SUELDO_BASICO/);

    const catalogo = await pool.query(`SELECT activo FROM conceptos_planilla WHERE codigo = 'SUELDO_BASICO'`);
    expect(catalogo.rows[0].activo).toBe(true);
  });

  it("PUT /api/conceptos/MOVILIDAD {activo: 'si'} (no booleano) se rechaza (400)", async () => {
    const r = await request(app).put("/api/conceptos/MOVILIDAD").set(auth()).send({ activo: "si" });
    expect(r.status).toBe(400);
  });
});
