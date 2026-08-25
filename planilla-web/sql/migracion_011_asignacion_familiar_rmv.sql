-- Migracion 011: la asignacion familiar (solo aplica a Empleados, regimen
-- general) ya NO se lee de la columna parametros_normativos.asignacion_familiar
-- (un monto fijo que habia que editar a mano) - ahora se calcula SIEMPRE
-- como 10% de la RMV (remuneracion_minima_vital), tal como exige la ley.
--
-- Si tu remuneracion_minima_vital todavia esta en 0 (quedo asi a proposito
-- cuando se creo el sistema, porque no se tenia el valor confirmado), esto
-- la deja en S/1,130 (RMV vigente) para que la asignacion familiar de tus
-- Empleados no salga en 0. Si ya la habias corregido tu mismo desde la
-- pestaña Parametros, esto NO la toca.

UPDATE parametros_normativos SET remuneracion_minima_vital = 1130.00 WHERE remuneracion_minima_vital = 0;
