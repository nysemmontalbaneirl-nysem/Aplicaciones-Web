// Pantalla "Planilla Mensual" (Ronda E, migracion_034): junta el Tareo
// Diario de todas las quincenas/semanas de un proyecto en un solo calculo
// por MES CALENDARIO, para poder declarar PLAME/AFPnet/Asiento Contable por
// mes en vez de por periodo de pago. Aplica solo a obreros (construccion
// civil) - Empleados ya declaran por su propio periodo MENSUAL, que ya
// cubre el mes calendario completo. Ver src/planillaMensual.ts (backend).
import { useEffect, useState } from "react";
import { apiDescargarArchivo, apiGet, apiPost, ErrorApi } from "../api";
import { useAuth } from "../AuthContext";
import {
  AvisoRecalculoPosteriorMensual,
  PlanillaMensualConsolidada,
  Proyecto,
  ResultadoConsolidacion,
} from "../types";

// NOTA (recon 19/46): el parche original tambien traia un boton "Descargar
// Asiento Contable (Excel)" (con su interfaz FaltanteMapeoContable y el
// manejo del error 400 "faltan cuentas contables por configurar"). Se omite
// aqui porque la ruta backend equivalente (GET .../exportar/asiento-contable)
// no se agrego - depende de "src/asientoContable.ts", que no existe en este
// arbol (ver RECONSTRUCCION_BRECHAS.md punto 5). Reagregar cuando ese modulo
// se reconstruya, siguiendo el mismo patron de descarga de REM/AFPnet.

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

function formato2(valor: number | string): string {
  return Number(valor).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PlanillaMensual() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "ADMIN";

  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [proyecto, setProyecto] = useState("");
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [mes, setMes] = useState(new Date().getMonth() + 1);

  const [cargando, setCargando] = useState(false);
  const [consolidando, setConsolidando] = useState(false);
  const [descargando, setDescargando] = useState<"rem" | "afpnet" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [consolidado, setConsolidado] = useState<PlanillaMensualConsolidada | null>(null);
  const [noConsolidado, setNoConsolidado] = useState(false);
  const [avisos, setAvisos] = useState<AvisoRecalculoPosteriorMensual[]>([]);
  const [erroresConsolidacion, setErroresConsolidacion] = useState<ResultadoConsolidacion["errores"]>([]);

  // Un usuario no-ADMIN solo puede elegir entre los proyectos que tiene
  // asignados (mismo criterio que Periodos.tsx).
  const proyectosDisponibles = esAdmin ? proyectos : proyectos.filter((p) => usuario?.proyectos.includes(p.nombre));

  useEffect(() => {
    apiGet<Proyecto[]>("/proyectos")
      .then(setProyectos)
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!proyecto && proyectosDisponibles.length > 0) {
      setProyecto(proyectosDisponibles[0].nombre);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectosDisponibles.length]);

  useEffect(() => {
    if (!proyecto) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyecto, anio, mes]);

  async function cargar() {
    setCargando(true);
    setError(null);
    setNoConsolidado(false);
    try {
      const datos = await apiGet<PlanillaMensualConsolidada>(
        `/planilla-mensual?proyecto=${encodeURIComponent(proyecto)}&anio=${anio}&mes=${mes}`
      );
      setConsolidado(datos);
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 404) {
        setConsolidado(null);
        setNoConsolidado(true);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setCargando(false);
    }
  }

  async function consolidar() {
    setConsolidando(true);
    setError(null);
    setAvisos([]);
    setErroresConsolidacion([]);
    try {
      const r = await apiPost<ResultadoConsolidacion>("/planilla-mensual/consolidar", { proyecto, anio, mes });
      setAvisos(r.avisos_recalculo_posterior);
      setErroresConsolidacion(r.errores);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConsolidando(false);
    }
  }

  async function descargar(tipoArchivo: "rem" | "afpnet", ruta: string, nombreArchivo: string) {
    if (!consolidado) return;
    setError(null);
    setDescargando(tipoArchivo);
    try {
      await apiDescargarArchivo(`/planilla-mensual/${consolidado.planillaMensual.id}${ruta}`, nombreArchivo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDescargando(null);
    }
  }

  const nroDoc = `${anio}${String(mes).padStart(2, "0")}`;

  return (
    <div>
      <div className="card">
        <h2>Planilla Mensual Consolidada</h2>
        <p style={{ color: "#5a6172", maxWidth: 800 }}>
          Junta el Tareo Diario de todas las quincenas/semanas de un proyecto en un solo calculo por MES CALENDARIO,
          para poder declarar PLAME, AFPnet y el Asiento Contable por mes en vez de por periodo de pago. Aplica solo
          a obreros (construccion civil) - Empleados ya declaran por su propio periodo mensual, que ya cubre el mes
          completo.
        </p>

        {error && <div className="mensaje-error">{error}</div>}

        <div className="form-grid" style={{ maxWidth: 500 }}>
          <label>
            Proyecto
            <select value={proyecto} onChange={(e) => setProyecto(e.target.value)}>
              {proyectosDisponibles.length === 0 && <option value="">No tienes proyectos asignados</option>}
              {proyectosDisponibles.map((p) => (
                <option key={p.id} value={p.nombre}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            Año
            <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} />
          </label>
          <label>
            Mes
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
              {MESES.map((nombreMes, i) => (
                <option key={i} value={i + 1}>
                  {nombreMes}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button className="primario" type="button" onClick={consolidar} disabled={!proyecto || consolidando}>
          {consolidando ? "Consolidando..." : consolidado ? "Volver a consolidar este mes" : "Consolidar mes"}
        </button>

        {erroresConsolidacion.length > 0 && (
          <div className="mensaje-error" style={{ marginTop: 12 }}>
            {erroresConsolidacion.length} trabajador(es) no se pudieron consolidar:
            <ul>
              {erroresConsolidacion.map((e) => (
                <li key={e.contrato_id}>
                  {e.dni} - {e.nombre}: {e.motivo}
                </li>
              ))}
            </ul>
          </div>
        )}

        {avisos.length > 0 && (
          <div className="mensaje-advertencia" style={{ marginTop: 12 }}>
            {avisos.length} periodo(s) usados en esta consolidacion se volvieron a calcular DESPUES de la ultima vez
            que se consolido este mes (foto historica: esta consolidacion ya quedo guardada con los datos actuales,
            pero si vuelves a corregir esas quincenas, recuerda presionar "Volver a consolidar este mes" de nuevo).
          </div>
        )}
      </div>

      {cargando && <div className="card">Cargando...</div>}

      {noConsolidado && !cargando && (
        <div className="card">
          Este mes todavia no se ha consolidado para "{proyecto}". Presiona "Consolidar mes" arriba.
        </div>
      )}

      {consolidado && !cargando && (
        <div className="card">
          <h2>
            {MESES[consolidado.planillaMensual.mes - 1]} {consolidado.planillaMensual.anio} — {proyecto} (
            {consolidado.detalle.length} trabajador{consolidado.detalle.length === 1 ? "" : "es"})
          </h2>
          <p style={{ fontSize: "0.85rem", color: "#5a6172" }}>
            Ultima consolidacion: {new Date(consolidado.planillaMensual.calculado_en).toLocaleString("es-PE")}
          </p>

          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={descargando === "rem"}
              onClick={() => descargar("rem", "/exportar/rem", `${nroDoc}_mensual.rem`)}
            >
              {descargando === "rem" ? "Generando..." : "Descargar REM (PLAME)"}
            </button>
            <button
              type="button"
              disabled={descargando === "afpnet"}
              onClick={() => descargar("afpnet", "/exportar/afpnet", `AFPnet_${nroDoc}_mensual.csv`)}
            >
              {descargando === "afpnet" ? "Generando..." : "Descargar AFPnet (CSV)"}
            </button>
          </div>

          <div style={{ overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>DNI</th>
                  <th>Trabajador</th>
                  <th>Categoria</th>
                  <th>Dias trab.</th>
                  <th>Sueldo basico</th>
                  <th>Gratificacion</th>
                  <th>CTS</th>
                  <th>Total ingresos</th>
                  <th>Total descuentos</th>
                  <th>Neto a pagar</th>
                </tr>
              </thead>
              <tbody>
                {consolidado.detalle.map((f) => (
                  <tr key={f.contrato_id}>
                    <td>{f.numero_documento}</td>
                    <td>{f.apellidos_nombres}</td>
                    <td>{f.categoria_ocupacional}</td>
                    <td>{f.dias_trabajados}</td>
                    <td>{formato2(f.sueldo_basico)}</td>
                    <td>{formato2(f.gratificacion)}</td>
                    <td>{formato2(f.cts)}</td>
                    <td>{formato2(f.total_ingresos)}</td>
                    <td>{formato2(f.total_descuentos)}</td>
                    <td>{formato2(f.neto_pagar)}</td>
                  </tr>
                ))}
                {consolidado.detalle.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ textAlign: "center", color: "#5a6172" }}>
                      No hay trabajadores consolidados este mes.
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
