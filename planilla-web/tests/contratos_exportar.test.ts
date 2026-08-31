// Pruebas de las descargas de Excel/PDF del listado de trabajadores
// (ver routes/contratos.ts: /contratos/exportar/excel y /exportar/pdf).
// Usan la misma app y base de datos de pruebas que autorizacion.test.ts.
import request from "supertest";
import ExcelJS from "exceljs";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let empleadoHabilId: number;
let empleadoCesadoId: number;

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const eHabil = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '99990020', 'PRUEBA EXPORTAR HABIL', 0) RETURNING id`
  );
  empleadoHabilId = eHabil.rows[0].id;
  await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Exportar', 'PEON', 'ONP', '2026-01-01', 'HABIL')`,
    [empleadoHabilId]
  );

  const eCesado = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '99990021', 'PRUEBA EXPORTAR CESADO', 0) RETURNING id`
  );
  empleadoCesadoId = eCesado.rows[0].id;
  await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, fecha_cese, estado, motivo_baja_codigo)
     VALUES ($1, 'Proyecto Exportar', 'PEON', 'ONP', '2025-01-01', '2025-06-30', 'CESADO', '01')`,
    [empleadoCesadoId]
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM contratos WHERE empleado_id IN ($1,$2)", [empleadoHabilId, empleadoCesadoId]);
  await pool.query("DELETE FROM empleados WHERE id IN ($1,$2)", [empleadoHabilId, empleadoCesadoId]);
  await pool.end();
});

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

describe("GET /api/contratos/exportar/excel", () => {
  it("exporta solo los HABIL cuando estado=HABIL", async () => {
    const r = await descargarBuffer("/api/contratos/exportar/excel?estado=HABIL&q=PRUEBA%20EXPORTAR");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("spreadsheetml.sheet");

    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(r.body as any);
    const hoja = workbook.getWorksheet("Trabajadores")!;
    const dnis: string[] = [];
    hoja.eachRow((fila, numero) => {
      if (numero === 1) return;
      dnis.push(String(fila.getCell(1).value));
    });
    expect(dnis).toContain("99990020");
    expect(dnis).not.toContain("99990021");
  });

  it("exporta solo los CESADO cuando estado=CESADO, con fecha de cese y motivo", async () => {
    const r = await descargarBuffer("/api/contratos/exportar/excel?estado=CESADO&q=PRUEBA%20EXPORTAR");
    expect(r.status).toBe(200);

    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(r.body as any);
    const hoja = workbook.getWorksheet("Trabajadores")!;
    const fila2 = hoja.getRow(2);
    expect(String(fila2.getCell(1).value)).toBe("99990021");
    expect(fila2.getCell(7).value).toBe("2025-06-30"); // Fecha cese
    expect(fila2.getCell(9).value).toBe("RENUNCIA"); // Motivo de baja (nombre, no codigo)
  });
});

describe("GET /api/contratos/exportar/pdf", () => {
  it("descarga un PDF con el listado filtrado", async () => {
    const r = await descargarBuffer("/api/contratos/exportar/pdf?estado=CESADO&q=PRUEBA%20EXPORTAR");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.body.length).toBeGreaterThan(500);
    expect(r.body.slice(0, 4).toString()).toBe("%PDF");
  });

  it("requiere sesion activa (sin token -> 401)", async () => {
    const r = await request(app).get("/api/contratos/exportar/pdf");
    expect(r.status).toBe(401);
  });
});
