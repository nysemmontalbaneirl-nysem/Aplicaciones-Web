// Pruebas del archivo OFICIAL de AFPnet (migracion 041, ver
// src/afpnetExcel.ts): generarFilasAFPnetExcel + construirWorkbookAFPnetExcel.
// A diferencia del CSV simplificado ya existente (afpnet.ts, cubierto por
// planilla_mensual_exportaciones.test.ts), este es el archivo con la
// estructura de 17 columnas que AFPnet exige para subir directamente al
// portal - confirmado con el usuario a partir de una declaracion real
// (DECLARACION_AFPNET_JULIO2026_-_P009.xlsx) que el mismo subio.
import { pool } from "../src/db";
import { consolidarPlanillaMensual } from "../src/planillaMensual";
import { generarFilasAFPnetExcel, construirWorkbookAFPnetExcel } from "../src/afpnetExcel";
import { generarCSVAFPnetMensual } from "../src/afpnet";

const PROYECTO = "Proyecto AFPNET-EXCEL-TEST"; // proyecto de texto libre, no requiere fila en "proyectos"
const ANIO = 2026;
const MES = 11; // mes sin usar por otras pruebas de tabla_salarial_mensual/tasas_afp_mensuales con este PROYECTO
const JORNAL_PEON = 70.0;

let adminUserId: number;
const empleadosCreados: number[] = [];
const contratosCreados: number[] = [];
let periodoId: number;
let planillaMensualId: number;

// DNI de cada trabajador de prueba, para identificar filas/advertencias sin
// depender del orden (generarFilasAFPnetExcel ordena por apellidos_nombres).
// Prefijo "5555100" propio de este archivo, para no chocar con los DNI de
// prueba "7777000x" ya usados en tareo_diario.test.ts.
const DNI_NORMAL = "55551001"; // tipo_documento '01' (DNI), todo completo -> fila normal, sin advertencia
const DNI_EXTRANJERO = "55551002"; // tipo_documento '04' (Carne Extranjeria) -> mapea a '1'
const DNI_SIN_MAPEO = "55551003"; // tipo_documento sin mapeo confirmado ('06', RUC) -> excluido + advertencia
const DNI_SIN_APELLIDOS = "55551004"; // apellido_paterno/materno/nombres NULL -> incluido con advertencia
const DNI_INGRESO_EN_MES = "55551005"; // fecha_ingreso Y fecha_cese DENTRO del mes -> Inicio/Cese RL = "S"
const DNI_LEGADO_UN_DIGITO = "55551006"; // tipo_documento '1' (DEFAULT historico de 1 solo digito, ver empleados en schema.sql) -> debe mapear igual que '01' (DNI)

async function crearTrabajador(opts: {
  dni: string;
  tipoDocumento: string;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
  nombres: string | null;
  fechaIngreso: string;
  fechaCese: string | null;
  categoria?: string;
}): Promise<number> {
  const e = await pool.query(
    `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos,
                             apellido_paterno, apellido_materno, nombres)
     VALUES ($1, $2, $3, 0, $4, $5, $6) RETURNING id`,
    [opts.tipoDocumento, opts.dni, `PRUEBA AFPNET EXCEL ${opts.dni}`, opts.apellidoPaterno, opts.apellidoMaterno, opts.nombres]
  );
  const empleadoId = e.rows[0].id as number;
  empleadosCreados.push(empleadoId);
  const c = await pool.query(
    `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, afp_nombre, cuspp,
                             fecha_ingreso, fecha_cese, estado)
     VALUES ($1, $2, $3, 'AFP', 'INTEGRA', $4, $5, $6, $7) RETURNING id`,
    [
      empleadoId,
      PROYECTO,
      opts.categoria ?? "PEON",
      `CUSPP-${opts.dni}`,
      opts.fechaIngreso,
      opts.fechaCese,
      opts.fechaCese ? "CESADO" : "HABIL",
    ]
  );
  const contratoId = c.rows[0].id as number;
  contratosCreados.push(contratoId);
  return contratoId;
}

async function cargarTareo(contratoId: number, fechas: string[]) {
  const filas = fechas.map((fecha) => `('${fecha}', ${periodoId}, ${contratoId}, 8, 0)`);
  await pool.query(
    `INSERT INTO tareo_diario (fecha, periodo_id, contrato_id, horas_normales, minutos_normales) VALUES ${filas.join(", ")}`
  );
}

beforeAll(async () => {
  const idResult = await pool.query("SELECT id FROM usuarios WHERE correo = 'admin@prueba.local'");
  adminUserId = idResult.rows[0].id as number;

  await pool.query(
    `INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
     VALUES ($1, $2, 'PEON', $3, 0.30, 0, 8.60, 12.98)
     ON CONFLICT (anio, mes, categoria) DO UPDATE SET jornal_basico = EXCLUDED.jornal_basico`,
    [ANIO, MES, JORNAL_PEON]
  );
  await pool.query(
    `INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
     VALUES ($1, $2, 'INTEGRA', 0.0155, 0.0137, 0.10)
     ON CONFLICT (anio, mes, afp_nombre) DO NOTHING`,
    [ANIO, MES]
  );

  const p = await pool.query(
    `INSERT INTO periodos_planilla (anio, mes, quincena, tipo, fecha_inicio, fecha_fin, dias_periodo, proyecto)
     VALUES ($1, $2, 1, 'QUINCENAL', $3, $4, 15, $5) RETURNING id`,
    [ANIO, MES, `${ANIO}-${String(MES).padStart(2, "0")}-01`, `${ANIO}-${String(MES).padStart(2, "0")}-15`, PROYECTO]
  );
  periodoId = p.rows[0].id as number;

  const diasComunes = [
    `${ANIO}-${String(MES).padStart(2, "0")}-02`,
    `${ANIO}-${String(MES).padStart(2, "0")}-03`,
    `${ANIO}-${String(MES).padStart(2, "0")}-04`,
  ];

  const contratoNormal = await crearTrabajador({
    dni: DNI_NORMAL,
    tipoDocumento: "01",
    apellidoPaterno: "PEREZ",
    apellidoMaterno: "GOMEZ",
    nombres: "JUAN",
    fechaIngreso: "2026-01-01", // antes del mes -> Inicio/Cese RL = N
    fechaCese: null,
  });
  await cargarTareo(contratoNormal, diasComunes);

  const contratoExtranjero = await crearTrabajador({
    dni: DNI_EXTRANJERO,
    tipoDocumento: "04",
    apellidoPaterno: "SILVA",
    apellidoMaterno: "TORRES",
    nombres: "CARLOS",
    fechaIngreso: "2026-01-01",
    fechaCese: null,
  });
  await cargarTareo(contratoExtranjero, diasComunes);

  const contratoSinMapeo = await crearTrabajador({
    dni: DNI_SIN_MAPEO,
    tipoDocumento: "06", // RUC - no esta en MAPEO_TIPO_DOCUMENTO_AFPNET
    apellidoPaterno: "RUIZ",
    apellidoMaterno: "DIAZ",
    nombres: "LUIS",
    fechaIngreso: "2026-01-01",
    fechaCese: null,
  });
  await cargarTareo(contratoSinMapeo, diasComunes);

  const contratoSinApellidos = await crearTrabajador({
    dni: DNI_SIN_APELLIDOS,
    tipoDocumento: "01",
    apellidoPaterno: null,
    apellidoMaterno: null,
    nombres: null,
    fechaIngreso: "2026-01-01",
    fechaCese: null,
  });
  await cargarTareo(contratoSinApellidos, diasComunes);

  const mm = String(MES).padStart(2, "0");
  const contratoIngresoEnMes = await crearTrabajador({
    dni: DNI_INGRESO_EN_MES,
    tipoDocumento: "01",
    apellidoPaterno: "FLORES",
    apellidoMaterno: "VEGA",
    nombres: "PEDRO",
    fechaIngreso: `${ANIO}-${mm}-02`, // dentro del mes -> Inicio RL = S
    fechaCese: `${ANIO}-${mm}-04`, // dentro del mes -> Cese RL = S
  });
  await cargarTareo(contratoIngresoEnMes, diasComunes);

  // Bug real detectado en produccion (19/09/2026): trabajadores cargados por
  // importacion masiva heredan el DEFAULT historico de 1 solo digito ('1')
  // de empleados.tipo_documento (routes/importacion.ts nunca toca esa
  // columna) - deben mapear a DNI igual que el '01' de 2 digitos.
  const contratoLegadoUnDigito = await crearTrabajador({
    dni: DNI_LEGADO_UN_DIGITO,
    tipoDocumento: "1",
    apellidoPaterno: "QUISPE",
    apellidoMaterno: "MAMANI",
    nombres: "JOSE",
    fechaIngreso: "2026-01-01",
    fechaCese: null,
  });
  await cargarTareo(contratoLegadoUnDigito, diasComunes);

  const resultado = await consolidarPlanillaMensual(PROYECTO, ANIO, MES, adminUserId);
  expect(resultado.errores).toEqual([]);
  expect(resultado.trabajadores_consolidados).toBe(6);
  planillaMensualId = resultado.planilla_mensual_id;
});

afterAll(async () => {
  await pool.query("DELETE FROM detalle_planilla_mensual WHERE planilla_mensual_id = $1", [planillaMensualId]);
  await pool.query("DELETE FROM planilla_mensual WHERE proyecto = $1 AND anio = $2 AND mes = $3", [PROYECTO, ANIO, MES]);
  await pool.query("DELETE FROM tareo_diario WHERE periodo_id = $1", [periodoId]);
  await pool.query("DELETE FROM periodos_planilla WHERE id = $1", [periodoId]);
  for (const id of contratosCreados) {
    await pool.query("DELETE FROM contratos WHERE id = $1", [id]);
  }
  for (const id of empleadosCreados) {
    await pool.query("DELETE FROM empleados WHERE id = $1", [id]);
  }
  await pool.query("DELETE FROM tabla_salarial_mensual WHERE anio = $1 AND mes = $2 AND categoria = 'PEON'", [ANIO, MES]);
  await pool.query("DELETE FROM tasas_afp_mensuales WHERE anio = $1 AND mes = $2", [ANIO, MES]);
  await pool.end();
});

describe("generarFilasAFPnetExcel", () => {
  it("arma 17 columnas por trabajador, excluye el tipo de documento sin mapeo y avisa de ambos casos no bloqueantes", async () => {
    const { filas, advertencias } = await generarFilasAFPnetExcel(planillaMensualId, PROYECTO, ANIO, MES);

    // Se excluye solo el trabajador con tipo de documento sin mapeo -> 5 filas, no 6.
    expect(filas).toHaveLength(5);
    for (const fila of filas) {
      expect(fila).toHaveLength(17);
    }
    expect(filas.some((f) => f[3] === DNI_SIN_MAPEO)).toBe(false);

    // 2 advertencias esperadas: tipo de documento sin mapeo (excluido) y apellidos incompletos (incluido igual).
    expect(advertencias.some((a) => a.includes(DNI_SIN_MAPEO) && a.includes("tipo de documento"))).toBe(true);
    expect(advertencias.some((a) => a.includes(DNI_SIN_APELLIDOS) && a.includes("apellido"))).toBe(true);
    expect(advertencias).toHaveLength(2);
  });

  it("mapea el tipo de documento propio de AFPnet (01->0 DNI, 04->1 Carne de Extranjeria)", async () => {
    const { filas } = await generarFilasAFPnetExcel(planillaMensualId, PROYECTO, ANIO, MES);

    const filaNormal = filas.find((f) => f[3] === DNI_NORMAL)!;
    expect(filaNormal[2]).toBe("0");

    const filaExtranjero = filas.find((f) => f[3] === DNI_EXTRANJERO)!;
    expect(filaExtranjero[2]).toBe("1");
  });

  it("normaliza el tipo_documento LEGADO de 1 solo digito ('1') al mismo DNI que '01' (bug real de produccion, 19/09)", async () => {
    const { filas, advertencias } = await generarFilasAFPnetExcel(planillaMensualId, PROYECTO, ANIO, MES);

    const filaLegado = filas.find((f) => f[3] === DNI_LEGADO_UN_DIGITO)!;
    expect(filaLegado).toBeDefined(); // antes del fix, esta fila se excluia por "sin mapeo"
    expect(filaLegado[2]).toBe("0");
    expect(advertencias.some((a) => a.includes(DNI_LEGADO_UN_DIGITO))).toBe(false);
  });

  it("arma apellido paterno/materno/nombres en columnas separadas, en blanco si faltan (no bloquea)", async () => {
    const { filas } = await generarFilasAFPnetExcel(planillaMensualId, PROYECTO, ANIO, MES);

    const filaNormal = filas.find((f) => f[3] === DNI_NORMAL)!;
    expect([filaNormal[4], filaNormal[5], filaNormal[6]]).toEqual(["PEREZ", "GOMEZ", "JUAN"]);

    const filaSinApellidos = filas.find((f) => f[3] === DNI_SIN_APELLIDOS)!;
    expect([filaSinApellidos[4], filaSinApellidos[5], filaSinApellidos[6]]).toEqual(["", "", ""]);
  });

  it('Excepcion de Aportar (columna K, indice 10) siempre en blanco', async () => {
    const { filas } = await generarFilasAFPnetExcel(planillaMensualId, PROYECTO, ANIO, MES);
    for (const fila of filas) {
      expect(fila[10]).toBe("");
    }
  });

  it("aportes voluntarios (columnas M, N, O) siempre en 0, y AFP (columna Q) siempre en blanco", async () => {
    const { filas } = await generarFilasAFPnetExcel(planillaMensualId, PROYECTO, ANIO, MES);
    for (const fila of filas) {
      expect([fila[12], fila[13], fila[14]]).toEqual([0, 0, 0]);
      expect(fila[16]).toBe("");
    }
  });

  it('Inicio/Cese de RL (S/N) segun si la fecha de ingreso/cese cae dentro del mes consolidado', async () => {
    const { filas } = await generarFilasAFPnetExcel(planillaMensualId, PROYECTO, ANIO, MES);

    // Ingreso antes del mes, sin cese -> Inicio N, Cese N.
    const filaNormal = filas.find((f) => f[3] === DNI_NORMAL)!;
    expect([filaNormal[8], filaNormal[9]]).toEqual(["N", "N"]);

    // Ingreso y cese DENTRO del mes -> Inicio S, Cese S.
    const filaIngresoEnMes = filas.find((f) => f[3] === DNI_INGRESO_EN_MES)!;
    expect([filaIngresoEnMes[8], filaIngresoEnMes[9]]).toEqual(["S", "S"]);

    // Relacion Laboral (columna H, indice 7): siempre "S" (solo entran trabajadores ya consolidados).
    for (const fila of filas) {
      expect(fila[7]).toBe("S");
    }
  });

  it("tipo de trabajo (columna P, indice 15): 'C' para categorias de construccion civil, 'N' para las demas", async () => {
    const { filas } = await generarFilasAFPnetExcel(planillaMensualId, PROYECTO, ANIO, MES);
    for (const fila of filas) {
      expect(fila[15]).toBe("C"); // todos los trabajadores de este fixture son PEON (construccion civil)
    }

    // Un contrato AFP de regimen general (no construccion civil) en la misma
    // Planilla Mensual/proyecto debe mapear a "N" - se inserta manualmente
    // porque consolidarPlanillaMensual solo consolida obreros (ver
    // planillaMensual.ts), asi que esta fila no puede salir de ahi.
    const empleadoRegimenGeneral = await pool.query(
      `INSERT INTO empleados (tipo_documento, numero_documento, apellidos_nombres, numero_hijos)
       VALUES ('01', '55551099', 'PRUEBA REGIMEN GENERAL AFPNET EXCEL', 0) RETURNING id`
    );
    const empleadoId = empleadoRegimenGeneral.rows[0].id as number;
    empleadosCreados.push(empleadoId);
    const contratoRegimenGeneral = await pool.query(
      `INSERT INTO contratos (empleado_id, proyecto, categoria_ocupacional, sistema_pension, afp_nombre, cuspp, fecha_ingreso, estado)
       VALUES ($1, $2, 'EMPLEADO', 'AFP', 'INTEGRA', 'CUSPP-55551099', '2026-01-01', 'HABIL') RETURNING id`,
      [empleadoId, PROYECTO]
    );
    const contratoId = contratoRegimenGeneral.rows[0].id as number;
    contratosCreados.push(contratoId);
    await pool.query(
      `INSERT INTO detalle_planilla_mensual (planilla_mensual_id, contrato_id, sueldo_basico) VALUES ($1, $2, 1500)`,
      [planillaMensualId, contratoId]
    );

    const { filas: filasConRegimenGeneral } = await generarFilasAFPnetExcel(planillaMensualId, PROYECTO, ANIO, MES);
    const filaRegimenGeneral = filasConRegimenGeneral.find((f) => f[3] === "55551099")!;
    expect(filaRegimenGeneral).toBeDefined();
    expect(filaRegimenGeneral[15]).toBe("N");

    // Limpieza dentro del propio test: esta fila se inserto a mano (fuera del
    // flujo normal de consolidarPlanillaMensual) solo para esta prueba - se
    // retira para no afectar el conteo de filas de las pruebas siguientes.
    await pool.query("DELETE FROM detalle_planilla_mensual WHERE contrato_id = $1", [contratoId]);
  });

  it("remuneracion asegurable (columna L, indice 11) usa la MISMA formula que el CSV simplificado de AFPnet", async () => {
    const { filas } = await generarFilasAFPnetExcel(planillaMensualId, PROYECTO, ANIO, MES);
    const csv = await generarCSVAFPnetMensual(planillaMensualId, PROYECTO);
    const filasCsv = csv.split("\n").slice(1); // sin encabezado

    const filaNormal = filas.find((f) => f[3] === DNI_NORMAL)!;
    const filaCsvNormal = filasCsv.find((l) => l.includes(DNI_NORMAL))!;
    expect(filaCsvNormal).toBeDefined();
    // El CSV trae "Remuneracion afecta" como su 6ta columna (indice 5).
    const remuneracionCsv = filaCsvNormal.split(",")[5];
    expect(filaNormal[11]).toBe(remuneracionCsv);
    expect(Number(filaNormal[11])).toBeGreaterThan(0);
  });

  it("planilla mensual sin trabajadores AFP de ese proyecto -> filas y advertencias vacias, sin lanzar error", async () => {
    const { filas, advertencias } = await generarFilasAFPnetExcel(planillaMensualId, "Proyecto Que No Existe", ANIO, MES);
    expect(filas).toEqual([]);
    expect(advertencias).toEqual([]);
  });
});

describe("construirWorkbookAFPnetExcel", () => {
  it("arma un workbook de una sola hoja 'AFPnet', SIN fila de encabezado, con DNI y CUSPP como texto", async () => {
    const { filas } = await generarFilasAFPnetExcel(planillaMensualId, PROYECTO, ANIO, MES);
    const workbook = construirWorkbookAFPnetExcel(filas);

    const hoja = workbook.getWorksheet("AFPnet");
    expect(hoja).toBeDefined();
    expect(hoja!.rowCount).toBe(filas.length); // sin fila de encabezado - la primera fila YA es el primer trabajador
    expect(hoja!.getColumn(4).numFmt).toBe("@"); // numero de documento
    expect(hoja!.getColumn(2).numFmt).toBe("@"); // CUSPP
  });
});
