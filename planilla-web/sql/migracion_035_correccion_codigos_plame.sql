-- =========================================================================
-- Migracion 035: correccion de codigos PLAME faltantes/incorrectos en
-- conceptos_planilla.
--
-- Al revisar el archivo .rem real (Planilla Mensual Consolidada) contra el
-- catalogo oficial Tabla 22 de SUNAT y contra el sistema Excel/VBA legado de
-- la empresa (analisis ya documentado en
-- docs/referencia-excel-legado/hallazgos-analisis-legado.md), se confirmo
-- que varios conceptos que SI se calculan y SI se pagan correctamente
-- (entran a total_ingresos/neto_pagar) nunca se declaraban en el archivo
-- PLAME porque su codigo_plame estaba vacio, o -en el caso del BUC y de los
-- subsidios- tenian un codigo incorrecto o mal formado. Este archivo
-- corrige unicamente los codigos guardados en conceptos_planilla; el
-- cableado en src/plame.ts para que esos codigos realmente se usen en el
-- generador del .rem se entrega en el mismo commit que esta migracion.
--
-- Todos estos codigos siguen siendo editables desde Configuracion ->
-- Conceptos de ingreso -> columna "Codigo PLAME" sin necesitar otra
-- migracion ni despliegue.
-- =========================================================================

-- BUC: '0314' es un codigo real del catalogo, pero corresponde a
-- "Bonificacion especial por trabajo agrario - Ley 31110 (BETA)", un
-- concepto agricola sin relacion con construccion civil. El codigo correcto
-- es '0311' ("Bonificacion Unificada de Construccion").
UPDATE conceptos_planilla SET codigo_plame = '0311' WHERE codigo = 'BUC' AND codigo_plame = '0314';

-- Asignacion por escolaridad: sin codigo declarado hasta ahora. Ya se habia
-- confirmado con el usuario en una sesion anterior: '0211' ("Asignacion por
-- escolaridad 30 jornales basicos/año").
UPDATE conceptos_planilla SET codigo_plame = '0211' WHERE codigo = 'ASIGNACION_ESCOLARIDAD' AND codigo_plame IS NULL;

-- Movilidad: sin codigo declarado. '0909' ("Movilidad supeditada a
-- asistencia y que cubre solo el traslado") coincide con como se paga aqui
-- (monto fijo por dia trabajado, tabla salarial mensual).
UPDATE conceptos_planilla SET codigo_plame = '0909' WHERE codigo = 'MOVILIDAD' AND codigo_plame IS NULL;

-- Vacaciones: sin codigo declarado. Se usa '0117' ("Compensacion
-- vacacional": se paga en efectivo cada periodo, sin que el trabajador
-- salga de vacaciones realmente) en vez de '0118' ("Remuneracion
-- vacacional", pago durante un goce real) o '0114' ("Vacaciones truncas",
-- pago al cese). Editable despues desde Configuracion si el usuario
-- prefiere otro codigo.
UPDATE conceptos_planilla SET codigo_plame = '0117' WHERE codigo = 'VACACIONES' AND codigo_plame IS NULL;

-- Bonificacion Extraordinaria (Ley 29351/30334, 9% de la gratificacion):
-- sin codigo declarado. Se usa '0313' ("proporcional") en vez de '0312'
-- ("temporal"): este concepto se calcula cada periodo junto con la
-- gratificacion de construccion civil, nunca como un monto semestral fijo
-- unico.
UPDATE conceptos_planilla SET codigo_plame = '0313' WHERE codigo = 'BONIFICACION_EXTRAORDINARIA' AND codigo_plame IS NULL;

-- Subsidio por enfermedad y licencia por paternidad: los codigos ya
-- declarados no tenian el 0 inicial (formato de 3 digitos en vez de 4),
-- generando una linea mal formada en el archivo .rem.
UPDATE conceptos_planilla SET codigo_plame = '0916' WHERE codigo = 'SUBSIDIO_ENFERMEDAD' AND codigo_plame = '916';
UPDATE conceptos_planilla SET codigo_plame = '0907' WHERE codigo = 'LICENCIA_PATERNIDAD' AND codigo_plame = '907';

-- NOTA: BAE (Bonificacion por Alta Especializacion) queda sin codigo_plame
-- a proposito - no se encontro en el catalogo Tabla 22 ninguna descripcion
-- que coincida con este concepto especifico de JHCR. Pendiente de que el
-- usuario confirme bajo que codigo declararlo antes de conectarlo al .rem.
