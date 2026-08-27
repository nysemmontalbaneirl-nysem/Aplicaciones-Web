import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../api";
import { PermisoCatalogo, Rol } from "../types";

const FORM_VACIO = { nombre: "", descripcion: "", permisos: [] as string[] };

export default function Roles() {
  const [roles, setRoles] = useState<Rol[]>([]);
  const [catalogo, setCatalogo] = useState<PermisoCatalogo[]>([]);
  const [form, setForm] = useState(FORM_VACIO);
  const [editandoCodigo, setEditandoCodigo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const [listaRoles, listaCatalogo] = await Promise.all([
        apiGet<Rol[]>("/roles"),
        apiGet<PermisoCatalogo[]>("/roles/permisos-disponibles"),
      ]);
      setRoles(listaRoles);
      setCatalogo(listaCatalogo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const grupos = Array.from(new Set(catalogo.map((p) => p.grupo)));

  function iniciarEdicion(r: Rol) {
    setEditandoCodigo(r.codigo);
    setForm({ nombre: r.nombre, descripcion: r.descripcion ?? "", permisos: r.permisos });
    setError(null);
    setOk(null);
  }

  function cancelarEdicion() {
    setEditandoCodigo(null);
    setForm(FORM_VACIO);
  }

  function alternarPermiso(codigo: string) {
    setForm((f) => ({
      ...f,
      permisos: f.permisos.includes(codigo) ? f.permisos.filter((p) => p !== codigo) : [...f.permisos, codigo],
    }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setGuardando(true);
    try {
      if (editandoCodigo) {
        await apiPut(`/roles/${editandoCodigo}`, form);
        setOk("Rol actualizado correctamente.");
      } else {
        await apiPost("/roles", form);
        setOk("Rol creado correctamente.");
      }
      cancelarEdicion();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(r: Rol) {
    if (!confirm(`¿Eliminar el rol "${r.nombre}"? Esta acción no se puede deshacer.`)) return;
    setError(null);
    setOk(null);
    try {
      await apiDelete(`/roles/${r.codigo}`);
      setOk("Rol eliminado.");
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>{editandoCodigo ? `Editar rol: ${form.nombre}` : "Nuevo rol"}</h2>
        <p style={{ color: "#5a6172", maxWidth: 800 }}>
          Cada rol define qué puede hacer un usuario. Marca las casillas de lo que este rol puede hacer; lo que
          quede sin marcar queda bloqueado para cualquier usuario con este rol. Además de esto, un usuario solo ve
          los datos de los proyectos que tenga asignados (eso se configura en la pestaña Usuarios).
        </p>
        {error && <div className="mensaje-error">{error}</div>}
        {ok && <div className="mensaje-ok">{ok}</div>}
        <form onSubmit={guardar}>
          <div className="form-grid">
            <label>
              Nombre del rol
              <input value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} required />
            </label>
            <label>
              Descripción (opcional)
              <input
                value={form.descripcion}
                onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
              />
            </label>
          </div>

          <div style={{ marginTop: 16 }}>
            <p style={{ marginBottom: 6, fontSize: "0.88rem", color: "#5a6172" }}>Qué puede hacer este rol:</p>
            {grupos.map((grupo) => (
              <div key={grupo} style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: 4 }}>{grupo}</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: "4px 20px",
                  }}
                >
                  {catalogo
                    .filter((p) => p.grupo === grupo)
                    .map((p) => (
                      <label key={p.codigo} style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                        <input
                          type="checkbox"
                          checked={form.permisos.includes(p.codigo)}
                          onChange={() => alternarPermiso(p.codigo)}
                        />
                        {p.nombre}
                      </label>
                    ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button className="primario" type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : editandoCodigo ? "Guardar cambios" : "Crear rol"}
            </button>
            {editandoCodigo && (
              <button type="button" onClick={cancelarEdicion}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Roles ({roles.length})</h2>
        {cargando && <p>Cargando...</p>}
        {!cargando && (
          <table>
            <thead>
              <tr>
                <th>Rol</th>
                <th>Descripción</th>
                <th>Permisos activos</th>
                <th>Usuarios</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.codigo}>
                  <td>
                    {r.nombre}
                    {r.protegido && (
                      <span style={{ marginLeft: 6, fontSize: "0.75rem", color: "#8a90a0" }}>(acceso total)</span>
                    )}
                  </td>
                  <td>{r.descripcion || "—"}</td>
                  <td>{r.protegido ? "Todos" : r.permisos.length}</td>
                  <td>{r.usuarios_count}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {!r.protegido && (
                      <>
                        <button type="button" onClick={() => iniciarEdicion(r)}>
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => eliminar(r)}
                          title={r.usuarios_count > 0 ? "Hay usuarios con este rol: reasígnalos antes de eliminarlo" : undefined}
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
