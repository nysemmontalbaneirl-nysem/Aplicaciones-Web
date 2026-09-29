// Pruebas de las 3 mejoras visuales/de impresion pedidas por el usuario
// (sept. 2026):
// 1) Horas extra por tramo (60%/100% en construccion civil, 25%/35%/100%
//    en regimen general), mostradas igual que "Dias trabajados" -> ver
//    camposHorasExtra en src/boletaPdf.ts.
// 2) Fecha de cese en la boleta, si el trabajador ceso.
// 3) Exportar/descargar en PDF las boletas seleccionadas o de un periodo
//    completo (un solo PDF, una boleta por pagina), y en ZIP (un PDF por
//    trabajador) - GET /api/periodos/:id/boletas/pdf y .../boletas/zip.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";
import { camposHorasExtra } from "../src/boletaPdf";

describe("camposHorasExtra (unidad)", () => {
  it("construccion civil (PEON): fusiona horas_extra_35 y horas_extra_100 en una sola cifra 100%", () => {
    const campos = camposHorasExtra({
      categoria_ocupacional: "PEON",
      horas_extra_25: 2,
      horas_extra_35: 1,
      horas_extra_100: 3,
    });
    expect(campos).toEqual([
      ["Horas extra 60%", "2"],
      ["Horas extra 100%", "4"],
    ]);
  });

  it("regimen general (EMPLEADO): muestra los 3 tramos por separado (25%/35%/100%)", () => {
    const campos = camposHorasExtra({
      categoria_ocupacional: "EMPLEADO",
      horas_extra_25: 2,
      horas_extra_35: 1,
      horas_extra_100: 3,
    });
    expect(campos).toEqual([
      ["Horas extra 25%", "2"],
      ["Horas extra 35%", "1"],
      ["Horas extra 100%", "3"],
    ]);
  });

  it("convierte valores que llegan como texto desde Postgres (columnas NUMERIC)", () => {
    const campos = camposHorasExtra({
      categoria_ocupacional: "OPERARIO",
      horas_extra_25: "2.50" as unknown as number,
      horas_extra_35: "0" as unknown as number,
      horas_extra_100: "1.50" as unknown as number,
    });
    expect(campos).toEqual([
      ["Horas extra 60%", "2.5"],
      ["Horas extra 100%", "1.5"],
    ]);
  });
});

let tokenAdmin: string;
let tokenTareador: string;
let proyectoId: number;
const empleadosCreados: number[] = [];
let contratoActivoId: number;
let contratoCesadoId: number;
let periodoId: number;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// Mismo patron ya usado en tests/asiento_contable.test.ts: sin esto,
// supertest no junta el cuerpo binario (PDF/ZIP) en un solo Buffer legible
// via response.body.
async function descargarBuffer(ruta: string, token: string) {
  return request(app)
    .get(ruta)
    .set(auth(token))
    .buffer()
    .parse((res, callback) => {
      const trozos: Buffer[] = [];
      res.on("data", (trozo: Buffer) => trozos.push(trozo));
      res.on("end", () => callback(null, Buffer.concat(trozos)));
    });
}

function contarPaginasPdf(pdf: Buffer): number {
  const texto = pdf.toString("latin1");
  return (texto.match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

function contarArchivosZip(zip: Buffer): number {
  const firma = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // firma de cabecera local "PK\x03\x04"
  let contador = 0;
  let indice = 0;
  while ((indice = zip.indexOf(firma, indice)) !== -1) {
    contador++;
    indice += firma.length;
  }
  return contador;
}

beforeAll(async () => {
  const rAdmin = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = rAdmin.body.token as string;

  const rTareador = await request(app)
    .post("/api/auth/login")
    .send({ correo: "tareador-a@prueba.local", password: CLAVE_PRUEBA });
  tokenTareador = rTareador.body.token as string;

  const proy = await pool.query(
    `INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Exportar Boletas', 'Lima') RETURNING id`
  );
  proyectoId = proy.rows[0].id;

  const e1 = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '77793001', 'PRUEBA EXPORTAR BOLETAS ACTIVO', 0) RETURNING id`
  );
  empleadosCreados.push(e1.rows[0].id);
  const c1 = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Exportar Boletas', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [e1.rows[0].id]
  );
  contratoActivoId = c1.rows[0].id;

  const e2 = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '77793002', 'PRUEBA EXPORTAR BOLETAS CESADO', 0) RETURNING id`
  );
  empleadosCreados.push(e2.rows[0].id);
  const c2 = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, fecha_cese, estado)
     VALUES ($1, 'Proyecto Exportar Boletas', 'OFICIAL', 'ONP', '2026-01-01', '2026-02-20', 'CESADO') RETURNING id`,
    [e2.rows[0].id]
  );
  contratoCesadoId = c2.rows[0].id;

  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
     VALUES (2026, 2, 'MENSUAL', '2026-02-01', '2026-02-28', 28) RETURNING id`
  );
  periodoId = p.rows[0].id;

  for (const contratoId of [contratoActivoId, contratoCesadoId]) {
    const editar = await request(app)
      .put(`/api/periodos/${periodoId}/tareo`)
      .set(auth(tokenAdmin))
      .send({
        contrato_id: contratoId,
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

  const calcular = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth(tokenAdmin)).send({});
  expect(calcular.status).toBe(200);
  expect(calcular.body.errores).toEqual([]);
});

afterAll(async () => {
  await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [id]);
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM proyectos WHERE id = $1", [proyectoId]);
  await pool.end();
});

describe("GET /api/periodos/:id/boletas/pdf", () => {
  it("sin ids, exporta un solo PDF con TODAS las boletas del periodo (2), una por pagina", async () => {
    const r = await descargarBuffer(`/api/periodos/${periodoId}/boletas/pdf`, tokenAdmin);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    const pdf = r.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(contarPaginasPdf(pdf)).toBe(2);
  });

  it("con ids, exporta solo la boleta seleccionada (1 pagina)", async () => {
    const listado = await request(app)
      .get(`/api/periodos/${periodoId}/planilla`)
      .set(auth(tokenAdmin));
    expect(listado.status).toBe(200);
    const idBoleta = listado.body.detalle.find(
      (d: { contrato_id: number }) => d.contrato_id === contratoActivoId
    ).id;

    const r = await descargarBuffer(`/api/periodos/${periodoId}/boletas/pdf?ids=${idBoleta}`, tokenAdmin);
    expect(r.status).toBe(200);
    const pdf = r.body as Buffer;
    expect(contarPaginasPdf(pdf)).toBe(1);
  });

  it("con ids que no existen en este periodo, responde 400 (no hay nada que exportar)", async () => {
    const r = await request(app)
      .get(`/api/periodos/${periodoId}/boletas/pdf?ids=999999999`)
      .set(auth(tokenAdmin));
    expect(r.status).toBe(400);
  });

  it("un usuario sin permiso boletas.ver recibe 403", async () => {
    const r = await request(app).get(`/api/periodos/${periodoId}/boletas/pdf`).set(auth(tokenTareador));
    expect(r.status).toBe(403);
  });
});

describe("GET /api/periodos/:id/boletas/zip", () => {
  it("sin ids, exporta un ZIP con UN PDF POR TRABAJADOR (2 archivos)", async () => {
    const r = await descargarBuffer(`/api/periodos/${periodoId}/boletas/zip`, tokenAdmin);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/zip");
    const zip = r.body as Buffer;
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    expect(contarArchivosZip(zip)).toBe(2);
  });

  it("con ids, exporta un ZIP con solo la boleta seleccionada (1 archivo)", async () => {
    const listado = await request(app)
      .get(`/api/periodos/${periodoId}/planilla`)
      .set(auth(tokenAdmin));
    const idBoleta = listado.body.detalle.find(
      (d: { contrato_id: number }) => d.contrato_id === contratoCesadoId
    ).id;

    const r = await descargarBuffer(`/api/periodos/${periodoId}/boletas/zip?ids=${idBoleta}`, tokenAdmin);
    expect(r.status).toBe(200);
    expect(contarArchivosZip(r.body as Buffer)).toBe(1);
  });
});

describe("Fecha de cese en el listado de boletas", () => {
  it("GET /api/periodos/:id/planilla incluye fecha_cese (null para activos, con valor para cesados)", async () => {
    const listado = await request(app)
      .get(`/api/periodos/${periodoId}/planilla`)
      .set(auth(tokenAdmin));
    expect(listado.status).toBe(200);
    const activo = listado.body.detalle.find((d: { contrato_id: number }) => d.contrato_id === contratoActivoId);
    const cesado = listado.body.detalle.find((d: { contrato_id: number }) => d.contrato_id === contratoCesadoId);
    expect(activo.fecha_cese).toBeNull();
    expect(String(cesado.fecha_cese).slice(0, 10)).toBe("2026-02-20");
  });
});
