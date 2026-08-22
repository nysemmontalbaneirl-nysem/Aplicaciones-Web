import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";

import { verificarConexion } from "./db";
import { empleadosRouter } from "./routes/empleados";
import { contratosRouter } from "./routes/contratos";
import { periodosRouter } from "./routes/periodos";
import { planillaRouter } from "./routes/planilla";
import { parametrosRouter } from "./routes/parametros";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/salud", (_req: Request, res: Response) => {
  res.json({ estado: "ok" });
});

app.use("/api/empleados", empleadosRouter);
app.use("/api/contratos", contratosRouter);
app.use("/api/periodos", periodosRouter);
// El router de planilla cuelga de /api/periodos/:id/planilla y /api/periodos/:id/calcular
app.use("/api/periodos", planillaRouter);
app.use("/api/parametros", parametrosRouter);

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
