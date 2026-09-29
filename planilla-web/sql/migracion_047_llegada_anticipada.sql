-- Migracion 047: "Llegada anticipada" en la importacion de marcaciones
-- biometricas (Ronda 2, ajuste pedido por el usuario el 26/09).
--
-- Contexto: el importador (migracion 046) tomaba la marca mas temprana del
-- dia como hora de ingreso real y, si esta era ANTERIOR a la hora de
-- ingreso programada del proyecto, ese tiempo se sumaba automaticamente
-- como hora extra. El usuario senalo que esto no es correcto: una llegada
-- anticipada no autorizada no deberia pagarse como extra sola - el sistema
-- debe dejarla marcada aparte y avisar a la persona que revisa la
-- importacion, para que decida explicitamente si la confirma como hora
-- extra a pagar o no (a diferencia de una salida tardia, que SI se sigue
-- acreditando como extra automaticamente, sin necesitar confirmacion - ese
-- es el caso normal de sobretiempo).
--
-- Esta migracion solo agrega las 2 columnas nuevas en la tabla de detalle
-- ya existente (migracion 046): cuantos minutos de esa llegada anticipada
-- se detectaron ese dia, y si la persona que revisa ya confirmo pagarlos
-- como hora extra. No se toca ninguna otra tabla.
ALTER TABLE importaciones_marcaciones_detalle
    ADD COLUMN IF NOT EXISTS minutos_llegada_anticipada INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS anticipacion_pagada BOOLEAN NOT NULL DEFAULT false;

-- Sin GRANT nuevo: son columnas en una tabla ya existente, el permiso de
-- grupojhc_boletas sobre importaciones_marcaciones_detalle ya la cubre.
