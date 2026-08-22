-- =========================================================================
-- Migracion 004: amplia columnas de empleados que resultaron muy cortas
-- para los datos reales al importar los 3283 trabajadores desde
-- DATA_JHCR.xlsm.
--
-- - ubigeo: el dato real es texto de ubicacion (distrito-provincia-
--   departamento), no un codigo numerico de 6 digitos, asi que 10
--   caracteres no alcanzaban.
-- - cuenta_bancaria: algunos registros traen cuenta + CCI concatenados.
--
-- No destructivo: solo amplia el tamano de columnas existentes, no borra
-- ni modifica datos.
-- =========================================================================

ALTER TABLE empleados ALTER COLUMN ubigeo TYPE VARCHAR(200);
ALTER TABLE empleados ALTER COLUMN cuenta_bancaria TYPE VARCHAR(100);
