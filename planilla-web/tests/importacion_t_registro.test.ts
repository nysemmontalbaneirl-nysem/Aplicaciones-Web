// Pruebas de la carga masiva (POST /api/empleados/importar-masivo) con las
// columnas T-Registro (SUNAT) nuevas agregadas en esta sesion. Usan la
// misma app y base de datos de pruebas que autorizacion.test.ts (ver
// tests/globalSetup.ts).
import request from "supertest";
import ExcelJS from "exceljs";
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
  await pool.query(
    "DELETE FROM contratos WHERE empleado_id IN (SELECT id FROM empleados WHERE numero_documento IN ('99990001','99990002'))"
  );
  await pool.query("DELETE FROM empleados WHERE numero_documento IN ('99990001','99990002')");
  await pool.end();
});

const ENCABEZADO =
  "DNI,APELLIDOS_NOMBRES,PROYECTO,CATEGORIA,SISTEMA_PENSION,FECHA_INGRESO,ESTADO," +
  "SEXO,ESTADO_CIVIL,NACIONALIDAD_CODIGO,GRADO_INSTRUCCION_CODIGO,ENTIDAD_BANCARIA_CODIGO," +
  "UBIGEO_DEPARTAMENTO_CODIGO,UBIGEO_PROVINCIA_CODIGO,UBIGEO_DISTRITO_CODIGO," +
  "CATEGORIA_OCUPACIONAL_SUNAT_CODIGO,TIPO_CONTRATO_CODIGO,REGIMEN_SALUD_CODIGO,EPS_CODIGO";

function filaValida(dni: string): string {
  return [
    dni, "PRUEBA IMPORTACION SUNAT", "Proyecto A", "PEON", "ONP", "2026-03-01", "HABIL",
    "M", "SOLTERO", "9589", "01", "002",
    "19", "1903", "190307",
    "02", "09", "01", "20431115825",
  ].join(",");
}

describe("POST /api/empleados/importar-masivo con columnas T-Registro (SUNAT)", () => {
  it("crea un empleado y contrato con los codigos SUNAT del CSV", async () => {
    const csv = `${ENCABEZADO}\n${filaValida("99990001")}\n`;

    const r = await request(app)
      .post("/api/empleados/importar-masivo")
      .set(auth())
      .attach("archivo", Buffer.from(csv, "utf-8"), "importar.csv");

    expect(r.status).toBe(200);
    expect(r.body.errores).toEqual([]);
    expect(r.body.empleados_creados).toBe(1);
    expect(r.body.contratos_creados).toBe(1);

    const empleado = await pool.query("SELECT * FROM empleados WHERE numero_documento = '99990001'");
    expect(empleado.rows[0].sexo).toBe("M");
    expect(empleado.rows[0].estado_civil).toBe("SOLTERO");
    expect(empleado.rows[0].entidad_bancaria_codigo).toBe("002");
    expect(empleado.rows[0].ubigeo_distrito_codigo).toBe("190307");
    // El texto libre historico se deriva automaticamente del catalogo
    expect(empleado.rows[0].ubigeo).toContain("PIURA");
    expect(typeof empleado.rows[0].entidad_bancaria).toBe("string");
    expect(empleado.rows[0].entidad_bancaria.length).toBeGreaterThan(0);

    const contrato = await pool.query(
      "SELECT * FROM contratos WHERE empleado_id = $1",
      [empleado.rows[0].id]
    );
    expect(contrato.rows[0].categoria_ocupacional_sunat_codigo).toBe("02");
    expect(contrato.rows[0].tipo_contrato_codigo).toBe("09");
    expect(contrato.rows[0].regimen_salud_codigo).toBe("01");
    expect(contrato.rows[0].eps_codigo).toBe("20431115825");
    // Defaults de construccion civil cuando el CSV no manda el codigo
    expect(contrato.rows[0].tipo_trabajador_codigo).toBe("27");
    expect(contrato.rows[0].regimen_laboral_codigo).toBe("21");
  });

  it("actualiza los campos SUNAT al reimportar el mismo DNI", async () => {
    // Segunda importacion del mismo DNI, con sexo y banco distintos.
    const filaActualizada = [
      "99990001", "PRUEBA IMPORTACION SUNAT", "Proyecto A", "PEON", "ONP", "2026-03-01", "HABIL",
      "F", "CASADO", "9589", "01", "003",
      "19", "1903", "190307",
      "02", "09", "01", "20431115825",
    ].join(",");
    const csv = `${ENCABEZADO}\n${filaActualizada}\n`;

    const r = await request(app)
      .post("/api/empleados/importar-masivo")
      .set(auth())
      .attach("archivo", Buffer.from(csv, "utf-8"), "importar.csv");

    expect(r.status).toBe(200);
    expect(r.body.errores).toEqual([]);
    expect(r.body.empleados_actualizados).toBe(1);
    // El contrato ya existia (mismo empleado+proyecto+fecha_ingreso), no crea uno nuevo
    expect(r.body.contratos_creados).toBe(0);

    const empleado = await pool.query("SELECT * FROM empleados WHERE numero_documento = '99990001'");
    expect(empleado.rows[0].sexo).toBe("F");
    expect(empleado.rows[0].estado_civil).toBe("CASADO");
    expect(empleado.rows[0].entidad_bancaria_codigo).toBe("003");
  });

  it("reporta un codigo de catalogo SUNAT inexistente como error de esa fila, sin detener el resto", async () => {
    const filaCodigoInvalido = [
      "99990002", "PRUEBA CODIGO INVALIDO", "Proyecto A", "PEON", "ONP", "2026-03-01", "HABIL",
      "M", "SOLTERO", "9589", "01", "999", // 999 no existe en catalogo_banco
      "19", "1903", "190307",
      "02", "09", "01", "20431115825",
    ].join(",");
    const csv = `${ENCABEZADO}\n${filaValida("99990003")}\n${filaCodigoInvalido}\n`;

    const r = await request(app)
      .post("/api/empleados/importar-masivo")
      .set(auth())
      .attach("archivo", Buffer.from(csv, "utf-8"), "importar.csv");

    expect(r.status).toBe(200);
    expect(r.body.empleados_creados).toBe(1); // solo la fila 99990003 (99990001 ya existia de antes)
    expect(r.body.errores).toHaveLength(1);
    expect(r.body.errores[0].dni).toBe("99990002");
    expect(r.body.errores[0].motivo).toMatch(/codigo de catalogo/i);

    const noCreado = await pool.query("SELECT id FROM empleados WHERE numero_documento = '99990002'");
    expect(noCreado.rowCount).toBe(0);

    await pool.query("DELETE FROM contratos WHERE empleado_id IN (SELECT id FROM empleados WHERE numero_documento = '99990003')");
    await pool.query("DELETE FROM empleados WHERE numero_documento = '99990003'");
  });
});

describe("GET /api/empleados/importar-masivo/plantilla.xlsx", () => {
  it("descarga un Excel con la hoja Trabajadores y hojas de referencia de catalogos", async () => {
    const r = await request(app)
      .get("/api/empleados/importar-masivo/plantilla.xlsx")
      .set(auth())
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("spreadsheetml.sheet");

    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(r.body as any);

    const nombresHojas = workbook.worksheets.map((h) => h.name);
    expect(nombresHojas).toContain("Trabajadores");
    expect(nombresHojas).toContain("Banco");
    expect(nombresHojas).toContain("UbigeoDistrito");

    const hojaTrabajadores = workbook.getWorksheet("Trabajadores")!;
    const encabezados = (hojaTrabajadores.getRow(1).values as unknown[]).filter(Boolean);
    expect(encabezados).toContain("DNI");
    expect(encabezados).toContain("ENTIDAD_BANCARIA_CODIGO");
    expect(encabezados).toContain("UBIGEO_DISTRITO_CODIGO");

    const hojaBanco = workbook.getWorksheet("Banco")!;
    expect(hojaBanco.rowCount).toBeGreaterThan(1); // encabezado + al menos un banco

    // Fila 2 = fila de ejemplo (no un trabajador real) con codigos SUNAT
    // validos, para mostrar el formato esperado en cada columna. Una vez
    // releido desde el buffer, ExcelJS ya no conoce las "keys" de columna
    // (eran solo para escribir), asi que se ubica por el numero de columna
    // segun el texto del encabezado en la fila 1.
    const columnaPorNombre = new Map<string, number>();
    hojaTrabajadores.getRow(1).eachCell((celda, numeroColumna) => {
      columnaPorNombre.set(String(celda.value), numeroColumna);
    });
    const filaEjemplo = hojaTrabajadores.getRow(2);
    expect(filaEjemplo.getCell(columnaPorNombre.get("DNI")!).value).toBe("00000000");
    expect(filaEjemplo.getCell(columnaPorNombre.get("ENTIDAD_BANCARIA_CODIGO")!).value).toBe("002");
    expect(filaEjemplo.getCell(columnaPorNombre.get("UBIGEO_DISTRITO_CODIGO")!).value).toBe("190307");
  });

  it("requiere sesion activa (sin token -> 401)", async () => {
    const r = await request(app).get("/api/empleados/importar-masivo/plantilla.xlsx");
    expect(r.status).toBe(401);
  });
});
