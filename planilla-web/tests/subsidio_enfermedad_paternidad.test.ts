// Pruebas de la migracion 030: descanso medico por enfermedad y licencia por
// paternidad AHORA SI se pagan (antes, migracion 027, eran puramente
// informativos - bug real reportado por el usuario con una boleta de
// prueba, trabajador IPANAQUE MEJIA JUAN JUNIOR: el descanso medico no se
// sumaba al total de ingresos ni generaba los aportes/descuentos
// correspondientes).
//
// ACTUALIZADO por la migracion 038 (17/09/2026): en produccion se detecto
// que el sistema estaba tratando TODOS los dias de descanso medico como si
// fueran "subsidiados por EsSalud" (afecto solo a SCTR/AFP, PLAME 0916),
// cuando en realidad eso solo es correcto a partir del dia 21 del año
// calendario por contrato (D.S. 009-97-SA) - los primeros 20 dias/año los
// paga integro el empleador, exactamente igual que un dia de trabajo
// normal (afecto a todo, PLAME 0121). Esta migracion:
// 1) Renombra el concepto SUBSIDIO_ENFERMEDAD a DESCANSO_MEDICO y le da el
//    tratamiento de "dia normal" (afecto a todo, PLAME 0121 - se fusiona
//    con SUELDO_BASICO en el REM, mismo criterio ya usado para
//    REM_DOMINICAL+REM_FERIADO bajo 0115).
// 2) Crea el concepto nuevo INCAPACIDAD_ENFERMEDAD (PLAME 0916), que
//    hereda los flags de afectacion que tenia ANTES el viejo
//    SUBSIDIO_ENFERMEDAD (NO afecto a EsSalud/SENATI/ONP, SI afecto a
//    SCTR/AFP), para el dia 21 en adelante.
// 3) La clasificacion entre ambos es AUTOMATICA: agregarTareoDiario
//    (routes/planilla.ts) cuenta, por año calendario y por contrato,
//    cuantos dias de DESCANSO_MEDICO ya estan marcados FUERA del rango de
//    fechas que se esta guardando/calculando, y reparte los dias de ESTE
//    rango entre el cupo normal restante (hasta completar 20) y el
//    excedente (INCAPACIDAD_ENFERMEDAD). El bloqueo con error 400 que
//    antes existia al llegar al dia 21 se ELIMINO a proposito: ahora el
//    dia 21 se guarda y se clasifica solo, no se rechaza.
//
// Decisiones de negocio confirmadas con el usuario (varias rondas de
// preguntas, la ultima el 17/09/2026):
// 1) DESCANSO_MEDICO (dias 1-20/año/contrato): se paga y se afecta a
//    aportes EXACTAMENTE igual que un dia de trabajo normal (afecto a
//    todo), declarado en el PLAME bajo el codigo 0121 (fusionado con
//    SUELDO_BASICO).
// 2) INCAPACIDAD_ENFERMEDAD (dia 21 en adelante, mismo año/contrato):
//    mantiene el tratamiento tributario que antes tenia TODO el concepto -
//    NO afecto a EsSalud/SENATI/ONP, SI afecto a SCTR y AFP -, declarado
//    en el PLAME bajo el codigo oficial 0916 "SUBSIDIOS DE INCAPACIDAD POR
//    ENFERMEDAD" (Anexo 22 SUNAT, docs/tabla22_plame.json).
// 3) Licencia por paternidad: se paga igual que un dia trabajado, SIN
//    tope, afecto a todo - codigo 0907 "LICENCIA CON GOCE DE HABER" (no
//    existe un codigo especifico de "paternidad" en el catalogo). Sin
//    cambios en esta migracion.
// 4) Descanso medico por MATERNIDAD: se mantiene puramente informativo (lo
//    paga EsSalud desde el dia 1, nunca por planilla) - sin cambios.
// 5) Valorizacion: el mismo jornal diario de un dia normal trabajado.
//    (migracion 035, 17/09/2026: los codigos PLAME se corrigieron de
//    "916"/"907" a "0916"/"0907" - les faltaba el 0 inicial en
//    conceptos_planilla. Sigue vigente tal cual.)
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { generarLineasREM } from "../src/plame";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
const empleadosCreados: number[] = [];
const contratosCreados: number[] = [];
let periodoId: number;

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

// Se usa categoria EMPLEADO (regimen general) en vez de PEON/construccion
// civil a proposito: la gratificacion de construccion civil se paga CADA
// periodo y su formula usa "dias computables" que YA incluyen
// dias_subsidio_enfermedad/dias_incapacidad_enfermedad/dias_subsidio_maternidad/
// dias_licencia_paternidad desde la migracion 025/038 (para no perjudicar
// al trabajador). La gratificacion de EMPLEADO es semestral (solo
// julio/diciembre) y el periodo de esta prueba es Febrero, asi que no
// interfiere.
async function crearContratoEmpleado(dni: string, nombre: string): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, 0) RETURNING id`,
    [dni, nombre]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado, sueldo_base, sctr_salud)
     VALUES ($1, 'Proyecto Subsidio Enfermedad', 'EMPLEADO', 'ONP', '2026-01-01', 'HABIL', 3100, true) RETURNING id`,
    [empleadoId]
  );
  const contratoId = c.rows[0].id as number;
  contratosCreados.push(contratoId);
  return contratoId;
}

async function guardarTareoDiario(contratoId: number, dias: Record<string, unknown>[]) {
  const r = await request(app)
    .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
    .set(auth())
    .send({ dias });
  return r;
}

async function calcular() {
  const r = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
  expect(r.status).toBe(200);
  expect(r.body.errores).toEqual([]);
  return r;
}

async function obtenerDetalle(contratoId: number) {
  const r = await pool.query("SELECT * FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2", [
    periodoId,
    contratoId,
  ]);
  return r.rows[0];
}

// 10 fechas consecutivas (Feb 02 al Feb 11) - mismo rango de dias/misma
// "semana calendario" en ambos contratos comparados, para que el dominical
// proporcional (jornal/6, migracion 023 - un mecanismo YA existente y
// totalmente ajeno a esta migracion) de igual en los 2 casos y no contamine
// la comparacion: un dia DESCANSO_MEDICO/SUBSIDIO_MATERNIDAD/
// LICENCIA_PATERNIDAD cuenta 8h fijas para ese calculo, igual que un dia
// normal trabajado - por eso el contrato "con" REEMPLAZA uno de estos 10
// dias por el dia especial (en vez de agregar un dia 11 aparte), y el
// contrato "sin" deja los 10 como dias normales trabajados. Asi ambos
// contratos tienen exactamente el mismo total de dias/horas semanales, y la
// UNICA diferencia real es si ese decimo dia se paga como SUELDO_BASICO
// (dia trabajado normal) o como el concepto especial correspondiente.
const NUEVE_DIAS_NORMALES = Array.from({ length: 9 }, (_, i) => ({
  fecha: `2026-02-${String(i + 2).padStart(2, "0")}`,
  horas_normales: 8,
}));
const DIEZ_DIAS_NORMALES = Array.from({ length: 10 }, (_, i) => ({
  fecha: `2026-02-${String(i + 2).padStart(2, "0")}`,
  horas_normales: 8,
}));
const DECIMO_DIA = "2026-02-11";

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  // Periodo MENSUAL de Febrero-2026 (globalSetup ya siembra tabla salarial /
  // tasas AFP para ese mes, mismo patron que condicion_trabajo.test.ts).
  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
     VALUES (2026, 2, 'MENSUAL', '2026-02-01', '2026-02-28', 28) RETURNING id`
  );
  periodoId = p.rows[0].id as number;

  await pool.query(`INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Subsidio Enfermedad', 'Lima')`);

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
  await pool.query("DELETE FROM proyectos WHERE nombre = 'Proyecto Subsidio Enfermedad'");
  await pool.end();
});

describe("DESCANSO_MEDICO (dias 1-20/año/contrato): se paga y se afecta a aportes IGUAL que un dia trabajado normal (PLAME 0121, fusionado con SUELDO_BASICO)", () => {
  let contratoConId: number;
  let contratoSinId: number;

  it("aparece en detalle_planilla.subsidio_enfermedad y el total_ingresos es equivalente a pagar ese dia como trabajado", async () => {
    contratoConId = await crearContratoEmpleado("77791001", "PRUEBA DESCANSO MEDICO CON DIA");
    contratoSinId = await crearContratoEmpleado("77791002", "PRUEBA DESCANSO MEDICO SIN DIA");

    const guardadoCon = await guardarTareoDiario(contratoConId, [
      ...NUEVE_DIAS_NORMALES,
      { fecha: DECIMO_DIA, tipo_dia_especial: "DESCANSO_MEDICO" },
    ]);
    expect(guardadoCon.status).toBe(204);
    const guardadoSin = await guardarTareoDiario(contratoSinId, DIEZ_DIAS_NORMALES);
    expect(guardadoSin.status).toBe(204);

    await calcular();

    const con = await obtenerDetalle(contratoConId);
    const sin = await obtenerDetalle(contratoSinId);

    expect(Number(con.dias_subsidio_enfermedad)).toBe(1);
    expect(Number(con.dias_incapacidad_enfermedad)).toBe(0);
    expect(Number(sin.dias_subsidio_enfermedad)).toBe(0);
    expect(Number(con.dias_trabajados)).toBe(9); // el dia de descanso medico NO cuenta como dia trabajado
    expect(Number(sin.dias_trabajados)).toBe(10);

    expect(Number(con.subsidio_enfermedad)).toBeCloseTo(Number(con.jornal_diario), 2);
    expect(Number(con.incapacidad_enfermedad)).toBe(0);
    expect(Number(sin.subsidio_enfermedad)).toBe(0);

    // El dia de descanso medico paga lo mismo que hubiera pagado como dia
    // trabajado normal (mismo jornal diario) - el total_ingresos de ambos
    // contratos (10 dias "pagados" en ambos casos, solo que por conceptos
    // distintos) debe ser equivalente.
    expect(Number(con.total_ingresos)).toBeCloseTo(Number(sin.total_ingresos), 1);
  });

  it("SI afecta EsSalud, SENATI y ONP igual que un dia trabajado normal (afecto a todo, a diferencia del viejo SUBSIDIO_ENFERMEDAD)", async () => {
    const con = await obtenerDetalle(contratoConId);
    const sin = await obtenerDetalle(contratoSinId);

    // Antes de la migracion 038, "con" tenia 9 dias trabajados + 1 dia de
    // subsidio NO afecto, asi que su EsSalud/ONP eran MENORES que "sin". A
    // partir de esta migracion, el dia 1-20 de descanso medico se afecta
    // igual que un dia normal - por eso ambos deben quedar equivalentes
    // (ambos con base de 10 dias).
    expect(Number(con.essalud)).toBeCloseTo(Number(sin.essalud), 2);
    expect(Number(con.aporte_pension)).toBeCloseTo(Number(sin.aporte_pension), 2);
    // SENATI (EMPLEADO no es construccion civil): 0 en ambos casos, sin
    // relacion con el descanso medico - se verifica igual para no perder la
    // regresion si esto cambiara.
    expect(Number(con.senati)).toBeCloseTo(Number(sin.senati), 2);
  });

  it("SI afecta SCTR (afecto_sctr = true): la base de 10 dias es la misma en ambos casos", async () => {
    const con = await obtenerDetalle(contratoConId);
    const sin = await obtenerDetalle(contratoSinId);
    expect(Number(con.sctr)).toBeCloseTo(Number(sin.sctr), 2);
  });

  it("aparece en el PLAME/REM FUSIONADO con SUELDO_BASICO bajo el codigo 0121 (NO genera una linea 0916 aparte)", async () => {
    const lineas = await generarLineasREM(periodoId);
    const linea0121 = lineas.find((l) => l.includes("|77791001|0121|"));
    expect(linea0121).toBeDefined();

    const con = await obtenerDetalle(contratoConId);
    const [, , , devengadoTexto] = (linea0121 as string).split("|");
    // La linea 0121 debe traer sueldo_basico + subsidio_enfermedad SUMADOS
    // en un solo monto (mismo criterio ya usado para REM_DOMINICAL +
    // REM_FERIADO bajo 0115).
    expect(Number(devengadoTexto)).toBeCloseTo(
      Number(con.sueldo_basico) + Number(con.subsidio_enfermedad),
      1
    );

    const linea0916 = lineas.find((l) => l.includes("|77791001|0916|"));
    expect(linea0916).toBeUndefined();
  });
});

describe("LICENCIA_PATERNIDAD: se paga igual que un dia trabajado, sin tope, afecto a todo (codigo PLAME 0907)", () => {
  let contratoConId: number;
  let contratoSinId: number;

  it("aparece en detalle_planilla.licencia_paternidad y el total_ingresos es equivalente a pagar ese dia como trabajado", async () => {
    contratoConId = await crearContratoEmpleado("77791003", "PRUEBA LICENCIA PATERNIDAD CON DIA");
    contratoSinId = await crearContratoEmpleado("77791004", "PRUEBA LICENCIA PATERNIDAD SIN DIA");

    await guardarTareoDiario(contratoConId, [
      ...NUEVE_DIAS_NORMALES,
      { fecha: DECIMO_DIA, tipo_dia_especial: "LICENCIA_PATERNIDAD" },
    ]);
    await guardarTareoDiario(contratoSinId, DIEZ_DIAS_NORMALES);

    await calcular();

    const con = await obtenerDetalle(contratoConId);
    const sin = await obtenerDetalle(contratoSinId);

    expect(Number(con.dias_licencia_paternidad)).toBe(1);
    expect(Number(con.licencia_paternidad)).toBeCloseTo(Number(con.jornal_diario), 2);
    expect(Number(con.total_ingresos)).toBeCloseTo(Number(sin.total_ingresos), 1);
  });

  it("SI afecta EsSalud y ONP igual que un dia trabajado (afecto a todo, igual que DESCANSO_MEDICO dentro del tope de 20 dias)", async () => {
    const con = await obtenerDetalle(contratoConId);
    const sin = await obtenerDetalle(contratoSinId);

    // A diferencia de INCAPACIDAD_ENFERMEDAD (dia 21+ de descanso medico,
    // no afecto a EsSalud/ONP), la licencia de paternidad SI cuenta para
    // EsSalud/ONP igual que un dia trabajado - por eso, aunque "con" tenga
    // 1 dia trabajado menos, su EsSalud/aporte_pension deben ser
    // equivalentes a "sin" (ambos con base de 10 dias).
    expect(Number(con.essalud)).toBeCloseTo(Number(sin.essalud), 2);
    expect(Number(con.aporte_pension)).toBeCloseTo(Number(sin.aporte_pension), 2);
  });

  it("aparece en el PLAME/REM bajo el codigo oficial 0907 (Anexo 22 SUNAT)", async () => {
    const lineas = await generarLineasREM(periodoId);
    const lineaDelContrato = lineas.find((l) => l.includes("|77791003|0907|"));
    expect(lineaDelContrato).toBeDefined();
  });
});

describe("SUBSIDIO_MATERNIDAD: se mantiene puramente informativo (regresion - NUNCA se paga por planilla)", () => {
  it("NO genera ningun monto pagado: el dia de maternidad reduce total_ingresos frente a un dia trabajado normal", async () => {
    const contratoConId = await crearContratoEmpleado("77791005", "PRUEBA SUBSIDIO MATERNIDAD CON DIA");
    const contratoSinId = await crearContratoEmpleado("77791006", "PRUEBA SUBSIDIO MATERNIDAD SIN DIA");

    await guardarTareoDiario(contratoConId, [
      ...NUEVE_DIAS_NORMALES,
      { fecha: DECIMO_DIA, tipo_dia_especial: "SUBSIDIO_MATERNIDAD" },
    ]);
    await guardarTareoDiario(contratoSinId, DIEZ_DIAS_NORMALES);

    await calcular();

    const con = await obtenerDetalle(contratoConId);
    const sin = await obtenerDetalle(contratoSinId);

    expect(Number(con.dias_subsidio_maternidad)).toBe(1);
    // A diferencia de DESCANSO_MEDICO/LICENCIA_PATERNIDAD (que si reemplazan
    // el pago del dia), aqui NO existe ningun concepto que pague ese decimo
    // dia - "con" queda con 1 dia MENOS de sueldo pagado que "sin", sin
    // ninguna compensacion. La diferencia debe ser aproximadamente 1 jornal
    // diario.
    expect(Number(sin.total_ingresos) - Number(con.total_ingresos)).toBeCloseTo(Number(con.jornal_diario), 1);
  });
});

describe("Migracion 038: division automatica 20/21+ de DESCANSO_MEDICO por año calendario y por contrato", () => {
  it("el dia 21 (20 ya marcados este año, fuera de este periodo) YA NO se bloquea (204) y se clasifica como INCAPACIDAD_ENFERMEDAD", async () => {
    const contratoId = await crearContratoEmpleado("77791007", "PRUEBA DIA 21 DESCANSO MEDICO");

    // Siembra directa de 20 dias ya marcados DESCANSO_MEDICO (simula que ya
    // se guardaron en este u otro periodo del mismo año, todos FUERA del
    // rango del periodo de esta prueba - Febrero) - deja claro que el
    // conteo es ACUMULADO por año calendario, no solo "por request".
    const fechasExistentes = Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    for (const fecha of fechasExistentes) {
      await pool.query(
        `INSERT INTO tareo_diario (periodo_id, contrato_id, fecha, tipo_dia_especial)
         VALUES ($1, $2, $3, 'DESCANSO_MEDICO')`,
        [periodoId, contratoId, fecha]
      );
    }

    // El dia 21 (fecha nueva, dentro de este periodo) ya NO se rechaza -
    // se guarda normalmente.
    const guardado = await guardarTareoDiario(contratoId, [
      { fecha: "2026-02-20", tipo_dia_especial: "DESCANSO_MEDICO" },
    ]);
    expect(guardado.status).toBe(204);

    await calcular();
    const detalle = await obtenerDetalle(contratoId);

    // El cupo normal (20) ya estaba agotado por los dias de enero - este
    // dia nuevo cae 100% en INCAPACIDAD_ENFERMEDAD (PLAME 0916), no en
    // DESCANSO_MEDICO (PLAME 0121).
    expect(Number(detalle.dias_subsidio_enfermedad)).toBe(0);
    expect(Number(detalle.dias_incapacidad_enfermedad)).toBe(1);
    expect(Number(detalle.subsidio_enfermedad)).toBe(0);
    expect(Number(detalle.incapacidad_enfermedad)).toBeCloseTo(Number(detalle.jornal_diario), 2);

    const lineas = await generarLineasREM(periodoId);
    expect(lineas.find((l) => l.includes("|77791007|0916|"))).toBeDefined();
  });

  it("permite llegar EXACTAMENTE a 20 dias sin pasar a INCAPACIDAD_ENFERMEDAD (el excedente es solo al SUPERAR 20)", async () => {
    const contratoId = await crearContratoEmpleado("77791008", "PRUEBA TOPE EXACTO 20 DIAS");
    const fechasExistentes = Array.from({ length: 19 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    for (const fecha of fechasExistentes) {
      await pool.query(
        `INSERT INTO tareo_diario (periodo_id, contrato_id, fecha, tipo_dia_especial)
         VALUES ($1, $2, $3, 'DESCANSO_MEDICO')`,
        [periodoId, contratoId, fecha]
      );
    }
    const dia20 = await guardarTareoDiario(contratoId, [
      { fecha: "2026-02-20", tipo_dia_especial: "DESCANSO_MEDICO" },
    ]);
    expect(dia20.status).toBe(204);

    await calcular();
    const detalle = await obtenerDetalle(contratoId);
    expect(Number(detalle.dias_subsidio_enfermedad)).toBe(1);
    expect(Number(detalle.dias_incapacidad_enfermedad)).toBe(0);
  });

  it("permite re-guardar una fecha YA marcada DESCANSO_MEDICO sin contarla dos veces", async () => {
    const contratoId = await crearContratoEmpleado("77791009", "PRUEBA RE-GUARDAR DESCANSO MEDICO");
    const fechasExistentes = Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    for (const fecha of fechasExistentes) {
      await pool.query(
        `INSERT INTO tareo_diario (periodo_id, contrato_id, fecha, tipo_dia_especial)
         VALUES ($1, $2, $3, 'DESCANSO_MEDICO')`,
        [periodoId, contratoId, fecha]
      );
    }

    // Re-guardar EXACTAMENTE una de las 20 fechas ya existentes (no agrega
    // un dia 21) - no debe bloquearse ni generar incapacidad_enfermedad.
    const reguardado = await guardarTareoDiario(contratoId, [
      { fecha: "2026-01-01", tipo_dia_especial: "DESCANSO_MEDICO" },
    ]);
    expect(reguardado.status).toBe(204);
  });

  it("un solo periodo con MAS de 20 dias de DESCANSO_MEDICO se auto-divide: los primeros 20 a subsidio_enfermedad, el resto a incapacidad_enfermedad", async () => {
    const contratoId = await crearContratoEmpleado("77791010", "PRUEBA AUTO-DIVISION 25 DIAS EN UN PERIODO");

    // 25 dias de DESCANSO_MEDICO cargados de una sola vez en este periodo,
    // sin ningun dia marcado antes en el año - el cupo normal (20) se
    // agota DENTRO de este mismo periodo, y el excedente (5 dias) debe
    // clasificarse solo como incapacidad_enfermedad, sin necesidad de un
    // periodo aparte.
    const veinticincoDias = Array.from({ length: 25 }, (_, i) => ({
      fecha: `2026-02-${String(i + 1).padStart(2, "0")}`,
      tipo_dia_especial: "DESCANSO_MEDICO",
    }));
    const guardado = await guardarTareoDiario(contratoId, veinticincoDias);
    expect(guardado.status).toBe(204);

    await calcular();
    const detalle = await obtenerDetalle(contratoId);

    expect(Number(detalle.dias_subsidio_enfermedad)).toBe(20);
    expect(Number(detalle.dias_incapacidad_enfermedad)).toBe(5);
    // Precision 0 (no 1): jornal_diario en detalle_planilla se guarda YA
    // redondeado a 2 decimales, pero el monto real se calcula con el valor
    // sin redondear (sueldo_base/dias_periodo) antes de multiplicar por 20 -
    // eso acumula una diferencia de centimos que un tolerance de 1 decimal
    // rechaza aunque el calculo sea correcto.
    expect(Number(detalle.subsidio_enfermedad)).toBeCloseTo(Number(detalle.jornal_diario) * 20, 0);
    expect(Number(detalle.incapacidad_enfermedad)).toBeCloseTo(Number(detalle.jornal_diario) * 5, 0);
  });
});
