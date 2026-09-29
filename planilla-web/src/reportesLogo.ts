import ExcelJS from "exceljs";

// Logo de la empresa (migracion 031) embebido en los reportes Excel -
// resumen de planilla (routes/reportes.ts) y asiento contable
// (routes/exportaciones.ts), pedido explicito del usuario. Se coloca como
// una imagen flotante en la esquina superior izquierda de la hoja, sin
// desplazar filas/columnas existentes (encabezados, autoFilter, vistas
// congeladas) - asi este cambio no arriesga romper nada de lo que ya
// generan esos 2 reportes.
//
// ExcelJS.addImage solo soporta jpeg/png/gif - si el logo se subio en WEBP
// (formato valido para la Boleta, que usa pdfkit) simplemente se omite en
// el Excel en vez de fallar la generacion del reporte.
function extensionExcelDeMime(mime: string | null | undefined): "jpeg" | "png" | null {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpeg";
  if (mime === "image/png") return "png";
  return null;
}

export function insertarLogoEnHoja(
  workbook: ExcelJS.Workbook,
  hoja: ExcelJS.Worksheet,
  logo: { buffer: Buffer; mime: string } | null
): void {
  if (!logo) return;
  const extension = extensionExcelDeMime(logo.mime);
  if (!extension) return;
  try {
    const imageId = workbook.addImage({ buffer: logo.buffer as unknown as ExcelJS.Buffer, extension });
    hoja.addImage(imageId, { tl: { col: 0.15, row: 0.1 }, ext: { width: 70, height: 32 } });
  } catch {
    // Logo corrupto o formato no soportado - no debe romper la generacion
    // del reporte, simplemente se omite.
  }
}
