// =========================================================================
// Archivo OFICIAL que se sube al portal de AFPnet (Excel, estructura FIJA).
//
// Migracion 041 (18/09/2026): a diferencia del CSV simplificado que ya
// existia (ver afpnet.ts, pensado como workaround porque en su momento no
// se tenia la estructura oficial documentada), esta si es la estructura
// real que exige AFPnet - confirmada por el usuario con un archivo real que
// el mismo declaro ("DECLARACION AFPNET JULIO2026 - P009.xlsx"), que trae
// una hoja "MODELO DE ESTRUCTURA AFP" con las 17 columnas oficiales
// documentadas campo por campo.
//
// Formato exacto: 17 columnas (A-Q), SIN fila de encabezado - el propio
// modelo indica "antes de usar elimine las filas 1, 2 y 3" (titulo,
// encabezado y notas), y el archivo real de julio 2026 que el usuario ya
// declaro confirma esto: su primera fila YA es el primer trabajador.
//
// Decisiones de negocio confirmadas explicitamente con el usuario:
// - Remuneracion asegurable: misma formula que ya usa el CSV de AFPnet
//   (ver calcularRemuneracionAfectaAfp en afpnet.ts) - sueldo basico +
//   dominical + dominical proporcional + feriado + sobretasa dominical +
//   sobretasa feriado + bonificacion BUC + asignacion familiar.
// - Excepcion de Aportar (columna K): siempre en blanco por ahora - asi lo
//   viene declarando el usuario en la practica (confirmado revisando su
//   archivo real de julio, en blanco incluso para quien tuvo descanso
//   medico ese mes).
// - Aportes voluntarios (columnas M, N, O): el sistema no los registra,
//   siempre van en 0.
// - Tipo de trabajo (columna P): "C" (construccion) o "N" (normal) segun
//   esConstruccionCivil(categoria_ocupacional) - no hay trabajadores
//   Mineria/Pesquero en este sistema.
// - AFP (columna Q): siempre en blanco ("Conviene dejar en blanco", segun
//   el propio instructivo del modelo - el sistema de AFPnet la resuelve
//   solo a partir del CUSPP).
// - Apellido paterno/materno/nombres (columnas E, F, G): nuevos campos
//   opcionales del trabajador (migracion 041). Si a algun trabajador le
//   falta alguno, la fila se genera igual (son "dato referencial" segun el
//   propio modelo, no obligatorio) pero se agrega una advertencia para que
//   se complete desde Trabajadores.
// - Tipo de documento (columna C): catalogo PROPIO de AFPnet, distinto al
//   T-Registro que ya usa el sistema (empleados.tipo_documento) - mapeo
//   MAPEO_TIPO_DOCUMENTO_AFPNET abajo. Confirmado con el usuario que hay
//   trabajadores con DNI (mayoria) y Carne de Extranjeria (algunos
//   proyectos con personal extranjero). Un trabajador con un tipo de
//   documento sin mapeo conocido se EXCLUYE del archivo (no se arriesga a
//   declarar un codigo incorrecto) y se reporta como advertencia.
// =========================================================================

import ExcelJS from "exceljs";
import { pool } from "./db";
import { calcularRemuneracionAfectaAfp, FilaAFPnet } from "./afpnet";
import { esConstruccionCivil } from "./motorCalculo";
import { AlcanceDeclaracionMensual, obtenerDetalleEmpleadosDelMes, rangoDelMes, resolverCabecerasObreros } from "./planillaMensual";
import { fechaISO } from "./routes/planilla";
import { CategoriaOcupacional } from "./tipos";

// Tabla 3 T-Registro (lo que ya guarda empleados.tipo_documento) -> catalogo
// propio de AFPnet (0=DNI, 1=Carne Extranjeria, 2=Carne Militar/Policial,
// 3=Libreta Adolescente Trabajador, 4=Pasaporte, 5=Inexistente/Afilia).
// Solo se completan los codigos que el sistema ya usa en Trabajadores (ver
// catalogo_tipo_documento en schema.sql); el resto no tiene equivalente
// confirmado todavia. Las claves son SIEMPRE el codigo de 2 digitos - ver
// normalizarTipoDocumento() abajo para el porque.
const MAPEO_TIPO_DOCUMENTO_AFPNET: Record<string, string> = {
  "01": "0", // Documento Nacional de Identidad
  "04": "1", // Carne de Extranjeria
  "07": "4", // Pasaporte
};

// BUG real detectado en produccion (19/09/2026): 45 de ~200 trabajadores
// quedaban excluidos del archivo por "tipo de documento '1' sin mapeo",
// aunque son DNI comunes y corrientes. Causa: empleados.tipo_documento tiene
// un DEFAULT historico de UN SOLO DIGITO ('1' = DNI, ver sql/schema.sql,
// anterior al catalogo T-Registro de 2 digitos agregado en la migracion 016)
// que TODO trabajador dado de alta por importacion masiva hereda sin darse
// cuenta - routes/importacion.ts nunca toca esta columna, asi que siempre
// queda en ese DEFAULT '1'. Los trabajadores dados de alta/editados a mano
// en Trabajadores.tsx si usan el codigo correcto de 2 digitos ('01', '04',
// etc., del desplegable). Es el MISMO codigo de la Tabla 3 T-Registro en
// ambos casos, solo que al de un digito le falta el cero a la izquierda -
// se normaliza aca antes de buscarlo en el mapeo, en vez de tener que listar
// cada variante de un digito a mano.
function normalizarTipoDocumento(valor: string): string {
  return valor.length === 1 ? `0${valor}` : valor;
}

interface FilaAFPnetExcel extends FilaAFPnet {
  tipo_documento: string;
  apellido_paterno: string | null;
  apellido_materno: string | null;
  nombres: string | null;
  categoria_ocupacional: CategoriaOcupacional;
  fecha_ingreso: string;
  fecha_cese: string | null;
}

const COLUMNAS_FILA_AFPNET_EXCEL = `e.numero_documento, e.apellidos_nombres, e.tipo_documento,
            e.apellido_paterno, e.apellido_materno, e.nombres,
            c.cuspp, c.afp_nombre, c.proyecto, c.categoria_ocupacional, c.fecha_ingreso, c.fecha_cese,
            d.sueldo_basico, d.remuneracion_dominical, d.remuneracion_dominical_proporcional, d.remuneracion_feriado,
            d.sobretasa_dominical, d.sobretasa_feriado,
            d.bonificacion_buc, d.asignacion_familiar, d.detalle_json`;

/**
 * "S" si la fecha (o null) cae dentro de [desde, hasta] (ambos "YYYY-MM-DD"
 * inclusive), sino "N". Recibe la fecha "cruda" tal cual la devuelve `pg`
 * (un objeto Date, no un string, para una columna DATE - mismo caso ya
 * resuelto en todo routes/planilla.ts con fechaISO()) y la normaliza con
 * fechaISO() antes de comparar, en vez de asumir que ya es un string
 * (`.slice(...)` sobre un Date real hubiera reventado en produccion).
 */
function sN(fecha: unknown, desde: string, hasta: string): "S" | "N" {
  if (!fecha) return "N";
  const f = fechaISO(fecha);
  return f >= desde && f <= hasta ? "S" : "N";
}

/**
 * Arma las filas (arreglo de arreglos, sin encabezado) del archivo Excel
 * oficial de AFPnet para una Planilla Mensual Consolidada ya calculada
 * (Ronda E), y la lista de advertencias no bloqueantes (datos referenciales
 * incompletos, o trabajadores excluidos por tipo de documento sin mapeo).
 *
 * IMPORTANTE (bug real de produccion, corregido 21/09/2026): esta funcion ya
 * NO filtra por "c.proyecto" (el proyecto ACTUAL del contrato). Antes lo
 * hacia, comparando contra el proyecto de la Planilla Mensual - un filtro
 * redundante y peligroso, porque `planilla_mensual_id` YA identifica de
 * forma unica (indice unico proyecto+anio+mes) el proyecto/mes exacto: todo
 * registro en detalle_planilla_mensual con ese id fue puesto ahi por
 * consolidarPlanillaMensual() precisamente para ese proyecto, sin importar
 * cual sea el valor ACTUAL de contratos.proyecto (texto libre, sin relacion
 * de llave foranea con periodos_planilla.proyecto/planilla_mensual.proyecto -
 * ver Ronda C). Si el proyecto de un contrato cambiaba o se corregia despues
 * de haberse usado para consolidar un mes (o si el texto no coincidia por un
 * caracter especial/espacio, ej. el "N°" de un nombre de proyecto largo),
 * ese filtro excluia SILENCIOSAMENTE al trabajador de este archivo - sin
 * ningun aviso, porque el WHERE lo descartaba antes de que el loop de abajo
 * pudiera generar una advertencia. Esto reproducia exactamente el sintoma
 * reportado por el usuario: "el reporte consolidado si tiene datos, pero el
 * Excel de AFPnet genera vacio" - el reporte general (obtenerPlanillaMensual,
 * en planillaMensual.ts) nunca tuvo este filtro y por eso nunca fallaba.
 */
export async function generarFilasAFPnetExcel(
  alcance: AlcanceDeclaracionMensual
): Promise<{ filas: (string | number)[][]; advertencias: string[] }> {
  const { desde, hasta } = rangoDelMes(alcance.anio, alcance.mes);

  const cabeceras = await resolverCabecerasObreros(alcance);
  const cabeceraIds = cabeceras.map((c) => c.id);

  const obrerosResultado = await pool.query<FilaAFPnetExcel>(
    `SELECT ${COLUMNAS_FILA_AFPNET_EXCEL}
     FROM detalle_planilla_mensual d
     JOIN contratos c ON c.id = d.contrato_id
     JOIN empleados e ON e.id = c.empleado_id
     WHERE d.planilla_mensual_id = ANY($1::int[]) AND c.sistema_pension = 'AFP'
     ORDER BY e.apellidos_nombres`,
    [cabeceraIds]
  );

  const empleadosTodos = (await obtenerDetalleEmpleadosDelMes(alcance)) as unknown as (FilaAFPnetExcel & {
    sistema_pension: string;
  })[];
  const empleadosAfp = empleadosTodos.filter((f) => f.sistema_pension === "AFP");

  const filas: (string | number)[][] = [];
  const advertencias: string[] = [];
  let secuencia = 0;

  const todasLasFilas = [...obrerosResultado.rows, ...empleadosAfp].sort((a, b) =>
    a.apellidos_nombres.localeCompare(b.apellidos_nombres)
  );

  for (const f of todasLasFilas) {
    const identificacion = `${f.apellidos_nombres} (${f.numero_documento})`;
    const tipoDocumentoAfpnet = MAPEO_TIPO_DOCUMENTO_AFPNET[normalizarTipoDocumento(f.tipo_documento)];
    if (tipoDocumentoAfpnet === undefined) {
      advertencias.push(
        `${identificacion}: tipo de documento '${f.tipo_documento}' no tiene un mapeo confirmado a AFPnet - ` +
          `no se incluyo en el archivo. Complete/revise manualmente esta declaracion.`
      );
      continue;
    }
    if (!f.apellido_paterno || !f.apellido_materno || !f.nombres) {
      advertencias.push(
        `${identificacion}: falta completar apellido paterno, materno y/o nombres (Trabajadores > editar) ` +
          `- la fila se genero igual, con esos campos en blanco (son datos referenciales, no obligatorios).`
      );
    }

    secuencia += 1;
    filas.push([
      secuencia,
      f.cuspp ?? "",
      tipoDocumentoAfpnet,
      f.numero_documento,
      f.apellido_paterno ?? "",
      f.apellido_materno ?? "",
      f.nombres ?? "",
      "S", // Relacion Laboral: siempre S (solo se incluyen trabajadores ya consolidados en este mes)
      sN(f.fecha_ingreso, desde, hasta), // Inicio de RL
      sN(f.fecha_cese, desde, hasta), // Cese de RL
      "", // Excepcion de Aportar: siempre en blanco (confirmado con el usuario)
      calcularRemuneracionAfectaAfp(f).toFixed(2),
      0, // Aporte voluntario del afiliado con fin previsional
      0, // Aporte voluntario del afiliado sin fin previsional
      0, // Aporte voluntario del empleador
      esConstruccionCivil(f.categoria_ocupacional) ? "C" : "N",
      "", // AFP: siempre en blanco (referencial - AFPnet la resuelve por CUSPP)
    ]);
  }

  return { filas, advertencias };
}

export interface DiagnosticoAfpnetMensual {
  trabajadores_consolidados: number;
  por_sistema_pension: { sistema_pension: string; total: number }[];
}

/**
 * Antes de esta funcion, un Excel de AFPnet vacio (0 filas) no dejaba
 * distinguir por su cuenta si era un error del sistema o si, sencillamente,
 * ese mes/proyecto no tenia ningun trabajador afiliado a una AFP (ej. todos
 * son ONP) - lo cual es un resultado CORRECTO, no un bug. Esta funcion cuenta,
 * para una declaracion mensual (un proyecto, o toda la empresa), cuantos
 * trabajadores hay en total - obreros ya consolidados MAS empleados de ese
 * mismo mes (unificacion Reportes/Planilla Mensual, 22/09/2026) - y como se
 * reparten por Sistema de Pension. Se muestra en pantalla (ver GET
 * /api/planilla-mensual/, avisos_datos_afpnet) sin que el usuario tenga que
 * descargar nada, y tambien se agrega al mensaje de error si de todas formas
 * intenta la descarga y sale vacia.
 */
export async function obtenerDiagnosticoAfpnetMensual(alcance: AlcanceDeclaracionMensual): Promise<DiagnosticoAfpnetMensual> {
  const cabeceras = await resolverCabecerasObreros(alcance);
  const cabeceraIds = cabeceras.map((c) => c.id);

  const obrerosR = await pool.query<{ sistema_pension: string | null; total: string }>(
    `SELECT COALESCE(c.sistema_pension, 'SIN CONFIGURAR') AS sistema_pension, COUNT(*)::int AS total
     FROM detalle_planilla_mensual d
     JOIN contratos c ON c.id = d.contrato_id
     WHERE d.planilla_mensual_id = ANY($1::int[])
     GROUP BY COALESCE(c.sistema_pension, 'SIN CONFIGURAR')`,
    [cabeceraIds]
  );

  const empleados = (await obtenerDetalleEmpleadosDelMes(alcance)) as unknown as { sistema_pension: string | null }[];
  const porSistemaPensionMapa = new Map<string, number>();
  for (const fila of obrerosR.rows) {
    porSistemaPensionMapa.set(fila.sistema_pension!, (porSistemaPensionMapa.get(fila.sistema_pension!) ?? 0) + Number(fila.total));
  }
  for (const fila of empleados) {
    const clave = fila.sistema_pension ?? "SIN CONFIGURAR";
    porSistemaPensionMapa.set(clave, (porSistemaPensionMapa.get(clave) ?? 0) + 1);
  }

  const porSistemaPension = [...porSistemaPensionMapa.entries()]
    .map(([sistema_pension, total]) => ({ sistema_pension, total }))
    .sort((a, b) => a.sistema_pension.localeCompare(b.sistema_pension));
  const trabajadoresConsolidados = porSistemaPension.reduce((acumulado, f) => acumulado + f.total, 0);
  return { trabajadores_consolidados: trabajadoresConsolidados, por_sistema_pension: porSistemaPension };
}

/** Arma el workbook (.xlsx) listo para descargar, con las filas ya calculadas. */
export function construirWorkbookAFPnetExcel(filas: (string | number)[][]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("AFPnet");
  // Numero de documento como texto (columna D, indice 4) para no perder
  // ceros a la izquierda - mismo criterio que el resto de exportaciones.
  hoja.getColumn(4).numFmt = "@";
  hoja.getColumn(2).numFmt = "@"; // CUSPP, tambien alfanumerico
  for (const fila of filas) {
    hoja.addRow(fila);
  }
  return workbook;
}
