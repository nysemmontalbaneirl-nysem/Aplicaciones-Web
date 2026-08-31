// Pruebas de las descargas de Excel/PDF del listado de boletas de un
// periodo (ver routes/planilla.ts: /periodos/:id/planilla/excel y /pdf).
// Usan la misma app y base de datos de pruebas que autorizacion.test.ts.
import request from "supertest";
import ExcelJS from "exceljs";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let empleadoId: number;
let contratoId: number;
let periodoId: number;

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '99990030', 'PRUEBA EXPORTAR PLANILLA', 0) RETURNING id`
  );
  empleadoId = e.rows[0].id;
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Planilla', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId]
  );
  contratoId = c.rows[0].id;

  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo, estado)
     VALUES (2026, 5, 'MENSUAL', '2026-05-01', '2026-05-31', 31, 'CALCULADO') RETURNING id`
  );
  periodoId = p.rows[0].id;

  await pool.query(
    `INSERT INTO detalle_planilla (periodo_id, contrato_id, total_ingresos, total_descuentos, neto_pagar, detalle_json)
     VALUES ($1, $2, 1500.00, 200.00, 1300.00, $3::jsonb)`,
    [periodoId, contratoId, JSON.stringify({ total_aportes_empleador: 145.5 })]
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  await pool.query("DELETE FROM contratos WHERE id = $1", [contratoId]);
  await pool.query("DELETE FROM empleados WHERE id = $1", [empleadoId]);
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

describe("GET /api/periodos/:id/planilla/excel", () => {
  it("incluye el total de aportes del empleador (no solo ingresos/descuentos/neto)", async () => {
    const r = await descargarBuffer(`/api/periodos/${periodoId}/planilla/excel`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("spreadsheetml.sheet");

    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(r.body as any);
    const hoja = workbook.worksheets[0];
    const fila2 = hoja.getRow(2);
    expect(String(fila2.getCell(1).value)).toBe("99990030");
    expect(Number(fila2.getCell(7).value)).toBeCloseTo(145.5); // Total aportes
    expect(Number(fila2.getCell(8).value)).toBeCloseTo(1300.0); // Neto a pagar

    const filaTotales = hoja.getRow(3);
    expect(Number(filaTotales.getCell(7).value)).toBeCloseTo(145.5);
  });

  it("respeta el filtro de busqueda (q)", async () => {
    const r = await descargarBuffer(`/api/periodos/${periodoId}/planilla/excel?q=NOEXISTE`);
    expect(r.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(r.body as any);
    const hoja = workbook.worksheets[0];
    // Sin coincidencias: solo el encabezado y la fila de totales (en cero)
    expect(hoja.rowCount).toBe(2);
    expect(Number(hoja.getRow(2).getCell(5).value)).toBe(0);
  });
});

describe("GET /api/periodos/:id/planilla/pdf", () => {
  it("descarga un PDF valido", async () => {
    const r = await descargarBuffer(`/api/periodos/${periodoId}/planilla/pdf`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.body.slice(0, 4).toString()).toBe("%PDF");
  });

  it("404 si el periodo no existe", async () => {
    const r = await request(app).get("/api/periodos/999999/planilla/pdf").set(auth());
    expect(r.status).toBe(404);
  });
});
