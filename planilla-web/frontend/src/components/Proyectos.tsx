import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import { Proyecto } from "../types";

export default function Proyectos() {
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [nombre, setNombre] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  async function cargar() {
    const lista = await apiGet<Proyecto[]>("/proyectos");
    setProyectos(lista);
  }

  useEffect(() => {
    cargar().catch((e) => setError((e as Error).message));
  }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreando(true);
    try {
      await apiPost("/proyectos", { nombre, ubicacion });
      setNombre("");
      setUbicacion("");
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreando(false);
    }
  }

  async function cambiarEstado(p: Proyecto) {
    setError(null);
    try {
      await apiPut(`/proyectos/${p.id}`, {
        nombre: p.nombre,
        ubicacion: p.ubicacion,
        estado: p.estado === "ACTIVO" ? "CERRADO" : "ACTIVO",
      });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Nuevo proyecto</h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          El nombre debe escribirse exactamente igual a como aparece en los contratos de los
          trabajadores (ej. "P013-Tecnologico La Union-Piura"), para que coincida al asignar
          usuarios a proyectos.
        </p>
        {error && <div className="mensaje-error">{error}</div>}
        <form onSubmit={crear}>
          <div className="form-grid">
            <label>
              Nombre
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
            </label>
            <label>
              Ubicación
              <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Ej. Piura-Piura" />
            </label>
          </div>
          <button className="primario" type="submit" disabled={creando}>
            {creando ? "Creando..." : "Crear proyecto"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Proyectos ({proyectos.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Ubicación</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {proyectos.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td>{p.ubicacion ?? "—"}</td>
                <td>{p.estado}</td>
                <td>
                  <button type="button" onClick={() => cambiarEstado(p)}>
                    {p.estado === "ACTIVO" ? "Cerrar" : "Reactivar"}
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
