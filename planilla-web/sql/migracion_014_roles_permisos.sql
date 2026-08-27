-- Migracion 014: roles configurables por el Administrador.
--
-- Hasta ahora los 3 roles (ADMIN, RESPONSABLE_PLANILLA, TAREADOR) y lo que
-- cada uno puede hacer estaban fijos en el codigo. Esta migracion agrega:
--   - roles: el catalogo de roles (los 3 de siempre + los que el
--     Administrador cree despues). "protegido" = true solo para ADMIN: ese
--     rol no se puede editar ni eliminar desde la pestana Roles, para que
--     nunca se pueda quedar el sistema sin ningun Administrador.
--   - permisos_catalogo: la lista fija de "cosas que el sistema sabe
--     controlar" (crear trabajadores, calcular planilla, etc.). Esta lista
--     la define el sistema, no es editable desde la pantalla.
--   - rol_permiso: que permisos tiene cada rol - esto SI lo edita el
--     Administrador desde la pestana Roles, marcando/desmarcando casillas.
--
-- Los permisos de RESPONSABLE_PLANILLA y TAREADOR se siembran para que
-- quede EXACTAMENTE el mismo comportamiento que ya tenian antes de esta
-- migracion (nadie pierde ni gana acceso a nada por correr esto).
--
-- No destructiva: se puede correr sobre la base real sin perder datos.

CREATE TABLE IF NOT EXISTS roles (
    codigo      VARCHAR(50) PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL,
    descripcion VARCHAR(300),
    -- El rol ADMIN es "protegido": tiene acceso a todo siempre (no depende
    -- de rol_permiso) y no se puede editar ni eliminar. Evita que alguien
    -- se quede sin ningun usuario con acceso total.
    protegido   BOOLEAN NOT NULL DEFAULT false,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permisos_catalogo (
    codigo  VARCHAR(60) PRIMARY KEY,
    nombre  VARCHAR(200) NOT NULL,
    grupo   VARCHAR(60) NOT NULL,
    orden   INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rol_permiso (
    rol_codigo     VARCHAR(50) NOT NULL REFERENCES roles(codigo) ON DELETE CASCADE ON UPDATE CASCADE,
    permiso_codigo VARCHAR(60) NOT NULL REFERENCES permisos_catalogo(codigo) ON DELETE CASCADE,
    PRIMARY KEY (rol_codigo, permiso_codigo)
);

INSERT INTO roles (codigo, nombre, descripcion, protegido) VALUES
    ('ADMIN', 'Administrador', 'Acceso total al sistema. No se puede editar ni eliminar.', true),
    ('RESPONSABLE_PLANILLA', 'Encargado de planilla', 'Gestiona trabajadores, tareo, calculo y boletas de sus proyectos asignados.', false),
    ('TAREADOR', 'Tareador', 'Solo carga el tareo (asistencia) de sus proyectos asignados.', false)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO permisos_catalogo (codigo, nombre, grupo, orden) VALUES
    ('empleados.gestionar',     'Crear y editar trabajadores',                                'Trabajadores',   10),
    ('contratos.gestionar',     'Crear, editar y dar de cese a contratos',                    'Trabajadores',   20),
    ('importacion.masiva',      'Importar trabajadores de forma masiva',                      'Trabajadores',   30),
    ('periodos.gestionar',      'Crear y eliminar periodos de planilla',                      'Planillas',      40),
    ('planilla.calcular',       'Calcular la planilla de un periodo',                         'Planillas',      50),
    ('boletas.ver',             'Ver las boletas ya calculadas',                              'Planillas',      60),
    ('reportes.ver',            'Ver y descargar el resumen de planilla (Excel)',             'Planillas',      70),
    ('exportaciones.descargar', 'Descargar archivos REM / AFPnet',                            'Planillas',      80),
    ('vacaciones.gestionar',    'Registrar goces de vacaciones y generar boletas',            'Vacaciones',     90),
    ('parametros.editar',       'Editar tasas legales, AFP y tabla salarial',                 'Parametros',    100),
    ('conceptos.editar',        'Configurar a que aportes/descuentos esta afecto cada concepto', 'Configuracion', 110),
    ('proyectos.gestionar',     'Crear y editar proyectos/obras',                             'Proyectos',     120),
    ('empresa.editar',          'Editar los datos de la empresa',                             'Empresa',       130),
    ('bitacora.ver',            'Ver el historial de cambios del sistema',                    'Bitacora',      140)
ON CONFLICT (codigo) DO NOTHING;

-- Backfill: deja a RESPONSABLE_PLANILLA y TAREADOR con el mismo acceso que
-- ya tenian (comparar contra los requiereRol(...) que existian en el
-- codigo antes de esta migracion). ADMIN no necesita filas aca: es
-- "protegido" y siempre tiene acceso a todo.
INSERT INTO rol_permiso (rol_codigo, permiso_codigo)
SELECT 'RESPONSABLE_PLANILLA', codigo FROM permisos_catalogo
WHERE codigo IN (
    'empleados.gestionar', 'contratos.gestionar', 'periodos.gestionar',
    'planilla.calcular', 'boletas.ver', 'reportes.ver',
    'exportaciones.descargar', 'vacaciones.gestionar'
)
ON CONFLICT DO NOTHING;

-- TAREADOR no tenia ninguno de estos permisos antes (solo podia cargar
-- tareo, que no pasaba por requiereRol) - por eso no se le siembra nada.

-- A partir de ahora usuarios.rol tiene que ser un codigo que exista en
-- roles (evita dejar un usuario con un rol que ya no existe). En un DO
-- block para poder correr esta migracion mas de una vez sin error.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_rol_fkey'
    ) THEN
        ALTER TABLE usuarios
            ADD CONSTRAINT usuarios_rol_fkey FOREIGN KEY (rol) REFERENCES roles(codigo);
    END IF;
END $$;
