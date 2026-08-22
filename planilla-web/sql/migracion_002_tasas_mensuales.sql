-- =========================================================================
-- Migracion 002: separar tasas AFP y tabla salarial (mensuales) de los
-- demas parametros normativos (anuales: UIT, RMV, ESSALUD, ONP, etc.)
--
-- Ejecutar UNA VEZ en pgAdmin (Query Tool) sobre planilla_construccion.
-- NO borra ninguna tabla existente ni datos de trabajadores/planillas.
-- =========================================================================

-- 1) Agregar remuneracion_minima_vital a los parametros anuales
ALTER TABLE parametros_normativos
    ADD COLUMN IF NOT EXISTS remuneracion_minima_vital NUMERIC(10,2) NOT NULL DEFAULT 0;

-- 2) Crear las tablas mensuales nuevas
CREATE TABLE IF NOT EXISTS tasas_afp_mensuales (
    id                  SERIAL PRIMARY KEY,
    anio                INT NOT NULL,
    mes                 INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    afp_nombre          VARCHAR(30) NOT NULL,
    comision_flujo      NUMERIC(6,4) NOT NULL DEFAULT 0,
    prima_seguro        NUMERIC(6,4) NOT NULL DEFAULT 0,
    aporte_obligatorio  NUMERIC(6,4) NOT NULL DEFAULT 0.10,
    UNIQUE (anio, mes, afp_nombre)
);

CREATE TABLE IF NOT EXISTS tabla_salarial_mensual (
    id              SERIAL PRIMARY KEY,
    anio            INT NOT NULL,
    mes             INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    categoria       VARCHAR(30) NOT NULL,
    jornal_basico   NUMERIC(10,2) NOT NULL,
    buc             NUMERIC(6,4) NOT NULL DEFAULT 0,
    UNIQUE (anio, mes, categoria)
);

-- 3) Copiar los valores que ya tenias en afp_tasas/tabla_categorias (JSONB)
--    hacia las tablas nuevas, para el mes actual de cada fila existente de
--    parametros_normativos, solo si esas columnas todavia existen.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'parametros_normativos' AND column_name = 'afp_tasas'
    ) THEN
        INSERT INTO tasas_afp_mensuales (anio, mes, afp_nombre, comision_flujo, prima_seguro, aporte_obligatorio)
        SELECT
            p.anio,
            2 AS mes, -- se asume febrero 2026 (el mes de origen de los datos); ajustalo si corresponde
            afp.key AS afp_nombre,
            (afp.value->>'comision_flujo')::numeric,
            (afp.value->>'prima_seguro')::numeric,
            (afp.value->>'aporte_obligatorio')::numeric
        FROM parametros_normativos p, jsonb_each(p.afp_tasas) AS afp
        ON CONFLICT (anio, mes, afp_nombre) DO NOTHING;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'parametros_normativos' AND column_name = 'tabla_categorias'
    ) THEN
        INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc)
        SELECT
            p.anio,
            2 AS mes,
            cat.key AS categoria,
            (cat.value->>'jornal_basico')::numeric,
            (cat.value->>'buc')::numeric
        FROM parametros_normativos p, jsonb_each(p.tabla_categorias) AS cat
        ON CONFLICT (anio, mes, categoria) DO NOTHING;
    END IF;
END $$;

-- 4) Quitar las columnas viejas (ya migradas a las tablas mensuales)
ALTER TABLE parametros_normativos DROP COLUMN IF EXISTS afp_tasas;
ALTER TABLE parametros_normativos DROP COLUMN IF EXISTS tabla_categorias;

-- 5) Agregar OPERARIO_EM y OPERARIO_TP a la tabla salarial (comparten el
--    jornal de OPERARIO, si ya existe una fila OPERARIO para ese mes)
INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc)
SELECT anio, mes, 'OPERARIO_EM', jornal_basico, buc FROM tabla_salarial_mensual WHERE categoria = 'OPERARIO'
ON CONFLICT (anio, mes, categoria) DO NOTHING;

INSERT INTO tabla_salarial_mensual (anio, mes, categoria, jornal_basico, buc)
SELECT anio, mes, 'OPERARIO_TP', jornal_basico, buc FROM tabla_salarial_mensual WHERE categoria = 'OPERARIO'
ON CONFLICT (anio, mes, categoria) DO NOTHING;
