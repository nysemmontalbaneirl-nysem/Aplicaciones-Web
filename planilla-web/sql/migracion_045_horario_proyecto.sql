-- Migracion 045: Horario de proyecto + tasa de tramo3 de horas extra
-- ("Control de Asistencia Diaria" - Ronda 1, sept. 2026).
--
-- Contexto (propuesta del usuario, CPC): integrar un modulo de asistencia
-- diaria con marcacion biometrica (lector de huella), que calcule horas
-- normales/extra a partir de un horario configurado por proyecto (hora de
-- ingreso, hora de salida, refrigerio). Es un proyecto grande que se
-- entrega en varias rondas:
--   Ronda 1 (esta migracion): la CONFIGURACION del horario por proyecto,
--     mas la tasa de recargo de "tramo3" de horas extra (ver abajo) - no
--     depende de tener el equipo biometrico comprado, y la tasa de tramo3
--     ya se puede aplicar HOY porque el tareador ya carga horas de tramo3
--     a mano en el Tareo Diario.
--   Ronda 2 (pendiente): importador de marcaciones del equipo biometrico +
--     calculo automatico + pantalla de revision antes de aplicar.
--   Ronda 3 (pendiente): aplicar lo revisado al Tareo Diario existente.
--
-- Reglas de negocio confirmadas por el usuario para el calculo de horas
-- extra a partir de la hora de salida marcada vs. la hora de salida
-- programada (para cuando exista la Ronda 2/3):
--   - Tramo1: las primeras 2 horas extra del dia.
--   - Tramo2: las siguientes hasta 4 horas mas (o sea, de la hora 2 a la
--     hora 6 acumulada).
--   - Tramo3: todo lo que pase de las 6 horas acumuladas, SIN LIMITE. El
--     recargo de tramo1/tramo2 sigue siendo un solo valor para toda la
--     empresa (conceptos_planilla.HORAS_EXTRA_CONSTRUCCION/GENERAL,
--     factor1/factor2, sin cambios) - pero el recargo de tramo3 SI se
--     pacta por proyecto (ej. 60% o menos segun la obra), y dentro de
--     tramo3 todas las horas se pagan parejo a ese mismo porcentaje (no
--     hay un cuarto tramo ni otro corte adicional).
--
-- tasa_tramo3 se guarda con la MISMA convencion que conceptos_planilla.
-- factor1/factor2/factor3 (ver calcularHorasExtra en motorCalculo.ts): es
-- el MULTIPLICADOR del valor hora, no el porcentaje puro - ej. 1.60
-- significa 60% de recargo. NULL (el default) significa "usa el factor3
-- general de la empresa" (HORAS_EXTRA_CONSTRUCCION o HORAS_EXTRA_GENERAL
-- segun el regimen del trabajador, exactamente el comportamiento actual,
-- sin cambios) - ningun proyecto queda sin poder calcular por no tener
-- esto configurado.
--
-- hora_ingreso/hora_salida/minutos_refrigerio (y sus variantes de sabado,
-- opcionales) todavia no se usan en ningun calculo en esta ronda - quedan
-- guardados para cuando exista el importador de marcaciones biometricas.
--
-- Una fila por proyecto (1 a 1, igual que datos_empresa es 1 sola fila
-- para toda la empresa, pero aqui es 1 fila por proyecto): se usa
-- proyecto_id como PRIMARY KEY en vez de un SERIAL propio, para que no
-- pueda existir mas de una configuracion por proyecto.

CREATE TABLE IF NOT EXISTS horarios_proyecto (
    proyecto_id          INT PRIMARY KEY REFERENCES proyectos(id) ON DELETE CASCADE,
    hora_ingreso         TIME NOT NULL DEFAULT '08:00',
    hora_salida          TIME NOT NULL DEFAULT '17:00',
    minutos_refrigerio   SMALLINT NOT NULL DEFAULT 60 CHECK (minutos_refrigerio BETWEEN 0 AND 240),
    -- Horario de sabado (opcional): si un proyecto no lo configura, la
    -- Ronda 2/3 debera usar el mismo horario de lunes a viernes para el
    -- sabado tambien (a confirmar en esa ronda).
    hora_ingreso_sabado  TIME,
    hora_salida_sabado   TIME,
    -- Multiplicador del valor hora para tramo3 (ej. 1.60 = 60% recargo).
    -- NULL = usa el factor3 general de conceptos_planilla (comportamiento
    -- actual, sin cambios).
    tasa_tramo3          NUMERIC(5,4) CHECK (tasa_tramo3 IS NULL OR tasa_tramo3 >= 1),
    actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GRANTs para el usuario de la aplicacion (grupojhc_boletas) - tabla nueva,
-- sin secuencia propia (PRIMARY KEY es proyecto_id, no un SERIAL).
GRANT SELECT, INSERT, UPDATE, DELETE ON horarios_proyecto TO grupojhc_boletas;
