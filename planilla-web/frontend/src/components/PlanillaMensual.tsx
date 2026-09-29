// Pantalla "Planilla Mensual" (Ronda E, migracion_034 + unificacion
// Reportes/Planilla Mensual, 22/09/2026): junta el Tareo Diario de todas las
// quincenas/semanas de un mes calendario en un solo calculo, para poder
// declarar PLAME/AFPnet/Asiento Contable por mes en vez de por periodo de
// pago. Trabaja en 2 modalidades:
//   - "Por proyecto": obreros YA consolidados de ese proyecto/mes MAS los
//     empleados (regimen general) de ese mismo proyecto/mes - estos ultimos
//     no necesitan "consolidarse", su propio periodo MENSUAL ya cubre el
//     mes completo.
//   - "Todos los proyectos": junta obreros de CADA proyecto con periodos ese
//     mes MAS empleados de TODOS los proyectos, en una sola vista/archivo -
//     coincide con como se declara PLAME/AFPnet ante SUNAT/AFP en la
//     realidad (una vez por RUC al mes). Restringido a ADMIN.
// Ver src/planillaMensual.ts / src/routes/planillaMensual.ts (backend).
import { useEffect, useState } from "react";
import { apiDescargarArchivo, apiGet, apiPost } from "../api";
import { useAuth } from "../AuthContext";
import {
  AvisoRecalculoPosteriorMensual,
  DetalleTrabajadorMensualFila,
  FilaHistorialConsolidacion,
  PeriodoIncluidoConsolidacion,
  Proyecto,
  ResultadoConsolidacionMensual,
  VistaDeclaracionMensual,
} from "../types";

// NOTA (recon 19/46, reconfirmado en recon 33/46): el parche original
// tambien traia (y sigue trayendo) un boton "Descargar Asiento Contable
// (Excel)" (con su interfaz FaltanteMapeoContable y el manejo del error 400
// "faltan cuentas contables por configurar"). Se sigue omitiendo aqui porque
// la ruta backend equivalente (GET .../exportar/asiento-contable) tampoco se
// agrego - depende de "src/asientoContable.ts", que no existe en este arbol
// (ver RECONSTRUCCION_BRECHAS.md punto 5 - confirmado ausente ya 3 veces).
// Reagregar cuando ese modulo se reconstruya, siguiendo el mismo patron de
// descarga de REM/AFPnet de aqui abajo.

// Columnas monetarias fijas de la tabla de resumen, agrupadas igual que las
// suma calcularLineaPlanilla/sumarResultadosLinea (motorCalculo.ts): Ingresos
// (suman total_ingresos), Descuentos (retenidos al trabajador, suman
// total_descuentos) y Aportes del empleador (essalud/sctr/senati/seguro de
// vida - no se descuentan al trabajador).
type ColumnaConcepto = { etiqueta: string; campo: keyof DetalleTrabajadorMensualFila };

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
  { etiqueta: "Descanso médico", campo: "subsidio_enfermedad" },
  { etiqueta: "Incapacidad enfermedad", campo: "incapacidad_enfermedad" },
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

const MESES_CORTO = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic",
];

function formato2(valor: number | string): string {
  return Number(valor).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Conceptos personalizados (formula propia, Configuracion): varian de una
// empresa a otra, asi que las columnas se arman dinamicamente a partir de lo
// que realmente aparece en el mes consolidado (no hay una lista fija como
// con COLUMNAS_INGRESOS/DESCUENTOS/APORTES_EMPLEADOR de arriba).
function conceptosPersonalizadosPorTipo(
  detalle: DetalleTrabajadorMensualFila[],
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

function montoPersonalizado(fila: DetalleTrabajadorMensualFila, codigo: string): number {
  return fila.conceptos_personalizados?.find((cp) => cp.codigo === codigo)?.monto ?? 0;
}

// Query string de {anio, mes, proyecto?} - proyecto se omite por completo
// cuando es null ("todos los proyectos"), tal como lo espera
// resolverAlcanceConAcceso en el backend.
function construirQuery(anio: number, mes: number, proyecto: string | null): string {
  const params = new URLSearchParams({ anio: String(anio), mes: String(mes) });
  if (proyecto) params.set("proyecto", proyecto);
  return params.toString();
}

type ModoDeclaracion = "PROYECTO" | "TODOS";

export default function PlanillaMensual() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "ADMIN";

  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [proyecto, setProyecto] = useState("");
  // "Todos los proyectos" solo tiene sentido para ADMIN (ver
  // resolverAlcanceConAcceso en el backend) - un RESPONSABLE_PLANILLA se
  // queda siempre en modo "Por proyecto".
  const [modo, setModo] = useState<ModoDeclaracion>("PROYECTO");
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [mes, setMes] = useState(new Date().getMonth() + 1);

  const [cargando, setCargando] = useState(false);
  const [consolidando, setConsolidando] = useState(false);
  const [descargando, setDescargando] = useState<"rem" | "afpnet" | "afpnet-excel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bug real de UI detectado en produccion (19/09/2026): los errores de
  // descarga (ej. el 400 "ningun trabajador con AFP" del Excel oficial de
  // AFPnet) se guardaban en el mismo estado "error" que usa la tarjeta de
  // arriba (Consolidar mes) - como esa tarjeta queda fuera de vista cuando
  // el usuario ya bajo hasta la tabla para presionar un boton de descarga,
  // el mensaje SI aparecia, pero arriba del todo, invisible sin volver a
  // subir. El usuario reporto "no sale ningun mensaje" varias veces con
  // este sintoma exacto. Se separa en su propio estado para mostrarlo justo
  // debajo de los botones de descarga, donde el usuario ya esta mirando.
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);

  const [vista, setVista] = useState<VistaDeclaracionMensual | null>(null);
  const [avisos, setAvisos] = useState<AvisoRecalculoPosteriorMensual[]>([]);
  const [erroresConsolidacion, setErroresConsolidacion] = useState<ResultadoConsolidacionMensual["errores"]>([]);

  // Migracion 042 (21/09/2026): el usuario reporto no tener forma de ver que
  // periodos exactos entraron en cada consolidacion (para verificar, ej.,
  // que una quincena que cruza de mes SI se repartio entre agosto y
  // setiembre), ni un historial de que meses/proyectos ya se consolidaron,
  // ni un aviso cuando algun periodo incluido todavia no habia pasado por
  // "Calcular". Los 2 primeros ya se calculaban en el backend pero se
  // descartaban sin mostrarse en pantalla; el tercero es nuevo.
  const [periodosIncluidos, setPeriodosIncluidos] = useState<PeriodoIncluidoConsolidacion[]>([]);
  const [avisosPeriodosNoCalculados, setAvisosPeriodosNoCalculados] = useState<
    ResultadoConsolidacionMensual["avisos_periodos_no_calculados"]
  >([]);
  const [proyectosConsolidados, setProyectosConsolidados] = useState<string[]>([]);
  const [historial, setHistorial] = useState<FilaHistorialConsolidacion[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [errorHistorial, setErrorHistorial] = useState<string | null>(null);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);

  async function cargarHistorial() {
    setCargandoHistorial(true);
    setErrorHistorial(null);
    try {
      setHistorial(await apiGet<FilaHistorialConsolidacion[]>("/planilla-mensual/historial"));
    } catch (e) {
      setErrorHistorial((e as Error).message);
    } finally {
      setCargandoHistorial(false);
    }
  }

  // Un usuario no-ADMIN solo puede elegir entre los proyectos que tiene
  // asignados (mismo criterio que Periodos.tsx).
  const proyectosDisponibles = esAdmin ? proyectos : proyectos.filter((p) => usuario?.proyectos.includes(p.nombre));
  // proyecto tal como lo espera la API: null = "todos los proyectos".
  const proyectoAlcance = modo === "TODOS" ? null : proyecto;

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
    if (modo === "PROYECTO" && !proyecto) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyecto, modo, anio, mes]);

  async function cargar() {
    setCargando(true);
    setError(null);
    setErrorDescarga(null);
    // periodos_incluidos/avisos_periodos_no_calculados son el resultado de
    // la ULTIMA vez que se presiono "Consolidar" en esta pantalla - si el
    // usuario cambia de mes/proyecto sin volver a consolidar, estos datos se
    // limpian para no mostrar datos de otro mes por error.
    setPeriodosIncluidos([]);
    setAvisosPeriodosNoCalculados([]);
    setProyectosConsolidados([]);
    try {
      const datos = await apiGet<VistaDeclaracionMensual>(
        `/planilla-mensual?${construirQuery(anio, mes, proyectoAlcance)}`
      );
      setVista(datos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function consolidar() {
    setConsolidando(true);
    setError(null);
    setAvisos([]);
    setErroresConsolidacion([]);
    setPeriodosIncluidos([]);
    setAvisosPeriodosNoCalculados([]);
    setProyectosConsolidados([]);
    try {
      const body: { anio: number; mes: number; proyecto?: string } = { anio, mes };
      if (proyectoAlcance) body.proyecto = proyectoAlcance;
      const r = await apiPost<ResultadoConsolidacionMensual>("/planilla-mensual/consolidar", body);
      setAvisos(r.avisos_recalculo_posterior);
      setErroresConsolidacion(r.errores);
      setProyectosConsolidados(r.proyectos_consolidados);
      await cargar(); // limpia periodosIncluidos/avisosPeriodosNoCalculados del mes anterior antes de fijar los nuevos
      setPeriodosIncluidos(r.periodos_incluidos);
      setAvisosPeriodosNoCalculados(r.avisos_periodos_no_calculados);
      if (mostrarHistorial) await cargarHistorial();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConsolidando(false);
    }
  }

  async function descargar(tipoArchivo: "rem" | "afpnet" | "afpnet-excel", ruta: string, nombreArchivo: string) {
    if (!vista) return;
    setErrorDescarga(null);
    setDescargando(tipoArchivo);
    try {
      await apiDescargarArchivo(`/planilla-mensual${ruta}?${construirQuery(anio, mes, proyectoAlcance)}`, nombreArchivo);
    } catch (e) {
      setErrorDescarga((e as Error).message);
    } finally {
      setDescargando(null);
    }
  }

  const nroDoc = `${anio}${String(mes).padStart(2, "0")}`;
  const etiquetaAlcance = proyectoAlcance ?? "todos los proyectos";

  return (
    <div>
      <div className="card">
        <h2 className="titulo-reporte">Planilla Mensual</h2>
        <p style={{ color: "#5a6172", maxWidth: 800 }}>
          Junta el Tareo Diario de todas las quincenas/semanas en un solo calculo por MES CALENDARIO, para poder
          declarar PLAME, AFPnet y el Asiento Contable por mes en vez de por periodo de pago. Incluye a los obreros ya
          consolidados y a los empleados de regimen general (que no necesitan consolidarse: su propio periodo mensual
          ya cubre el mes completo).
        </p>

        {error && <div className="mensaje-error">{error}</div>}

        {esAdmin && (
          <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: "normal" }}>
              <input type="radio" checked={modo === "PROYECTO"} onChange={() => setModo("PROYECTO")} /> Por proyecto
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: "normal" }}>
              <input type="radio" checked={modo === "TODOS"} onChange={() => setModo("TODOS")} /> Todos los proyectos
              (declaracion de toda la empresa)
            </label>
          </div>
        )}

        <div className="form-grid" style={{ maxWidth: 500 }}>
          {modo === "PROYECTO" && (
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
          )}
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

        <button
          className="primario"
          type="button"
          onClick={consolidar}
          disabled={(modo === "PROYECTO" && !proyecto) || consolidando}
        >
          {consolidando
            ? "Consolidando..."
            : modo === "TODOS"
              ? "Consolidar obreros de TODOS los proyectos"
              : "Consolidar obreros de este proyecto"}
        </button>{" "}
        <button
          type="button"
          onClick={() => {
            const abrir = !mostrarHistorial;
            setMostrarHistorial(abrir);
            if (abrir && historial.length === 0) void cargarHistorial();
          }}
        >
          {mostrarHistorial ? "Ocultar historial de meses consolidados" : "Ver historial de meses consolidados"}
        </button>

        {proyectosConsolidados.length > 0 && (
          <p style={{ marginTop: 12, fontSize: "0.85rem", color: "#5a6172" }}>
            Proyectos consolidados en esta operacion: {proyectosConsolidados.join(", ")}.
          </p>
        )}

        {periodosIncluidos.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ marginBottom: 4, fontSize: "0.85rem", color: "#5a6172" }}>
              <strong>Periodos que se tomaron en cuenta en esta consolidacion</strong> (se busca cualquier periodo de
              cada proyecto cuyas fechas toquen el mes, aunque su etiqueta sea de otro mes - ej. una quincena que
              cruza de agosto a setiembre aporta sus dias de setiembre a la consolidacion de setiembre):
            </p>
            <table>
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>Tipo</th>
                  <th>Quincena</th>
                  <th>Desde</th>
                  <th>Hasta</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {periodosIncluidos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.proyecto}</td>
                    <td>{p.tipo}</td>
                    <td>{p.quincena ?? "-"}</td>
                    <td>{p.fecha_inicio}</td>
                    <td>{p.fecha_fin}</td>
                    <td>{p.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {avisosPeriodosNoCalculados.length > 0 && (
          <div className="mensaje-advertencia" style={{ marginTop: 12 }}>
            {avisosPeriodosNoCalculados.length} periodo(s) incluidos en esta consolidacion todavia NO han pasado por
            "Calcular" en la pantalla Periodos (su Tareo Diario podria estar incompleto todavia):
            <ul>
              {avisosPeriodosNoCalculados.map((p) => (
                <li key={p.id}>
                  {p.proyecto} — {p.tipo} {p.quincena ? `(quincena ${p.quincena})` : ""} — {p.fecha_inicio} al{" "}
                  {p.fecha_fin}
                </li>
              ))}
            </ul>
            Esta consolidacion igual se calculo a partir del Tareo Diario ya cargado en esos periodos - revisa que
            este completo antes de descargar los archivos oficiales.
          </div>
        )}

        {erroresConsolidacion.length > 0 && (
          <div className="mensaje-error" style={{ marginTop: 12 }}>
            {erroresConsolidacion.length} trabajador(es) no se pudieron consolidar:
            <ul>
              {erroresConsolidacion.map((e) => (
                <li key={e.contrato_id}>
                  {e.proyecto} — {e.dni} - {e.nombre}: {e.motivo}
                </li>
              ))}
            </ul>
          </div>
        )}

        {avisos.length > 0 && (
          <div className="mensaje-advertencia" style={{ marginTop: 12 }}>
            {avisos.length} periodo(s) usados en esta consolidacion se volvieron a calcular DESPUES de la ultima vez
            que se consolido ese mes/proyecto (foto historica: esta consolidacion ya quedo guardada con los datos
            actuales, pero si vuelves a corregir esas quincenas, recuerda volver a consolidar).
          </div>
        )}
      </div>

      {mostrarHistorial && (
        <div className="card">
          <h2 className="titulo-reporte">Historial de meses consolidados (obreros)</h2>
          {errorHistorial && <div className="mensaje-error">{errorHistorial}</div>}
          {cargandoHistorial ? (
            <p>Cargando...</p>
          ) : historial.length === 0 ? (
            <p style={{ color: "#5a6172" }}>Todavia no se ha consolidado ningun mes.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Periodo</th>
                  <th>Proyecto</th>
                  <th>Trabajadores</th>
                  <th>Ultima consolidacion</th>
                  <th>Por</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historial.map((h) => (
                  <tr key={h.id}>
                    <td>
                      {MESES_CORTO[h.mes - 1]} {h.anio}
                    </td>
                    <td>{h.proyecto}</td>
                    <td>{h.trabajadores_consolidados}</td>
                    <td>{new Date(h.calculado_en).toLocaleString("es-PE")}</td>
                    <td>{h.calculado_por_nombre ?? "-"}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setModo("PROYECTO");
                          setProyecto(h.proyecto);
                          setAnio(h.anio);
                          setMes(h.mes);
                        }}
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {cargando && <div className="card">Cargando...</div>}

      {vista && !cargando && (
        <div className="card">
          <h2 className="titulo-reporte">
            {MESES[vista.mes - 1]} {vista.anio} — {vista.proyecto ?? "Todos los proyectos"} (
            {vista.detalle.length} trabajador{vista.detalle.length === 1 ? "" : "es"})
          </h2>

          {vista.cabeceras_obreros.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "#5a6172" }}>
              Los obreros de {etiquetaAlcance} todavia no se han consolidado este mes (si hay empleados de regimen
              general con boleta calculada, igual aparecen abajo).
            </p>
          ) : (
            <p style={{ fontSize: "0.85rem", color: "#5a6172" }}>
              Ultima consolidacion de obreros:{" "}
              {vista.cabeceras_obreros
                .map((c) => `${c.proyecto} (${new Date(c.calculado_en).toLocaleString("es-PE")})`)
                .join(" — ")}
            </p>
          )}

          {vista.avisos_periodos_empleados_no_calculados.length > 0 && (
            <div className="mensaje-advertencia" style={{ marginTop: 8, marginBottom: 8 }}>
              {vista.avisos_periodos_empleados_no_calculados.length} periodo(s) MENSUAL de empleados de este mes
              todavia no han pasado por "Calcular" en la pantalla Periodos:
              <ul>
                {vista.avisos_periodos_empleados_no_calculados.map((p) => (
                  <li key={p.id}>
                    {p.proyecto ?? "(proyecto legado)"} — {p.fecha_inicio} al {p.fecha_fin}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Migracion 043 (21/09/2026): desglose por Sistema de Pension,
              visible SIEMPRE (sin tener que descargar el Excel de AFPnet) -
              para que el usuario pueda distinguir por su cuenta un mes/
              proyecto sin ningun trabajador AFP (resultado correcto, el Excel
              de AFPnet saldria correctamente vacio, no seria un error). */}
          <p style={{ fontSize: "0.85rem", color: "#5a6172", marginBottom: 16 }}>
            Por Sistema de Pension:{" "}
            {vista.diagnostico_afpnet.por_sistema_pension.length > 0
              ? vista.diagnostico_afpnet.por_sistema_pension.map((f) => `${f.sistema_pension}: ${f.total}`).join(" — ")
              : "sin trabajadores consolidados"}
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
            <button
              type="button"
              disabled={descargando === "afpnet-excel"}
              onClick={() =>
                descargar("afpnet-excel", "/exportar/afpnet-excel", `AFPnet_Oficial_${nroDoc}_${etiquetaAlcance}.xlsx`)
              }
            >
              {descargando === "afpnet-excel" ? "Generando..." : "Descargar AFPnet (Excel oficial)"}
            </button>
          </div>

          {errorDescarga && (
            <div className="mensaje-error" style={{ marginBottom: 16 }}>
              {errorDescarga}
            </div>
          )}

          {vista.avisos_datos_afpnet.length > 0 && (
            <div className="mensaje-advertencia" style={{ marginBottom: 16 }}>
              El archivo oficial de AFPnet (Excel) tiene {vista.avisos_datos_afpnet.length} advertencia
              {vista.avisos_datos_afpnet.length === 1 ? "" : "s"} - no impide la descarga, pero conviene revisarlas:
              <ul>
                {vista.avisos_datos_afpnet.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {(() => {
            const personalizadosIngreso = conceptosPersonalizadosPorTipo(vista.detalle, "INGRESO");
            const personalizadosDescuento = conceptosPersonalizadosPorTipo(vista.detalle, "DESCUENTO");
            const personalizadosAporte = conceptosPersonalizadosPorTipo(vista.detalle, "APORTE");
            const totalColumnas =
              5 +
              (modo === "TODOS" ? 1 : 0) +
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
                      <th>Tipo</th>
                      {modo === "TODOS" && <th>Proyecto</th>}
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
                    {vista.detalle.map((f) => (
                      <tr key={`${f.tipo_trabajador}-${f.contrato_id}`}>
                        <td>{f.numero_documento}</td>
                        <td>{f.apellidos_nombres}</td>
                        <td>{f.tipo_trabajador === "OBRERO" ? "Obrero" : "Empleado"}</td>
                        {modo === "TODOS" && <td>{f.proyecto}</td>}
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
                    {vista.detalle.length === 0 && (
                      <tr>
                        <td colSpan={totalColumnas} style={{ textAlign: "center", color: "#5a6172" }}>
                          No hay trabajadores (ni obreros consolidados ni empleados calculados) para {etiquetaAlcance}{" "}
                          en {MESES[mes - 1]} {anio}.
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
