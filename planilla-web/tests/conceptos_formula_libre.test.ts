// Pruebas de integracion de "Conceptos con formula propia" (Ronda D,
// migracion 033): CRUD protegido por la clave secundaria de formulas,
// evaluacion de la formula durante el calculo de planilla, persistencia en
// detalle_planilla_conceptos, efecto sobre las bases de aportes (afecto_*),
// vigencia por mes calendario, y en el PLAME, y el aviso de posible
// duplicado contra el catalogo Anexo 22.
//
// NOTA (recon 15/46): las pruebas originales tambien cubrian "aparicion en
// el asiento contable" (src/asientoContable.ts, plan_cuentas,
// mapeo_cuentas_contables) - ese archivo/feature completo no existe
// todavia en este punto de la reconstruccion (gap conocido, documentado
// desde patches anteriores: sin parche fuente disponible). Se omite esa
// prueba y todo su setup (cuentas de prueba) aqui; revisar y reincorporar
// cuando se reconstruya esa funcionalidad.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { generarLineasREM } from "../src/plame";
import { CLAVE_PRUEBA } from "./globalSetup";

const CLAVE_FORMULAS = "ClaveFormulasPrueba1!";
const PROYECTO_NOMBRE = "Proyecto Formula Libre";

let tokenAdmin: string;
let periodoId: number;
let proyectoId: number;
let empleadoId: number;
let contratoId: number;

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

async function obtenerConceptosPersonalizados(detalleId: number) {
  const r = await pool.query("SELECT * FROM detalle_planilla_conceptos WHERE detalle_id = $1", [detalleId]);
  return r.rows;
}

async function obtenerDetalle() {
  const r = await pool.query("SELECT * FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2", [
    periodoId,
    contratoId,
  ]);
  return r.rows[0];
}

async function calcular() {
  const r = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
  expect(r.status).toBe(200);
  expect(r.body.errores).toEqual([]);
  return r.body;
}

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const proy = await pool.query(`INSERT INTO proyectos (nombre, ubicacion) VALUES ($1, 'Lima') RETURNING id`, [
    PROYECTO_NOMBRE,
  ]);
  proyectoId = proy.rows[0].id;

  // Periodo MENSUAL de Febrero-2026, con proyecto propio (para no chocar con
  // el periodo global/legado de febrero-2026 que usan otras pruebas -
  // migracion_028 permite 2 periodos con las mismas fechas en proyectos
  // distintos). Reutiliza la tabla salarial/tasas AFP de ese mes, ya
  // sembradas en schema.sql (PEON: jornal_basico = 62.80).
  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES (2026, 2, 'MENSUAL', '2026-02-01', '2026-02-28', 28, $1) RETURNING id`,
    [PROYECTO_NOMBRE]
  );
  periodoId = p.rows[0].id;

  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '77790301', 'PRUEBA FORMULA LIBRE', 0) RETURNING id`
  );
  empleadoId = e.rows[0].id;
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, $2, 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId, PROYECTO_NOMBRE]
  );
  contratoId = c.rows[0].id;

  // Configura la clave secundaria de formulas (todavia no configurada en
  // esta base de pruebas: ninguna otra prueba la toca).
  const configurar = await request(app)
    .post("/api/conceptos/clave-formulas")
    .set(auth())
    .send({ clave_nueva: CLAVE_FORMULAS });
  expect(configurar.status).toBe(204);
});

afterAll(async () => {
  await pool.query("DELETE FROM detalle_planilla_conceptos WHERE detalle_id IN (SELECT id FROM detalle_planilla WHERE periodo_id = $1)", [periodoId]);
  await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  await pool.query("DELETE FROM contratos WHERE id = $1", [contratoId]);
  await pool.query("DELETE FROM empleados WHERE id = $1", [empleadoId]);
  await pool.query("DELETE FROM conceptos_planilla WHERE es_personalizado = true");
  await pool.query("DELETE FROM proyectos WHERE id = $1", [proyectoId]);
  await pool.end();
});

describe("Clave secundaria de formulas: exigida en toda accion, incluso para ADMIN", () => {
  it("rechaza crear un concepto sin clave_formulas en el body", async () => {
    const r = await request(app)
      .post("/api/conceptos/formula")
      .set(auth())
      .send({ codigo: "SIN_CLAVE_TEST", nombre: "Sin clave", tipo: "INGRESO", modo: "FORMULA", formula: "jornal_diario" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/clave secundaria/i);
  });

  it("rechaza crear un concepto con clave_formulas incorrecta", async () => {
    const r = await request(app)
      .post("/api/conceptos/formula")
      .set(auth())
      .send({
        codigo: "CLAVE_MALA_TEST",
        nombre: "Clave mala",
        tipo: "INGRESO",
        modo: "FORMULA",
        formula: "jornal_diario",
        clave_formulas: "esta-clave-es-incorrecta",
      });
    expect(r.status).toBe(403);
  });
});

describe("Validacion de formula al crear un concepto personalizado", () => {
  it("rechaza una formula con una variable que no existe en la lista blanca", async () => {
    const r = await request(app)
      .post("/api/conceptos/formula")
      .set(auth())
      .send({
        codigo: "VARIABLE_INVALIDA_TEST",
        nombre: "Variable invalida",
        tipo: "INGRESO",
        modo: "FORMULA",
        formula: "variable_invalida * 2",
        clave_formulas: CLAVE_FORMULAS,
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("variable_invalida");
  });

  it("rechaza una formula con sintaxis invalida", async () => {
    const r = await request(app)
      .post("/api/conceptos/formula")
      .set(auth())
      .send({
        codigo: "SINTAXIS_INVALIDA_TEST",
        nombre: "Sintaxis invalida",
        tipo: "INGRESO",
        modo: "FORMULA",
        formula: "jornal_diario * ",
        clave_formulas: CLAVE_FORMULAS,
      });
    expect(r.status).toBe(400);
  });

  it("rechaza poner formula/clave en un concepto que NO es personalizado (ej. GRATIFICACION)", async () => {
    const r = await request(app)
      .put("/api/conceptos/formula/GRATIFICACION")
      .set(auth())
      .send({ formula: "jornal_diario * 2", clave_formulas: CLAVE_FORMULAS });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no es personalizado/i);
  });
});

describe("Concepto personalizado con formula: calculo, persistencia y efecto en bases de aportes", () => {
  const CODIGO = "PLUS_PRODUCTIVIDAD_TEST";

  it("crea el concepto con una formula valida (jornal_diario * 0.1)", async () => {
    const r = await request(app)
      .post("/api/conceptos/formula")
      .set(auth())
      .send({
        codigo: CODIGO,
        nombre: "Plus de productividad (prueba)",
        tipo: "INGRESO",
        modo: "FORMULA",
        formula: "jornal_diario * 0.1",
        afecto_essalud: true,
        clave_formulas: CLAVE_FORMULAS,
      });
    expect(r.status).toBe(201);
    expect(r.body.concepto.es_personalizado).toBe(true);
    expect(r.body.concepto.formula).toBe("jornal_diario * 0.1");
    expect(r.body.concepto.activo).toBe(true);
  });

  it("al calcular el periodo, el monto correcto queda en detalle_planilla_conceptos (PEON: jornal 62.80 x 0.1 = 6.28)", async () => {
    const tareo = await request(app)
      .put(`/api/periodos/${periodoId}/tareo`)
      .set(auth())
      .send({
        contrato_id: contratoId,
        dias_trabajados: 24,
        dias_dominical: 0,
        dias_feriado: 0,
        dias_falta: 0,
        horas_extra_25: 0,
        horas_extra_35: 0,
        horas_extra_100: 0,
      });
    expect(tareo.status).toBe(204);

    await calcular();
    const detalle = await obtenerDetalle();
    const conceptos = await obtenerConceptosPersonalizados(detalle.id);
    const fila = conceptos.find((c) => c.concepto_codigo === CODIGO);
    expect(fila).toBeDefined();
    expect(Number(fila!.monto)).toBeCloseTo(6.28, 2);
  });

  it("afecto_essalud=true: el monto del concepto personalizado SI entra a la base de EsSalud", async () => {
    const detalleConFormula = await obtenerDetalle();
    const essaludConFormula = Number(detalleConFormula.essalud);

    // NOTA (recon 15/46): la prueba original reabria el periodo primero
    // (POST /:id/reabrir, "Ronda 1") antes de recalcular - esa ruta no
    // existe todavia en este punto de la reconstruccion (gap conocido, sin
    // parche fuente disponible). No hace falta aqui: POST /:id/calcular en
    // nuestro arbol no exige estado ABIERTO, simplemente recalcula.
    const desactivar = await request(app)
      .put(`/api/conceptos/formula/${CODIGO}`)
      .set(auth())
      .send({ activo: false, clave_formulas: CLAVE_FORMULAS });
    expect(desactivar.status).toBe(200);

    await calcular();
    const detalleSinFormula = await obtenerDetalle();
    const essaludSinFormula = Number(detalleSinFormula.essalud);

    // La diferencia debe ser aprox. 6.28 * 9% = 0.5652 (tolerancia por
    // redondeo independiente de cada base).
    expect(essaludConFormula - essaludSinFormula).toBeCloseTo(0.57, 1);

    // Reactiva el concepto y vuelve a calcular, para dejar el estado listo
    // para la prueba siguiente (PLAME).
    const reactivar = await request(app)
      .put(`/api/conceptos/formula/${CODIGO}`)
      .set(auth())
      .send({ activo: true, clave_formulas: CLAVE_FORMULAS });
    expect(reactivar.status).toBe(200);
    await calcular();
  });

  // NOTA (recon 15/46): prueba "aparece en el asiento contable..." omitida
  // aqui - depende de src/asientoContable.ts, que no existe todavia (ver
  // nota al inicio del archivo).

  it("aparece en el PLAME/REM cuando tiene codigo_plame configurado", async () => {
    const editar = await request(app)
      .put(`/api/conceptos/formula/${CODIGO}`)
      .set(auth())
      .send({ codigo_plame: "0899", clave_formulas: CLAVE_FORMULAS });
    expect(editar.status).toBe(200);
    expect(editar.body.codigo_plame).toBe("0899");

    const lineas = await generarLineasREM(periodoId);
    const lineaDelConcepto = lineas.find((l) => l.includes("|77790301|0899|"));
    expect(lineaDelConcepto).toBeDefined();
    expect(lineaDelConcepto).toContain("6.28");
  });

  it("no se puede eliminar un concepto ya usado en un calculo (hay que desactivarlo)", async () => {
    const r = await request(app)
      .delete(`/api/conceptos/formula/${CODIGO}`)
      .set(auth())
      .send({ clave_formulas: CLAVE_FORMULAS });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/ya se uso/i);
  });
});

describe("Vigencia por mes calendario (vigente_hasta en el pasado respecto al periodo calculado)", () => {
  const CODIGO = "CONCEPTO_DEROGADO_TEST";

  it("un concepto con vigente_hasta anterior al mes del periodo NO se aplica, aunque este activo", async () => {
    const crear = await request(app)
      .post("/api/conceptos/formula")
      .set(auth())
      .send({
        codigo: CODIGO,
        nombre: "Concepto ya derogado (prueba)",
        tipo: "INGRESO",
        modo: "FORMULA",
        formula: "jornal_diario * 0.05",
        vigente_hasta: "2026-01-31", // el periodo de prueba es febrero-2026
        clave_formulas: CLAVE_FORMULAS,
      });
    expect(crear.status).toBe(201);

    // NOTA (recon 15/46): ver nota anterior sobre POST /:id/reabrir (no
    // existe todavia) - se recalcula directo.
    await calcular();

    const detalle = await obtenerDetalle();
    const conceptos = await obtenerConceptosPersonalizados(detalle.id);
    expect(conceptos.find((c) => c.concepto_codigo === CODIGO)).toBeUndefined();
  });
});

describe("Anexo 22 SUNAT: aviso (no bloqueante) de posible concepto duplicado", () => {
  it("advierte cuando el nombre se parece a un concepto ya existente en el catalogo del sistema", async () => {
    const r = await request(app)
      .post("/api/conceptos/formula")
      .set(auth())
      .send({
        codigo: "SUELDO_EXTRA_DUPTEST",
        nombre: "Sueldo Jornal basico extra",
        tipo: "INGRESO",
        modo: "FORMULA",
        formula: "jornal_diario * 0.01",
        clave_formulas: CLAVE_FORMULAS,
      });
    expect(r.status).toBe(201);
    expect(r.body.avisos_duplicado.length).toBeGreaterThan(0);
    expect(r.body.avisos_duplicado.some((a: { fuente: string }) => a.fuente === "CONCEPTO_EXISTENTE")).toBe(true);
  });
});

describe("Modo PROGRAMACION_INTERNA: concepto visible pero inactivo hasta que un desarrollador lo implemente", () => {
  it("crea el concepto sin formula, en estado PENDIENTE_DESARROLLO e inactivo", async () => {
    const r = await request(app)
      .post("/api/conceptos/formula")
      .set(auth())
      .send({
        codigo: "PENDIENTE_DESARROLLO_TEST",
        nombre: "Concepto pendiente de desarrollo (prueba)",
        tipo: "DESCUENTO",
        modo: "PROGRAMACION_INTERNA",
        clave_formulas: CLAVE_FORMULAS,
      });
    expect(r.status).toBe(201);
    expect(r.body.concepto.formula).toBeNull();
    expect(r.body.concepto.estado).toBe("PENDIENTE_DESARROLLO");
    expect(r.body.concepto.activo).toBe(false);
  });
});
