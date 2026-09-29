// Prueba de regresion: pg devuelve las columnas DATE como objetos Date (no
// como texto) cuando se consultan directo desde el backend - a diferencia
// del frontend, que recibe el JSON ya con fechas convertidas a texto por
// Express. generarPdfBoleta se llama con filas crudas de pg (ver
// routes/envios.ts), asi que tiene que soportar un Date real en
// fecha_ingreso sin explotar (bug real encontrado al probar el envio de
// boletas a mano: "detalle.fecha_ingreso?.slice is not a function").
import { calcularAlturaBloqueFirmas, DetalleBoletaPdf, generarPdfBoleta } from "../src/boletaPdf";

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
  fecha_cese: null,
  dias_trabajados: 30,
  dias_feriado: 0,
  horas_extra_25: 0,
  horas_extra_35: 0,
  horas_extra_100: 0,
  sueldo_basico: 1500.5,
  remuneracion_dominical: 0,
  remuneracion_feriado: 0,
  importe_horas_extra: 50,
  asignacion_familiar: 113,
  asignacion_escolaridad: 0,
  bonificacion_buc: 450,
  bonificacion_bae: 0,
  bonificacion_movilidad: 258,
  subsidio_enfermedad: 0,
  licencia_paternidad: 0,
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

// PNG minimo de 1x1 pixel (mismo que usan las pruebas de certificado/logo/
// firma) - suficiente para que pdfkit lo procese como una imagen real.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

// Cuenta las paginas de un PDF generado por pdfkit contando los objetos
// "/Type /Page" (sin la "s" de "/Type /Pages", el objeto contenedor). pdfkit
// no comprime sus streams de objetos por defecto, asi que el texto crudo del
// PDF alcanza para esta cuenta simple - no hace falta una libreria de
// parseo de PDF solo para esta prueba.
function contarPaginas(pdf: Buffer): number {
  const texto = pdf.toString("latin1");
  const matches = texto.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

describe("generarPdfBoleta", () => {
  it("genera un PDF valido cuando fecha_ingreso es un objeto Date real (como lo devuelve pg)", async () => {
    const pdf = await generarPdfBoleta(DETALLE_BASE, { anio: 2026, mes: 2 });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
  });

  // Migracion 031: logo de la empresa + firma del empleador (con nombre del
  // representante legal) + firma escaneada del trabajador (referencial).
  // Ninguno es obligatorio - se prueba que el PDF se sigue generando bien
  // con y sin ellos.
  it("genera un PDF valido con un logo de empresa configurado (Buffer, no el archivo estatico)", async () => {
    const pdf = await generarPdfBoleta(DETALLE_BASE, { anio: 2026, mes: 2 }, { logo: PNG_1X1 });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("genera un PDF valido con la firma escaneada del trabajador (referencial)", async () => {
    const pdf = await generarPdfBoleta({ ...DETALLE_BASE, firma_archivo: PNG_1X1, firma_mime: "image/png" }, { anio: 2026, mes: 2 });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("genera un PDF valido con la firma del empleador y el nombre del representante legal", async () => {
    const pdf = await generarPdfBoleta(DETALLE_BASE, { anio: 2026, mes: 2 }, {
      firmaEmpleador: PNG_1X1,
      representanteLegal: "MONTALBAN SANCHEZ CARLOS",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("genera un PDF valido con el nombre del representante legal aunque NO se haya subido la firma del empleador", async () => {
    const pdf = await generarPdfBoleta(DETALLE_BASE, { anio: 2026, mes: 2 }, {
      representanteLegal: "MONTALBAN SANCHEZ CARLOS",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("no explota si firma_archivo llega con bytes invalidos (imagen corrupta) - se omite sin romper la boleta", async () => {
    const pdf = await generarPdfBoleta(
      { ...DETALLE_BASE, firma_archivo: Buffer.from("no es una imagen valida"), firma_mime: "image/png" },
      { anio: 2026, mes: 2 }
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
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

  // Bug real reportado por el usuario (con una boleta real adjunta): la
  // boleta salia en 2 hojas y, ademas, la firma del empleador aparecia como
  // SOLO TEXTO en esa segunda hoja, sin la imagen (PDFKit no reubica sola
  // una imagen en (x,y) absolutos cuando cae mas alla del margen, a
  // diferencia del texto que si pagina solo). NOTA (recon 8/46): la prueba
  // original armaba una boleta con MUCHOS conceptos (incluyendo campos como
  // remuneracion_dominical_proporcional/sobretasa_dominical/sobretasa_feriado/
  // condicion_trabajo que todavia no existen en este punto de la
  // reconstruccion - los agrega un parche posterior) para forzar que casi
  // se llene la hoja por si sola; aqui se usan valores altos de los campos
  // que SI existen para lograr el mismo efecto (llenar casi toda la hoja) y
  // se agrega el bloque de firmas encima, que es lo que realmente prueba
  // este caso.
  it("una boleta con muchos conceptos + firma del empleador + firma del trabajador + representante legal sigue cabiendo en 1 sola pagina", async () => {
    const detalleGrande: DetalleBoletaPdf = {
      ...DETALLE_BASE,
      apellidos_nombres: "ACOSTA MORALES CEVERIANO",
      proyecto: "P012-I.E.N. 030 Baldomero Franco-Tumbes-Tumbes-Tumbes",
      sistema_pension: "AFP",
      afp_nombre: "INTEGRA",
      cuspp: "551481CAMSA6",
      sueldo_basico: 882.28,
      remuneracion_dominical: 176.81,
      remuneracion_feriado: 89.3,
      importe_horas_extra: 142.88,
      asignacion_familiar: 10,
      asignacion_escolaridad: 73.52,
      bonificacion_buc: 282.33,
      bonificacion_bae: 10,
      bonificacion_movilidad: 86,
      subsidio_enfermedad: 10,
      licencia_paternidad: 10,
      otras_bonificaciones: 10,
      gratificacion: 330.05,
      bonificacion_extraordinaria: 29.7,
      cts: 132.39,
      vacaciones: 88.23,
      total_ingresos: 2313.49,
      descuento_sindicato: 5,
      conafovicer: 21.18,
      renta_5ta: 5,
      otros_descuentos: 5,
      total_descuentos: 235.89,
      essalud: 149.56,
      sctr: 5,
      seguro_vida: 5,
      senati: 6.44,
      neto_pagar: 2077.6,
      detalle_json: {
        aporte_pension_detalle: { aporteObligatorio: 166.18, comisionFlujo: 25.76, primaSeguro: 22.77 },
        total_aportes_empleador: 156.0,
      },
      firma_archivo: PNG_1X1,
      firma_mime: "image/png",
    };
    const pdf = await generarPdfBoleta(detalleGrande, { anio: 2026, mes: 8 }, {
      firmaEmpleador: PNG_1X1,
      representanteLegal: "MONTALBAN SANCHEZ CARLOS",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(contarPaginas(pdf)).toBe(1);
  });
});

describe("calcularAlturaBloqueFirmas (espacio reservado antes de dibujar las firmas)", () => {
  it("no reserva nada extra sin imagen ni representante legal (solo la etiqueta)", () => {
    expect(calcularAlturaBloqueFirmas(false, false)).toBe(11);
  });

  it("reserva mas espacio cuando hay imagen (30pt de la imagen + la nota 'solo referencial' debajo)", () => {
    expect(calcularAlturaBloqueFirmas(true, false)).toBe(30 + 11 + 9);
  });

  it("reserva mas espacio cuando hay nombre del representante legal", () => {
    expect(calcularAlturaBloqueFirmas(false, true)).toBe(11 + 10);
  });

  it("reserva el maximo cuando hay imagen Y representante legal", () => {
    expect(calcularAlturaBloqueFirmas(true, true)).toBe(30 + 11 + 9 + 10);
  });
});
