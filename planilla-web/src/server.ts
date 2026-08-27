import { app } from "./app";
import { verificarConexion } from "./db";

// Red de seguridad adicional: si algo lanza un error fuera de una peticion
// HTTP (o se escapa del asyncHandler de las rutas), que quede en el log en
// vez de tumbar el servidor completo.
process.on("uncaughtException", (err) => {
  console.error("Excepcion no capturada:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("Promesa rechazada sin capturar:", err);
});

const PORT = Number(process.env.PORT ?? 3000);

async function iniciar() {
  await verificarConexion();
  console.log("Conexion a PostgreSQL verificada correctamente.");
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

iniciar().catch((err) => {
  console.error("No se pudo iniciar el servidor:", err);
  process.exit(1);
});
