import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import { ParametrosMensuales, ParametrosNormativos, PeriodoMensual } from "../types";

const AFPS = ["INTEGRA", "PRIMA", "PROFUTURO", "HABITAT"];
const CATEGORIAS_CONSTRUCCION = ["OPERARIO", "OFICIAL", "PEON", "OPERARIO_EP", "OPERARIO_EM", "OPERARIO_TP"];
const CATEGORIAS_TABLA = [...CATEGORIAS_CONSTRUCCION, "PEON_A", "R_GENERAL"];

function esConstruccionCivil(categoria: string): boolean {
  return CATEGORIAS_CONSTRUCCION.includes(categoria);
}

// Columnas de solo lectura: se derivan del jornal basico con formula fija,
// verificadas contra la hoja AFPS-SALARIOS real (no se guardan en BD).
function calcDominical(jornal: number): number {
  return jornal / 6;
}
function calcVacaciones(jornal: number): number {
  return jornal * 0.1;
}
function calcCTS(jornal: number): number {
  return jornal * 0.15;
}
// Gratificacion diaria = 40 jornales basicos / 210 dias (RD N°777-87-DR-LIM),
// verificada contra boletas reales - ya no se guarda como campo editable
// aparte porque quedaba en 0 por olvido en categorias/periodos nuevos.
function calcGratificacion(jornal: number): number {
  return jornal * (40 / 210);
}
function calcHoraExtra(jornal: number, categoria: string): { tramo1: number; tramo2: number; etiqueta: string } {
  const cc = esConstruccionCivil(categoria);
  const jornalHora = jornal / 8;
  return cc
    ? { tramo1: jornalHora * 1.6, tramo2: jornalHora * 2.0, etiqueta: "60% / 100%" }
    : { tramo1: jornalHora * 1.25, tramo2: jornalHora * 1.35, etiqueta: "25% / 35%" };
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

// Los porcentajes se muestran/editan como "9" (%) pero se guardan como 0.09 (fraccion)
function aPorcentaje(fraccion: number): string {
  return (fraccion * 100).toFixed(4).replace(/\.?0+$/, "");
}
function aFraccion(porcentajeTexto: string): number {
  return (Number(porcentajeTexto) || 0) / 100;
}

export default function Parametros() {
  return (
    <div>
      <SeccionAnual />
      <SeccionMensual />
    </div>
  );
}

// ==========================================================================
// Valores anuales: UIT, RMV, ESSALUD, ONP, SENATI, CONAFOVICER, SCTR, etc.
// ==========================================================================
function SeccionAnual() {
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

  useEffect(() => {
    cargarLista().catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (anioSeleccionado === null) return;
    setError(null);
    setOk(null);
    apiGet<ParametrosNormativos>(`/parametros/${anioSeleccionado}`)
      .then(setParametros)
      .catch((e) => setError((e as Error).message));
  }, [anioSeleccionado]);

  function actualizarEscalar<K extends keyof ParametrosNormativos>(campo: K, valor: ParametrosNormativos[K]) {
    setParametros((p) => (p ? { ...p, [campo]: valor } : p));
  }

  async function guardar() {
    if (!parametros) return;
    setError(null);
    setOk(null);
    setGuardando(true);
    try {
      await apiPut<ParametrosNormativos>(`/parametros/${parametros.anio}`, parametros);
      setOk(`Parametros anuales de ${parametros.anio} actualizados correctamente.`);
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
      await apiPost<ParametrosNormativos>("/parametros", { anio: nuevoAnio, copiar_de_anio: anioSeleccionado });
      await cargarLista();
      setAnioSeleccionado(nuevoAnio);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card">
      <h2>Valores anuales (UIT, RMV, ESSALUD, ONP, SENATI, CONAFOVICER, SCTR)</h2>
      {error && <div className="mensaje-error">{error}</div>}
      {ok && <div className="mensaje-ok">{ok}</div>}

      <div className="form-grid" style={{ maxWidth: 300 }}>
        <label>
          Año
          <select value={anioSeleccionado ?? ""} onChange={(e) => setAnioSeleccionado(Number(e.target.value))}>
            {anios.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
      </div>

      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", color: "#2f6fed" }}>Crear un año nuevo</summary>
        <form onSubmit={crearAnio} style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "end" }}>
          <label>
            Nuevo año
            <input type="number" value={nuevoAnio} onChange={(e) => setNuevoAnio(Number(e.target.value))} />
          </label>
          <button className="primario" type="submit">Crear copiando de {anioSeleccionado}</button>
        </form>
      </details>

      {parametros && (
        <>
          <div className="form-grid">
            <label>
              UIT (S/.)
              <input type="number" step="0.01" value={parametros.uit}
                onChange={(e) => actualizarEscalar("uit", Number(e.target.value))} />
            </label>
            <label>
              Remuneración Mínima Vital (S/.)
              <input type="number" step="0.01" value={parametros.remuneracion_minima_vital}
                onChange={(e) => actualizarEscalar("remuneracion_minima_vital", Number(e.target.value))} />
            </label>
            <label>
              Asignación familiar (S/.) — 10% de la RMV, se calcula sola
              <input
                type="number"
                step="0.01"
                value={(parametros.remuneracion_minima_vital * 0.1).toFixed(2)}
                disabled
                style={{ background: "#f7f8fa", color: "#5a6172" }}
              />
            </label>
            <label>
              Seguro vida ley (S/.)
              <input type="number" step="0.01" value={parametros.seguro_vida_ley}
                onChange={(e) => actualizarEscalar("seguro_vida_ley", Number(e.target.value))} />
            </label>
            <label>
              ESSALUD (%)
              <input type="number" step="0.01" value={aPorcentaje(parametros.tasa_essalud)}
                onChange={(e) => actualizarEscalar("tasa_essalud", aFraccion(e.target.value))} />
            </label>
            <label>
              ONP (%)
              <input type="number" step="0.01" value={aPorcentaje(parametros.tasa_onp)}
                onChange={(e) => actualizarEscalar("tasa_onp", aFraccion(e.target.value))} />
            </label>
            <label>
              SENATI (%)
              <input type="number" step="0.001" value={aPorcentaje(parametros.tasa_senati)}
                onChange={(e) => actualizarEscalar("tasa_senati", aFraccion(e.target.value))} />
            </label>
            <label>
              CONAFOVICER (%)
              <input type="number" step="0.01" value={aPorcentaje(parametros.tasa_conafovicer)}
                onChange={(e) => actualizarEscalar("tasa_conafovicer", aFraccion(e.target.value))} />
            </label>
            <label>
              SCTR salud (%)
              <input type="number" step="0.01" value={aPorcentaje(parametros.tasa_sctr_salud)}
                onChange={(e) => actualizarEscalar("tasa_sctr_salud", aFraccion(e.target.value))} />
            </label>
          </div>
          <button className="primario" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando..." : `Guardar valores anuales de ${parametros.anio}`}
          </button>
        </>
      )}
    </div>
  );
}

// ==========================================================================
// Tasas AFP y tabla salarial de construccion civil: frecuencia MENSUAL
// ==========================================================================
function SeccionMensual() {
  const hoy = new Date();
  const [periodos, setPeriodos] = useState<PeriodoMensual[]>([]);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [datos, setDatos] = useState<ParametrosMensuales | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargarPeriodos() {
    const lista = await apiGet<PeriodoMensual[]>("/parametros/mensual");
    setPeriodos(lista);
  }

  async function cargarMes(a: number, m: number) {
    setError(null);
    setOk(null);
    try {
      const d = await apiGet<ParametrosMensuales>(`/parametros/mensual/${a}/${m}`);
      setDatos(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    cargarPeriodos().catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    cargarMes(anio, mes);
  }, [anio, mes]);

  function actualizarAFP(afpNombre: string, campo: "aporte_obligatorio" | "comision_flujo" | "prima_seguro", valorPorcentaje: string) {
    setDatos((d) => {
      if (!d) return d;
      const actual = d.afp_tasas[afpNombre] ?? { aporte_obligatorio: 0, comision_flujo: 0, prima_seguro: 0 };
      return { ...d, afp_tasas: { ...d.afp_tasas, [afpNombre]: { ...actual, [campo]: aFraccion(valorPorcentaje) } } };
    });
  }

  function actualizarCategoria(
    categoria: string,
    campo: "buc" | "bae" | "jornal_basico" | "movilidad_acumulada" | "gratificacion_diaria",
    valor: string
  ) {
    setDatos((d) => {
      if (!d) return d;
      const actual = d.tabla_categorias[categoria] ?? {
        buc: 0,
        jornal_basico: 0,
        bae: 0,
        movilidad_acumulada: 0,
        gratificacion_diaria: 0,
      };
      const nuevoValor = campo === "buc" || campo === "bae" ? aFraccion(valor) : Number(valor) || 0;
      return { ...d, tabla_categorias: { ...d.tabla_categorias, [categoria]: { ...actual, [campo]: nuevoValor } } };
    });
  }

  async function guardar() {
    if (!datos) return;
    setError(null);
    setOk(null);
    setGuardando(true);
    try {
      await apiPut(`/parametros/mensual/${anio}/${mes}`, {
        afp_tasas: datos.afp_tasas,
        tabla_categorias: datos.tabla_categorias,
      });
      setOk(`Tasas de ${MESES[mes - 1]} ${anio} guardadas correctamente.`);
      await cargarPeriodos();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function copiarDeOtroMes(origen: PeriodoMensual) {
    setError(null);
    try {
      await apiPost("/parametros/mensual", {
        anio, mes, copiar_de_anio: origen.anio, copiar_de_mes: origen.mes,
      });
      await cargarMes(anio, mes);
      await cargarPeriodos();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card">
      <h2>Tasas AFP y tabla salarial construcción civil (mensual)</h2>
      <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
        SBS publica las comisiones/prima de AFP cada mes, y la tabla salarial de construcción
        civil también puede cambiar mes a mes. Por eso cada mes tiene sus propios valores,
        independientes del resto del año.
      </p>
      {error && <div className="mensaje-error">{error}</div>}
      {ok && <div className="mensaje-ok">{ok}</div>}

      <div className="form-grid" style={{ maxWidth: 300 }}>
        <label>
          Año
          <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} />
        </label>
        <label>
          Mes
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((nombre, idx) => (
              <option key={nombre} value={idx + 1}>{nombre}</option>
            ))}
          </select>
        </label>
      </div>

      {periodos.length > 0 && (
        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", color: "#2f6fed" }}>Copiar valores de otro mes ya configurado</summary>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {periodos.map((p) => (
              <button key={`${p.anio}-${p.mes}`} type="button" onClick={() => copiarDeOtroMes(p)}>
                {MESES[p.mes - 1]} {p.anio}
              </button>
            ))}
          </div>
        </details>
      )}

      {datos && (
        <>
          <h3>Tasas AFP</h3>
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
                const t = datos.afp_tasas[afp] ?? { aporte_obligatorio: 0, comision_flujo: 0, prima_seguro: 0 };
                return (
                  <tr key={afp}>
                    <td>{afp}</td>
                    <td>
                      <input type="number" step="0.01" value={aPorcentaje(t.aporte_obligatorio)}
                        onChange={(e) => actualizarAFP(afp, "aporte_obligatorio", e.target.value)} />
                    </td>
                    <td>
                      <input type="number" step="0.01" value={aPorcentaje(t.comision_flujo)}
                        onChange={(e) => actualizarAFP(afp, "comision_flujo", e.target.value)} />
                    </td>
                    <td>
                      <input type="number" step="0.01" value={aPorcentaje(t.prima_seguro)}
                        onChange={(e) => actualizarAFP(afp, "prima_seguro", e.target.value)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3>Tabla salarial</h3>
          <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
            Las columnas en blanco (Jornal, BUC, BAE, Movilidad, Gratificación) se editan
            directamente. Las columnas en gris se calculan solas a partir del jornal básico
            (Dominical = jornal/6, Vacaciones = 10%, CTS = 15%) y no se guardan por separado.
            El recargo de hora extra depende del régimen: construcción civil usa 60%/100% y
            el resto (PEON_A, R_GENERAL) usa 25%/35%.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ marginBottom: 20 }}>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Jornal básico (S/.)</th>
                  <th>BUC (%)</th>
                  <th>BAE (%)</th>
                  <th>Movilidad acum. (S/.)</th>
                  <th style={{ background: "#f0f1f4" }}>Dominical (S/.)</th>
                  <th style={{ background: "#f0f1f4" }}>Vacaciones 10% (S/.)</th>
                  <th style={{ background: "#f0f1f4" }}>CTS 15% (S/.)</th>
                  <th style={{ background: "#f0f1f4" }}>Gratificación (S/.)</th>
                  <th style={{ background: "#f0f1f4" }}>H.E. tramo 1 (S/.)</th>
                  <th style={{ background: "#f0f1f4" }}>H.E. tramo 2 (S/.)</th>
                  <th style={{ background: "#f0f1f4" }}>Recargo H.E.</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIAS_TABLA.map((cat) => {
                  const c = datos.tabla_categorias[cat] ?? {
                    buc: 0,
                    jornal_basico: 0,
                    bae: 0,
                    movilidad_acumulada: 0,
                    gratificacion_diaria: 0,
                  };
                  const horaExtra = calcHoraExtra(c.jornal_basico, cat);
                  return (
                    <tr key={cat}>
                      <td>{cat}</td>
                      <td>
                        <input type="number" step="0.01" value={c.jornal_basico}
                          onChange={(e) => actualizarCategoria(cat, "jornal_basico", e.target.value)} />
                      </td>
                      <td>
                        <input type="number" step="0.01" value={aPorcentaje(c.buc)}
                          onChange={(e) => actualizarCategoria(cat, "buc", e.target.value)} />
                      </td>
                      <td>
                        <input type="number" step="0.01" value={aPorcentaje(c.bae)}
                          onChange={(e) => actualizarCategoria(cat, "bae", e.target.value)} />
                      </td>
                      <td>
                        <input type="number" step="0.01" value={c.movilidad_acumulada}
                          onChange={(e) => actualizarCategoria(cat, "movilidad_acumulada", e.target.value)} />
                      </td>
                      <td style={{ background: "#f7f8fa", color: "#5a6172" }}>{calcDominical(c.jornal_basico).toFixed(2)}</td>
                      <td style={{ background: "#f7f8fa", color: "#5a6172" }}>{calcVacaciones(c.jornal_basico).toFixed(2)}</td>
                      <td style={{ background: "#f7f8fa", color: "#5a6172" }}>{calcCTS(c.jornal_basico).toFixed(2)}</td>
                      <td style={{ background: "#f7f8fa", color: "#5a6172" }}>{calcGratificacion(c.jornal_basico).toFixed(2)}</td>
                      <td style={{ background: "#f7f8fa", color: "#5a6172" }}>{horaExtra.tramo1.toFixed(2)}</td>
                      <td style={{ background: "#f7f8fa", color: "#5a6172" }}>{horaExtra.tramo2.toFixed(2)}</td>
                      <td style={{ background: "#f7f8fa", color: "#5a6172" }}>{horaExtra.etiqueta}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button className="primario" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando..." : `Guardar tasas de ${MESES[mes - 1]} ${anio}`}
          </button>
        </>
      )}
    </div>
  );
}
