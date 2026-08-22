import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import { CategoriaOcupacional, Contrato, Empleado } from "../types";

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

const estadoVacio = {
  numero_documento: "",
  apellidos_nombres: "",
  fecha_nacimiento: "",
  grado_instruccion: "",
  numero_hijos: "0",
  celular: "",
  correo: "",
  direccion: "",
  ubigeo: "",
  entidad_bancaria: "",
  cuenta_bancaria: "",
  proyecto: "",
  grupo: "",
  ocupacion: "",
  categoria_ocupacional: "PEON" as CategoriaOcupacional,
  sistema_pension: "ONP" as "AFP" | "ONP",
  afp_nombre: "",
  cuspp: "",
  sistema_comision: "",
  fecha_ingreso: "",
  fecha_cese: "",
  sueldo_base: "",
  viaticos: "0",
  sindicalizado: false,
  poliza_seguro: false,
  sctr_salud: false,
  essalud_vida: false,
  domiciliado: true,
};

type FormularioTrabajador = typeof estadoVacio;

export default function Trabajadores() {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [form, setForm] = useState<FormularioTrabajador>(estadoVacio);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Cuando no es null, el formulario esta editando este contrato en vez de crear uno nuevo
  const [contratoEnEdicion, setContratoEnEdicion] = useState<Contrato | null>(null);

  async function cargar() {
    try {
      const datos = await apiGet<Contrato[]>("/contratos?estado=HABIL");
      setContratos(datos);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

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

  function actualizarCampo<K extends keyof FormularioTrabajador>(campo: K, valor: FormularioTrabajador[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function iniciarEdicion(contrato: Contrato) {
    setError(null);
    setOk(null);
    try {
      const empleado = await apiGet<Empleado & { grado_instruccion?: string; direccion?: string; ubigeo?: string; entidad_bancaria?: string; cuenta_bancaria?: string }>(
        `/empleados/${contrato.empleado_id}`
      );
      setContratoEnEdicion(contrato);
      setForm({
        numero_documento: empleado.numero_documento,
        apellidos_nombres: empleado.apellidos_nombres,
        fecha_nacimiento: empleado.fecha_nacimiento?.slice(0, 10) ?? "",
        grado_instruccion: empleado.grado_instruccion ?? "",
        numero_hijos: String(empleado.numero_hijos ?? 0),
        celular: empleado.celular ?? "",
        correo: empleado.correo ?? "",
        direccion: empleado.direccion ?? "",
        ubigeo: empleado.ubigeo ?? "",
        entidad_bancaria: empleado.entidad_bancaria ?? "",
        cuenta_bancaria: empleado.cuenta_bancaria ?? "",
        proyecto: contrato.proyecto,
        grupo: contrato.grupo ?? "",
        ocupacion: (contrato as unknown as { ocupacion?: string }).ocupacion ?? "",
        categoria_ocupacional: contrato.categoria_ocupacional,
        sistema_pension: contrato.sistema_pension,
        afp_nombre: contrato.afp_nombre ?? "",
        cuspp: (contrato as unknown as { cuspp?: string }).cuspp ?? "",
        sistema_comision: (contrato as unknown as { sistema_comision?: string }).sistema_comision ?? "",
        fecha_ingreso: contrato.fecha_ingreso?.slice(0, 10) ?? "",
        fecha_cese: contrato.fecha_cese?.slice(0, 10) ?? "",
        sueldo_base: contrato.sueldo_base != null ? String(contrato.sueldo_base) : "",
        viaticos: "0",
        sindicalizado: contrato.sindicalizado,
        poliza_seguro: contrato.poliza_seguro,
        sctr_salud: contrato.sctr_salud,
        essalud_vida: (contrato as unknown as { essalud_vida?: boolean }).essalud_vida ?? false,
        domiciliado: true,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function cancelarEdicion() {
    setContratoEnEdicion(null);
    setForm(estadoVacio);
    setError(null);
    setOk(null);
  }

  async function darDeBaja(contrato: Contrato) {
    const fecha = window.prompt(`Fecha de cese de ${contrato.apellidos_nombres} (YYYY-MM-DD):`, new Date().toISOString().slice(0, 10));
    if (!fecha) return;
    setError(null);
    setOk(null);
    try {
      await apiPost(`/contratos/${contrato.id}/cese`, { fecha_cese: fecha });
      setOk(`${contrato.apellidos_nombres} dado de baja correctamente.`);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function guardarTrabajador(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setGuardando(true);
    try {
      const datosEmpleado = {
        apellidos_nombres: form.apellidos_nombres,
        fecha_nacimiento: form.fecha_nacimiento || null,
        grado_instruccion: form.grado_instruccion || null,
        numero_hijos: Number(form.numero_hijos) || 0,
        celular: form.celular || null,
        correo: form.correo || null,
        direccion: form.direccion || null,
        ubigeo: form.ubigeo || null,
        entidad_bancaria: form.entidad_bancaria || null,
        cuenta_bancaria: form.cuenta_bancaria || null,
      };
      const datosContrato = {
        proyecto: form.proyecto,
        grupo: form.grupo || null,
        ocupacion: form.ocupacion || null,
        categoria_ocupacional: form.categoria_ocupacional,
        sistema_pension: form.sistema_pension,
        afp_nombre: form.sistema_pension === "AFP" ? form.afp_nombre : null,
        cuspp: form.cuspp || null,
        sistema_comision: form.sistema_comision || null,
        fecha_ingreso: form.fecha_ingreso,
        fecha_cese: form.fecha_cese || null,
        sueldo_base: form.categoria_ocupacional === "EMPLEADO" ? Number(form.sueldo_base) : null,
        viaticos: Number(form.viaticos) || 0,
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
      } else {
        const empleado = await apiPost<Empleado>("/empleados", {
          numero_documento: form.numero_documento,
          ...datosEmpleado,
        });
        await apiPost<Contrato>("/contratos", { empleado_id: empleado.id, ...datosContrato });
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
        <h2>{contratoEnEdicion ? `Editar trabajador — ${form.apellidos_nombres}` : "Nuevo trabajador"}</h2>
        {error && <div className="mensaje-error">{error}</div>}
        {ok && <div className="mensaje-ok">{ok}</div>}
        <form onSubmit={guardarTrabajador}>
          <h3 style={{ fontSize: "0.9rem", color: "#5a6172", marginBottom: 6 }}>Datos personales</h3>
          <div className="form-grid">
            <label>
              DNI
              <input
                required
                disabled={!!contratoEnEdicion}
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
              Fecha nacimiento
              <input
                type="date"
                value={form.fecha_nacimiento}
                onChange={(e) => actualizarCampo("fecha_nacimiento", e.target.value)}
              />
            </label>
            <label>
              Grado de instrucción
              <input
                value={form.grado_instruccion}
                onChange={(e) => actualizarCampo("grado_instruccion", e.target.value)}
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
            <label>
              Dirección
              <input value={form.direccion} onChange={(e) => actualizarCampo("direccion", e.target.value)} />
            </label>
            <label>
              Ubigeo
              <input value={form.ubigeo} onChange={(e) => actualizarCampo("ubigeo", e.target.value)} />
            </label>
          </div>

          <h3 style={{ fontSize: "0.9rem", color: "#5a6172", marginBottom: 6 }}>Datos bancarios</h3>
          <div className="form-grid">
            <label>
              Entidad bancaria
              <input
                value={form.entidad_bancaria}
                onChange={(e) => actualizarCampo("entidad_bancaria", e.target.value)}
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

          <h3 style={{ fontSize: "0.9rem", color: "#5a6172", marginBottom: 6 }}>Datos laborales</h3>
          <div className="form-grid">
            <label>
              Proyecto / obra
              <input
                required
                value={form.proyecto}
                onChange={(e) => actualizarCampo("proyecto", e.target.value)}
              />
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
              Categoria
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
            <label>
              Fecha cese
              <input
                type="date"
                value={form.fecha_cese}
                onChange={(e) => actualizarCampo("fecha_cese", e.target.value)}
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
            <label>
              Viáticos (S/.)
              <input
                type="number"
                step="0.01"
                value={form.viaticos}
                onChange={(e) => actualizarCampo("viaticos", e.target.value)}
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
              {guardando ? "Guardando..." : contratoEnEdicion ? "Guardar cambios" : "Registrar trabajador"}
            </button>
            {contratoEnEdicion && (
              <button type="button" onClick={cancelarEdicion} disabled={guardando}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Trabajadores hábiles ({contratosFiltrados.length} de {contratos.length})</h2>
        <div className="form-grid" style={{ maxWidth: 340, marginBottom: 12 }}>
          <label>
            Buscar (DNI, nombre o proyecto)
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Ej: 41480202 o Montalban"
            />
          </label>
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
                <td style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => iniciarEdicion(c)}>Editar</button>
                  <button type="button" onClick={() => darDeBaja(c)}>Dar de baja</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
