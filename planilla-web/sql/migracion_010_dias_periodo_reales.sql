-- Migracion 010: corrige dias_periodo para que sea siempre los dias
-- calendario REALES entre fecha_inicio y fecha_fin (28, 29, 30 o 31), no un
-- valor fijo de 30 (bug real: tanto el frontend como el backend guardaban
-- 30 fijo sin importar el mes, lo que hacia mal el prorrateo de sueldo de
-- Empleados y la asignacion familiar en cualquier mes que no fuera de 30
-- dias). No destructiva: solo recalcula esta columna a partir de las fechas
-- que ya tiene cada periodo.

UPDATE periodos_planilla
SET dias_periodo = (fecha_fin::date - fecha_inicio::date + 1);
