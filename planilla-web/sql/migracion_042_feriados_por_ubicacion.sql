-- Migracion 042: ambito geografico de los dias feriados (Nacional /
-- Regional / Local), para que un feriado regional/local (ej. aniversario
-- de Piura) NO se aplique a un proyecto de otra region (ej. uno en Lima).
--
-- Contexto (22/09/2026): el sistema hoy trata TODO feriado como si
-- aplicara a TODOS los proyectos por igual, sin importar en que
-- departamento/provincia/distrito este cada obra. El usuario pidio
-- explicitamente distinguir el alcance de cada feriado y que el sistema
-- determine automaticamente si aplica o no segun el proyecto en el que el
-- trabajador estuvo asignado cada dia (ya cubierto por como
-- agregarTareoDiario recibe el periodo -> proyecto de cada tramo).
--
-- Se reutiliza el catalogo UBIGEO ya existente (catalogo_ubigeo_*,
-- migracion_016) en vez de inventar un modelo de geografia nuevo, tal
-- como recomendo el usuario ("estructura geografica normalizada"). Si en
-- el futuro se agregan paises fuera de Peru, este mismo mecanismo se
-- puede extender con una tabla catalogo_pais + una columna pais_codigo,
-- sin tener que rediseñar esto.
--
-- NOTA (recon 31/46): esta migracion ORIGINALMENTE tambien agregaba
-- ambito/ubigeo_* a una tabla "dias_feriados" (el catalogo central de
-- feriados, con su propia pantalla CRUD dentro de Configuracion -> "Dias
-- feriados") y la logica de coincidencia geografica en agregarTareoDiario
-- (routes/planilla.ts). Esa parte se omite por completo: la tabla
-- "dias_feriados" en si NUNCA existio en este arbol reconstruido -
-- ninguno de los 46 parches recuperados la crea (ni su CRUD en
-- routes/conceptos.ts, ni su pestaña en Configuracion.tsx) - el feriado
-- se registra hoy a mano por el tareador (horas_feriado/minutos_feriado
-- en el Tareo Diario), sin un calendario central. Ver
-- RECONSTRUCCION_BRECHAS.md punto 15 para el detalle completo. Se
-- conserva SOLO la parte de abajo (ubicacion UBIGEO de "proyectos", que
-- ya existe como tabla) porque no depende de "dias_feriados" y queda
-- lista para cuando ese catalogo se reconstruya en el futuro (via
-- Proyectos.tsx, ya con sus selects en cascada de
-- departamento/provincia/distrito).

-- ---------------------------------------------------------------------
-- Ubicacion geografica de cada proyecto (opcional, se completa desde
-- Proyectos). "Provincia" alcanza para un feriado LOCAL de alcance
-- provincial completo; "Distrito" es opcional, para cuando el feriado es
-- de un distrito/localidad puntual.
-- ---------------------------------------------------------------------
ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS ubigeo_departamento_codigo VARCHAR(2) REFERENCES catalogo_ubigeo_departamento(codigo),
  ADD COLUMN IF NOT EXISTS ubigeo_provincia_codigo    VARCHAR(4) REFERENCES catalogo_ubigeo_provincia(codigo),
  ADD COLUMN IF NOT EXISTS ubigeo_distrito_codigo     VARCHAR(6) REFERENCES catalogo_ubigeo_distrito(codigo);

-- Sin GRANT nuevo: no se crea ninguna tabla, solo se agregan columnas a
-- una tabla ya existente (proyectos) que grupojhc_boletas ya puede
-- leer/escribir.
