import { useEffect, useMemo, useRef, useState } from "react";
import { apiDelete, apiGet, apiPostArchivo, apiPut, BASE_URL, conToken } from "../api";
import { AsistenciaTareo, Contrato, PeriodoPlanilla } from "../types";

interface Props {
  periodo: PeriodoPlanilla;
  onIrACalcular: () => void;
}

interface ErrorFilaTareo {
  fila: number;
  dni: string;
  motivo: string;
}

const CAMPOS_ASISTENCIA = [
  "dias_trabajados",
  "dias_dominical",
  "dias_feriado",
  "dias_falta",
  "horas_extra_25",
  "horas_extra_35",
  "horas_extra_100",
] as const;

export default function Tareo({ periodo, onIrACalcular }: Props) {
  const [tareo, setTareo] = useState<AsistenciaTareo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [erroresTareo, setErroresTareo] = useState<ErrorFilaTareo[]>([]);
  const [guardadosTareo, setGuardadosTareo] = useState<number | null>(null);

  const [busquedaAgregar, setBusquedaAgregar] = useState("");
  const [contratosDisponibles, setContratosDisponibles] = useState<Contrato[]>([]);
  const [busquedaTareo, setBusquedaTareo] = useState("");
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [eliminandoLote, setEliminandoLote] = useState(false);

  // Con muchos trabajadores el tareo cargado puede ser una lista larga - estas
  // referencias permiten volver directo al buscador correspondiente desde la
  // barra de accesos rapidos, sin tener que desplazarse manualmente.
  const buscadorAgregarRef = useRef<HTMLInputElement>(null);
  const buscadorListaRef = useRef<HTMLInputElement>(null);

  function irABuscadorAgregar() {
    buscadorAgregarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    buscadorAgregarRef.current?.focus();
  }

  function irABuscadorLista() {
    buscadorListaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    buscadorListaRef.current?.focus();
  }

  async function cargarTareo() {
    const datos = await apiGet<{ tareo: AsistenciaTareo[] }>(`/periodos/${periodo.id}/tareo`);
    setTareo(datos.tareo);
  }

  useEffect(() => {
    cargarTareo().catch((e) => setError((e as Error).message));
    apiGet<Contrato[]>("/contratos?estado=HABIL")
      .then(setContratosDisponibles)
      .catch((e) => setError((e as Error).message));
  }, [periodo.id]);

  async function cargarArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;

    setError(null);
    setErroresTareo([]);
    setGuardadosTareo(null);
    setSubiendo(true);
    try {
      const formData = new FormData();
      formData.append("archivo", archivo);
      const cuerpo = await apiPostArchivo<{ guardados: number; errores: ErrorFilaTareo[] }>(
        `/periodos/${periodo.id}/tareo/importar`,
        formData
      );

      setGuardadosTareo(cuerpo.guardados);
      setErroresTareo(cuerpo.errores);
      await cargarTareo();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  function actualizarCampo(contratoId: number, campo: (typeof CAMPOS_ASISTENCIA)[number], valor: number) {
    setTareo((prev) => prev.map((f) => (f.contrato_id === contratoId ? { ...f, [campo]: valor } : f)));
  }

  async function guardarFila(fila: AsistenciaTareo) {
    setError(null);
    try {
      await apiPut(`/periodos/${periodo.id}/tareo`, fila);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function eliminarFila(contratoId: number) {
    if (!window.confirm("¿Quitar a este trabajador del tareo de este periodo?")) return;
    setError(null);
    try {
      await apiDelete(`/periodos/${periodo.id}/tareo/${contratoId}`);
      await cargarTareo();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function alternarSeleccion(contratoId: number) {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(contratoId)) nuevo.delete(contratoId);
      else nuevo.add(contratoId);
      return nuevo;
    });
  }

  function alternarSeleccionTodos() {
    setSeleccionados((prev) =>
      prev.size === tareoFiltrado.length && tareoFiltrado.length > 0
        ? new Set()
        : new Set(tareoFiltrado.map((f) => f.contrato_id))
    );
  }

  async function eliminarSeleccionados() {
    if (
      !window.confirm(
        `¿Quitar a ${seleccionados.size} trabajador(es) del tareo de este periodo?`
      )
    )
      return;
    setError(null);
    setEliminandoLote(true);
    try {
      await Promise.all(
        Array.from(seleccionados).map((contratoId) =>
          apiDelete(`/periodos/${periodo.id}/tareo/${contratoId}`)
        )
      );
      setSeleccionados(new Set());
      await cargarTareo();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEliminandoLote(false);
    }
  }

  const tareoFiltrado = useMemo(() => {
    const q = busquedaTareo.trim().toLowerCase();
    if (!q) return tareo;
    return tareo.filter(
      (f) =>
        f.numero_documento?.toLowerCase().includes(q) ||
        f.apellidos_nombres?.toLowerCase().includes(q)
    );
  }, [busquedaTareo, tareo]);

  const contratosFiltrados = useMemo(() => {
    const q = busquedaAgregar.trim().toLowerCase();
    if (q.length < 2) return [];
    const yaEnTareo = new Set(tareo.map((f) => f.contrato_id));
    return contratosDisponibles
      .filter((c) => !yaEnTareo.has(c.id))
      .filter(
        (c) =>
          c.numero_documento?.toLowerCase().includes(q) ||
          c.apellidos_nombres?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [busquedaAgregar, contratosDisponibles, tareo]);

  async function agregarTrabajador(c: Contrato) {
    setError(null);
    try {
      await apiPut(`/periodos/${periodo.id}/tareo`, {
        contrato_id: c.id,
        dias_trabajados: 0,
        dias_dominical: 0,
        dias_feriado: 0,
        dias_falta: 0,
        horas_extra_25: 0,
        horas_extra_35: 0,
        horas_extra_100: 0,
      });
      setBusquedaAgregar("");
      await cargarTareo();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <div className="barra-accesos-rapidos">
        <button type="button" onClick={irABuscadorLista}>
          Ir al buscador de la lista
        </button>
        <button type="button" onClick={irABuscadorAgregar}>
          Agregar trabajador a mano
        </button>
      </div>

      {error && <div className="mensaje-error">{error}</div>}

      <div className="card">
        <h2>
          Tareo — {periodo.mes}/{periodo.anio}
        </h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          Solo aparecen aqui los trabajadores que ya tienen tareo cargado para este periodo (no
          toda la planilla). Descarga la plantilla, bórrale las filas de quienes no trabajaron
          ese periodo, llena los datos, y vuelve a subirla. Las horas extra se ingresan en
          decimal (ej. 1 hora 30 min = 1.5). Si prefieres registrar dia por dia (con horas y
          minutos separados), usa "Registrar Tareo Diario" en el menu — se suma automaticamente
          a estos mismos totales. Las columnas de subsidio/licencia son solo informativas.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a href={conToken(`${BASE_URL}/periodos/${periodo.id}/tareo/plantilla`)}>
            <button type="button">Descargar plantilla Excel</button>
          </a>
          <input type="file" accept=".xlsx,.csv" onChange={cargarArchivo} disabled={subiendo} />
          {subiendo && <span>Cargando...</span>}
        </div>

        {guardadosTareo !== null && (
          <div className="mensaje-ok" style={{ marginTop: 12 }}>
            {guardadosTareo} trabajadores guardados en el tareo de este periodo.
          </div>
        )}
        {erroresTareo.length > 0 && (
          <>
            <h3>Filas con error ({erroresTareo.length})</h3>
            <table>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>DNI</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {erroresTareo.map((e, idx) => (
                  <tr key={idx}>
                    <td>{e.fila}</td>
                    <td>{e.dni}</td>
                    <td>{e.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div style={{ marginTop: 16, position: "relative", maxWidth: 400 }}>
          <label>
            Agregar un trabajador a mano (por DNI o nombre)
            <input
              ref={buscadorAgregarRef}
              type="text"
              value={busquedaAgregar}
              onChange={(e) => setBusquedaAgregar(e.target.value)}
              placeholder="Buscar..."
            />
          </label>
          {contratosFiltrados.length > 0 && (
            <div className="lista-sugerencias">
              {contratosFiltrados.map((c) => (
                <div key={c.id} className="sugerencia" onClick={() => agregarTrabajador(c)}>
                  {c.numero_documento} — {c.apellidos_nombres} ({c.proyecto})
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2>
            Trabajadores con tareo cargado ({tareoFiltrado.length}
            {busquedaTareo.trim() ? ` de ${tareo.length}` : ""})
          </h2>
          <button
            className="primario"
            type="button"
            disabled={seleccionados.size === 0 || eliminandoLote}
            onClick={eliminarSeleccionados}
          >
            {eliminandoLote ? "Quitando..." : `Quitar seleccionados (${seleccionados.size})`}
          </button>
        </div>
        <div style={{ maxWidth: 400, marginBottom: 12 }}>
          <label>
            Buscar en esta lista (por DNI o nombre)
            <input
              ref={buscadorListaRef}
              type="text"
              value={busquedaTareo}
              onChange={(e) => setBusquedaTareo(e.target.value)}
              placeholder="Ej. 12345678 o Perez"
            />
          </label>
        </div>
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={tareoFiltrado.length > 0 && seleccionados.size === tareoFiltrado.length}
                  onChange={alternarSeleccionTodos}
                  title="Seleccionar todos"
                />
              </th>
              <th>DNI</th>
              <th>Trabajador</th>
              <th>Dias trab.</th>
              <th>Dominical</th>
              <th>Feriado</th>
              <th>Faltas</th>
              <th>H.E. 1</th>
              <th>H.E. 2</th>
              <th>H.E. 3</th>
              <th title="Cargado desde Registrar Tareo Diario - solo informativo">Subs. enfermedad</th>
              <th title="Cargado desde Registrar Tareo Diario - solo informativo">Subs. maternidad</th>
              <th title="Cargado desde Registrar Tareo Diario - solo informativo">Lic. paternidad</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tareoFiltrado.map((fila) => (
              <tr key={fila.contrato_id}>
                <td>
                  <input
                    type="checkbox"
                    checked={seleccionados.has(fila.contrato_id)}
                    onChange={() => alternarSeleccion(fila.contrato_id)}
                  />
                </td>
                <td>{fila.numero_documento}</td>
                <td>{fila.apellidos_nombres}</td>
                {CAMPOS_ASISTENCIA.map((campo) => (
                  <td key={campo}>
                    <input
                      type="number"
                      min={0}
                      value={fila[campo]}
                      onChange={(e) => actualizarCampo(fila.contrato_id, campo, Number(e.target.value))}
                      onBlur={() => guardarFila(fila)}
                    />
                  </td>
                ))}
                <td style={{ textAlign: "center", color: "#5a6172" }}>{fila.dias_subsidio_enfermedad ?? 0}</td>
                <td style={{ textAlign: "center", color: "#5a6172" }}>{fila.dias_subsidio_maternidad ?? 0}</td>
                <td style={{ textAlign: "center", color: "#5a6172" }}>{fila.dias_licencia_paternidad ?? 0}</td>
                <td>
                  <button type="button" onClick={() => eliminarFila(fila.contrato_id)}>
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
            {tareo.length === 0 && (
              <tr>
                <td colSpan={14} style={{ textAlign: "center", color: "#5a6172" }}>
                  Todavia no hay tareo cargado para este periodo.
                </td>
              </tr>
            )}
            {tareo.length > 0 && tareoFiltrado.length === 0 && (
              <tr>
                <td colSpan={14} style={{ textAlign: "center", color: "#5a6172" }}>
                  Ningún trabajador cargado coincide con "{busquedaTareo}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ marginTop: 16 }}>
          <button className="primario" onClick={onIrACalcular} disabled={tareo.length === 0}>
            Ir a calcular la planilla
          </button>
        </div>
      </div>
    </div>
  );
}
