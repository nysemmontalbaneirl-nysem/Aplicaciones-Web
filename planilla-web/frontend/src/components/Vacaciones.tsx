import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import { BoletaVacacionesRespuesta, Contrato, RecordVacacional } from "../types";
import BoletaVacaciones from "./BoletaVacaciones";

export default function Vacaciones() {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [contratoSeleccionado, setContratoSeleccionado] = useState<Contrato | null>(null);
  const [record, setRecord] = useState<RecordVacacional | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boletaVista, setBoletaVista] = useState<BoletaVacacionesRespuesta | null>(null);

  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    apiGet<Contrato[]>("/contratos")
      .then((lista) => setContratos(lista.filter((c) => c.categoria_ocupacional === "EMPLEADO")))
      .catch(() => setContratos([]));
  }, []);

  const contratosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return contratos
      .filter(
        (c) =>
          c.numero_documento?.toLowerCase().includes(q) ||
          c.apellidos_nombres?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [busqueda, contratos]);

  async function cargarRecord(contrato: Contrato) {
    setContratoSeleccionado(contrato);
    setBusqueda("");
    setError(null);
    setCargando(true);
    try {
      const datos = await apiGet<RecordVacacional>(`/vacaciones/${contrato.id}`);
      setRecord(datos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar el récord vacacional");
      setRecord(null);
    } finally {
      setCargando(false);
    }
  }

  async function registrarGoce() {
    if (!contratoSeleccionado) return;
    if (!fechaInicio || !fechaFin) {
      setError("Debes indicar fecha de inicio y fecha de fin");
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      await apiPost(`/vacaciones/${contratoSeleccionado.id}/goce`, {
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        observaciones: observaciones || null,
      });
      setFechaInicio("");
      setFechaFin("");
      setObservaciones("");
      await cargarRecord(contratoSeleccionado);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar el goce de vacaciones");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarGoce(goceId: number) {
    if (!contratoSeleccionado) return;
    if (!confirm("¿Eliminar este registro de vacaciones tomadas? También se eliminará su boleta.")) return;
    setError(null);
    try {
      await apiDelete(`/vacaciones/${contratoSeleccionado.id}/goce/${goceId}`);
      await cargarRecord(contratoSeleccionado);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar el registro");
    }
  }

  async function verBoleta(goceId: number) {
    if (!contratoSeleccionado) return;
    setError(null);
    try {
      const datos = await apiGet<BoletaVacacionesRespuesta>(
        `/vacaciones/${contratoSeleccionado.id}/goce/${goceId}/boleta`
      );
      setBoletaVista(datos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar la boleta de vacaciones");
    }
  }

  return (
    <div className="card">
      <h2>Vacaciones de Empleados</h2>
      <p style={{ color: "#5a6172", marginBottom: 16 }}>
        Récord vacacional anual (aniversario a aniversario) para trabajadores en régimen general
        (categoría Empleado). Se exige un mínimo de 260 días efectivos laborados en el año
        (jornada de 6 días semanales) para tener derecho a los 30 días completos de descanso; si no
        se llega al récord, los días ganados se calculan de forma proporcional.
      </p>

      <div style={{ position: "relative", maxWidth: 420, marginBottom: 20 }}>
        <label>
          Buscar trabajador (DNI o nombres)
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Escribe al menos 2 caracteres..."
          />
        </label>
        {contratosFiltrados.length > 0 && (
          <div className="lista-sugerencias">
            {contratosFiltrados.map((c) => (
              <div key={c.id} className="sugerencia" onClick={() => cargarRecord(c)}>
                {c.apellidos_nombres} — {c.numero_documento} ({c.proyecto})
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {cargando && <p>Cargando...</p>}

      {record && !cargando && (
        <>
          <h3 className="seccion-titulo">
            {record.contrato.apellidos_nombres} — {record.contrato.numero_documento}
          </h3>
          <p style={{ color: "#5a6172" }}>
            Proyecto: {record.contrato.proyecto} · Fecha de ingreso:{" "}
            {new Date(record.contrato.fecha_ingreso).toLocaleDateString("es-PE")}
            {record.contrato.fecha_cese &&
              ` · Fecha de cese: ${new Date(record.contrato.fecha_cese).toLocaleDateString("es-PE")}`}
          </p>

          <div style={{ display: "flex", gap: 24, margin: "16px 0" }}>
            <div>
              <strong>Total ganado:</strong> {record.total_ganado} días
            </div>
            <div>
              <strong>Total gozado:</strong> {record.total_gozado} días
            </div>
            <div>
              <strong>Saldo pendiente:</strong> {record.saldo_pendiente} días
            </div>
          </div>

          <h3 className="seccion-titulo">Períodos vacacionales</h3>
          <table>
            <thead>
              <tr>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Días computables</th>
                <th>¿Cumplió récord ({record.umbral_dias_record})?</th>
                <th>Días ganados</th>
              </tr>
            </thead>
            <tbody>
              {record.periodos.map((p, i) => (
                <tr key={i}>
                  <td>{new Date(p.fecha_inicio).toLocaleDateString("es-PE")}</td>
                  <td>{new Date(p.fecha_fin).toLocaleDateString("es-PE")}</td>
                  <td>{p.dias_computables}</td>
                  <td>{p.cumplio_record ? "Sí" : "No"}</td>
                  <td>{p.dias_ganados}</td>
                </tr>
              ))}
              {record.periodos.length === 0 && (
                <tr>
                  <td colSpan={5}>Aún no se completa un período vacacional desde el ingreso.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h3 className="seccion-titulo">Registrar vacaciones tomadas</h3>
          <div className="form-grid">
            <label>
              Fecha de inicio
              <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
            </label>
            <label>
              Fecha de fin
              <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
            </label>
            <label>
              Observaciones (opcional)
              <input
                type="text"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
              />
            </label>
          </div>
          <button type="button" className="primario" onClick={registrarGoce} disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar goce"}
          </button>

          <h3 className="seccion-titulo">Historial de vacaciones tomadas</h3>
          <p style={{ color: "#5a6172", marginTop: -8 }}>
            Cada registro genera automáticamente su propia boleta de vacaciones (documento separado de la
            planilla mensual).
          </p>
          <table>
            <thead>
              <tr>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Días</th>
                <th>Neto pagado</th>
                <th>Observaciones</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {record.goces.map((g) => (
                <tr key={g.id}>
                  <td>{new Date(g.fecha_inicio).toLocaleDateString("es-PE")}</td>
                  <td>{new Date(g.fecha_fin).toLocaleDateString("es-PE")}</td>
                  <td>{g.dias}</td>
                  <td>{g.boleta_neto_pagar != null ? `S/ ${Number(g.boleta_neto_pagar).toFixed(2)}` : "-"}</td>
                  <td>{g.observaciones ?? "-"}</td>
                  <td style={{ display: "flex", gap: 8 }}>
                    {g.boleta_id != null && (
                      <button type="button" onClick={() => verBoleta(g.id)}>
                        Ver boleta
                      </button>
                    )}
                    <button type="button" onClick={() => eliminarGoce(g.id)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {record.goces.length === 0 && (
                <tr>
                  <td colSpan={6}>Sin registros de vacaciones tomadas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {boletaVista && <BoletaVacaciones datos={boletaVista} onCerrar={() => setBoletaVista(null)} />}
    </div>
  );
}
