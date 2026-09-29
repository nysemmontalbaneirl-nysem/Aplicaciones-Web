// Pruebas de la actualizacion masiva de apellido paterno/materno/nombres
// (migracion 042, 21/09/2026): el usuario pidio una forma de completar estos
// 3 campos (agregados en la migracion 041 para el archivo oficial de
// AFPnet) para trabajadores QUE YA EXISTEN, subiendo un Excel con el DNI y
// esos 3 campos - sin tener que repetir CATEGORIA/SISTEMA_PENSION/etc. como
// exigiria reutilizar "importar-masivo" (ver src/routes/importacion.ts).
import request from "supertest";
import ExcelJS from "exceljs";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;

const DNI_CON_DATOS_COMPLETOS = "99990060"; // no deberia aparecer en la plantilla precargada
const DNI_A_COMPLETAR = "99990061";
const DNI_INEXISTENTE = "99990062"; // nunca se crea - para probar el error de fila

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  if (r.status !== 200) {
    throw new Error(`No se pudo iniciar sesion como admin: ${r.status} ${JSON.stringify(r.body)}`);
  }
  tokenAdmin = r.body.token as string;

  await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos, apellido_paterno, apellido_materno, nombres)
     VALUES ('01', $1, 'PRUEBA DATOS YA COMPLETOS', 0, 'YA', 'TENGO', 'DATOS')`,
    [DNI_CON_DATOS_COMPLETOS]
  );
  await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('01', $1, 'PRUEBA A COMPLETAR JUAN PEREZ', 0)`,
    [DNI_A_COMPLETAR]
  );
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM contratos WHERE empleado_id IN (SELECT id FROM empleados WHERE numero_documento IN ($1, $2, $3))",
    [DNI_CON_DATOS_COMPLETOS, DNI_A_COMPLETAR, DNI_INEXISTENTE]
  );
  await pool.query("DELETE FROM empleados WHERE numero_documento IN ($1, $2, $3)", [
    DNI_CON_DATOS_COMPLETOS,
    DNI_A_COMPLETAR,
    DNI_INEXISTENTE,
  ]);
  await pool.end();
});

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

/** Arma un .xlsx en memoria con encabezado + filas, para subirlo como si fuera la plantilla ya llenada. */
async function armarXlsx(encabezado: string[], filas: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Trabajadores a completar");
  hoja.addRow(encabezado);
  for (const fila of filas) hoja.addRow(fila);
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

const ENCABEZADO = ["DNI", "APELLIDO_PATERNO", "APELLIDO_MATERNO", "NOMBRES"];

describe("GET /api/empleados/actualizar-nombres-afpnet/plantilla.xlsx", () => {
  it("precarga a los trabajadores con algun dato faltante, y NO a los que ya tienen todo completo", async () => {
    const r = await request(app)
      .get("/api/empleados/actualizar-nombres-afpnet/plantilla.xlsx")
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
    const hoja = workbook.getWorksheet("Trabajadores a completar")!;
    const dnis: string[] = [];
    hoja.eachRow((fila, numeroFila) => {
      if (numeroFila === 1) return;
      dnis.push(fila.getCell(1).text.trim());
    });
    expect(dnis).toContain(DNI_A_COMPLETAR);
    expect(dnis).not.toContain(DNI_CON_DATOS_COMPLETOS);
  });

  it("sin sesion -> 401", async () => {
    const r = await request(app).get("/api/empleados/actualizar-nombres-afpnet/plantilla.xlsx");
    expect(r.status).toBe(401);
  });
});

describe("POST /api/empleados/actualizar-nombres-afpnet", () => {
  it("completa apellido paterno/materno/nombres de un trabajador ya existente (por DNI)", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [[DNI_A_COMPLETAR, "PEREZ", "GOMEZ", "JUAN CARLOS"]]);

    const r = await request(app)
      .post("/api/empleados/actualizar-nombres-afpnet")
      .set(auth())
      .attach("archivo", xlsx, "nombres.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.actualizados).toBe(1);
    expect(r.body.errores).toEqual([]);

    const fila = await pool.query(
      "SELECT apellido_paterno, apellido_materno, nombres FROM empleados WHERE numero_documento = $1",
      [DNI_A_COMPLETAR]
    );
    expect(fila.rows[0]).toEqual({ apellido_paterno: "PEREZ", apellido_materno: "GOMEZ", nombres: "JUAN CARLOS" });
  });

  it("una celda vacia NUNCA borra un dato ya cargado - solo actualiza lo que la fila trae", async () => {
    // Solo trae APELLIDO_PATERNO (distinto al ya guardado); MATERNO y
    // NOMBRES vienen vacios - deben quedar EXACTAMENTE igual que antes.
    const xlsx = await armarXlsx(ENCABEZADO, [[DNI_A_COMPLETAR, "PEREZ CORREGIDO", "", ""]]);

    const r = await request(app)
      .post("/api/empleados/actualizar-nombres-afpnet")
      .set(auth())
      .attach("archivo", xlsx, "nombres.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.actualizados).toBe(1);

    const fila = await pool.query(
      "SELECT apellido_paterno, apellido_materno, nombres FROM empleados WHERE numero_documento = $1",
      [DNI_A_COMPLETAR]
    );
    expect(fila.rows[0]).toEqual({
      apellido_paterno: "PEREZ CORREGIDO",
      apellido_materno: "GOMEZ", // sin cambios (de la prueba anterior)
      nombres: "JUAN CARLOS", // sin cambios (de la prueba anterior)
    });
  });

  it("DNI que no existe en el sistema -> se reporta como fila con error, sin crear un trabajador nuevo", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [[DNI_INEXISTENTE, "APELLIDO", "MATERNO", "NOMBRE"]]);

    const r = await request(app)
      .post("/api/empleados/actualizar-nombres-afpnet")
      .set(auth())
      .attach("archivo", xlsx, "nombres.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.actualizados).toBe(0);
    expect(r.body.errores).toHaveLength(1);
    expect(r.body.errores[0].dni).toBe(DNI_INEXISTENTE);
    expect(r.body.errores[0].motivo).toMatch(/no existe/i);

    const fila = await pool.query("SELECT 1 FROM empleados WHERE numero_documento = $1", [DNI_INEXISTENTE]);
    expect(fila.rowCount).toBe(0);
  });

  it("fila en blanco (sin DNI ni datos) se ignora en silencio, no cuenta como error", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [
      [DNI_A_COMPLETAR, "PEREZ", "GOMEZ", "JUAN CARLOS"],
      ["", "", "", ""],
    ]);

    const r = await request(app)
      .post("/api/empleados/actualizar-nombres-afpnet")
      .set(auth())
      .attach("archivo", xlsx, "nombres.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.actualizados).toBe(1);
    expect(r.body.errores).toEqual([]);
  });

  it("falta la columna APELLIDO_MATERNO -> 400 explicando cual falta", async () => {
    const xlsx = await armarXlsx(["DNI", "APELLIDO_PATERNO", "NOMBRES"], [[DNI_A_COMPLETAR, "PEREZ", "JUAN"]]);

    const r = await request(app)
      .post("/api/empleados/actualizar-nombres-afpnet")
      .set(auth())
      .attach("archivo", xlsx, "nombres.xlsx");

    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/APELLIDO_MATERNO/);
  });

  it("sin archivo -> 400", async () => {
    const r = await request(app).post("/api/empleados/actualizar-nombres-afpnet").set(auth());
    expect(r.status).toBe(400);
  });

  it("sin sesion -> 401", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [[DNI_A_COMPLETAR, "PEREZ", "GOMEZ", "JUAN"]]);
    const r = await request(app).post("/api/empleados/actualizar-nombres-afpnet").attach("archivo", xlsx, "nombres.xlsx");
    expect(r.status).toBe(401);
  });
});
