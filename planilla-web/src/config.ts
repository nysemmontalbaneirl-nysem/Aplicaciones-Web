// Configuracion global pequeña, compartida entre modulos que no tienen otro
// lugar natural en comun (ej. boletaPdf.ts y routes/envios.ts). Se separa en
// su propio archivo para no crear una dependencia cruzada entre esos dos.

// Migracion 040: URL de acceso al sistema (login), a pedido del usuario para
// que aparezca en el pie de la boleta y en el correo cuando se envia una
// boleta por email. Se lee de APP_URL (.env) - si no esta configurada, cae
// al dominio real de produccion de este proyecto, para no dejar el campo
// vacio ni con un valor de ejemplo (localhost) si alguien olvida definir la
// variable en el servidor.
export function obtenerUrlAcceso(): string {
  return (process.env.APP_URL ?? "https://planillas.grupojhcr.com").trim().replace(/\/+$/, "");
}
