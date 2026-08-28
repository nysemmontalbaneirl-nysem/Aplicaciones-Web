import PDFDocument from "pdfkit";

// Genera el PDF de una boleta de pago para enviar por correo. El contenido
// replica la boleta que ya se ve/imprime en pantalla (frontend/Boleta.tsx),
// en una sola columna (mas simple y confiable de armar con pdfkit que
// intentar replicar las 3 columnas del navegador).

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

interface DetalleAportePension {
  onp?: number;
  aporteObligatorio?: number;
  comisionFlujo?: number;
  primaSeguro?: number;
}

export interface DetalleBoletaPdf {
  apellidos_nombres: string;
  numero_documento: string;
  numero_hijos: number;
  proyecto: string;
  categoria_ocupacional: string;
  sistema_pension: "AFP" | "ONP";
  afp_nombre: string | null;
  cuspp: string | null;
  // pg devuelve las columnas DATE como objetos Date (no como texto) cuando
  // se consultan directo desde el backend - a diferencia del frontend, que
  // recibe el JSON ya con fechas convertidas a texto por Express.
  fecha_ingreso: string | Date;
  dias_trabajados: number;

  sueldo_basico: number;
  remuneracion_dominical: number;
  remuneracion_feriado: number;
  importe_horas_extra: number;
  asignacion_familiar: number;
  asignacion_escolaridad: number;
  bonificacion_buc: number;
  bonificacion_bae: number;
  bonificacion_movilidad: number;
  otras_bonificaciones: number;
  gratificacion: number;
  bonificacion_extraordinaria: number;
  cts: number;
  vacaciones: number;
  total_ingresos: number;

  aporte_pension: number;
  descuento_sindicato: number;
  conafovicer: number;
  renta_5ta: number;
  otros_descuentos: number;
  total_descuentos: number;

  essalud: number;
  sctr: number;
  seguro_vida: number;
  senati: number;

  neto_pagar: number;
  detalle_json: { aporte_pension_detalle?: DetalleAportePension; total_aportes_empleador?: number };
}

interface Periodo {
  anio: number;
  mes: number;
}

interface Linea {
  etiqueta: string;
  valor: number;
}

function moneda(valor: number | undefined | null): string {
  return `S/ ${Number(valor ?? 0).toFixed(2)}`;
}

function sinCero(lineas: Linea[]): Linea[] {
  return lineas.filter((l) => l.valor !== 0);
}

function fechaTexto(valor: string | Date | null | undefined): string {
  if (!valor) return "";
  const iso = valor instanceof Date ? valor.toISOString() : valor;
  return iso.slice(0, 10);
}

export async function generarPdfBoleta(detalle: DetalleBoletaPdf, periodo: Periodo): Promise<Buffer> {
  const aporte = detalle.detalle_json?.aporte_pension_detalle ?? {};

  const ingresos = sinCero([
    { etiqueta: "Sueldo / Jornal basico", valor: detalle.sueldo_basico },
    { etiqueta: "Remuneracion dominical", valor: detalle.remuneracion_dominical },
    { etiqueta: "Remuneracion feriado", valor: detalle.remuneracion_feriado },
    { etiqueta: "Horas extra", valor: detalle.importe_horas_extra },
    { etiqueta: "Asignacion familiar", valor: detalle.asignacion_familiar },
    { etiqueta: "Asignacion por escolaridad", valor: detalle.asignacion_escolaridad },
    { etiqueta: "Bonificacion Unificada Construccion (BUC)", valor: detalle.bonificacion_buc },
    { etiqueta: "Bonificacion por Alta Especializacion (BAE)", valor: detalle.bonificacion_bae },
    { etiqueta: "Bonificacion por movilidad", valor: detalle.bonificacion_movilidad },
    { etiqueta: "Otras bonificaciones", valor: detalle.otras_bonificaciones },
    { etiqueta: "Gratificacion", valor: detalle.gratificacion },
    { etiqueta: "Bonificacion Extraordinaria Ley 29351", valor: detalle.bonificacion_extraordinaria },
    { etiqueta: "CTS", valor: detalle.cts },
    { etiqueta: "Vacaciones", valor: detalle.vacaciones },
  ]);

  const descuentos = sinCero([
    ...(detalle.sistema_pension === "ONP"
      ? [{ etiqueta: "ONP (13%)", valor: aporte.onp ?? detalle.aporte_pension }]
      : [
          { etiqueta: `AFP ${detalle.afp_nombre ?? ""} - Aporte obligatorio`, valor: aporte.aporteObligatorio ?? 0 },
          { etiqueta: `AFP ${detalle.afp_nombre ?? ""} - Comision`, valor: aporte.comisionFlujo ?? 0 },
          { etiqueta: `AFP ${detalle.afp_nombre ?? ""} - Prima de seguro`, valor: aporte.primaSeguro ?? 0 },
        ]),
    { etiqueta: "Cuota sindical", valor: detalle.descuento_sindicato },
    { etiqueta: "CONAFOVICER", valor: detalle.conafovicer },
    { etiqueta: "Renta de 5ta categoria", valor: detalle.renta_5ta },
    { etiqueta: "Otros descuentos", valor: detalle.otros_descuentos },
  ]);

  const aportesEmpleador = sinCero([
    { etiqueta: "ESSALUD", valor: detalle.essalud },
    { etiqueta: "SCTR salud", valor: detalle.sctr },
    { etiqueta: "Essalud + Vida", valor: detalle.seguro_vida },
    { etiqueta: "Fondo de Capacitacion", valor: detalle.senati },
  ]);

  const doc = new PDFDocument({ margin: 45, size: "A4" });
  const trozos: Buffer[] = [];
  doc.on("data", (trozo: Buffer) => trozos.push(trozo));
  const listo = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(trozos))));

  const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const xEtiqueta = doc.page.margins.left;
  const anchoMonto = 100;
  const xMonto = doc.page.margins.left + anchoUtil - anchoMonto;

  function fila(etiqueta: string, valor: number, negrita = false) {
    doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(9.5);
    const y = doc.y;
    doc.text(etiqueta, xEtiqueta, y, { width: xMonto - xEtiqueta - 10 });
    doc.text(moneda(valor), xMonto, y, { width: anchoMonto, align: "right" });
    doc.moveDown(0.3);
  }

  function seccion(titulo: string, lineas: Linea[], total: { etiqueta: string; valor: number }) {
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(11).text(titulo, xEtiqueta);
    doc.moveDown(0.2);
    for (const l of lineas) fila(l.etiqueta, l.valor);
    doc.moveTo(xEtiqueta, doc.y).lineTo(xEtiqueta + anchoUtil, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.2);
    fila(total.etiqueta, total.valor, true);
  }

  doc.font("Helvetica-Bold").fontSize(16).text("Boleta de pago", xEtiqueta);
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#5a6172")
    .text(`D.S. N. 003-97-TR - ${MESES[periodo.mes - 1]} ${periodo.anio}`, xEtiqueta);
  doc.fillColor("#000000");
  doc.moveDown(0.8);

  doc.font("Helvetica").fontSize(10);
  const infoIzquierda = [
    ["Apellidos y nombres", detalle.apellidos_nombres],
    ["Categoria", detalle.categoria_ocupacional],
    ["Fecha de ingreso", fechaTexto(detalle.fecha_ingreso)],
    ["N. de hijos", String(detalle.numero_hijos)],
  ];
  const infoDerecha = [
    ["DNI", detalle.numero_documento],
    ["Proyecto", detalle.proyecto],
    [
      "Sistema de pension",
      detalle.sistema_pension === "AFP"
        ? `AFP ${detalle.afp_nombre ?? ""}${detalle.cuspp ? ` (${detalle.cuspp})` : ""}`
        : "ONP",
    ],
    ["Dias trabajados", String(detalle.dias_trabajados)],
  ];
  const yInicioInfo = doc.y;
  const anchoColInfo = anchoUtil / 2;
  for (let i = 0; i < infoIzquierda.length; i++) {
    const y = yInicioInfo + i * 15;
    doc.font("Helvetica").fillColor("#5a6172").text(infoIzquierda[i][0], xEtiqueta, y, { continued: false });
    doc.fillColor("#000000").text(infoIzquierda[i][1], xEtiqueta + 110, y, { width: anchoColInfo - 120 });
    doc.fillColor("#5a6172").text(infoDerecha[i][0], xEtiqueta + anchoColInfo, y);
    doc.fillColor("#000000").text(infoDerecha[i][1], xEtiqueta + anchoColInfo + 110, y, { width: anchoColInfo - 120 });
  }
  doc.y = yInicioInfo + infoIzquierda.length * 15 + 6;

  seccion("Ingresos", ingresos, { etiqueta: "Total ingresos", valor: detalle.total_ingresos });
  seccion("Descuentos", descuentos, { etiqueta: "Total descuentos", valor: detalle.total_descuentos });
  seccion("Aportes del empleador", aportesEmpleador, {
    etiqueta: "Total aportes",
    valor: detalle.detalle_json?.total_aportes_empleador ?? 0,
  });

  doc.moveDown(0.8);
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(`Neto a pagar: ${moneda(detalle.neto_pagar)}`, xEtiqueta, doc.y, { width: anchoUtil, align: "right" });

  doc.end();
  return listo;
}
