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
DROP TABLE IF EXISTS proyectos CASCADE;
DROP TABLE IF EXISTS datos_empresa CASCADE;

-- -------------------------------------------------------------------------
-- usuarios: acceso al sistema (login real con contraseña)
-- -------------------------------------------------------------------------
CREATE TABLE usuarios (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(150) NOT NULL,
    correo          VARCHAR(150) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    -- ADMIN: acceso total. RESPONSABLE_PLANILLA: tareo/calculo/boletas solo
    -- de sus proyectos asignados. TAREADOR: solo carga tareo de sus
    -- proyectos asignados (no calcula ni ve boletas).
    rol             VARCHAR(30)  NOT NULL DEFAULT 'TAREADOR',
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
