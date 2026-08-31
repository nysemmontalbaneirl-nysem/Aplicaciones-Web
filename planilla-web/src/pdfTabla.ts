import PDFDocument from "pdfkit";

// Generador generico de PDF tabular (listados/reportes de consulta): una
// cabecera con titulo/subtitulo, una fila de encabezados de columna en
// negrita que se repite en cada pagina nueva, y las filas de datos. Pensado
// para reutilizarse en Trabajadores, Boletas y Bitacora en vez de repetir
// el manejo de paginacion de pdfkit en cada ruta.

export interface ColumnaPdfTabla {
  titulo: string;
  ancho: number; // en puntos
  align?: "left" | "right" | "center";
}

export interface OpcionesPdfTabla {
  titulo: string;
  subtitulo?: string;
  columnas: ColumnaPdfTabla[];
  filas: (string | number)[][];
  filaTotales?: (string | number)[];
  orientacion?: "portrait" | "landscape";
}

const ALTO_MINIMO_FILA = 16;
const ALTO_MINIMO_ENCABEZADO = 14;
const ESPACIO_ENTRE_FILAS = 3;

export async function generarPdfTabla(opciones: OpcionesPdfTabla): Promise<Buffer> {
  const { titulo, subtitulo, columnas, filas, filaTotales, orientacion = "landscape" } = opciones;

  const doc = new PDFDocument({ margin: 36, size: "A4", layout: orientacion });
  const trozos: Buffer[] = [];
  doc.on("data", (trozo: Buffer) => trozos.push(trozo));
  const listo = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(trozos))));

  const xInicio = doc.page.margins.left;
  const yLimite = doc.page.height - doc.page.margins.bottom;

  function xColumna(indice: number): number {
    let x = xInicio;
    for (let i = 0; i < indice; i++) x += columnas[i].ancho;
    return x;
  }

  function dibujarEncabezadoPagina() {
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#000000").text(titulo, xInicio, doc.y);
    if (subtitulo) {
      doc.moveDown(0.15);
      doc.font("Helvetica").fontSize(9).fillColor("#5a6172").text(subtitulo, xInicio);
      doc.fillColor("#000000");
    }
    doc.moveDown(0.6);
    dibujarFilaEncabezadoColumnas();
  }

  // Calcula la altura real que va a ocupar una fila segun el ancho de cada
  // columna, porque pdfkit envuelve automaticamente el texto que no cabe
  // (ej. un nombre largo) a varias lineas. Sin esto, se avanzaba siempre
  // una altura fija y una fila con texto envuelto quedaba montada sobre la
  // siguiente ("amontonada").
  function alturaFila(valores: (string | number)[], negrita: boolean, minimo: number): number {
    doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
    let alto = minimo;
    columnas.forEach((col, i) => {
      const texto = String(valores[i] ?? "");
      const h = doc.heightOfString(texto, { width: col.ancho - 4 });
      if (h > alto) alto = h;
    });
    return alto;
  }

  function dibujarFilaEncabezadoColumnas() {
    const y = doc.y;
    const titulos = columnas.map((c) => c.titulo);
    const alto = alturaFila(titulos, true, ALTO_MINIMO_ENCABEZADO);
    doc.font("Helvetica-Bold").fontSize(8.5);
    columnas.forEach((col, i) => {
      doc.text(col.titulo, xColumna(i), y, { width: col.ancho - 4, align: col.align ?? "left" });
    });
    doc.y = y + alto + 4;
    doc.moveTo(xInicio, doc.y).lineTo(xColumna(columnas.length), doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.2);
  }

  function dibujarFila(valores: (string | number)[], negrita = false) {
    const alto = alturaFila(valores, negrita, ALTO_MINIMO_FILA);
    if (doc.y + alto > yLimite) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      dibujarFilaEncabezadoColumnas();
    }
    const y = doc.y;
    doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
    columnas.forEach((col, i) => {
      const valor = valores[i] ?? "";
      doc.text(String(valor), xColumna(i), y, { width: col.ancho - 4, align: col.align ?? "left" });
    });
    doc.y = y + alto + ESPACIO_ENTRE_FILAS;
  }

  dibujarEncabezadoPagina();
  for (const fila of filas) dibujarFila(fila);
  if (filaTotales) {
    doc.moveTo(xInicio, doc.y).lineTo(xColumna(columnas.length), doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.2);
    dibujarFila(filaTotales, true);
  }
  if (filas.length === 0) {
    doc.font("Helvetica").fontSize(9).fillColor("#5a6172").text("Sin registros para estos filtros.", xInicio, doc.y);
  }

  doc.end();
  return listo;
}
