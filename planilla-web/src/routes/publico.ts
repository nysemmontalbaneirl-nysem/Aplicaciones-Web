import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { obtenerLogoEmpresa } from "./empresa";

// Rutas PUBLICAS (sin sesion iniciada) - se montan en app.ts ANTES de
// requiereLogin, mismo criterio que /api/auth. Hoy solo el logo de la
// empresa, para poder mostrarlo en la pantalla de Login (pedido explicito
// del usuario, migracion 031): antes de loguearse no existe ningun token,
// asi que la ruta protegida /api/empresa/logo (que exige sesion, ver
// authMiddleware) no sirve para este caso. El logo no es informacion
// sensible - es la misma imagen que ya aparece en cualquier Boleta
// impresa - asi que exponerla sin autenticacion es aceptable.
export const publicoRouter = Router();

publicoRouter.get(
  "/logo-empresa",
  asyncHandler(async (_req: Request, res: Response) => {
    const logo = await obtenerLogoEmpresa();
    if (!logo) {
      return res.status(404).json({ error: "No hay logo configurado todavia" });
    }
    res.setHeader("Content-Type", logo.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", 'inline; filename="logo"');
    // Sin cache: si el usuario reemplaza el logo, el siguiente que abra la
    // pantalla de Login (sin sesion, sin el "?v=" que usa la pantalla
    // Empresa para forzar recarga) debe ver el logo nuevo de inmediato.
    res.setHeader("Cache-Control", "no-store");
    res.send(logo.buffer);
  })
);
