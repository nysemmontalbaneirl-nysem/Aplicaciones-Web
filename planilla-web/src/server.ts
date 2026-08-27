import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import { verificarConexion } from "./db";
import { requiereLogin } from "./authMiddleware";
import { authRouter } from "./routes/auth";
import { usuariosRouter } from "./routes/usuarios";
import { proyectosRouter } from "./routes/proyectos";
import { empresaRouter } from "./routes/empresa";
import { empleadosRouter } from "./routes/empleados";
import { contratosRouter } from "./routes/contratos";
import { periodosRouter } from "./routes/periodos";
import { planillaRouter } from "./routes/planilla";
import { parametrosRouter } from "./routes/parametros";
import { exportacionesRouter } from "./routes/exportaciones";
import { reportesRouter } from "./routes/reportes";
import { importacionRouter } from "./routes/importacion";
import { vacacionesRouter } from "./routes/vacaciones";
import { conceptosRouter } from "./routes/conceptos";
import { bitacoraRouter } from "./routes/bitacora";

// Red de seguridad adicional: si algo lanza un error fuera de una peticion
// HTTP (o se escapa del asyncHandler de las rutas), que quede en el log en
// vez de tumbar el servidor completo.
process.on("uncaughtException", (err) => {
  console.error("Excepcion no capturada:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("Promesa rechazada sin capturar:", err);
});

// Origenes permitidos para el frontend (separados por coma en CORS_ORIGIN si
// hace falta mas de uno, ej. produccion + un dominio de pruebas). Por
// defecto trae los puertos que ya usa este proyecto en desarrollo (Vite
// "npm run dev" = 5173, "npm run preview" = 4173), asi que instalar este
// cambio no rompe el flujo local existente. Cuando el sistema se publique
// en un dominio real, hay que poner ese dominio en CORS_ORIGIN.
const origenesPermitidos = (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://localhost:4173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
app.use(cors({ origin: origenesPermitidos }));
// El limite por defecto de 100kb se queda corto al calcular planilla con
// miles de trabajadores (el array de asistencias del periodo puede pesar
// varios cientos de KB).
app.use(express.json({ limit: "10mb" }));

app.get("/api/salud", (_req: Request, res: Response) => {
  res.json({ estado: "ok" });
});

// /api/auth es publico (el login no puede requerir estar logueado); las
// demas rutas de este mismo router (me, cambiar-password) se protegen a si
// mismas con requiereLogin.
app.use("/api/auth", authRouter);

// A partir de aca, toda ruta requiere sesion activa.
app.use(requiereLogin);

app.use("/api/usuarios", usuariosRouter);
app.use("/api/proyectos", proyectosRouter);
app.use("/api/empresa", empresaRouter);
app.use("/api/empleados", empleadosRouter);
app.use("/api/contratos", contratosRouter);
app.use("/api/periodos", periodosRouter);
// El router de planilla cuelga de /api/periodos/:id/planilla y /api/periodos/:id/calcular
app.use("/api/periodos", planillaRouter);
app.use("/api/parametros", parametrosRouter);
app.use("/api/periodos", exportacionesRouter);
app.use("/api/periodos", reportesRouter);
app.use("/api/empleados", importacionRouter);
app.use("/api/vacaciones", vacacionesRouter);
app.use("/api/conceptos", conceptosRouter);
app.use("/api/bitacora", bitacoraRouter);

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
