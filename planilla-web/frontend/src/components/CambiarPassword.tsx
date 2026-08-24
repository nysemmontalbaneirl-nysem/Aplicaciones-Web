import { useState } from "react";
import { apiPost } from "../api";

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
          <input type="password" value={passwordActual} onChange={(e) => setPasswordActual(e.target.value)} required />
        </label>
        <label>
          Contraseña nueva (mínimo 8 caracteres)
          <input type="password" value={passwordNueva} onChange={(e) => setPasswordNueva(e.target.value)} required minLength={8} />
        </label>
        <button className="primario" type="submit" disabled={guardando} style={{ marginTop: 12 }}>
          {guardando ? "Guardando..." : "Cambiar contraseña"}
        </button>
      </form>
    </div>
  );
}
