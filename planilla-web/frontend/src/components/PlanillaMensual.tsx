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
  DetallePlanillaMensualFila,
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

// Columnas monetarias fijas de la tabla de resumen, agrupadas igual que las
// suma calcularLineaPlanilla/sumarResultadosLinea (motorCalculo.ts): Ingresos
// (suman total_ingresos), Descuentos (retenidos al trabajador, suman
// total_descuentos) y Aportes del empleador (essalud/sctr/senati/seguro de
// vida - no se descuentan al trabajador). Pedido por el usuario (17/09/2026):
// "deberian salir en el reporte todos los ingresos, aportes y descuentos" -
// antes esta pantalla solo mostraba Sueldo basico, Gratificacion y CTS,
// dejando fuera BUC/Asignaciones/Movilidad/etc. aunque ya estaban calculados
// y guardados en detalle_planilla_mensual.
type ColumnaConcepto = { etiqueta: string; campo: keyof DetallePlanillaMensualFila };

const COLUMNAS_INGRESOS: ColumnaConcepto[] = [
  { etiqueta: "Sueldo basico", campo: "sueldo_basico" },
  { etiqueta: "Rem. dominical", campo: "remuneracion_dominical" },
  { etiqueta: "Dominical proporcional", campo: "remuneracion_dominical_proporcional" },
  { etiqueta: "Rem. feriado", campo: "remuneracion_feriado" },
  { etiqueta: "Sobretasa dominical", campo: "sobretasa_dominical" },
  { etiqueta: "Sobretasa feriado", campo: "sobretasa_feriado" },
  { etiqueta: "Horas extra", campo: "importe_horas_extra" },
  { etiqueta: "Asignacion familiar", campo: "asignacion_familiar" },
  { etiqueta: "Asignacion escolaridad", campo: "asignacion_escolaridad" },
  { etiqueta: "BUC", campo: "bonificacion_buc" },
  { etiqueta: "BAE", campo: "bonificacion_bae" },
  { etiqueta: "Movilidad", campo: "bonificacion_movilidad" },
  { etiqueta: "Condicion de trabajo", campo: "condicion_trabajo" },
  { etiqueta: "Subsidio enfermedad", campo: "subsidio_enfermedad" },
  { etiqueta: "Licencia paternidad", campo: "licencia_paternidad" },
  { etiqueta: "Otras bonificaciones", campo: "otras_bonificaciones" },
  { etiqueta: "Gratificacion", campo: "gratificacion" },
  { etiqueta: "Bonificacion extraordinaria", campo: "bonificacion_extraordinaria" },
  { etiqueta: "CTS", campo: "cts" },
  { etiqueta: "Vacaciones", campo: "vacaciones" },
];

const COLUMNAS_DESCUENTOS: ColumnaConcepto[] = [
  { etiqueta: "Aporte pension (ONP/AFP)", campo: "aporte_pension" },
  { etiqueta: "Cuota sindical", campo: "descuento_sindicato" },
  { etiqueta: "CONAFOVICER", campo: "conafovicer" },
  { etiqueta: "Renta 5ta", campo: "renta_5ta" },
  { etiqueta: "Otros descuentos", campo: "otros_descuentos" },
];

const COLUMNAS_APORTES_EMPLEADOR: ColumnaConcepto[] = [
  { etiqueta: "EsSalud", campo: "essalud" },
  { etiqueta: "SCTR", campo: "sctr" },
  { etiqueta: "SENATI", campo: "senati" },
  { etiqueta: "Seguro de vida", campo: "seguro_vida" },
];

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

function formato2(valor: number | string): string {
  return Number(valor).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Conceptos personalizados (formula propia, Configuracion): varian de una
// empresa a otra, asi que las columnas se arman dinamicamente a partir de lo
// que realmente aparece en el mes consolidado (no hay una lista fija como
// con COLUMNAS_INGRESOS/DESCUENTOS/APORTES_EMPLEADOR de arriba).
function conceptosPersonalizadosPorTipo(
  detalle: DetallePlanillaMensualFila[],
  tipo: "INGRESO" | "DESCUENTO" | "APORTE"
): { codigo: string; nombre: string }[] {
  const vistos = new Map<string, string>();
  for (const fila of detalle) {
    for (const cp of fila.conceptos_personalizados ?? []) {
      if (cp.tipo === tipo && !vistos.has(cp.codigo)) vistos.set(cp.codigo, cp.nombre);
    }
  }
  return [...vistos.entries()].map(([codigo, nombre]) => ({ codigo, nombre }));
}

function montoPersonalizado(fila: DetallePlanillaMensualFila, codigo: string): number {
  return fila.conceptos_personalizados?.find((cp) => cp.codigo === codigo)?.monto ?? 0;
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

          {(() => {
            const personalizadosIngreso = conceptosPersonalizadosPorTipo(consolidado.detalle, "INGRESO");
            const personalizadosDescuento = conceptosPersonalizadosPorTipo(consolidado.detalle, "DESCUENTO");
            const personalizadosAporte = conceptosPersonalizadosPorTipo(consolidado.detalle, "APORTE");
            const totalColumnas =
              4 +
              COLUMNAS_INGRESOS.length +
              personalizadosIngreso.length +
              COLUMNAS_DESCUENTOS.length +
              personalizadosDescuento.length +
              COLUMNAS_APORTES_EMPLEADOR.length +
              personalizadosAporte.length +
              3;

            // Encabezado de UNA sola fila (no 2 filas con colSpan/rowSpan):
            // el "position: sticky" de esta tabla (ver .tabla-scroll-horizontal
            // en el CSS) esta pensado para una sola fila de <th> fija arriba -
            // con 2 filas, ambas quedarian ancladas en el mismo "top: 0" al
            // hacer scroll vertical y se superpondrian. En su lugar, el inicio
            // de cada grupo (Ingresos/Descuentos/Aportes/Totales) se marca con
            // un separador visual (borde izquierdo), mismo criterio simple que
            // ya usa el reporte Excel de Reportes.tsx (columnas planas, sin
            // agrupar).
            const separador = { borderLeft: "2px solid #d8dce6" };
            return (
              <div className="tabla-scroll-horizontal">
                <table>
                  <thead>
                    <tr>
                      <th>DNI</th>
                      <th>Trabajador</th>
                      <th>Categoria</th>
                      <th>Dias trab.</th>
                      {COLUMNAS_INGRESOS.map((c, i) => (
                        <th key={c.campo} style={i === 0 ? separador : undefined}>
                          {c.etiqueta}
                        </th>
                      ))}
                      {personalizadosIngreso.map((c) => (
                        <th key={c.codigo}>{c.nombre}</th>
                      ))}
                      {COLUMNAS_DESCUENTOS.map((c, i) => (
                        <th key={c.campo} style={i === 0 ? separador : undefined}>
                          {c.etiqueta}
                        </th>
                      ))}
                      {personalizadosDescuento.map((c) => (
                        <th key={c.codigo}>{c.nombre}</th>
                      ))}
                      {COLUMNAS_APORTES_EMPLEADOR.map((c, i) => (
                        <th key={c.campo} style={i === 0 ? separador : undefined}>
                          {c.etiqueta}
                        </th>
                      ))}
                      {personalizadosAporte.map((c) => (
                        <th key={c.codigo}>{c.nombre}</th>
                      ))}
                      <th style={separador}>Total ingresos</th>
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
                        {COLUMNAS_INGRESOS.map((c, i) => (
                          <td key={c.campo} style={i === 0 ? separador : undefined}>
                            {formato2(f[c.campo] as number)}
                          </td>
                        ))}
                        {personalizadosIngreso.map((c) => (
                          <td key={c.codigo}>{formato2(montoPersonalizado(f, c.codigo))}</td>
                        ))}
                        {COLUMNAS_DESCUENTOS.map((c, i) => (
                          <td key={c.campo} style={i === 0 ? separador : undefined}>
                            {formato2(f[c.campo] as number)}
                          </td>
                        ))}
                        {personalizadosDescuento.map((c) => (
                          <td key={c.codigo}>{formato2(montoPersonalizado(f, c.codigo))}</td>
                        ))}
                        {COLUMNAS_APORTES_EMPLEADOR.map((c, i) => (
                          <td key={c.campo} style={i === 0 ? separador : undefined}>
                            {formato2(f[c.campo] as number)}
                          </td>
                        ))}
                        {personalizadosAporte.map((c) => (
                          <td key={c.codigo}>{formato2(montoPersonalizado(f, c.codigo))}</td>
                        ))}
                        <td style={separador}>{formato2(f.total_ingresos)}</td>
                        <td>{formato2(f.total_descuentos)}</td>
                        <td>{formato2(f.neto_pagar)}</td>
                      </tr>
                    ))}
                    {consolidado.detalle.length === 0 && (
                      <tr>
                        <td colSpan={totalColumnas} style={{ textAlign: "center", color: "#5a6172" }}>
                          No hay trabajadores consolidados este mes.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
