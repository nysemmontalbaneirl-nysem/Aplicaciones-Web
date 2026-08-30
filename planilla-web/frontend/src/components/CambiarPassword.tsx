import { useState } from "react";
import { apiPost } from "../api";
import CampoPassword from "./CampoPassword";

export default function CambiarPassword({ onListo }: { onListo: () => void }) {
  const [passwordActual, setPasswordActual] = useState("");
  const [passwordNueva, setPasswordNueva] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      await apiPost("/auth/cambiar-password", {
        password_actual: passwordActual,
        password_nueva: passwordNueva,
      });
      onListo();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 360 }}>
      <h2>Cambiar contraseña</h2>
      {error && <div className="mensaje-error">{error}</div>}
      <form onSubmit={enviar}>
        <label>
          Contraseña actual
          <CampoPassword value={passwordActual} onChange={setPasswordActual} required autoComplete="current-password" />
        </label>
        <label>
          Contraseña nueva (mínimo 8 caracteres)
          <CampoPassword value={passwordNueva} onChange={setPasswordNueva} required minLength={8} autoComplete="new-password" />
        </label>
        <button className="primario" type="submit" disabled={guardando} style={{ marginTop: 12 }}>
          {guardando ? "Guardando..." : "Cambiar contraseña"}
        </button>
      </form>
    </div>
  );
}
