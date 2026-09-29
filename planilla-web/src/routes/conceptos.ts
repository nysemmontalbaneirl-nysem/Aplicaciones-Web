import bcrypt from "bcryptjs";
import { Router, Request, Response, NextFunction } from "express";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso, requiereRol } from "../authMiddleware";
import { pool } from "../db";
import { ConceptoPlanilla, ConceptosPlanilla, CuotaSindicalCategoria, CategoriaOcupacional } from "../tipos";
import { ErrorValidacion } from "../validaciones";
import { registrarBitacora } from "../bitacora";
import { validarFormula, ErrorFormula, VARIABLES_FORMULA } from "../formulas";
import { buscarPosiblesDuplicados, AvisoDuplicado } from "../anexo22";

export const conceptosRouter = Router();

function filaAConcepto(fila: Record<string, unknown>): ConceptoPlanilla {
  const numeroONull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    id: fila.id as number,
    codigo: fila.codigo as string,
    nombre: fila.nombre as string,
    descripcion: (fila.descripcion as string | null) ?? null,
    orden: fila.orden as number,
    codigo_plame: (fila.codigo_plame as string | null) ?? null,
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
    tipo: fila.tipo as ConceptoPlanilla["tipo"],
    formula: (fila.formula as string | null) ?? null,
    es_personalizado: fila.es_personalizado as boolean,
    estado: fila.estado as ConceptoPlanilla["estado"],
    activo: fila.activo as boolean,
    creado_en: fila.creado_en instanceof Date ? fila.creado_en.toISOString() : String(fila.creado_en),
    vigente_desde: fechaOnull(fila.vigente_desde),
    vigente_hasta: fechaOnull(fila.vigente_hasta),
  };
}

function fechaOnull(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

function filaACuotaSindical(fila: Record<string, unknown>): CuotaSindicalCategoria {
  return {
    id: fila.id as number,
    proyecto_id: fila.proyecto_id as number,
    categoria: fila.categoria as CategoriaOcupacional,
    monto_semanal: Number(fila.monto_semanal),
  };
}

// Las 10 categorias validas de contratos.categoria_ocupacional (ver
// CategoriaOcupacional en tipos.ts) - la cuota sindical no esta limitada a
// construccion civil (contratos.sindicalizado es un flag libre en
// cualquier categoria), asi que se valida contra el catalogo completo.
const CATEGORIAS_VALIDAS = new Set<string>([
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
]);

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

// ===========================================================================
// Cuota sindical por proyecto y categoria (cuota_sindical_categoria,
// migracion_029): el monto SEMANAL que acuerda el sindicato varia por
// categoria del trabajador (peon/oficial/operario), no solo por proyecto -
// antes el sistema solo tenia el valor unico de proyectos.cuota_sindical_semanal.
// routes/planilla.ts (ruta /calcular) usa esta tabla con prioridad y cae al
// valor unico del proyecto si la combinacion no esta configurada aqui.
//
// OJO: estas 2 rutas ("/cuota-sindical") deben quedar registradas ANTES de
// PUT "/:codigo" (mas abajo) - Express matchea rutas en el orden en que se
// registran, y "/:codigo" con codigo="cuota-sindical" la interceptaria
// (404 "Concepto no encontrado") si quedara antes.
// ===========================================================================

// GET /api/conceptos/cuota-sindical -> toda la tabla, para la pantalla
// "Cuota sindical" de Configuracion (matriz proyecto x categoria).
conceptosRouter.get(
  "/cuota-sindical",
  requierePermiso("conceptos.editar"),
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query("SELECT * FROM cuota_sindical_categoria ORDER BY proyecto_id, categoria");
    res.json(r.rows.map(filaACuotaSindical));
  })
);

// PUT /api/conceptos/cuota-sindical -> guarda de una vez todas las celdas
// editadas en la matriz (upsert de cada entrada). Body:
// { entradas: [{ proyecto_id, categoria, monto_semanal }, ...] }
conceptosRouter.put(
  "/cuota-sindical",
  requierePermiso("conceptos.editar"),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const entradas = req.body?.entradas;
      if (!Array.isArray(entradas) || entradas.length === 0) {
        throw new ErrorValidacion("entradas debe ser un arreglo no vacio");
      }

      const proyectos = await pool.query("SELECT id FROM proyectos");
      const proyectosValidos = new Set(proyectos.rows.map((r) => r.id as number));

      for (const e of entradas) {
        if (typeof e.proyecto_id !== "number" || !proyectosValidos.has(e.proyecto_id)) {
          throw new ErrorValidacion(`proyecto_id invalido: ${e.proyecto_id}`);
        }
        if (typeof e.categoria !== "string" || !CATEGORIAS_VALIDAS.has(e.categoria)) {
          throw new ErrorValidacion(`categoria invalida: ${e.categoria}`);
        }
        if (typeof e.monto_semanal !== "number" || !Number.isFinite(e.monto_semanal) || e.monto_semanal < 0) {
          throw new ErrorValidacion(`monto_semanal invalido para ${e.categoria}: ${e.monto_semanal}`);
        }
      }

      const guardadas: CuotaSindicalCategoria[] = [];
      for (const e of entradas) {
        const r = await pool.query(
          `INSERT INTO cuota_sindical_categoria (proyecto_id, categoria, monto_semanal)
           VALUES ($1, $2, $3)
           ON CONFLICT (proyecto_id, categoria)
           DO UPDATE SET monto_semanal = EXCLUDED.monto_semanal, actualizado_en = now()
           RETURNING *`,
          [e.proyecto_id, e.categoria, e.monto_semanal]
        );
        guardadas.push(filaACuotaSindical(r.rows[0]));
      }
      await registrarBitacora(req.usuario!.id, "EDICION_CUOTA_SINDICAL", "cuota_sindical_categoria", null, {
        cantidad: guardadas.length,
      });
      res.json(guardadas);
    } catch (err) {
      if (err instanceof ErrorValidacion) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
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
    try {
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
      // Migracion 039: interruptor activo/inactivo para conceptos de codigo
      // fijo (ver estaActivo en motorCalculo.ts). SUELDO_BASICO nunca se
      // puede apagar por aca - no es solo una convencion de negocio: el
      // sueldo/jornal basico ni siquiera se calcula leyendo este flag (ver
      // comentario de estaActivo), asi que "desactivarlo" seria un boton que
      // aparenta hacer algo y no hace nada - se rechaza explicitamente para
      // no confundir al usuario.
      if (b.activo !== undefined && typeof b.activo !== "boolean") {
        throw new ErrorValidacion("activo debe ser verdadero o falso");
      }
      if (b.activo === false && req.params.codigo === "SUELDO_BASICO") {
        throw new ErrorValidacion("SUELDO_BASICO no se puede desactivar (el sueldo/jornal basico siempre se calcula)");
      }

      const r = await pool.query(
        `UPDATE conceptos_planilla SET
           factor1 = $1, factor2 = $2, factor3 = $3,
           afecto_essalud = $4, afecto_sctr = $5, afecto_senati = $6,
           afecto_onp = $7, afecto_afp = $8, afecto_renta5ta = $9, afecto_conafovicer = $10,
           activo = $11,
           actualizado_en = now()
         WHERE codigo = $12
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
          b.activo !== undefined ? b.activo : actual.activo,
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
          activo: actual.activo,
        },
        despues: filaAConcepto(r.rows[0]),
      });
      res.json(filaAConcepto(r.rows[0]));
    } catch (err) {
      // NOTA (recon 26/46): esta ruta no tenia try/catch propio - cualquier
      // ErrorValidacion (incluidas las validaciones YA existentes de
      // factor1/2/3 y afecto_*, anteriores a esta migracion) caia al
      // manejador de errores centralizado de app.ts, que siempre responde
      // 500 (no distingue ErrorValidacion). Se agrega este catch, igual
      // patron que el resto de rutas de este archivo (ver PUT
      // /formula/:codigo mas abajo), necesario para que el interruptor
      // "Activo" nuevo (y las validaciones previas) respondan 400 en vez
      // de 500 ante un body invalido.
      if (err instanceof ErrorValidacion) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  })
);

// ===========================================================================
// Clave secundaria de formulas (configuracion_seguridad, migracion 033):
// candado independiente del usuario/rol de sesion, exigido en cada
// creacion/edicion/eliminacion de un concepto con formula propia - incluso
// para ADMIN (que de otro modo pasaria cualquier permiso normal por su
// comodin "*", ver requierePermiso en src/authMiddleware.ts). Ver
// PLAN_PENDIENTE.md, seccion "Conceptos con formula propia", punto 3.
// ===========================================================================

// GET /api/conceptos/clave-formulas/estado -> si ya se configuro o no (para
// que el frontend sepa si mostrar "configurar por primera vez" o "cambiar").
conceptosRouter.get(
  "/clave-formulas/estado",
  requiereRol("ADMIN"),
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query("SELECT clave_formulas_hash FROM configuracion_seguridad WHERE id = 1");
    res.json({ configurada: !!r.rows[0]?.clave_formulas_hash });
  })
);

// POST /api/conceptos/clave-formulas -> configura (primera vez) o cambia
// (exige clave_actual) la clave secundaria de formulas. Solo ADMIN puede
// configurarla/cambiarla (no hace falta un permiso extra en el catalogo de
// Roles para esto: solo el rol protegido puede tocarla).
conceptosRouter.post(
  "/clave-formulas",
  requiereRol("ADMIN"),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { clave_actual, clave_nueva } = req.body;
      if (typeof clave_nueva !== "string" || clave_nueva.length < 6) {
        throw new ErrorValidacion("clave_nueva debe tener al menos 6 caracteres");
      }
      const existente = await pool.query("SELECT clave_formulas_hash FROM configuracion_seguridad WHERE id = 1");
      const hashActual = existente.rows[0]?.clave_formulas_hash as string | null;
      if (hashActual) {
        if (typeof clave_actual !== "string" || !(await bcrypt.compare(clave_actual, hashActual))) {
          return res.status(403).json({ error: "clave_actual es incorrecta." });
        }
      }
      const nuevoHash = await bcrypt.hash(clave_nueva, 10);
      await pool.query(
        "UPDATE configuracion_seguridad SET clave_formulas_hash = $1, actualizado_en = now() WHERE id = 1",
        [nuevoHash]
      );
      await registrarBitacora(req.usuario!.id, "CAMBIO_CLAVE_FORMULAS", "configuracion_seguridad", null, {
        accion: hashActual ? "cambio" : "configuracion_inicial",
      });
      res.status(204).end();
    } catch (err) {
      if (err instanceof ErrorValidacion) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  })
);

/**
 * Exige la clave secundaria de formulas (body.clave_formulas) en cada
 * creacion/edicion/eliminacion de un concepto con formula - APARTE del
 * permiso "conceptos.editar" ya exigido por el resto de este router, y sin
 * excepcion para ADMIN (ver comentario de la seccion de arriba).
 */
async function requiereClaveFormulas(req: Request, res: Response, next: NextFunction): Promise<void> {
  const clave = req.body?.clave_formulas;
  if (typeof clave !== "string" || clave.length === 0) {
    res.status(400).json({ error: "Falta la clave secundaria de formulas (clave_formulas)." });
    return;
  }
  const r = await pool.query("SELECT clave_formulas_hash FROM configuracion_seguridad WHERE id = 1");
  const hash = r.rows[0]?.clave_formulas_hash as string | null;
  if (!hash) {
    res.status(400).json({
      error:
        "Todavia no se configuro la clave secundaria de formulas. Un ADMIN debe configurarla primero " +
        "(POST /api/conceptos/clave-formulas).",
    });
    return;
  }
  if (!(await bcrypt.compare(clave, hash))) {
    res.status(403).json({ error: "Clave secundaria de formulas incorrecta." });
    return;
  }
  next();
}

// ===========================================================================
// Conceptos con formula propia ("Ronda D", migracion 033): catalogo
// ABIERTO, distinto de los 14+ conceptos originales del sistema (esos se
// editan con el PUT /:codigo de mas arriba, sin formula ni clave
// secundaria). Toda accion de esta seccion exige, ademas del permiso
// "conceptos.editar", la clave secundaria de formulas de arriba.
// ===========================================================================

const TIPOS_CONCEPTO_VALIDOS = new Set(["INGRESO", "APORTE", "DESCUENTO"]);

function validarFechaOpcional(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor !== "string" || Number.isNaN(Date.parse(valor))) {
    throw new ErrorValidacion(`${campo} debe ser una fecha valida (YYYY-MM-DD) o vacio`);
  }
  return valor;
}

// GET /api/conceptos/formula/variables -> lista de variables disponibles
// para escribir una formula (para mostrarla en la pantalla de Configuracion).
conceptosRouter.get(
  "/formula/variables",
  requierePermiso("conceptos.editar"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ variables: VARIABLES_FORMULA });
  })
);

// POST /api/conceptos/formula -> crea un concepto personalizado, con
// formula propia (modo="FORMULA") o para que lo programe un desarrollador
// mas adelante (modo="PROGRAMACION_INTERNA": queda visible pero inactivo,
// sin formula, en estado PENDIENTE_DESARROLLO, hasta que alguien lo
// implemente en codigo y lo pase a "FORMULA" o lo reprograme a mano).
conceptosRouter.post(
  "/formula",
  requierePermiso("conceptos.editar"),
  requiereClaveFormulas,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const b = req.body;
      if (typeof b.codigo !== "string" || !/^[A-Z0-9_]{2,60}$/.test(b.codigo)) {
        throw new ErrorValidacion("codigo es obligatorio: solo mayusculas, numeros y guion bajo (2 a 60 caracteres)");
      }
      if (typeof b.nombre !== "string" || b.nombre.trim().length === 0) {
        throw new ErrorValidacion("nombre es obligatorio");
      }
      if (!TIPOS_CONCEPTO_VALIDOS.has(b.tipo)) {
        throw new ErrorValidacion('tipo debe ser "INGRESO", "APORTE" o "DESCUENTO"');
      }
      if (b.modo !== "FORMULA" && b.modo !== "PROGRAMACION_INTERNA") {
        throw new ErrorValidacion('modo debe ser "FORMULA" o "PROGRAMACION_INTERNA"');
      }
      const existeCodigo = await pool.query("SELECT 1 FROM conceptos_planilla WHERE codigo = $1", [b.codigo]);
      if ((existeCodigo.rowCount ?? 0) > 0) {
        throw new ErrorValidacion(`Ya existe un concepto con el codigo ${b.codigo}`);
      }
      for (const campoFactor of ["factor1", "factor2", "factor3"] as const) {
        if (b[campoFactor] !== undefined && b[campoFactor] !== null && typeof b[campoFactor] !== "number") {
          throw new ErrorValidacion(`${campoFactor} debe ser un numero`);
        }
      }
      for (const campo of CAMPOS_AFECTO) {
        if (b[campo] !== undefined && typeof b[campo] !== "boolean") {
          throw new ErrorValidacion(`${campo} debe ser verdadero o falso`);
        }
      }
      const vigenteDesde = validarFechaOpcional(b.vigente_desde, "vigente_desde");
      const vigenteHasta = validarFechaOpcional(b.vigente_hasta, "vigente_hasta");
      if (vigenteDesde && vigenteHasta && vigenteDesde > vigenteHasta) {
        throw new ErrorValidacion("vigente_desde no puede ser posterior a vigente_hasta");
      }

      let formula: string | null = null;
      let estado: "ACTIVO" | "PENDIENTE_DESARROLLO" = "ACTIVO";
      let activo = b.activo !== undefined ? !!b.activo : true;
      if (b.modo === "FORMULA") {
        formula = validarFormula(b.formula);
      } else {
        estado = "PENDIENTE_DESARROLLO";
        activo = false; // visible pero inactivo hasta que un desarrollador lo implemente
      }

      const r = await pool.query(
        `INSERT INTO conceptos_planilla
           (codigo, nombre, descripcion, orden, codigo_plame,
            factor1, factor1_etiqueta, factor2, factor2_etiqueta, factor3, factor3_etiqueta,
            afecto_essalud, afecto_sctr, afecto_senati, afecto_onp, afecto_afp, afecto_renta5ta, afecto_conafovicer,
            tipo, formula, es_personalizado, estado, activo, vigente_desde, vigente_hasta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,$21,$22,$23,$24)
         RETURNING *`,
        [
          b.codigo,
          b.nombre.trim(),
          b.descripcion ?? null,
          typeof b.orden === "number" ? b.orden : 900,
          b.codigo_plame ?? null,
          b.factor1 ?? null,
          b.factor1_etiqueta ?? null,
          b.factor2 ?? null,
          b.factor2_etiqueta ?? null,
          b.factor3 ?? null,
          b.factor3_etiqueta ?? null,
          !!b.afecto_essalud,
          !!b.afecto_sctr,
          !!b.afecto_senati,
          !!b.afecto_onp,
          !!b.afecto_afp,
          b.afecto_renta5ta === undefined || b.afecto_renta5ta === null ? null : !!b.afecto_renta5ta,
          !!b.afecto_conafovicer,
          b.tipo,
          formula,
          estado,
          activo,
          vigenteDesde,
          vigenteHasta,
        ]
      );

      const existentes = await pool.query("SELECT codigo, nombre FROM conceptos_planilla WHERE codigo <> $1", [b.codigo]);
      const avisosDuplicado: AvisoDuplicado[] = buscarPosiblesDuplicados(b.nombre, b.descripcion, existentes.rows);

      await registrarBitacora(req.usuario!.id, "CREACION_CONCEPTO_FORMULA", "conceptos_planilla", r.rows[0].id, {
        codigo: b.codigo,
        modo: b.modo,
        tipo: b.tipo,
      });
      res.status(201).json({ concepto: filaAConcepto(r.rows[0]), avisos_duplicado: avisosDuplicado });
    } catch (err) {
      if (err instanceof ErrorValidacion || err instanceof ErrorFormula) {
        return res.status(400).json({ error: err.message });
      }
      if ((err as { code?: string }).code === "23505") {
        return res.status(400).json({ error: "Ya existe un concepto con ese codigo" });
      }
      throw err;
    }
  })
);

// PUT /api/conceptos/formula/:codigo -> edita un concepto PERSONALIZADO
// (nunca uno de los 14+ originales - esos se editan con el PUT /:codigo de
// mas arriba, sin formula). Permite pasar de PROGRAMACION_INTERNA a
// FORMULA (el desarrollador ya lo implemento) o viceversa, si se manda
// "modo" explicitamente.
conceptosRouter.put(
  "/formula/:codigo",
  requierePermiso("conceptos.editar"),
  requiereClaveFormulas,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const existente = await pool.query("SELECT * FROM conceptos_planilla WHERE codigo = $1", [req.params.codigo]);
      if (existente.rowCount === 0) {
        return res.status(404).json({ error: "Concepto no encontrado" });
      }
      const actual = existente.rows[0];
      if (!actual.es_personalizado) {
        throw new ErrorValidacion(
          "Este concepto no es personalizado (es uno de los conceptos originales del sistema) - " +
            "se edita con PUT /api/conceptos/:codigo, sin formula."
        );
      }
      const b = req.body;

      if (b.nombre !== undefined && (typeof b.nombre !== "string" || b.nombre.trim().length === 0)) {
        throw new ErrorValidacion("nombre debe ser un texto no vacio");
      }
      if (b.tipo !== undefined && !TIPOS_CONCEPTO_VALIDOS.has(b.tipo)) {
        throw new ErrorValidacion('tipo debe ser "INGRESO", "APORTE" o "DESCUENTO"');
      }
      for (const campoFactor of ["factor1", "factor2", "factor3"] as const) {
        if (b[campoFactor] !== undefined && b[campoFactor] !== null && typeof b[campoFactor] !== "number") {
          throw new ErrorValidacion(`${campoFactor} debe ser un numero`);
        }
      }
      for (const campo of CAMPOS_AFECTO) {
        if (b[campo] !== undefined && typeof b[campo] !== "boolean") {
          throw new ErrorValidacion(`${campo} debe ser verdadero o falso`);
        }
      }

      let formula = actual.formula as string | null;
      let estado = actual.estado as string;
      if (b.modo === "FORMULA") {
        formula = validarFormula(b.formula);
        estado = "ACTIVO";
      } else if (b.modo === "PROGRAMACION_INTERNA") {
        formula = null;
        estado = "PENDIENTE_DESARROLLO";
      } else if (b.formula !== undefined) {
        formula = validarFormula(b.formula);
      }

      const vigenteDesde =
        b.vigente_desde !== undefined ? validarFechaOpcional(b.vigente_desde, "vigente_desde") : actual.vigente_desde;
      const vigenteHasta =
        b.vigente_hasta !== undefined ? validarFechaOpcional(b.vigente_hasta, "vigente_hasta") : actual.vigente_hasta;
      if (vigenteDesde && vigenteHasta && vigenteDesde > vigenteHasta) {
        throw new ErrorValidacion("vigente_desde no puede ser posterior a vigente_hasta");
      }

      const r = await pool.query(
        `UPDATE conceptos_planilla SET
           nombre = $1, descripcion = $2, codigo_plame = $3,
           factor1 = $4, factor1_etiqueta = $5, factor2 = $6, factor2_etiqueta = $7, factor3 = $8, factor3_etiqueta = $9,
           afecto_essalud = $10, afecto_sctr = $11, afecto_senati = $12, afecto_onp = $13, afecto_afp = $14,
           afecto_renta5ta = $15, afecto_conafovicer = $16,
           tipo = $17, formula = $18, estado = $19, activo = $20, vigente_desde = $21, vigente_hasta = $22,
           actualizado_en = now()
         WHERE codigo = $23
         RETURNING *`,
        [
          b.nombre !== undefined ? b.nombre.trim() : actual.nombre,
          b.descripcion !== undefined ? b.descripcion : actual.descripcion,
          b.codigo_plame !== undefined ? b.codigo_plame : actual.codigo_plame,
          b.factor1 !== undefined ? b.factor1 : actual.factor1,
          b.factor1_etiqueta !== undefined ? b.factor1_etiqueta : actual.factor1_etiqueta,
          b.factor2 !== undefined ? b.factor2 : actual.factor2,
          b.factor2_etiqueta !== undefined ? b.factor2_etiqueta : actual.factor2_etiqueta,
          b.factor3 !== undefined ? b.factor3 : actual.factor3,
          b.factor3_etiqueta !== undefined ? b.factor3_etiqueta : actual.factor3_etiqueta,
          b.afecto_essalud !== undefined ? b.afecto_essalud : actual.afecto_essalud,
          b.afecto_sctr !== undefined ? b.afecto_sctr : actual.afecto_sctr,
          b.afecto_senati !== undefined ? b.afecto_senati : actual.afecto_senati,
          b.afecto_onp !== undefined ? b.afecto_onp : actual.afecto_onp,
          b.afecto_afp !== undefined ? b.afecto_afp : actual.afecto_afp,
          b.afecto_renta5ta !== undefined ? b.afecto_renta5ta : actual.afecto_renta5ta,
          b.afecto_conafovicer !== undefined ? b.afecto_conafovicer : actual.afecto_conafovicer,
          b.tipo !== undefined ? b.tipo : actual.tipo,
          formula,
          estado,
          b.activo !== undefined ? !!b.activo : actual.activo,
          vigenteDesde,
          vigenteHasta,
          req.params.codigo,
        ]
      );
      await registrarBitacora(req.usuario!.id, "EDICION_CONCEPTO_FORMULA", "conceptos_planilla", r.rows[0].id, {
        codigo: req.params.codigo,
      });
      res.json(filaAConcepto(r.rows[0]));
    } catch (err) {
      if (err instanceof ErrorValidacion || err instanceof ErrorFormula) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  })
);

// DELETE /api/conceptos/formula/:codigo -> elimina un concepto
// PERSONALIZADO, solo si NUNCA se uso en ningun calculo (si ya tiene
// montos guardados en detalle_planilla_conceptos, hay que desactivarlo en
// vez de eliminarlo - PUT .../formula/:codigo con activo:false - para no
// perder el historial de boletas ya calculadas).
conceptosRouter.delete(
  "/formula/:codigo",
  requierePermiso("conceptos.editar"),
  requiereClaveFormulas,
  asyncHandler(async (req: Request, res: Response) => {
    const existente = await pool.query("SELECT * FROM conceptos_planilla WHERE codigo = $1", [req.params.codigo]);
    if (existente.rowCount === 0) {
      return res.status(404).json({ error: "Concepto no encontrado" });
    }
    if (!existente.rows[0].es_personalizado) {
      return res.status(400).json({ error: "Este concepto no es personalizado - no se puede eliminar desde aqui." });
    }
    const usado = await pool.query("SELECT 1 FROM detalle_planilla_conceptos WHERE concepto_codigo = $1 LIMIT 1", [
      req.params.codigo,
    ]);
    if ((usado.rowCount ?? 0) > 0) {
      return res.status(400).json({
        error:
          "Este concepto ya se uso en al menos un calculo de planilla - no se puede eliminar (se perderia el historial). " +
          "Desactivalo en vez de eliminarlo (PUT /api/conceptos/formula/:codigo con activo:false).",
      });
    }
    await pool.query("DELETE FROM conceptos_planilla WHERE codigo = $1", [req.params.codigo]);
    await registrarBitacora(req.usuario!.id, "ELIMINACION_CONCEPTO_FORMULA", "conceptos_planilla", existente.rows[0].id, {
      codigo: req.params.codigo,
    });
    res.status(204).end();
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
// editables, por eso son el punto de "restaurar valores originales". OJO:
// BUC.afecto_senati se corrigio a "false" en migracion_029 (el Fondo de
// Capacitacion no debe incluir el BUC en su base, error real reportado por
// el usuario) - si este arreglo siguiera con el valor original de
// migracion_014 (true), "Restaurar" reintroduciria ese mismo bug.
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
  { codigo: "BUC", factor1: null, factor2: null, factor3: null, afecto_essalud: true, afecto_sctr: true, afecto_senati: false, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: false },
  { codigo: "BAE", factor1: null, factor2: null, factor3: null, afecto_essalud: true, afecto_sctr: true, afecto_senati: false, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: false },
  { codigo: "MOVILIDAD", factor1: null, factor2: null, factor3: null, afecto_essalud: false, afecto_sctr: false, afecto_senati: false, afecto_onp: false, afecto_afp: false, afecto_renta5ta: true, afecto_conafovicer: false },
  { codigo: "GRATIFICACION", factor1: 40, factor2: 210, factor3: null, afecto_essalud: false, afecto_sctr: false, afecto_senati: false, afecto_onp: false, afecto_afp: false, afecto_renta5ta: null, afecto_conafovicer: false },
  { codigo: "BONIFICACION_EXTRAORDINARIA", factor1: 0.09, factor2: null, factor3: null, afecto_essalud: false, afecto_sctr: false, afecto_senati: false, afecto_onp: false, afecto_afp: false, afecto_renta5ta: null, afecto_conafovicer: false },
  { codigo: "CTS", factor1: 0.15, factor2: null, factor3: null, afecto_essalud: false, afecto_sctr: false, afecto_senati: false, afecto_onp: false, afecto_afp: false, afecto_renta5ta: false, afecto_conafovicer: false },
  { codigo: "VACACIONES", factor1: 0.1, factor2: null, factor3: null, afecto_essalud: true, afecto_sctr: true, afecto_senati: false, afecto_onp: true, afecto_afp: true, afecto_renta5ta: true, afecto_conafovicer: false },
];
