# Brechas conocidas de la reconstrucción (branch `reconstruccion-sept2026`)

Este documento existe SOLO por el proceso de reconstrucción que se hizo
en esta rama a partir de 46 archivos `.patch` recuperados después de que
un reinicio del entorno en la nube borrara el historial de git local (el
remoto de GitHub tampoco tenía varias rondas de trabajo). No describe
brechas de diseño del sistema (para eso está `PLAN_PENDIENTE.md`) ni el
historial de lo que ya está en producción (`HISTORIAL_IMPLEMENTACIONES.md`),
sino los puntos donde el código de ESTA rama reconstruida queda, a
propósito, por detrás de lo que probablemente corre en producción real,
porque el parche que lo agregó no estaba entre los 46 recuperados (o
dependía de otro parche que tampoco apareció).

Cada brecha está también marcada en el código fuente con un comentario
`NOTA (recon N/46): ...` en el punto exacto donde se sintió la falta,
cuando aplicaba. Esta lista es solo el resumen centralizado para no tener
que recorrer todo el código buscando esos comentarios.

Progreso: ver `/root/work/patches/last_applied.txt` (fuera del repo) y el
manifiesto `/root/work/patches/manifest_final.tsv` para el detalle
parche-por-parche.

---

## 1. Formulario flotante del Tareo (Diario y Totales) — parches #16, #17, #18 SALTADOS

**Estado: saltados sin aplicar (no hay commit para ellos).**

- `#16` (`f7ba3077`, "Agrega buscador de trabajador dentro del formulario
  flotante"): sus 9 hunks (8 en `TareoDiario.tsx`, 1 en `styles.css`)
  fallan al 100% porque asumen un "formulario flotante" (modal día-por-día,
  con estado `fechaModalAbierto`, navegación "día anterior/siguiente",
  grilla de horas por hora/minuto) que en algún momento se agregó a
  `TareoDiario.tsx` en producción, pero NUNCA llegó como uno de los 46
  parches recuperados — ni como parche independiente ni como parte de
  otro. Nuestro `TareoDiario.tsx` (310 líneas a la fecha) no tiene ningún
  rastro de esa infraestructura (confirmado por grep de
  `modal|flotante|fechaModalAbierto`, sin resultados).
- `#17` (`df92ff31`, "Mejora el formulario flotante del Tareo Diario:
  flechas") depende del mismo modal faltante en `TareoDiario.tsx` — mismo
  bloqueo que `#16`.
- `#18` (`39b89b1c`, "Agrega el formulario flotante a Tareo (totales del
  periodo)") es distinto: su diff completo SÍ está disponible y es
  autocontenido en `Tareo.tsx` (no depende de código de `TareoDiario.tsx`,
  define su propio estado `contratoIdModalAbierto` desde cero). Pero
  usa clases CSS genéricas (`modal-overlay`, `modal-flotante`,
  `modal-flotante-cabecera`, `modal-flotante-flecha`,
  `modal-flotante-cerrar`, `modal-flotante-grid-horas`,
  `modal-flotante-campo`, `modal-flotante-navegacion`) que este mismo
  parche NO define — confirmado que ninguna existe hoy en `styles.css`.
  Esas clases debieron haberse agregado por el parche original que creó
  el modal de `TareoDiario.tsx` (el mismo que falta en el punto anterior),
  así que `#18` queda bloqueado por la misma causa raíz, aunque su propio
  código JSX esté completo y no inventado.

**Por qué se decidió saltar los 3 en vez de reconstruir el modal base:**
Reconstruir desde cero el modal completo de `TareoDiario.tsx` (con toda
su lógica de navegación día-por-día) implicaría inventar una interfaz que
no está documentada en ningún parche que tengamos — a diferencia de los
huecos de lógica de cálculo (migración 025, por ejemplo), donde alcanzaba
con omitir un término de fórmula con una nota clara, acá se trata de una
pantalla completa. Es una funcionalidad de interfaz (no afecta cálculos
de planilla, montos, ni el archivo PLAME), así que el riesgo de dejarla
pendiente es bajo comparado con el riesgo de construir una versión
"inventada" que no coincida con la que el usuario ya conoce en
producción real y que después alguien intente parchar de nuevo sobre
una base distinta.

**Cómo cerrar esta brecha en el futuro:** si aparece el parche faltante
(probablemente fechado antes del 16-sep-2026, ya que `#16`/`#17` son de
esa fecha y asumen el modal como preexistente), aplicarlo primero, y
recién ahí `#16`, `#17` y `#18` deberían aplicar limpio o con ajustes
menores. Si nunca aparece, `#18` es candidato razonable para
reconstruir a mano MÁS ADELANTE (su JSX ya lo tenemos completo arriba,
en el archivo de parche original), escribiendo desde cero solo el CSS
base del modal (`.modal-overlay`, `.modal-flotante`, etc.) con un diseño
propio — pero eso ya sería una decisión de diseño nueva, no una
reconstrucción fiel, y debe confirmarse con el usuario antes de hacerse.

---

## 2. Migración 025 — Gratificación (topes por tramo ago-dic / ene-jul)

`calcularGratificacion` en `motorCalculo.ts` no incluye
`dias_dominical_no_laborado` / `dias_subsidio_maternidad` /
`dias_licencia_paternidad` en su base de cómputo, ni el split
`factorDenominadorAgostoDiciembre` / `factorDenominadorEneroJulio` que la
fórmula real de producción sí tiene. `gratificacion_construccion_civil.test.ts`
tampoco existe. Ver comentario NOTA en `motorCalculo.ts` (patch 12/46).

## 3. Migración 019 — `codigo_plame` en `conceptos_planilla`

Reconstruida de forma MÍNIMA en el patch 15/46: solo lo que necesitaba
"Ronda D" (conceptos con fórmula propia). La ruta `PUT /:codigo` para los
14+ conceptos originales NO fue extendida para exponer/editar este campo
ahí — solo se agregó la columna y su lectura en `filaAConcepto`.

## 4. Dominical proporcional / feriado no laborado / sobretasa /
   condición de trabajo (migraciones 022/023/026)

`dias_dominical_no_laborado`, `dias_feriado_trabajado`,
`remuneracion_dominical_proporcional`, `sobretasa_dominical`,
`sobretasa_feriado`, `condicion_trabajo`, `calcularDiasDominicalProporcional`,
`DiaAsistenciaCruda`, `rangoVigenciaEnPeriodo` no existen en este árbol.
Por eso `VARIABLES_FORMULA` (formulas.ts) excluye explícitamente
`dias_dominical_no_laborado` y `dias_feriado_trabajado` aunque la lista
original (producción) sí los tenía.

**Resurgió en el patch 19/46** ("Ronda E"): `afpnet.ts`/`plame.ts` ahora
tienen estos campos como OPCIONALES en `FilaAFPnet`/`FilaExportacion`
(con `num()` tratando `undefined` como 0) para poder compartir la lógica
de formato entre la exportación por periodo de pago (que no los tiene) y
la mensual consolidada (que sí, ver abajo). La tabla nueva
`detalle_planilla_mensual` (migración 034) SÍ nace con columnas propias
`dias_dominical_no_laborado`/`remuneracion_dominical_proporcional`/
`sobretasa_dominical`/`sobretasa_feriado` — pero como el motor de cálculo
(`motorCalculo.ts`/`ResultadoCalculoLinea`) tampoco las produce todavía,
`planillaMensual.ts` las deja en su `DEFAULT 0` de tabla (no las lee de
`d`, que no las tiene) y `CAMPOS_ASISTENCIA_SUMABLES` tampoco suma
`dias_feriado_trabajado`/`dias_dominical_no_laborado`. Es decir: la
"tubería" (columnas, tipos) para esta brecha ya está más completa que
antes, pero el cálculo real sigue pendiente de las migraciones 022/023/026.

### 4.1. Catálogo de códigos PLAME para descuentos/aportes (`obtenerAportes`)

Descubierto en el patch 19/46: `resolverCodigosPlame()` (plame.ts)
originalmente resolvía códigos PLAME editables tanto para conceptos de
INGRESO (`obtenerConceptos()`, migración 019, SÍ existe) como para
DESCUENTOS/APORTES (`obtenerAportes()`: cuota sindical, CONAFOVICER,
renta 5ta, ONP) vía una función que no existe en este árbol — no hay
catálogo ni pantalla de Configuración para hacer editable el código PLAME
de esos 4 conceptos. Se mantienen con su código fijo de `CONCEPTO.*`,
igual que antes de este parche (sin regresión, pero sin la mejora que
traía). Reconstruir si aparece el parche que agrega ese catálogo.

## 5. `src/asientoContable.ts` (Asiento Contable / exportación contable)

Módulo completo ausente. Confirmado por segunda vez en el patch 15/46:
un test que lo importaba y usaba tablas `plan_cuentas` /
`mapeo_cuentas_contables` (tampoco existentes en `schema.sql`) fue
removido de `tests/conceptos_formula_libre.test.ts`.

**Confirmado por TERCERA vez en el patch 19/46** ("Ronda E", Planilla
Mensual Consolidada): el parche traía `generarAsientoContableMensual`
(refactor de `asientoContable.ts` para leer de `detalle_planilla_mensual`),
la ruta `GET /api/planilla-mensual/:id/exportar/asiento-contable` y el
botón "Descargar Asiento Contable (Excel)" en la pantalla `PlanillaMensual.tsx`
— los 3 fueron omitidos (ruta y botón eliminados por completo, no solo
comentados) porque dependen enteramente de ese módulo. Cuando
`asientoContable.ts` se reconstruya, agregar de nuevo esa ruta y ese botón
siguiendo el mismo patrón que las descargas de REM/AFPnet ya presentes en
`routes/planillaMensual.ts` / `PlanillaMensual.tsx`.

## 6. Ronda B, Parte 2 (logo de la empresa fijo + encabezado de boleta centrado)

Sin cambios desde segmentos anteriores — brecha ya establecida.

## 7. `POST /:id/reabrir` ("Ronda 1", reabrir un periodo CALCULADO)

Solo existe como comentario en `routes/periodos.ts`; la ruta nunca se
implementó en los parches recuperados. Confirmado que `POST /:id/calcular`
no tiene ninguna validación de estado `ABIERTO` en este árbol, así que
recalcular un periodo ya CALCULADO funciona directo, sin necesitar
"reabrirlo" primero — así se adaptaron los tests que antes llamaban a
`/reabrir` (patch 15/46).

## 8. Archivos de parche faltantes y vacío pre-14-sep

6 archivos `.patch` del listado original nunca se pudieron recuperar, más
un vacío de documentación anterior al 14-sep-2026 — sin cambios desde
segmentos anteriores, no se volvió a intentar localizarlos en este
segmento.
