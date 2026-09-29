// Prueba de regresion: el usuario reporto que la cuota sindical es un monto
// acordado con el sindicato de CADA PROYECTO y que varia segun la
// categoria del trabajador (un peon no paga lo mismo que un operario u
// oficial), pero el sistema solo tenia un valor unico por proyecto
// (proyectos.cuota_sindical_semanal).
//
// migracion_029 agrega la tabla cuota_sindical_categoria (proyecto +
// categoria -> monto semanal) y las rutas GET/PUT /api/conceptos/cuota-sindical
// para administrarla desde Configuracion. La cadena de resolucion en la
// consulta de routes/planilla.ts (/:id/calcular) es:
//   COALESCE(csc.monto_semanal, p.cuota_sindical_semanal, 0)
// es decir: usa el valor por categoria si esta configurado, si no cae al
// valor unico legado del proyecto, y solo llega a 0 si ninguno existe.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let tokenResponsable: string;
let proyectoId: number;
const empleadosCreados: number[] = [];
const periodosCreados: number[] = [];

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const rAdmin = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = rAdmin.body.token as string;

  const rResp = await request(app)
    .post("/api/auth/login")
    .send({ correo: "responsable-a@prueba.local", password: CLAVE_PRUEBA });
  tokenResponsable = rResp.body.token as string;

  const proy = await pool.query(
    `INSERT INTO proyectos (nombre, ubicacion, cuota_sindical_semanal)
     VALUES ('Proyecto Cuota Sindical', 'Lima', 15) RETURNING id`
  );
  proyectoId = proy.rows[0].id;
});

afterAll(async () => {
  for (const periodoId of periodosCreados) {
    await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoId]);
    await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [periodoId]);
    await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [id]);
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM cuota_sindical_categoria WHERE proyecto_id = $1", [proyectoId]);
  await pool.query("DELETE FROM proyectos WHERE id = $1", [proyectoId]);
  await pool.end();
});

describe("GET/PUT /api/conceptos/cuota-sindical (validaciones)", () => {
  it("un usuario sin permiso conceptos.editar recibe 403", async () => {
    const r = await request(app)
      .put("/api/conceptos/cuota-sindical")
      .set(auth(tokenResponsable))
      .send({ entradas: [{ proyecto_id: proyectoId, categoria: "PEON", monto_semanal: 20 }] });
    expect(r.status).toBe(403);
  });

  it("rechaza un proyecto_id que no existe", async () => {
    const r = await request(app)
      .put("/api/conceptos/cuota-sindical")
      .set(auth(tokenAdmin))
      .send({ entradas: [{ proyecto_id: 999999, categoria: "PEON", monto_semanal: 20 }] });
    expect(r.status).toBe(400);
  });

  it("rechaza una categoria invalida", async () => {
    const r = await request(app)
      .put("/api/conceptos/cuota-sindical")
      .set(auth(tokenAdmin))
      .send({ entradas: [{ proyecto_id: proyectoId, categoria: "GERENTE", monto_semanal: 20 }] });
    expect(r.status).toBe(400);
  });

  it("rechaza un monto_semanal negativo", async () => {
    const r = await request(app)
      .put("/api/conceptos/cuota-sindical")
      .set(auth(tokenAdmin))
      .send({ entradas: [{ proyecto_id: proyectoId, categoria: "PEON", monto_semanal: -5 }] });
    expect(r.status).toBe(400);
  });

  it("guarda valores por categoria y los devuelve en el GET", async () => {
    const guardar = await request(app)
      .put("/api/conceptos/cuota-sindical")
      .set(auth(tokenAdmin))
      .send({
        entradas: [
          { proyecto_id: proyectoId, categoria: "PEON", monto_semanal: 12 },
          { proyecto_id: proyectoId, categoria: "OFICIAL", monto_semanal: 18 },
        ],
      });
    expect(guardar.status).toBe(200);
    expect(guardar.body).toHaveLength(2);

    const listar = await request(app).get("/api/conceptos/cuota-sindical").set(auth(tokenAdmin));
    expect(listar.status).toBe(200);
    const paraProyecto = listar.body.filter((f: { proyecto_id: number }) => f.proyecto_id === proyectoId);
    expect(paraProyecto).toHaveLength(2);
    const peon = paraProyecto.find((f: { categoria: string }) => f.categoria === "PEON");
    expect(Number(peon.monto_semanal)).toBe(12);
  });
});

async function crearContrato(dni: string, nombre: string, categoria: string, sindicalizado: boolean) {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, 0) RETURNING id`,
    [dni, nombre]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado, sindicalizado)
     VALUES ($1, 'Proyecto Cuota Sindical', $2, 'ONP', '2026-01-01', 'HABIL', $3) RETURNING id`,
    [empleadoId, categoria, sindicalizado]
  );
  return c.rows[0].id as number;
}

async function calcularPeriodo(contratoId: number, indice: number) {
  // Cada contrato usa una semana distinta de marzo-2026 (indice unico
  // parcial de periodos SEMANAL exige fechas exactas distintas, migracion_018).
  const inicioDia = 1 + indice * 7;
  const finDia = inicioDia + 5;
  const fechaInicio = `2026-03-${String(inicioDia).padStart(2, "0")}`;
  const fechaFin = `2026-03-${String(finDia).padStart(2, "0")}`;
  const periodo = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
     VALUES (2026, 3, 'SEMANAL', $1, $2, 6) RETURNING id`,
    [fechaInicio, fechaFin]
  );
  const periodoId = periodo.rows[0].id as number;
  periodosCreados.push(periodoId);

  const editar = await request(app)
    .put(`/api/periodos/${periodoId}/tareo`)
    .set(auth(tokenAdmin))
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

  const calcular = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth(tokenAdmin)).send({});
  expect(calcular.status).toBe(200);
  expect(calcular.body.errores).toEqual([]);

  const detalle = await pool.query(
    "SELECT descuento_sindicato FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2",
    [periodoId, contratoId]
  );
  return detalle.rows[0];
}

// nota: parametros_normativos/tabla_salarial_mensual/tasas_afp_mensuales
// solo estan sembrados para anio=2026 en schema.sql - marzo (mes=3) no
// tiene fila propia en tabla_salarial_mensual/tasas_afp_mensuales, asi que
// estos calculos usan PEON/OFICIAL/OPERARIO de la tabla de febrero
// (obtenerTablaCategorias exige alguna fila para ese anio+mes exacto) -
// para evitar ese problema se siembra tambien marzo-2026 en beforeAll de
// este describe.
describe("Fallback proyecto+categoria en /calcular (COALESCE)", () => {
  beforeAll(async () => {
    await pool.query(
      `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico)
       SELECT 2026, 3, categoria, jornal_basico FROM tabla_salarial_mensual
       WHERE anio = 2026 AND mes = 2
       ON CONFLICT DO NOTHING`
    );
    await pool.query(
      `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
       SELECT 2026, 3, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio FROM tasas_afp_mensuales
       WHERE anio = 2026 AND mes = 2
       ON CONFLICT DO NOTHING`
    );
  });

  it("usa el valor por categoria configurado (PEON=12) en vez del legado (15)", async () => {
    const contratoId = await crearContrato("77791001", "PRUEBA CUOTA PEON CONFIGURADO", "PEON", true);
    const detalle = await calcularPeriodo(contratoId, 0);
    // cuotaDiaria = 12/6 = 2; 6 dias trabajados => 12
    expect(Number(detalle.descuento_sindicato)).toBeCloseTo(12);
  });

  it("cae al valor legado del proyecto (15) para una categoria sin configurar (OPERARIO)", async () => {
    const contratoId = await crearContrato("77791002", "PRUEBA CUOTA OPERARIO SIN CONFIGURAR", "OPERARIO", true);
    const detalle = await calcularPeriodo(contratoId, 1);
    // cuotaDiaria = 15/6 = 2.5; 6 dias trabajados => 15
    expect(Number(detalle.descuento_sindicato)).toBeCloseTo(15);
  });

  it("un contrato no sindicalizado nunca paga cuota sindical, sin importar la categoria", async () => {
    const contratoId = await crearContrato("77791003", "PRUEBA CUOTA NO SINDICALIZADO", "PEON", false);
    const detalle = await calcularPeriodo(contratoId, 2);
    expect(Number(detalle.descuento_sindicato)).toBe(0);
  });
});
