-- =========================================================================
-- Migracion 034: Planilla Mensual Consolidada ("Ronda E").
--
-- Resuelve el problema que planteo el usuario (CPC responsable de las
-- declaraciones): la PLAME, AFPnet y el Asiento Contable se presentan por
-- MES CALENDARIO, pero a los obreros (construccion civil) se les paga por
-- quincena/semana, y una quincena puede cruzar de mes. Hoy cada exportacion
-- sale de UN SOLO periodo de pago (detalle_planilla, ver migraciones
-- anteriores) - no existe ninguna forma de juntar 2 quincenas (mas el
-- periodo MENSUAL de Empleados, que no se toca en esta ronda) en un solo
-- archivo por mes.
--
-- Este mecanismo es ADICIONAL: no reemplaza ni modifica las boletas ya
-- calculadas por periodo de pago (detalle_planilla sigue igual, sin
-- cambios). "Planilla Mensual" junta el Tareo Diario de todas las quincenas
-- que tocan un {proyecto, anio, mes} y corre el calculo UNA sola vez sobre
-- el mes completo (foto historica, igual criterio que el resto del
-- sistema: no se recalcula sola si se corrige una quincena despues -
-- avisa, no bloquea).
--
-- Aplica SOLO a obreros (categorias de construccion civil): el periodo
-- MENSUAL de Empleados ya cubre el mes calendario completo, confirmado con
-- el usuario - no necesita este mecanismo.
--
-- Tablas nuevas:
--   1) planilla_mensual: cabecera (proyecto, anio, mes) - una fila por mes
--      consolidado de un proyecto.
--   2) detalle_planilla_mensual: espejo de detalle_planilla (mismas
--      columnas de asistencia/ingresos/descuentos/aportes), pero con clave
--      {planilla_mensual_id, contrato_id} en vez de {periodo_id, contrato_id}.
--   3) detalle_planilla_conceptos_mensual: espejo de
--      detalle_planilla_conceptos (Ronda D, conceptos con formula propia),
--      para los montos personalizados calculados a nivel mensual.
-- =========================================================================

CREATE TABLE IF NOT EXISTS planilla_mensual (
    id              SERIAL PRIMARY KEY,
    proyecto        VARCHAR(150) NOT NULL,
    anio            INT NOT NULL,
    mes             INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    calculado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    calculado_por   INT REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (proyecto, anio, mes)
);

CREATE TABLE IF NOT EXISTS detalle_planilla_mensual (
    id                     SERIAL PRIMARY KEY,
    planilla_mensual_id    INT NOT NULL REFERENCES planilla_mensual(id) ON DELETE CASCADE,
    contrato_id            INT NOT NULL REFERENCES contratos(id) ON DELETE RESTRICT,

    -- asistencia (mismas columnas que detalle_planilla)
    dias_trabajados        NUMERIC(6,2) NOT NULL DEFAULT 0,
    dias_dominical         NUMERIC(6,2) NOT NULL DEFAULT 0,
    dias_dominical_no_laborado NUMERIC(6,2) NOT NULL DEFAULT 0,
    dias_feriado           NUMERIC(6,2) NOT NULL DEFAULT 0,
    dias_falta             NUMERIC(6,2) NOT NULL DEFAULT 0,
    horas_extra_25         NUMERIC(6,2) NOT NULL DEFAULT 0,
    horas_extra_35         NUMERIC(6,2) NOT NULL DEFAULT 0,
    horas_extra_100        NUMERIC(6,2) NOT NULL DEFAULT 0,

    -- ingresos
    jornal_diario          NUMERIC(10,2) NOT NULL DEFAULT 0,
    sueldo_basico          NUMERIC(10,2) NOT NULL DEFAULT 0,
    remuneracion_dominical NUMERIC(10,2) NOT NULL DEFAULT 0,
    remuneracion_dominical_proporcional NUMERIC(10,2) NOT NULL DEFAULT 0,
    remuneracion_feriado   NUMERIC(10,2) NOT NULL DEFAULT 0,
    sobretasa_dominical    NUMERIC(10,2) NOT NULL DEFAULT 0,
    sobretasa_feriado      NUMERIC(10,2) NOT NULL DEFAULT 0,
    importe_horas_extra    NUMERIC(10,2) NOT NULL DEFAULT 0,
    asignacion_familiar    NUMERIC(10,2) NOT NULL DEFAULT 0,
    asignacion_escolaridad NUMERIC(10,2) NOT NULL DEFAULT 0,
    bonificacion_buc       NUMERIC(10,2) NOT NULL DEFAULT 0,
    bonificacion_bae       NUMERIC(10,2) NOT NULL DEFAULT 0,
    bonificacion_movilidad NUMERIC(10,2) NOT NULL DEFAULT 0,
    condicion_trabajo      NUMERIC(10,2) NOT NULL DEFAULT 0,
    dias_subsidio_enfermedad NUMERIC(6,2) NOT NULL DEFAULT 0,
    dias_subsidio_maternidad NUMERIC(6,2) NOT NULL DEFAULT 0,
    dias_licencia_paternidad NUMERIC(6,2) NOT NULL DEFAULT 0,
    dias_subsidio_enfermedad_computable NUMERIC(6,2) NOT NULL DEFAULT 0,
    subsidio_enfermedad    NUMERIC(10,2) NOT NULL DEFAULT 0,
    licencia_paternidad    NUMERIC(10,2) NOT NULL DEFAULT 0,
    otras_bonificaciones   NUMERIC(10,2) NOT NULL DEFAULT 0,
    gratificacion          NUMERIC(10,2) NOT NULL DEFAULT 0,
    bonificacion_extraordinaria NUMERIC(10,2) NOT NULL DEFAULT 0,
    cts                    NUMERIC(10,2) NOT NULL DEFAULT 0,
    vacaciones             NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_ingresos         NUMERIC(10,2) NOT NULL DEFAULT 0,

    -- descuentos del trabajador
    aporte_pension         NUMERIC(10,2) NOT NULL DEFAULT 0,
    descuento_sindicato    NUMERIC(10,2) NOT NULL DEFAULT 0,
    seguro_vida            NUMERIC(10,2) NOT NULL DEFAULT 0,
    conafovicer            NUMERIC(10,2) NOT NULL DEFAULT 0,
    renta_5ta              NUMERIC(10,2) NOT NULL DEFAULT 0,
    otros_descuentos       NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_descuentos       NUMERIC(10,2) NOT NULL DEFAULT 0,

    -- aportes del empleador (informativo)
    essalud                NUMERIC(10,2) NOT NULL DEFAULT 0,
    sctr                   NUMERIC(10,2) NOT NULL DEFAULT 0,
    senati                 NUMERIC(10,2) NOT NULL DEFAULT 0,

    neto_pagar             NUMERIC(10,2) NOT NULL DEFAULT 0,

    detalle_json           JSONB,

    UNIQUE (planilla_mensual_id, contrato_id)
);
CREATE INDEX IF NOT EXISTS idx_detalle_planilla_mensual_planilla ON detalle_planilla_mensual(planilla_mensual_id);

CREATE TABLE IF NOT EXISTS detalle_planilla_conceptos_mensual (
    id              SERIAL PRIMARY KEY,
    detalle_id      INT NOT NULL REFERENCES detalle_planilla_mensual(id) ON DELETE CASCADE,
    concepto_codigo VARCHAR(60) NOT NULL REFERENCES conceptos_planilla(codigo),
    monto           NUMERIC(10,2) NOT NULL DEFAULT 0,
    UNIQUE(detalle_id, concepto_codigo)
);
CREATE INDEX IF NOT EXISTS idx_detalle_planilla_conceptos_mensual_detalle ON detalle_planilla_conceptos_mensual(detalle_id);

-- -------------------------------------------------------------------------
-- Nuevo permiso: "Consolidar y descargar la Planilla Mensual". Se otorga de
-- entrada a RESPONSABLE_PLANILLA (mismo criterio que las demas tareas de
-- planilla/exportaciones); el ADMIN ya tiene acceso total via el permiso
-- comodin "*" (ver src/authMiddleware.ts), no necesita esta fila.
-- -------------------------------------------------------------------------
INSERT INTO permisos_catalogo (codigo, nombre, grupo, orden) VALUES
    ('planilla_mensual.gestionar', 'Consolidar y descargar la Planilla Mensual', 'Planillas', 85)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_codigo, permiso_codigo)
SELECT 'RESPONSABLE_PLANILLA', 'planilla_mensual.gestionar'
WHERE NOT EXISTS (
    SELECT 1 FROM rol_permiso WHERE rol_codigo = 'RESPONSABLE_PLANILLA' AND permiso_codigo = 'planilla_mensual.gestionar'
);

-- -------------------------------------------------------------------------
-- IMPORTANTE (leccion aprendida de migraciones anteriores: 019, 020, 022,
-- 033): el usuario de la aplicacion (grupojhc_boletas) es distinto del
-- usuario con el que se corre este script en phpMyAdmin (grupojhc) - crear
-- una tabla no le da automaticamente permiso a otro usuario para usarla ni
-- para usar su secuencia.
-- -------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON planilla_mensual TO grupojhc_boletas;
GRANT USAGE, SELECT ON SEQUENCE planilla_mensual_id_seq TO grupojhc_boletas;
GRANT SELECT, INSERT, UPDATE, DELETE ON detalle_planilla_mensual TO grupojhc_boletas;
GRANT USAGE, SELECT ON SEQUENCE detalle_planilla_mensual_id_seq TO grupojhc_boletas;
GRANT SELECT, INSERT, UPDATE, DELETE ON detalle_planilla_conceptos_mensual TO grupojhc_boletas;
GRANT USAGE, SELECT ON SEQUENCE detalle_planilla_conceptos_mensual_id_seq TO grupojhc_boletas;
