-- Migracion 044: Piso legal mensual de EsSalud (Ronda 4 del plan de
-- "Dominical proporcional / periodo que cruza de mes / piso EsSalud /
-- reabrir periodo").
--
-- El aporte a EsSalud (9% de la remuneracion afecta) no puede ser menor,
-- en un mes calendario, al 9% de la Remuneracion Minima Vital (RMV)
-- vigente ese mes. El sistema paga por quincena/semana (no por mes), asi
-- que hoy no existe ninguna verificacion de este piso: cada periodo se
-- calcula por separado, sin acumular nada con los demas periodos del
-- mismo mes.
--
-- Propuesta tecnica confirmada por el usuario (CPC, sept. 2026):
--   1) La RMV pasa a poder configurarse MES A MES (no solo por año como
--      hoy en parametros_normativos), para que si el gobierno la modifica
--      a mitad de año, el piso (y la Asignacion Familiar, que tambien usa
--      la RMV) queden correctos en el historico sin depender de un unico
--      valor anual. Se agrega la tabla rmv_mensual: un mes SIN fila aqui
--      sigue usando el valor anual de parametros_normativos (no rompe
--      nada existente, no hace falta sembrar los 12 meses de cada año).
--   2) El sistema debe sumar el aporte EsSalud (sin ajustar) de todos los
--      periodos de pago de un mismo contrato que caen en el mismo mes
--      calendario, y si esa suma no llega al piso, ajustar la diferencia
--      en el ULTIMO periodo (cronologicamente) de ese mes.
--   3) Si despues se recalcula un periodo ANTERIOR de ese mismo mes (ya
--      con otro periodo POSTERIOR ya calculado y con el ajuste ya
--      aplicado), el sistema debe correguir en CASCADA: el ajuste se
--      recalcula sobre el conjunto completo y se traslada automaticamente
--      al periodo que corresponda, sin necesidad de que el usuario reabra
--      y recalcule el periodo posterior a mano.
--
-- Para poder recalcular el acumulado del mes sin arrastrar un ajuste ya
-- aplicado antes, cada periodo debe guardar aparte el aporte SIN ajustar
-- (essalud_base) ademas del aporte final (essalud, columna que ya existia).
-- Ver calcularAjustePisoEssaludMensual (motorCalculo.ts) y
-- ajustarPisoEssaludDelMes (routes/planilla.ts).

CREATE TABLE rmv_mensual (
    id                        SERIAL PRIMARY KEY,
    anio                      INT NOT NULL,
    mes                       INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    remuneracion_minima_vital NUMERIC(10,2) NOT NULL,
    actualizado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (anio, mes)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON rmv_mensual TO grupojhc_boletas;
GRANT USAGE, SELECT ON SEQUENCE rmv_mensual_id_seq TO grupojhc_boletas;

-- essalud_base en detalle_planilla (boletas por periodo de pago real) y en
-- detalle_planilla_mensual (Planilla Mensual Consolidada, Ronda E) - en
-- ambas, "essalud" pasa a ser el monto FINAL (ya ajustado si corresponde) y
-- "essalud_base" el 9% sin ajustar. Como el piso nunca se aplico hasta hoy,
-- todo lo ya calculado tiene essalud_base = essalud (backfill seguro: no
-- cambia ningun monto ya pagado, solo completa el dato historico).
ALTER TABLE detalle_planilla ADD COLUMN IF NOT EXISTS essalud_base NUMERIC(10,2) NOT NULL DEFAULT 0;
UPDATE detalle_planilla SET essalud_base = essalud;

ALTER TABLE detalle_planilla_mensual ADD COLUMN IF NOT EXISTS essalud_base NUMERIC(10,2) NOT NULL DEFAULT 0;
UPDATE detalle_planilla_mensual SET essalud_base = essalud;
