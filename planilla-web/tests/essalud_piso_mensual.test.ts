// Pruebas de la Ronda 4 ("piso de EsSalud mensual"), migracion_044.
//
// El aporte a EsSalud (9% de la remuneracion afecta) no puede ser menor, en
// un mes calendario, al 9% de la RMV vigente ese mes - pero el sistema paga
// por quincena/semana, no por mes. Este archivo verifica:
//   1) calcularAjustePisoEssaludMensual / calcularPisoEssaludMensual
//      (funciones puras, motorCalculo.ts) - sin base de datos.
//   2) La reconciliacion real via POST /:id/calcular (ajustarPisoEssaludDelMes,
//      routes/planilla.ts): suma essalud_base de todos los periodos del
//      mismo contrato en el mismo mes calendario, ajusta el ultimo si hace
//      falta, y CORRIGE EN CASCADA un periodo YA calculado si se recalcula
//      otro periodo del mismo mes despues (decision confirmada por el
//      usuario: cascada automatica, no solo un aviso).
//   3) RMV mensual (rmv_mensual): un mes con override usa ese valor tanto
//      para el piso de EsSalud como para la Asignacion Familiar.
//   4) El mismo piso, aplicado de forma directa (sin cascada, ya que es un
//      solo calculo por mes) dentro de Planilla Mensual Consolidada.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";
import { calcularAjustePisoEssaludMensual, calcularPisoEssaludMensual } from "../src/motorCalculo";
import { consolidarPlanillaMensual, obtenerPlanillaMensual } from "../src/planillaMensual";
import { ParametrosNormativos } from "../src/tipos";

const PROYECTO = "Proyecto Piso EsSalud Test";

// parametros_normativos es POR ANIO (ver obtenerParametros en routes/planilla.ts)
// y schema.sql solo siembra el anio real de produccion - los periodos de
// prueba de este archivo usan 2027 (anio dedicado, igual criterio que
// periodo_cruza_mes.test.ts), asi que hace falta sembrar sus parametros aqui.
// RMV=1130/tasa_essalud=0.09 -> piso legal de prueba = 101.70, igual que en
// produccion (ver notas del correo/plan de esta ronda).
const ANIO_PRUEBA_PARAMETROS = 2027;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO parametros_normativos (anio, uit, remuneracion_minima_vital, tasa_essalud, tasa_onp, tasa_senati, tasa_conafovicer, tasa_sctr_salud, asignacion_familiar, seguro_vida_ley)
     VALUES ($1, 5350, 1130.00, 0.09, 0.13, 0.0075, 0.02, 0.0155, 113.00, 5.00)
     ON CONFLICT (anio) DO NOTHING`,
    [ANIO_PRUEBA_PARAMETROS]
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM parametros_normativos WHERE anio = $1", [ANIO_PRUEBA_PARAMETROS]);
});

describe("calcularPisoEssaludMensual (pura)", () => {
  it("9% de la RMV configurada", () => {
    const parametros = { remuneracion_minima_vital: 1130, tasa_essalud: 0.09 } as ParametrosNormativos;
    expect(calcularPisoEssaludMensual(parametros)).toBeCloseTo(101.7, 2);
  });
});

describe("calcularAjustePisoEssaludMensual (pura)", () => {
  it("un solo periodo por debajo del piso: absorbe todo el ajuste", () => {
    const resultado = calcularAjustePisoEssaludMensual(
      [{ periodoId: 1, essaludBase: 10, fechaFin: "2027-01-07" }],
      101.7
    );
    expect(resultado.get(1)).toBeCloseTo(101.7, 2);
  });

  it("suma de 2 periodos por debajo del piso: el ajuste completo va al de fecha_fin mas reciente", () => {
    const resultado = calcularAjustePisoEssaludMensual(
      [
        { periodoId: 1, essaludBase: 2, fechaFin: "2027-01-07" },
        { periodoId: 2, essaludBase: 3, fechaFin: "2027-01-14" },
      ],
      101.7
    );
    expect(resultado.get(1)).toBeCloseTo(2, 2); // anterior: su propia base, sin ajuste
    expect(resultado.get(2)).toBeCloseTo(99.7, 2); // 3 + (101.7 - 5)
    expect((resultado.get(1) ?? 0) + (resultado.get(2) ?? 0)).toBeCloseTo(101.7, 2);
  });

  it("suma ya por encima del piso: ningun periodo se ajusta", () => {
    const resultado = calcularAjustePisoEssaludMensual(
      [
        { periodoId: 1, essaludBase: 60, fechaFin: "2027-01-07" },
        { periodoId: 2, essaludBase: 60, fechaFin: "2027-01-14" },
      ],
      101.7
    );
    expect(resultado.get(1)).toBeCloseTo(60, 2);
    expect(resultado.get(2)).toBeCloseTo(60, 2);
  });

  it("sin ningun aporte base en el mes: no se fuerza el piso (nadie trabajo ese mes)", () => {
    const resultado = calcularAjustePisoEssaludMensual(
      [
        { periodoId: 1, essaludBase: 0, fechaFin: "2027-01-07" },
        { periodoId: 2, essaludBase: 0, fechaFin: "2027-01-14" },
      ],
      101.7
    );
    expect(resultado.get(1)).toBe(0);
    expect(resultado.get(2)).toBe(0);
  });

  it("recalculo fuera de orden: mover el ajuste de un periodo a otro cuando cambia cual es el ultimo calculado", () => {
    // Solo P1 calculado todavia (P2 aun no existe en el conjunto) -> P1 es "el ultimo".
    const soloP1 = calcularAjustePisoEssaludMensual([{ periodoId: 1, essaludBase: 2, fechaFin: "2027-01-07" }], 101.7);
    expect(soloP1.get(1)).toBeCloseTo(101.7, 2);

    // Ahora aparece P2 (posterior) - el ajuste se recalcula desde cero y se
    // traslada a P2 (mas reciente); P1 vuelve a su propia base.
    const conP2 = calcularAjustePisoEssaludMensual(
      [
        { periodoId: 1, essaludBase: 2, fechaFin: "2027-01-07" },
        { periodoId: 2, essaludBase: 3, fechaFin: "2027-01-14" },
      ],
      101.7
    );
    expect(conP2.get(1)).toBeCloseTo(2, 2);
    expect(conP2.get(2)).toBeCloseTo(99.7, 2);
  });
});

describe("Piso de EsSalud mensual: integracion via POST /:id/calcular", () => {
  let tokenAdmin: string;
  const periodosCreados: number[] = [];
  const empleadosCreados: number[] = [];
  const contratosCreados: number[] = [];
  const mesesSembrados: { anio: number; mes: number }[] = [];

  function auth() {
    return { Authorization: `Bearer ${tokenAdmin}` };
  }

  async function sembrarMes(anio: number, mes: number, jornalBasico: number) {
    await pool.query(
      `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
       VALUES ($1, $2, 'PEON', $3, 0, 0, 0, 0)
       ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`,
      [anio, mes, jornalBasico]
    );
    await pool.query(
      `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
       VALUES ($1, $2, 'INTEGRA', 0.0155, 0.0137, 0.10)
       ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`,
      [anio, mes]
    );
    mesesSembrados.push({ anio, mes });
  }

  async function crearContratoPeon(dni: string, nombre: string): Promise<number> {
    const e = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('1', $1, $2, 0) RETURNING id`,
      [dni, nombre]
    );
    empleadosCreados.push(e.rows[0].id);
    const c = await pool.query(
      `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
       VALUES ($1, $2, 'PEON', 'ONP', '2020-01-01', 'HABIL') RETURNING id`,
      [e.rows[0].id, PROYECTO]
    );
    contratosCreados.push(c.rows[0].id);
    return c.rows[0].id;
  }

  async function crearContratoEmpleado(dni: string, nombre: string, sueldoBase: number, numeroHijos: number): Promise<number> {
    const e = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('1', $1, $2, $3) RETURNING id`,
      [dni, nombre, numeroHijos]
    );
    empleadosCreados.push(e.rows[0].id);
    const c = await pool.query(
      `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado, sueldo_base)
       VALUES ($1, $2, 'EMPLEADO', 'ONP', '2020-01-01', 'HABIL', $3) RETURNING id`,
      [e.rows[0].id, PROYECTO, sueldoBase]
    );
    contratosCreados.push(c.rows[0].id);
    return c.rows[0].id;
  }

  async function crearPeriodoSemanal(anio: number, mes: number, fechaInicio: string, fechaFin: string, diasPeriodo: number): Promise<number> {
    const p = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
       VALUES ($1, $2, 'SEMANAL', $3, $4, $5, $6) RETURNING id`,
      [anio, mes, fechaInicio, fechaFin, diasPeriodo, PROYECTO]
    );
    periodosCreados.push(p.rows[0].id);
    return p.rows[0].id;
  }

  async function crearPeriodoMensual(anio: number, mes: number, fechaInicio: string, fechaFin: string, diasPeriodo: number): Promise<number> {
    const p = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
       VALUES ($1, $2, 'MENSUAL', $3, $4, $5, $6) RETURNING id`,
      [anio, mes, fechaInicio, fechaFin, diasPeriodo, PROYECTO]
    );
    periodosCreados.push(p.rows[0].id);
    return p.rows[0].id;
  }

  async function cargarTareoDiario(periodoId: number, contratoId: number, fechas: string[]) {
    // limites_tareo (schema.sql) limita "Jornal normal" a 5h en sabado (8h30
    // de lunes a viernes) - se respeta ese tope aqui para no chocar con esa
    // validacion (PUT /tareo-diario/:contratoId) al sembrar dias de prueba.
    const dias = fechas.map((fecha) => {
      const esSabado = new Date(`${fecha}T00:00:00Z`).getUTCDay() === 6;
      return { fecha, horas_normales: esSabado ? 5 : 8, minutos_normales: 0 };
    });
    const r = await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
      .set(auth())
      .send({ dias });
    expect(r.status).toBe(204);
  }

  async function calcular(periodoId: number) {
    const r = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth());
    expect(r.status).toBe(200);
    return r.body as {
      avisos_essalud: { contrato_id: number; dni: string; nombre: string; mensaje: string }[];
    };
  }

  async function leerDetalle(periodoId: number, contratoId: number) {
    const r = await pool.query(
      "SELECT essalud, essalud_base, asignacion_familiar FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2",
      [periodoId, contratoId]
    );
    return {
      essalud: Number(r.rows[0].essalud),
      essalud_base: Number(r.rows[0].essalud_base),
      asignacion_familiar: Number(r.rows[0].asignacion_familiar),
    };
  }

  beforeAll(async () => {
    const r = await request(app).post("/api/auth/login").send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
    tokenAdmin = r.body.token as string;
  });

  afterAll(async () => {
    for (const id of periodosCreados) {
      await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [id]);
      await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [id]);
      await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [id]);
      await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [id]);
    }
    for (const id of contratosCreados) {
      await pool.query("DELETE FROM contratos WHERE id = $1", [id]);
    }
    for (const id of empleadosCreados) {
      await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
    }
    for (const { anio, mes } of mesesSembrados) {
      await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = $1 AND mes = $2 AND categoria = 'PEON'", [anio, mes]);
      await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = $1 AND mes = $2", [anio, mes]);
      await pool.query("DELETE FROM rmv_mensual WHERE anio = $1 AND mes = $2", [anio, mes]);
    }
  });

  it("un solo periodo del mes, por debajo del piso: se ajusta solo (caso trivial)", async () => {
    await sembrarMes(2027, 3, 5); // jornal muy bajo a proposito, para que essalud_base quede bien por debajo del piso
    const contratoId = await crearContratoPeon("90000001", "PRUEBA PISO SOLO");
    const p1 = await crearPeriodoSemanal(2027, 3, "2027-03-01", "2027-03-07", 7);
    await cargarTareoDiario(p1, contratoId, ["2027-03-01", "2027-03-02"]); // 2 dias

    await calcular(p1);
    const d1 = await leerDetalle(p1, contratoId);
    // No se fija un valor exacto de essalud_base: la remuneracion afecta a
    // EsSalud incluye, ademas del jornal, el dominical proporcional (Ronda 2)
    // segun como caigan los dias trabajados en la semana - lo que importa
    // aqui es que quede por debajo del piso.
    expect(d1.essalud_base).toBeGreaterThan(0);
    expect(d1.essalud_base).toBeLessThan(101.7);
    expect(d1.essalud).toBeCloseTo(101.7, 2); // unico periodo del mes -> absorbe todo

    const p2 = await crearPeriodoSemanal(2027, 3, "2027-03-08", "2027-03-14", 7);
    await cargarTareoDiario(p2, contratoId, ["2027-03-08", "2027-03-09", "2027-03-10"]); // 3 dias

    const respuestaP2 = await calcular(p2);
    const d1DespuesDeP2 = await leerDetalle(p1, contratoId);
    const d2 = await leerDetalle(p2, contratoId);

    // P1 (anterior) vuelve a su propia base - el ajuste se traslada a P2 (mas reciente).
    expect(d1DespuesDeP2.essalud).toBeCloseTo(d1.essalud_base, 2);
    expect(d2.essalud_base).toBeGreaterThan(0);
    expect(d2.essalud_base).toBeLessThan(101.7);
    expect(d1DespuesDeP2.essalud + d2.essalud).toBeCloseTo(101.7, 2);
    // El aviso de la respuesta de calcular P2 debe mencionar que se ajusto OTRO periodo (P1).
    expect(respuestaP2.avisos_essalud.length).toBeGreaterThan(0);
    expect(respuestaP2.avisos_essalud[0].contrato_id).toBe(contratoId);
  });

  it("cascada: recalcular el periodo ANTERIOR corrige solo, automaticamente, el aporte del periodo POSTERIOR ya calculado", async () => {
    await sembrarMes(2027, 8, 5);
    const contratoId = await crearContratoPeon("90000002", "PRUEBA CASCADA");
    const p1 = await crearPeriodoSemanal(2027, 8, "2027-08-01", "2027-08-07", 7);
    const p2 = await crearPeriodoSemanal(2027, 8, "2027-08-08", "2027-08-14", 7);

    await cargarTareoDiario(p1, contratoId, ["2027-08-01", "2027-08-02"]); // 2 dias
    await calcular(p1);
    await cargarTareoDiario(p2, contratoId, ["2027-08-08", "2027-08-09", "2027-08-10"]); // 3 dias
    await calcular(p2);

    let d1 = await leerDetalle(p1, contratoId);
    let d2 = await leerDetalle(p2, contratoId);
    const baseP2Inicial = d2.essalud_base;
    expect(d1.essalud).toBeCloseTo(d1.essalud_base, 2); // su propia base (no es el ultimo del mes)
    expect(d1.essalud + d2.essalud).toBeCloseTo(101.7, 2); // P2 (ultimo) absorbio el ajuste

    // Se corrige P1 (se agregan mas dias) y se RECALCULA SOLO P1 - nunca se
    // vuelve a llamar /calcular sobre P2 en esta prueba.
    await cargarTareoDiario(p1, contratoId, [
      "2027-08-01", "2027-08-02", "2027-08-03", "2027-08-04", "2027-08-05", "2027-08-06", "2027-08-07",
    ]); // 7 dias -> mas base que antes
    const respuestaRecalculoP1 = await calcular(p1);

    d1 = await leerDetalle(p1, contratoId);
    d2 = await leerDetalle(p2, contratoId);
    expect(d1.essalud).toBeCloseTo(d1.essalud_base, 2); // sigue sin ser el ultimo -> su propia base
    // P2 NO se volvio a calcular (nunca se llamo /calcular sobre p2 de nuevo
    // en esta prueba), pero su essalud_base (el 9% sin ajustar) no cambio:
    expect(d2.essalud_base).toBeCloseTo(baseP2Inicial, 2);
    // ...aun asi su aporte FINAL si se corrigio solo, en cascada, para que
    // el total del mes se mantenga exactamente en el piso legal:
    expect(d2.essalud).not.toBeCloseTo(baseP2Inicial, 2);
    expect(d1.essalud + d2.essalud).toBeCloseTo(101.7, 2);
    expect(respuestaRecalculoP1.avisos_essalud.some((a) => a.contrato_id === contratoId)).toBe(true);
  });

  it("suma de periodos ya por encima del piso: ningun periodo se ajusta", async () => {
    await sembrarMes(2027, 4, 120);
    const contratoId = await crearContratoPeon("90000003", "PRUEBA SIN AJUSTE");
    const p1 = await crearPeriodoSemanal(2027, 4, "2027-04-01", "2027-04-07", 7);
    const p2 = await crearPeriodoSemanal(2027, 4, "2027-04-08", "2027-04-14", 7);
    await cargarTareoDiario(p1, contratoId, ["2027-04-01", "2027-04-02", "2027-04-03", "2027-04-04", "2027-04-05", "2027-04-06"]);
    await cargarTareoDiario(p2, contratoId, ["2027-04-08", "2027-04-09", "2027-04-10", "2027-04-11", "2027-04-12", "2027-04-13"]);
    await calcular(p1);
    await calcular(p2);

    const d1 = await leerDetalle(p1, contratoId);
    const d2 = await leerDetalle(p2, contratoId);
    expect(d1.essalud_base).toBeGreaterThan(101.7 / 2);
    expect(d1.essalud).toBeCloseTo(d1.essalud_base, 2); // sin ajuste
    expect(d2.essalud).toBeCloseTo(d2.essalud_base, 2); // sin ajuste
  });

  it("regimen general (EMPLEADO, periodo MENSUAL): el piso tambien aplica", async () => {
    await sembrarMes(2027, 5, 5); // tabla_salarial_mensual PEON no se usa aqui, pero hace falta la fila de AFP del mes
    const contratoId = await crearContratoEmpleado("90000004", "PRUEBA EMPLEADO PISO", 500, 0);
    const p1 = await crearPeriodoMensual(2027, 5, "2027-05-01", "2027-05-31", 31);
    const fechas = Array.from({ length: 31 }, (_, i) => `2027-05-${String(i + 1).padStart(2, "0")}`);
    await cargarTareoDiario(p1, contratoId, fechas);
    await calcular(p1);

    const d1 = await leerDetalle(p1, contratoId);
    expect(d1.essalud_base).toBeLessThan(101.7); // 9% de ~500 = 45, por debajo del piso
    expect(d1.essalud).toBeCloseTo(101.7, 2);
  });

  it("RMV mensual (rmv_mensual): un mes con override usa ese valor para el piso Y para la Asignacion Familiar", async () => {
    await sembrarMes(2027, 6, 5);
    await pool.query(
      `INSERT INTO rmv_mensual (anio, mes, remuneracion_minima_vital) VALUES (2027, 6, 2000)
       ON CONFLICT (anio, mes) DO UPDATE SET remuneracion_minima_vital = EXCLUDED.remuneracion_minima_vital`
    );
    const contratoId = await crearContratoEmpleado("90000005", "PRUEBA RMV MENSUAL", 500, 1);
    const p1 = await crearPeriodoMensual(2027, 6, "2027-06-01", "2027-06-30", 30);
    const fechas = Array.from({ length: 30 }, (_, i) => `2027-06-${String(i + 1).padStart(2, "0")}`);
    await cargarTareoDiario(p1, contratoId, fechas);
    await calcular(p1);

    const d1 = await leerDetalle(p1, contratoId);
    // Asignacion familiar = 10% de la RMV vigente ESE mes (override 2000, no
    // la anual 1130), prorrateada por dias_trabajados/dias_periodo (formula
    // ya existente de Ronda 2 - el sabado cargado con solo 5h por el limite
    // de limites_tareo hace que la proporcion no sea exactamente 1). Se
    // recalcula aqui la misma proporcion (leida de asistencia_periodo) en
    // vez de asumir un valor fijo, para no depender de cuantos sabados caen
    // en junio-2027.
    const asistencia = await pool.query(
      "SELECT dias_trabajados FROM asistencia_periodo WHERE periodo_id = $1 AND contrato_id = $2",
      [p1, contratoId]
    );
    const proporcion = Math.min(Number(asistencia.rows[0].dias_trabajados) / 30, 1);
    const asignacionFamiliarConOverride = Math.round(2000 * 0.1 * proporcion * 100) / 100;
    const asignacionFamiliarSinOverride = Math.round(1130 * 0.1 * proporcion * 100) / 100;
    expect(d1.asignacion_familiar).toBeCloseTo(asignacionFamiliarConOverride, 2);
    // Confirma que de verdad se uso el override (2000) y no la RMV anual (1130).
    expect(d1.asignacion_familiar).not.toBeCloseTo(asignacionFamiliarSinOverride, 2);
    // Piso = 9% de 2000 = 180 (no 101.70, el piso con la RMV anual) - el piso
    // es un monto absoluto, no depende de la proporcion de dias trabajados.
    expect(d1.essalud).toBeCloseTo(180, 2);
  });
});

describe("Piso de EsSalud mensual en Planilla Mensual Consolidada (ajuste directo, sin cascada)", () => {
  let adminUserId: number;
  let tokenAdmin: string;
  const empleadosCreados: number[] = [];
  const periodosCreados: number[] = [];

  beforeAll(async () => {
    const idResult = await pool.query("SELECT id FROM usuarios WHERE correo = 'admin@prueba.local'");
    adminUserId = idResult.rows[0].id as number;

    const login = await request(app).post("/api/auth/login").send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
    tokenAdmin = login.body.token as string;

    await pool.query(
      `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
       VALUES (2027, 7, 'PEON', 5, 0, 0, 0, 0)
       ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`
    );
    await pool.query(
      `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
       VALUES (2027, 7, 'INTEGRA', 0.0155, 0.0137, 0.10)
       ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`
    );
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM detalle_planilla_mensual WHERE contrato_id = ANY(SELECT id FROM contratos WHERE proyecto = $1)",
      [PROYECTO]
    );
    await pool.query("DELETE FROM planilla_mensual WHERE proyecto = $1 AND anio = 2027 AND mes = 7", [PROYECTO]);
    for (const id of periodosCreados) {
      await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [id]);
      await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [id]);
      await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [id]);
      await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [id]);
    }
    for (const id of empleadosCreados) {
      await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [id]);
      await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
    }
    await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2027 AND mes = 7 AND categoria = 'PEON'");
    await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = 2027 AND mes = 7");
  });

  function auth() {
    return { Authorization: `Bearer ${tokenAdmin}` };
  }

  it("essalud_base bajo el piso -> la consolidacion mensual ajusta directo al piso (sin necesitar otro periodo)", async () => {
    const e = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('1', '90000006', 'PRUEBA CONSOLIDACION PISO', 0) RETURNING id`
    );
    empleadosCreados.push(e.rows[0].id);
    const c = await pool.query(
      `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
       VALUES ($1, $2, 'PEON', 'ONP', '2020-01-01', 'HABIL') RETURNING id`,
      [e.rows[0].id, PROYECTO]
    );
    const contratoId = c.rows[0].id;

    const p1 = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
       VALUES (2027, 7, 'SEMANAL', '2027-07-01', '2027-07-07', 7, $1) RETURNING id`,
      [PROYECTO]
    );
    periodosCreados.push(p1.rows[0].id);
    const rTareo = await request(app)
      .put(`/api/periodos/${p1.rows[0].id}/tareo-diario/${contratoId}`)
      .set(auth())
      .send({ dias: [{ fecha: "2027-07-01", horas_normales: 8, minutos_normales: 0 }] });
    expect(rTareo.status).toBe(204);

    const resultado = await consolidarPlanillaMensual(PROYECTO, 2027, 7, adminUserId);
    expect(resultado.errores).toEqual([]);

    const consolidado = await obtenerPlanillaMensual(PROYECTO, 2027, 7);
    const fila = consolidado!.detalle.find((d: { contrato_id: number }) => d.contrato_id === contratoId) as
      | { essalud: string | number; essalud_base: string | number }
      | undefined;
    expect(fila).toBeDefined();
    expect(Number(fila!.essalud_base)).toBeLessThan(101.7); // 1 dia x jornal 5 x 9% = 0.45
    expect(Number(fila!.essalud)).toBeCloseTo(101.7, 2);
  });
});
