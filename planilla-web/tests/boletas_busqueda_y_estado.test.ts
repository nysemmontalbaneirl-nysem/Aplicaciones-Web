// Pruebas de la mejora "Boletas" (sept. 2026), parte backend:
// 1) GET /:id/planilla ahora acepta calculado_desde/calculado_hasta
//    (el usuario le llama "Periodo creado" y confirmo que se refiere a la
//    fecha en que se CALCULO cada boleta, detalle_planilla.calculado_en).
// 2) total_boletas_periodo distingue "periodo sin calcular todavia" (0,
//    detalle vacio) de "hay boletas pero el filtro no encontro nada" (>0,
//    detalle vacio) de "hay resultados" - pedido explicito del usuario para
//    poder mostrar el mensaje correcto en cada caso.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let tokenResponsable: string;
let proyectoId: number;
let otroProyectoId: number;
const empleadosCreados: number[] = [];
let contratoId: number;
let contratoOtroProyectoId: number;
let periodoAbiertoId: number;
let periodoCalculadoId: number;
let fechaCalculo: string; // ISO date (YYYY-MM-DD) del momento en que se calculo periodoCalculadoId

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const rAdmin = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = rAdmin.body.token as string;

  const rResponsable = await request(app)
    .post("/api/auth/login")
    .send({ correo: "responsable-a@prueba.local", password: CLAVE_PRUEBA });
  tokenResponsable = rResponsable.body.token as string;

  const proy = await pool.query(
    `INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Boletas Busqueda Estado', 'Lima') RETURNING id`
  );
  proyectoId = proy.rows[0].id;

  const proy2 = await pool.query(
    `INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Boletas Busqueda Estado (otro)', 'Lima') RETURNING id`
  );
  otroProyectoId = proy2.rows[0].id;

  const e1 = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '77794001', 'PRUEBA BOLETAS BUSQUEDA ESTADO', 0) RETURNING id`
  );
  empleadosCreados.push(e1.rows[0].id);
  const c1 = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Boletas Busqueda Estado', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [e1.rows[0].id]
  );
  contratoId = c1.rows[0].id;

  const e2 = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '77794002', 'PRUEBA BOLETAS OTRO PROYECTO', 0) RETURNING id`
  );
  empleadosCreados.push(e2.rows[0].id);
  const c2 = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Boletas Busqueda Estado (otro)', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [e2.rows[0].id]
  );
  contratoOtroProyectoId = c2.rows[0].id;

  // Periodo ABIERTO: nunca se calcula, para probar el caso "sin procesar".
  const pAbierto = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES (2026, 3, 'MENSUAL', '2026-03-01', '2026-03-31', 31, 'Proyecto Boletas Busqueda Estado') RETURNING id`
  );
  periodoAbiertoId = pAbierto.rows[0].id;

  // Periodo que SI se calcula, con boletas de 2 proyectos distintos.
  // Usa Febrero 2026 porque es el unico mes con tabla_salarial_mensual y
  // tasas_afp_mensuales ya sembradas de fabrica (ver sql/schema.sql) - mismo
  // mes que ya usa tests/exportar_boletas.test.ts, sin conflicto porque
  // ese archivo borra su propio periodo en su afterAll antes de que este
  // archivo corra (la bateria completa se ejecuta con --runInBand).
  const pCalculado = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
     VALUES (2026, 2, 'MENSUAL', '2026-02-01', '2026-02-28', 28) RETURNING id`
  );
  periodoCalculadoId = pCalculado.rows[0].id;

  for (const cId of [contratoId, contratoOtroProyectoId]) {
    const editar = await request(app)
      .put(`/api/periodos/${periodoCalculadoId}/tareo`)
      .set(auth(tokenAdmin))
      .send({
        contrato_id: cId,
        dias_trabajados: 20,
        dias_dominical: 0,
        dias_feriado: 0,
        dias_falta: 0,
        horas_extra_25: 0,
        horas_extra_35: 0,
        horas_extra_100: 0,
      });
    expect(editar.status).toBe(204);
  }

  const calcular = await request(app).post(`/api/periodos/${periodoCalculadoId}/calcular`).set(auth(tokenAdmin)).send({});
  expect(calcular.status).toBe(200);
  expect(calcular.body.errores).toEqual([]);

  const fila = await pool.query(
    `SELECT calculado_en FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2`,
    [periodoCalculadoId, contratoId]
  );
  fechaCalculo = new Date(fila.rows[0].calculado_en).toISOString().slice(0, 10);
});

afterAll(async () => {
  await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoCalculadoId]);
  await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id IN ($1, $2)", [periodoAbiertoId, periodoCalculadoId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id IN ($1, $2)", [periodoAbiertoId, periodoCalculadoId]);
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [id]);
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM proyectos WHERE id IN ($1, $2)", [proyectoId, otroProyectoId]);
  await pool.end();
});

describe("GET /api/periodos/:id/planilla - estado del periodo (procesado / sin procesar)", () => {
  it("periodo ABIERTO (nunca calculado): responde 200, detalle vacio y total_boletas_periodo=0", async () => {
    const r = await request(app).get(`/api/periodos/${periodoAbiertoId}/planilla`).set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.periodo.estado).toBe("ABIERTO");
    expect(r.body.detalle).toEqual([]);
    expect(r.body.total_boletas_periodo).toBe(0);
  });

  it("periodo CALCULADO: total_boletas_periodo refleja el total SIN filtrar, aunque q no encuentre nada", async () => {
    const r = await request(app)
      .get(`/api/periodos/${periodoCalculadoId}/planilla?q=NOMBRE_QUE_NO_EXISTE_XYZ`)
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.periodo.estado).toBe("CALCULADO");
    expect(r.body.detalle).toEqual([]);
    expect(r.body.total_boletas_periodo).toBe(2);
  });

  it("periodo CALCULADO sin filtros: devuelve las boletas y el mismo total en total_boletas_periodo", async () => {
    const r = await request(app).get(`/api/periodos/${periodoCalculadoId}/planilla`).set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.detalle).toHaveLength(2);
    expect(r.body.total_boletas_periodo).toBe(2);
  });

  it("usuario no-ADMIN (responsable de un solo proyecto): total_boletas_periodo tambien queda acotado a sus proyectos", async () => {
    const r = await request(app).get(`/api/periodos/${periodoCalculadoId}/planilla`).set(auth(tokenResponsable));
    expect(r.status).toBe(200);
    // responsable-a@prueba.local esta asignado (ver globalSetup) solo al
    // proyecto de pruebas original, no a "Proyecto Boletas Busqueda Estado"
    // ni a su variante "(otro)" - por lo tanto no deberia ver ninguna de
    // las 2 boletas de este periodo.
    expect(r.body.detalle).toEqual([]);
    expect(r.body.total_boletas_periodo).toBe(0);
  });
});

describe("GET /api/periodos/:id/planilla - filtro calculado_desde/calculado_hasta", () => {
  it("calculado_desde/calculado_hasta que incluyen el dia del calculo: devuelve las boletas", async () => {
    const r = await request(app)
      .get(`/api/periodos/${periodoCalculadoId}/planilla?calculado_desde=${fechaCalculo}&calculado_hasta=${fechaCalculo}`)
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.detalle).toHaveLength(2);
    expect(r.body.total_boletas_periodo).toBe(2);
  });

  it("calculado_desde en el futuro (dia siguiente): no encuentra nada, pero total_boletas_periodo sigue en 2", async () => {
    const manana = new Date(fechaCalculo + "T00:00:00Z");
    manana.setUTCDate(manana.getUTCDate() + 1);
    const r = await request(app)
      .get(`/api/periodos/${periodoCalculadoId}/planilla?calculado_desde=${manana.toISOString().slice(0, 10)}`)
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.detalle).toEqual([]);
    expect(r.body.total_boletas_periodo).toBe(2);
  });

  it("calculado_hasta el dia anterior al calculo: no encuentra nada (limite inferior respetado)", async () => {
    const ayer = new Date(fechaCalculo + "T00:00:00Z");
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    const r = await request(app)
      .get(`/api/periodos/${periodoCalculadoId}/planilla?calculado_hasta=${ayer.toISOString().slice(0, 10)}`)
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.detalle).toEqual([]);
  });

  it("calculado_hasta el mismo dia del calculo incluye TODO ese dia (limite superior exclusivo del dia SIGUIENTE)", async () => {
    // Esto verifica especificamente que "hasta hoy" no excluya calculos
    // hechos mas tarde en el mismo dia (comparacion con calculado_en, que
    // es un TIMESTAMPTZ con hora, no solo fecha).
    const r = await request(app)
      .get(`/api/periodos/${periodoCalculadoId}/planilla?calculado_hasta=${fechaCalculo}`)
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.detalle).toHaveLength(2);
  });

  it("se puede combinar q + calculado_desde + calculado_hasta a la vez", async () => {
    const listado = await request(app).get(`/api/periodos/${periodoCalculadoId}/planilla`).set(auth(tokenAdmin));
    const dni = listado.body.detalle.find((d: { contrato_id: number }) => d.contrato_id === contratoId).numero_documento;

    const r = await request(app)
      .get(`/api/periodos/${periodoCalculadoId}/planilla?q=${dni}&calculado_desde=${fechaCalculo}&calculado_hasta=${fechaCalculo}`)
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.detalle).toHaveLength(1);
    expect(r.body.detalle[0].contrato_id).toBe(contratoId);
  });
});
