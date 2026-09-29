import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPut } from "../api";
import {
  ClaveConceptoLimiteTareo,
  Contrato,
  esConstruccionCivil,
  FactoresHorasExtra,
  LimitesTareo,
  PeriodoPlanilla,
  porcentajeRecargo,
  TareoDiarioFila,
  TipoDiaEspecial,
} from "../types";

interface Props {
  periodo: PeriodoPlanilla;
}

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

const OPCIONES_DIA_ESPECIAL: { valor: TipoDiaEspecial | ""; etiqueta: string }[] = [
  { valor: "", etiqueta: "" },
  { valor: "FALTA", etiqueta: "Falta" },
  // Migracion 038: "SUBSIDIO_ENFERMEDAD" se renombro a "DESCANSO_MEDICO" -
  // el sistema ya no bloquea marcar mas de 20 dias/año (antes lo hacia): el
  // dia 21 en adelante se paga automaticamente como "Incapacidad por
  // Enfermedad" al calcular la planilla, sin que el usuario tenga que
  // elegir un tipo de dia distinto aqui.
  { valor: "DESCANSO_MEDICO", etiqueta: "Descanso médico" },
  { valor: "SUBSIDIO_MATERNIDAD", etiqueta: "Subsidio maternidad" },
  { valor: "LICENCIA_PATERNIDAD", etiqueta: "Licencia paternidad" },
];

// "YYYY-MM-DD" -> Date en hora local (evita el corrimiento de un dia que da
// "new Date('YYYY-MM-DD')", que Javascript interpreta en UTC).
function fechaLocal(fechaIso: string): Date {
  const [anio, mes, dia] = fechaIso.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

function formatearFechaIso(d: Date): string {
  const anio = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

function diasDelPeriodo(periodo: PeriodoPlanilla): string[] {
  const fechas: string[] = [];
  const actual = fechaLocal(periodo.fecha_inicio.slice(0, 10));
  const fin = fechaLocal(periodo.fecha_fin.slice(0, 10));
  while (actual <= fin) {
    fechas.push(formatearFechaIso(actual));
    actual.setDate(actual.getDate() + 1);
  }
  return fechas;
}

// Migracion 040: un dia todavia no guardado nace con todos los campos de
// horas/minutos en null (se muestran vacios en la grilla) en vez de 0 - a
// pedido explicito del usuario, para poder escribir directo sin borrar un
// "0" primero. Un dia que YA vino guardado desde el backend siempre trae
// numeros reales (nunca null), asi que esto solo afecta a dias sin tocar.
function filaVacia(fecha: string): TareoDiarioFila {
  return {
    fecha,
    horas_normales: null,
    minutos_normales: null,
    horas_dominical: null,
    minutos_dominical: null,
    horas_feriado: null,
    minutos_feriado: null,
    horas_extra_tramo1: null,
    minutos_extra_tramo1: null,
    horas_extra_tramo2: null,
    minutos_extra_tramo2: null,
    horas_extra_tramo3: null,
    minutos_extra_tramo3: null,
    tipo_dia_especial: null,
  };
}

type CampoHoras = Exclude<keyof TareoDiarioFila, "fecha" | "tipo_dia_especial">;

// Migracion 040 (ampliacion, sept. 2026): el usuario reporto que el bloqueo
// del limite de horas/minutos solo se notaba al presionar "Guardar" (el
// campo aceptaba cualquier valor mientras tanto) - se pidio explicitamente
// un control PREVENTIVO que rechace el valor de inmediato, sin esperar al
// guardado.
//
// Migracion 043 (sept. 2026): el limite dejo de ser UNA suma combinada de
// todas las columnas - ahora cada CONCEPTO (Jornal normal, y cada tramo de
// horas extra) tiene su propio limite independiente (mismo criterio que ya
// valida el backend, routes/planilla.ts: CONCEPTOS_LIMITE_TAREO), para que
// llegar al tope del jornal normal ya no bloquee registrar horas extra ese
// mismo dia. Domingo trabajado y Feriado trabajado quedan sin limite (no
// estan en esta lista, a proposito).
const CONCEPTOS_LIMITE_TAREO: {
  clave: ClaveConceptoLimiteTareo;
  campoHoras: CampoHoras;
  campoMinutos: CampoHoras;
  etiqueta: string;
}[] = [
  { clave: "normal", campoHoras: "horas_normales", campoMinutos: "minutos_normales", etiqueta: "Jornal normal" },
  { clave: "tramo1", campoHoras: "horas_extra_tramo1", campoMinutos: "minutos_extra_tramo1", etiqueta: "Horas extra tramo 1" },
  { clave: "tramo2", campoHoras: "horas_extra_tramo2", campoMinutos: "minutos_extra_tramo2", etiqueta: "Horas extra tramo 2" },
  { clave: "tramo3", campoHoras: "horas_extra_tramo3", campoMinutos: "minutos_extra_tramo3", etiqueta: "Horas extra tramo 3" },
];

export default function TareoDiario({ periodo }: Props) {
  const [contratosDisponibles, setContratosDisponibles] = useState<Contrato[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [contratoSeleccionado, setContratoSeleccionado] = useState<Contrato | null>(null);
  const [dias, setDias] = useState<TareoDiarioFila[]>([]);
  const [factores, setFactores] = useState<FactoresHorasExtra | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Migracion 040 (ampliacion): limites configurables de horas/minutos por
  // dia (Configuracion -> Limites de tareo), traidos una sola vez al abrir
  // la pantalla, para poder bloquear en el momento (ver actualizarHoras) sin
  // depender de que el usuario presione "Guardar". Si no se pudieron traer
  // (ej. sin permiso), simplemente no se valida nada en el frontend - el
  // backend igual lo valida al guardar. erroresLimite guarda el mensaje del
  // ultimo intento bloqueado, con clave "fecha|claveConcepto" (no solo
  // "fecha") - asi cada concepto (Jornal normal, tramo1, tramo2, tramo3)
  // tiene su propio error independiente y se puede mostrar debajo de SU
  // PROPIA columna en vez de amontonar todo bajo la columna Fecha (defecto
  // de UI reportado por el usuario, sept. 2026: un mensaje largo ahi
  // ensanchaba esa columna y desplazaba las demas fuera de la pantalla).
  // Se limpia por concepto apenas ese concepto ya no excede su limite, y
  // por completo al cambiar de trabajador.
  const [limites, setLimites] = useState<LimitesTareo | null>(null);
  const [erroresLimite, setErroresLimite] = useState<Record<string, string>>({});

  function claveErrorLimite(fecha: string, claveConcepto: string) {
    return `${fecha}|${claveConcepto}`;
  }

  const buscadorRef = useRef<HTMLInputElement>(null);
  function irABuscador() {
    buscadorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    buscadorRef.current?.focus();
  }

  useEffect(() => {
    apiGet<Contrato[]>("/contratos?estado=HABIL")
      .then(setContratosDisponibles)
      .catch((e) => setError((e as Error).message));
    apiGet<FactoresHorasExtra>("/conceptos/horas-extra")
      .then(setFactores)
      .catch(() => {
        // Si no se pudo traer (ej. sin permiso), se muestran los tramos sin
        // porcentaje ("Horas extra tramo 1", etc.) - no bloquea la pantalla.
      });
    apiGet<LimitesTareo>("/conceptos/limites-tareo")
      .then(setLimites)
      .catch(() => {
        // Sin limites cargados, actualizarHoras no bloquea nada en el
        // frontend - el backend igual valida al guardar (ver planilla.ts).
      });
  }, []);

  const contratosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return contratosDisponibles
      .filter(
        (c) =>
          c.numero_documento?.toLowerCase().includes(q) ||
          c.apellidos_nombres?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [busqueda, contratosDisponibles]);

  async function elegirTrabajador(c: Contrato) {
    setContratoSeleccionado(c);
    setBusqueda("");
    setError(null);
    setOk(null);
    setCargando(true);
    try {
      const respuesta = await apiGet<{ dias: TareoDiarioFila[] }>(`/periodos/${periodo.id}/tareo-diario/${c.id}`);
      const porFecha = new Map(respuesta.dias.map((d) => [d.fecha.slice(0, 10), d]));
      const grilla = diasDelPeriodo(periodo).map((fecha) => porFecha.get(fecha) ?? filaVacia(fecha));
      setDias(grilla);
      setErroresLimite({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  // Migracion 040: "valor" llega en null cuando el usuario borro el campo
  // por completo (input vacio) - se guarda tal cual (queda vacio en
  // pantalla) en vez de forzarlo a 0, para no pelear con el usuario cada
  // vez que borra para volver a escribir.
  //
  // Migracion 043 (ampliacion, sept. 2026): limpia el error de UN SOLO
  // concepto (fecha + claveConcepto), no todos los del dia - antes, con una
  // sola clave por fecha, corregir un campo borraba tambien el aviso de
  // otro concepto distinto que siguiera excedido ese mismo dia.
  function limpiarErrorLimiteConcepto(fecha: string, claveConcepto: string) {
    const clave = claveErrorLimite(fecha, claveConcepto);
    setErroresLimite((prev) => {
      if (!(clave in prev)) return prev;
      const { [clave]: _omitido, ...resto } = prev;
      return resto;
    });
  }

  function actualizarHoras(fecha: string, campo: CampoHoras, valor: number | null) {
    // Migracion 043 (sept. 2026): "campo" solo se compara contra el limite
    // de SU PROPIO concepto (Jornal normal o el tramo de horas extra que
    // corresponda) - ya no se suma con las demas columnas del dia. Domingo
    // trabajado y Feriado trabajado no tienen concepto en
    // CONCEPTOS_LIMITE_TAREO, asi que nunca se bloquean por este control
    // (mismo criterio confirmado con el usuario que ya aplicaba a Domingo
    // por dia de la semana).
    const concepto = CONCEPTOS_LIMITE_TAREO.find((c) => c.campoHoras === campo || c.campoMinutos === campo);

    if (valor === null) {
      setDias((prev) => prev.map((f) => (f.fecha === fecha ? { ...f, [campo]: null } : f)));
      // Borrar el campo nunca puede hacer que un dia supere el limite de SU concepto.
      if (concepto) limpiarErrorLimiteConcepto(fecha, concepto.clave);
      return;
    }
    // Las horas y minutos se guardan como enteros (columnas INT en la base
    // de datos) - si el usuario escribe un decimal por error (ej. "1.13"
    // pensando en "1 hora 13 minutos"), se redondea aqui mismo en vez de
    // dejar que llegue asi al servidor y falle con un error de Postgres.
    const esMinutos = campo.startsWith("minutos_");
    const entero = Math.round(valor || 0);
    const acotado = esMinutos ? Math.min(59, Math.max(0, entero)) : Math.max(0, entero);

    // Migracion 040 (ampliacion, sept. 2026): bloqueo PREVENTIVO en tiempo
    // real, a pedido explicito del usuario - antes se avisaba recien al
    // presionar "Guardar" (el campo aceptaba cualquier numero mientras
    // tanto), lo cual el usuario reporto como poco efectivo.
    const diaSemana = fechaLocal(fecha).getDay(); // 0=domingo .. 6=sabado
    if (concepto && limites && diaSemana !== 0) {
      const esSabado = diaSemana === 6;
      const tipoDia = esSabado ? "sabado" : "lun_vie";
      const maximo = esMinutos
        ? limites[`minutos_max_${concepto.clave}_${tipoDia}`]
        : limites[`horas_max_${concepto.clave}_${tipoDia}`];
      if (acotado > maximo) {
        const etiquetaDia = esSabado ? "sábado" : "día (lunes a viernes)";
        const unidad = esMinutos ? "minutos" : "horas";
        setErroresLimite((prev) => ({
          ...prev,
          [claveErrorLimite(fecha, concepto.clave)]: `No puede superar ${maximo} ${unidad} este ${etiquetaDia} (Configuración → Límites de tareo).`,
        }));
        return; // se rechaza el cambio - no se actualiza "dias"
      }
    }
    if (concepto) limpiarErrorLimiteConcepto(fecha, concepto.clave);
    setDias((prev) => prev.map((f) => (f.fecha === fecha ? { ...f, [campo]: acotado } : f)));
  }

  function actualizarTipoDia(fecha: string, valor: TipoDiaEspecial | "") {
    setDias((prev) => prev.map((f) => (f.fecha === fecha ? { ...f, tipo_dia_especial: valor || null } : f)));
  }

  async function guardar() {
    if (!contratoSeleccionado) return;
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      await apiPut(`/periodos/${periodo.id}/tareo-diario/${contratoSeleccionado.id}`, { dias });
      setOk(`Tareo diario de ${contratoSeleccionado.apellidos_nombres} guardado correctamente.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const construccionCivil = contratoSeleccionado ? esConstruccionCivil(contratoSeleccionado.categoria_ocupacional) : true;
  const factoresRegimen = factores ? (construccionCivil ? factores.construccion : factores.general) : null;
  const etiquetaTramo1 = `Horas extra tramo 1${factoresRegimen ? ` (${porcentajeRecargo(factoresRegimen.factor1)})` : ""}`;
  const etiquetaTramo2 = `Horas extra tramo 2${factoresRegimen ? ` (${porcentajeRecargo(factoresRegimen.factor2)})` : ""}`;
  const etiquetaTramo3 = `Horas extra tramo 3${factoresRegimen ? ` (${porcentajeRecargo(factoresRegimen.factor3)})` : ""}`;

  return (
    <div>
      <div className="barra-accesos-rapidos">
        <button type="button" onClick={irABuscador}>
          Ir al buscador de trabajador
        </button>
      </div>

      {error && <div className="mensaje-error">{error}</div>}
      {ok && <div className="mensaje-ok">{ok}</div>}

      <div className="card">
        <h2>
          Registrar Tareo Diario — {periodo.mes}/{periodo.anio}
        </h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          Busca a un trabajador para registrar su asistencia dia por dia de este periodo (horas y
          minutos separados). Esto se suma automaticamente a los totales del tareo del periodo,
          igual que si se hubieran cargado por Excel o a mano.
        </p>
        <div style={{ position: "relative", maxWidth: 400 }}>
          <label>
            Buscar trabajador (por DNI o nombre)
            <input
              ref={buscadorRef}
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar..."
            />
          </label>
          {contratosFiltrados.length > 0 && (
            <div className="lista-sugerencias">
              {contratosFiltrados.map((c) => (
                <div key={c.id} className="sugerencia" onClick={() => elegirTrabajador(c)}>
                  {c.numero_documento} — {c.apellidos_nombres} ({c.proyecto})
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* NOTA (recon 34/46 SALTADO): el parche original convertia esta
          tarjeta en un formulario flotante (modal-overlay/modal-flotante-completo,
          con navegacion "Trabajador anterior/siguiente" y el buscador de
          "cambiar de trabajador" movido aca). Se omite por completo: ese
          parche construye ENCIMA de la infraestructura base del formulario
          flotante de UN dia especifico (fechaModalAbierto, cerrarModal,
          busquedaModal, coincidenciasModal, cambiarTrabajadorDesdeModal, las
          clases .modal-overlay/.modal-flotante/etc.), que nunca existio en
          este arbol - fue introducida por los parches #16/#17/#18, SALTADOS
          por completo (brecha #1, ver RECONSTRUCCION_BRECHAS.md punto 1). El
          diff de este parche solo trae fragmentos que asumen esa base ya
          escrita (mueve un buscador de un modal a otro, agrega botones de
          navegacion) - no alcanza para reconstruir el formulario de un dia
          desde cero sin inventar su logica completa. Se conserva la tarjeta
          simple ya existente (sin modal), igual que antes de este parche. */}
      {contratoSeleccionado && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2>
              {contratoSeleccionado.apellidos_nombres} — {contratoSeleccionado.numero_documento} (
              {contratoSeleccionado.proyecto})
            </h2>
            <button className="primario" type="button" disabled={guardando || cargando} onClick={guardar}>
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </div>

          {cargando ? (
            <p>Cargando...</p>
          ) : (
            <div className="tabla-tareo-diario tabla-scroll-horizontal">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Dia</th>
                    <th>Jornal normal (H/M)</th>
                    <th>Domingo trabajado (H/M)</th>
                    <th>Feriado trabajado (H/M)</th>
                    <th>{etiquetaTramo1} (H/M)</th>
                    <th>{etiquetaTramo2} (H/M)</th>
                    <th>{etiquetaTramo3} (H/M)</th>
                    <th>Dia especial</th>
                  </tr>
                </thead>
                <tbody>
                  {dias.map((fila) => {
                    const esEspecial = fila.tipo_dia_especial !== null;
                    return (
                      <tr key={fila.fecha}>
                        <td>
                          {fila.fecha}
                          {/* NOTA (recon 36/46): antes el aviso de limite
                              excedido tambien se mostraba aca, debajo de la
                              fecha - un mensaje largo ensanchaba esta columna
                              y desplazaba las demas fuera de la pantalla
                              (defecto de UI reportado por el usuario, sept.
                              2026). Ahora cada concepto muestra el suyo
                              debajo de su propia columna (ver mas abajo),
                              con la clase "aviso-columna" (styles.css) para
                              quebrar en varias lineas en vez de estirarse.
                              NO se reconstruyo el aviso "Fuera de vigencia"
                              (variable "fueraDeVigencia") ni el formateo
                              "formatearFechaVisible(fecha)" que el parche
                              original asumia ya existentes en este punto:
                              ninguno de los 46 parches recuperados los
                              define, todos los que los usan (este y el
                              parche #28/46) los referencian como codigo ya
                              existente - ver RECONSTRUCCION_BRECHAS.md,
                              brecha nueva en la seccion de este parche. */}
                        </td>
                        <td>{DIAS_SEMANA[fechaLocal(fila.fecha).getDay()]}</td>
                        {(
                          [
                            ["horas_normales", "minutos_normales"],
                            ["horas_dominical", "minutos_dominical"],
                            ["horas_feriado", "minutos_feriado"],
                            ["horas_extra_tramo1", "minutos_extra_tramo1"],
                            ["horas_extra_tramo2", "minutos_extra_tramo2"],
                            ["horas_extra_tramo3", "minutos_extra_tramo3"],
                          ] as [CampoHoras, CampoHoras][]
                        ).map(([campoHoras, campoMinutos]) => {
                          const concepto = CONCEPTOS_LIMITE_TAREO.find((c) => c.campoHoras === campoHoras);
                          const mensajeError = concepto
                            ? erroresLimite[claveErrorLimite(fila.fecha, concepto.clave)]
                            : undefined;
                          return (
                            <td key={campoHoras}>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                disabled={esEspecial}
                                style={{ width: 48 }}
                                value={fila[campoHoras] ?? ""}
                                onChange={(e) =>
                                  actualizarHoras(fila.fecha, campoHoras, e.target.value === "" ? null : Number(e.target.value))
                                }
                              />
                              {" h "}
                              <input
                                type="number"
                                min={0}
                                max={59}
                                step={1}
                                disabled={esEspecial}
                                style={{ width: 48 }}
                                value={fila[campoMinutos] ?? ""}
                                onChange={(e) =>
                                  actualizarHoras(fila.fecha, campoMinutos, e.target.value === "" ? null : Number(e.target.value))
                                }
                              />
                              {" m"}
                              {mensajeError && (
                                <div className="aviso-columna aviso-columna-limite">{mensajeError}</div>
                              )}
                            </td>
                          );
                        })}
                        <td>
                          <select
                            value={fila.tipo_dia_especial ?? ""}
                            onChange={(e) => actualizarTipoDia(fila.fecha, e.target.value as TipoDiaEspecial | "")}
                          >
                            {OPCIONES_DIA_ESPECIAL.map((o) => (
                              <option key={o.valor} value={o.valor}>
                                {o.etiqueta}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ color: "#5a6172", fontSize: "0.82rem", marginTop: 12 }}>
            Los dias marcados como Falta, Subsidio o Licencia no necesitan horas: no se calcula
            jornal ese dia. El monto del subsidio/licencia y sus aportes se revisan manualmente
            por ahora — este registro solo avisa cuando calculas la planilla.
          </p>
        </div>
      )}
    </div>
  );
}
