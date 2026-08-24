import { useEffect, useState } from "react";
import { apiGet, BASE_URL, conToken } from "../api";
import { PeriodoPlanilla } from "../types";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

interface DatosReporte {
  periodo: PeriodoPlanilla;
  columnas: string[];
  filas: (string | number)[][];
}

// Las primeras 3 columnas (TD, DNI, Apellidos y Nombres) quedan fijas al
// desplazarse horizontalmente, igual que en el Excel de referencia.
const COLUMNAS_FIJAS = 3;
const ANCHOS_FIJOS = [50, 110, 220];
const IZQUIERDA_FIJA = [0, ANCHOS_FIJOS[0], ANCHOS_FIJOS[0] + ANCHOS_FIJOS[1]];

function formatoCelda(valor: string | number): string {
  if (typeof valor !== "number") return valor;
  return valor.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function Reportes() {
  const [periodos, setPeriodos] = useState<PeriodoPlanilla[]>([]);
  const [periodoId, setPeriodoId] = useState<number | null>(null);
  const [datos, setDatos] = useState<DatosReporte | null>(null);
  const [cargando, setCargando] = useState(false);
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

  useEffect(() => {
    if (!periodoId) {
      setDatos(null);
      return;
    }
    setCargando(true);
    setError(null);
    apiGet<DatosReporte>(`/periodos/${periodoId}/reporte/datos`)
      .then(setDatos)
      .catch((e) => setError((e as Error).message))
      .finally(() => setCargando(false));
  }, [periodoId]);

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

      {cargando && <div className="card">Cargando vista previa...</div>}

      {datos && !cargando && (
        <div className="card">
          <h2>
            Vista previa — {MESES[datos.periodo.mes - 1]} {datos.periodo.anio} ({datos.filas.length} trabajadores)
          </h2>
          <div
            style={{
              overflow: "auto",
              maxHeight: "70vh",
              border: "1px solid #e3e5ea",
              borderRadius: 8,
            }}
          >
            <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  {datos.columnas.map((col, i) => (
                    <th
                      key={i}
                      style={{
                        position: "sticky",
                        top: 0,
                        left: i < COLUMNAS_FIJAS ? IZQUIERDA_FIJA[i] : undefined,
                        zIndex: i < COLUMNAS_FIJAS ? 3 : 2,
                        background: "#fafbfc",
                        whiteSpace: "nowrap",
                        minWidth: i < COLUMNAS_FIJAS ? ANCHOS_FIJOS[i] : 120,
                        borderBottom: "1px solid #e3e5ea",
                        borderRight: i === COLUMNAS_FIJAS - 1 ? "2px solid #d5d9e0" : undefined,
                      }}
                    >
                      {col || <span style={{ color: "#c3c7d1" }}>—</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {datos.filas.map((fila, fi) => (
                  <tr key={fi}>
                    {fila.map((valor, ci) => (
                      <td
                        key={ci}
                        style={{
                          position: ci < COLUMNAS_FIJAS ? "sticky" : undefined,
                          left: ci < COLUMNAS_FIJAS ? IZQUIERDA_FIJA[ci] : undefined,
                          zIndex: ci < COLUMNAS_FIJAS ? 1 : undefined,
                          background: ci < COLUMNAS_FIJAS ? "#fff" : undefined,
                          whiteSpace: "nowrap",
                          borderRight: ci === COLUMNAS_FIJAS - 1 ? "2px solid #d5d9e0" : undefined,
                        }}
                      >
                        {formatoCelda(valor)}
                      </td>
                    ))}
                  </tr>
                ))}
                {datos.filas.length === 0 && (
                  <tr>
                    <td colSpan={datos.columnas.length} style={{ textAlign: "center", color: "#5a6172" }}>
                      No hay datos calculados para este periodo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
