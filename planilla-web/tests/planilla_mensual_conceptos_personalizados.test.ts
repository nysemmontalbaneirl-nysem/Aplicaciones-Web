// Pruebas de la migracion 037: "Planilla Mensual Consolidada" (Ronda E) no
// volvia a leer los conceptos PERSONALIZADOS (formula propia, Ronda D) que
// SI guardaba al consolidar - se insertaban en detalle_planilla_conceptos_mensual
// (ver consolidarPlanillaMensual en src/planillaMensual.ts) pero
// obtenerPlanillaMensual nunca los volvia a traer, asi que la pantalla
// "Planilla Mensual" (frontend/src/components/PlanillaMensual.tsx) los
// mostraba siempre vacios.
//
// Reportado por el usuario (CPC responsable de las declaraciones) el
// 17/09/2026: "en el reporte de la planilla consolidada no se reflejan los
// conceptos de BUC, Asignacion Escolaridad o Familiar, Movilidad, etc." - la
// causa principal de eso era que la tabla en pantalla solo mostraba Sueldo
// basico/Gratificacion/CTS (ver el fix de frontend, sin prueba automatizada
// posible desde aqui), pero de paso se encontro este segundo gap real de
// backend con los conceptos personalizados, que si se puede cubrir con una
// prueba de API.
//
// Este archivo inserta directamente en conceptos_planilla/
// detalle_planilla_conceptos_mensual (sin pasar por la clave secundaria de
// formulas ni por el motor de evaluacion, ya cubiertos en
// tests/conceptos_formula_libre.test.ts) porque lo que se quiere probar es
// solo la LECTURA de vuelta (el join que faltaba en obtenerPlanillaMensual),
// no el calculo de la formula en si.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { consolidarPlanillaMensual } from "../src/planillaMensual";
import { CLAVE_PRUEBA } from "./globalSetup";

const PROYECTO = "Proyecto Conceptos Personalizados Mensual";

let tokenAdmin: string;
let adminUserId: number;
let empleadoId: number;
let contratoId: number;
let periodoId: number;
let planillaMensualId: number;
let detalleMensualId: number;

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const idResult = await pool.query("SELECT id FROM usuarios WHERE correo = 'admin@prueba.local'");
  adminUserId = idResult.rows[0].id as number;

  await pool.query(
    `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
     VALUES (2026, 10, 'PEON', 68.0, 0.30, 0, 8.60, 12.98)
     ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`
  );
  // obtenerAfpTasas exige que exista al menos una fila para anio/mes (aunque
  // este contrato de prueba sea ONP, no AFP) - mismo requisito generico ya
  // visto en tests/afp_codigos_plame_desagregados.test.ts.
  await pool.query(
    `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
     VALUES (2026, 10, 'INTEGRA', 0.0155, 0.0137, 0.10)
     ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`
  );

  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES (2026, 10, 1, 'QUINCENAL', '2026-10-01', '2026-10-15', 15, $1) RETURNING id`,
    [PROYECTO]
  );
  periodoId = p.rows[0].id as number;

  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', '88882001', 'PRUEBA CONCEPTOS PERSONALIZADOS MENSUAL', 0) RETURNING id`
  );
  empleadoId = e.rows[0].id as number;
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, $2, 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId, PROYECTO]
  );
  contratoId = c.rows[0].id as number;

  const dias = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map(
    (fecha) => `('${fecha}', ${periodoId}, ${contratoId}, 8, 0)`
  );
  await pool.query(
    `INSERT INTO tareo_diario (fecha, periodo_id, contrato_id, horas_normales, minutos_normales) VALUES ${dias.join(", ")}`
  );

  const resultado = await consolidarPlanillaMensual(PROYECTO, 2026, 10, adminUserId);
  expect(resultado.errores).toEqual([]);
  expect(resultado.trabajadores_consolidados).toBe(1);
  planillaMensualId = resultado.planilla_mensual_id;

  const detalleResult = await pool.query(
    "SELECT id FROM detalle_planilla_mensual WHERE planilla_mensual_id = $1 AND contrato_id = $2",
    [planillaMensualId, contratoId]
  );
  detalleMensualId = detalleResult.rows[0].id as number;

  // Concepto personalizado insertado directo en BD (sin pasar por la ruta
  // protegida por la clave secundaria de formulas, ver comentario de arriba).
  await pool.query(
    `INSERT INTO conceptos_planilla (codigo, nombre, tipo, es_personalizado, orden)
     VALUES ('BONO_TEST_MENSUAL', 'Bono de prueba (personalizado)', 'INGRESO', true, 999)
     ON CONFLICT (codigo) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO detalle_planilla_conceptos_mensual (detalle_id, concepto_codigo, monto) VALUES ($1, 'BONO_TEST_MENSUAL', 55.50)`,
    [detalleMensualId]
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM detalle_planilla_conceptos_mensual WHERE detalle_id = $1", [detalleMensualId]);
  await pool.query("DELETE FROM conceptos_planilla WHERE codigo = 'BONO_TEST_MENSUAL'");
  await pool.query("DELETE FROM detalle_planilla_mensual WHERE planilla_mensual_id = $1", [planillaMensualId]);
  await pool.query("DELETE FROM planilla_mensual WHERE proyecto = $1 AND anio = 2026 AND mes = 10", [PROYECTO]);
  await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  await pool.query("DELETE FROM contratos WHERE id = $1", [contratoId]);
  await pool.query("DELETE FROM empleados WHERE id = $1", [empleadoId]);
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2026 AND mes = 10 AND categoria = 'PEON'");
  await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = 2026 AND mes = 10");
  await pool.end();
});

describe("GET /api/planilla-mensual incluye los conceptos personalizados guardados al consolidar", () => {
  it("trae el concepto BONO_TEST_MENSUAL con su nombre, tipo y monto (antes siempre venia vacio)", async () => {
    const r = await request(app)
      .get(`/api/planilla-mensual?proyecto=${encodeURIComponent(PROYECTO)}&anio=2026&mes=10`)
      .set(auth());
    expect(r.status).toBe(200);

    const fila = r.body.detalle.find((f: { contrato_id: number }) => f.contrato_id === contratoId);
    expect(fila).toBeDefined();
    expect(fila.conceptos_personalizados).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: "BONO_TEST_MENSUAL", nombre: "Bono de prueba (personalizado)", tipo: "INGRESO", monto: 55.5 }),
      ])
    );
  });
});
