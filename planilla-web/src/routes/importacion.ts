import { Router, Request, Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { CategoriaOcupacional, SistemaPension } from "../tipos";
import { validarEstadoCivil, validarSexo } from "../validaciones";

export const importacionRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const CATEGORIAS_VALIDAS: CategoriaOcupacional[] = [
  "OPERARIO",
  "OFICIAL",
  "PEON",
  "EMPLEADO",
  "EVENTUAL",
  "OPERARIO_EP",
  "OPERARIO_EM",
  "OPERARIO_TP",
  "PEON_A",
  "R_GENERAL",
];
const SISTEMAS_PENSION_VALIDOS: SistemaPension[] = ["AFP", "ONP"];

// Columnas esperadas en el CSV (encabezado en la primera fila, en este orden o con estos nombres).
// Las primeras son las historicas (obligatorias las que ya lo eran antes).
// Las de la seccion "T-Registro (SUNAT)" son NUEVAS y OPCIONALES: si no se
// incluyen en el CSV, la fila se procesa igual que antes (el dato SUNAT
// queda vacio y se puede completar luego editando el trabajador uno por
// uno). Reciben el CODIGO del catalogo (no el texto/nombre) - los mismos
// codigos que se ven en GET /api/catalogos, ej. entidad_bancaria_codigo
// "002" para BCP, ubigeo_distrito_codigo "190307" para SAN MIGUEL DE EL
// FAIQUE. Un codigo que no exista en el catalogo se reporta como error de
// esa fila (no detiene el resto de la importacion).
const COLUMNAS = [
  "DNI",
  "APELLIDOS_NOMBRES",
  "FECHA_NACIMIENTO",
  "GRADO_INSTRUCCION",
  "NUMERO_HIJOS",
  "CELULAR",
  "CORREO",
  "DIRECCION",
  "UBIGEO",
  "ENTIDAD_BANCARIA",
  "CUENTA_BANCARIA",
  "PROYECTO",
  "GRUPO",
  "CATEGORIA",
  "OCUPACION",
  "SISTEMA_PENSION",
  "AFP_NOMBRE",
  "CUSPP",
  "SISTEMA_COMISION",
  "FECHA_INGRESO",
  "FECHA_CESE",
  "SUELDO_BASE",
  "VIATICOS",
  "SINDICALIZADO",
  "POLIZA_SEGURO",
  "SCTR_SALUD",
  "ESSALUD_VIDA",
  "ESTADO",
  // --- T-Registro (SUNAT) - opcionales, van por CODIGO de catalogo ---
  "SEXO",
  "ESTADO_CIVIL",
  "NACIONALIDAD_CODIGO",
  "PAIS_EMISOR_DOCUMENTO_CODIGO",
  "GRADO_INSTRUCCION_CODIGO",
  "ENTIDAD_BANCARIA_CODIGO",
  "DISCAPACIDAD",
  "SEGUNDA_DIRECCION",
  "DIRECCION_ESSALUD",
  "UBIGEO_DEPARTAMENTO_CODIGO",
  "UBIGEO_PROVINCIA_CODIGO",
  "UBIGEO_DISTRITO_CODIGO",
  "CATEGORIA_OCUPACIONAL_SUNAT_CODIGO",
  "TIPO_TRABAJADOR_CODIGO",
  "REGIMEN_LABORAL_CODIGO",
  "TIPO_CONTRATO_CODIGO",
  "TIPO_PAGO_CODIGO",
  "PERIODICIDAD_CODIGO",
  "SITUACION_ESPECIAL_CODIGO",
  "JORNADA_LABORAL",
  "REGIMEN_SALUD_CODIGO",
  "EPS_CODIGO",
  "MOTIVO_BAJA_CODIGO",
] as const;

interface FilaCSV {
  [columna: string]: string;
}

interface ErrorFila {
  fila: number;
  dni: string;
  motivo: string;
}

function normalizarFecha(valor: string): string | null {
  const v = (valor ?? "").trim();
  if (!v) return null;
  // admite YYYY-MM-DD o DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

function esBooleano(valor: string): boolean {
  const v = (valor ?? "").trim().toUpperCase();
  return v === "1" || v === "SI" || v === "TRUE" || v === "X";
}

function num(valor: string): number | null {
  const v = (valor ?? "").trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Celda opcional del CSV -> string recortado o null (celda vacia/ausente).
function opcional(valor: string | undefined): string | null {
  return (valor ?? "").trim() || null;
}

// Mismo criterio que el alta individual (ver routes/empleados.ts): el texto
// libre historico (grado_instruccion/entidad_bancaria/ubigeo) se deriva del
// catalogo cuando el CSV manda el *_CODIGO pero no el texto directamente,
// para no perder el dato en pantallas/reportes que aun leen el texto libre.
async function resolverNombreCatalogo(tabla: string, codigo: string | null): Promise<string | null> {
  if (!codigo) return null;
  const r = await pool.query(`SELECT nombre FROM ${tabla} WHERE codigo = $1`, [codigo]);
  return r.rows[0]?.nombre ?? null;
}

async function componerUbigeoTexto(
  depCodigo: string | null,
  provCodigo: string | null,
  distCodigo: string | null
): Promise<string | null> {
  if (!depCodigo && !provCodigo && !distCodigo) return null;
  const partes: string[] = [];
  if (depCodigo) partes.push((await resolverNombreCatalogo("catalogo_ubigeo_departamento", depCodigo)) ?? depCodigo);
  if (provCodigo) partes.push((await resolverNombreCatalogo("catalogo_ubigeo_provincia", provCodigo)) ?? provCodigo);
  if (distCodigo) partes.push((await resolverNombreCatalogo("catalogo_ubigeo_distrito", distCodigo)) ?? distCodigo);
  return partes.join(" / ");
}

// Traduce las FK/CHECK de catalogo violadas (codigo SUNAT inexistente) a un
// mensaje legible para la columna "motivo" del reporte de errores por fila.
function mensajeErrorFila(err: unknown): string {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code === "23503") {
    return `Codigo de catalogo SUNAT inexistente (restriccion: ${e.constraint ?? "clave foranea"}). Revisa las columnas *_CODIGO de esta fila.`;
  }
  if (e.code === "23514") {
    return `Un valor de esta fila no cumple el formato esperado (restriccion: ${e.constraint ?? "check"}).`;
  }
  return (err as Error).message;
}

// Catalogos SUNAT que se incluyen como hojas de referencia en la plantilla
// descargable, para que quien la llena no tenga que adivinar el codigo ni
// volver a la pantalla de "Nuevo trabajador" para verlo. ubigeo_provincia y
// ubigeo_distrito llevan ademas el codigo del padre (departamento/provincia)
// para poder ubicar el codigo correcto en listas largas.
const CATALOGOS_REFERENCIA: { hoja: string; tabla: string; columnas: string }[] = [
  { hoja: "Nacionalidad", tabla: "catalogo_nacionalidad", columnas: "codigo, nombre" },
  { hoja: "GradoInstruccion", tabla: "catalogo_grado_instruccion", columnas: "codigo, nombre" },
  { hoja: "Banco", tabla: "catalogo_banco", columnas: "codigo, nombre" },
  { hoja: "CategoriaOcupacionalSUNAT", tabla: "catalogo_categoria_ocupacional_sunat", columnas: "codigo, nombre" },
  { hoja: "TipoTrabajador", tabla: "catalogo_tipo_trabajador", columnas: "codigo, nombre" },
  { hoja: "RegimenLaboral", tabla: "catalogo_regimen_laboral", columnas: "codigo, nombre" },
  { hoja: "TipoContrato", tabla: "catalogo_tipo_contrato", columnas: "codigo, nombre" },
  { hoja: "TipoPago", tabla: "catalogo_tipo_pago", columnas: "codigo, nombre" },
  { hoja: "Periodicidad", tabla: "catalogo_periodicidad", columnas: "codigo, nombre" },
  { hoja: "SituacionEspecial", tabla: "catalogo_situacion_especial", columnas: "codigo, nombre" },
  { hoja: "RegimenSalud", tabla: "catalogo_regimen_salud", columnas: "codigo, nombre" },
  { hoja: "EPS", tabla: "catalogo_eps", columnas: "codigo, nombre" },
  { hoja: "MotivoBaja", tabla: "catalogo_motivo_baja", columnas: "codigo, nombre" },
  { hoja: "UbigeoDepartamento", tabla: "catalogo_ubigeo_departamento", columnas: "codigo, nombre" },
  { hoja: "UbigeoProvincia", tabla: "catalogo_ubigeo_provincia", columnas: "codigo, nombre, departamento_codigo" },
  { hoja: "UbigeoDistrito", tabla: "catalogo_ubigeo_distrito", columnas: "codigo, nombre, provincia_codigo" },
];

// GET /api/empleados/importar-masivo/plantilla.xlsx -> descarga un Excel
// listo para llenar y volver a subir: la hoja "Trabajadores" trae todas las
// columnas (las historicas y las T-Registro/SUNAT nuevas) como encabezado,
// y una hoja de referencia por cada catalogo SUNAT con su codigo y nombre,
// para no tener que adivinar el codigo ni volver a la pantalla de alta.
importacionRouter.get(
  "/importar-masivo/plantilla.xlsx",
  requierePermiso("importacion.masiva"),
  asyncHandler(async (_req: Request, res: Response) => {
    const workbook = new ExcelJS.Workbook();

    const hojaPrincipal = workbook.addWorksheet("Trabajadores");
    hojaPrincipal.columns = COLUMNAS.map((nombre) => ({ header: nombre, key: nombre, width: 20 }));
    hojaPrincipal.getRow(1).font = { bold: true };
    hojaPrincipal.getColumn("DNI").numFmt = "@"; // texto, para no perder ceros a la izquierda

    for (const { hoja, tabla, columnas } of CATALOGOS_REFERENCIA) {
      const resultado = await pool.query(`SELECT ${columnas} FROM ${tabla} ORDER BY nombre`);
      const hojaCat = workbook.addWorksheet(hoja);
      const encabezados = columnas.split(",").map((c) => c.trim().toUpperCase());
      hojaCat.columns = encabezados.map((nombre) => ({ header: nombre, key: nombre.toLowerCase(), width: 22 }));
      hojaCat.getRow(1).font = { bold: true };
      for (const fila of resultado.rows) {
        hojaCat.addRow(fila);
      }
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="plantilla_importar_trabajadores.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  })
);

// POST /api/empleados/importar-masivo  (multipart, campo "archivo" = CSV con encabezado)
importacionRouter.post("/importar-masivo", requierePermiso("importacion.masiva"), upload.single("archivo"), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "Falta el archivo CSV (campo 'archivo')" });
  }

  let filas: FilaCSV[];
  try {
    filas = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    return res.status(400).json({ error: `No se pudo leer el CSV: ${(err as Error).message}` });
  }

  if (filas.length === 0) {
    return res.status(400).json({ error: "El archivo no tiene filas de datos" });
  }

  const errores: ErrorFila[] = [];
  let empleadosCreados = 0;
  let empleadosActualizados = 0;
  let contratosCreados = 0;

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const numeroFila = i + 2; // +2: fila 1 es encabezado, base 1
      const dni = (fila.DNI ?? "").trim();

      await cliente.query(`SAVEPOINT fila_${i}`);
      try {
        if (!/^\d{8,15}$/.test(dni)) {
          throw new Error("DNI vacio o invalido (debe tener 8 a 15 digitos)");
        }
        const apellidosNombres = (fila.APELLIDOS_NOMBRES ?? "").trim();
        if (apellidosNombres.length < 3) {
          throw new Error("APELLIDOS_NOMBRES vacio o muy corto");
        }
        const categoria = (fila.CATEGORIA ?? "").trim().toUpperCase() as CategoriaOcupacional;
        if (!CATEGORIAS_VALIDAS.includes(categoria)) {
          throw new Error(
            `CATEGORIA '${fila.CATEGORIA}' no reconocida. Valores permitidos: ${CATEGORIAS_VALIDAS.join(", ")}`
          );
        }
        const sistemaPension = (fila.SISTEMA_PENSION ?? "").trim().toUpperCase() as SistemaPension;
        if (!SISTEMAS_PENSION_VALIDOS.includes(sistemaPension)) {
          throw new Error(`SISTEMA_PENSION '${fila.SISTEMA_PENSION}' invalido (debe ser AFP u ONP)`);
        }
        if (sistemaPension === "AFP" && !(fila.AFP_NOMBRE ?? "").trim()) {
          throw new Error("AFP_NOMBRE es obligatorio cuando SISTEMA_PENSION = AFP");
        }
        const fechaIngreso = normalizarFecha(fila.FECHA_INGRESO ?? "");
        if (!fechaIngreso) {
          throw new Error(`FECHA_INGRESO invalida: '${fila.FECHA_INGRESO}' (usa YYYY-MM-DD o DD/MM/YYYY)`);
        }
        if (categoria === "EMPLEADO" && num(fila.SUELDO_BASE ?? "") === null) {
          throw new Error("SUELDO_BASE es obligatorio para la categoria EMPLEADO");
        }

        // Campos T-Registro (SUNAT) del empleado - todos opcionales. sexo y
        // estado_civil se validan con el mismo criterio que el alta
        // individual para dar un mensaje de fila claro si vienen mal.
        const sexo = validarSexo(fila.SEXO);
        const estadoCivil = validarEstadoCivil(fila.ESTADO_CIVIL);
        const nacionalidadCodigo = opcional(fila.NACIONALIDAD_CODIGO) ?? "9589"; // PERU por defecto
        const paisEmisorCodigo = opcional(fila.PAIS_EMISOR_DOCUMENTO_CODIGO);
        const gradoInstruccionCodigo = opcional(fila.GRADO_INSTRUCCION_CODIGO);
        const entidadBancariaCodigo = opcional(fila.ENTIDAD_BANCARIA_CODIGO);
        const discapacidad = esBooleano(fila.DISCAPACIDAD ?? "");
        const segundaDireccion = opcional(fila.SEGUNDA_DIRECCION);
        const direccionEssalud = opcional(fila.DIRECCION_ESSALUD);
        const ubigeoDepartamentoCodigo = opcional(fila.UBIGEO_DEPARTAMENTO_CODIGO);
        const ubigeoProvinciaCodigo = opcional(fila.UBIGEO_PROVINCIA_CODIGO);
        const ubigeoDistritoCodigo = opcional(fila.UBIGEO_DISTRITO_CODIGO);

        // El texto libre historico (grado_instruccion/entidad_bancaria/ubigeo)
        // se completa desde el catalogo solo si el CSV no trae ya el texto
        // en su columna de siempre.
        const gradoInstruccionTexto =
          opcional(fila.GRADO_INSTRUCCION) ?? (await resolverNombreCatalogo("catalogo_grado_instruccion", gradoInstruccionCodigo));
        const entidadBancariaTexto =
          opcional(fila.ENTIDAD_BANCARIA) ?? (await resolverNombreCatalogo("catalogo_banco", entidadBancariaCodigo));
        const ubigeoTexto =
          opcional(fila.UBIGEO) ?? (await componerUbigeoTexto(ubigeoDepartamentoCodigo, ubigeoProvinciaCodigo, ubigeoDistritoCodigo));

        // Upsert empleado por DNI
        const empleadoExistente = await cliente.query("SELECT id FROM empleados WHERE numero_documento = $1", [dni]);
        let empleadoId: number;

        if (empleadoExistente.rowCount === 0) {
          const r = await cliente.query(
            `INSERT INTO empleados
              (numero_documento, apellidos_nombres, fecha_nacimiento, grado_instruccion,
               numero_hijos, celular, correo, direccion, ubigeo, entidad_bancaria, cuenta_bancaria,
               sexo, estado_civil, nacionalidad_codigo, pais_emisor_documento_codigo,
               grado_instruccion_codigo, entidad_bancaria_codigo, discapacidad,
               segunda_direccion, direccion_essalud,
               ubigeo_departamento_codigo, ubigeo_provincia_codigo, ubigeo_distrito_codigo)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
             RETURNING id`,
            [
              dni,
              apellidosNombres,
              normalizarFecha(fila.FECHA_NACIMIENTO ?? ""),
              gradoInstruccionTexto,
              num(fila.NUMERO_HIJOS ?? "") ?? 0,
              (fila.CELULAR ?? "").trim() || null,
              (fila.CORREO ?? "").trim() || null,
              (fila.DIRECCION ?? "").trim() || null,
              ubigeoTexto,
              entidadBancariaTexto,
              (fila.CUENTA_BANCARIA ?? "").trim() || null,
              sexo,
              estadoCivil,
              nacionalidadCodigo,
              paisEmisorCodigo,
              gradoInstruccionCodigo,
              entidadBancariaCodigo,
              discapacidad,
              segundaDireccion,
              direccionEssalud,
              ubigeoDepartamentoCodigo,
              ubigeoProvinciaCodigo,
              ubigeoDistritoCodigo,
            ]
          );
          empleadoId = r.rows[0].id;
          empleadosCreados++;
        } else {
          empleadoId = empleadoExistente.rows[0].id;
          await cliente.query(
            `UPDATE empleados SET
               apellidos_nombres = $1, fecha_nacimiento = $2, grado_instruccion = $3,
               numero_hijos = $4, celular = $5, correo = $6, direccion = $7, ubigeo = $8,
               entidad_bancaria = $9, cuenta_bancaria = $10,
               sexo = $11, estado_civil = $12, nacionalidad_codigo = $13,
               pais_emisor_documento_codigo = $14, grado_instruccion_codigo = $15,
               entidad_bancaria_codigo = $16, discapacidad = $17,
               segunda_direccion = $18, direccion_essalud = $19,
               ubigeo_departamento_codigo = $20, ubigeo_provincia_codigo = $21,
               ubigeo_distrito_codigo = $22, actualizado_en = now()
             WHERE id = $23`,
            [
              apellidosNombres,
              normalizarFecha(fila.FECHA_NACIMIENTO ?? ""),
              gradoInstruccionTexto,
              num(fila.NUMERO_HIJOS ?? "") ?? 0,
              (fila.CELULAR ?? "").trim() || null,
              (fila.CORREO ?? "").trim() || null,
              (fila.DIRECCION ?? "").trim() || null,
              ubigeoTexto,
              entidadBancariaTexto,
              (fila.CUENTA_BANCARIA ?? "").trim() || null,
              sexo,
              estadoCivil,
              nacionalidadCodigo,
              paisEmisorCodigo,
              gradoInstruccionCodigo,
              entidadBancariaCodigo,
              discapacidad,
              segundaDireccion,
              direccionEssalud,
              ubigeoDepartamentoCodigo,
              ubigeoProvinciaCodigo,
              ubigeoDistritoCodigo,
              empleadoId,
            ]
          );
          empleadosActualizados++;
        }

        // Campos T-Registro (SUNAT) del contrato - opcionales. Los que
        // tambien tienen un valor por defecto en el alta individual
        // conservan el mismo default aqui (construccion civil).
        const categoriaOcupacionalSunatCodigo = opcional(fila.CATEGORIA_OCUPACIONAL_SUNAT_CODIGO);
        const tipoTrabajadorCodigo = opcional(fila.TIPO_TRABAJADOR_CODIGO) ?? "27"; // CONSTRUCCION CIVIL
        const regimenLaboralCodigo = opcional(fila.REGIMEN_LABORAL_CODIGO) ?? "21"; // CONSTRUCCION CIVIL
        const tipoContratoCodigo = opcional(fila.TIPO_CONTRATO_CODIGO);
        const tipoPagoCodigo = opcional(fila.TIPO_PAGO_CODIGO);
        const periodicidadCodigo = opcional(fila.PERIODICIDAD_CODIGO);
        const situacionEspecialCodigo = opcional(fila.SITUACION_ESPECIAL_CODIGO) ?? "0"; // NINGUNA
        const jornadaLaboral = opcional(fila.JORNADA_LABORAL);
        const regimenSaludCodigo = opcional(fila.REGIMEN_SALUD_CODIGO) ?? "00"; // ESSALUD REGULAR
        const epsCodigo = opcional(fila.EPS_CODIGO);
        const estadoContrato = (fila.ESTADO ?? "").trim().toUpperCase() === "CESADO" ? "CESADO" : "HABIL";
        const motivoBajaCodigo = estadoContrato === "CESADO" ? opcional(fila.MOTIVO_BAJA_CODIGO) : null;

        // Evitar duplicar el mismo contrato si ya existe uno identico (mismo empleado+proyecto+fecha_ingreso)
        const contratoExistente = await cliente.query(
          `SELECT id FROM contratos WHERE empleado_id = $1 AND proyecto = $2 AND fecha_ingreso = $3`,
          [empleadoId, (fila.PROYECTO ?? "").trim(), fechaIngreso]
        );
        if (contratoExistente.rowCount === 0) {
          await cliente.query(
            `INSERT INTO contratos
              (empleado_id, proyecto, grupo, categoria_ocupacional, ocupacion, sistema_pension,
               afp_nombre, cuspp, sistema_comision, fecha_ingreso, fecha_cese, sueldo_base, viaticos,
               sindicalizado, poliza_seguro, sctr_salud, essalud_vida, estado,
               categoria_ocupacional_sunat_codigo, tipo_trabajador_codigo, regimen_laboral_codigo,
               tipo_contrato_codigo, tipo_pago_codigo, periodicidad_codigo, situacion_especial_codigo,
               jornada_laboral, regimen_salud_codigo, eps_codigo, motivo_baja_codigo)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
            [
              empleadoId,
              (fila.PROYECTO ?? "").trim(),
              (fila.GRUPO ?? "").trim() || null,
              categoria,
              (fila.OCUPACION ?? "").trim() || null,
              sistemaPension,
              sistemaPension === "AFP" ? (fila.AFP_NOMBRE ?? "").trim().toUpperCase() : null,
              (fila.CUSPP ?? "").trim() || null,
              (fila.SISTEMA_COMISION ?? "").trim().toUpperCase() || null,
              fechaIngreso,
              normalizarFecha(fila.FECHA_CESE ?? ""),
              categoria === "EMPLEADO" ? num(fila.SUELDO_BASE ?? "") : null,
              num(fila.VIATICOS ?? "") ?? 0,
              esBooleano(fila.SINDICALIZADO ?? ""),
              esBooleano(fila.POLIZA_SEGURO ?? ""),
              esBooleano(fila.SCTR_SALUD ?? ""),
              esBooleano(fila.ESSALUD_VIDA ?? ""),
              estadoContrato,
              categoriaOcupacionalSunatCodigo,
              tipoTrabajadorCodigo,
              regimenLaboralCodigo,
              tipoContratoCodigo,
              tipoPagoCodigo,
              periodicidadCodigo,
              situacionEspecialCodigo,
              jornadaLaboral,
              regimenSaludCodigo,
              epsCodigo,
              motivoBajaCodigo,
            ]
          );
          contratosCreados++;
        }
      } catch (err) {
        await cliente.query(`ROLLBACK TO SAVEPOINT fila_${i}`);
        errores.push({ fila: numeroFila, dni: dni || "(vacio)", motivo: mensajeErrorFila(err) });
      }
    }

    await cliente.query("COMMIT");
    res.json({
      total_filas: filas.length,
      empleados_creados: empleadosCreados,
      empleados_actualizados: empleadosActualizados,
      contratos_creados: contratosCreados,
      errores,
    });
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
}));

// Referencia de columnas esperadas, para que el frontend pueda mostrar ayuda
importacionRouter.get("/importar-masivo/plantilla", (_req: Request, res: Response) => {
  res.json({ columnas: COLUMNAS });
});
