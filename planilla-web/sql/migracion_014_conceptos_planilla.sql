-- Migracion 014: catalogo configurable de conceptos de planilla, siguiendo
-- el modelo de la Tabla 22 de SUNAT (PDT PLAME). Antes la afectacion de
-- cada concepto (a que aportes/descuentos entra) y algunos factores/tasas
-- legales estaban "quemados" en motorCalculo.ts; ahora el administrador
-- puede editarlos desde la pestana Configuracion, sin tocar codigo. Los
-- valores sembrados aqui son EXACTAMENTE los que el motor ya usaba antes de
-- esta migracion, asi que instalarla no cambia ningun monto calculado hasta
-- que el administrador edite algo. No destructiva (usa IF NOT EXISTS).
--
-- Las FORMULAS en si (que se multiplica por que, cuando aplica cada una
-- segun categoria) siguen fijas en motorCalculo.ts - solo los numeros/tasas
-- dentro de esas formulas se volvieron editables aqui.

CREATE TABLE IF NOT EXISTS conceptos_planilla (
    id                  SERIAL PRIMARY KEY,
    codigo              VARCHAR(60) NOT NULL UNIQUE,
    nombre              VARCHAR(120) NOT NULL,
    descripcion         TEXT,
    orden               INT NOT NULL DEFAULT 0,

    factor1             NUMERIC(12,6),
    factor1_etiqueta    VARCHAR(120),
    factor2             NUMERIC(12,6),
    factor2_etiqueta    VARCHAR(120),
    factor3             NUMERIC(12,6),
    factor3_etiqueta    VARCHAR(120),

    afecto_essalud      BOOLEAN NOT NULL DEFAULT false,
    afecto_sctr         BOOLEAN NOT NULL DEFAULT false,
    afecto_senati       BOOLEAN NOT NULL DEFAULT false,
    afecto_onp          BOOLEAN NOT NULL DEFAULT false,
    afecto_afp          BOOLEAN NOT NULL DEFAULT false,
    afecto_renta5ta     BOOLEAN,
    afecto_conafovicer  BOOLEAN NOT NULL DEFAULT false,

    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO conceptos_planilla
    (codigo, nombre, descripcion, orden,
     factor1, factor1_etiqueta, factor2, factor2_etiqueta, factor3, factor3_etiqueta,
     afecto_essalud, afecto_sctr, afecto_senati, afecto_onp, afecto_afp, afecto_renta5ta, afecto_conafovicer)
SELECT * FROM (VALUES
    ('SUELDO_BASICO', 'Sueldo / Jornal básico', 'Remuneración base del período: jornal diario x días trabajados, o sueldo mensual prorrateado para Empleados.', 10,
     NULL::numeric, NULL::varchar, NULL::numeric, NULL::varchar, NULL::numeric, NULL::varchar,
     true, true, true, true, true, true::boolean, true),

    ('REM_DOMINICAL', 'Remuneración dominical', 'Pago por días de descanso dominical trabajados.', 20,
     NULL, NULL, NULL, NULL, NULL, NULL,
     true, true, true, true, true, true, true),

    ('REM_FERIADO', 'Remuneración feriado', 'Pago por feriados no laborados.', 30,
     NULL, NULL, NULL, NULL, NULL, NULL,
     true, true, true, true, true, true, false),

    ('HORAS_EXTRA_CONSTRUCCION', 'Horas extra (construcción civil)', 'Recargo sobre el valor hora del jornal, según convenio colectivo de construcción civil.', 40,
     1.60, 'Recargo primeras 2 horas (multiplicador del valor hora)', 2.00, 'Recargo horas adicionales (multiplicador)', 2.00, 'Recargo tramo 100% (multiplicador)',
     true, true, false, true, true, true, false),

    ('HORAS_EXTRA_GENERAL', 'Horas extra (régimen general / Empleado)', 'Recargo legal estándar (D.S. 007-2002-TR).', 50,
     1.25, 'Recargo primeras 2 horas (multiplicador del valor hora)', 1.35, 'Recargo horas adicionales (multiplicador)', 2.00, 'Recargo tramo 100% (multiplicador)',
     true, true, false, true, true, true, false),

    ('ASIGNACION_FAMILIAR', 'Asignación familiar', 'Solo Empleados con hijos: porcentaje de la Remuneración Mínima Vital (RMV).', 60,
     0.10, 'Porcentaje de la RMV', NULL, NULL, NULL, NULL,
     true, true, true, true, true, true, false),

    ('ASIGNACION_ESCOLARIDAD', 'Asignación por escolaridad', 'Solo construcción civil con hijos: 30 jornales básicos al año por hijo (RD N°100-72-DPRTESS).', 70,
     12, 'Divisor (jornal ÷ este número = monto diario por hijo)', NULL, NULL, NULL, NULL,
     false, false, false, false, false, true, false),

    ('BUC', 'Bonificación Unificada de Construcción (BUC)', 'Solo construcción civil. La tasa se configura en Parámetros → Tabla salarial mensual, por categoría.', 80,
     NULL, NULL, NULL, NULL, NULL, NULL,
     true, true, true, true, true, true, false),

    ('BAE', 'Bonificación por Alta Especialización (BAE)', 'Solo operarios especializados (EP/EM/TP). La tasa se configura en Parámetros → Tabla salarial mensual.', 90,
     NULL, NULL, NULL, NULL, NULL, NULL,
     true, true, false, true, true, true, false),

    ('MOVILIDAD', 'Bonificación por movilidad', 'Solo construcción civil. El monto fijo por día se configura en Parámetros → Tabla salarial mensual.', 100,
     NULL, NULL, NULL, NULL, NULL, NULL,
     false, false, false, false, false, true, false),

    ('GRATIFICACION', 'Gratificación (Fiestas Patrias / Navidad)', 'Construcción civil: se paga cada período (factor diario). Empleado: pago semestral con fórmula fija (jul/dic), no editable aquí. Su afectación a Renta de 5ta ya está incorporada en la fórmula anual de Empleado, por eso esa columna no aplica para este concepto.', 110,
     40, 'Numerador en jornales básicos (solo construcción civil)', 210, 'Denominador en días (solo construcción civil)', NULL, NULL,
     false, false, false, false, false, NULL, false),

    ('BONIFICACION_EXTRAORDINARIA', 'Bonificación Extraordinaria (Ley 29351/30334)', 'Porcentaje de la gratificación, pagado en efectivo en vez de EsSalud. Su afectación a Renta de 5ta ya está incorporada en la fórmula anual de Empleado, por eso esa columna no aplica para este concepto.', 120,
     0.09, 'Porcentaje de la gratificación', NULL, NULL, NULL, NULL,
     false, false, false, false, false, NULL, false),

    ('CTS', 'Compensación por Tiempo de Servicios (CTS)', 'Construcción civil: se devenga cada período (factor diario). Empleado: depósito semestral con fórmula fija (may/nov), no editable aquí. Totalmente inafecta a aportes y descuentos.', 130,
     0.15, 'Porcentaje del jornal diario (solo construcción civil)', NULL, NULL, NULL, NULL,
     false, false, false, false, false, false, false),

    ('VACACIONES', 'Vacaciones (construcción civil)', 'Solo construcción civil, se devenga cada período. Para Empleado, ver el módulo de récord vacacional en la pestaña Vacaciones.', 140,
     0.10, 'Porcentaje del jornal diario', NULL, NULL, NULL, NULL,
     true, true, false, true, true, true, false)
) AS datos(codigo, nombre, descripcion, orden, factor1, factor1_etiqueta, factor2, factor2_etiqueta, factor3, factor3_etiqueta,
           afecto_essalud, afecto_sctr, afecto_senati, afecto_onp, afecto_afp, afecto_renta5ta, afecto_conafovicer)
WHERE NOT EXISTS (SELECT 1 FROM conceptos_planilla WHERE conceptos_planilla.codigo = datos.codigo);
