// Pruebas de la migracion 048 (dominical proporcional / feriado no
// laborado / sobretasas / condicion de trabajo / Gratificacion con 2
// denominadores), reconstruida desde backend_dist de produccion (ver
// RECONSTRUCCION_BRECHAS.md, puntos 4/4.1/15). A diferencia del resto de
// este arbol (reconstruido aplicando archivos .patch recuperados), esta
// migracion se reconstruyo leyendo el codigo YA COMPILADO de produccion,
// asi que estas pruebas verifican la logica contra los mismos casos reales
// documentados en los comentarios de motorCalculo.ts.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";
import {
  calcularDiasDominicalProporcional,
  calcularGratificacion,
  calcularRemuneracionDominicalProporcional,
  calcularSobretasaDominical,
  calcularSobretasaFeriado,
  DiaCrudoDominical,
} from "../src/motorCalculo";
import { AsistenciaEntrada, CategoriaOcupacional, Contrato } from "../src/tipos";

// ===========================================================================
// 1) calcularGratificacion (construccion civil) - caso real ALVAREZ CALDERON,
//    periodo 08/2026: confirma que agosto-diciembre usa N=150 (no 210 todo
//    el año, que pagaba de menos: 17.01/dia en vez de 23.81/dia).
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

// Numerador (40 jornales) y denominadores (210 enero-julio / 150
// agosto-diciembre) confirmados en conceptos_planilla -> GRATIFICACION
// (migracion 048, ver sql/migracion_048_....sql).
const FACTOR_NUMERADOR = 40;
const FACTOR_DENOM_ENERO_JULIO = 210;
const FACTOR_DENOM_AGOSTO_DICIEMBRE = 150;

describe("calcularGratificacion (funcion pura) - construccion civil, 2 denominadores por tramo (migracion 048)", () => {
  it.each([
    ["OPERARIO", 89.3, 17.01],
    ["OFICIAL", 69.75, 13.29],
    ["PEON", 62.8, 11.96],
  ] as const)(
    "tramo ENERO-JULIO: %s con jornal %d -> tasa diaria %d/dia (40/210)",
    (categoria, jornal, tasaEsperada) => {
      // 1 dia computable para aislar la tasa diaria exacta.
      const gratificacion = calcularGratificacion(
        contratoConstruccionCivil(categoria),
        asistencia({ dias_trabajados: 1 }),
        jornal,
        0,
        3, // marzo: cae en el tramo enero-julio
        2026,
        "2026-01-01",
        FACTOR_NUMERADOR,
        FACTOR_DENOM_ENERO_JULIO,
        FACTOR_DENOM_AGOSTO_DICIEMBRE
      );
      expect(gratificacion).toBeCloseTo(tasaEsperada, 2);
    }
  );

  it.each([
    ["OPERARIO", 89.3, 23.81],
    ["OFICIAL", 69.75, 18.6],
    ["PEON", 62.8, 16.75],
  ] as const)(
    "tramo AGOSTO-DICIEMBRE: %s con jornal %d -> tasa diaria %d/dia (40/150), NO 40/210",
    (categoria, jornal, tasaEsperada) => {
      const gratificacion = calcularGratificacion(
        contratoConstruccionCivil(categoria),
        asistencia({ dias_trabajados: 1 }),
        jornal,
        0,
        8, // agosto: cae en el tramo agosto-diciembre
        2026,
        "2026-01-01",
        FACTOR_NUMERADOR,
        FACTOR_DENOM_ENERO_JULIO,
        FACTOR_DENOM_AGOSTO_DICIEMBRE
      );
      expect(gratificacion).toBeCloseTo(tasaEsperada, 2);
    }
  );

  it("caso real ALVAREZ CALDERON (periodo 08/2026, Operario 89.30): usar N=210 todo el año pagaria de MENOS (17.01 en vez de 23.81)", () => {
    const conDenominadorCorrecto = calcularGratificacion(
      contratoConstruccionCivil("OPERARIO"),
      asistencia({ dias_trabajados: 1 }),
      89.3,
      0,
      8,
      2026,
      "2026-01-01",
      FACTOR_NUMERADOR,
      FACTOR_DENOM_ENERO_JULIO,
      FACTOR_DENOM_AGOSTO_DICIEMBRE
    );
    // Antes de esta migracion (bug real reportado): mismo denominador (210)
    // para todo el año, sin distinguir tramo.
    const conDenominadorViejoBug = (89.3 * (40 / 210) * 1);
    expect(conDenominadorCorrecto).toBeCloseTo(23.81, 2);
    expect(conDenominadorCorrecto).not.toBeCloseTo(conDenominadorViejoBug, 2);
  });

  it("los dias computables incluyen dominical no laborado, feriado (trabajado o no) y descanso medico computable", () => {
    const gratificacion = calcularGratificacion(
      contratoConstruccionCivil("OPERARIO"),
      asistencia({
        dias_trabajados: 20,
        dias_dominical: 1,
        dias_dominical_no_laborado: 2,
        dias_feriado: 1,
        dias_subsidio_enfermedad_computable: 1,
        dias_subsidio_maternidad: 1,
        dias_licencia_paternidad: 1,
      }),
      89.3,
      0,
      3,
      2026,
      "2026-01-01",
      FACTOR_NUMERADOR,
      FACTOR_DENOM_ENERO_JULIO,
      FACTOR_DENOM_AGOSTO_DICIEMBRE
    );
    // dias computables = 20+1+2+1+1+1+1 = 27; tasa = 89.30 x 40/210 = 17.0095...
    const diasComputables = 20 + 1 + 2 + 1 + 1 + 1 + 1;
    const tasa = 89.3 * (40 / 210);
    expect(gratificacion).toBeCloseTo(Math.round(tasa * diasComputables * 100) / 100, 2);
  });

  it("EMPLEADO (regimen general) sigue con la formula semestral fija, sin cambios por esta migracion", () => {
    const gratificacion = calcularGratificacion(
      contratoConstruccionCivil("EMPLEADO"),
      asistencia({ dias_trabajados: 30 }),
      50,
      3000,
      7,
      2026,
      "2026-01-01",
      FACTOR_NUMERADOR,
      FACTOR_DENOM_ENERO_JULIO,
      FACTOR_DENOM_AGOSTO_DICIEMBRE
    );
    expect(gratificacion).toBeCloseTo(3000, 2);
  });
});

// ===========================================================================
// 2) calcularDiasDominicalProporcional (funcion pura, migracion 023)
// ===========================================================================
describe("calcularDiasDominicalProporcional (funcion pura)", () => {
  it("semana completa trabajada (48h de lunes a sabado) sin domingo trabajado -> 1 dia proporcional (48/6/8=1)", () => {
    const dias: DiaCrudoDominical[] = [
      { fecha: "2026-08-03", horasJornada: 8, domingoTrabajado: false }, // lunes
      { fecha: "2026-08-04", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-05", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-06", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-07", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-08", horasJornada: 8, domingoTrabajado: false }, // sabado
    ];
    expect(calcularDiasDominicalProporcional(dias)).toBeCloseTo(1, 2);
  });

  it("si el domingo de esa semana SI se trabajo, esa semana no aporta nada (ya se paga por REM_DOMINICAL + SOBRETASA_DOMINICAL)", () => {
    const dias: DiaCrudoDominical[] = [
      { fecha: "2026-08-03", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-04", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-05", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-06", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-07", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-08", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-09", horasJornada: 0, domingoTrabajado: true }, // domingo trabajado
    ];
    expect(calcularDiasDominicalProporcional(dias)).toBe(0);
  });

  it("semana parcial (solo 5 dias de 8h, ej. quincena que corta a mitad de semana) -> prorrateo fraccionario (40/6/8=0.83)", () => {
    const dias: DiaCrudoDominical[] = [
      { fecha: "2026-08-03", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-04", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-05", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-06", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-07", horasJornada: 8, domingoTrabajado: false },
    ];
    expect(calcularDiasDominicalProporcional(dias)).toBeCloseTo(0.83, 2);
  });

  it("varias semanas se acumulan (2 semanas completas de 48h no laboradas en domingo -> 2 dias)", () => {
    const semana1: DiaCrudoDominical[] = [
      { fecha: "2026-08-03", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-04", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-05", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-06", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-07", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-08", horasJornada: 8, domingoTrabajado: false },
    ];
    const semana2: DiaCrudoDominical[] = [
      { fecha: "2026-08-10", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-11", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-12", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-13", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-14", horasJornada: 8, domingoTrabajado: false },
      { fecha: "2026-08-15", horasJornada: 8, domingoTrabajado: false },
    ];
    expect(calcularDiasDominicalProporcional([...semana1, ...semana2])).toBeCloseTo(2, 2);
  });

  it("sin ningun dia registrado -> 0", () => {
    expect(calcularDiasDominicalProporcional([])).toBe(0);
  });
});

describe("calcularRemuneracionDominicalProporcional / calcularSobretasaDominical / calcularSobretasaFeriado (funciones puras)", () => {
  it("remuneracion dominical proporcional = jornal x dias_dominical_no_laborado", () => {
    const monto = calcularRemuneracionDominicalProporcional(89.3, asistencia({ dias_dominical_no_laborado: 0.83 }));
    expect(monto).toBeCloseTo(89.3 * 0.83, 2);
  });

  it("sobretasa dominical = jornal x dias_dominical (domingo SI trabajado) x factor (100% = 1.00)", () => {
    const monto = calcularSobretasaDominical(89.3, asistencia({ dias_dominical: 2 }), 1.0);
    expect(monto).toBeCloseTo(89.3 * 2 * 1.0, 2);
  });

  it("sobretasa feriado = jornal x dias_feriado_trabajado (NO dias_feriado total) x factor (200%)", () => {
    const monto = calcularSobretasaFeriado(89.3, asistencia({ dias_feriado: 3, dias_feriado_trabajado: 1 }), 2.0);
    // Usa dias_feriado_trabajado (1), no dias_feriado total (3, que incluye
    // 2 dias no laborados que ya no generan sobretasa).
    expect(monto).toBeCloseTo(89.3 * 1 * 2.0, 2);
  });
});

// ===========================================================================
// 3) Integracion: CRUD de dias_feriados (routes/conceptos.ts, migracion 048)
// ===========================================================================
let tokenAdmin: string;
let tokenTareador: string;
const feriadosCreados: number[] = [];

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const rAdmin = await request(app).post("/api/auth/login").send({ correo: "admin@prueba.local", password: CLAVE_PRUEBA });
  tokenAdmin = rAdmin.body.token as string;
  const rTareador = await request(app)
    .post("/api/auth/login")
    .send({ correo: "tareador-a@prueba.local", password: CLAVE_PRUEBA });
  tokenTareador = rTareador.body.token as string;
});

afterAll(async () => {
  for (const id of feriadosCreados) {
    await pool.query("DELETE FROM dias_feriados WHERE id = $1", [id]);
  }
});

describe("CRUD /api/conceptos/dias-feriados", () => {
  it("GET sin el permiso conceptos.editar (ej. TAREADOR) -> 403", async () => {
    const r = await request(app).get("/api/conceptos/dias-feriados").set(auth(tokenTareador));
    expect(r.status).toBe(403);
  });

  it("POST crea un feriado NACIONAL (sin ubicacion) y GET lo devuelve", async () => {
    const post = await request(app)
      .post("/api/conceptos/dias-feriados")
      .set(auth(tokenAdmin))
      .send({ fecha: "2026-12-25", descripcion: "Navidad" });
    expect(post.status).toBe(201);
    expect(post.body.ambito).toBe("NACIONAL");
    feriadosCreados.push(post.body.id);

    const get = await request(app).get("/api/conceptos/dias-feriados").set(auth(tokenAdmin));
    expect(get.status).toBe(200);
    expect(get.body.some((f: { id: number; descripcion: string }) => f.id === post.body.id && f.descripcion === "Navidad")).toBe(true);
  });

  it("POST rechaza un NACIONAL con ubicacion (regla ambito<->ubicacion)", async () => {
    const r = await request(app)
      .post("/api/conceptos/dias-feriados")
      .set(auth(tokenAdmin))
      .send({ fecha: "2026-11-01", descripcion: "Prueba invalida", ambito: "NACIONAL", ubigeo_departamento_codigo: "15" });
    expect(r.status).toBe(400);
  });

  it("POST rechaza un REGIONAL sin departamento", async () => {
    const r = await request(app)
      .post("/api/conceptos/dias-feriados")
      .set(auth(tokenAdmin))
      .send({ fecha: "2026-11-02", descripcion: "Prueba invalida", ambito: "REGIONAL" });
    expect(r.status).toBe(400);
  });

  it("POST rechaza un LOCAL sin provincia", async () => {
    const r = await request(app)
      .post("/api/conceptos/dias-feriados")
      .set(auth(tokenAdmin))
      .send({ fecha: "2026-11-03", descripcion: "Prueba invalida", ambito: "LOCAL" });
    expect(r.status).toBe(400);
  });

  it("POST acepta un REGIONAL con solo departamento", async () => {
    const r = await request(app)
      .post("/api/conceptos/dias-feriados")
      .set(auth(tokenAdmin))
      .send({ fecha: "2026-11-04", descripcion: "Aniversario regional", ambito: "REGIONAL", ubigeo_departamento_codigo: "15" });
    expect(r.status).toBe(201);
    expect(r.body.ambito).toBe("REGIONAL");
    expect(r.body.ubigeo_departamento_codigo).toBe("15");
    feriadosCreados.push(r.body.id);
  });

  it("POST duplicado (misma fecha+ambito+ubicacion) -> 400", async () => {
    const r = await request(app)
      .post("/api/conceptos/dias-feriados")
      .set(auth(tokenAdmin))
      .send({ fecha: "2026-12-25", descripcion: "Navidad de nuevo" });
    expect(r.status).toBe(400);
  });

  it("PUT edita solo la descripcion (edicion parcial, conserva ambito/ubicacion actuales)", async () => {
    const post = await request(app)
      .post("/api/conceptos/dias-feriados")
      .set(auth(tokenAdmin))
      .send({ fecha: "2026-10-08", descripcion: "Combate de Angamos" });
    feriadosCreados.push(post.body.id);

    const put = await request(app)
      .put(`/api/conceptos/dias-feriados/${post.body.id}`)
      .set(auth(tokenAdmin))
      .send({ descripcion: "Combate de Angamos (corregido)" });
    expect(put.status).toBe(200);
    expect(put.body.descripcion).toBe("Combate de Angamos (corregido)");
    expect(put.body.ambito).toBe("NACIONAL");
  });

  it("PUT sobre un id inexistente -> 404", async () => {
    const r = await request(app)
      .put("/api/conceptos/dias-feriados/999999")
      .set(auth(tokenAdmin))
      .send({ descripcion: "No existe" });
    expect(r.status).toBe(404);
  });

  it("DELETE elimina el feriado", async () => {
    const post = await request(app)
      .post("/api/conceptos/dias-feriados")
      .set(auth(tokenAdmin))
      .send({ fecha: "2026-05-01", descripcion: "Dia del Trabajo (a borrar)" });
    const id = post.body.id;

    const del = await request(app).delete(`/api/conceptos/dias-feriados/${id}`).set(auth(tokenAdmin));
    expect(del.status).toBe(204);

    const get = await request(app).get("/api/conceptos/dias-feriados").set(auth(tokenAdmin));
    expect(get.body.some((f: { id: number }) => f.id === id)).toBe(false);
  });
});
