// Pruebas de la unificacion "Reportes vs Planilla Mensual" (22/09/2026, ver
// cabecera de src/planillaMensual.ts y src/routes/planillaMensual.ts): la
// pantalla de Planilla Mensual pasa a trabajar por ALCANCE
// {anio, mes, proyecto?} en vez de un solo planilla_mensual_id, en 2
// modalidades - "por proyecto" (incluye tambien a los EMPLEADOS de regimen
// general de ese proyecto/mes, que antes no aparecian aqui) y "todos los
// proyectos" (junta los obreros de VARIOS proyectos con los empleados de
// TODOS los proyectos en una sola vista/archivo, restringido a ADMIN).
//
// Este archivo cubre especificamente lo que NO cubren ya
// planilla_mensual_exportaciones.test.ts (un solo proyecto, solo obreros) ni
// planilla_mensual_rutas.test.ts (control de acceso HTTP): la mezcla real
// obreros+empleados y la combinacion de VARIOS proyectos a la vez.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { consolidarMes, obtenerVistaMensual } from "../src/planillaMensual";
import { generarLineasREMMensual } from "../src/plame";
import { generarCSVAFPnetMensual } from "../src/afpnet";
import { obtenerDiagnosticoAfpnetMensual } from "../src/afpnetExcel";
import { CLAVE_PRUEBA } from "./globalSetup";

// NOTA (recon 19/46, reconfirmado en recon 33/46): la prueba original de
// este archivo tambien cubria generarAsientoContableMensual (agrupacion POR
// PROYECTO del asiento contable, en modo "todos los proyectos") - se omite
// (junto con su import de "../src/asientoContable") porque ese modulo no
// existe en este arbol (ver RECONSTRUCCION_BRECHAS.md punto 5 - confirmado
// ausente ya 3 veces).

const ANIO = 2027;
const MES = 6; // año/mes propios de este archivo, sin usar por ninguna otra prueba (ver periodo_cruza_mes.test.ts, unico otro archivo que toca 2027, pero otros meses)
const PROYECTO_A = "Proyecto Unificacion A";
const PROYECTO_B = "Proyecto Unificacion B";
const PROYECTO_C = "Proyecto Unificacion C"; // solo para el aviso de periodo MENSUAL de empleados sin calcular
const JORNAL_PEON = 70.0;

// Dias de semana (lunes-viernes) del 01-15 de junio 2027, para no chocar con
// los limites de tareo de sabado/domingo sin tener que relajarlos.
const DIAS_QUINCENA = ["2027-06-02", "2027-06-03", "2027-06-04"];
const DIAS_MES = ["2027-06-02", "2027-06-03", "2027-06-04", "2027-06-07", "2027-06-08"];

let tokenAdmin: string;
let adminUserId: number;
const proyectosCreados: number[] = [];
const periodosCreados: number[] = [];
const empleadosCreados: number[] = [];
const contratosCreados: number[] = [];

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

async function crearObrero(proyecto: string, dni: string, sistemaPension: "AFP" | "ONP"): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('01', $1, $2, 0) RETURNING id`,
    [dni, `PRUEBA UNIFICACION OBRERO ${dni}`]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, afp_nombre, cuspp, fecha_ingreso, estado)
     VALUES ($1, $2, 'PEON', $3, $4, $5, '2027-01-01', 'HABIL') RETURNING id`,
    [empleadoId, proyecto, sistemaPension, sistemaPension === "AFP" ? "INTEGRA" : null, sistemaPension === "AFP" ? `CUSPP-${dni}` : null]
  );
  const contratoId = c.rows[0].id as number;
  contratosCreados.push(contratoId);
  return contratoId;
}

async function crearEmpleadoRegimenGeneral(proyecto: string, dni: string, sistemaPension: "AFP" | "ONP"): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('01', $1, $2, 0) RETURNING id`,
    [dni, `PRUEBA UNIFICACION EMPLEADO ${dni}`]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, afp_nombre, cuspp, fecha_ingreso, estado, sueldo_base)
     VALUES ($1, $2, 'EMPLEADO', $3, $4, $5, '2027-01-01', 'HABIL', 3200) RETURNING id`,
    [empleadoId, proyecto, sistemaPension, sistemaPension === "AFP" ? "INTEGRA" : null, sistemaPension === "AFP" ? `CUSPP-${dni}` : null]
  );
  const contratoId = c.rows[0].id as number;
  contratosCreados.push(contratoId);
  return contratoId;
}

// Insercion directa a tareo_diario - suficiente para los OBREROS (la
// consolidacion mensual, consolidarMes/agregarTareoDiario, lee directo de
// esta tabla, ver planillaMensual.ts).
async function cargarTareo(periodoId: number, contratoId: number, fechas: string[]) {
  const filas = fechas.map((fecha) => `('${fecha}', ${periodoId}, ${contratoId}, 8, 0)`);
  await pool.query(
    `INSERT INTO tareo_diario (fecha, periodo_id, contrato_id, horas_normales, minutos_normales) VALUES ${filas.join(", ")}`
  );
}

// Para los EMPLEADOS hace falta pasar por la ruta HTTP (no un INSERT directo
// a tareo_diario): POST /:id/calcular lee de asistencia_periodo, que solo se
// recalcula cuando se guarda el tareo por esta ruta (recalcularAsistenciaDesdeTareoDiario).
async function cargarTareoHttp(periodoId: number, contratoId: number, fechas: string[]) {
  const r = await request(app)
    .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
    .set(auth())
    .send({ dias: fechas.map((fecha) => ({ fecha, horas_normales: 8, minutos_normales: 0 })) });
  expect(r.status).toBe(204);
}

let periodoQuincenalA: number;
let periodoQuincenalB: number;
let periodoMensualA: number;
let periodoMensualB: number;
let periodoMensualC: number;
let contratoObreroA: number;
let contratoObreroB: number;
let contratoEmpleadoA: number;
let contratoEmpleadoB: number;

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;
  const idResult = await pool.query("SELECT id FROM usuarios WHERE correo = 'admin@prueba.local'");
  adminUserId = idResult.rows[0].id as number;

  await pool.query(
    `INSERT INTO parametros_normativos (anio, uit, remuneracion_minima_vital, tasa_essalud, tasa_onp, tasa_senati, tasa_conafovicer, tasa_sctr_salud, asignacion_familiar, seguro_vida_ley)
     VALUES ($1, 5600, 1150.00, 0.09, 0.13, 0.0045, 0.02, 0.0155, 115.00, 5.00)
     ON CONFLICT (anio) DO NOTHING`,
    [ANIO]
  );
  await pool.query(
    `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
     VALUES ($1, $2, 'PEON', $3, 0.30, 0, 8.60, 12.98)
     ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`,
    [ANIO, MES, JORNAL_PEON]
  );
  await pool.query(
    `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
     VALUES ($1, $2, 'INTEGRA', 0.0155, 0.0137, 0.10)
     ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`,
    [ANIO, MES]
  );

  // proyectos A y B necesitan existir en la tabla "proyectos" para que
  // generarAsientoContableMensual pueda resolver su proyecto_id (ver
  // asientoContable.ts: un proyecto de texto libre sin fila aca se omite
  // por completo del asiento, no genera ni lineas ni faltantes).
  for (const nombre of [PROYECTO_A, PROYECTO_B]) {
    const p = await pool.query("INSERT INTO proyectos (nombre) VALUES ($1) RETURNING id", [nombre]);
    proyectosCreados.push(p.rows[0].id as number);
  }

  // --- Obreros (QUINCENAL, se consolidan con consolidarMes) ---
  const pa = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES ($1, $2, 1, 'QUINCENAL', $3, $4, 15, $5) RETURNING id`,
    [ANIO, MES, "2027-06-01", "2027-06-15", PROYECTO_A]
  );
  periodoQuincenalA = pa.rows[0].id as number;
  periodosCreados.push(periodoQuincenalA);
  contratoObreroA = await crearObrero(PROYECTO_A, "66661001", "AFP");
  await cargarTareo(periodoQuincenalA, contratoObreroA, DIAS_QUINCENA);

  const pb = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES ($1, $2, 1, 'QUINCENAL', $3, $4, 15, $5) RETURNING id`,
    [ANIO, MES, "2027-06-01", "2027-06-15", PROYECTO_B]
  );
  periodoQuincenalB = pb.rows[0].id as number;
  periodosCreados.push(periodoQuincenalB);
  contratoObreroB = await crearObrero(PROYECTO_B, "66661002", "ONP");
  await cargarTareo(periodoQuincenalB, contratoObreroB, DIAS_QUINCENA);

  // --- Empleados (MENSUAL, ya cubren el mes completo, NO se consolidan) ---
  const ma = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES ($1, $2, 'MENSUAL', '2027-06-01', '2027-06-30', 30, $3) RETURNING id`,
    [ANIO, MES, PROYECTO_A]
  );
  periodoMensualA = ma.rows[0].id as number;
  periodosCreados.push(periodoMensualA);
  contratoEmpleadoA = await crearEmpleadoRegimenGeneral(PROYECTO_A, "66662001", "AFP");
  await cargarTareoHttp(periodoMensualA, contratoEmpleadoA, DIAS_MES);
  const calcA = await request(app).post(`/api/periodos/${periodoMensualA}/calcular`).set(auth()).send({});
  expect(calcA.status).toBe(200);
  expect(calcA.body.errores).toEqual([]);

  const mb = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES ($1, $2, 'MENSUAL', '2027-06-01', '2027-06-30', 30, $3) RETURNING id`,
    [ANIO, MES, PROYECTO_B]
  );
  periodoMensualB = mb.rows[0].id as number;
  periodosCreados.push(periodoMensualB);
  contratoEmpleadoB = await crearEmpleadoRegimenGeneral(PROYECTO_B, "66662002", "ONP");
  await cargarTareoHttp(periodoMensualB, contratoEmpleadoB, DIAS_MES);
  const calcB = await request(app).post(`/api/periodos/${periodoMensualB}/calcular`).set(auth()).send({});
  expect(calcB.status).toBe(200);
  expect(calcB.body.errores).toEqual([]);

  // Periodo MENSUAL de un TERCER proyecto, nunca calculado (queda ABIERTO) -
  // solo para probar el aviso de "periodo de empleados sin calcular".
  const mc = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES ($1, $2, 'MENSUAL', '2027-06-01', '2027-06-30', 30, $3) RETURNING id`,
    [ANIO, MES, PROYECTO_C]
  );
  periodoMensualC = mc.rows[0].id as number;
  periodosCreados.push(periodoMensualC);

  // Consolida los obreros de AMBOS proyectos de una sola vez ("todos los
  // proyectos", proyecto=null) - confirma que combina N proyectos.
  const resultado = await consolidarMes(ANIO, MES, null, adminUserId);
  expect(resultado.errores).toEqual([]);
  expect(resultado.proyectos_consolidados.sort()).toEqual([PROYECTO_A, PROYECTO_B].sort());
  expect(resultado.trabajadores_consolidados).toBe(2);
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM detalle_planilla_mensual WHERE planilla_mensual_id IN (SELECT id FROM planilla_mensual WHERE anio = $1 AND mes = $2)",
    [ANIO, MES]
  );
  await pool.query("DELETE FROM planilla_mensual WHERE anio = $1 AND mes = $2", [ANIO, MES]);
  await pool.query(
    "DELETE FROM detalle_planilla_conceptos WHERE detalle_id IN (SELECT id FROM detalle_planilla WHERE periodo_id = ANY($1::int[]))",
    [periodosCreados]
  );
  await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = ANY($1::int[])", [periodosCreados]);
  await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = ANY($1::int[])", [periodosCreados]);
  for (const periodoId of periodosCreados) {
    await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [periodoId]);
    await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  }
  for (const id of contratosCreados) {
    await pool.query("DELETE FROM contratos WHERE id = $1", [id]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM proyectos WHERE id = ANY($1::int[])", [proyectosCreados]);
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = $1 AND mes = $2", [ANIO, MES]);
  await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = $1 AND mes = $2", [ANIO, MES]);
  await pool.query("DELETE FROM parametros_normativos WHERE anio = $1", [ANIO]);
  await pool.end();
});

describe("obtenerVistaMensual - modo 'por proyecto' incluye tambien a los empleados", () => {
  it("Proyecto A: detalle trae 1 OBRERO (consolidado) + 1 EMPLEADO (boleta MENSUAL ya calculada)", async () => {
    const vista = await obtenerVistaMensual({ anio: ANIO, mes: MES, proyecto: PROYECTO_A });
    expect(vista.detalle).toHaveLength(2);
    const obrero = vista.detalle.find((f) => f.tipo_trabajador === "OBRERO");
    const empleado = vista.detalle.find((f) => f.tipo_trabajador === "EMPLEADO");
    expect(obrero).toBeDefined();
    expect(empleado).toBeDefined();
    expect((obrero as unknown as { contrato_id: number }).contrato_id).toBe(contratoObreroA);
    expect((empleado as unknown as { contrato_id: number }).contrato_id).toBe(contratoEmpleadoA);
    // El empleado nunca tiene planilla_mensual_id (no se "consolida").
    expect((empleado as unknown as { planilla_mensual_id: number | null }).planilla_mensual_id).toBeNull();
  });

  it("Proyecto A: el aviso de periodos de empleados sin calcular NO incluye al Proyecto C (otro proyecto)", async () => {
    const vista = await obtenerVistaMensual({ anio: ANIO, mes: MES, proyecto: PROYECTO_A });
    expect(vista.avisos_periodos_empleados_no_calculados.some((a) => a.id === periodoMensualC)).toBe(false);
  });
});

describe("obtenerVistaMensual - modo 'todos los proyectos' (proyecto=null)", () => {
  it("combina los obreros y empleados de AMBOS proyectos (A y B) en una sola vista", async () => {
    const vista = await obtenerVistaMensual({ anio: ANIO, mes: MES, proyecto: null });
    expect(vista.detalle).toHaveLength(4);
    const contratoIds = vista.detalle.map((f) => (f as unknown as { contrato_id: number }).contrato_id).sort((a, b) => a - b);
    expect(contratoIds).toEqual([contratoObreroA, contratoObreroB, contratoEmpleadoA, contratoEmpleadoB].sort((a, b) => a - b));
  });

  it("avisa del periodo MENSUAL de empleados del Proyecto C que todavia no se calculo", async () => {
    const vista = await obtenerVistaMensual({ anio: ANIO, mes: MES, proyecto: null });
    expect(vista.avisos_periodos_empleados_no_calculados.some((a) => a.id === periodoMensualC)).toBe(true);
  });
});

describe("Exportaciones 'todos los proyectos' - combinan N proyectos + obreros + empleados en un solo archivo", () => {
  it("generarLineasREMMensual incluye a los 4 trabajadores (2 obreros + 2 empleados) de ambos proyectos", async () => {
    const lineas = await generarLineasREMMensual({ anio: ANIO, mes: MES, proyecto: null });
    for (const dni of ["66661001", "66661002", "66662001", "66662002"]) {
      expect(lineas.some((l) => l.includes(`|${dni}|`))).toBe(true);
    }
  });

  it("generarCSVAFPnetMensual incluye SOLO a los trabajadores AFP de ambos proyectos (1 obrero + 1 empleado)", async () => {
    const csv = await generarCSVAFPnetMensual({ anio: ANIO, mes: MES, proyecto: null });
    const filas = csv.split("\n");
    expect(filas).toHaveLength(3); // encabezado + 2 filas AFP
    expect(csv).toContain("66661001"); // obrero A, AFP
    expect(csv).toContain("66662001"); // empleado A, AFP
    expect(csv).not.toContain("66661002"); // obrero B, ONP
    expect(csv).not.toContain("66662002"); // empleado B, ONP
  });

  it("obtenerDiagnosticoAfpnetMensual cuenta los 4 trabajadores de ambos proyectos, 2 AFP y 2 ONP", async () => {
    const diagnostico = await obtenerDiagnosticoAfpnetMensual({ anio: ANIO, mes: MES, proyecto: null });
    expect(diagnostico.trabajadores_consolidados).toBe(4);
    expect(diagnostico.por_sistema_pension.sort((a, b) => a.sistema_pension.localeCompare(b.sistema_pension))).toEqual([
      { sistema_pension: "AFP", total: 2 },
      { sistema_pension: "ONP", total: 2 },
    ]);
  });
});
