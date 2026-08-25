-- Migracion 008: nuevas columnas en detalle_planilla para los beneficios de
-- construccion civil que se pagan cada periodo (verificados contra boletas
-- reales de la empresa): asignacion escolar, BAE, movilidad, y la
-- bonificacion extraordinaria Ley 29351/30334 (9% de la gratificacion).
-- No destructiva: solo agrega columnas nuevas con DEFAULT 0.

ALTER TABLE detalle_planilla
  ADD COLUMN IF NOT EXISTS asignacion_escolaridad NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonificacion_bae NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonificacion_movilidad NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonificacion_extraordinaria NUMERIC(10,2) NOT NULL DEFAULT 0;

-- El campo "senati" (columna "Fondo Capacitacion" en la boleta real de la
-- empresa) usa 0.45% verificado contra boletas reales, no el 0.75% legal de
-- SENATI que tenia el sistema. Solo se corrige si sigue en el valor viejo
-- (no pisa un valor que el admin ya haya editado a mano en Parametros).
UPDATE parametros_normativos SET tasa_senati = 0.0045 WHERE tasa_senati = 0.0075;
