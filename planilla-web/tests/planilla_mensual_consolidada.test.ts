// Pruebas de "Planilla Mensual Consolidada" (Ronda E): junta el Tareo Diario
// de todas las quincenas/semanas de un {proyecto, anio, mes} en un solo
// calculo mensual, para poder declarar PLAME/AFPnet/Asiento Contable por MES
// CALENDARIO en vez de por periodo de pago. Ver src/planillaMensual.ts y la
// seccion "Ronda E" del plan del proyecto para el diseño completo.
//
// Puntos criticos que este archivo verifica en particular (los que el diseño
// senala como faciles de arruinar si se les pasa el tipoPeriodo equivocado o
// se suman/duplican montos fijos):
//   - dias_trabajados/horas de 2 quincenas del MISMO mes se SUMAN.
//   - seguro_vida (EsSalud+Vida) sale ENTERO (divisor MENSUAL=1), no la mitad
//     ni un cuarto - si se pasara QUINCENAL/SEMANAL aqui, se pagaria de menos.
//   - un contrato NO de construccion civil (EMPLEADO) se excluye del todo.
//   - avisos_recalculo_posterior se dispara si una quincena se recalculo
//     DESPUES de la ultima consolidacion (foto historica, no se actualiza sola).
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";
import { consolidarPlanillaMensual, obtenerPlanillaMensual, rangoDelMes } from "../src/planillaMensual";
import { ErrorValidacion } from "../src/validaciones";

const PROYECTO = "Proyecto A"; // ya sembrado por globalSetup.ts
const JORNAL_PEON_AGO_2026 = 66.5; // valor de prueba, distinto al de febrero (ya sembrado en schema.sql)

let tokenAdmin: string;
let adminUserId: number;
const empleadosCreados: number[] = [];
const periodosCreados: number[] = [];

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const idResult = await pool.query("SELECT id FROM usuarios WHERE correo = 'admin@prueba.local'");
  adminUserId = idResult.rows[0].id as number;

  await pool.query(
    `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
     VALUES (2026, 8, 'PEON', $1, 0.30, 0, 8.60, 12.68)
     ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`,
    [JORNAL_PEON_AGO_2026]
  );
  await pool.query(
    `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
     VALUES (2026, 8, 'INTEGRA', 0.0155, 0.0137, 0.10)
     ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`
  );

  // Migracion 040: los limites configurables de tareo (max 8h/dia lun-vie,
  // 5h/dia sabado) no son el objeto de esta prueba - se relajan aqui para
  // no romper fixtures existentes con fechas/horas anteriores a esta
  // migracion. Se restauran en afterAll.
  await pool.query(
    "UPDATE limites_tareo SET horas_max_lun_vie = 24, minutos_max_lun_vie = 59, horas_max_sabado = 24, minutos_max_sabado = 59 WHERE id = 1"
  );
});

afterAll(async () => {
  await pool.query(
    "UPDATE limites_tareo SET horas_max_lun_vie = 8, minutos_max_lun_vie = 30, horas_max_sabado = 5, minutos_max_sabado = 30 WHERE id = 1"
  );
  await pool.query("DELETE FROM detalle_planilla_mensual WHERE contrato_id = ANY(SELECT id FROM contratos WHERE proyecto = $1 AND empleado_id = ANY($2::int[]))", [PROYECTO, empleadosCreados]).catch(() => {});
  await pool.query("DELETE FROM planilla_mensual WHERE proyecto = $1 AND anio = 2026 AND mes = 8", [PROYECTO]);
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
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2026 AND mes = 8 AND categoria = 'PEON'");
  await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = 2026 AND mes = 8");
  await pool.end();
});

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

async function crearPeriodoQuincenal(quincena: 1 | 2, fechaInicio: string, fechaFin: string, diasPeriodo: number): Promise<number> {
  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES (2026, 8, $1, 'QUINCENAL', $2, $3, $4, $5) RETURNING id`,
    [quincena, fechaInicio, fechaFin, diasPeriodo, PROYECTO]
  );
  const id = p.rows[0].id as number;
  periodosCreados.push(id);
  return id;
}

// El indice unico periodos_planilla_periodo_unico solo deja 2 huecos
// QUINCENAL por {proyecto,anio,mes} (quincena 1 y 2, ya usados por la
// primera prueba de integracion) - las pruebas que necesitan SU PROPIO
// periodo aislado usan SEMANAL en su lugar (unico por rango de fechas, sin
// ese limite), tal como ya conviven ambos tipos en produccion.
async function crearPeriodoSemanal(fechaInicio: string, fechaFin: string, diasPeriodo: number): Promise<number> {
  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES (2026, 8, 'SEMANAL', $1, $2, $3, $4) RETURNING id`,
    [fechaInicio, fechaFin, diasPeriodo, PROYECTO]
  );
  const id = p.rows[0].id as number;
  periodosCreados.push(id);
  return id;
}

async function crearContrato(dni: string, nombre: string, categoria: string, opts: { essaludVida?: boolean } = {}): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, 0) RETURNING id`,
    [dni, nombre]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado, essalud_vida, sueldo_base)
     VALUES ($1, $2, $3, 'ONP', '2026-01-01', 'HABIL', $4, $5) RETURNING id`,
    [empleadoId, PROYECTO, categoria, opts.essaludVida ?? false, categoria === "EMPLEADO" ? 2000 : null]
  );
  return c.rows[0].id as number;
}

async function cargarTareoDiario(periodoId: number, contratoId: number, fechas: string[]) {
  const dias = fechas.map((fecha) => ({ fecha, horas_normales: 8, minutos_normales: 0 }));
  const r = await request(app)
    .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
    .set(auth())
    .send({ dias });
  expect(r.status).toBe(204);
}

describe("rangoDelMes (funcion pura)", () => {
  it("agosto 2026 (31 dias) -> 2026-08-01 .. 2026-08-31", () => {
    expect(rangoDelMes(2026, 8)).toEqual({ desde: "2026-08-01", hasta: "2026-08-31", dias: 31 });
  });

  it("febrero 2026 (no bisiesto, 28 dias) -> 2026-02-01 .. 2026-02-28", () => {
    expect(rangoDelMes(2026, 2)).toEqual({ desde: "2026-02-01", hasta: "2026-02-28", dias: 28 });
  });
});

describe("consolidarPlanillaMensual: integracion con Tareo Diario real", () => {
  it("sin ningun periodo QUINCENAL/SEMANAL de ese proyecto en ese mes -> rechaza con ErrorValidacion", async () => {
    await expect(consolidarPlanillaMensual("Proyecto Inexistente XYZ", 2026, 8, adminUserId)).rejects.toBeInstanceOf(
      ErrorValidacion
    );
  });

  it("2 quincenas del mismo mes: suma dias_trabajados y calcula seguro_vida ENTERO (divisor MENSUAL, no partido)", async () => {
    const q1 = await crearPeriodoQuincenal(1, "2026-08-01", "2026-08-15", 15);
    const q2 = await crearPeriodoQuincenal(2, "2026-08-16", "2026-08-31", 16);
    const contratoId = await crearContrato("88880001", "PRUEBA CONSOLIDACION MENSUAL", "PEON", { essaludVida: true });

    // 10 dias trabajados en Q1, 12 dias trabajados en Q2 = 22 dias en el mes.
    await cargarTareoDiario(q1, contratoId, [
      "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07",
      "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
    ]);
    await cargarTareoDiario(q2, contratoId, [
      "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21",
      "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30",
    ]);

    const resultado = await consolidarPlanillaMensual(PROYECTO, 2026, 8, adminUserId);
    expect(resultado.errores).toEqual([]);
    expect(resultado.trabajadores_consolidados).toBe(1);
    expect(resultado.periodos_incluidos).toHaveLength(2);
    expect(resultado.avisos_recalculo_posterior).toEqual([]);

    const consolidado = await obtenerPlanillaMensual(PROYECTO, 2026, 8);
    expect(consolidado).not.toBeNull();
    const fila = consolidado!.detalle.find((f: any) => f.contrato_id === contratoId);
    expect(fila).toBeDefined();

    expect(Number(fila.dias_trabajados)).toBeCloseTo(22);
    expect(Number(fila.sueldo_basico)).toBeCloseTo(22 * JORNAL_PEON_AGO_2026);
    expect(Number(fila.jornal_diario)).toBeCloseTo(JORNAL_PEON_AGO_2026);

    // Punto critico: seguro_vida_ley = 5.00 (parametros_normativos 2026),
    // pasado con tipoPeriodo="MENSUAL" -> divisor 1 -> se paga ENTERO una
    // sola vez en la consolidacion (NO 2.50, que seria el divisor QUINCENAL
    // aplicado por error a los 2 periodos y sumado, y NO 10.00 si se sumara
    // el monto ya completo de cada quincena por separado).
    expect(Number(fila.seguro_vida)).toBeCloseTo(5.0);
  });

  it("re-consolidar el mismo mes reemplaza el detalle anterior (foto nueva, no se duplica)", async () => {
    const resultado = await consolidarPlanillaMensual(PROYECTO, 2026, 8, adminUserId);
    const consolidado = await obtenerPlanillaMensual(PROYECTO, 2026, 8);
    // Sigue habiendo exactamente 1 fila por contrato, no 2 (no se duplico al
    // volver a consolidar).
    const filasDelContrato = consolidado!.detalle.filter((f: any) => f.contrato_id !== undefined);
    expect(filasDelContrato.length).toBe(resultado.trabajadores_consolidados);
  });

  it("un contrato EMPLEADO con tareo diario en un periodo QUINCENAL/SEMANAL (caso anomalo) queda excluido - su periodo MENSUAL ya lo cubre por su cuenta", async () => {
    const semanal = await crearPeriodoSemanal("2026-08-03", "2026-08-04", 2);
    const contratoEmpleadoId = await crearContrato("88880002", "PRUEBA EMPLEADO NO APLICA", "EMPLEADO");
    // Carga tareo diario aunque en la practica un EMPLEADO no deberia tener
    // periodo QUINCENAL/SEMANAL - se prueba igual que, si pasara, no se consolida.
    await cargarTareoDiario(semanal, contratoEmpleadoId, ["2026-08-03", "2026-08-04"]);

    const resultado = await consolidarPlanillaMensual(PROYECTO, 2026, 8, adminUserId);
    expect(resultado.errores).toEqual([]);
    const consolidado = await obtenerPlanillaMensual(PROYECTO, 2026, 8);
    const filaEmpleado = consolidado!.detalle.find((f: any) => f.contrato_id === contratoEmpleadoId);
    expect(filaEmpleado).toBeUndefined();
  });

  it("avisos_recalculo_posterior: si una quincena se recalcula DESPUES de la ultima consolidacion, avisa (no bloquea ni se actualiza sola)", async () => {
    const semanal = await crearPeriodoSemanal("2026-08-05", "2026-08-06", 2);
    const contratoId = await crearContrato("88880003", "PRUEBA AVISO RECALCULO", "PEON");
    await cargarTareoDiario(semanal, contratoId, ["2026-08-05", "2026-08-06"]);

    // Primera consolidacion: incluye este nuevo periodo por primera vez, sin
    // avisos todavia para EL (no hay consolidacion previa que lo cubriera).
    const primera = await consolidarPlanillaMensual(PROYECTO, 2026, 8, adminUserId);
    expect(primera.errores).toEqual([]);
    expect(primera.avisos_recalculo_posterior).toEqual([]);

    // Simula que ese periodo se volvio a calcular DESPUES de la
    // consolidacion (calcular de verdad via /calcular, que siempre deja
    // calculado_en = now()).
    const calc = await request(app).post(`/api/periodos/${semanal}/calcular`).set(auth()).send({});
    expect(calc.status).toBe(200);

    const segunda = await consolidarPlanillaMensual(PROYECTO, 2026, 8, adminUserId);
    expect(segunda.avisos_recalculo_posterior.length).toBeGreaterThan(0);
    expect(segunda.avisos_recalculo_posterior.some((a) => a.periodo_id === semanal)).toBe(true);
  });
});

// Caso real reportado por el usuario en produccion (21/09/2026): una
// quincena etiquetada "Agosto" en Periodos en realidad va del 31/08 al
// 13/09 (13 de sus 14 dias son de setiembre), y en Periodos existe ademas
// una quincena SI etiquetada "Setiembre" (14/09 al 27/09). El usuario
// reporto que al generar el archivo de AFPnet, agosto salia bien pero
// setiembre salia vacio - la sospecha era que la consolidacion de
// setiembre no estaba encontrando la quincena etiquetada "Agosto" (aunque
// case la totalidad de sus dias son de setiembre). Esta prueba reproduce
// exactamente esas 2 quincenas y confirma que obtenerPeriodosDelMes/
// consolidarPlanillaMensual SI las junta correctamente por FECHA (no por la
// etiqueta anio/mes del periodo, que aqui es enganosa a proposito).
describe("consolidarPlanillaMensual: quincena que cruza de mes (caso real 21/09/2026)", () => {
  const contratosCruceMes: number[] = [];
  const periodosCruceMes: number[] = [];

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
       VALUES (2026, 9, 'PEON', 66.5, 0.30, 0, 8.60, 12.68)
       ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`
    );
    await pool.query(
      `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
       VALUES (2026, 9, 'INTEGRA', 0.0155, 0.0137, 0.10)
       ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM detalle_planilla_mensual WHERE contrato_id = ANY($1::int[])", [contratosCruceMes]);
    await pool.query("DELETE FROM planilla_mensual WHERE proyecto = $1 AND anio = 2026 AND mes = 9", [PROYECTO]);
    for (const periodoId of periodosCruceMes) {
      await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [periodoId]);
      await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [periodoId]);
      await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
    }
    await pool.query("DELETE FROM contratos WHERE id = ANY($1::int[])", [contratosCruceMes]);
    await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2026 AND mes = 9 AND categoria = 'PEON'");
    await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = 2026 AND mes = 9");
  });

  it("setiembre consolida la quincena etiquetada 'Agosto' (31/08-13/09) MAS la etiquetada 'Setiembre' (14/09-27/09), sin quedar vacio", async () => {
    // Quincena etiquetada "Agosto 2026" pero con fechas mayormente de
    // setiembre - igual que el caso real (imagen de Periodos adjuntada).
    // quincena=NULL (en vez de 2) solo para no chocar con el indice unico
    // de {anio,mes,tipo,quincena,proyecto} ya ocupado por otra prueba de
    // este mismo archivo (Q1/Q2 de agosto) - no cambia lo que se prueba
    // aqui, que es el filtro por FECHA, no por quincena.
    const pAgostoEtiqueta = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto, estado)
       VALUES (2026, 8, NULL, 'QUINCENAL', '2026-08-31', '2026-09-13', 14, $1, 'CALCULADO') RETURNING id`,
      [PROYECTO]
    );
    const periodoAgostoEtiqueta = pAgostoEtiqueta.rows[0].id as number;
    periodosCruceMes.push(periodoAgostoEtiqueta);

    // Quincena etiquetada "Setiembre 2026", fechas 100% de setiembre.
    const pSetiembre = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto, estado)
       VALUES (2026, 9, 1, 'QUINCENAL', '2026-09-14', '2026-09-27', 14, $1, 'CALCULADO') RETURNING id`,
      [PROYECTO]
    );
    const periodoSetiembre = pSetiembre.rows[0].id as number;
    periodosCruceMes.push(periodoSetiembre);

    const contratoId = await crearContrato("88880099", "PRUEBA CRUCE DE MES SETIEMBRE", "PEON");
    contratosCruceMes.push(contratoId);

    // Tareo cargado en AMBAS quincenas: 1 dia de agosto + 12 dias de
    // setiembre en la quincena "Agosto", mas 10 dias en la quincena
    // "Setiembre" - solo los dias de SETIEMBRE deben contar al consolidar
    // setiembre (el 31/08 debe quedar fuera, es de la consolidacion de
    // agosto, no de esta).
    await cargarTareoDiario(periodoAgostoEtiqueta, contratoId, [
      "2026-08-31", // no debe contar para la consolidacion de SETIEMBRE
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
    await cargarTareoDiario(periodoSetiembre, contratoId, [
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]);

    const resultado = await consolidarPlanillaMensual(PROYECTO, 2026, 9, adminUserId);

    expect(resultado.errores).toEqual([]);
    // Las 2 quincenas deben aparecer como incluidas, aunque una este
    // etiquetada "Agosto" - se buscan por fecha, no por la etiqueta.
    expect(resultado.periodos_incluidos.map((p) => p.id).sort()).toEqual(
      [periodoAgostoEtiqueta, periodoSetiembre].sort()
    );
    // El punto central de esta prueba: setiembre NO debe salir vacio.
    expect(resultado.trabajadores_consolidados).toBe(1);

    const consolidado = await obtenerPlanillaMensual(PROYECTO, 2026, 9);
    expect(consolidado).not.toBeNull();
    // 11 dias de setiembre en la quincena "Agosto" (se excluye el 31/08) + 10
    // dias en la quincena "Setiembre" = 21 dias trabajados en total.
    expect(Number(consolidado!.detalle[0].dias_trabajados)).toBe(21);
  });
});
