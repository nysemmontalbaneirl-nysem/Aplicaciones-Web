// Pruebas de 2 correcciones de seguridad/acceso encontradas en una revision
// posterior a la migracion 048 (ver RECONSTRUCCION_BRECHAS.md, seccion 30 y
// su addendum de correcciones):
//
// 1) PUT /:id/marcaciones/:importacionId/detalle/:detalleId nunca validaba
//    que el usuario tuviera acceso al proyecto del contrato de esa fila -
//    un usuario limitado a un proyecto podia confirmar/retirar el pago de
//    la "llegada anticipada" (cambiando el monto de horas extra) de un
//    contrato de OTRO proyecto, con solo conocer/adivinar el :detalleId.
//
// 2) GET /:id/marcaciones y GET /:id/marcaciones/:importacionId devolvian
//    "errores_json" completo, sin filtrar por proyecto - a diferencia de
//    "detalle", que si se filtra. Si quien importo el archivo fue un ADMIN
//    (alcance de TODA la empresa), esa lista de errores puede mencionar
//    DNIs/proyectos de contratos que un usuario limitado a un solo proyecto
//    no deberia poder ver.
//
// Reutiliza los proyectos/usuarios/contratos ya sembrados en globalSetup.ts:
// "Proyecto A" (DNI 10000001, responsable-a@prueba.local / tareador-a@prueba.local
// solo ven este proyecto) y "Proyecto B" (DNI 10000002, responsable-b@prueba.local
// solo ve este proyecto).
import request from "supertest";
import ExcelJS from "exceljs";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let tokenResponsableA: string;
let tokenResponsableB: string;
let periodoProyectoAId: number;

function authAdmin() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}
function authResponsableA() {
  return { Authorization: `Bearer ${tokenResponsableA}` };
}
function authResponsableB() {
  return { Authorization: `Bearer ${tokenResponsableB}` };
}

async function armarXlsx(encabezado: string[], filas: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Marcaciones");
  hoja.addRow(encabezado);
  for (const fila of filas) hoja.addRow(fila);
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

beforeAll(async () => {
  const rAdmin = await request(app).post("/api/auth/login").send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = rAdmin.body.token as string;
  const rA = await request(app)
    .post("/api/auth/login")
    .send({ correo: "responsable-a@prueba.local", password: CLAVE_PRUEBA });
  tokenResponsableA = rA.body.token as string;
  const rB = await request(app)
    .post("/api/auth/login")
    .send({ correo: "responsable-b@prueba.local", password: CLAVE_PRUEBA });
  tokenResponsableB = rB.body.token as string;

  const periodo = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, quincena, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES (2026, 8, 'QUINCENAL', 1, '2026-08-01', '2026-08-15', 15, 'Proyecto A') RETURNING id`
  );
  periodoProyectoAId = periodo.rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM importaciones_marcaciones_detalle WHERE importacion_id IN (SELECT id FROM importaciones_marcaciones WHERE periodo_id = $1)", [periodoProyectoAId]);
  await pool.query("DELETE FROM importaciones_marcaciones WHERE periodo_id = $1", [periodoProyectoAId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoProyectoAId]);
  await pool.end();
});

describe("Importacion de marcaciones - control de acceso por proyecto", () => {
  let importacionId: number;
  let detalleIdProyectoA: number;

  it("ADMIN importa un archivo con un DNI de Proyecto A (valido) y uno de Proyecto B (invalido para este periodo)", async () => {
    const archivo = await armarXlsx(
      ["DNI", "PROYECTO", "NOMBRE", "FECHA", "HORA", "TIPO"],
      [
        ["10000001", "Proyecto A", "TRABAJADOR PROYECTO A", "2026-08-03", "08:00", "ENTRADA"],
        ["10000001", "Proyecto A", "TRABAJADOR PROYECTO A", "2026-08-03", "17:00", "SALIDA"],
        ["10000002", "Proyecto B", "TRABAJADOR PROYECTO B", "2026-08-03", "08:00", "ENTRADA"],
        ["10000002", "Proyecto B", "TRABAJADOR PROYECTO B", "2026-08-03", "17:00", "SALIDA"],
      ]
    );

    const r = await request(app)
      .post(`/api/periodos/${periodoProyectoAId}/marcaciones/importar`)
      .set(authAdmin())
      .attach("archivo", archivo, "marcaciones.xlsx");

    expect(r.status).toBe(201);
    expect(r.body.errores.length).toBeGreaterThanOrEqual(1);
    const errorProyectoB = r.body.errores.find((e: { dni: string }) => e.dni === "10000002");
    expect(errorProyectoB).toBeDefined();
    expect(errorProyectoB.motivo).toMatch(/Proyecto B/);

    const listado = await pool.query(
      "SELECT id FROM importaciones_marcaciones WHERE periodo_id = $1 ORDER BY id DESC LIMIT 1",
      [periodoProyectoAId]
    );
    importacionId = listado.rows[0].id;

    const detalle = await pool.query(
      `SELECT d.id FROM importaciones_marcaciones_detalle d
       JOIN contratos c ON c.id = d.contrato_id
       WHERE d.importacion_id = $1 AND c.proyecto = 'Proyecto A'`,
      [importacionId]
    );
    detalleIdProyectoA = detalle.rows[0].id;
  });

  it("responsable-b (solo Proyecto B) SI ve el error de su propio proyecto en la lista", async () => {
    const r = await request(app)
      .get(`/api/periodos/${periodoProyectoAId}/marcaciones/${importacionId}`)
      .set(authResponsableB());
    expect(r.status).toBe(200);
    const errorProyectoB = r.body.importacion.errores.find((e: { dni: string }) => e.dni === "10000002");
    expect(errorProyectoB).toBeDefined();
  });

  it("responsable-a (solo Proyecto A) NO ve el error del DNI de Proyecto B en el detalle de la importacion", async () => {
    const r = await request(app)
      .get(`/api/periodos/${periodoProyectoAId}/marcaciones/${importacionId}`)
      .set(authResponsableA());
    expect(r.status).toBe(200);
    const errorProyectoB = r.body.importacion.errores.find((e: { dni: string }) => e.dni === "10000002");
    expect(errorProyectoB).toBeUndefined();
  });

  it("responsable-a (solo Proyecto A) NO ve el error del DNI de Proyecto B en el listado de importaciones", async () => {
    const r = await request(app).get(`/api/periodos/${periodoProyectoAId}/marcaciones`).set(authResponsableA());
    expect(r.status).toBe(200);
    const cabecera = r.body.find((c: { id: number }) => c.id === importacionId);
    expect(cabecera).toBeDefined();
    const errorProyectoB = cabecera.errores.find((e: { dni: string }) => e.dni === "10000002");
    expect(errorProyectoB).toBeUndefined();
  });

  it("ADMIN sigue viendo la lista de errores completa, sin filtrar", async () => {
    const r = await request(app)
      .get(`/api/periodos/${periodoProyectoAId}/marcaciones/${importacionId}`)
      .set(authAdmin());
    expect(r.status).toBe(200);
    const errorProyectoB = r.body.importacion.errores.find((e: { dni: string }) => e.dni === "10000002");
    expect(errorProyectoB).toBeDefined();
  });

  it("PUT detalle: responsable-b (sin acceso a Proyecto A) recibe 403 al intentar editar una fila de Proyecto A", async () => {
    const r = await request(app)
      .put(`/api/periodos/${periodoProyectoAId}/marcaciones/${importacionId}/detalle/${detalleIdProyectoA}`)
      .set(authResponsableB())
      .send({ anticipacion_pagada: true });
    expect(r.status).toBe(403);
  });

  it("PUT detalle: responsable-a (con acceso a Proyecto A) SI puede editar esa misma fila", async () => {
    const r = await request(app)
      .put(`/api/periodos/${periodoProyectoAId}/marcaciones/${importacionId}/detalle/${detalleIdProyectoA}`)
      .set(authResponsableA())
      .send({ anticipacion_pagada: true });
    expect(r.status).toBe(200);
    expect(r.body.anticipacion_pagada).toBe(true);
  });
});
