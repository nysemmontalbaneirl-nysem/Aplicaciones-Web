-- Migracion 030: pago real del descanso medico por enfermedad (primeros 20
-- dias por año calendario, a cargo del empleador) y de la licencia por
-- paternidad (Ley 29409, sin tope). Hasta ahora (migracion 027) estos dias
-- eran puramente informativos en la boleta -- se mostraban pero NO se
-- pagaban, lo que el usuario reporto como un bug real (boleta de prueba del
-- trabajador IPANAQUE MEJIA JUAN JUNIOR, DNI 75264067, agosto 2026): el
-- descanso medico no se sumaba al total de ingresos ni generaba los
-- aportes/descuentos correspondientes.
--
-- Decisiones de negocio confirmadas con el usuario (2 rondas de preguntas):
-- 1) Tope de 20 dias/año por CONTRATO para el descanso medico por
--    enfermedad: se BLOQUEA el registro (no solo aviso) al llegar al dia 21
--    -- del dia 21 en adelante el subsidio lo paga EsSalud directamente al
--    trabajador, fuera de planilla, y este sistema no tiene forma de pagar
--    "fuera de planilla". Ver la validacion nueva en
--    PUT /:id/tareo-diario/:contratoId (routes/planilla.ts).
-- 2) Licencia por paternidad: SI se paga desde ahora, igual que un dia
--    normal trabajado, SIN tope (Ley 29409 no impone uno para el pago).
-- 3) Descanso medico por MATERNIDAD: se mantiene puramente informativo (lo
--    paga EsSalud desde el dia 1, nunca por planilla) -- sin cambios aqui.
-- 4) Valorizacion: el mismo jornal diario de un dia normal trabajado (mismo
--    monto por dia que ya usan REM_FERIADO/REM_DOMINICAL).
-- 5) Tratamiento tributario del pago de descanso medico por enfermedad:
--    NO afecto a EsSalud regular/SENATI (Fondo de Capacitacion)/ONP, SI
--    afecto a SCTR y AFP -- segun el codigo oficial PLAME 916 "SUBSIDIOS DE
--    INCAPACIDAD POR ENFERMEDAD" (docs/tabla22_plame.json), que contradijo
--    la primera respuesta del usuario ("afecto a todo") -- se le mostro el
--    catalogo oficial y confirmo seguirlo a el, no su respuesta anterior.
--    La licencia por paternidad usa el codigo 907 "LICENCIA CON GOCE DE
--    HABER" (no existe un codigo PLAME especifico de "paternidad"), que en
--    el catalogo esta afecto a TODO -- consistente con la respuesta ya dada
--    por el usuario para este concepto, sin conflicto.
--    CONAFOVICER no aparece como columna en el catalogo PLAME (es un fondo
--    propio de construccion civil, no un tributo SUNAT) -- se completa por
--    consistencia con el resto de flags de cada concepto: en falso para
--    enfermedad (igual que essalud/senati/onp, todos en falso) y en
--    verdadero para paternidad (igual que el resto de flags, todos en
--    verdadero) -- si en la practica no calza, se ajusta desde Configuracion
--    -> Conceptos de ingreso sin necesitar otra migracion.
--
-- No crea tablas nuevas -> no hace falta ningun GRANT nuevo (las columnas
-- se agregan a detalle_planilla, que la app ya puede escribir).

ALTER TABLE detalle_planilla
    ADD COLUMN IF NOT EXISTS subsidio_enfermedad NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS licencia_paternidad  NUMERIC(10,2) NOT NULL DEFAULT 0;

INSERT INTO conceptos_planilla
    (codigo, nombre, descripcion, orden, codigo_plame,
     factor1, factor1_etiqueta, factor2, factor2_etiqueta, factor3, factor3_etiqueta,
     afecto_essalud, afecto_sctr, afecto_senati, afecto_onp, afecto_afp, afecto_renta5ta, afecto_conafovicer)
VALUES
    ('SUBSIDIO_ENFERMEDAD', 'Subsidio por incapacidad temporal (descanso médico)',
     'Pago de los primeros 20 dias por año calendario de descanso medico por enfermedad, a cargo del empleador (D.S. 009-97-SA) - del dia 21 en adelante lo paga EsSalud directamente, fuera de planilla (el sistema bloquea el registro de mas de 20 dias/año por contrato, ver Tareo Diario). Valorizado igual que un dia normal trabajado.',
     106, '916',
     NULL, NULL, NULL, NULL, NULL, NULL,
     false, true, false, false, true, false, false),

    ('LICENCIA_PATERNIDAD', 'Licencia por paternidad',
     'Pago de los dias de licencia por paternidad (Ley 29409), sin tope de dias, valorizado igual que un dia normal trabajado.',
     107, '907',
     NULL, NULL, NULL, NULL, NULL, NULL,
     true, true, true, true, true, true, true)
ON CONFLICT (codigo) DO NOTHING;
