export const BASE_URL = "http://localhost:3000/api";

const CLAVE_TOKEN = "planilla_token";

export function obtenerToken(): string | null {
  return localStorage.getItem(CLAVE_TOKEN);
}

export function guardarToken(token: string): void {
  localStorage.setItem(CLAVE_TOKEN, token);
}

export function borrarToken(): void {
  localStorage.removeItem(CLAVE_TOKEN);
}

// Agrega el token a un enlace de descarga (<a href>), que no puede mandar
// el header Authorization.
export function conToken(ruta: string): string {
  const token = obtenerToken();
  if (!token) return ruta;
  const separador = ruta.includes("?") ? "&" : "?";
  return `${ruta}${separador}token=${encodeURIComponent(token)}`;
}

function encabezadosAuth(): Record<string, string> {
  const token = obtenerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function manejarRespuesta<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    borrarToken();
    window.dispatchEvent(new Event("sesion-expirada"));
  }
  if (!res.ok) {
    let mensaje = `Error ${res.status}`;
    try {
      const cuerpo = await res.json();
      if (cuerpo?.error) mensaje = cuerpo.error;
    } catch {
      // sin cuerpo JSON, se deja el mensaje generico
    }
    throw new Error(mensaje);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function apiGet<T>(ruta: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${ruta}`, { headers: encabezadosAuth() });
  return manejarRespuesta<T>(res);
}

export async function apiPost<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...encabezadosAuth() },
    body: JSON.stringify(cuerpo),
  });
  return manejarRespuesta<T>(res);
}

export async function apiPut<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${ruta}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...encabezadosAuth() },
    body: JSON.stringify(cuerpo),
  });
  return manejarRespuesta<T>(res);
}

export async function apiDelete(ruta: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${ruta}`, { method: "DELETE", headers: encabezadosAuth() });
  return manejarRespuesta<void>(res);
}

// Para subir archivos (FormData) - no se le pone Content-Type, el browser
// arma el multipart/form-data solo.
export async function apiPostArchivo<T>(ruta: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${ruta}`, {
    method: "POST",
    headers: encabezadosAuth(),
    body: formData,
  });
  return manejarRespuesta<T>(res);
}
