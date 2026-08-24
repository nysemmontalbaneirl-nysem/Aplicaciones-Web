import { useEffect, useState } from "react";
import { apiGet, BASE_URL, conToken } from "../api";
import { PeriodoPlanilla } from "../types";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

export default function Reportes() {
  const [periodos, setPeriodos] = useState<PeriodoPlanilla[]>([]);
  const [periodoId, setPeriodoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<PeriodoPlanilla[]>("/periodos")
      .then((lista) => {
        const calculados = lista.filter((p) => p.estado === "CALCULADO");
        setPeriodos(calculados);
        if (calculados.length > 0) setPeriodoId(calculados[0].id);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div>
      <div className="card">
        <h2>Reportes</h2>
        {error && <div className="mensaje-error">{error}</div>}
        <div className="form-grid" style={{ maxWidth: 400 }}>
          <label>
            Periodo
            <select value={periodoId ?? ""} onChange={(e) => setPeriodoId(Number(e.target.value))}>
              {periodos.length === 0 && <option value="">No hay periodos calculados</option>}
              {periodos.map((p) => (
                <option key={p.id} value={p.id}>
                  {MESES[p.mes - 1]} {p.anio}
                </option>
              ))}
            </select>
          </label>
        </div>

        {periodoId && (
          <a href={conToken(`${BASE_URL}/periodos/${periodoId}/reporte`)}>
            <button className="primario" type="button">
              Descargar resumen en Excel
            </button>
          </a>
        )}

        <details style={{ marginTop: 20 }}>
          <summary style={{ cursor: "pointer", color: "#2f6fed" }}>
            Sobre las columnas que salen en blanco
          </summary>
          <p style={{ fontSize: "0.85rem", color: "#5a6172", marginTop: 8 }}>
            El resumen tiene el mismo formato y orden de columnas que tu Excel de referencia
            (con las columnas DNI y Apellidos/Nombres fijas al desplazarte). Algunas columnas
            salen en blanco a propósito: son conceptos que el sistema todavía no calcula
            (vacaciones, movilidad, BAE, subsidios, condición de trabajo, etc.) — antes fue
            revisado contigo cuáles son para no inventar números. Se irán activando conforme se
            construyan esos módulos.
          </p>
        </details>
      </div>
    </div>
  );
}
