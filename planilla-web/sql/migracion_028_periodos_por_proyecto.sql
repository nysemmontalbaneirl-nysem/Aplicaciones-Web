-- Migracion 028 (Ronda C): periodos de planilla por proyecto.
--
-- Hasta ahora un periodo (mes/quincena/semana) era global: mezclaba
-- contratos de TODOS los proyectos/obras. Esto complicaba coordinar
-- quincenas/semanas que se acuerdan distinto por obra. Se agrega
-- periodos_planilla.proyecto (texto libre, igual que contratos.proyecto -
-- no es una FK, mismo criterio ya usado ahi para no inventar una relacion
-- mas estricta de la que ya existe hoy).
--
-- Decision confirmada con el usuario: los periodos YA EXISTENTES quedan
-- con proyecto NULL ("periodo legado / todos los proyectos") de forma
-- PERMANENTE - no se migran datos ni se le pide al usuario asignarles un
-- proyecto a mano. La exigencia de elegir un proyecto aplica solo a los
-- periodos que se creen de ahora en adelante (validado en
-- routes/periodos.ts, no con un NOT NULL de columna - asi no se rompen
-- los datos existentes ni se obliga a un DEFAULT arbitrario).
--
-- No destructiva: se puede correr sobre la base real sin perder datos.

ALTER TABLE periodos_planilla
    ADD COLUMN IF NOT EXISTS proyecto VARCHAR(150);

-- Los 2 indices unicos existentes se recrean incluyendo "proyecto", para
-- que 2 proyectos distintos puedan tener periodos con las mismas fechas
-- (antes, dos periodos identicos en fechas pero de obras distintas
-- chocaban entre si). Se usa COALESCE(proyecto,'') en vez de dejar que
-- Postgres trate cada NULL como distinto (comportamiento normal de un
-- UNIQUE en Postgres), porque de lo contrario 2 periodos legado con las
-- mismas fechas exactas (hoy imposible, pero por seguridad) podrian
-- duplicarse sin que el indice lo evite.
DROP INDEX IF EXISTS periodos_planilla_periodo_unico;
CREATE UNIQUE INDEX periodos_planilla_periodo_unico
    ON periodos_planilla (anio, mes, tipo, COALESCE(quincena, 0), COALESCE(proyecto, ''))
    WHERE tipo <> 'SEMANAL';

DROP INDEX IF EXISTS periodos_planilla_semanal_unico;
CREATE UNIQUE INDEX periodos_planilla_semanal_unico
    ON periodos_planilla (fecha_inicio, fecha_fin, COALESCE(proyecto, ''))
    WHERE tipo = 'SEMANAL';
