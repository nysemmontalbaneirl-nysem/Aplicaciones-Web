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

### 4.1. Catálogo de códigos PLAME para descuentos/aportes (`obtenerAportes` / tabla `conceptos_aportes`)

Descubierto en el patch 19/46: `resolverCodigosPlame()` (plame.ts)
originalmente resolvía códigos PLAME editables tanto para conceptos de
INGRESO (`obtenerConceptos()`, migración 019, SÍ existe) como para
DESCUENTOS/APORTES (`obtenerAportes()`: cuota sindical, CONAFOVICER,
renta 5ta, ONP) vía una función que no existe en este árbol — no hay
catálogo ni pantalla de Configuración para hacer editable el código PLAME
de esos 4 conceptos. Se mantienen con su código fijo de `CONCEPTO.*`,
igual que antes de este parche (sin regresión, pero sin la mejora que
traía).

**Confirmado y ampliado en el patch 22/46** (`4d9ec871`, "Desagrega el
código PLAME del aporte AFP en Configuración", migración 036) —
**SALTADO por completo, sin commit**. Este parche modifica una tabla
`conceptos_aportes` YA EXISTENTE en producción (con filas previas: SENATI,
SEGURO_VIDA, ONP, RENTA_5TA, CONAFOVICER, CUOTA_SINDICAL, y 4 filas
`AFP_INTEGRA`/`AFP_PRIMA`/`AFP_PROFUTURO`/`AFP_HABITAT` usadas para la
cuenta contable del Asiento por administradora), agregándole 3 filas
nuevas (`AFP_APORTE_OBLIGATORIO`/`AFP_COMISION`/`AFP_PRIMA_SEGURO`) y
conectando `plame.ts` para leer esos 3 códigos desde ahí en vez de tenerlos
fijos. Confirmado por grep (`conceptos_aportes`, `conceptos/aportes`) que
ni la tabla, ni sus rutas `GET/PUT /api/conceptos/aportes`, ni la pantalla
"Aportes y retenciones" de Configuración existen en absoluto en este árbol
— es una funcionalidad completa (tabla + rutas + pantalla), no una columna
aislada como `codigo_plame` de la migración 019, así que no se intentó un
backfill mínimo. Además esta tabla alimenta directamente al Asiento
Contable (punto 5 de abajo), así que reconstruirla a medias sin esa base
tampoco sería fiel a producción. Reconstruir `conceptos_aportes` completo
(tabla + rutas + pantalla) es el prerequisito tanto para este parche como,
probablemente, para gran parte del Asiento Contable.

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

## 9. `agregarConceptosPersonalizadosBatch` (versión de un solo argumento) — RECONSTRUIDA a mano en el patch #23/46

**Estado: reconstruida (con comentario `NOTA (recon 23/46)` en el propio
código), no saltada — a diferencia de las brechas 1 y 4.1 de arriba.**

El patch `#23` (`b2d02632`, "Muestra todos los ingresos, aportes y
descuentos en Planilla Mensual", migración 037) modifica una función
`agregarConceptosPersonalizadosBatch` en `src/routes/planilla.ts` que se
asume YA EXISTENTE (le agrega un segundo parámetro opcional
`tablaDetalleConceptos`). Pero esa función no aparece definida en ningún
punto de los 46 parches recuperados — ni siquiera en el patch #15 (Ronda D,
migración 033, que introdujo la tabla `detalle_planilla_conceptos` que esta
función lee). Debió agregarse en alguno de los parches que nunca se
recuperaron (ver punto 8 de arriba).

Como sí se cuenta con el "antes" completo de la firma y el cuerpo de la
consulta SQL (via el diff del propio patch #23, que los muestra como
contexto/líneas removidas), y el test nuevo que trae ese mismo patch
(`tests/planilla_mensual_conceptos_personalizados.test.ts`) deja clarísima
la forma exacta del resultado esperado (`conceptos_personalizados:
{codigo, nombre, tipo, monto}[]` adjunto a cada fila, agrupado por
`detalle_id`/`id`), se optó por reconstruir la función completa a mano en
vez de saltar el parche — es un caso distinto a la brecha 1 (formulario
flotante) o 4.1 (`conceptos_aportes`), donde faltaba una funcionalidad
entera sin ninguna pista concreta de su forma final.

Los 281 tests (incluida la prueba nueva de este parche) pasan con esta
reconstrucción. Si alguna vez aparece el parche original que definió esta
función por primera vez, comparar su cuerpo con el reconstruido aquí (en
`src/routes/planilla.ts`, buscar el comentario `NOTA (recon 23/46)`) por si
hay alguna diferencia de detalle (por ejemplo, algún manejo de error o
caso borde que no se haya podido inferir del contexto disponible).

## 10. Migración 038 (parche #24/46) — "Días informativos" de la boleta PDF, nunca reconstruidos

El patch `#24` (`7971eef6`, "Migracion 038: separar Descanso Medico de
Incapacidad por Enfermedad") es la migración más grande reconstruida hasta
ahora (26 archivos): renombra el concepto `SUBSIDIO_ENFERMEDAD` a
`DESCANSO_MEDICO` (≤20 días/año por contrato, a cargo del EMPLEADOR, PLAME
0121, afecto a TODO igual que un día normal de trabajo) y agrega el
concepto nuevo `INCAPACIDAD_ENFERMEDAD` (21+ días, PLAME 0916, mismas
afectaciones que tenía el viejo `SUBSIDIO_ENFERMEDAD` — solo SCTR/AFP). La
división 20/21+ ahora es automática por año calendario y por contrato
(`agregarTareoDiario`, `routes/planilla.ts`) — el bloqueo HTTP 400 que
antes existía al superar 20 días se eliminó a propósito. Reconstruida casi
en su totalidad (SQL, `motorCalculo.ts`, `plame.ts`, `tipos.ts`,
`formulas.ts`, `validaciones.ts`, `routes/planilla.ts`,
`planillaMensual.ts`, `boletaPdf.ts`, frontend `Boleta.tsx`/`Calculo.tsx`/
`Tareo.tsx`/`PlanillaMensual.tsx`/`types.ts`), con 282 tests pasando.

Dos piezas del parche original NO se pudieron aplicar, por depender de
infraestructura que ya faltaba de brechas ANTERIORES (no una brecha nueva
introducida por este parche):

- **`TareoDiario.tsx`: `requiereCertificado()` y `TIPOS_CON_CERTIFICADO`**
  (subida de certificado médico por día especial) — no existen en este
  árbol porque dependen del "formulario flotante" de `TareoDiario.tsx`
  (brecha 1 de arriba, patches #16-18 saltados). El único cambio de este
  parche ahí era un rename (`SUBSIDIO_ENFERMEDAD` → `DESCANSO_MEDICO`
  dentro de esas funciones) — no aplica hasta que se reconstruya la brecha
  1. Mismo motivo para el describe completo "Certificado (imagen) de un
  día de Tareo Diario" en `tests/tareo_diario.test.ts` (no existe en nuestro
  árbol).
- **`src/boletaPdf.ts` — sección "días informativos" de la boleta PDF**
  (conteo de días de descanso médico/maternidad/licencia por paternidad,
  mostrados aparte de los montos pagados): el parche original asumía que
  `DetalleBoletaPdf` ya tenía `dias_subsidio_enfermedad`/
  `dias_subsidio_maternidad`/`dias_licencia_paternidad` como campos de
  conteo (además de los montos pagados `subsidio_enfermedad`/etc., que sí
  existen) y una sección `diasInformativos` en el PDF que los renderiza -
  ninguno de los dos existe en `boletaPdf.ts` en este árbol (nunca llegó
  como parche independiente, a diferencia del frontend `Boleta.tsx`, que sí
  tiene su propia sección `diasInformativos` — confirmado que son
  implementaciones independientes, backend/PDF vs. frontend/pantalla). Por
  eso `tests/boleta_dias_informativos.test.ts` tampoco existe (el intento
  de aplicar ese archivo del parche falló con "file to patch" al no
  encontrarlo). Se aplicó solo la parte que sí corresponde a este árbol:
  agregar `incapacidad_enfermedad` a `DetalleBoletaPdf` y a la lista de
  "conceptos pagados" (montos), sin la sección de conteo de días. **Cómo
  cerrarla:** si aparece el parche que agregó esa sección a `boletaPdf.ts`
  (probablemente parte de la migración 027, "Ronda B"), aplicarlo primero;
  si no, se puede construir a mano imitando la sección equivalente ya
  existente en `frontend/src/components/Boleta.tsx` (`diasInformativos`,
  `filasSinCero`), pero eso es una decisión de diseño nueva a confirmar con
  el usuario, no una reconstrucción fiel.

Otros 3 archivos de test del parche original tampoco se pudieron aplicar
por el mismo motivo general (asumen archivos/infraestructura que no existe
en este árbol, ninguno de los 3 es una brecha NUEVA de este parche):
`tests/asiento_contable.test.ts` y `tests/gratificacion_construccion_civil.test.ts`
no existen (brechas 5 y 2 de arriba), y `tests/dominical_proporcional.test.ts`
tampoco (brecha 4 de arriba).
