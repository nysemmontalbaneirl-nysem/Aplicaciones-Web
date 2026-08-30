# Análisis del sistema Excel/VBA legado (JHCR) — hallazgos

Fecha del análisis: 30/08/2026.
Fuente: archivos subidos por el usuario el 29-30/08/2026 (ver carpetas hermanas
`vba-legado/`, `archivos-planos-plame/`, `boletas-ejemplo/`, `lectura-normativa/`
dentro de `docs/referencia-excel-legado/`).

## 0. Archivo que NO llegó a subirse

El usuario mencionó `Estructuras Plame - Trabajadores - V.1.4.26 modificado.xlsm`
en el mensaje, pero **no aparece entre los archivos recibidos** (ni file_uuid ni
en el listado de subida — mismo problema de "no se pudieron subir los archivos"
de un mensaje anterior). Este es el workbook más importante que falta: es la
hoja maestra con las pestañas `PLANILLA-TRABAJADORES`, `ASIENTO_MENSUAL`,
`GENERA_AFP`, `MAESTRO`, `PS 4TA CATEGORÍA` que el código VBA referencia
constantemente. Sin ella no se pueden ver los códigos SUNAT reales que estaban
escritos en la fila 5 de `PLANILLA-TRABAJADORES` (ver sección 2). Hay que
pedirle al usuario que la vuelva a subir.

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

**El hallazgo más importante:** en `informacion_REM`, el código de concepto
SUNAT (4 dígitos) **no está fijo en el VBA** — se lee dinámicamente de la fila
5 de cada columna de `PLANILLA-TRABAJADORES` (`ws.Cells(5, columna)`), y si esa
columna está marcada como "D" en la fila 2 va a "devengado" o si está marcada
"P" va a "percibido" (cualquier otra marca la manda a ambos). Es decir: los
códigos 0121, 0201, 0311/0314, etc. son **datos de configuración de la
plantilla Excel**, no reglas de negocio en el VBA. Eso confirma por qué el
archivo real usa "0314" para BUC en vez del "0311" del catálogo oficial: lo que
sea que esté escrito en esa fila 5 de la plantilla real es lo que sale, sin
validación contra el catálogo SUNAT. Sin el archivo `Estructuras Plame -
Trabajadores.xlsm` no puedo confirmar qué código quedó configurado ahí, pero
si son consistentes en 2 archivos reales aceptados por SUNAT, lo más seguro es
que la plantilla real use "0314" a propósito (aunque no figure en el catálogo
oficial del Excel `TABLA22.xls` que ya tenemos).

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
hoja `ASIENTO_MENSUAL`** de la plantilla maestra — la misma que no llegó a
subirse. Sin esa hoja no se puede diseñar la función "Libro Diario" del
sistema web todavía: hace falta ver la estructura real de esas 16 columnas
(probablemente: cuenta contable, glosa, debe, haber, centro de costo/proyecto,
etc.) para replicar la lógica.

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

1. ¿Puede volver a subir `Estructuras Plame - Trabajadores - V.1.4.26
   modificado.xlsm`? Es la pieza que falta para confirmar los códigos SUNAT
   reales (fila 5 de `PLANILLA-TRABAJADORES`) y para diseñar el Libro Diario
   (hoja `ASIENTO_MENSUAL`).
2. ¿La categoría `OPERARIO_EP` (Operario Equipo Pesado) debe tratarse como una
   categoría propia en el sistema web, con reglas distintas a `OPERARIO`
   (por ejemplo la Escolaridad que aparece en su boleta)?
3. ¿Confirma que el trabajador con tipo="04" en el `.rem` real corresponde a
   un `EMPLEADO` de régimen general (no construcción civil)?
4. ¿El sistema web actual necesita generar ya los 7 archivos PLAME completos
   (.rem, .tas, .toc, .jor, .snl, y opcionalmente .or5) en vez de solo `.rem`,
   y también `.4ta`/`.ps4` para el personal de renta de 4ta?
