import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import { Proyecto } from "../types";

export default function Proyectos() {
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [nombre, setNombre] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [cuotaSindical, setCuotaSindical] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [cuotasEdicion, setCuotasEdicion] = useState<Record<number, string>>({});
  const [guardandoId, setGuardandoId] = useState<number | null>(null);

  async function cargar() {
    const lista = await apiGet<Proyecto[]>("/proyectos");
    setProyectos(lista);
    setCuotasEdicion(Object.fromEntries(lista.map((p) => [p.id, String(p.cuota_sindical_semanal)])));
  }

  useEffect(() => {
    cargar().catch((e) => setError((e as Error).message));
  }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreando(true);
    try {
      await apiPost("/proyectos", { nombre, ubicacion, cuota_sindical_semanal: Number(cuotaSindical) || 0 });
      setNombre("");
      setUbicacion("");
      setCuotaSindical("0");
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
        cuota_sindical_semanal: p.cuota_sindical_semanal,
      });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function guardarCuota(p: Proyecto) {
    setError(null);
    setGuardandoId(p.id);
    try {
      await apiPut(`/proyectos/${p.id}`, {
        nombre: p.nombre,
        ubicacion: p.ubicacion,
        estado: p.estado,
        cuota_sindical_semanal: Number(cuotasEdicion[p.id]) || 0,
      });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoId(null);
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
            <label>
              Cuota sindical (S/. por semana)
              <input
                type="number"
                step="0.01"
                min="0"
                value={cuotaSindical}
                onChange={(e) => setCuotaSindical(e.target.value)}
              />
            </label>
          </div>
          <button className="primario" type="submit" disabled={creando}>
            {creando ? "Creando..." : "Crear proyecto"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Proyectos ({proyectos.length})</h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          La cuota sindical es una tarifa FIJA semanal por trabajador sindicalizado (no un
          porcentaje del sueldo) y varía por proyecto/obra. Se descuenta solo a los trabajadores
          marcados como "Sindicalizado" en su ficha.
        </p>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Ubicación</th>
              <th>Estado</th>
              <th>Cuota sindical (S/. semana)</th>
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
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    style={{ width: 90 }}
                    value={cuotasEdicion[p.id] ?? "0"}
                    onChange={(e) => setCuotasEdicion((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => guardarCuota(p)}
                    disabled={guardandoId === p.id}
                    style={{ marginLeft: 6 }}
                  >
                    {guardandoId === p.id ? "..." : "Guardar"}
                  </button>
                </td>
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
