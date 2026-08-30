// Pruebas de la migracion_016: catalogos oficiales SUNAT (T-Registro) y los
// nuevos campos de empleados/contratos/proyectos que los usan. Usan la
// misma app y base de datos de pruebas que autorizacion.test.ts (ver
// tests/globalSetup.ts, que ya aplica sql/schema.sql completo - incluye
// las tablas catalogo_* y su data semilla).
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  if (r.status !== 200) {
    throw new Error(`No se pudo iniciar sesion como admin: ${r.status} ${JSON.stringify(r.body)}`);
  }
  tokenAdmin = r.body.token as string;
});

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

afterAll(async () => {
  await pool.end();
});

describe("GET /api/catalogos", () => {
  it("devuelve los 18 catalogos con datos", async () => {
    const r = await request(app).get("/api/catalogos").set(auth());
    expect(r.status).toBe(200);

    const claves = [
      "tipo_documento", "nacionalidad", "tipo_trabajador", "grado_instruccion",
      "regimen_pensionario", "tipo_contrato", "periodicidad", "eps", "tipo_pago",
      "motivo_baja", "categoria_ocupacional_sunat", "regimen_salud", "regimen_laboral",
      "situacion_especial", "banco", "ubigeo_departamento", "ubigeo_provincia", "ubigeo_distrito",
    ];
    for (const clave of claves) {
      expect(Array.isArray(r.body[clave])).toBe(true);
      expect(r.body[clave].length).toBeGreaterThan(0);
    }
    // Peru debe estar en nacionalidad (codigo usado como default en empleados)
    expect(r.body.nacionalidad.some((n: { codigo: string }) => n.codigo === "9589")).toBe(true);
    // La jerarquia de ubigeo debe traer el codigo padre
    expect(r.body.ubigeo_provincia[0]).toHaveProperty("departamento_codigo");
    expect(r.body.ubigeo_distrito[0]).toHaveProperty("provincia_codigo");
  });

  it("requiere sesion activa (sin token -> 401)", async () => {
    const r = await request(app).get("/api/catalogos");
    expect(r.status).toBe(401);
  });
});

describe("POST/PUT /api/empleados con campos T-Registro", () => {
  it("crea un empleado con sexo/estado_civil/ubigeo/banco y sincroniza el texto libre historico", async () => {
    const r = await request(app)
      .post("/api/empleados")
      .set(auth())
      .send({
        tipo_documento: "1",
        numero_documento: "88880001",
        apellidos_nombres: "PRUEBA T-REGISTRO UNO",
        sexo: "M",
        estado_civil: "SOLTERO",
        grado_instruccion_codigo: "01",
        entidad_bancaria_codigo: "002", // BCP
        ubigeo_departamento_codigo: "19", // PIURA
        ubigeo_provincia_codigo: "1903", // HUANCABAMBA
        ubigeo_distrito_codigo: "190307", // SAN MIGUEL DE EL FAIQUE
        segunda_direccion: "AV. PRUEBA 123",
      });

    expect(r.status).toBe(201);
    expect(r.body.sexo).toBe("M");
    expect(r.body.estado_civil).toBe("SOLTERO");
    expect(r.body.entidad_bancaria_codigo).toBe("002");
    expect(r.body.nacionalidad_codigo).toBe("9589"); // default PERU
    expect(r.body.segunda_direccion).toBe("AV. PRUEBA 123");
    // El texto libre historico se deriva automaticamente del catalogo
    expect(typeof r.body.entidad_bancaria).toBe("string");
    expect(r.body.entidad_bancaria.length).toBeGreaterThan(0);
    expect(r.body.ubigeo).toContain("PIURA");

    // Limpieza: no dejar el registro de prueba en la BD compartida de tests
    await pool.query("DELETE FROM empleados WHERE numero_documento = '88880001'");
  });

  it("rechaza sexo invalido con 400", async () => {
    const r = await request(app)
      .post("/api/empleados")
      .set(auth())
      .send({
        tipo_documento: "1",
        numero_documento: "88880002",
        apellidos_nombres: "PRUEBA SEXO INVALIDO",
        sexo: "X",
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/sexo/i);
  });

  it("rechaza un codigo de catalogo inexistente con 400 (no 500)", async () => {
    const r = await request(app)
      .post("/api/empleados")
      .set(auth())
      .send({
        tipo_documento: "1",
        numero_documento: "88880003",
        apellidos_nombres: "PRUEBA CODIGO INVALIDO",
        entidad_bancaria_codigo: "999", // no existe en catalogo_banco
      });
    expect(r.status).toBe(400);
  });
});

describe("POST /api/contratos y /cese con campos T-Registro", () => {
  let empleadoId: number;
  let contratoId: number;

  beforeAll(async () => {
    const eResult = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('1', '88880010', 'PRUEBA CONTRATO T-REGISTRO', 0) RETURNING id`
    );
    empleadoId = eResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [empleadoId]);
    await pool.query("DELETE FROM empleados WHERE id = $1", [empleadoId]);
  });

  it("crea un contrato con categoria SUNAT, tipo de contrato y regimen de salud", async () => {
    const r = await request(app)
      .post("/api/contratos")
      .set(auth())
      .send({
        empleado_id: empleadoId,
        proyecto: "Proyecto A",
        categoria_ocupacional: "PEON",
        sistema_pension: "ONP",
        fecha_ingreso: "2026-03-01",
        categoria_ocupacional_sunat_codigo: "02", // Obrero
        tipo_contrato_codigo: "09", // obra determinada o servicio especifico
        regimen_salud_codigo: "01", // EsSalud + EPS
        eps_codigo: "20431115825", // PACIFICO S.A. EPS
      });

    expect(r.status).toBe(201);
    contratoId = r.body.id;
    expect(r.body.tipo_trabajador_codigo).toBe("27"); // default construccion civil
    expect(r.body.regimen_laboral_codigo).toBe("21"); // default construccion civil
    expect(r.body.categoria_ocupacional_sunat_codigo).toBe("02");
    expect(r.body.regimen_salud_codigo).toBe("01");
    expect(r.body.eps_codigo).toBe("20431115825");
  });

  it("registra el motivo de baja al cesar", async () => {
    const r = await request(app)
      .post(`/api/contratos/${contratoId}/cese`)
      .set(auth())
      .send({ fecha_cese: "2026-06-30", motivo_baja_codigo: "01" });

    expect(r.status).toBe(200);
    expect(r.body.estado).toBe("CESADO");
    expect(r.body.motivo_baja_codigo).toBe("01");
  });
});

describe("POST/PUT /api/proyectos con establecimiento SUNAT", () => {
  it("crea y actualiza un proyecto con codigo_establecimiento y tipo_establecimiento", async () => {
    const crear = await request(app)
      .post("/api/proyectos")
      .set(auth())
      .send({ nombre: "Obra de Prueba T-Registro", codigo_establecimiento: "0001", tipo_establecimiento: "DOMICILIO FISCAL" });

    expect(crear.status).toBe(201);
    expect(crear.body.codigo_establecimiento).toBe("0001");
    expect(crear.body.tipo_establecimiento).toBe("DOMICILIO FISCAL");

    const actualizar = await request(app)
      .put(`/api/proyectos/${crear.body.id}`)
      .set(auth())
      .send({ nombre: "Obra de Prueba T-Registro", codigo_establecimiento: "0002", tipo_establecimiento: "ESTABLECIMIENTO ANEXO" });

    expect(actualizar.status).toBe(200);
    expect(actualizar.body.codigo_establecimiento).toBe("0002");
    expect(actualizar.body.tipo_establecimiento).toBe("ESTABLECIMIENTO ANEXO");

    await pool.query("DELETE FROM proyectos WHERE id = $1", [crear.body.id]);
  });
});
