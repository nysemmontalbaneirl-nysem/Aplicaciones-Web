import { useEffect, useState } from "react";
import { apiGet, apiPut } from "../api";
import { DatosEmpresa } from "../types";

const VACIO: Omit<DatosEmpresa, "id"> = {
  ruc: "",
  razon_social: "",
  nombre_comercial: "",
  domicilio_fiscal: "",
  ubigeo: "",
  actividad_economica: "",
  tipo_empresa: "",
  regimen_laboral: "",
  representante_legal: "",
  telefono: "",
  correo: "",
};

export default function Empresa() {
  const [datos, setDatos] = useState<Omit<DatosEmpresa, "id">>(VACIO);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    apiGet<DatosEmpresa>("/empresa")
      .then(({ id: _id, ...resto }) => setDatos(resto))
      .catch(() => {
        // todavia no hay datos configurados, se queda con el formulario vacio
      });
  }, []);

  function actualizar<K extends keyof typeof datos>(campo: K, valor: string) {
    setDatos((d) => ({ ...d, [campo]: valor }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setGuardando(true);
    try {
      await apiPut("/empresa", datos);
      setOk("Datos de la empresa guardados correctamente.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Datos de la empresa</h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          Estos datos se usan como referencia del empleador para PLAME/T-Registro.
        </p>
        {error && <div className="mensaje-error">{error}</div>}
        {ok && <div className="mensaje-ok">{ok}</div>}

        <form onSubmit={guardar}>
          <div className="form-grid">
            <label>
              RUC
              <input value={datos.ruc} onChange={(e) => actualizar("ruc", e.target.value)} maxLength={11} required />
            </label>
            <label>
              Razón social
              <input value={datos.razon_social} onChange={(e) => actualizar("razon_social", e.target.value)} required />
            </label>
            <label>
              Nombre comercial
              <input value={datos.nombre_comercial ?? ""} onChange={(e) => actualizar("nombre_comercial", e.target.value)} />
            </label>
            <label>
              Tipo de empresa
              <input
                value={datos.tipo_empresa ?? ""}
                onChange={(e) => actualizar("tipo_empresa", e.target.value)}
                placeholder="Ej. Sociedad Anónima Cerrada"
              />
            </label>
            <label>
              Régimen laboral
              <input
                value={datos.regimen_laboral ?? ""}
                onChange={(e) => actualizar("regimen_laboral", e.target.value)}
                placeholder="Ej. Construcción Civil"
              />
            </label>
            <label>
              Actividad económica
              <input value={datos.actividad_economica ?? ""} onChange={(e) => actualizar("actividad_economica", e.target.value)} />
            </label>
            <label>
              Domicilio fiscal
              <input value={datos.domicilio_fiscal ?? ""} onChange={(e) => actualizar("domicilio_fiscal", e.target.value)} />
            </label>
            <label>
              Ubigeo
              <input value={datos.ubigeo ?? ""} onChange={(e) => actualizar("ubigeo", e.target.value)} />
            </label>
            <label>
              Representante legal
              <input value={datos.representante_legal ?? ""} onChange={(e) => actualizar("representante_legal", e.target.value)} />
            </label>
            <label>
              Teléfono
              <input value={datos.telefono ?? ""} onChange={(e) => actualizar("telefono", e.target.value)} />
            </label>
            <label>
              Correo
              <input type="email" value={datos.correo ?? ""} onChange={(e) => actualizar("correo", e.target.value)} />
            </label>
          </div>
          <button className="primario" type="submit" disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar datos de la empresa"}
          </button>
        </form>
      </div>
    </div>
  );
}
