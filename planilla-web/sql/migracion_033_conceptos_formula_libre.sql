-- =========================================================================
-- Migracion 033: Conceptos con formula propia ("Ronda D" del correo de
-- Claudia). Ver PLAN_PENDIENTE.md para el diseño completo confirmado con
-- el usuario a lo largo de varias conversaciones.
--
-- Resumen de lo que agrega:
--   1) conceptos_planilla gana columnas para poder crear conceptos NUEVOS
--      (ademas de los 14+ ya hardcodeados, que NO se tocan): tipo (para
--      saber si suma a ingresos/aportes/descuentos), formula (texto tipo
--      Excel, NULL para los conceptos originales), es_personalizado,
--      estado (ACTIVO o PENDIENTE_DESARROLLO -si el usuario eligio "que lo
--      programe un desarrollador" en vez de escribir una formula-), activo
--      (interruptor administrativo inmediato) y las 2 fechas de vigencia
--      legal (se validan contra la fecha del PERIODO que se calcula, no
--      contra "hoy" - ver motorCalculo.ts).
--   2) detalle_planilla_conceptos: tabla nueva para guardar el monto de
--      cada concepto PERSONALIZADO calculado en cada boleta (los conceptos
--      originales siguen usando sus columnas propias en detalle_planilla,
--      sin cambios - se acepta esta inconsistencia para no arriesgar el
--      calculo de los conceptos ya en produccion).
--   3) configuracion_seguridad: una fila unica con el hash (bcrypt) de la
--      "clave secundaria de formulas" - un candado APARTE del usuario/rol
--      de sesion, obligatorio para crear/editar/eliminar un concepto con
--      formula, incluso para el ADMIN (el rol ADMIN tiene un permiso
--      comodin "*" que pasa cualquier chequeo de permiso normal - ver
--      src/authMiddleware.ts - por eso este candado es un mecanismo
--      aparte, no un permiso mas del catalogo de Roles). NULL = todavia no
--      configurada (primer uso: un ADMIN debe configurarla antes de poder
--      crear el primer concepto con formula).
-- =========================================================================

ALTER TABLE conceptos_planilla
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'INGRESO'
        CHECK (tipo IN ('INGRESO', 'APORTE', 'DESCUENTO')),
    ADD COLUMN IF NOT EXISTS formula TEXT,
    ADD COLUMN IF NOT EXISTS es_personalizado BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS estado VARCHAR(30) NOT NULL DEFAULT 'ACTIVO'
        CHECK (estado IN ('ACTIVO', 'PENDIENTE_DESARROLLO')),
    ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS vigente_desde DATE,
    ADD COLUMN IF NOT EXISTS vigente_hasta DATE;

COMMENT ON COLUMN conceptos_planilla.tipo IS
    'INGRESO/APORTE/DESCUENTO. Los 14+ conceptos originales (es_personalizado=false) son todos INGRESO por compatibilidad, pero ese campo no se usa para ellos (su formula sigue fija en motorCalculo.ts).';
COMMENT ON COLUMN conceptos_planilla.formula IS
    'Formula tipo Excel (ver src/formulas.ts), solo para es_personalizado=true y estado=ACTIVO. NULL en los conceptos originales y en los PENDIENTE_DESARROLLO.';
COMMENT ON COLUMN conceptos_planilla.activo IS
    'Interruptor administrativo inmediato (independiente de vigente_desde/vigente_hasta) - solo tiene sentido para es_personalizado=true. Los conceptos originales quedan siempre en true.';

CREATE TABLE IF NOT EXISTS detalle_planilla_conceptos (
    id              SERIAL PRIMARY KEY,
    detalle_id      INT NOT NULL REFERENCES detalle_planilla(id) ON DELETE CASCADE,
    concepto_codigo VARCHAR(60) NOT NULL REFERENCES conceptos_planilla(codigo),
    monto           NUMERIC(10,2) NOT NULL DEFAULT 0,
    UNIQUE(detalle_id, concepto_codigo)
);
CREATE INDEX IF NOT EXISTS idx_detalle_planilla_conceptos_detalle ON detalle_planilla_conceptos(detalle_id);
CREATE INDEX IF NOT EXISTS idx_detalle_planilla_conceptos_concepto ON detalle_planilla_conceptos(concepto_codigo);

CREATE TABLE IF NOT EXISTS configuracion_seguridad (
    id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    clave_formulas_hash TEXT,
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO configuracion_seguridad (id, clave_formulas_hash)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------------------
-- IMPORTANTE (leccion aprendida de migraciones anteriores: 019, 020, 022):
-- el usuario de la aplicacion (grupojhc_boletas) es distinto del usuario
-- con el que se corre este script en phpMyAdmin (grupojhc) - crear una
-- tabla no le da automaticamente permiso a otro usuario para usarla ni
-- para usar su secuencia.
-- -------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON detalle_planilla_conceptos TO grupojhc_boletas;
GRANT USAGE, SELECT ON SEQUENCE detalle_planilla_conceptos_id_seq TO grupojhc_boletas;
GRANT SELECT, INSERT, UPDATE ON configuracion_seguridad TO grupojhc_boletas;
