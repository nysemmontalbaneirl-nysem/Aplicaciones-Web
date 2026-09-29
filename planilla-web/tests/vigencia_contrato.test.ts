// Pruebas puras de src/vigenciaContrato.ts (migracion 048, reconstruida
// desde backend_dist de produccion - ver RECONSTRUCCION_BRECHAS.md).
import { traslapaVigencia, rangoVigenciaEnPeriodo, fechaFueraDeVigencia } from "../src/vigenciaContrato";

describe("traslapaVigencia", () => {
  it("true si el contrato sigue vigente (fecha_cese null) y empezo antes del periodo", () => {
    expect(traslapaVigencia("2026-01-01", null, "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("true si el contrato ingreso a mitad del periodo", () => {
    expect(traslapaVigencia("2026-08-15", null, "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("false si el contrato ingresa despues de terminado el periodo", () => {
    expect(traslapaVigencia("2026-09-01", null, "2026-08-01", "2026-08-31")).toBe(false);
  });

  it("false si el contrato ceso antes de empezar el periodo", () => {
    expect(traslapaVigencia("2026-01-01", "2026-07-15", "2026-08-01", "2026-08-31")).toBe(false);
  });

  it("true si el cese cae justo dentro del periodo", () => {
    expect(traslapaVigencia("2026-01-01", "2026-08-10", "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("true en los bordes exactos (ingreso == fin del periodo, cese == inicio del periodo)", () => {
    expect(traslapaVigencia("2026-08-31", null, "2026-08-01", "2026-08-31")).toBe(true);
    expect(traslapaVigencia("2026-01-01", "2026-08-01", "2026-08-01", "2026-08-31")).toBe(true);
  });
});

describe("rangoVigenciaEnPeriodo", () => {
  it("null si no hay traslape", () => {
    expect(rangoVigenciaEnPeriodo("2026-09-01", null, "2026-08-01", "2026-08-31")).toBeNull();
  });

  it("el periodo completo si el contrato ya estaba vigente y sigue vigente despues", () => {
    expect(rangoVigenciaEnPeriodo("2026-01-01", null, "2026-08-01", "2026-08-31")).toEqual({
      desde: "2026-08-01",
      hasta: "2026-08-31",
    });
  });

  it("recorta el 'desde' cuando el contrato ingresa a mitad del periodo", () => {
    expect(rangoVigenciaEnPeriodo("2026-08-15", null, "2026-08-01", "2026-08-31")).toEqual({
      desde: "2026-08-15",
      hasta: "2026-08-31",
    });
  });

  it("recorta el 'hasta' cuando el contrato cesa a mitad del periodo", () => {
    expect(rangoVigenciaEnPeriodo("2026-01-01", "2026-08-20", "2026-08-01", "2026-08-31")).toEqual({
      desde: "2026-08-01",
      hasta: "2026-08-20",
    });
  });

  it("recorta ambos extremos cuando ingreso y cese caen dentro del mismo periodo", () => {
    expect(rangoVigenciaEnPeriodo("2026-08-10", "2026-08-20", "2026-08-01", "2026-08-31")).toEqual({
      desde: "2026-08-10",
      hasta: "2026-08-20",
    });
  });
});

describe("fechaFueraDeVigencia", () => {
  it("true para una fecha anterior al ingreso", () => {
    expect(fechaFueraDeVigencia("2026-08-05", "2026-08-10", null)).toBe(true);
  });

  it("false para una fecha igual al ingreso", () => {
    expect(fechaFueraDeVigencia("2026-08-10", "2026-08-10", null)).toBe(false);
  });

  it("true para una fecha posterior al cese", () => {
    expect(fechaFueraDeVigencia("2026-08-25", "2026-08-01", "2026-08-20")).toBe(true);
  });

  it("false para una fecha igual al cese", () => {
    expect(fechaFueraDeVigencia("2026-08-20", "2026-08-01", "2026-08-20")).toBe(false);
  });

  it("false para una fecha dentro del rango, con cese null (sigue vigente)", () => {
    expect(fechaFueraDeVigencia("2026-12-31", "2026-08-01", null)).toBe(false);
  });
});
