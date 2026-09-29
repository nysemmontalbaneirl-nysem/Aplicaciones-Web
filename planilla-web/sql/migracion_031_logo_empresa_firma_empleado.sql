-- Migracion 031: logo de la empresa (para Boleta/reportes) + firma escaneada
-- de cada trabajador (referencial, en Trabajadores).
--
-- Pedido explicito del usuario (sept. 2026): "en el menú configuración
-- tener una pestaña para Adjuntar la Firma del Empleado escaneada y el logo
-- de la empresa para que aparezca en la Boleta y en los reportes". Tras
-- aclarar con el usuario (4 preguntas), quedo confirmado:
--   1. El logo se administra desde la pantalla "Empresa" (no una pestaña
--      nueva dentro de Configuracion).
--   2. La firma se administra desde el propio formulario de cada
--      trabajador, en Trabajadores (no en Empresa/Configuracion).
--   3. La firma en la boleta es SOLO de referencia visual - no reemplaza el
--      espacio de firma fisica, que se mantiene igual que antes.
--   4. El logo aparece en la Boleta, en el resumen Excel (reportes.ts) y en
--      el Excel del asiento contable (exportaciones.ts) - el usuario marco
--      las 3 opciones en la pregunta de alcance.
--
-- Mismo patron ya usado para el certificado de Tareo Diario (migracion 021):
-- BYTEA directo en Postgres, NUNCA un archivo en el filesystem del servidor,
-- porque la carpeta "public" del servidor se borra y se reemplaza por
-- completo en cada despliegue del frontend (y "dist" del backend tambien se
-- reemplaza entero) - cualquier archivo guardado ahi se perderia en el
-- siguiente despliegue. Guardarlo en la base de datos evita ese riesgo.
--
-- No crea tablas nuevas (datos_empresa y empleados ya existen) -> no hace
-- falta ningun GRANT nuevo.

ALTER TABLE datos_empresa
    ADD COLUMN IF NOT EXISTS logo_archivo BYTEA,
    ADD COLUMN IF NOT EXISTS logo_mime    VARCHAR(100),
    ADD COLUMN IF NOT EXISTS logo_nombre  VARCHAR(200);

ALTER TABLE empleados
    ADD COLUMN IF NOT EXISTS firma_archivo BYTEA,
    ADD COLUMN IF NOT EXISTS firma_mime    VARCHAR(100),
    ADD COLUMN IF NOT EXISTS firma_nombre  VARCHAR(200);
