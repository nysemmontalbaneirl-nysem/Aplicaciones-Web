import { Router, Request, Response } from "express";
import ExcelJS from "exceljs";
import { asyncHandler } from "../asyncHandler";
import { pool } from "../db";
import { esConstruccionCivil } from "../motorCalculo";

export const reportesRouter = Router();

// Columnas del "resumen de planilla" (calcado del formato real en Excel de
// la empresa). Las marcadas "no calculado" se dejan en blanco a proposito:
// el sistema todavia no calcula ese concepto (ver detalle en la respuesta
// del chat que acompaña esta funcionalidad), en vez de inventar un numero.
const COLUMNAS = [
  "TD", "DNI", "APELLIDOS Y NOMBRES", "FECHA_NACIMIENTO", "FECHA INGRESO", "FECHA CESE",
  "PROYECTO", "CATEGORIA", "AFP/ONP", "SISTEMA COMISION", "CUSPP", "N° HIJOS",
  "SCTR SALUD", "BONIF", "Dcto.Adelanto", "ESSALUD VIDA", "POLIZA SEGURO", "",
  "SINDICATO", "CTS", "VIATICOS", "SUELDO", "Dia Manual", "Dominical", "Feriados",
  "Dias Vacaciones", "Días Subsidiados Por Essalud (Tipo 21/22)", "Razón: Días no laborados",
  "Subsidios Por Paternidad", "TOTAL", "Costo Hora Normal", "Jornal Basico",
  "Salario / Sueldo", "Dias Dominical", "Vacaciones", "Subsidios Por Maternidad",
  "Feriado", "Descanso Medico", "Importe H.E.25%", "Importe H.E.100%", "Importe H.E.60%",
  "0201 Asig. Fam", "0211 Escolaridad", "BUC OP=32% OF=30% PE=30%", "BAE EP=10% EM=8% TP=9%",
  "Bonific. Ext.Ley 29351", "Gratificaciones Julio - Diciembre", "Gratificaciones Ley 29351-30334",
  "CTS S/.", "Condición de Trabajo", "Movilidad", "Sumas O Bienes Que No Son De Libre Disposición",
  "Total Remun Bruta", "AFP", "ONP 13%", "Aport Obligat", "Comis Variable", "Comision Flujo",
  "Comision Saldo", "Prima Seguro", "Dscto AFP 1%", "AFPs", "Adelanto", "Cuota Sindical",
  "Conafov 2%", "Dscto Renta 5ta", "Total DesCto", "Neto", "ESSALUD 9%", "SCTR 1.55%",
  "Essalud + Vida", "POL.SEG", "FOND.CAPAC.", "Aportes",
] as const;

function fecha(v: unknown): string {
  if (!v) return "";
  return new Date(v as string).toISOString().slice(0, 10);
}

reportesRouter.get(
  "/:id/reporte",
  asyncHandler(async (req: Request, res: Response) => {
    const periodoResult = await pool.query("SELECT * FROM periodos_planilla WHERE id = $1", [req.params.id]);
    const periodo = periodoResult.rows[0];
    if (!periodo) return res.status(404).json({ error: "Periodo no encontrado" });

    const resultado = await pool.query(
      `SELECT d.*, e.apellidos_nombres, e.numero_documento, e.numero_hijos, e.fecha_nacimiento,
              c.proyecto, c.categoria_ocupacional, c.sistema_pension, c.afp_nombre, c.cuspp,
              c.fecha_ingreso, c.fecha_cese, c.sistema_comision, c.viaticos, c.sueldo_base,
              c.sindicalizado, c.poliza_seguro, c.sctr_salud
       FROM detalle_planilla d
       JOIN contratos c ON c.id = d.contrato_id
       JOIN empleados e ON e.id = c.empleado_id
       WHERE d.periodo_id = $1
       ORDER BY e.apellidos_nombres ASC`,
      [req.params.id]
    );

    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet(`Resumen ${periodo.mes}-${periodo.anio}`);
    hoja.addRow([...COLUMNAS]);
    hoja.getRow(1).font = { bold: true };
    hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS.length } };
    // Congela la columna DNI y Apellidos/Nombres (y la fila de encabezado)
    // al desplazarse horizontalmente por las 74 columnas.
    hoja.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];

    for (const d of resultado.rows) {
      const detalleJson = typeof d.detalle_json === "string" ? JSON.parse(d.detalle_json) : d.detalle_json ?? {};
      const aportePension = detalleJson.aporte_pension_detalle ?? {};
      const esAfp = d.sistema_pension === "AFP";
      const construccionCivil = esConstruccionCivil(d.categoria_ocupacional);

      // Recalcula el desglose de horas extra por tramo (el sistema solo
      // guarda el importe total combinado), usando la misma regla de
      // recargo que el motor de calculo: 60%/100% en construccion civil,
      // 25%/35% en el resto.
      const jornalHora = Number(d.jornal_diario) / 8;
      const [recargo1, recargo2] = construccionCivil ? [1.6, 2.0] : [1.25, 1.35];
      const importeTramo1 = jornalHora * recargo1 * Number(d.horas_extra_25);
      const importeTramo2y3 = jornalHora * recargo2 * Number(d.horas_extra_35) + jornalHora * 2.0 * Number(d.horas_extra_100);

      const fila: (string | number)[] = [
        "1",
        d.numero_documento,
        d.apellidos_nombres,
        fecha(d.fecha_nacimiento),
        fecha(d.fecha_ingreso),
        d.fecha_cese ? fecha(d.fecha_cese) : "CONTINUA",
        d.proyecto,
        d.categoria_ocupacional,
        esAfp ? d.afp_nombre : "ONP",
        d.sistema_comision ?? "",
        d.cuspp ?? "",
        d.numero_hijos,
        Number(d.sctr),
        "", // BONIF - no calculado
        "", // Dcto.Adelanto - no calculado
        "", // ESSALUD VIDA (codigo) - no identificado con certeza
        d.poliza_seguro ? 1 : 0,
        "",
        d.sindicalizado ? 1 : 0,
        "", // CTS (columna temprana, ambigua) - ver "CTS S/." mas adelante
        Number(d.viaticos ?? 0),
        d.sueldo_base != null ? Number(d.sueldo_base) : "",
        Number(d.dias_trabajados),
        Number(d.dias_dominical),
        Number(d.dias_feriado),
        "", // Dias Vacaciones - modulo de vacaciones no implementado
        "", "", "", // subsidios/dias no laborados - no calculado
        Number(d.dias_trabajados) + Number(d.dias_dominical) + Number(d.dias_feriado),
        Number(jornalHora.toFixed(4)),
        Number(d.jornal_diario),
        Number(d.sueldo_basico),
        "", // Dias Dominical (columna duplicada, ambigua)
        "", // Vacaciones (importe) - modulo no implementado
        "", // Subsidios Por Maternidad - no calculado
        Number(d.remuneracion_feriado),
        "", // Descanso Medico - no calculado
        construccionCivil ? "" : Number(importeTramo1.toFixed(2)),
        Number(importeTramo2y3.toFixed(2)),
        construccionCivil ? Number(importeTramo1.toFixed(2)) : "",
        Number(d.asignacion_familiar),
        "", // 0211 Escolaridad - no calculado
        Number(d.bonificacion_buc),
        "", // BAE - no calculado (TODO conocido en motorCalculo.ts)
        "", // Bonific. Ext. Ley 29351 - no identificado con certeza
        periodo.mes === 12 ? Number(d.gratificacion) : "",
        periodo.mes === 7 ? Number(d.gratificacion) : "",
        Number(d.cts),
        "", // Condicion de Trabajo - no calculado
        "", // Movilidad - no aplicado todavia (existe en tabla salarial pero no se paga)
        "", // Sumas O Bienes... - no calculado
        Number(d.total_ingresos),
        esAfp ? 2 : 1,
        !esAfp ? Number(aportePension.onp ?? 0) : "",
        esAfp ? Number(aportePension.aporteObligatorio ?? 0) : "",
        "", // Comis Variable - no distinguido
        esAfp && d.sistema_comision === "F" ? Number(aportePension.comisionFlujo ?? 0) : "",
        "", // Comision Saldo - no implementado (solo se calcula comision de flujo)
        esAfp ? Number(aportePension.primaSeguro ?? 0) : "",
        "", // Dscto AFP 1% - no calculado
        esAfp ? Number(d.aporte_pension) : "",
        "", // Adelanto - no calculado
        Number(d.descuento_sindicato),
        Number(d.conafovicer),
        Number(d.renta_5ta),
        Number(d.total_descuentos),
        Number(d.neto_pagar),
        Number(d.essalud),
        Number(d.sctr),
        "", // Essalud + Vida (aporte empleador) - en este sistema el seguro de vida es un descuento del trabajador, no un aporte del empleador; revisar con el usuario
        "", // POL.SEG - no calculado
        Number(d.senati),
        Number(detalleJson.total_aportes_empleador ?? 0),
      ];
      hoja.addRow(fila);
    }

    hoja.columns.forEach((col) => {
      col.width = 16;
    });
    hoja.getColumn(3).width = 32; // Apellidos y nombres
    hoja.getColumn(7).width = 22; // Proyecto

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="resumen_planilla_${periodo.mes}_${periodo.anio}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  })
);
