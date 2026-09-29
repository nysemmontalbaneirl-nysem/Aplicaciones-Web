// Pruebas de la Ronda C (periodos_planilla.proyecto, migracion_028): cada
// periodo NUEVO ahora puede (y, si el usuario no es ADMIN, DEBE) pertenecer
// a un proyecto especifico. Los periodos ya existentes antes de esta
// migracion quedan con proyecto = NULL de forma permanente ("periodo
// legado/todos los proyectos", decision confirmada con el usuario) - el
// periodo MENSUAL 2026-03 sembrado en globalSetup.ts sirve como ese caso de
// regresion real (nunca se le asigna proyecto en este archivo).
//
// Reutiliza los usuarios/proyectos ya sembrados en globalSetup.ts:
// admin@prueba.local (ADMIN, ve/crea de todo), responsable-a@prueba.local
// (RESPONSABLE_PLANILLA, solo "Proyecto A"), responsable-b@prueba.local
// (RESPONSABLE_PLANILLA, solo "Proyecto B").
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let tokenResponsableA: string;
let tokenResponsableB: string;
const periodosCreados: number[] = [];
const empleadosCreados: number[] = [];
const contratosCreados: number[] = [];

function authAdmin() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}
function authResponsableA() {
  return { Authorization: `Bearer ${tokenResponsableA}` };
}
function authResponsableB() {
  return { Authorization: `Bearer ${tokenResponsableB}` };
}

async function crearContrato(dni: string, nombre: string, proyecto: string, fechaIngreso = "2026-01-01"): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, 0) RETURNING id`,
    [dni, nombre]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, $2, 'PEON', 'ONP', $3, 'HABIL') RETURNING id`,
    [empleadoId, proyecto, fechaIngreso]
  );
  const contratoId = c.rows[0].id as number;
  contratosCreados.push(contratoId);
  return contratoId;
}

beforeAll(async () => {
  const rAdmin = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = rAdmin.body.token as string;

  const rA = await request(app)
    .post("/api/auth/login")
    .send({ correo: "responsable-a@prueba.local", password: CLAVE_PRUEBA });
  tokenResponsableA = rA.body.token as string;

  const rB = await request(app)
    .post("/api/auth/login")
    .send({ correo: "responsable-b@prueba.local", password: CLAVE_PRUEBA });
  tokenResponsableB = rB.body.token as string;
});

afterAll(async () => {
  for (const id of periodosCreados) {
    await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [id]);
    await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [id]);
    await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [id]);
    await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [id]);
  }
  for (const id of contratosCreados) {
    await pool.query("DELETE FROM contratos WHERE id = $1", [id]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.end();
});

describe("POST /api/periodos - proyecto", () => {
  it("ADMIN crea un periodo con proyecto: queda guardado con ese proyecto", async () => {
    const r = await request(app)
      .post("/api/periodos")
      .set(authAdmin())
      .send({
        anio: 2028,
        mes: 1,
        tipo: "MENSUAL",
        fecha_inicio: "2028-01-01",
        fecha_fin: "2028-01-31",
        proyecto: "Proyecto A",
      });
    expect(r.status).toBe(201);
    expect(r.body.proyecto).toBe("Proyecto A");
    periodosCreados.push(r.body.id);
  });

  it("ADMIN puede crear un periodo SIN proyecto (legado)", async () => {
    const r = await request(app)
      .post("/api/periodos")
      .set(authAdmin())
      .send({
        anio: 2028,
        mes: 1,
        tipo: "MENSUAL",
        fecha_inicio: "2028-01-01",
        fecha_fin: "2028-01-31",
        // Distinto tipo/anio/mes que el anterior no hace falta - alcanza con
        // que el proyecto sea distinto (NULL vs "Proyecto A") para no chocar
        // con el indice unico.
      });
    expect(r.status).toBe(201);
    expect(r.body.proyecto).toBeNull();
    periodosCreados.push(r.body.id);
  });

  it("2 periodos SEMANAL con las mismas fechas pero proyectos distintos: ambos se crean sin conflicto", async () => {
    const base = {
      anio: 2028,
      mes: 2,
      tipo: "SEMANAL",
      fecha_inicio: "2028-02-01",
      fecha_fin: "2028-02-07",
    };
    const r1 = await request(app).post("/api/periodos").set(authAdmin()).send({ ...base, proyecto: "Proyecto A" });
    expect(r1.status).toBe(201);
    periodosCreados.push(r1.body.id);

    const r2 = await request(app).post("/api/periodos").set(authAdmin()).send({ ...base, proyecto: "Proyecto B" });
    expect(r2.status).toBe(201);
    periodosCreados.push(r2.body.id);
  });

  it("2 periodos SEMANAL con las mismas fechas y el mismo proyecto: el segundo choca (409)", async () => {
    const base = {
      anio: 2028,
      mes: 2,
      tipo: "SEMANAL",
      fecha_inicio: "2028-02-08",
      fecha_fin: "2028-02-14",
      proyecto: "Proyecto A",
    };
    const r1 = await request(app).post("/api/periodos").set(authAdmin()).send(base);
    expect(r1.status).toBe(201);
    periodosCreados.push(r1.body.id);

    const r2 = await request(app).post("/api/periodos").set(authAdmin()).send(base);
    expect(r2.status).toBe(409);
  });

  it("un periodo legado (proyecto NULL) ya existente sigue funcionando igual que antes (regresion)", async () => {
    const r = await request(app).get("/api/periodos").set(authAdmin());
    expect(r.status).toBe(200);
    const legado = r.body.find((p: { anio: number; mes: number; tipo: string }) => p.anio === 2026 && p.mes === 3 && p.tipo === "MENSUAL");
    expect(legado).toBeDefined();
    expect(legado.proyecto).toBeNull();
  });

  it("RESPONSABLE_PLANILLA sin enviar proyecto: 403 (solo ADMIN puede crear un periodo legado)", async () => {
    const r = await request(app)
      .post("/api/periodos")
      .set(authResponsableA())
      .send({
        anio: 2028,
        mes: 4,
        tipo: "MENSUAL",
        fecha_inicio: "2028-04-01",
        fecha_fin: "2028-04-30",
      });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/Solo un Administrador/i);
  });

  it("RESPONSABLE_PLANILLA intentando un proyecto al que no tiene acceso: 403", async () => {
    const r = await request(app)
      .post("/api/periodos")
      .set(authResponsableA())
      .send({
        anio: 2028,
        mes: 4,
        tipo: "MENSUAL",
        fecha_inicio: "2028-04-01",
        fecha_fin: "2028-04-30",
        proyecto: "Proyecto B",
      });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/No tienes acceso/i);
  });

  it("RESPONSABLE_PLANILLA creando un periodo de su propio proyecto asignado: 201", async () => {
    const r = await request(app)
      .post("/api/periodos")
      .set(authResponsableA())
      .send({
        anio: 2028,
        mes: 4,
        tipo: "MENSUAL",
        fecha_inicio: "2028-04-01",
        fecha_fin: "2028-04-30",
        proyecto: "Proyecto A",
      });
    expect(r.status).toBe(201);
    expect(r.body.proyecto).toBe("Proyecto A");
    periodosCreados.push(r.body.id);
  });
});

describe("GET /api/periodos - filtrado por proyecto asignado", () => {
  let periodoAId: number;
  let periodoBId: number;

  beforeAll(async () => {
    const rA = await request(app)
      .post("/api/periodos")
      .set(authAdmin())
      .send({ anio: 2028, mes: 5, tipo: "MENSUAL", fecha_inicio: "2028-05-01", fecha_fin: "2028-05-31", proyecto: "Proyecto A" });
    periodoAId = rA.body.id;
    periodosCreados.push(periodoAId);

    const rB = await request(app)
      .post("/api/periodos")
      .set(authAdmin())
      .send({ anio: 2028, mes: 6, tipo: "MENSUAL", fecha_inicio: "2028-06-01", fecha_fin: "2028-06-30", proyecto: "Proyecto B" });
    periodoBId = rB.body.id;
    periodosCreados.push(periodoBId);
  });

  it("ADMIN ve ambos periodos (de Proyecto A y de Proyecto B)", async () => {
    const r = await request(app).get("/api/periodos").set(authAdmin());
    const ids = r.body.map((p: { id: number }) => p.id);
    expect(ids).toContain(periodoAId);
    expect(ids).toContain(periodoBId);
  });

  it("RESPONSABLE_PLANILLA de Proyecto A ve el periodo de su proyecto y el legado, pero NO el de Proyecto B", async () => {
    const r = await request(app).get("/api/periodos").set(authResponsableA());
    const ids = r.body.map((p: { id: number }) => p.id);
    expect(ids).toContain(periodoAId);
    expect(ids).not.toContain(periodoBId);
    const legado = r.body.find((p: { anio: number; mes: number; tipo: string }) => p.anio === 2026 && p.mes === 3 && p.tipo === "MENSUAL");
    expect(legado).toBeDefined();
  });

  it("RESPONSABLE_PLANILLA de Proyecto B ve el periodo de su proyecto y el legado, pero NO el de Proyecto A", async () => {
    const r = await request(app).get("/api/periodos").set(authResponsableB());
    const ids = r.body.map((p: { id: number }) => p.id);
    expect(ids).toContain(periodoBId);
    expect(ids).not.toContain(periodoAId);
  });
});

describe("PUT /api/periodos/:id - editar un periodo ABIERTO", () => {
  it("edita fechas y proyecto de un periodo ABIERTO: 200 con los datos actualizados", async () => {
    const crear = await request(app)
      .post("/api/periodos")
      .set(authAdmin())
      .send({ anio: 2028, mes: 7, tipo: "MENSUAL", fecha_inicio: "2028-07-01", fecha_fin: "2028-07-31", proyecto: "Proyecto A" });
    expect(crear.status).toBe(201);
    const id = crear.body.id as number;
    periodosCreados.push(id);

    const r = await request(app)
      .put(`/api/periodos/${id}`)
      .set(authAdmin())
      .send({ fecha_inicio: "2028-07-01", fecha_fin: "2028-07-31", proyecto: "Proyecto B" });
    expect(r.status).toBe(200);
    expect(r.body.proyecto).toBe("Proyecto B");

    const bitacora = await pool.query(
      "SELECT * FROM bitacora_planilla WHERE accion = 'EDITAR_PERIODO' AND tabla_afectada = 'periodos_planilla' AND registro_id = $1",
      [id]
    );
    expect(bitacora.rowCount).toBeGreaterThanOrEqual(1);
  });

  it("400 al intentar editar un periodo que ya esta CALCULADO", async () => {
    const crear = await request(app)
      .post("/api/periodos")
      .set(authAdmin())
      .send({ anio: 2028, mes: 8, tipo: "MENSUAL", fecha_inicio: "2028-08-01", fecha_fin: "2028-08-31", proyecto: "Proyecto A" });
    const id = crear.body.id as number;
    periodosCreados.push(id);

    await pool.query("UPDATE periodos_planilla SET estado = 'CALCULADO' WHERE id = $1", [id]);

    const r = await request(app)
      .put(`/api/periodos/${id}`)
      .set(authAdmin())
      .send({ proyecto: "Proyecto B" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/ABIERTO/);

    const actual = await pool.query("SELECT proyecto FROM periodos_planilla WHERE id = $1", [id]);
    expect(actual.rows[0].proyecto).toBe("Proyecto A");
  });

  it("rechaza (400) asignarle un proyecto si el periodo ya tiene tareo cargado de OTRO proyecto", async () => {
    // Periodo legado (proyecto NULL) para poder cargarle tareo de un
    // contrato de Proyecto A sin restriccion.
    const crear = await request(app)
      .post("/api/periodos")
      .set(authAdmin())
      .send({ anio: 2028, mes: 9, tipo: "MENSUAL", fecha_inicio: "2028-09-01", fecha_fin: "2028-09-30" });
    const id = crear.body.id as number;
    periodosCreados.push(id);

    const contratoId = await crearContrato("77791101", "PRUEBA PUT MISMATCH", "Proyecto A", "2028-01-01");
    const tareo = await request(app)
      .put(`/api/periodos/${id}/tareo`)
      .set(authAdmin())
      .send({
        contrato_id: contratoId,
        dias_trabajados: 5,
        dias_dominical: 0,
        dias_feriado: 0,
        dias_falta: 0,
        horas_extra_25: 0,
        horas_extra_35: 0,
        horas_extra_100: 0,
      });
    expect(tareo.status).toBe(204);

    const r = await request(app)
      .put(`/api/periodos/${id}`)
      .set(authAdmin())
      .send({ proyecto: "Proyecto B" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Proyecto A/);

    const actual = await pool.query("SELECT proyecto FROM periodos_planilla WHERE id = $1", [id]);
    expect(actual.rows[0].proyecto).toBeNull();
  });
});

describe("Carga de tareo respeta el proyecto del periodo (Ronda C)", () => {
  let periodoProyectoAId: number;
  let contratoProyectoBId: number;

  beforeAll(async () => {
    const crear = await request(app)
      .post("/api/periodos")
      .set(authAdmin())
      .send({ anio: 2028, mes: 10, tipo: "MENSUAL", fecha_inicio: "2028-10-01", fecha_fin: "2028-10-31", proyecto: "Proyecto A" });
    periodoProyectoAId = crear.body.id;
    periodosCreados.push(periodoProyectoAId);

    contratoProyectoBId = await crearContrato("77791102", "PRUEBA TAREO MISMATCH", "Proyecto B", "2028-01-01");
  });

  it("PUT /:id/tareo-diario/:contratoId rechaza (400) un contrato de otro proyecto", async () => {
    const r = await request(app)
      .put(`/api/periodos/${periodoProyectoAId}/tareo-diario/${contratoProyectoBId}`)
      .set(authAdmin())
      .send({ dias: [{ fecha: "2028-10-02", horas_normales: 8, minutos_normales: 0 }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/especifico del proyecto "Proyecto A"/);
  });

  it("PUT /:id/tareo rechaza (400) un contrato de otro proyecto", async () => {
    const r = await request(app)
      .put(`/api/periodos/${periodoProyectoAId}/tareo`)
      .set(authAdmin())
      .send({
        contrato_id: contratoProyectoBId,
        dias_trabajados: 5,
        dias_dominical: 0,
        dias_feriado: 0,
        dias_falta: 0,
        horas_extra_25: 0,
        horas_extra_35: 0,
        horas_extra_100: 0,
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/especifico del proyecto "Proyecto A"/);
  });

  it("POST /:id/tareo/importar reporta un error de fila (no lo guarda) para un contrato de otro proyecto", async () => {
    const dni = "77791102";
    const csv =
      "DNI,DIAS_TRABAJADOS,DIAS_DOMINICAL,DIAS_FERIADO,DIAS_FALTA,HORAS_EXTRA_25,HORAS_EXTRA_35,HORAS_EXTRA_100\n" +
      `${dni},5,0,0,0,0,0,0\n`;
    const r = await request(app)
      .post(`/api/periodos/${periodoProyectoAId}/tareo/importar`)
      .set(authAdmin())
      .attach("archivo", Buffer.from(csv), "tareo.csv");
    expect(r.status).toBe(200);
    expect(r.body.guardados).toBe(0);
    expect(r.body.errores).toHaveLength(1);
    expect(r.body.errores[0].motivo).toMatch(/especifico del proyecto 'Proyecto A'/);
  });
});
