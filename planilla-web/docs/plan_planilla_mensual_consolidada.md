# Plan: Planilla Mensual Consolidada (para PLAME, AFPnet y Asiento Contable)

**Fecha:** 16 de setiembre de 2026
**Estado:** Diseño de negocio confirmado contigo. Pendiente: detalle técnico final + implementación + pruebas + despliegue.

---

## 1. El problema que planteaste

La PLAME (T-Registro/PDT), las declaraciones a las AFP (AFPnet) y el Asiento
Contable se presentan **por mes calendario** (por ejemplo, Agosto = del 01 al
31). Pero el sistema paga a los obreros **por quincena o semana**, y una
quincena puede cruzar de un mes a otro (ejemplo real ya visto en el sistema:
una "1ra quincena" fue del 31/08 al 13/09 — solo 1 día de agosto y 13 días de
setiembre).

Hoy, cada exportación (REM, AFPnet, Asiento) se genera a partir de **un solo
período de pago**, usando como "mes declarado" una etiqueta que se calcula
automáticamente del mes en que EMPIEZA ese período — sin importar cuántos
días realmente caen en cada mes. Además, un mes normal no es un solo
período: normalmente son 2 quincenas de obreros más el período mensual de
empleados, y hoy no existe ninguna forma de juntarlos en un solo archivo.

## 2. Cómo lo resuelves hoy, a mano (confirmado con tu Excel real)

Nos mandaste `Registro TAREO Col.Baldomero Tumbes.xlsx`, y lo analizamos a
fondo. Así funciona tu proceso actual:

- **`TABLAST`**: catálogo de las quincenas del año con un código corto
  (`Q25BT.1`, `Q25BT.2`, ...) y la tabla de categorías/feriados.
- **`Q25BT.1` / `Q25BT.2`**: el tareo quincenal tal cual, con columnas de
  horas normales (HN) y horas al 60% (H60) por cada día de esa quincena.
- **`Res.ago.25`** ("Resumen de Agosto 2025"): la pieza clave. Tiene una
  fila **"SELECCIONAR QUINCENAS"** que, día por día del 01 al 31 de agosto,
  indica de qué quincena se debe tomar el dato de ESE día puntual — sin
  duplicar ni perder ningún día. Al final trae los totales del mes ya
  consolidados: horas normales, horas extra al 60%, total de horas, días en
  horas normales, días feriados trabajados.
- Con esos totales ya consolidados por mes completo, haces los cálculos de
  montos en soles en **otro Excel aparte** (jornal, EsSalud, gratificación,
  etc.), y de ahí sale la PLAME, el AFPnet y el Asiento Contable — **los 3
  archivos salen de esa misma Planilla Mensual ya consolidada**, sin
  excepción para el asiento contable.

Tú mismo lo describiste así: *"todo este proceso... ha salido de una
creación de mi mente, una forma de ingeniarme para poder juntar las
planillas, PERO EN EXCEL, no en sistema."*

## 3. Lo que se propone construir

Un mecanismo nuevo dentro del sistema — la **"Planilla Mensual
Consolidada"** — que reproduce exactamente ese proceso, sin Excel:

1. Para un proyecto y un mes elegidos, el sistema busca todos los períodos
   (quincenales o semanales) de ese proyecto cuyas fechas toquen ese mes.
2. Junta el Tareo Diario de esos períodos, pero se queda **solo con los
   días 01 al 30/31** de ese mes exacto — igual que tu fila "SELECCIONAR
   QUINCENAS", día por día, sin duplicar ni perder ninguno.
3. Con esos días ya consolidados, calcula los montos **una sola vez** para
   todo el mes (jornal, EsSalud, gratificación, aportes, etc.) — igual que
   tu segundo Excel de cálculo mensual.
4. Guarda ese resultado como una "foto" fija (igual que ya hace el resto del
   sistema con las boletas: no cambia sola si algo se corrige después).
5. De ahí salen los botones para descargar la PLAME (.rem), el AFPnet
   (.csv) y el Asiento Contable de ese mes — ya no por período, sino por
   mes calendario completo.
6. Vas a poder ver y descargar esta Planilla Mensual como su propio reporte
   (no solo como paso invisible camino a los 3 archivos finales).

Las boletas que ya se les paga a los trabajadores (quincenales/semanales)
**no cambian en nada** — esto es un cálculo adicional, solo para las
declaraciones, que convive con lo que ya existe.

## 4. Las 4 decisiones que confirmaste

| # | Pregunta | Tu respuesta |
|---|----------|--------------|
| 1 | ¿El período MENSUAL de los Empleados siempre cubre el mes completo? | Sí, siempre — no hace falta tocar nada para Empleados, solo para Obreros. |
| 2 | ¿Un trabajador que cambia de proyecto a mitad de mes se reparte entre los 2 proyectos? | Sí, se reparte — cada proyecto recibe solo los días/montos que le corresponden. |
| 3 | ¿Qué pasa si se recalcula una quincena después de declarar el mes? | No se actualiza sola; el sistema avisa para que decidas si vuelves a consolidar el mes a mano. |
| 4 | ¿Necesitas ver/descargar la Planilla Mensual en sí, además de los 3 archivos finales? | Sí, es un documento de trabajo que usas tú mismo. |

## 5. Alcance técnico de la implementación (para cuando confirmes seguir)

- **Base de datos**: 2 tablas nuevas — `planilla_mensual` (cabecera: proyecto,
  año, mes) y `detalle_planilla_mensual` (un espejo de la tabla de boletas
  actual, pero con los montos ya consolidados del mes completo).
- **Motor de cálculo**: una función que junta el Tareo Diario de las
  quincenas que tocan el mes, respeta el proyecto vigente de cada día, y
  corre el cálculo de planilla una sola vez sobre el mes completo.
- **Aviso de recálculo tardío**: si una quincena se corrige después de
  haber declarado el mes, el sistema te avisa (no bloquea, no recalcula
  solo).
- **Exportaciones**: la PLAME, el AFPnet y el Asiento Contable pasan a poder
  generarse por `{proyecto, año, mes}` en vez de por período — sin tocar
  cómo funcionan hoy para Empleados.
- **Pantalla nueva**: "Planilla Mensual" (elegir proyecto + año + mes, botón
  "Consolidar", tabla-resumen tipo tu `Res.ago.25`, botones de descarga).
- **Pruebas**: se usará tu propio Excel de agosto 2025 (las hojas
  `Q25BT.1`/`Q25BT.2`/`Res.ago.25`) como caso de prueba real, comparando
  cifra por cifra el resultado del sistema contra tu Excel antes de dar
  por buena la funcionalidad.

Por su tamaño, esta es una ronda grande — comparable a la de "Conceptos con
fórmula propia" — porque toca los 3 generadores de archivos que ya están
validados contra la SUNAT real. Se entregará y probará con el mismo cuidado
de siempre: migración, pruebas automáticas, compilación limpia, y guía paso
a paso para el despliegue en producción, avisándote antes de cada paso.

---

*Cuando estés listo para que empecemos a construir esto, solo dime "sigue" o
"empecemos" y arranco con el detalle técnico final y la implementación.*
