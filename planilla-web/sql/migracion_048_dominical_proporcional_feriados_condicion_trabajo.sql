-- Migracion 048: reconstruccion consolidada de las migraciones originales
-- 022 (feriado no laborado), 023 (dominical proporcional), 026 (condicion
-- de trabajo) y el catalogo "dias_feriados" con su ambito geografico
-- (migracion 042, parte que faltaba - la parte de ubigeo en "proyectos" ya
-- se habia reconstruido antes, ver parche #31/46).
--
-- A diferencia del resto de este arbol (reconstruido aplicando archivos
-- .patch recuperados), estas migraciones nunca aparecieron como parche:
-- fueron identificadas como brecha #4/#4.1 en RECONSTRUCCION_BRECHAS.md
-- y se reconstruyen ahora leyendo el codigo YA COMPILADO de produccion
-- (carpeta backend_dist que el usuario subio en su momento, dist/*.js,
-- fechado 27-sept-2026) como fuente de verdad, en vez de un .patch. La
-- logica de negocio (formulas, comentarios, redondeos) se copio fiel del
-- .js compilado; solo se le devolvieron los tipos/nombres de variable
-- propios de TypeScript.
--
-- No destructiva: crea tabla nueva (dias_feriados, sembrada VACIA - el
-- usuario la llena con las fechas oficiales de cada año desde
-- Configuracion) y agrega columnas nuevas con DEFAULT 0/NULL, no toca
-- ninguna columna existente ni ningun monto ya calculado.
--
-- CORRECCION (revision posterior a la 048): "dias_feriados" es una tabla
-- que YA EXISTE en produccion (la funcionalidad completa viene corriendo
-- ahi desde el backend_dist que sirvio de fuente para esta reconstruccion -
-- ver la cabecera de este archivo). Un simple "CREATE TABLE IF NOT EXISTS"
-- con TODAS las columnas en la misma sentencia NO ES SUFICIENTE: si la
-- tabla ya existe, Postgres ignora la sentencia COMPLETA (no agrega las
-- columnas que le falten), y el sistema quedaria escribiendo/leyendo
-- columnas que en realidad no estan ahi. Por eso, igual criterio que la
-- migracion 044 (ver su propia correccion): la tabla se crea con el minimo
-- indispensable y cada columna/constraint nueva se agrega por separado con
-- su propio guard (ADD COLUMN IF NOT EXISTS / DO-block para el CHECK),
-- de forma que el resultado final es el mismo sin importar si la tabla ya
-- existia (con estas mismas columnas, con menos, o no existia en absoluto).
--
-- ANTES DE APLICAR EN PRODUCCION: confirmar las columnas actuales de
-- "dias_feriados" alli con
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'dias_feriados' ORDER BY ordinal_position;
-- Si ya trae "ambito"/"ubigeo_*" con esos mismos nombres (lo esperable, ya
-- que se origina en el mismo backend_dist), este archivo no hace nada mas
-- que completar los GRANT/indice si faltaran. Si trajera columnas con
-- otro nombre o tipo distinto, avisar antes de continuar.

-- ---------------------------------------------------------------------
-- 1) Catalogo de feriados (migracion 022 + ambito geografico de 042)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dias_feriados (
    id                          SERIAL PRIMARY KEY,
    fecha                       DATE NOT NULL,
    descripcion                 VARCHAR(200) NOT NULL
);

ALTER TABLE dias_feriados
    ADD COLUMN IF NOT EXISTS ambito VARCHAR(10) NOT NULL DEFAULT 'NACIONAL',
    ADD COLUMN IF NOT EXISTS ubigeo_departamento_codigo VARCHAR(2),
    ADD COLUMN IF NOT EXISTS ubigeo_provincia_codigo VARCHAR(4),
    ADD COLUMN IF NOT EXISTS ubigeo_distrito_codigo VARCHAR(6),
    -- CORRECCION (verificado en produccion via phpPgAdmin, 29-sept-2026):
    -- dias_feriados YA TIENE alli una columna "creado_en" que esta version
    -- original de la migracion no contemplaba. No sabemos si en produccion
    -- es NOT NULL sin DEFAULT (rompería el POST si no se envia un valor),
    -- asi que ademas de agregarla aqui (no-op en produccion, donde ya
    -- existe) el INSERT de routes/conceptos.ts ahora la llena explicitamente
    -- con now() para cubrir cualquier caso.
    ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT now();

-- Los CHECK/FK se agregan aparte (Postgres no soporta "ADD CONSTRAINT IF
-- NOT EXISTS"): un bloque DO que primero verifica en pg_constraint, para
-- que una segunda ejecucion (o una tabla que ya traia estas columnas de
-- produccion) no falle con "constraint ya existe".
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dias_feriados_ambito_check') THEN
        ALTER TABLE dias_feriados ADD CONSTRAINT dias_feriados_ambito_check
            CHECK (ambito IN ('NACIONAL', 'REGIONAL', 'LOCAL'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dias_feriados_ubigeo_departamento_codigo_fkey') THEN
        ALTER TABLE dias_feriados ADD CONSTRAINT dias_feriados_ubigeo_departamento_codigo_fkey
            FOREIGN KEY (ubigeo_departamento_codigo) REFERENCES catalogo_ubigeo_departamento(codigo);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dias_feriados_ubigeo_provincia_codigo_fkey') THEN
        ALTER TABLE dias_feriados ADD CONSTRAINT dias_feriados_ubigeo_provincia_codigo_fkey
            FOREIGN KEY (ubigeo_provincia_codigo) REFERENCES catalogo_ubigeo_provincia(codigo);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dias_feriados_ubigeo_distrito_codigo_fkey') THEN
        ALTER TABLE dias_feriados ADD CONSTRAINT dias_feriados_ubigeo_distrito_codigo_fkey
            FOREIGN KEY (ubigeo_distrito_codigo) REFERENCES catalogo_ubigeo_distrito(codigo);
    END IF;
    -- Un NACIONAL no lleva ubicacion; un REGIONAL lleva solo departamento;
    -- un LOCAL lleva al menos provincia (distrito opcional) - validado
    -- tambien en la API (routes/conceptos.ts) para dar un mensaje claro,
    -- pero se refuerza aqui por si se edita la tabla directo.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dias_feriados_ambito_ubicacion_check') THEN
        ALTER TABLE dias_feriados ADD CONSTRAINT dias_feriados_ambito_ubicacion_check CHECK (
            (ambito = 'NACIONAL' AND ubigeo_departamento_codigo IS NULL AND ubigeo_provincia_codigo IS NULL AND ubigeo_distrito_codigo IS NULL)
            OR (ambito = 'REGIONAL' AND ubigeo_departamento_codigo IS NOT NULL AND ubigeo_provincia_codigo IS NULL AND ubigeo_distrito_codigo IS NULL)
            OR (ambito = 'LOCAL' AND ubigeo_provincia_codigo IS NOT NULL)
        );
    END IF;
END $$;

-- Evita registrar 2 veces el mismo feriado con el mismo alcance/ubicacion
-- (COALESCE para que el indice unico funcione con NULLs, que Postgres no
-- trata como iguales entre si por defecto).
CREATE UNIQUE INDEX IF NOT EXISTS idx_dias_feriados_unico
    ON dias_feriados (fecha, ambito, COALESCE(ubigeo_departamento_codigo, ''), COALESCE(ubigeo_provincia_codigo, ''), COALESCE(ubigeo_distrito_codigo, ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON dias_feriados TO grupojhc_boletas;
GRANT USAGE, SELECT ON SEQUENCE dias_feriados_id_seq TO grupojhc_boletas;

-- ---------------------------------------------------------------------
-- 2) asistencia_periodo: dias_feriado_trabajado (subconjunto SI trabajado
--    de dias_feriado, usado para la sobretasa) y dias_dominical_no_laborado
--    (prorrateo del descanso semanal, migracion 023).
-- ---------------------------------------------------------------------
ALTER TABLE asistencia_periodo
    ADD COLUMN IF NOT EXISTS dias_feriado_trabajado NUMERIC(6,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dias_dominical_no_laborado NUMERIC(6,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- 3) detalle_planilla: las mismas 2 columnas de asistencia (para que
--    Boleta/Reportes puedan mostrar el desglose de ESE periodo calculado,
--    igual criterio que dias_subsidio_maternidad/dias_licencia_paternidad
--    de la migracion 027) + los montos nuevos que arma calcularLineaPlanilla.
-- ---------------------------------------------------------------------
ALTER TABLE detalle_planilla
    ADD COLUMN IF NOT EXISTS dias_feriado_trabajado NUMERIC(6,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dias_dominical_no_laborado NUMERIC(6,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS remuneracion_dominical_proporcional NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sobretasa_dominical NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sobretasa_feriado NUMERIC(10,2) NOT NULL DEFAULT 0,
    -- Migracion 026: monto FIJO por contrato (ver columna nueva en
    -- "contratos" mas abajo), copiado tal cual a cada boleta del periodo -
    -- se guarda tambien aqui (y no solo en contratos) por el mismo motivo
    -- que el resto de detalle_planilla: es una FOTO del monto vigente ese
    -- periodo especifico, para que un cambio posterior en el contrato no
    -- altere boletas ya calculadas.
    ADD COLUMN IF NOT EXISTS condicion_trabajo NUMERIC(10,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- 4) contratos: monto fijo de "condicion de trabajo" (D.S. 003-97-TR,
--    migracion 026) - no remunerativo, no se prorratea, no se declara en
--    el PLAME (ver plame.ts / conceptos_planilla.CONDICION_TRABAJO, con
--    todos sus afecto_* en false).
-- ---------------------------------------------------------------------
ALTER TABLE contratos
    ADD COLUMN IF NOT EXISTS condicion_trabajo NUMERIC(10,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- 4.1) detalle_planilla_mensual: le faltaba "dias_feriado_trabajado" (el
--      resto de columnas de esta infraestructura ya se habian agregado en
--      una reconstruccion anterior, ver RECONSTRUCCION_BRECHAS.md).
-- ---------------------------------------------------------------------
ALTER TABLE detalle_planilla_mensual
    ADD COLUMN IF NOT EXISTS dias_feriado_trabajado NUMERIC(6,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- 5) conceptos_planilla: nuevos conceptos SOBRETASA_DOMINICAL/
--    SOBRETASA_FERIADO/CONDICION_TRABAJO, y el factor3 nuevo de
--    GRATIFICACION (denominador del tramo agosto-diciembre - antes solo
--    tenia UN denominador en factor2, para todo el año).
-- ---------------------------------------------------------------------
INSERT INTO conceptos_planilla
    (codigo, nombre, descripcion, orden,
     factor1, factor1_etiqueta, factor2, factor2_etiqueta, factor3, factor3_etiqueta,
     afecto_essalud, afecto_sctr, afecto_senati, afecto_onp, afecto_afp, afecto_renta5ta, afecto_conafovicer)
SELECT * FROM (VALUES
    ('SOBRETASA_DOMINICAL', 'Sobretasa por trabajo en dia de descanso (domingo)', 'Recargo legal (D.Leg. 713) por trabajar el dia de descanso semanal sin sustitutorio: 100% adicional sobre el jornal, ademas de la Remuneracion Dominical.', 22,
     1.00, 'Recargo sobre el jornal (multiplicador, 1.00 = 100%)', NULL::numeric, NULL::varchar, NULL::numeric, NULL::varchar,
     true, true, true, true, true, true::boolean, true),

    ('SOBRETASA_FERIADO', 'Sobretasa por trabajo en feriado', 'Recargo legal (D.Leg. 713) por trabajar un feriado sin sustitutorio: junto con la Remuneracion Feriado (pago garantizado) completa el "pago triple" (100% pago del dia + 100% por el trabajo + 100% de sobretasa).', 32,
     2.00, 'Recargo sobre el jornal de los dias feriado TRABAJADOS (multiplicador, 2.00 = 200%)', NULL, NULL, NULL, NULL,
     true, true, true, true, true, true, false),

    ('CONDICION_TRABAJO', 'Condicion de trabajo', 'Monto fijo mensual por contrato (D.S. 003-97-TR), configurado en Contratos. No remunerativo: no afecta ningun aporte ni se declara en el PLAME.', 105,
     NULL, NULL, NULL, NULL, NULL, NULL,
     false, false, false, false, false, false, false)
) AS datos(codigo, nombre, descripcion, orden, factor1, factor1_etiqueta, factor2, factor2_etiqueta, factor3, factor3_etiqueta,
           afecto_essalud, afecto_sctr, afecto_senati, afecto_onp, afecto_afp, afecto_renta5ta, afecto_conafovicer)
WHERE NOT EXISTS (SELECT 1 FROM conceptos_planilla WHERE conceptos_planilla.codigo = datos.codigo);

-- GRATIFICACION pasa a tener 2 denominadores (enero-julio / agosto-diciembre,
-- ver el comentario completo en motorCalculo.ts): factor2 se queda con el
-- de enero-julio (ya sembrado en 210 desde la migracion 014, sin cambios) y
-- se agrega factor3 = 150 (agosto-diciembre) SOLO si todavia esta vacio -
-- para no pisar un valor que el usuario ya haya editado a mano si esta
-- migracion se corre por segunda vez o en una base que ya lo tuviera.
UPDATE conceptos_planilla
SET factor2_etiqueta = 'Denominador dias ENERO-JULIO (solo construccion civil)',
    factor3 = 150,
    factor3_etiqueta = 'Denominador dias AGOSTO-DICIEMBRE (solo construccion civil)'
WHERE codigo = 'GRATIFICACION' AND factor3 IS NULL;
