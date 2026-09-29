// =========================================================================
// Motor de formulas para "Conceptos con formula propia" (Ronda D,
// migracion 033). Permite que un concepto de conceptos_planilla con
// es_personalizado=true calcule su monto con una formula de texto tipo
// Excel (ej. "jornal_diario * dias_trabajados * factor1") en vez de tener
// su formula fija en motorCalculo.ts.
//
// Seguridad: se usa "expr-eval-fork" (no el "expr-eval" original, que
// tiene 2 vulnerabilidades altas sin parchear -ver npm audit-: prototype
// pollution y ejecucion de funciones no restringidas via evaluate()). Aun
// asi, se refuerza con allowMemberAccess:false (nunca se accede a
// "objeto.propiedad" dentro de una formula) y se deshabilitan los
// operadores "assignment" y "fndef" (una formula de un concepto de
// planilla nunca necesita asignar variables ni definir funciones nuevas -
// menos superficie de ataque). El contexto de evaluacion SOLO contiene
// numeros (ver VariablesFormula), nunca funciones ni objetos, asi que
// tampoco aplica el vector de "funciones no restringidas".
//
// Ver PLAN_PENDIENTE.md para el diseño completo confirmado con el usuario.
// =========================================================================

import { Parser } from "expr-eval-fork";

// Lista blanca de variables que una formula personalizada puede usar.
// Congelada deliberadamente: nunca se expone el objeto completo de
// Contrato/AsistenciaEntrada, solo estos nombres (documentados tambien en
// la pantalla de Configuracion para quien escriba una formula).
// NOTA (recon 15/46): la lista original tambien incluia
// "dias_dominical_no_laborado" y "dias_feriado_trabajado" (infraestructura
// de "dominical proporcional / feriado no laborado", migraciones 022/023,
// que no existen todavia en este punto de la reconstruccion - ninguno de
// los 2 campos esta en AsistenciaEntrada). Se omiten aqui: si se dejaran
// en la lista blanca pero nunca se les pasa un valor real, cualquier
// formula que los use evaluaria siempre a 0 en silencio (evaluarFormula
// rellena con 0 las variables permitidas que no vienen en el contexto) -
// mejor que el usuario no pueda escribir una formula con una variable que
// todavia no existe, a que la escriba y el resultado sea silenciosamente
// incorrecto. Revisar y reincorporar cuando se reconstruya esa
// infraestructura.
export const VARIABLES_FORMULA = [
  "jornal_diario",
  "dias_trabajados",
  "dias_dominical",
  "dias_feriado",
  "dias_falta",
  "dias_subsidio_enfermedad",
  "dias_subsidio_enfermedad_computable",
  "dias_subsidio_maternidad",
  "dias_licencia_paternidad",
  "horas_extra_25",
  "horas_extra_35",
  "horas_extra_100",
  "sueldo_basico",
  "remuneracion_computable",
  "numero_hijos",
  "uit",
  "remuneracion_minima_vital",
  "factor1",
  "factor2",
  "factor3",
] as const;

export type VariableFormula = (typeof VARIABLES_FORMULA)[number];
export type VariablesFormula = Record<VariableFormula, number>;

const VARIABLES_PERMITIDAS = new Set<string>(VARIABLES_FORMULA);

// Sin acceso a miembros (a.b), sin asignaciones (a = b) ni definicion de
// funciones (f(x) = ...) - una formula de concepto de planilla es una
// expresion aritmetica pura, nunca necesita nada de esto.
const parser = new Parser({
  allowMemberAccess: false,
  operators: { assignment: false, fndef: false },
});

export class ErrorFormula extends Error {}

/**
 * Valida que una formula tenga sintaxis correcta y que TODAS las variables
 * que usa esten en la lista blanca. No evalua nada (no hace falta tener
 * valores reales todavia) - se usa al crear/editar un concepto, para poder
 * avisar el error de inmediato en la pantalla de Configuracion.
 */
export function validarFormula(formula: unknown): string {
  if (typeof formula !== "string" || formula.trim().length === 0) {
    throw new ErrorFormula("La formula no puede estar vacia");
  }
  const texto = formula.trim();
  let expr;
  try {
    expr = parser.parse(texto);
  } catch (err) {
    throw new ErrorFormula(`Formula invalida: ${(err as Error).message}`);
  }
  const variables = expr.variables();
  const noPermitidas = variables.filter((v) => !VARIABLES_PERMITIDAS.has(v));
  if (noPermitidas.length > 0) {
    throw new ErrorFormula(
      `La formula usa variable(s) no permitida(s): ${noPermitidas.join(", ")}. ` +
        `Variables disponibles: ${VARIABLES_FORMULA.join(", ")}.`
    );
  }
  return texto;
}

/**
 * Evalua una formula ya validada contra un conjunto de variables reales.
 * Cualquier variable de la lista blanca que no venga en "variables" se
 * pasa como 0 (para que una formula que use, por ejemplo, factor2 nunca
 * reviente si ese factor no se definio para este concepto en particular).
 * Redondea a 2 decimales, igual criterio que el resto de motorCalculo.ts.
 */
export function evaluarFormula(formula: string, variables: Partial<VariablesFormula>): number {
  const expr = parser.parse(formula);
  const contexto = {} as VariablesFormula;
  for (const v of VARIABLES_FORMULA) {
    contexto[v] = variables[v] ?? 0;
  }
  let resultado: unknown;
  try {
    resultado = expr.evaluate(contexto);
  } catch (err) {
    throw new ErrorFormula(`No se pudo evaluar la formula: ${(err as Error).message}`);
  }
  if (typeof resultado !== "number" || !Number.isFinite(resultado)) {
    throw new ErrorFormula("La formula no produjo un numero valido");
  }
  return Math.round(resultado * 100) / 100;
}
