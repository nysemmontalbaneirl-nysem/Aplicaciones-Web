import { Router, Request, Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { pool } from "../db";
import { CategoriaOcupacional, SistemaPension } from "../tipos";

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

// Columnas esperadas en el CSV (encabezado en la primera fila, en este orden o con estos nombres)
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

// POST /api/empleados/importar-masivo  (multipart, campo "archivo" = CSV con encabezado)
importacionRouter.post("/importar-masivo", upload.single("archivo"), async (req: Request, res: Response) => {
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

        // Upsert empleado por DNI
        const empleadoExistente = await cliente.query("SELECT id FROM empleados WHERE numero_documento = $1", [dni]);
        let empleadoId: number;

        if (empleadoExistente.rowCount === 0) {
          const r = await cliente.query(
            `INSERT INTO empleados
              (numero_documento, apellidos_nombres, fecha_nacimiento, grado_instruccion,
               numero_hijos, celular, correo, direccion, ubigeo, entidad_bancaria, cuenta_bancaria)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id`,
            [
              dni,
              apellidosNombres,
              normalizarFecha(fila.FECHA_NACIMIENTO ?? ""),
              (fila.GRADO_INSTRUCCION ?? "").trim() || null,
              num(fila.NUMERO_HIJOS ?? "") ?? 0,
              (fila.CELULAR ?? "").trim() || null,
              (fila.CORREO ?? "").trim() || null,
              (fila.DIRECCION ?? "").trim() || null,
              (fila.UBIGEO ?? "").trim() || null,
              (fila.ENTIDAD_BANCARIA ?? "").trim() || null,
              (fila.CUENTA_BANCARIA ?? "").trim() || null,
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
               entidad_bancaria = $9, cuenta_bancaria = $10, actualizado_en = now()
             WHERE id = $11`,
            [
              apellidosNombres,
              normalizarFecha(fila.FECHA_NACIMIENTO ?? ""),
              (fila.GRADO_INSTRUCCION ?? "").trim() || null,
              num(fila.NUMERO_HIJOS ?? "") ?? 0,
              (fila.CELULAR ?? "").trim() || null,
              (fila.CORREO ?? "").trim() || null,
              (fila.DIRECCION ?? "").trim() || null,
              (fila.UBIGEO ?? "").trim() || null,
              (fila.ENTIDAD_BANCARIA ?? "").trim() || null,
              (fila.CUENTA_BANCARIA ?? "").trim() || null,
              empleadoId,
            ]
          );
          empleadosActualizados++;
        }

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
               sindicalizado, poliza_seguro, sctr_salud, essalud_vida, estado)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
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
              (fila.ESTADO ?? "").trim().toUpperCase() === "CESADO" ? "CESADO" : "HABIL",
            ]
          );
          contratosCreados++;
        }
      } catch (err) {
        await cliente.query(`ROLLBACK TO SAVEPOINT fila_${i}`);
        errores.push({ fila: numeroFila, dni: dni || "(vacio)", motivo: (err as Error).message });
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
});

// Referencia de columnas esperadas, para que el frontend pueda mostrar ayuda
importacionRouter.get("/importar-masivo/plantilla", (_req: Request, res: Response) => {
  res.json({ columnas: COLUMNAS });
});
