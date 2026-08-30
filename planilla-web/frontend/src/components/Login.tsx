import { useState } from "react";
import { useAuth } from "../AuthContext";
import logoJhcr from "../assets/logo-jhcr.jpg";
import CampoPassword from "./CampoPassword";

export default function Login() {
  const { iniciarSesion } = useAuth();
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEntrando(true);
    try {
      await iniciarSesion(correo, password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh" }}>
      <div className="card" style={{ width: 360 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <img
            src={logoJhcr}
            alt="JHCR Recursos Humanos Web"
            style={{ width: 96, height: 96, objectFit: "contain" }}
          />
        </div>
        <h2 style={{ textAlign: "center" }}>Sistema de Planillas — JHCR</h2>
        {error && <div className="mensaje-error">{error}</div>}
        <form onSubmit={enviar}>
          <label>
            Correo
            <input
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              autoFocus
              required
            />
          </label>
          <label>
            Contraseña
            <CampoPassword value={password} onChange={setPassword} required autoComplete="current-password" />
          </label>
          <button className="primario" type="submit" disabled={entrando} style={{ marginTop: 12, width: "100%" }}>
            {entrando ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
