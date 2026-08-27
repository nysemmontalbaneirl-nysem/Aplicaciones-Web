import { NextFunction, Request, Response } from "express";
import { TokenPayload, verificarToken } from "./auth";
import { RolUsuario } from "./tipos";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: TokenPayload;
    }
  }
}

export function requiereLogin(req: Request, res: Response, next: NextFunction) {
  const encabezado = req.headers.authorization;
  // Los enlaces de descarga (<a href>, ej. REM/AFPnet/plantilla de tareo) no
  // pueden mandar el header Authorization, asi que tambien se acepta el
  // token por query string (?token=...) solo para esos casos.
  const token = encabezado?.startsWith("Bearer ")
    ? encabezado.slice("Bearer ".length)
    : (req.query.token as string | undefined);
  if (!token) {
    return res.status(401).json({ error: "No hay sesion activa. Inicia sesion de nuevo." });
  }
  try {
    req.usuario = verificarToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "La sesion expiro o no es valida. Inicia sesion de nuevo." });
  }
}

export function requiereRol(...roles: RolUsuario[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario) {
      return res.status(401).json({ error: "No hay sesion activa. Inicia sesion de nuevo." });
    }
    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: "No tienes permiso para hacer esto." });
    }
    next();
  };
}

// Igual que requiereRol, pero contra un permiso de permisos_catalogo en vez
// de un rol fijo por nombre - lo que tenga el rol del usuario depende de
// rol_permiso, configurable por el Administrador desde la pestaña Roles.
// "*" (rol protegido, ej. ADMIN) siempre pasa.
export function requierePermiso(codigo: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario) {
      return res.status(401).json({ error: "No hay sesion activa. Inicia sesion de nuevo." });
    }
    if (!req.usuario.permisos.includes("*") && !req.usuario.permisos.includes(codigo)) {
      return res.status(403).json({ error: "No tienes permiso para hacer esto." });
    }
    next();
  };
}
