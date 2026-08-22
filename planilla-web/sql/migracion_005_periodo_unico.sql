-- =========================================================================
-- Migracion 005: corrige la restriccion de periodo unico.
--
-- El UNIQUE(anio, mes, quincena, tipo) original no evitaba crear dos
-- periodos MENSUAL del mismo mes, porque en Postgres dos valores NULL
-- (la quincena es NULL cuando el periodo es mensual) nunca se consideran
-- iguales para un UNIQUE normal. Se reemplaza por un indice unico que
-- trata la quincena NULL como un valor fijo (0).
--
-- No destructivo: no borra ningun periodo existente.
-- =========================================================================

ALTER TABLE periodos_planilla DROP CONSTRAINT IF EXISTS periodos_planilla_anio_mes_quincena_tipo_key;

DROP INDEX IF EXISTS periodos_planilla_periodo_unico;
CREATE UNIQUE INDEX periodos_planilla_periodo_unico
    ON periodos_planilla (anio, mes, tipo, COALESCE(quincena, 0));
