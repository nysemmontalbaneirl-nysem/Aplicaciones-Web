import { Fragment, useEffect, useState } from "react";
import { apiGet } from "../api";
import { EntradaBitacora, RespuestaBitacora } from "../types";

const ETIQUETAS_ACCION: Record<string, string> = {
  EDICION_CONCEPTO_PLANILLA: "Editó un concepto de planilla",
  RESTAURAR_CONCEPTOS_PLANILLA: "Restauró los conceptos a sus valores originales",
  CREAR_PARAMETROS_MENSUALES: "Creó tasas/tabla salarial de un mes",
  EDICION_PARAMETROS_MENSUALES: "Editó tasas/tabla salarial de un mes",
  CREAR_PARAMETROS_ANUALES: "Creó parámetros de un año",
  EDICION_PARAMETROS_ANUALES: "Editó parámetros de un año",
  QUITAR_TRABAJADOR_TAREO: "Quitó un trabajador del tareo",
  CALCULO_PLANILLA: "Calculó una planilla",
  ELIMINAR_PERIODO: "Eliminó un período",
  CESE_TRABAJADOR: "Dio de baja a un trabajador",
  CREAR_USUARIO: "Creó un usuario",
  EDICION_USUARIO: "Editó un usuario",
};

function etiquetaAccion(accion: string): string {
  return ETIQUETAS_ACCION[accion] ?? accion;
}

export default function Bitacora() {
  const [datos, setDatos] = useState<RespuestaBitacora | null>(null);
  const [acciones, setAcciones] = useState<string[]>([]);
  const [pagina, setPagina] = useState(1);
  const [filtroAccion, setFiltroAccion] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");
  const [expandido, setExpandido] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<string[]>("/bitacora/acciones")
      .then(setAcciones)
      .catch(() => setAcciones([]));
  }, []);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, filtroAccion, filtroDesde, filtroHasta]);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("pagina", String(pagina));
      if (filtroAccion) params.set("accion", filtroAccion);
      if (filtroDesde) params.set("desde", filtroDesde);
      if (filtroHasta) params.set("hasta", filtroHasta);
      const resultado = await apiGet<RespuestaBitacora>(`/bitacora?${params.toString()}`);
      setDatos(resultado);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar la bitácora");
    } finally {
      setCargando(false);
    }
  }

  function cambiarFiltro(fn: () => void) {
    fn();
    setPagina(1);
  }

  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.por_pagina)) : 1;

  return (
    <div className="card">
      <h2>Bitácora de auditoría</h2>
      <p style={{ color: "#5a6172", marginBottom: 16, maxWidth: 800 }}>
        Registro de acciones sensibles: quién cambió una tasa o un concepto de planilla, quién dio de baja a un
        trabajador, quién calculó o eliminó un período, y quién creó o editó un usuario. Es de solo lectura — no
        se puede editar ni borrar, para que sea un respaldo confiable si algún día hay que revisar qué pasó.
      </p>

      <div className="form-grid" style={{ marginBottom: 16 }}>
        <label>
          Acción
          <select value={filtroAccion} onChange={(e) => cambiarFiltro(() => setFiltroAccion(e.target.value))}>
            <option value="">Todas</option>
            {acciones.map((a) => (
              <option key={a} value={a}>
                {etiquetaAccion(a)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input
            type="date"
            value={filtroDesde}
            onChange={(e) => cambiarFiltro(() => setFiltroDesde(e.target.value))}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={filtroHasta}
            onChange={(e) => cambiarFiltro(() => setFiltroHasta(e.target.value))}
          />
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      {cargando && <p>Cargando...</p>}

      {!cargando && datos && (
        <>
          <table>
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Tabla afectada</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {datos.registros.map((entrada: EntradaBitacora) => (
                <Fragment key={entrada.id}>
                  <tr>
                    <td>{new Date(entrada.fecha).toLocaleString("es-PE")}</td>
                    <td>{entrada.usuario_nombre ?? "(usuario eliminado)"}</td>
                    <td>{etiquetaAccion(entrada.accion)}</td>
                    <td>
                      {entrada.tabla_afectada}
                      {entrada.registro_id != null ? ` #${entrada.registro_id}` : ""}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setExpandido(expandido === entrada.id ? null : entrada.id)}
                      >
                        {expandido === entrada.id ? "Ocultar" : "Ver detalle"}
                      </button>
                    </td>
                  </tr>
                  {expandido === entrada.id && (
                    <tr>
                      <td colSpan={5}>
                        <pre
                          style={{
                            background: "#f7f8fa",
                            padding: 12,
                            borderRadius: 4,
                            fontSize: "0.82rem",
                            overflowX: "auto",
                            margin: 0,
                          }}
                        >
                          {JSON.stringify(entrada.detalle, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {datos.registros.length === 0 && (
                <tr>
                  <td colSpan={5}>No hay registros con estos filtros.</td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
            <span style={{ color: "#5a6172", fontSize: "0.9rem" }}>
              {datos.total} registro{datos.total === 1 ? "" : "s"} · página {pagina} de {totalPaginas}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1}>
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                disabled={pagina >= totalPaginas}
              >
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
