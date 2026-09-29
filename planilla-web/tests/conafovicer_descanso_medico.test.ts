// Migracion 039: CONAFOVICER (descuento propio de construccion civil) ya
// NO debe incluir los dias de "Descanso Medico" (<=20 dias/año, D.S.
// 009-97-SA) en su base imponible. Antes de esta migracion,
// conceptos_planilla.afecto_conafovicer para DESCANSO_MEDICO estaba en
// true (copiado de SUELDO_BASICO en la migracion 038); el usuario pidio
// explicitamente excluirlo.
//
// El ajuste es puramente de datos (un flag en conceptos_planilla) - no se
// toco calcularConafovicer()/sumarBase(), que ya eran 100% genericos. Esta
// prueba compara 2 contratos PEON con el mismo total de "dias
// equivalentes" (trabajados + descanso medico = 15 en ambos casos), pero
// distribuidos distinto: uno 100% trabajados, el otro con 2 dias de
// Descanso Medico. Si el flag quedo bien aplicado, el CONAFOVICER del
// segundo debe ser MENOR, exactamente en jornal_diario x 2 x tasa_conafovicer
// (2%) - la porcion que se movio de SUELDO_BASICO (afecto) a
// DESCANSO_MEDICO (ya no afecto).
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
    `INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Conafovicer Descanso Medico', 'Lima') RETURNING id`
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

async function crearContratoPeon(numeroDocumento: string, nombre: string): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, 0) RETURNING id`,
    [numeroDocumento, nombre]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);

  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Conafovicer Descanso Medico', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId]
  );
  const contratoId = c.rows[0].id as number;
  contratosCreados.push(contratoId);
  return contratoId;
}

describe("CONAFOVICER excluye los dias de Descanso Medico de su base (migracion 039)", () => {
  let contratoSinDescansoId: number;
  let contratoConDescansoId: number;

  it("precondicion: arma 2 contratos PEON con 15 dias equivalentes cada uno (uno sin descanso medico, otro con 2 dias de descanso medico)", async () => {
    contratoSinDescansoId = await crearContratoPeon("77794001", "PRUEBA CONAFOVICER SIN DESCANSO MEDICO");
    contratoConDescansoId = await crearContratoPeon("77794002", "PRUEBA CONAFOVICER CON DESCANSO MEDICO");

    const diasBase = Array.from({ length: 13 }, (_, i) => ({
      fecha: `2026-02-${String(i + 1).padStart(2, "0")}`,
      horas_normales: 8,
    }));

    // Contrato SIN descanso medico: 15 dias, todos trabajados normalmente.
    const guardadoSin = await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoSinDescansoId}`)
      .set(auth())
      .send({
        dias: [
          ...diasBase,
          { fecha: "2026-02-14", horas_normales: 8 },
          { fecha: "2026-02-15", horas_normales: 8 },
        ],
      });
    expect(guardadoSin.status).toBe(204);

    // Contrato CON descanso medico: mismos 13 dias trabajados + 2 dias de
    // Descanso Medico (bien dentro del cupo de 20/año) en vez de los 2
    // dias trabajados adicionales.
    const guardadoCon = await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoConDescansoId}`)
      .set(auth())
      .send({
        dias: [
          ...diasBase,
          { fecha: "2026-02-14", tipo_dia_especial: "DESCANSO_MEDICO" },
          { fecha: "2026-02-15", tipo_dia_especial: "DESCANSO_MEDICO" },
        ],
      });
    expect(guardadoCon.status).toBe(204);

    const calculo = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
    expect(calculo.status).toBe(200);
    expect(calculo.body.errores).toEqual([]);
  });

  it("el contrato CON descanso medico paga MENOS Conafovicer, exactamente por los 2 dias movidos fuera de la base", async () => {
    const filas = await pool.query(
      `SELECT contrato_id, jornal_diario, sueldo_basico, subsidio_enfermedad, conafovicer
       FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = ANY($2::int[])`,
      [periodoId, [contratoSinDescansoId, contratoConDescansoId]]
    );
    const filaSin = filas.rows.find((f) => f.contrato_id === contratoSinDescansoId);
    const filaCon = filas.rows.find((f) => f.contrato_id === contratoConDescansoId);
    expect(filaSin).toBeDefined();
    expect(filaCon).toBeDefined();

    // Precondiciones: mismo jornal diario, 2 dias de descanso medico
    // efectivamente pagados en el segundo contrato, y el mismo total
    // "trabajado + descanso medico" en soles (misma valorizacion, jornal x 15).
    expect(Number(filaCon.subsidio_enfermedad)).toBeGreaterThan(0);
    expect(Number(filaSin.subsidio_enfermedad)).toBe(0);
    const jornalDiario = Number(filaSin.jornal_diario);
    expect(jornalDiario).toBeGreaterThan(0);
    expect(jornalDiario).toBeCloseTo(Number(filaCon.jornal_diario), 2);
    expect(Number(filaSin.sueldo_basico) + 0).toBeCloseTo(
      Number(filaCon.sueldo_basico) + Number(filaCon.subsidio_enfermedad),
      1
    );

    // El efecto esperado: Conafovicer(sin) - Conafovicer(con) = jornal x 2 dias x 2%.
    const tasaConafovicer = 0.02;
    const diferenciaEsperada = Math.round(jornalDiario * 2 * tasaConafovicer * 100) / 100;
    const diferenciaReal = Number(filaSin.conafovicer) - Number(filaCon.conafovicer);
    expect(diferenciaReal).toBeCloseTo(diferenciaEsperada, 1);
    expect(Number(filaCon.conafovicer)).toBeLessThan(Number(filaSin.conafovicer));
  });

  it("el concepto DESCANSO_MEDICO del catalogo quedo con afecto_conafovicer = false", async () => {
    const r = await pool.query(`SELECT afecto_conafovicer FROM conceptos_planilla WHERE codigo = 'DESCANSO_MEDICO'`);
    expect(r.rows[0].afecto_conafovicer).toBe(false);
  });
});
