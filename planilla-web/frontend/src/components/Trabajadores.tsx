import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, BASE_URL, conToken, ErrorApi } from "../api";
import { CategoriaOcupacional, Catalogos, CatalogoItem, Contrato, Empleado, Proyecto } from "../types";

// Crea un contrato; si el trabajador ya tiene otro contrato HABIL, el
// backend responde 409 pidiendo confirmacion (ver routes/contratos.ts) en
// vez de bloquear directamente - puede ser un descuido (olvidaron cesar el
// anterior) o un caso legitimo (dos proyectos a la vez), asi que se le
// pregunta al usuario en vez de decidir por el.
async function crearContratoConConfirmacion(cuerpo: Record<string, unknown>): Promise<Contrato> {
  try {
    return await apiPost<Contrato>("/contratos", cuerpo);
  } catch (e) {
    if (e instanceof ErrorApi && e.status === 409 && (e.body as { requiere_confirmacion?: boolean })?.requiere_confirmacion) {
      const habiles = (e.body as { contratos_habiles?: { proyecto: string; fecha_ingreso: string }[] }).contratos_habiles ?? [];
      const detalle = habiles.map((h) => `${h.proyecto} (desde ${h.fecha_ingreso})`).join(", ");
      const continuar = window.confirm(
        `${e.message}${detalle ? `\n\nContrato(s) activo(s) actual(es): ${detalle}` : ""}`
      );
      if (!continuar) {
        throw new Error("Registro cancelado: ya existe un contrato activo para este trabajador.");
      }
      return await apiPost<Contrato>("/contratos", { ...cuerpo, confirmar_duplicado: true });
    }
    throw e;
  }
}

const CATEGORIAS: CategoriaOcupacional[] = [
  "OPERARIO",
  "OFICIAL",
  "PEON",
  "EMPLEADO",
  "EVENTUAL",
  "OPERARIO_EP",
  "OPERARIO_EM",
  "OPERARIO_TP",
  "PEON_A",
  "R_GENERAL",
];

const ESTADOS_CIVILES = ["SOLTERO", "CASADO", "VIUDO", "DIVORCIADO", "CONVIVIENTE"];

const estadoVacio = {
  tipo_documento: "01",
  numero_documento: "",
  apellidos_nombres: "",
  fecha_nacimiento: "",
  sexo: "",
  estado_civil: "",
  nacionalidad_codigo: "9589",
  pais_emisor_documento_codigo: "",
  grado_instruccion_codigo: "",
  numero_hijos: "0",
  celular: "",
  correo: "",
  direccion: "",
  segunda_direccion: "",
  direccion_essalud: "",
  ubigeo_departamento_codigo: "",
  ubigeo_provincia_codigo: "",
  ubigeo_distrito_codigo: "",
  discapacidad: false,
  entidad_bancaria_codigo: "",
  cuenta_bancaria: "",
  proyecto: "",
  grupo: "",
  ocupacion: "",
  categoria_ocupacional: "PEON" as CategoriaOcupacional,
  categoria_ocupacional_sunat_codigo: "",
  tipo_trabajador_codigo: "27",
  regimen_laboral_codigo: "21",
  tipo_contrato_codigo: "",
  sistema_pension: "ONP" as "AFP" | "ONP",
  afp_nombre: "",
  cuspp: "",
  sistema_comision: "",
  fecha_ingreso: "",
  fecha_cese: "",
  sueldo_base: "",
  viaticos: "0",
  tipo_pago_codigo: "",
  periodicidad_codigo: "",
  situacion_especial_codigo: "0",
  jornada_laboral: "",
  regimen_salud_codigo: "00",
  eps_codigo: "",
  sindicalizado: false,
  poliza_seguro: false,
  sctr_salud: false,
  essalud_vida: false,
  domiciliado: true,
};

type FormularioTrabajador = typeof estadoVacio;

// Desplegable generico "codigo - nombre" para los catalogos SUNAT (todos
// tienen la misma forma). vacioTexto es la opcion en blanco (ej. "Sin EPS",
// "Selecciona...") - si se omite no se agrega ninguna opcion vacia (el
// campo queda como obligatorio de hecho).
function SelectorCatalogo({
  value,
  onChange,
  opciones,
  vacioTexto,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  opciones: CatalogoItem[];
  vacioTexto?: string;
  required?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      {vacioTexto !== undefined && <option value="">{vacioTexto}</option>}
      {opciones.map((o) => (
        <option key={o.codigo} value={o.codigo}>
          {o.codigo} - {o.nombre}
        </option>
      ))}
    </select>
  );
}

export default function Trabajadores() {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [busqueda, setBusqueda] = useState("");
  // Que trabajadores mostrar: solo los que siguen activos (por defecto, igual
  // que antes), solo los dados de baja, o todos sin filtrar por estado.
  const [filtroEstado, setFiltroEstado] = useState<"HABIL" | "CESADO" | "TODOS">("HABIL");
  const [form, setForm] = useState<FormularioTrabajador>(estadoVacio);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Cuando no es null, el formulario esta editando este contrato en vez de crear uno nuevo
  const [contratoEnEdicion, setContratoEnEdicion] = useState<Contrato | null>(null);
  // Cuando no es null, el formulario esta creando un contrato NUEVO para un
  // trabajador que YA EXISTE (reingreso tras un cese) - no se crea un
  // empleado nuevo, solo un contrato adicional para este empleado_id.
  const [reingresoEmpleadoId, setReingresoEmpleadoId] = useState<number | null>(null);

  // Dar de baja necesita pedir fecha Y motivo (T17) - un solo window.prompt
  // ya no alcanza, asi que se muestra un mini-formulario inline en vez de
  // agregarle un segundo prompt encadenado (mala experiencia de uso).
  const [cesando, setCesando] = useState<Contrato | null>(null);
  const [fechaCese, setFechaCese] = useState("");
  const [motivoBaja, setMotivoBaja] = useState("");
  const [guardandoBaja, setGuardandoBaja] = useState(false);

  // Historial de periodos de un trabajador (todos sus contratos, HABIL y
  // CESADO) - GET /api/contratos?empleado_id=X ya devuelve todo sin filtrar
  // por estado, no hace falta nada nuevo en el backend.
  const [historialEmpleadoId, setHistorialEmpleadoId] = useState<number | null>(null);
  const [historialNombre, setHistorialNombre] = useState("");
  const [historialContratos, setHistorialContratos] = useState<Contrato[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  async function cargar() {
    try {
      const filtro = filtroEstado === "TODOS" ? "" : `?estado=${filtroEstado}`;
      const datos = await apiGet<Contrato[]>(`/contratos${filtro}`);
      setContratos(datos);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroEstado]);

  useEffect(() => {
    apiGet<Proyecto[]>("/proyectos").then(setProyectos).catch((e) => setError((e as Error).message));
    apiGet<Catalogos>("/catalogos").then(setCatalogos).catch((e) => setError((e as Error).message));
  }, []);

  // URL de descarga (Excel/PDF) del listado actualmente visible: mismo
  // filtro de estado y mismo texto de busqueda que se ve en pantalla.
  function urlExportar(formato: "excel" | "pdf"): string {
    const params = new URLSearchParams();
    if (filtroEstado !== "TODOS") params.set("estado", filtroEstado);
    if (busqueda.trim()) params.set("q", busqueda.trim());
    return conToken(`${BASE_URL}/contratos/exportar/${formato}?${params.toString()}`);
  }

  const contratosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return contratos;
    return contratos.filter(
      (c) =>
        c.numero_documento?.toLowerCase().includes(q) ||
        c.apellidos_nombres?.toLowerCase().includes(q) ||
        c.proyecto?.toLowerCase().includes(q)
    );
  }, [contratos, busqueda]);

  const provinciasDisponibles = useMemo(
    () => catalogos?.ubigeo_provincia.filter((p) => p.departamento_codigo === form.ubigeo_departamento_codigo) ?? [],
    [catalogos, form.ubigeo_departamento_codigo]
  );
  const distritosDisponibles = useMemo(
    () => catalogos?.ubigeo_distrito.filter((d) => d.provincia_codigo === form.ubigeo_provincia_codigo) ?? [],
    [catalogos, form.ubigeo_provincia_codigo]
  );

  function actualizarCampo<K extends keyof FormularioTrabajador>(campo: K, valor: FormularioTrabajador[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function actualizarDepartamento(codigo: string) {
    setForm((f) => ({ ...f, ubigeo_departamento_codigo: codigo, ubigeo_provincia_codigo: "", ubigeo_distrito_codigo: "" }));
  }

  function actualizarProvincia(codigo: string) {
    setForm((f) => ({ ...f, ubigeo_provincia_codigo: codigo, ubigeo_distrito_codigo: "" }));
  }

  async function iniciarEdicion(contrato: Contrato) {
    setError(null);
    setOk(null);
    try {
      const empleado = await apiGet<Empleado>(`/empleados/${contrato.empleado_id}`);
      setContratoEnEdicion(contrato);
      setForm({
        tipo_documento: empleado.tipo_documento ?? "01",
        numero_documento: empleado.numero_documento,
        apellidos_nombres: empleado.apellidos_nombres,
        fecha_nacimiento: empleado.fecha_nacimiento?.slice(0, 10) ?? "",
        sexo: empleado.sexo ?? "",
        estado_civil: empleado.estado_civil ?? "",
        nacionalidad_codigo: empleado.nacionalidad_codigo ?? "9589",
        pais_emisor_documento_codigo: empleado.pais_emisor_documento_codigo ?? "",
        grado_instruccion_codigo: empleado.grado_instruccion_codigo ?? "",
        numero_hijos: String(empleado.numero_hijos ?? 0),
        celular: empleado.celular ?? "",
        correo: empleado.correo ?? "",
        direccion: empleado.direccion ?? "",
        segunda_direccion: empleado.segunda_direccion ?? "",
        direccion_essalud: empleado.direccion_essalud ?? "",
        ubigeo_departamento_codigo: empleado.ubigeo_departamento_codigo ?? "",
        ubigeo_provincia_codigo: empleado.ubigeo_provincia_codigo ?? "",
        ubigeo_distrito_codigo: empleado.ubigeo_distrito_codigo ?? "",
        discapacidad: empleado.discapacidad ?? false,
        entidad_bancaria_codigo: empleado.entidad_bancaria_codigo ?? "",
        cuenta_bancaria: empleado.cuenta_bancaria ?? "",
        proyecto: contrato.proyecto,
        grupo: contrato.grupo ?? "",
        ocupacion: contrato.ocupacion ?? "",
        categoria_ocupacional: contrato.categoria_ocupacional,
        categoria_ocupacional_sunat_codigo: contrato.categoria_ocupacional_sunat_codigo ?? "",
        tipo_trabajador_codigo: contrato.tipo_trabajador_codigo ?? "27",
        regimen_laboral_codigo: contrato.regimen_laboral_codigo ?? "21",
        tipo_contrato_codigo: contrato.tipo_contrato_codigo ?? "",
        sistema_pension: contrato.sistema_pension,
        afp_nombre: contrato.afp_nombre ?? "",
        cuspp: contrato.cuspp ?? "",
        sistema_comision: contrato.sistema_comision ?? "",
        fecha_ingreso: contrato.fecha_ingreso?.slice(0, 10) ?? "",
        fecha_cese: contrato.fecha_cese?.slice(0, 10) ?? "",
        sueldo_base: contrato.sueldo_base != null ? String(contrato.sueldo_base) : "",
        viaticos: "0",
        tipo_pago_codigo: contrato.tipo_pago_codigo ?? "",
        periodicidad_codigo: contrato.periodicidad_codigo ?? "",
        situacion_especial_codigo: contrato.situacion_especial_codigo ?? "0",
        jornada_laboral: contrato.jornada_laboral ?? "",
        regimen_salud_codigo: contrato.regimen_salud_codigo ?? "00",
        eps_codigo: contrato.eps_codigo ?? "",
        sindicalizado: contrato.sindicalizado,
        poliza_seguro: contrato.poliza_seguro,
        sctr_salud: contrato.sctr_salud,
        essalud_vida: contrato.essalud_vida ?? false,
        domiciliado: contrato.domiciliado ?? true,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function cancelarEdicion() {
    setContratoEnEdicion(null);
    setReingresoEmpleadoId(null);
    setForm(estadoVacio);
    setError(null);
    setOk(null);
  }

  async function verHistorial(empleadoId: number, nombre: string) {
    setError(null);
    setHistorialEmpleadoId(empleadoId);
    setHistorialNombre(nombre);
    setHistorialContratos([]);
    setCargandoHistorial(true);
    try {
      const datos = await apiGet<Contrato[]>(`/contratos?empleado_id=${empleadoId}`);
      setHistorialContratos(datos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargandoHistorial(false);
    }
  }

  function cerrarHistorial() {
    setHistorialEmpleadoId(null);
    setHistorialContratos([]);
  }

  function nombreMotivoBaja(codigo?: string | null): string {
    if (!codigo) return "-";
    return catalogos?.motivo_baja.find((m) => m.codigo === codigo)?.nombre ?? codigo;
  }

  // Reingreso: el trabajador ya existe (empleados no se borra al cesar un
  // contrato), asi que solo hace falta un contrato NUEVO para el mismo
  // empleado_id. Se precargan los datos personales (por si cambiaron, ej.
  // domicilio o celular) y los datos laborales del ultimo contrato, pero
  // se limpian fecha_ingreso/fecha_cese para que el usuario indique la
  // fecha real de reingreso.
  async function iniciarReingreso(contrato: Contrato) {
    setError(null);
    setOk(null);
    try {
      const empleado = await apiGet<Empleado>(`/empleados/${contrato.empleado_id}`);
      setContratoEnEdicion(null);
      setReingresoEmpleadoId(contrato.empleado_id);
      setForm({
        tipo_documento: empleado.tipo_documento ?? "01",
        numero_documento: empleado.numero_documento,
        apellidos_nombres: empleado.apellidos_nombres,
        fecha_nacimiento: empleado.fecha_nacimiento?.slice(0, 10) ?? "",
        sexo: empleado.sexo ?? "",
        estado_civil: empleado.estado_civil ?? "",
        nacionalidad_codigo: empleado.nacionalidad_codigo ?? "9589",
        pais_emisor_documento_codigo: empleado.pais_emisor_documento_codigo ?? "",
        grado_instruccion_codigo: empleado.grado_instruccion_codigo ?? "",
        numero_hijos: String(empleado.numero_hijos ?? 0),
        celular: empleado.celular ?? "",
        correo: empleado.correo ?? "",
        direccion: empleado.direccion ?? "",
        segunda_direccion: empleado.segunda_direccion ?? "",
        direccion_essalud: empleado.direccion_essalud ?? "",
        ubigeo_departamento_codigo: empleado.ubigeo_departamento_codigo ?? "",
        ubigeo_provincia_codigo: empleado.ubigeo_provincia_codigo ?? "",
        ubigeo_distrito_codigo: empleado.ubigeo_distrito_codigo ?? "",
        discapacidad: empleado.discapacidad ?? false,
        entidad_bancaria_codigo: empleado.entidad_bancaria_codigo ?? "",
        cuenta_bancaria: empleado.cuenta_bancaria ?? "",
        proyecto: contrato.proyecto,
        grupo: contrato.grupo ?? "",
        ocupacion: contrato.ocupacion ?? "",
        categoria_ocupacional: contrato.categoria_ocupacional,
        categoria_ocupacional_sunat_codigo: contrato.categoria_ocupacional_sunat_codigo ?? "",
        tipo_trabajador_codigo: contrato.tipo_trabajador_codigo ?? "27",
        regimen_laboral_codigo: contrato.regimen_laboral_codigo ?? "21",
        tipo_contrato_codigo: contrato.tipo_contrato_codigo ?? "",
        sistema_pension: contrato.sistema_pension,
        afp_nombre: contrato.afp_nombre ?? "",
        cuspp: contrato.cuspp ?? "",
        sistema_comision: contrato.sistema_comision ?? "",
        fecha_ingreso: "",
        fecha_cese: "",
        sueldo_base: contrato.sueldo_base != null ? String(contrato.sueldo_base) : "",
        viaticos: "0",
        tipo_pago_codigo: contrato.tipo_pago_codigo ?? "",
        periodicidad_codigo: contrato.periodicidad_codigo ?? "",
        situacion_especial_codigo: contrato.situacion_especial_codigo ?? "0",
        jornada_laboral: contrato.jornada_laboral ?? "",
        regimen_salud_codigo: contrato.regimen_salud_codigo ?? "00",
        eps_codigo: contrato.eps_codigo ?? "",
        sindicalizado: contrato.sindicalizado,
        poliza_seguro: contrato.poliza_seguro,
        sctr_salud: contrato.sctr_salud,
        essalud_vida: contrato.essalud_vida ?? false,
        domiciliado: contrato.domiciliado ?? true,
      });
      cerrarHistorial();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function iniciarBaja(contrato: Contrato) {
    setError(null);
    setOk(null);
    setCesando(contrato);
    setFechaCese(new Date().toISOString().slice(0, 10));
    setMotivoBaja("");
  }

  async function confirmarBaja() {
    if (!cesando) return;
    setError(null);
    setOk(null);
    setGuardandoBaja(true);
    try {
      await apiPost(`/contratos/${cesando.id}/cese`, {
        fecha_cese: fechaCese,
        motivo_baja_codigo: motivoBaja || null,
      });
      setOk(`${cesando.apellidos_nombres} dado de baja correctamente.`);
      setCesando(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoBaja(false);
    }
  }

  async function guardarTrabajador(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setGuardando(true);
    try {
      const datosEmpleado = {
        tipo_documento: form.tipo_documento,
        apellidos_nombres: form.apellidos_nombres,
        fecha_nacimiento: form.fecha_nacimiento || null,
        sexo: form.sexo || null,
        estado_civil: form.estado_civil || null,
        nacionalidad_codigo: form.nacionalidad_codigo || null,
        pais_emisor_documento_codigo: form.tipo_documento === "07" ? form.pais_emisor_documento_codigo || null : null,
        grado_instruccion_codigo: form.grado_instruccion_codigo || null,
        numero_hijos: Number(form.numero_hijos) || 0,
        celular: form.celular || null,
        correo: form.correo || null,
        direccion: form.direccion || null,
        segunda_direccion: form.segunda_direccion || null,
        direccion_essalud: form.direccion_essalud || null,
        ubigeo_departamento_codigo: form.ubigeo_departamento_codigo || null,
        ubigeo_provincia_codigo: form.ubigeo_provincia_codigo || null,
        ubigeo_distrito_codigo: form.ubigeo_distrito_codigo || null,
        discapacidad: form.discapacidad,
        entidad_bancaria_codigo: form.entidad_bancaria_codigo || null,
        cuenta_bancaria: form.cuenta_bancaria || null,
      };
      const datosContrato = {
        proyecto: form.proyecto,
        grupo: form.grupo || null,
        ocupacion: form.ocupacion || null,
        categoria_ocupacional: form.categoria_ocupacional,
        categoria_ocupacional_sunat_codigo: form.categoria_ocupacional_sunat_codigo || null,
        tipo_trabajador_codigo: form.tipo_trabajador_codigo || null,
        regimen_laboral_codigo: form.regimen_laboral_codigo || null,
        tipo_contrato_codigo: form.tipo_contrato_codigo || null,
        sistema_pension: form.sistema_pension,
        afp_nombre: form.sistema_pension === "AFP" ? form.afp_nombre : null,
        cuspp: form.cuspp || null,
        sistema_comision: form.sistema_comision || null,
        fecha_ingreso: form.fecha_ingreso,
        fecha_cese: form.fecha_cese || null,
        sueldo_base:
          form.categoria_ocupacional === "EMPLEADO" || form.categoria_ocupacional === "EVENTUAL"
            ? Number(form.sueldo_base)
            : null,
        viaticos: Number(form.viaticos) || 0,
        tipo_pago_codigo: form.tipo_pago_codigo || null,
        periodicidad_codigo: form.periodicidad_codigo || null,
        situacion_especial_codigo: form.situacion_especial_codigo || null,
        jornada_laboral: form.jornada_laboral || null,
        regimen_salud_codigo: form.regimen_salud_codigo || null,
        eps_codigo: form.eps_codigo || null,
        sindicalizado: form.sindicalizado,
        poliza_seguro: form.poliza_seguro,
        sctr_salud: form.sctr_salud,
        essalud_vida: form.essalud_vida,
        domiciliado: form.domiciliado,
      };

      if (contratoEnEdicion) {
        await apiPut<Empleado>(`/empleados/${contratoEnEdicion.empleado_id}`, datosEmpleado);
        await apiPut<Contrato>(`/contratos/${contratoEnEdicion.id}`, datosContrato);
        setOk(`Trabajador ${form.apellidos_nombres} actualizado correctamente.`);
        setContratoEnEdicion(null);
      } else if (reingresoEmpleadoId) {
        await apiPut<Empleado>(`/empleados/${reingresoEmpleadoId}`, datosEmpleado);
        await crearContratoConConfirmacion({ empleado_id: reingresoEmpleadoId, ...datosContrato });
        setOk(`Reingreso de ${form.apellidos_nombres} registrado correctamente.`);
        setReingresoEmpleadoId(null);
      } else {
        const empleado = await apiPost<Empleado>("/empleados", {
          numero_documento: form.numero_documento,
          ...datosEmpleado,
        });
        await crearContratoConConfirmacion({ empleado_id: empleado.id, ...datosContrato });
        setOk(`Trabajador ${form.apellidos_nombres} registrado correctamente.`);
      }

      setForm(estadoVacio);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>
          {contratoEnEdicion
            ? `Editar trabajador — ${form.apellidos_nombres}`
            : reingresoEmpleadoId
            ? `Reingreso de trabajador — ${form.apellidos_nombres}`
            : "Nuevo trabajador"}
        </h2>
        {reingresoEmpleadoId && (
          <p style={{ color: "#5a6172", fontSize: "0.85rem", marginTop: -8 }}>
            Este trabajador ya existe en el sistema. Se creará un contrato nuevo (indica la fecha de
            reingreso); sus datos personales no se duplican.
          </p>
        )}
        {error && <div className="mensaje-error">{error}</div>}
        {ok && <div className="mensaje-ok">{ok}</div>}
        {!catalogos && <p style={{ color: "#5a6172" }}>Cargando catálogos SUNAT...</p>}
        {catalogos && (
        <form onSubmit={guardarTrabajador}>
          <h3 className="seccion-titulo">Datos personales</h3>
          <div className="form-grid">
            <label>
              Tipo de documento
              <SelectorCatalogo
                value={form.tipo_documento}
                onChange={(v) => actualizarCampo("tipo_documento", v)}
                opciones={catalogos.tipo_documento}
              />
            </label>
            <label>
              N° de documento
              <input
                required
                disabled={!!contratoEnEdicion || !!reingresoEmpleadoId}
                value={form.numero_documento}
                onChange={(e) => actualizarCampo("numero_documento", e.target.value)}
              />
            </label>
            <label>
              Apellidos y nombres
              <input
                required
                value={form.apellidos_nombres}
                onChange={(e) => actualizarCampo("apellidos_nombres", e.target.value)}
              />
            </label>
            <label>
              Sexo
              <select value={form.sexo} onChange={(e) => actualizarCampo("sexo", e.target.value)}>
                <option value="">Selecciona...</option>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
              </select>
            </label>
            <label>
              Fecha nacimiento
              <input
                type="date"
                value={form.fecha_nacimiento}
                onChange={(e) => actualizarCampo("fecha_nacimiento", e.target.value)}
              />
            </label>
            <label>
              Estado civil
              <select value={form.estado_civil} onChange={(e) => actualizarCampo("estado_civil", e.target.value)}>
                <option value="">Selecciona...</option>
                {ESTADOS_CIVILES.map((ec) => (
                  <option key={ec} value={ec}>{ec}</option>
                ))}
              </select>
            </label>
            <label>
              Nacionalidad
              <SelectorCatalogo
                value={form.nacionalidad_codigo}
                onChange={(v) => actualizarCampo("nacionalidad_codigo", v)}
                opciones={catalogos.nacionalidad}
              />
            </label>
            {form.tipo_documento === "07" && (
              <label>
                País emisor del documento (pasaporte)
                <SelectorCatalogo
                  value={form.pais_emisor_documento_codigo}
                  onChange={(v) => actualizarCampo("pais_emisor_documento_codigo", v)}
                  opciones={catalogos.nacionalidad}
                  vacioTexto="Selecciona..."
                />
              </label>
            )}
            <label>
              Grado de instrucción
              <SelectorCatalogo
                value={form.grado_instruccion_codigo}
                onChange={(v) => actualizarCampo("grado_instruccion_codigo", v)}
                opciones={catalogos.grado_instruccion}
                vacioTexto="Selecciona..."
              />
            </label>
            <label>
              N° hijos
              <input
                type="number"
                min={0}
                value={form.numero_hijos}
                onChange={(e) => actualizarCampo("numero_hijos", e.target.value)}
              />
            </label>
            <label>
              Celular
              <input value={form.celular} onChange={(e) => actualizarCampo("celular", e.target.value)} />
            </label>
            <label>
              Correo electrónico
              <input
                type="email"
                value={form.correo}
                onChange={(e) => actualizarCampo("correo", e.target.value)}
              />
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6, display: "inline-flex" }}>
              <input type="checkbox" checked={form.discapacidad} onChange={(e) => actualizarCampo("discapacidad", e.target.checked)} />
              Persona con discapacidad
            </label>
          </div>

          <h3 className="seccion-titulo">Domicilio</h3>
          <p style={{ color: "#5a6172", fontSize: "0.85rem", marginTop: -8 }}>
            La dirección del DNI muchas veces difiere de donde vive realmente el trabajador - por
            eso hay una segunda dirección opcional (igual que en la Constancia de Alta de SUNAT).
          </p>
          <div className="form-grid">
            <label>
              Primera dirección
              <input value={form.direccion} onChange={(e) => actualizarCampo("direccion", e.target.value)} />
            </label>
            <label>
              Segunda dirección (opcional, ej. donde vive realmente)
              <input value={form.segunda_direccion} onChange={(e) => actualizarCampo("segunda_direccion", e.target.value)} />
            </label>
            <label>
              Dirección referente EsSalud (opcional)
              <input value={form.direccion_essalud} onChange={(e) => actualizarCampo("direccion_essalud", e.target.value)} />
            </label>
            <label>
              Departamento
              <SelectorCatalogo
                value={form.ubigeo_departamento_codigo}
                onChange={actualizarDepartamento}
                opciones={catalogos.ubigeo_departamento}
                vacioTexto="Selecciona..."
              />
            </label>
            <label>
              Provincia
              <SelectorCatalogo
                value={form.ubigeo_provincia_codigo}
                onChange={actualizarProvincia}
                opciones={provinciasDisponibles}
                vacioTexto={form.ubigeo_departamento_codigo ? "Selecciona..." : "Elige un departamento primero"}
              />
            </label>
            <label>
              Distrito
              <SelectorCatalogo
                value={form.ubigeo_distrito_codigo}
                onChange={(v) => actualizarCampo("ubigeo_distrito_codigo", v)}
                opciones={distritosDisponibles}
                vacioTexto={form.ubigeo_provincia_codigo ? "Selecciona..." : "Elige una provincia primero"}
              />
            </label>
          </div>

          <h3 className="seccion-titulo">Datos bancarios</h3>
          <div className="form-grid">
            <label>
              Entidad bancaria
              <SelectorCatalogo
                value={form.entidad_bancaria_codigo}
                onChange={(v) => actualizarCampo("entidad_bancaria_codigo", v)}
                opciones={catalogos.banco}
                vacioTexto="Selecciona..."
              />
            </label>
            <label>
              N° cuenta
              <input
                value={form.cuenta_bancaria}
                onChange={(e) => actualizarCampo("cuenta_bancaria", e.target.value)}
              />
            </label>
          </div>

          <h3 className="seccion-titulo">Datos laborales</h3>
          <div className="form-grid">
            <label>
              Proyecto / obra
              <select
                required
                value={form.proyecto}
                onChange={(e) => actualizarCampo("proyecto", e.target.value)}
              >
                <option value="">Selecciona...</option>
                {proyectos.map((p) => (
                  <option key={p.id} value={p.nombre}>{p.nombre}</option>
                ))}
              </select>
            </label>
            <label>
              Grupo
              <input value={form.grupo} onChange={(e) => actualizarCampo("grupo", e.target.value)} />
            </label>
            <label>
              Ocupación
              <input value={form.ocupacion} onChange={(e) => actualizarCampo("ocupacion", e.target.value)} />
            </label>
            <label>
              Categoria (convenio construcción civil)
              <select
                value={form.categoria_ocupacional}
                onChange={(e) => actualizarCampo("categoria_ocupacional", e.target.value as CategoriaOcupacional)}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Categoría ocupacional oficial (T-Registro)
              <SelectorCatalogo
                value={form.categoria_ocupacional_sunat_codigo}
                onChange={(v) => actualizarCampo("categoria_ocupacional_sunat_codigo", v)}
                opciones={catalogos.categoria_ocupacional_sunat}
                vacioTexto="Selecciona..."
              />
            </label>
            <label>
              Tipo de trabajador (T-Registro)
              <SelectorCatalogo
                value={form.tipo_trabajador_codigo}
                onChange={(v) => actualizarCampo("tipo_trabajador_codigo", v)}
                opciones={catalogos.tipo_trabajador}
              />
            </label>
            <label>
              Régimen laboral (T-Registro)
              <SelectorCatalogo
                value={form.regimen_laboral_codigo}
                onChange={(v) => actualizarCampo("regimen_laboral_codigo", v)}
                opciones={catalogos.regimen_laboral}
              />
            </label>
            <label>
              Tipo de contrato
              <SelectorCatalogo
                value={form.tipo_contrato_codigo}
                onChange={(v) => actualizarCampo("tipo_contrato_codigo", v)}
                opciones={catalogos.tipo_contrato}
                vacioTexto="Selecciona..."
              />
            </label>
            <label>
              Jornada laboral
              <input
                value={form.jornada_laboral}
                onChange={(e) => actualizarCampo("jornada_laboral", e.target.value)}
                placeholder="Ej: Jornada de trabajo máxima"
              />
            </label>
            <label>
              Sistema pension
              <select
                value={form.sistema_pension}
                onChange={(e) => actualizarCampo("sistema_pension", e.target.value as "AFP" | "ONP")}
              >
                <option value="ONP">ONP</option>
                <option value="AFP">AFP</option>
              </select>
            </label>
            {form.sistema_pension === "AFP" && (
              <>
                <label>
                  AFP
                  <select value={form.afp_nombre} onChange={(e) => actualizarCampo("afp_nombre", e.target.value)}>
                    <option value="">Selecciona...</option>
                    <option value="INTEGRA">INTEGRA</option>
                    <option value="PRIMA">PRIMA</option>
                    <option value="PROFUTURO">PROFUTURO</option>
                    <option value="HABITAT">HABITAT</option>
                  </select>
                </label>
                <label>
                  CUSPP
                  <input value={form.cuspp} onChange={(e) => actualizarCampo("cuspp", e.target.value)} />
                </label>
                <label>
                  Sistema comisión
                  <select
                    value={form.sistema_comision}
                    onChange={(e) => actualizarCampo("sistema_comision", e.target.value)}
                  >
                    <option value="">Selecciona...</option>
                    <option value="F">Flujo</option>
                    <option value="S">Saldo</option>
                    <option value="M">Mixta</option>
                  </select>
                </label>
              </>
            )}
            <label>
              Fecha ingreso
              <input
                required
                type="date"
                value={form.fecha_ingreso}
                onChange={(e) => actualizarCampo("fecha_ingreso", e.target.value)}
              />
            </label>
            {form.categoria_ocupacional === "EMPLEADO" && (
              <label>
                Sueldo base (S/.)
                <input
                  type="number"
                  step="0.01"
                  value={form.sueldo_base}
                  onChange={(e) => actualizarCampo("sueldo_base", e.target.value)}
                />
              </label>
            )}
            {form.categoria_ocupacional === "EVENTUAL" && (
              <label>
                Monto pactado (S/.)
                <input
                  type="number"
                  step="0.01"
                  value={form.sueldo_base}
                  onChange={(e) => actualizarCampo("sueldo_base", e.target.value)}
                />
              </label>
            )}
            <label>
              Viáticos (S/.)
              <input
                type="number"
                step="0.01"
                value={form.viaticos}
                onChange={(e) => actualizarCampo("viaticos", e.target.value)}
              />
            </label>
            <label>
              Tipo de pago
              <SelectorCatalogo
                value={form.tipo_pago_codigo}
                onChange={(v) => actualizarCampo("tipo_pago_codigo", v)}
                opciones={catalogos.tipo_pago}
                vacioTexto="Selecciona..."
              />
            </label>
            <label>
              Periodicidad de la remuneración
              <SelectorCatalogo
                value={form.periodicidad_codigo}
                onChange={(v) => actualizarCampo("periodicidad_codigo", v)}
                opciones={catalogos.periodicidad}
                vacioTexto="Selecciona..."
              />
            </label>
            <label>
              Situación especial
              <SelectorCatalogo
                value={form.situacion_especial_codigo}
                onChange={(v) => actualizarCampo("situacion_especial_codigo", v)}
                opciones={catalogos.situacion_especial}
              />
            </label>
          </div>

          <h3 className="seccion-titulo">Seguridad social</h3>
          <div className="form-grid">
            <label>
              Régimen de aseguramiento de salud
              <SelectorCatalogo
                value={form.regimen_salud_codigo}
                onChange={(v) => actualizarCampo("regimen_salud_codigo", v)}
                opciones={catalogos.regimen_salud}
              />
            </label>
            <label>
              EPS (si aplica)
              <SelectorCatalogo
                value={form.eps_codigo}
                onChange={(v) => actualizarCampo("eps_codigo", v)}
                opciones={catalogos.eps}
                vacioTexto="Sin EPS"
              />
            </label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6, display: "inline-flex", marginRight: 16 }}>
              <input type="checkbox" checked={form.sindicalizado} onChange={(e) => actualizarCampo("sindicalizado", e.target.checked)} />
              Sindicalizado
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6, display: "inline-flex", marginRight: 16 }}>
              <input type="checkbox" checked={form.poliza_seguro} onChange={(e) => actualizarCampo("poliza_seguro", e.target.checked)} />
              Póliza de seguro
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6, display: "inline-flex", marginRight: 16 }}>
              <input type="checkbox" checked={form.sctr_salud} onChange={(e) => actualizarCampo("sctr_salud", e.target.checked)} />
              SCTR salud
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6, display: "inline-flex", marginRight: 16 }}>
              <input type="checkbox" checked={form.essalud_vida} onChange={(e) => actualizarCampo("essalud_vida", e.target.checked)} />
              ESSALUD vida
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6, display: "inline-flex" }}>
              <input type="checkbox" checked={form.domiciliado} onChange={(e) => actualizarCampo("domiciliado", e.target.checked)} />
              Domiciliado
            </label>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="primario" type="submit" disabled={guardando}>
              {guardando
                ? "Guardando..."
                : contratoEnEdicion
                ? "Guardar cambios"
                : reingresoEmpleadoId
                ? "Registrar reingreso"
                : "Registrar trabajador"}
            </button>
            {(contratoEnEdicion || reingresoEmpleadoId) && (
              <button type="button" onClick={cancelarEdicion} disabled={guardando}>
                Cancelar
              </button>
            )}
          </div>
        </form>
        )}
      </div>

      {cesando && (
        <div className="card">
          <h2>Dar de baja a {cesando.apellidos_nombres}</h2>
          {error && <div className="mensaje-error">{error}</div>}
          <div className="form-grid">
            <label>
              Fecha de cese
              <input type="date" value={fechaCese} onChange={(e) => setFechaCese(e.target.value)} />
            </label>
            <label>
              Motivo de baja (T-Registro)
              <select value={motivoBaja} onChange={(e) => setMotivoBaja(e.target.value)}>
                <option value="">Selecciona...</option>
                {catalogos?.motivo_baja.map((m) => (
                  <option key={m.codigo} value={m.codigo}>{m.codigo} - {m.nombre}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="primario" type="button" onClick={confirmarBaja} disabled={guardandoBaja || !fechaCese}>
              {guardandoBaja ? "Guardando..." : "Confirmar baja"}
            </button>
            <button type="button" onClick={() => setCesando(null)} disabled={guardandoBaja}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {historialEmpleadoId !== null && (
        <div className="card">
          <h2>Historial de periodos — {historialNombre}</h2>
          {error && <div className="mensaje-error">{error}</div>}
          {cargandoHistorial && <p style={{ color: "#5a6172" }}>Cargando historial...</p>}
          {!cargandoHistorial && historialContratos.length === 0 && (
            <p style={{ color: "#5a6172" }}>Este trabajador no tiene periodos registrados.</p>
          )}
          {!cargandoHistorial && historialContratos.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>Categoria</th>
                  <th>Ingreso</th>
                  <th>Cese</th>
                  <th>Estado</th>
                  <th>Motivo de baja</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historialContratos.map((c) => (
                  <tr key={c.id}>
                    <td>{c.proyecto}</td>
                    <td>{c.categoria_ocupacional}</td>
                    <td>{c.fecha_ingreso?.slice(0, 10)}</td>
                    <td>{c.fecha_cese ? c.fecha_cese.slice(0, 10) : "-"}</td>
                    <td>{c.estado}</td>
                    <td>{c.estado === "CESADO" ? nombreMotivoBaja(c.motivo_baja_codigo) : "-"}</td>
                    <td>
                      {c.estado === "CESADO" && (
                        <button type="button" onClick={() => iniciarReingreso(c)}>
                          Reingresar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button type="button" onClick={cerrarHistorial}>Cerrar</button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>
          {filtroEstado === "HABIL" && "Trabajadores hábiles"}
          {filtroEstado === "CESADO" && "Trabajadores cesados"}
          {filtroEstado === "TODOS" && "Todos los trabajadores"}
          {" "}({contratosFiltrados.length} de {contratos.length})
        </h2>
        <div className="form-grid" style={{ maxWidth: 600, marginBottom: 12 }}>
          <label>
            Mostrar
            <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as typeof filtroEstado)}>
              <option value="HABIL">Hábiles</option>
              <option value="CESADO">Cesados</option>
              <option value="TODOS">Todos</option>
            </select>
          </label>
          <label>
            Buscar (DNI, nombre o proyecto)
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Ej: 41480202 o Montalban"
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <a href={urlExportar("excel")}>
            <button type="button">Exportar a Excel</button>
          </a>
          <a href={urlExportar("pdf")}>
            <button type="button">Exportar a PDF</button>
          </a>
        </div>
        <table>
          <thead>
            <tr>
              <th>DNI</th>
              <th>Apellidos y nombres</th>
              <th>Proyecto</th>
              <th>Categoria</th>
              <th>Pension</th>
              <th>Ingreso</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {contratosFiltrados.map((c) => (
              <tr key={c.id}>
                <td>{c.numero_documento}</td>
                <td>{c.apellidos_nombres}</td>
                <td>{c.proyecto}</td>
                <td>{c.categoria_ocupacional}</td>
                <td>{c.sistema_pension === "AFP" ? c.afp_nombre : "ONP"}</td>
                <td>{c.fecha_ingreso?.slice(0, 10)}</td>
                <td>{c.estado}</td>
                <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => iniciarEdicion(c)}>Editar</button>
                  {c.estado === "HABIL" && (
                    <button type="button" onClick={() => iniciarBaja(c)}>Dar de baja</button>
                  )}
                  {c.estado === "CESADO" && (
                    <button type="button" onClick={() => iniciarReingreso(c)}>Reingresar</button>
                  )}
                  <button type="button" onClick={() => verHistorial(c.empleado_id, c.apellidos_nombres ?? "")}>
                    Historial
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
