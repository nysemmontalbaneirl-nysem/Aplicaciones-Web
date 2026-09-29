-- Migracion 046: Importacion de marcaciones biometricas (Ronda 2, "puente
-- practico" - control de asistencia diaria).
--
-- Contexto: mientras el usuario compra/verifica el equipo biometrico (lector
-- de huella) y su software propio de exportacion, se acordo avanzar de forma
-- practica: el usuario llena a mano una plantilla Excel (1 fila por cada
-- marcacion individual: DNI, nombre, fecha, hora, tipo ENTRADA/SALIDA -
-- exactamente el formato crudo que exporta un equipo biometrico real) y el
-- sistema la importa, calcula automaticamente horas normales/extra por dia
-- (comparando la marca de ingreso/salida contra el horario configurado por
-- proyecto, migracion 045) y las deja en una pantalla de revision manual
-- antes de aplicarlas al Tareo Diario real (regla de negocio ya confirmada
-- hace tiempo: todo dato calculado a partir de biometria pasa por revision
-- humana antes de afectar una planilla).
--
-- Esta migracion NO cambia el calculo de planillas ni el Tareo Diario en si
-- - solo agrega el area de "bandeja" donde vive una importacion mientras se
-- revisa: una vez que el usuario aprueba, el sistema escribe los dias
-- aprobados en tareo_diario usando la MISMA validacion (limites de tareo,
-- vigencia del contrato) que ya usa la edicion manual del Tareo Diario.
--
-- importaciones_marcaciones: una fila por cada archivo importado (permite
-- reintentar/corregir sin perder el historial de intentos anteriores).
CREATE TABLE IF NOT EXISTS importaciones_marcaciones (
    id                  SERIAL PRIMARY KEY,
    periodo_id          INT NOT NULL REFERENCES periodos_planilla(id) ON DELETE CASCADE,
    nombre_archivo      VARCHAR(255),
    importado_por       INT REFERENCES usuarios(id),
    importado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    total_marcaciones   INT NOT NULL DEFAULT 0,
    total_dias          INT NOT NULL DEFAULT 0,
    total_errores       INT NOT NULL DEFAULT 0,
    -- Errores de fila que no se pudieron resolver (DNI no encontrado, fuera
    -- de vigencia, fecha/hora invalida, etc.) - se guardan para que la
    -- pantalla de revision los muestre, igual que ya hace
    -- POST /:id/tareo/importar con su respuesta { errores }, pero aqui se
    -- persisten porque la revision puede ocurrir en otra sesion.
    errores_json        JSONB NOT NULL DEFAULT '[]',
    aplicado_en         TIMESTAMPTZ,
    aplicado_por        INT REFERENCES usuarios(id)
);

-- importaciones_marcaciones_detalle: una fila por cada combinacion
-- (contrato, fecha) ya calculada - lo que se muestra y se aplica. Se guarda
-- tambien la hora de ingreso/salida real detectada (min/max de las marcas
-- de ese dia) y las marcas crudas (marcas_json) para que la pantalla de
-- revision pueda mostrarle al usuario "de donde salio" cada calculo.
CREATE TABLE IF NOT EXISTS importaciones_marcaciones_detalle (
    id                  SERIAL PRIMARY KEY,
    importacion_id      INT NOT NULL REFERENCES importaciones_marcaciones(id) ON DELETE CASCADE,
    contrato_id         INT NOT NULL REFERENCES contratos(id),
    fecha               DATE NOT NULL,
    hora_ingreso_real   TIME,
    hora_salida_real    TIME,
    -- Mismos 12 campos (y mismo significado) que tareo_diario - se aplican
    -- tal cual, fila por fila, al aprobar (ver PUT /:id/tareo-diario/:contratoId).
    horas_normales          INT NOT NULL DEFAULT 0,
    minutos_normales        INT NOT NULL DEFAULT 0,
    horas_dominical         INT NOT NULL DEFAULT 0,
    minutos_dominical       INT NOT NULL DEFAULT 0,
    horas_feriado           INT NOT NULL DEFAULT 0,
    minutos_feriado         INT NOT NULL DEFAULT 0,
    horas_extra_tramo1      INT NOT NULL DEFAULT 0,
    minutos_extra_tramo1    INT NOT NULL DEFAULT 0,
    horas_extra_tramo2      INT NOT NULL DEFAULT 0,
    minutos_extra_tramo2    INT NOT NULL DEFAULT 0,
    horas_extra_tramo3      INT NOT NULL DEFAULT 0,
    minutos_extra_tramo3    INT NOT NULL DEFAULT 0,
    marcas_json         JSONB NOT NULL DEFAULT '[]',
    aplicado            BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (importacion_id, contrato_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_importaciones_marcaciones_detalle_importacion
    ON importaciones_marcaciones_detalle (importacion_id);

-- GRANTs para el usuario de la aplicacion (grupojhc_boletas) - tablas
-- nuevas, con secuencia propia cada una (PRIMARY KEY SERIAL).
GRANT SELECT, INSERT, UPDATE, DELETE ON importaciones_marcaciones TO grupojhc_boletas;
GRANT USAGE, SELECT ON SEQUENCE importaciones_marcaciones_id_seq TO grupojhc_boletas;
GRANT SELECT, INSERT, UPDATE, DELETE ON importaciones_marcaciones_detalle TO grupojhc_boletas;
GRANT USAGE, SELECT ON SEQUENCE importaciones_marcaciones_detalle_id_seq TO grupojhc_boletas;
