// Pruebas automatizadas de autorizacion: verifican que cada ruta exija el
// rol correcto (ADMIN / RESPONSABLE_PLANILLA / TAREADOR) y, donde aplica,
// que un RESPONSABLE_PLANILLA o TAREADOR no pueda tocar datos de un
// proyecto que no tiene asignado. Usan la app real (tests/setupEnv.ts fuerza
// DB_NAME=planilla_test_jest, nunca la base real) y una base de datos de
// pruebas sembrada por tests/globalSetup.ts.
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";
import { CLAVE_PRUEBA } from "./globalSetup";

type Usuario = "admin" | "responsableA" | "tareadorA" | "responsableB" | "inactivo";

const CORREOS: Record<Usuario, string> = {
  admin: "admin@prueba.local",
  responsableA: "responsable-a@prueba.local",
  tareadorA: "tareador-a@prueba.local",
  responsableB: "responsable-b@prueba.local",
  inactivo: "inactivo@prueba.local",
};

const tokens: Partial<Record<Usuario, string>> = {};

async function login(usuario: Usuario): Promise<string> {
  const r = await request(app)
    .post("/api/auth/login")
    .send({ correo: CORREOS[usuario], password: CLAVE_PRUEBA });
  if (r.status !== 200) {
    throw new Error(`No se pudo iniciar sesion como ${usuario}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body.token as string;
}

function auth(usuario: Usuario) {
  return { Authorization: `Bearer ${tokens[usuario]}` };
}

let contratoProyectoA: number;
let contratoProyectoB: number;
let periodoId: number;

beforeAll(async () => {
  // Se loguea UNA sola vez por usuario y se reusan los tokens en todas las
  // pruebas (el login tiene un freno de 10 intentos/15min por IP, ver
  // routes/auth.ts, asi que no conviene loguearse repetidamente).
  tokens.admin = await login("admin");
  tokens.responsableA = await login("responsableA");
  tokens.tareadorA = await login("tareadorA");
  tokens.responsableB = await login("responsableB");

  const contratos = await request(app).get("/api/contratos").set(auth("admin"));
  const contratoA = contratos.body.find((c: { proyecto: string }) => c.proyecto === "Proyecto A");
  const contratoB = contratos.body.find((c: { proyecto: string }) => c.proyecto === "Proyecto B");
  contratoProyectoA = contratoA.id;
  contratoProyectoB = contratoB.id;

  const periodos = await request(app).get("/api/periodos").set(auth("admin"));
  periodoId = periodos.body[0].id;
});

afterAll(async () => {
  // Cierra el pool de conexiones abierto por src/db.ts al importar la app,
  // para que Jest no se quede colgado esperando handles abiertos y para que
  // tests/globalTeardown.ts pueda borrar la base de pruebas sin pelear con
  // conexiones activas.
  await pool.end();
});

describe("login", () => {
  it("rechaza un usuario inactivo aunque la contraseña sea correcta", async () => {
    const r = await request(app)
      .post("/api/auth/login")
      .send({ correo: CORREOS.inactivo, password: CLAVE_PRUEBA });
    expect(r.status).toBe(401);
  });

  it("rechaza una contraseña incorrecta", async () => {
    const r = await request(app)
      .post("/api/auth/login")
      .send({ correo: CORREOS.admin, password: "contraseña-incorrecta" });
    expect(r.status).toBe(401);
  });

  it("da un token distinto de vacio para credenciales correctas", async () => {
    const r = await request(app)
      .post("/api/auth/login")
      .send({ correo: CORREOS.admin, password: CLAVE_PRUEBA });
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe("string");
    expect(r.body.token.length).toBeGreaterThan(10);
  });
});

describe("acceso sin sesion", () => {
  it("rechaza una peticion sin token con 401", async () => {
    const r = await request(app).get("/api/empleados");
    expect(r.status).toBe(401);
  });

  it("rechaza un token invalido con 401", async () => {
    const r = await request(app).get("/api/empleados").set({ Authorization: "Bearer token-invalido" });
    expect(r.status).toBe(401);
  });
});

// Rutas/acciones que exigen ADMIN puro (ni RESPONSABLE_PLANILLA ni TAREADOR
// pueden entrar).
describe("rutas solo-ADMIN", () => {
  const casos: Array<[string, (u: Usuario) => request.Test]> = [
    ["GET /api/usuarios", (u) => request(app).get("/api/usuarios").set(auth(u))],
    ["POST /api/proyectos", (u) => request(app).post("/api/proyectos").set(auth(u)).send({ nombre: "X" })],
    ["POST /api/parametros/mensual", (u) => request(app).post("/api/parametros/mensual").set(auth(u)).send({})],
    ["GET /api/conceptos", (u) => request(app).get("/api/conceptos").set(auth(u))],
    ["GET /api/bitacora", (u) => request(app).get("/api/bitacora").set(auth(u))],
    [
      "POST /api/empleados/importar-masivo",
      (u) => request(app).post("/api/empleados/importar-masivo").set(auth(u)),
    ],
  ];

  it.each(casos)("%s -> 403 para RESPONSABLE_PLANILLA", async (_nombre, hacer) => {
    const r = await hacer("responsableA");
    expect(r.status).toBe(403);
  });

  it.each(casos)("%s -> 403 para TAREADOR", async (_nombre, hacer) => {
    const r = await hacer("tareadorA");
    expect(r.status).toBe(403);
  });

  it.each(casos)("%s -> no da 403 para ADMIN", async (_nombre, hacer) => {
    const r = await hacer("admin");
    expect(r.status).not.toBe(403);
  });
});

// Rutas que exigen ADMIN o RESPONSABLE_PLANILLA (TAREADOR queda afuera).
// Incluye explicitamente las dos rutas cuyo bug de falta de control de rol
// se corrigio en esta misma tanda de trabajo (periodos y exportaciones),
// para que la suite falle si alguna vez se vuelve a quitar el control.
describe("rutas ADMIN + RESPONSABLE_PLANILLA (TAREADOR sin acceso)", () => {
  // DELETE /api/periodos/:id se prueba aparte (mas abajo) porque, a
  // diferencia de las demas, si el rol pasa el permiso realmente borra el
  // periodo - no puede compartir el mismo periodoId que las pruebas de
  // exportar.
  const casos: Array<[string, (u: Usuario) => request.Test]> = [
    ["POST /api/periodos", (u) => request(app).post("/api/periodos").set(auth(u)).send({})],
    [
      "GET /api/periodos/:id/exportar/rem",
      (u) => request(app).get(`/api/periodos/${periodoId}/exportar/rem`).set(auth(u)),
    ],
    [
      "GET /api/periodos/:id/exportar/afpnet",
      (u) => request(app).get(`/api/periodos/${periodoId}/exportar/afpnet`).set(auth(u)),
    ],
    ["POST /api/empleados", (u) => request(app).post("/api/empleados").set(auth(u)).send({})],
    ["POST /api/contratos", (u) => request(app).post("/api/contratos").set(auth(u)).send({})],
  ];

  it.each(casos)("%s -> 403 para TAREADOR", async (_nombre, hacer) => {
    const r = await hacer("tareadorA");
    expect(r.status).toBe(403);
  });

  it.each(casos)("%s -> no da 403/401 para RESPONSABLE_PLANILLA", async (_nombre, hacer) => {
    const r = await hacer("responsableA");
    expect(r.status).not.toBe(403);
    expect(r.status).not.toBe(401);
  });

  it.each(casos)("%s -> no da 403/401 para ADMIN", async (_nombre, hacer) => {
    const r = await hacer("admin");
    expect(r.status).not.toBe(403);
    expect(r.status).not.toBe(401);
  });

  async function crearPeriodoDescartable(mes: number): Promise<number> {
    const r = await request(app)
      .post("/api/periodos")
      .set(auth("admin"))
      .send({ anio: 2027, mes, tipo: "MENSUAL", fecha_inicio: `2027-${String(mes).padStart(2, "0")}-01`, fecha_fin: `2027-${String(mes).padStart(2, "0")}-28` });
    expect(r.status).toBe(201);
    return r.body.id;
  }

  it("DELETE /api/periodos/:id -> 403 para TAREADOR (y el periodo sigue existiendo)", async () => {
    const id = await crearPeriodoDescartable(1);
    const r = await request(app).delete(`/api/periodos/${id}`).set(auth("tareadorA"));
    expect(r.status).toBe(403);
    const sigueAhi = await request(app).get("/api/periodos").set(auth("admin"));
    expect(sigueAhi.body.some((p: { id: number }) => p.id === id)).toBe(true);
  });

  it("DELETE /api/periodos/:id -> RESPONSABLE_PLANILLA si puede eliminarlo", async () => {
    const id = await crearPeriodoDescartable(2);
    const r = await request(app).delete(`/api/periodos/${id}`).set(auth("responsableA"));
    expect(r.status).toBe(204);
  });

  it("DELETE /api/periodos/:id -> ADMIN si puede eliminarlo", async () => {
    const id = await crearPeriodoDescartable(3);
    const r = await request(app).delete(`/api/periodos/${id}`).set(auth("admin"));
    expect(r.status).toBe(204);
  });
});

// Control por proyecto: un RESPONSABLE_PLANILLA solo puede tocar los
// contratos de SU proyecto, aunque su rol si le alcance para la accion.
describe("control por proyecto (RESPONSABLE_PLANILLA)", () => {
  it("Responsable de Proyecto A puede dar de cese a un contrato de Proyecto A", async () => {
    const r = await request(app)
      .post(`/api/contratos/${contratoProyectoA}/cese`)
      .set(auth("responsableA"))
      .send({ fecha_cese: "2026-03-15" });
    expect(r.status).toBe(200);
  });

  it("Responsable de Proyecto A NO puede dar de cese a un contrato de Proyecto B", async () => {
    const r = await request(app)
      .post(`/api/contratos/${contratoProyectoB}/cese`)
      .set(auth("responsableA"))
      .send({ fecha_cese: "2026-03-15" });
    expect(r.status).toBe(403);
  });

  it("Responsable de Proyecto B NO puede dar de cese a un contrato de Proyecto A", async () => {
    const r = await request(app)
      .post(`/api/contratos/${contratoProyectoA}/cese`)
      .set(auth("responsableB"))
      .send({ fecha_cese: "2026-03-15" });
    expect(r.status).toBe(403);
  });

  it("no puede crear un contrato en un proyecto que no tiene asignado", async () => {
    const r = await request(app)
      .post("/api/contratos")
      .set(auth("responsableA"))
      .send({
        empleado_id: 1,
        proyecto: "Proyecto B",
        categoria_ocupacional: "PEON",
        sistema_pension: "ONP",
        fecha_ingreso: "2026-03-01",
      });
    expect(r.status).toBe(403);
  });

  it("ADMIN si puede tocar contratos de cualquier proyecto", async () => {
    const r = await request(app).get("/api/contratos").set(auth("admin"));
    expect(r.status).toBe(200);
    const proyectos = r.body.map((c: { proyecto: string }) => c.proyecto);
    expect(proyectos).toEqual(expect.arrayContaining(["Proyecto A", "Proyecto B"]));
  });
});

// Roles configurables: prueba que un rol NUEVO creado desde la pestaña
// Roles realmente controle el acceso (no solo quede como una casilla
// marcada sin efecto), y que el rol protegido (ADMIN) quede a salvo de
// edicion/eliminacion accidental.
describe("roles configurables", () => {
  it("gestionar roles es solo para ADMIN, no delegable", async () => {
    const r1 = await request(app).get("/api/roles").set(auth("responsableA"));
    expect(r1.status).toBe(403);
    const r2 = await request(app).get("/api/roles").set(auth("tareadorA"));
    expect(r2.status).toBe(403);
  });

  it("el catalogo de permisos disponibles incluye los permisos conocidos", async () => {
    const r = await request(app).get("/api/roles/permisos-disponibles").set(auth("admin"));
    expect(r.status).toBe(200);
    const codigos = r.body.map((p: { codigo: string }) => p.codigo);
    expect(codigos).toEqual(expect.arrayContaining(["planilla.calcular", "reportes.ver", "empresa.editar"]));
  });

  it("el rol protegido (ADMIN) no se puede editar ni eliminar", async () => {
    const rEditar = await request(app).put("/api/roles/ADMIN").set(auth("admin")).send({ nombre: "Otro nombre" });
    expect(rEditar.status).toBe(409);
    const rBorrar = await request(app).delete("/api/roles/ADMIN").set(auth("admin"));
    expect(rBorrar.status).toBe(409);
  });

  it("crea un rol nuevo con un solo permiso y ese permiso SI controla el acceso real", async () => {
    const crear = await request(app)
      .post("/api/roles")
      .set(auth("admin"))
      .send({ nombre: "Supervisor de Prueba", permisos: ["planilla.calcular"] });
    expect(crear.status).toBe(201);
    const codigoRol = crear.body.codigo;
    expect(crear.body.permisos).toEqual(["planilla.calcular"]);

    const crearUsuario = await request(app)
      .post("/api/usuarios")
      .set(auth("admin"))
      .send({
        nombre: "Usuario Supervisor Prueba",
        correo: "supervisor-prueba@prueba.local",
        password: "ClavePrueba123!",
        rol: codigoRol,
        proyecto_ids: [],
      });
    expect(crearUsuario.status).toBe(201);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ correo: "supervisor-prueba@prueba.local", password: "ClavePrueba123!" });
    expect(login.status).toBe(200);
    expect(login.body.usuario.permisos).toEqual(["planilla.calcular"]);
    const tokenSupervisor = login.body.token as string;

    // Tiene el permiso planilla.calcular: no lo bloquea el rol (puede
    // fallar despues por reglas de negocio, ej. falta tareo, pero eso ya
    // no es un 401/403).
    const calcular = await request(app)
      .post(`/api/periodos/${periodoId}/calcular`)
      .set({ Authorization: `Bearer ${tokenSupervisor}` });
    expect(calcular.status).not.toBe(401);
    expect(calcular.status).not.toBe(403);

    // NO tiene reportes.ver: el checklist debe bloquearlo igual que a
    // cualquier otro rol sin ese permiso.
    const reporte = await request(app)
      .get(`/api/periodos/${periodoId}/reporte/datos`)
      .set({ Authorization: `Bearer ${tokenSupervisor}` });
    expect(reporte.status).toBe(403);

    // No se puede eliminar un rol que todavia tiene usuarios asignados.
    const borrarEnUso = await request(app).delete(`/api/roles/${codigoRol}`).set(auth("admin"));
    expect(borrarEnUso.status).toBe(409);
  });

  it("no se puede crear un usuario con un rol que no existe", async () => {
    const r = await request(app)
      .post("/api/usuarios")
      .set(auth("admin"))
      .send({
        nombre: "Usuario Rol Invalido",
        correo: "rol-invalido@prueba.local",
        password: "ClavePrueba123!",
        rol: "ROL_QUE_NO_EXISTE",
      });
    expect(r.status).toBe(400);
  });
});
