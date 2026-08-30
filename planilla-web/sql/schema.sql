-- =========================================================================
-- Esquema: planilla_construccion
-- Sistema de planillas (migración desde Excel/VBA) - JHCR
-- Régimen: Construcción Civil (BUC, CONAFOVICER, SENATI) + Empleados
-- =========================================================================
-- Ejecutar completo en pgAdmin (Query Tool) sobre la base planilla_construccion.
-- Si ya existían las 7 tablas de la versión anterior (sin datos), este script
-- las reemplaza por una versión más completa alineada al motor de cálculo real.
-- =========================================================================

DROP TABLE IF EXISTS conceptos_planilla CASCADE;
DROP TABLE IF EXISTS boletas_vacaciones CASCADE;
DROP TABLE IF EXISTS vacaciones_goce CASCADE;
DROP TABLE IF EXISTS bitacora_planilla CASCADE;
DROP TABLE IF EXISTS detalle_planilla CASCADE;
DROP TABLE IF EXISTS periodos_planilla CASCADE;
DROP TABLE IF EXISTS contratos CASCADE;
DROP TABLE IF EXISTS empleados CASCADE;
DROP TABLE IF EXISTS parametros_normativos CASCADE;
DROP TABLE IF EXISTS usuario_proyecto CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS rol_permiso CASCADE;
DROP TABLE IF EXISTS permisos_catalogo CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS proyectos CASCADE;
DROP TABLE IF EXISTS datos_empresa CASCADE;

-- -------------------------------------------------------------------------
-- roles / permisos_catalogo / rol_permiso: roles configurables desde la
-- pestaña Roles (ver sql/migracion_014_roles_permisos.sql para el detalle).
-- "protegido" = true solo para ADMIN: acceso total siempre, no editable ni
-- eliminable, para que el sistema nunca se quede sin un Administrador.
-- -------------------------------------------------------------------------
CREATE TABLE roles (
    codigo      VARCHAR(50) PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL,
    descripcion VARCHAR(300),
    protegido   BOOLEAN NOT NULL DEFAULT false,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catalogo fijo de permisos que el sistema sabe controlar (no editable
-- desde la pantalla, solo que rol tiene cada uno).
CREATE TABLE permisos_catalogo (
    codigo  VARCHAR(60) PRIMARY KEY,
    nombre  VARCHAR(200) NOT NULL,
    grupo   VARCHAR(60) NOT NULL,
    orden   INT NOT NULL DEFAULT 0
);

CREATE TABLE rol_permiso (
    rol_codigo     VARCHAR(50) NOT NULL REFERENCES roles(codigo) ON DELETE CASCADE ON UPDATE CASCADE,
    permiso_codigo VARCHAR(60) NOT NULL REFERENCES permisos_catalogo(codigo) ON DELETE CASCADE,
    PRIMARY KEY (rol_codigo, permiso_codigo)
);

-- -------------------------------------------------------------------------
-- usuarios: acceso al sistema (login real con contraseña)
-- -------------------------------------------------------------------------
CREATE TABLE usuarios (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(150) NOT NULL,
    correo          VARCHAR(150) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    -- Codigo de roles.codigo. ADMIN (protegido): acceso total. Los demas
    -- roles definen su acceso via rol_permiso, mas el filtro por proyecto
    -- asignado (usuario_proyecto) para lo que si tienen permiso de hacer.
    rol             VARCHAR(30)  NOT NULL DEFAULT 'TAREADOR' REFERENCES roles(codigo),
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------
-- proyectos: obras/centros de costo (la empresa es constructora, cada
-- proyecto puede estar en una ciudad distinta con su propio encargado de
-- planilla y tareadores). Por ahora es una tabla de referencia: el campo
-- contratos.proyecto sigue siendo texto libre (para no romper los ~3200
-- contratos ya migrados), pero debe coincidir con proyectos.nombre.
-- -------------------------------------------------------------------------
CREATE TABLE proyectos (
    id                      SERIAL PRIMARY KEY,
    nombre                  VARCHAR(200) NOT NULL UNIQUE, -- debe coincidir con contratos.proyecto
    ubicacion               VARCHAR(200),
    estado                  VARCHAR(20) NOT NULL DEFAULT 'ACTIVO', -- ACTIVO | CERRADO
    -- Cuota sindical: NO es un porcentaje del sueldo, es una tarifa FIJA
    -- semanal que varia por proyecto (verificado contra boletas reales:
    -- P012=S/15/semana, P009=S/10/semana, P013=S/20/semana). Se divide entre
    -- 6 dias para la tarifa diaria, y se multiplica por los dias trabajados.
    cuota_sindical_semanal  NUMERIC(10,2) NOT NULL DEFAULT 0,
    -- Cada proyecto/obra es su propio establecimiento SUNAT (ver migracion_016).
    codigo_establecimiento  VARCHAR(4) DEFAULT '0000',
    tipo_establecimiento    VARCHAR(30) NOT NULL DEFAULT 'ESTABLECIMIENTO ANEXO'
        CHECK (tipo_establecimiento IN ('DOMICILIO FISCAL', 'ESTABLECIMIENTO ANEXO')),
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------
-- usuario_proyecto: a que proyecto(s) tiene acceso cada usuario (no aplica
-- a ADMIN, que ve todos).
-- -------------------------------------------------------------------------
CREATE TABLE usuario_proyecto (
    usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    proyecto_id INT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, proyecto_id)
);

-- -------------------------------------------------------------------------
-- datos_empresa: datos del empleador para PLAME/T-Registro (fila unica)
-- -------------------------------------------------------------------------
CREATE TABLE datos_empresa (
    id                    SERIAL PRIMARY KEY,
    ruc                   VARCHAR(11) NOT NULL,
    razon_social          VARCHAR(200) NOT NULL,
    nombre_comercial      VARCHAR(200),
    domicilio_fiscal      VARCHAR(250),
    ubigeo                VARCHAR(200),
    actividad_economica   VARCHAR(200),
    tipo_empresa          VARCHAR(100), -- ej. Sociedad Anonima Cerrada, E.I.R.L, etc
    regimen_laboral       VARCHAR(100), -- ej. Construccion Civil
    representante_legal   VARCHAR(200),
    telefono              VARCHAR(30),
    correo                VARCHAR(150),
    actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------
-- parametros_normativos: constantes legales por año (editable sin tocar código)
-- -------------------------------------------------------------------------
-- Valores de frecuencia ANUAL (UIT, RMV, ESSALUD, ONP, etc.) - un registro por año.
CREATE TABLE parametros_normativos (
    id                          SERIAL PRIMARY KEY,
    anio                        INT NOT NULL UNIQUE,
    uit                         NUMERIC(10,2) NOT NULL,
    remuneracion_minima_vital   NUMERIC(10,2) NOT NULL DEFAULT 0,
    tasa_essalud                NUMERIC(6,4)  NOT NULL DEFAULT 0.09,
    tasa_onp                    NUMERIC(6,4)  NOT NULL DEFAULT 0.13,
    tasa_senati                 NUMERIC(6,4)  NOT NULL DEFAULT 0.0045, -- "Fondo Capacitacion" en la boleta real, no 0.75%
    tasa_conafovicer            NUMERIC(6,4)  NOT NULL DEFAULT 0.02,
    tasa_sctr_salud             NUMERIC(6,4)  NOT NULL DEFAULT 0.0155,
    asignacion_familiar         NUMERIC(10,2) NOT NULL,
    seguro_vida_ley             NUMERIC(10,2) NOT NULL DEFAULT 5.00,
    creado_en                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tasas AFP de frecuencia MENSUAL (SBS publica valores nuevos cada mes).
CREATE TABLE tasas_afp_mensuales (
    id                  SERIAL PRIMARY KEY,
    anio                INT NOT NULL,
    mes                 INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    afp_nombre          VARCHAR(30) NOT NULL, -- INTEGRA | PRIMA | PROFUTURO | HABITAT
    comision_flujo      NUMERIC(6,4) NOT NULL DEFAULT 0,
    prima_seguro        NUMERIC(6,4) NOT NULL DEFAULT 0,
    aporte_obligatorio  NUMERIC(6,4) NOT NULL DEFAULT 0.10,
    UNIQUE (anio, mes, afp_nombre)
);

-- Tabla salarial de construcción civil de frecuencia MENSUAL (jornal básico y BUC por categoría).
CREATE TABLE tabla_salarial_mensual (
    id                    SERIAL PRIMARY KEY,
    anio                  INT NOT NULL,
    mes                   INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    categoria             VARCHAR(30) NOT NULL, -- OPERARIO | OFICIAL | PEON | OPERARIO_EP | OPERARIO_EM | OPERARIO_TP | PEON_A | R_GENERAL
    jornal_basico         NUMERIC(10,2) NOT NULL,
    buc                   NUMERIC(6,4) NOT NULL DEFAULT 0,
    bae                   NUMERIC(6,4) NOT NULL DEFAULT 0, -- solo OPERARIO_EP/EM/TP (10%/8%/9%)
    movilidad_acumulada   NUMERIC(10,2) NOT NULL DEFAULT 0,
    -- Valor de referencia editable (no alimenta el calculo de gratificacion real,
    -- que se calcula por Ley 29351 segun tiempo de servicio en motorCalculo.ts).
    gratificacion_diaria  NUMERIC(10,2) NOT NULL DEFAULT 0,
    UNIQUE (anio, mes, categoria)
);

-- -------------------------------------------------------------------------
-- Catalogos oficiales SUNAT (Anexo 2, T-Registro) - ver migracion_016 para
-- el detalle de la fuente y las decisiones de diseño. Son de solo lectura
-- para la aplicacion; se actualizan re-corriendo la migracion si SUNAT
-- publica una version mas nueva del Anexo 2.
-- -------------------------------------------------------------------------
CREATE TABLE catalogo_tipo_documento (codigo VARCHAR(2) PRIMARY KEY, nombre VARCHAR(150) NOT NULL);
CREATE TABLE catalogo_nacionalidad (codigo VARCHAR(4) PRIMARY KEY, nombre VARCHAR(150) NOT NULL);
CREATE TABLE catalogo_tipo_trabajador (codigo VARCHAR(2) PRIMARY KEY, nombre VARCHAR(150) NOT NULL);
CREATE TABLE catalogo_grado_instruccion (codigo VARCHAR(2) PRIMARY KEY, nombre VARCHAR(150) NOT NULL);
CREATE TABLE catalogo_regimen_pensionario (codigo VARCHAR(2) PRIMARY KEY, nombre VARCHAR(150) NOT NULL);
CREATE TABLE catalogo_tipo_contrato (codigo VARCHAR(2) PRIMARY KEY, nombre VARCHAR(150) NOT NULL);
CREATE TABLE catalogo_periodicidad (codigo VARCHAR(1) PRIMARY KEY, nombre VARCHAR(60) NOT NULL);
CREATE TABLE catalogo_eps (codigo VARCHAR(11) PRIMARY KEY, nombre VARCHAR(150) NOT NULL); -- RUC de la EPS ("0"=servicios propios)
CREATE TABLE catalogo_tipo_pago (codigo VARCHAR(1) PRIMARY KEY, nombre VARCHAR(60) NOT NULL);
CREATE TABLE catalogo_motivo_baja (codigo VARCHAR(2) PRIMARY KEY, nombre VARCHAR(200) NOT NULL);
CREATE TABLE catalogo_categoria_ocupacional_sunat (codigo VARCHAR(2) PRIMARY KEY, nombre VARCHAR(150) NOT NULL);
CREATE TABLE catalogo_regimen_salud (codigo VARCHAR(2) PRIMARY KEY, nombre VARCHAR(150) NOT NULL);
CREATE TABLE catalogo_regimen_laboral (codigo VARCHAR(2) PRIMARY KEY, nombre VARCHAR(150) NOT NULL);
CREATE TABLE catalogo_situacion_especial (codigo VARCHAR(1) PRIMARY KEY, nombre VARCHAR(150) NOT NULL);
CREATE TABLE catalogo_banco (codigo VARCHAR(3) PRIMARY KEY, nombre VARCHAR(150) NOT NULL);

-- Ubigeo: 3 catalogos independientes (la hoja fuente de SUNAT no es una
-- tabla jerarquica fila-a-fila) - la jerarquia se deriva del propio codigo,
-- ver migracion_016 para el detalle.
CREATE TABLE catalogo_ubigeo_departamento (codigo VARCHAR(2) PRIMARY KEY, nombre VARCHAR(100) NOT NULL);
CREATE TABLE catalogo_ubigeo_provincia (
    codigo VARCHAR(4) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    departamento_codigo VARCHAR(2) NOT NULL REFERENCES catalogo_ubigeo_departamento(codigo)
);
CREATE TABLE catalogo_ubigeo_distrito (
    codigo VARCHAR(6) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    provincia_codigo VARCHAR(4) NOT NULL REFERENCES catalogo_ubigeo_provincia(codigo)
);
CREATE INDEX idx_ubigeo_provincia_dep ON catalogo_ubigeo_provincia(departamento_codigo);
CREATE INDEX idx_ubigeo_distrito_prov ON catalogo_ubigeo_distrito(provincia_codigo);

-- -------------------------------------------------------------------------
-- empleados: datos maestros de la persona (no cambian por proyecto/periodo)
-- -------------------------------------------------------------------------
CREATE TABLE empleados (
    id                  SERIAL PRIMARY KEY,
    tipo_documento      VARCHAR(2)   NOT NULL DEFAULT '1', -- Tabla 3 T-Registro (1=DNI)
    numero_documento    VARCHAR(15)  NOT NULL UNIQUE,
    apellidos_nombres   VARCHAR(200) NOT NULL,
    fecha_nacimiento    DATE,
    sexo                VARCHAR(1) CHECK (sexo IN ('M', 'F')),
    estado_civil        VARCHAR(20) CHECK (estado_civil IN ('SOLTERO', 'CASADO', 'VIUDO', 'DIVORCIADO', 'CONVIVIENTE')),
    nacionalidad_codigo VARCHAR(4) REFERENCES catalogo_nacionalidad(codigo) DEFAULT '9589', -- PERU
    pais_emisor_documento_codigo VARCHAR(4) REFERENCES catalogo_nacionalidad(codigo), -- solo si tipo_documento = pasaporte
    grado_instruccion   VARCHAR(60), -- texto libre historico (import inicial) - preferir grado_instruccion_codigo en formularios nuevos
    grado_instruccion_codigo VARCHAR(2) REFERENCES catalogo_grado_instruccion(codigo),
    numero_hijos        INT NOT NULL DEFAULT 0,
    celular             VARCHAR(20),
    correo              VARCHAR(120),
    direccion           TEXT,
    segunda_direccion   TEXT, -- la direccion del DNI muchas veces difiere de donde vive el trabajador
    direccion_essalud   TEXT, -- referente para el centro asistencial EsSalud
    ubigeo              VARCHAR(200), -- texto libre historico - preferir ubigeo_*_codigo en formularios nuevos
    ubigeo_departamento_codigo VARCHAR(2) REFERENCES catalogo_ubigeo_departamento(codigo),
    ubigeo_provincia_codigo    VARCHAR(4) REFERENCES catalogo_ubigeo_provincia(codigo),
    ubigeo_distrito_codigo     VARCHAR(6) REFERENCES catalogo_ubigeo_distrito(codigo),
    entidad_bancaria    VARCHAR(100), -- texto libre historico - preferir entidad_bancaria_codigo en formularios nuevos
    entidad_bancaria_codigo VARCHAR(3) REFERENCES catalogo_banco(codigo),
    cuenta_bancaria     VARCHAR(100),
    discapacidad        BOOLEAN NOT NULL DEFAULT FALSE,
    estado              VARCHAR(20) NOT NULL DEFAULT 'ACTIVO', -- ACTIVO | INACTIVO
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------
-- contratos: relación laboral (una persona puede tener varios en el tiempo,
-- o reingresar). Aquí vive todo lo que cambia por asignación de obra/proyecto.
-- -------------------------------------------------------------------------
CREATE TABLE contratos (
    id                    SERIAL PRIMARY KEY,
    empleado_id           INT NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
    proyecto              VARCHAR(150) NOT NULL, -- obra/centro de costo (ej. "P013-Tecnologico La Union-Piura")
    grupo                 VARCHAR(100),          -- ej. "JHCR", "CRJH-SINDICATO"
    categoria_ocupacional VARCHAR(30) NOT NULL,  -- OPERARIO | OFICIAL | PEON | EMPLEADO | EVENTUAL | OPERARIO EP
    categoria_ocupacional_sunat_codigo VARCHAR(2) REFERENCES catalogo_categoria_ocupacional_sunat(codigo), -- Tabla 24 (dato independiente, no derivado)
    ocupacion             VARCHAR(120),
    sistema_pension       VARCHAR(10) NOT NULL,  -- AFP | ONP
    afp_nombre            VARCHAR(30),           -- INTEGRA | PRIMA | PROFUTURO | HABITAT (null si ONP)
    cuspp                 VARCHAR(20),
    sistema_comision      VARCHAR(5),            -- F=Flujo | S=Saldo | M=Mixta
    fecha_ingreso         DATE NOT NULL,
    fecha_cese            DATE,
    sueldo_base           NUMERIC(10,2),         -- solo aplica a categoría EMPLEADO (mensual fijo)
    viaticos              NUMERIC(10,2) NOT NULL DEFAULT 0,
    sindicalizado         BOOLEAN NOT NULL DEFAULT FALSE,
    poliza_seguro         BOOLEAN NOT NULL DEFAULT FALSE,
    sctr_salud            BOOLEAN NOT NULL DEFAULT FALSE,
    essalud_vida          BOOLEAN NOT NULL DEFAULT FALSE,
    domiciliado           BOOLEAN NOT NULL DEFAULT TRUE,
    estado                VARCHAR(20) NOT NULL DEFAULT 'HABIL', -- HABIL | CESADO
    -- Campos T-Registro (Tablas 8, 33, 12, 16, 13, 17, 35, 32, 14) - ver migracion_016.
    tipo_trabajador_codigo    VARCHAR(2) REFERENCES catalogo_tipo_trabajador(codigo) DEFAULT '27', -- CONSTRUCCION CIVIL
    regimen_laboral_codigo    VARCHAR(2) REFERENCES catalogo_regimen_laboral(codigo) DEFAULT '21', -- CONSTRUCCION CIVIL
    tipo_contrato_codigo      VARCHAR(2) REFERENCES catalogo_tipo_contrato(codigo),
    tipo_pago_codigo          VARCHAR(1) REFERENCES catalogo_tipo_pago(codigo),
    periodicidad_codigo       VARCHAR(1) REFERENCES catalogo_periodicidad(codigo),
    motivo_baja_codigo        VARCHAR(2) REFERENCES catalogo_motivo_baja(codigo), -- se llena recien al cesar
    situacion_especial_codigo VARCHAR(1) REFERENCES catalogo_situacion_especial(codigo) DEFAULT '0', -- NINGUNA
    jornada_laboral           VARCHAR(100), -- sin tabla SUNAT propia
    regimen_salud_codigo      VARCHAR(2) REFERENCES catalogo_regimen_salud(codigo) DEFAULT '00', -- ESSALUD REGULAR
    eps_codigo                VARCHAR(11) REFERENCES catalogo_eps(codigo), -- NULL = sin EPS
    creado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contratos_empleado ON contratos(empleado_id);
CREATE INDEX idx_contratos_estado ON contratos(estado);

-- -------------------------------------------------------------------------
-- periodos_planilla: cabecera de cada mes/quincena procesada
-- -------------------------------------------------------------------------
CREATE TABLE periodos_planilla (
    id             SERIAL PRIMARY KEY,
    anio           INT NOT NULL,
    mes            INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    quincena       INT CHECK (quincena IN (1,2)), -- NULL si es mensual
    tipo           VARCHAR(20) NOT NULL DEFAULT 'MENSUAL', -- MENSUAL | QUINCENAL
    fecha_inicio   DATE NOT NULL,
    fecha_fin      DATE NOT NULL,
    dias_periodo   INT NOT NULL DEFAULT 30,
    estado         VARCHAR(20) NOT NULL DEFAULT 'ABIERTO', -- ABIERTO | CALCULADO | CERRADO | DECLARADO
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indice unico en vez de un UNIQUE de columnas: en Postgres dos NULL nunca
-- se consideran iguales, asi que un UNIQUE(anio,mes,quincena,tipo) normal
-- no evita crear dos periodos MENSUAL (quincena NULL) del mismo mes.
CREATE UNIQUE INDEX periodos_planilla_periodo_unico
    ON periodos_planilla (anio, mes, tipo, COALESCE(quincena, 0));

-- -------------------------------------------------------------------------
-- asistencia_periodo: tareo cargado (Excel/CSV o manual) de un periodo.
-- Solo existe una fila aqui para los trabajadores que efectivamente
-- trabajaron ese periodo (no para toda la planilla) - es la fuente de la
-- que se calcula detalle_planilla.
-- -------------------------------------------------------------------------
CREATE TABLE asistencia_periodo (
    id              SERIAL PRIMARY KEY,
    periodo_id      INT NOT NULL REFERENCES periodos_planilla(id) ON DELETE CASCADE,
    contrato_id     INT NOT NULL REFERENCES contratos(id) ON DELETE RESTRICT,
    dias_trabajados NUMERIC(5,2) NOT NULL DEFAULT 0,
    dias_dominical  NUMERIC(5,2) NOT NULL DEFAULT 0,
    dias_feriado    NUMERIC(5,2) NOT NULL DEFAULT 0,
    dias_falta      NUMERIC(5,2) NOT NULL DEFAULT 0,
    horas_extra_25  NUMERIC(6,2) NOT NULL DEFAULT 0,
    horas_extra_35  NUMERIC(6,2) NOT NULL DEFAULT 0,
    horas_extra_100 NUMERIC(6,2) NOT NULL DEFAULT 0,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (periodo_id, contrato_id)
);

-- -------------------------------------------------------------------------
-- detalle_planilla: línea calculada por trabajador y periodo (el "resultado")
-- -------------------------------------------------------------------------
CREATE TABLE detalle_planilla (
    id                     SERIAL PRIMARY KEY,
    periodo_id             INT NOT NULL REFERENCES periodos_planilla(id) ON DELETE CASCADE,
    contrato_id            INT NOT NULL REFERENCES contratos(id) ON DELETE RESTRICT,

    -- asistencia
    dias_trabajados        NUMERIC(6,2) NOT NULL DEFAULT 0,
    dias_dominical         NUMERIC(6,2) NOT NULL DEFAULT 0,
    dias_feriado           NUMERIC(6,2) NOT NULL DEFAULT 0,
    dias_falta             NUMERIC(6,2) NOT NULL DEFAULT 0,
    horas_extra_25         NUMERIC(6,2) NOT NULL DEFAULT 0,
    horas_extra_35         NUMERIC(6,2) NOT NULL DEFAULT 0,
    horas_extra_100        NUMERIC(6,2) NOT NULL DEFAULT 0,

    -- ingresos
    jornal_diario          NUMERIC(10,2) NOT NULL DEFAULT 0,
    sueldo_basico          NUMERIC(10,2) NOT NULL DEFAULT 0,
    remuneracion_dominical NUMERIC(10,2) NOT NULL DEFAULT 0,
    remuneracion_feriado   NUMERIC(10,2) NOT NULL DEFAULT 0,
    importe_horas_extra    NUMERIC(10,2) NOT NULL DEFAULT 0,
    asignacion_familiar    NUMERIC(10,2) NOT NULL DEFAULT 0,
    asignacion_escolaridad NUMERIC(10,2) NOT NULL DEFAULT 0,
    bonificacion_buc       NUMERIC(10,2) NOT NULL DEFAULT 0,
    bonificacion_bae       NUMERIC(10,2) NOT NULL DEFAULT 0,
    bonificacion_movilidad NUMERIC(10,2) NOT NULL DEFAULT 0,
    otras_bonificaciones   NUMERIC(10,2) NOT NULL DEFAULT 0,
    gratificacion          NUMERIC(10,2) NOT NULL DEFAULT 0,
    bonificacion_extraordinaria NUMERIC(10,2) NOT NULL DEFAULT 0, -- Ley 29351/30334: 9% de la gratificacion, pagado al trabajador
    cts                    NUMERIC(10,2) NOT NULL DEFAULT 0,
    vacaciones             NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_ingresos         NUMERIC(10,2) NOT NULL DEFAULT 0,

    -- descuentos del trabajador
    aporte_pension         NUMERIC(10,2) NOT NULL DEFAULT 0, -- ONP 13% u (obligatorio+comisión+prima AFP)
    descuento_sindicato     NUMERIC(10,2) NOT NULL DEFAULT 0,
    seguro_vida             NUMERIC(10,2) NOT NULL DEFAULT 0, -- Poliza de vida Ley (D.Leg 688): aporte integro del empleador, NO se descuenta al trabajador (no se suma a total_descuentos)
    conafovicer              NUMERIC(10,2) NOT NULL DEFAULT 0,
    renta_5ta               NUMERIC(10,2) NOT NULL DEFAULT 0,
    otros_descuentos        NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_descuentos         NUMERIC(10,2) NOT NULL DEFAULT 0,

    -- aportes del empleador (informativo, no se descuenta al trabajador)
    essalud                NUMERIC(10,2) NOT NULL DEFAULT 0,
    sctr                   NUMERIC(10,2) NOT NULL DEFAULT 0,
    senati                 NUMERIC(10,2) NOT NULL DEFAULT 0,

    neto_pagar             NUMERIC(10,2) NOT NULL DEFAULT 0,

    detalle_json            JSONB, -- desglose completo para la boleta / auditoría fina
    calculado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (periodo_id, contrato_id)
);
CREATE INDEX idx_detalle_periodo ON detalle_planilla(periodo_id);

-- -------------------------------------------------------------------------
-- vacaciones_goce: registro de vacaciones YA TOMADAS por un trabajador
-- (solo se usa para Empleados, regimen general). Los "dias ganados" no se
-- guardan aqui - se calculan en el momento a partir de fecha_ingreso del
-- contrato + el record de dias trabajados/dominicales/feriados del tareo
-- de cada periodo (ver routes/vacaciones.ts), para que nunca queden
-- desactualizados si se corrige un tareo antiguo.
-- -------------------------------------------------------------------------
CREATE TABLE vacaciones_goce (
    id             SERIAL PRIMARY KEY,
    contrato_id    INT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    fecha_inicio   DATE NOT NULL,
    fecha_fin      DATE NOT NULL,
    dias           INT NOT NULL,
    observaciones  TEXT,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vacaciones_goce_contrato ON vacaciones_goce(contrato_id);

-- -------------------------------------------------------------------------
-- boletas_vacaciones: boleta de pago de la remuneracion vacacional,
-- SEPARADA de la planilla mensual (decision del usuario: cada goce genera
-- su propio documento, en vez de aparecer como una linea mas en la
-- planilla del mes). Un goce genera exactamente una boleta (1 a 1).
-- -------------------------------------------------------------------------
CREATE TABLE boletas_vacaciones (
    id                        SERIAL PRIMARY KEY,
    goce_id                   INT NOT NULL UNIQUE REFERENCES vacaciones_goce(id) ON DELETE CASCADE,
    contrato_id               INT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    fecha_inicio              DATE NOT NULL,
    fecha_fin                 DATE NOT NULL,
    dias                      INT NOT NULL,
    remuneracion_vacacional   NUMERIC(10,2) NOT NULL,
    aporte_pension            NUMERIC(10,2) NOT NULL,
    essalud                   NUMERIC(10,2) NOT NULL,
    sctr                      NUMERIC(10,2) NOT NULL,
    neto_pagar                NUMERIC(10,2) NOT NULL,
    detalle_json              JSONB NOT NULL DEFAULT '{}',
    generado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_boletas_vacaciones_contrato ON boletas_vacaciones(contrato_id);

-- -------------------------------------------------------------------------
-- conceptos_planilla: catalogo configurable de conceptos de ingreso y su
-- afectacion a aportes/descuentos, siguiendo el modelo de la Tabla 22 de
-- SUNAT (PDT PLAME). Antes esto estaba "quemado" en motorCalculo.ts; ahora
-- el administrador puede editarlo desde la pestana Configuracion sin tocar
-- codigo. factor1/2/3 son los factores/tasas legales de cada formula (ej.
-- 0.15 = 15% para CTS de construccion civil); las FORMULAS en si (que se
-- multiplica por que, cuando aplica cada una segun categoria) siguen fijas
-- en motorCalculo.ts - eso fue una decision explicita del usuario para no
-- arriesgar el calculo legal de la planilla con formulas libres.
--
-- afecto_renta5ta NULL (no true ni false) en GRATIFICACION y
-- BONIFICACION_EXTRAORDINARIA: la Tabla 22 los marca afectos a Renta 5ta,
-- pero calcularRenta5ta (solo aplica a Empleados) ya los incorpora de forma
-- distinta, mediante la proyeccion anual x12+2 gratificaciones - sumarlos
-- tambien aqui duplicaria la retencion. Por eso esos dos conceptos no
-- participan de la suma dinamica de la base de Renta 5ta.
-- -------------------------------------------------------------------------
CREATE TABLE conceptos_planilla (
    id                  SERIAL PRIMARY KEY,
    codigo              VARCHAR(60) NOT NULL UNIQUE,
    nombre              VARCHAR(120) NOT NULL,
    descripcion         TEXT,
    orden               INT NOT NULL DEFAULT 0,

    factor1             NUMERIC(12,6),
    factor1_etiqueta    VARCHAR(120),
    factor2             NUMERIC(12,6),
    factor2_etiqueta    VARCHAR(120),
    factor3             NUMERIC(12,6),
    factor3_etiqueta    VARCHAR(120),

    afecto_essalud      BOOLEAN NOT NULL DEFAULT false,
    afecto_sctr         BOOLEAN NOT NULL DEFAULT false,
    afecto_senati       BOOLEAN NOT NULL DEFAULT false,
    afecto_onp          BOOLEAN NOT NULL DEFAULT false,
    afecto_afp          BOOLEAN NOT NULL DEFAULT false,
    afecto_renta5ta     BOOLEAN,
    afecto_conafovicer  BOOLEAN NOT NULL DEFAULT false,

    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO conceptos_planilla
    (codigo, nombre, descripcion, orden,
     factor1, factor1_etiqueta, factor2, factor2_etiqueta, factor3, factor3_etiqueta,
     afecto_essalud, afecto_sctr, afecto_senati, afecto_onp, afecto_afp, afecto_renta5ta, afecto_conafovicer)
VALUES
    ('SUELDO_BASICO', 'Sueldo / Jornal básico', 'Remuneración base del período: jornal diario x días trabajados, o sueldo mensual prorrateado para Empleados.', 10,
     NULL, NULL, NULL, NULL, NULL, NULL,
     true, true, true, true, true, true, true),

    ('REM_DOMINICAL', 'Remuneración dominical', 'Pago por días de descanso dominical trabajados.', 20,
     NULL, NULL, NULL, NULL, NULL, NULL,
     true, true, true, true, true, true, true),

    ('REM_FERIADO', 'Remuneración feriado', 'Pago por feriados no laborados.', 30,
     NULL, NULL, NULL, NULL, NULL, NULL,
     true, true, true, true, true, true, false),

    ('HORAS_EXTRA_CONSTRUCCION', 'Horas extra (construcción civil)', 'Recargo sobre el valor hora del jornal, según convenio colectivo de construcción civil.', 40,
     1.60, 'Recargo primeras 2 horas (multiplicador del valor hora)', 2.00, 'Recargo horas adicionales (multiplicador)', 2.00, 'Recargo tramo 100% (multiplicador)',
     true, true, false, true, true, true, false),

    ('HORAS_EXTRA_GENERAL', 'Horas extra (régimen general / Empleado)', 'Recargo legal estándar (D.S. 007-2002-TR).', 50,
     1.25, 'Recargo primeras 2 horas (multiplicador del valor hora)', 1.35, 'Recargo horas adicionales (multiplicador)', 2.00, 'Recargo tramo 100% (multiplicador)',
     true, true, false, true, true, true, false),

    ('ASIGNACION_FAMILIAR', 'Asignación familiar', 'Solo Empleados con hijos: porcentaje de la Remuneración Mínima Vital (RMV).', 60,
     0.10, 'Porcentaje de la RMV', NULL, NULL, NULL, NULL,
     true, true, true, true, true, true, false),

    ('ASIGNACION_ESCOLARIDAD', 'Asignación por escolaridad', 'Solo construcción civil con hijos: 30 jornales básicos al año por hijo (RD N°100-72-DPRTESS).', 70,
     12, 'Divisor (jornal ÷ este número = monto diario por hijo)', NULL, NULL, NULL, NULL,
     false, false, false, false, false, true, false),

    ('BUC', 'Bonificación Unificada de Construcción (BUC)', 'Solo construcción civil. La tasa se configura en Parámetros → Tabla salarial mensual, por categoría.', 80,
     NULL, NULL, NULL, NULL, NULL, NULL,
     true, true, true, true, true, true, false),

    ('BAE', 'Bonificación por Alta Especialización (BAE)', 'Solo operarios especializados (EP/EM/TP). La tasa se configura en Parámetros → Tabla salarial mensual.', 90,
     NULL, NULL, NULL, NULL, NULL, NULL,
     true, true, false, true, true, true, false),

    ('MOVILIDAD', 'Bonificación por movilidad', 'Solo construcción civil. El monto fijo por día se configura en Parámetros → Tabla salarial mensual.', 100,
     NULL, NULL, NULL, NULL, NULL, NULL,
     false, false, false, false, false, true, false),

    ('GRATIFICACION', 'Gratificación (Fiestas Patrias / Navidad)', 'Construcción civil: se paga cada período (factor diario). Empleado: pago semestral con fórmula fija (jul/dic), no editable aquí. Su afectación a Renta de 5ta ya está incorporada en la fórmula anual de Empleado, por eso esa columna no aplica para este concepto.', 110,
     40, 'Numerador en jornales básicos (solo construcción civil)', 210, 'Denominador en días (solo construcción civil)', NULL, NULL,
     false, false, false, false, false, NULL, false),

    ('BONIFICACION_EXTRAORDINARIA', 'Bonificación Extraordinaria (Ley 29351/30334)', 'Porcentaje de la gratificación, pagado en efectivo en vez de EsSalud. Su afectación a Renta de 5ta ya está incorporada en la fórmula anual de Empleado, por eso esa columna no aplica para este concepto.', 120,
     0.09, 'Porcentaje de la gratificación', NULL, NULL, NULL, NULL,
     false, false, false, false, false, NULL, false),

    ('CTS', 'Compensación por Tiempo de Servicios (CTS)', 'Construcción civil: se devenga cada período (factor diario). Empleado: depósito semestral con fórmula fija (may/nov), no editable aquí. Totalmente inafecta a aportes y descuentos.', 130,
     0.15, 'Porcentaje del jornal diario (solo construcción civil)', NULL, NULL, NULL, NULL,
     false, false, false, false, false, false, false),

    ('VACACIONES', 'Vacaciones (construcción civil)', 'Solo construcción civil, se devenga cada período. Para Empleado, ver el módulo de récord vacacional en la pestaña Vacaciones.', 140,
     0.10, 'Porcentaje del jornal diario', NULL, NULL, NULL, NULL,
     true, true, false, true, true, true, false);

-- -------------------------------------------------------------------------
-- bitacora_planilla: auditoría de acciones sensibles
-- -------------------------------------------------------------------------
CREATE TABLE bitacora_planilla (
    id              SERIAL PRIMARY KEY,
    usuario_id      INT REFERENCES usuarios(id),
    accion          VARCHAR(50) NOT NULL,   -- CALCULO_PLANILLA | CIERRE_PERIODO | EDICION_EMPLEADO | ...
    tabla_afectada  VARCHAR(50),
    registro_id     INT,
    detalle         JSONB,
    fecha           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------
-- Parámetros anuales 2026. remuneracion_minima_vital = S/1,130 (RMV vigente).
-- La asignacion familiar YA NO se lee de la columna asignacion_familiar -
-- se calcula siempre como 10% de la RMV (ver calcularAsignacionFamiliar en
-- motorCalculo.ts); la columna se deja solo por compatibilidad. Verifica
-- que la RMV siga vigente antes de usar el sistema en un anio nuevo.
-- -------------------------------------------------------------------------
INSERT INTO parametros_normativos (
    anio, uit, remuneracion_minima_vital, tasa_essalud, tasa_onp, tasa_senati,
    tasa_conafovicer, tasa_sctr_salud, asignacion_familiar, seguro_vida_ley
) VALUES (
    2026, 5500, 1130.00, 0.09, 0.13, 0.0045, 0.02, 0.0155, 113.00, 5.00
);

-- -------------------------------------------------------------------------
-- Tasas AFP y tabla salarial de FEBRERO 2026 - valores reales tomados de la
-- hoja "AFPS-SALARIOS" del Excel original ("TABLAS SALARIALES CONSTRUCCION
-- CIVIL 02-2026"). Solo cubre ese mes; agrega los meses siguientes desde la
-- pestaña "Parametros" cuando SBS/el sector publique valores nuevos.
-- -------------------------------------------------------------------------
INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio) VALUES
    (2026, 2, 'INTEGRA',   0.0155, 0.0137, 0.10),
    (2026, 2, 'PRIMA',     0.0160, 0.0137, 0.10),
    (2026, 2, 'PROFUTURO', 0.0169, 0.0137, 0.10),
    (2026, 2, 'HABITAT',   0.0147, 0.0137, 0.10);

-- NOTA: OPERARIO_EP/EM/TP comparten el jornal básico de OPERARIO (así está
-- en AFPS-SALARIOS: L12/L13/L14 = "=+L7"). Cada una tiene además un
-- porcentaje "BAE" propio (EP=10%, EM=8%, TP=9%) que el motor de cálculo
-- TODAVÍA NO aplica - falta agregarlo como un concepto adicional en
-- motorCalculo.ts.
INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria) VALUES
    (2026, 2, 'OPERARIO',    89.30, 0.32, 0,    8.60, 17.01),
    (2026, 2, 'OFICIAL',     69.75, 0.30, 0,    8.60, 13.29),
    (2026, 2, 'PEON',        62.80, 0.30, 0,    8.60, 11.96),
    (2026, 2, 'OPERARIO_EP', 89.30, 0.32, 0.10, 8.60, 17.01),
    (2026, 2, 'OPERARIO_EM', 89.30, 0.32, 0.08, 8.60, 17.01),
    (2026, 2, 'OPERARIO_TP', 89.30, 0.32, 0.09, 8.60, 17.01),
    (2026, 2, 'PEON_A',      47.61, 0,    0,    0,    0),
    (2026, 2, 'R_GENERAL',   37.67, 0,    0,    0,    0);

-- -------------------------------------------------------------------------
-- Roles del sistema y catalogo de permisos (ver migracion_014 para el
-- detalle de cada permiso). RESPONSABLE_PLANILLA y TAREADOR quedan con el
-- mismo acceso que tenian antes de que existiera esta tabla.
-- -------------------------------------------------------------------------
INSERT INTO roles (codigo, nombre, descripcion, protegido) VALUES
    ('ADMIN', 'Administrador', 'Acceso total al sistema. No se puede editar ni eliminar.', true),
    ('RESPONSABLE_PLANILLA', 'Encargado de planilla', 'Gestiona trabajadores, tareo, calculo y boletas de sus proyectos asignados.', false),
    ('TAREADOR', 'Tareador', 'Solo carga el tareo (asistencia) de sus proyectos asignados.', false);

INSERT INTO permisos_catalogo (codigo, nombre, grupo, orden) VALUES
    ('empleados.gestionar',     'Crear y editar trabajadores',                                'Trabajadores',   10),
    ('contratos.gestionar',     'Crear, editar y dar de cese a contratos',                    'Trabajadores',   20),
    ('importacion.masiva',      'Importar trabajadores de forma masiva',                      'Trabajadores',   30),
    ('periodos.gestionar',      'Crear y eliminar periodos de planilla',                      'Planillas',      40),
    ('planilla.calcular',       'Calcular la planilla de un periodo',                         'Planillas',      50),
    ('boletas.ver',             'Ver las boletas ya calculadas',                              'Planillas',      60),
    ('boletas.enviar',          'Enviar boletas por correo',                                  'Planillas',      65),
    ('reportes.ver',            'Ver y descargar el resumen de planilla (Excel)',             'Planillas',      70),
    ('exportaciones.descargar', 'Descargar archivos REM / AFPnet',                            'Planillas',      80),
    ('vacaciones.gestionar',    'Registrar goces de vacaciones y generar boletas',            'Vacaciones',     90),
    ('parametros.editar',       'Editar tasas legales, AFP y tabla salarial',                 'Parametros',    100),
    ('conceptos.editar',        'Configurar a que aportes/descuentos esta afecto cada concepto', 'Configuracion', 110),
    ('proyectos.gestionar',     'Crear y editar proyectos/obras',                             'Proyectos',     120),
    ('empresa.editar',          'Editar los datos de la empresa',                             'Empresa',       130),
    ('bitacora.ver',            'Ver el historial de cambios del sistema',                    'Bitacora',      140);

INSERT INTO rol_permiso (rol_codigo, permiso_codigo)
SELECT 'RESPONSABLE_PLANILLA', codigo FROM permisos_catalogo
WHERE codigo IN (
    'empleados.gestionar', 'contratos.gestionar', 'periodos.gestionar',
    'planilla.calcular', 'boletas.ver', 'boletas.enviar', 'reportes.ver',
    'exportaciones.descargar', 'vacaciones.gestionar'
);

-- -------------------------------------------------------------------------
-- Usuario administrador inicial. Contraseña temporal: Cambiar123!
-- IMPORTANTE: entra con este usuario y cambia la contraseña de inmediato
-- desde la pestaña Usuarios.
-- -------------------------------------------------------------------------
INSERT INTO usuarios (nombre, correo, password_hash, rol) VALUES
    ('Administrador', 'admin@jhcr.pe', '$2b$10$8Lxwd51pi2/sDoPsybebsewOTlQ615wedQrrQkPA80EFMdlUr4uiK', 'ADMIN');

-- -------------------------------------------------------------------------
-- Fila inicial de datos_empresa (vacia, se completa desde la pestaña Empresa)
-- -------------------------------------------------------------------------
INSERT INTO datos_empresa (ruc, razon_social) VALUES ('', '');

-- =========================================================================
-- Datos de los catalogos SUNAT (Anexo 2, ver migracion_016 para el detalle
-- y docs/anexo2_tablas_parametricas_sunat.xlsx como fuente).
-- =========================================================================

-- catalogo_tipo_documento (fuente: T3- Tipo Documento)
INSERT INTO catalogo_tipo_documento (codigo, nombre) VALUES ('01', 'DOCUMENTO NACIONAL DE IDENTIDAD') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_documento (codigo, nombre) VALUES ('04', 'CARNÉ DE EXTRANJERÍA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_documento (codigo, nombre) VALUES ('06', 'REG. ÚNICO DE CONTRIBUYENTES (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_documento (codigo, nombre) VALUES ('07', 'PASAPORTE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_documento (codigo, nombre) VALUES ('09', 'CARNÉ DE SOLICIT DE REFUGIO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_documento (codigo, nombre) VALUES ('11', 'PARTIDA DE NACIMIENTO (2)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_documento (codigo, nombre) VALUES ('22', 'CARNÉ DE IDENTIDAD - RELACIONES EXTERIORES') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_documento (codigo, nombre) VALUES ('23', 'PERM.TEMP.PERMANENCIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_documento (codigo, nombre) VALUES ('24', 'DOC. DE IDENTIDAD EXTRANJERO (3)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_documento (codigo, nombre) VALUES ('26', 'CARNÉ DE PERMISO TEMP DE PERMANENCIA') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_nacionalidad (fuente: T4 Nacionalidad)
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9001', 'BOUVET ISLAND') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9002', 'COTE D IVOIRE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9003', 'FALKLAND ISLANDS (MALVINAS)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9004', 'FRANCE, METROPOLITAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9005', 'FRENCH SOUTHERN TERRITORIES') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9006', 'HEARD AND MC DONALD ISLANDS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9007', 'MAYOTTE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9008', 'SOUTH GEORGIA AND THE SOUTH SANDWICH ISLANDS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9009', 'SVALBARD AND JAN MAYEN ISLANDS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9010', 'UNITED STATES MINOR OUTLYING ISLANDS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9011', 'OTROS PAISES O LUGARES') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9013', 'AFGANISTAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9017', 'ALBANIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9019', 'ALDERNEY') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9023', 'ALEMANIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9026', 'ARMENIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9027', 'ARUBA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9028', 'ASCENCION') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9029', 'BOSNIA-HERZEGOVINA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9031', 'BURKINA FASO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9037', 'ANDORRA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9040', 'ANGOLA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9041', 'ANGUILLA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9043', 'ANTIGUA Y BARBUDA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9047', 'ANTILLAS HOLANDESAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9053', 'ARABIA SAUDITA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9059', 'ARGELIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9063', 'ARGENTINA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9069', 'AUSTRALIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9072', 'AUSTRIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9074', 'AZERBAIJÁN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9077', 'BAHAMAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9080', 'BAHREIN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9081', 'BANGLA DESH') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9083', 'BARBADOS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9087', 'BÉLGICA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9088', 'BELICE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9090', 'BERMUDAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9091', 'BELARUS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9093', 'MYANMAR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9097', 'BOLIVIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9101', 'BOTSWANA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9105', 'BRASIL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9108', 'BRUNEI DARUSSALAM') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9111', 'BULGARIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9115', 'BURUNDI') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9119', 'BUTÁN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9127', 'CABO VERDE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9137', 'CAIMÁN, ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9141', 'CAMBOYA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9145', 'CAMERÚN, REPUBLICA UNIDA DEL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9147', 'CAMPIONE D TALIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9149', 'CANADÁ') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9155', 'CANAL (NORMANDAS), ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9157', 'CANTÓN Y ENDERBURRY') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9159', 'SANTA SEDE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9165', 'COCOS (KEELING),ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9169', 'COLOMBIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9173', 'COMORAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9177', 'CONGO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9183', 'COOK, ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9187', 'COREA (NORTE), REPUBLICA POPULAR DEMOCRATICA DE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9190', 'COREA (SUR), REPUBLICA DE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9193', 'COSTA DE MARFIL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9196', 'COSTA RICA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9198', 'CROACIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9199', 'CUBA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9203', 'CHAD') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9207', 'CHECOSLOVAQUIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9211', 'CHILE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9215', 'CHINA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9218', 'TAIWAN (FORMOSA)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9221', 'CHIPRE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9229', 'BENIN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9232', 'DINAMARCA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9235', 'DOMINICA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9239', 'ECUADOR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9240', 'EGIPTO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9242', 'EL SALVADOR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9243', 'ERITREA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9244', 'EMIRATOS ARABES UNIDOS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9245', 'ESPAÑA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9246', 'ESLOVAQUIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9247', 'ESLOVENIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9249', 'ESTADOS UNIDOS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9251', 'ESTONIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9253', 'ETIOPIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9259', 'FEROE, ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9267', 'FILIPINAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9271', 'FINLANDIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9275', 'FRANCIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9281', 'GABON') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9285', 'GAMBIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9286', 'GAZA Y JERICO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9287', 'GEORGIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9289', 'GHANA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9293', 'GIBRALTAR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9297', 'GRANADA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9301', 'GRECIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9305', 'GROENLANDIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9309', 'GUADALUPE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9313', 'GUAM') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9317', 'GUATEMALA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9325', 'GUAYANA FRANCESA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9327', 'GUERNSEY') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9329', 'GUINEA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9331', 'GUINEA ECUATORIAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9334', 'GUINEA-BISSAU') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9337', 'GUYANA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9341', 'HAITI') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9345', 'HONDURAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9348', 'HONDURAS BRITANICAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9351', 'HONG KONG') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9355', 'HUNGRIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9361', 'INDIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9365', 'INDONESIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9369', 'IRAK') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9372', 'IRAN, REPUBLICA ISLAMICA DEL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9375', 'IRLANDA (EIRE)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9377', 'ISLA AZORES') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9378', 'ISLA DEL MAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9379', 'ISLANDIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9380', 'ISLAS CANARIAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9381', 'ISLAS DE CHRISTMAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9382', 'ISLAS QESHM') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9383', 'ISRAEL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9386', 'ITALIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9391', 'JAMAICA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9395', 'JONSTON, ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9399', 'JAPON') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9401', 'JERSEY') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9403', 'JORDANIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9406', 'KAZAJSTAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9410', 'KENIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9411', 'KIRIBATI') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9412', 'KIRGUIZISTAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9413', 'KUWAIT') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9418', 'LABUN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9420', 'LAOS, REPUBLICA POPULAR DEMOCRATICA DE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9426', 'LESOTHO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9429', 'LETONIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9431', 'LIBANO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9434', 'LIBERIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9438', 'LIBIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9440', 'LIECHTENSTEIN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9443', 'LITUANIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9445', 'LUXEMBURGO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9447', 'MACAO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9448', 'MACEDONIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9450', 'MADAGASCAR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9453', 'MADEIRA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9455', 'MALAYSIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9458', 'MALAWI') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9461', 'MALDIVAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9464', 'MALI') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9467', 'MALTA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9469', 'MARIANAS DEL NORTE, ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9472', 'MARSHALL, ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9474', 'MARRUECOS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9477', 'MARTINICA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9485', 'MAURICIO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9488', 'MAURITANIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9493', 'MEXICO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9494', 'MICRONESIA, ESTADOS FEDERADOS DE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9495', 'MIDWAY ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9496', 'MOLDAVIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9497', 'MONGOLIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9498', 'MONACO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9501', 'MONTSERRAT, ISLA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9505', 'MOZAMBIQUE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9507', 'NAMIBIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9508', 'NAURU') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9511', 'NAVIDAD (CHRISTMAS), ISLA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9517', 'NEPAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9521', 'NICARAGUA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9525', 'NIGER') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9528', 'NIGERIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9531', 'NIUE, ISLA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9535', 'NORFOLK, ISLA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9538', 'NORUEGA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9542', 'NUEVA CALEDONIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9545', 'PAPUASIA NUEVA GUINEA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9548', 'NUEVA ZELANDA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9551', 'VANUATU') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9556', 'OMAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9566', 'PACIFICO, ISLAS DEL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9573', 'PAISES BAJOS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9576', 'PAKISTAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9578', 'PALAU, ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9579', 'TERRITORIO AUTONOMO DE PALESTINA.') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9580', 'PANAMA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9586', 'PARAGUAY') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9589', 'PERÚ') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9593', 'PITCAIRN, ISLA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9599', 'POLINESIA FRANCESA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9603', 'POLONIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9607', 'PORTUGAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9611', 'PUERTO RICO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9618', 'QATAR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9628', 'REINO UNIDO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9629', 'ESCOCIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9633', 'REPUBLICA ARABE UNIDA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9640', 'REPUBLICA CENTROAFRICANA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9644', 'REPUBLICA CHECA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9645', 'REPUBLICA DE SWAZILANDIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9646', 'REPUBLICA DE TUNEZ') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9647', 'REPUBLICA DOMINICANA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9660', 'REUNION') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9665', 'ZIMBABWE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9670', 'RUMANIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9675', 'RUANDA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9676', 'RUSIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9677', 'SALOMON, ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9685', 'SAHARA OCCIDENTAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9687', 'SAMOA OCCIDENTAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9690', 'SAMOA NORTEAMERICANA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9695', 'SAN CRISTOBAL Y NIEVES') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9697', 'SAN MARINO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9700', 'SAN PEDRO Y MIQUELON') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9705', 'SAN VICENTE Y LAS GRANADINAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9710', 'SANTA ELENA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9715', 'SANTA LUCIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9720', 'SANTO TOME Y PRINCIPE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9728', 'SENEGAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9731', 'SEYCHELLES') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9735', 'SIERRA LEONA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9741', 'SINGAPUR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9744', 'SIRIA, REPUBLICA ARABE DE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9748', 'SOMALIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9750', 'SRI LANKA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9756', 'SUDAFRICA, REPUBLICA DE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9759', 'SUDAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9764', 'SUECIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9767', 'SUIZA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9770', 'SURINAM') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9773', 'SAWSILANDIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9774', 'TADJIKISTAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9776', 'TAILANDIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9780', 'TANZANIA, REPUBLICA UNIDA DE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9783', 'DJIBOUTI') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9786', 'TERRITORIO ANTARTICO BRITANICO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9787', 'TERRITORIO BRITANICO DEL OCEANO INDICO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9788', 'TIMOR DEL ESTE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9800', 'TOGO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9805', 'TOKELAU') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9810', 'TONGA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9815', 'TRINIDAD Y TOBAGO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9816', 'TRISTAN DA CUNHA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9820', 'TUNICIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9823', 'TURCAS Y CAICOS, ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9825', 'TURKMENISTAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9827', 'TURQUIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9828', 'TUVALU') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9830', 'UCRANIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9833', 'UGANDA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9840', 'URSS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9845', 'URUGUAY') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9847', 'UZBEKISTAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9850', 'VENEZUELA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9855', 'VIET NAM') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9858', 'VIETNAM (DEL NORTE)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9863', 'VIRGENES, ISLAS (BRITANICAS)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9866', 'VIRGENES, ISLAS (NORTEAMERICANAS)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9870', 'FIJI') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9873', 'WAKE, ISLA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9875', 'WALLIS Y FORTUNA, ISLAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9880', 'YEMEN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9885', 'YUGOSLAVIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9888', 'ZAIRE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9890', 'ZAMBIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9895', 'ZONA DEL CANAL DE PANAMA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9896', 'ZONA LIBRE OSTRAVA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_nacionalidad (codigo, nombre) VALUES ('9897', 'ZONA NEUTRAL (PALESTINA)') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_tipo_trabajador (fuente: T8 Tipo Trab-Pens-PS)
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('19', 'EJECUTIVO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('20', 'OBRERO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('21', 'EMPLEADO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('22', 'TRABAJADOR PORTUARIO - LEY 27866') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('23', 'PRACTICANTE SENATI - DEC. LEY 20151') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('24', 'PENSIONISTA O CESANTE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('26', 'PENSIONISTA - LEY 28320') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('27', 'CONSTRUCCIÓN CIVIL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('28', 'PILOTO Y COPILOTO DE AVIACIÓN COMERCIAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('29', 'MARÍTIMO, FLUVIAL O LACUSTRE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('30', 'PERIODISTA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('31', 'TRABAJADOR DE LA INDUSTRIA DE CUERO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('32', 'MINERO DE MINA DE SOCAVÓN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('36', 'TRABAJADOR PESQUERO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('37', 'MINERO DE TAJO ABIERTO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('38', 'MINERO DE INDUSTRIA MINERA METALÚRGICA Y/O SIDERÚRGICA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('39', 'TRABAJADOR PESQUERO – LEY 30003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('48', 'AGROINDUSTRIAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('56', 'ARTISTA -  LEY 28131') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('64', 'AGRARIO DEPENDIENTE - LEY 27360') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('65', 'TRABAJADOR ACTIVIDAD ACUÍCOLA - LEY 27460') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('66', 'PESCADOR Y PROCESADOR ARTESANAL INDEPENDIENTE  - LEY 27177') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('71', 'CONDUCTOR DE MICROEMPRESA REMYPE - D.LEG.1086') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('73', 'SOCIO DE COOPERATIVA AGRARIA – LEY N.° 29972') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('76', 'AGRARIO LEY N° 31110') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_trabajador (codigo, nombre) VALUES ('98', 'PERSONA QUE GENERA INGRESOS DE CUARTA - QUINTA CATEGORÍA') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_grado_instruccion (fuente: T9 Situación Educativa)
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('01', 'SIN EDUCACIÓN FORMAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('02', 'EDUCACIÓN ESPECIAL INCOMPLETA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('03', 'EDUCACIÓN ESPECIAL COMPLETA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('04', 'EDUCACIÓN PRIMARIA INCOMPLETA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('05', 'EDUCACIÓN PRIMARIA COMPLETA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('06', 'EDUCACIÓN SECUNDARIA INCOMPLETA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('07', 'EDUCACIÓN SECUNDARIA COMPLETA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('08', 'EDUCACIÓN TÉCNICA INCOMPLETA (2)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('09', 'EDUCACIÓN TÉCNICA COMPLETA (2)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('10', 'EDUCACIÓN SUPERIOR (INSTITUTO SUPERIOR, ETC) INCOMPLETA (3)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('11', 'EDUCACIÓN SUPERIOR (INSTITUTO SUPERIOR, ETC) COMPLETA  (3)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('12', 'EDUCACIÓN UNIVERSITARIA INCOMPLETA  (4)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('13', 'EDUCACIÓN UNIVERSITARIA COMPLETA (4)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('14', 'GRADO DE BACHILLER') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('15', 'TITULADO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('16', 'ESTUDIOS DE MAESTRÍA INCOMPLETA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('17', 'ESTUDIOS DE MAESTRÍA COMPLETA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('18', 'GRADO DE MAESTRÍA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('19', 'ESTUDIOS DE DOCTORADO INCOMPLETO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('20', 'ESTUDIOS DE DOCTORADO COMPLETO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_grado_instruccion (codigo, nombre) VALUES ('21', 'GRADO DE DOCTOR') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_regimen_pensionario (fuente: T11 Reg. Pensionario)
INSERT INTO catalogo_regimen_pensionario (codigo, nombre) VALUES ('02', 'DECRETO LEY 19990 - SISTEMA NACIONAL DE PENSIONES - ONP') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_pensionario (codigo, nombre) VALUES ('09', 'CAJA DE BENEFICIOS DE SEGURIDAD SOCIAL DEL PESCADOR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_pensionario (codigo, nombre) VALUES ('12', 'OTROS REGIMENES PENSIONARIOS (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_pensionario (codigo, nombre) VALUES ('14', 'LEY 29903 - SISTEMA NACIONAL DE PENSIONES -INDEPENDIENTES') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_pensionario (codigo, nombre) VALUES ('15', 'LEY 30003 - RÉGIMEN ESPECIAL DE PENSIONES -PESQUEROS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_pensionario (codigo, nombre) VALUES ('21', 'SPP INTEGRA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_pensionario (codigo, nombre) VALUES ('22', 'SPP HORIZONTE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_pensionario (codigo, nombre) VALUES ('23', 'SPP PROFUTURO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_pensionario (codigo, nombre) VALUES ('24', 'SPP PRIMA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_pensionario (codigo, nombre) VALUES ('25', 'SPP HABITAT') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_pensionario (codigo, nombre) VALUES ('99', 'SIN REGIMEN PENSIONARIO/NO APLICA') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_tipo_contrato (fuente: T12 Contratos)
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('01', 'A PLAZO INDETERMINADO - D.LEG. 728') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('02', 'A TIEMPO PARCIAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('03', 'POR INICIO O INCREMENTO DE ACTIVIDAD') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('04', 'POR NECESIDADES DEL MERCADO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('05', 'POR RECONVERSIÓN EMPRESARIAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('06', 'OCASIONAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('07', 'DE SUPLENCIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('08', 'DE EMERGENCIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('09', 'PARA OBRA DETERMINADA O SERVICIO ESPECÍFICO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('10', 'INTERMITENTE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('11', 'DE TEMPORADA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('12', 'DE EXPORTACIÓN NO TRADICIONAL D.LEY 22342') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('13', 'DE EXTRANJERO - D.LEG.689') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('14', 'ADMINISTRATIVO DE SERVICIOS - D.LEG 1057 (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('15', 'NOMBRADO - D.LEG. N.° 276 (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('16', 'SERVICIOS PERSONALES  - APLICABLES A LOS REGÍM. DE CARRERA (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('17', 'GERENTE PÚBLICO - D.LEG. 1024 (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('18', 'A DOMICILIO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('19', 'FUTBOLISTAS PROFESIONALES') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('20', 'AGRARIO - LEY 27360') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('21', 'MIGRANTE ANDINO DECISIÓN 545') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('22', 'A PLAZO INDETERMINADO - LEY 30057') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('23', 'A PLAZO FIJO - LEY 30057') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('24', 'NOMBRADO - CARRERAS ESPECIALES DEL SECTOR PÚBLICO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('25', 'CONTRATADO - CARRERAS ESPECIALES DEL SECTOR PÚBLICO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_contrato (codigo, nombre) VALUES ('99', 'OTROS NO PREVISTOS') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_periodicidad (fuente: T13 Periodicidad)
INSERT INTO catalogo_periodicidad (codigo, nombre) VALUES ('1', 'MENSUAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_periodicidad (codigo, nombre) VALUES ('2', 'QUINCENAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_periodicidad (codigo, nombre) VALUES ('3', 'SEMANAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_periodicidad (codigo, nombre) VALUES ('4', 'DIARIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_periodicidad (codigo, nombre) VALUES ('5', 'OTROS') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_eps (fuente: T14 EPSSERV PROPIOS)
INSERT INTO catalogo_eps (codigo, nombre) VALUES ('20514372251', 'PERSALUD S.A. EPS (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_eps (codigo, nombre) VALUES ('20431115825', 'PACÍFICO S.A. EPS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_eps (codigo, nombre) VALUES ('20414955020', 'RÍMAC INTERNACIONAL S.A. EPS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_eps (codigo, nombre) VALUES ('0', 'SERVICIOS PROPIOS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_eps (codigo, nombre) VALUES ('20517182673', 'MAPFRE PERU S.A. EPS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_eps (codigo, nombre) VALUES ('20523470761', 'SANITAS PERU S.A. - EPS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_eps (codigo, nombre) VALUES ('20601978572', 'EPS, LA POSITIVA S.A. ENTIDAD PRESTADORA DE SALUD') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_tipo_pago (fuente: T16 Tipo de Pago)
INSERT INTO catalogo_tipo_pago (codigo, nombre) VALUES ('1', 'EFECTIVO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_pago (codigo, nombre) VALUES ('2', 'DEPÓSITO EN CUENTA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_tipo_pago (codigo, nombre) VALUES ('3', 'OTROS') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_motivo_baja (fuente: T17 Motivo fin del periodo)
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('01', 'RENUNCIA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('02', 'RENUNCIA CON INCENTIVOS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('03', 'DESPIDO O DESTITUCIÓN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('04', 'CESE COLECTIVO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('05', 'JUBILACIÓN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('06', 'INVALIDEZ ABSOLUTA PERMANENTE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('07', 'TERMINACIÓN DE LA OBRA O SERVICIO, CUMPLIMIENTO CONDICIÓN RESOLUTORIA O VENCIMIENTO DEL PLAZO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('08', 'MUTUO DISENSO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('09', 'FALLECIMIENTO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('10', 'SUSPENSIÓN DE LA PENSIÓN (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('11', 'REASIGNACIÓN SERVIDOR DE LA ADMINISTRACIÓN PÚBLICA(2)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('12', 'PERMUTA SERVIDOR DE LA ADMINISTRACIÓN PÚBLICA (2)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('13', 'TRANSFERENCIA SERVIDOR DE LA ADMINISTRACIÓN PÚBLICA (2)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('14', 'BAJA POR SUCESIÓN EN POSICIÓN DEL EMPLEADOR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('15', 'EXTINCIÓN O LIQUIDACIÓN DEL EMPLEADOR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('16', 'OTROS MOTIVOS DE CADUCIDAD DE LA PENSIÓN (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('17', 'NO SE INICIÓ LA RELACIÓN LABORAL O PRESTACIÓN EFECTIVA DE SERVICIOS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('18', 'LÍMITE DE EDAD 70 AÑOS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('19', 'OTRAS CAUSALES RÉGIMEN PÚBLICO GENERAL SERVICIO CIVIL - LEY 30057') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('20', 'INHABILITACIÓN PARA EL EJERCICIO PROFESIONAL O DE LA FUNCIÓN PÚBLICA POR MÁS DE TRES MESES - LEY 30057') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_motivo_baja (codigo, nombre) VALUES ('99', 'SIN VÍNCULO LABORAL - HABILITADO PARA PDT PLAME') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_categoria_ocupacional_sunat (fuente: T24 Categoria Ocupacional)
INSERT INTO catalogo_categoria_ocupacional_sunat (codigo, nombre) VALUES ('01', 'EJECUTIVO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_categoria_ocupacional_sunat (codigo, nombre) VALUES ('02', 'OBRERO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_categoria_ocupacional_sunat (codigo, nombre) VALUES ('03', 'EMPLEADO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_categoria_ocupacional_sunat (codigo, nombre) VALUES ('11', 'FUNCIONARIO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_categoria_ocupacional_sunat (codigo, nombre) VALUES ('12', 'PROFESIONAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_categoria_ocupacional_sunat (codigo, nombre) VALUES ('13', 'TÉCNICO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_categoria_ocupacional_sunat (codigo, nombre) VALUES ('14', 'AUXILIAR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_categoria_ocupacional_sunat (codigo, nombre) VALUES ('21', 'FUNCIONARIO PÚBLICO - LEY 30057') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_categoria_ocupacional_sunat (codigo, nombre) VALUES ('22', 'DIRECTIVO PÚBLICO - LEY 30057') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_categoria_ocupacional_sunat (codigo, nombre) VALUES ('23', 'SERVIDOR CIVIL DE CARRERA - LEY 30057') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_categoria_ocupacional_sunat (codigo, nombre) VALUES ('24', 'SERVIDOR DE ACTIVIDADES COMPLEMENTARIAS - LEY 30057') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_regimen_salud (fuente: T32 Rég Aseg Salud)
INSERT INTO catalogo_regimen_salud (codigo, nombre) VALUES ('00', 'ESSALUD REGULAR (Exclusivamente)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_salud (codigo, nombre) VALUES ('01', 'ESSALUD REGULAR Y EPS/SERV. PROPIOS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_salud (codigo, nombre) VALUES ('02', 'ESSALUD TRABAJADORES PESQUEROS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_salud (codigo, nombre) VALUES ('03', 'ESSALUD TRABAJADORES PESQUEROS Y EPS(SERV.PROPIOS)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_salud (codigo, nombre) VALUES ('04', 'ESSALUD AGRARIO/ACUÍCOLA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_salud (codigo, nombre) VALUES ('05', 'ESSALUD PENSIONISTAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_salud (codigo, nombre) VALUES ('20', 'SANIDAD DE FFAA Y POLICIALES (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_salud (codigo, nombre) VALUES ('21', 'SIS – MICROEMPRESA(2)') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_regimen_laboral (fuente: T33 Régimen Laboral)
INSERT INTO catalogo_regimen_laboral (codigo, nombre) VALUES ('01', 'PRIVADO GENERAL -DECRETO LEGISLATIVO N.° 728') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_laboral (codigo, nombre) VALUES ('16', 'MICROEMPRESA D. LEG. 1086 (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_laboral (codigo, nombre) VALUES ('17', 'PEQUEÑA EMPRESA D. LEG. 1086 (1)') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_laboral (codigo, nombre) VALUES ('18', 'AGRARIO LEY 27360') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_laboral (codigo, nombre) VALUES ('19', 'EXPORTACION NO TRADICIONAL D. LEY 22342') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_laboral (codigo, nombre) VALUES ('20', 'MINEROS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_laboral (codigo, nombre) VALUES ('21', 'CONSTRUCCION CIVIL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_laboral (codigo, nombre) VALUES ('26', 'RÉGIMEN LABORAL AGRARIO LEY N° 31110') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_regimen_laboral (codigo, nombre) VALUES ('99', 'OTROS NO PREVISTOS') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_situacion_especial (fuente: T35 Situacion especial)
INSERT INTO catalogo_situacion_especial (codigo, nombre) VALUES ('0', 'NINGUNA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_situacion_especial (codigo, nombre) VALUES ('1', 'TRABAJADOR DE DIRECCIÓN – PRESENCIAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_situacion_especial (codigo, nombre) VALUES ('2', 'TRABAJADOR DE CONFIANZA - PRESENCIAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_situacion_especial (codigo, nombre) VALUES ('3', 'TRABAJADOR DE DIRECCIÓN - TELETRABAJO MIXTO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_situacion_especial (codigo, nombre) VALUES ('4', 'TRABAJADOR DE CONFIANZA - TELETRABAJO MIXTO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_situacion_especial (codigo, nombre) VALUES ('5', 'TRABAJADOR DE DIRECCIÓN - TELETRABAJO COMPLETO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_situacion_especial (codigo, nombre) VALUES ('6', 'TRABAJADOR DE CONFIANZA - TELETRABAJO COMPLETO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_situacion_especial (codigo, nombre) VALUES ('7', 'TELETRABAJO MIXTO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_situacion_especial (codigo, nombre) VALUES ('8', 'TELETRABAJO COMPLETO') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_banco (fuente: T36 Entidad Bancaria)
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('002', 'BANCO DE CRÉDITO DEL PERÚ') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('003', 'INTERBANK') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('007', 'CITIBANK DEL PERÚ') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('009', 'SCOTIABANK PERÚ') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('011', 'BBVA BANCO CONTINENTAL') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('018', 'BANCO DE LA NACIÓN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('020', 'BANCO FALABELLA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('023', 'BANCO DE COMERCIO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('035', 'BANCO PICHINCHA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('038', 'BANCO INTERAMERICANO DE FINANZAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('043', 'CREDISCOTIA FINANCIERA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('053', 'BANCO GNB') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('056', 'SANTANDER') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('057', 'BANCO AZTECA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('058', 'BANCO CENCOSUD') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('059', 'BANCO RIPLEY') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('060', 'ICBC PERÚ BANK') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('070', 'MIBANCO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('200', 'FINANC. CREDINKA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('202', 'FINANC. PROEMPRESA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('204', 'FINANC. CONFIANZA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('206', 'CREDIRAIZ') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('208', 'COMPARTAMOS FINANCIERA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('210', 'FINANCIERA QAPAQ') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('212', 'FINANCIERA TFC S A') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('214', 'FINANCIERA EFECTIVA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('216', 'AMERIKA FINANCIERA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('218', 'FINANCIERA OH!') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('800', 'CAJA METROPOLITANA DE LIMA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('802', 'CMAC TRUJILLO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('803', 'CMAC AREQUIPA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('805', 'CMAC SULLANA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('806', 'CMAC CUSCO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('808', 'CMAC HUANCAYO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('813', 'CMAC TACNA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('820', 'CMAC DEL SANTA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('822', 'CMAC ICA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('824', 'CMAC PIURA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('826', 'CMAC MAYNAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('828', 'CMAC PAITA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('900', 'CRAC SIPAN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('902', 'CRAC DEL CENTRO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('904', 'CRAC INCASUR') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('906', 'CRAC PRYMERA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_banco (codigo, nombre) VALUES ('908', 'CRAC LOS ANDES') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_ubigeo_departamento (fuente: T28 UBIGEO, columnas A-B)
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('01', 'AMAZONAS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('02', 'ÁNCASH') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('03', 'APURÍMAC') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('04', 'AREQUIPA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('05', 'AYACUCHO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('06', 'CAJAMARCA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('07', 'CUSCO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('08', 'HUANCAVELICA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('09', 'HUÁNUCO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('10', 'ICA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('11', 'JUNÍN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('12', 'LA LIBERTAD') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('13', 'LAMBAYEQUE') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('14', 'LIMA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('15', 'LORETO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('16', 'MADRE DE DIOS') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('17', 'MOQUEGUA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('18', 'PASCO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('19', 'PIURA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('20', 'PUNO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('21', 'SAN MARTÍN') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('22', 'TACNA') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('23', 'TUMBES') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('24', 'CALLAO') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_departamento (codigo, nombre) VALUES ('25', 'UCAYALI') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_ubigeo_provincia (fuente: T28 UBIGEO, columnas C-D)
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0101', 'CHACHAPOYAS', '01') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0102', 'BAGUA', '01') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0103', 'BONGARÁ', '01') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0104', 'LUYA', '01') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0105', 'RODRÍGUEZ DE MENDOZA', '01') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0106', 'CONDORCANQUI', '01') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0107', 'UTCUBAMBA', '01') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0201', 'HUARAZ', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0202', 'AIJA', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0203', 'BOLOGNESI', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0204', 'CARHUAZ', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0205', 'CASMA', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0206', 'CORONGO', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0207', 'HUAYLAS', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0208', 'HUARI', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0209', 'MARISCAL LUZURIAGA', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0210', 'PALLASCA', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0211', 'POMABAMBA', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0212', 'RECUAY', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0213', 'SANTA', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0214', 'SIHUAS', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0215', 'YUNGAY', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0216', 'ANTONIO RAYMONDI', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0217', 'CARLOS FERMÍN FITZCARRALD', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0218', 'ASUNCIÓN', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0219', 'HUARMEY', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0220', 'OCROS', '02') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0301', 'ABANCAY', '03') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0302', 'AYMARAES', '03') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0303', 'ANDAHUAYLAS', '03') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0304', 'ANTABAMBA', '03') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0305', 'COTABAMBAS', '03') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0306', 'GRAU', '03') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0307', 'CHINCHEROS', '03') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0401', 'AREQUIPA', '04') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0402', 'CAYLLOMA', '04') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0403', 'CAMANÁ', '04') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0404', 'CARAVELÍ', '04') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0405', 'CASTILLA', '04') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0406', 'CONDESUYOS', '04') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0407', 'ISLAY', '04') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0408', 'LA UNIÓN', '04') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0501', 'HUAMANGA', '05') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0502', 'CANGALLO', '05') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0503', 'HUANTA', '05') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0504', 'LA MAR', '05') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0505', 'LUCANAS', '05') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0506', 'PARINACOCHAS', '05') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0507', 'VÍCTOR FAJARDO', '05') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0508', 'HUANCA SANCOS', '05') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0509', 'VILCAS HUAMÁN', '05') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0510', 'PÁUCAR DEL SARA SARA', '05') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0511', 'SUCRE', '05') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0601', 'CAJAMARCA', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0602', 'CAJABAMBA', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0603', 'CELENDÍN', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0604', 'CONTUMAZÁ', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0605', 'CUTERVO', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0606', 'CHOTA', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0607', 'HUALGAYOC', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0608', 'JAÉN', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0609', 'SANTA CRUZ', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0610', 'SAN MIGUEL', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0611', 'SAN IGNACIO', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0612', 'SAN MARCOS', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0613', 'SAN PABLO', '06') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0701', 'CUSCO', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0702', 'ACOMAYO', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0703', 'ANTA', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0704', 'CALCA', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0705', 'CANAS', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0706', 'CANCHIS', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0707', 'CHUMBIVILCAS', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0708', 'ESPINAR', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0709', 'LA CONVENCIÓN', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0710', 'PARURO', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0711', 'PAUCARTAMBO', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0712', 'QUISPICANCHI', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0713', 'URUBAMBA', '07') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0801', 'HUANCAVELICA', '08') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0802', 'ACOBAMBA', '08') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0803', 'ANGARAES', '08') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0804', 'CASTROVIRREYNA', '08') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0805', 'TAYACAJA', '08') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0806', 'HUAYTARÁ', '08') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0807', 'CHURCAMPA', '08') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0901', 'HUÁNUCO', '09') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0902', 'AMBO', '09') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0903', 'DOS DE MAYO', '09') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0904', 'HUAMALÍES', '09') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0905', 'MARAÑÓN', '09') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0906', 'LEONCIO PRADO', '09') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0907', 'PACHITEA', '09') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0908', 'PUERTO INCA', '09') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0909', 'HUACAYBAMBA', '09') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0910', 'LAURICOCHA', '09') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('0911', 'YAROWILCA', '09') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1001', 'ICA', '10') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1002', 'CHINCHA', '10') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1003', 'NASCA', '10') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1004', 'PISCO', '10') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1005', 'PALPA', '10') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1101', 'HUANCAYO', '11') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1102', 'CONCEPCIÓN', '11') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1103', 'JAUJA', '11') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1104', 'JUNÍN', '11') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1105', 'TARMA', '11') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1106', 'YAULI', '11') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1107', 'SATIPO', '11') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1108', 'CHANCHAMAYO', '11') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1109', 'CHUPACA', '11') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1201', 'TRUJILLO', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1202', 'BOLÍVAR', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1203', 'SÁNCHEZ CARRIÓN', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1204', 'OTUZCO', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1205', 'PACASMAYO', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1206', 'PATAZ', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1207', 'SANTIAGO DE CHUCO', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1208', 'ASCOPE', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1209', 'CHEPÉN', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1210', 'JULCÁN', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1211', 'GRAN CHIMÚ', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1212', 'VIRÚ', '12') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1301', 'CHICLAYO', '13') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1302', 'FERREÑAFE', '13') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1303', 'LAMBAYEQUE', '13') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1401', 'LIMA', '14') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1402', 'CAJATAMBO', '14') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1403', 'CANTA', '14') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1404', 'CAÑETE', '14') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1405', 'HUAURA', '14') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1406', 'HUAROCHIRÍ', '14') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1407', 'YAUYOS', '14') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1408', 'HUARAL', '14') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1409', 'BARRANCA', '14') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1410', 'OYÓN', '14') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1501', 'MAYNAS', '15') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1502', 'ALTO AMAZONAS', '15') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1503', 'LORETO', '15') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1504', 'REQUENA', '15') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1505', 'UCAYALI', '15') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1506', 'MARISCAL RAMÓN CASTILLA', '15') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1507', 'DATEM DEL MARAÑÓN', '15') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1509', 'PUTUMAYO', '15') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1601', 'TAMBOPATA', '16') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1602', 'MANU', '16') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1603', 'TAHUAMANU', '16') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1701', 'MARISCAL NIETO', '17') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1702', 'GENERAL SÁNCHEZ CERRO', '17') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1703', 'ILO', '17') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1801', 'PASCO', '18') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1802', 'DANIEL ALCIDES CARRIÓN', '18') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1803', 'OXAPAMPA', '18') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1901', 'PIURA', '19') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1902', 'AYABACA', '19') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1903', 'HUANCABAMBA', '19') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1904', 'MORROPÓN', '19') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1905', 'PAITA', '19') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1906', 'SULLANA', '19') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1907', 'TALARA', '19') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('1908', 'SECHURA', '19') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2001', 'PUNO', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2002', 'AZÁNGARO', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2003', 'CARABAYA', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2004', 'CHUCUITO', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2005', 'HUANCANÉ', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2006', 'LAMPA', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2007', 'MELGAR', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2008', 'SANDIA', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2009', 'SAN ROMÁN', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2010', 'YUNGUYO', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2011', 'SAN ANTONIO DE PUTINA', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2012', 'EL COLLAO', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2013', 'MOHO', '20') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2101', 'MOYOBAMBA', '21') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2102', 'HUALLAGA', '21') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2103', 'LAMAS', '21') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2104', 'MARISCAL CÁCERES', '21') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2105', 'RIOJA', '21') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2106', 'SAN MARTÍN', '21') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2107', 'BELLAVISTA', '21') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2108', 'TOCACHE', '21') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2109', 'PICOTA', '21') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2110', 'EL DORADO', '21') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2201', 'TACNA', '22') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2202', 'TARATA', '22') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2203', 'JORGE BASADRE', '22') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2204', 'CANDARAVE', '22') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2301', 'TUMBES', '23') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2302', 'CONTRALMIRANTE VILLAR', '23') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2303', 'ZARUMILLA', '23') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2401', 'CALLAO', '24') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2501', 'CORONEL PORTILLO', '25') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2502', 'PADRE ABAD', '25') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2503', 'ATALAYA', '25') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_provincia (codigo, nombre, departamento_codigo) VALUES ('2504', 'PURÚS', '25') ON CONFLICT (codigo) DO NOTHING;

-- catalogo_ubigeo_distrito (fuente: T28 UBIGEO, columnas E-F)
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010101', 'CHACHAPOYAS', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010102', 'ASUNCIÓN', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010103', 'BALSAS', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010104', 'CHETO', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010105', 'CHILIQUIN', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010106', 'CHUQUIBAMBA', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010107', 'GRANADA', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010108', 'HUANCAS', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010109', 'LA JALCA', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010110', 'LEIMEBAMBA', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010111', 'LEVANTO', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010112', 'MAGDALENA', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010113', 'MARISCAL CASTILLA', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010114', 'MOLINOPAMPA', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010115', 'MONTEVIDEO', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010116', 'OLLEROS', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010117', 'QUINJALCA', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010118', 'SAN FRANCISCO DE DAGUAS', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010119', 'SAN ISIDRO DE MAINO', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010120', 'SOLOCO', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010121', 'SONCHE', '0101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010201', 'LA PECA', '0102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010202', 'ARAMANGO', '0102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010203', 'COPALLIN', '0102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010204', 'EL PARCO', '0102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010205', 'BAGUA', '0102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010206', 'IMAZA', '0102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010301', 'JUMBILLA', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010302', 'COROSHA', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010303', 'CUISPES', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010304', 'CHISQUILLA', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010305', 'CHURUJA', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010306', 'FLORIDA', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010307', 'RECTA', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010308', 'SAN CARLOS', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010309', 'SHIPASBAMBA', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010310', 'VALERA', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010311', 'YAMBRASBAMBA', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010312', 'JAZAN', '0103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010401', 'LAMUD', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010402', 'CAMPORREDONDO', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010403', 'COCABAMBA', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010404', 'COLCAMAR', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010405', 'CONILA', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010406', 'INGUILPATA', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010407', 'LONGUITA', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010408', 'LONYA CHICO', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010409', 'LUYA', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010410', 'LUYA VIEJO', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010411', 'MARÍA', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010412', 'OCALLI', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010413', 'OCUMAL', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010414', 'PISUQUIA', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010415', 'SAN CRISTÓBAL', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010416', 'SAN FRANCISCO DEL YESO', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010417', 'SAN JERÓNIMO', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010418', 'SAN JUAN DE LOPECANCHA', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010419', 'SANTA CATALINA', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010420', 'SANTO TOMÁS', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010421', 'TINGO', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010422', 'TRITA', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010423', 'PROVIDENCIA', '0104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010501', 'SAN NICOLÁS', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010502', 'COCHAMAL', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010503', 'CHIRIMOTO', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010504', 'HUAMBO', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010505', 'LIMABAMBA', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010506', 'LONGAR', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010507', 'MILPUC', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010508', 'MARISCAL BENAVIDES', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010509', 'OMIA', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010510', 'SANTA ROSA', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010511', 'TOTORA', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010512', 'VISTA ALEGRE', '0105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010601', 'NIEVA', '0106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010602', 'RÍO SANTIAGO', '0106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010603', 'EL CENEPA', '0106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010701', 'BAGUA GRANDE', '0107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010702', 'CAJARURO', '0107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010703', 'CUMBA', '0107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010704', 'EL MILAGRO', '0107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010705', 'JAMALCA', '0107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010706', 'LONYA GRANDE', '0107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('010707', 'YAMON', '0107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020101', 'HUARAZ', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020102', 'INDEPENDENCIA', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020103', 'COCHABAMBA', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020104', 'COLCABAMBA', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020105', 'HUANCHAY', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020106', 'JANGAS', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020107', 'LA LIBERTAD', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020108', 'OLLEROS', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020109', 'PAMPAS GRANDE', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020110', 'PARIACOTO', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020111', 'PIRA', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020112', 'TARICA', '0201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020201', 'AIJA', '0202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020203', 'CORIS', '0202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020205', 'HUACLLAN', '0202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020206', 'LA MERCED', '0202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020208', 'SUCCHA', '0202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020301', 'CHIQUIAN', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020302', 'ABELARDO PARDO LEZAMETA', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020304', 'AQUIA', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020305', 'CAJACAY', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020310', 'HUAYLLACAYAN', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020311', 'HUASTA', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020313', 'MANGAS', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020315', 'PACLLON', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020317', 'SAN MIGUEL DE CORPANQUI', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020320', 'TICLLOS', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020321', 'ANTONIO RAYMONDI', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020322', 'CANIS', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020323', 'COLQUIOC', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020324', 'LA PRIMAVERA', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020325', 'HUALLANCA', '0203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020401', 'CARHUAZ', '0204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020402', 'ACOPAMPA', '0204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020403', 'AMASHCA', '0204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020404', 'ANTA', '0204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020405', 'ATAQUERO', '0204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020406', 'MARCARA', '0204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020407', 'PARIAHUANCA', '0204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020408', 'SAN MIGUEL DE ACO', '0204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020409', 'SHILLA', '0204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020410', 'TINCO', '0204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020411', 'YUNGAR', '0204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020501', 'CASMA', '0205') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020502', 'BUENA VISTA ALTA', '0205') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020503', 'COMANDANTE NOEL', '0205') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020505', 'YAUTAN', '0205') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020601', 'CORONGO', '0206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020602', 'ACO', '0206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020603', 'BAMBAS', '0206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020604', 'CUSCA', '0206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020605', 'LA PAMPA', '0206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020606', 'YANAC', '0206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020607', 'YUPAN', '0206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020701', 'CARAZ', '0207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020702', 'HUALLANCA', '0207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020703', 'HUATA', '0207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020704', 'HUAYLAS', '0207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020705', 'MATO', '0207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020706', 'PAMPAROMAS', '0207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020707', 'PUEBLO LIBRE', '0207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020708', 'SANTA CRUZ', '0207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020709', 'YURACMARCA', '0207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020710', 'SANTO TORIBIO', '0207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020801', 'HUARI', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020802', 'CAJAY', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020803', 'CHAVÍN DE HUÁNTAR', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020804', 'HUACACHI', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020805', 'HUACHIS', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020806', 'HUACCHIS', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020807', 'HUÁNTAR', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020808', 'MASIN', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020809', 'PAUCAS', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020810', 'PONTO', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020811', 'RAHUAPAMPA', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020812', 'RAPAYAN', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020813', 'SAN MARCOS', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020814', 'SAN PEDRO DE CHANA', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020815', 'UCO', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020816', 'ANRA', '0208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020901', 'PISCOBAMBA', '0209') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020902', 'CASCA', '0209') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020903', 'LUCMA', '0209') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020904', 'FIDEL OLIVAS ESCUDERO', '0209') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020905', 'LLAMA', '0209') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020906', 'LLUMPA', '0209') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020907', 'MUSGA', '0209') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('020908', 'ELEAZAR GUZMÁN BARRON', '0209') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021001', 'CABANA', '0210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021002', 'BOLOGNESI', '0210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021003', 'CONCHUCOS', '0210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021004', 'HUACASCHUQUE', '0210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021005', 'HUANDOVAL', '0210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021006', 'LACABAMBA', '0210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021007', 'LLAPO', '0210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021008', 'PALLASCA', '0210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021009', 'PAMPAS', '0210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021010', 'SANTA ROSA', '0210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021011', 'TAUCA', '0210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021101', 'POMABAMBA', '0211') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021102', 'HUAYLLAN', '0211') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021103', 'PAROBAMBA', '0211') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021104', 'QUINUABAMBA', '0211') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021201', 'RECUAY', '0212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021202', 'COTAPARACO', '0212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021203', 'HUAYLLAPAMPA', '0212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021204', 'MARCA', '0212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021205', 'PAMPAS CHICO', '0212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021206', 'PARARIN', '0212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021207', 'TAPACOCHA', '0212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021208', 'TICAPAMPA', '0212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021209', 'LLACLLIN', '0212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021210', 'CATAC', '0212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021301', 'CHIMBOTE', '0213') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021302', 'CÁCERES DEL PERÚ', '0213') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021303', 'MACATE', '0213') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021304', 'MORO', '0213') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021305', 'NEPEÑA', '0213') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021306', 'SAMANCO', '0213') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021307', 'SANTA', '0213') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021308', 'COISHCO', '0213') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021309', 'NUEVO CHIMBOTE', '0213') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021401', 'SIHUAS', '0214') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021402', 'ALFONSO UGARTE', '0214') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021403', 'CHINGALPO', '0214') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021404', 'HUAYLLABAMBA', '0214') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021405', 'QUICHES', '0214') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021406', 'SICSIBAMBA', '0214') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021407', 'ACOBAMBA', '0214') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021408', 'CASHAPAMPA', '0214') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021409', 'RAGASH', '0214') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021410', 'SAN JUAN', '0214') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021501', 'YUNGAY', '0215') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021502', 'CASCAPARA', '0215') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021503', 'MANCOS', '0215') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021504', 'MATACOTO', '0215') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021505', 'QUILLO', '0215') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021506', 'RANRAHIRCA', '0215') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021507', 'SHUPLUY', '0215') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021508', 'YANAMA', '0215') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021601', 'LLAMELLIN', '0216') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021602', 'ACZO', '0216') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021603', 'CHACCHO', '0216') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021604', 'CHINGAS', '0216') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021605', 'MIRGAS', '0216') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021606', 'SAN JUAN DE RONTOY', '0216') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021701', 'SAN LUIS', '0217') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021702', 'YAUYA', '0217') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021703', 'SAN NICOLÁS', '0217') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021801', 'CHACAS', '0218') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021802', 'ACOCHACA', '0218') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021901', 'HUARMEY', '0219') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021902', 'COCHAPETI', '0219') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021903', 'HUAYAN', '0219') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021904', 'MALVAS', '0219') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('021905', 'CULEBRAS', '0219') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('022001', 'ACAS', '0220') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('022002', 'CAJAMARQUILLA', '0220') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('022003', 'CARHUAPAMPA', '0220') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('022004', 'COCHAS', '0220') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('022005', 'CONGAS', '0220') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('022006', 'LLIPA', '0220') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('022007', 'OCROS', '0220') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('022008', 'SAN CRISTÓBAL DE RAJAN', '0220') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('022009', 'SAN PEDRO', '0220') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('022010', 'SANTIAGO DE CHILCAS', '0220') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030101', 'ABANCAY', '0301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030102', 'CIRCA', '0301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030103', 'CURAHUASI', '0301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030104', 'CHACOCHE', '0301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030105', 'HUANIPACA', '0301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030106', 'LAMBRAMA', '0301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030107', 'PICHIRHUA', '0301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030108', 'SAN PEDRO DE CACHORA', '0301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030109', 'TAMBURCO', '0301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030201', 'CHALHUANCA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030202', 'CAPAYA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030203', 'CARAYBAMBA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030204', 'COLCABAMBA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030205', 'COTARUSE', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030206', 'CHAPIMARCA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030207', 'IHUAYLLO', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030208', 'LUCRE', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030209', 'POCOHUANCA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030210', 'SAÑAYCA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030211', 'SORAYA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030212', 'TAPAIRIHUA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030213', 'TINTAY', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030214', 'TORAYA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030215', 'YANACA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030216', 'SAN JUAN DE CHACÑA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030217', 'JUSTO APU SAHUARAURA', '0302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030301', 'ANDAHUAYLAS', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030302', 'ANDARAPA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030303', 'CHIARA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030304', 'HUANCARAMA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030305', 'HUANCARAY', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030306', 'KISHUARA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030307', 'PACOBAMBA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030308', 'PAMPACHIRI', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030309', 'SAN ANTONIO DE CACHI', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030310', 'SAN JERÓNIMO', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030311', 'TALAVERA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030312', 'TURPO', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030313', 'PACUCHA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030314', 'POMACOCHA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030315', 'SANTA MARÍA DE CHICMO', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030316', 'TUMAY HUARACA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030317', 'HUAYANA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030318', 'SAN MIGUEL DE CHACCRAMPA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030319', 'KAQUIABAMBA', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030320', 'JOSÉ MARÍA ARGUEDAS', '0303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030401', 'ANTABAMBA', '0304') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030402', 'EL ORO', '0304') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030403', 'HUAQUIRCA', '0304') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030404', 'JUAN ESPINOZA MEDRANO', '0304') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030405', 'OROPESA', '0304') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030406', 'PACHACONAS', '0304') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030407', 'SABAINO', '0304') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030501', 'TAMBOBAMBA', '0305') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030502', 'COYLLURQUI', '0305') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030503', 'COTABAMBAS', '0305') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030504', 'HAQUIRA', '0305') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030505', 'MARA', '0305') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030506', 'CHALLHUAHUACHO', '0305') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030601', 'CHUQUIBAMBILLA', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030602', 'CURPAHUASI', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030603', 'HUAYLLATI', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030604', 'MAMARA', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030605', 'GAMARRA', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030606', 'MICAELA BASTIDAS', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030607', 'PROGRESO', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030608', 'PATAYPAMPA', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030609', 'SAN ANTONIO', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030610', 'TURPAY', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030611', 'VILCABAMBA', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030612', 'VIRUNDO', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030613', 'SANTA ROSA', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030614', 'CURASCO', '0306') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030701', 'CHINCHEROS', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030702', 'ONGOY', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030703', 'OCOBAMBA', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030704', 'COCHARCAS', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030705', 'ANCO-HUALLO', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030706', 'HUACCANA', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030707', 'URANMARCA', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030708', 'RANRACANCHA', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030709', 'ROCCHACC', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030710', 'EL PORVENIR', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030711', 'LOS CHANKAS', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('030712', 'AHUAYRO', '0307') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040101', 'AREQUIPA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040102', 'CAYMA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040103', 'CERRO COLORADO', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040104', 'CHARACATO', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040105', 'CHIGUATA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040106', 'LA JOYA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040107', 'MIRAFLORES', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040108', 'MOLLEBAYA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040109', 'PAUCARPATA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040110', 'POCSI', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040111', 'POLOBAYA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040112', 'QUEQUEÑA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040113', 'SABANDIA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040114', 'SACHACA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040115', 'SAN JUAN DE SIGUAS', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040116', 'SAN JUAN DE TARUCANI', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040117', 'SANTA ISABEL DE SIGUAS', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040118', 'SANTA RITA DE SIGUAS', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040119', 'SOCABAYA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040120', 'TIABAYA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040121', 'UCHUMAYO', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040122', 'VÍTOR', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040123', 'YANAHUARA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040124', 'YARABAMBA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040125', 'YURA', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040126', 'MARIANO MELGAR', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040127', 'JACOBO HUNTER', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040128', 'ALTO SELVA ALEGRE', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040129', 'JOSÉ LUIS BUSTAMANTE Y RIVERO', '0401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040201', 'CHIVAY', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040202', 'ACHOMA', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040203', 'CABANACONDE', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040204', 'CAYLLOMA', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040205', 'CALLALLI', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040206', 'COPORAQUE', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040207', 'HUAMBO', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040208', 'HUANCA', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040209', 'ICHUPAMPA', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040210', 'LARI', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040211', 'LLUTA', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040212', 'MACA', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040213', 'MADRIGAL', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040214', 'SAN ANTONIO DE CHUCA', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040215', 'SIBAYO', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040216', 'TAPAY', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040217', 'TISCO', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040218', 'TUTI', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040219', 'YANQUE', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040220', 'MAJES', '0402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040301', 'CAMANÁ', '0403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040302', 'JOSÉ MARÍA QUIMPER', '0403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040303', 'MARIANO NICOLÁS VALCÁRCEL', '0403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040304', 'MARISCAL CÁCERES', '0403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040305', 'NICOLÁS DE PIÉROLA', '0403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040306', 'OCOÑA', '0403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040307', 'QUILCA', '0403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040308', 'SAMUEL PASTOR', '0403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040401', 'CARAVELÍ', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040402', 'ACARÍ', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040403', 'ATICO', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040404', 'ATIQUIPA', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040405', 'BELLA UNIÓN', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040406', 'CAHUACHO', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040407', 'CHALA', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040408', 'CHÁPARRA', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040409', 'HUANUHUANU', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040410', 'JAQUI', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040411', 'LOMAS', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040412', 'QUICACHA', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040413', 'YAUCA', '0404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040501', 'APLAO', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040502', 'ANDAGUA', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040503', 'AYO', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040504', 'CHACHAS', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040505', 'CHILCAYMARCA', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040506', 'CHOCO', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040507', 'HUANCARQUI', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040508', 'MACHAGUAY', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040509', 'ORCOPAMPA', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040510', 'PAMPACOLCA', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040511', 'TIPÁN', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040512', 'URACA', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040513', 'UÑÓN', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040514', 'VIRACO', '0405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040601', 'CHUQUIBAMBA', '0406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040602', 'ANDARAY', '0406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040603', 'CAYARANI', '0406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040604', 'CHICHAS', '0406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040605', 'IRAY', '0406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040606', 'SALAMANCA', '0406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040607', 'YANAQUIHUA', '0406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040608', 'RÍO GRANDE', '0406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040701', 'MOLLENDO', '0407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040702', 'COCACHACRA', '0407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040703', 'DEÁN VALDIVIA', '0407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040704', 'ISLAY', '0407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040705', 'MEJÍA', '0407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040706', 'PUNTA DE BOMBÓN', '0407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040801', 'COTAHUASI', '0408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040802', 'ALCA', '0408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040803', 'CHARCANA', '0408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040804', 'HUAYNACOTAS', '0408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040805', 'PAMPAMARCA', '0408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040806', 'PUYCA', '0408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040807', 'QUECHUALLA', '0408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040808', 'SAYLA', '0408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040809', 'TAURIA', '0408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040810', 'TOMEPAMPA', '0408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('040811', 'TORO', '0408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050101', 'AYACUCHO', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050102', 'ACOS VINCHOS', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050103', 'CARMEN ALTO', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050104', 'CHIARA', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050105', 'QUINUA', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050106', 'SAN JOSÉ DE TICLLAS', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050107', 'SAN JUAN BAUTISTA', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050108', 'SANTIAGO DE PISCHA', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050109', 'VINCHOS', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050110', 'TAMBILLO', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050111', 'ACOCRO', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050112', 'SOCOS', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050113', 'OCROS', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050114', 'PACAYCASA', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050115', 'JESÚS NAZARENO', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050116', 'ANDRÉS AVELINO CÁCERES DORREGARAY', '0501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050201', 'CANGALLO', '0502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050204', 'CHUSCHI', '0502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050206', 'LOS MOROCHUCOS', '0502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050207', 'PARAS', '0502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050208', 'TOTOS', '0502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050211', 'MARÍA PARADO DE BELLIDO', '0502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050301', 'HUANTA', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050302', 'AYAHUANCO', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050303', 'HUAMANGUILLA', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050304', 'IGUAIN', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050305', 'LURICOCHA', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050307', 'SANTILLANA', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050308', 'SIVIA', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050309', 'LLOCHEGUA', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050310', 'CANAYRE', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050311', 'UCHURACCAY', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050312', 'PUCACOLPA', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050313', 'CHACA', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050314', 'PUTIS', '0503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050401', 'SAN MIGUEL', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050402', 'ANCO', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050403', 'AYNA', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050404', 'CHILCAS', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050405', 'CHUNGUI', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050406', 'TAMBO', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050407', 'LUIS CARRANZA', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050408', 'SANTA ROSA', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050409', 'SAMUGARI', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050410', 'ANCHIHUAY', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050411', 'ORONCCOY', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050412', 'UNIÓN PROGRESO', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050413', 'PATIBAMBA', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050414', 'NINABAMBA', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050415', 'RIO MAGDALENA', '0504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050501', 'PUQUIO', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050502', 'AUCARA', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050503', 'CABANA', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050504', 'CARMEN SALCEDO', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050506', 'CHAVIÑA', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050508', 'CHIPAO', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050510', 'HUAC-HUAS', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050511', 'LARAMATE', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050512', 'LEONCIO PRADO', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050513', 'LUCANAS', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050514', 'LLAUTA', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050516', 'OCAÑA', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050517', 'OTOCA', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050520', 'SANCOS', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050521', 'SAN JUAN', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050522', 'SAN PEDRO', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050524', 'SANTA ANA DE HUAYCAHUACHO', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050525', 'SANTA LUCÍA', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050529', 'SAISA', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050531', 'SAN PEDRO DE PALCO', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050532', 'SAN CRISTÓBAL', '0505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050601', 'CORACORA', '0506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050604', 'CORONEL CASTAÑEDA', '0506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050605', 'CHUMPI', '0506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050608', 'PACAPAUSA', '0506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050611', 'PULLO', '0506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050612', 'PUYUSCA', '0506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050615', 'SAN FRANCISCO DE RAVACAYCO', '0506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050616', 'UPAHUACHO', '0506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050701', 'HUANCAPI', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050702', 'ALCAMENCA', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050703', 'APONGO', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050704', 'CANARIA', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050706', 'CAYARA', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050707', 'COLCA', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050708', 'HUALLA', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050709', 'HUAMANQUIQUIA', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050710', 'HUANCARAYLLA', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050713', 'SARHUA', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050714', 'VILCANCHOS', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050715', 'ASQUIPATA', '0507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050801', 'SANCOS', '0508') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050802', 'SACSAMARCA', '0508') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050803', 'SANTIAGO DE LUCANAMARCA', '0508') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050804', 'CARAPO', '0508') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050901', 'VILCAS HUAMÁN', '0509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050902', 'VISCHONGO', '0509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050903', 'ACCOMARCA', '0509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050904', 'CARHUANCA', '0509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050905', 'CONCEPCIÓN', '0509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050906', 'HUAMBALPA', '0509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050907', 'SAURAMA', '0509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('050908', 'INDEPENDENCIA', '0509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051001', 'PAUSA', '0510') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051002', 'COLTA', '0510') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051003', 'CORCULLA', '0510') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051004', 'LAMPA', '0510') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051005', 'MARCABAMBA', '0510') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051006', 'OYOLO', '0510') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051007', 'PARARCA', '0510') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051008', 'SAN JAVIER DE ALPABAMBA', '0510') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051009', 'SAN JOSÉ DE USHUA', '0510') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051010', 'SARA SARA', '0510') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051101', 'QUEROBAMBA', '0511') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051102', 'BELÉN', '0511') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051103', 'CHALCOS', '0511') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051104', 'SAN SALVADOR DE QUIJE', '0511') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051105', 'PAICO', '0511') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051106', 'SANTIAGO DE PAUCARAY', '0511') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051107', 'SAN PEDRO DE LARCAY', '0511') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051108', 'SORAS', '0511') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051109', 'HUACAÑA', '0511') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051110', 'CHILCAYOC', '0511') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('051111', 'MORCOLLA', '0511') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060101', 'CAJAMARCA', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060102', 'ASUNCIÓN', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060103', 'COSPAN', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060104', 'CHETILLA', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060105', 'ENCAÑADA', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060106', 'JESÚS', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060107', 'LOS BAÑOS DEL INCA', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060108', 'LLACANORA', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060109', 'MAGDALENA', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060110', 'MATARA', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060111', 'NAMORA', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060112', 'SAN JUAN', '0601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060201', 'CAJABAMBA', '0602') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060202', 'CACHACHI', '0602') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060203', 'CONDEBAMBA', '0602') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060205', 'SITACOCHA', '0602') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060301', 'CELENDÍN', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060302', 'CORTEGANA', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060303', 'CHUMUCH', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060304', 'HUASMÍN', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060305', 'JORGE CHÁVEZ', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060306', 'JOSÉ GÁLVEZ', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060307', 'MIGUEL IGLESIAS', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060308', 'OXAMARCA', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060309', 'SOROCHUCO', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060310', 'SUCRE', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060311', 'UTCO', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060312', 'LA LIBERTAD DE PALLÁN', '0603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060401', 'CONTUMAZÁ', '0604') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060403', 'CHILETE', '0604') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060404', 'GUZMANGO', '0604') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060405', 'SAN BENITO', '0604') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060406', 'CUPISNIQUE', '0604') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060407', 'TANTARICA', '0604') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060408', 'YONÁN', '0604') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060409', 'SANTA CRUZ DE TOLEDO', '0604') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060501', 'CUTERVO', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060502', 'CALLAYUC', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060503', 'CUJILLO', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060504', 'CHOROS', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060505', 'LA RAMADA', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060506', 'PIMPINGOS', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060507', 'QUEROCOTILLO', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060508', 'SAN ANDRÉS DE CUTERVO', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060509', 'SAN JUAN DE CUTERVO', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060510', 'SAN LUIS DE LUCMA', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060511', 'SANTA CRUZ', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060512', 'SANTO DOMINGO DE LA CAPILLA', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060513', 'SANTO TOMÁS', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060514', 'SOCOTA', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060515', 'TORIBIO CASANOVA', '0605') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060601', 'CHOTA', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060602', 'ANGUIA', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060603', 'COCHABAMBA', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060604', 'CONCHÁN', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060605', 'CHADIN', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060606', 'CHIGUIRIP', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060607', 'CHIMBÁN', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060608', 'HUAMBOS', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060609', 'LAJAS', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060610', 'LLAMA', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060611', 'MIRACOSTA', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060612', 'PACCHA', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060613', 'PION', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060614', 'QUEROCOTO', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060615', 'TACABAMBA', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060616', 'TOCMOCHE', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060617', 'SAN JUAN DE LICUPIS', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060618', 'CHOROPAMPA', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060619', 'CHALAMARCA', '0606') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060701', 'BAMBAMARCA', '0607') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060702', 'CHUGUR', '0607') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060703', 'HUALGAYOC', '0607') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060801', 'JAÉN', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060802', 'BELLAVISTA', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060803', 'COLASAY', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060804', 'CHONTALI', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060805', 'POMAHUACA', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060806', 'PUCARÁ', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060807', 'SALLIQUE', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060808', 'SAN FELIPE', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060809', 'SAN JOSÉ DEL ALTO', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060810', 'SANTA ROSA', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060811', 'LAS PIRIAS', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060812', 'HUABAL', '0608') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060901', 'SANTA CRUZ', '0609') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060902', 'CATACHE', '0609') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060903', 'CHANCAYBAÑOS', '0609') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060904', 'LA ESPERANZA', '0609') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060905', 'NINABAMBA', '0609') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060906', 'PULÁN', '0609') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060907', 'SEXI', '0609') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060908', 'UTICYACU', '0609') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060909', 'YAUYUCAN', '0609') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060910', 'ANDABAMBA', '0609') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('060911', 'SAUCEPAMPA', '0609') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061001', 'SAN MIGUEL', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061002', 'CALQUIS', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061003', 'LA FLORIDA', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061004', 'LLAPA', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061005', 'NANCHOC', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061006', 'NIEPOS', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061007', 'SAN GREGORIO', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061008', 'SAN SILVESTRE DE COCHÁN', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061009', 'EL PRADO', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061010', 'UNIÓN AGUA BLANCA', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061011', 'TONGOD', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061012', 'CATILLUC', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061013', 'BOLÍVAR', '0610') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061101', 'SAN IGNACIO', '0611') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061102', 'CHIRINOS', '0611') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061103', 'HUARANGO', '0611') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061104', 'NAMBALLE', '0611') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061105', 'LA COIPA', '0611') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061106', 'SAN JOSÉ DE LOURDES', '0611') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061107', 'TABACONAS', '0611') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061201', 'PEDRO GÁLVEZ', '0612') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061202', 'ICHOCÁN', '0612') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061203', 'GREGORIO PITA', '0612') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061204', 'JOSÉ MANUEL QUIROZ', '0612') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061205', 'EDUARDO VILLANUEVA', '0612') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061206', 'JOSÉ SABOGAL', '0612') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061207', 'CHANCAY', '0612') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061301', 'SAN PABLO', '0613') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061302', 'SAN BERNARDINO', '0613') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061303', 'SAN LUIS', '0613') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('061304', 'TUMBADEN', '0613') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070101', 'CUSCO', '0701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070102', 'CCORCA', '0701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070103', 'POROY', '0701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070104', 'SAN JERÓNIMO', '0701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070105', 'SAN SEBASTIÁN', '0701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070106', 'SANTIAGO', '0701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070107', 'SAYLLA', '0701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070108', 'WANCHAQ', '0701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070201', 'ACOMAYO', '0702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070202', 'ACOPIA', '0702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070203', 'ACOS', '0702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070204', 'POMACANCHI', '0702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070205', 'RONDOCAN', '0702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070206', 'SANGARARA', '0702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070207', 'MOSOC LLACTA', '0702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070301', 'ANTA', '0703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070302', 'CHINCHAYPUJIO', '0703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070303', 'HUAROCONDO', '0703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070304', 'LIMATAMBO', '0703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070305', 'MOLLEPATA', '0703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070306', 'PUCYURA', '0703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070307', 'ZURITE', '0703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070308', 'CACHIMAYO', '0703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070309', 'ANCAHUASI', '0703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070401', 'CALCA', '0704') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070402', 'COYA', '0704') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070403', 'LAMAY', '0704') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070404', 'LARES', '0704') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070405', 'PÍSAC', '0704') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070406', 'SAN SALVADOR', '0704') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070407', 'TARAY', '0704') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070408', 'YANATILE', '0704') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070501', 'YANAOCA', '0705') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070502', 'CHECCA', '0705') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070503', 'KUNTURKANKI', '0705') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070504', 'LANGUI', '0705') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070505', 'LAYO', '0705') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070506', 'PAMPAMARCA', '0705') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070507', 'QUEHUE', '0705') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070508', 'TÚPAC AMARU', '0705') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070601', 'SICUANI', '0706') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070602', 'COMBAPATA', '0706') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070603', 'CHECACUPE', '0706') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070604', 'MARANGANI', '0706') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070605', 'PITUMARCA', '0706') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070606', 'SAN PABLO', '0706') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070607', 'SAN PEDRO', '0706') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070608', 'TINTA', '0706') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070701', 'SANTO TOMÁS', '0707') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070702', 'CAPACMARCA', '0707') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070703', 'COLQUEMARCA', '0707') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070704', 'CHAMACA', '0707') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070705', 'LIVITACA', '0707') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070706', 'LLUSCO', '0707') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070707', 'QUIÑOTA', '0707') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070708', 'VELILLE', '0707') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070801', 'ESPINAR', '0708') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070802', 'CONDOROMA', '0708') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070803', 'COPORAQUE', '0708') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070804', 'OCORURO', '0708') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070805', 'PALLPATA', '0708') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070806', 'PICHIGUA', '0708') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070807', 'SUYCKUTAMBO', '0708') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070808', 'ALTO PICHIGUA', '0708') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070901', 'SANTA ANA', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070902', 'ECHARATE', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070903', 'HUAYOPATA', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070904', 'MARANURA', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070905', 'OCOBAMBA', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070906', 'SANTA TERESA', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070907', 'VILCABAMBA', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070908', 'QUELLOUNO', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070909', 'KIMBIRI', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070910', 'PICHARI', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070911', 'INKAWASI', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070912', 'VILLA VIRGEN', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070913', 'VILLA KINTIARINA', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070915', 'MEGANTONI', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070916', 'KUMPIRUSHIATO', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070917', 'CIELO PUNCO', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070918', 'MANITEA', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('070919', 'UNIÓN ASHÁNINKA', '0709') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071001', 'PARURO', '0710') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071002', 'ACCHA', '0710') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071003', 'CCAPI', '0710') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071004', 'COLCHA', '0710') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071005', 'HUANOQUITE', '0710') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071006', 'OMACHA', '0710') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071007', 'YAURISQUE', '0710') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071008', 'PACCARITAMBO', '0710') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071009', 'PILLPINTO', '0710') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071101', 'PAUCARTAMBO', '0711') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071102', 'CAICAY', '0711') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071103', 'COLQUEPATA', '0711') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071104', 'CHALLABAMBA', '0711') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071105', 'KOSÑIPATA', '0711') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071106', 'HUANCARANI', '0711') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071201', 'URCOS', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071202', 'ANDAHUAYLILLAS', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071203', 'CAMANTI', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071204', 'CCARHUAYO', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071205', 'CCATCA', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071206', 'CUSIPATA', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071207', 'HUARO', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071208', 'LUCRE', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071209', 'MARCAPATA', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071210', 'OCONGATE', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071211', 'OROPESA', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071212', 'QUIQUIJANA', '0712') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071301', 'URUBAMBA', '0713') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071302', 'CHINCHERO', '0713') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071303', 'HUAYLLABAMBA', '0713') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071304', 'MACHUPICCHU', '0713') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071305', 'MARAS', '0713') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071306', 'OLLANTAYTAMBO', '0713') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('071307', 'YUCAY', '0713') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080101', 'HUANCAVELICA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080102', 'ACOBAMBILLA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080103', 'ACORIA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080104', 'CONAYCA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080105', 'CUENCA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080106', 'HUACHOCOLPA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080108', 'HUAYLLAHUARA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080109', 'IZCUCHACA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080110', 'LARIA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080111', 'MANTA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080112', 'MARISCAL CÁCERES', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080113', 'MOYA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080114', 'NUEVO OCCORO', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080115', 'PALCA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080116', 'PILCHACA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080117', 'VILCA', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080118', 'YAULI', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080119', 'ASCENSIÓN', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080120', 'HUANDO', '0801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080201', 'ACOBAMBA', '0802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080202', 'ANTA', '0802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080203', 'ANDABAMBA', '0802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080204', 'CAJA', '0802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080205', 'MARCAS', '0802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080206', 'PAUCARA', '0802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080207', 'POMACOCHA', '0802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080208', 'ROSARIO', '0802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080301', 'LIRCAY', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080302', 'ANCHONGA', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080303', 'CALLANMARCA', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080304', 'CONGALLA', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080305', 'CHINCHO', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080306', 'HUAYLLAY GRANDE', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080307', 'HUANCA-HUANCA', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080308', 'JULCAMARCA', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080309', 'SAN ANTONIO DE ANTAPARCO', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080310', 'SANTO TOMÁS DE PATA', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080311', 'SECCLLA', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080312', 'CCOCHACCASA', '0803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080401', 'CASTROVIRREYNA', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080402', 'ARMA', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080403', 'AURAHUA', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080405', 'CAPILLAS', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080406', 'COCAS', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080408', 'CHUPAMARCA', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080409', 'HUACHOS', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080410', 'HUAMATAMBO', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080414', 'MOLLEPAMPA', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080422', 'SAN JUAN', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080427', 'TANTARA', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080428', 'TICRAPO', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080429', 'SANTA ANA', '0804') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080501', 'PAMPAS', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080502', 'ACOSTAMBO', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080503', 'ACRAQUIA', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080504', 'AHUAYCHA', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080506', 'COLCABAMBA', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080509', 'DANIEL HERNÁNDEZ', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080511', 'HUACHOCOLPA', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080512', 'HUARIBAMBA', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080515', 'ÑAHUIMPUQUIO', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080517', 'PAZOS', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080518', 'QUISHUAR', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080519', 'SALCABAMBA', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080520', 'SAN MARCOS DE ROCCHAC', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080523', 'SURCUBAMBA', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080525', 'TINTAY PUNCU', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080526', 'SALCAHUASI', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080528', 'QUICHUAS', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080529', 'ANDAYMARCA', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080530', 'ROBLE', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080531', 'PICHOS', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080532', 'SANTIAGO DE TUCUMA', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080533', 'LAMBRAS', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080534', 'COCHABAMBA', '0805') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080601', 'AYAVI', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080602', 'CÓRDOVA', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080603', 'HUAYACUNDO ARMA', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080604', 'HUAYTARA', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080605', 'LARAMARCA', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080606', 'OCOYO', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080607', 'PILPICHACA', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080608', 'QUERCO', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080609', 'QUITO-ARMA', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080610', 'SAN ANTONIO DE CUSICANCHA', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080611', 'SAN FRANCISCO DE SANGAYAICO', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080612', 'SAN ISIDRO', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080613', 'SANTIAGO DE CHOCORVOS', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080614', 'SANTIAGO DE QUIRAHUARA', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080615', 'SANTO DOMINGO DE CAPILLAS', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080616', 'TAMBO', '0806') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080701', 'CHURCAMPA', '0807') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080702', 'ANCO', '0807') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080703', 'CHINCHIHUASI', '0807') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080704', 'EL CARMEN', '0807') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080705', 'LA MERCED', '0807') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080706', 'LOCROJA', '0807') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080707', 'PAUCARBAMBA', '0807') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080708', 'SAN MIGUEL DE MAYOCC', '0807') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080709', 'SAN PEDRO DE CORIS', '0807') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080710', 'PACHAMARCA', '0807') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('080711', 'COSME', '0807') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090101', 'HUÁNUCO', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090102', 'CHINCHAO', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090103', 'CHURUBAMBA', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090104', 'MARGOS', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090105', 'QUISQUI', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090106', 'SAN FRANCISCO DE CAYRAN', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090107', 'SAN PEDRO DE CHAULAN', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090108', 'SANTA MARÍA DEL VALLE', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090109', 'YARUMAYO', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090110', 'AMARILIS', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090111', 'PILLCO MARCA', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090112', 'YACUS', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090113', 'SAN PABLO DE PILLAO', '0901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090201', 'AMBO', '0902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090202', 'CAYNA', '0902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090203', 'COLPAS', '0902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090204', 'CONCHAMARCA', '0902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090205', 'HUÁCAR', '0902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090206', 'SAN FRANCISCO', '0902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090207', 'SAN RAFAEL', '0902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090208', 'TOMAY KICHWA', '0902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090301', 'LA UNIÓN', '0903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090307', 'CHUQUIS', '0903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090312', 'MARÍAS', '0903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090314', 'PACHAS', '0903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090316', 'QUIVILLA', '0903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090317', 'RIPÁN', '0903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090321', 'SHUNQUI', '0903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090322', 'SILLAPATA', '0903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090323', 'YANAS', '0903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090401', 'LLATA', '0904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090402', 'ARANCAY', '0904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090403', 'CHAVÍN DE PARIARCA', '0904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090404', 'JACAS GRANDE', '0904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090405', 'JIRCAN', '0904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090406', 'MIRAFLORES', '0904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090407', 'MONZÓN', '0904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090408', 'PUNCHAO', '0904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090409', 'PUÑOS', '0904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090410', 'SINGA', '0904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090411', 'TANTAMAYO', '0904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090501', 'HUACRACHUCO', '0905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090502', 'CHOLÓN', '0905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090505', 'SAN BUENAVENTURA', '0905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090506', 'LA MORADA', '0905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090507', 'SANTA ROSA DE ALTO YANAJANCA', '0905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090601', 'RUPA-RUPA', '0906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090602', 'DANIEL ALOMÍA ROBLES', '0906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090603', 'HERMILIO VALDIZAN', '0906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090604', 'LUYANDO', '0906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090605', 'MARIANO DÁMASO BERAÚN', '0906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090606', 'JOSÉ CRESPO Y CASTILLO', '0906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090607', 'PUCAYACU', '0906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090608', 'CASTILLO GRANDE', '0906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090609', 'PUEBLO NUEVO', '0906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090610', 'SANTO DOMINGO DE ANDA', '0906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090701', 'PANAO', '0907') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090702', 'CHAGLLA', '0907') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090704', 'MOLINO', '0907') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090706', 'UMARI', '0907') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090801', 'HONORIA', '0908') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090802', 'PUERTO INCA', '0908') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090803', 'CODO DEL POZUZO', '0908') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090804', 'TOURNAVISTA', '0908') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090805', 'YUYAPICHIS', '0908') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090901', 'HUACAYBAMBA', '0909') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090902', 'PINRA', '0909') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090903', 'CANCHABAMBA', '0909') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('090904', 'COCHABAMBA', '0909') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091001', 'JESÚS', '0910') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091002', 'BAÑOS', '0910') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091003', 'SAN FRANCISCO DE ASÍS', '0910') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091004', 'QUEROPALCA', '0910') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091005', 'SAN MIGUEL DE CAURI', '0910') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091006', 'RONDOS', '0910') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091007', 'JIVIA', '0910') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091101', 'CHAVINILLO', '0911') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091102', 'APARICIO POMARES', '0911') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091103', 'CAHUAC', '0911') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091104', 'CHACABAMBA', '0911') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091105', 'JACAS CHICO', '0911') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091106', 'OBAS', '0911') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091107', 'PAMPAMARCA', '0911') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('091108', 'CHORAS', '0911') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100101', 'ICA', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100102', 'LA TINGUIÑA', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100103', 'LOS AQUIJES', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100104', 'PARCONA', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100105', 'PUEBLO NUEVO', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100106', 'SALAS', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100107', 'SAN JOSÉ DE LOS MOLINOS', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100108', 'SAN JUAN BAUTISTA', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100109', 'SANTIAGO', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100110', 'SUBTANJALLA', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100111', 'YAUCA DEL ROSARIO', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100112', 'TATE', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100113', 'PACHACÚTEC', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100114', 'OCUCAJE', '1001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100201', 'CHINCHA ALTA', '1002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100202', 'CHAVÍN', '1002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100203', 'CHINCHA BAJA', '1002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100204', 'EL CARMEN', '1002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100205', 'GROCIO PRADO', '1002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100206', 'SAN PEDRO DE HUACARPANA', '1002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100207', 'SUNAMPE', '1002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100208', 'TAMBO DE MORA', '1002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100209', 'ALTO LARÁN', '1002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100210', 'PUEBLO NUEVO', '1002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100211', 'SAN JUAN DE YANAC', '1002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100301', 'NASCA', '1003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100302', 'CHANGUILLO', '1003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100303', 'EL INGENIO', '1003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100304', 'MARCONA', '1003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100305', 'VISTA ALEGRE', '1003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100401', 'PISCO', '1004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100402', 'HUANCANO', '1004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100403', 'HUMAY', '1004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100404', 'INDEPENDENCIA', '1004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100405', 'PARACAS', '1004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100406', 'SAN ANDRÉS', '1004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100407', 'SAN CLEMENTE', '1004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100408', 'TÚPAC AMARU INCA', '1004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100501', 'PALPA', '1005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100502', 'LLIPATA', '1005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100503', 'RÍO GRANDE', '1005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100504', 'SANTA CRUZ', '1005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('100505', 'TIBILLO', '1005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110101', 'HUANCAYO', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110103', 'CARHUACALLANGA', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110104', 'COLCA', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110105', 'CULLHUAS', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110106', 'CHACAPAMPA', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110107', 'CHICCHE', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110108', 'CHILCA', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110109', 'CHONGOS ALTO', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110112', 'CHUPURO', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110113', 'EL TAMBO', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110114', 'HUACRAPUQUIO', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110116', 'HUALHUAS', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110118', 'HUANCÁN', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110119', 'HUASICANCHA', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110120', 'HUAYUCACHI', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110121', 'INGENIO', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110122', 'PARIAHUANCA', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110123', 'PILCOMAYO', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110124', 'PUCARÁ', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110125', 'QUICHUAY', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110126', 'QUILCAS', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110127', 'SAN AGUSTÍN', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110128', 'SAN JERÓNIMO DE TUNÁN', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110131', 'SANTO DOMINGO DE ACOBAMBA', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110132', 'SAÑO', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110133', 'SAPALLANGA', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110134', 'SICAYA', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110136', 'VIQUES', '1101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110201', 'CONCEPCIÓN', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110202', 'ACO', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110203', 'ANDAMARCA', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110204', 'COMAS', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110205', 'COCHAS', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110206', 'CHAMBARA', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110207', 'HEROÍNAS TOLEDO', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110208', 'MANZANARES', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110209', 'MARISCAL CASTILLA', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110210', 'MATAHUASI', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110211', 'MITO', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110212', 'NUEVE DE JULIO', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110213', 'ORCOTUNA', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110214', 'SANTA ROSA DE OCOPA', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110215', 'SAN JOSÉ DE QUERO', '1102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110301', 'JAUJA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110302', 'ACOLLA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110303', 'APATA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110304', 'ATAURA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110305', 'CANCHAYLLO', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110306', 'EL MANTARO', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110307', 'HUAMALÍ', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110308', 'HUARIPAMPA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110309', 'HUERTAS', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110310', 'JANJAILLO', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110311', 'JULCÁN', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110312', 'LEONOR ORDÓÑEZ', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110313', 'LLOCLLAPAMPA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110314', 'MARCO', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110315', 'MASMA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110316', 'MOLINOS', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110317', 'MONOBAMBA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110318', 'MUQUI', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110319', 'MUQUIYAUYO', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110320', 'PACA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110321', 'PACCHA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110322', 'PANCÁN', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110323', 'PARCO', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110324', 'POMACANCHA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110325', 'RICRÁN', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110326', 'SAN LORENZO', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110327', 'SAN PEDRO DE CHUNÁN', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110328', 'SINCOS', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110329', 'TUNAN MARCA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110330', 'YAULI', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110331', 'CURICACA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110332', 'MASMA CHICCHE', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110333', 'SAUSA', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110334', 'YAUYOS', '1103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110401', 'JUNÍN', '1104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110402', 'CARHUAMAYO', '1104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110403', 'ONDORES', '1104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110404', 'ULCUMAYO', '1104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110501', 'TARMA', '1105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110502', 'ACOBAMBA', '1105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110503', 'HUARICOLCA', '1105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110504', 'HUASAHUASI', '1105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110505', 'LA UNIÓN', '1105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110506', 'PALCA', '1105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110507', 'PALCAMAYO', '1105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110508', 'SAN PEDRO DE CAJAS', '1105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110509', 'TAPO', '1105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110601', 'LA OROYA', '1106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110602', 'CHACAPALPA', '1106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110603', 'HUAY-HUAY', '1106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110604', 'MARCAPOMACOCHA', '1106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110605', 'MOROCOCHA', '1106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110606', 'PACCHA', '1106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110607', 'SANTA BÁRBARA DE CARHUACAYÁN', '1106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110608', 'SUITUCANCHA', '1106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110609', 'YAULI', '1106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110610', 'SANTA ROSA DE SACCO', '1106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110701', 'SATIPO', '1107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110702', 'COVIRIALI', '1107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110703', 'LLAYLLA', '1107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110704', 'MAZAMARI', '1107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110705', 'PAMPA HERMOSA', '1107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110706', 'PANGOA', '1107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110707', 'RÍO NEGRO', '1107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110708', 'RÍO TAMBO', '1107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110709', 'VIZCATAN DEL ENE', '1107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110801', 'CHANCHAMAYO', '1108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110802', 'SAN RAMÓN', '1108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110803', 'VITOC', '1108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110804', 'SAN LUIS DE SHUARO', '1108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110805', 'PICHANAQUI', '1108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110806', 'PERENÉ', '1108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110901', 'CHUPACA', '1109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110902', 'AHUAC', '1109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110903', 'CHONGOS BAJO', '1109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110904', 'HUÁCHAC', '1109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110905', 'HUAMANCACA CHICO', '1109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110906', 'SAN JUAN DE ISCOS', '1109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110907', 'SAN JUAN DE JARPA', '1109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110908', 'TRES DE DICIEMBRE', '1109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('110909', 'YANACANCHA', '1109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120101', 'TRUJILLO', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120102', 'HUANCHACO', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120103', 'LAREDO', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120104', 'MOCHE', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120105', 'SALAVERRY', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120106', 'SIMBAL', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120107', 'VICTOR LARCO HERRERA', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120109', 'POROTO', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120110', 'EL PORVENIR', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120111', 'LA ESPERANZA', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120112', 'FLORENCIA DE MORA', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120113', 'ALTO TRUJILLO', '1201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120201', 'BOLÍVAR', '1202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120202', 'BAMBAMARCA', '1202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120203', 'CONDORMARCA', '1202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120204', 'LONGOTEA', '1202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120205', 'UCUNCHA', '1202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120206', 'UCHUMARCA', '1202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120301', 'HUAMACHUCO', '1203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120302', 'COCHORCO', '1203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120303', 'CURGOS', '1203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120304', 'CHUGAY', '1203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120305', 'MARCABAL', '1203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120306', 'SANAGORAN', '1203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120307', 'SARÍN', '1203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120308', 'SARTIMBAMBA', '1203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120401', 'OTUZCO', '1204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120402', 'AGALLPAMPA', '1204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120403', 'CHARAT', '1204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120404', 'HUARANCHAL', '1204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120405', 'LA CUESTA', '1204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120408', 'PARANDAY', '1204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120409', 'SALPO', '1204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120410', 'SINSICAP', '1204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120411', 'USQUIL', '1204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120413', 'MACHE', '1204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120501', 'SAN PEDRO DE LLOC', '1205') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120503', 'GUADALUPE', '1205') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120504', 'JEQUETEPEQUE', '1205') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120506', 'PACASMAYO', '1205') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120508', 'SAN JOSÉ', '1205') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120601', 'TAYABAMBA', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120602', 'BULDIBUYO', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120603', 'CHILLIA', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120604', 'HUAYLILLAS', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120605', 'HUANCASPATA', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120606', 'HUAYO', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120607', 'ONGON', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120608', 'PARCOY', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120609', 'PATAZ', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120610', 'PIAS', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120611', 'TAURIJA', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120612', 'URPAY', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120613', 'SANTIAGO DE CHALLAS', '1206') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120701', 'SANTIAGO DE CHUCO', '1207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120702', 'CACHICADAN', '1207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120703', 'MOLLEBAMBA', '1207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120704', 'MOLLEPATA', '1207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120705', 'QUIRUVILCA', '1207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120706', 'SANTA CRUZ DE CHUCA', '1207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120707', 'SITABAMBA', '1207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120708', 'ANGASMARCA', '1207') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120801', 'ASCOPE', '1208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120802', 'CHICAMA', '1208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120803', 'CHOCOPE', '1208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120804', 'SANTIAGO DE CAO', '1208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120805', 'MAGDALENA DE CAO', '1208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120806', 'PAIJÁN', '1208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120807', 'RÁZURI', '1208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120808', 'CASA GRANDE', '1208') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120901', 'CHEPÉN', '1209') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120902', 'PACANGA', '1209') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('120903', 'PUEBLO NUEVO', '1209') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('121001', 'JULCÁN', '1210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('121002', 'CARABAMBA', '1210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('121003', 'CALAMARCA', '1210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('121004', 'HUASO', '1210') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('121101', 'CASCAS', '1211') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('121102', 'LUCMA', '1211') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('121103', 'MARMOT', '1211') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('121104', 'SAYAPULLO', '1211') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('121201', 'VIRÚ', '1212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('121202', 'CHAO', '1212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('121203', 'GUADALUPITO', '1212') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130101', 'CHICLAYO', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130102', 'CHONGOYAPE', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130103', 'ETEN', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130104', 'ETEN PUERTO', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130105', 'LAGUNAS', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130106', 'MONSEFÚ', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130107', 'NUEVA ARICA', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130108', 'OYOTÚN', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130109', 'PICSI', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130110', 'PIMENTEL', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130111', 'REQUE', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130112', 'JOSÉ LEONARDO ORTIZ', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130113', 'SANTA ROSA', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130114', 'SAÑA', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130115', 'LA VICTORIA', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130116', 'CAYALTÍ', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130117', 'PATAPO', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130118', 'POMALCA', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130119', 'PUCALÁ', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130120', 'TUMÁN', '1301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130201', 'FERREÑAFE', '1302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130202', 'INCAHUASI', '1302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130203', 'CAÑARIS', '1302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130204', 'PITIPO', '1302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130205', 'PUEBLO NUEVO', '1302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130206', 'MANUEL ANTONIO MESONES MURO', '1302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130301', 'LAMBAYEQUE', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130302', 'CHOCHOPE', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130303', 'ILLIMO', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130304', 'JAYANCA', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130305', 'MOCHUMI', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130306', 'MÓRROPE', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130307', 'MOTUPE', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130308', 'OLMOS', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130309', 'PACORA', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130310', 'SALAS', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130311', 'SAN JOSÉ', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('130312', 'TÚCUME', '1303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140101', 'LIMA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140102', 'ANCÓN', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140103', 'ATE', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140104', 'BREÑA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140105', 'CARABAYLLO', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140106', 'COMAS', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140107', 'CHACLACAYO', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140108', 'CHORRILLOS', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140109', 'LA VICTORIA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140110', 'LA MOLINA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140111', 'LINCE', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140112', 'LURIGANCHO', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140113', 'LURÍN', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140114', 'MAGDALENA DEL MAR', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140115', 'MIRAFLORES', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140116', 'PACHACAMAC', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140117', 'PUEBLO LIBRE', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140118', 'PUCUSANA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140119', 'PUENTE PIEDRA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140120', 'PUNTA HERMOSA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140121', 'PUNTA NEGRA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140122', 'RÍMAC', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140123', 'SAN BARTOLO', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140124', 'SAN ISIDRO', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140125', 'BARRANCO', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140126', 'SAN MARTÍN DE PORRES', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140127', 'SAN MIGUEL', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140128', 'SANTA MARÍA DEL MAR', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140129', 'SANTA ROSA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140130', 'SANTIAGO DE SURCO', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140131', 'SURQUILLO', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140132', 'VILLA MARÍA DEL TRIUNFO', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140133', 'JESÚS MARÍA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140134', 'INDEPENDENCIA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140135', 'EL AGUSTINO', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140136', 'SAN JUAN DE MIRAFLORES', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140137', 'SAN JUAN DE LURIGANCHO', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140138', 'SAN LUIS', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140139', 'CIENEGUILLA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140140', 'SAN BORJA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140141', 'VILLA EL SALVADOR', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140142', 'LOS OLIVOS', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140143', 'SANTA ANITA', '1401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140201', 'CAJATAMBO', '1402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140205', 'COPA', '1402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140206', 'GORGOR', '1402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140207', 'HUANCAPÓN', '1402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140208', 'MANAS', '1402') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140301', 'CANTA', '1403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140302', 'ARAHUAY', '1403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140303', 'HUAMANTANGA', '1403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140304', 'HUAROS', '1403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140305', 'LACHAQUI', '1403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140306', 'SAN BUENAVENTURA', '1403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140307', 'SANTA ROSA DE QUIVES', '1403') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140401', 'SAN VICENTE DE CAÑETE', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140402', 'CALANGO', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140403', 'CERRO AZUL', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140404', 'COAYLLO', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140405', 'CHILCA', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140406', 'IMPERIAL', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140407', 'LUNAHUANÁ', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140408', 'MALA', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140409', 'NUEVO IMPERIAL', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140410', 'PACARAN', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140411', 'QUILMANA', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140412', 'SAN ANTONIO', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140413', 'SAN LUIS', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140414', 'SANTA CRUZ DE FLORES', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140415', 'ZÚÑIGA', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140416', 'ASIA', '1404') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140501', 'HUACHO', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140502', 'ÁMBAR', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140504', 'CALETA DE CARQUÍN', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140505', 'CHECRAS', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140506', 'HUALMAY', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140507', 'HUAURA', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140508', 'LEONCIO PRADO', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140509', 'PACCHO', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140511', 'SANTA LEONOR', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140512', 'SANTA MARÍA', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140513', 'SAYÁN', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140516', 'VEGUETA', '1405') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140601', 'MATUCANA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140602', 'ANTIOQUÍA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140603', 'CALLAHUANCA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140604', 'CARAMPOMA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140605', 'SAN PEDRO DE CASTA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140606', 'CUENCA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140607', 'CHICLA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140608', 'HUANZA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140609', 'HUAROCHIRI', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140610', 'LAHUAYTAMBO', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140611', 'LANGA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140612', 'MARIATANA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140613', 'RICARDO PALMA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140614', 'SAN ANDRÉS DE TUPICOCHA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140615', 'SAN ANTONIO', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140616', 'SAN BARTOLOMÉ', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140617', 'SAN DAMIÁN', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140618', 'SANGALLAYA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140619', 'SAN JUAN DE TANTARANCHE', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140620', 'SAN LORENZO DE QUINTI', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140621', 'SAN MATEO', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140622', 'SAN MATEO DE OTAO', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140623', 'SAN PEDRO DE HUANCAYRE', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140624', 'SANTA CRUZ DE COCACHACRA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140625', 'SANTA EULALIA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140626', 'SANTIAGO DE ANCHUCAYA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140627', 'SANTIAGO DE TUNA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140628', 'SANTO DOMINGO DE LOS OLLEROS', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140629', 'SURCO', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140630', 'HUACHUPAMPA', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140631', 'SAN PEDRO DE LARAOS', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140632', 'SAN JUAN DE IRIS', '1406') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140701', 'YAUYOS', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140702', 'ALIS', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140703', 'ALLAUCA', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140704', 'AYAVIRI', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140705', 'AZÁNGARO', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140706', 'CACRA', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140707', 'CARANIA', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140708', 'COCHAS', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140709', 'COLONIA', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140710', 'CHOCOS', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140711', 'HUAMPARA', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140712', 'HUANCAYA', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140713', 'HUANGASCAR', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140714', 'HUANTAN', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140715', 'HUAÑEC', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140716', 'LARAOS', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140717', 'LINCHA', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140718', 'MIRAFLORES', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140719', 'OMAS', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140720', 'QUINCHES', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140721', 'QUINOCAY', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140722', 'SAN JOAQUÍN', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140723', 'SAN PEDRO DE PILAS', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140724', 'TANTA', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140725', 'TAURIPAMPA', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140726', 'TUPE', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140727', 'TOMAS', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140728', 'VIÑAC', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140729', 'VITIS', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140730', 'HONGOS', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140731', 'MADEAN', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140732', 'PUTINZA', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140733', 'CATAHUASI', '1407') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140801', 'HUARAL', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140802', 'ATAVILLOS ALTO', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140803', 'ATAVILLOS BAJO', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140804', 'AUCALLAMA', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140805', 'CHANCAY', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140806', 'IHUARI', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140807', 'LAMPÍAN', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140808', 'PACARAOS', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140809', 'SAN MIGUEL DE ACOS', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140810', 'VEINTISIETE DE NOVIEMBRE', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140811', 'SANTA CRUZ DE ANDAMARCA', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140812', 'SUMBILCA', '1408') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140901', 'BARRANCA', '1409') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140902', 'PARAMONGA', '1409') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140903', 'PATIVILCA', '1409') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140904', 'SUPE', '1409') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('140905', 'SUPE PUERTO', '1409') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('141001', 'OYÓN', '1410') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('141002', 'NAVAN', '1410') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('141003', 'CAUJUL', '1410') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('141004', 'ANDAJES', '1410') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('141005', 'PACHANGARA', '1410') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('141006', 'COCHAMARCA', '1410') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150101', 'IQUITOS', '1501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150102', 'ALTO NANAY', '1501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150103', 'FERNANDO LORES', '1501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150104', 'LAS AMAZONAS', '1501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150105', 'MAZAN', '1501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150106', 'NAPO', '1501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150108', 'TORRES CAUSANA', '1501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150110', 'INDIANA', '1501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150111', 'PUNCHANA', '1501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150112', 'BELÉN', '1501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150113', 'SAN JUAN BAUTISTA', '1501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150201', 'YURIMAGUAS', '1502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150202', 'BALSAPUERTO', '1502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150205', 'JEBEROS', '1502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150206', 'LAGUNAS', '1502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150210', 'SANTA CRUZ', '1502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150211', 'TENIENTE CÉSAR LÓPEZ ROJAS', '1502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150301', 'NAUTA', '1503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150302', 'PARINARI', '1503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150303', 'TIGRE', '1503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150304', 'URARINAS', '1503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150305', 'TROMPETEROS', '1503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150401', 'REQUENA', '1504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150402', 'ALTO TAPICHE', '1504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150403', 'CAPELO', '1504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150404', 'EMILIO SAN MARTÍN', '1504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150405', 'MAQUIA', '1504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150406', 'PUINAHUA', '1504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150407', 'SAQUENA', '1504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150408', 'SOPLIN', '1504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150409', 'TAPICHE', '1504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150410', 'JENARO HERRERA', '1504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150411', 'YAQUERANA', '1504') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150501', 'CONTAMANA', '1505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150502', 'VARGAS GUERRA', '1505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150503', 'PADRE MÁRQUEZ', '1505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150504', 'PAMPA HERMOSA', '1505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150505', 'SARAYACU', '1505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150506', 'INAHUAYA', '1505') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150601', 'RAMÓN CASTILLA', '1506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150602', 'PEBAS', '1506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150603', 'YAVARÍ', '1506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150604', 'SAN PABLO', '1506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150605', 'SANTA ROSA DE LORETO', '1506') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150701', 'BARRANCA', '1507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150702', 'ANDOAS', '1507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150703', 'CAHUAPANAS', '1507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150704', 'MANSERICHE', '1507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150705', 'MORONA', '1507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150706', 'PASTAZA', '1507') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150901', 'PUTUMAYO', '1509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150902', 'ROSA PANDURO', '1509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150903', 'TENIENTE MANUEL CLAVERO', '1509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('150904', 'YAGUAS', '1509') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('160101', 'TAMBOPATA', '1601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('160102', 'INAMBARI', '1601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('160103', 'LAS PIEDRAS', '1601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('160104', 'LABERINTO', '1601') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('160201', 'MANU', '1602') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('160202', 'FITZCARRALD', '1602') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('160203', 'MADRE DE DIOS', '1602') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('160204', 'HUEPETUHE', '1602') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('160301', 'IÑAPARI', '1603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('160302', 'IBERIA', '1603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('160303', 'TAHUAMANU', '1603') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170101', 'MOQUEGUA', '1701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170102', 'CARUMAS', '1701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170103', 'CUCHUMBAYA', '1701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170104', 'SAN CRISTÓBAL', '1701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170105', 'TORATA', '1701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170106', 'SAMEGUA', '1701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170107', 'SAN ANTONIO', '1701') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170201', 'OMATE', '1702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170202', 'COALAQUE', '1702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170203', 'CHOJATA', '1702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170204', 'ICHUÑA', '1702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170205', 'LA CAPILLA', '1702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170206', 'LLOQUE', '1702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170207', 'MATALAQUE', '1702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170208', 'PUQUINA', '1702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170209', 'QUINISTAQUILLAS', '1702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170210', 'UBINAS', '1702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170211', 'YUNGA', '1702') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170301', 'ILO', '1703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170302', 'EL ALGARROBAL', '1703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('170303', 'PACOCHA', '1703') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180101', 'CHAUPIMARCA', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180103', 'HUACHÓN', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180104', 'HUARIACA', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180105', 'HUAYLLAY', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180106', 'NINACACA', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180107', 'PALLANCHACRA', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180108', 'PAUCARTAMBO', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180109', 'SAN FRANCISCO DE ASÍS DE YARUSYACÁN', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180110', 'SIMÓN BOLÍVAR', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180111', 'TICLACAYAN', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180112', 'TINYAHUARCO', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180113', 'VICCO', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180114', 'YANACANCHA', '1801') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180201', 'YANAHUANCA', '1802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180202', 'CHACAYAN', '1802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180203', 'GOYLLARISQUIZGA', '1802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180204', 'PAUCAR', '1802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180205', 'SAN PEDRO DE PILLAO', '1802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180206', 'SANTA ANA DE TUSI', '1802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180207', 'TAPUC', '1802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180208', 'VILCABAMBA', '1802') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180301', 'OXAPAMPA', '1803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180302', 'CHONTABAMBA', '1803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180303', 'HUANCABAMBA', '1803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180304', 'PUERTO BERMÚDEZ', '1803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180305', 'VILLA RICA', '1803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180306', 'POZUZO', '1803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180307', 'PALCAZU', '1803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('180308', 'CONSTITUCIÓN', '1803') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190101', 'PIURA', '1901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190103', 'CASTILLA', '1901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190104', 'CATACAOS', '1901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190105', 'LA ARENA', '1901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190106', 'LA UNIÓN', '1901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190107', 'LAS LOMAS', '1901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190109', 'TAMBO GRANDE', '1901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190113', 'CURA MORI', '1901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190114', 'EL TALLÁN', '1901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190115', 'VEINTISÉIS DE OCTUBRE', '1901') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190201', 'AYABACA', '1902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190202', 'FRÍAS', '1902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190203', 'LAGUNAS', '1902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190204', 'MONTERO', '1902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190205', 'PACAIPAMPA', '1902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190206', 'SAPILLICA', '1902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190207', 'SICCHEZ', '1902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190208', 'SUYO', '1902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190209', 'JILILI', '1902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190210', 'PAIMAS', '1902') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190301', 'HUANCABAMBA', '1903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190302', 'CANCHAQUE', '1903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190303', 'HUARMACA', '1903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190304', 'SONDOR', '1903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190305', 'SONDORILLO', '1903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190306', 'EL CARMEN DE LA FRONTERA', '1903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190307', 'SAN MIGUEL DE EL FAIQUE', '1903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190308', 'LALAQUIZ', '1903') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190401', 'CHULUCANAS', '1904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190402', 'BUENOS AIRES', '1904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190403', 'CHALACO', '1904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190404', 'MORROPÓN', '1904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190405', 'SALITRAL', '1904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190406', 'SANTA CATALINA DE MOSSA', '1904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190407', 'SANTO DOMINGO', '1904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190408', 'LA MATANZA', '1904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190409', 'YAMANGO', '1904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190410', 'SAN JUAN DE BIGOTE', '1904') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190501', 'PAITA', '1905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190502', 'AMOTAPE', '1905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190503', 'ARENAL', '1905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190504', 'LA HUACA', '1905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190505', 'COLAN', '1905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190506', 'TAMARINDO', '1905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190507', 'VICHAYAL', '1905') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190601', 'SULLANA', '1906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190602', 'BELLAVISTA', '1906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190603', 'LANCONES', '1906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190604', 'MARCAVELICA', '1906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190605', 'MIGUEL CHECA', '1906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190606', 'QUERECOTILLO', '1906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190607', 'SALITRAL', '1906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190608', 'IGNACIO ESCUDERO', '1906') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190701', 'PARIÑAS', '1907') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190702', 'EL ALTO', '1907') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190703', 'LA BREA', '1907') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190704', 'LOBITOS', '1907') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190705', 'MÁNCORA', '1907') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190706', 'LOS ÓRGANOS', '1907') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190801', 'SECHURA', '1908') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190802', 'VICE', '1908') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190803', 'BERNAL', '1908') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190804', 'BELLAVISTA DE LA UNIÓN', '1908') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190805', 'CRISTO NOS VALGA', '1908') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('190806', 'RINCONADA LLICUAR', '1908') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200101', 'PUNO', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200102', 'ÁCORA', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200103', 'ATUNCOLLA', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200104', 'CAPACHICA', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200105', 'COATA', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200106', 'CHUCUITO', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200107', 'HUATA', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200108', 'MAÑAZO', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200109', 'PAUCARCOLLA', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200110', 'PICHACANI', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200111', 'SAN ANTONIO', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200112', 'TIQUILLACA', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200113', 'VILQUE', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200114', 'PLATERÍA', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200115', 'AMANTANÍ', '2001') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200201', 'AZÁNGARO', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200202', 'ACHAYA', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200203', 'ARAPA', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200204', 'ASILLO', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200205', 'CAMINACA', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200206', 'CHUPA', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200207', 'JOSÉ DOMINGO CHOQUEHUANCA', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200208', 'MUÑANI', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200210', 'POTONI', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200212', 'SAMÁN', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200213', 'SAN ANTÓN', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200214', 'SAN JOSÉ', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200215', 'SAN JUAN DE SALINAS', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200216', 'SANTIAGO DE PUPUJA', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200217', 'TIRAPATA', '2002') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200301', 'MACUSANI', '2003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200302', 'AJOYANI', '2003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200303', 'AYAPATA', '2003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200304', 'COASA', '2003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200305', 'CORANI', '2003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200306', 'CRUCERO', '2003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200307', 'ITUATA', '2003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200308', 'OLLACHEA', '2003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200309', 'SAN GABÁN', '2003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200310', 'USICAYOS', '2003') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200401', 'JULI', '2004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200402', 'DESAGUADERO', '2004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200403', 'HUACULLANI', '2004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200406', 'PISACOMA', '2004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200407', 'POMATA', '2004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200410', 'ZEPITA', '2004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200412', 'KELLUYO', '2004') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200501', 'HUANCANÉ', '2005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200502', 'COJATA', '2005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200504', 'INCHUPALLA', '2005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200506', 'PUSI', '2005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200507', 'ROSASPATA', '2005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200508', 'TARACO', '2005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200509', 'VILQUE CHICO', '2005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200511', 'HUATASANI', '2005') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200601', 'LAMPA', '2006') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200602', 'CABANILLA', '2006') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200603', 'CALAPUJA', '2006') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200604', 'NICASIO', '2006') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200605', 'OCUVIRI', '2006') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200606', 'PALCA', '2006') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200607', 'PARATIA', '2006') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200608', 'PUCARA', '2006') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200609', 'SANTA LUCÍA', '2006') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200610', 'VILAVILA', '2006') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200701', 'AYAVIRI', '2007') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200702', 'ANTAUTA', '2007') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200703', 'CUPI', '2007') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200704', 'LLALLI', '2007') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200705', 'MACARI', '2007') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200706', 'NUÑOA', '2007') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200707', 'ORURILLO', '2007') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200708', 'SANTA ROSA', '2007') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200709', 'UMACHIRI', '2007') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200801', 'SANDIA', '2008') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200803', 'CUYOCUYO', '2008') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200804', 'LIMBANI', '2008') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200805', 'PHARA', '2008') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200806', 'PATAMBUCO', '2008') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200807', 'QUIACA', '2008') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200808', 'SAN JUAN DEL ORO', '2008') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200810', 'YANAHUAYA', '2008') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200811', 'ALTO INAMBARI', '2008') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200812', 'SAN PEDRO DE PUTINA PUNCO', '2008') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200901', 'JULIACA', '2009') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200902', 'CABANA', '2009') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200903', 'CABANILLAS', '2009') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200904', 'CARACOTO', '2009') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('200905', 'SAN MIGUEL', '2009') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201001', 'YUNGUYO', '2010') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201002', 'UNICACHI', '2010') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201003', 'ANAPIA', '2010') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201004', 'COPANI', '2010') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201005', 'CUTURAPI', '2010') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201006', 'OLLARAYA', '2010') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201007', 'TINICACHI', '2010') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201101', 'PUTINA', '2011') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201102', 'PEDRO VILCA APAZA', '2011') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201103', 'QUILCAPUNCU', '2011') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201104', 'ANANEA', '2011') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201105', 'SINA', '2011') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201201', 'ILAVE', '2012') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201202', 'PILCUYO', '2012') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201203', 'SANTA ROSA', '2012') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201204', 'CAPAZO', '2012') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201205', 'CONDURIRI', '2012') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201301', 'MOHO', '2013') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201302', 'CONIMA', '2013') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201303', 'TILALI', '2013') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('201304', 'HUAYRAPATA', '2013') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210101', 'MOYOBAMBA', '2101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210102', 'CALZADA', '2101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210103', 'HABANA', '2101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210104', 'JEPELACIO', '2101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210105', 'SORITOR', '2101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210106', 'YANTALO', '2101') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210201', 'SAPOSOA', '2102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210202', 'PISCOYACU', '2102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210203', 'SACANCHE', '2102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210204', 'TINGO DE SAPOSOA', '2102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210205', 'ALTO SAPOSOA', '2102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210206', 'EL ESLABÓN', '2102') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210301', 'LAMAS', '2103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210303', 'BARRANQUITA', '2103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210304', 'CAYNARACHI', '2103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210305', 'CUÑUMBUQUI', '2103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210306', 'PINTO RECODO', '2103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210307', 'RUMISAPA', '2103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210311', 'SHANAO', '2103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210313', 'TABALOSOS', '2103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210314', 'ZAPATERO', '2103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210315', 'ALONSO DE ALVARADO', '2103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210316', 'SAN ROQUE DE CUMBAZA', '2103') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210401', 'JUANJUÍ', '2104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210402', 'CAMPANILLA', '2104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210403', 'HUICUNGO', '2104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210404', 'PACHIZA', '2104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210405', 'PAJARILLO', '2104') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210501', 'RIOJA', '2105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210502', 'POSIC', '2105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210503', 'YORONGOS', '2105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210504', 'YURACYACU', '2105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210505', 'NUEVA CAJAMARCA', '2105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210506', 'ELÍAS SOPLÍN VARGAS', '2105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210507', 'SAN FERNANDO', '2105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210508', 'PARDO MIGUEL', '2105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210509', 'AWAJUN', '2105') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210601', 'TARAPOTO', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210602', 'ALBERTO LEVEAU', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210604', 'CACATACHI', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210606', 'CHAZUTA', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210607', 'CHIPURANA', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210608', 'EL PORVENIR', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210609', 'HUIMBAYOC', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210610', 'JUAN GUERRA', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210611', 'MORALES', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210612', 'PAPAPLAYA', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210616', 'SAN ANTONIO', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210619', 'SAUCE', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210620', 'SHAPAJA', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210621', 'LA BANDA DE SHILCAYO', '2106') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210701', 'BELLAVISTA', '2107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210702', 'SAN RAFAEL', '2107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210703', 'SAN PABLO', '2107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210704', 'ALTO BIAVO', '2107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210705', 'HUALLAGA', '2107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210706', 'BAJO BIAVO', '2107') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210801', 'TOCACHE', '2108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210802', 'NUEVO PROGRESO', '2108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210803', 'PÓLVORA', '2108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210804', 'SHUNTE', '2108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210805', 'UCHIZA', '2108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210806', 'SANTA LUCIA', '2108') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210901', 'PICOTA', '2109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210902', 'BUENOS AIRES', '2109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210903', 'CASPISAPA', '2109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210904', 'PILLUANA', '2109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210905', 'PUCACACA', '2109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210906', 'SAN CRISTÓBAL', '2109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210907', 'SAN HILARIÓN', '2109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210908', 'TINGO DE PONASA', '2109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210909', 'TRES UNIDOS', '2109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('210910', 'SHAMBOYACU', '2109') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('211001', 'SAN JOSÉ DE SISA', '2110') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('211002', 'AGUA BLANCA', '2110') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('211003', 'SHATOJA', '2110') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('211004', 'SAN MARTÍN', '2110') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('211005', 'SANTA ROSA', '2110') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220101', 'TACNA', '2201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220102', 'CALANA', '2201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220104', 'INCLÁN', '2201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220107', 'PACHIA', '2201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220108', 'PALCA', '2201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220109', 'POCOLLAY', '2201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220110', 'SAMA', '2201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220111', 'ALTO DE LA ALIANZA', '2201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220112', 'CIUDAD NUEVA', '2201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220113', 'CORONEL GREGORIO ALBARRACÍN LANCHIPA', '2201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220114', 'LA YARADA LOS PALOS', '2201') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220201', 'TARATA', '2202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220205', 'HÉROES ALBARRACÍN', '2202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220206', 'ESTIQUE', '2202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220207', 'ESTIQUE PAMPA', '2202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220210', 'SITAJARA', '2202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220211', 'SUSAPAYA', '2202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220212', 'TARUCACHI', '2202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220213', 'TICACO', '2202') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220301', 'LOCUMBA', '2203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220302', 'ITE', '2203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220303', 'ILABAYA', '2203') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220401', 'CANDARAVE', '2204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220402', 'CAIRANI', '2204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220403', 'CURIBAYA', '2204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220404', 'HUANUARA', '2204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220405', 'QUILAHUANI', '2204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('220406', 'CAMILACA', '2204') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230101', 'TUMBES', '2301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230102', 'CORRALES', '2301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230103', 'LA CRUZ', '2301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230104', 'PAMPAS DE HOSPITAL', '2301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230105', 'SAN JACINTO', '2301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230106', 'SAN JUAN DE LA VIRGEN', '2301') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230201', 'ZORRITOS', '2302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230202', 'CASITAS', '2302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230203', 'CANOAS DE PUNTA SAL', '2302') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230301', 'ZARUMILLA', '2303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230302', 'MATAPALO', '2303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230303', 'PAPAYAL', '2303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('230304', 'AGUAS VERDES', '2303') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('240101', 'CALLAO', '2401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('240102', 'BELLAVISTA', '2401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('240103', 'LA PUNTA', '2401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('240104', 'CARMEN DE LA LEGUA REYNOSO', '2401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('240105', 'LA PERLA', '2401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('240106', 'VENTANILLA', '2401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('240107', 'MI PERÚ', '2401') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250101', 'CALLERIA', '2501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250102', 'YARINACOCHA', '2501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250103', 'MASISEA', '2501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250104', 'CAMPOVERDE', '2501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250105', 'IPARIA', '2501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250106', 'NUEVA REQUENA', '2501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250107', 'MANANTAY', '2501') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250201', 'PADRE ABAD', '2502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250202', 'IRAZOLA', '2502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250203', 'CURIMANA', '2502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250204', 'NESHUYA', '2502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250205', 'ALEXANDER VON HUMBOLDT', '2502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250206', 'BOQUERON', '2502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250207', 'HUIPOCA', '2502') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250301', 'RAIMONDI', '2503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250302', 'TAHUANIA', '2503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250303', 'YURUA', '2503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250304', 'SEPAHUA', '2503') ON CONFLICT (codigo) DO NOTHING;
INSERT INTO catalogo_ubigeo_distrito (codigo, nombre, provincia_codigo) VALUES ('250401', 'PURÚS', '2504') ON CONFLICT (codigo) DO NOTHING;