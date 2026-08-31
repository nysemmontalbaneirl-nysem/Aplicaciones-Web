import { Router, Request, Response } from "express";
import ExcelJS from "exceljs";
import { asyncHandler } from "../asyncHandler";
import { requierePermiso } from "../authMiddleware";
import { pool } from "../db";
import { tieneAccesoProyecto } from "../permisos";
import {
  codigoOpcional,
  ErrorValidacion,
  mensajeErrorCatalogo,
  validarCategoriaOcupacional,
  validarFecha,
  validarSistemaPension,
} from "../validaciones";
import { registrarBitacora } from "../bitacora";
import { generarPdfTabla } from "../pdfTabla";

export const contratosRouter = Router();

// Arma el WHERE + valores compartido entre el listado en pantalla y las
// descargas de Excel/PDF, para que "lo que ves es lo que exportas": mismo
// filtro de estado, mismo texto de busqueda (DNI/nombre/proyecto) y mismo
// recorte de proyectos segun el rol del usuario.
function condicionesContratos(req: Request): { where: string; valores: unknown[] } {
  const { empleado_id, estado, q } = req.query;
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (empleado_id) {
    valores.push(empleado_id);
    condiciones.push(`c.empleado_id = $${valores.length}`);
  }
  if (estado) {
    valores.push(estado);
    condiciones.push(`c.estado = $${valores.length}`);
  }
  if (q && String(q).trim()) {
    valores.push(`%${String(q).trim()}%`);
    condiciones.push(
      `(e.numero_documento ILIKE $${valores.length} OR e.apellidos_nombres ILIKE $${valores.length} OR c.proyecto ILIKE $${valores.length})`
    );
  }
  if (req.usuario!.rol !== "ADMIN") {
    valores.push(req.usuario!.proyectos);
    condiciones.push(`c.proyecto = ANY($${valores.length}::text[])`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  return { where, valores };
}

contratosRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const { where, valores } = condicionesContratos(req);
  const resultado = await pool.query(
    `SELECT c.*, e.apellidos_nombres, e.numero_documento
     FROM contratos c JOIN empleados e ON e.id = c.empleado_id
     ${where}
     ORDER BY c.fecha_ingreso DESC`,
    valores
  );
  res.json(resultado.rows);
}));

function fechaCortaOTexto(v: unknown): string {
  if (!v) return "-";
  return new Date(v as string).toISOString().slice(0, 10);
}

async function obtenerFilasExportacion(req: Request) {
  const { where, valores } = condicionesContratos(req);
  const resultado = await pool.query(
    `SELECT c.*, e.apellidos_nombres, e.numero_documento
     FROM contratos c JOIN empleados e ON e.id = c.empleado_id
     ${where}
     ORDER BY e.apellidos_nombres ASC`,
    valores
  );
  return resultado.rows;
}

// Descarga en Excel del listado de trabajadores actualmente visible en
// pantalla (respeta el mismo filtro de estado y el mismo texto de busqueda).
contratosRouter.get("/exportar/excel", asyncHandler(async (req: Request, res: Response) => {
  const filas = await obtenerFilasExportacion(req);

  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Trabajadores");
  hoja.columns = [
    { header: "DNI", key: "dni", width: 14 },
    { header: "Apellidos y nombres", key: "nombres", width: 34 },
    { header: "Proyecto", key: "proyecto", width: 22 },
    { header: "Categoria", key: "categoria", width: 14 },
    { header: "Pension", key: "pension", width: 14 },
    { header: "Fecha ingreso", key: "ingreso", width: 14 },
    { header: "Fecha cese", key: "cese", width: 14 },
    { header: "Estado", key: "estado", width: 12 },
    { header: "Motivo de baja", key: "motivo", width: 14 },
  ];
  hoja.getRow(1).font = { bold: true };

  const codigosMotivo = new Map<string, string>();
  const catalogoMotivo = await pool.query("SELECT codigo, nombre FROM catalogo_motivo_baja");
  for (const m of catalogoMotivo.rows) codigosMotivo.set(m.codigo, m.nombre);

  for (const c of filas) {
    hoja.addRow({
      dni: c.numero_documento,
      nombres: c.apellidos_nombres,
      proyecto: c.proyecto,
      categoria: c.categoria_ocupacional,
      pension: c.sistema_pension === "AFP" ? `AFP ${c.afp_nombre ?? ""}` : "ONP",
      ingreso: fechaCortaOTexto(c.fecha_ingreso),
      cese: c.fecha_cese ? fechaCortaOTexto(c.fecha_cese) : "-",
      estado: c.estado,
      motivo: c.motivo_baja_codigo ? codigosMotivo.get(c.motivo_baja_codigo) ?? c.motivo_baja_codigo : "-",
    });
  }
  hoja.getColumn("dni").numFmt = "@"; // texto, no perder ceros a la izquierda

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="trabajadores.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}));

// Descarga en PDF del mismo listado (tabla simple, para imprimir o adjuntar).
contratosRouter.get("/exportar/pdf", asyncHandler(async (req: Request, res: Response) => {
  const filas = await obtenerFilasExportacion(req);

  const filtroEstado = (req.query.estado as string | undefined) ?? "TODOS";
  const buffer = await generarPdfTabla({
    titulo: "Listado de trabajadores",
    subtitulo: `Estado: ${filtroEstado} · ${filas.length} trabajador(es) · Generado el ${new Date().toLocaleDateString("es-PE")}`,
    columnas: [
      { titulo: "DNI", ancho: 60 },
      { titulo: "Apellidos y nombres", ancho: 170 },
      { titulo: "Proyecto", ancho: 110 },
      { titulo: "Categoria", ancho: 75 },
      { titulo: "Pension", ancho: 75 },
      { titulo: "Ingreso", ancho: 60 },
      { titulo: "Cese", ancho: 60 },
      { titulo: "Estado", ancho: 55 },
    ],
    filas: filas.map((c) => [
      c.numero_documento,
      c.apellidos_nombres,
      c.proyecto,
      c.categoria_ocupacional,
      c.sistema_pension === "AFP" ? `AFP ${c.afp_nombre ?? ""}` : "ONP",
      fechaCortaOTexto(c.fecha_ingreso),
      c.fecha_cese ? fechaCortaOTexto(c.fecha_cese) : "-",
      c.estado,
    ]),
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="trabajadores.pdf"`);
  res.send(buffer);
}));

contratosRouter.post("/", requierePermiso("contratos.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const categoria_ocupacional = validarCategoriaOcupacional(b.categoria_ocupacional);
    const sistema_pension = validarSistemaPension(b.sistema_pension);
    const fecha_ingreso = validarFecha(b.fecha_ingreso, "fecha_ingreso");

    if (!b.empleado_id) {
      throw new ErrorValidacion("empleado_id es obligatorio");
    }
    if (sistema_pension === "AFP" && !b.afp_nombre) {
      throw new ErrorValidacion("afp_nombre es obligatorio cuando sistema_pension = AFP");
    }
    if ((categoria_ocupacional === "EMPLEADO" || categoria_ocupacional === "EVENTUAL") && !b.sueldo_base) {
      throw new ErrorValidacion("sueldo_base es obligatorio para las categorias EMPLEADO y EVENTUAL");
    }
    if (!tieneAccesoProyecto(req.usuario!, b.proyecto ?? "")) {
      return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    }

    // Aviso (no bloqueo) si el trabajador ya tiene otro contrato HABIL: en
    // la mayoria de los casos es un descuido (se olvidaron de cesar el
    // anterior), pero un trabajador SI puede legitimamente tener contratos
    // activos en dos proyectos a la vez - por eso se deja seguir si el
    // frontend confirma explicitamente con confirmar_duplicado=true.
    if (!b.confirmar_duplicado) {
      const habilExistente = await pool.query(
        `SELECT id, proyecto, fecha_ingreso FROM contratos WHERE empleado_id = $1 AND estado = 'HABIL'`,
        [b.empleado_id]
      );
      if ((habilExistente.rowCount ?? 0) > 0) {
        return res.status(409).json({
          error: "Este trabajador ya tiene otro contrato HABIL activo. ¿Deseas crear uno nuevo de todas formas?",
          requiere_confirmacion: true,
          contratos_habiles: habilExistente.rows,
        });
      }
    }

    const categoria_ocupacional_sunat_codigo = codigoOpcional(b.categoria_ocupacional_sunat_codigo);
    const tipo_trabajador_codigo = codigoOpcional(b.tipo_trabajador_codigo) ?? "27"; // CONSTRUCCION CIVIL
    const regimen_laboral_codigo = codigoOpcional(b.regimen_laboral_codigo) ?? "21"; // CONSTRUCCION CIVIL
    const tipo_contrato_codigo = codigoOpcional(b.tipo_contrato_codigo);
    const tipo_pago_codigo = codigoOpcional(b.tipo_pago_codigo);
    const periodicidad_codigo = codigoOpcional(b.periodicidad_codigo);
    const situacion_especial_codigo = codigoOpcional(b.situacion_especial_codigo) ?? "0"; // NINGUNA
    const regimen_salud_codigo = codigoOpcional(b.regimen_salud_codigo) ?? "00"; // ESSALUD REGULAR
    const eps_codigo = codigoOpcional(b.eps_codigo);

    const resultado = await pool.query(
      `INSERT INTO contratos
        (empleado_id, proyecto, grupo, categoria_ocupacional, ocupacion, sistema_pension,
         afp_nombre, cuspp, sistema_comision, fecha_ingreso, sueldo_base, viaticos,
         sindicalizado, poliza_seguro, sctr_salud, essalud_vida, domiciliado,
         categoria_ocupacional_sunat_codigo, tipo_trabajador_codigo, regimen_laboral_codigo,
         tipo_contrato_codigo, tipo_pago_codigo, periodicidad_codigo, situacion_especial_codigo,
         jornada_laboral, regimen_salud_codigo, eps_codigo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       RETURNING *`,
      [
        b.empleado_id,
        b.proyecto ?? "",
        b.grupo ?? null,
        categoria_ocupacional,
        b.ocupacion ?? null,
        sistema_pension,
        b.afp_nombre ?? null,
        b.cuspp ?? null,
        b.sistema_comision ?? null,
        fecha_ingreso,
        b.sueldo_base ?? null,
        b.viaticos ?? 0,
        b.sindicalizado ?? false,
        b.poliza_seguro ?? false,
        b.sctr_salud ?? false,
        b.essalud_vida ?? false,
        b.domiciliado ?? true,
        categoria_ocupacional_sunat_codigo,
        tipo_trabajador_codigo,
        regimen_laboral_codigo,
        tipo_contrato_codigo,
        tipo_pago_codigo,
        periodicidad_codigo,
        situacion_especial_codigo,
        b.jornada_laboral ?? null,
        regimen_salud_codigo,
        eps_codigo,
      ]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    const mensajeCatalogo = mensajeErrorCatalogo(err);
    if (mensajeCatalogo) {
      return res.status(400).json({ error: mensajeCatalogo });
    }
    throw err;
  }
}));

contratosRouter.put("/:id", requierePermiso("contratos.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const categoria_ocupacional = validarCategoriaOcupacional(b.categoria_ocupacional);
    const sistema_pension = validarSistemaPension(b.sistema_pension);
    const fecha_ingreso = validarFecha(b.fecha_ingreso, "fecha_ingreso");

    if (sistema_pension === "AFP" && !b.afp_nombre) {
      throw new ErrorValidacion("afp_nombre es obligatorio cuando sistema_pension = AFP");
    }
    if ((categoria_ocupacional === "EMPLEADO" || categoria_ocupacional === "EVENTUAL") && !b.sueldo_base) {
      throw new ErrorValidacion("sueldo_base es obligatorio para las categorias EMPLEADO y EVENTUAL");
    }

    const actual = await pool.query("SELECT proyecto FROM contratos WHERE id = $1", [req.params.id]);
    if (actual.rowCount === 0) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    if (
      !tieneAccesoProyecto(req.usuario!, actual.rows[0].proyecto) ||
      !tieneAccesoProyecto(req.usuario!, b.proyecto ?? "")
    ) {
      return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    }

    const categoria_ocupacional_sunat_codigo = codigoOpcional(b.categoria_ocupacional_sunat_codigo);
    const tipo_trabajador_codigo = codigoOpcional(b.tipo_trabajador_codigo) ?? "27";
    const regimen_laboral_codigo = codigoOpcional(b.regimen_laboral_codigo) ?? "21";
    const tipo_contrato_codigo = codigoOpcional(b.tipo_contrato_codigo);
    const tipo_pago_codigo = codigoOpcional(b.tipo_pago_codigo);
    const periodicidad_codigo = codigoOpcional(b.periodicidad_codigo);
    const situacion_especial_codigo = codigoOpcional(b.situacion_especial_codigo) ?? "0";
    const regimen_salud_codigo = codigoOpcional(b.regimen_salud_codigo) ?? "00";
    const eps_codigo = codigoOpcional(b.eps_codigo);

    const resultado = await pool.query(
      `UPDATE contratos SET
        proyecto = $1, grupo = $2, categoria_ocupacional = $3, ocupacion = $4,
        sistema_pension = $5, afp_nombre = $6, cuspp = $7, sistema_comision = $8,
        fecha_ingreso = $9, sueldo_base = $10, viaticos = $11, sindicalizado = $12,
        poliza_seguro = $13, sctr_salud = $14, essalud_vida = $15, domiciliado = $16,
        categoria_ocupacional_sunat_codigo = $17, tipo_trabajador_codigo = $18,
        regimen_laboral_codigo = $19, tipo_contrato_codigo = $20, tipo_pago_codigo = $21,
        periodicidad_codigo = $22, situacion_especial_codigo = $23, jornada_laboral = $24,
        regimen_salud_codigo = $25, eps_codigo = $26
       WHERE id = $27
       RETURNING *`,
      [
        b.proyecto ?? "",
        b.grupo ?? null,
        categoria_ocupacional,
        b.ocupacion ?? null,
        sistema_pension,
        b.afp_nombre ?? null,
        b.cuspp ?? null,
        b.sistema_comision ?? null,
        fecha_ingreso,
        b.sueldo_base ?? null,
        b.viaticos ?? 0,
        b.sindicalizado ?? false,
        b.poliza_seguro ?? false,
        b.sctr_salud ?? false,
        b.essalud_vida ?? false,
        b.domiciliado ?? true,
        categoria_ocupacional_sunat_codigo,
        tipo_trabajador_codigo,
        regimen_laboral_codigo,
        tipo_contrato_codigo,
        tipo_pago_codigo,
        periodicidad_codigo,
        situacion_especial_codigo,
        b.jornada_laboral ?? null,
        regimen_salud_codigo,
        eps_codigo,
        req.params.id,
      ]
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    res.json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    const mensajeCatalogo = mensajeErrorCatalogo(err);
    if (mensajeCatalogo) {
      return res.status(400).json({ error: mensajeCatalogo });
    }
    throw err;
  }
}));

contratosRouter.post("/:id/cese", requierePermiso("contratos.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  try {
    const fecha_cese = validarFecha(req.body.fecha_cese, "fecha_cese");
    const actual = await pool.query("SELECT proyecto FROM contratos WHERE id = $1", [req.params.id]);
    if (actual.rowCount === 0) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    if (!tieneAccesoProyecto(req.usuario!, actual.rows[0].proyecto)) {
      return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    }
    const motivo_baja_codigo = codigoOpcional(req.body.motivo_baja_codigo);

    const resultado = await pool.query(
      `UPDATE contratos SET fecha_cese = $1, estado = 'CESADO', motivo_baja_codigo = $2 WHERE id = $3 RETURNING *`,
      [fecha_cese, motivo_baja_codigo, req.params.id]
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    await registrarBitacora(req.usuario!.id, "CESE_TRABAJADOR", "contratos", resultado.rows[0].id, {
      fecha_cese,
      motivo_baja_codigo,
      proyecto: resultado.rows[0].proyecto,
    });
    res.json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    const mensajeCatalogo = mensajeErrorCatalogo(err);
    if (mensajeCatalogo) {
      return res.status(400).json({ error: mensajeCatalogo });
    }
    throw err;
  }
}));

// PUT /:id/cese - corrige la fecha o el motivo de un cese YA registrado (ej.
// se digito mal la fecha o el motivo de baja), sin cambiar el estado: el
// contrato sigue CESADO. Antes de esto no habia forma de corregir esos
// datos una vez guardados. Para deshacer el cese por completo (el
// trabajador nunca debio ser dado de baja) esta el POST /anular-cese.
contratosRouter.put("/:id/cese", requierePermiso("contratos.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  try {
    const fecha_cese = validarFecha(req.body.fecha_cese, "fecha_cese");
    const actual = await pool.query("SELECT proyecto, estado FROM contratos WHERE id = $1", [req.params.id]);
    if (actual.rowCount === 0) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    if (!tieneAccesoProyecto(req.usuario!, actual.rows[0].proyecto)) {
      return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
    }
    if (actual.rows[0].estado !== "CESADO") {
      return res.status(400).json({ error: "Este contrato no esta cesado - no hay datos de cese que corregir" });
    }
    const motivo_baja_codigo = codigoOpcional(req.body.motivo_baja_codigo);

    const resultado = await pool.query(
      `UPDATE contratos SET fecha_cese = $1, motivo_baja_codigo = $2 WHERE id = $3 RETURNING *`,
      [fecha_cese, motivo_baja_codigo, req.params.id]
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: "Contrato no encontrado" });
    }
    await registrarBitacora(req.usuario!.id, "EDITAR_CESE", "contratos", resultado.rows[0].id, {
      fecha_cese,
      motivo_baja_codigo,
      proyecto: resultado.rows[0].proyecto,
    });
    res.json(resultado.rows[0]);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return res.status(400).json({ error: err.message });
    }
    const mensajeCatalogo = mensajeErrorCatalogo(err);
    if (mensajeCatalogo) {
      return res.status(400).json({ error: mensajeCatalogo });
    }
    throw err;
  }
}));

// POST /:id/anular-cese - deshace un cese registrado por error: el contrato
// vuelve a HABIL y se borran fecha_cese/motivo_baja_codigo. Aviso (no
// bloqueo) si el trabajador ya tiene OTRO contrato HABIL (ej. ya se hizo un
// reingreso despues de este cese) - reactivar este dejaria dos contratos
// HABIL a la vez, que probablemente no es lo que se quiere; el frontend
// confirma explicitamente con confirmar_duplicado=true para seguir de
// todas formas (mismo patron que crear un contrato duplicado).
contratosRouter.post("/:id/anular-cese", requierePermiso("contratos.gestionar"), asyncHandler(async (req: Request, res: Response) => {
  const actual = await pool.query("SELECT * FROM contratos WHERE id = $1", [req.params.id]);
  if (actual.rowCount === 0) {
    return res.status(404).json({ error: "Contrato no encontrado" });
  }
  const contrato = actual.rows[0];
  if (!tieneAccesoProyecto(req.usuario!, contrato.proyecto)) {
    return res.status(403).json({ error: "No tienes acceso a ese proyecto" });
  }
  if (contrato.estado !== "CESADO") {
    return res.status(400).json({ error: "Este contrato no esta cesado" });
  }

  if (!req.body?.confirmar_duplicado) {
    const habilExistente = await pool.query(
      `SELECT id, proyecto, fecha_ingreso FROM contratos WHERE empleado_id = $1 AND estado = 'HABIL' AND id <> $2`,
      [contrato.empleado_id, contrato.id]
    );
    if ((habilExistente.rowCount ?? 0) > 0) {
      return res.status(409).json({
        error:
          "Este trabajador ya tiene otro contrato HABIL activo (posiblemente un reingreso posterior). ¿Deseas anular el cese de todas formas?",
        requiere_confirmacion: true,
        contratos_habiles: habilExistente.rows,
      });
    }
  }

  const resultado = await pool.query(
    `UPDATE contratos SET fecha_cese = NULL, motivo_baja_codigo = NULL, estado = 'HABIL' WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  await registrarBitacora(req.usuario!.id, "ANULAR_CESE", "contratos", resultado.rows[0].id, {
    proyecto: resultado.rows[0].proyecto,
  });
  res.json(resultado.rows[0]);
}));
