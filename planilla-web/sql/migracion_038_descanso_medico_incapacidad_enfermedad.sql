-- =========================================================================
-- Migracion 038: separa "Descanso Medico" (<=20 dias/año, dia normal de
-- trabajo) de "Incapacidad por Enfermedad" (21+ dias/año, subsidiado por
-- EsSalud) - antes ambos casos vivian bajo un unico concepto
-- 'SUBSIDIO_ENFERMEDAD' calculado SIEMPRE con el tratamiento tributario del
-- caso 21+ (afecto solo a SCTR/AFP), incluso para los primeros 20 dias, que
-- por ley deben pagarse y afectarse a TODOS los aportes igual que un dia
-- normal de trabajo.
--
-- Reporte textual del usuario (CPC responsable de las declaraciones,
-- 17/09/2026), ya en produccion:
--   "DEBERIAS AGREGAR EN LA PESTAÑA DE CONFIGURACION / CONCEPTOS DE
--   INGRESOS (SIN FORMULA), UN CONCEPTO DE DESCANSO MEDICO QUE ESTE AFECTO
--   A TODO COMO SI FUESE UN DIA DE TRABAJO NORMAL, TENIENDO EN CUENTA QUE
--   LOS DIAS DE DESCANSO MEDICO MENORES O IGUALES A 20 DIAS SI SE
--   CONSIDERAN DIAS REMUNERADOS NORMALES, A PARTIR DEL DIA 21 SI SE
--   CONSIDERA UN DIA SUBSIDIADO. EL MOTIVO POR EL QUE TE PIDO ESTO ES
--   PORQUE AL MOMENTO DE GENERAR LOS ARCHIVOS PLANOS ESTOS CONCEPTOS VAN EN
--   CASILLAS DE LA PLAME DIFERENTES: LOS DESCANSOS MEDICOS REMUNERADOS VAN
--   EN LA CASILLA 0121, MIENTRAS QUE LOS DIAS DE SUBSIDIO POR ENFERMEDAD VA
--   EN LA CASILLA 0916. ACTUALMENTE EL SISTEMA POR ERROR LOS DIAS DE
--   DESCANSO MEDICO LOS ESTA TOMANDO COMO DIAS SUBSIDIADOS."
--
-- Decisiones confirmadas por el usuario (AskUserQuestion):
--   1. Renombrar tambien el identificador interno (codigo de
--      conceptos_planilla y valor de tipo_dia_especial), no solo el nombre
--      visible en pantalla.
--   2. El dia 21 en adelante se registra y se divide AUTOMATICAMENTE (ya no
--      se bloquea el registro de mas de 20 dias/año, como hacia el sistema
--      hasta ahora) - no se agrega un segundo tipo de dia manual.
--   3. El concepto nuevo de 21+ (INCAPACIDAD_ENFERMEDAD, casilla PLAME
--      0916) mantiene EXACTAMENTE las mismas afectaciones que ya tenia
--      SUBSIDIO_ENFERMEDAD antes de esta migracion (SI SCTR/AFP, NO
--      EsSalud/SENATI/ONP/Renta5ta/Conafovicer).
--
-- Esta migracion:
--   (a) Agrega dias_incapacidad_enfermedad/incapacidad_enfermedad a
--       asistencia_periodo/detalle_planilla/detalle_planilla_mensual.
--   (b) Renombra el codigo 'SUBSIDIO_ENFERMEDAD' de conceptos_planilla a
--       'DESCANSO_MEDICO' (secuencia segura de PK: INSERT nuevo -> UPDATE
--       referencias -> DELETE viejo, ya que detalle_planilla_conceptos/
--       detalle_planilla_conceptos_mensual tienen FK real sin ON UPDATE
--       CASCADE, y mapeo_cuentas_contables.concepto_codigo no tiene FK pero
--       igual se actualiza por consistencia), con nombre/descripcion/
--       codigo_plame ('0121') y afecto_* (todos true) nuevos.
--   (c) Agrega el concepto nuevo 'INCAPACIDAD_ENFERMEDAD' (codigo_plame
--       '0916', mismos afecto_* que tenia SUBSIDIO_ENFERMEDAD).
--   (d) Actualiza el CHECK de tareo_diario.tipo_dia_especial y los datos ya
--       cargados con el valor viejo 'SUBSIDIO_ENFERMEDAD'.
--
-- IMPORTANTE - cambio de comportamiento visible para el usuario: antes de
-- esta migracion, el sistema RECHAZABA (HTTP 400) guardar un dia de
-- descanso medico si el contrato ya superaba 20 dias pagados en el año.
-- Desde esta migracion YA NO se rechaza: el dia se guarda igual, y al
-- calcular la planilla el sistema decide automaticamente si ese dia se paga
-- como "Descanso Medico" (si el acumulado del año todavia no llega a 20) o
-- como "Incapacidad por Enfermedad" (si ya lo supera).
-- =========================================================================

-- (a) Columnas nuevas.
ALTER TABLE asistencia_periodo
  ADD COLUMN IF NOT EXISTS dias_incapacidad_enfermedad NUMERIC(6,2) NOT NULL DEFAULT 0;

ALTER TABLE detalle_planilla
  ADD COLUMN IF NOT EXISTS dias_incapacidad_enfermedad NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS incapacidad_enfermedad NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE detalle_planilla_mensual
  ADD COLUMN IF NOT EXISTS dias_incapacidad_enfermedad NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS incapacidad_enfermedad NUMERIC(10,2) NOT NULL DEFAULT 0;

-- (b) Rename seguro del codigo 'SUBSIDIO_ENFERMEDAD' -> 'DESCANSO_MEDICO'.
-- Paso 1: inserta la fila nueva (si ya existiera de una corrida parcial
-- anterior, no la vuelve a tocar).
INSERT INTO conceptos_planilla
    (codigo, nombre, descripcion, orden, codigo_plame,
     afecto_essalud, afecto_sctr, afecto_senati, afecto_onp, afecto_afp, afecto_renta5ta, afecto_conafovicer)
VALUES
    ('DESCANSO_MEDICO', 'Días de Descanso Médico',
     'Pago de los primeros 20 dias por año calendario de descanso medico por enfermedad, a cargo del empleador (D.S. 009-97-SA) - se paga y se afecta a aportes igual que un dia normal de trabajo. Del dia 21 en adelante, ver el concepto "Días por Incapacidad por Enfermedad".',
     106, '0121',
     true, true, true, true, true, true, true)
ON CONFLICT (codigo) DO NOTHING;

-- Paso 2: repunta cualquier referencia existente al codigo viejo hacia el
-- nuevo, en las 2 tablas con FK real a conceptos_planilla.codigo, mas
-- mapeo_cuentas_contables (sin FK, pero se actualiza por consistencia para
-- que la cuenta contable ya configurada por proyecto no se pierda).
UPDATE detalle_planilla_conceptos SET concepto_codigo = 'DESCANSO_MEDICO' WHERE concepto_codigo = 'SUBSIDIO_ENFERMEDAD';
UPDATE detalle_planilla_conceptos_mensual SET concepto_codigo = 'DESCANSO_MEDICO' WHERE concepto_codigo = 'SUBSIDIO_ENFERMEDAD';
UPDATE mapeo_cuentas_contables SET concepto_codigo = 'DESCANSO_MEDICO' WHERE concepto_codigo = 'SUBSIDIO_ENFERMEDAD';

-- Paso 3: recien ahora se puede borrar la fila vieja sin dejar referencias
-- huerfanas.
DELETE FROM conceptos_planilla WHERE codigo = 'SUBSIDIO_ENFERMEDAD';

-- (c) Concepto nuevo para el bucket 21+, mismas afectaciones que tenia
-- SUBSIDIO_ENFERMEDAD antes de esta migracion (confirmado con el usuario:
-- "mantener las que ya existian").
INSERT INTO conceptos_planilla
    (codigo, nombre, descripcion, orden, codigo_plame,
     afecto_essalud, afecto_sctr, afecto_senati, afecto_onp, afecto_afp, afecto_renta5ta, afecto_conafovicer)
VALUES
    ('INCAPACIDAD_ENFERMEDAD', 'Días por Incapacidad por Enfermedad',
     'Pago de los dias de descanso medico por enfermedad a partir del dia 21 por año calendario y por contrato, subsidiado por EsSalud directamente al trabajador (D.S. 009-97-SA). Valorizado igual que un dia normal trabajado.',
     108, '0916',
     false, true, false, false, true, false, false)
ON CONFLICT (codigo) DO NOTHING;

-- (d) tareo_diario: CHECK constraint y datos ya cargados. El nombre del
-- constraint es el default de Postgres para una columna CHECK inline
-- (confirmado en la base real: tareo_diario_tipo_dia_especial_check).
ALTER TABLE tareo_diario DROP CONSTRAINT IF EXISTS tareo_diario_tipo_dia_especial_check;
UPDATE tareo_diario SET tipo_dia_especial = 'DESCANSO_MEDICO' WHERE tipo_dia_especial = 'SUBSIDIO_ENFERMEDAD';
ALTER TABLE tareo_diario ADD CONSTRAINT tareo_diario_tipo_dia_especial_check
  CHECK (tipo_dia_especial IN ('FALTA', 'DESCANSO_MEDICO', 'SUBSIDIO_MATERNIDAD', 'LICENCIA_PATERNIDAD'));

-- GRANT (plantilla estandar del proyecto): no hace falta aqui, no se crean
-- tablas ni secuencias nuevas en esta migracion (solo columnas nuevas en
-- tablas ya existentes y filas en conceptos_planilla, que ya tiene GRANT).
