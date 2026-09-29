import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import { ClaveConceptoLimiteTareo, ConceptoPlanilla, HorarioProyecto, LimitesTareo, Proyecto } from "../types";

type CampoAfecto = "afecto_essalud" | "afecto_sctr" | "afecto_senati" | "afecto_onp" | "afecto_afp" | "afecto_renta5ta" | "afecto_conafovicer";

const COLUMNAS_AFECTO: { campo: CampoAfecto; etiqueta: string }[] = [
  { campo: "afecto_essalud", etiqueta: "EsSalud" },
  { campo: "afecto_sctr", etiqueta: "SCTR" },
  { campo: "afecto_senati", etiqueta: "SENATI" },
  { campo: "afecto_onp", etiqueta: "ONP" },
  { campo: "afecto_afp", etiqueta: "AFP" },
  { campo: "afecto_renta5ta", etiqueta: "Renta 5ta" },
  { campo: "afecto_conafovicer", etiqueta: "CONAFOVICER" },
];

type Edicion = Partial<Pick<ConceptoPlanilla, "factor1" | "factor2" | "factor3" | "activo" | CampoAfecto>>;

// Limites de tareo (migracion 043): un concepto (Jornal normal, y cada
// tramo de horas extra) con limite independiente, para 2 tipos de dia
// (lunes a viernes / sabado) - mismas claves que ya usa el backend
// (routes/planilla.ts: CONCEPTOS_LIMITE_TAREO) y TareoDiario.tsx, para
// armar los 16 nombres de columna sin escribirlos a mano.
const CONCEPTOS_LIMITE_TAREO: { clave: ClaveConceptoLimiteTareo; etiqueta: string }[] = [
  { clave: "normal", etiqueta: "Jornal normal" },
  { clave: "tramo1", etiqueta: "Horas extra tramo 1 (60%)" },
  { clave: "tramo2", etiqueta: "Horas extra tramo 2 (100%)" },
  { clave: "tramo3", etiqueta: "Horas extra tramo 3 (100%)" },
];
const TIPOS_DIA_LIMITE_TAREO: { clave: "lun_vie" | "sabado"; etiqueta: string }[] = [
  { clave: "lun_vie", etiqueta: "Lunes a viernes" },
  { clave: "sabado", etiqueta: "Sábado" },
];

// Horario de proyecto + tasa de tramo3 (migracion_045, "Control de
// Asistencia Diaria" - Ronda 1): campos editables por proyecto, todos en
// una sola fila (a diferencia de la cuota sindical, que tiene una columna
// por categoria) - se guardan todos juntos con un solo boton "Guardar".
type CampoHorarioProyecto =
  | "hora_ingreso"
  | "hora_salida"
  | "minutos_refrigerio"
  | "hora_ingreso_sabado"
  | "hora_salida_sabado"
  | "tasa_tramo3";

function claveHorario(proyectoId: number, campo: CampoHorarioProyecto): string {
  return `${proyectoId}|${campo}`;
}

export default function Configuracion() {
  const [conceptos, setConceptos] = useState<ConceptoPlanilla[]>([]);
  const [ediciones, setEdiciones] = useState<Record<string, Edicion>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Limites de tareo (migracion 040): fila unica, se edita completa de una
  // vez (no celda por celda como los conceptos de arriba).
  // NOTA (recon 27/46): en produccion esta seccion vive en una pestana
  // propia dentro de un sub-menu de Configuracion ("Conceptos de ingreso" /
  // "Aportes y retenciones" / "Plan de cuentas" / "Dias feriados" / "Cuota
  // sindical" / "Limites de tareo" / "Conceptos con formula propia") que
  // nunca se reconstruyo en este arbol - las 5 secciones restantes (y sus
  // rutas backend correspondientes) no existen aqui, asi que se agrega esta
  // tarjeta como una segunda seccion simple debajo de la tabla de
  // conceptos, en vez de como una pestana mas de un sub-menu que no existe.
  const [limitesTareo, setLimitesTareo] = useState<LimitesTareo | null>(null);
  const [edicionLimites, setEdicionLimites] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const c of CONCEPTOS_LIMITE_TAREO) {
      for (const tipoDia of TIPOS_DIA_LIMITE_TAREO) {
        inicial[`horas_max_${c.clave}_${tipoDia.clave}`] = "";
        inicial[`minutos_max_${c.clave}_${tipoDia.clave}`] = "";
      }
    }
    return inicial;
  });
  const [guardandoLimites, setGuardandoLimites] = useState(false);

  // Horario de proyecto + tasa de tramo3 (migracion_045, "Control de
  // Asistencia Diaria" - Ronda 1).
  // NOTA (recon 41/46): el parche original agrega esta seccion como una
  // pestana mas del sub-menu de Configuracion (type Seccion = "ingresos" |
  // "aportes" | ... | "horarioProyecto") - ese sub-menu es la misma brecha
  // #12 ya documentada (nunca se reconstruyo en este arbol). Se agrega aqui
  // como una tercera tarjeta simple apilada, igual criterio que "Limites de
  // tareo" (ver la NOTA de mas arriba).
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [horarios, setHorarios] = useState<HorarioProyecto[]>([]);
  const [edicionesHorario, setEdicionesHorario] = useState<Record<string, string>>({});
  const [guardandoHorarioProyecto, setGuardandoHorarioProyecto] = useState<number | null>(null);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const [datos, datosLimites, datosProyectos, datosHorarios] = await Promise.all([
        apiGet<ConceptoPlanilla[]>("/conceptos"),
        apiGet<LimitesTareo>("/conceptos/limites-tareo"),
        apiGet<Proyecto[]>("/proyectos"),
        apiGet<HorarioProyecto[]>("/conceptos/horarios-proyecto"),
      ]);
      setConceptos(datos);
      setEdiciones({});
      setLimitesTareo(datosLimites);
      setProyectos(datosProyectos);
      setHorarios(datosHorarios);
      setEdicionesHorario({});
      const edicionInicial: Record<string, string> = {};
      for (const c of CONCEPTOS_LIMITE_TAREO) {
        for (const tipoDia of TIPOS_DIA_LIMITE_TAREO) {
          edicionInicial[`horas_max_${c.clave}_${tipoDia.clave}`] = String(datosLimites[`horas_max_${c.clave}_${tipoDia.clave}`]);
          edicionInicial[`minutos_max_${c.clave}_${tipoDia.clave}`] = String(datosLimites[`minutos_max_${c.clave}_${tipoDia.clave}`]);
        }
      }
      setEdicionLimites(edicionInicial);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar los conceptos");
    } finally {
      setCargando(false);
    }
  }

  function valorActual<K extends keyof Edicion>(c: ConceptoPlanilla, campo: K): ConceptoPlanilla[K] {
    const edicion = ediciones[c.codigo];
    if (edicion && campo in edicion) return edicion[campo] as ConceptoPlanilla[K];
    return c[campo];
  }

  function editar(codigo: string, campo: keyof Edicion, valor: Edicion[keyof Edicion]) {
    setEdiciones((prev) => ({ ...prev, [codigo]: { ...prev[codigo], [campo]: valor } }));
    setMensaje(null);
  }

  function esFilaEditada(codigo: string): boolean {
    return !!ediciones[codigo] && Object.keys(ediciones[codigo]).length > 0;
  }

  async function guardarFila(c: ConceptoPlanilla) {
    const cambios = ediciones[c.codigo];
    if (!cambios) return;
    setGuardando(c.codigo);
    setError(null);
    try {
      const actualizado = await apiPut<ConceptoPlanilla>(`/conceptos/${c.codigo}`, cambios);
      setConceptos((prev) => prev.map((x) => (x.codigo === c.codigo ? actualizado : x)));
      setEdiciones((prev) => {
        const copia = { ...prev };
        delete copia[c.codigo];
        return copia;
      });
      setMensaje(`Guardado: ${c.nombre}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar el concepto");
    } finally {
      setGuardando(null);
    }
  }

  async function restaurarValoresOriginales() {
    if (
      !confirm(
        "¿Restaurar TODOS los conceptos a los valores originales del sistema? Se perderán todos los cambios manuales que hayas hecho en esta pestaña."
      )
    ) {
      return;
    }
    setRestaurando(true);
    setError(null);
    try {
      const datos = await apiPost<ConceptoPlanilla[]>("/conceptos/restaurar", {});
      setConceptos(datos);
      setEdiciones({});
      setMensaje("Se restauraron los valores originales.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al restaurar los valores originales");
    } finally {
      setRestaurando(false);
    }
  }

  function celdaFactor(c: ConceptoPlanilla, campo: "factor1" | "factor2" | "factor3", etiquetaCampo: "factor1_etiqueta" | "factor2_etiqueta" | "factor3_etiqueta") {
    const etiqueta = c[etiquetaCampo];
    if (!etiqueta) return <td style={{ color: "#b0b5c0" }}>—</td>;
    const valor = valorActual(c, campo);
    return (
      <td title={etiqueta}>
        <input
          type="number"
          step="any"
          value={valor ?? ""}
          onChange={(e) => editar(c.codigo, campo, e.target.value === "" ? null : Number(e.target.value))}
          style={{ width: 90 }}
        />
        <div style={{ fontSize: "0.72rem", color: "#8a90a0", maxWidth: 140 }}>{etiqueta}</div>
      </td>
    );
  }

  function celdaAfecto(c: ConceptoPlanilla, campo: CampoAfecto) {
    const valor = valorActual(c, campo);
    if (valor === null) {
      return (
        <span style={{ color: "#b0b5c0" }} title="No aplica: ya incorporado en la fórmula anual de Empleado">
          N/A
        </span>
      );
    }
    return (
      <input type="checkbox" checked={valor} onChange={(e) => editar(c.codigo, campo, e.target.checked)} />
    );
  }

  // Migracion 039: interruptor activo/inactivo para conceptos de codigo fijo
  // (sin formula) - permite apagar temporalmente uno (ej. para reemplazarlo
  // por un "gemelo" con formula propia) sin borrarlo del catalogo.
  // SUELDO_BASICO no se puede apagar (el sueldo/jornal basico siempre se
  // calcula, ver motorCalculo.ts:estaActivo) - el checkbox aparece
  // deshabilitado para ese codigo puntual, con una explicacion al pasar el
  // mouse.
  function celdaActivo(c: ConceptoPlanilla) {
    const valor = valorActual(c, "activo");
    if (c.codigo === "SUELDO_BASICO") {
      return (
        <input
          type="checkbox"
          checked={true}
          disabled
          title="El sueldo/jornal básico siempre se calcula - no se puede desactivar"
        />
      );
    }
    return <input type="checkbox" checked={valor} onChange={(e) => editar(c.codigo, "activo", e.target.checked)} />;
  }

  // ------------------------------------------------------------------
  // Horario de proyecto + tasa de tramo3 (migracion_045, "Control de
  // Asistencia Diaria" - Ronda 1): una fila por proyecto, con todos sus
  // campos editables juntos y un solo boton "Guardar" por fila (a
  // diferencia de la cuota sindical, que seria una matriz proyecto x
  // categoria). El GET ya trae, para cada proyecto, valores por defecto
  // (08:00/17:00/60) si todavia no configuro nada - por eso aqui no hace
  // falta un "0" de respaldo.
  // ------------------------------------------------------------------
  const mapaHorario = useMemo(() => {
    const m = new Map<number, HorarioProyecto>();
    for (const h of horarios) m.set(h.proyecto_id, h);
    return m;
  }, [horarios]);

  function valorHorario(proyectoId: number, campo: CampoHorarioProyecto): string {
    const clave = claveHorario(proyectoId, campo);
    if (clave in edicionesHorario) return edicionesHorario[clave];
    const fila = mapaHorario.get(proyectoId);
    if (!fila) return "";
    const v = fila[campo];
    return v === null || v === undefined ? "" : String(v);
  }

  function editarHorario(proyectoId: number, campo: CampoHorarioProyecto, valor: string) {
    setEdicionesHorario((prev) => ({ ...prev, [claveHorario(proyectoId, campo)]: valor }));
    setMensaje(null);
  }

  function esProyectoHorarioEditado(proyectoId: number): boolean {
    const campos: CampoHorarioProyecto[] = [
      "hora_ingreso",
      "hora_salida",
      "minutos_refrigerio",
      "hora_ingreso_sabado",
      "hora_salida_sabado",
      "tasa_tramo3",
    ];
    return campos.some((campo) => claveHorario(proyectoId, campo) in edicionesHorario);
  }

  async function guardarHorarioProyecto(proyecto: Proyecto) {
    const horaIngreso = valorHorario(proyecto.id, "hora_ingreso");
    const horaSalida = valorHorario(proyecto.id, "hora_salida");
    const refrigerioTexto = valorHorario(proyecto.id, "minutos_refrigerio");
    const horaIngresoSabado = valorHorario(proyecto.id, "hora_ingreso_sabado");
    const horaSalidaSabado = valorHorario(proyecto.id, "hora_salida_sabado");
    const tasaTramo3Texto = valorHorario(proyecto.id, "tasa_tramo3");

    if (!horaIngreso || !horaSalida) {
      setError(`Hora de ingreso y hora de salida son obligatorias en ${proyecto.nombre}`);
      return;
    }
    const minutosRefrigerio = Number(refrigerioTexto);
    if (refrigerioTexto.trim() === "" || Number.isNaN(minutosRefrigerio) || minutosRefrigerio < 0 || minutosRefrigerio > 240) {
      setError(`Minutos de refrigerio invalido (0 a 240) en ${proyecto.nombre}`);
      return;
    }
    let tasaTramo3: number | null = null;
    if (tasaTramo3Texto.trim() !== "") {
      tasaTramo3 = Number(tasaTramo3Texto);
      if (Number.isNaN(tasaTramo3) || tasaTramo3 < 1) {
        setError(
          `Tasa de tramo 3 invalida en ${proyecto.nombre}: debe ser el multiplicador del valor hora (ej. 1.60 para 60% de recargo), o dejarse vacio para usar el recargo general`
        );
        return;
      }
    }

    setGuardandoHorarioProyecto(proyecto.id);
    setError(null);
    try {
      const guardadas = await apiPut<HorarioProyecto[]>("/conceptos/horarios-proyecto", {
        entradas: [
          {
            proyecto_id: proyecto.id,
            hora_ingreso: horaIngreso,
            hora_salida: horaSalida,
            minutos_refrigerio: minutosRefrigerio,
            hora_ingreso_sabado: horaIngresoSabado || null,
            hora_salida_sabado: horaSalidaSabado || null,
            tasa_tramo3: tasaTramo3,
          },
        ],
      });
      setHorarios((prev) => {
        const otras = prev.filter((x) => !guardadas.some((g) => g.proyecto_id === x.proyecto_id));
        return [...otras, ...guardadas];
      });
      setEdicionesHorario((prev) => {
        const copia = { ...prev };
        for (const campo of [
          "hora_ingreso",
          "hora_salida",
          "minutos_refrigerio",
          "hora_ingreso_sabado",
          "hora_salida_sabado",
          "tasa_tramo3",
        ] as CampoHorarioProyecto[]) {
          delete copia[claveHorario(proyecto.id, campo)];
        }
        return copia;
      });
      setMensaje(`Horario guardado: ${proyecto.nombre}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar el horario del proyecto");
    } finally {
      setGuardandoHorarioProyecto(null);
    }
  }

  // ------------------------------------------------------------------
  // Limites de tareo (migracion 040, ampliada en migracion 043: un limite
  // independiente por cada concepto x tipo de dia, en vez de 4 campos fijos)
  // ------------------------------------------------------------------
  function editarLimite(campo: string, valor: string) {
    setEdicionLimites((prev) => ({ ...prev, [campo]: valor }));
    setMensaje(null);
  }

  async function guardarLimitesTareo() {
    const valores: Record<string, number> = {};
    const invalido = { horas: false, minutos: false };
    for (const c of CONCEPTOS_LIMITE_TAREO) {
      for (const tipoDia of TIPOS_DIA_LIMITE_TAREO) {
        const campoHoras = `horas_max_${c.clave}_${tipoDia.clave}`;
        const campoMinutos = `minutos_max_${c.clave}_${tipoDia.clave}`;
        const horas = Number(edicionLimites[campoHoras]);
        const minutos = Number(edicionLimites[campoMinutos]);
        if (Number.isNaN(horas) || horas < 0 || horas > 24) invalido.horas = true;
        if (Number.isNaN(minutos) || minutos < 0 || minutos > 59) invalido.minutos = true;
        valores[campoHoras] = horas;
        valores[campoMinutos] = minutos;
      }
    }
    if (invalido.horas || invalido.minutos) {
      setError("Revisa los valores: las horas deben estar entre 0 y 24, y los minutos entre 0 y 59.");
      return;
    }
    setGuardandoLimites(true);
    setError(null);
    try {
      const guardado = await apiPut<LimitesTareo>("/conceptos/limites-tareo", valores);
      setLimitesTareo(guardado);
      setMensaje("Límites de tareo guardados correctamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar los límites de tareo");
    } finally {
      setGuardandoLimites(false);
    }
  }

  return (
    <>
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <h2>Configuración de conceptos de planilla</h2>
          <p style={{ color: "#5a6172", maxWidth: 800 }}>
            Para cada concepto de ingreso, define a qué aportes/descuentos está afecto (igual que la Tabla 22
            de SUNAT — EsSalud, SCTR, SENATI, ONP, AFP, Renta 5ta, CONAFOVICER) y los factores/tasas legales de
            su fórmula (ej. 0.15 = 15%). La estructura de cada fórmula sigue fija en el sistema — solo los
            números dentro de ella son editables aquí. Las celdas marcadas "N/A" no se pueden activar: su
            efecto ya está incorporado de otra forma en el cálculo (ver la descripción del concepto).
          </p>
        </div>
        <button type="button" onClick={restaurarValoresOriginales} disabled={restaurando} className="no-imprimir">
          {restaurando ? "Restaurando..." : "Restaurar valores originales"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {mensaje && <p style={{ color: "#1a7f37" }}>{mensaje}</p>}
      {cargando && <p>Cargando...</p>}

      {!cargando && (
        <div className="tabla-scroll-horizontal">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Concepto</th>
                <th>Factor 1</th>
                <th>Factor 2</th>
                <th>Factor 3</th>
                {COLUMNAS_AFECTO.map((col) => (
                  <th key={col.campo} style={{ textAlign: "center" }}>
                    {col.etiqueta}
                  </th>
                ))}
                <th style={{ textAlign: "center" }} title="Interruptor para desactivar temporalmente el concepto sin borrarlo">
                  Activo
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {conceptos.map((c) => (
                <tr key={c.codigo}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                    {c.descripcion && (
                      <div style={{ fontSize: "0.78rem", color: "#8a90a0", maxWidth: 320 }}>{c.descripcion}</div>
                    )}
                  </td>
                  {celdaFactor(c, "factor1", "factor1_etiqueta")}
                  {celdaFactor(c, "factor2", "factor2_etiqueta")}
                  {celdaFactor(c, "factor3", "factor3_etiqueta")}
                  {COLUMNAS_AFECTO.map((col) => (
                    <td key={col.campo} style={{ textAlign: "center" }}>
                      {celdaAfecto(c, col.campo)}
                    </td>
                  ))}
                  <td style={{ textAlign: "center" }}>{celdaActivo(c)}</td>
                  <td>
                    {esFilaEditada(c.codigo) && (
                      <button
                        type="button"
                        className="primario"
                        onClick={() => guardarFila(c)}
                        disabled={guardando === c.codigo}
                      >
                        {guardando === c.codigo ? "..." : "Guardar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

    {!cargando && limitesTareo && (
      <div className="card" style={{ marginTop: 18 }}>
        <h2 className="titulo-reporte">Límites de tareo</h2>
        <p style={{ color: "#5a6172", maxWidth: 800 }}>
          Límite máximo de horas y minutos que se puede registrar por día en el Tareo Diario, distinto para
          días de lunes a viernes y para sábados (domingo no tiene límite configurable aquí — se paga aparte
          como "domingo trabajado"; Feriado trabajado tampoco tiene límite). Cada concepto tiene su propio
          límite independiente — el Jornal normal ya no comparte tope con las horas extra, así que llegar al
          límite del jornal normal no bloquea registrar horas extra ese mismo día. Si se excede el límite de
          un concepto puntual, el sistema no deja guardar ese día.
        </p>
        <div className="tabla-scroll-horizontal">
          <table>
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Horas máx. (lunes a viernes)</th>
                <th>Minutos máx. (lunes a viernes)</th>
                <th>Horas máx. (sábado)</th>
                <th>Minutos máx. (sábado)</th>
              </tr>
            </thead>
            <tbody>
              {CONCEPTOS_LIMITE_TAREO.map((c) => (
                <tr key={c.clave}>
                  <td>{c.etiqueta}</td>
                  {TIPOS_DIA_LIMITE_TAREO.flatMap((tipoDia) => [
                    <td key={`${tipoDia.clave}-horas`}>
                      <input
                        type="number"
                        min={0}
                        max={24}
                        step={1}
                        value={edicionLimites[`horas_max_${c.clave}_${tipoDia.clave}`] ?? ""}
                        onChange={(e) => editarLimite(`horas_max_${c.clave}_${tipoDia.clave}`, e.target.value)}
                      />
                    </td>,
                    <td key={`${tipoDia.clave}-minutos`}>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        step={1}
                        value={edicionLimites[`minutos_max_${c.clave}_${tipoDia.clave}`] ?? ""}
                        onChange={(e) => editarLimite(`minutos_max_${c.clave}_${tipoDia.clave}`, e.target.value)}
                      />
                    </td>,
                  ])}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          className="primario"
          type="button"
          onClick={guardarLimitesTareo}
          disabled={guardandoLimites}
          style={{ marginTop: 12 }}
        >
          {guardandoLimites ? "Guardando..." : "Guardar límites"}
        </button>
      </div>
    )}

    {!cargando && (
      <div className="card" style={{ marginTop: 18 }}>
        <h2 className="titulo-reporte">Horario por proyecto y tasa de tramo 3</h2>
        <p style={{ color: "#5a6172", maxWidth: 900 }}>
          Configura, para cada proyecto/obra, la hora de ingreso, hora de salida y minutos de refrigerio (usados por
          el futuro control de asistencia con marcación biométrica) y la tasa de recargo del "tramo 3" de horas
          extra (más de 6 horas extra acumuladas en el día). La tasa de tramo 3 se aplica ya mismo al calcular
          planillas: es el multiplicador del valor hora (ej. 1.60 significa 60% de recargo). Si se deja vacía, ese
          proyecto sigue usando el recargo general de la empresa. El horario de sábado es opcional; si se deja
          vacío, se usa el mismo horario de lunes a viernes.
        </p>
        {proyectos.length === 0 && <p>No hay proyectos registrados todavía.</p>}
        {proyectos.length > 0 && (
          <div className="tabla-scroll-horizontal">
            <table>
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>Hora ingreso</th>
                  <th>Hora salida</th>
                  <th>Refrigerio (min)</th>
                  <th>Hora ingreso sábado</th>
                  <th>Hora salida sábado</th>
                  <th>Tasa tramo 3 (multiplicador)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {proyectos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.nombre}</td>
                    <td>
                      <input
                        type="time"
                        value={valorHorario(p.id, "hora_ingreso")}
                        onChange={(e) => editarHorario(p.id, "hora_ingreso", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        value={valorHorario(p.id, "hora_salida")}
                        onChange={(e) => editarHorario(p.id, "hora_salida", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max="240"
                        style={{ width: 70 }}
                        value={valorHorario(p.id, "minutos_refrigerio")}
                        onChange={(e) => editarHorario(p.id, "minutos_refrigerio", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        value={valorHorario(p.id, "hora_ingreso_sabado")}
                        onChange={(e) => editarHorario(p.id, "hora_ingreso_sabado", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        value={valorHorario(p.id, "hora_salida_sabado")}
                        onChange={(e) => editarHorario(p.id, "hora_salida_sabado", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        placeholder="General"
                        style={{ width: 90 }}
                        value={valorHorario(p.id, "tasa_tramo3")}
                        onChange={(e) => editarHorario(p.id, "tasa_tramo3", e.target.value)}
                      />
                    </td>
                    <td>
                      {esProyectoHorarioEditado(p.id) && (
                        <button
                          type="button"
                          className="primario"
                          onClick={() => guardarHorarioProyecto(p)}
                          disabled={guardandoHorarioProyecto === p.id}
                        >
                          {guardandoHorarioProyecto === p.id ? "..." : "Guardar"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )}
    </>
  );
}
