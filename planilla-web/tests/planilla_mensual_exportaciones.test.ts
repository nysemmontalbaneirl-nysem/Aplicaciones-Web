// Pruebas de las exportaciones "mensuales" de la Planilla Mensual
// Consolidada (Ronda E): generarLineasREMMensual (plame.ts) y
// generarCSVAFPnetMensual (afpnet.ts). Ambas son un refactor de las
// funciones ya existentes por periodo de pago (generarLineasREM/
// generarCSVAFPnet), que ahora comparten la logica de formato/acumulacion
// (construirLineasREM/construirCSVAFPnet) y solo difieren en de que tabla
// leen (detalle_planilla_mensual en vez de detalle_planilla). Este archivo
// verifica que el cableado nuevo (SQL, columnas) funciona de punta a punta
// contra una consolidacion real - la logica de calculo en si ya esta
// cubierta por plame.test.ts/afpnet.test.ts (no se repite aqui).
//
// NOTA (recon 19/46): el parche original tambien probaba
// generarAsientoContableMensual (asientoContable.ts) aqui - se omite porque
// ese modulo no existe en este arbol (ver RECONSTRUCCION_BRECHAS.md punto 5,
// ya confirmado ausente antes en el patch 15/46).
import { pool } from "../src/db";
import { consolidarPlanillaMensual } from "../src/planillaMensual";
import { generarLineasREMMensual } from "../src/plame";
import { generarCSVAFPnetMensual } from "../src/afpnet";

const PROYECTO = "Proyecto B"; // ya sembrado por globalSetup.ts (distinto del usado en planilla_mensual_consolidada.test.ts)
const JORNAL_PEON_SET_2026 = 68.0;

let adminUserId: number;
const empleadosCreados: number[] = [];
const periodosCreados: number[] = [];
let planillaMensualId: number;

beforeAll(async () => {
  const idResult = await pool.query("SELECT id FROM usuarios WHERE correo = 'admin@prueba.local'");
  adminUserId = idResult.rows[0].id as number;

  await pool.query(
    `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
     VALUES (2026, 9, 'PEON', $1, 0.30, 0, 8.60, 12.98)
     ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`,
    [JORNAL_PEON_SET_2026]
  );
  await pool.query(
    `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
     VALUES (2026, 9, 'INTEGRA', 0.0155, 0.0137, 0.10)
     ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`
  );

  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES (2026, 9, 1, 'QUINCENAL', '2026-09-01', '2026-09-15', 15, $1) RETURNING id`,
    [PROYECTO]
  );
  const periodoId = p.rows[0].id as number;
  periodosCreados.push(periodoId);

  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '88881001', 'PRUEBA EXPORTACION MENSUAL AFP', 0) RETURNING id`
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, afp_nombre, cuspp, fecha_ingreso, estado)
     VALUES ($1, $2, 'PEON', 'AFP', 'INTEGRA', 'CUSPP-TEST-001', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId, PROYECTO]
  );
  const contratoId = c.rows[0].id as number;

  const dias = ["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-08", "2026-09-09", "2026-09-10"].map(
    (fecha) => `('${fecha}', ${periodoId}, ${contratoId}, 8, 0)`
  );
  await pool.query(
    `INSERT INTO tareo_diario (fecha, periodo_id, contrato_id, horas_normales, minutos_normales) VALUES ${dias.join(", ")}`
  );

  const resultado = await consolidarPlanillaMensual(PROYECTO, 2026, 9, adminUserId);
  expect(resultado.errores).toEqual([]);
  expect(resultado.trabajadores_consolidados).toBe(1);
  planillaMensualId = resultado.planilla_mensual_id;
});

const ALCANCE = { anio: 2026, mes: 9, proyecto: PROYECTO };

afterAll(async () => {
  await pool.query("DELETE FROM detalle_planilla_mensual WHERE planilla_mensual_id = $1", [planillaMensualId]);
  await pool.query("DELETE FROM planilla_mensual WHERE proyecto = $1 AND anio = 2026 AND mes = 9", [PROYECTO]);
  for (const periodoId of periodosCreados) {
    await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [periodoId]);
    await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [id]);
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2026 AND mes = 9 AND categoria = 'PEON'");
  await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = 2026 AND mes = 9");
  await pool.end();
});

describe("generarLineasREMMensual", () => {
  it("genera lineas .rem a partir de detalle_planilla_mensual (mismo formato que generarLineasREM por periodo)", async () => {
    const lineas = await generarLineasREMMensual(ALCANCE);
    expect(lineas.length).toBeGreaterThan(0);
    // Cada linea sigue el formato TIPO|DNI|CODIGO|DEVENGADO|PERCIBIDO|
    for (const linea of lineas) {
      expect(linea).toMatch(/^01\|88881001\|\d{3,4}\|\d+\.\d{2}\|\d+\.\d{2}\|$/);
    }
    // El sueldo basico (0121) debe estar presente con un monto > 0 (7 dias trabajados).
    const lineaSueldo = lineas.find((l) => l.includes("|0121|"));
    expect(lineaSueldo).toBeDefined();
  });
});

describe("generarCSVAFPnetMensual", () => {
  it("genera el CSV de aportes AFP a partir de detalle_planilla_mensual, con encabezado y 1 fila (contrato AFP)", async () => {
    const csv = await generarCSVAFPnetMensual(ALCANCE);
    const filas = csv.split("\n");
    expect(filas[0]).toBe(
      "DNI,Apellidos y nombres,CUSPP,AFP,Proyecto,Remuneracion afecta,Aporte obligatorio,Comision,Prima de seguro,Total aporte AFP"
    );
    expect(filas).toHaveLength(2);
    expect(filas[1]).toContain("88881001");
    expect(filas[1]).toContain("CUSPP-TEST-001");
    expect(filas[1]).toContain("INTEGRA");
  });

  it("una planilla mensual de otro proyecto, sin trabajadores consolidados, da solo el encabezado", async () => {
    const otroProyecto = "Proyecto Sin Consolidar EXPORTACIONES-TEST";
    await pool.query(
      `INSERT INTO planilla_mensual (proyecto, anio, mes, calculado_en, calculado_por)
       VALUES ($1, 2026, 9, now(), $2)`,
      [otroProyecto, adminUserId]
    );
    const csv = await generarCSVAFPnetMensual({ anio: 2026, mes: 9, proyecto: otroProyecto });
    const filas = csv.split("\n");
    expect(filas).toHaveLength(1); // solo el encabezado
    await pool.query("DELETE FROM planilla_mensual WHERE proyecto = $1 AND anio = 2026 AND mes = 9", [otroProyecto]);
  });
});
