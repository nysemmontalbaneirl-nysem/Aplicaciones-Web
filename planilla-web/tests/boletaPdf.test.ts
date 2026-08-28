// Prueba de regresion: pg devuelve las columnas DATE como objetos Date (no
// como texto) cuando se consultan directo desde el backend - a diferencia
// del frontend, que recibe el JSON ya con fechas convertidas a texto por
// Express. generarPdfBoleta se llama con filas crudas de pg (ver
// routes/envios.ts), asi que tiene que soportar un Date real en
// fecha_ingreso sin explotar (bug real encontrado al probar el envio de
// boletas a mano: "detalle.fecha_ingreso?.slice is not a function").
import { DetalleBoletaPdf, generarPdfBoleta } from "../src/boletaPdf";

const DETALLE_BASE: DetalleBoletaPdf = {
  apellidos_nombres: "PEREZ GOMEZ JUAN",
  numero_documento: "12345678",
  numero_hijos: 2,
  proyecto: "Obra Prueba",
  categoria_ocupacional: "PEON",
  sistema_pension: "ONP",
  afp_nombre: null,
  cuspp: null,
  fecha_ingreso: new Date("2026-01-02T00:00:00.000Z"),
  dias_trabajados: 30,
  sueldo_basico: 1500.5,
  remuneracion_dominical: 0,
  remuneracion_feriado: 0,
  importe_horas_extra: 50,
  asignacion_familiar: 113,
  asignacion_escolaridad: 0,
  bonificacion_buc: 450,
  bonificacion_bae: 0,
  bonificacion_movilidad: 258,
  otras_bonificaciones: 0,
  gratificacion: 0,
  bonificacion_extraordinaria: 0,
  cts: 0,
  vacaciones: 0,
  total_ingresos: 2371.5,
  aporte_pension: 308.29,
  descuento_sindicato: 15,
  conafovicer: 30,
  renta_5ta: 0,
  otros_descuentos: 0,
  total_descuentos: 353.29,
  essalud: 213.44,
  sctr: 36.76,
  seguro_vida: 5,
  senati: 17.79,
  neto_pagar: 2018.21,
  detalle_json: { aporte_pension_detalle: { onp: 308.29 }, total_aportes_empleador: 273.0 },
};

describe("generarPdfBoleta", () => {
  it("genera un PDF valido cuando fecha_ingreso es un objeto Date real (como lo devuelve pg)", async () => {
    const pdf = await generarPdfBoleta(DETALLE_BASE, { anio: 2026, mes: 2 });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("tambien funciona si fecha_ingreso ya viene como texto (caso del frontend)", async () => {
    const pdf = await generarPdfBoleta({ ...DETALLE_BASE, fecha_ingreso: "2026-01-02" }, { anio: 2026, mes: 2 });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("no explota si fecha_ingreso es null", async () => {
    const pdf = await generarPdfBoleta(
      { ...DETALLE_BASE, fecha_ingreso: null as unknown as Date },
      { anio: 2026, mes: 2 }
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
