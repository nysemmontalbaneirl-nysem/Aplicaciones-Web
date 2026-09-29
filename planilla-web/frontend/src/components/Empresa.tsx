import { useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPostArchivo, apiPut, BASE_URL, conToken } from "../api";
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
  // Logo de la empresa (migracion 031) - se sube/reemplaza/quita por
  // separado del resto del formulario (mismo criterio que el certificado
  // de Tareo Diario: una accion inmediata, no atada al boton "Guardar").
  const [tieneLogo, setTieneLogo] = useState(false);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0); // fuerza recargar el <img> tras subir/quitar
  const inputLogoRef = useRef<HTMLInputElement>(null);

  // Firma escaneada del EMPLEADOR (pedido adicional del usuario) - misma
  // logica que el logo, guardada tambien en datos_empresa.
  const [tieneFirmaEmpleador, setTieneFirmaEmpleador] = useState(false);
  const [subiendoFirmaEmpleador, setSubiendoFirmaEmpleador] = useState(false);
  const [firmaEmpleadorVersion, setFirmaEmpleadorVersion] = useState(0);
  const inputFirmaEmpleadorRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiGet<DatosEmpresa>("/empresa")
      .then(({ id: _id, tiene_logo, tiene_firma_empleador, ...resto }) => {
        setDatos(resto);
        setTieneLogo(!!tiene_logo);
        setTieneFirmaEmpleador(!!tiene_firma_empleador);
      })
      .catch(() => {
        // todavia no hay datos configurados, se queda con el formulario vacio
      });
  }, []);

  function abrirSelectorLogo() {
    setError(null);
    setOk(null);
    inputLogoRef.current?.click();
  }

  async function alSeleccionarLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo despues (ej. si fallo)
    if (!archivo) return;

    if (archivo.size > 5 * 1024 * 1024) {
      setError("La imagen supera los 5 MB. Usa una foto normal en formato JPG/PNG o comprímela antes de subirla.");
      return;
    }

    setSubiendoLogo(true);
    setError(null);
    setOk(null);
    try {
      const formData = new FormData();
      formData.append("archivo", archivo);
      await apiPostArchivo("/empresa/logo", formData);
      setTieneLogo(true);
      setLogoVersion((v) => v + 1);
      setOk("Logo guardado correctamente. Aparecerá en la Boleta y en los reportes.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendoLogo(false);
    }
  }

  async function quitarLogo() {
    if (!confirm("¿Quitar el logo configurado? La Boleta y los reportes volverán a usar el logo por defecto.")) return;
    setSubiendoLogo(true);
    setError(null);
    setOk(null);
    try {
      await apiDelete("/empresa/logo");
      setTieneLogo(false);
      setLogoVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendoLogo(false);
    }
  }

  function abrirSelectorFirmaEmpleador() {
    setError(null);
    setOk(null);
    inputFirmaEmpleadorRef.current?.click();
  }

  async function alSeleccionarFirmaEmpleador(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;

    if (archivo.size > 5 * 1024 * 1024) {
      setError("La imagen supera los 5 MB. Usa una foto normal en formato JPG/PNG o comprímela antes de subirla.");
      return;
    }

    setSubiendoFirmaEmpleador(true);
    setError(null);
    setOk(null);
    try {
      const formData = new FormData();
      formData.append("archivo", archivo);
      await apiPostArchivo("/empresa/firma-empleador", formData);
      setTieneFirmaEmpleador(true);
      setFirmaEmpleadorVersion((v) => v + 1);
      setOk("Firma del empleador guardada correctamente. Aparecerá en la Boleta.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendoFirmaEmpleador(false);
    }
  }

  async function quitarFirmaEmpleador() {
    if (!confirm("¿Quitar la firma del empleador configurada?")) return;
    setSubiendoFirmaEmpleador(true);
    setError(null);
    setOk(null);
    try {
      await apiDelete("/empresa/firma-empleador");
      setTieneFirmaEmpleador(false);
      setFirmaEmpleadorVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendoFirmaEmpleador(false);
    }
  }

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
      {error && <div className="mensaje-error">{error}</div>}
      {ok && <div className="mensaje-ok">{ok}</div>}

      <div className="card">
        <h2>Logo de la empresa</h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          Aparece en la Boleta de pago, en el resumen de planilla (Excel) y en el asiento contable (Excel). Formatos
          admitidos: JPG, PNG o WEBP (máx. 5 MB) — para los reportes Excel solo JPG/PNG se pueden incrustar.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {tieneLogo ? (
            <img
              key={logoVersion}
              src={conToken(`${BASE_URL}/empresa/logo?v=${logoVersion}`)}
              alt="Logo de la empresa"
              style={{ height: 70, maxWidth: 160, objectFit: "contain", border: "1px solid #e0e3ea", borderRadius: 6, padding: 4 }}
            />
          ) : (
            <span style={{ color: "#8a90a0", fontSize: "0.85rem" }}>Todavía no se configuró ningún logo (se usa el logo por defecto).</span>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={subiendoLogo} onClick={abrirSelectorLogo}>
              {subiendoLogo ? "..." : tieneLogo ? "Reemplazar logo" : "Subir logo"}
            </button>
            {tieneLogo && (
              <button type="button" disabled={subiendoLogo} onClick={quitarLogo}>
                Quitar logo
              </button>
            )}
          </div>
          <input
            ref={inputLogoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            onChange={alSeleccionarLogo}
          />
        </div>
      </div>

      <div className="card">
        <h2>Firma del empleador</h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          Aparece en la Boleta de pago, junto al nombre del representante legal (campo &quot;Representante legal&quot;
          en el formulario de abajo). Solo de referencia visual — no reemplaza el espacio de firma física.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {tieneFirmaEmpleador ? (
            <img
              key={firmaEmpleadorVersion}
              src={conToken(`${BASE_URL}/empresa/firma-empleador?v=${firmaEmpleadorVersion}`)}
              alt="Firma del empleador"
              style={{ height: 60, maxWidth: 160, objectFit: "contain", border: "1px solid #e0e3ea", borderRadius: 6, padding: 4 }}
            />
          ) : (
            <span style={{ color: "#8a90a0", fontSize: "0.85rem" }}>Todavía no se configuró ninguna firma del empleador.</span>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={subiendoFirmaEmpleador} onClick={abrirSelectorFirmaEmpleador}>
              {subiendoFirmaEmpleador ? "..." : tieneFirmaEmpleador ? "Reemplazar firma" : "Subir firma"}
            </button>
            {tieneFirmaEmpleador && (
              <button type="button" disabled={subiendoFirmaEmpleador} onClick={quitarFirmaEmpleador}>
                Quitar firma
              </button>
            )}
          </div>
          <input
            ref={inputFirmaEmpleadorRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            onChange={alSeleccionarFirmaEmpleador}
          />
        </div>
      </div>

      <div className="card">
        <h2>Datos de la empresa</h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          Estos datos se usan como referencia del empleador para PLAME/T-Registro.
        </p>

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
