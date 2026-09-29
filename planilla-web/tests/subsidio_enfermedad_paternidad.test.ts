// Pruebas de la migracion 030: descanso medico por enfermedad y licencia por
// paternidad AHORA SI se pagan (antes, migracion 027, eran puramente
// informativos - bug real reportado por el usuario con una boleta de
// prueba, trabajador IPANAQUE MEJIA JUAN JUNIOR: el descanso medico no se
// sumaba al total de ingresos ni generaba los aportes/descuentos
// correspondientes).
//
// Decisiones de negocio confirmadas con el usuario (2 rondas de preguntas):
// 1) Tope de 20 dias/año por CONTRATO para descanso medico por enfermedad:
//    se BLOQUEA el registro (no solo aviso) al llegar al dia 21.
// 2) Licencia por paternidad: se paga igual que un dia trabajado, SIN tope.
// 3) Descanso medico por MATERNIDAD: se mantiene puramente informativo (lo
//    paga EsSalud desde el dia 1, nunca por planilla) - sin cambios.
// 4) Valorizacion: el mismo jornal diario de un dia normal trabajado.
// 5) Tratamiento tributario del descanso medico por enfermedad: NO afecto a
//    EsSalud/SENATI/ONP, SI afecto a SCTR y AFP - segun el codigo oficial
//    PLAME 916 "SUBSIDIOS DE INCAPACIDAD POR ENFERMEDAD" (Anexo 22 SUNAT,
//    docs/tabla22_plame.json), que el usuario confirmo seguir tal cual
//    (respetar el Anexo 22), incluso sobre su primera respuesta ("afecto a
//    todo"). La licencia por paternidad usa el codigo 907 "LICENCIA CON
//    GOCE DE HABER" (no existe un codigo especifico de "paternidad" en el
//    catalogo), afecto a todo segun ese mismo Anexo 22.
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
// dias_subsidio_enfermedad/dias_subsidio_maternidad/dias_licencia_paternidad
// desde la migracion 025 (para no perjudicar al trabajador). La
// gratificacion de EMPLEADO es semestral (solo julio/diciembre) y el
// periodo de esta prueba es Febrero, asi que no interfiere.
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
// la comparacion: un dia SUBSIDIO_ENFERMEDAD/SUBSIDIO_MATERNIDAD/
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
  await pool.query("DELETE FROM proyectos WHERE nombre = 'Proyecto Subsidio Enfermedad'");
  await pool.end();
});

describe("SUBSIDIO_ENFERMEDAD: se paga igual que un dia trabajado, afecto solo a SCTR/AFP (codigo PLAME 916)", () => {
  let contratoConId: number;
  let contratoSinId: number;

  it("aparece en detalle_planilla.subsidio_enfermedad y el total_ingresos es equivalente a pagar ese dia como trabajado", async () => {
    contratoConId = await crearContratoEmpleado("77791001", "PRUEBA SUBSIDIO ENFERMEDAD CON DIA");
    contratoSinId = await crearContratoEmpleado("77791002", "PRUEBA SUBSIDIO ENFERMEDAD SIN DIA");

    const guardadoCon = await guardarTareoDiario(contratoConId, [
      ...NUEVE_DIAS_NORMALES,
      { fecha: DECIMO_DIA, tipo_dia_especial: "SUBSIDIO_ENFERMEDAD" },
    ]);
    expect(guardadoCon.status).toBe(204);
    const guardadoSin = await guardarTareoDiario(contratoSinId, DIEZ_DIAS_NORMALES);
    expect(guardadoSin.status).toBe(204);

    await calcular();

    const con = await obtenerDetalle(contratoConId);
    const sin = await obtenerDetalle(contratoSinId);

    expect(Number(con.dias_subsidio_enfermedad)).toBe(1);
    expect(Number(sin.dias_subsidio_enfermedad)).toBe(0);
    expect(Number(con.dias_trabajados)).toBe(9); // el dia de subsidio NO cuenta como dia trabajado
    expect(Number(sin.dias_trabajados)).toBe(10);

    expect(Number(con.subsidio_enfermedad)).toBeCloseTo(Number(con.jornal_diario), 2);
    expect(Number(sin.subsidio_enfermedad)).toBe(0);

    // El dia de subsidio paga lo mismo que hubiera pagado como dia
    // trabajado normal (mismo jornal diario) - el total_ingresos de ambos
    // contratos (10 dias "pagados" en ambos casos, solo que por conceptos
    // distintos) debe ser equivalente.
    expect(Number(con.total_ingresos)).toBeCloseTo(Number(sin.total_ingresos), 1);
  });

  it("NO afecta EsSalud, SENATI ni ONP (afecto_essalud/afecto_senati/afecto_onp = false)", async () => {
    const con = await obtenerDetalle(contratoConId);
    const sin = await obtenerDetalle(contratoSinId);

    // "sin" tiene 10 dias trabajados (todos afectos), "con" tiene 9 dias
    // trabajados + 1 dia de subsidio que NO es afecto - por eso con.essalud
    // debe ser MENOR (base de 9 dias en vez de 10), y por la misma razon
    // aporte_pension (base ONP) tambien.
    expect(Number(con.essalud)).toBeLessThan(Number(sin.essalud));
    expect(Number(con.aporte_pension)).toBeLessThan(Number(sin.aporte_pension));
    // SENATI (EMPLEADO no es construccion civil): 0 en ambos casos, sin
    // relacion con el subsidio - se verifica igual para no perder la
    // regresion si esto cambiara.
    expect(Number(con.senati)).toBeCloseTo(Number(sin.senati), 2);
  });

  it("SI afecta SCTR (afecto_sctr = true): la base de 10 dias es la misma en ambos casos", async () => {
    const con = await obtenerDetalle(contratoConId);
    const sin = await obtenerDetalle(contratoSinId);
    // A diferencia de EsSalud/ONP, SCTR SI incluye el subsidio en su base -
    // por eso, a pesar de que "con" tiene 1 dia trabajado menos, su aporte
    // SCTR (activado en ambos contratos via sctr_salud) es equivalente al
    // de "sin" (ambos con base de 10 dias).
    expect(Number(con.sctr)).toBeCloseTo(Number(sin.sctr), 2);
  });

  it("aparece en el PLAME/REM bajo el codigo oficial 916 (Anexo 22 SUNAT)", async () => {
    const lineas = await generarLineasREM(periodoId);
    const lineaDelContrato = lineas.find((l) => l.includes("|77791001|916|"));
    expect(lineaDelContrato).toBeDefined();
  });
});

describe("LICENCIA_PATERNIDAD: se paga igual que un dia trabajado, sin tope, afecto a todo (codigo PLAME 907)", () => {
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

  it("SI afecta EsSalud y ONP igual que un dia trabajado (afecto a todo, a diferencia de SUBSIDIO_ENFERMEDAD)", async () => {
    const con = await obtenerDetalle(contratoConId);
    const sin = await obtenerDetalle(contratoSinId);

    // A diferencia del caso SUBSIDIO_ENFERMEDAD (afecto_essalud/onp=false),
    // aqui la licencia de paternidad SI cuenta para EsSalud/ONP igual que
    // un dia trabajado - por eso, aunque "con" tenga 1 dia trabajado menos,
    // su EsSalud/aporte_pension deben ser equivalentes a "sin" (ambos con
    // base de 10 dias).
    expect(Number(con.essalud)).toBeCloseTo(Number(sin.essalud), 2);
    expect(Number(con.aporte_pension)).toBeCloseTo(Number(sin.aporte_pension), 2);
  });

  it("aparece en el PLAME/REM bajo el codigo oficial 907 (Anexo 22 SUNAT)", async () => {
    const lineas = await generarLineasREM(periodoId);
    const lineaDelContrato = lineas.find((l) => l.includes("|77791003|907|"));
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
    // A diferencia de SUBSIDIO_ENFERMEDAD/LICENCIA_PATERNIDAD (que si
    // reemplazan el pago del dia), aqui NO existe ningun concepto que pague
    // ese decimo dia - "con" queda con 1 dia MENOS de sueldo pagado que
    // "sin", sin ninguna compensacion. La diferencia debe ser
    // aproximadamente 1 jornal diario.
    expect(Number(sin.total_ingresos) - Number(con.total_ingresos)).toBeCloseTo(Number(con.jornal_diario), 1);
  });
});

describe("Tope de 20 dias/año de SUBSIDIO_ENFERMEDAD por contrato: se BLOQUEA al superarlo", () => {
  it("bloquea (400) el registro del dia 21 de SUBSIDIO_ENFERMEDAD en el mismo año para el mismo contrato", async () => {
    const contratoId = await crearContratoEmpleado("77791007", "PRUEBA TOPE 20 DIAS ENFERMEDAD");

    // Siembra directa de 20 dias ya cargados (simula que ya se guardaron en
    // este u otro periodo del mismo año) - evita depender de 20 llamadas
    // HTTP y deja claro que el tope es ACUMULADO por año calendario, no solo
    // "por request".
    const fechasExistentes = Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    for (const fecha of fechasExistentes) {
      await pool.query(
        `INSERT INTO tareo_diario (periodo_id, contrato_id, fecha, tipo_dia_especial)
         VALUES ($1, $2, $3, 'SUBSIDIO_ENFERMEDAD')`,
        [periodoId, contratoId, fecha]
      );
    }

    // El dia 21 (fecha nueva, no incluida arriba) debe rechazarse - todo el
    // request se descarta, ni siquiera ese dia se guarda.
    const bloqueado = await guardarTareoDiario(contratoId, [
      { fecha: "2026-02-20", tipo_dia_especial: "SUBSIDIO_ENFERMEDAD" },
    ]);
    expect(bloqueado.status).toBe(400);
    expect(bloqueado.body.error).toMatch(/20 dias/);

    const noSeGuardo = await pool.query(
      "SELECT 1 FROM tareo_diario WHERE contrato_id = $1 AND fecha = '2026-02-20'",
      [contratoId]
    );
    expect(noSeGuardo.rowCount).toBe(0);
  });

  it("permite re-guardar una fecha YA marcada SUBSIDIO_ENFERMEDAD (no se cuenta dos veces)", async () => {
    const contratoId = await crearContratoEmpleado("77791008", "PRUEBA TOPE 20 DIAS RE-GUARDAR");
    const fechasExistentes = Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    for (const fecha of fechasExistentes) {
      await pool.query(
        `INSERT INTO tareo_diario (periodo_id, contrato_id, fecha, tipo_dia_especial)
         VALUES ($1, $2, $3, 'SUBSIDIO_ENFERMEDAD')`,
        [periodoId, contratoId, fecha]
      );
    }

    // Re-guardar EXACTAMENTE una de las 20 fechas ya existentes (no agrega
    // un dia 21) - no debe bloquearse.
    const reguardado = await guardarTareoDiario(contratoId, [
      { fecha: "2026-01-01", tipo_dia_especial: "SUBSIDIO_ENFERMEDAD" },
    ]);
    expect(reguardado.status).toBe(204);
  });

  it("permite llegar EXACTAMENTE a 20 dias (el bloqueo es solo al SUPERAR 20)", async () => {
    const contratoId = await crearContratoEmpleado("77791009", "PRUEBA TOPE EXACTO 20 DIAS");
    const fechasExistentes = Array.from({ length: 19 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    for (const fecha of fechasExistentes) {
      await pool.query(
        `INSERT INTO tareo_diario (periodo_id, contrato_id, fecha, tipo_dia_especial)
         VALUES ($1, $2, $3, 'SUBSIDIO_ENFERMEDAD')`,
        [periodoId, contratoId, fecha]
      );
    }
    const dia20 = await guardarTareoDiario(contratoId, [
      { fecha: "2026-02-20", tipo_dia_especial: "SUBSIDIO_ENFERMEDAD" },
    ]);
    expect(dia20.status).toBe(204);
  });
});
