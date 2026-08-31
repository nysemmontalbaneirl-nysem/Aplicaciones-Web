import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, BASE_URL, conToken } from "../api";
import { DetallePlanilla, PeriodoPlanilla, tienePermiso } from "../types";
import { useAuth } from "../AuthContext";
import Boleta from "./Boleta";

interface ErrorEnvio {
  dni: string;
  nombre: string;
  motivo: string;
}

interface ResultadoEnvio {
  enviados: number;
  errores: ErrorEnvio[];
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

interface Props {
  periodoInicial: PeriodoPlanilla | null;
}

export default function Boletas({ periodoInicial }: Props) {
  const { usuario } = useAuth();
  const puedeEnviarCorreo = !!usuario && tienePermiso(usuario, "boletas.enviar");
  const [periodos, setPeriodos] = useState<PeriodoPlanilla[]>([]);
  const [periodoId, setPeriodoId] = useState<number | null>(periodoInicial?.id ?? null);
  const [busqueda, setBusqueda] = useState("");
  const [resultado, setResultado] = useState<DetallePlanilla[]>([]);
  const [periodoActual, setPeriodoActual] = useState<PeriodoPlanilla | null>(periodoInicial);
  const [error, setError] = useState<string | null>(null);
  const [boletaSeleccionada, setBoletaSeleccionada] = useState<DetallePlanilla | null>(null);
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [imprimiendoLote, setImprimiendoLote] = useState(false);
  const [enviandoCorreo, setEnviandoCorreo] = useState(false);
  const [resultadoEnvio, setResultadoEnvio] = useState<ResultadoEnvio | null>(null);

  // Con muchas boletas en el periodo la tabla puede ser larga - este boton de
  // acceso rapido permite volver directo al buscador/filtro sin desplazarse
  // manualmente por toda la lista.
  const buscadorRef = useRef<HTMLInputElement>(null);
  function irABuscador() {
    buscadorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    buscadorRef.current?.focus();
  }

  useEffect(() => {
    apiGet<PeriodoPlanilla[]>("/periodos")
      .then((lista) => {
        setPeriodos(lista.filter((p) => p.estado === "CALCULADO"));
        if (!periodoId && lista.length > 0) {
          const primero = lista.find((p) => p.estado === "CALCULADO");
          if (primero) setPeriodoId(primero.id);
        }
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (!periodoId) return;
    setError(null);
    setSeleccionados(new Set());
    setImprimiendoLote(false);
    setResultadoEnvio(null);
    const q = busqueda.trim() ? `?q=${encodeURIComponent(busqueda.trim())}` : "";
    apiGet<{ periodo: PeriodoPlanilla; detalle: DetallePlanilla[] }>(`/periodos/${periodoId}/planilla${q}`)
      .then((d) => {
        setResultado(d.detalle);
        setPeriodoActual(d.periodo);
      })
      .catch((e) => setError((e as Error).message));
  }, [periodoId, busqueda]);

  const totales = resultado.reduce(
    (acc, d) => ({
      ingresos: acc.ingresos + Number(d.total_ingresos),
      descuentos: acc.descuentos + Number(d.total_descuentos),
      aportes: acc.aportes + Number(d.detalle_json?.total_aportes_empleador ?? 0),
      neto: acc.neto + Number(d.neto_pagar),
    }),
    { ingresos: 0, descuentos: 0, aportes: 0, neto: 0 }
  );

  // URL de descarga (Excel/PDF) de este mismo listado: mismo periodo y
  // mismo texto de busqueda que se ve en pantalla.
  function urlExportar(formato: "excel" | "pdf"): string {
    const params = new URLSearchParams();
    if (busqueda.trim()) params.set("q", busqueda.trim());
    return conToken(`${BASE_URL}/periodos/${periodoId}/planilla/${formato}?${params.toString()}`);
  }

  function alternarSeleccion(id: number) {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  function alternarSeleccionTodos() {
    setSeleccionados((prev) =>
      prev.size === resultado.length ? new Set() : new Set(resultado.map((d) => d.id))
    );
  }

  const boletasDelLote = resultado.filter((d) => seleccionados.has(d.id));

  async function enviarPorCorreo() {
    if (!periodoId) return;
    setEnviandoCorreo(true);
    setError(null);
    setResultadoEnvio(null);
    try {
      const r = await apiPost<ResultadoEnvio>(`/periodos/${periodoId}/boletas/enviar-correo`, {
        detalle_ids: Array.from(seleccionados),
      });
      setResultadoEnvio(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviandoCorreo(false);
    }
  }

  return (
    <div>
      <div className="barra-accesos-rapidos">
        <button type="button" onClick={irABuscador}>
          Ir al buscador
        </button>
      </div>

      {error && <div className="mensaje-error">{error}</div>}

      <div className="card">
        <h2>Boletas</h2>
        <div className="form-grid" style={{ maxWidth: 500 }}>
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
          <label>
            Buscar (DNI o nombre)
            <input
              ref={buscadorRef}
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Ej. 12345678 o Perez"
            />
          </label>
        </div>
      </div>

      {periodoActual && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2>
              {resultado.length} boletas — {MESES[periodoActual.mes - 1]} {periodoActual.anio}
            </h2>
            <div style={{ display: "flex", gap: 8 }}>
              {puedeEnviarCorreo && (
                <button
                  type="button"
                  disabled={seleccionados.size === 0 || enviandoCorreo}
                  onClick={enviarPorCorreo}
                >
                  {enviandoCorreo ? "Enviando..." : `Enviar por correo (${seleccionados.size})`}
                </button>
              )}
              <button
                className="primario"
                type="button"
                disabled={seleccionados.size === 0}
                onClick={() => setImprimiendoLote(true)}
              >
                Imprimir seleccionadas ({seleccionados.size})
              </button>
              <a href={urlExportar("excel")}>
                <button type="button">Exportar a Excel</button>
              </a>
              <a href={urlExportar("pdf")}>
                <button type="button">Exportar a PDF</button>
              </a>
            </div>
          </div>

          {resultadoEnvio && (
            <div className={resultadoEnvio.errores.length > 0 ? "mensaje-error" : "mensaje-ok"} style={{ marginTop: 10 }}>
              <div>
                {resultadoEnvio.enviados} correo(s) enviado(s) correctamente
                {resultadoEnvio.errores.length > 0 && `, ${resultadoEnvio.errores.length} con problemas:`}
              </div>
              {resultadoEnvio.errores.length > 0 && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                  {resultadoEnvio.errores.map((e, i) => (
                    <li key={i}>
                      {e.nombre} {e.dni && `(${e.dni})`}: {e.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={resultado.length > 0 && seleccionados.size === resultado.length}
                    onChange={alternarSeleccionTodos}
                    title="Seleccionar todas"
                  />
                </th>
                <th>DNI</th>
                <th>Trabajador</th>
                <th>Categoria</th>
                <th>Proyecto</th>
                <th>Total ingresos</th>
                <th>Total descuentos</th>
                <th>Total aportes</th>
                <th>Neto a pagar</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {resultado.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={seleccionados.has(d.id)}
                      onChange={() => alternarSeleccion(d.id)}
                    />
                  </td>
                  <td>{d.numero_documento}</td>
                  <td>{d.apellidos_nombres}</td>
                  <td>{d.categoria_ocupacional}</td>
                  <td>{d.proyecto}</td>
                  <td>S/ {Number(d.total_ingresos).toFixed(2)}</td>
                  <td>S/ {Number(d.total_descuentos).toFixed(2)}</td>
                  <td>S/ {Number(d.detalle_json?.total_aportes_empleador ?? 0).toFixed(2)}</td>
                  <td>S/ {Number(d.neto_pagar).toFixed(2)}</td>
                  <td>
                    <button type="button" onClick={() => setBoletaSeleccionada(d)}>
                      Ver boleta
                    </button>
                  </td>
                </tr>
              ))}
              {resultado.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", color: "#5a6172" }}>
                    No se encontraron boletas.
                  </td>
                </tr>
              )}
              {resultado.length > 0 && (
                <tr className="totales-fila">
                  <td colSpan={5}>Totales</td>
                  <td>S/ {totales.ingresos.toFixed(2)}</td>
                  <td>S/ {totales.descuentos.toFixed(2)}</td>
                  <td>S/ {totales.aportes.toFixed(2)}</td>
                  <td>S/ {totales.neto.toFixed(2)}</td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {boletaSeleccionada && periodoActual && (
        <Boleta
          detalle={boletaSeleccionada}
          periodo={periodoActual}
          onCerrar={() => setBoletaSeleccionada(null)}
        />
      )}

      {imprimiendoLote && periodoActual && (
        <div className="lote-imprimible">
          <div className="no-imprimir card" style={{ display: "flex", gap: 8 }}>
            <button className="primario" type="button" onClick={() => window.print()}>
              Imprimir {boletasDelLote.length} boletas
            </button>
            <button type="button" onClick={() => setImprimiendoLote(false)}>
              Cerrar
            </button>
          </div>
          {boletasDelLote.map((d) => (
            <Boleta key={d.id} detalle={d} periodo={periodoActual} onCerrar={() => {}} ocultarControles />
          ))}
        </div>
      )}
    </div>
  );
}
