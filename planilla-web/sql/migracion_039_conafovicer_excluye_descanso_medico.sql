-- =========================================================================
-- Migracion 039: excluye los dias de Descanso Medico de la base imponible
-- de CONAFOVICER.
--
-- Solicitud textual del usuario (CPC responsable de las declaraciones,
-- 18/09/2026):
--   "Error en la Base de Calculo de CONAFOVICER - Se detecto que el
--   sistema incluye los dias de descanso medico dentro de la base
--   imponible para la retencion de CONAFOVICER. Los dias de descanso
--   medico debidamente subsidiados o no subsidiados no deben considerarse
--   para el calculo de este aporte, por lo que se solicita la exclusion
--   inmediata de dichos periodos."
--
-- Contexto tecnico: calcularConafovicer() (src/motorCalculo.ts) calcula
-- base * tasa_conafovicer, donde "base" sale de forma 100% generica de
-- sumarBase(montosPorConcepto, conceptos, "afecto_conafovicer") - o sea,
-- suma el monto de CUALQUIER concepto de ingreso cuyo flag
-- afecto_conafovicer este en true. No existe ningun caso especial de
-- codigo para CONAFOVICER: el unico ajuste necesario es de DATOS, no de
-- codigo.
--
-- 'DESCANSO_MEDICO' (<=20 dias/año, D.S. 009-97-SA) quedo con
-- afecto_conafovicer = true desde la migracion 038 (copio los mismos
-- flags que SUELDO_BASICO, ya que legalmente se paga y se afecta como un
-- dia normal de trabajo para EsSalud/SCTR/SENATI/ONP/AFP/Renta 5ta) - pero
-- CONAFOVICER es la unica excepcion: el usuario confirmo que ni los dias
-- subsidiados NI los no subsidiados de descanso medico deben entrar a su
-- base. 'INCAPACIDAD_ENFERMEDAD' (21+ dias/año) ya tenia
-- afecto_conafovicer = false desde antes (verificado, no requiere cambio).
--
-- Esta migracion corrige unicamente el flag de datos; no se modifica
-- calcularConafovicer() ni sumarBase().
-- =========================================================================

UPDATE conceptos_planilla
   SET afecto_conafovicer = false
 WHERE codigo = 'DESCANSO_MEDICO';

-- GRANT: no hace falta - no se crean tablas ni secuencias nuevas, solo se
-- actualiza una fila en conceptos_planilla (tabla ya existente con GRANT).
