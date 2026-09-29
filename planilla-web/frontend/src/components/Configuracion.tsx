import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../api";
import {
  AmbitoFeriado,
  CatalogoItem,
  CatalogoUbigeoDistrito,
  CatalogoUbigeoProvincia,
  ClaveConceptoLimiteTareo,
  ConceptoAporte,
  ConceptoPlanilla,
  CuentaContable,
  DiaFeriado,
  HorarioProyecto,
  LimitesTareo,
  MapeoContable,
  Proyecto,
} from "../types";

// Movimientos contables que requiere cada concepto de INGRESO/APORTE/
// DESCUENTO (conceptos_planilla.tipo) - usado por el Mapeo Contable
// (migracion_049) para saber si mostrar la columna "Cuenta (Debe)",
// "Cuenta (Haber)" o ambas para ese concepto.
function movimientosDeConceptoIngreso(tipo: string): Array<"DEBE" | "HABER"> {
  if (tipo === "DESCUENTO") return ["HABER"];
  if (tipo === "APORTE") return ["DEBE", "HABER"];
  return ["DEBE"]; // INGRESO (o cualquier otro valor, por defecto)
}

// Movimientos contables que requiere cada aporte/retencion
// (conceptos_aportes.tipo_movimiento): "DEBE"/"HABER" literal = solo ese
// movimiento; cualquier otro valor ("APORTE", usado por los aportes
// patronales) = requiere cuenta en AMBOS (Debe y Haber) - mismo criterio
// que asientoContable.ts (acumula Debe+Haber por el mismo monto para
// ESSALUD/SCTR/SENATI/SEGURO_VIDA).
function movimientosDeAporte(tipoMovimiento: string): Array<"DEBE" | "HABER"> {
  if (tipoMovimiento === "DEBE" || tipoMovimiento === "HABER") return [tipoMovimiento];
  return ["DEBE", "HABER"];
}

function claveMapeo(conceptoCodigo: string, tipoMovimiento: "DEBE" | "HABER"): string {
  return `${conceptoCodigo}|${tipoMovimiento}`;
}

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

  // ------------------------------------------------------------------
  // Dias feriados (dias_feriados, migracion 022, reconstruida desde
  // backend_dist en la migracion 048 - ver RECONSTRUCCION_BRECHAS.md):
  // catalogo editable para que el sistema acredite automaticamente el pago
  // del feriado no laborado al recalcular el Tareo Diario. Se agrega aqui
  // como una cuarta tarjeta simple apilada, mismo criterio que "Limites de
  // tareo"/"Horario por proyecto" de mas arriba (el sub-menu de
  // Configuracion con pestañas nunca se reconstruyo en este arbol).
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // Aportes patronales/retenciones (conceptos_aportes), Plan de Cuentas
  // (plan_cuentas) y Mapeo Contable (mapeo_cuentas_contables) - migracion
  // 049, prerequisito del Asiento Contable (ver src/asientoContable.ts).
  // Igual criterio que las tarjetas de arriba: se agregan como tarjetas
  // simples apiladas, no como pestañas de un sub-menu (ese sub-menu de
  // produccion nunca se reconstruyo en este arbol - ver la NOTA de arriba).
  // ------------------------------------------------------------------
  const [aportes, setAportes] = useState<ConceptoAporte[]>([]);
  const [edicionesAporte, setEdicionesAporte] = useState<Record<string, Partial<Pick<ConceptoAporte, "nombre" | "descripcion" | "codigo_plame">>>>({});
  const [guardandoAporte, setGuardandoAporte] = useState<string | null>(null);

  const [cuentas, setCuentas] = useState<CuentaContable[]>([]);
  const [edicionesCuenta, setEdicionesCuenta] = useState<Record<number, Partial<Pick<CuentaContable, "codigo" | "denominacion" | "activa">>>>({});
  const [guardandoCuentaId, setGuardandoCuentaId] = useState<number | null>(null);
  const [nuevaCuenta, setNuevaCuenta] = useState({ codigo: "", denominacion: "" });
  const [agregandoCuenta, setAgregandoCuenta] = useState(false);

  const [mapeo, setMapeo] = useState<MapeoContable[]>([]);
  const [proyectoMapeoId, setProyectoMapeoId] = useState<number | null>(null);
  const [edicionesMapeo, setEdicionesMapeo] = useState<Record<string, number | "">>({});
  const [guardandoMapeo, setGuardandoMapeo] = useState(false);

  const [feriados, setFeriados] = useState<DiaFeriado[]>([]);
  const [ubigeoDepartamentos, setUbigeoDepartamentos] = useState<CatalogoItem[]>([]);
  const [ubigeoProvincias, setUbigeoProvincias] = useState<CatalogoUbigeoProvincia[]>([]);
  const [ubigeoDistritos, setUbigeoDistritos] = useState<CatalogoUbigeoDistrito[]>([]);
  const [nuevoFeriado, setNuevoFeriado] = useState({
    fecha: "",
    descripcion: "",
    ambito: "NACIONAL" as AmbitoFeriado,
    ubigeo_departamento_codigo: "",
    ubigeo_provincia_codigo: "",
    ubigeo_distrito_codigo: "",
  });
  const [guardandoFeriado, setGuardandoFeriado] = useState(false);
  const [eliminandoFeriadoId, setEliminandoFeriadoId] = useState<number | null>(null);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const [datos, datosLimites, datosProyectos, datosHorarios, datosFeriados, datosCatalogos, datosAportes, datosCuentas, datosMapeo] =
        await Promise.all([
          apiGet<ConceptoPlanilla[]>("/conceptos"),
          apiGet<LimitesTareo>("/conceptos/limites-tareo"),
          apiGet<Proyecto[]>("/proyectos"),
          apiGet<HorarioProyecto[]>("/conceptos/horarios-proyecto"),
          apiGet<DiaFeriado[]>("/conceptos/dias-feriados"),
          apiGet<{
            ubigeo_departamento: CatalogoItem[];
            ubigeo_provincia: CatalogoUbigeoProvincia[];
            ubigeo_distrito: CatalogoUbigeoDistrito[];
          }>("/catalogos"),
          apiGet<ConceptoAporte[]>("/conceptos/aportes"),
          apiGet<CuentaContable[]>("/conceptos/plan-cuentas"),
          apiGet<MapeoContable[]>("/conceptos/mapeo-contable"),
        ]);
      setConceptos(datos);
      setEdiciones({});
      setLimitesTareo(datosLimites);
      setProyectos(datosProyectos);
      setHorarios(datosHorarios);
      setEdicionesHorario({});
      setFeriados(datosFeriados);
      setUbigeoDepartamentos(datosCatalogos.ubigeo_departamento);
      setUbigeoProvincias(datosCatalogos.ubigeo_provincia);
      setUbigeoDistritos(datosCatalogos.ubigeo_distrito);
      setAportes(datosAportes);
      setEdicionesAporte({});
      setCuentas(datosCuentas);
      setEdicionesCuenta({});
      setMapeo(datosMapeo);
      setProyectoMapeoId((actual) => actual ?? datosProyectos[0]?.id ?? null);
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

  // ------------------------------------------------------------------
  // Dias feriados (migracion 048)
  // ------------------------------------------------------------------
  const provinciasDelDepartamento = useMemo(
    () => ubigeoProvincias.filter((p) => p.departamento_codigo === nuevoFeriado.ubigeo_departamento_codigo),
    [ubigeoProvincias, nuevoFeriado.ubigeo_departamento_codigo]
  );
  const distritosDeLaProvincia = useMemo(
    () => ubigeoDistritos.filter((d) => d.provincia_codigo === nuevoFeriado.ubigeo_provincia_codigo),
    [ubigeoDistritos, nuevoFeriado.ubigeo_provincia_codigo]
  );

  function cambiarAmbitoFeriado(ambito: AmbitoFeriado) {
    setNuevoFeriado((f) => ({
      ...f,
      ambito,
      ubigeo_departamento_codigo: "",
      ubigeo_provincia_codigo: "",
      ubigeo_distrito_codigo: "",
    }));
  }

  async function agregarFeriado() {
    if (!nuevoFeriado.fecha || !nuevoFeriado.descripcion.trim()) {
      setError("La fecha y la descripción son obligatorias para agregar un feriado.");
      return;
    }
    if (nuevoFeriado.ambito === "REGIONAL" && !nuevoFeriado.ubigeo_departamento_codigo) {
      setError("Un feriado REGIONAL debe llevar el departamento.");
      return;
    }
    if (nuevoFeriado.ambito === "LOCAL" && !nuevoFeriado.ubigeo_provincia_codigo) {
      setError("Un feriado LOCAL debe llevar al menos la provincia (el distrito es opcional).");
      return;
    }
    setGuardandoFeriado(true);
    setError(null);
    try {
      const creado = await apiPost<DiaFeriado>("/conceptos/dias-feriados", {
        fecha: nuevoFeriado.fecha,
        descripcion: nuevoFeriado.descripcion.trim(),
        ambito: nuevoFeriado.ambito,
        ubigeo_departamento_codigo: nuevoFeriado.ambito === "REGIONAL" ? nuevoFeriado.ubigeo_departamento_codigo : null,
        ubigeo_provincia_codigo: nuevoFeriado.ambito === "LOCAL" ? nuevoFeriado.ubigeo_provincia_codigo : null,
        ubigeo_distrito_codigo: nuevoFeriado.ambito === "LOCAL" ? nuevoFeriado.ubigeo_distrito_codigo || null : null,
      });
      setFeriados((prev) => [...prev, creado].sort((a, b) => a.fecha.localeCompare(b.fecha)));
      setNuevoFeriado({
        fecha: "",
        descripcion: "",
        ambito: "NACIONAL",
        ubigeo_departamento_codigo: "",
        ubigeo_provincia_codigo: "",
        ubigeo_distrito_codigo: "",
      });
      setMensaje(`Feriado agregado: ${creado.descripcion}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al agregar el feriado");
    } finally {
      setGuardandoFeriado(false);
    }
  }

  async function eliminarFeriado(feriado: DiaFeriado) {
    if (!confirm(`¿Eliminar el feriado "${feriado.descripcion}" (${feriado.fecha})?`)) return;
    setEliminandoFeriadoId(feriado.id);
    setError(null);
    try {
      await apiDelete(`/conceptos/dias-feriados/${feriado.id}`);
      setFeriados((prev) => prev.filter((f) => f.id !== feriado.id));
      setMensaje(`Feriado eliminado: ${feriado.descripcion}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar el feriado");
    } finally {
      setEliminandoFeriadoId(null);
    }
  }

  function etiquetaUbicacionFeriado(f: DiaFeriado): string {
    if (f.ambito === "NACIONAL") return "—";
    if (f.ambito === "REGIONAL") {
      return ubigeoDepartamentos.find((d) => d.codigo === f.ubigeo_departamento_codigo)?.nombre ?? f.ubigeo_departamento_codigo ?? "—";
    }
    const provincia = ubigeoProvincias.find((p) => p.codigo === f.ubigeo_provincia_codigo)?.nombre ?? f.ubigeo_provincia_codigo;
    const distrito = f.ubigeo_distrito_codigo
      ? ubigeoDistritos.find((d) => d.codigo === f.ubigeo_distrito_codigo)?.nombre ?? f.ubigeo_distrito_codigo
      : null;
    return distrito ? `${provincia} - ${distrito}` : `${provincia}`;
  }

  // ------------------------------------------------------------------
  // Aportes patronales/retenciones (conceptos_aportes, migracion_049).
  // ------------------------------------------------------------------
  function valorAporte<K extends "nombre" | "descripcion" | "codigo_plame">(a: ConceptoAporte, campo: K): ConceptoAporte[K] {
    const edicion = edicionesAporte[a.codigo];
    if (edicion && campo in edicion) return edicion[campo] as ConceptoAporte[K];
    return a[campo];
  }

  function editarAporte(codigo: string, campo: "nombre" | "descripcion" | "codigo_plame", valor: string) {
    setEdicionesAporte((prev) => ({ ...prev, [codigo]: { ...prev[codigo], [campo]: valor } }));
    setMensaje(null);
  }

  async function guardarAporte(a: ConceptoAporte) {
    const cambios = edicionesAporte[a.codigo];
    if (!cambios) return;
    setGuardandoAporte(a.codigo);
    setError(null);
    try {
      const actualizado = await apiPut<ConceptoAporte>(`/conceptos/aportes/${a.codigo}`, cambios);
      setAportes((prev) => prev.map((x) => (x.codigo === a.codigo ? actualizado : x)));
      setEdicionesAporte((prev) => {
        const copia = { ...prev };
        delete copia[a.codigo];
        return copia;
      });
      setMensaje(`Guardado: ${a.nombre}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar el concepto de aporte");
    } finally {
      setGuardandoAporte(null);
    }
  }

  // ------------------------------------------------------------------
  // Plan de Cuentas contable (plan_cuentas, migracion_049). El codigo NO
  // es unico (la empresa reutiliza codigos entre denominaciones distintas).
  // ------------------------------------------------------------------
  function valorCuenta<K extends "codigo" | "denominacion" | "activa">(c: CuentaContable, campo: K): CuentaContable[K] {
    const edicion = edicionesCuenta[c.id];
    if (edicion && campo in edicion) return edicion[campo] as CuentaContable[K];
    return c[campo];
  }

  function editarCuenta(id: number, campo: "codigo" | "denominacion" | "activa", valor: string | boolean) {
    setEdicionesCuenta((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }));
    setMensaje(null);
  }

  async function guardarCuenta(c: CuentaContable) {
    const cambios = edicionesCuenta[c.id];
    if (!cambios) return;
    setGuardandoCuentaId(c.id);
    setError(null);
    try {
      const actualizado = await apiPut<CuentaContable>(`/conceptos/plan-cuentas/${c.id}`, cambios);
      setCuentas((prev) => prev.map((x) => (x.id === c.id ? actualizado : x)));
      setEdicionesCuenta((prev) => {
        const copia = { ...prev };
        delete copia[c.id];
        return copia;
      });
      setMensaje(`Guardado: ${actualizado.codigo} - ${actualizado.denominacion}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar la cuenta contable");
    } finally {
      setGuardandoCuentaId(null);
    }
  }

  async function agregarCuenta() {
    if (!nuevaCuenta.codigo.trim() || !nuevaCuenta.denominacion.trim()) {
      setError("Código y denominación son obligatorios para agregar una cuenta.");
      return;
    }
    setAgregandoCuenta(true);
    setError(null);
    try {
      const creada = await apiPost<CuentaContable>("/conceptos/plan-cuentas", {
        codigo: nuevaCuenta.codigo.trim(),
        denominacion: nuevaCuenta.denominacion.trim(),
        activa: true,
      });
      setCuentas((prev) => [...prev, creada].sort((a, b) => a.codigo.localeCompare(b.codigo) || a.denominacion.localeCompare(b.denominacion)));
      setNuevaCuenta({ codigo: "", denominacion: "" });
      setMensaje(`Cuenta agregada: ${creada.codigo} - ${creada.denominacion}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al agregar la cuenta contable");
    } finally {
      setAgregandoCuenta(false);
    }
  }

  // ------------------------------------------------------------------
  // Mapeo Contable por proyecto (mapeo_cuentas_contables, migracion_049):
  // concepto x proyecto x movimiento -> cuenta, usado por el Asiento
  // Contable (ver src/asientoContable.ts). Se edita un proyecto a la vez
  // (selector arriba de la tabla) para no armar una matriz gigante con
  // TODOS los proyectos a la vez.
  // ------------------------------------------------------------------
  const filasMapeoConceptos = useMemo(
    () => [
      ...conceptos.map((c) => ({ codigo: c.codigo, nombre: c.nombre, movimientos: movimientosDeConceptoIngreso(c.tipo) })),
      ...aportes.map((a) => ({ codigo: a.codigo, nombre: a.nombre, movimientos: movimientosDeAporte(a.tipo_movimiento) })),
    ],
    [conceptos, aportes]
  );

  useEffect(() => {
    if (proyectoMapeoId === null) return;
    const inicial: Record<string, number | ""> = {};
    for (const fila of filasMapeoConceptos) {
      for (const movimiento of fila.movimientos) {
        const existente = mapeo.find(
          (m) => m.concepto_codigo === fila.codigo && m.proyecto_id === proyectoMapeoId && m.tipo_movimiento === movimiento
        );
        inicial[claveMapeo(fila.codigo, movimiento)] = existente?.cuenta_id ?? "";
      }
    }
    setEdicionesMapeo(inicial);
    // Solo se recalcula al cambiar de proyecto o al recargar el mapeo desde
    // el servidor (guardar) - no en cada tecla del propio formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoMapeoId, mapeo, filasMapeoConceptos]);

  function editarMapeo(conceptoCodigo: string, movimiento: "DEBE" | "HABER", cuentaId: string) {
    setEdicionesMapeo((prev) => ({ ...prev, [claveMapeo(conceptoCodigo, movimiento)]: cuentaId === "" ? "" : Number(cuentaId) }));
    setMensaje(null);
  }

  async function guardarMapeoProyecto() {
    if (proyectoMapeoId === null) return;
    // Solo se envian las celdas con una cuenta seleccionada: la API es un
    // upsert (no hay ruta para "desconfigurar" una cuenta ya guardada), asi
    // que dejar una celda en "— sin cuenta —" simplemente no la reenvia (la
    // fila existente, si la habia, queda sin cambios).
    const entradas: { concepto_codigo: string; proyecto_id: number; tipo_movimiento: "DEBE" | "HABER"; cuenta_id: number }[] = [];
    for (const fila of filasMapeoConceptos) {
      for (const movimiento of fila.movimientos) {
        const valor = edicionesMapeo[claveMapeo(fila.codigo, movimiento)];
        if (valor !== "" && valor !== undefined) {
          entradas.push({ concepto_codigo: fila.codigo, proyecto_id: proyectoMapeoId, tipo_movimiento: movimiento, cuenta_id: valor });
        }
      }
    }
    if (entradas.length === 0) {
      setError("No hay ninguna cuenta seleccionada para guardar.");
      return;
    }
    setGuardandoMapeo(true);
    setError(null);
    try {
      await apiPut<MapeoContable[]>("/conceptos/mapeo-contable", { entradas });
      const actualizado = await apiGet<MapeoContable[]>("/conceptos/mapeo-contable");
      setMapeo(actualizado);
      setMensaje("Mapeo contable guardado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar el mapeo contable");
    } finally {
      setGuardandoMapeo(false);
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
                        title="Vacío = usa el recargo general de la empresa"
                        style={{ width: 120 }}
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

    {!cargando && (
      <div className="card" style={{ marginTop: 18 }}>
        <h2 className="titulo-reporte">Días feriados</h2>
        <p style={{ color: "#5a6172", maxWidth: 900 }}>
          Catálogo de fechas feriadas para que el sistema acredite automáticamente el pago del feriado no
          laborado al recalcular el Tareo Diario (D.Leg. 713 — el feriado se paga se trabaje o no). Un feriado
          NACIONAL aplica a todos los proyectos; uno REGIONAL solo aplica a los proyectos configurados en ese
          departamento (ver Proyectos); uno LOCAL solo a los de esa provincia (y distrito, si se especifica).
          Empieza cada año con las fechas oficiales — el catálogo comienza vacío.
        </p>

        <div className="tabla-scroll-horizontal">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Descripción</th>
                <th>Ámbito</th>
                <th>Ubicación</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {feriados.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "#8a90a0" }}>
                    Todavía no hay feriados registrados.
                  </td>
                </tr>
              )}
              {feriados.map((f) => (
                <tr key={f.id}>
                  <td>{f.fecha}</td>
                  <td>{f.descripcion}</td>
                  <td>{f.ambito}</td>
                  <td>{etiquetaUbicacionFeriado(f)}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => eliminarFeriado(f)}
                      disabled={eliminandoFeriadoId === f.id}
                    >
                      {eliminandoFeriadoId === f.id ? "..." : "Eliminar"}
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <input
                    type="date"
                    value={nuevoFeriado.fecha}
                    onChange={(e) => setNuevoFeriado((f) => ({ ...f, fecha: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    placeholder="Ej. Año Nuevo"
                    style={{ width: 220 }}
                    value={nuevoFeriado.descripcion}
                    onChange={(e) => setNuevoFeriado((f) => ({ ...f, descripcion: e.target.value }))}
                  />
                </td>
                <td>
                  <select
                    value={nuevoFeriado.ambito}
                    onChange={(e) => cambiarAmbitoFeriado(e.target.value as AmbitoFeriado)}
                  >
                    <option value="NACIONAL">NACIONAL</option>
                    <option value="REGIONAL">REGIONAL</option>
                    <option value="LOCAL">LOCAL</option>
                  </select>
                </td>
                <td>
                  {nuevoFeriado.ambito === "NACIONAL" && <span style={{ color: "#8a90a0" }}>—</span>}
                  {nuevoFeriado.ambito === "REGIONAL" && (
                    <select
                      value={nuevoFeriado.ubigeo_departamento_codigo}
                      onChange={(e) => setNuevoFeriado((f) => ({ ...f, ubigeo_departamento_codigo: e.target.value }))}
                    >
                      <option value="">Selecciona departamento...</option>
                      {ubigeoDepartamentos.map((d) => (
                        <option key={d.codigo} value={d.codigo}>
                          {d.nombre}
                        </option>
                      ))}
                    </select>
                  )}
                  {nuevoFeriado.ambito === "LOCAL" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <select
                        value={nuevoFeriado.ubigeo_departamento_codigo}
                        onChange={(e) =>
                          setNuevoFeriado((f) => ({
                            ...f,
                            ubigeo_departamento_codigo: e.target.value,
                            ubigeo_provincia_codigo: "",
                            ubigeo_distrito_codigo: "",
                          }))
                        }
                      >
                        <option value="">Departamento...</option>
                        {ubigeoDepartamentos.map((d) => (
                          <option key={d.codigo} value={d.codigo}>
                            {d.nombre}
                          </option>
                        ))}
                      </select>
                      <select
                        value={nuevoFeriado.ubigeo_provincia_codigo}
                        onChange={(e) =>
                          setNuevoFeriado((f) => ({ ...f, ubigeo_provincia_codigo: e.target.value, ubigeo_distrito_codigo: "" }))
                        }
                        disabled={!nuevoFeriado.ubigeo_departamento_codigo}
                      >
                        <option value="">Provincia...</option>
                        {provinciasDelDepartamento.map((p) => (
                          <option key={p.codigo} value={p.codigo}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                      <select
                        value={nuevoFeriado.ubigeo_distrito_codigo}
                        onChange={(e) => setNuevoFeriado((f) => ({ ...f, ubigeo_distrito_codigo: e.target.value }))}
                        disabled={!nuevoFeriado.ubigeo_provincia_codigo}
                      >
                        <option value="">Distrito (opcional)...</option>
                        {distritosDeLaProvincia.map((d) => (
                          <option key={d.codigo} value={d.codigo}>
                            {d.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </td>
                <td>
                  <button type="button" className="primario" onClick={agregarFeriado} disabled={guardandoFeriado}>
                    {guardandoFeriado ? "..." : "Agregar"}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )}

    {!cargando && (
      <div className="card" style={{ marginTop: 18 }}>
        <h2 className="titulo-reporte">Aportes y retenciones</h2>
        <p style={{ color: "#5a6172", maxWidth: 900 }}>
          Catálogo de aportes patronales (EsSalud, SCTR, SENATI, seguro de vida), retenciones al trabajador (ONP,
          AFP, Renta 5ta, CONAFOVICER, cuota sindical) y el neto a pagar. El código PLAME es editable (igual
          criterio que "Conceptos de ingreso"); el tipo de movimiento contable no se puede editar aquí — es fijo
          según el modelo del Asiento Contable.
        </p>
        <div className="tabla-scroll-horizontal">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th style={{ minWidth: 200 }}>Nombre</th>
                <th style={{ minWidth: 260 }}>Descripción</th>
                <th>Código PLAME</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {aportes.map((a) => (
                <tr key={a.codigo}>
                  <td>
                    <code>{a.codigo}</code>
                  </td>
                  <td>
                    <input
                      type="text"
                      style={{ width: 200 }}
                      value={valorAporte(a, "nombre")}
                      onChange={(e) => editarAporte(a.codigo, "nombre", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      style={{ width: 260 }}
                      value={valorAporte(a, "descripcion") ?? ""}
                      onChange={(e) => editarAporte(a.codigo, "descripcion", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      style={{ width: 90 }}
                      maxLength={10}
                      value={valorAporte(a, "codigo_plame") ?? ""}
                      onChange={(e) => editarAporte(a.codigo, "codigo_plame", e.target.value)}
                    />
                  </td>
                  <td>
                    {!!edicionesAporte[a.codigo] && (
                      <button
                        type="button"
                        className="primario"
                        onClick={() => guardarAporte(a)}
                        disabled={guardandoAporte === a.codigo}
                      >
                        {guardandoAporte === a.codigo ? "..." : "Guardar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {!cargando && (
      <div className="card" style={{ marginTop: 18 }}>
        <h2 className="titulo-reporte">Plan de cuentas</h2>
        <p style={{ color: "#5a6172", maxWidth: 900 }}>
          Catálogo de cuentas contables para el Asiento Contable. El código no es único: la empresa puede reutilizar
          el mismo código bajo denominaciones distintas.
        </p>
        <div className="tabla-scroll-horizontal">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th style={{ minWidth: 260 }}>Denominación</th>
                <th style={{ textAlign: "center" }}>Activa</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cuentas.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ color: "#8a90a0" }}>
                    Todavía no hay cuentas registradas.
                  </td>
                </tr>
              )}
              {cuentas.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      type="text"
                      style={{ width: 100 }}
                      maxLength={20}
                      value={valorCuenta(c, "codigo")}
                      onChange={(e) => editarCuenta(c.id, "codigo", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      style={{ width: 320 }}
                      value={valorCuenta(c, "denominacion")}
                      onChange={(e) => editarCuenta(c.id, "denominacion", e.target.value)}
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={valorCuenta(c, "activa")}
                      onChange={(e) => editarCuenta(c.id, "activa", e.target.checked)}
                    />
                  </td>
                  <td>
                    {!!edicionesCuenta[c.id] && (
                      <button
                        type="button"
                        className="primario"
                        onClick={() => guardarCuenta(c)}
                        disabled={guardandoCuentaId === c.id}
                      >
                        {guardandoCuentaId === c.id ? "..." : "Guardar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <input
                    type="text"
                    placeholder="Código"
                    style={{ width: 100 }}
                    maxLength={20}
                    value={nuevaCuenta.codigo}
                    onChange={(e) => setNuevaCuenta((v) => ({ ...v, codigo: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    placeholder="Denominación"
                    style={{ width: 320 }}
                    value={nuevaCuenta.denominacion}
                    onChange={(e) => setNuevaCuenta((v) => ({ ...v, denominacion: e.target.value }))}
                  />
                </td>
                <td></td>
                <td>
                  <button type="button" className="primario" onClick={agregarCuenta} disabled={agregandoCuenta}>
                    {agregandoCuenta ? "..." : "Agregar"}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )}

    {!cargando && (
      <div className="card" style={{ marginTop: 18 }}>
        <h2 className="titulo-reporte">Mapeo contable por proyecto</h2>
        <p style={{ color: "#5a6172", maxWidth: 900 }}>
          Para cada proyecto, asigna la cuenta contable de cada concepto de ingreso y de cada aporte/retención. El
          Asiento Contable (Planilla Mensual y Reportes) no genera una línea sin esta configuración: si falta
          alguna, se avisa con el detalle completo al intentar descargarlo. Elige un proyecto, completa las
          cuentas que falten y guarda — las celdas ya guardadas antes se pueden cambiar, pero no "vaciar" desde
          aquí.
        </p>
        <div style={{ marginBottom: 12 }}>
          <label>
            Proyecto:{" "}
            <select
              value={proyectoMapeoId ?? ""}
              onChange={(e) => setProyectoMapeoId(e.target.value === "" ? null : Number(e.target.value))}
            >
              {proyectos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
        {proyectoMapeoId !== null && (
          <div className="tabla-scroll-horizontal">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Concepto</th>
                  <th>Cuenta (Debe)</th>
                  <th>Cuenta (Haber)</th>
                </tr>
              </thead>
              <tbody>
                {filasMapeoConceptos.map((fila) => (
                  <tr key={fila.codigo}>
                    <td>{fila.nombre}</td>
                    {(["DEBE", "HABER"] as const).map((movimiento) => (
                      <td key={movimiento}>
                        {fila.movimientos.includes(movimiento) ? (
                          <select
                            value={edicionesMapeo[claveMapeo(fila.codigo, movimiento)] ?? ""}
                            onChange={(e) => editarMapeo(fila.codigo, movimiento, e.target.value)}
                          >
                            <option value="">— sin cuenta —</option>
                            {cuentas.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.codigo} - {c.denominacion}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ color: "#b0b5c0" }}>—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="primario" onClick={guardarMapeoProyecto} disabled={guardandoMapeo || proyectoMapeoId === null}>
            {guardandoMapeo ? "Guardando..." : "Guardar mapeo de este proyecto"}
          </button>
        </div>
      </div>
    )}
    </>
  );
}
