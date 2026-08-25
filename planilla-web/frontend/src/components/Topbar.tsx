import { useEffect, useState } from "react";
import { apiGet } from "../api";
import { DatosEmpresa, Usuario } from "../types";

interface Props {
  usuario: Usuario;
  onCambiarPassword: () => void;
  onCerrarSesion: () => void;
}

const ETIQUETAS_ROL: Record<string, string> = {
  ADMIN: "Administrador",
  RESPONSABLE_PLANILLA: "Responsable de planilla",
  TAREADOR: "Tareador",
};

export default function Topbar({ usuario, onCambiarPassword, onCerrarSesion }: Props) {
  const [empresa, setEmpresa] = useState<DatosEmpresa | null>(null);

  useEffect(() => {
    apiGet<DatosEmpresa>("/empresa")
      .then(setEmpresa)
      .catch(() => setEmpresa(null)); // sin datos de empresa configurados todavia
  }, []);

  const nombreEmpresa = empresa?.nombre_comercial || empresa?.razon_social || "Sistema de Planillas";

  return (
    <header className="topbar">
      <div className="topbar-empresa">
        <span className="topbar-empresa-nombre">{nombreEmpresa}</span>
        {empresa?.ruc && <span className="topbar-empresa-ruc">RUC {empresa.ruc}</span>}
      </div>

      <div className="topbar-usuario">
        <div className="topbar-usuario-info">
          <div className="topbar-usuario-nombre">{usuario.nombre}</div>
          <div className="topbar-usuario-rol">{ETIQUETAS_ROL[usuario.rol] ?? usuario.rol}</div>
        </div>
        <div className="topbar-usuario-acciones">
          <button type="button" onClick={onCambiarPassword}>
            Cambiar contraseña
          </button>
          <button type="button" className="primario" onClick={onCerrarSesion}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </header>
  );
}
