import { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 no atrapa automaticamente los rechazos de promesas de un
// handler async: si algo lanza un error inesperado, la promesa queda
// "unhandled rejection" y tumba TODO el proceso de Node (no solo esa
// peticion). Este wrapper reenvia cualquier error a next(err) para que
// lo capture el middleware de errores centralizado en server.ts.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
