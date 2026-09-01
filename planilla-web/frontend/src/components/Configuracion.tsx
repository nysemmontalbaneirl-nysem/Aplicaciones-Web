import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import { ConceptoPlanilla } from "../types";

type CampoAfecto = "afecto_essalud" | "afecto_sctr" | "afecto_senati" | "afecto_onp" | "afecto_afp" | "afecto_renta5ta" | "afecto_conafovicer";

const COLUMNAS_AFECTO: { campo: CampoAfecto; etiqueta: string }[] = [
  { campo: "afecto_essalud", etiqueta: "EsSalud" },
  { campo: "afecto_sctr", etiqueta: "SCTR" },
  { campo: "afecto_senati", etiqueta: "SENATI" },
  { campo: "afecto_onp", etiqueta: "ONP" },
  { campo: "afecto_afp", etiqueta: "AFP" },
  { campo: "afecto_renta5ta", etiqueta: "Renta 5ta" },
  { campo: "afecto_conafovicer", etiqueta: "CONAFOVICER" },
];

type Edicion = Partial<Pick<ConceptoPlanilla, "factor1" | "factor2" | "factor3" | CampoAfecto>>;

export default function Configuracion() {
  const [conceptos, setConceptos] = useState<ConceptoPlanilla[]>([]);
  const [ediciones, setEdiciones] = useState<Record<string, Edicion>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const datos = await apiGet<ConceptoPlanilla[]>("/conceptos");
      setConceptos(datos);
      setEdiciones({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar los conceptos");
    } finally {
      setCargando(false);
    }
  }

  function valorActual<K extends keyof Edicion>(c: ConceptoPlanilla, campo: K): ConceptoPlanilla[K] {
    const edicion = ediciones[c.codigo];
    if (edicion && campo in edicion) return edicion[campo] as ConceptoPlanilla[K];
    return c[campo];
  }

  function editar(codigo: string, campo: keyof Edicion, valor: Edicion[keyof Edicion]) {
    setEdiciones((prev) => ({ ...prev, [codigo]: { ...prev[codigo], [campo]: valor } }));
    setMensaje(null);
  }

  function esFilaEditada(codigo: string): boolean {
    return !!ediciones[codigo] && Object.keys(ediciones[codigo]).length > 0;
  }

  async function guardarFila(c: ConceptoPlanilla) {
    const cambios = ediciones[c.codigo];
    if (!cambios) return;
    setGuardando(c.codigo);
    setError(null);
    try {
      const actualizado = await apiPut<ConceptoPlanilla>(`/conceptos/${c.codigo}`, cambios);
      setConceptos((prev) => prev.map((x) => (x.codigo === c.codigo ? actualizado : x)));
      setEdiciones((prev) => {
        const copia = { ...prev };
        delete copia[c.codigo];
        return copia;
      });
      setMensaje(`Guardado: ${c.nombre}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar el concepto");
    } finally {
      setGuardando(null);
    }
  }

  async function restaurarValoresOriginales() {
    if (
      !confirm(
        "¿Restaurar TODOS los conceptos a los valores originales del sistema? Se perderán todos los cambios manuales que hayas hecho en esta pestaña."
      )
    ) {
      return;
    }
    setRestaurando(true);
    setError(null);
    try {
      const datos = await apiPost<ConceptoPlanilla[]>("/conceptos/restaurar", {});
      setConceptos(datos);
      setEdiciones({});
      setMensaje("Se restauraron los valores originales.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al restaurar los valores originales");
    } finally {
      setRestaurando(false);
    }
  }

  function celdaFactor(c: ConceptoPlanilla, campo: "factor1" | "factor2" | "factor3", etiquetaCampo: "factor1_etiqueta" | "factor2_etiqueta" | "factor3_etiqueta") {
    const etiqueta = c[etiquetaCampo];
    if (!etiqueta) return <td style={{ color: "#b0b5c0" }}>—</td>;
    const valor = valorActual(c, campo);
    return (
      <td title={etiqueta}>
        <input
          type="number"
          step="any"
          value={valor ?? ""}
          onChange={(e) => editar(c.codigo, campo, e.target.value === "" ? null : Number(e.target.value))}
          style={{ width: 90 }}
        />
        <div style={{ fontSize: "0.72rem", color: "#8a90a0", maxWidth: 140 }}>{etiqueta}</div>
      </td>
    );
  }

  function celdaAfecto(c: ConceptoPlanilla, campo: CampoAfecto) {
    const valor = valorActual(c, campo);
    if (valor === null) {
      return (
        <span style={{ color: "#b0b5c0" }} title="No aplica: ya incorporado en la fórmula anual de Empleado">
          N/A
        </span>
      );
    }
    return (
      <input type="checkbox" checked={valor} onChange={(e) => editar(c.codigo, campo, e.target.checked)} />
    );
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <h2>Configuración de conceptos de planilla</h2>
          <p style={{ color: "#5a6172", maxWidth: 800 }}>
            Para cada concepto de ingreso, define a qué aportes/descuentos está afecto (igual que la Tabla 22
            de SUNAT — EsSalud, SCTR, SENATI, ONP, AFP, Renta 5ta, CONAFOVICER) y los factores/tasas legales de
            su fórmula (ej. 0.15 = 15%). La estructura de cada fórmula sigue fija en el sistema — solo los
            números dentro de ella son editables aquí. Las celdas marcadas "N/A" no se pueden activar: su
            efecto ya está incorporado de otra forma en el cálculo (ver la descripción del concepto).
          </p>
        </div>
        <button type="button" onClick={restaurarValoresOriginales} disabled={restaurando} className="no-imprimir">
          {restaurando ? "Restaurando..." : "Restaurar valores originales"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {mensaje && <p style={{ color: "#1a7f37" }}>{mensaje}</p>}
      {cargando && <p>Cargando...</p>}

      {!cargando && (
        <div className="tabla-scroll-horizontal">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Concepto</th>
                <th>Factor 1</th>
                <th>Factor 2</th>
                <th>Factor 3</th>
                {COLUMNAS_AFECTO.map((col) => (
                  <th key={col.campo} style={{ textAlign: "center" }}>
                    {col.etiqueta}
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {conceptos.map((c) => (
                <tr key={c.codigo}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                    {c.descripcion && (
                      <div style={{ fontSize: "0.78rem", color: "#8a90a0", maxWidth: 320 }}>{c.descripcion}</div>
                    )}
                  </td>
                  {celdaFactor(c, "factor1", "factor1_etiqueta")}
                  {celdaFactor(c, "factor2", "factor2_etiqueta")}
                  {celdaFactor(c, "factor3", "factor3_etiqueta")}
                  {COLUMNAS_AFECTO.map((col) => (
                    <td key={col.campo} style={{ textAlign: "center" }}>
                      {celdaAfecto(c, col.campo)}
                    </td>
                  ))}
                  <td>
                    {esFilaEditada(c.codigo) && (
                      <button
                        type="button"
                        className="primario"
                        onClick={() => guardarFila(c)}
                        disabled={guardando === c.codigo}
                      >
                        {guardando === c.codigo ? "..." : "Guardar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
