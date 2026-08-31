import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { ConceptoPlanilla, ConceptosPlanilla } from "../tipos";
import { ErrorValidacion } from "../validaciones";
import { registrarBitacora } from "../bitacora";

export const conceptosRouter = Router();

function filaAConcepto(fila: Record<string, unknown>): ConceptoPlanilla {
  const numeroONull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    id: fila.id as number,
    codigo: fila.codigo as string,
    nombre: fila.nombre as string,
    descripcion: (fila.descripcion as string | null) ?? null,
    orden: fila.orden as number,
    factor1: numeroONull(fila.factor1),
    factor1_etiqueta: (fila.factor1_etiqueta as string | null) ?? null,
    factor2: numeroONull(fila.factor2),
    factor2_etiqueta: (fila.factor2_etiqueta as string | null) ?? null,
    factor3: numeroONull(fila.factor3),
    factor3_etiqueta: (fila.factor3_etiqueta as string | null) ?? null,
    afecto_essalud: fila.afecto_essalud as boolean,
    afecto_sctr: fila.afecto_sctr as boolean,
    afecto_senati: fila.afecto_senati as boolean,
    afecto_onp: fila.afecto_onp as boolean,
    afecto_afp: fila.afecto_afp as boolean,
    afecto_renta5ta: fila.afecto_renta5ta as boolean | null,
    afecto_conafovicer: fila.afecto_conafovicer as boolean,
  };
}

/**
 * Trae el catalogo completo de conceptos de planilla, indexado por codigo,
 * listo para pasarle a calcularLineaPlanilla/calcularBoletaVacaciones.
 * Usado por routes/planilla.ts y routes/vacaciones.ts.
 */
export async function obtenerConceptos(): Promise<ConceptosPlanilla> {
  const r = await pool.query("SELECT * FROM conceptos_planilla ORDER BY orden");
  const conceptos: ConceptosPlanilla = {};
  for (const fila of r.rows) {
    conceptos[fila.codigo] = filaAConcepto(fila);
  }
  return conceptos;
}

// GET /api/conceptos -> catalogo completo, ordenado para mostrar en la tabla.
conceptosRouter.get(
  "/",
  requierePermiso("conceptos.editar"),
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query("SELECT * FROM conceptos_planilla ORDER BY orden");
    res.json(r.rows.map(filaAConcepto));
  })
);

// GET /api/conceptos/horas-extra -> solo los 3 multiplicadores de los dos
// conceptos de horas extra (construccion civil / regimen general), sin el
// permiso "conceptos.editar" (que un TAREADOR no tiene). Es de solo lectura
// y no expone nada mas del catalogo - se usa para etiquetar dinamicamente
// las columnas de horas extra en la pantalla de Tareo Diario segun la
// categoria de cada trabajador (ver motorCalculo.ts: esConstruccionCivil).
conceptosRouter.get(
  "/horas-extra",
  asyncHandler(async (_req: Request, res: Response) => {
    const conceptos = await obtenerConceptos();
    function factores(codigo: string) {
      const c = conceptos[codigo];
      return { factor1: c?.factor1 ?? null, factor2: c?.factor2 ?? null, factor3: c?.factor3 ?? null };
    }
    res.json({
      construccion: factores("HORAS_EXTRA_CONSTRUCCION"),
      general: factores("HORAS_EXTRA_GENERAL"),
    });
  })
);

const CAMPOS_AFECTO = [
  "afecto_essalud",
  "afecto_sctr",
  "afecto_senati",
  "afecto_onp",
  "afecto_afp",
  "afecto_conafovicer",
] as const;

// PUT /api/conceptos/:codigo -> actualiza los factores y/o la afectacion de
// un concepto. Body: { factor1?, factor2?, factor3?, afecto_essalud?, ... }
// Cualquier campo omitido conserva su valor actual.
conceptosRouter.put(
  "/:codigo",
  requierePermiso("conceptos.editar"),
  asyncHandler(async (req: Request, res: Response) => {
    const existente = await pool.query("SELECT * FROM conceptos_planilla WHERE codigo = $1", [req.params.codigo]);
    if (existente.rowCount === 0) {
      return res.status(404).json({ error: "Concepto no encontrado" });
    }
    const actual = existente.rows[0];
    const b = req.body;

    for (const campoFactor of ["factor1", "factor2", "factor3"] as const) {
      if (b[campoFactor] !== undefined && b[campoFactor] !== null) {
        if (typeof b[campoFactor] !== "number" || !Number.isFinite(b[campoFactor])) {
          throw new ErrorValidacion(`${campoFactor} debe ser un numero`);
        }
      }
    }
    for (const campo of CAMPOS_AFECTO) {
      if (b[campo] !== undefined && typeof b[campo] !== "boolean") {
        throw new ErrorValidacion(`${campo} debe ser verdadero o falso`);
      }
    }
    if (b.afecto_renta5ta !== undefined && b.afecto_renta5ta !== null && typeof b.afecto_renta5ta !== "boolean") {
      throw new ErrorValidacion("afecto_renta5ta debe ser verdadero, falso, o nulo");
    }

    const r = await pool.query(
      `UPDATE conceptos_planilla SET
         factor1 = $1, factor2 = $2, factor3 = $3,
         afecto_essalud = $4, afecto_sctr = $5, afecto_senati = $6,
         afecto_onp = $7, afecto_afp = $8, afecto_renta5ta = $9, afecto_conafovicer = $10,
         actualizado_en = now()
       WHERE codigo = $11
       RETURNING *`,
      [
        b.factor1 !== undefined ? b.factor1 : actual.factor1,
        b.factor2 !== undefined ? b.factor2 : actual.factor2,
        b.factor3 !== undefined ? b.factor3 : actual.factor3,
        b.afecto_essalud !== undefined ? b.afecto_essalud : actual.afecto_essalud,
        b.afecto_sctr !== undefined ? b.afecto_sctr : actual.afecto_sctr,
        b.afecto_senati !== undefined ? b.afecto_senati : actual.afecto_senati,
        b.afecto_onp !== undefined ? b.afecto_onp : actual.afecto_onp,
        b.afecto_afp !== undefined ? b.afecto_afp : actual.afecto_afp,
        b.afecto_renta5ta !== undefined ? b.afecto_renta5ta : actual.afecto_renta5ta,
        b.afecto_conafovicer !== undefined ? b.afecto_conafovicer : actual.afecto_conafovicer,
        req.params.codigo,
      ]
    );
    await registrarBitacora(req.usuario!.id, "EDICION_CONCEPTO_PLANILLA", "conceptos_planilla", r.rows[0].id, {
      codigo: req.params.codigo,
      antes: {
        factor1: actual.factor1,
        factor2: actual.factor2,
        factor3: actual.factor3,
        afecto_essalud: actual.afecto_essalud,
        afecto_sctr: actual.afecto_sctr,
        afecto_senati: actual.afecto_senati,
        afecto_onp: actual.afecto_onp,
        afecto_afp: actual.afecto_afp,
        afecto_renta5ta: actual.afecto_renta5ta,
        afecto_conafovicer: actual.afecto_conafovicer,
      },
      despues: filaAConcepto(r.rows[0]),
    });
    res.json(filaAConcepto(r.rows[0]));
  })
);

// POST /api/conceptos/restaurar -> vuelve TODOS los conceptos a los valores
// originales del sistema (los mismos con los que ya venia funcionando la
// planilla antes de que existiera esta pestana). Red de seguridad por si
// una configuracion manual queda mal armada.
conceptosRouter.post(
  "/restaurar",
  requierePermiso("conceptos.editar"),
  asyncHandler(async (req: Request, res: Response) => {
    for (const valores of VALORES_ORIGINALES) {
      await pool.query(
        `UPDATE conceptos_planilla SET
           factor1 = $1, factor2 = $2, factor3 = $3,
           afecto_essalud = $4, afecto_sctr = $5, afecto_senati = $6,
           afecto_onp = $7, afecto_afp = $8, afecto_renta5ta = $9, afecto_conafovicer = $10,
           actualizado_en = now()
         WHERE codigo = $11`,
        [
          valores.factor1,
          valores.factor2,
          valores.factor3,
          valores.afecto_essalud,
          valores.afecto_sctr,
          valores.afecto_senati,
          valores.afecto_onp,
          valores.afecto_afp,
          valores.afecto_renta5ta,
          valores.afecto_conafovicer,
          valores.codigo,
        ]
      );
    }
    await registrarBitacora(req.usuario!.id, "RESTAURAR_CONCEPTOS_PLANILLA", "conceptos_planilla", null, {
      nota: "Se restauraron los 14 conceptos a sus valores originales",
    });
    const r = await pool.query("SELECT * FROM conceptos_planilla ORDER BY orden");
    res.json(r.rows.map(filaAConcepto));
  })
);

// Mismos valores que sql/migracion_014_conceptos_planilla.sql - la
// planilla se comportaba exactamente asi antes de que estos campos fueran
// editables, por eso son el punto de "restaurar valores originales".
const VALORES_ORIGINALES: Array<{
  codigo: string;
  factor1: number | null;
  factor2: number | null;
  factor3: number | null;
  afecto_essalud: boolean;
  afecto_sctr: boolean;
  afecto_senati: boolean;
  afecto_onp: boolean;
  afecto_afp: boolean;
  afecto_renta5ta: boolean | null;
  afecto_conafovicer: boolean;
}> = [
  { codigo: "SUELDO_BASICO", factor1: null, factor2: null, factor3: null, afecto_essalud: true, afecto_sctr: true, afecto_senati: true, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: true },
  { codigo: "REM_DOMINICAL", factor1: null, factor2: null, factor3: null, afecto_essalud: true, afecto_sctr: true, afecto_senati: true, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: true },
  { codigo: "REM_FERIADO", factor1: null, factor2: null, factor3: null, afecto_essalud: true, afecto_sctr: true, afecto_senati: true, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: false },
  { codigo: "HORAS_EXTRA_CONSTRUCCION", factor1: 1.6, factor2: 2.0, factor3: 2.0, afecto_essalud: true, afecto_sctr: true, afecto_senati: false, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: false },
  { codigo: "HORAS_EXTRA_GENERAL", factor1: 1.25, factor2: 1.35, factor3: 2.0, afecto_essalud: true, afecto_sctr: true, afecto_senati: false, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: false },
  { codigo: "ASIGNACION_FAMILIAR", factor1: 0.1, factor2: null, factor3: null, afecto_essalud: true, afecto_sctr: true, afecto_senati: true, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: false },
  { codigo: "ASIGNACION_ESCOLARIDAD", factor1: 12, factor2: null, factor3: null, afecto_essalud: false, afecto_sctr: false, afecto_senati: false, afecto_onp: false, afecto_afp: false, afecto_renta5ta: true, afecto_conafovicer: false },
  { codigo: "BUC", factor1: null, factor2: null, factor3: null, afecto_essalud: true, afecto_sctr: true, afecto_senati: true, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: false },
  { codigo: "BAE", factor1: null, factor2: null, factor3: null, afecto_essalud: true, afecto_sctr: true, afecto_senati: false, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: false },
  { codigo: "MOVILIDAD", factor1: null, factor2: null, factor3: null, afecto_essalud: false, afecto_sctr: false, afecto_senati: false, afecto_onp: false, afecto_afp: false, afecto_renta5ta: true, afecto_conafovicer: false },
  { codigo: "GRATIFICACION", factor1: 40, factor2: 210, factor3: null, afecto_essalud: false, afecto_sctr: false, afecto_senati: false, afecto_onp: false, afecto_afp: false, afecto_renta5ta: null, afecto_conafovicer: false },
  { codigo: "BONIFICACION_EXTRAORDINARIA", factor1: 0.09, factor2: null, factor3: null, afecto_essalud: false, afecto_sctr: false, afecto_senati: false, afecto_onp: false, afecto_afp: false, afecto_renta5ta: null, afecto_conafovicer: false },
  { codigo: "CTS", factor1: 0.15, factor2: null, factor3: null, afecto_essalud: false, afecto_sctr: false, afecto_senati: false, afecto_onp: false, afecto_afp: false, afecto_renta5ta: false, afecto_conafovicer: false },
  { codigo: "VACACIONES", factor1: 0.1, factor2: null, factor3: null, afecto_essalud: true, afecto_sctr: true, afecto_senati: false, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: false },
];
