import { useEffect, useState } from "react";
import { apiGet } from "../api";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const ETIQUETAS_ESTADO: Record<string, string> = {
  ABIERTO: "Abierto (sin calcular)",
  CALCULADO: "Calculado",
  CERRADO: "Cerrado",
  DECLARADO: "Declarado",
};

interface PeriodoActual {
  id: number;
  anio: number;
  mes: number;
  quincena: number | null;
  tipo: string;
  estado: string;
  trabajadores_con_tareo: number;
  costo_total_ingresos: number | null;
}

interface Alerta {
  tipo: string;
  mensaje: string;
}

interface Resumen {
  trabajadores_activos: number;
  proyectos_activos: number;
  periodo_actual: PeriodoActual | null;
  alertas: Alerta[];
}

function Tile({ etiqueta, valor }: { etiqueta: string; valor: string | number }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e3e5ea",
        borderRadius: 8,
        padding: "18px 20px",
        minWidth: 180,
        flex: "1 1 180px",
      }}
    >
      <div style={{ fontSize: "0.82rem", color: "#5a6172", marginBottom: 6 }}>{etiqueta}</div>
      <div style={{ fontSize: "1.7rem", fontWeight: 700 }}>{valor}</div>
    </div>
  );
}

export default function Dashboard({ nombreUsuario }: { nombreUsuario: string }) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Resumen>("/dashboard/resumen")
      .then(setResumen)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!resumen) return <p>Cargando...</p>;

  const p = resumen.periodo_actual;
  const nombrePeriodo = p ? `${MESES[p.mes - 1]} ${p.anio}${p.quincena ? ` - Q${p.quincena}` : ""}` : null;

  return (
    <div>
      <div className="card">
        <h2>Hola, {nombreUsuario}</h2>
        <p style={{ color: "#5a6172" }}>Resumen general del sistema.</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
          <Tile etiqueta="Trabajadores activos" valor={resumen.trabajadores_activos} />
          <Tile etiqueta="Proyectos activos" valor={resumen.proyectos_activos} />
          {p && <Tile etiqueta="Periodo actual" valor={nombrePeriodo ?? ""} />}
          {p && <Tile etiqueta="Estado del periodo" valor={ETIQUETAS_ESTADO[p.estado] ?? p.estado} />}
          {p && <Tile etiqueta="Trabajadores con tareo cargado" valor={p.trabajadores_con_tareo} />}
          {p && p.costo_total_ingresos !== null && (
            <Tile etiqueta="Total ingresos de la planilla" valor={`S/ ${p.costo_total_ingresos.toFixed(2)}`} />
          )}
        </div>
      </div>

      {resumen.alertas.length > 0 && (
        <div className="card">
          <h2>Alertas</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {resumen.alertas.map((a, i) => (
              <li key={i} style={{ marginBottom: 6, color: "#9a5b00" }}>
                {a.mensaje}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
