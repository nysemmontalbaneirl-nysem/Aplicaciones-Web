const BASE_URL = "http://localhost:3000/api";

async function manejarRespuesta<T>(res: Response): Promise<T> {
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
  return res.json() as Promise<T>;
}

export async function apiGet<T>(ruta: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${ruta}`);
  return manejarRespuesta<T>(res);
}

export async function apiPost<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return manejarRespuesta<T>(res);
}
