-- Migracion 029: 3 correcciones a descuentos/aportes reportadas por el
-- usuario en produccion (los ingresos estaban correctos).
--
-- 1) Cuota sindical por proyecto Y categoria (antes solo por proyecto):
--    el monto que acuerda el sindicato varia por categoria del trabajador
--    (peon/oficial/operario), no solo por obra. Se agrega una tabla nueva
--    con un valor FIJO por proyecto+categoria (no varia por mes/anio,
--    decision confirmada con el usuario - se edita a mano cuando cambie
--    el convenio, igual que el valor unico de hoy). Se siembra copiando el
--    valor actual de cada proyecto (proyectos.cuota_sindical_semanal) a
--    las 10 categorias, para no alterar NINGUN descuento ya calculado
--    hasta que el usuario ajuste cada categoria a su monto real desde la
--    pantalla nueva Configuracion -> Cuota sindical.
--    proyectos.cuota_sindical_semanal se mantiene sin cambios: pasa a ser
--    el valor de respaldo/por defecto para una combinacion proyecto+
--    categoria que aun no se haya configurado aqui (ej. un proyecto recien
--    creado) - asi nunca se deja de descontar por accidente.
CREATE TABLE IF NOT EXISTS cuota_sindical_categoria (
    id             SERIAL PRIMARY KEY,
    proyecto_id    INT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    categoria      VARCHAR(30) NOT NULL, -- OPERARIO | OFICIAL | PEON | EMPLEADO | EVENTUAL | OPERARIO_EP | OPERARIO_EM | OPERARIO_TP | PEON_A | R_GENERAL
    monto_semanal  NUMERIC(10,2) NOT NULL DEFAULT 0,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (proyecto_id, categoria)
);

INSERT INTO cuota_sindical_categoria (proyecto_id, categoria, monto_semanal)
SELECT p.id, cat.categoria, p.cuota_sindical_semanal
FROM proyectos p
CROSS JOIN (VALUES
    ('OPERARIO'), ('OFICIAL'), ('PEON'), ('EMPLEADO'), ('EVENTUAL'),
    ('OPERARIO_EP'), ('OPERARIO_EM'), ('OPERARIO_TP'), ('PEON_A'), ('R_GENERAL')
) AS cat(categoria)
ON CONFLICT (proyecto_id, categoria) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON cuota_sindical_categoria TO grupojhc_boletas;
GRANT USAGE, SELECT ON SEQUENCE cuota_sindical_categoria_id_seq TO grupojhc_boletas;

-- 2) EsSalud+Vida (parametros_normativos.seguro_vida_ley, S/5.00/mes fijo):
--    se aplicaba integro en CADA periodo sin importar su duracion, lo que
--    duplicaba (quincenal) o cuadruplicaba (semanal) el aporte real
--    mensual. Se corrigio en codigo (motorCalculo.ts, funcion
--    obtenerDivisorEssaludVida): divisor FIJO por tipo de periodo -
--    MENSUAL /1, QUINCENAL /2 (S/2.50 exacto), SEMANAL /4 (S/1.25) -
--    decision confirmada con el usuario. No requiere ninguna columna ni
--    tabla nueva (el tipo de periodo ya existe en periodos_planilla.tipo).

-- 3) Fondo de Capacitacion (conceptos_planilla.afecto_senati, tasa 0.45%
--    ya correcta desde migracion_008): el BUC no debe formar parte de la
--    base de este aporte (decision confirmada con el usuario; la
--    Remuneracion Feriado se mantiene en la base, sin cambios). Este mismo
--    ajuste ya se podia hacer sin ninguna migracion desde Configuracion ->
--    Conceptos de ingreso (columna "SENATI" del concepto BUC) - se corrige
--    aqui tambien por si el usuario aun no lo habia hecho, sin pisar un
--    valor que ya haya cambiado a mano (mismo criterio defensivo que
--    migracion_008 con tasa_senati).
UPDATE conceptos_planilla SET afecto_senati = false WHERE codigo = 'BUC' AND afecto_senati = true;
