// Pruebas de la migracion_045 ("Control de Asistencia Diaria" - Ronda 1):
// tabla horarios_proyecto (horario de ingreso/salida/refrigerio por
// proyecto, todavia sin uso en ningun calculo - reservado para el futuro
// importador de marcaciones biometricas de Ronda 2/3) y, lo que SI entra en
// vigencia de inmediato, tasa_tramo3: el recargo del "tramo 3" de horas
// extra (mas de 6 horas extra acumuladas en el dia) pactado POR PROYECTO,
// en vez del recargo general de la empresa (conceptos_planilla.
// HORAS_EXTRA_CONSTRUCCION/GENERAL.factor3). Ver motorCalculo.ts
// (calcularHorasExtra/calcularLineaPlanilla), routes/planilla.ts,
// planillaMensual.ts y routes/conceptos.ts (GET/PUT
// /api/conceptos/horarios-proyecto).
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";
import { calcularHorasExtra } from "../src/motorCalculo";
import { AsistenciaEntrada } from "../src/tipos";

// ===========================================================================
// 1) Pruebas unitarias de calcularHorasExtra con tasaTramo3Override
// ===========================================================================
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

const RECARGOS_CONSTRUCCION: [number, number, number] = [1.6, 2.0, 2.0];
const RECARGOS_GENERAL: [number, number, number] = [1.25, 1.35, 2.0];
const JORNAL_DIARIO = 80; // jornalHora = 10

describe("calcularHorasExtra con tasaTramo3Override (migracion_045)", () => {
  it("construccion civil: sin override, usa el recargoTramo3 general (2.00)", () => {
    const importe = calcularHorasExtra(
      JORNAL_DIARIO,
      asistencia({ horas_extra_100: 4 }),
      "PEON",
      RECARGOS_CONSTRUCCION,
      RECARGOS_GENERAL
    );
    // jornalHora(10) x 2.00 x 4 = 80
    expect(importe).toBeCloseTo(80);
  });

  it("construccion civil: con override, reemplaza SOLO el recargo de tramo3", () => {
    const importe = calcularHorasExtra(
      JORNAL_DIARIO,
      asistencia({ horas_extra_25: 2, horas_extra_35: 1, horas_extra_100: 4 }),
      "PEON",
      RECARGOS_CONSTRUCCION,
      RECARGOS_GENERAL,
      1.3
    );
    // tramo1: 10 x 1.60 x 2 = 32; tramo2: 10 x 2.00 x 1 = 20 (SIN cambios,
    // el override solo afecta tramo3); tramo3: 10 x 1.30 x 4 = 52
    expect(importe).toBeCloseTo(32 + 20 + 52);
  });

  it("regimen general: el override tambien aplica (no es exclusivo de construccion civil)", () => {
    const importe = calcularHorasExtra(
      JORNAL_DIARIO,
      asistencia({ horas_extra_100: 3 }),
      "EMPLEADO",
      RECARGOS_CONSTRUCCION,
      RECARGOS_GENERAL,
      1.45
    );
    // jornalHora(10) x 1.45 x 3 = 43.5
    expect(importe).toBeCloseTo(43.5);
  });

  it("un override de exactamente 1.00 (0% de recargo) sigue funcionando (no se confunde con 'sin override')", () => {
    const importe = calcularHorasExtra(JORNAL_DIARIO, asistencia({ horas_extra_100: 5 }), "PEON", RECARGOS_CONSTRUCCION, RECARGOS_GENERAL, 1.0);
    // jornalHora(10) x 1.00 x 5 = 50 (si el override se ignorara por "falsy",
    // este caso fallaria porque 1.00 no es falsy en JS, pero se prueba igual
    // por seguridad ya que el codigo usa "??" y no "||")
    expect(importe).toBeCloseTo(50);
  });
});

// ===========================================================================
// 2) Pruebas de integracion: GET/PUT /api/conceptos/horarios-proyecto
// ===========================================================================
let tokenAdmin: string;
let tokenResponsable: string;
let proyectoId: number;
let proyectoSinConfigurarId: number;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const rAdmin = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = rAdmin.body.token as string;

  const rResp = await request(app)
    .post("/api/auth/login")
    .send({ correo: "responsable-a@prueba.local", password: CLAVE_PRUEBA });
  tokenResponsable = rResp.body.token as string;

  const proy = await pool.query(`INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Horario Tramo3', 'Lima') RETURNING id`);
  proyectoId = proy.rows[0].id;

  const proySin = await pool.query(
    `INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Horario Sin Configurar', 'Lima') RETURNING id`
  );
  proyectoSinConfigurarId = proySin.rows[0].id;
});

afterAll(async () => {
  const proyectosPrueba = ["Proyecto Horario Tramo3", "Proyecto Horario Sin Configurar"];
  await pool.query("DELETE FROM detalle_planilla WHERE contrato_id IN (SELECT id FROM contratos WHERE proyecto = ANY($1::text[]))", [
    proyectosPrueba,
  ]);
  await pool.query("DELETE FROM asistencia_periodo WHERE contrato_id IN (SELECT id FROM contratos WHERE proyecto = ANY($1::text[]))", [
    proyectosPrueba,
  ]);
  await pool.query("DELETE FROM tareo_diario WHERE contrato_id IN (SELECT id FROM contratos WHERE proyecto = ANY($1::text[]))", [
    proyectosPrueba,
  ]);
  await pool.query("DELETE FROM contratos WHERE proyecto = ANY($1::text[])", [proyectosPrueba]);
  await pool.query("DELETE FROM empleados WHERE numero_documento LIKE '7779200%'");
  await pool.query("DELETE FROM periodos_planilla WHERE anio = 2026 AND mes = 6 AND tipo = 'MENSUAL' AND fecha_inicio = '2026-06-01' AND dias_periodo = 30");
  await pool.query("DELETE FROM horarios_proyecto WHERE proyecto_id IN ($1, $2)", [proyectoId, proyectoSinConfigurarId]);
  await pool.query("DELETE FROM proyectos WHERE id IN ($1, $2)", [proyectoId, proyectoSinConfigurarId]);
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = 2026 AND mes = 6 AND categoria = 'PEON'");
  await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = 2026 AND mes = 6");
  await pool.end();
});

describe("GET/PUT /api/conceptos/horarios-proyecto (validaciones)", () => {
  it("un usuario sin permiso conceptos.editar recibe 403", async () => {
    const r = await request(app)
      .put("/api/conceptos/horarios-proyecto")
      .set(auth(tokenResponsable))
      .send({
        entradas: [
          { proyecto_id: proyectoId, hora_ingreso: "08:00", hora_salida: "17:00", minutos_refrigerio: 60, tasa_tramo3: 1.3 },
        ],
      });
    expect(r.status).toBe(403);
  });

  it("rechaza un proyecto_id que no existe", async () => {
    const r = await request(app)
      .put("/api/conceptos/horarios-proyecto")
      .set(auth(tokenAdmin))
      .send({
        entradas: [{ proyecto_id: 999999, hora_ingreso: "08:00", hora_salida: "17:00", minutos_refrigerio: 60 }],
      });
    expect(r.status).toBe(400);
  });

  it("rechaza hora_ingreso con formato invalido", async () => {
    const r = await request(app)
      .put("/api/conceptos/horarios-proyecto")
      .set(auth(tokenAdmin))
      .send({
        entradas: [{ proyecto_id: proyectoId, hora_ingreso: "8:00", hora_salida: "17:00", minutos_refrigerio: 60 }],
      });
    expect(r.status).toBe(400);
  });

  it("rechaza minutos_refrigerio fuera de rango (0 a 240)", async () => {
    const r = await request(app)
      .put("/api/conceptos/horarios-proyecto")
      .set(auth(tokenAdmin))
      .send({
        entradas: [{ proyecto_id: proyectoId, hora_ingreso: "08:00", hora_salida: "17:00", minutos_refrigerio: 300 }],
      });
    expect(r.status).toBe(400);
  });

  it("rechaza una tasa_tramo3 menor a 1 (debe ser el multiplicador, no un porcentaje)", async () => {
    const r = await request(app)
      .put("/api/conceptos/horarios-proyecto")
      .set(auth(tokenAdmin))
      .send({
        entradas: [
          { proyecto_id: proyectoId, hora_ingreso: "08:00", hora_salida: "17:00", minutos_refrigerio: 60, tasa_tramo3: 0.3 },
        ],
      });
    expect(r.status).toBe(400);
  });

  it("un proyecto sin fila propia aparece en el GET con los valores por defecto (08:00/17:00/60/null)", async () => {
    const r = await request(app).get("/api/conceptos/horarios-proyecto").set(auth(tokenAdmin));
    expect(r.status).toBe(200);
    const fila = r.body.find((f: { proyecto_id: number }) => f.proyecto_id === proyectoSinConfigurarId);
    expect(fila).toBeDefined();
    expect(fila.hora_ingreso).toBe("08:00");
    expect(fila.hora_salida).toBe("17:00");
    expect(fila.minutos_refrigerio).toBe(60);
    expect(fila.tasa_tramo3).toBeNull();
  });

  it("guarda la configuracion de un proyecto y la devuelve en el GET", async () => {
    const guardar = await request(app)
      .put("/api/conceptos/horarios-proyecto")
      .set(auth(tokenAdmin))
      .send({
        entradas: [
          {
            proyecto_id: proyectoId,
            hora_ingreso: "07:30",
            hora_salida: "16:30",
            minutos_refrigerio: 45,
            hora_ingreso_sabado: "07:30",
            hora_salida_sabado: "12:30",
            tasa_tramo3: 1.3,
          },
        ],
      });
    expect(guardar.status).toBe(200);
    expect(guardar.body).toHaveLength(1);
    expect(guardar.body[0].hora_ingreso).toBe("07:30");
    expect(Number(guardar.body[0].tasa_tramo3)).toBeCloseTo(1.3);

    const listar = await request(app).get("/api/conceptos/horarios-proyecto").set(auth(tokenAdmin));
    expect(listar.status).toBe(200);
    const fila = listar.body.find((f: { proyecto_id: number }) => f.proyecto_id === proyectoId);
    expect(fila.hora_ingreso).toBe("07:30");
    expect(fila.hora_salida).toBe("16:30");
    expect(fila.minutos_refrigerio).toBe(45);
    expect(fila.hora_ingreso_sabado).toBe("07:30");
    expect(Number(fila.tasa_tramo3)).toBeCloseTo(1.3);
  });
});

// ===========================================================================
// 3) Prueba de integracion end-to-end: /api/periodos/:id/calcular usa la
// tasa_tramo3 del proyecto (guardada arriba, 1.30) en vez del recargo
// general de HORAS_EXTRA_CONSTRUCCION (factor3 = 2.00, sembrado en
// schema.sql), y un proyecto SIN configurar sigue usando el recargo general
// (regresion, sin romper el comportamiento anterior a esta migracion).
// ===========================================================================
describe("Tasa de tramo3 por proyecto en /calcular (migracion_045)", () => {
  let periodoId: number;
  let contratoConOverrideId: number;
  let contratoSinOverrideId: number;

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico) VALUES (2026, 6, 'PEON', 80)
       ON CONFLICT DO NOTHING`
    );
    await pool.query(
      `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
       SELECT 2026, 6, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio FROM tasas_afp_mensuales
       WHERE anio = 2026 AND mes = 2
       ON CONFLICT DO NOTHING`
    );

    const periodo = await pool.query(
      `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
       VALUES (2026, 6, 'MENSUAL', '2026-06-01', '2026-06-30', 30) RETURNING id`
    );
    periodoId = periodo.rows[0].id as number;

    const e1 = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('1', '77792001', 'PRUEBA TRAMO3 CON OVERRIDE', 0) RETURNING id`
    );
    const c1 = await pool.query(
      `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
       VALUES ($1, 'Proyecto Horario Tramo3', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
      [e1.rows[0].id]
    );
    contratoConOverrideId = c1.rows[0].id;

    const e2 = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('1', '77792002', 'PRUEBA TRAMO3 SIN OVERRIDE', 0) RETURNING id`
    );
    const c2 = await pool.query(
      `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
       VALUES ($1, 'Proyecto Horario Sin Configurar', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
      [e2.rows[0].id]
    );
    contratoSinOverrideId = c2.rows[0].id;
  });

  async function cargarTareo(contratoId: number) {
    const editar = await request(app)
      .put(`/api/periodos/${periodoId}/tareo`)
      .set(auth(tokenAdmin))
      .send({
        contrato_id: contratoId,
        dias_trabajados: 24,
        dias_dominical: 0,
        dias_feriado: 0,
        dias_falta: 0,
        horas_extra_25: 0,
        horas_extra_35: 0,
        horas_extra_100: 4,
      });
    expect(editar.status).toBe(204);
  }

  it("usa la tasa_tramo3 pactada del proyecto (1.30) en vez del recargo general (2.00)", async () => {
    await cargarTareo(contratoConOverrideId);
    const calcular = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth(tokenAdmin)).send({});
    expect(calcular.status).toBe(200);
    expect(calcular.body.errores).toEqual([]);

    const detalle = await pool.query("SELECT importe_horas_extra FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2", [
      periodoId,
      contratoConOverrideId,
    ]);
    // jornalHora = 80/8 = 10; tramo3: 10 x 1.30 x 4 = 52 (sin tramo1/tramo2,
    // horas_extra_25/35 en 0)
    expect(Number(detalle.rows[0].importe_horas_extra)).toBeCloseTo(52);
  });

  it("un proyecto sin tasa_tramo3 configurada sigue usando el recargo general de la empresa (2.00) - sin regresion", async () => {
    await cargarTareo(contratoSinOverrideId);
    const calcular = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth(tokenAdmin)).send({});
    expect(calcular.status).toBe(200);
    expect(calcular.body.errores).toEqual([]);

    const detalle = await pool.query("SELECT importe_horas_extra FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2", [
      periodoId,
      contratoSinOverrideId,
    ]);
    // jornalHora = 10; tramo3: 10 x 2.00 (factor3 general HORAS_EXTRA_CONSTRUCCION) x 4 = 80
    expect(Number(detalle.rows[0].importe_horas_extra)).toBeCloseTo(80);
  });
});
