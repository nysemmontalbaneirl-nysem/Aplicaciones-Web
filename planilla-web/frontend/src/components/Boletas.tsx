import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, BASE_URL, conToken } from "../api";
import { DatosEmpresa, DetallePlanilla, PeriodoPlanilla, tienePermiso } from "../types";
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

// Etiqueta del selector de periodo: antes solo mostraba "{Mes} {Año}", lo
// que no distinguia 2 periodos del mismo mes (ej. 1ra/2da quincena, o 2
// proyectos con periodo propio el mismo mes) - se agrega quincena/semana y
// proyecto cuando corresponde. "(sin calcular)" es el pedido explicito del
// usuario (mejora "Boletas", sept. 2026): antes el selector solo ofrecia
// periodos YA calculados, asi que nunca se podia mostrar el aviso de "este
// periodo todavia no tiene boletas generadas" - ahora se listan todos.
function etiquetaPeriodo(p: PeriodoPlanilla): string {
  let base = `${MESES[p.mes - 1]} ${p.anio}`;
  if (p.tipo === "QUINCENAL") base += p.quincena === 2 ? " - 2da quincena" : " - 1ra quincena";
  else if (p.tipo === "SEMANAL") base += ` - Semana (${p.fecha_inicio.slice(0, 10)} al ${p.fecha_fin.slice(0, 10)})`;
  if (p.proyecto) base += ` [${p.proyecto}]`;
  if (p.estado !== "CALCULADO") base += " (sin calcular)";
  return base;
}

interface Props {
  periodoInicial: PeriodoPlanilla | null;
}

export default function Boletas({ periodoInicial }: Props) {
  const { usuario } = useAuth();
  const puedeEnviarCorreo = !!usuario && tienePermiso(usuario, "boletas.enviar");
  const [periodos, setPeriodos] = useState<PeriodoPlanilla[]>([]);
  const [periodoId, setPeriodoId] = useState<number | null>(periodoInicial?.id ?? null);
  const [busqueda, setBusqueda] = useState("");
  // "Periodo creado" (mejora Boletas, sept. 2026): el usuario confirmo que
  // esto significa la fecha en que se CALCULO la planilla (no la fecha en
  // que se dio de alta el periodo), para poder acotar la busqueda a
  // boletas calculadas/recalculadas dentro de un rango de fechas concreto.
  const [calculadoDesde, setCalculadoDesde] = useState("");
  const [calculadoHasta, setCalculadoHasta] = useState("");
  const [resultado, setResultado] = useState<DetallePlanilla[]>([]);
  // Total de boletas del periodo SIN aplicar busqueda/rango de calculo -
  // permite distinguir "el periodo no tiene ninguna boleta calculada
  // todavia" de "la busqueda no encontro nada dentro de un periodo que SI
  // tiene boletas" (pedido explicito del usuario).
  const [totalBoletasPeriodo, setTotalBoletasPeriodo] = useState(0);
  const [periodoActual, setPeriodoActual] = useState<PeriodoPlanilla | null>(periodoInicial);
  const [error, setError] = useState<string | null>(null);
  const [boletaSeleccionada, setBoletaSeleccionada] = useState<DetallePlanilla | null>(null);
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [imprimiendoLote, setImprimiendoLote] = useState(false);
  const [enviandoCorreo, setEnviandoCorreo] = useState(false);
  const [resultadoEnvio, setResultadoEnvio] = useState<ResultadoEnvio | null>(null);
  // Firma del empleador + nombre del representante legal (migracion 031) -
  // se piden UNA sola vez aqui (no dentro de <Boleta>) porque esta pantalla
  // puede mostrar muchas boletas a la vez (imprimir lote); repetir el
  // fetch por cada una seria redundante. Si todavia no hay datos de la
  // empresa configurados, se sigue mostrando la boleta con normalidad, sin
  // la firma/nombre del empleador.
  const [datosEmpresa, setDatosEmpresa] = useState<DatosEmpresa | null>(null);

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
        // Antes se ofrecian solo los periodos YA CALCULADOS - eso impedia
        // mostrarle al usuario el aviso de "este periodo todavia no se ha
        // calculado" (nunca se podia seleccionar uno asi). Ahora se listan
        // todos; se sigue prefiriendo un CALCULADO como seleccion inicial.
        setPeriodos(lista);
        if (!periodoId && lista.length > 0) {
          const primero = lista.find((p) => p.estado === "CALCULADO") ?? lista[0];
          setPeriodoId(primero.id);
        }
      })
      .catch((e) => setError((e as Error).message));
    apiGet<DatosEmpresa>("/empresa")
      .then(setDatosEmpresa)
      .catch(() => {
        // todavia no hay datos de la empresa configurados - la Boleta se
        // muestra igual, sin firma/nombre del empleador.
      });
  }, []);

  function armarQuery(): string {
    const params = new URLSearchParams();
    if (busqueda.trim()) params.set("q", busqueda.trim());
    if (calculadoDesde) params.set("calculado_desde", calculadoDesde);
    if (calculadoHasta) params.set("calculado_hasta", calculadoHasta);
    const texto = params.toString();
    return texto ? `?${texto}` : "";
  }

  useEffect(() => {
    if (!periodoId) return;
    setError(null);
    setSeleccionados(new Set());
    setImprimiendoLote(false);
    setResultadoEnvio(null);
    apiGet<{ periodo: PeriodoPlanilla; detalle: DetallePlanilla[]; total_boletas_periodo: number }>(
      `/periodos/${periodoId}/planilla${armarQuery()}`
    )
      .then((d) => {
        setResultado(d.detalle);
        setPeriodoActual(d.periodo);
        setTotalBoletasPeriodo(d.total_boletas_periodo);
      })
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodoId, busqueda, calculadoDesde, calculadoHasta]);

  const totales = resultado.reduce(
    (acc, d) => ({
      ingresos: acc.ingresos + Number(d.total_ingresos),
      descuentos: acc.descuentos + Number(d.total_descuentos),
      aportes: acc.aportes + Number(d.detalle_json?.total_aportes_empleador ?? 0),
      neto: acc.neto + Number(d.neto_pagar),
    }),
    { ingresos: 0, descuentos: 0, aportes: 0, neto: 0 }
  );

  // URL de descarga (Excel/PDF) de este mismo listado: mismos criterios
  // (periodo, busqueda y rango de calculo) que se ven en pantalla.
  function urlExportar(formato: "excel" | "pdf"): string {
    return conToken(`${BASE_URL}/periodos/${periodoId}/planilla/${formato}${armarQuery()}`);
  }

  // URL de descarga de las boletas COMPLETAS (no el resumen tabular de
  // arriba): "pdf" arma un solo PDF con una boleta por pagina, "zip" un PDF
  // por trabajador dentro de un ZIP. Sin ids seleccionados exporta TODAS
  // las boletas visibles en pantalla (mismos criterios de busqueda).
  function urlExportarBoletas(formato: "pdf" | "zip", ids: number[]): string {
    const params = new URLSearchParams();
    if (busqueda.trim()) params.set("q", busqueda.trim());
    if (calculadoDesde) params.set("calculado_desde", calculadoDesde);
    if (calculadoHasta) params.set("calculado_hasta", calculadoHasta);
    if (ids.length > 0) params.set("ids", ids.join(","));
    return conToken(`${BASE_URL}/periodos/${periodoId}/boletas/${formato}?${params.toString()}`);
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

  // Mensaje a mostrar cuando la tabla de resultados queda vacia - distingue
  // las 3 situaciones posibles (pedido explicito del usuario, mejora
  // "Boletas" sept. 2026): periodo sin calcular, periodo calculado pero sin
  // ninguna boleta, y busqueda sin resultados dentro de un periodo que si
  // tiene boletas.
  function mensajeSinResultados(): string {
    if (!periodoActual) return "No se encontraron boletas.";
    if (periodoActual.estado !== "CALCULADO") {
      return "Las boletas correspondientes a este período aún no han sido generadas, debido a que el proceso de cálculo de la planilla todavía no ha sido ejecutado.";
    }
    if (totalBoletasPeriodo === 0) {
      return "Este período ya fue calculado, pero no tiene ninguna boleta registrada.";
    }
    return "No se encontraron boletas con los criterios de búsqueda indicados.";
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
        <h2 className="titulo-reporte">Boletas</h2>
        <div className="form-grid" style={{ maxWidth: 700 }}>
          <label>
            Periodo
            <select value={periodoId ?? ""} onChange={(e) => setPeriodoId(Number(e.target.value))}>
              {periodos.length === 0 && <option value="">No hay periodos registrados</option>}
              {periodos.map((p) => (
                <option key={p.id} value={p.id}>
                  {etiquetaPeriodo(p)}
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
          <label>
            Calculado desde
            <input type="date" value={calculadoDesde} onChange={(e) => setCalculadoDesde(e.target.value)} />
          </label>
          <label>
            Calculado hasta
            <input type="date" value={calculadoHasta} onChange={(e) => setCalculadoHasta(e.target.value)} />
          </label>
        </div>
        <p style={{ color: "#5a6172", fontSize: "0.85rem", marginTop: 8, marginBottom: 0 }}>
          "Calculado desde/hasta" filtra por la fecha en que se ejecutó el cálculo de cada boleta (útil para
          ubicar boletas de una corrida de cálculo o recálculo concreta), y se puede combinar con el periodo y la
          búsqueda por DNI/nombre.
        </p>
      </div>

      {periodoActual && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2 className="titulo-reporte">
              {resultado.length} boletas — {MESES[periodoActual.mes - 1]} {periodoActual.anio}
            </h2>
            {resultado.length > 0 && (
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
                  <button type="button">Exportar a PDF (resumen)</button>
                </a>
                <a href={urlExportarBoletas("pdf", Array.from(seleccionados))}>
                  <button type="button" title="Un solo PDF con las boletas completas, una por pagina">
                    {seleccionados.size > 0
                      ? `Descargar boletas en PDF (${seleccionados.size})`
                      : "Descargar todas las boletas en PDF"}
                  </button>
                </a>
                <a href={urlExportarBoletas("zip", Array.from(seleccionados))}>
                  <button type="button" title="Un archivo ZIP con un PDF de boleta por trabajador">
                    {seleccionados.size > 0
                      ? `Descargar boletas en ZIP (${seleccionados.size})`
                      : "Descargar todas las boletas en ZIP"}
                  </button>
                </a>
              </div>
            )}
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
                  <td colSpan={10} style={{ textAlign: "center", color: "#5a6172", padding: "18px 12px" }}>
                    {mensajeSinResultados()}
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

      {/* NOTA (recon 32/46): el parche original mostraba esta boleta puntual
          dentro de un formulario flotante (modal-overlay/modal-flotante),
          reusando ese mismo patron de "Registrar Tareo Diario" - con su
          propio sub-buscador de DNI para saltar de una boleta a otra sin
          cerrar el formulario, y los botones de descargar/enviar/imprimir
          movidos a la cabecera del modal. Se omite esa conversion (y todo
          el estado que la sostenia: dniModal/resultadosModal/envioModal,
          abrirBoleta/cerrarBoleta, enviarBoletaModalPorCorreo): ese mismo
          "formulario flotante" (clases modal-overlay/modal-flotante-*) es
          la infraestructura de la brecha #1 (parches #16/17/18, SALTADOS
          por completo - ver RECONSTRUCCION_BRECHAS.md punto 1), que nunca
          llego a existir en este arbol. Se conserva el comportamiento
          anterior (la boleta se inserta debajo del listado, con sus
          propios controles de descargar/enviar/imprimir dentro de
          <Boleta>). */}
      {boletaSeleccionada && periodoActual && (
        <Boleta
          detalle={boletaSeleccionada}
          periodo={periodoActual}
          datosEmpresa={datosEmpresa}
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
            <Boleta key={d.id} detalle={d} periodo={periodoActual} datosEmpresa={datosEmpresa} onCerrar={() => {}} ocultarControles />
          ))}
        </div>
      )}
    </div>
  );
}
