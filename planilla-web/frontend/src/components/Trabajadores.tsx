import { useEffect, useState } from "react";
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
];

const estadoVacio = {
  numero_documento: "",
  apellidos_nombres: "",
  fecha_nacimiento: "",
  numero_hijos: "0",
  celular: "",
  proyecto: "",
  categoria_ocupacional: "PEON" as CategoriaOcupacional,
  sistema_pension: "ONP" as "AFP" | "ONP",
  afp_nombre: "",
  fecha_ingreso: "",
  sueldo_base: "",
  sindicalizado: false,
  poliza_seguro: false,
  sctr_salud: false,
};

type FormularioTrabajador = typeof estadoVacio;

export default function Trabajadores() {
  const [contratos, setContratos] = useState<Contrato[]>([]);
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

  function actualizarCampo<K extends keyof FormularioTrabajador>(campo: K, valor: FormularioTrabajador[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function iniciarEdicion(contrato: Contrato) {
    setError(null);
    setOk(null);
    try {
      const empleado = await apiGet<Empleado>(`/empleados/${contrato.empleado_id}`);
      setContratoEnEdicion(contrato);
      setForm({
        numero_documento: empleado.numero_documento,
        apellidos_nombres: empleado.apellidos_nombres,
        fecha_nacimiento: empleado.fecha_nacimiento?.slice(0, 10) ?? "",
        numero_hijos: String(empleado.numero_hijos ?? 0),
        celular: empleado.celular ?? "",
        proyecto: contrato.proyecto,
        categoria_ocupacional: contrato.categoria_ocupacional,
        sistema_pension: contrato.sistema_pension,
        afp_nombre: contrato.afp_nombre ?? "",
        fecha_ingreso: contrato.fecha_ingreso?.slice(0, 10) ?? "",
        sueldo_base: contrato.sueldo_base != null ? String(contrato.sueldo_base) : "",
        sindicalizado: contrato.sindicalizado,
        poliza_seguro: contrato.poliza_seguro,
        sctr_salud: contrato.sctr_salud,
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

  async function guardarTrabajador(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setGuardando(true);
    try {
      if (contratoEnEdicion) {
        await apiPut<Empleado>(`/empleados/${contratoEnEdicion.empleado_id}`, {
          apellidos_nombres: form.apellidos_nombres,
          fecha_nacimiento: form.fecha_nacimiento || null,
          numero_hijos: Number(form.numero_hijos) || 0,
          celular: form.celular || null,
        });
        await apiPut<Contrato>(`/contratos/${contratoEnEdicion.id}`, {
          proyecto: form.proyecto,
          categoria_ocupacional: form.categoria_ocupacional,
          sistema_pension: form.sistema_pension,
          afp_nombre: form.sistema_pension === "AFP" ? form.afp_nombre : null,
          fecha_ingreso: form.fecha_ingreso,
          sueldo_base:
            form.categoria_ocupacional === "EMPLEADO" ? Number(form.sueldo_base) : null,
          sindicalizado: form.sindicalizado,
          poliza_seguro: form.poliza_seguro,
          sctr_salud: form.sctr_salud,
        });
        setOk(`Trabajador ${form.apellidos_nombres} actualizado correctamente.`);
        setContratoEnEdicion(null);
      } else {
        const empleado = await apiPost<Empleado>("/empleados", {
          numero_documento: form.numero_documento,
          apellidos_nombres: form.apellidos_nombres,
          fecha_nacimiento: form.fecha_nacimiento || null,
          numero_hijos: Number(form.numero_hijos) || 0,
          celular: form.celular || null,
        });

        await apiPost<Contrato>("/contratos", {
          empleado_id: empleado.id,
          proyecto: form.proyecto,
          categoria_ocupacional: form.categoria_ocupacional,
          sistema_pension: form.sistema_pension,
          afp_nombre: form.sistema_pension === "AFP" ? form.afp_nombre : null,
          fecha_ingreso: form.fecha_ingreso,
          sueldo_base:
            form.categoria_ocupacional === "EMPLEADO" ? Number(form.sueldo_base) : null,
          sindicalizado: form.sindicalizado,
          poliza_seguro: form.poliza_seguro,
          sctr_salud: form.sctr_salud,
        });
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
              <input
                value={form.celular}
                onChange={(e) => actualizarCampo("celular", e.target.value)}
              />
            </label>
            <label>
              Proyecto / obra
              <input
                required
                value={form.proyecto}
                onChange={(e) => actualizarCampo("proyecto", e.target.value)}
              />
            </label>
            <label>
              Categoria
              <select
                value={form.categoria_ocupacional}
                onChange={(e) =>
                  actualizarCampo("categoria_ocupacional", e.target.value as CategoriaOcupacional)
                }
              >
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
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
              <label>
                AFP
                <select
                  value={form.afp_nombre}
                  onChange={(e) => actualizarCampo("afp_nombre", e.target.value)}
                >
                  <option value="">Selecciona...</option>
                  <option value="INTEGRA">INTEGRA</option>
                  <option value="PRIMA">PRIMA</option>
                  <option value="PROFUTURO">PROFUTURO</option>
                  <option value="HABITAT">HABITAT</option>
                </select>
              </label>
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
          </div>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6, display: "inline-flex", marginRight: 16 }}>
            <input
              type="checkbox"
              checked={form.sindicalizado}
              onChange={(e) => actualizarCampo("sindicalizado", e.target.checked)}
            />
            Sindicalizado
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6, display: "inline-flex", marginRight: 16 }}>
            <input
              type="checkbox"
              checked={form.poliza_seguro}
              onChange={(e) => actualizarCampo("poliza_seguro", e.target.checked)}
            />
            Poliza de seguro
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6, display: "inline-flex", marginBottom: 16 }}>
            <input
              type="checkbox"
              checked={form.sctr_salud}
              onChange={(e) => actualizarCampo("sctr_salud", e.target.checked)}
            />
            SCTR salud
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="primario" type="submit" disabled={guardando}>
              {guardando
                ? "Guardando..."
                : contratoEnEdicion
                ? "Guardar cambios"
                : "Registrar trabajador"}
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
        <h2>Trabajadores habiles ({contratos.length})</h2>
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
            {contratos.map((c) => (
              <tr key={c.id}>
                <td>{c.numero_documento}</td>
                <td>{c.apellidos_nombres}</td>
                <td>{c.proyecto}</td>
                <td>{c.categoria_ocupacional}</td>
                <td>{c.sistema_pension === "AFP" ? c.afp_nombre : "ONP"}</td>
                <td>{c.fecha_ingreso?.slice(0, 10)}</td>
                <td>
                  <button type="button" onClick={() => iniciarEdicion(c)}>
                    Editar
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
