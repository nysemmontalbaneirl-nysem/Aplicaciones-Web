// Pruebas HTTP de las rutas de "Planilla Mensual" (Ronda E +
// unificacion Reportes/Planilla Mensual, 22/09/2026 - ver
// src/routes/planillaMensual.ts): POST /consolidar, GET /historial,
// GET / (leer, siempre 200) y las descargas (rem/afpnet/afpnet-excel),
// ahora todas por {anio, mes, proyecto?} en vez de un planilla_mensual_id en
// la URL. Cubre en particular el control de acceso (permiso
// planilla_mensual.gestionar + tieneAccesoProyecto, y la restriccion nueva
// de "todos los proyectos" solo ADMIN), que es la parte de este router que
// no esta cubierta por las pruebas unitarias de
// planillaMensual.ts/plame.ts/afpnet.ts.
//
// NOTA (recon 19/46, reconfirmado en recon 33/46): la ruta GET
// .../exportar/asiento-contable del parche original se sigue omitiendo (y su
// prueba con ella) - depende de "src/asientoContable.ts", que no existe en
// este arbol (ver RECONSTRUCCION_BRECHAS.md punto 5 - confirmado ausente ya
// 3 veces).
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

const PROYECTO = "Proyecto A"; // responsable-a@prueba.local tiene acceso a este, ya sembrado por globalSetup.ts
const JORNAL_PEON_OCT_2026 = 69.0;
// Mes reservado para "sin nada declarado" (no debe chocar con el mes 10, que
// este mismo archivo consolida arriba).
const MES_SIN_DATOS = 12;

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

  // Migracion 040: los limites configurables de tareo (max 8h/dia lun-vie,
  // 5h/dia sabado) no son el objeto de esta prueba - se relajan aqui para
  // no romper este fixture (2026-10-03 es sabado). Se restauran en afterAll.
  await pool.query(
    "UPDATE limites_tareo SET horas_max_lun_vie = 24, minutos_max_lun_vie = 59, horas_max_sabado = 24, minutos_max_sabado = 59 WHERE id = 1"
  );

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
    "UPDATE limites_tareo SET horas_max_lun_vie = 8, minutos_max_lun_vie = 30, horas_max_sabado = 5, minutos_max_sabado = 30 WHERE id = 1"
  );
  await pool.query(
    "DELETE FROM detalle_planilla_mensual WHERE planilla_mensual_id IN (SELECT id FROM planilla_mensual WHERE anio = 2026 AND mes = 10)"
  );
  await pool.query("DELETE FROM planilla_mensual WHERE anio = 2026 AND mes = 10");
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
    expect(r.body.proyecto).toBe(PROYECTO);
    expect(r.body.proyectos_consolidados).toEqual([PROYECTO]);
    expect(r.body.trabajadores_consolidados).toBe(1);

    // Migracion 042: el periodo del fixture (beforeAll) queda en estado
    // ABIERTO (nunca se le presiona "Calcular") - debe aparecer listado en
    // periodos_incluidos Y generar el aviso de "periodo no calculado
    // todavia", sin que eso bloquee la consolidacion.
    expect(r.body.periodos_incluidos).toHaveLength(1);
    expect(r.body.periodos_incluidos[0].estado).toBe("ABIERTO");
    expect(r.body.periodos_incluidos[0].proyecto).toBe(PROYECTO);
    expect(r.body.avisos_periodos_no_calculados).toHaveLength(1);
    expect(r.body.avisos_periodos_no_calculados[0].fecha_inicio).toBe("2026-10-01");
  });

  it("falta anio o mes -> 400", async () => {
    const r = await request(app)
      .post("/api/planilla-mensual/consolidar")
      .set(auth(tokenAdmin))
      .send({ proyecto: PROYECTO, mes: 10 });
    expect(r.status).toBe(400);
  });

  it("sin proyecto (todos los proyectos), sin ser ADMIN -> 403", async () => {
    const r = await request(app)
      .post("/api/planilla-mensual/consolidar")
      .set(auth(tokenResponsableA))
      .send({ anio: 2026, mes: 10 });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/administrador/);
  });

  it("ADMIN consolida TODOS los proyectos a la vez (sin proyecto) -> 200, incluye Proyecto A", async () => {
    const r = await request(app).post("/api/planilla-mensual/consolidar").set(auth(tokenAdmin)).send({ anio: 2026, mes: 10 });
    expect(r.status).toBe(200);
    expect(r.body.proyecto).toBeNull();
    expect(r.body.proyectos_consolidados).toContain(PROYECTO);
  });
});

describe("GET /api/planilla-mensual/historial", () => {
  it("ADMIN ve el mes/proyecto ya consolidado arriba", async () => {
    const r = await request(app).get("/api/planilla-mensual/historial").set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    const fila = r.body.find((f: { proyecto: string; anio: number; mes: number }) => f.proyecto === PROYECTO && f.anio === 2026 && f.mes === 10);
    expect(fila).toBeDefined();
    expect(fila.trabajadores_consolidados).toBe(1);
  });

  it("Responsable de Proyecto B NO ve la consolidacion de Proyecto A", async () => {
    const r = await request(app).get("/api/planilla-mensual/historial").set(auth(tokenResponsableB));
    expect(r.status).toBe(200);
    expect(r.body.some((f: { proyecto: string }) => f.proyecto === PROYECTO)).toBe(false);
  });

  it("Responsable de Proyecto A SI ve su propia consolidacion", async () => {
    const r = await request(app).get("/api/planilla-mensual/historial").set(auth(tokenResponsableA));
    expect(r.status).toBe(200);
    expect(r.body.some((f: { proyecto: string }) => f.proyecto === PROYECTO)).toBe(true);
  });

  it("sin el permiso planilla_mensual.gestionar (TAREADOR) -> 403", async () => {
    const r = await request(app).get("/api/planilla-mensual/historial").set(auth(tokenTareadorA));
    expect(r.status).toBe(403);
  });
});

describe("GET /api/planilla-mensual", () => {
  it("mes ya consolidado, por proyecto -> 200 con cabeceras + detalle", async () => {
    const r = await request(app)
      .get("/api/planilla-mensual")
      .query({ proyecto: PROYECTO, anio: 2026, mes: 10 })
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.proyecto).toBe(PROYECTO);
    expect(r.body.detalle).toHaveLength(1);
    // Migracion 043 (21/09/2026): diagnostico por Sistema de Pension, visible
    // sin tener que descargar el Excel de AFPnet - el unico trabajador de
    // este fixture esta en ONP (no AFP, ver beforeAll).
    expect(r.body.diagnostico_afpnet).toEqual({
      trabajadores_consolidados: 1,
      por_sistema_pension: [{ sistema_pension: "ONP", total: 1 }],
    });
  });

  it("mes NUNCA tocado -> 200 con arreglos vacios (ya no 404 - permite distinguir 'nada' de 'sin tocar' desde el propio contenido)", async () => {
    const r = await request(app)
      .get("/api/planilla-mensual")
      .query({ proyecto: PROYECTO, anio: 2026, mes: MES_SIN_DATOS })
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.cabeceras_obreros).toEqual([]);
    expect(r.body.detalle).toEqual([]);
  });

  it("Responsable de Proyecto B no puede leer la Planilla Mensual de Proyecto A -> 403", async () => {
    const r = await request(app)
      .get("/api/planilla-mensual")
      .query({ proyecto: PROYECTO, anio: 2026, mes: 10 })
      .set(auth(tokenResponsableB));
    expect(r.status).toBe(403);
  });

  it("sin proyecto (todos los proyectos), sin ser ADMIN -> 403", async () => {
    const r = await request(app).get("/api/planilla-mensual").query({ anio: 2026, mes: 10 }).set(auth(tokenResponsableA));
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/administrador/);
  });

  it("ADMIN sin proyecto (todos los proyectos) -> 200, incluye el detalle de Proyecto A", async () => {
    const r = await request(app).get("/api/planilla-mensual").query({ anio: 2026, mes: 10 }).set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.body.proyecto).toBeNull();
    expect(r.body.detalle.some((f: { proyecto: string }) => f.proyecto === PROYECTO)).toBe(true);
  });
});

describe("Descargas de la Planilla Mensual ya consolidada", () => {
  const queryProyecto = { proyecto: PROYECTO, anio: 2026, mes: 10 };

  // Bug real de produccion (21/09/2026): el usuario recibia SIEMPRE el mismo
  // archivo .xlsx (byte a byte identico, confirmado comparando la fecha de
  // creacion interna del archivo) sin importar cuantas veces lo descargara,
  // porque el navegador servia una copia de su propia cache sin volver a
  // pedirle el archivo al servidor - ninguna ruta de este router mandaba
  // encabezados de "no cachear". Se prueba una sola ruta como representante
  // (no solo en afpnet-excel) porque el mismo problema aplicaba igual a
  // REM/AFPnet CSV y a la lectura de la Planilla Mensual.
  it("TODAS las rutas de este router mandan encabezados de 'no cachear' (Cache-Control: no-store)", async () => {
    const r = await request(app).get("/api/planilla-mensual/exportar/rem").query(queryProyecto).set(auth(tokenAdmin));
    expect(r.headers["cache-control"]).toContain("no-store");
    expect(r.headers["pragma"]).toBe("no-cache");
  });

  it("GET /exportar/rem -> 200 texto plano", async () => {
    const r = await request(app).get("/api/planilla-mensual/exportar/rem").query(queryProyecto).set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/plain");
    expect(r.text).toContain("|88882001|");
  });

  it("GET /exportar/afpnet -> 200 CSV", async () => {
    const r = await request(app).get("/api/planilla-mensual/exportar/afpnet").query(queryProyecto).set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
  });

  // Bug real de produccion (19/09/2026): el usuario recibio un .xlsx "valido"
  // pero sin ninguna fila, sin ningun aviso de por que, y penso que era un
  // bug del generador. El unico trabajador de esta Planilla Mensual esta en
  // ONP (no AFP, ver beforeAll) - exactamente el caso que antes devolvia 200
  // con un archivo vacio. Ahora debe explicar el motivo en vez de entregarlo.
  it("GET /exportar/afpnet-excel sin ningun trabajador con Sistema de Pension = AFP -> 400 explicando el motivo (nunca un archivo vacio en silencio)", async () => {
    const r = await request(app).get("/api/planilla-mensual/exportar/afpnet-excel").query(queryProyecto).set(auth(tokenAdmin));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Sistema de Pension = AFP/);
    expect(r.body.advertencias).toEqual([]);
    // Migracion 043: el mensaje ahora explica que SI se consolidaron
    // trabajadores este mes, solo que ninguno es AFP (resultado correcto,
    // no un error) - y lo confirma con el desglose real.
    expect(r.body.error).toMatch(/Se encontraron 1 trabajador/);
    expect(r.body.error).toMatch(/ONP: 1/);
    expect(r.body.diagnostico).toEqual({
      trabajadores_consolidados: 1,
      por_sistema_pension: [{ sistema_pension: "ONP", total: 1 }],
    });
  });

  it("Responsable de Proyecto B no puede descargar el REM de Proyecto A -> 403", async () => {
    const r = await request(app).get("/api/planilla-mensual/exportar/rem").query(queryProyecto).set(auth(tokenResponsableB));
    expect(r.status).toBe(403);
  });

  it("sin proyecto (todos los proyectos), sin ser ADMIN -> 403", async () => {
    const r = await request(app)
      .get("/api/planilla-mensual/exportar/rem")
      .query({ anio: 2026, mes: 10 })
      .set(auth(tokenResponsableA));
    expect(r.status).toBe(403);
  });

  it("mes/proyecto sin nada declarado -> el REM sale vacio (200), nunca revienta", async () => {
    const r = await request(app)
      .get("/api/planilla-mensual/exportar/rem")
      .query({ proyecto: PROYECTO, anio: 2026, mes: MES_SIN_DATOS })
      .set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    expect(r.text.trim()).toBe("");
  });
});
