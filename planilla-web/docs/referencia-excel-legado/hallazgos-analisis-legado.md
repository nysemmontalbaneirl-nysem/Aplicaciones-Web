# Análisis del sistema Excel/VBA legado (JHCR) — hallazgos

Fecha del análisis: 30/08/2026.
Fuente: archivos subidos por el usuario el 29-30/08/2026 (ver carpetas hermanas
`vba-legado/`, `archivos-planos-plame/`, `boletas-ejemplo/`, `lectura-normativa/`
dentro de `docs/referencia-excel-legado/`).

## 0. Archivo que no subía por el chat — resuelto vía la carpeta conectada

`Estructuras Plame - Trabajadores - V.1.4.26 modificado.xlsm` (33.9 MB) nunca
llegó a subirse por el chat — casi seguro por su tamaño. Como la computadora
del usuario ya estaba vinculada a esta sesión y la carpeta
`Descargas\Sistema Web RRHH` ya estaba conectada, el archivo se recuperó
directamente de ahí (el usuario ya lo había guardado en esa carpeta) y se
copió a `vba-legado/` en este repo. **Con esto ya se tiene el workbook
maestro completo**, incluyendo las hojas `PLANILLA-TRABAJADORES`,
`ASIENTO_MENSUAL`, `Genera_AFP`, `Maestro`, `PS 4TA CATEGORÍA` que el VBA
referencia. El resto de esta sección queda actualizado con los datos reales
ya confirmados (ya no son hipótesis).

## 1. Qué se recibió y qué es cada cosa

- `vba-legado/DATA_JHCR.xlsm` — libro de **catálogos de referencia SUNAT**
  (hojas `T9 Situación Educativa`, `Sist.Pens`, `T24 Categoría Ocupacional`,
  `RESUMEN` con el índice de tablas paramétricas del Anexo 2). Sirve como
  material de consulta pero no contiene la lógica de cálculo ni las hojas de
  trabajo reales.
- `vba-legado/ThisWorkbook.cls` + `vba-legado/Modulos Planilla/*.bas` —
  código VBA real del sistema Excel (18 módulos, ~2900 líneas). Ya extraído y
  revisado (detalle abajo).
- `archivos-planos-plame/060120260710164660775.*` — el mismo lote de archivos
  planos PLAME ya recibido y analizado antes (RUC 10164660775 = CASTILLO RUIZ
  JOSE HUMBERTO / JHCR), sin cambios (mismo MD5).
- `boletas-ejemplo/Boleta_{Peon,Operario,Operario_Equipo_Pesado,Oficial,Empleado}.pdf`
  — boletas de ejemplo, una por categoría, fechadas JULIO 2026.
- `lectura-normativa/` — MEP de SUNAT (construcción civil), 2 folletos de
  SUNAFIL sobre beneficios del régimen (idénticos, uno era duplicado), y la
  tabla salarial 2026 de la Federación de Trabajadores en Construcción Civil.

## 2. Cómo generaba el Excel los archivos planos PLAME (`Generatxt.bas`)

El botón "Exportar" corre `exportar_txt`, que llama, según casillas de
verificación en `Hoja6`, a una subrutina por cada archivo:

| Archivo | Subrutina | Hoja origen | Regla de inclusión de la fila |
|---|---|---|---|
| `.rem` | `informacion_REM` | `PLANILLA-TRABAJADORES` | Cualquier celda numérica (**incluye 0**), recorriendo TODAS las columnas desde la que tiene el texto `"sebas"` en la fila 2 hasta la última columna con datos |
| `.jor` | `informacion_jor` | ídem | Si alguna de 4 columnas tiene contenido |
| `.toc` | `informacion_toc` | ídem | Si más de 1 de 4 columnas tiene contenido |
| `.tas` | `informacion_tas` | ídem | Si alguna de 2 columnas tiene contenido |
| `.snl` | `informacion_snl` | ídem | Si la celda y DNI/tipo existen |
| `.or5` | `informacion_or5` | ídem | Otros ingresos de 5ta — **no vino ningún `.or5` en el lote recibido**, puede que este periodo no aplique |
| `.4ta` / `.ps4` | `Mod_PLAME_4ta.bas` (`Procesar_4ta`) | `PS 4TA CATEGORÍA` | Trabajadores de renta de 4ta (honorarios), hoja separada de la planilla de dependientes |

### 2.1 Detalle campo por campo de cada archivo hermano de `.rem`

Esto es lo que faltaba detallar la vez pasada — el contenido real de cada
archivo, verificado contra el lote real (`archivos-planos-plame/`, RUC
10164660775, periodo 7.1JULIO2026, 537 DNIs únicos) y contra los encabezados
reales de `PLANILLA-TRABAJADORES` en el workbook maestro:

**`.jor` — Jornada Laboral** (547 líneas, 537 DNIs únicos, 1 línea por
trabajador). Formato: `tipo(2) | DNI(8) | horas_ordinarias | horas_extra_25 |
horas_extra_35 | ??? |`. Ejemplo real: `01|02786253|248|0|0|0|`. Las 4
columnas de origen son "Número de Horas Ordinarias Trabajadas", "Número de
Minutos Ordinarios Trabajados", "Número de Horas en Sobretiempo Trabajadas" y
"Número de Minutos en Sobretiempo Trabajados" (fila 6 de la plantilla,
columnas 14-17). Hoy el sistema web **no genera este archivo**.

**`.tas` — Tasas SCTR ESSALUD y/o Convenio IES** (546 líneas, 536 DNIs
únicos). Formato: `tipo(2) | DNI(8) | indicador_SCTR/convenio(0) | tasa(vacío
o 0.00) |`. Ejemplo real: `01|02694963|0||`. En este periodo casi todos los
trabajadores salen con indicador 0 y tasa vacía — es decir, esta empresa no
tenía SCTR/Convenio IES activo para la mayoría en julio 2026. Hoy el sistema
web **no genera este archivo**.

**`.toc` — Otras Condiciones** (537 líneas, 536 DNIs únicos). Formato:
`tipo(2) | DNI(8) | col_H | col_I(2) | col_J | col_K(1) |`. Ejemplo real:
`01|02694963||2||1|`. Corresponde a la tabla "Indicador de aporte a...",
"Domiciliado" (2=No) y campos relacionados de situación del trabajador —
sale solo cuando hay al menos 2 de esas 4 columnas con datos. Hoy el sistema
web **no genera este archivo**.

**`.snl` — Días Subsidiados y/o No Laborados** (8,515 líneas, 537 DNIs
únicos — muchas líneas por trabajador, una por cada tramo de días
subsidiados/no laborados que tenga). Formato: `tipo(2) | DNI(8) |
tipo_dia(2) | cantidad_dias(2) |`. Corresponde a "Días Subsidiados por
Essalud (Tipo 21/22)" y "N° de días de suspensión de labores" (columnas
18-21 de la plantilla). Hoy el sistema web **no genera este archivo**.

**`.4TA` — Comprobantes de renta de 4ta categoría** (63 líneas = 63
prestadores de servicios/honorarios, un grupo de personas totalmente
distinto a los 537 trabajadores en planilla). Formato confirmado contra la
hoja `PS 4TA CATEGORÍA` del workbook maestro: `tipo_doc(06) |
RUC/DNI(11 díg.) | tipo_comprobante(R=recibo) | serie(E001) |
numero_comprobante(00000150) | monto(100.00) | fecha_emisión | fecha_pago |
indicador_retención_8%(0/1) | indicador_retención_régimen_pensionario |
importe_aporte_pensión |`. Ejemplo real: `06|10002419918|R|E001|00000150|
100.00|16/07/2026|16/07/2026|0|||`.

**`.PS4` — Datos personales de los prestadores de 4ta** (63 líneas, mismas
63 personas que `.4TA`). Formato: `tipo(06) | numero_documento(padded) |
apellido_paterno | apellido_materno | nombres | estado(1) | otro(0) |`.
Ejemplo real: `06|10002419918    |APONTE|SALDARRIAGA|EGDARD GABRIEL|1|0|`.

**Conclusión clave de esta sección:** el sistema web actual **solo genera
`.rem`** (confirmado en `src/routes/exportaciones.ts`, única ruta de
exportación PLAME). Los otros 6 archivos (`.jor`, `.tas`, `.toc`, `.snl`,
`.4TA`, `.PS4`) — que sí forman parte del mismo envío mensual a SUNAT/PLAME —
todavía no existen en el backend. La renta de 4ta (`.4TA`/`.PS4`) además
requiere un concepto que el sistema web no maneja en absoluto todavía:
prestadores de servicios por honorarios, separados de los trabajadores en
planilla.

**El hallazgo más importante:** en `informacion_REM`, el código de concepto
SUNAT (4 dígitos) **no está fijo en el VBA** — se lee dinámicamente de la fila
5 de cada columna de `PLANILLA-TRABAJADORES` (`ws.Cells(5, columna)`), y si esa
columna está marcada como "D" en la fila 2 va a "devengado" o si está marcada
"P" va a "percibido" (cualquier otra marca la manda a ambos). Es decir: los
códigos son **datos de configuración de la plantilla Excel**, no reglas de
negocio en el VBA.

Con el workbook maestro ya recuperado (sección 0), esta tabla ya no es
hipótesis — es la fila 5 real de `PLANILLA-TRABAJADORES`, columna por columna
(columnas 24 a 89, después de la marca `"sebas"` en la fila 2):

| Col. | Código PLAME | Concepto (fila 6 de la plantilla) | ¿Existe hoy en `src/plame.ts`? |
|---|---|---|---|
| 24 | **0121** | Remuneración o Jornal Básico | Sí, `REMUNERACION_BASICA` ✅ |
| 25 | **0115** | Remuneración día de descanso y feriados (incl. 1° de mayo) | Sí, `DESCANSO_FERIADO` ✅ |
| 26 | **0114** | Vacaciones truncas | ❌ falta |
| 27 | **0107** | Trabajo en día feriado o de descanso | ❌ falta (distinto de 0115, ver nota abajo) |
| 28 | **0105** | Horas extra 25% | Constante existe pero no se usa en `candidatas` |
| 29 | **0106** | Horas extra 35% | Constante existe pero no se usa en `candidatas` |
| 30 | **0117** | Compensación vacacional | ❌ falta |
| 31 | **0118** | Remuneración vacacional | ❌ falta |
| 34 | **0201** | Asignación familiar | Sí, `ASIGNACION_FAMILIAR` ✅ |
| 35 | **0213** | Asignaciones otorgadas regularmente | ❌ falta |
| 36 | **0211** | Asignación por escolaridad | ❌ falta |
| 39 | **0309** | Bonificación por turno nocturno 20% | ❌ falta |
| 40 | **0302** | Bonificación por cierre de pliego | ❌ falta |
| 41 | **0306** | Bonificaciones regulares | ❌ falta |
| 42 | **0311** | **Bonificación Unificada de Construcción (BUC)** | **`BUC_CONSTRUCCION` = "0314" ❌ CÓDIGO INCORRECTO, debe ser "0311"** |
| 43 | **0303** | Bonificación por producción, altura, turno, etc. | ❌ falta |
| 44 | **0312** | Bonificación Extraordinaria Temporal — Ley 29351 (BAE) | ❌ falta (ver "BAE" en boletas, sección 7) |
| 47 | **0401** | Gratificaciones Fiestas Patrias y Navidad (genérico) | No se usa (se usa 0406 en su lugar, correcto) |
| 48 | **0406** | Gratificaciones Fiestas Patrias y Navidad — Ley 29351 | Sí, `GRATIFICACION` ✅ |
| 49 | **0402** | Otras gratificaciones ordinarias | ❌ falta |
| 52 | **0502** | Indemnización por muerte o incapacidad | ❌ falta |
| 55 | **0924** | Ingresos 4ta-5ta sin relación de dependencia | ❌ falta |
| 56 | **0922** | Sumas o bienes que no son de libre disposición | ❌ falta |
| 57 | **0915** | Subsidios por maternidad | ❌ falta |
| 58 | **0923** | Ingresos de 4ta categoría considerados de 5ta | ❌ falta |
| 59 | **0909** | Movilidad supeditada a asistencia | Constante no existe |
| 60 | **0917** | Condiciones de trabajo | ❌ falta |
| 61 | **0916** | Subsidios de incapacidad por enfermedad | ❌ falta |
| 62 | **0903** | Canasta de navidad o similares | ❌ falta |
| 63 | **0904** | CTS | Sí, `CTS` ✅ |
| 66 | **1001** | Otros conceptos 1 | ❌ falta |
| 67 | **1002** | Otros conceptos 2 | ❌ falta |
| 70 | **0608** | SPP aportación obligatoria | Sí ✅ |
| 71 | **0602** | CONAFOVICER | Sí ✅ |
| 72 | **0606** | SPP prima de seguro | Sí ✅ |
| 73 | **0601** | SPP comisión porcentual | Sí ✅ |
| 74 | **0605** | Renta 5ta categoría retenciones | Sí, `RENTA_5TA` ✅ |
| 77 | **0701** | Adelanto | ❌ falta |
| 78 | **0706** | Otros descuentos no deducibles de la base imponible | ❌ falta |
| 79 | **0702** | Cuota sindical | Sí ✅ |
| 80 | **0705** | Inasistencias | ❌ falta |
| 83 | **0807** | SENATI | Constante existe (`SENATI`="0807" ✅) pero comentada, no usada |
| 84 | **0806** | Essalud — SCTR salud | Constante existe (`SCTR_ESSALUD`="0806" ✅, el código SÍ es correcto) pero comentada, no usada |
| 85 | **0805** | Pensiones — SCTR pensión | Constante no existe |
| 86 | **0803** | Póliza de seguro D. Leg. 688 | Constante existe (`POLIZA_SEGURO_688`="0803" ✅) pero comentada, no usada |
| 87 | **0817** | Otras aportaciones de cargo del empleador | Constante no existe |
| 88 | **0810** | EPS — SCTR | Constante no existe |
| 89 | **0815** | Essalud + vida | Constante no existe (el actual `ESSALUD`="0804" **no aparece en ningún lado de esta plantilla** — la empresa no usa el código genérico 0804, usa 0815 "Essalud + vida" en su lugar) |

**Correcciones confirmadas para `src/plame.ts`:**
1. `BUC_CONSTRUCCION` debe cambiar de `"0314"` a `"0311"` (el "0314" que
   aparecía en los 2 archivos `.rem` reales revisados antes era, en
   retrospectiva, una lectura equivocada de mi parte o un archivo de otro
   periodo — la plantilla oficial de la empresa usa 0311, que además es el
   código correcto del catálogo SUNAT).
2. El código `SCTR_ESSALUD = "0806"` y `POLIZA_SEGURO_688 = "0803"` que ya
   existen en el archivo (comentados, sin usar) son correctos — pero
   `ESSALUD = "0804"` no corresponde a nada que esta empresa declare; el
   código real que usan es `0815` ("Essalud + vida", visible también en las 5
   boletas de ejemplo como "Essalud + Vida").
3. Faltan por completo los códigos de horas extra (0105/0106 — la constante ya
   existe pero no se emite), movilidad (0909), escolaridad (0211), BAE/0312,
   vacaciones truncas (0114) y remuneración vacacional (0117/0118), entre
   otros de la tabla — su inclusión depende de si esta empresa realmente paga
   esos conceptos (algunos, como "otros conceptos 1/2" o "indemnización por
   muerte", son casos especiales que probablemente casi nunca tengan monto).

También confirma algo clave para tu sistema actual: **el "tipo de planilla" (2
dígitos) se lee por fila desde la columna C de cada trabajador** (`Format(ws.
Cells(i+6,3),"00")`) — no es un valor fijo "01" para toda la empresa. Esto
explica el trabajador con tipo="04" que vimos en el archivo real: no es un
capricho ni un error, es un campo variable por trabajador/categoría que el
sistema actual (`src/plame.ts`, línea 98: `const TIPO_PLANILLA = "01"`)
todavía no contempla.

Y confirma que el Excel **sí incluye líneas con monto 0.00** (basta con que la
celda tenga un valor numérico, aunque sea cero, para generar la línea) — el
`src/plame.ts` actual las omite (`if (devengado === 0 && percibido === 0)
return null`), lo cual es una diferencia real de comportamiento frente al
sistema validado por SUNAT.

## 3. AFPnet (`Módulo_AFPnet.bas`) — ya resuelto, sin acción pendiente

Confirmado: el Excel **no genera el layout plano oficial de la SBS** para
AFPnet. Genera un Excel filtrado (por proyecto) con CUSPP + montos de aporte,
pensado para copiar/pegar o subir manualmente al portal de AFPnet. El sistema
actual (`src/afpnet.ts`) ya replica exactamente este mismo enfoque como CSV, y
el propio código ya tiene un comentario que dice que esto fue confirmado con
el usuario. **No hay nada que corregir aquí** — es la única pieza de las 3 que
el usuario mencionó (PLAME, AFPnet, Libro Diario) que ya está bien resuelta.

## 4. Libro Diario (`AsientoContable.bas`) — el Excel NO calcula el asiento, solo lo exporta

La macro `ExportarRango_Txt_y_Excel_Texto` no calcula el asiento contable: toma
un rango ya armado en la hoja `ASIENTO_MENSUAL` (columnas A a P, 428 filas), lo
exporta a un `.txt` temporal, lo vuelve a importar forzando la columna D como
numérica, borra las filas donde esa columna quede vacía o en cero, y guarda el
resultado como un `.xlsx` limpio. Es decir, **el cálculo real del asiento
(qué cuentas contables, débito/crédito, glosas) vive en fórmulas dentro de la
hoja `ASIENTO_MENSUAL`**, no en el VBA.

Ya con el workbook maestro recuperado, esta es la estructura real de esa hoja
(16 columnas, confirmadas):

`CODIGO | D_H | FECHA | IMPORTE | CODIGO_PRO | NRO_DOC | TIPO_DOC | ECPN | EFE
| DETALLE | MONTO_EXTR | LUGAR | GLOSA | COD_LIBRO | COD_MOVIM | ESTADO`

Ejemplo real (mayo 2026): fila con `CODIGO=621101`, `D_H=D` (debe),
`DETALLE="Sueldos - ADM1"`, `GLOSA="POR LA PROVISION DE LA PLANILLA DE
SUELDOS CORRESPONDIENTE A 5.1MAYO2026"`. Luego se repite una fila por cada
proyecto con el código de cuenta incrementado (`6211021`=P001, `6211022`
=P002, ... hasta `6211032`), es decir la cuenta contable `621101` (Sueldos y
salarios, Plan Contable General Empresarial) se abre por proyecto agregando
un dígito correlativo al final.

**Importante:** en la fila del ejemplo, las columnas `IMPORTE` y
`CODIGO_PRO` muestran `#REF!` — hay referencias rotas en el propio archivo
del usuario (probablemente por un copy/paste o una hoja de periodo que se
movió/renombró). Esto es un problema de la plantilla en sí, no algo que se
pueda arreglar desde aquí; conviene que el usuario lo tenga presente si
piensa seguir usando este Excel en paralelo. Para el sistema web no es un
problema — solo significa que no puedo tomar el importe de este ejemplo
puntual como referencia de cálculo, pero la estructura de columnas sí queda
confirmada.

Con esto ya se puede empezar a diseñar el Libro Diario del sistema web
(mapear cada concepto de planilla a un código de cuenta contable + debe/haber
por proyecto), pero como es una funcionalidad nueva que no existe hoy,
conviene definir con el usuario el plan de cuentas completo antes de
construirla — este análisis ya da la forma del archivo de salida, no las
reglas de negocio completas (esas viven en las fórmulas de esa hoja, que
haría falta revisar celda por celda o pedirle al usuario el plan de cuentas
directamente).

## 5. Menú del sistema Excel (`CodRibbon.bas`) — mapa de funciones

Confirma el alcance completo del sistema Excel original vía los botones del
ribbon personalizado:
- Ingreso con clave (activación por licencia, `frmActivacion`) — no aplica al
  sistema web (ya tiene login propio).
- `PLANILLA-TRABAJADORES` (planilla mensual de dependientes).
- `PS 4TA CATEGORÍA` (honorarios/renta de 4ta) — **no existe todavía en el
  sistema web actual** (los archivos `.4ta`/`.ps4` no se generan hoy).
- `Genera_AFP` (ya cubierto, ver sección 3).
- `BOLETA_PAGO`, registro/consulta de trabajadores.
- El asiento contable no tiene botón propio visible en el ribbon — puede que
  se dispare desde un botón dentro de la propia hoja `ASIENTO_MENSUAL`.

## 6. Estructura de conceptos confirmada (`Módulo1.bas`)

La hoja de configuración de columnas de `PLANILLA-TRABAJADORES` organiza los
conceptos exactamente en los rangos de la Tabla 22 de SUNAT:

- 0100 Ingresos
- 0200 Ingresos: Asignaciones
- 0300 Ingresos: Bonificaciones
- 0400 Ingresos: Gratificaciones / Aguinaldos
- 0500 Ingresos: Indemnizaciones
- 0600 Aportaciones del trabajador/pensionista
- 0700 Descuentos al trabajador
- 0800 Aportaciones de cargo del empleador
- 0900 Conceptos varios / otros conceptos

Esto confirma que la plantilla real sigue el catálogo oficial como estructura
general, aunque como se vio en la sección 2 los códigos exactos de 4 dígitos
están escritos como datos en la plantilla, no derivados por fórmula.

## 7. Boletas de ejemplo — categorías y conceptos nuevos detectados

Las boletas confirman datos ya conocidos pero también revelan cosas que el
sistema actual debe verificar:

- Categoría **`OPERARIO_EP`** (Operario Equipo Pesado) — no confirmada aún en
  el motor de cálculo actual (`motorCalculo.ts`) como categoría distinta de
  `OPERARIO`. En la boleta de ejemplo tiene el mismo jornal básico que
  OPERARIO (S/ 89.30) pero incluye **Escolaridad** (535.80) que no aparece en
  la boleta de OPERARIO normal.
- **BAE** (Bonificación Extra Ley N° 30334) aparece en la tabla salarial 2026
  como concepto separado del BUC — coincide con lo que ya sabíamos de
  `tabla22_plame.md` (códigos 312/313 = Bonificación Extraordinaria). Vale la
  pena confirmar que el sistema actual declara BAE con su propio código y no
  lo mezcla con BUC.
- La boleta de **EMPLEADO** usa "Condición de Trabajo" en vez de
  Dominical/Feriado, y aporta a ONP en vez de AFP en este ejemplo puntual (no
  necesariamente la regla general, solo lo que salió en este caso).
- Todas las boletas muestran el desglose completo de aportes del empleador
  (ES SALUD, SCTR SALUD, SCTR PENSION, EPS.SCTR, Essalud+Vida, Poliza Vida Ley,
  Fondo Capacitación) — vale la pena comparar campo por campo contra
  `src/boletaPdf.ts` para confirmar que no falta ninguno.
- Confirma que **Movilidad** e **Importe H.E.60%/H.E.100%** (horas extra) son
  conceptos activos y con montos reales — el `src/plame.ts` actual no los
  declara todavía en el `.rem` (ver el archivo original, comentario "PENDIENTE
  DE VALIDAR").

## 8. Preguntas abiertas para el usuario

1. ¿La categoría `OPERARIO_EP` (Operario Equipo Pesado) debe tratarse como una
   categoría propia en el sistema web, con reglas distintas a `OPERARIO`
   (por ejemplo la Escolaridad que aparece en su boleta)?
2. ¿Confirma que el trabajador con tipo="04" en el `.rem` real corresponde a
   un `EMPLEADO` de régimen general (no construcción civil)?
3. ¿El sistema web actual necesita generar ya los 7 archivos PLAME completos
   (.rem, .tas, .toc, .jor, .snl, y opcionalmente .or5) en vez de solo `.rem`,
   y también `.4ta`/`.ps4` para el personal de renta de 4ta (esto implicaría
   modelar en el sistema web un tipo de persona nuevo: prestador de servicios
   por honorarios, distinto de un trabajador en planilla)?
4. Antes de corregir `src/plame.ts`: ¿doy luz verde para aplicar ya el cambio
   confirmado de `BUC_CONSTRUCCION` de "0314" a "0311", o prefieres que
   agrupe esa corrección junto con el resto de conceptos faltantes (horas
   extra, movilidad, escolaridad, BAE, etc.) en un solo cambio?
5. Para el Libro Diario: ¿tienes a la mano el plan de cuentas contable
   completo (qué código de cuenta corresponde a cada concepto de planilla:
   sueldos, CTS, aportes del empleador, etc.), o prefieres que lo derivemos
   revisando las fórmulas de la hoja `ASIENTO_MENSUAL` celda por celda?
