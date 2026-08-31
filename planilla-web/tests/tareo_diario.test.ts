// Pruebas del Registro de Tareo Diario (ver routes/planilla.ts: rutas
// /periodos/:id/tareo-diario/*), agregado ademas de la carga por Excel/CSV
// y la edicion manual de totales que ya existian. Verifica que:
// - Guardar dias en tareo_diario recalcula correctamente los totales de
//   asistencia_periodo (incluyendo FALTA y los 3 tipos de subsidio/licencia)
//   via la misma guardarAsistencia() que usan el Excel y la edicion manual.
// - Borrar un dia puntual tambien recalcula el agregado.
// - La edicion manual de totales (PUT /:id/tareo, ya existente) no borra por
//   accidente los campos de subsidio cargados desde tareo_diario.
// - POST /:id/calcular sigue calculando la boleta con normalidad a partir de
//   esos agregados y devuelve avisos_subsidio (puramente informativo, sin
//   alterar ningun monto) para los trabajadores con dias de subsidio/licencia.
// Usa la misma app y base de datos de pruebas que autorizacion.test.ts, y
// reutiliza el periodo FEB-2026 porque schema.sql ya trae parametros
// normativos/tasas AFP/tabla salarial reales seedeados para ese mes.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
const empleadosCreados: number[] = [];
let periodoId: number;

beforeAll(async () => {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = r.body.token as string;

  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, fecha_inicio, fecha_fin, dias_periodo)
     VALUES (2026, 2, 'MENSUAL', '2026-02-01', '2026-02-28', 28) RETURNING id`
  );
  periodoId = p.rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM detalle_planilla WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM asistencia_periodo WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM contratos WHERE empleado_id = $1", [id]);
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.end();
});

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

async function crearContrato(dni: string, nombre: string, categoria: string): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, $2, 0) RETURNING id`,
    [dni, nombre]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Tareo Diario', $2, 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [empleadoId, categoria]
  );
  return c.rows[0].id as number;
}

async function obtenerAsistencia(contratoId: number) {
  const r = await pool.query("SELECT * FROM asistencia_periodo WHERE periodo_id = $1 AND contrato_id = $2", [
    periodoId,
    contratoId,
  ]);
  return r.rows[0];
}

describe("GET /api/conceptos/horas-extra", () => {
  it("devuelve los multiplicadores de construccion civil y regimen general sin exigir permiso de conceptos.editar", async () => {
    const r = await request(app).get("/api/conceptos/horas-extra").set(auth());
    expect(r.status).toBe(200);
    expect(r.body.construccion.factor1).toBeCloseTo(1.6);
    expect(r.body.construccion.factor2).toBeCloseTo(2.0);
    expect(r.body.general.factor1).toBeCloseTo(1.25);
    expect(r.body.general.factor2).toBeCloseTo(1.35);
  });
});

describe("PUT /api/periodos/:id/tareo-diario/:contratoId", () => {
  it("suma jornal normal, horas extra tramo1, falta y subsidio en asistencia_periodo", async () => {
    const contratoId = await crearContrato("77770001", "PRUEBA TAREO DIARIO PEON", "PEON");

    const r = await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
      .set(auth())
      .send({
        dias: [
          { fecha: "2026-02-02", horas_normales: 8, minutos_normales: 0 },
          { fecha: "2026-02-03", horas_normales: 8, minutos_normales: 0, horas_extra_tramo1: 2, minutos_extra_tramo1: 0 },
          { fecha: "2026-02-04", tipo_dia_especial: "FALTA" },
          { fecha: "2026-02-05", tipo_dia_especial: "SUBSIDIO_ENFERMEDAD" },
        ],
      });
    expect(r.status).toBe(204);

    const asistencia = await obtenerAsistencia(contratoId);
    expect(Number(asistencia.dias_trabajados)).toBeCloseTo(2.0); // (8+8)/8
    expect(Number(asistencia.horas_extra_25)).toBeCloseTo(2.0); // tramo1 -> horas_extra_25
    expect(Number(asistencia.dias_falta)).toBe(1);
    expect(Number(asistencia.dias_subsidio_enfermedad)).toBe(1);
    expect(Number(asistencia.dias_subsidio_maternidad)).toBe(0);
    expect(Number(asistencia.dias_licencia_paternidad)).toBe(0);

    const guardado = await request(app)
      .get(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
      .set(auth());
    expect(guardado.status).toBe(200);
    expect(guardado.body.dias).toHaveLength(4);
  });

  it("convierte minutos correctamente y usa el tramo2 (horas_extra_35) para regimen general", async () => {
    const contratoId = await crearContrato("77770002", "PRUEBA TAREO DIARIO GENERAL", "R_GENERAL");

    const r = await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
      .set(auth())
      .send({
        dias: [
          { fecha: "2026-02-02", horas_normales: 8 },
          { fecha: "2026-02-03", horas_dominical: 8 },
          { fecha: "2026-02-04", horas_extra_tramo2: 1, minutos_extra_tramo2: 30 },
          { fecha: "2026-02-05", tipo_dia_especial: "SUBSIDIO_MATERNIDAD" },
        ],
      });
    expect(r.status).toBe(204);

    const asistencia = await obtenerAsistencia(contratoId);
    expect(Number(asistencia.dias_trabajados)).toBeCloseTo(1.0);
    expect(Number(asistencia.dias_dominical)).toBeCloseTo(1.0);
    expect(Number(asistencia.horas_extra_35)).toBeCloseTo(1.5); // 1h30 -> 1.5
    expect(Number(asistencia.dias_subsidio_maternidad)).toBe(1);
  });

  it("borrar un dia puntual recalcula el agregado", async () => {
    const contratoId = await crearContrato("77770003", "PRUEBA TAREO DIARIO BORRAR", "PEON");
    await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
      .set(auth())
      .send({ dias: [{ fecha: "2026-02-02", tipo_dia_especial: "FALTA" }] });

    let asistencia = await obtenerAsistencia(contratoId);
    expect(Number(asistencia.dias_falta)).toBe(1);

    const del = await request(app)
      .delete(`/api/periodos/${periodoId}/tareo-diario/${contratoId}/2026-02-02`)
      .set(auth());
    expect(del.status).toBe(204);

    asistencia = await obtenerAsistencia(contratoId);
    expect(Number(asistencia.dias_falta)).toBe(0);
  });

  it("400 con tipo_dia_especial invalido", async () => {
    const contratoId = await crearContrato("77770004", "PRUEBA TAREO DIARIO INVALIDO", "PEON");
    const r = await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
      .set(auth())
      .send({ dias: [{ fecha: "2026-02-02", tipo_dia_especial: "VACACIONES" }] });
    expect(r.status).toBe(400);
  });

  it("404 si el contrato no existe", async () => {
    const r = await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/999999`)
      .set(auth())
      .send({ dias: [] });
    expect(r.status).toBe(404);
  });

  it("requiere sesion activa (sin token -> 401)", async () => {
    const r = await request(app).put(`/api/periodos/${periodoId}/tareo-diario/1`).send({ dias: [] });
    expect(r.status).toBe(401);
  });
});

describe("La edicion manual de totales (PUT /:id/tareo) no borra el subsidio cargado desde tareo diario", () => {
  it("conserva dias_subsidio_* al editar un campo no relacionado", async () => {
    const contratoId = await crearContrato("77770005", "PRUEBA NO PISAR SUBSIDIO", "PEON");
    await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoId}`)
      .set(auth())
      .send({ dias: [{ fecha: "2026-02-02", tipo_dia_especial: "SUBSIDIO_ENFERMEDAD" }] });

    let asistencia = await obtenerAsistencia(contratoId);
    expect(Number(asistencia.dias_subsidio_enfermedad)).toBe(1);

    // La edicion manual de totales (pantalla Tareo) no conoce los campos de
    // subsidio - no deberian resetearse a 0 por editar, por ejemplo, faltas.
    const editar = await request(app)
      .put(`/api/periodos/${periodoId}/tareo`)
      .set(auth())
      .send({
        contrato_id: contratoId,
        dias_trabajados: 5,
        dias_dominical: 0,
        dias_feriado: 0,
        dias_falta: 2,
        horas_extra_25: 0,
        horas_extra_35: 0,
        horas_extra_100: 0,
      });
    expect(editar.status).toBe(204);

    asistencia = await obtenerAsistencia(contratoId);
    expect(Number(asistencia.dias_trabajados)).toBe(5);
    expect(Number(asistencia.dias_falta)).toBe(2);
    expect(Number(asistencia.dias_subsidio_enfermedad)).toBe(1); // no se borro
  });
});

describe("POST /api/periodos/:id/calcular con tareo diario cargado", () => {
  it("calcula la boleta con normalidad y avisa (sin cambiar montos) los dias de subsidio/licencia", async () => {
    const contratoConSubsidio = await crearContrato("77770006", "PRUEBA CALCULO CON SUBSIDIO", "PEON");
    const contratoSinSubsidio = await crearContrato("77770007", "PRUEBA CALCULO SIN SUBSIDIO", "PEON");

    await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoConSubsidio}`)
      .set(auth())
      .send({
        dias: [
          { fecha: "2026-02-02", horas_normales: 8 },
          { fecha: "2026-02-03", tipo_dia_especial: "SUBSIDIO_ENFERMEDAD" },
        ],
      });
    await request(app)
      .put(`/api/periodos/${periodoId}/tareo-diario/${contratoSinSubsidio}`)
      .set(auth())
      .send({ dias: [{ fecha: "2026-02-02", horas_normales: 8 }] });

    const r = await request(app).post(`/api/periodos/${periodoId}/calcular`).set(auth()).send({});
    expect(r.status).toBe(200);
    expect(r.body.errores).toEqual([]);

    const avisoDelContratoConSubsidio = r.body.avisos_subsidio.find(
      (a: { contrato_id: number }) => a.contrato_id === contratoConSubsidio
    );
    expect(avisoDelContratoConSubsidio).toBeDefined();
    expect(avisoDelContratoConSubsidio.dias_subsidio_enfermedad).toBe(1);

    const avisoDelContratoSinSubsidio = r.body.avisos_subsidio.find(
      (a: { contrato_id: number }) => a.contrato_id === contratoSinSubsidio
    );
    expect(avisoDelContratoSinSubsidio).toBeUndefined();

    // El monto calculado no se ve afectado por el aviso (sigue siendo solo
    // el jornal de 1 dia trabajado en ambos casos - el dia de subsidio no
    // suma sueldo basico en esta fase).
    const detalleConSubsidio = await pool.query(
      "SELECT sueldo_basico FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2",
      [periodoId, contratoConSubsidio]
    );
    const detalleSinSubsidio = await pool.query(
      "SELECT sueldo_basico FROM detalle_planilla WHERE periodo_id = $1 AND contrato_id = $2",
      [periodoId, contratoSinSubsidio]
    );
    expect(Number(detalleConSubsidio.rows[0].sueldo_basico)).toBeCloseTo(
      Number(detalleSinSubsidio.rows[0].sueldo_basico)
    );
  });
});
