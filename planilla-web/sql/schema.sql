-- =========================================================================
-- Esquema: planilla_construccion
-- Sistema de planillas (migración desde Excel/VBA) - JHCR
-- Régimen: Construcción Civil (BUC, CONAFOVICER, SENATI) + Empleados
-- =========================================================================
-- Ejecutar completo en pgAdmin (Query Tool) sobre la base planilla_construccion.
-- Si ya existían las 7 tablas de la versión anterior (sin datos), este script
-- las reemplaza por una versión más completa alineada al motor de cálculo real.
-- =========================================================================

DROP TABLE IF EXISTS bitacora_planilla CASCADE;
DROP TABLE IF EXISTS detalle_planilla CASCADE;
DROP TABLE IF EXISTS periodos_planilla CASCADE;
DROP TABLE IF EXISTS contratos CASCADE;
DROP TABLE IF EXISTS empleados CASCADE;
DROP TABLE IF EXISTS parametros_normativos CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;

-- -------------------------------------------------------------------------
-- usuarios: acceso al sistema
-- -------------------------------------------------------------------------
CREATE TABLE usuarios (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(150) NOT NULL,
    correo          VARCHAR(150) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    rol             VARCHAR(30)  NOT NULL DEFAULT 'OPERADOR', -- ADMIN | OPERADOR | CONSULTA
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
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
    tasa_senati                 NUMERIC(6,4)  NOT NULL DEFAULT 0.0075,
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
-- empleados: datos maestros de la persona (no cambian por proyecto/periodo)
-- -------------------------------------------------------------------------
CREATE TABLE empleados (
    id                  SERIAL PRIMARY KEY,
    tipo_documento      VARCHAR(2)   NOT NULL DEFAULT '1', -- Tabla 3 T-Registro (1=DNI)
    numero_documento    VARCHAR(15)  NOT NULL UNIQUE,
    apellidos_nombres   VARCHAR(200) NOT NULL,
    fecha_nacimiento    DATE,
    grado_instruccion   VARCHAR(60),
    numero_hijos        INT NOT NULL DEFAULT 0,
    celular             VARCHAR(20),
    correo              VARCHAR(120),
    direccion           TEXT,
    ubigeo              VARCHAR(200), -- el dato real de la empresa es texto de ubicacion (distrito-provincia-departamento), no un codigo numerico
    entidad_bancaria    VARCHAR(100),
    cuenta_bancaria     VARCHAR(100),
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
    bonificacion_buc       NUMERIC(10,2) NOT NULL DEFAULT 0,
    otras_bonificaciones   NUMERIC(10,2) NOT NULL DEFAULT 0,
    gratificacion          NUMERIC(10,2) NOT NULL DEFAULT 0,
    cts                    NUMERIC(10,2) NOT NULL DEFAULT 0,
    vacaciones             NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_ingresos         NUMERIC(10,2) NOT NULL DEFAULT 0,

    -- descuentos del trabajador
    aporte_pension         NUMERIC(10,2) NOT NULL DEFAULT 0, -- ONP 13% u (obligatorio+comisión+prima AFP)
    descuento_sindicato     NUMERIC(10,2) NOT NULL DEFAULT 0,
    seguro_vida             NUMERIC(10,2) NOT NULL DEFAULT 0,
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
-- Parámetros anuales 2026. OJO: remuneracion_minima_vital queda en 0 a
-- proposito - no se encontro un valor confirmado en los archivos revisados,
-- actualizalo desde la pestaña "Parametros" antes de usarlo en un calculo.
-- -------------------------------------------------------------------------
INSERT INTO parametros_normativos (
    anio, uit, remuneracion_minima_vital, tasa_essalud, tasa_onp, tasa_senati,
    tasa_conafovicer, tasa_sctr_salud, asignacion_familiar, seguro_vida_ley
) VALUES (
    2026, 5500, 0, 0.09, 0.13, 0.0075, 0.02, 0.0155, 113.00, 5.00
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
