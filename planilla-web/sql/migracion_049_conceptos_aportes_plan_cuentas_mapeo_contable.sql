-- Migracion 049: Catalogo de Aportes/Retenciones (conceptos_aportes), Plan
-- de Cuentas contable (plan_cuentas) y Mapeo Contable (mapeo_cuentas_contables),
-- prerequisito de src/asientoContable.ts (brecha #5 de RECONSTRUCCION_BRECHAS.md)
-- y de la brecha #4.1 (codigos PLAME editables para CUOTA_SINDICAL/CONAFOVICER/
-- RENTA_5TA/ONP/AFP_* en src/plame.ts).
--
-- Igual que con "dias_feriados" (ver la correccion de la migracion 048): esta
-- funcionalidad NUNCA aparecio como archivo .patch en este arbol, pero SI
-- corre en produccion desde el backend_dist que sirvio de fuente para esta
-- reconstruccion (fechado 27-sept-2026) - de hecho, la nota tecnica del
-- despliegue de este proyecto ya registra un error real de permisos con
-- "mapeo_cuentas_contables_id_seq" en produccion, lo que confirma que estas
-- 3 tablas YA EXISTEN alli, con datos reales que el usuario configuro (su
-- Plan de Cuentas y su Mapeo Contable por proyecto). Por lo tanto este
-- archivo sigue el mismo criterio defensivo que la migracion 048:
--   - Cada tabla se crea con "CREATE TABLE IF NOT EXISTS" y el MINIMO
--     indispensable; cada columna adicional se agrega aparte con
--     "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" (nunca todas las columnas
--     en una sola sentencia CREATE TABLE, que Postgres ignora por completo
--     si la tabla ya existe).
--   - Los CHECK/FK/UNIQUE se agregan en bloques DO que primero verifican
--     pg_constraint (Postgres no soporta "ADD CONSTRAINT IF NOT EXISTS").
--   - El catalogo de conceptos_aportes se siembra con
--     "ON CONFLICT (codigo) DO NOTHING": si production ya tiene estas filas
--     (editadas por el usuario, ej. con su propio codigo_plame o nombre),
--     esta migracion NUNCA las sobreescribe.
--   - plan_cuentas y mapeo_cuentas_contables se siembran VACIAS (igual
--     criterio que dias_feriados): son enteramente configurables por el
--     usuario desde Configuracion -> "Configurar por proyecto"; si ya
--     tienen filas en produccion, esta migracion no las toca en absoluto.
--   - Se incluyen los GRANT de tabla Y secuencia para grupojhc_boletas
--     (usuario de la aplicacion) al final de cada seccion, para no repetir
--     el error de permisos de secuencia ya visto antes en este proyecto
--     (ver nota del despliegue: "permiso denegado a la secuencia
--     mapeo_cuentas_contables_id_seq").
--
-- ANTES DE APLICAR EN PRODUCCION: confirmar las columnas actuales de las 3
-- tablas alli, por ejemplo con
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_name IN ('conceptos_aportes', 'plan_cuentas', 'mapeo_cuentas_contables')
--    ORDER BY table_name, ordinal_position;
-- Si ya traen estas mismas columnas (lo esperable, ya que se originan en el
-- mismo backend_dist), este archivo solo completa GRANT/constraints si
-- faltaran, y siembra los codigos de conceptos_aportes que aun no existan.

-- ---------------------------------------------------------------------
-- 1) conceptos_aportes: catalogo de aportes patronales, retenciones al
--    trabajador y "neto a pagar" - no son conceptos de INGRESO (no pasan
--    por conceptos_planilla), pero necesitan nombre + codigo PLAME editable
--    + poder mapearse a una cuenta contable, igual que un concepto de
--    ingreso (ver src/routes/conceptos.ts, GET/PUT /aportes).
--
--    codigo es la propia PRIMARY KEY (sin id/secuencia propia - las rutas
--    de la API siempre identifican estas filas por "codigo", nunca por un
--    id numerico).
--
--    tipo_movimiento NO tiene un CHECK restringido a 'DEBE'/'HABER': el
--    frontend (funcion mx() del bundle de produccion) trata literalmente
--    "DEBE" como "solo Debe", "HABER" como "solo Haber", y CUALQUIER OTRO
--    valor como "Debe y Haber" (para los aportes patronales, que generan
--    una linea al Debe -gasto- y otra al Haber -pasivo- por el mismo
--    monto).
--
--    CORRECCION (verificado en produccion via phpPgAdmin, 29-sept-2026):
--    produccion SI tiene un CHECK aqui (conceptos_aportes_tipo_movimiento_check),
--    con los valores 'DEBE', 'HABER' y 'DEBE_HABER' (confirmado por
--    pg_get_constraintdef). La version original de este archivo usaba
--    'APORTE' como tercer valor (nunca confirmado) - se cambio a
--    'DEBE_HABER' en la semilla de abajo y se agrega el mismo CHECK aqui,
--    porque la version con 'APORTE' rompia la migracion en la practica: el
--    INSERT de la semilla viola el CHECK de produccion ANTES de llegar a
--    evaluar el ON CONFLICT (Postgres valida CHECK por cada fila propuesta,
--    conflicte o no), asi que la migracion completa fallaba y revertia
--    (confirmado reproduciendo el error exacto en una base de prueba con
--    este mismo CHECK). 'DEBE_HABER' no cambia ningun comportamiento del
--    frontend (movimientosDeAporte() en Configuracion.tsx trata CUALQUIER
--    valor que no sea el literal 'DEBE'/'HABER' como "Debe y Haber").
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conceptos_aportes (
    codigo              VARCHAR(60) PRIMARY KEY,
    nombre              VARCHAR(120) NOT NULL
);

ALTER TABLE conceptos_aportes
    ADD COLUMN IF NOT EXISTS descripcion TEXT,
    ADD COLUMN IF NOT EXISTS codigo_plame VARCHAR(10),
    ADD COLUMN IF NOT EXISTS tipo_movimiento VARCHAR(20) NOT NULL DEFAULT 'HABER',
    ADD COLUMN IF NOT EXISTS orden INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conceptos_aportes_tipo_movimiento_check') THEN
        ALTER TABLE conceptos_aportes ADD CONSTRAINT conceptos_aportes_tipo_movimiento_check
            CHECK (tipo_movimiento IN ('DEBE', 'HABER', 'DEBE_HABER'));
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON conceptos_aportes TO grupojhc_boletas;

-- Semilla: 16 filas inferidas de src/asientoContable.ts (construirAsiento -
-- lista aportesPatronales, retenciones, NETO_A_PAGAR) y de src/plame.ts /
-- backend_dist/plame.js (resolverCodigosPlame -> codigoAporte). codigo_plame
-- viene de las constantes CONCEPTO.* ya confirmadas contra archivos .rem
-- reales de esta empresa (ver cabecera de src/plame.ts); NULL donde ese
-- concepto no se declara en el PLAME (los 4 codigos por administradora AFP
-- y el neto a pagar).
INSERT INTO conceptos_aportes (codigo, nombre, descripcion, codigo_plame, tipo_movimiento, orden) VALUES
    -- Aportes patronales (Debe = gasto, Haber = pasivo por pagar; mismo monto en ambos).
    ('ESSALUD',     'ESSALUD',                        'Aporte patronal EsSalud (9%)',                                   '0804', 'DEBE_HABER', 10),
    ('SCTR',        'SCTR salud',                      'Seguro Complementario de Trabajo de Riesgo - salud',             '0806', 'DEBE_HABER', 20),
    ('SENATI',      'Fondo de Capacitacion (SENATI)',  'Aporte patronal SENATI',                                        '0807', 'DEBE_HABER', 30),
    ('SEGURO_VIDA', 'Essalud + Vida',                  'Poliza de vida ley (D.Leg. 688 / convenio EsSalud+Vida)',        '0803', 'DEBE_HABER', 40),
    -- Retenciones al trabajador (solo Haber).
    ('CUOTA_SINDICAL', 'Cuota sindical',               'Retencion de cuota sindical',                                   '0702', 'HABER', 50),
    ('CONAFOVICER',    'CONAFOVICER',                  'Retencion CONAFOVICER (construccion civil)',                    '0602', 'HABER', 60),
    ('RENTA_5TA',       'Renta de 5ta categoria',       'Retencion de renta de quinta categoria',                        '0605', 'HABER', 70),
    ('ONP',              'ONP',                        'Aporte de pension - sistema nacional (ONP, 13%)',               '0607', 'HABER', 80),
    -- Aporte de pension por AFP, desglosado para el PLAME (mismos 3 codigos
    -- SUNAT para cualquier administradora - ver src/plame.ts).
    ('AFP_APORTE_OBLIGATORIO', 'AFP - Aporte obligatorio', 'Aporte de pension AFP: aporte obligatorio',                  '0608', 'HABER', 90),
    ('AFP_COMISION',           'AFP - Comision',           'Aporte de pension AFP: comision de la administradora',       '0601', 'HABER', 100),
    ('AFP_PRIMA_SEGURO',       'AFP - Prima de seguro',    'Aporte de pension AFP: prima de seguro',                     '0606', 'HABER', 110),
    -- Aporte de pension por AFP, por administradora (usado por el asiento
    -- contable para retener el monto TOTAL de la AFP hacia la cuenta de esa
    -- administradora especifica - no se declara aparte en el PLAME, que ya
    -- usa los 3 codigos desglosados de arriba).
    ('AFP_INTEGRA',    'AFP Integra',    'Retencion de aporte de pension - AFP Integra',    NULL, 'HABER', 120),
    ('AFP_PRIMA',       'AFP Prima',      'Retencion de aporte de pension - AFP Prima',      NULL, 'HABER', 130),
    ('AFP_PROFUTURO',  'AFP Profuturo',  'Retencion de aporte de pension - AFP Profuturo',  NULL, 'HABER', 140),
    ('AFP_HABITAT',     'AFP Habitat',    'Retencion de aporte de pension - AFP Habitat',    NULL, 'HABER', 150),
    -- Neto a pagar: balancea el asiento (Haber).
    ('NETO_A_PAGAR', 'Neto a pagar', 'Neto a pagar al trabajador (balancea el asiento)', NULL, 'HABER', 160)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2) plan_cuentas: catalogo de cuentas contables, editable por el usuario
--    desde Configuracion -> "Plan de cuentas". El codigo NO es unico (la
--    empresa reutiliza codigos entre denominaciones distintas - ver
--    src/routes/conceptos.ts, seccion "Plan de Cuentas contable"), asi que
--    no lleva UNIQUE ni se valida unicidad de codigo en la API.
--    Sembrada VACIA: el usuario la llena el mismo (igual criterio que
--    dias_feriados).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_cuentas (
    id  SERIAL PRIMARY KEY
);

ALTER TABLE plan_cuentas
    ADD COLUMN IF NOT EXISTS codigo VARCHAR(20) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS denominacion VARCHAR(200) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS activa BOOLEAN NOT NULL DEFAULT true,
    -- CORRECCION (verificado en produccion via phpPgAdmin, 29-sept-2026):
    -- plan_cuentas YA TIENE alli una columna "creado_en" que esta version
    -- original no contemplaba (mismo hallazgo que en dias_feriados/048). Se
    -- agrega aqui (no-op en produccion) y el INSERT de routes/conceptos.ts
    -- ahora la llena explicitamente con now(), para no depender de que el
    -- DEFAULT de produccion exista.
    ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT now();

-- El DEFAULT '' de arriba es solo para poder agregar la columna NOT NULL en
-- una tabla que ya tuviera filas (no aplica en la practica: plan_cuentas se
-- siembra vacia); no se inserta ninguna fila con ese valor por defecto.

GRANT SELECT, INSERT, UPDATE, DELETE ON plan_cuentas TO grupojhc_boletas;
GRANT USAGE, SELECT ON SEQUENCE plan_cuentas_id_seq TO grupojhc_boletas;

-- ---------------------------------------------------------------------
-- 3) mapeo_cuentas_contables: concepto x proyecto x movimiento -> cuenta
--    contable, usado por src/asientoContable.ts para armar el asiento
--    consolidado del periodo. concepto_codigo puede venir de
--    conceptos_planilla O de conceptos_aportes - se valida contra ambas
--    tablas en la API (no hay una FK real posible entre dos origenes
--    distintos, ver src/routes/conceptos.ts). Sembrada VACIA: el usuario la
--    llena desde Configuracion -> "Configurar por proyecto".
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mapeo_cuentas_contables (
    id  SERIAL PRIMARY KEY
);

ALTER TABLE mapeo_cuentas_contables
    ADD COLUMN IF NOT EXISTS concepto_codigo VARCHAR(60) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS proyecto_id INT,
    ADD COLUMN IF NOT EXISTS tipo_movimiento VARCHAR(10) NOT NULL DEFAULT 'DEBE',
    ADD COLUMN IF NOT EXISTS cuenta_id INT,
    ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mapeo_cuentas_contables_proyecto_id_fkey') THEN
        ALTER TABLE mapeo_cuentas_contables ADD CONSTRAINT mapeo_cuentas_contables_proyecto_id_fkey
            FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mapeo_cuentas_contables_cuenta_id_fkey') THEN
        ALTER TABLE mapeo_cuentas_contables ADD CONSTRAINT mapeo_cuentas_contables_cuenta_id_fkey
            FOREIGN KEY (cuenta_id) REFERENCES plan_cuentas(id) ON DELETE CASCADE;
    END IF;
    -- tipo_movimiento SI se valida estricto en la API (routes/conceptos.ts,
    -- PUT /mapeo-contable: solo admite 'DEBE' o 'HABER'), asi que reforzar
    -- el mismo CHECK en la base de datos no arriesga datos reales.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mapeo_cuentas_contables_tipo_movimiento_check') THEN
        ALTER TABLE mapeo_cuentas_contables ADD CONSTRAINT mapeo_cuentas_contables_tipo_movimiento_check
            CHECK (tipo_movimiento IN ('DEBE', 'HABER'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mapeo_cuentas_contables_concepto_codigo_proyecto_id_tipo_mo_key') THEN
        ALTER TABLE mapeo_cuentas_contables ADD CONSTRAINT mapeo_cuentas_contables_concepto_codigo_proyecto_id_tipo_mo_key
            UNIQUE (concepto_codigo, proyecto_id, tipo_movimiento);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mapeo_cuentas_contables_proyecto ON mapeo_cuentas_contables(proyecto_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON mapeo_cuentas_contables TO grupojhc_boletas;
GRANT USAGE, SELECT ON SEQUENCE mapeo_cuentas_contables_id_seq TO grupojhc_boletas;
