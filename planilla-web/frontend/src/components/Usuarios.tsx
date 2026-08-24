import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import { Proyecto, RolUsuario } from "../types";

interface UsuarioFila {
  id: number;
  nombre: string;
  correo: string;
  rol: RolUsuario;
  activo: boolean;
  proyectos: string[];
}

const ROLES: RolUsuario[] = ["ADMIN", "RESPONSABLE_PLANILLA", "TAREADOR"];

const ETIQUETAS_ROL: Record<RolUsuario, string> = {
  ADMIN: "Administrador",
  RESPONSABLE_PLANILLA: "Encargado de planilla",
  TAREADOR: "Tareador",
};

const FORM_VACIO = {
  nombre: "",
  correo: "",
  password: "",
  rol: "TAREADOR" as RolUsuario,
  proyecto_ids: [] as number[],
};

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioFila[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [form, setForm] = useState(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const [listaUsuarios, listaProyectos] = await Promise.all([
      apiGet<UsuarioFila[]>("/usuarios"),
      apiGet<Proyecto[]>("/proyectos"),
    ]);
    setUsuarios(listaUsuarios);
    setProyectos(listaProyectos);
  }

  useEffect(() => {
    cargar().catch((e) => setError((e as Error).message));
  }, []);

  function iniciarEdicion(u: UsuarioFila) {
    setEditandoId(u.id);
    setForm({
      nombre: u.nombre,
      correo: u.correo,
      password: "",
      rol: u.rol,
      proyecto_ids: proyectos.filter((p) => u.proyectos.includes(p.nombre)).map((p) => p.id),
    });
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setForm(FORM_VACIO);
  }

  function alternarProyecto(id: number) {
    setForm((f) => ({
      ...f,
      proyecto_ids: f.proyecto_ids.includes(id)
        ? f.proyecto_ids.filter((p) => p !== id)
        : [...f.proyecto_ids, id],
    }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setGuardando(true);
    try {
      if (editandoId) {
        const body: Record<string, unknown> = {
          nombre: form.nombre,
          rol: form.rol,
          proyecto_ids: form.proyecto_ids,
        };
        if (form.password) body.password = form.password;
        await apiPut(`/usuarios/${editandoId}`, body);
        setOk("Usuario actualizado correctamente.");
      } else {
        await apiPost("/usuarios", form);
        setOk("Usuario creado correctamente.");
      }
      cancelarEdicion();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(u: UsuarioFila) {
    setError(null);
    try {
      await apiPut(`/usuarios/${u.id}`, { activo: !u.activo });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>{editandoId ? "Editar usuario" : "Nuevo usuario"}</h2>
        {error && <div className="mensaje-error">{error}</div>}
        {ok && <div className="mensaje-ok">{ok}</div>}
        <form onSubmit={guardar}>
          <div className="form-grid">
            <label>
              Nombre
              <input value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} required />
            </label>
            <label>
              Correo
              <input
                type="email"
                value={form.correo}
                onChange={(e) => setForm((f) => ({ ...f, correo: e.target.value }))}
                disabled={!!editandoId}
                required
              />
            </label>
            <label>
              {editandoId ? "Nueva contraseña (dejar en blanco para no cambiarla)" : "Contraseña"}
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required={!editandoId}
              />
            </label>
            <label>
              Rol
              <select value={form.rol} onChange={(e) => setForm((f) => ({ ...f, rol: e.target.value as RolUsuario }))}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ETIQUETAS_ROL[r]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {form.rol !== "ADMIN" && (
            <div style={{ marginTop: 12 }}>
              <p style={{ marginBottom: 6, fontSize: "0.88rem", color: "#5a6172" }}>
                Proyectos a los que tiene acceso este usuario:
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {proyectos.map((p) => (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={form.proyecto_ids.includes(p.id)}
                      onChange={() => alternarProyecto(p.id)}
                    />
                    {p.nombre}
                  </label>
                ))}
                {proyectos.length === 0 && <span style={{ color: "#5a6172" }}>No hay proyectos registrados todavia.</span>}
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button className="primario" type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : editandoId ? "Guardar cambios" : "Crear usuario"}
            </button>
            {editandoId && (
              <button type="button" onClick={cancelarEdicion}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Usuarios ({usuarios.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Proyectos</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>{u.nombre}</td>
                <td>{u.correo}</td>
                <td>{ETIQUETAS_ROL[u.rol]}</td>
                <td>{u.rol === "ADMIN" ? "Todos" : u.proyectos.join(", ") || "—"}</td>
                <td>{u.activo ? "Activo" : "Inactivo"}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => iniciarEdicion(u)}>
                    Editar
                  </button>
                  <button type="button" onClick={() => alternarActivo(u)}>
                    {u.activo ? "Desactivar" : "Activar"}
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
