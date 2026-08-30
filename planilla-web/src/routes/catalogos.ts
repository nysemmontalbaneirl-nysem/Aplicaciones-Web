import { Router, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { pool } from "../db";

// Catalogos oficiales SUNAT (Anexo 2 T-Registro) cargados por la
// migracion_016. Son tablas de solo lectura para el sistema (se actualizan
// corriendo la migracion de nuevo con datos mas recientes de SUNAT, no
// desde la aplicacion) - por eso este router no tiene POST/PUT, solo GET.
//
// Se sirven todos juntos en una sola respuesta: el volumen total (~2600
// filas, la mas grande es el listado de distritos con ~1900) es chico
// para cargarlo una vez al abrir el formulario de alta de trabajador, y
// evita rodar el flujo con multiples idas y vueltas al servidor para
// armar los desplegables en cascada (departamento -> provincia -> distrito).
export const catalogosRouter = Router();

catalogosRouter.get("/", asyncHandler(async (_req: Request, res: Response) => {
  const [
    tipoDocumento,
    nacionalidad,
    tipoTrabajador,
    gradoInstruccion,
    regimenPensionario,
    tipoContrato,
    periodicidad,
    eps,
    tipoPago,
    motivoBaja,
    categoriaOcupacionalSunat,
    regimenSalud,
    regimenLaboral,
    situacionEspecial,
    banco,
    ubigeoDepartamento,
    ubigeoProvincia,
    ubigeoDistrito,
  ] = await Promise.all([
    pool.query("SELECT codigo, nombre FROM catalogo_tipo_documento ORDER BY codigo"),
    pool.query("SELECT codigo, nombre FROM catalogo_nacionalidad ORDER BY nombre"),
    pool.query("SELECT codigo, nombre FROM catalogo_tipo_trabajador ORDER BY nombre"),
    pool.query("SELECT codigo, nombre FROM catalogo_grado_instruccion ORDER BY codigo"),
    pool.query("SELECT codigo, nombre FROM catalogo_regimen_pensionario ORDER BY codigo"),
    pool.query("SELECT codigo, nombre FROM catalogo_tipo_contrato ORDER BY codigo"),
    pool.query("SELECT codigo, nombre FROM catalogo_periodicidad ORDER BY codigo"),
    pool.query("SELECT codigo, nombre FROM catalogo_eps ORDER BY nombre"),
    pool.query("SELECT codigo, nombre FROM catalogo_tipo_pago ORDER BY codigo"),
    pool.query("SELECT codigo, nombre FROM catalogo_motivo_baja ORDER BY codigo"),
    pool.query("SELECT codigo, nombre FROM catalogo_categoria_ocupacional_sunat ORDER BY codigo"),
    pool.query("SELECT codigo, nombre FROM catalogo_regimen_salud ORDER BY codigo"),
    pool.query("SELECT codigo, nombre FROM catalogo_regimen_laboral ORDER BY codigo"),
    pool.query("SELECT codigo, nombre FROM catalogo_situacion_especial ORDER BY codigo"),
    pool.query("SELECT codigo, nombre FROM catalogo_banco ORDER BY nombre"),
    pool.query("SELECT codigo, nombre FROM catalogo_ubigeo_departamento ORDER BY nombre"),
    pool.query("SELECT codigo, nombre, departamento_codigo FROM catalogo_ubigeo_provincia ORDER BY nombre"),
    pool.query("SELECT codigo, nombre, provincia_codigo FROM catalogo_ubigeo_distrito ORDER BY nombre"),
  ]);

  res.json({
    tipo_documento: tipoDocumento.rows,
    nacionalidad: nacionalidad.rows,
    tipo_trabajador: tipoTrabajador.rows,
    grado_instruccion: gradoInstruccion.rows,
    regimen_pensionario: regimenPensionario.rows,
    tipo_contrato: tipoContrato.rows,
    periodicidad: periodicidad.rows,
    eps: eps.rows,
    tipo_pago: tipoPago.rows,
    motivo_baja: motivoBaja.rows,
    categoria_ocupacional_sunat: categoriaOcupacionalSunat.rows,
    regimen_salud: regimenSalud.rows,
    regimen_laboral: regimenLaboral.rows,
    situacion_especial: situacionEspecial.rows,
    banco: banco.rows,
    ubigeo_departamento: ubigeoDepartamento.rows,
    ubigeo_provincia: ubigeoProvincia.rows,
    ubigeo_distrito: ubigeoDistrito.rows,
  });
}));
