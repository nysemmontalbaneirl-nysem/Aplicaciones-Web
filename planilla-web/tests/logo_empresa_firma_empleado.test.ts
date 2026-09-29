// Pruebas de la migracion 031: logo de la empresa (pantalla Empresa) +
// firma escaneada del trabajador (pantalla Trabajadores), pedido explicito
// del usuario para que ambos aparezcan en la Boleta y en los reportes.
// Mismo patron BYTEA que el certificado de Tareo Diario (migracion 021):
// se sube por multipart, se sirve como imagen cruda (no JSON) y se puede
// quitar - ver tests/tareo_diario.test.ts para el precedente.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let tokenResponsableA: string;
let tokenResponsableB: string;
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

// Mismo PNG minimo de 1x1 pixel que ya usa tests/tareo_diario.test.ts.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function crearContrato(dni: string, nombre: string, proyecto = "Proyecto A"): Promise<{ empleadoId: number; contratoId: number }> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, 0) RETURNING id`,
    [dni, nombre]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, $2, 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId, proyecto]
  );
  const contratoId = c.rows[0].id as number;
  contratosCreados.push(contratoId);
  return { empleadoId, contratoId };
}

beforeAll(async () => {
  const rAdmin = await request(app).post("/api/auth/login").send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = rAdmin.body.token as string;
  const rA = await request(app).post("/api/auth/login").send({ correo: "responsable-a@prueba.local", password: CLAVE_PRUEBA });
  tokenResponsableA = rA.body.token as string;
  const rB = await request(app).post("/api/auth/login").send({ correo: "responsable-b@prueba.local", password: CLAVE_PRUEBA });
  tokenResponsableB = rB.body.token as string;
});

afterAll(async () => {
  // Deja los datos de la empresa como estaban (sin logo/firma del empleador
  // y sin representante_legal) para no afectar otras pruebas/entornos que
  // reutilicen esta misma base de datos de prueba.
  await pool.query(
    `UPDATE datos_empresa SET
       logo_archivo = NULL, logo_mime = NULL, logo_nombre = NULL,
       firma_empleador_archivo = NULL, firma_empleador_mime = NULL, firma_empleador_nombre = NULL,
       representante_legal = NULL`
  );
  for (const id of contratosCreados) {
    await pool.query("DELETE FROM contratos WHERE id = $1", [id]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.end();
});

describe("Logo de la empresa (GET/POST/DELETE /api/empresa/logo)", () => {
  it("GET /api/empresa no incluye logo_archivo (bytea) en el JSON, solo metadata + tiene_logo", async () => {
    const r = await request(app).get("/api/empresa").set(authAdmin());
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty("logo_archivo");
    expect(r.body).toHaveProperty("tiene_logo");
  });

  it("sube, ve y quita el logo de la empresa", async () => {
    const subida = await request(app)
      .post("/api/empresa/logo")
      .set(authAdmin())
      .attach("archivo", PNG_1X1, "logo.png");
    expect(subida.status).toBe(204);

    const datos = await request(app).get("/api/empresa").set(authAdmin());
    expect(datos.body.tiene_logo).toBe(true);
    expect(datos.body.logo_nombre).toBe("logo.png");

    const imagen = await request(app).get("/api/empresa/logo").set(authAdmin());
    expect(imagen.status).toBe(200);
    expect(imagen.headers["content-type"]).toBe("image/png");
    expect((imagen.body as Buffer).equals(PNG_1X1)).toBe(true);

    const quitar = await request(app).delete("/api/empresa/logo").set(authAdmin());
    expect(quitar.status).toBe(204);

    const despues = await request(app).get("/api/empresa/logo").set(authAdmin());
    expect(despues.status).toBe(404);
  });

  it("rechaza un archivo que no sea JPG/PNG/WEBP", async () => {
    const r = await request(app)
      .post("/api/empresa/logo")
      .set(authAdmin())
      .attach("archivo", Buffer.from("no es una imagen"), { filename: "logo.txt", contentType: "text/plain" });
    expect(r.status).toBe(400);
  });

  it("guardar los datos de la empresa (PUT /api/empresa) no borra el logo ya subido", async () => {
    await request(app).post("/api/empresa/logo").set(authAdmin()).attach("archivo", PNG_1X1, "logo.png");

    const actual = await request(app).get("/api/empresa").set(authAdmin());
    const r = await request(app)
      .put("/api/empresa")
      .set(authAdmin())
      .send({ ...actual.body, razon_social: "NYSEM EIRL (prueba logo)" });
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty("logo_archivo");
    expect(r.body.tiene_logo).toBe(true);

    const sigueTeniendo = await request(app).get("/api/empresa/logo").set(authAdmin());
    expect(sigueTeniendo.status).toBe(200);

    await request(app).delete("/api/empresa/logo").set(authAdmin());
  });
});

describe("Firma del EMPLEADOR (GET/POST/DELETE /api/empresa/firma-empleador) - pedido adicional del usuario", () => {
  it("GET /api/empresa no incluye firma_empleador_archivo (bytea) en el JSON, solo metadata + tiene_firma_empleador", async () => {
    const r = await request(app).get("/api/empresa").set(authAdmin());
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty("firma_empleador_archivo");
    expect(r.body).toHaveProperty("tiene_firma_empleador");
  });

  it("sube, ve y quita la firma del empleador", async () => {
    const subida = await request(app)
      .post("/api/empresa/firma-empleador")
      .set(authAdmin())
      .attach("archivo", PNG_1X1, "firma-empleador.png");
    expect(subida.status).toBe(204);

    const datos = await request(app).get("/api/empresa").set(authAdmin());
    expect(datos.body.tiene_firma_empleador).toBe(true);
    expect(datos.body.firma_empleador_nombre).toBe("firma-empleador.png");

    const imagen = await request(app).get("/api/empresa/firma-empleador").set(authAdmin());
    expect(imagen.status).toBe(200);
    expect((imagen.body as Buffer).equals(PNG_1X1)).toBe(true);

    const quitar = await request(app).delete("/api/empresa/firma-empleador").set(authAdmin());
    expect(quitar.status).toBe(204);

    const despues = await request(app).get("/api/empresa/firma-empleador").set(authAdmin());
    expect(despues.status).toBe(404);
  });

  it("guardar el nombre del representante legal (PUT /api/empresa) se refleja en el GET", async () => {
    const actual = await request(app).get("/api/empresa").set(authAdmin());
    const r = await request(app)
      .put("/api/empresa")
      .set(authAdmin())
      .send({ ...actual.body, representante_legal: "MONTALBAN SANCHEZ CARLOS" });
    expect(r.status).toBe(200);
    expect(r.body.representante_legal).toBe("MONTALBAN SANCHEZ CARLOS");

    const relectura = await request(app).get("/api/empresa").set(authAdmin());
    expect(relectura.body.representante_legal).toBe("MONTALBAN SANCHEZ CARLOS");
  });
});

describe("Firma escaneada del trabajador (GET/POST/DELETE /api/empleados/:id/firma)", () => {
  it("GET /api/empleados y /api/empleados/:id no incluyen firma_archivo (bytea), solo metadata + tiene_firma", async () => {
    const { empleadoId } = await crearContrato("77790001", "PRUEBA FIRMA LISTADO");
    const listado = await request(app).get("/api/empleados").set(authAdmin());
    const fila = listado.body.find((e: { id: number }) => e.id === empleadoId);
    expect(fila).toBeTruthy();
    expect(fila).not.toHaveProperty("firma_archivo");
    expect(fila.tiene_firma).toBe(false);

    const uno = await request(app).get(`/api/empleados/${empleadoId}`).set(authAdmin());
    expect(uno.body).not.toHaveProperty("firma_archivo");
  });

  it("sube, ve y quita la firma de un trabajador", async () => {
    const { empleadoId } = await crearContrato("77790002", "PRUEBA FIRMA OK");

    const subida = await request(app)
      .post(`/api/empleados/${empleadoId}/firma`)
      .set(authAdmin())
      .attach("archivo", PNG_1X1, "firma.png");
    expect(subida.status).toBe(204);

    const uno = await request(app).get(`/api/empleados/${empleadoId}`).set(authAdmin());
    expect(uno.body.tiene_firma).toBe(true);
    expect(uno.body.firma_nombre).toBe("firma.png");

    const imagen = await request(app).get(`/api/empleados/${empleadoId}/firma`).set(authAdmin());
    expect(imagen.status).toBe(200);
    expect((imagen.body as Buffer).equals(PNG_1X1)).toBe(true);

    const quitar = await request(app).delete(`/api/empleados/${empleadoId}/firma`).set(authAdmin());
    expect(quitar.status).toBe(204);

    const despues = await request(app).get(`/api/empleados/${empleadoId}/firma`).set(authAdmin());
    expect(despues.status).toBe(404);
  });

  it("404 al subir/ver/quitar la firma de un empleado inexistente", async () => {
    const subida = await request(app)
      .post("/api/empleados/999999/firma")
      .set(authAdmin())
      .attach("archivo", PNG_1X1, "firma.png");
    expect(subida.status).toBe(404);

    const ver = await request(app).get("/api/empleados/999999/firma").set(authAdmin());
    expect(ver.status).toBe(404);
  });

  it("actualizar los datos del empleado (PUT /api/empleados/:id) no borra la firma ya subida", async () => {
    const { empleadoId } = await crearContrato("77790003", "PRUEBA FIRMA PUT");
    await request(app).post(`/api/empleados/${empleadoId}/firma`).set(authAdmin()).attach("archivo", PNG_1X1, "firma.png");

    const r = await request(app)
      .put(`/api/empleados/${empleadoId}`)
      .set(authAdmin())
      .send({ apellidos_nombres: "PRUEBA FIRMA PUT (editado)", sexo: "M", estado_civil: "SOLTERO" });
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty("firma_archivo");
    expect(r.body.tiene_firma).toBe(true);
  });
});

describe("GET /api/contratos/:id/firma (usado por la Boleta en pantalla, que solo conoce el contrato_id)", () => {
  it("sirve la firma del empleado dueño del contrato, respetando el acceso por proyecto", async () => {
    const { empleadoId, contratoId } = await crearContrato("77790004", "PRUEBA FIRMA CONTRATO", "Proyecto A");
    await request(app).post(`/api/empleados/${empleadoId}/firma`).set(authAdmin()).attach("archivo", PNG_1X1, "firma.png");

    const comoAdmin = await request(app).get(`/api/contratos/${contratoId}/firma`).set(authAdmin());
    expect(comoAdmin.status).toBe(200);
    expect((comoAdmin.body as Buffer).equals(PNG_1X1)).toBe(true);

    const comoResponsableA = await request(app).get(`/api/contratos/${contratoId}/firma`).set(authResponsableA());
    expect(comoResponsableA.status).toBe(200);

    const comoResponsableB = await request(app).get(`/api/contratos/${contratoId}/firma`).set(authResponsableB());
    expect(comoResponsableB.status).toBe(403);
  });

  it("404 si el contrato no existe, o si el empleado todavia no tiene firma", async () => {
    const { contratoId } = await crearContrato("77790005", "PRUEBA SIN FIRMA");
    const sinFirma = await request(app).get(`/api/contratos/${contratoId}/firma`).set(authAdmin());
    expect(sinFirma.status).toBe(404);

    const inexistente = await request(app).get("/api/contratos/999999/firma").set(authAdmin());
    expect(inexistente.status).toBe(404);
  });
});
