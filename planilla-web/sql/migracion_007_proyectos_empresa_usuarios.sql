-- =========================================================================
-- Migracion 007: Fase 1 de usuarios/perfiles y datos de la empresa.
--
-- Agrega:
-- - proyectos: lista de obras/centros de costo (se auto-llena con los
--   proyectos que ya usan tus contratos, ej. "P013-Tecnologico La
--   Union-Piura"). contratos.proyecto sigue siendo texto libre, no se
--   toca ningun contrato existente.
-- - usuario_proyecto: a que proyecto(s) tiene acceso cada usuario
--   (se usa en la Fase 2, cuando se activen los permisos por proyecto).
-- - datos_empresa: datos del empleador (RUC, razon social, regimen
--   laboral, etc.) para PLAME/T-Registro.
-- - usuarios: se agrega (si no existe) con un usuario ADMIN inicial.
--
-- No destructivo: no borra ni modifica ningun dato existente.
-- =========================================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(150) NOT NULL,
    correo          VARCHAR(150) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    rol             VARCHAR(30)  NOT NULL DEFAULT 'TAREADOR',
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proyectos (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(200) NOT NULL UNIQUE,
    ubicacion   VARCHAR(200),
    estado      VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuario_proyecto (
    usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    proyecto_id INT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, proyecto_id)
);

CREATE TABLE IF NOT EXISTS datos_empresa (
    id                    SERIAL PRIMARY KEY,
    ruc                   VARCHAR(11) NOT NULL,
    razon_social          VARCHAR(200) NOT NULL,
    nombre_comercial      VARCHAR(200),
    domicilio_fiscal      VARCHAR(250),
    ubigeo                VARCHAR(200),
    actividad_economica   VARCHAR(200),
    tipo_empresa          VARCHAR(100),
    regimen_laboral       VARCHAR(100),
    representante_legal   VARCHAR(200),
    telefono              VARCHAR(30),
    correo                VARCHAR(150),
    actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Autocompleta proyectos con los que ya estan en uso en tus contratos.
INSERT INTO proyectos (nombre)
SELECT DISTINCT proyecto FROM contratos WHERE proyecto IS NOT NULL AND proyecto <> ''
ON CONFLICT (nombre) DO NOTHING;

-- Fila inicial de datos_empresa, solo si la tabla esta vacia.
INSERT INTO datos_empresa (ruc, razon_social)
SELECT '', ''
WHERE NOT EXISTS (SELECT 1 FROM datos_empresa);

-- Usuario administrador inicial, solo si todavia no hay ningun usuario.
-- Contraseña temporal: Cambiar123!  -- cambiala apenas entres.
INSERT INTO usuarios (nombre, correo, password_hash, rol)
SELECT 'Administrador', 'admin@jhcr.pe', '$2b$10$8Lxwd51pi2/sDoPsybebsewOTlQ615wedQrrQkPA80EFMdlUr4uiK', 'ADMIN'
WHERE NOT EXISTS (SELECT 1 FROM usuarios);
