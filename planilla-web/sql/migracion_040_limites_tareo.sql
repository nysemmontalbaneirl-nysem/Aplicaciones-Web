-- =========================================================================
-- Migracion 040: limites configurables de horas/minutos para el Tareo
-- Diario (Configuracion -> "Limites de tareo").
--
-- Pedido textual del usuario (18/09/2026, trabajando ya en produccion):
--   "1. Configuracion de limites de horas y minutos para el tareo. Se
--   deberia implementar una pestana dentro de la configuracion que permita
--   establecer los limites de horas y minutos por dia para el registro del
--   tareo. Propongo los siguientes valores: De lunes a viernes: Horas:
--   minimo 0 y maximo 8 horas. Minutos: entre 0 y 30 minutos por dia.
--   Sabados: Horas: minimo 0 y maximo 5 horas. Minutos: entre 0 y 30
--   minutos por dia."
--
-- Decisiones confirmadas por el usuario (AskUserQuestion):
--   1. El limite aplica a la SUMA de TODAS las columnas de horas del dia
--      (jornal normal + domingo + feriado + horas extra tramo 1/2/3), y por
--      separado a la suma de TODAS las columnas de minutos - no solo al
--      jornal normal.
--   2. Si se excede el limite, el guardado se BLOQUEA (HTTP 400), mismo
--      criterio que ya usa el sistema para minutos fuera de 0-59.
--
-- Domingo queda sin limite configurable (el pedido original solo cubre
-- "lunes a viernes" y "sabados" - el domingo ya se paga aparte como
-- "domingo trabajado", con su propio tratamiento legal).
--
-- Fila unica (id=1), mismo patron que 'configuracion_seguridad'
-- (migracion 033): se lee/actualiza siempre con WHERE id = 1, nunca hay una
-- segunda fila.
-- =========================================================================

CREATE TABLE IF NOT EXISTS limites_tareo (
    id                   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    horas_max_lun_vie    SMALLINT NOT NULL DEFAULT 8  CHECK (horas_max_lun_vie BETWEEN 0 AND 24),
    minutos_max_lun_vie  SMALLINT NOT NULL DEFAULT 30 CHECK (minutos_max_lun_vie BETWEEN 0 AND 59),
    horas_max_sabado     SMALLINT NOT NULL DEFAULT 5  CHECK (horas_max_sabado BETWEEN 0 AND 24),
    minutos_max_sabado   SMALLINT NOT NULL DEFAULT 30 CHECK (minutos_max_sabado BETWEEN 0 AND 59),
    actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO limites_tareo (id, horas_max_lun_vie, minutos_max_lun_vie, horas_max_sabado, minutos_max_sabado)
VALUES (1, 8, 30, 5, 30)
ON CONFLICT (id) DO NOTHING;

-- GRANT (plantilla estandar del proyecto - tabla nueva, sin columna SERIAL
-- asi que no hace falta GRANT de secuencia).
GRANT SELECT, UPDATE ON limites_tareo TO grupojhc_boletas;
