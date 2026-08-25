import { BoletaVacacionesRespuesta } from "../types";

interface Props {
  datos: BoletaVacacionesRespuesta;
  onCerrar: () => void;
}

function moneda(valor: number | undefined | null): string {
  return `S/ ${Number(valor ?? 0).toFixed(2)}`;
}

interface Linea {
  etiqueta: string;
  valor: number;
}

function filasSinCero(lineas: Linea[]): Linea[] {
  return lineas.filter((l) => l.valor !== 0);
}

export default function BoletaVacaciones({ datos, onCerrar }: Props) {
  const { boleta, contrato } = datos;
  const aporteDetalle = boleta.detalle_json?.aporte_pension_detalle;

  const descuentos = filasSinCero([
    ...(contrato.sistema_pension === "ONP"
      ? [{ etiqueta: "ONP (13%)", valor: aporteDetalle?.onp ?? boleta.aporte_pension }]
      : [
          { etiqueta: `AFP ${contrato.afp_nombre ?? ""} - Aporte obligatorio`, valor: aporteDetalle?.aporteObligatorio ?? 0 },
          { etiqueta: `AFP ${contrato.afp_nombre ?? ""} - Comisión`, valor: aporteDetalle?.comisionFlujo ?? 0 },
          { etiqueta: `AFP ${contrato.afp_nombre ?? ""} - Prima de seguro`, valor: aporteDetalle?.primaSeguro ?? 0 },
        ]),
  ]);

  const aportesEmpleador = filasSinCero([
    { etiqueta: "ESSALUD", valor: Number(boleta.essalud) },
    { etiqueta: "SCTR salud", valor: Number(boleta.sctr) },
  ]);

  return (
    <div className="card boleta-imprimible">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Boleta de vacaciones</h2>
          <div style={{ fontSize: "0.85rem", color: "#5a6172" }}>
            D.Leg. Nº 713 — Del {boleta.fecha_inicio.slice(0, 10)} al {boleta.fecha_fin.slice(0, 10)} (
            {boleta.dias} días)
          </div>
        </div>
        <div className="no-imprimir" style={{ display: "flex", gap: 8 }}>
          <button className="primario" type="button" onClick={() => window.print()}>
            Imprimir
          </button>
          <button type="button" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </div>

      <table style={{ marginTop: 16, marginBottom: 16 }}>
        <tbody>
          <tr>
            <td style={{ width: 140, color: "#5a6172" }}>Apellidos y nombres</td>
            <td>{contrato.apellidos_nombres}</td>
            <td style={{ width: 100, color: "#5a6172" }}>DNI</td>
            <td>{contrato.numero_documento}</td>
          </tr>
          <tr>
            <td style={{ color: "#5a6172" }}>Categoría</td>
            <td>{contrato.categoria_ocupacional}</td>
            <td style={{ color: "#5a6172" }}>Proyecto</td>
            <td>{contrato.proyecto}</td>
          </tr>
          <tr>
            <td style={{ color: "#5a6172" }}>Sistema pensión</td>
            <td>
              {contrato.sistema_pension === "AFP"
                ? `AFP ${contrato.afp_nombre ?? ""}${contrato.cuspp ? ` (${contrato.cuspp})` : ""}`
                : "ONP"}
            </td>
            <td style={{ color: "#5a6172" }}>N° hijos</td>
            <td>{contrato.numero_hijos}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <div>
          <h3 style={{ fontSize: "0.95rem", marginBottom: 6 }}>Ingresos</h3>
          <table>
            <tbody>
              <tr>
                <td>Remuneración vacacional</td>
                <td style={{ textAlign: "right" }}>{moneda(boleta.remuneracion_vacacional)}</td>
              </tr>
              <tr className="totales-fila">
                <td>Total ingresos</td>
                <td style={{ textAlign: "right" }}>{moneda(boleta.remuneracion_vacacional)}</td>
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
                <td style={{ textAlign: "right" }}>{moneda(boleta.aporte_pension)}</td>
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
                <td style={{ textAlign: "right" }}>{moneda(Number(boleta.essalud) + Number(boleta.sctr))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="no-imprimir" style={{ marginTop: 16, color: "#5a6172", fontSize: "0.85rem" }}>
        No incluye retención de renta de 5ta categoría: ya se proyecta sobre el sueldo mensual regular en la
        planilla del mes (estos días de vacaciones son el mismo sueldo pagado por adelantado, no un ingreso
        adicional).
      </p>

      <div
        style={{
          marginTop: 20,
          textAlign: "right",
          fontSize: "1.2rem",
          fontWeight: 700,
        }}
      >
        Neto a pagar: {moneda(boleta.neto_pagar)}
      </div>
    </div>
  );
}
