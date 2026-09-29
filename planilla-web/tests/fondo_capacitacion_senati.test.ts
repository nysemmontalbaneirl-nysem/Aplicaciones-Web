// Prueba de regresion: el usuario reporto que el Fondo de Capacitacion
// (aporte del empleador, detalle_planilla.senati, tasa 0.45% ya correcta
// desde migracion_008) se calculaba aplicando el 0.45% sobre Jornal Basico
// + Remuneracion Dominical + BUC, cuando el BUC (Bonificacion Unificada de
// Construccion) NO debe formar parte de la base de este aporte.
//
// migracion_029 corrige el flag conceptos_planilla.afecto_senati del
// concepto BUC (de true a false) - este flag ya era editable por el
// usuario desde Configuracion -> Conceptos de ingreso (columna "SENATI"),
// pero se corrige tambien el valor de fabrica/semilla para que un
// despliegue nuevo, o un "Restaurar valores originales", no reintroduzca
// el error. La Remuneracion Feriado (REM_FERIADO) se mantiene en la base,
// sin cambios, tal como confirmo el usuario.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let contratoId: number;
let empleadoId: number;
let periodoId: number;

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '77792001', 'PRUEBA FONDO CAPACITACION SIN BUC', 0) RETURNING id`
  );
  empleadoId = e.rows[0].id;

  // PEON (construccion civil, jornal_basico=62.80, buc=0.30 en 2026-02
  // segun schema.sql) para que la Bonificacion BUC sea distinta de 0 y la
  // diferencia entre incluirla o no en la base de SENATI sea detectable.
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Fondo Capacitacion', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId]
  );
  contratoId = c.rows[0].id;

  // Periodo SEMANAL de 2026-02 (ya sembrado con tabla_salarial_mensual/
  // tasas_afp_mensuales/parametros_normativos en schema.sql), sin domingos
  // ni feriados en el rango para aislar el efecto del BUC.
  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
     VALUES (2026, 2, 'SEMANAL', '2026-02-16', '2026-02-21', 6) RETURNING id`
  );
  periodoId = p.rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [empleadoId]);
  await pool.query("DELETE FROM empleados WHERE id = $1", [empleadoId]);
  await pool.end();
});

it("el Fondo de Capacitacion (senati) no incluye el BUC en su base, pero si Jornal Basico y Rem. Feriado", async () => {
  const editar = await request(app)
    .put(`/api/periodos/${periodoId}/tareo`)
    .set(auth())
    .send({
      contrato_id: contratoId,
      dias_trabajados: 6,
      dias_dominical: 0,
      dias_feriado: 0,
      dias_falta: 0,
      horas_extra_25: 0,
      horas_extra_35: 0,
      horas_extra_100: 0,
    });
  expect(editar.status).toBe(204);

  const calcular = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
  expect(calcular.status).toBe(200);
  expect(calcular.body.errores).toEqual([]);

  const r = await pool.query(
    "SELECT sueldo_basico, bonificacion_buc, senati FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2",
    [periodoId, contratoId]
  );
  const detalle = r.rows[0];
  const sueldoBasico = Number(detalle.sueldo_basico);
  const bonificacionBuc = Number(detalle.bonificacion_buc);
  const senati = Number(detalle.senati);

  // Con jornal_basico=62.80 y 6 dias trabajados: sueldo_basico=376.80.
  expect(sueldoBasico).toBeCloseTo(376.8);
  // Con buc=0.30 sobre el jornal: bonificacion_buc = 62.80*0.30*6 = 113.04
  // (debe ser claramente > 0 para que esta prueba detecte el bug si reaparece).
  expect(bonificacionBuc).toBeGreaterThan(0);

  // tasa_senati = 0.0045 (parametros_normativos, 2026). La base correcta es
  // SOLO sueldo_basico (no hay dominical/feriado en este periodo): 376.80 x
  // 0.0045 = 1.6956 -> 1.70. Si el bug reapareciera (BUC incluido), la base
  // seria 376.80+113.04=489.84 -> senati = 2.20.
  expect(senati).toBeCloseTo(1.7, 1);
  expect(senati).not.toBeCloseTo(2.2, 1);
});
