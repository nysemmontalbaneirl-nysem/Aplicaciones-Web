// Pruebas del "Resumen de Planilla" (src/routes/reportes.ts): 5 columnas que
// quedaban en blanco a proposito ("no calculado") en rondas anteriores, pero
// cuyo dato SI existe hoy en detalle_planilla gracias a migraciones
// posteriores (Ronda A: condicion_trabajo; migracion 030: licencia_paternidad;
// migracion 038: subsidio_enfermedad/dias_incapacidad_enfermedad ya separados
// en "Descanso Medico" y "Días Subsidiados Por Essalud"; modulo de
// compensacion vacacional de construccion civil: vacaciones). Se completaron
// el 18/09/2026 a pedido del usuario, tras revisar todos los reportes
// posteriores a la migracion 038.
//
// "Dias Vacaciones" (el CONTEO de dias, distinto de "Vacaciones" el importe)
// y "Razón: Días no laborados" siguen sin dato en el sistema - se verifica
// que sigan en blanco (regresion), no que tengan un valor.
//
// NOTA (recon 25/46): "Condición de Trabajo" (Ronda A, migracion 026) es una
// de las 5 columnas que la prueba original ya daba por completada, pero esa
// migracion (022/023/026: dominical proporcional / feriado no laborado /
// condicion_trabajo) nunca aparecio entre los 46 parches recuperados - ni la
// columna "condicion_trabajo" existe en "contratos" ni en "detalle_planilla"
// en este arbol (ver RECONSTRUCCION_BRECHAS.md, brecha #4). El codigo de
// reportes.ts ya la lee de forma defensiva (`d.condicion_trabajo ?? 0`), asi
// que simplemente da 0 en vez de fallar; aqui se adapta la prueba para
// reflejar ese estado real (columna en 0, no en 150) hasta que se reconstruya
// esa migracion.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let periodoId: number;
let proyectoId: number;
const empleadosCreados: number[] = [];
const contratosCreados: number[] = [];

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

// Indices dentro del arreglo "columnas"/cada fila del reporte (0-based) -
// confirmados contra el arreglo COLUMNAS real de src/routes/reportes.ts.
const COL = {
  DIAS_VACACIONES: 25,
  DIAS_SUBSIDIADOS_ESSALUD: 26, // dias_incapacidad_enfermedad (dia 21+)
  RAZON_DIAS_NO_LABORADOS: 27,
  SUBSIDIOS_PATERNIDAD: 28, // licencia_paternidad (importe)
  VACACIONES: 34, // compensacion vacacional (importe)
  DESCANSO_MEDICO: 37, // subsidio_enfermedad (importe, dias 1-20)
  CONDICION_TRABAJO: 49,
};

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
     VALUES (2026, 2, 'MENSUAL', '2026-02-01', '2026-02-28', 28) RETURNING id`
  );
  periodoId = p.rows[0].id as number;

  const proy = await pool.query(
    `INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Reporte Resumen', 'Lima') RETURNING id`
  );
  proyectoId = proy.rows[0].id as number;
});

afterAll(async () => {
  await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  for (const id of contratosCreados) {
    await pool.query("DELETE FROM contratos WHERE id = $1", [id]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM proyectos WHERE id = $1", [proyectoId]);
  await pool.end();
});

describe("GET /api/periodos/:id/reporte/datos: columnas completadas el 18/09/2026", () => {
  let contratoId: number;
  let fila: (string | number)[];

  it("precondicion: arma un caso PEON (construccion civil) con descanso medico, incapacidad por enfermedad, licencia por paternidad y condicion de trabajo", async () => {
    const e = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('1', '77793001', 'PRUEBA RESUMEN PLANILLA COMPLETO', 0) RETURNING id`
    );
    const empleadoId = e.rows[0].id as number;
    empleadosCreados.push(empleadoId);

    // NOTA (recon 25/46): sin la columna "condicion_trabajo" (no existe en
    // "contratos" en este arbol - ver brecha #4) el INSERT original hubiera
    // fallado con "column condicion_trabajo of relation contratos does not
    // exist".
    const c = await pool.query(
      `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
       VALUES ($1, 'Proyecto Reporte Resumen', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
      [empleadoId]
    );
    contratoId = c.rows[0].id as number;
    contratosCreados.push(contratoId);

    // 19 dias de DESCANSO_MEDICO ya marcados en enero (fuera de este periodo)
    // - deja cupo para exactamente 1 dia mas dentro del tope de 20/año.
    const fechasEnero = Array.from({ length: 19 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    for (const fecha of fechasEnero) {
      await pool.query(
        `INSERT INTO tareo_diario (periodo_id, contrato_id, fecha, tipo_dia_especial)
         VALUES ($1, $2, $3, 'DESCANSO_MEDICO')`,
        [periodoId, contratoId, fecha]
      );
    }

    const guardado = await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
      .set(auth())
      .send({
        dias: [
          ...Array.from({ length: 10 }, (_, i) => ({
            fecha: `2026-02-${String(i + 1).padStart(2, "0")}`,
            horas_normales: 8,
          })),
          // Dia 20 del año (dentro del cupo normal) -> Descanso Medico.
          { fecha: "2026-02-11", tipo_dia_especial: "DESCANSO_MEDICO" },
          // Dia 21 del año (excede el cupo) -> Incapacidad por Enfermedad.
          { fecha: "2026-02-12", tipo_dia_especial: "DESCANSO_MEDICO" },
          { fecha: "2026-02-13", tipo_dia_especial: "LICENCIA_PATERNIDAD" },
        ],
      });
    expect(guardado.status).toBe(204);

    const calculo = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
    expect(calculo.status).toBe(200);
    expect(calculo.body.errores).toEqual([]);

    const detalle = (
      await pool.query("SELECT * FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2", [
        periodoId,
        contratoId,
      ])
    ).rows[0];
    // Precondiciones sobre los datos crudos, antes de mirar el reporte.
    expect(Number(detalle.dias_subsidio_enfermedad)).toBe(1);
    expect(Number(detalle.dias_incapacidad_enfermedad)).toBe(1);
    expect(Number(detalle.subsidio_enfermedad)).toBeGreaterThan(0);
    expect(Number(detalle.incapacidad_enfermedad)).toBeGreaterThan(0);
    expect(Number(detalle.licencia_paternidad)).toBeGreaterThan(0);
    expect(Number(detalle.vacaciones)).toBeGreaterThan(0); // compensacion vacacional automatica por dias trabajados
  });

  it("GET /:id/reporte/datos devuelve las 74 columnas y la fila del contrato en el mismo orden", async () => {
    const r = await request(app).get(`/api/periodos/${periodoId}/reporte/datos`).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.columnas.length).toBe(74);
    expect(r.body.columnas[COL.DESCANSO_MEDICO]).toBe("Descanso Medico");
    expect(r.body.columnas[COL.DIAS_SUBSIDIADOS_ESSALUD]).toBe("Días Subsidiados Por Essalud (Tipo 21/22)");
    expect(r.body.columnas[COL.SUBSIDIOS_PATERNIDAD]).toBe("Subsidios Por Paternidad");
    expect(r.body.columnas[COL.VACACIONES]).toBe("Vacaciones");
    expect(r.body.columnas[COL.CONDICION_TRABAJO]).toBe("Condición de Trabajo");

    const filaEncontrada = (r.body.filas as (string | number)[][]).find((f) => f[1] === "77793001");
    expect(filaEncontrada).toBeDefined();
    fila = filaEncontrada as (string | number)[];
    expect(fila.length).toBe(74);
  });

  it("'Descanso Medico' (col. 37) trae el importe de subsidio_enfermedad (ya NO esta en blanco)", async () => {
    const detalle = await pool.query(
      "SELECT subsidio_enfermedad FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2",
      [periodoId, contratoId]
    );
    expect(Number(fila[COL.DESCANSO_MEDICO])).toBeCloseTo(Number(detalle.rows[0].subsidio_enfermedad), 2);
    expect(Number(fila[COL.DESCANSO_MEDICO])).toBeGreaterThan(0);
  });

  it("'Días Subsidiados Por Essalud (Tipo 21/22)' (col. 26) trae dias_incapacidad_enfermedad (dia 21+)", async () => {
    const detalle = await pool.query(
      "SELECT dias_incapacidad_enfermedad FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2",
      [periodoId, contratoId]
    );
    expect(Number(fila[COL.DIAS_SUBSIDIADOS_ESSALUD])).toBe(Number(detalle.rows[0].dias_incapacidad_enfermedad));
    expect(Number(fila[COL.DIAS_SUBSIDIADOS_ESSALUD])).toBe(1);
  });

  it("'Subsidios Por Paternidad' (col. 28) trae el importe de licencia_paternidad", async () => {
    const detalle = await pool.query(
      "SELECT licencia_paternidad FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2",
      [periodoId, contratoId]
    );
    expect(Number(fila[COL.SUBSIDIOS_PATERNIDAD])).toBeCloseTo(Number(detalle.rows[0].licencia_paternidad), 2);
    expect(Number(fila[COL.SUBSIDIOS_PATERNIDAD])).toBeGreaterThan(0);
  });

  // NOTA (recon 25/46): en produccion esta columna trae el monto fijo de
  // "condicion_trabajo" del contrato (Ronda A, migracion 026). Esa migracion
  // no existe en este arbol (brecha #4) - se verifica que la columna se
  // degrade a 0 (no que falle), que es el comportamiento real hoy.
  it("'Condición de Trabajo' (col. 49) da 0 - migracion 026 (Ronda A) no reconstruida, ver brecha #4", async () => {
    expect(Number(fila[COL.CONDICION_TRABAJO])).toBe(0);
  });

  it("'Vacaciones' (col. 34, importe) trae la compensacion vacacional calculada", async () => {
    const detalle = await pool.query("SELECT vacaciones FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2", [
      periodoId,
      contratoId,
    ]);
    expect(Number(fila[COL.VACACIONES])).toBeCloseTo(Number(detalle.rows[0].vacaciones), 2);
    expect(Number(fila[COL.VACACIONES])).toBeGreaterThan(0);
  });

  it("'Dias Vacaciones' (col. 25) y 'Razón: Días no laborados' (col. 27) siguen en blanco (sin fuente de datos)", () => {
    expect(fila[COL.DIAS_VACACIONES]).toBe("");
    expect(fila[COL.RAZON_DIAS_NO_LABORADOS]).toBe("");
  });
});
