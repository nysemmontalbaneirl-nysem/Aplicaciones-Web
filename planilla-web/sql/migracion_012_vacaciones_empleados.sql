-- Migracion 012: modulo de record vacacional para Empleados (regimen
-- general). Los dias GANADOS no se guardan en ninguna tabla - se calculan
-- en el momento a partir de la fecha de ingreso del contrato y el record
-- de dias trabajados/dominicales/feriados del tareo de cada periodo (para
-- que nunca queden desactualizados). Esta tabla solo guarda los dias YA
-- TOMADOS (goce), que es informacion que no existe en ningun otro lado del
-- sistema. No destructiva.

CREATE TABLE IF NOT EXISTS vacaciones_goce (
    id             SERIAL PRIMARY KEY,
    contrato_id    INT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    fecha_inicio   DATE NOT NULL,
    fecha_fin      DATE NOT NULL,
    dias           INT NOT NULL,
    observaciones  TEXT,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vacaciones_goce_contrato ON vacaciones_goce(contrato_id);
