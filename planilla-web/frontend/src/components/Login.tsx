import { useState } from "react";
import { useAuth } from "../AuthContext";

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
        <h2>Sistema de Planillas — JHCR</h2>
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
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="primario" type="submit" disabled={entrando} style={{ marginTop: 12, width: "100%" }}>
            {entrando ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
