import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import { ParametrosNormativos } from "../types";

const AFPS = ["INTEGRA", "PRIMA", "PROFUTURO", "HABITAT"];
const CATEGORIAS_CONSTRUCCION = ["OPERARIO", "OFICIAL", "PEON", "OPERARIO EP"];

// Los porcentajes se muestran/editan como "9" (%) pero se guardan como 0.09 (fraccion)
function aPorcentaje(fraccion: number): string {
  return (fraccion * 100).toFixed(4).replace(/\.?0+$/, "");
}
function aFraccion(porcentajeTexto: string): number {
  return (Number(porcentajeTexto) || 0) / 100;
}

export default function Parametros() {
  const [anios, setAnios] = useState<number[]>([]);
  const [anioSeleccionado, setAnioSeleccionado] = useState<number | null>(null);
  const [parametros, setParametros] = useState<ParametrosNormativos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [nuevoAnio, setNuevoAnio] = useState(new Date().getFullYear() + 1);

  async function cargarLista() {
    const lista = await apiGet<ParametrosNormativos[]>("/parametros");
    setAnios(lista.map((p) => p.anio));
    if (lista.length > 0 && anioSeleccionado === null) {
      setAnioSeleccionado(lista[0].anio);
    }
  }

  async function cargarAnio(anio: number) {
    setError(null);
    setOk(null);
    try {
      const datos = await apiGet<ParametrosNormativos>(`/parametros/${anio}`);
      setParametros(datos);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    cargarLista().catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (anioSeleccionado !== null) {
      cargarAnio(anioSeleccionado);
    }
  }, [anioSeleccionado]);

  function actualizarEscalar<K extends keyof ParametrosNormativos>(campo: K, valor: ParametrosNormativos[K]) {
    setParametros((p) => (p ? { ...p, [campo]: valor } : p));
  }

  function actualizarAFP(afp: string, campo: "aporte_obligatorio" | "comision_flujo" | "prima_seguro", valorPorcentaje: string) {
    setParametros((p) => {
      if (!p) return p;
      const actual = p.afp_tasas[afp] ?? { aporte_obligatorio: 0, comision_flujo: 0, prima_seguro: 0 };
      return {
        ...p,
        afp_tasas: {
          ...p.afp_tasas,
          [afp]: { ...actual, [campo]: aFraccion(valorPorcentaje) },
        },
      };
    });
  }

  function actualizarCategoria(cat: string, campo: "buc" | "jornal_basico", valor: string) {
    setParametros((p) => {
      if (!p) return p;
      const actual = p.tabla_categorias[cat] ?? { buc: 0, jornal_basico: 0 };
      const nuevoValor = campo === "buc" ? aFraccion(valor) : Number(valor) || 0;
      return {
        ...p,
        tabla_categorias: {
          ...p.tabla_categorias,
          [cat]: { ...actual, [campo]: nuevoValor },
        },
      };
    });
  }

  async function guardar() {
    if (!parametros) return;
    setError(null);
    setOk(null);
    setGuardando(true);
    try {
      await apiPut<ParametrosNormativos>(`/parametros/${parametros.anio}`, parametros);
      setOk(`Parametros de ${parametros.anio} actualizados correctamente.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function crearAnio(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiPost<ParametrosNormativos>("/parametros", {
        anio: nuevoAnio,
        copiar_de_anio: anioSeleccionado,
      });
      await cargarLista();
      setAnioSeleccionado(nuevoAnio);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Parametros normativos por año</h2>
        {error && <div className="mensaje-error">{error}</div>}
        {ok && <div className="mensaje-ok">{ok}</div>}

        <div className="form-grid" style={{ maxWidth: 400 }}>
          <label>
            Año a editar
            <select
              value={anioSeleccionado ?? ""}
              onChange={(e) => setAnioSeleccionado(Number(e.target.value))}
            >
              {anios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>

        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", color: "#2f6fed" }}>Crear parametros para un año nuevo</summary>
          <form onSubmit={crearAnio} style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "end" }}>
            <label>
              Nuevo año
              <input
                type="number"
                value={nuevoAnio}
                onChange={(e) => setNuevoAnio(Number(e.target.value))}
              />
            </label>
            <button className="primario" type="submit">
              Crear copiando de {anioSeleccionado}
            </button>
          </form>
        </details>

        {parametros && (
          <>
            <h3>Valores generales</h3>
            <div className="form-grid">
              <label>
                UIT (S/.)
                <input
                  type="number"
                  step="0.01"
                  value={parametros.uit}
                  onChange={(e) => actualizarEscalar("uit", Number(e.target.value))}
                />
              </label>
              <label>
                Asignación familiar (S/.)
                <input
                  type="number"
                  step="0.01"
                  value={parametros.asignacion_familiar}
                  onChange={(e) => actualizarEscalar("asignacion_familiar", Number(e.target.value))}
                />
              </label>
              <label>
                Seguro vida ley (S/.)
                <input
                  type="number"
                  step="0.01"
                  value={parametros.seguro_vida_ley}
                  onChange={(e) => actualizarEscalar("seguro_vida_ley", Number(e.target.value))}
                />
              </label>
              <label>
                ESSALUD (%)
                <input
                  type="number"
                  step="0.01"
                  value={aPorcentaje(parametros.tasa_essalud)}
                  onChange={(e) => actualizarEscalar("tasa_essalud", aFraccion(e.target.value))}
                />
              </label>
              <label>
                ONP (%)
                <input
                  type="number"
                  step="0.01"
                  value={aPorcentaje(parametros.tasa_onp)}
                  onChange={(e) => actualizarEscalar("tasa_onp", aFraccion(e.target.value))}
                />
              </label>
              <label>
                SENATI (%)
                <input
                  type="number"
                  step="0.001"
                  value={aPorcentaje(parametros.tasa_senati)}
                  onChange={(e) => actualizarEscalar("tasa_senati", aFraccion(e.target.value))}
                />
              </label>
              <label>
                CONAFOVICER (%)
                <input
                  type="number"
                  step="0.01"
                  value={aPorcentaje(parametros.tasa_conafovicer)}
                  onChange={(e) => actualizarEscalar("tasa_conafovicer", aFraccion(e.target.value))}
                />
              </label>
              <label>
                SCTR salud (%)
                <input
                  type="number"
                  step="0.01"
                  value={aPorcentaje(parametros.tasa_sctr_salud)}
                  onChange={(e) => actualizarEscalar("tasa_sctr_salud", aFraccion(e.target.value))}
                />
              </label>
            </div>

            <h3>Tasas AFP (según SBS, cambian mes a mes)</h3>
            <table style={{ marginBottom: 20 }}>
              <thead>
                <tr>
                  <th>AFP</th>
                  <th>Aporte obligatorio (%)</th>
                  <th>Comisión (%)</th>
                  <th>Prima de seguro (%)</th>
                </tr>
              </thead>
              <tbody>
                {AFPS.map((afp) => {
                  const t = parametros.afp_tasas[afp] ?? {
                    aporte_obligatorio: 0,
                    comision_flujo: 0,
                    prima_seguro: 0,
                  };
                  return (
                    <tr key={afp}>
                      <td>{afp}</td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={aPorcentaje(t.aporte_obligatorio)}
                          onChange={(e) => actualizarAFP(afp, "aporte_obligatorio", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={aPorcentaje(t.comision_flujo)}
                          onChange={(e) => actualizarAFP(afp, "comision_flujo", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={aPorcentaje(t.prima_seguro)}
                          onChange={(e) => actualizarAFP(afp, "prima_seguro", e.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h3>Tabla salarial construcción civil (jornales y BUC)</h3>
            <table style={{ marginBottom: 20 }}>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Jornal básico diario (S/.)</th>
                  <th>BUC (%)</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIAS_CONSTRUCCION.map((cat) => {
                  const c = parametros.tabla_categorias[cat] ?? { buc: 0, jornal_basico: 0 };
                  return (
                    <tr key={cat}>
                      <td>{cat}</td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={c.jornal_basico}
                          onChange={(e) => actualizarCategoria(cat, "jornal_basico", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={aPorcentaje(c.buc)}
                          onChange={(e) => actualizarCategoria(cat, "buc", e.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <button className="primario" onClick={guardar} disabled={guardando}>
              {guardando ? "Guardando..." : `Guardar parametros de ${parametros.anio}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
