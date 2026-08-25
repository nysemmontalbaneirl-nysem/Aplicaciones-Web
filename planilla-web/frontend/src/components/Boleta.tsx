import { DetallePlanilla, PeriodoPlanilla } from "../types";

interface Props {
  detalle: DetallePlanilla;
  periodo: PeriodoPlanilla;
  onCerrar: () => void;
  // Oculta los botones Imprimir/Cerrar propios de esta boleta, para cuando
  // se muestra dentro de un lote con sus propios controles compartidos.
  ocultarControles?: boolean;
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

function moneda(valor: number | undefined): string {
  return `S/ ${Number(valor ?? 0).toFixed(2)}`;
}

interface Linea {
  etiqueta: string;
  valor: number;
}

function filasSinCero(lineas: Linea[]): Linea[] {
  return lineas.filter((l) => l.valor !== 0);
}

export default function Boleta({ detalle, periodo, onCerrar, ocultarControles }: Props) {
  const aporteDetalle = detalle.detalle_json?.aporte_pension_detalle;

  const ingresos = filasSinCero([
    { etiqueta: "Sueldo / Jornal básico", valor: detalle.sueldo_basico },
    { etiqueta: "Remuneración dominical", valor: detalle.remuneracion_dominical },
    { etiqueta: "Remuneración feriado", valor: detalle.remuneracion_feriado },
    { etiqueta: "Horas extra", valor: detalle.importe_horas_extra },
    { etiqueta: "Asignación familiar", valor: detalle.asignacion_familiar },
    { etiqueta: "Asignación por escolaridad", valor: detalle.asignacion_escolaridad },
    { etiqueta: "Bonificación Unificada Construcción (BUC)", valor: detalle.bonificacion_buc },
    { etiqueta: "Bonificación por Alta Especialización (BAE)", valor: detalle.bonificacion_bae },
    { etiqueta: "Bonificación por movilidad", valor: detalle.bonificacion_movilidad },
    { etiqueta: "Otras bonificaciones", valor: detalle.otras_bonificaciones },
    { etiqueta: "Gratificación", valor: detalle.gratificacion },
    { etiqueta: "Bonificación Extraordinaria Ley 29351", valor: detalle.bonificacion_extraordinaria },
    { etiqueta: "CTS", valor: detalle.cts },
    { etiqueta: "Vacaciones", valor: detalle.vacaciones },
  ]);

  const descuentos = filasSinCero([
    ...(detalle.sistema_pension === "ONP"
      ? [{ etiqueta: "ONP (13%)", valor: aporteDetalle?.onp ?? detalle.aporte_pension }]
      : [
          { etiqueta: `AFP ${detalle.afp_nombre ?? ""} - Aporte obligatorio`, valor: aporteDetalle?.aporteObligatorio ?? 0 },
          { etiqueta: `AFP ${detalle.afp_nombre ?? ""} - Comisión`, valor: aporteDetalle?.comisionFlujo ?? 0 },
          { etiqueta: `AFP ${detalle.afp_nombre ?? ""} - Prima de seguro`, valor: aporteDetalle?.primaSeguro ?? 0 },
        ]),
    { etiqueta: "Cuota sindical", valor: detalle.descuento_sindicato },
    { etiqueta: "CONAFOVICER", valor: detalle.conafovicer },
    { etiqueta: "Renta de 5ta categoría", valor: detalle.renta_5ta },
    { etiqueta: "Otros descuentos", valor: detalle.otros_descuentos },
  ]);

  const aportesEmpleador = filasSinCero([
    { etiqueta: "ESSALUD", valor: detalle.essalud },
    { etiqueta: "SCTR salud", valor: detalle.sctr },
    // Poliza de vida (D.Leg 688 / convenio EsSalud+Vida): aporte integro del
    // empleador, nunca un descuento al trabajador. Etiqueta "Essalud + Vida"
    // verificada contra boletas reales (linea poblada; "Poliza Vida Ley"
    // sale en blanco en las 5 boletas revisadas).
    { etiqueta: "Essalud + Vida", valor: detalle.seguro_vida },
    { etiqueta: "Fondo de Capacitación", valor: detalle.senati },
  ]);

  return (
    <div className="card boleta-imprimible">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Boleta de pago</h2>
          <div style={{ fontSize: "0.85rem", color: "#5a6172" }}>
            D.S. Nº 003-97-TR — {MESES[periodo.mes - 1]} {periodo.anio}
          </div>
        </div>
        {!ocultarControles && (
          <div className="no-imprimir" style={{ display: "flex", gap: 8 }}>
            <button className="primario" type="button" onClick={() => window.print()}>
              Imprimir
            </button>
            <button type="button" onClick={onCerrar}>
              Cerrar
            </button>
          </div>
        )}
      </div>

      <table style={{ marginTop: 16, marginBottom: 16 }}>
        <tbody>
          <tr>
            <td style={{ width: 140, color: "#5a6172" }}>Apellidos y nombres</td>
            <td>{detalle.apellidos_nombres}</td>
            <td style={{ width: 100, color: "#5a6172" }}>DNI</td>
            <td>{detalle.numero_documento}</td>
          </tr>
          <tr>
            <td style={{ color: "#5a6172" }}>Categoría</td>
            <td>{detalle.categoria_ocupacional}</td>
            <td style={{ color: "#5a6172" }}>Proyecto</td>
            <td>{detalle.proyecto}</td>
          </tr>
          <tr>
            <td style={{ color: "#5a6172" }}>Fecha ingreso</td>
            <td>{detalle.fecha_ingreso?.slice(0, 10)}</td>
            <td style={{ color: "#5a6172" }}>Sistema pensión</td>
            <td>
              {detalle.sistema_pension === "AFP"
                ? `AFP ${detalle.afp_nombre ?? ""}${detalle.cuspp ? ` (${detalle.cuspp})` : ""}`
                : "ONP"}
            </td>
          </tr>
          <tr>
            <td style={{ color: "#5a6172" }}>N° hijos</td>
            <td>{detalle.numero_hijos}</td>
            <td style={{ color: "#5a6172" }}>Días trabajados</td>
            <td>{detalle.dias_trabajados}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <div>
          <h3 style={{ fontSize: "0.95rem", marginBottom: 6 }}>Ingresos</h3>
          <table>
            <tbody>
              {ingresos.map((l) => (
                <tr key={l.etiqueta}>
                  <td>{l.etiqueta}</td>
                  <td style={{ textAlign: "right" }}>{moneda(l.valor)}</td>
                </tr>
              ))}
              <tr className="totales-fila">
                <td>Total ingresos</td>
                <td style={{ textAlign: "right" }}>{moneda(detalle.total_ingresos)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <h3 style={{ fontSize: "0.95rem", marginBottom: 6 }}>Descuentos</h3>
          <table>
            <tbody>
              {descuentos.map((l) => (
                <tr key={l.etiqueta}>
                  <td>{l.etiqueta}</td>
                  <td style={{ textAlign: "right" }}>{moneda(l.valor)}</td>
                </tr>
              ))}
              <tr className="totales-fila">
                <td>Total descuentos</td>
                <td style={{ textAlign: "right" }}>{moneda(detalle.total_descuentos)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <h3 style={{ fontSize: "0.95rem", marginBottom: 6 }}>Aportes del empleador</h3>
          <table>
            <tbody>
              {aportesEmpleador.map((l) => (
                <tr key={l.etiqueta}>
                  <td>{l.etiqueta}</td>
                  <td style={{ textAlign: "right" }}>{moneda(l.valor)}</td>
                </tr>
              ))}
              <tr className="totales-fila">
                <td>Total aportes</td>
                <td style={{ textAlign: "right" }}>
                  {moneda(detalle.detalle_json?.total_aportes_empleador)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div
        style={{
          marginTop: 20,
          textAlign: "right",
          fontSize: "1.2rem",
          fontWeight: 700,
        }}
      >
        Neto a pagar: {moneda(detalle.neto_pagar)}
      </div>
    </div>
  );
}
