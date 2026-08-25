-- Migracion 013: boleta de pago de la remuneracion vacacional, SEPARADA
-- de la planilla mensual (decision del usuario: cada goce de vacaciones
-- registrado genera su propio documento/boleta, en vez de aparecer como
-- una linea mas dentro de la planilla del mes). Un goce (vacaciones_goce)
-- genera exactamente una boleta_vacaciones (relacion 1 a 1). No destructiva.

CREATE TABLE IF NOT EXISTS boletas_vacaciones (
    id                        SERIAL PRIMARY KEY,
    goce_id                   INT NOT NULL UNIQUE REFERENCES vacaciones_goce(id) ON DELETE CASCADE,
    contrato_id               INT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    fecha_inicio              DATE NOT NULL,
    fecha_fin                 DATE NOT NULL,
    dias                      INT NOT NULL,
    remuneracion_vacacional   NUMERIC(10,2) NOT NULL,
    aporte_pension            NUMERIC(10,2) NOT NULL,
    essalud                   NUMERIC(10,2) NOT NULL,
    sctr                      NUMERIC(10,2) NOT NULL,
    neto_pagar                NUMERIC(10,2) NOT NULL,
    detalle_json              JSONB NOT NULL DEFAULT '{}',
    generado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boletas_vacaciones_contrato ON boletas_vacaciones(contrato_id);
