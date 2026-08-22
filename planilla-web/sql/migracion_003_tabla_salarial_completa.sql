-- =========================================================================
-- Migracion 003: completa tabla_salarial_mensual con las columnas que
-- faltaban (BAE, movilidad acumulada, gratificacion diaria de referencia)
-- y agrega las categorias PEON_A y R_GENERAL (regimen general, fuera de
-- construccion civil) confirmadas por el usuario en la hoja AFPS-SALARIOS.
--
-- No destructivo: solo agrega columnas y filas nuevas, no borra nada.
-- Ejecutar en pgAdmin -> Query Tool sobre la base de datos de produccion.
-- =========================================================================

ALTER TABLE tabla_salarial_mensual ADD COLUMN IF NOT EXISTS bae NUMERIC(6,4) NOT NULL DEFAULT 0;
ALTER TABLE tabla_salarial_mensual ADD COLUMN IF NOT EXISTS movilidad_acumulada NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE tabla_salarial_mensual ADD COLUMN IF NOT EXISTS gratificacion_diaria NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Completa BAE / movilidad acumulada / gratificacion diaria para los meses
-- que ya existan en la tabla (valores reales de febrero 2026, hoja
-- AFPS-SALARIOS). Si ya editaste estos valores manualmente para algun
-- anio/mes, este UPDATE los va a sobreescribir con los de referencia -
-- vuelve a ajustarlos despues si corresponde.
UPDATE tabla_salarial_mensual SET bae = 0,    movilidad_acumulada = 8.60, gratificacion_diaria = 17.01 WHERE categoria = 'OPERARIO';
UPDATE tabla_salarial_mensual SET bae = 0,    movilidad_acumulada = 8.60, gratificacion_diaria = 13.29 WHERE categoria = 'OFICIAL';
UPDATE tabla_salarial_mensual SET bae = 0,    movilidad_acumulada = 8.60, gratificacion_diaria = 11.96 WHERE categoria = 'PEON';
UPDATE tabla_salarial_mensual SET bae = 0.10, movilidad_acumulada = 8.60, gratificacion_diaria = 17.01 WHERE categoria = 'OPERARIO_EP';
UPDATE tabla_salarial_mensual SET bae = 0.08, movilidad_acumulada = 8.60, gratificacion_diaria = 17.01 WHERE categoria = 'OPERARIO_EM';
UPDATE tabla_salarial_mensual SET bae = 0.09, movilidad_acumulada = 8.60, gratificacion_diaria = 17.01 WHERE categoria = 'OPERARIO_TP';

-- Agrega PEON_A y R_GENERAL para cada anio/mes que ya tenga tabla salarial
-- configurada, copiando el jornal real de la hoja AFPS-SALARIOS.
INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
SELECT DISTINCT anio, mes, 'PEON_A', 47.61, 0, 0, 0, 0
FROM tabla_salarial_mensual
ON CONFLICT (anio, mes, categoria) DO NOTHING;

INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc, bae, movilidad_acumulada, gratificacion_diaria)
SELECT DISTINCT anio, mes, 'R_GENERAL', 37.67, 0, 0, 0, 0
FROM tabla_salarial_mensual
ON CONFLICT (anio, mes, categoria) DO NOTHING;
