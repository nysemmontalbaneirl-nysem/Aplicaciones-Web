// Pruebas de la migracion 032: Vacaciones, CTS y Asignacion por Escolaridad
// (construccion civil) ahora SI creditan los dias de descanso medico por
// enfermedad en sus "dias computables" - antes de esta correccion solo
// usaban dias_trabajados, ignorando el descanso medico (Gratificacion ya lo
// hacia desde la migracion 025, sin tope).
//
// Reportado por el usuario (CPC.MONTALBAN) con un caso real: trabajador
// ARTEAGA CARCAMO LUIS ALFONSO, categoria OPERARIO, jornal S/89.30, 3 hijos,
// 10.94 dias trabajados y 1 dia de descanso medico en el periodo. Confirmado
// reproduciendo EXACTO los montos de su Excel de referencia (Calculos.xlsx)
// para Vacaciones y Escolaridad, y el mismo criterio de redondeo que el
// sistema YA usaba para CTS (tasa diaria redondeada a 2 decimales antes de
// multiplicar, ver comentario de calcularCTS en motorCalculo.ts):
// Vacaciones = (89.30 x 0.10) x (10.94 + 1) = 106.62; CTS = redondear(89.30 x
// 0.15) x (10.94 + 1) = 13.40 x 11.94 = 160.00; Escolaridad = (89.30/12) x
// (10.94 + 1 + dias_feriado) x 3 hijos = 266.56.
//
// Ademas, el usuario confirmo (via pregunta de opcion multiple) un tope
// NUEVO de 60 dias de descanso medico por año calendario por CONTRATO para
// que un dia cuente como "computable" en estos 4 beneficios (Gratificacion/
// Vacaciones/CTS/Escolaridad) - basado en el mismo criterio legal citado en
// su compendio de referencia ("descansos medicos debidamente acreditados
// hasta por un periodo de 60 dias al año"). Este tope es DISTINTO del tope
// de 20 dias/año YA EXISTENTE (migracion 030) sobre el PAGO del subsidio a
// cargo del empleador - como 20 < 60, el tope de 60 nunca se alcanza hoy en
// la practica via la UI (que bloquea el dia 21), asi que las pruebas del
// tope se siembran directo por SQL (bypassing esa validacion) para poder
// probar la logica del tope en aislamiento.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";
import {
  calcularAsignacionEscolar,
  calcularCTS,
  calcularVacaciones,
} from "../src/motorCalculo";
import { AsistenciaEntrada, CategoriaOcupacional, Contrato } from "../src/tipos";

// ===========================================================================
// 1) Pruebas unitarias de las funciones puras (caso ARTEAGA CARCAMO)
// ===========================================================================
function contratoConstruccionCivil(categoria: CategoriaOcupacional = "OPERARIO"): Contrato {
  return {
    id: 1,
    empleado_id: 1,
    proyecto: "Proyecto Prueba",
    grupo: null,
    categoria_ocupacional: categoria,
    ocupacion: null,
    sistema_pension: "ONP",
    afp_nombre: null,
    cuspp: null,
    sistema_comision: null,
    fecha_ingreso: "2026-01-01",
    fecha_cese: null,
    sueldo_base: null,
    viaticos: 0,
    condicion_trabajo: 0,
    sindicalizado: false,
    poliza_seguro: false,
    sctr_salud: false,
    essalud_vida: false,
    domiciliado: true,
    estado: "HABIL",
  };
}

function asistencia(parcial: Partial<AsistenciaEntrada>): AsistenciaEntrada {
  return {
    contrato_id: 1,
    dias_trabajados: 0,
    dias_dominical: 0,
    dias_dominical_no_laborado: 0,
    dias_feriado: 0,
    dias_feriado_trabajado: 0,
    dias_falta: 0,
    horas_extra_25: 0,
    horas_extra_35: 0,
    horas_extra_100: 0,
    dias_subsidio_enfermedad: 0,
    dias_incapacidad_enfermedad: 0,
    dias_subsidio_maternidad: 0,
    dias_licencia_paternidad: 0,
    dias_subsidio_enfermedad_computable: 0,
    ...parcial,
  };
}

const JORNAL_ARTEAGA = 89.3;
const DIAS_TRABAJADOS_ARTEAGA = 10.94;

describe("calcularVacaciones (funcion pura) - construccion civil suma descanso medico computable", () => {
  it("caso ARTEAGA CARCAMO: 10.94 dias trabajados + 1 dia de descanso medico -> S/106.62 (Excel del usuario)", () => {
    const vacaciones = calcularVacaciones(
      contratoConstruccionCivil(),
      JORNAL_ARTEAGA,
      asistencia({ dias_trabajados: DIAS_TRABAJADOS_ARTEAGA, dias_subsidio_enfermedad_computable: 1 }),
      0.1
    );
    expect(vacaciones).toBeCloseTo(106.62, 2);
  });

  it("sin el descanso medico computable, el monto es menor (el bug original reportado)", () => {
    const sinDescansoMedico = calcularVacaciones(
      contratoConstruccionCivil(),
      JORNAL_ARTEAGA,
      asistencia({ dias_trabajados: DIAS_TRABAJADOS_ARTEAGA }),
      0.1
    );
    expect(sinDescansoMedico).toBeCloseTo(97.69, 2); // monto que mostraba la boleta antes de esta correccion
  });

  it("EMPLEADO (regimen general) sigue en 0, sin cambios", () => {
    const vacaciones = calcularVacaciones(
      contratoConstruccionCivil("EMPLEADO"),
      JORNAL_ARTEAGA,
      asistencia({ dias_trabajados: 30, dias_subsidio_enfermedad_computable: 2 }),
      0.1
    );
    expect(vacaciones).toBe(0);
  });
});

describe("calcularCTS (funcion pura) - construccion civil suma descanso medico computable", () => {
  it("caso ARTEAGA CARCAMO: 10.94 dias trabajados + 1 dia de descanso medico -> S/160.00 (jornal x 15% redondeado x dias, mismo criterio ya usado por el sistema)", () => {
    const cts = calcularCTS(
      contratoConstruccionCivil(),
      JORNAL_ARTEAGA,
      asistencia({ dias_trabajados: DIAS_TRABAJADOS_ARTEAGA, dias_subsidio_enfermedad_computable: 1 }),
      0,
      0,
      8,
      2026,
      "2026-01-01",
      0.15
    );
    // ctsDiaria = redondear(89.30 x 0.15) = 13.40 (no 13.395); x 11.94 dias = 159.996 -> 160.00.
    expect(cts).toBeCloseTo(160.0, 2);
  });

  it("sin el descanso medico computable, el monto es menor (el bug original reportado)", () => {
    const sinDescansoMedico = calcularCTS(
      contratoConstruccionCivil(),
      JORNAL_ARTEAGA,
      asistencia({ dias_trabajados: DIAS_TRABAJADOS_ARTEAGA }),
      0,
      0,
      8,
      2026,
      "2026-01-01",
      0.15
    );
    expect(sinDescansoMedico).toBeCloseTo(146.6, 2); // monto que mostraba la boleta antes de esta correccion
  });
});

// NOTA (recon 26/46): el titulo original de este describe menciona tambien
// "+ dominical proporcional (migracion 039)" - esa parte de la migracion 039
// (sumar dias_dominical_no_laborado a los dias computables de Escolaridad)
// no se pudo reconstruir: ese campo no existe todavia en AsistenciaEntrada
// en este arbol (migraciones 022/023/026, ver RECONSTRUCCION_BRECHAS.md
// brecha #4). El resto de la migracion 039 (interruptor "Activo" por
// concepto, exclusion de Descanso Medico de CONAFOVICER) SI se reconstruyo.
describe("calcularAsignacionEscolar (funcion pura) - suma descanso medico computable + feriado", () => {
  it("caso ARTEAGA CARCAMO: 10.94 dias trabajados + 1 dia de descanso medico + 3 hijos -> S/266.56", () => {
    const escolaridad = calcularAsignacionEscolar(
      JORNAL_ARTEAGA,
      3,
      asistencia({ dias_trabajados: DIAS_TRABAJADOS_ARTEAGA, dias_subsidio_enfermedad_computable: 1, dias_feriado: 0 }),
      "OPERARIO",
      12
    );
    // (89.30/12) x (10.94+1+0) x 3 = 266.5645 -> redondeado 266.56
    expect(escolaridad).toBeCloseTo(266.56, 2);
  });

  it("sin el descanso medico computable, el monto es menor (el bug original reportado, S/244.24)", () => {
    const sinDescansoMedico = calcularAsignacionEscolar(
      JORNAL_ARTEAGA,
      3,
      asistencia({ dias_trabajados: DIAS_TRABAJADOS_ARTEAGA }),
      "OPERARIO",
      12
    );
    expect(sinDescansoMedico).toBeCloseTo(244.24, 2);
  });

  it("el dominical (domingo SI trabajado) NO entra a la formula de escolaridad (a diferencia de Gratificacion) - confirmado con el Excel del usuario", () => {
    const conDominical = calcularAsignacionEscolar(
      JORNAL_ARTEAGA,
      3,
      asistencia({ dias_trabajados: DIAS_TRABAJADOS_ARTEAGA, dias_dominical: 5 }),
      "OPERARIO",
      12
    );
    const sinDominical = calcularAsignacionEscolar(
      JORNAL_ARTEAGA,
      3,
      asistencia({ dias_trabajados: DIAS_TRABAJADOS_ARTEAGA }),
      "OPERARIO",
      12
    );
    expect(conDominical).toBeCloseTo(sinDominical, 2);
  });

  // Migracion 048 (reconstruida desde backend_dist, ver
  // RECONSTRUCCION_BRECHAS.md): a diferencia del dominical SI trabajado (caso
  // de arriba), el dominical proporcional NO LABORADO (dias_dominical_no_laborado,
  // migracion 023) SI entra a los "dias computables" de Escolaridad, con el
  // mismo criterio que dias_subsidio_enfermedad_computable/dias_feriado
  // (calcularAsignacionEscolar en motorCalculo.ts).
  it("el dominical proporcional NO laborado SI entra a la formula de escolaridad", () => {
    const conDominicalNoLaborado = calcularAsignacionEscolar(
      JORNAL_ARTEAGA,
      3,
      asistencia({ dias_trabajados: DIAS_TRABAJADOS_ARTEAGA, dias_dominical_no_laborado: 1 }),
      "OPERARIO",
      12
    );
    const sinDominicalNoLaborado = calcularAsignacionEscolar(
      JORNAL_ARTEAGA,
      3,
      asistencia({ dias_trabajados: DIAS_TRABAJADOS_ARTEAGA }),
      "OPERARIO",
      12
    );
    // (89.30/12) x (10.94+1) x 3 = 266.56 vs (89.30/12) x 10.94 x 3 = 244.24
    // (los mismos montos ya verificados arriba para dias_subsidio_enfermedad_computable,
    // porque ambos campos entran a la formula de la misma forma) - diferencia 22.32.
    expect(conDominicalNoLaborado).toBeCloseTo(266.56, 2);
    expect(sinDominicalNoLaborado).toBeCloseTo(244.24, 2);
  });
});

// ===========================================================================
// 2) Prueba de integracion via HTTP: reproduce el caso ARTEAGA CARCAMO de
//    punta a punta (Tareo Diario -> asistencia_periodo -> detalle_planilla).
// ===========================================================================
let tokenAdmin: string;
const empleadosCreados: number[] = [];
const periodosCreados: number[] = [];

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  await pool.query(
    `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
     VALUES (2026, 8, 'OPERARIO', 89.30, 0.32, 0, 8.60, 23.81)
     ON CONFLICT DO NOTHING`
  );
  await pool.query(
    `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
     VALUES (2026, 8, 'PROFUTURO', 0.0169, 0.0117, 0.10)
     ON CONFLICT DO NOTHING`
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
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2026 AND mes = 8 AND categoria = 'OPERARIO'");
  await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = 2026 AND mes = 8 AND afp_nombre = 'PROFUTURO'");
  await pool.end();
});

describe("Integracion: Vacaciones/CTS/Escolaridad via Tareo Diario + /calcular creditan el descanso medico", () => {
  it("un dia de DESCANSO_MEDICO dentro del tope de 60 aumenta Vacaciones/CTS/Escolaridad", async () => {
    const periodo = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
       VALUES (2026, 8, 'SEMANAL', '2026-08-03', '2026-08-09', 8) RETURNING id`
    );
    const periodoId = periodo.rows[0].id as number;
    periodosCreados.push(periodoId);

    const empleado = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('1', '77794001', 'PRUEBA DIAS COMPUTABLES CON DESCANSO', 3) RETURNING id`
    );
    const empleadoId = empleado.rows[0].id as number;
    empleadosCreados.push(empleadoId);
    const contrato = await pool.query(
      `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
       VALUES ($1, 'Proyecto Dias Computables', 'OPERARIO', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
      [empleadoId]
    );
    const contratoId = contrato.rows[0].id as number;

    const empleadoSin = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('1', '77794002', 'PRUEBA DIAS COMPUTABLES SIN DESCANSO', 3) RETURNING id`
    );
    const empleadoSinId = empleadoSin.rows[0].id as number;
    empleadosCreados.push(empleadoSinId);
    const contratoSin = await pool.query(
      `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
       VALUES ($1, 'Proyecto Dias Computables', 'OPERARIO', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
      [empleadoSinId]
    );
    const contratoSinId = contratoSin.rows[0].id as number;

    // 6 dias trabajados normales, un dia con DESCANSO_MEDICO (certificado).
    const cargarCon = await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
      .set(auth())
      .send({
        dias: [
          { fecha: "2026-08-03", horas_normales: 8, minutos_normales: 0 },
          { fecha: "2026-08-04", horas_normales: 8, minutos_normales: 0 },
          { fecha: "2026-08-05", horas_normales: 8, minutos_normales: 0 },
          { fecha: "2026-08-06", horas_normales: 8, minutos_normales: 0 },
          { fecha: "2026-08-07", horas_normales: 8, minutos_normales: 0 },
          { fecha: "2026-08-08", tipo_dia_especial: "DESCANSO_MEDICO" },
        ],
      });
    expect(cargarCon.status).toBe(204);

    // Mismo trabajador, sin ningun dia de descanso medico (7 dias normales,
    // para tener el mismo total de "dias pagados" y aislar el efecto).
    const cargarSin = await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoSinId}`)
      .set(auth())
      .send({
        dias: [
          { fecha: "2026-08-03", horas_normales: 8, minutos_normales: 0 },
          { fecha: "2026-08-04", horas_normales: 8, minutos_normales: 0 },
          { fecha: "2026-08-05", horas_normales: 8, minutos_normales: 0 },
          { fecha: "2026-08-06", horas_normales: 8, minutos_normales: 0 },
          { fecha: "2026-08-07", horas_normales: 8, minutos_normales: 0 },
        ],
      });
    expect(cargarSin.status).toBe(204);

    const asistenciaCon = (
      await pool.query("SELECT * FROM asistencia_periodo WHERE periodo_id = $1 AND contrato_id = $2", [
        periodoId,
        contratoId,
      ])
    ).rows[0];
    expect(Number(asistenciaCon.dias_subsidio_enfermedad)).toBe(1);
    expect(Number(asistenciaCon.dias_subsidio_enfermedad_computable)).toBe(1);

    const calcular = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
    expect(calcular.status).toBe(200);
    expect(calcular.body.errores).toEqual([]);

    const detalleCon = (
      await pool.query("SELECT * FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2", [
        periodoId,
        contratoId,
      ])
    ).rows[0];
    const detalleSin = (
      await pool.query("SELECT * FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2", [
        periodoId,
        contratoSinId,
      ])
    ).rows[0];

    const jornalDiario = Number(detalleCon.jornal_diario);
    // "con" tiene 1 dia de descanso medico computable de mas que "sin" -> la
    // diferencia en Vacaciones/CTS/Escolaridad debe ser exactamente la tasa
    // diaria de cada beneficio (10%/15%/jornal-12-x-hijos).
    expect(Number(detalleCon.vacaciones) - Number(detalleSin.vacaciones)).toBeCloseTo(
      Math.round(jornalDiario * 0.1 * 100) / 100,
      2
    );
    expect(Number(detalleCon.cts) - Number(detalleSin.cts)).toBeCloseTo(Math.round(jornalDiario * 0.15 * 100) / 100, 2);
    // Migracion 048 (039 original, reconstruida desde backend_dist, ver
    // RECONSTRUCCION_BRECHAS.md): dias_dominical_no_laborado ya existe y
    // entra a la formula de Escolaridad (calcularAsignacionEscolar). En este
    // escenario puntual (ninguno de los 2 contratos tiene domingo trabajado
    // ni fila cargada el domingo del periodo) el prorrateo semanal da el
    // mismo resultado para ambos, asi que la diferencia observada sigue
    // siendo exactamente 1 dia de descanso medico computable - confirmado
    // corriendo esta prueba tras la reconstruccion.
    expect(Number(detalleCon.asignacion_escolaridad) - Number(detalleSin.asignacion_escolaridad)).toBeCloseTo(
      (jornalDiario / 12) * 3,
      2
    );
  });
});

// ===========================================================================
// 3) Tope de 60 dias/año: se siembra directo por SQL (bypassing el tope de
//    20 dias/año ya existente en la UI, mas estricto) para probar la logica
//    del tope en aislamiento - hoy no se puede alcanzar 60 dias/año en un
//    solo contrato via la UI normal (el PUT /tareo-diario bloquea cualquier
//    request que sume mas de 20 dias/año, ver subsidio_enfermedad_paternidad.
//    test.ts). Por eso TODOS los dias de estas pruebas (los "ya acreditados"
//    y los del periodo actual) se insertan directo en tareo_diario por SQL,
//    y la recalculacion de asistencia_periodo se dispara con el DELETE de un
//    dia "descartable" sembrado aparte (esa ruta llama a
//    recalcularAsistenciaDesdeTareoDiario sin la validacion de 20 dias/año,
//    a diferencia del PUT).
function fechasConsecutivas(inicioISO: string, cantidad: number): string[] {
  const inicio = new Date(inicioISO + "T00:00:00Z");
  return Array.from({ length: cantidad }, (_, i) => {
    const d = new Date(inicio);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

async function sembrarSubsidioEnfermedad(periodoId: number, contratoId: number, fechas: string[]) {
  for (const fecha of fechas) {
    await pool.query(
      `INSERT INTO tareo_diario (periodo_id, contrato_id, fecha, tipo_dia_especial)
       VALUES ($1, $2, $3, 'DESCANSO_MEDICO')`,
      [periodoId, contratoId, fecha]
    );
  }
}

// Dispara recalcularAsistenciaDesdeTareoDiario (no exportada) sin pasar por
// la validacion de 20 dias/año del PUT: se siembra un dia "descartable" (0
// horas, sin marca especial) dentro del rango del periodo y se borra via la
// ruta DELETE, que recalcula pero no valida el tope de 20 dias/año.
async function recalcularViaDeleteDescartable(periodoId: number, contratoId: number, fechaDescartable: string) {
  await pool.query(
    `INSERT INTO tareo_diario (periodo_id, contrato_id, fecha) VALUES ($1, $2, $3)`,
    [periodoId, contratoId, fechaDescartable]
  );
  const r = await request(app)
    .delete(`/api/periodos/${periodoId}/tareo-diario/${contratoId}/${fechaDescartable}`)
    .set(auth());
  expect(r.status).toBe(204);
}

describe("Tope de 60 dias/año de dias_subsidio_enfermedad_computable (migracion 032)", () => {
  it("un contrato con 59 dias YA acreditados en otros periodos del mismo año solo puede computar 1 dia mas, aunque tenga 3 dias de descanso medico en este periodo", async () => {
    const periodoAnterior = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
       VALUES (2026, 8, 'SEMANAL', '2026-08-10', '2026-08-16', 7) RETURNING id`
    );
    const periodoAnteriorId = periodoAnterior.rows[0].id as number;
    periodosCreados.push(periodoAnteriorId);

    const periodoActual = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
       VALUES (2026, 8, 'SEMANAL', '2026-08-17', '2026-08-23', 7) RETURNING id`
    );
    const periodoActualId = periodoActual.rows[0].id as number;
    periodosCreados.push(periodoActualId);

    const empleado = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('1', '77794003', 'PRUEBA TOPE 60 DIAS', 0) RETURNING id`
    );
    const empleadoId = empleado.rows[0].id as number;
    empleadosCreados.push(empleadoId);
    const contrato = await pool.query(
      `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
       VALUES ($1, 'Proyecto Dias Computables', 'OPERARIO', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
      [empleadoId]
    );
    const contratoId = contrato.rows[0].id as number;

    // 59 dias de DESCANSO_MEDICO ya "acreditados" en el año 2026, en un
    // periodo previo (fuera del rango del periodo actual) - simula que ya se
    // guardaron en un calculo anterior.
    await sembrarSubsidioEnfermedad(periodoAnteriorId, contratoId, fechasConsecutivas("2026-01-01", 59));

    // 3 dias mas de descanso medico en el periodo ACTUAL (agosto 17-23) -
    // como ya hay 59 acreditados en el año, solo 1 de estos 3 puede contar
    // como computable (60 - 59 = 1); los otros 2 quedan sin contar para
    // estos 4 beneficios (aunque SI se siguen pagando como subsidio, eso no
    // cambia con esta migracion).
    await sembrarSubsidioEnfermedad(periodoActualId, contratoId, ["2026-08-19", "2026-08-20", "2026-08-21"]);
    await recalcularViaDeleteDescartable(periodoActualId, contratoId, "2026-08-22");

    const asistencia = (
      await pool.query("SELECT * FROM asistencia_periodo WHERE periodo_id = $1 AND contrato_id = $2", [
        periodoActualId,
        contratoId,
      ])
    ).rows[0];
    // Migracion 038: el cupo normal de 20 dias/año ya estaba agotado por los
    // 59 dias sembrados antes - los 3 dias de este periodo caen 100% en
    // dias_incapacidad_enfermedad (no en dias_subsidio_enfermedad). Esta
    // division de "pago" (20/21+) es un eje totalmente distinto del tope de
    // 60 dias "computables" para gratificacion/vacaciones/CTS que prueba
    // este describe, y no lo afecta.
    expect(Number(asistencia.dias_subsidio_enfermedad)).toBe(0);
    expect(Number(asistencia.dias_incapacidad_enfermedad)).toBe(3);
    // El tope: solo 1 de los 3 dias de este periodo puede computar, porque
    // ya habia 59 acreditados en el año.
    expect(Number(asistencia.dias_subsidio_enfermedad_computable)).toBe(1);
  });

  it("un contrato con 60+ dias YA acreditados en el año no puede computar ningun dia mas en el periodo actual", async () => {
    const periodoAnterior = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
       VALUES (2026, 8, 'SEMANAL', '2026-08-24', '2026-08-30', 7) RETURNING id`
    );
    const periodoAnteriorId = periodoAnterior.rows[0].id as number;
    periodosCreados.push(periodoAnteriorId);

    const periodoActual = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
       VALUES (2026, 9, 'SEMANAL', '2026-09-01', '2026-09-07', 7) RETURNING id`
    );
    const periodoActualId = periodoActual.rows[0].id as number;
    periodosCreados.push(periodoActualId);

    const empleado = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('1', '77794004', 'PRUEBA TOPE 60 DIAS AGOTADO', 0) RETURNING id`
    );
    const empleadoId = empleado.rows[0].id as number;
    empleadosCreados.push(empleadoId);
    const contrato = await pool.query(
      `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
       VALUES ($1, 'Proyecto Dias Computables', 'OPERARIO', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
      [empleadoId]
    );
    const contratoId = contrato.rows[0].id as number;

    await sembrarSubsidioEnfermedad(periodoAnteriorId, contratoId, fechasConsecutivas("2026-01-01", 60));
    await sembrarSubsidioEnfermedad(periodoActualId, contratoId, ["2026-09-02"]);
    await recalcularViaDeleteDescartable(periodoActualId, contratoId, "2026-09-03");

    const asistencia = (
      await pool.query("SELECT * FROM asistencia_periodo WHERE periodo_id = $1 AND contrato_id = $2", [
        periodoActualId,
        contratoId,
      ])
    ).rows[0];
    // Migracion 038: cupo normal ya agotado (60 dias ya acreditados) - el
    // dia de este periodo cae en dias_incapacidad_enfermedad, no en
    // dias_subsidio_enfermedad. El tope de 60 dias computables (eje
    // independiente) sigue en 0, como antes.
    expect(Number(asistencia.dias_subsidio_enfermedad)).toBe(0);
    expect(Number(asistencia.dias_incapacidad_enfermedad)).toBe(1);
    expect(Number(asistencia.dias_subsidio_enfermedad_computable)).toBe(0);
  });
});
