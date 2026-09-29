// Pruebas de la migracion 049 (brecha #4.1 + #5 de RECONSTRUCCION_BRECHAS.md):
// catalogo de Aportes y retenciones (conceptos_aportes), Plan de Cuentas
// (plan_cuentas), Mapeo Contable (mapeo_cuentas_contables) y el Asiento
// Contable consolidado (src/asientoContable.ts) que los junta.
//
// Se inserta directo en detalle_planilla (en vez de correr todo el motor de
// calculo) para poder elegir montos exactos y verificar que el asiento
// cuadre (Debe == Haber) con numeros conocidos.
import request from "supertest";
import ExcelJS from "exceljs";
import { app } from "../src/app";
import { pool } from "../src/db";
import { generarAsientoContable } from "../src/asientoContable";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let proyectoId: number;
let periodoId: number;
let contratoOnpId: number;
let contratoAfpId: number;
const empleadosCreados: number[] = [];
const contratosCreados: number[] = [];
const cuentasCreadas: number[] = [];

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

async function descargarBuffer(ruta: string) {
  return request(app)
    .get(ruta)
    .set(auth())
    .buffer()
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
}

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const proy = await pool.query(`INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Asiento Contable', 'Lima') RETURNING id`);
  proyectoId = proy.rows[0].id as number;

  const periodo = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES (2026, 5, 'MENSUAL', '2026-05-01', '2026-05-31', 30, 'Proyecto Asiento Contable') RETURNING id`
  );
  periodoId = periodo.rows[0].id as number;

  const eOnp = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres) VALUES ('1', '77793001', 'PRUEBA ASIENTO ONP') RETURNING id`
  );
  empleadosCreados.push(eOnp.rows[0].id);
  const cOnp = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Asiento Contable', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [eOnp.rows[0].id]
  );
  contratoOnpId = cOnp.rows[0].id as number;
  contratosCreados.push(contratoOnpId);

  const eAfp = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres) VALUES ('1', '77793002', 'PRUEBA ASIENTO AFP') RETURNING id`
  );
  empleadosCreados.push(eAfp.rows[0].id);
  const cAfp = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, afp_nombre, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Asiento Contable', 'PEON', 'AFP', 'INTEGRA', '2026-01-01', 'HABIL') RETURNING id`,
    [eAfp.rows[0].id]
  );
  contratoAfpId = cAfp.rows[0].id as number;
  contratosCreados.push(contratoAfpId);

  // Montos elegidos para que Debe == Haber en CADA contrato por separado
  // (sueldo_basico + essalud == essalud + aporte_pension + neto_pagar):
  //   ONP:  1000 + 90  = 90  + 130 + 870  -> 1090 == 1090
  //   AFP:  2000 + 180 = 180 + 250 + 1750 -> 2180 == 2180
  await pool.query(
    `INSERT INTO detalle_planilla (periodo_id, contrato_id, sueldo_basico, essalud, aporte_pension, neto_pagar)
     VALUES ($1, $2, 1000, 90, 130, 870)`,
    [periodoId, contratoOnpId]
  );
  await pool.query(
    `INSERT INTO detalle_planilla (periodo_id, contrato_id, sueldo_basico, essalud, aporte_pension, neto_pagar)
     VALUES ($1, $2, 2000, 180, 250, 1750)`,
    [periodoId, contratoAfpId]
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM mapeo_cuentas_contables WHERE proyecto_id = $1", [proyectoId]);
  for (const id of cuentasCreadas) {
    await pool.query("DELETE FROM plan_cuentas WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoId]);
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

describe("Catalogo de aportes y retenciones (GET/PUT /api/conceptos/aportes)", () => {
  it("trae el catalogo sembrado por la migracion 049 (16 filas), incluyendo ESSALUD y NETO_A_PAGAR", async () => {
    const r = await request(app).get("/api/conceptos/aportes").set(auth());
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThanOrEqual(16);
    const essalud = r.body.find((a: { codigo: string }) => a.codigo === "ESSALUD");
    expect(essalud).toBeDefined();
    expect(essalud.tipo_movimiento).not.toBe("HABER"); // requiere Debe Y Haber (ver movimientosDeAporte)
    expect(essalud.tipo_movimiento).not.toBe("DEBE");
    const netoAPagar = r.body.find((a: { codigo: string }) => a.codigo === "NETO_A_PAGAR");
    expect(netoAPagar.tipo_movimiento).toBe("HABER");
  });

  it("edita nombre/descripcion/codigo_plame de un aporte, pero no permite tocar tipo_movimiento/orden (no vienen en el body soportado)", async () => {
    const r = await request(app)
      .put("/api/conceptos/aportes/CONAFOVICER")
      .set(auth())
      .send({ codigo_plame: "0699" });
    expect(r.status).toBe(200);
    expect(r.body.codigo_plame).toBe("0699");

    // lo deja como estaba, para no afectar otras pruebas (plame.ts) que
    // dependen del codigo_plame original de CONAFOVICER.
    const revertir = await request(app).put("/api/conceptos/aportes/CONAFOVICER").set(auth()).send({ codigo_plame: "0602" });
    expect(revertir.status).toBe(200);
    expect(revertir.body.codigo_plame).toBe("0602");
  });

  it("404 si el codigo de aporte no existe", async () => {
    const r = await request(app).put("/api/conceptos/aportes/NO_EXISTE").set(auth()).send({ nombre: "x" });
    expect(r.status).toBe(404);
  });
});

describe("Plan de cuentas (GET/POST/PUT /api/conceptos/plan-cuentas)", () => {
  it("agrega una cuenta nueva y la puede editar despues", async () => {
    const crear = await request(app)
      .post("/api/conceptos/plan-cuentas")
      .set(auth())
      .send({ codigo: "999999", denominacion: "Cuenta de prueba" });
    expect(crear.status).toBe(201);
    expect(crear.body.activa).toBe(true);
    cuentasCreadas.push(crear.body.id);

    const editar = await request(app)
      .put(`/api/conceptos/plan-cuentas/${crear.body.id}`)
      .set(auth())
      .send({ denominacion: "Cuenta de prueba (editada)", activa: false });
    expect(editar.status).toBe(200);
    expect(editar.body.denominacion).toBe("Cuenta de prueba (editada)");
    expect(editar.body.activa).toBe(false);
  });

  it("permite 2 cuentas con el mismo codigo pero distinta denominacion (no hay UNIQUE de codigo)", async () => {
    const a = await request(app).post("/api/conceptos/plan-cuentas").set(auth()).send({ codigo: "700001", denominacion: "Denominacion A" });
    const b = await request(app).post("/api/conceptos/plan-cuentas").set(auth()).send({ codigo: "700001", denominacion: "Denominacion B" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    cuentasCreadas.push(a.body.id, b.body.id);
  });

  it("400 si falta el codigo o la denominacion", async () => {
    const r = await request(app).post("/api/conceptos/plan-cuentas").set(auth()).send({ denominacion: "Sin codigo" });
    expect(r.status).toBe(400);
  });
});

describe("Asiento Contable: sin mapeo configurado, reporta 'faltantes' y no genera ninguna linea", () => {
  it("generarAsientoContable reporta un faltante por cada concepto/proyecto/movimiento sin cuenta configurada", async () => {
    const resultado = await generarAsientoContable(periodoId);
    expect(resultado.lineas).toEqual([]);
    expect(resultado.totalDebe).toBe(0);
    expect(resultado.totalHaber).toBe(0);

    const claves = resultado.faltantes.map((f) => `${f.concepto_codigo}|${f.tipo_movimiento}`);
    expect(claves).toEqual(
      expect.arrayContaining(["SUELDO_BASICO|DEBE", "ESSALUD|DEBE", "ESSALUD|HABER", "ONP|HABER", "AFP_INTEGRA|HABER", "NETO_A_PAGAR|HABER"])
    );
    expect(resultado.faltantes.every((f) => f.proyecto_nombre === "Proyecto Asiento Contable")).toBe(true);
  });

  it("GET /exportar/asiento-contable responde 400 con la lista de faltantes en vez de un Excel", async () => {
    const r = await request(app).get(`/api/periodos/${periodoId}/exportar/asiento-contable`).set(auth());
    expect(r.status).toBe(400);
    expect(Array.isArray(r.body.faltantes)).toBe(true);
    expect(r.body.faltantes.length).toBeGreaterThan(0);
  });
});

describe("Asiento Contable: con el mapeo configurado, genera un asiento cuadrado (Debe == Haber)", () => {
  const cuentaIdPorCodigo: Record<string, number> = {};

  beforeAll(async () => {
    const cuentasNecesarias: [string, string][] = [
      ["10001", "Remuneraciones por pagar"],
      ["62001", "EsSalud - gasto"],
      ["40101", "EsSalud por pagar"],
      ["40301", "ONP por pagar"],
      ["40302", "AFP Integra por pagar"],
      ["41001", "Remuneraciones por pagar (neto)"],
    ];
    for (const [codigo, denominacion] of cuentasNecesarias) {
      const r = await pool.query(`INSERT INTO plan_cuentas (codigo, denominacion) VALUES ($1, $2) RETURNING id`, [codigo, denominacion]);
      cuentaIdPorCodigo[codigo] = r.rows[0].id;
      cuentasCreadas.push(r.rows[0].id);
    }

    const entradas = [
      { concepto_codigo: "SUELDO_BASICO", proyecto_id: proyectoId, tipo_movimiento: "DEBE", cuenta_id: cuentaIdPorCodigo["10001"] },
      { concepto_codigo: "ESSALUD", proyecto_id: proyectoId, tipo_movimiento: "DEBE", cuenta_id: cuentaIdPorCodigo["62001"] },
      { concepto_codigo: "ESSALUD", proyecto_id: proyectoId, tipo_movimiento: "HABER", cuenta_id: cuentaIdPorCodigo["40101"] },
      { concepto_codigo: "ONP", proyecto_id: proyectoId, tipo_movimiento: "HABER", cuenta_id: cuentaIdPorCodigo["40301"] },
      { concepto_codigo: "AFP_INTEGRA", proyecto_id: proyectoId, tipo_movimiento: "HABER", cuenta_id: cuentaIdPorCodigo["40302"] },
      { concepto_codigo: "NETO_A_PAGAR", proyecto_id: proyectoId, tipo_movimiento: "HABER", cuenta_id: cuentaIdPorCodigo["41001"] },
    ];
    const r = await request(app).put("/api/conceptos/mapeo-contable").set(auth()).send({ entradas });
    expect(r.status).toBe(200);
  });

  it("400 si concepto_codigo/proyecto_id/tipo_movimiento/cuenta_id no son validos", async () => {
    const r = await request(app)
      .put("/api/conceptos/mapeo-contable")
      .set(auth())
      .send({ entradas: [{ concepto_codigo: "NO_EXISTE", proyecto_id: proyectoId, tipo_movimiento: "DEBE", cuenta_id: cuentaIdPorCodigo["10001"] }] });
    expect(r.status).toBe(400);
  });

  it("generarAsientoContable ya no reporta faltantes y el asiento cuadra (Debe == Haber)", async () => {
    const resultado = await generarAsientoContable(periodoId);
    expect(resultado.faltantes).toEqual([]);
    expect(resultado.totalDebe).toBe(resultado.totalHaber);
    // DEBE: (1000+90) del contrato ONP + (2000+180) del contrato AFP.
    expect(resultado.totalDebe).toBe(3270);

    const lineaSueldo = resultado.lineas.find((l) => l.CODIGO === "10001");
    expect(lineaSueldo).toBeDefined();
    expect(lineaSueldo!.D_H).toBe("D");
    expect(lineaSueldo!.IMPORTE).toBe(3000); // 1000 + 2000, un solo proyecto acumula ambos contratos
    expect(lineaSueldo!.DETALLE).toContain("Proyecto Asiento Contable");

    const lineaEssaludDebe = resultado.lineas.find((l) => l.CODIGO === "62001");
    expect(lineaEssaludDebe!.IMPORTE).toBe(270); // 90 + 180
    const lineaEssaludHaber = resultado.lineas.find((l) => l.CODIGO === "40101");
    expect(lineaEssaludHaber!.IMPORTE).toBe(270);

    const lineaOnp = resultado.lineas.find((l) => l.CODIGO === "40301");
    expect(lineaOnp!.IMPORTE).toBe(130);
    const lineaAfp = resultado.lineas.find((l) => l.CODIGO === "40302");
    expect(lineaAfp!.IMPORTE).toBe(250);

    const lineaNeto = resultado.lineas.find((l) => l.CODIGO === "41001");
    expect(lineaNeto!.IMPORTE).toBe(870 + 1750);
  });

  it("GET /exportar/asiento-contable ahora descarga un Excel con esas mismas lineas", async () => {
    const r = await descargarBuffer(`/api/periodos/${periodoId}/exportar/asiento-contable`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("spreadsheetml.sheet");

    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(r.body as any);
    const hoja = workbook.worksheets[0];
    const encabezado = hoja.getRow(1).values as unknown[];
    expect(encabezado).toContain("CODIGO");
    expect(encabezado).toContain("IMPORTE");

    let sumaDebe = 0;
    let sumaHaber = 0;
    hoja.eachRow((fila, numero) => {
      if (numero === 1) return;
      const dh = fila.getCell(2).value as string;
      const importe = Number(fila.getCell(4).value);
      if (dh === "D") sumaDebe += importe;
      else sumaHaber += importe;
    });
    expect(sumaDebe).toBe(3270);
    expect(sumaHaber).toBe(3270);
  });
});
