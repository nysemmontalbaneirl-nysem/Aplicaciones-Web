import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";

import { verificarConexion } from "./db";
import { empleadosRouter } from "./routes/empleados";
import { contratosRouter } from "./routes/contratos";
import { periodosRouter } from "./routes/periodos";
import { planillaRouter } from "./routes/planilla";
import { parametrosRouter } from "./routes/parametros";
import { exportacionesRouter } from "./routes/exportaciones";
import { importacionRouter } from "./routes/importacion";

dotenv.config();

// Red de seguridad adicional: si algo lanza un error fuera de una peticion
// HTTP (o se escapa del asyncHandler de las rutas), que quede en el log en
// vez de tumbar el servidor completo.
process.on("uncaughtException", (err) => {
  console.error("Excepcion no capturada:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("Promesa rechazada sin capturar:", err);
});

const app = express();
app.use(cors());
// El limite por defecto de 100kb se queda corto al calcular planilla con
// miles de trabajadores (el array de asistencias del periodo puede pesar
// varios cientos de KB).
app.use(express.json({ limit: "10mb" }));

app.get("/api/salud", (_req: Request, res: Response) => {
  res.json({ estado: "ok" });
});

app.use("/api/empleados", empleadosRouter);
app.use("/api/contratos", contratosRouter);
app.use("/api/periodos", periodosRouter);
// El router de planilla cuelga de /api/periodos/:id/planilla y /api/periodos/:id/calcular
app.use("/api/periodos", planillaRouter);
app.use("/api/parametros", parametrosRouter);
app.use("/api/periodos", exportacionesRouter);
app.use("/api/empleados", importacionRouter);

// Manejador de errores centralizado
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
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
