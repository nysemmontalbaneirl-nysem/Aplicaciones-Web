-- =========================================================================
-- Migracion 006: tabla asistencia_periodo (tareo guardado por periodo).
--
-- Antes el tareo cargado (Excel/CSV) solo vivia en la memoria del
-- navegador hasta presionar "Calcular planilla" - si cerrabas la pestana
-- se perdia. Ahora se guarda directamente en la base de datos apenas se
-- sube o edita, y solo contiene a los trabajadores que efectivamente
-- tienen tareo cargado ese periodo (no a todos los ~3200).
--
-- No destructivo: solo crea una tabla nueva, no borra ni modifica nada.
-- =========================================================================

CREATE TABLE IF NOT EXISTS asistencia_periodo (
    id              SERIAL PRIMARY KEY,
    periodo_id      INT NOT NULL REFERENCES periodos_planilla(id) ON DELETE CASCADE,
    contrato_id     INT NOT NULL REFERENCES contratos(id) ON DELETE RESTRICT,
    dias_trabajados NUMERIC(5,2) NOT NULL DEFAULT 0,
    dias_dominical  NUMERIC(5,2) NOT NULL DEFAULT 0,
    dias_feriado    NUMERIC(5,2) NOT NULL DEFAULT 0,
    dias_falta      NUMERIC(5,2) NOT NULL DEFAULT 0,
    horas_extra_25  NUMERIC(6,2) NOT NULL DEFAULT 0,
    horas_extra_35  NUMERIC(6,2) NOT NULL DEFAULT 0,
    horas_extra_100 NUMERIC(6,2) NOT NULL DEFAULT 0,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (periodo_id, contrato_id)
);
