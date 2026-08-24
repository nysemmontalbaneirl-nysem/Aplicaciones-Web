import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { apiGet, apiPost, borrarToken, guardarToken, obtenerToken } from "./api";
import { Usuario } from "./types";

interface AuthContextValor {
  usuario: Usuario | null;
  cargando: boolean;
  iniciarSesion: (correo: string, password: string) => Promise<void>;
  cerrarSesion: () => void;
}

const AuthContext = createContext<AuthContextValor | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  async function restaurarSesion() {
    if (!obtenerToken()) {
      setCargando(false);
      return;
    }
    try {
      const { usuario } = await apiGet<{ usuario: Usuario }>("/auth/me");
      setUsuario(usuario);
    } catch {
      borrarToken();
      setUsuario(null);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    restaurarSesion();
    function alExpirar() {
      setUsuario(null);
    }
    window.addEventListener("sesion-expirada", alExpirar);
    return () => window.removeEventListener("sesion-expirada", alExpirar);
  }, []);

  async function iniciarSesion(correo: string, password: string) {
    const { token, usuario } = await apiPost<{ token: string; usuario: Usuario }>("/auth/login", {
      correo,
      password,
    });
    guardarToken(token);
    setUsuario(usuario);
  }

  function cerrarSesion() {
    borrarToken();
    setUsuario(null);
  }

  return (
    <AuthContext.Provider value={{ usuario, cargando, iniciarSesion, cerrarSesion }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValor {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
