-- Migracion 009: la cuota sindical NO es un porcentaje del sueldo, es una
-- tarifa FIJA semanal que varia por proyecto (verificado contra boletas
-- reales de julio 2026: P012=S/15/semana, P009=S/10/semana, P013=S/20/semana).
-- No destructiva: agrega una columna nueva con DEFAULT 0.

ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS cuota_sindical_semanal NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Precarga las 3 tarifas confirmadas contra boletas reales, solo si esos
-- proyectos ya existen en tu catalogo (no crea proyectos nuevos) y solo si
-- todavia estan en 0 (no pisa una tarifa que ya hayas cargado a mano).
UPDATE proyectos SET cuota_sindical_semanal = 15.00 WHERE nombre = 'P012' AND cuota_sindical_semanal = 0;
UPDATE proyectos SET cuota_sindical_semanal = 10.00 WHERE nombre = 'P009' AND cuota_sindical_semanal = 0;
UPDATE proyectos SET cuota_sindical_semanal = 20.00 WHERE nombre = 'P013' AND cuota_sindical_semanal = 0;
