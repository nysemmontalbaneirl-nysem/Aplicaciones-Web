-- =========================================================================
-- Migracion 018: soporte para periodos SEMANALES (y habilita QUINCENAL
-- desde la interfaz, que hasta ahora no tenia forma de crearse).
--
-- periodos_planilla.tipo ya es VARCHAR(20) libre (sin CHECK), asi que ya
-- acepta el valor 'SEMANAL' sin necesidad de tocar la columna.
--
-- Lo que si falta es una regla de unicidad para SEMANAL: el indice ya
-- existente periodos_planilla_periodo_unico (anio, mes, tipo,
-- COALESCE(quincena,0)) solo tiene 3 "huecos" por mes y tipo (mensual,
-- quincena 1, quincena 2) y no alcanza para los obreros de jornal
-- (construccion civil) que se pagan de forma semanal, donde puede haber
-- hasta 4+ periodos en un mismo mes con fechas de inicio flexibles segun
-- lo acuerde cada obra/proyecto (no necesariamente alineadas a lunes, y
-- pudiendo cruzar el fin de mes).
--
-- Se agrega un indice unico PARCIAL nuevo, solo para tipo = 'SEMANAL',
-- sobre el rango de fechas real. Esto evita crear dos veces el mismo rango
-- exacto de fechas; no evita rangos superpuestos entre proyectos
-- distintos, porque los periodos siguen siendo globales (no estan
-- asociados a un proyecto/obra), igual que en el diseño original.
--
-- IMPORTANTE: el indice existente periodos_planilla_periodo_unico
-- (anio, mes, tipo, COALESCE(quincena,0)) hay que reconstruirlo como
-- parcial EXCLUYENDO 'SEMANAL' (no se puede agregar un WHERE a un indice
-- existente, hay que recrearlo). Si no se hace esto, ese indice viejo
-- seguiria bloqueando un segundo periodo SEMANAL en el mismo mes sin
-- siquiera llegar a mirar las fechas, porque todos los periodos SEMANALES
-- de un mismo mes comparten el mismo (anio, mes, tipo='SEMANAL',
-- quincena=NULL) - MENSUAL y QUINCENAL no se ven afectados, siguen
-- funcionando exactamente igual que antes.
--
-- No destructiva: no borra ni modifica ninguna fila existente, solo
-- reconstruye un indice y agrega uno nuevo.
-- =========================================================================

DROP INDEX IF EXISTS periodos_planilla_periodo_unico;
CREATE UNIQUE INDEX IF NOT EXISTS periodos_planilla_periodo_unico
    ON periodos_planilla (anio, mes, tipo, COALESCE(quincena, 0))
    WHERE tipo <> 'SEMANAL';

CREATE UNIQUE INDEX IF NOT EXISTS periodos_planilla_semanal_unico
    ON periodos_planilla (fecha_inicio, fecha_fin)
    WHERE tipo = 'SEMANAL';
