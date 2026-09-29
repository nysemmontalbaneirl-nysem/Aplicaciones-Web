import { Fragment, useEffect, useState } from "react";
import { apiGet, apiPost, apiPostArchivo, apiPut, BASE_URL, conToken } from "../api";
import { ImportacionMarcaciones, ImportacionMarcacionesDetalle, PeriodoPlanilla } from "../types";

interface Props {
  periodo: PeriodoPlanilla;
}

interface ResultadoAplicar {
  aplicados: number[];
  errores: { contrato_id: number; motivo: string }[];
}

// Formatea horas+minutos como "2h 30m" (u "-" si esta todo en 0), para no
// mostrar una fila de ceros en cada columna de la tabla de revision.
function horasMinutos(horas: number, minutos: number): string {
  if (!horas && !minutos) return "-";
  return `${horas}h ${String(minutos).padStart(2, "0")}m`;
}

export default function ImportarMarcaciones({ periodo }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  const [importaciones, setImportaciones] = useState<ImportacionMarcaciones[]>([]);
  const [importacionActual, setImportacionActual] = useState<ImportacionMarcaciones | null>(null);
  const [detalle, setDetalle] = useState<ImportacionMarcacionesDetalle[]>([]);
  const [resultadoAplicar, setResultadoAplicar] = useState<ResultadoAplicar | null>(null);
  const [marcasAbiertas, setMarcasAbiertas] = useState<number | null>(null);
  const [actualizandoAnticipacion, setActualizandoAnticipacion] = useState<number | null>(null);

  async function cargarLista() {
    const lista = await apiGet<ImportacionMarcaciones[]>(`/periodos/${periodo.id}/marcaciones`);
    setImportaciones(lista);
    return lista;
  }

  async function abrirImportacion(id: number) {
    setError(null);
    setResultadoAplicar(null);
    try {
      const datos = await apiGet<{ importacion: ImportacionMarcaciones; detalle: ImportacionMarcacionesDetalle[] }>(
        `/periodos/${periodo.id}/marcaciones/${id}`
      );
      setImportacionActual(datos.importacion);
      setDetalle(datos.detalle);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Confirma o retira el pago de la "llegada anticipada" de un dia como
  // hora extra (el importador nunca la paga automatico - ver nota en el
  // backend, calcularJornadaDesdeMarcas). Recalcula solo esa fila; el
  // resto del detalle ya visible no cambia.
  async function alternarAnticipacion(d: ImportacionMarcacionesDetalle) {
    if (!importacionActual) return;
    setError(null);
    setActualizandoAnticipacion(d.id);
    try {
      const actualizado = await apiPut<Partial<ImportacionMarcacionesDetalle>>(
        `/periodos/${periodo.id}/marcaciones/${importacionActual.id}/detalle/${d.id}`,
        { anticipacion_pagada: !d.anticipacion_pagada }
      );
      setDetalle((lista) => lista.map((fila) => (fila.id === d.id ? { ...fila, ...actualizado } : fila)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActualizandoAnticipacion(null);
    }
  }

  useEffect(() => {
    cargarLista()
      .then((lista) => {
        if (lista.length > 0) abrirImportacion(lista[0].id);
      })
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo.id]);

  async function cargarArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;

    setError(null);
    setResultadoAplicar(null);
    setSubiendo(true);
    try {
      const formData = new FormData();
      formData.append("archivo", archivo);
      const resultado = await apiPostArchivo<{ importacion_id: number }>(
        `/periodos/${periodo.id}/marcaciones/importar`,
        formData
      );
      await cargarLista();
      await abrirImportacion(resultado.importacion_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  async function aplicar() {
    if (!importacionActual) return;
    setError(null);
    setAplicando(true);
    try {
      const resultado = await apiPost<ResultadoAplicar>(
        `/periodos/${periodo.id}/marcaciones/${importacionActual.id}/aplicar`,
        {}
      );
      setResultadoAplicar(resultado);
      await cargarLista();
      await abrirImportacion(importacionActual.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAplicando(false);
    }
  }

  const pendientes = detalle.filter((d) => !d.aplicado).length;

  return (
    <div>
      {error && <div className="mensaje-error">{error}</div>}

      <div className="card">
        <h2 className="titulo-reporte">
          Importar marcaciones — {periodo.mes}/{periodo.anio}
        </h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          Sube el Excel/CSV con 1 fila por cada marcacion individual (DNI, nombre, fecha, hora,
          tipo ENTRADA/SALIDA). El sistema agrupa las marcas por trabajador y dia, calcula
          automaticamente las horas normales y extra comparando la primera y ultima marca contra
          el horario configurado del proyecto, y las deja abajo para tu revision — nada se aplica
          al Tareo Diario hasta que apruebes con el boton "Aplicar al Tareo Diario".
        </p>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          Si alguien marca su ingreso antes de la hora programada, ese tiempo NO se paga como
          hora extra en forma automatica — la fila queda resaltada con ⚠ "Llegada anticipada" y
          tu decides, con la casilla de esa columna, si confirmas pagarlo como extra o no. Una
          salida despues de la hora programada si se sigue acreditando como extra automaticamente
          (eso no cambia).
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a href={conToken(`${BASE_URL}/periodos/${periodo.id}/marcaciones/plantilla`)}>
            <button type="button">Descargar plantilla Excel</button>
          </a>
          <input type="file" accept=".xlsx,.csv" onChange={cargarArchivo} disabled={subiendo} />
          {subiendo && <span>Cargando...</span>}
        </div>
        <p style={{ color: "#5a6172", fontSize: "0.82rem" }}>
          La plantilla ya trae el DNI, el proyecto y el nombre de cada trabajador (la columna
          PROYECTO solo hace falta cuando un DNI tiene mas de un contrato activo) - completa la
          FECHA y la HORA de cada marcacion, y duplica el par de filas ENTRADA/SALIDA por cada
          dia adicional.
        </p>

        {importaciones.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <label>
              Importaciones anteriores de este periodo:{" "}
              <select
                value={importacionActual?.id ?? ""}
                onChange={(e) => abrirImportacion(Number(e.target.value))}
              >
                {importaciones.map((imp) => (
                  <option key={imp.id} value={imp.id}>
                    {new Date(imp.importado_en).toLocaleString("es-PE")} — {imp.nombre_archivo ?? "archivo"} (
                    {imp.total_dias} dias{imp.aplicado_en ? ", aplicada" : ""})
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {importacionActual && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>
            Revision — {importacionActual.nombre_archivo} ({importacionActual.total_dias} dias
            calculados, {importacionActual.total_errores} filas con error)
          </h3>

          {importacionActual.errores.length > 0 && (
            <>
              <h4>Filas con error ({importacionActual.errores.length})</h4>
              <table>
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>DNI</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {importacionActual.errores.map((e, idx) => (
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

          {detalle.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Trabajador</th>
                  <th>Fecha</th>
                  <th>Ingreso</th>
                  <th>Salida</th>
                  <th>Normal</th>
                  <th>Extra T1</th>
                  <th>Extra T2</th>
                  <th>Extra T3</th>
                  <th>Dominical</th>
                  <th>Feriado</th>
                  <th>Llegada anticipada</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {detalle.map((d) => (
                  <Fragment key={d.id}>
                    <tr style={d.minutos_llegada_anticipada > 0 ? { background: "#fff8e1" } : undefined}>
                      <td>
                        {d.numero_documento} — {d.apellidos_nombres}
                      </td>
                      <td>{d.fecha.slice(0, 10)}</td>
                      <td>{d.hora_ingreso_real?.slice(0, 5) ?? "-"}</td>
                      <td>{d.hora_salida_real?.slice(0, 5) ?? "-"}</td>
                      <td>{horasMinutos(d.horas_normales, d.minutos_normales)}</td>
                      <td>{horasMinutos(d.horas_extra_tramo1, d.minutos_extra_tramo1)}</td>
                      <td>{horasMinutos(d.horas_extra_tramo2, d.minutos_extra_tramo2)}</td>
                      <td>{horasMinutos(d.horas_extra_tramo3, d.minutos_extra_tramo3)}</td>
                      <td>{horasMinutos(d.horas_dominical, d.minutos_dominical)}</td>
                      <td>{horasMinutos(d.horas_feriado, d.minutos_feriado)}</td>
                      <td>
                        {d.minutos_llegada_anticipada > 0 ? (
                          <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                            <input
                              type="checkbox"
                              checked={d.anticipacion_pagada}
                              disabled={d.aplicado || actualizandoAnticipacion === d.id}
                              onChange={() => alternarAnticipacion(d)}
                            />
                            <span title="Llego antes de la hora de ingreso programada. Marca la casilla para pagar ese tiempo como hora extra.">
                              ⚠ {Math.floor(d.minutos_llegada_anticipada / 60)}h{" "}
                              {String(d.minutos_llegada_anticipada % 60).padStart(2, "0")}m
                              {d.anticipacion_pagada ? " (se paga)" : " (no se paga)"}
                            </span>
                          </label>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{d.aplicado ? "Aplicado" : "Pendiente"}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setMarcasAbiertas(marcasAbiertas === d.id ? null : d.id)}
                        >
                          {marcasAbiertas === d.id ? "Ocultar marcas" : "Ver marcas"}
                        </button>
                      </td>
                    </tr>
                    {marcasAbiertas === d.id && (
                      <tr>
                        <td colSpan={13} style={{ background: "#f7f8fa" }}>
                          Marcas registradas ese dia:{" "}
                          {d.marcas.map((m) => `${m.hora}${m.tipo ? ` (${m.tipo})` : ""}`).join(", ")}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}

          {detalle.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button type="button" onClick={aplicar} disabled={aplicando || pendientes === 0}>
                {aplicando
                  ? "Aplicando..."
                  : pendientes === 0
                    ? "Ya se aplico todo lo calculado"
                    : `Aplicar al Tareo Diario (${pendientes} dias pendientes)`}
              </button>
            </div>
          )}

          {resultadoAplicar && (
            <div style={{ marginTop: 12 }}>
              {resultadoAplicar.aplicados.length > 0 && (
                <div className="mensaje-ok">
                  {resultadoAplicar.aplicados.length} trabajador(es) aplicados correctamente al
                  Tareo Diario.
                </div>
              )}
              {resultadoAplicar.errores.length > 0 && (
                <div className="mensaje-error">
                  {resultadoAplicar.errores.map((e, idx) => (
                    <div key={idx}>
                      Contrato #{e.contrato_id}: {e.motivo}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
