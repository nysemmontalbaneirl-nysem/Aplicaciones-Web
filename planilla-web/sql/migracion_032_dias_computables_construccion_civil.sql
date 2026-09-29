-- Migracion 032: correccion de "dias computables" en 4 beneficios de
-- construccion civil (Gratificacion, Vacaciones, CTS, Asignacion por
-- Escolaridad) para que crediten los dias de descanso medico por
-- enfermedad, con un tope propio de 60 dias/año.
--
-- Reportado por el usuario (CPC.MONTALBAN) con un caso real (trabajador
-- ARTEAGA CARCAMO LUIS ALFONSO, boleta agosto 2026, 1 dia de descanso
-- medico) y un Excel de referencia con el calculo esperado de cada
-- beneficio, mas 2 paginas de un compendio de derechos laborales del
-- regimen especial de construccion civil (Compensacion vacacional / CTS)
-- que citan textualmente: "el trabajador... tiene derecho a percibir por
-- concepto de vacaciones truncas el 10% del jornal basico por dia efectivo
-- de trabajo y los descansos medicos debidamente acreditados hasta por un
-- periodo de 60 dias al año" (mismo criterio de 60 dias para CTS).
--
-- Diagnostico confirmado (reproduciendo exacto los montos de la boleta y
-- del Excel del usuario con las formulas actuales del codigo):
-- - Vacaciones y CTS (motorCalculo.ts): solo usaban dias_trabajados, sin
--   sumar el descanso medico -> pagaban de menos exactamente el 10%/15%
--   del jornal por cada dia de descanso medico.
-- - Asignacion por Escolaridad: mismo problema (solo dias_trabajados),
--   ademas de no sumar dias_feriado.
-- - Gratificacion YA sumaba dias_subsidio_enfermedad desde la migracion 025
--   (sin tope) - el usuario confirmo agregarle el mismo tope de 60
--   dias/año que Vacaciones/CTS/Escolaridad, por consistencia, aunque hoy
--   nunca se activa en la practica (ver mas abajo).
--
-- Decisiones confirmadas con el usuario (via preguntas de opcion multiple):
-- 1) "Dias computables" de cada beneficio, replicando exacto su Excel:
--    - Vacaciones y CTS: dias_trabajados + dias_subsidio_enfermedad_computable.
--    - Asignacion por Escolaridad: dias_trabajados +
--      dias_subsidio_enfermedad_computable + dias_feriado (sin dominical).
--    - Gratificacion: igual formula que ya tenia (incluye dominical/
--      dominical no laborado/feriado/maternidad/paternidad), solo se
--      cambia dias_subsidio_enfermedad por la version topada.
-- 2) Tope de 60 dias/año por CONTRATO para el descanso medico, DISTINTO del
--    tope de 20 dias/año ya existente (ese es sobre el PAGO del subsidio a
--    cargo del empleador, D.S. 009-97-SA - ver PUT /:id/tareo-diario/:contratoId
--    en routes/planilla.ts). Como ese tope de 20 ya bloquea cargar mas de
--    20 dias/año de SUBSIDIO_ENFERMEDAD por contrato, el tope de 60 nunca
--    se alcanza hoy en la practica (20 < 60) - se implementa correctamente
--    de todos modos, para cuando el tope de 20 se revise mas adelante.
--
-- dias_subsidio_enfermedad (ya existente) sigue siendo el que se usa para
-- PAGAR el subsidio (calcularSubsidioEnfermedad) y para el aviso
-- informativo "Dias considerados en este periodo" de la boleta - sin
-- cambios ahi. dias_subsidio_enfermedad_computable es un campo NUEVO,
-- calculado en agregarTareoDiario (routes/planilla.ts) sumando los dias de
-- SUBSIDIO_ENFERMEDAD ya acreditados en el AÑO CALENDARIO (otros periodos
-- del mismo contrato) y topando lo que aporta este periodo a 60 en total.
--
-- No crea tablas nuevas -> no hace falta ningun GRANT nuevo (las columnas
-- se agregan a asistencia_periodo/detalle_planilla, que la app ya puede
-- escribir).

ALTER TABLE asistencia_periodo
    ADD COLUMN IF NOT EXISTS dias_subsidio_enfermedad_computable NUMERIC(6,2) NOT NULL DEFAULT 0;

ALTER TABLE detalle_planilla
    ADD COLUMN IF NOT EXISTS dias_subsidio_enfermedad_computable NUMERIC(6,2) NOT NULL DEFAULT 0;
