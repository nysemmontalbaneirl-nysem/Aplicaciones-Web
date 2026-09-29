// Pruebas de "periodo que cruza de mes calendario" (Ronda 3): un periodo
// QUINCENAL/SEMANAL cuyas fechas abarcan 2 meses calendario distintos (ej.
// 24/02 al 09/03) usaba, antes de esta mejora, una sola tabla salarial (la
// del mes de fecha_inicio) para todo el periodo - un error silencioso de
// calculo si la tabla salarial/tasas AFP cambian de un mes a otro (tipico en
// construccion civil cuando cambia el convenio colectivo). Ver
// periodoCruzaMes/calcularTramosMes/sumarResultadosLinea en motorCalculo.ts
// y la seccion "Ronda 3" del plan del proyecto para el diseño completo.
//
// Este archivo tiene 2 partes:
// 1) Pruebas UNITARIAS de las funciones puras (sin HTTP ni base de datos).
// 2) Pruebas de INTEGRACION via HTTP (PUT tareo-diario + POST calcular),
//    sembrando una tabla_salarial_mensual de MARZO-2026 distinta a la de
//    FEBRERO-2026 (ya sembrada en schema.sql) para poder verificar que cada
//    tramo usa su propia tabla.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";
import {
  calcularTramosMes,
  diasEntreFechas,
  periodoCruzaMes,
  ResultadoCalculoLinea,
  sumarResultadosLinea,
} from "../src/motorCalculo";

// ===========================================================================
// 1) Pruebas unitarias de las funciones puras
// ===========================================================================
describe("periodoCruzaMes (funcion pura)", () => {
  it("quincena dentro del mismo mes -> false", () => {
    expect(periodoCruzaMes("2026-02-01", "2026-02-15")).toBe(false);
  });

  it("quincena que empieza en un mes y termina en el siguiente -> true", () => {
    expect(periodoCruzaMes("2026-02-24", "2026-03-09")).toBe(true);
  });

  it("periodo mensual (siempre dentro de un mismo mes por definicion) -> false", () => {
    expect(periodoCruzaMes("2026-02-01", "2026-02-28")).toBe(false);
  });

  it("cruce de año (diciembre a enero) -> true", () => {
    expect(periodoCruzaMes("2026-12-28", "2027-01-05")).toBe(true);
  });
});

describe("calcularTramosMes (funcion pura)", () => {
  it("periodo dentro de un solo mes -> 1 tramo que cubre todo el rango", () => {
    const tramos = calcularTramosMes("2026-02-01", "2026-02-15");
    expect(tramos).toEqual([{ anio: 2026, mes: 2, desde: "2026-02-01", hasta: "2026-02-15" }]);
  });

  it("quincena 24/02 al 09/03 -> 2 tramos, cada uno acotado a su mes", () => {
    const tramos = calcularTramosMes("2026-02-24", "2026-03-09");
    expect(tramos).toEqual([
      { anio: 2026, mes: 2, desde: "2026-02-24", hasta: "2026-02-28" },
      { anio: 2026, mes: 3, desde: "2026-03-01", hasta: "2026-03-09" },
    ]);
  });

  it("cruce de año -> 2 tramos con anio distinto", () => {
    const tramos = calcularTramosMes("2026-12-28", "2027-01-05");
    expect(tramos).toEqual([
      { anio: 2026, mes: 12, desde: "2026-12-28", hasta: "2026-12-31" },
      { anio: 2027, mes: 1, desde: "2027-01-01", hasta: "2027-01-05" },
    ]);
  });

  it("mes bisiesto (febrero 2028 tiene 29 dias) -> el tramo de febrero llega hasta el 29", () => {
    const tramos = calcularTramosMes("2028-02-25", "2028-03-05");
    expect(tramos[0]).toEqual({ anio: 2028, mes: 2, desde: "2028-02-25", hasta: "2028-02-29" });
  });
});

describe("diasEntreFechas (funcion pura)", () => {
  it("mismo dia -> 1", () => {
    expect(diasEntreFechas("2026-02-24", "2026-02-24")).toBe(1);
  });

  it("24/02 al 28/02 -> 5 dias inclusive", () => {
    expect(diasEntreFechas("2026-02-24", "2026-02-28")).toBe(5);
  });
});

describe("sumarResultadosLinea (funcion pura)", () => {
  // Fabrica un ResultadoCalculoLinea minimo, con la mayoria de los campos en
  // 0, para poder aislar el comportamiento de cada campo en las pruebas.
  //
  // NOTA (recon 11/46): el fixture original tambien incluia
  // "dias_dominical_no_laborado", "remuneracion_dominical_proporcional",
  // "sobretasa_dominical", "sobretasa_feriado" y "condicion_trabajo" -
  // ninguno de esos campos existe todavia en DetallePlanilla en este punto
  // de la reconstruccion (ver sumarResultadosLinea en motorCalculo.ts, que
  // los omite por el mismo motivo). Se quitan aqui tambien. Revisar y
  // reincorporar cuando se reconstruyan esas migraciones.
  function detalle(overrides: Partial<ResultadoCalculoLinea["detalle"]>): ResultadoCalculoLinea {
    return {
      detalle: {
        contrato_id: 1,
        dias_trabajados: 0,
        dias_dominical: 0,
        dias_feriado: 0,
        dias_falta: 0,
        horas_extra_25: 0,
        horas_extra_35: 0,
        horas_extra_100: 0,
        dias_subsidio_enfermedad: 0,
        dias_incapacidad_enfermedad: 0,
        dias_subsidio_maternidad: 0,
        dias_licencia_paternidad: 0,
        dias_subsidio_enfermedad_computable: 0,
        jornal_diario: 0,
        sueldo_basico: 0,
        remuneracion_dominical: 0,
        remuneracion_feriado: 0,
        importe_horas_extra: 0,
        asignacion_familiar: 0,
        asignacion_escolaridad: 0,
        bonificacion_buc: 0,
        bonificacion_bae: 0,
        bonificacion_movilidad: 0,
        subsidio_enfermedad: 0,
        incapacidad_enfermedad: 0,
        licencia_paternidad: 0,
        otras_bonificaciones: 0,
        gratificacion: 0,
        bonificacion_extraordinaria: 0,
        cts: 0,
        vacaciones: 0,
        total_ingresos: 0,
        aporte_pension: 0,
        descuento_sindicato: 0,
        seguro_vida: 0,
        conafovicer: 0,
        renta_5ta: 0,
        otros_descuentos: 0,
        total_descuentos: 0,
        essalud: 0,
        sctr: 0,
        senati: 0,
        neto_pagar: 0,
        detalle_json: { remuneracion_computable: 0, bases: {}, total_aportes_empleador: 0 },
        ...overrides,
      },
    };
  }

  it("con un solo resultado, lo devuelve tal cual (sin tocar nada)", () => {
    const unico = detalle({ sueldo_basico: 500, total_ingresos: 500 });
    expect(sumarResultadosLinea([unico])).toBe(unico);
  });

  it("suma los campos proporcionales a dias/horas (sueldo_basico, dias_trabajados, essalud, etc.)", () => {
    const tramo1 = detalle({ dias_trabajados: 4, sueldo_basico: 251.2, essalud: 22.61 });
    const tramo2 = detalle({ dias_trabajados: 6, sueldo_basico: 400, essalud: 36.0 });
    const r = sumarResultadosLinea([tramo1, tramo2]);
    expect(r.detalle.dias_trabajados).toBeCloseTo(10);
    expect(r.detalle.sueldo_basico).toBeCloseTo(651.2);
    expect(r.detalle.essalud).toBeCloseTo(58.61);
  });

  // NOTA (recon 11/46): la prueba original de "NO duplica condicion_trabajo"
  // se omite aqui - ese campo (migracion 026) no existe todavia (ver nota
  // del fixture "detalle" arriba). Revisar y reincorporar cuando se
  // reconstruya esa migracion.

  it("NO duplica seguro_vida (EsSalud+Vida, monto fijo segun tipo de periodo, no por tramo) - toma el del ultimo tramo", () => {
    const tramo1 = detalle({ seguro_vida: 2.5 });
    const tramo2 = detalle({ seguro_vida: 2.5 });
    const r = sumarResultadosLinea([tramo1, tramo2]);
    expect(r.detalle.seguro_vida).toBe(2.5);
  });

  it("jornal_diario final es el del ULTIMO tramo cronologico (confirmado con el usuario), no un promedio", () => {
    const tramo1 = detalle({ jornal_diario: 62.8 });
    const tramo2 = detalle({ jornal_diario: 65.0 });
    const r = sumarResultadosLinea([tramo1, tramo2]);
    expect(r.detalle.jornal_diario).toBe(65.0);
  });

  it("total_ingresos, total_descuentos y neto_pagar se RECALCULAN a partir de los componentes ya sumados/tomados (no se suman tal cual)", () => {
    // NOTA (recon 11/46): la prueba original demostraba esto con
    // condicion_trabajo (monto fijo que NO se duplica, pero que si se
    // sumaran los total_ingresos de cada tramo "tal cual" quedaria
    // implicitamente duplicado) - ese campo no existe todavia (ver nota del
    // fixture "detalle" arriba). Se verifica aqui el mismo principio con
    // los campos que si existen: total_ingresos de cada tramo se arma con
    // MAS conceptos (asignacion_familiar, gratificacion) que los que la
    // funcion vuelve a sumar en su recalculo, asi que sumar los
    // total_ingresos "tal cual" daria un numero distinto al recalculado.
    const tramo1 = detalle({
      sueldo_basico: 300,
      asignacion_familiar: 50,
      total_ingresos: 999, // valor absurdo a proposito: si se usara tal cual, el test fallaria
      aporte_pension: 30,
      total_descuentos: 999,
    });
    const tramo2 = detalle({
      sueldo_basico: 200,
      gratificacion: 40,
      total_ingresos: 999,
      aporte_pension: 20,
      total_descuentos: 999,
    });
    const r = sumarResultadosLinea([tramo1, tramo2]);
    // sueldo_basico sumado (300+200=500) + asignacion_familiar (50) +
    // gratificacion (40) = 590, recalculado a partir de los componentes -
    // NO 1998 (que seria sumar los 2 total_ingresos "tal cual").
    expect(r.detalle.total_ingresos).toBe(590);
    expect(r.detalle.total_descuentos).toBe(50); // 30+20, recalculado, no 1998
    expect(r.detalle.neto_pagar).toBe(540); // 590-50
  });

  it("suma las bases de aportes (detalle_json.bases) y recalcula total_aportes_empleador sin duplicar seguro_vida", () => {
    const tramo1 = detalle({
      essalud: 10,
      sctr: 2,
      senati: 1,
      seguro_vida: 2.5,
      detalle_json: { remuneracion_computable: 100, bases: { essalud: 100, sctr: 100 }, total_aportes_empleador: 15.5 },
    });
    const tramo2 = detalle({
      essalud: 15,
      sctr: 3,
      senati: 1.5,
      seguro_vida: 2.5, // mismo monto fijo del tramo1, no se debe duplicar
      detalle_json: { remuneracion_computable: 150, bases: { essalud: 150, sctr: 150 }, total_aportes_empleador: 22.0 },
    });
    const r = sumarResultadosLinea([tramo1, tramo2]);
    const json = r.detalle.detalle_json as { bases: { essalud: number; sctr: number }; total_aportes_empleador: number; remuneracion_computable: number };
    expect(json.bases.essalud).toBeCloseTo(250);
    expect(json.bases.sctr).toBeCloseTo(250);
    expect(json.remuneracion_computable).toBeCloseTo(250);
    // essalud(25) + sctr(5) + senati(2.5) + seguro_vida UNA sola vez (2.5) = 35
    expect(json.total_aportes_empleador).toBeCloseTo(35);
  });
});

// ===========================================================================
// 2) Pruebas de integracion via HTTP (PUT tareo-diario + POST calcular)
// ===========================================================================
const JORNAL_PEON_FEB = 62.8;
const JORNAL_PEON_MAR = 70.0; // valor de prueba, distinto al de febrero, para
// poder verificar que cada tramo usa su propia tabla salarial.

let tokenAdmin: string;
const empleadosCreados: number[] = [];
const periodosCreados: number[] = [];

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  // Tabla salarial de MARZO-2026, distinta a la de FEBRERO-2026 (ya
  // sembrada en schema.sql) - necesaria para que el periodo de prueba que
  // cruza FEB/MAR tenga 2 tramos con jornales distintos de verdad.
  await pool.query(
    `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
     VALUES (2026, 3, 'PEON', $1, 0.30, 0, 8.60, 13.33)
     ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`,
    [JORNAL_PEON_MAR]
  );
  // obtenerAfpTasas(anio, mes) se consulta SIEMPRE para el mes de cada
  // tramo (igual que ya lo hace el calculo de un periodo normal), aunque
  // el contrato de prueba use ONP y no AFP - sin al menos 1 fila para ese
  // mes, obtenerAfpTasas lanza "No hay tasas_afp_mensuales configuradas".
  await pool.query(
    `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
     VALUES (2026, 3, 'INTEGRA', 0.0155, 0.0137, 0.10)
     ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`
  );
});

afterAll(async () => {
  for (const periodoId of periodosCreados) {
    await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoId]);
    await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [periodoId]);
    await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [periodoId]);
    await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [id]);
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2026 AND mes = 3 AND categoria = 'PEON'");
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2026 AND mes = 12 AND categoria = 'PEON'");
  await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = 2026 AND mes IN (3, 12)");
  await pool.query("DELETE FROM parametros_normativos WHERE anio = 2027");
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2027");
  await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = 2027");
  await pool.end();
});

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

async function crearPeriodo(fechaInicio: string, fechaFin: string, diasPeriodo: number, anio: number, mes: number): Promise<number> {
  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
     VALUES ($4, $5, 'SEMANAL', $1, $2, $3) RETURNING id`,
    [fechaInicio, fechaFin, diasPeriodo, anio, mes]
  );
  const id = p.rows[0].id as number;
  periodosCreados.push(id);
  return id;
}

async function crearContrato(dni: string, nombre: string, categoria = "PEON"): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, 0) RETURNING id`,
    [dni, nombre]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Cruce de Mes', $2, 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId, categoria]
  );
  return c.rows[0].id as number;
}

async function cargarTareoDiario(periodoId: number, contratoId: number, dias: Record<string, unknown>[]) {
  const r = await request(app)
    .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
    .set(auth())
    .send({ dias });
  expect(r.status).toBe(204);
}

async function calcular(periodoId: number) {
  const r = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
  expect(r.status).toBe(200);
  expect(r.body.errores).toEqual([]);
  return r;
}

async function obtenerDetalle(periodoId: number, contratoId: number) {
  const r = await pool.query("SELECT * FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2", [
    periodoId,
    contratoId,
  ]);
  return r.rows[0];
}

function jornalNormal(fechas: string[]): Record<string, unknown>[] {
  return fechas.map((fecha) => ({ fecha, horas_normales: 8, minutos_normales: 0 }));
}

describe("Periodo que cruza de mes calendario: integracion via Tareo Diario + /calcular", () => {
  it("quincena 24/02 al 09/03 con Tareo Diario cargado: cada tramo usa su propia tabla salarial", async () => {
    const periodoId = await crearPeriodo("2026-02-24", "2026-03-09", 14, 2026, 2);
    const contratoId = await crearContrato("77790001", "PRUEBA CRUCE MES TAREO DIARIO");

    // 4 dias en febrero (jornal 62.80) + 6 dias en marzo (jornal 70.00),
    // saltando domingos (01/03/2026 es domingo).
    await cargarTareoDiario(periodoId, contratoId, [
      ...jornalNormal(["2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27"]),
      ...jornalNormal(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-09"]),
    ]);

    const r = await calcular(periodoId);
    expect(r.body.avisos_cruce_mes).toEqual([]);

    const detalle = await obtenerDetalle(periodoId, contratoId);
    // sueldo_basico = jornal x dias_trabajados de CADA tramo, sumado:
    // tramo febrero: 4 dias x 62.80 = 251.20
    // tramo marzo: 6 dias x 70.00 = 420.00
    // total esperado: 671.20 (si se hubiera usado 1 sola tabla para los 10
    // dias, con la tabla de febrero habria dado 628.00 - la diferencia
    // exacta que esta correccion evita).
    expect(Number(detalle.dias_trabajados)).toBeCloseTo(10);
    expect(Number(detalle.sueldo_basico)).toBeCloseTo(251.2 + 420.0);
    // jornal_diario final = el del ULTIMO tramo cronologico (marzo).
    expect(Number(detalle.jornal_diario)).toBeCloseTo(JORNAL_PEON_MAR);
    // Trazabilidad: el detalle_json debe traer los 2 tramos usados.
    expect(detalle.detalle_json.tramos_mes).toHaveLength(2);
  });

  it("la misma quincena SIN Tareo Diario (solo carga en bloque) usa una sola tabla (la del mes de inicio) y avisa para revisar a mano", async () => {
    // Fechas distintas a las del primer test (aunque tambien cruza FEB/MAR)
    // para no chocar con el indice unico periodos_planilla_semanal_unico
    // (fecha_inicio, fecha_fin) - ambos periodos SEMANAL de este archivo no
    // pueden compartir el mismo rango exacto de fechas.
    const periodoId = await crearPeriodo("2026-02-23", "2026-03-01", 7, 2026, 2);
    const contratoId = await crearContrato("77790002", "PRUEBA CRUCE MES SIN TAREO DIARIO");

    const editar = await request(app)
      .put(`/api/periodos/${periodoId}/tareo`)
      .set(auth())
      .send({
        contrato_id: contratoId,
        dias_trabajados: 10,
        dias_dominical: 0,
        dias_feriado: 0,
        dias_falta: 0,
        horas_extra_25: 0,
        horas_extra_35: 0,
        horas_extra_100: 0,
      });
    expect(editar.status).toBe(204);

    const r = await calcular(periodoId);
    expect(r.body.avisos_cruce_mes).toHaveLength(1);
    expect(r.body.avisos_cruce_mes[0].contrato_id).toBe(contratoId);

    const detalle = await obtenerDetalle(periodoId, contratoId);
    // Se calcula con la tabla del MES DE INICIO (febrero) para los 10 dias
    // completos, sin partir en tramos (no hay forma de saber que dias caen
    // en cada mes sin Tareo Diario).
    expect(Number(detalle.sueldo_basico)).toBeCloseTo(JORNAL_PEON_FEB * 10);
  });

  it("periodo que NO cruza de mes sigue sin avisos_cruce_mes (comportamiento sin cambios)", async () => {
    const periodoId = await crearPeriodo("2026-02-02", "2026-02-07", 6, 2026, 2);
    const contratoId = await crearContrato("77790003", "PRUEBA SIN CRUCE DE MES");
    await cargarTareoDiario(periodoId, contratoId, jornalNormal(["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-07"]));

    const r = await calcular(periodoId);
    expect(r.body.avisos_cruce_mes).toEqual([]);
    const detalle = await obtenerDetalle(periodoId, contratoId);
    expect(Number(detalle.sueldo_basico)).toBeCloseTo(JORNAL_PEON_FEB * 6);
  });

  it("cruce de año (28/12/2026 al 05/01/2027) con Tareo Diario: resuelve parametros_normativos/tabla/AFP tambien por tramo", async () => {
    // Siembra el minimo necesario para diciembre-2026/enero-2027:
    // parametros_normativos es POR ANIO (un periodo que cruza de año
    // necesita el del año siguiente tambien) y tabla_salarial_mensual es
    // por (anio, mes) - diciembre-2026 tampoco esta sembrado en schema.sql
    // (solo febrero-2026), asi que hace falta sembrarlo para esta prueba.
    const JORNAL_PEON_DIC_2026 = 65.0;
    const JORNAL_PEON_ENE_2027 = 72.0;
    await pool.query(
      `INSERT INTO parametros_normativos (anio, uit, remuneracion_minima_vital, tasa_essalud, tasa_onp, tasa_senati, tasa_conafovicer, tasa_sctr_salud, asignacion_familiar, seguro_vida_ley)
       VALUES (2027, 5600, 1150.00, 0.09, 0.13, 0.0045, 0.02, 0.0155, 115.00, 5.00)
       ON CONFLICT (anio) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
       VALUES (2026, 12, 'PEON', $1, 0.30, 0, 8.60, 12.38)
       ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`,
      [JORNAL_PEON_DIC_2026]
    );
    await pool.query(
      `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
       VALUES (2027, 1, 'PEON', $1, 0.30, 0, 8.60, 13.71)
       ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`,
      [JORNAL_PEON_ENE_2027]
    );
    // Igual que en el tramo de marzo (ver beforeAll): obtenerAfpTasas se
    // consulta siempre para el mes de cada tramo, aunque el contrato use ONP.
    await pool.query(
      `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
       VALUES (2026, 12, 'INTEGRA', 0.0155, 0.0137, 0.10)
       ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
       VALUES (2027, 1, 'INTEGRA', 0.0155, 0.0137, 0.10)
       ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`
    );

    const periodoId = await crearPeriodo("2026-12-28", "2027-01-05", 9, 2026, 12);
    const contratoId = await crearContrato("77790004", "PRUEBA CRUCE DE ANIO");

    await cargarTareoDiario(periodoId, contratoId, [
      ...jornalNormal(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31"]),
      ...jornalNormal(["2027-01-04", "2027-01-05"]), // 01/01 feriado, 02-03 sabado/domingo
    ]);

    const r = await calcular(periodoId);
    expect(r.body.errores).toEqual([]);

    const detalle = await obtenerDetalle(periodoId, contratoId);
    expect(Number(detalle.dias_trabajados)).toBeCloseTo(6);
    expect(Number(detalle.sueldo_basico)).toBeCloseTo(4 * JORNAL_PEON_DIC_2026 + 2 * JORNAL_PEON_ENE_2027);
    expect(Number(detalle.jornal_diario)).toBeCloseTo(JORNAL_PEON_ENE_2027); // ultimo tramo (enero 2027)
  });
});
