-- =========================================================================
-- Migracion 017: registro de tareo diario (por trabajador y por dia).
--
-- Hasta ahora el tareo solo se cargaba a nivel de TOTALES DEL MES por
-- trabajador (Excel/CSV agregado, o edicion manual de los mismos totales en
-- la pestana Tareo). Esta migracion agrega una tabla nueva para poder
-- registrar la asistencia dia por dia (fecha, horas y minutos por concepto),
-- pensando en: (1) que cargar el tareo sea mas natural para quien lo hace a
-- diario, y (2) que a futuro (T-Registro/PLAME) se necesitan horas y minutos
-- como campos independientes, no un decimal.
--
-- Los totales que ya usa el motor de calculo (motorCalculo.ts) siguen
-- viviendo en asistencia_periodo exactamente igual que antes: el tareo
-- diario se sigue sumando hacia esos mismos campos (dias_trabajados,
-- dias_dominical, dias_feriado, dias_falta, horas_extra_25/35/100) desde el
-- backend - motorCalculo.ts no se toca.
--
-- Tambien se agregan 3 columnas nuevas a asistencia_periodo para dejar
-- constancia de dias de descanso medico/subsidio EsSalud (enfermedad comun,
-- maternidad) y de licencia por paternidad. Por ahora son PURAMENTE
-- INFORMATIVAS: el motor de calculo no las lee ni cambia ningun monto ni
-- aporte a partir de ellas. La regla legal completa (Ley 26790: dias 1-20
-- los paga el empleador como remuneracion normal y con aportes, desde el
-- dia 21 lo asume EsSalud sobre el promedio de los ultimos 4 meses y sin
-- aportes; maternidad desde el dia 1; paternidad es licencia del empleador)
-- queda para una fase posterior dedicada - por ahora solo se avisa al
-- calcular la planilla para que el responsable lo revise a mano.
--
-- No destructiva: solo crea una tabla nueva y agrega columnas con DEFAULT,
-- no borra ni modifica nada existente.
-- =========================================================================

CREATE TABLE IF NOT EXISTS tareo_diario (
    id                   SERIAL PRIMARY KEY,
    periodo_id           INT NOT NULL REFERENCES periodos_planilla(id) ON DELETE CASCADE,
    contrato_id          INT NOT NULL REFERENCES contratos(id) ON DELETE RESTRICT,
    fecha                DATE NOT NULL,

    horas_normales       INT NOT NULL DEFAULT 0,
    minutos_normales     INT NOT NULL DEFAULT 0,
    horas_dominical      INT NOT NULL DEFAULT 0,
    minutos_dominical    INT NOT NULL DEFAULT 0,
    horas_feriado        INT NOT NULL DEFAULT 0,
    minutos_feriado      INT NOT NULL DEFAULT 0,

    -- Los 3 "tramos" de horas extra son los mismos que usa el motor de
    -- calculo (asistencia_periodo.horas_extra_25/35/100): tramo1 ->
    -- horas_extra_25, tramo2 -> horas_extra_35, tramo3 -> horas_extra_100.
    -- El % real que se paga por cada tramo depende de la categoria del
    -- trabajador (construccion civil: 60/100/100, regimen general:
    -- 25/35/100 - ver conceptos_planilla HORAS_EXTRA_CONSTRUCCION/GENERAL),
    -- por eso aqui se guardan neutros como "tramo1/2/3" y no con el %.
    horas_extra_tramo1   INT NOT NULL DEFAULT 0,
    minutos_extra_tramo1 INT NOT NULL DEFAULT 0,
    horas_extra_tramo2   INT NOT NULL DEFAULT 0,
    minutos_extra_tramo2 INT NOT NULL DEFAULT 0,
    horas_extra_tramo3   INT NOT NULL DEFAULT 0,
    minutos_extra_tramo3 INT NOT NULL DEFAULT 0,

    -- Si el dia fue una falta, o un dia de subsidio/licencia en vez de un
    -- dia normal de trabajo. NULL = dia normal (se usan las horas de arriba).
    tipo_dia_especial    VARCHAR(20)
                         CHECK (tipo_dia_especial IN (
                           'FALTA',
                           'SUBSIDIO_ENFERMEDAD',
                           'SUBSIDIO_MATERNIDAD',
                           'LICENCIA_PATERNIDAD'
                         )),

    actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (periodo_id, contrato_id, fecha)
);

ALTER TABLE asistencia_periodo
  ADD COLUMN IF NOT EXISTS dias_subsidio_enfermedad NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dias_subsidio_maternidad NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dias_licencia_paternidad NUMERIC(5,2) NOT NULL DEFAULT 0;
