// Pruebas unitarias del motor de formulas (migracion 033, "Ronda D" -
// Conceptos con formula propia). No dependen de la base de datos ni de
// peticiones HTTP: prueban validarFormula/evaluarFormula directamente.
import { validarFormula, evaluarFormula, ErrorFormula, VARIABLES_FORMULA } from "../src/formulas";

describe("validarFormula", () => {
  it("acepta una formula valida que solo usa variables de la lista blanca", () => {
    expect(validarFormula("jornal_diario * dias_trabajados * 0.09")).toBe("jornal_diario * dias_trabajados * 0.09");
  });

  it("recorta espacios en blanco alrededor de la formula", () => {
    expect(validarFormula("  jornal_diario * 0.1  ")).toBe("jornal_diario * 0.1");
  });

  it("rechaza una formula vacia", () => {
    expect(() => validarFormula("")).toThrow(ErrorFormula);
    expect(() => validarFormula("   ")).toThrow(ErrorFormula);
  });

  it("rechaza sintaxis invalida", () => {
    expect(() => validarFormula("jornal_diario * ")).toThrow(ErrorFormula);
  });

  it("rechaza una variable que no esta en la lista blanca", () => {
    expect(() => validarFormula("variable_invalida * 2")).toThrow(ErrorFormula);
    try {
      validarFormula("variable_invalida * 2");
      throw new Error("no debio llegar aqui");
    } catch (err) {
      expect((err as Error).message).toContain("variable_invalida");
      expect((err as Error).message).toContain("Variables disponibles");
    }
  });

  it("rechaza acceso a miembros de objeto (allowMemberAccess: false)", () => {
    expect(() => validarFormula("jornal_diario.toString")).toThrow(ErrorFormula);
  });

  it("rechaza asignaciones y definicion de funciones (operadores deshabilitados)", () => {
    expect(() => validarFormula("factor1 = 5")).toThrow(ErrorFormula);
    expect(() => validarFormula("f(x) = x * 2")).toThrow(ErrorFormula);
  });

  it("todas las variables documentadas en VARIABLES_FORMULA pasan la validacion", () => {
    const formula = VARIABLES_FORMULA.join(" + ");
    expect(() => validarFormula(formula)).not.toThrow();
  });
});

describe("evaluarFormula", () => {
  it("evalua correctamente con todas las variables presentes", () => {
    const resultado = evaluarFormula("jornal_diario * dias_trabajados * factor1", {
      jornal_diario: 62.8,
      dias_trabajados: 24,
      factor1: 0.09,
    });
    expect(resultado).toBeCloseTo(135.65, 2);
  });

  it("rellena con 0 cualquier variable de la lista blanca ausente del contexto", () => {
    const resultado = evaluarFormula("jornal_diario * 0.1 + factor2", { jornal_diario: 62.8 });
    expect(resultado).toBeCloseTo(6.28, 2);
  });

  it("redondea el resultado a 2 decimales", () => {
    const resultado = evaluarFormula("jornal_diario / 3", { jornal_diario: 10 });
    expect(resultado).toBeCloseTo(3.33, 2);
  });

  it("lanza ErrorFormula si el resultado no es un numero finito (division por cero -> Infinity)", () => {
    expect(() => evaluarFormula("jornal_diario / factor1", { jornal_diario: 10, factor1: 0 })).toThrow(ErrorFormula);
  });
});
