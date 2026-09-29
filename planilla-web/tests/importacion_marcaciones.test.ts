// Pruebas de la migracion_046 ("Control de Asistencia Diaria" - Ronda 2,
// "puente practico"): importacion de marcaciones biometricas desde un
// Excel/CSV (1 fila por cada marcacion individual: DNI, nombre, fecha,
// hora, tipo ENTRADA/SALIDA), calculo automatico de horas normales/extra
// tramo1-2-3 comparando la primera y ultima marca del dia contra
// horarios_proyecto, y aplicacion final a tareo_diario reutilizando la
// MISMA validacion que la edicion manual (validarYGuardarDiasTareoDiario).
import request from "supertest";
import ExcelJS from "exceljs";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

let tokenAdmin: string;
let proyectoId: number;
let periodoId: number;
let contratoId: number; // vigente todo el periodo
let contratoFueraVigenciaId: number; // ingresa DESPUES del periodo

const DNI_VIGENTE = "88880001";
const DNI_FUERA_VIGENCIA = "88880002";
const DNI_INEXISTENTE = "88880099";

function auth() {
  return { Authorization: `Bearer ${tokenAdmin}` };
}

async function armarXlsx(encabezado: string[], filas: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Marcaciones");
  hoja.addRow(encabezado);
  for (const fila of filas) hoja.addRow(fila);
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  if (r.status !== 200) throw new Error(`No se pudo iniciar sesion como admin: ${r.status} ${JSON.stringify(r.body)}`);
  tokenAdmin = r.body.token as string;

  const proy = await pool.query(
    `INSERT INTO proyectos (nombre, ubicacion) VALUES ('Proyecto Marcaciones Prueba', 'Lima') RETURNING id`
  );
  proyectoId = proy.rows[0].id;
  await pool.query(
    `INSERT INTO horarios_proyecto (proyecto_id, hora_ingreso, hora_salida, minutos_refrigerio)
     VALUES ($1, '08:00', '17:00', 60)`,
    [proyectoId]
  );

  const periodo = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, tipo, quincena, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES (2026, 8, 'QUINCENAL', 1, '2026-08-01', '2026-08-15', 15, 'Proyecto Marcaciones Prueba') RETURNING id`
  );
  periodoId = periodo.rows[0].id;

  // NOTA (recon 44/46): el parche original sembraba aqui un feriado
  // nacional (2026-08-06) en la tabla "dias_feriados" para probar la
  // clasificacion automatica de "Feriado trabajado" al importar marcaciones
  // - esa tabla NUNCA existio en este arbol (ver RECONSTRUCCION_BRECHAS.md
  // punto 15), asi que el importador no clasifica ningun dia como feriado
  // automaticamente (ver la NOTA equivalente en routes/planilla.ts). Se
  // omite la siembra y el caso de prueba correspondiente.

  const e1 = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, 'PRUEBA MARCACIONES VIGENTE', 0) RETURNING id`,
    [DNI_VIGENTE]
  );
  const c1 = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Marcaciones Prueba', 'PEON', 'ONP', '2026-01-01', 'HABIL') RETURNING id`,
    [e1.rows[0].id]
  );
  contratoId = c1.rows[0].id;

  const e2 = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
     VALUES ('1', $1, 'PRUEBA MARCACIONES FUERA VIGENCIA', 0) RETURNING id`,
    [DNI_FUERA_VIGENCIA]
  );
  const c2 = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, fecha_ingreso, estado)
     VALUES ($1, 'Proyecto Marcaciones Prueba', 'PEON', 'ONP', '2026-09-01', 'HABIL') RETURNING id`,
    [e2.rows[0].id]
  );
  contratoFueraVigenciaId = c2.rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM importaciones_marcaciones WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM tareo_diario WHERE contrato_id IN ($1, $2)", [contratoId, contratoFueraVigenciaId]);
  await pool.query("DELETE FROM asistencia_periodo WHERE contrato_id IN ($1, $2)", [contratoId, contratoFueraVigenciaId]);
  await pool.query("DELETE FROM contratos WHERE id IN ($1, $2)", [contratoId, contratoFueraVigenciaId]);
  await pool.query("DELETE FROM empleados WHERE numero_documento IN ($1, $2, $3)", [
    DNI_VIGENTE,
    DNI_FUERA_VIGENCIA,
    DNI_INEXISTENTE,
  ]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  await pool.query("DELETE FROM horarios_proyecto WHERE proyecto_id = $1", [proyectoId]);
  await pool.query("DELETE FROM proyectos WHERE id = $1", [proyectoId]);
  await pool.end();
});

const ENCABEZADO = ["DNI", "NOMBRE", "FECHA", "HORA", "TIPO"];

describe("POST /api/periodos/:id/marcaciones/importar", () => {
  it("calcula jornal normal + horas extra tramo1/tramo2 en un dia de semana con marcas de entrada/salida", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [
      // 2026-08-04 (martes): 08:00 a 20:00 -> bruto 720min - 60 refrigerio = 660min
      // netos; jornada programada neta = 480min (8h); extra = 180min = 3h ->
      // tramo1 = 120min (2h), tramo2 = 60min (1h), tramo3 = 0.
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-04", "08:00", "ENTRADA"],
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-04", "20:00", "SALIDA"],
    ]);

    const r = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");

    expect(r.status).toBe(201);
    expect(r.body.total_dias).toBe(1);
    expect(r.body.total_errores).toBe(0);

    const revision = await request(app)
      .get(`/api/periodos/${periodoId}/marcaciones/${r.body.importacion_id}`)
      .set(auth());
    expect(revision.status).toBe(200);
    const fila = revision.body.detalle.find((d: { fecha: string }) => d.fecha === "2026-08-04");
    expect(fila).toBeDefined();
    expect(fila.hora_ingreso_real.slice(0, 5)).toBe("08:00");
    expect(fila.hora_salida_real.slice(0, 5)).toBe("20:00");
    expect(fila.horas_normales).toBe(8);
    expect(fila.minutos_normales).toBe(0);
    expect(fila.horas_extra_tramo1).toBe(2);
    expect(fila.minutos_extra_tramo1).toBe(0);
    expect(fila.horas_extra_tramo2).toBe(1);
    expect(fila.minutos_extra_tramo2).toBe(0);
    expect(fila.horas_extra_tramo3).toBe(0);
  });

  it("un domingo trabajado se acredita completo a 'Domingo trabajado' sin dividir en tramos", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [
      // 2026-08-02 (domingo): 08:00 a 14:00 -> bruto 360min - 60 = 300min = 5h.
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-02", "08:00", "ENTRADA"],
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-02", "14:00", "SALIDA"],
    ]);
    const r = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");
    expect(r.status).toBe(201);

    const revision = await request(app)
      .get(`/api/periodos/${periodoId}/marcaciones/${r.body.importacion_id}`)
      .set(auth());
    const fila = revision.body.detalle[0];
    expect(fila.horas_dominical).toBe(5);
    expect(fila.minutos_dominical).toBe(0);
    expect(fila.horas_normales).toBe(0);
    expect(fila.horas_extra_tramo1).toBe(0);
  });

  // NOTA (recon 44/46): se omite el caso "un feriado (catalogo dias_feriados)
  // trabajado se acredita completo a 'Feriado trabajado'" - dependia de la
  // tabla "dias_feriados", que no existe en este arbol (brecha #15). Ver la
  // nota equivalente en el beforeAll de arriba y en routes/planilla.ts.

  it("agrupa varias marcas del mismo dia usando la mas temprana y la mas tardia, sin importar el orden del archivo", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [
      // 2026-08-08 (sabado, sin horario propio de sabado configurado -> usa
      // el mismo horario de lunes a viernes): marcas fuera de orden y con
      // una intermedia (ej. una salida a un tramite) que no debe afectar el
      // calculo (solo cuentan la primera y la ultima).
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-08", "13:00", "SALIDA"],
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-08", "08:00", "ENTRADA"],
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-08", "11:00", "SALIDA"],
    ]);
    const r = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");
    expect(r.status).toBe(201);

    const revision = await request(app)
      .get(`/api/periodos/${periodoId}/marcaciones/${r.body.importacion_id}`)
      .set(auth());
    const fila = revision.body.detalle[0];
    expect(fila.hora_ingreso_real.slice(0, 5)).toBe("08:00");
    expect(fila.hora_salida_real.slice(0, 5)).toBe("13:00");
    // 08:00 a 13:00 = 300min - 60 refrigerio = 240min = 4h, todo normal
    // (jornada programada neta = 8h, no hay excedente).
    expect(fila.horas_normales).toBe(4);
    expect(fila.horas_extra_tramo1).toBe(0);
    expect(fila.marcas).toHaveLength(3);
  });

  it("reporta error de fila para un DNI inexistente y para una fecha fuera de la vigencia del contrato, sin bloquear las filas validas", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [
      [DNI_INEXISTENTE, "NO EXISTE", "2026-08-04", "08:00", "ENTRADA"],
      [DNI_INEXISTENTE, "NO EXISTE", "2026-08-04", "17:00", "SALIDA"],
      // contratoFueraVigenciaId ingresa 2026-09-01, este dia cae antes.
      [DNI_FUERA_VIGENCIA, "PRUEBA MARCACIONES FUERA VIGENCIA", "2026-08-04", "08:00", "ENTRADA"],
      [DNI_FUERA_VIGENCIA, "PRUEBA MARCACIONES FUERA VIGENCIA", "2026-08-04", "17:00", "SALIDA"],
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-03", "08:00", "ENTRADA"],
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-03", "17:00", "SALIDA"],
    ]);
    const r = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");
    expect(r.status).toBe(201);
    expect(r.body.total_dias).toBe(1); // solo el DNI_VIGENTE del 03/08 se pudo procesar
    expect(r.body.total_errores).toBeGreaterThanOrEqual(2);
    const motivos = (r.body.errores as { motivo: string }[]).map((e) => e.motivo).join(" | ");
    expect(motivos).toMatch(/No existe un contrato habil/);
    expect(motivos).toMatch(/fuera de la vigencia del contrato/);
  });

  it("acepta un mapeo manual de columnas cuando el archivo no usa ninguno de los alias reconocidos", async () => {
    const xlsx = await armarXlsx(["IDENTIFICACION", "FECHA_MARCA", "HORA_REGISTRO"], [
      [DNI_VIGENTE, "2026-08-10", "08:00"],
      [DNI_VIGENTE, "2026-08-10", "17:00"],
    ]);
    const r = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .field("mapeo", JSON.stringify({ dni: "IDENTIFICACION", fecha: "FECHA_MARCA", hora: "HORA_REGISTRO" }))
      .attach("archivo", xlsx, "marcaciones.xlsx");
    expect(r.status).toBe(201);
    expect(r.body.total_dias).toBe(1);
    expect(r.body.total_errores).toBe(0);
  });

  it("sin ninguna columna reconocible (ni alias ni mapeo manual) devuelve 400 explicando el problema", async () => {
    const xlsx = await armarXlsx(["COL_A", "COL_B", "COL_C"], [["x", "y", "z"]]);
    const r = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/columnas obligatorias/);
  });

  it("una llegada ANTES de la hora programada NO se acredita como hora extra automaticamente (migracion 047)", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [
      // 2026-08-05 (miercoles): marca real 07:30, 30 min antes de la hora de
      // ingreso programada (08:00); salida exactamente a la hora programada
      // (17:00). El tramo "normal" solo cubre la interseccion con la ventana
      // programada (08:00-17:00), asi que la llegada anticipada queda fuera
      // tanto del jornal normal como de las horas extra.
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-05", "07:30", "ENTRADA"],
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-05", "17:00", "SALIDA"],
    ]);
    const r = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");
    expect(r.status).toBe(201);

    const revision = await request(app)
      .get(`/api/periodos/${periodoId}/marcaciones/${r.body.importacion_id}`)
      .set(auth());
    const fila = revision.body.detalle.find((d: { fecha: string }) => d.fecha === "2026-08-05");
    expect(fila.hora_ingreso_real.slice(0, 5)).toBe("07:30");
    expect(fila.minutos_llegada_anticipada).toBe(30);
    expect(fila.anticipacion_pagada).toBe(false);
    // 08:00 a 17:00 neto (540 - 60 refrigerio) = 480min = 8h normal exacto;
    // sin excedente por salida (coincide con la hora programada) -> 0 extra.
    expect(fila.horas_normales).toBe(8);
    expect(fila.minutos_normales).toBe(0);
    expect(fila.horas_extra_tramo1).toBe(0);
    expect(fila.minutos_extra_tramo1).toBe(0);
  });

  it("una llegada tarde y/o salida temprana (sin anticipacion) reduce el jornal normal sin marcar nada para confirmar", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [
      // 2026-08-07 (viernes): ingreso 08:30 (tarde) y salida 16:30 (temprano).
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-07", "08:30", "ENTRADA"],
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-07", "16:30", "SALIDA"],
    ]);
    const r = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");
    expect(r.status).toBe(201);

    const revision = await request(app)
      .get(`/api/periodos/${periodoId}/marcaciones/${r.body.importacion_id}`)
      .set(auth());
    const fila = revision.body.detalle.find((d: { fecha: string }) => d.fecha === "2026-08-07");
    expect(fila.minutos_llegada_anticipada).toBe(0);
    // 08:30 a 16:30 = 480min bruto - 60 refrigerio = 420min = 7h, todo normal.
    expect(fila.horas_normales).toBe(7);
    expect(fila.horas_extra_tramo1).toBe(0);
  });
});

describe("PUT /api/periodos/:id/marcaciones/:importacionId/detalle/:detalleId", () => {
  it("confirma pagar la llegada anticipada como hora extra, recalculando el tramo correspondiente", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [
      // 2026-08-13 (jueves): 45 min de llegada anticipada (07:15 vs 08:00
      // programado), salida exacta a la hora programada.
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-13", "07:15", "ENTRADA"],
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-13", "17:00", "SALIDA"],
    ]);
    const importar = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");
    expect(importar.status).toBe(201);

    const revisionAntes = await request(app)
      .get(`/api/periodos/${periodoId}/marcaciones/${importar.body.importacion_id}`)
      .set(auth());
    const filaAntes = revisionAntes.body.detalle.find((d: { fecha: string }) => d.fecha === "2026-08-13");
    expect(filaAntes.minutos_llegada_anticipada).toBe(45);
    expect(filaAntes.anticipacion_pagada).toBe(false);
    expect(filaAntes.horas_extra_tramo1).toBe(0);
    expect(filaAntes.minutos_extra_tramo1).toBe(0);

    const put = await request(app)
      .put(`/api/periodos/${periodoId}/marcaciones/${importar.body.importacion_id}/detalle/${filaAntes.id}`)
      .set(auth())
      .send({ anticipacion_pagada: true });
    expect(put.status).toBe(200);
    expect(put.body.anticipacion_pagada).toBe(true);
    expect(put.body.horas_extra_tramo1).toBe(0);
    expect(put.body.minutos_extra_tramo1).toBe(45);

    const revisionDespues = await request(app)
      .get(`/api/periodos/${periodoId}/marcaciones/${importar.body.importacion_id}`)
      .set(auth());
    const filaDespues = revisionDespues.body.detalle.find((d: { fecha: string }) => d.fecha === "2026-08-13");
    expect(filaDespues.anticipacion_pagada).toBe(true);
    expect(filaDespues.minutos_extra_tramo1).toBe(45);

    // Se puede revertir la confirmacion igual de facil.
    const putRevertir = await request(app)
      .put(`/api/periodos/${periodoId}/marcaciones/${importar.body.importacion_id}/detalle/${filaAntes.id}`)
      .set(auth())
      .send({ anticipacion_pagada: false });
    expect(putRevertir.status).toBe(200);
    expect(putRevertir.body.horas_extra_tramo1).toBe(0);
    expect(putRevertir.body.minutos_extra_tramo1).toBe(0);
  });

  it("rechaza el toggle una vez que la fila ya se aplico al Tareo Diario", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-14", "07:45", "ENTRADA"],
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-14", "17:00", "SALIDA"],
    ]);
    const importar = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");
    const importacionId = importar.body.importacion_id;
    const revision = await request(app).get(`/api/periodos/${periodoId}/marcaciones/${importacionId}`).set(auth());
    const fila = revision.body.detalle.find((d: { fecha: string }) => d.fecha === "2026-08-14");
    expect(fila.minutos_llegada_anticipada).toBe(15);

    const aplicar = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/${importacionId}/aplicar`)
      .set(auth())
      .send({ contrato_ids: [contratoId] });
    expect(aplicar.status).toBe(200);
    expect(aplicar.body.aplicados).toContain(contratoId);

    const put = await request(app)
      .put(`/api/periodos/${periodoId}/marcaciones/${importacionId}/detalle/${fila.id}`)
      .set(auth())
      .send({ anticipacion_pagada: true });
    expect(put.status).toBe(400);
    expect(put.body.error).toMatch(/ya se aplico/);
  });

  it("devuelve 400 si falta 'anticipacion_pagada' en el body", async () => {
    const xlsx = await armarXlsx(ENCABEZADO, [
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-15", "08:00", "ENTRADA"],
      [DNI_VIGENTE, "PRUEBA MARCACIONES VIGENTE", "2026-08-15", "17:00", "SALIDA"],
    ]);
    const importar = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");
    const revision = await request(app)
      .get(`/api/periodos/${periodoId}/marcaciones/${importar.body.importacion_id}`)
      .set(auth());
    const fila = revision.body.detalle[0];

    const put = await request(app)
      .put(`/api/periodos/${periodoId}/marcaciones/${importar.body.importacion_id}/detalle/${fila.id}`)
      .set(auth())
      .send({});
    expect(put.status).toBe(400);
  });
});

describe("POST /api/periodos/:id/marcaciones/:importacionId/aplicar", () => {
  it("escribe los dias calculados en tareo_diario reutilizando la validacion existente, y marca la importacion como aplicada", async () => {
    const xlsx = await armarXlsx(["DNI", "FECHA", "HORA", "TIPO"], [
      [DNI_VIGENTE, "2026-08-11", "08:00", "ENTRADA"],
      [DNI_VIGENTE, "2026-08-11", "18:00", "SALIDA"],
    ]);
    const importar = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");
    expect(importar.status).toBe(201);
    const importacionId = importar.body.importacion_id;

    const aplicar = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/${importacionId}/aplicar`)
      .set(auth())
      .send({});
    expect(aplicar.status).toBe(200);
    expect(aplicar.body.aplicados).toContain(contratoId);
    expect(aplicar.body.errores).toEqual([]);

    const tareo = await pool.query(
      "SELECT * FROM tareo_diario WHERE periodo_id = $1 AND contrato_id = $2 AND fecha = '2026-08-11'",
      [periodoId, contratoId]
    );
    expect(tareo.rowCount).toBe(1);
    // 08:00 a 18:00 = 600min - 60 = 540min neto; jornada neta 480min ->
    // normal 8h, extra 60min = 1h (tramo1).
    expect(tareo.rows[0].horas_normales).toBe(8);
    expect(tareo.rows[0].horas_extra_tramo1).toBe(1);

    const revision = await request(app).get(`/api/periodos/${periodoId}/marcaciones/${importacionId}`).set(auth());
    expect(revision.body.detalle[0].aplicado).toBe(true);
    expect(revision.body.importacion.aplicado_en).not.toBeNull();
  });

  it("una segunda llamada a aplicar no vuelve a tocar los dias ya aplicados (no hay nada pendiente)", async () => {
    const xlsx = await armarXlsx(["DNI", "FECHA", "HORA", "TIPO"], [
      [DNI_VIGENTE, "2026-08-12", "08:00", "ENTRADA"],
      [DNI_VIGENTE, "2026-08-12", "17:00", "SALIDA"],
    ]);
    const importar = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/importar`)
      .set(auth())
      .attach("archivo", xlsx, "marcaciones.xlsx");
    const importacionId = importar.body.importacion_id;

    const primeraAplicacion = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/${importacionId}/aplicar`)
      .set(auth())
      .send({});
    expect(primeraAplicacion.body.aplicados).toContain(contratoId);

    const segundaAplicacion = await request(app)
      .post(`/api/periodos/${periodoId}/marcaciones/${importacionId}/aplicar`)
      .set(auth())
      .send({});
    expect(segundaAplicacion.status).toBe(200);
    expect(segundaAplicacion.body.aplicados).toEqual([]);
    expect(segundaAplicacion.body.errores).toEqual([]);
  });
});
