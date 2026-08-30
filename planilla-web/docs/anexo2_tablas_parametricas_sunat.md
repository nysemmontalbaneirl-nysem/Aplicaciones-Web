# Anexo 2 — Tablas Paramétricas de la Planilla Electrónica (SUNAT)

- **Archivo fuente**: [`anexo2_tablas_parametricas_sunat.xlsx`](./anexo2_tablas_parametricas_sunat.xlsx)
  (`tablas_parametricas_actualizada-27-08-26.xlsx`, proporcionado por el
  usuario, 27/08/2026).
- Es el catálogo oficial completo de SUNAT/T-Registro: **37 tablas** (T1 a
  T37), cada una con sus códigos y descripciones oficiales. La `TABLA22.xls`
  guardada por separado en `docs/TABLA22.xls` es solo la tabla 22 de este
  mismo conjunto — este archivo la incluye también (versión T22 ligeramente
  más nueva, con 3 códigos adicionales frente a la copia suelta del
  25/08/2026, ej. "902 Bono de Productividad").

## Qué contiene cada tabla (resumen)

| Tabla | Contenido | ¿Ya la usa el sistema? |
|---|---|---|
| T1 | Tipo de actividad económica (CIIU) | No |
| T3 | Tipo de documento de identidad (DNI, Carné Ext., RUC, Pasaporte...) | Parcial (el sistema asume DNI) |
| T4 | Nacionalidad | No |
| T5 / T6 | Vía y Zona (para direcciones formales) | No |
| T8 | Tipo de trabajador/pensionista/prestador de servicios | No |
| T9 | Situación educativa | No (ya estaba en `DATA_JHCR.xlsm`) |
| T10 | Ocupación (sector público) | No aplica (empresa privada) |
| **T11** | **Régimen pensionario** (ONP=02, AFP Integra=21, Horizonte=22, Profuturo=23, Prima=24, Habitat=25, sin régimen=99...) | **Parcial** — el sistema ya guarda `afp_nombre`/`sistema_pension` como texto libre, sin catálogo ni código oficial |
| T12 | Tipo de contrato / condición laboral | No |
| T13 | Periodicidad de la remuneración | No (el sistema asume mensual/quincenal implícito) |
| T14 | EPS / servicios propios | No |
| T15 | Situación del trabajador (activo, baja, suspendido...) | No |
| T16 | Tipo de pago (efectivo, depósito, otros) | No |
| T17 | Motivo de baja | No (el sistema no registra ceses con motivo aún) |
| T18-T20 | Modalidad formativa, vínculo familiar, motivo baja derechohabiente | No aplica hoy |
| **T21** | **Tipo de suspensión de la relación laboral** | No — relevante para el archivo `.snl` (días subsidiados/no laborados), ver informe de hallazgos legado |
| T22 | Ingresos, tributos y descuentos (los códigos PLAME) | **Sí** — ya extraído en `tabla22_plame.md/json` |
| **T23** | **Tipo de comprobante del prestador de servicios 4ta** (R=recibo por honorarios, N=nota de crédito, D=dieta, O=otro) | No — relevante para `.4TA`, que hoy el sistema no genera |
| T24 | Categoría ocupacional **oficial** SUNAT (Ejecutivo/Obrero/Empleado/Funcionario/Profesional/Técnico/Auxiliar...) | **No es lo mismo que el campo actual** — ver nota abajo |
| T25 | Convenios para evitar doble tributación | No |
| T26 | País emisor del documento (solo pasaporte) | No |
| T27 | Documento que sustenta vínculo familiar | No |
| T28 | **UBIGEO RENIEC** (departamento/provincia/distrito, miles de filas) | No — el sistema guarda `ubigeo` como texto libre |
| T29 | Códigos de larga distancia nacional | No |
| T30 | Ocupación aplicable al sector privado | No |
| T31 | Pliego presupuestal | No aplica (empresa privada) |
| T32 | Régimen de aseguramiento de salud | No |
| T33 | Régimen laboral (D.Leg. 728, 276, etc.) | No |
| T34 | Instituciones educativas y carreras | No |
| T35 | Situación especial (dirección, confianza, teletrabajo...) | No |
| **T36** | **Entidades del sistema financiero** (46 bancos/financieras/cajas, con código de 3 dígitos) | **No** — el campo `entidad_bancaria` es texto libre hoy |
| T37 | Organizaciones sindicales del sector público | No aplica (empresa privada) |

## Utilidad concreta para el sistema — lo que pediste

**Banco (dropdown en vez de texto libre):** hoy `contratos.entidad_bancaria`
es `VARCHAR(100)` sin validación (`sql/schema.sql` línea 184) — cualquiera
puede escribir "BCP", "Banco de Credito", "bcp" para el mismo banco. Con la
T36 se puede construir un desplegable de 46 opciones oficiales (código +
nombre, ej. `002 BANCO DE CRÉDITO DEL PERÚ`, `011 BBVA BANCO CONTINENTAL`,
`018 BANCO DE LA NACIÓN`) y guardar el código en vez del texto. Esto es
rápido de implementar: una tabla pequeña de catálogo + un `<select>` en el
formulario de alta del trabajador.

**Régimen pensionario / AFP (dropdown):** mismo caso — `afp_nombre` es texto
libre hoy. La T11 da los 5 códigos de AFP realmente vigentes en Perú
(Integra=21, Profuturo=23, Prima=24, Habitat=25 — Horizonte=22 ya no opera,
se fusionó hace años, así que no hace falta ofrecerlo) más ONP=02. Se puede
reemplazar por un desplegable oficial igual de simple que el de bancos.

**Categoría ocupacional — ojo, son DOS cosas distintas:** el campo actual
`contratos.categoria_ocupacional` (`OPERARIO | OFICIAL | PEON | EMPLEADO |
EVENTUAL | OPERARIO EP`) es la categoría del **convenio colectivo de
construcción civil** — determina las reglas de cálculo del sistema (BUC,
jornales, etc.) y es específica de este gremio, no es un código SUNAT. La
T24 "Categoría Ocupacional" oficial es otra cosa: solo tiene
Ejecutivo/Obrero/Empleado/Funcionario/Profesional/Técnico/Auxiliar — SUNAT
la pide en el T-Registro como dato adicional, no reemplaza a la categoría
del sistema. Si más adelante el sistema necesita generar también el
T-Registro (no solo PLAME), habría que agregar un campo nuevo con el código
T24 (probablemente derivado automáticamente: OPERARIO/OFICIAL/PEON → 02
OBRERO, EMPLEADO → 03 EMPLEADO), sin tocar el campo actual.

**Otras tablas que valen la pena para más adelante:**
- T21 (tipo de suspensión) y T23 (tipo de comprobante 4ta) son directamente
  necesarias si el sistema llega a generar los archivos `.snl` y `.4TA` que
  hoy no genera (ver el informe de hallazgos del sistema legado).
- T28 (UBIGEO) permitiría reemplazar el campo de texto libre `ubigeo` por un
  desplegable oficial en cascada (departamento → provincia → distrito),
  aunque es una tabla grande (miles de distritos) — conviene evaluarla
  aparte, no es urgente.
- El resto (T1, T4-T10, T12-T20, T25-T35) son para cuando el sistema necesite
  generar el T-Registro completo (no solo boletas/PLAME), que hoy no es el
  caso.

## Próximo paso sugerido

Empezar por lo que ya pediste explícitamente — banco y AFP — porque son
cambios chicos y de alto impacto (mejoran la calidad del dato desde el alta
del trabajador). La categoría ocupacional oficial (T24) y el resto quedan
para cuando se decida encarar el T-Registro completo.
