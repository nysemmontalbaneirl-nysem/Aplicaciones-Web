-- Migracion 043: separa el limite de tareo por CONCEPTO (jornal normal, y
-- cada tramo de horas extra por separado), a pedido explicito del usuario
-- (sept. 2026): antes, el jornal normal y las 3 columnas de horas extra
-- compartian un solo tope combinado (se validaba la SUMA de TODAS las
-- columnas de horas del dia contra un unico limite) - esto bloqueaba
-- registrar horas extra en cuanto el jornal normal ya llegaba al limite
-- configurado, impidiendo declarar sobretiempo real.
--
-- Decisiones confirmadas con el usuario:
-- 1) Domingo trabajado y Feriado trabajado quedan SIN limite (mismo
--    criterio que ya tenia Domingo: "ya se paga aparte") - antes Feriado
--    trabajado SI entraba en la suma combinada, ahora tampoco se valida.
-- 2) Las horas extra tienen un limite INDEPENDIENTE por cada tramo (60%,
--    100%, 100%), no un limite combinado entre los 3.
--
-- Se renombran las 4 columnas existentes (jornal normal, lunes a viernes y
-- sabado) para no perder los valores que el usuario ya tuviera configurados
-- en produccion, y se agregan 12 columnas nuevas (3 tramos x 2 tipos de dia
-- x horas/minutos). Los defaults de los tramos nuevos (4 horas, 0 minutos)
-- son solo un punto de partida - el usuario los ajusta desde Configuracion
-- -> "Limites de tareo" segun sus necesidades operativas reales.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'limites_tareo' AND column_name = 'horas_max_lun_vie'
    ) THEN
        ALTER TABLE limites_tareo RENAME COLUMN horas_max_lun_vie TO horas_max_normal_lun_vie;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'limites_tareo' AND column_name = 'minutos_max_lun_vie'
    ) THEN
        ALTER TABLE limites_tareo RENAME COLUMN minutos_max_lun_vie TO minutos_max_normal_lun_vie;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'limites_tareo' AND column_name = 'horas_max_sabado'
    ) THEN
        ALTER TABLE limites_tareo RENAME COLUMN horas_max_sabado TO horas_max_normal_sabado;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'limites_tareo' AND column_name = 'minutos_max_sabado'
    ) THEN
        ALTER TABLE limites_tareo RENAME COLUMN minutos_max_sabado TO minutos_max_normal_sabado;
    END IF;
END $$;

ALTER TABLE limites_tareo
    ADD COLUMN IF NOT EXISTS horas_max_tramo1_lun_vie   SMALLINT NOT NULL DEFAULT 4 CHECK (horas_max_tramo1_lun_vie BETWEEN 0 AND 24),
    ADD COLUMN IF NOT EXISTS minutos_max_tramo1_lun_vie SMALLINT NOT NULL DEFAULT 0 CHECK (minutos_max_tramo1_lun_vie BETWEEN 0 AND 59),
    ADD COLUMN IF NOT EXISTS horas_max_tramo1_sabado    SMALLINT NOT NULL DEFAULT 4 CHECK (horas_max_tramo1_sabado BETWEEN 0 AND 24),
    ADD COLUMN IF NOT EXISTS minutos_max_tramo1_sabado  SMALLINT NOT NULL DEFAULT 0 CHECK (minutos_max_tramo1_sabado BETWEEN 0 AND 59),
    ADD COLUMN IF NOT EXISTS horas_max_tramo2_lun_vie   SMALLINT NOT NULL DEFAULT 4 CHECK (horas_max_tramo2_lun_vie BETWEEN 0 AND 24),
    ADD COLUMN IF NOT EXISTS minutos_max_tramo2_lun_vie SMALLINT NOT NULL DEFAULT 0 CHECK (minutos_max_tramo2_lun_vie BETWEEN 0 AND 59),
    ADD COLUMN IF NOT EXISTS horas_max_tramo2_sabado    SMALLINT NOT NULL DEFAULT 4 CHECK (horas_max_tramo2_sabado BETWEEN 0 AND 24),
    ADD COLUMN IF NOT EXISTS minutos_max_tramo2_sabado  SMALLINT NOT NULL DEFAULT 0 CHECK (minutos_max_tramo2_sabado BETWEEN 0 AND 59),
    ADD COLUMN IF NOT EXISTS horas_max_tramo3_lun_vie   SMALLINT NOT NULL DEFAULT 4 CHECK (horas_max_tramo3_lun_vie BETWEEN 0 AND 24),
    ADD COLUMN IF NOT EXISTS minutos_max_tramo3_lun_vie SMALLINT NOT NULL DEFAULT 0 CHECK (minutos_max_tramo3_lun_vie BETWEEN 0 AND 59),
    ADD COLUMN IF NOT EXISTS horas_max_tramo3_sabado    SMALLINT NOT NULL DEFAULT 4 CHECK (horas_max_tramo3_sabado BETWEEN 0 AND 24),
    ADD COLUMN IF NOT EXISTS minutos_max_tramo3_sabado  SMALLINT NOT NULL DEFAULT 0 CHECK (minutos_max_tramo3_sabado BETWEEN 0 AND 59);
