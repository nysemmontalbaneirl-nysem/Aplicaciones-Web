// Pruebas HTTP de las rutas de "Planilla Mensual Consolidada" (Ronda E, ver
// src/routes/planillaMensual.ts): POST /consolidar, GET / (leer), y las
// descargas (rem/afpnet). Cubre en particular el control de acceso (permiso
// planilla_mensual.gestionar + tieneAccesoProyecto), que es la parte de este
// router que no esta cubierta por las pruebas unitarias de
// planillaMensual.ts/plame.ts/afpnet.ts.
//
// NOTA (recon 19/46): la ruta GET .../exportar/asiento-contable del parche
// original se omite (y su prueba con ella) - depende de
// "src/asientoContable.ts", que no existe en este arbol (ver
// RECONSTRUCCION_BRECHAS.md punto 5).
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

const PROYECTO = "Proyecto A"; // responsable-a@prueba.local tiene acceso a este, ya sembrado por globalSetup.ts
const JORNAL_PEON_OCT_2026 = 69.0;

let tokenAdmin: string;
let tokenResponsableA: string; // acceso a Proyecto A
let tokenResponsableB: string; // acceso a Proyecto B (NO a Proyecto A)
let tokenTareadorA: string; // acceso a Proyecto A, pero SIN el permiso planilla_mensual.gestionar

const periodosCreados: number[] = [];
const empleadosCreados: number[] = [];

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const login = async (correo: string) => {
    const r = await request(app).post("/api/auth/login").send({ correo, password: CLAVE_PRUEBA });
    return r.body.token as string;
  };
  tokenAdmin = await login("admin@prueba.local");
  tokenResponsableA = await login("responsable-a@prueba.local");
  tokenResponsableB = await login("responsable-b@prueba.local");
  tokenTareadorA = await login("tareador-a@prueba.local");

  await pool.query(
    `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
     VALUES (2026, 10, 'PEON', $1, 0.30, 0, 8.60, 13.13)
     ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`,
    [JORNAL_PEON_OCT_2026]
  );
  await pool.query(
    `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
     VALUES (2026, 10, 'INTEGRA', 0.0155, 0.0137, 0.10)
     ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`
  );

  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES (2026, 10, 1, 'QUINCENAL', '2026-10-01', '2026-10-15', 15, $1) RETURNING id`,
    [PROYECTO]
  );
  const periodoId = p.rows[0].id as number;
  periodosCreados.push(periodoId);

  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '88882001', 'PRUEBA RUTAS PLANILLA MENSUAL', 0) RETURNING id`
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, $2, 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId, PROYECTO]
  );
  const contratoId = c.rows[0].id as number;

  await request(app)
    .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
    .set(auth(tokenAdmin))
    .send({
      dias: ["2026-10-02", "2026-10-03", "2026-10-05"].map((fecha) => ({ fecha, horas_normales: 8, minutos_normales: 0 })),
    })
    .expect(204);
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM detalle_planilla_mensual WHERE planilla_mensual_id IN (SELECT id FROM planilla_mensual WHERE proyecto = $1 AND anio = 2026 AND mes = 10)",
    [PROYECTO]
  );
  await pool.query("DELETE FROM planilla_mensual WHERE proyecto = $1 AND anio = 2026 AND mes = 10", [PROYECTO]);
  for (const periodoId of periodosCreados) {
    await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [periodoId]);
    await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [id]);
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2026 AND mes = 10 AND categoria = 'PEON'");
  await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = 2026 AND mes = 10");
  await pool.end();
});

let planillaMensualId: number;

describe("POST /api/planilla-mensual/consolidar", () => {
  it("sin el permiso planilla_mensual.gestionar (TAREADOR) -> 403", async () => {
    const r = await request(app)
      .post("/api/planilla-mensual/consolidar")
      .set(auth(tokenTareadorA))
      .send({ proyecto: PROYECTO, anio: 2026, mes: 10 });
    expect(r.status).toBe(403);
  });

  it("con el permiso pero SIN acceso a ese proyecto (Responsable de Proyecto B) -> 403", async () => {
    const r = await request(app)
      .post("/api/planilla-mensual/consolidar")
      .set(auth(tokenResponsableB))
      .send({ proyecto: PROYECTO, anio: 2026, mes: 10 });
    expect(r.status).toBe(403);
  });

  it("Responsable de Proyecto A consolida su propio proyecto -> 200", async () => {
    const r = await request(app)
      .post("/api/planilla-mensual/consolidar")
      .set(auth(tokenResponsableA))
      .send({ proyecto: PROYECTO, anio: 2026, mes: 10 });
    expect(r.status).toBe(200);
    expect(r.body.errores).toEqual([]);
    expect(r.body.trabajadores_consolidados).toBe(1);
    planillaMensualId = r.body.planilla_mensual_id;
  });

  it("falta proyecto/anio/mes -> 400", async () => {
    const r = await request(app).post("/api/planilla-mensual/consolidar").set(auth(tokenAdmin)).send({ anio: 2026, mes: 10 });
    expect(r.status).toBe(400);
  });
});

describe("GET /api/planilla-mensual", () => {
  it("mes ya consolidado -> 200 con cabecera + detalle", async () => {
    const r = await request(app)
      .get("/api/planilla-mensual")
      .query({ proyecto: PROYECTO, anio: 2026, mes: 10 })
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.planillaMensual.proyecto).toBe(PROYECTO);
    expect(r.body.detalle).toHaveLength(1);
  });

  it("mes NUNCA consolidado -> 404", async () => {
    const r = await request(app)
      .get("/api/planilla-mensual")
      .query({ proyecto: PROYECTO, anio: 2026, mes: 11 })
      .set(auth(tokenAdmin));
    expect(r.status).toBe(404);
  });

  it("Responsable de Proyecto B no puede leer la Planilla Mensual de Proyecto A -> 403", async () => {
    const r = await request(app)
      .get("/api/planilla-mensual")
      .query({ proyecto: PROYECTO, anio: 2026, mes: 10 })
      .set(auth(tokenResponsableB));
    expect(r.status).toBe(403);
  });
});

describe("Descargas de la Planilla Mensual ya consolidada", () => {
  it("GET /:id/exportar/rem -> 200 texto plano", async () => {
    const r = await request(app)
      .get(`/api/planilla-mensual/${planillaMensualId}/exportar/rem`)
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/plain");
    expect(r.text).toContain("|88882001|");
  });

  it("GET /:id/exportar/afpnet -> 200 CSV", async () => {
    const r = await request(app)
      .get(`/api/planilla-mensual/${planillaMensualId}/exportar/afpnet`)
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
  });

  it("Responsable de Proyecto B no puede descargar el REM de Proyecto A -> 403", async () => {
    const r = await request(app)
      .get(`/api/planilla-mensual/${planillaMensualId}/exportar/rem`)
      .set(auth(tokenResponsableB));
    expect(r.status).toBe(403);
  });

  it("id inexistente -> 404", async () => {
    const r = await request(app).get("/api/planilla-mensual/999999/exportar/rem").set(auth(tokenAdmin));
    expect(r.status).toBe(404);
  });
});
