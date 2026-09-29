-- Migracion 041: apellido paterno / apellido materno / nombres por separado
-- en empleados.
--
-- Contexto (18/09/2026): el usuario pidio implementar la generacion del
-- archivo OFICIAL que se sube a AFPnet (Excel con estructura fija, ver
-- "MODELO DE ESTRUCTURA AFP" del archivo que adjunto). Esa estructura exige
-- el apellido paterno, el apellido materno y los nombres en 3 columnas
-- separadas - el sistema hoy solo guarda "apellidos_nombres" en un unico
-- campo de texto libre. El usuario confirmo explicitamente agregar estos 3
-- campos nuevos al trabajador (en vez de intentar partir el texto libre por
-- reglas automaticas, que fallarian con apellidos compuestos).
--
-- "apellidos_nombres" NO se toca ni se reemplaza - sigue siendo el campo
-- maestro que usa el resto del sistema (boletas, reportes, tareo, etc.).
-- Estos 3 campos son ADICIONALES y no retroactivos: quedan en NULL para los
-- empleados ya cargados, hasta que se editen a mano desde Trabajadores (o se
-- carguen en una alta/edicion nueva). El export de AFPnet avisa (sin
-- bloquear la descarga, ya que AFPnet los marca como "dato referencial", no
-- obligatorio) que trabajadores todavia no tienen estos 3 campos completos.
ALTER TABLE empleados
    ADD COLUMN IF NOT EXISTS apellido_paterno VARCHAR(100),
    ADD COLUMN IF NOT EXISTS apellido_materno VARCHAR(100),
    ADD COLUMN IF NOT EXISTS nombres VARCHAR(150);

-- Columnas en una tabla ya existente - no hace falta GRANT nuevo
-- (grupojhc_boletas ya tiene permisos sobre "empleados").
