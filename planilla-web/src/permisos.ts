import { TokenPayload } from "./auth";

// ADMIN ve/edita todo. RESPONSABLE_PLANILLA y TAREADOR solo los proyectos
// que tengan asignados en usuario_proyecto (guardados en el token al hacer
// login).
export function tieneAccesoProyecto(usuario: TokenPayload, proyecto: string): boolean {
  if (usuario.rol === "ADMIN") return true;
  return usuario.proyectos.includes(proyecto);
}
