import PDFDocument from "pdfkit";
import archiver from "archiver";
import { esConstruccionCivil } from "./motorCalculo";
import { CategoriaOcupacional } from "./tipos";

// Genera el PDF de una boleta de pago para enviar por correo. El contenido
// replica la boleta que ya se ve/imprime en pantalla (frontend/Boleta.tsx),
// en una sola columna (mas simple y confiable de armar con pdfkit que
// intentar replicar las 3 columnas del navegador).

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

// Datos a nivel EMPRESA (no por trabajador) que la Boleta puede mostrar,
// pedido explicito del usuario: el logo, la firma escaneada del empleador
// y el nombre del representante legal (se imprime debajo de esa firma).
// Todos opcionales - si el llamador no los resuelve (o todavia no se
// configuraron en la pantalla Empresa), la boleta se genera igual, sin
// logo/firma/nombre de empleador. NOTA (recon 6/46): a diferencia del
// parche original, aqui NO hay un logo estatico de respaldo (RUTA_LOGO) -
// ver la nota de recon 5/46 sobre la "Ronda B, Parte 2" todavia no
// reconstruida.
export interface DatosEmpresaBoleta {
  logo?: Buffer | null;
  firmaEmpleador?: Buffer | null;
  representanteLegal?: string | null;
}

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
  // Solo si el trabajador ceso (contratos.fecha_cese) - se muestra en la
  // boleta cuando esta presente (pedido explicito del usuario, sept. 2026).
  fecha_cese: string | Date | null;
  dias_trabajados: number;
  dias_feriado: number;
  // Numero de horas extra por tramo (no el importe, ya cubierto por
  // importe_horas_extra) - se muestra igual que dias_trabajados (pedido
  // explicito del usuario). Ver camposHorasExtra() mas abajo.
  horas_extra_25: number;
  horas_extra_35: number;
  horas_extra_100: number;

  sueldo_basico: number;
  remuneracion_dominical: number;
  remuneracion_feriado: number;
  importe_horas_extra: number;
  asignacion_familiar: number;
  asignacion_escolaridad: number;
  bonificacion_buc: number;
  bonificacion_bae: number;
  bonificacion_movilidad: number;
  // Migracion 030: pago REAL de descanso medico por enfermedad/licencia por
  // paternidad, valorizado igual que un dia normal trabajado (jornal_diario
  // x dias). subsidio_enfermedad viene topado en el origen a 20 dias/año
  // por contrato (ver la validacion en PUT /:id/tareo-diario/:contratoId);
  // licencia_paternidad no tiene tope.
  subsidio_enfermedad: number;
  licencia_paternidad: number;
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

  // Firma escaneada del trabajador (migracion 031) - SOLO de referencia
  // visual, no reemplaza el espacio de firma fisica que se dibuja siempre
  // (confirmado con el usuario). pg devuelve BYTEA como Buffer nativo (no
  // como texto, a diferencia de las columnas NUMERIC) asi que no hace
  // falta ninguna conversion especial aqui. Ambos campos son opcionales
  // porque no todas las consultas que arman DetalleBoletaPdf los traen
  // (ver el JOIN agregado en routes/envios.ts y routes/planilla.ts).
  firma_archivo?: Buffer | null;
  firma_mime?: string | null;
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

// Numero de horas extra por tramo, mostrado igual que "Dias trabajados"
// (pedido explicito del usuario, sept. 2026) - mismo criterio que
// frontend/src/components/Boleta.tsx (camposHorasExtra): construccion civil
// fusiona horas_extra_35 y horas_extra_100 en una sola cifra "100%" (ambos
// tramos pagan el mismo recargo, ver calcularHorasExtra en motorCalculo.ts);
// regimen general muestra sus 3 tramos (25%/35%/100%) por separado.
export function camposHorasExtra(
  detalle: Pick<DetalleBoletaPdf, "categoria_ocupacional" | "horas_extra_25" | "horas_extra_35" | "horas_extra_100">
): Array<[string, string]> {
  const h25 = Number(detalle.horas_extra_25);
  const h35 = Number(detalle.horas_extra_35);
  const h100 = Number(detalle.horas_extra_100);
  if (esConstruccionCivil(detalle.categoria_ocupacional as CategoriaOcupacional)) {
    return [
      ["Horas extra 60%", String(h25)],
      ["Horas extra 100%", String(h35 + h100)],
    ];
  }
  return [
    ["Horas extra 25%", String(h25)],
    ["Horas extra 35%", String(h35)],
    ["Horas extra 100%", String(h100)],
  ];
}

// Dibuja una boleta completa sobre un PDFDocument ya existente, en la
// posicion actual del cursor (doc.y) - no crea el documento ni lo cierra
// (doc.end()), para poder usarse tanto para una sola boleta
// (generarPdfBoleta) como para varias en un mismo PDF combinado
// (generarPdfBoletas, ver mas abajo: llama doc.addPage() antes de cada
// boleta salvo la primera).
function dibujarBoleta(
  doc: InstanceType<typeof PDFDocument>,
  detalle: DetalleBoletaPdf,
  periodo: Periodo,
  datosEmpresa?: DatosEmpresaBoleta
): void {
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
    { etiqueta: "Subsidio incapacidad temporal (descanso medico)", valor: detalle.subsidio_enfermedad },
    { etiqueta: "Licencia por paternidad", valor: detalle.licencia_paternidad },
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

  // Logo de la empresa (migracion 031, configurable desde la pantalla
  // Empresa). NOTA (recon 5/46): el parche original modificaba un logo ya
  // dibujado en posicion absoluta y centrada junto con el titulo,
  // agregado por un parche anterior ("Ronda B, Parte 2") que todavia no
  // se ha reconstruido en este punto (no existe RUTA_LOGO/fs.existsSync
  // en este archivo) - se agrega aqui una version simplificada, sin el
  // fallback al logo estatico (no hay archivo estatico de respaldo
  // todavia) ni el centrado junto al titulo: solo dibuja el logo si el
  // llamador lo resolvio desde la base de datos (datosEmpresa.logo).
  // Revisar/unificar con el bloque completo cuando llegue esa "Ronda B,
  // Parte 2".
  if (datosEmpresa?.logo) {
    const anchoLogo = 45;
    const yLogo = doc.y;
    try {
      doc.image(datosEmpresa.logo, xEtiqueta, yLogo, { width: anchoLogo });
      doc.y = yLogo + anchoLogo + 6;
    } catch {
      // Logo corrupto o formato no soportado - no debe romper la boleta.
      doc.y = yLogo;
    }
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
  // Fecha de cese (solo si aplica) + horas extra por tramo (pedido explicito
  // del usuario, sept. 2026): se agregan de a pares en las 2 columnas ya
  // existentes, igual criterio que frontend/src/components/Boleta.tsx
  // (agruparDeADos) - la ultima fila queda con la celda derecha vacia si la
  // cantidad de campos extra es impar. NOTA: el parche original usaba una
  // funcion "fechaCorta" (formato DD/MM/AAAA) que no existe todavia en este
  // punto de la reconstruccion - se usa fechaTexto() (formato AAAA-MM-DD,
  // ya existente en este archivo) hasta que un parche posterior la agregue.
  const camposAdicionales: Array<[string, string]> = [
    ...(detalle.fecha_cese ? ([["Fecha de cese", fechaTexto(detalle.fecha_cese)]] as Array<[string, string]>) : []),
    ...camposHorasExtra(detalle),
  ];
  for (let i = 0; i < camposAdicionales.length; i += 2) {
    infoIzquierda.push(camposAdicionales[i]);
    infoDerecha.push(camposAdicionales[i + 1] ?? ["", ""]);
  }
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

  dibujarFirmas(doc, detalle, datosEmpresa, xEtiqueta, anchoUtil);
}

// Un bloque de firma individual (empleador o trabajador): dibuja la imagen
// de referencia (si hay) encima de la linea, la linea en blanco SIEMPRE
// (nunca se omite - es el espacio de firma fisica) y una etiqueta debajo.
// "textoAdicional" (solo el bloque del empleador lo usa) imprime el nombre
// del representante legal debajo de la etiqueta, pedido explicito del
// usuario para que quede identificado quien firma por la empresa.
function dibujarBloqueFirma(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  yLinea: number,
  ancho: number,
  imagen: Buffer | null | undefined,
  etiqueta: string,
  notaReferencial: string,
  textoAdicional?: string | null
): void {
  if (imagen) {
    const altoImagenFirma = 28;
    try {
      doc.image(imagen, x + (ancho - 70) / 2, yLinea - altoImagenFirma - 2, { width: 70, height: altoImagenFirma });
    } catch {
      // Imagen corrupta o formato no soportado - no debe romper la
      // generacion de la boleta, simplemente se omite (el espacio de
      // firma fisica igual se dibuja debajo).
    }
  }

  doc.moveTo(x, yLinea).lineTo(x + ancho, yLinea).strokeColor("#000000").stroke();
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#5a6172")
    .text(etiqueta, x, yLinea + 2, { width: ancho, align: "center" });
  let y = yLinea + 11;
  if (imagen) {
    doc.text(notaReferencial, x, y, { width: ancho, align: "center" });
    y += 9;
  }
  if (textoAdicional && textoAdicional.trim()) {
    doc
      .font("Helvetica-Bold")
      .fillColor("#000000")
      .text(textoAdicional, x, y, { width: ancho, align: "center" });
  }
  doc.fillColor("#000000");
}

// Espacio de firma al pie de la boleta (migracion 031): 2 bloques lado a
// lado - empleador (izquierda) y trabajador (derecha). El espacio para la
// firma FISICA se dibuja SIEMPRE en ambos (una linea en blanco) - las
// firmas escaneadas (empresa en datos_empresa, trabajador en empleados)
// son puramente una referencia visual de apoyo (confirmado explicitamente
// con el usuario: no reemplazan la firma fisica ni el mecanismo de entrega
// ya existente por correo), asi que se dibujan pequeñas, encima de esa
// misma linea, solo si estan disponibles - nunca en su lugar. El nombre del
// representante legal (si esta configurado en la pantalla Empresa) se
// imprime debajo de la etiqueta del empleador, se haya subido su firma o no.
function dibujarFirmas(
  doc: InstanceType<typeof PDFDocument>,
  detalle: DetalleBoletaPdf,
  datosEmpresa: DatosEmpresaBoleta | undefined,
  xEtiqueta: number,
  anchoUtil: number
): void {
  const anchoFirma = 160;
  const xEmpleador = xEtiqueta;
  const xTrabajador = xEtiqueta + anchoUtil - anchoFirma;
  doc.moveDown(2.2);
  const yLinea = doc.y;

  dibujarBloqueFirma(
    doc,
    xEmpleador,
    yLinea,
    anchoFirma,
    datosEmpresa?.firmaEmpleador,
    "Firma y sello del empleador",
    "(firma registrada - solo referencial)",
    datosEmpresa?.representanteLegal
  );
  dibujarBloqueFirma(
    doc,
    xTrabajador,
    yLinea,
    anchoFirma,
    detalle.firma_archivo,
    "Firma del trabajador",
    "(firma registrada - solo referencial)"
  );
}

// Genera el PDF de UNA sola boleta (usado para el envio por correo,
// routes/envios.ts). datosEmpresa (migracion 031) es opcional - el llamador
// lo resuelve una sola vez con obtenerDatosEmpresaBoleta() (routes/empresa.ts)
// y lo pasa aqui; si se omite, dibujarBoleta cae al logo estatico de
// siempre y no dibuja firma/nombre del empleador.
export async function generarPdfBoleta(detalle: DetalleBoletaPdf, periodo: Periodo, datosEmpresa?: DatosEmpresaBoleta): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 45, size: "A4" });
  const trozos: Buffer[] = [];
  doc.on("data", (trozo: Buffer) => trozos.push(trozo));
  const listo = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(trozos))));
  dibujarBoleta(doc, detalle, periodo, datosEmpresa);
  doc.end();
  return listo;
}

// Genera UN SOLO PDF con varias boletas, una por pagina (pedido explicito
// del usuario, sept. 2026: exportar/descargar en PDF las boletas
// seleccionadas o de un periodo completo, en vez de imprimirlas una por
// una desde el navegador). Usa el mismo PDFDocument para todas - pdfkit ya
// soporta documentos de varias paginas de forma nativa, asi que solo hace
// falta doc.addPage() antes de cada boleta salvo la primera (el
// constructor ya crea la primera pagina).
export async function generarPdfBoletas(filas: DetalleBoletaPdf[], periodo: Periodo, datosEmpresa?: DatosEmpresaBoleta): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 45, size: "A4" });
  const trozos: Buffer[] = [];
  doc.on("data", (trozo: Buffer) => trozos.push(trozo));
  const listo = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(trozos))));
  filas.forEach((fila, indice) => {
    if (indice > 0) doc.addPage();
    dibujarBoleta(doc, fila, periodo, datosEmpresa);
  });
  doc.end();
  return listo;
}

// Genera un archivo ZIP con UN PDF POR TRABAJADOR (pedido explicito del
// usuario, sept. 2026: "guardar las boletas de un periodo determinado en
// PDF en un archivo comprimido tipo ZIP") - mismo nombre de archivo que ya
// se usaba al enviar boletas por correo (routes/envios.ts), para que el
// usuario reconozca el mismo criterio en ambos lugares. Se arma el ZIP
// completo en memoria (junta todos los bytes antes de resolver la
// promesa) en vez de transmitirlo en streaming directo a la respuesta
// HTTP: mismo criterio de "generar el buffer completo y luego res.send()"
// que ya usan el resto de descargas de este archivo/proyecto (Excel, PDF
// resumen), asi un error a mitad de camino (ej. una boleta que falla)
// nunca deja una respuesta HTTP a medio enviar con headers ya fijados.
export async function generarZipBoletas(filas: DetalleBoletaPdf[], periodo: Periodo, datosEmpresa?: DatosEmpresaBoleta): Promise<Buffer> {
  const archivo = archiver("zip", { zlib: { level: 9 } });
  const trozos: Buffer[] = [];
  archivo.on("data", (trozo: Buffer) => trozos.push(trozo));
  const listo = new Promise<Buffer>((resolve, reject) => {
    archivo.on("end", () => resolve(Buffer.concat(trozos)));
    archivo.on("error", (err) => reject(err));
  });
  for (const fila of filas) {
    const pdf = await generarPdfBoleta(fila, periodo, datosEmpresa);
    const nombreArchivo = `Boleta_${MESES[periodo.mes - 1]}_${periodo.anio}_${fila.numero_documento}.pdf`;
    archivo.append(pdf, { name: nombreArchivo });
  }
  await archivo.finalize();
  return listo;
}
