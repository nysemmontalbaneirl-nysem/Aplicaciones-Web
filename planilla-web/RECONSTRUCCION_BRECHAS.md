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

**Confirmado de nuevo en el patch 25/46** ("Completa 5 columnas del Resumen
de Planilla que quedaban en blanco"): una de las 5 columnas que ese parche
da por completada es justamente "Condición de Trabajo" (`Ronda A`), leída
en `reportes.ts` como `Number(d.condicion_trabajo ?? 0)` — ya de forma
defensiva en el propio parche original, así que no hizo falta tocar el
código de `reportes.ts`. Como `condicion_trabajo` no existe ni en
`contratos` ni en `detalle_planilla` en este árbol, esa columna
simplemente da `0` en vez de fallar. La única pieza que sí tuvo que
adaptarse fue la prueba nueva del parche
(`tests/reportes_resumen_planilla.test.ts`): su "precondición" insertaba un
`condicion_trabajo = 150` directo en `contratos` (columna inexistente ahí,
lo que hacía fallar el INSERT y arrastraba los 8 casos de esa prueba a
"undefined") — se quitó esa columna del INSERT y se cambió la aserción de
"Condición de Trabajo" para esperar `0` (comportamiento real hoy), no
`150`. Cuando se reconstruya la migración 026, falta además decidir en qué
tabla vive `condicion_trabajo` en producción real: por el INSERT de esta
prueba, parece ser un monto FIJO por contrato (columna en `contratos`, no
un valor calculado por periodo en `detalle_planilla`) — dato a confirmar
si aparece un parche futuro para esa migración.

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

## 11. Migración 039 (parche #26/46) — interruptor "Activo" por concepto (reconstruido) + confirmación adicional de la brecha #4

El grueso de este parche (interruptor `activo`/`estaActivo()` para
conceptos de código fijo en `motorCalculo.ts`, validación y persistencia en
`PUT /api/conceptos/:codigo`, columna "Activo" en la pestaña Configuración,
y la exclusión de `DESCANSO_MEDICO` de la base de CONAFOVICER) SÍ se
reconstruyó por completo — la columna `conceptos_planilla.activo` ya
existía desde la migración 033 (Ronda D), así que no dependía de ninguna
infraestructura faltante. `tests/activo_conceptos.test.ts` y
`tests/conafovicer_descanso_medico.test.ts` (ambos nuevos de este parche)
pasan sin modificaciones.

Una sola pieza del parche SÍ dependía de la brecha #4 (dominical
proporcional, migraciones 022/023/026) y se omitió: el requerimiento
funcional 1 de esta migración agregaba `dias_dominical_no_laborado` a la
fórmula de `calcularAsignacionEscolar` (Escolaridad) — ese campo no existe
todavía en `AsistenciaEntrada` en este árbol. Se dejó la fórmula de
Escolaridad como estaba (solo `dias_trabajados + dias_subsidio_enfermedad_computable
+ dias_feriado`) y se adaptaron en consecuencia el `describe()` de
`tests/dias_computables_construccion_civil.test.ts` (título y las 2 pruebas
que antes ejercitaban `dias_dominical_no_laborado`) y la prueba de
integración de Vacaciones/CTS/Escolaridad más abajo en el mismo archivo
(volvió a su aserción original, sin el término de dominical proporcional).

**Bug de datos preexistente descubierto y corregido de paso:** la ruta
`PUT /api/conceptos/:codigo` (conceptos de código fijo) nunca tuvo su
propio `try/catch` — cualquier `ErrorValidacion` lanzada ahí (incluidas las
validaciones YA existentes de `factor1/2/3` y `afecto_*`, anteriores a esta
migración) caía al manejador de errores centralizado de `app.ts`, que
siempre responde 500 sin distinguir `ErrorValidacion` (a diferencia de
`PUT /formula/:codigo`, que sí envuelve su lógica en `try/catch` desde
antes). Esto quedó expuesto porque las pruebas nuevas de este parche sí
verifican una respuesta 400 concreta (`SUELDO_BASICO` no se puede
desactivar, `activo` no booleano). Se agregó el mismo patrón `try/catch` ya
usado en el resto de `src/routes/conceptos.ts` — no es una regresión de
esta reconstrucción: la ruta nunca tuvo ese manejo en ningún punto de los
46 parches recuperados hasta ahora.

## 12. Migración 040 (parche #27/46) — pestaña de Configuración inexistente, `filaTieneDatos`/modal de Tareo, `.subtabs`

**Descubrimiento nuevo, mayor que lo documentado hasta ahora:** al intentar
aplicar la sección 1 de esta migración ("Configuracion -> Límites de
tareo"), se confirmó que `frontend/src/components/Configuracion.tsx` en
este árbol es una página de una sola tabla ("Conceptos de ingreso"), sin
NINGUNA de las otras 5 secciones que el parche da por existentes: "Aportes
y retenciones", "Plan de cuentas", "Días feriados", "Cuota sindical" (el
backend de cuota sindical sí existe — `GET/PUT /api/conceptos/
cuota-sindical` — pero se administra desde `Proyectos.tsx`, no desde
Configuración) y "Conceptos con fórmula propia" (esta última ya apuntada en
la brecha 3/4.1 de arriba, pero ahora confirmado que ninguna de las otras 4
tampoco existe, ni sus rutas backend correspondientes — `/conceptos/
aportes`, `/conceptos/plan-cuentas`, `/conceptos/dias-feriados`,
`/conceptos/mapeo-contable` no están definidas en `routes/conceptos.ts`).
Es decir: el "sub-menu de pestañas" completo de Configuración (`type
Seccion`, `SECCIONES`, la clase CSS `.subtabs`) nunca se reconstruyó — muy
probablemente forma parte de alguno de los 6 archivos `.patch` nunca
recuperados (brecha #8).

**Cómo se resolvió para este parche:** en vez de inventar las 5 pestañas
faltantes solo para alojar la sexta ("Límites de tareo"), se agregó esa
sección como una segunda tarjeta simple debajo de la tabla de conceptos
(sin pestañas), consumiendo la ruta backend `GET/PUT /api/conceptos/
limites-tareo` (esta sí se reconstruyó completa, incluida en
`src/routes/conceptos.ts`). La regla `.subtabs`/`.subtabs button` de
`styles.css` (fondo azul unificado) se omitió por completo — no hay ningún
elemento en el árbol que use esa clase todavía. `.titulo-reporte` (mismo
parche, para `Reportes.tsx`) sí se aplicó, porque `Reportes.tsx` sí existe
y ya lo usa.

**Cómo cerrarla en el futuro:** si aparece alguno de los parches faltantes
que construya el sub-menu de pestañas de Configuración (backend de
aportes/plan de cuentas/feriados + la UI de pestañas), esta tarjeta de
"Límites de tareo" debería moverse a su propia pestaña dentro de ese
sub-menu, siguiendo el mismo patrón que las demás.

**Menor, misma migración:** dos piezas de `TareoDiario.tsx` tampoco se
pudieron aplicar por depender del "formulario flotante" (brecha #1, ya
documentada — parches #16/#17/#18 saltados): la función `filaTieneDatos`
(decide si un día ya tiene datos para no sobreescribirlo al abrir el
formulario) y los inputs de horas/minutos dentro de `filaModal` (la
versión del formulario flotante de esos mismos campos) — ninguno de los
dos existe en este árbol. Sí se aplicó el resto de la migración 040 para
este archivo: `filaVacia` con los 12 campos en `null` en vez de `0`,
`actualizarHoras` aceptando `null`, y los inputs de horas/minutos de la
grilla normal (`fila[campoHoras]`/`fila[campoMinutos]`) mostrando vacío en
vez de "0".

## 13. Parche #28/46 (`2e06805a`, "Bloqueo preventivo en tiempo real del límite de tareo") — `filaModal` de nuevo

100% frontend (`TareoDiario.tsx`), sin migración SQL. Se reconstruyó
completo: el bloqueo preventivo de horas/minutos por día (mismo criterio
de día hábil/sábado/domingo y límites de `Configuración -> Límites de
tareo` que ya valida el backend desde el parche #27) ahora también rechaza
el cambio de inmediato en el frontend, con `erroresLimite` mostrando el
mensaje junto a la fecha en la grilla. La única pieza omitida fue, de
nuevo, la que depende del formulario flotante inexistente (brecha #1): el
mismo mensaje de error dentro de `filaModal`, y el `setErroresLimite({})`
de la función que guarda y cambia de trabajador dentro de ese formulario
(el parche la llama con una variable `nombreAnterior` que tampoco existe
en este árbol). Los 309 tests existentes siguen pasando (este parche no
trae tests propios - "Cambio 100% frontend" según su propio mensaje de
commit).

## 14. Parche #29/46 (`d8781540`, migración 041 "AFPnet Excel oficial" + migración 042 "Planilla Mensual: períodos incluidos, historial y aviso") — patrón de "éxito parcial de hunks" recurrente, sin brechas nuevas

Archivo combinado tipo mbox con 7 sub-parches de `git format-patch`. A
diferencia de los patches anteriores, aquí NO apareció ninguna
funcionalidad genuinamente faltante (no hay nada nuevo que agregar a las
brechas #1/#4/#5/#8 de arriba) — todo lo que trae este parche se pudo
reconstruir completo. El trabajo fue enteramente de reconciliación manual
por el mismo patrón de "éxito parcial de hunks" ya visto en parches
anteriores, mucho más marcado aquí por tratarse de un archivo combinado
(varios sub-parches tocando los mismos archivos en momentos distintos):

- `src/afpnet.ts`: el sub-parche 2/7 ("Corregir mapeo de tipo de documento
  ... bug de producción") esperaba que `construirCSVAFPnet` llamara a la
  función ya extraída `calcularRemuneracionAfectaAfp(f)` (agregada por el
  sub-parche 1/7), pero el hunk que hacía ese reemplazo falló por contexto;
  se aplicó a mano.
- `src/routes/planillaMensual.ts`: el sub-parche 1/7 crea la ruta
  `GET /:id/exportar/afpnet-excel` completa, y el sub-parche 3/7 ("Nunca
  entregar el Excel de AFPnet vacío en silencio") la modifica para agregar
  el guard de 400 con `advertencias` ANTES de armar el workbook. Ambos
  grupos de hunks fallidos quedaron acumulados en el mismo `.rej` (mismo
  archivo, tocado por 2 sub-parches distintos) — se fusionaron a mano en
  una sola versión final (la ruta ya nace con el guard de `advertencias`,
  nunca existió una versión intermedia sin él en este árbol).
- `frontend/src/components/PlanillaMensual.tsx`: el caso más marcado de
  "éxito parcial" de todo el proceso de reconstrucción hasta ahora — 3
  sub-parches distintos (1/7 botón de descarga del Excel oficial, 5/7
  corrección del mensaje de error invisible, 7/7 UI de períodos
  incluidos/historial) tocan el mismo archivo, y en los 3 casos el patch
  tool aplicó la mitad "de adelante" (los usos/JSX que dependían de nuevo
  estado) sin haber aplicado la mitad "de atrás" (la declaración de ese
  mismo estado), dejando el árbol en un estado que no compila hasta
  reconciliar a mano:
  - El botón "Descargar AFPnet (Excel oficial)" y el tipo `"afpnet-excel"`
    del estado `descargando`/la firma de `descargar()` NUNCA se habían
    aplicado (0 de los hunks del sub-parche 1/7 para este archivo tuvo
    éxito) — se agregaron completos a mano.
  - El estado `errorDescarga` (con su comentario explicando el bug real de
    UI de producción del 19/09/2026: el mensaje de error de una descarga
    quedaba guardado en el mismo estado `error` de la tarjeta de arriba,
    invisible si el usuario ya había bajado hasta los botones de
    descarga) NUNCA se había declarado, pero el bloque JSX que lo
    renderiza (`{errorDescarga && (...)}`) SÍ se había aplicado solo,
    dejando una referencia a una variable inexistente. Se agregó la
    declaración del estado y se cambiaron `setError`/`setError(null)` por
    `setErrorDescarga`/`setErrorDescarga(null)` en `cargar()` y
    `descargar()`, a mano.
  - El estado/efectos de `historial`/`cargandoHistorial`/
    `errorHistorial`/`mostrarHistorial` (migración 042) y la función
    `cargarHistorial()` SÍ se habían aplicado solos, igual que el botón
    "Ver historial de meses consolidados" y la tabla de
    `periodosIncluidos`/`avisosPeriodosNoCalculados` — pero la tarjeta
    `<div className="card"><h2>Historial de meses consolidados</h2>...`
    que efectivamente RENDERIZA la lista de `historial` con sus columnas
    (Período/Proyecto/Trabajadores/Última consolidación/Por/Ver) nunca se
    había insertado, ni el array `MESES_CORTO` que usa, ni los imports de
    los tipos `FilaHistorialConsolidacion`/`PeriodoIncluidoConsolidacion`
    (que sí existían ya en `frontend/src/types.ts`, aplicados sin problema
    por el sub-parche 1/7). Se agregaron los 3 a mano, en el mismo lugar
    donde los traía el parche original (debajo de la tarjeta principal,
    antes del bloque `{cargando && ...}}`), sin el bloque de
    `faltantesAsiento` del parche original (esa parte de "Asiento
    Contable" no existe en este árbol, ver brecha #5 — se omitió esa
    condición, ya que aquí nunca hubo tal estado que envolver).
  - El único ajuste real de contenido (no solo de mecánica de aplicación):
    el botón "Descargar AFPnet (Excel oficial)" se colocó inmediatamente
    después del botón CSV existente, sin el tercer botón "Asiento Contable"
    que traía el parche original entre ellos (tampoco existe, brecha #5).
- `tests/planilla_mensual_rutas.test.ts`: 1 hunk del sub-parche 3/7 (prueba
  del 400 "ningún trabajador con AFP" del Excel oficial) quedó en el mismo
  `.rej` que 2 hunks ya aplicados del sub-parche 7/7 — se insertó a mano,
  sin cambios de contenido (el fixture de este archivo ya tenía exactamente
  el escenario que la prueba necesita: el único trabajador de
  `beforeAll` está en ONP, no AFP).

Verificado: `tsc --noEmit` limpio (backend y frontend), 335/335 tests
pasando (309 previos + `afpnet_excel.test.ts` + `actualizar_nombres_afpnet.test.ts`
+ 1 prueba nueva en `planilla_mensual_rutas.test.ts`).

## 15. Migración 042 "ambito geografico de feriados" (parche #31/46, `ce41e219`) — tabla `dias_feriados` (catálogo de feriados) NUNCA existió; se omite toda la lógica de coincidencia, se conserva solo la ubicación UBIGEO de "proyectos"

**Estado: parcialmente aplicado** — se reconstruyó solo la mitad
independiente del parche (ubicación geográfica UBIGEO opcional en
`proyectos`, tanto en el backend como en la pantalla Proyectos); se
descartó por completo la otra mitad (ámbito NACIONAL/REGIONAL/LOCAL de
cada feriado y la lógica que decide si un feriado aplica o no a un
proyecto según su ubicación).

**Causa raíz**: este parche modifica una tabla `dias_feriados` (un
catálogo central de feriados con fecha + descripción, alimentando además
una pantalla CRUD dentro de la pestaña "Días feriados" de Configuración) -
pero esa tabla **nunca existió en este árbol reconstruido**. Confirmado
por grep: no hay ningún `CREATE TABLE dias_feriados` en `schema.sql`, ni
rutas para ella en `routes/conceptos.ts`, ni ningún componente que la
consuma. El propio diff de este parche (`sql/schema.sql`, hunk sobre
`dias_feriados`) muestra el `CREATE TABLE` que esperaba encontrar
(`id, fecha UNIQUE, descripcion, creado_en` - sin ámbito) como el estado
"antes" del cambio - es decir, ese catálogo simple ya debía existir de
una migración anterior a esta, que tampoco llegó entre los 46 parches
recuperados (ni depende de ninguna de las brechas #1/#5/#8 ya
documentadas - es una brecha nueva e independiente). Hoy el sistema
registra el feriado 100% a mano, por día y por trabajador, en el Tareo
Diario (`horas_feriado`/`minutos_feriado`), sin ningún calendario
central. Esto es consistente con el patrón ya visto en las brechas
#5 (`asientoContable.ts`) y #12 (pestañas de Configuración): una pieza de
infraestructura de base que ninguno de los 46 parches recuperados crea.

**Qué se descartó por completo** (sin ningún rastro en el código, ni
siquiera comentado, porque no hay nada sobre lo que apoyarlo):
- `frontend/src/components/Configuracion.tsx`: los 11 hunks (selector de
  ámbito + selects condicionales de ubicación en el formulario de alta/
  edición de un feriado, pestaña "Días feriados") - 100% de los hunks
  fallaron, nada se aplicó (la pestaña en sí ya era brecha #12).
- `src/routes/conceptos.ts`: las 4 hunks del CRUD de `dias_feriados` con
  su validación de consistencia ámbito↔ubicación - 100% fallaron.
- `src/routes/planilla.ts`: de los 3 hunks, 1 se aplicó "por accidente"
  (contexto coincidía) pero quedó **roto** - agregaba un bloque que
  consultaba `SELECT ... FROM dias_feriados WHERE ... ambito IN
  ('REGIONAL', 'LOCAL')` (tabla inexistente, hubiera tirado 500 en
  producción en cada `POST /:id/calcular`). Se revirtió a mano ese bloque
  completo, dejando una `NOTA (recon 31/46)` en su lugar.
- `sql/migracion_042_feriados_por_ubicacion.sql` y el hunk de
  `dias_feriados` en `schema.sql`: se reescribió el archivo de migración
  para quitar TODOS los `ALTER TABLE dias_feriados ...` (columnas
  ambito/ubigeo_*, constraints de consistencia, índice único nuevo) -
  ejecutar esos `ALTER TABLE` contra una base real fallaría de inmediato
  porque la tabla no existe.
- `src/tipos.ts` (hunk 1, tipo `AmbitoFeriado` + campos de `DiaFeriado`) y
  `frontend/src/types.ts` (hunk 2, probablemente el mismo tipo del lado
  frontend): fallaron enteros - `DiaFeriado` no existe en ninguno de los
  2 lados.
- `tests/feriados_por_ubicacion.test.ts` (471 líneas, 13 casos): archivo
  nuevo completo, eliminado sin conservar nada - los 13 casos ejercitan
  exclusivamente el emparejamiento ámbito↔proyecto (ej. "un proyecto en
  Sullana-Piura SI recibe el feriado regional de Piura"), inservible sin
  la tabla `dias_feriados`.

**Qué SÍ se reconstruyó** (independiente de `dias_feriados`, aplicó
100% limpio con `patch -p2 --fuzz=0`, sin necesidad de reconciliación
manual):
- `sql/schema.sql` / `sql/migracion_042_feriados_por_ubicacion.sql`:
  `ALTER TABLE proyectos ADD COLUMN ubigeo_departamento_codigo /
  ubigeo_provincia_codigo / ubigeo_distrito_codigo` (referencian el
  catálogo UBIGEO ya existente desde la migración 016 - mismo catálogo
  que ya usa `empleados`). Sin `GRANT` nuevo (columnas en tabla existente).
- `src/routes/proyectos.ts`: `POST`/`PUT /api/proyectos` ahora aceptan y
  persisten estos 3 campos.
- `frontend/src/components/Proyectos.tsx`: agrega selects en cascada
  departamento → provincia → distrito (mismo patrón ya usado en
  `Trabajadores.tsx`), tanto al crear un proyecto como al editar uno
  existente, consumiendo `GET /api/catalogos` (ya existente).
- `src/tipos.ts` / `frontend/src/types.ts`: campos opcionales
  `ubigeo_departamento_codigo`/`ubigeo_provincia_codigo`/
  `ubigeo_distrito_codigo` en la interfaz `Proyecto` (ambos lados).

Esta mitad reconstruida queda **sin ningún consumidor todavía** (ningún
código lee estas columnas para decidir nada) - es una preparación a
propósito para cuando el catálogo `dias_feriados` se reconstruya en el
futuro (propio o a partir de un parche que aparezca despues), momento en
el que recién se podría retomar el resto de este parche #31/46 (el
ámbito NACIONAL/REGIONAL/LOCAL en sí).

Verificado: `tsc --noEmit` limpio (backend y frontend). 336/336 tests
(sin cambio en el conteo - no se conservó ningún test nuevo de este
parche).

## 16. Parche #32/46 (`ba17c03a`, "Boletas: busqueda por fecha de calculo, mensajes de estado y modal flotante") — el "formulario flotante" es OTRA VEZ la brecha #1, se omite solo esa parte

**Estado: mayormente reconstruido** - se aplicó todo el parche EXCEPTO la
conversión de "Ver boleta" a un formulario flotante (modal), que se
mantiene con el comportamiento anterior (la boleta se inserta debajo del
listado, como ya funcionaba antes de este parche).

**Causa raíz de lo omitido**: el propio comentario del parche original
dice textualmente "Reusa el mismo patron modal-overlay/modal-flotante ya
usado en Registrar Tareo Diario" - es decir, este modal para "Ver boleta"
depende de la MISMA infraestructura CSS/UX (clases `.modal-overlay`,
`.modal-flotante`, `.modal-flotante-cabecera`, `.modal-flotante-cerrar`,
`.modal-flotante-buscador`, `.modal-flotante-resultados`,
`.modal-flotante-resultado-vacio`) que nunca se reconstruyó, porque los
parches que la creaban (`#16`/`#17`/`#18`, el "formulario flotante" de
Tareo Diario) fueron SALTADOS por completo - ver brecha #1 más arriba.
Confirmado por grep: ninguna de esas clases existe en `styles.css` ni en
ningún componente. A diferencia de las brechas con una tabla SQL faltante
(que hacen fallar la app con un 500), aquí el riesgo es distinto: el
parche aplica mecánicamente 100% limpio (el JSX no depende de que la
clase CSS exista para compilar), pero el resultado visual sería un
`<div>` sin overlay, sin centrado ni superposición - una experiencia
rota, no lo que el usuario pidió. Se prefirió, otra vez, no inventar esa
UX desde cero y en su lugar conservar el comportamiento previo, coherente
con el criterio ya aplicado en la brecha #1.

**Qué se omitió/revirtió** en
`frontend/src/components/Boletas.tsx` (el parche aplicó 100% limpio con
`patch -p2`, esto se revirtió a mano después):
- El estado `dniModal`/`resultadosModal`/`buscandoModal`/`envioModal`, las
  funciones `abrirBoleta`/`cerrarBoleta` (wrappers de
  `setBoletaSeleccionada` que además reseteaban ese estado del modal) y
  `enviarBoletaModalPorCorreo`, y el `useEffect` que buscaba "otro
  trabajador" por DNI dentro del modal.
- El bloque JSX `<div className="modal-overlay">...` completo (cabecera
  con nombre/DNI + botones Descargar PDF/Enviar por correo/Imprimir/Cerrar
  movidos ahí, el buscador de DNI dentro del modal, y `<Boleta
  ocultarControles />` embebida) - se restauró el `<Boleta detalle={...}
  onCerrar={() => setBoletaSeleccionada(null)} />` simple que ya existía
  antes de este parche (sin `ocultarControles`, con sus propios controles
  internos).
- `frontend/src/styles.css`: se omitió por completo el hunk que agregaba
  `.modal-flotante-ancho { max-width: 1100px }` (una variante de una clase
  base `.modal-flotante` que no existe - no tiene nada que extender).

**Qué SÍ se reconstruyó completo** (100% del resto del parche, sin
depender del modal en absoluto):
- `src/routes/planilla.ts`: filtro `calculado_desde`/`calculado_hasta`
  (por `detalle_planilla.calculado_en`, límite superior exclusivo del día
  siguiente para incluir todo el día) en `GET /:id/planilla` y las 4
  descargas (excel/pdf/boletas-pdf/boletas-zip) vía el nuevo
  `FiltrosDetallePeriodo`/`filtrosDetallePeriodoDeQuery`; nueva función
  `contarBoletasPeriodo` y el campo `total_boletas_periodo` en la
  respuesta de `GET /:id/planilla` (1 hunk con desfase de contexto,
  reinsertado a mano sin cambios de contenido).
- `frontend/src/components/Boletas.tsx` (todo lo demás): `etiquetaPeriodo`
  (quincena/semana/proyecto/"(sin calcular)" en el selector de periodo,
  que ahora lista TODOS los periodos y no solo los ya calculados),
  filtros de fecha "Calculado desde/hasta" en el formulario de búsqueda,
  `mensajeSinResultados` (mensaje de 3 vías: sin calcular / calculado sin
  boletas / búsqueda sin resultados), y los botones de exportar/imprimir
  ahora ocultos cuando no hay resultados.
- `tests/boletas_busqueda_y_estado.test.ts` (9 casos, archivo completo):
  todos ejercitan exclusivamente el backend (`GET /:id/planilla` con los
  filtros de fecha y `total_boletas_periodo`), ninguno depende del modal
  - se conservó completo, sin cambios.

Verificado: `tsc --noEmit` limpio (backend y frontend). 345/345 tests
(336 previos + 9 nuevos de `boletas_busqueda_y_estado.test.ts`).

---

## 17. Parche #33/46 (`db871772`, "feat(planilla-mensual): unificar Reportes y Planilla Mensual") — reescritura arquitectónica grande (12 archivos, 2567 líneas); reconfirma la brecha #5 por 3ra vez; una función/interfaz nueva se reconstruye completa a partir del propio parche

Este parche unifica la pantalla "Planilla Mensual" con lo que antes era el
reporte separado de Empleados: todo pasa a trabajar por un **ALCANCE**
`{anio, mes, proyecto: string | null}` (`proyecto: null` = "todos los
proyectos", solo ADMIN) en vez de un `planilla_mensual_id` fijo en la URL,
combinando SIEMPRE obreros ya consolidados (`detalle_planilla_mensual`, vía
`resolverCabecerasObreros`) con empleados de régimen general de ese mismo
mes (`detalle_planilla`, vía `obtenerDetalleEmpleadosDelMes` — estos NUNCA
se "consolidan", su propio período MENSUAL ya cubre el mes calendario
completo). Afecta `src/planillaMensual.ts`, `src/afpnet.ts`,
`src/afpnetExcel.ts`, `src/plame.ts`, `src/routes/planillaMensual.ts`,
`frontend/src/types.ts`, `frontend/src/components/PlanillaMensual.tsx` y 4
archivos de `tests/`.

Fue delegado primero a un subagente (`Agent` general-purpose) por su
tamaño; un límite de sesión lo cortó a medio camino, dejando
`src/planillaMensual.ts` 100% aplicado (verificado línea por línea, sin
`.rej`) y el resto con hunks parciales. Se retomó la reconciliación
directamente (sin reanudar el subagente) para mantener control fino sobre
las 2 decisiones de juicio de abajo.

**Brecha #5 (`src/asientoContable.ts`) reconfirmada ausente una 3ra vez**
(antes: parche #15/46, parche #19/46): este parche trae, como MODIFICACIÓN
(no como novedad), la ruta `GET /:id/exportar/asiento-contable` →
`GET /exportar/asiento-contable` (con query params `anio`/`mes`/`proyecto`
igual que el resto del router) y el botón "Descargar Asiento Contable
(Excel)" correspondiente en `PlanillaMensual.tsx`, además de una prueba en
`tests/planilla_mensual_unificacion.test.ts` que agrupa el asiento POR
PROYECTO en modo "todos los proyectos". Las 3 piezas se omiten por
completo, igual que en los 2 parches anteriores: `src/asientoContable.ts`
sigue sin existir en este árbol. Se actualizaron los comentarios
`NOTA (recon 19/46, reconfirmado en recon 33/46): ...` en
`src/routes/planillaMensual.ts` y `frontend/src/components/PlanillaMensual.tsx`
para reflejar la 3ra confirmación, y se quitó el import de
`"../src/asientoContable"` y el test que lo usaba en
`tests/planilla_mensual_unificacion.test.ts` (el resto de ese archivo, que
no depende de asiento contable, se conservó completo sin cambios).

**`obtenerDiagnosticoAfpnetMensual`/`DiagnosticoAfpnetMensual` — reconstruida
completa, no es una brecha**: a diferencia de `asientoContable.ts` (donde
NINGÚN parche recuperado trae la implementación), esta función se
referenciaba en el diff de este parche como una MODIFICACIÓN de código que
no existe en ningún lado de este árbol (ni la interfaz `DiagnosticoAfpnetMensual`
en `frontend/src/types.ts`, ni la función en `src/afpnetExcel.ts` — confirmado
con grep en ambos archivos antes de decidir). Pero el propio diff de este
parche SÍ trae el contenido completo y concreto de ambas (no solo el
diff de un cambio menor), y además las usa en múltiples puntos coherentes
entre sí dentro del mismo parche (2 sitios en `routes/planillaMensual.ts`,
`tests/afpnet_excel.test.ts` completo, y `tests/planilla_mensual_unificacion.test.ts`).
Como no se trata de inventar código no verificado sino de aplicar
exactamente lo que un parche legítimamente recuperado especifica — su
prerrequisito (una introducción anterior de esta misma función, en algún
parche NO recuperado de los 46) simplemente nunca llegó —, se agregó fresca
en ambos archivos (backend y frontend), siguiendo el mismo patrón de
`generarFilasAFPnetExcel`. Mismo criterio aplicado al middleware
`Cache-Control: no-store` de `src/routes/planillaMensual.ts` (el diff lo
mostraba como código ya existente — contexto sin cambios —, pero no estaba
en este árbol; se agregó completo porque el propio parche lo da entero,
sin necesidad de inventar nada).

**Qué se reconstruyó** (además de lo anterior): reescritura completa de
`src/routes/planillaMensual.ts` (rutas `:id` → query params
`anio`/`mes`/`proyecto`; `GET /` ya nunca devuelve 404, siempre 200 con
arreglos vacíos); `frontend/src/components/PlanillaMensual.tsx` (selector
"Por proyecto"/"Todos los proyectos", columnas "Tipo"/"Proyecto" en modo
"todos", tarjeta de diagnóstico por Sistema de Pensión, aviso de períodos
MENSUAL de empleados sin calcular); `frontend/src/types.ts`
(`VistaDeclaracionMensual`, `PeriodoMensualEmpleadosNoCalculado`); y las 4
suites de prueba adaptadas al nuevo `alcance` (en vez de
`planillaMensualId`), incluyendo el archivo nuevo completo
`tests/planilla_mensual_unificacion.test.ts` (mezcla real obreros+empleados
y combinación de varios proyectos a la vez con `proyecto: null`).

Verificado: `tsc --noEmit` limpio (backend y frontend). 360/360 tests (345
previos + 15 nuevos: 2 en `afpnet_excel.test.ts`, 3 en
`planilla_mensual_rutas.test.ts`, 10 en `planilla_mensual_unificacion.test.ts`
— descontando el test de asiento contable omitido de este último).

---

## 18. Parche #34/46 (`c333650a`, "Tareo Diario: al elegir un trabajador se abre en formulario flotante") SALTADO — construye ENCIMA de la brecha #1, no la cierra

**Estado: saltado sin aplicar (no hay commit funcional para él, solo un
comentario `NOTA` en el punto donde hubiera ido).**

Esperanza inicial (al llegar a este parche): quizás finalmente traía la
infraestructura base del "formulario flotante" de `TareoDiario.tsx` que
falta desde la brecha #1 (parches #16/#17/#18, SALTADOS). No es el caso:
este parche ASUME esa base como ya existente y solo la extiende — envuelve
la tarjeta simple del trabajador seleccionado en un `modal-overlay`/
`modal-flotante-completo` NUEVO (con navegación "Trabajador anterior/
siguiente") que queda ANIDADO alrededor del formulario de UN día específico
(`fechaModalAbierto`) que la brecha #1 nunca reconstruyó, y mueve el
buscador de "cambiar de trabajador" (`busquedaModal`/`coincidenciasModal`/
`cambiarTrabajadorDesdeModal`) de ese modal de día (inexistente) al nuevo
modal de trabajador. Confirmado por grep: `fechaModalAbierto`,
`modal-overlay`, `modal-flotante`, `cambiarTrabajadorDesdeModal`,
`busquedaModal`, `coincidenciasModal` y `cerrarModal` no existen en ningún
lado de `TareoDiario.tsx` en este árbol. El dry-run de `patch -p2` lo
confirma: 4 de 5 hunks fallan en `TareoDiario.tsx` (el único que aplica
"limpio" es un cambio de contexto trivial que no depende del modal) y el
único hunk de `styles.css` (agrega `.modal-flotante-completo` como variante
de una clase base `.modal-flotante` que tampoco existe) también falla.

Mismo criterio que la brecha #1: reconstruir esto implicaría inventar
desde cero toda la lógica del formulario de un día (estado, navegación,
guardado, subida de certificado) que ningún parche recuperado documenta
completo — no se trata de un término de fórmula omitible, sino de una
pantalla entera. Se agregó un comentario `NOTA (recon 34/46 SALTADO): ...`
en `frontend/src/components/TareoDiario.tsx`, justo antes de la tarjeta
simple (sin modal) del trabajador seleccionado, que se conserva intacta.

**Cómo cerrar esta brecha en el futuro:** igual que la brecha #1 - si
aparece el parche faltante que originalmente creó el modal día-por-día de
`TareoDiario.tsx` (anterior a estos 4, #16/#17/#18/#34), aplicarlo primero
y luego reintentar estos 4 en orden cronológico.

No requirió verificación (`tsc`/`jest`) porque no se tocó ningún código
funcional, solo se agregó un comentario.

---

## 19. Parche #35/46 (`b7fb93f8`, "Tareo Diario: limite de horas independiente por concepto") — reconstruido completo, sin brechas nuevas

**Estado: aplicado y verificado completo (migración 043 + backend + frontend + pruebas).**

Este parche reemplaza el límite ÚNICO y COMBINADO de horas de tareo por
día (una sola pareja de columnas `horas_max_lun_vie`/`minutos_max_lun_vie`
y `horas_max_sabado`/`minutos_max_sabado` en `limites_tareo`, que topaba la
SUMA de todas las horas del día) por 4 límites INDEPENDIENTES, uno por
concepto (Jornal normal, Horas extra tramo 1/2/3), cada uno con su propio
límite para 2 tipos de día (lunes a viernes / sábado) = 16 columnas nuevas
(`horas_max_<concepto>_<tipo_dia>` / `minutos_max_<concepto>_<tipo_dia>`).
Domingo trabajado y Feriado trabajado siguen SIN límite (se pagan aparte),
igual que antes.

**Patrón "hunk parcialmente aplicado" recurrente una vez más** (ya
documentado en secciones anteriores): en `src/routes/planilla.ts` y en
`frontend/src/components/TareoDiario.tsx`, el hunk que DEFINE/IMPORTA
`CONCEPTOS_LIMITE_TAREO` (o el tipo `ClaveConceptoLimiteTareo`) falló,
mientras que el hunk posterior que ya lo USA aplicó limpio — dejando el
árbol en estado no compilable hasta reinsertar manualmente la definición
faltante, tomada íntegra del propio diff del parche (sin inventar nada,
ya que el parche mostraba el contenido completo de la definición).

**`frontend/src/types.ts`**: el único hunk (reemplazo íntegro de la
interfaz `LimitesTareo` de 4 campos por la de 16 campos + índice) falló al
100% por desajuste de contexto/offset, pero el contenido nuevo completo
venía dado enteramente por el diff, así que se transcribió directo.

**`frontend/src/components/Configuracion.tsx`**: 4 de 5 hunks fallaron
(el 5to, el cuerpo de `guardarLimitesTareo`, ya había aplicado solo y
referenciaba constantes aún no definidas — mismo patrón de "éxito
parcial"). Los 4 pendientes se reconstruyeron a mano, íntegros del propio
diff: import de `ClaveConceptoLimiteTareo`; los arreglos
`CONCEPTOS_LIMITE_TAREO`/`TIPOS_DIA_LIMITE_TAREO` (mismas claves que ya usa
el backend); el inicializador de `edicionLimites` reescrito como bucle
sobre esos arreglos en vez de 4 campos fijos; el `setEdicionLimites(...)`
dentro de `cargar()` reescrito igual; y el bloque de edición reemplazado
por una tabla dinámica (`CONCEPTOS_LIMITE_TAREO.map` ×
`TIPOS_DIA_LIMITE_TAREO.flatMap`) en vez de 4 pares `<label>`/`<input>`
fijos. Esta pantalla sigue siendo mucho más chica que la del autor
original del parche (ver `NOTA (recon 27/46)` ya existente en el archivo:
varias sub-pestañas de Configuración, como Días feriados o Plan de
cuentas, nunca se reconstruyeron), pero esta funcionalidad puntual
("Límites de tareo") es autocontenida y no depende de esas sub-pestañas
faltantes, así que se reconstruyó completa sin tocar esa brecha.

**Archivos que aplicaron limpios (0 hunks fallidos), revisados igual para
confirmar consistencia con el nuevo esquema de 16 columnas**:
`sql/schema.sql` (tabla `limites_tareo` actualizada), `src/routes/conceptos.ts`
(GET/PUT genérico basado en `CONCEPTOS_LIMITE_TAREO`/`TIPOS_DIA_LIMITE_TAREO`),
`tests/limites_tareo.test.ts` (archivo nuevo, 5 pruebas), y
`tests/periodo_cruza_mes.test.ts`, `tests/planilla_mensual_consolidada.test.ts`,
`tests/planilla_mensual_rutas.test.ts`, `tests/reportes_resumen_planilla.test.ts`,
`tests/subsidio_enfermedad_paternidad.test.ts`, `tests/tareo_diario.test.ts`
— ninguno referencia los nombres de columna viejos (`horas_max_lun_vie`,
`minutos_max_lun_vie`, `horas_max_sabado`, `minutos_max_sabado`; confirmado
con grep en los 7 archivos, cero coincidencias).

**Archivo nuevo**: `sql/migracion_043_limites_tareo_por_concepto.sql` — un
bloque `DO $$ ... IF EXISTS ... RENAME COLUMN ... END $$` defensivo que
renombra las 4 columnas viejas a su equivalente `_normal_` (para conservar
cualquier valor que el usuario ya haya configurado en producción), más
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para las 12 columnas nuevas de
tramo1/2/3, cada una con su `CHECK` (0-24 horas, 0-59 minutos) y valores
por defecto razonables (4 horas, 0 minutos). No crea tablas nuevas, así
que no hace falta ningún `GRANT` adicional para `grupojhc_boletas` (a
diferencia de otras migraciones anteriores de este proyecto que sí crean
tablas).

**3 archivos de prueba NO reconstruidos, confirmado que NO es una brecha
nueva**: `tests/dominical_proporcional.test.ts`, `tests/feriado_no_laborado.test.ts`
y `tests/feriados_por_ubicacion.test.ts` no existen en este árbol (`patch`
reportó "can't find file to patch" para los 3). Se confirmó revisando el
diff crudo del parche para estos 3 archivos: sus únicos cambios son, en
`beforeAll`/`afterAll`, actualizar el `UPDATE limites_tareo SET ...` que
relaja/restaura los límites (de las 4 columnas viejas a las 16 nuevas) —
es decir, dependen enteramente de que el archivo base ya exista, y esos 3
archivos completos nunca se reconstruyeron por las brechas #4 (columnas de
dominical proporcional/feriado no laborado faltantes en `detalle_planilla`)
y #15 (tabla `dias_feriados` nunca existió). No es una brecha nueva de
este parche, solo la misma ausencia ya documentada propagándose a este
cambio puntual.

Verificado: `tsc --noEmit` limpio (backend y frontend). 365/365 tests
(360 previos + 5 nuevos de `tests/limites_tareo.test.ts`).

---

## 20. Parche #36/46 (`9e4d588d`, "Tareo Diario: corrige el ensanchamiento de columnas al mostrar alertas de límite") — descubre una BRECHA NUEVA: `fueraDeVigencia`/`formatearFechaVisible` nunca llegaron en ninguno de los 46 parches

**Estado: aplicado parcialmente y verificado (la parte que no depende de
brechas quedó completa; se omitió solo la porción que caía dentro del
modal ya documentado en la brecha #1, más una porción nueva y menor).**

Parche 100% frontend (`TareoDiario.tsx`, `styles.css`), sin migración ni
cambios de backend. Corrige un defecto de UI real: la tabla de Tareo
Diario usa `white-space: nowrap` para que los inputs de horas/minutos no
salten de línea, pero eso también impedía que el aviso de "límite
excedido" quebrara en varias líneas — un mensaje largo ensanchaba la
columna Fecha completa y desplazaba las demás columnas fuera del campo
visual. La solución: una clase reutilizable `.aviso-columna` en
`styles.css` (con dos variantes, `-limite` y `-vigencia`) que quiebra el
texto dentro de un ancho fijo en vez de estirar la columna, y mover cada
aviso de límite a mostrarse debajo de SU PROPIA columna de concepto (en
vez de amontonar todos bajo la columna Fecha) — para lo cual
`erroresLimite` pasa a guardarse con clave `"fecha|claveConcepto"` (no
solo `"fecha"`) mediante una nueva función `claveErrorLimite(fecha,
claveConcepto)`.

**Patrón "hunk parcialmente aplicado" una vez más**: los hunks que
renombran `limpiarErrorLimite` a `limpiarErrorLimiteConcepto` y que ya
llaman a `claveErrorLimite(...)` habían aplicado solos (heredados del
propio parche 35, que ya traía por adelantado parte de este cambio),
pero el hunk que agrega la DEFINICIÓN de `claveErrorLimite` nunca se
había aplicado — dejando el árbol sin compilar hasta reinsertarla a mano,
tomada íntegra del propio diff. Igual patrón en la fila principal de la
grilla (`dias.map(...)`): se reescribió a mano para que cada columna de
concepto calcule su propio `mensajeError` con `claveErrorLimite` y lo
muestre con la clase `aviso-columna-limite`.

**Brecha NUEVA descubierta en este parche**: el propio diff de este
parche asume que ya existen, como contexto sin cambios (no los define en
ningún lado): la variable `fueraDeVigencia` (un aviso "Fuera de vigencia"
que se muestra junto a la fecha cuando un día cae fuera del rango de
vigencia del contrato del trabajador) y la función
`formatearFechaVisible(fecha)` (para mostrar la fecha con un formato más
amigable que el `YYYY-MM-DD` crudo). Se confirmó con `grep` en TODOS los
46 parches recuperados que ninguno los DEFINE como código nuevo — solo
los referencian como contexto ya existente: el parche #28/46
(`2e06805a`, "Bloqueo preventivo en tiempo real del límite de tareo",
sección 13 de este documento) ya los daba por sentados y su
reconciliación en su momento simplemente los omitió sin dejar una entrada
propia en este documento (quedó implícito dentro de la omisión general de
`filaModal`). Los parches #16/#17 (brecha #1, SALTADOS) también los
referencian dentro del modal inexistente. Conclusión: el parche que
originalmente introdujo la verificación de vigencia del contrato en
`TareoDiario.tsx` (probablemente junto con `formatearFechaVisible`) nunca
llegó como parte de los 46 `.patch` recuperados — es una funcionalidad de
producción real que este árbol reconstruido simplemente no tiene, ni
tiene forma de tener sin inventar la lógica de negocio completa (qué
campo del contrato define "vigencia", cómo se calcula el rango, qué pasa
en los bordes). No se intentó adivinar esa lógica.

**Qué se omitió por esta brecha, concretamente**: en la columna Fecha, el
bloque `{fueraDeVigencia && (<div className="aviso-columna
aviso-columna-vigencia">Fuera de vigencia</div>)}` no se agregó (la
columna sigue mostrando `{fila.fecha}` en crudo, igual que antes de este
parche, en vez de `{formatearFechaVisible(fila.fecha)}`). Se dejó un
comentario `NOTA (recon 36/46): ...` en el punto exacto, explicando que
ninguno de los 46 parches define estas dos piezas. El resto de la columna
Fecha (el aviso de límite que antes vivía ahí) se retiró correctamente,
tal como pedía este parche, porque ahora vive debajo de cada columna de
concepto.

**Qué se omitió por la brecha #1 (ya conocida)**: el hunk que tocaba el
formulario flotante de un día (`filaModal`, `camposHorasModal`,
`especialModal`, `cambiandoTrabajador`, clases `modal-flotante-campo`/
`modal-flotante-grid-horas`/`modal-flotante-horas`) no se pudo aplicar en
absoluto porque esa infraestructura entera sigue sin existir en este
árbol (confirmado por grep, cero resultados) — mismo criterio que las
secciones 1, 16 y 18 de este documento.

**Cómo cerrar la brecha nueva en el futuro:** si aparece el parche
faltante que originalmente introdujo `fueraDeVigencia`/
`formatearFechaVisible` en `TareoDiario.tsx` (posiblemente relacionado
con validar la fecha de ingreso/cese del contrato), aplicarlo primero y
luego revisar si el parche #28/46 y este #36/46 necesitan alguna
reconciliación adicional para conectar sus fragmentos con esa base.

Verificado: `tsc --noEmit` limpio (backend y frontend). 365/365 tests
(sin cambios en el número de tests - este parche no trae pruebas propias,
"Cambio 100% de frontend" según su propio mensaje de commit).

---

## 21. Parche #37/46 (`941a0b73`, "Trabajadores: formulario flotante + estilo uniforme de encabezados/botones") — 20 archivos; el "formulario flotante" de Trabajadores es OTRA VEZ la brecha #1 (aunque su código sea 100% completo y autónomo); se aplica todo lo demás

**Estado: aplicado parcialmente y verificado (todo el rediseño cosmético
—`.titulo-reporte`/`button.secundario`— se aplicó en 18 de los 20
archivos; el envoltorio de formulario flotante de `Trabajadores.tsx` se
omitió por la brecha #1).**

Parche grande (20 archivos) con 2 mejoras independientes mezcladas en un
solo commit: (1) el registro/edición de trabajadores pasa de una tarjeta
al final de la lista a un formulario flotante (mismo patrón que
`TareoDiario.tsx`/`Boletas.tsx`), con navegación "trabajador
anterior/siguiente" y guardado automático al saltar de uno a otro; y (2)
se unifica el estilo de encabezados (clase `.titulo-reporte`, ya usada
por Reportes) y se agrega `button.secundario` (gris neutro, para
Cancelar/Cerrar) en 19 componentes del sistema.

**La mejora (2) se aplicó completa**: `.titulo-reporte` en los `<h2>` de
18 archivos (`Bitacora.tsx`, `Boletas.tsx`, `Calculo.tsx`,
`CambiarPassword.tsx`, `Configuracion.tsx` —solo su única sección que
existe, "Límites de tareo"—, `Dashboard.tsx`, `Empresa.tsx` (3 títulos),
`Importar.tsx`, `Parametros.tsx`, `Periodos.tsx`, `Proyectos.tsx`,
`Roles.tsx`, `Tareo.tsx`, `TareoDiario.tsx`, `Trabajadores.tsx` (3
títulos, ver más abajo), `Usuarios.tsx`, `Vacaciones.tsx`) y
`button.secundario` (definido en `styles.css`) en los botones
Cancelar/Cerrar correspondientes. 2 hunks (uno en `Periodos.tsx`, uno en
`PlanillaMensual.tsx`) no se aplicaron porque el `<h2>Faltan cuentas
contables por configurar</h2>` que tocaban no existe en este árbol — es
la misma brecha #5 (`asientoContable.ts`/"Faltan cuentas contables",
nunca reconstruido), no una brecha nueva.

**La mejora (1), en `Trabajadores.tsx`, es OTRA VEZ la brecha #1 — con
un matiz importante**: a diferencia de los casos anteriores (`#16`/`#17`,
que asumían estado ya existente que nunca llegó), el código de este
formulario flotante para Trabajadores es 100% completo, nuevo y autónomo
(define su propio estado desde cero: `cambiandoTrabajador`,
`busquedaModal`, `indiceTrabajadorModal`, `coincidenciasModal`,
`cambiarTrabajadorDesdeModal`, `guardarDatosFormulario` extraído de
`guardarTrabajador` — nada de esto depende de código de
`TareoDiario.tsx` ni de ningún otro archivo) — de hecho, 12 de los 13
hunks de este archivo aplicaron solos, sin ningún conflicto de contexto.
El bloqueo es exactamente el mismo que ya
documentó la sección 1 para el parche `#18` (Tareo, formulario de
totales): usa las clases CSS genéricas `modal-overlay`, `modal-flotante`,
`modal-flotante-ancho`, `modal-flotante-cabecera`, `modal-flotante-
flecha`, `modal-flotante-cerrar`, `modal-flotante-buscador`,
`modal-flotante-resultados`, `modal-flotante-resultado-vacio` que NINGÚN
parche de los 46 recuperados define — confirmado (de nuevo) que ninguna
existe en `styles.css`. El propio `styles.css` de ESTE parche solo agrega
`button.secundario`, no las clases de modal — es decir, ni siquiera este
parche (el más reciente en tocar el tema) las trae.

**Decisión, con el mismo criterio que la sección 1 (parche `#18`)**: se
revirtió el envoltorio completo de `Trabajadores.tsx` a su tarjeta
simple de siempre (sin modal), y con él todo el estado/funciones que solo
existían para servirlo (`cambiandoTrabajador`, `busquedaModal`,
`indiceTrabajadorModal`, `hayTrabajadorAnterior`, `hayTrabajadorSiguiente`,
`irATrabajadorAnterior`, `irATrabajadorSiguiente`, `coincidenciasModal`,
`cambiarTrabajadorDesdeModal`) — dejarlos habría sido código muerto
(nunca invocado desde ningún JSX) y el compilador ya marcaba un error
real (`guardarDatosFormulario` referenciado sin definir, por el mismo
patrón de "éxito parcial de hunks": el hunk que EXTRAE esa función de
`guardarTrabajador` falló, pero el hunk que la USA desde
`cambiarTrabajadorDesdeModal` sí aplicó). Se dejó un comentario `NOTA
(recon 37/46): ...` justo antes de la tarjeta del formulario, explicando
la causa exacta y que las mejoras (2) de esta misma pantalla (clases
"titulo-reporte"/"secundario") sí se aplicaron.

**Nota para el futuro**: esta es ya la 2da vez (después de `#18`) que un
parche trae código de modal 100% autocontenido y completo, bloqueado
ÚNICAMENTE por CSS genérico faltante (no por lógica de negocio). Si en
algún momento aparecen los parches faltantes que originalmente crearon
`.modal-overlay`/`.modal-flotante`/etc. en `styles.css` (probablemente
los mismos que faltan de la brecha #1, parches previos a `#16`), valdría
la pena reintentar TODOS los fragmentos ya marcados como bloqueados por
esta causa (`#18` en `Tareo.tsx`, este `#37` en `Trabajadores.tsx`) de
una sola vez, ya que su código JS/TS no necesita cambios, solo la base
CSS.

Verificado: `tsc --noEmit` limpio (backend y frontend). 365/365 tests
(sin tests propios de este parche, cambio de frontend puro).

---

## 22. Parche #38/46 (`74d63657`, "Trabajadores: convierte Historial y Dar de baja/Editar cese a formulario flotante") SALTADO — construye ENCIMA de la brecha #1 (vía el parche #37), no la cierra

**Estado: saltado sin aplicar (no hay commit funcional para él, solo un
comentario `NOTA` en el punto donde hubiera ido).**

Convierte las tarjetas de "Historial de periodos" y "Dar de baja/Editar
cese" de `Trabajadores.tsx` (que hasta ahora quedaban renderadas al final
de la lista, obligando a desplazarse) al mismo patrón
`modal-overlay`/`modal-flotante` que el parche #37/46 quiso introducir
para el formulario de alta/edición — y que se tuvo que omitir por la
brecha #1 (ver sección 21). Este parche depende ENTERAMENTE de esa misma
base: usa las mismas clases CSS (`modal-overlay`, `modal-flotante`,
`modal-flotante-ancho`, `modal-flotante-cabecera`,
`modal-flotante-cerrar`) que ya se confirmó que no existen en
`styles.css`, y además asume como contexto ya existente el cambio de
`useEffect` de Escape del parche #37/46 (el que combina cerrar
cesando/historial/formulario con Escape en orden de "más anidado
primero") — cambio que también se omitió al revertir el envoltorio de
modal completo en la sección 21.

De los 4 hunks, 2 (que solo eliminan las referencias `cesandoRef`/
`historialRef` y sus `useEffect` de scroll-into-view) aplicarían "limpio"
en aislamiento, pero dejarían el árbol roto: esas refs siguen en uso por
las tarjetas simples que SÍ se conservaron (patrón ya visto de "éxito
parcial" pero en sentido inverso — aquí el peligro es aplicar solo la
mitad "de atrás" sin la mitad "de adelante", que es justamente la que no
se puede reconstruir). El hunk que combina la lógica de Escape falló por
completo (el contexto que esperaba, ya modificado por el parche #37/46,
nunca se aplicó en este árbol). El hunk grande que reemplaza ambas
tarjetas por modales sí calificaría como "aplicable" en un dry-run
aislado, pero por la misma razón de fondo (CSS inexistente) que la
sección 21 ya explicó para el formulario principal.

**Decisión**: se saltó el parche completo (SALTADO), sin tocar código
funcional — solo se agregó un comentario `NOTA (recon 38/46): ...` justo
antes de la tarjeta de "Dar de baja/Editar cese", explicando que depende
de la misma brecha #1 vía el parche #37/46. Las tarjetas de Historial y
Dar de baja/Editar cese siguen funcionando exactamente igual que antes
de este parche (con scroll automático hacia ellas, sin modal).

**Cómo cerrar esta brecha en el futuro:** igual que las secciones 1, 18 y
21 — si aparecen las clases CSS `modal-overlay`/`modal-flotante`/etc. (ya
sea porque aparece el parche original que las creó, o porque se decide
escribirlas a mano en algún momento dado lo extendida que está esta
brecha), reintentar de una sola vez todos los fragmentos ya identificados
como bloqueados por esta causa: parche #18 (`Tareo.tsx`), parche #37
(formulario principal de `Trabajadores.tsx`) y este mismo parche #38
(Historial y Dar de baja/Editar cese de `Trabajadores.tsx`).

No requirió verificación (`tsc`/`jest`) porque no se tocó ningún código
funcional, solo se agregó un comentario.

---

## 23. Parche #39/46 (`0c19aeeb`, "Contratos: el selector de Tareo respeta el proyecto del periodo (Ronda C)") — la base `periodo_id` de `condicionesContratos` tampoco existía; se reconstruyó completa porque el propio diff la traía entera como contexto

**Estado: aplicado completo y verificado.**

100% backend (`src/routes/contratos.ts` + `tests/periodos_por_proyecto.test.ts`),
sin migración. El parche agrega un filtro de proyecto a
`condicionesContratos()` (la función compartida que arma el `WHERE` de
`GET /contratos`, usada por el selector de trabajadores de Tareo Diario y
Tareo): cuando se filtra por `periodo_id`, además de la vigencia por
fechas ya existente, ahora también exige que el contrato sea del mismo
proyecto del periodo (si el periodo no es "legado", es decir si tiene
proyecto asignado).

**Descubrimiento**: el bloque COMPLETO de `periodo_id` (la parte que
consulta `fecha_inicio`/`fecha_fin` en `periodos_planilla` y filtra por
vigencia) no existía en este árbol en absoluto — confirmado por grep, y
por que `condicionesContratos` aquí era una función SÍNCRONA (sin
`Promise`, sin `await pool.query`), mientras que el encabezado del hunk
del parche (`@@ ... async function condicionesContratos(...): Promise<...>`)
muestra que en la versión que este parche asume ya era asíncrona. Se
confirmó con grep en los 46 parches que `condicionesContratos` solo
aparece mencionada en ESTE parche — el que originalmente introdujo el
filtro por `periodo_id` no llegó como ninguno de los 46 recuperados.

**Por qué SÍ se reconstruyó (a diferencia de la brecha de "vigencia" de
la sección 20)**: a diferencia de `fueraDeVigencia`/`formatearFechaVisible`
en `TareoDiario.tsx` (que ningún parche mostraba nunca cómo se calculan,
solo los usaban como caja negra), aquí el propio diff de este parche
incluye, como contexto SIN CAMBIOS (líneas de diff sin `+`/`-`), el
bloque `periodo_id` completo tal cual existía antes de este parche: la
consulta SQL exacta, el manejo de `rowCount`, y los dos `condiciones.push(...)`
de vigencia por fechas. No hubo que inventar ninguna lógica de negocio —
solo transcribir lo que el propio parche ya mostraba entero, igual
criterio que `obtenerDiagnosticoAfpnetMensual` en la sección 17. Se
convirtió `condicionesContratos` a `async`/`Promise` (como el propio
encabezado del hunk ya lo daba por hecho) y se agregó `await` en sus 2
puntos de llamada (`GET /` y `obtenerFilasExportacion`, usada por las
descargas de Excel/PDF).

**Dato adicional confirmado**: ni `TareoDiario.tsx` ni `Tareo.tsx` envían
hoy `periodo_id` al pedir la lista de contratos (`GET /contratos?estado=HABIL`,
sin `periodo_id`) — o sea que, aunque el backend ya queda correcto y
probado, el selector del frontend todavía no aprovecha este filtro (eso
requeriría que algún parche posterior conecte `periodo_id` desde el
frontend; no se vio ninguno de los 46 que lo haga). No es una brecha —
simplemente el frontend nunca mandó ese parámetro en ningún parche
recuperado, así que no hay nada pendiente de aplicar de ese lado.

Verificado: `tsc --noEmit` limpio (backend y frontend). 367/367 tests
(365 previos + 2 nuevos de `tests/periodos_por_proyecto.test.ts`).

## 24. Parche #40/46 (`70fa1e7c`, "Planilla: piso legal de EsSalud mensual (Ronda 4) + RMV mensual") — reconstrucción grande de un piso legal con corrección en cascada; nueva brecha en `Parametros.tsx` (sub-menu de secciones que ningún parche construye), resuelta apilando la sección en vez de inventar el sub-menu

**Estado: aplicado completo y verificado.**

Parche grande (14 archivos): migración `044` (tabla `rmv_mensual` + columna
`essalud_base` en `detalle_planilla` y `detalle_planilla_mensual`),
funciones puras nuevas en `motorCalculo.ts`
(`calcularPisoEssaludMensual`/`calcularAjustePisoEssaludMensual`), la
reconciliación real en `routes/planilla.ts`
(`ajustarPisoEssaludDelMes`) y su equivalente directo (sin cascada) en
`planillaMensual.ts`, CRUD de `rmv_mensual` en `routes/parametros.ts`,
UI nueva en `Parametros.tsx` (`SeccionRmvMensual`) y aviso informativo en
`Calculo.tsx` (`avisos_essalud`).

**Regla de negocio** (confirmada con el usuario, ver comentario completo
en `tipos.ts`/`motorCalculo.ts`): el aporte a EsSalud (9% de la
remuneración afecta) no puede ser menor, en un mes calendario, al 9% de
la RMV vigente ese mes — pero el sistema paga por quincena/semana. Se
guarda `essalud_base` (el 9% SIN ajustar) además de `essalud` (el monto
final, ya ajustado si correspondió) para poder recalcular el acumulado
del mes sin arrastrar un ajuste ya aplicado antes. Si la suma de
`essalud_base` de los períodos ya calculados de un mes no llega al piso,
la diferencia se acredita en el período cronológicamente más reciente de
ese conjunto; si luego se recalcula un período anterior, la función
decide de nuevo desde cero cuál es el período más reciente y corrige en
cascada cualquier otro período ya calculado cuyo `essalud` cambie.

**Patrón de "éxito parcial de hunks" (recurrente, ver secciones
anteriores), 2 instancias más esta vez:**

- `src/tipos.ts`: un bug de "interfaz equivocada" — `patch` aplicó el
  comentario completo + campo `essalud_base` en `DetallePlanillaMensual`
  en vez de `DetallePlanilla` (ambas interfaces terminan con la misma
  secuencia de campos, ver sección de `tipos.ts` en parches previos con
  el mismo patrón). Corregido a mano: comentario completo + campo en
  `DetallePlanilla`, comentario corto de referencia + campo en
  `DetallePlanillaMensual`.
- `src/routes/planilla.ts`: 4 de 10 hunks fallaron en cascada (imports
  faltantes, un parámetro implícitamente `any` en `cliente.query(...)`
  dentro de una función ya aplicada, la declaración de `avisosEssalud`
  faltante mientras su lógica de uso ya estaba aplicada, y el campo
  `avisos_essalud` faltante en la respuesta JSON final) — mismo patrón ya
  documentado en secciones previas: se completó cada pieza faltante
  usando el propio contenido del parche.
- `src/routes/planilla.ts` y `src/planillaMensual.ts`: el mismo desajuste
  de conteo de columnas SQL ya visto en parches anteriores — el arreglo
  JS de `VALUES` ya traía `essalud_base`/`d.essalud_base` como último
  ítem (de un hunk ya aplicado), pero la lista de columnas y los
  placeholders del `INSERT` no llegaban a incluirlo. Se corrigió contando
  a mano los ítems reales del arreglo (46 en ambos archivos, no los 50/51
  que asumía el parche original, que asume columnas de la brecha #4 que
  este árbol no tiene) y ajustando la lista de columnas + rango de
  placeholders para que coincidan exactamente.

**Brecha nueva descubierta: `frontend/src/components/Parametros.tsx`
asume un sub-menu de secciones que ningún parche de los 46 construye.**
El parche extiende `type SeccionParametros = "anual" | "mensual"` a
`"anual" | "mensual" | "rmv"`, y dos hunks (la extensión del tipo/menú y
la rama de render `{seccion === "rmv" && <SeccionRmvMensual />}`)
asumían que la pantalla YA tenía un sub-menu que muestra una sección a la
vez (mismo patrón que las pestañas de Configuración, brecha #12) — pero
nuestro árbol actual sigue con el patrón original y más simple: ambas
secciones (`SeccionAnual`/`SeccionMensual`) se renderizan siempre,
apiladas, sin ningún `useState<SeccionParametros>` ni botones de menú.
Se confirmó por grep en los 46 parches que `SeccionParametros` solo
aparece mencionado en ESTE parche — el que originalmente convirtió
`Parametros.tsx` al patrón de sub-menu (igual que pasó con las pestañas
de Configuración, brecha #12) no llegó como ninguno de los 46
recuperados. A diferencia del caso de `condicionesContratos` (sección
23), aquí el diff NO trae el sub-menu completo como contexto — solo
fragmentos discontinuos (la extensión del tipo, y una sola línea de JSX
dentro de un bloque de render mucho más grande que el hunk ni siquiera
toca) — es decir, es una referencia de caja negra, no un bloque completo
reconstruible sin inventar. Consistente con el criterio ya establecido
(brecha #1, brecha #12): no se fabricó el sub-menu desde cero. En vez de
eso, se adaptó la integración al patrón que el árbol SÍ tiene hoy: se
agregó `<SeccionRmvMensual />` apilada junto a las otras 2 secciones
existentes (el componente `SeccionRmvMensual` en sí — la función
completa con su propio estado, formulario y tabla — SÍ se aplicó limpio
desde el propio parche, ya que es 100% autocontenida y no depende de
ninguna brecha). El resultado es funcionalmente equivalente para el
usuario (la sección de RMV mensual es accesible y funciona igual),
simplemente sin el sub-menu de una-sección-a-la-vez que el parche
original asumía. Documentado con nota `NOTA (recon 40/46)` en el propio
archivo.

**`tests/dominical_proporcional.test.ts`**: el hunk de este parche (un
"ancla" — crear un período posterior del mismo mes para que el período
bajo prueba nunca sea "el último del mes" y así no reciba el ajuste de
piso, lo que enmascararía la comparación que la prueba necesita) no se
aplicó porque el archivo completo no existe en este árbol — consistente
con la brecha #4/#15 ya conocida (no es una brecha nueva; se revisó el
diff completo del hunk y es solo ese ajuste puntual sobre una prueba que
de por sí no existe aquí).

**`src/routes/vacaciones.ts`**: tocado por el parche solo porque
`ResultadoCalculoLinea`/`DetallePlanilla` ahora requieren el campo
`essalud_base`, pero este archivo solo lee `detalle.essalud` (no
inserta ninguna columna `essalud_base` en `goces_vacacionales`, tabla
que no participa del piso mensual) — sin cambios necesarios más allá de
lo que ya aplicó limpio.

Verificado: `tsc --noEmit` limpio (backend y frontend). 379/379 tests
(367 previos + 12 nuevos de `tests/essalud_piso_mensual.test.ts`).

## 25. Parche #41/46 (`3c96de0e`, "Control de Asistencia Diaria (Ronda 1): horario por proyecto") — migración 045 (tabla `horarios_proyecto` + tasa de tramo3 por proyecto); Configuración.tsx reconfirma la brecha #12 (9/9 hunks fallaron), y un bug de "orden de rutas de Express" nuevo, detectado por las propias pruebas del parche

**Estado: aplicado completo y verificado.**

Ronda 1 de un proyecto grande ("Control de Asistencia Diaria" con
marcación biométrica) que se entrega en varias rondas — esta ronda solo
trae la CONFIGURACIÓN del horario por proyecto (hora de ingreso/salida/
refrigerio, todavía sin uso en ningún cálculo, reservada para el
importador de marcaciones de la Ronda 2/3) y la tasa de recargo del
"tramo 3" de horas extra (más de 6 horas extra acumuladas en el día),
que SÍ se aplica ya mismo y se puede pactar por proyecto en vez de usar
el recargo general de la empresa (`horarios_proyecto.tasa_tramo3`, NULL
= sigue usando `conceptos_planilla.HORAS_EXTRA_CONSTRUCCION/GENERAL.factor3`
como hasta ahora). Migración `044+1` → `045`: tabla nueva
`horarios_proyecto` (PK `proyecto_id`, sin secuencia propia, con su
propio `GRANT` para `grupojhc_boletas`). `calcularHorasExtra`
(`motorCalculo.ts`) recibe un `tasaTramo3Override?: number` opcional que,
si se pasa, reemplaza solo el recargo de tramo3 para esa llamada; el
valor se resuelve en el caller (`routes/planilla.ts` /
`planillaMensual.ts`, con un `LEFT JOIN horarios_proyecto` igual al
patrón ya usado para `cuota_sindical_categoria`) — la función pura de
`motorCalculo.ts` no conoce de dónde viene el valor, así que no hay
riesgo de romper el comportamiento existente si un proyecto no configura
nada (sigue en `undefined`/`NULL`).

**Brecha reconfirmada (no nueva): `frontend/src/components/Configuracion.tsx`
depende por completo del sub-menu de 7 secciones (brecha #12) — 9/9 hunks
fallaron.** El parche agrega "Horario / Tramo 3 por proyecto" como una
8va pestaña de ese sub-menu (`type Seccion = "ingresos" | "aportes" |
... | "horarioProyecto"`), y también asume que la pantalla YA carga
`proyectos`/`cuotaSindical`/etc. en el mismo `Promise.all` (el parche de
la Ronda D en secciones anteriores confirmó que solo "Conceptos de
ingreso" y "Límites de tareo" existen en este árbol, sin sub-menu, cada
uno como una tarjeta simple apilada). Igual criterio que en Parámetros
(sección 24 de este mismo documento) y que Configuración en parches
anteriores: no se fabricó el sub-menu ni las 5 secciones que le faltan a
Configuración — se agregó "Horario por proyecto" como una TERCERA
tarjeta simple apilada (después de "Conceptos de ingreso" y "Límites de
tareo"), con su propia carga de `proyectos`/`horarios` agregada al
`Promise.all` existente. El componente `SeccionRmvMensual`-equivalente
aquí (toda la lógica de `mapaHorario`/`valorHorario`/`editarHorario`/
`esProyectoHorarioEditado`/`guardarHorarioProyecto`) es 100% autónomo y
se trasladó sin cambios de lógica, solo re-cableado al patrón de
tarjetas apiladas en vez del sub-menu inexistente. `src/routes/conceptos.ts`
(el backend GET/PUT `/conceptos/horarios-proyecto`) SÍ es completamente
autónomo — sus 2 hunks fallaron solo por desajuste de líneas de contexto
(imports/orden de secciones distintos a los que asumía el parche), se
transcribió el contenido del parche tal cual.

**Bug nuevo detectado por las propias pruebas del parche: orden de rutas
de Express.** Al colocar el bloque nuevo `GET/PUT /horarios-proyecto` al
final de `conceptos.ts` (después de `PUT /:codigo`, el handler genérico
que edita un concepto por código), Express intercepta cualquier
`PUT /conceptos/horarios-proyecto` con ese handler genérico ANTES de
llegar a la ruta especial — trata "horarios-proyecto" como si fuera un
`:codigo`, no encuentra ningún concepto con ese código, y responde 404.
Detectado porque 6 de las 13 pruebas de `tests/horario_proyecto_tramo3.test.ts`
fallaban con "Expected 400/200, Received 404" (todas las que usan PUT) y
una prueba de cálculo real fallaba por un valor incorrecto (52 esperado,
80 recibido) — consecuencia de que el PUT de guardado nunca llegaba a
guardar nada. Corregido reubicando el bloque completo `GET/PUT
/horarios-proyecto` ANTES del handler genérico `PUT /:codigo` (junto a
los otros endpoints de ruta fija como `/limites-tareo` y
`/cuota-sindical`, que ya seguían ese mismo orden correcto). Verificado
con un diff ordenado línea por línea contra el archivo original que la
reubicación no perdió ni duplicó ninguna línea.

**`tests/horario_proyecto_tramo3.test.ts`**: 1 ajuste manual — el
objeto base de la función auxiliar `asistencia(...)` traía
`dias_feriado_trabajado`/`dias_dominical_no_laborado`, que no existen en
`AsistenciaEntrada` en este árbol (brecha #4 ya documentada, error de
compilación real detectado por `tsc` vía jest/ts-jest, que NO corre
sobre `tests/` en el `tsc --noEmit -p .` normal del backend — hay que
correr jest para detectar errores de tipos dentro de las pruebas). Se
quitaron esos 2 campos con una nota explicativa, igual criterio que el
resto del motor de cálculo.

Verificado: `tsc --noEmit` limpio (backend y frontend). 392/392 tests
(379 previos + 13 nuevos de `tests/horario_proyecto_tramo3.test.ts`).

## 26. Parche #42/46 (`bf0fdc4d`, "Parametros: la vista previa de H.E. tramo1/tramo2 lee el recargo real configurado") — parche pequeño, aplicado 100% limpio, sin brechas

**Estado: aplicado completo y verificado.**

Solo `frontend/src/components/Parametros.tsx` (5 hunks). La columna de
vista previa (S/. por hora extra) en Parámetros → tabla salarial mensual
tenía el 60%/100%/25%/35% escrito directamente en el código del
frontend, en vez de leer el valor real de `conceptos_planilla`
(`HORAS_EXTRA_CONSTRUCCION/GENERAL.factor1/factor2`, editable en
Configuración). El cálculo real de la planilla ya usaba el valor
correcto — esto solo corrige la vista previa para que no quede
desactualizada si el recargo se edita desde Configuración.

Los 5 hunks aplicaron limpio (3 con un offset de -16 líneas, por las
notas `NOTA (recon 40/46)`/`NOTA (recon 41/46)` agregadas en parches
anteriores de este mismo archivo) — sin `.rej`, sin necesidad de
intervención manual. Sin migración, sin pruebas nuevas (es un cambio
puramente visual del frontend).

Verificado: `tsc --noEmit` limpio (backend y frontend). 392/392 tests
(sin cambios - este parche no toca backend ni agrega pruebas).

## 27. Parche #43/46 (`d30afc83`, "Configuracion: corrige el placeholder recortado del campo Tasa tramo 3") — 1 línea, aplicado a mano sobre la tarjeta apilada de la sección 25 (brecha #12)

**Estado: aplicado completo y verificado.**

Cambio puramente visual de 1 campo: el input "Tasa tramo 3
(multiplicador)" en Configuración → "Horario por proyecto" (agregado en
el parche #41, sección 25) mostraba el placeholder "General" cortado
como "Genera" por ser muy angosto. El parche original apunta a la línea
2211 de la versión upstream (con el sub-menu de 7 secciones, brecha
#12) — en este árbol el mismo campo vive en la tarjeta apilada
reconstruida en la sección 25, así que se aplicó el mismo cambio a mano
ahí: `style={{ width: 90 }}` → `{{ width: 120 }}` y se agregó
`title="Vacío = usa el recargo general de la empresa"`. Sin migración,
sin pruebas nuevas.

Verificado: `tsc --noEmit` limpio (frontend). Sin cambios de backend.

## 28. Parche #44/46 (`28f33a6f`, "Control de Asistencia Diaria (Ronda 2): importador de marcaciones") — migración 046 (bandeja de importación de marcaciones biométricas); `TareoUnificado.tsx` es una brecha nueva (componente que ningún parche construye); 2 utilidades (`fechaFueraDeVigencia`/`diaTieneDatos`) nunca definidas por ningún parche, reconstruidas por semántica inequívoca; la nueva importación hereda la brecha #15 (sin catálogo de feriados)

**Estado: aplicado completo y verificado.**

Ronda 2 del "puente práctico" de Control de Asistencia Diaria: mientras
se compra/verifica el equipo biométrico real, el usuario llena a mano
una plantilla Excel/CSV (1 fila por cada marcación individual: DNI,
fecha, hora, tipo ENTRADA/SALIDA) y el sistema la importa, calcula
automáticamente horas normales/extra tramo1-2-3 por día (comparando la
primera y última marca contra `horarios_proyecto`, migración 045) y las
deja en una bandeja de revisión (`importaciones_marcaciones`/
`_detalle`, migración 046, con sus `GRANT`) antes de aplicarlas al
Tareo Diario real reutilizando la MISMA validación que la edición
manual. `frontend/src/components/ImportarMarcaciones.tsx` (archivo
nuevo, 270 líneas) aplicó 100% limpio.

**Brecha nueva: `frontend/src/components/TareoUnificado.tsx` no existe
en este árbol — "can't find file to patch".** El parche asume que
`Tareo.tsx` y `TareoDiario.tsx` ya fueron unificados detrás de un
componente `TareoUnificado` con su propio sub-menu interno ("Tareo
(totales)" / "Registrar Tareo Diario" / ahora "Importar marcaciones"),
del mismo tipo que las brechas de sub-menu ya vistas (#12 en
Configuración, sección 24 en Parámetros) — confirmado por grep que
`TareoUnificado` solo aparece mencionado en este parche entre los 46.
En este árbol, `App.tsx` sigue renderizando `Tareo`/`TareoDiario` como
2 pestañas PLANAS separadas del `Sidebar` (`"tareo"`/`"tareoDiario"`),
sin ningún wrapper. Aunque el propio diff mostraba el archivo completo
de `TareoUnificado.tsx` como contexto (55 líneas, perfectamente
reconstruible), se optó por el mismo criterio ya aplicado a Parámetros/
Configuración: no fabricar el wrapper que ningún parche construye ni
reestructurar la navegación existente de `App.tsx`. Se agregó
"Importar marcaciones" como una tercera pestaña plana más en
`Sidebar.tsx`/`App.tsx` (`id: "marcaciones"`), junto a `"tareo"`/
`"tareoDiario"`, con el mismo patrón `disabled: !periodoSeleccionado`.

**Bug nuevo detectado (no de este parche en sí, sino de infraestructura
que nunca llegó): `fechaFueraDeVigencia`/`diaTieneDatos` nunca fueron
definidas por ningún parche de los 46, solo usadas.** El hunk que
extrae `validarYGuardarDiasTareoDiario` (para reutilizar la validación
del Tareo Diario manual desde "aplicar importación") introduce, POR
PRIMERA VEZ en este árbol, un bloque que llama a estas 2 funciones - un
`grep` confirmado en los 46 parches muestra que solo se usan, nunca se
declaran (deben venir de un parche anterior, no recuperado, que ya las
tenía definidas — mismo patrón que otras brechas de este documento).
A diferencia de los casos "caja negra" (`fueraDeVigencia`/
`formatearFechaVisible` en `TareoDiario.tsx`, sección 20), aquí la
semántica queda inequívoca por el nombre y los comentarios que las
rodean (comparar una fecha contra la vigencia del contrato; detectar si
una fila de tareo trae algún dato real, para no rechazar los días en
0/vacíos que la grilla del frontend siempre manda) — se reconstruyeron
ambas como funciones puras y pequeñas, sin inventar ninguna regla de
negocio nueva. Detectado porque `tsc` fallaba con "Cannot find name" en
2 puntos del archivo (el hunk había aplicado con éxito automático, sin
generar `.rej`, así que el error solo se vio corriendo `tsc` después).

**La importación hereda la brecha #15 (`dias_feriados` nunca existió,
sección 15): no hay forma de clasificar automáticamente un día
importado como "Feriado trabajado".** Se dejó `feriadosPorContrato`
siempre vacío (documentado con una `NOTA (recon 44/46)` en el punto
exacto donde el parche original consultaba `obtenerFeriadosVigentes`) -
ningún día se clasifica como feriado; el usuario puede corregirlo a
mano desde Registrar Tareo Diario después de aplicar la importación,
igual que ya hace hoy con cualquier feriado. Se omitió por completo la
función `obtenerFeriadosVigentes` (que el parche extraía de
`agregarTareoDiario`) porque su única razón de ser es consultar
`dias_feriados` - no tiene sentido reconstruirla para que siempre
devuelva un `Set` vacío. `tests/importacion_marcaciones.test.ts`: se
quitó la siembra/limpieza de `dias_feriados` en `beforeAll`/`afterAll`
y el único caso que dependía de esa clasificación ("un feriado ...
trabajado se acredita completo a 'Feriado trabajado'").

Verificado: `tsc --noEmit` limpio (backend y frontend). 400/400 tests
(392 previos + 8 nuevos de `tests/importacion_marcaciones.test.ts`, de
los 9 originales del parche - 1 descartado por la brecha #15).

## 29. Parche #45/46 (`8728fd58`, "Control de Asistencia Diaria: plantilla con PROYECTO + llegada anticipada") — última entrada del manifiesto; migración 047 (2 columnas nuevas); "llegada anticipada" queda excluida de horas extra hasta confirmación manual; plantilla Excel de marcaciones con DNI/PROYECTO/NOMBRE resueltos; aplicó 100% limpio en los 7 archivos, un solo `Cannot find name` a corregir a mano

Este es el ÚLTIMO parche de `manifest_final.tsv` (línea 46 de 46). A
diferencia de casi todos los parches grandes de este documento, los 7
archivos tocados (`ImportarMarcaciones.tsx`, `frontend/src/types.ts`,
`sql/schema.sql`, `sql/migracion_047_llegada_anticipada.sql` (nuevo),
`src/routes/planilla.ts`, `src/tipos.ts`,
`tests/importacion_marcaciones.test.ts`) aplicaron con **cero
`.rej`** — todos los hunks tuvieron éxito automático (con offsets de
hasta -361 líneas, por todo lo que este árbol acumuló manualmente en
los parches 40-44).

**Contenido funcional del parche:**
- Migración 047: agrega `minutos_llegada_anticipada` (INT) y
  `anticipacion_pagada` (BOOLEAN) a `importaciones_marcaciones_detalle`
  (tabla ya existente desde la migración 046) — sin `GRANT` nuevo,
  porque son columnas en una tabla que `grupojhc_boletas` ya tiene
  permiso completo (revisado y confirmado correcto).
- Nueva regla de negocio (pedida por el usuario el 26/09, documentada
  en el propio comentario del parche): si alguien marca su ingreso
  ANTES de la hora programada del proyecto, ese tiempo NO se acredita
  como hora extra automáticamente — queda separado en
  `minutos_llegada_anticipada` y excluido tanto del jornal normal como
  de las horas extra, hasta que la persona que revisa lo confirme
  explícitamente. Una salida DESPUÉS de la hora programada se sigue
  acreditando como extra automático, sin cambios (ese es el caso
  normal de sobretiempo). El cálculo de un día completo (antes en
  línea, repetido inline en `agregarTareoDiario`) se extrajo a una
  función compartida `calcularJornadaDesdeMarcas(...)`, reutilizada
  tanto por la importación masiva (`incluirAnticipacionComoExtra:
  false` siempre) como por el nuevo endpoint de confirmación puntual.
- Nuevo `PUT /api/periodos/:id/marcaciones/:importacionId/detalle/:detalleId`
  (body `{ anticipacion_pagada: boolean }`) — recalcula el desglose
  completo de ese día (no solo el campo de anticipación, porque el
  tramo1/2/3 depende de si esos minutos entran o no al total de
  extra), bloqueado si la fila ya se aplicó al Tareo Diario.
- Nuevo `GET /api/periodos/:id/marcaciones/plantilla` — genera un
  `.xlsx` de plantilla con DNI/PROYECTO/NOMBRE ya resueltos por
  contrato hábil vigente (mismo patrón que la plantilla de
  `/tareo/plantilla`), para que el usuario no tenga que escribir a
  mano la columna PROYECTO (que solo hace falta para desambiguar un
  DNI con más de un contrato hábil activo).
- Frontend (`ImportarMarcaciones.tsx`): fila resaltada (fondo amarillo
  claro) cuando `minutos_llegada_anticipada > 0`, con una casilla para
  confirmar/revertir el pago como extra, botón "Descargar plantilla
  Excel", y texto explicativo de la nueva regla.

**Único gap encontrado — nueva variante de la brecha #15, NO una
brecha nueva:** el hunk de `src/routes/planilla.ts` introduce, en el
nuevo `PUT .../detalle/:detalleId`, una llamada directa a
`obtenerFeriadosVigentes(...)` — la misma función que la sección 28 ya
había decidido omitir por completo (depende de la tabla
`dias_feriados`, que nunca existió en este árbol). A diferencia del
caso de la sección 28 (donde el resultado se guarda en un mapa
`feriadosPorContrato` calculado una sola vez para todo el lote), aquí
es una llamada puntual por fila — no puede reutilizar ese mapa (que
solo vive durante la request de importación). Se resolvió igual que
antes: se reemplazó la llamada por `const esFeriado = false;`, con una
`NOTA (recon 45/46)` que remite al mismo punto 15 de este documento y
explica que el usuario puede marcar el día como "Feriado trabajado" a
mano desde Registrar Tareo Diario después de aplicar/confirmar la
fila. Este fue el único error de `tsc` (`Cannot find name
'obtenerFeriadosVigentes'`) tras aplicar el parche.

**Revisión del resto de hunks (todos aplicados automáticamente, sin
`.rej`, así que se revisaron con cuidado extra por si escondían algún
problema silencioso):** `sql/migracion_047_llegada_anticipada.sql` y
el hunk de `sql/schema.sql` son consistentes entre sí (mismas 2
columnas, mismo comentario). Los hunks de `src/tipos.ts` y
`frontend/src/types.ts` son idénticos entre sí (mismo campo agregado a
`ImportacionMarcacionesDetalle` en ambos lados). El resto de
`routes/planilla.ts` (endpoint de plantilla Excel, función
`calcularJornadaDesdeMarcas`, el nuevo `PUT`) se leyó completo y es
autoconsistente — no depende de ninguna infraestructura faltante
aparte del punto ya corregido arriba. Las 5 pruebas nuevas de
`tests/importacion_marcaciones.test.ts` no referencian `dias_feriados`
en ningún punto (ya limpio desde la sección 28), así que no hubo que
descartar ninguna esta vez.

**Sobre el conteo "548/548" del propio mensaje de commit del parche
original:** ese número es de la rama upstream/original (con todos los
46+ parches históricos aplicados sin brechas) y NO aplica a este árbol
reconstruido — se ignora.

Verificado: `tsc --noEmit` limpio (backend y frontend, después de la
corrección de `obtenerFeriadosVigentes`). 405/405 tests (400 previos +
5 nuevos de `tests/importacion_marcaciones.test.ts`: llegada anticipada
no se acredita como extra al importar, llegada tarde/salida temprana
sin anticipación reduce el jornal normal sin nada que confirmar,
confirmar y revertir el pago vía `PUT`, rechazo del `PUT` sobre una
fila ya aplicada, 400 si falta `anticipacion_pagada` en el body).

**Nota sobre la numeración final:** esta es la ÚLTIMA entrada de
`manifest_final.tsv` (línea 46 de 46 líneas). Bajo la convención de
etiquetado ya establecida en este documento (línea de manifiesto L →
"recon (L-1)/46"), esta entrada queda etiquetada **"recon 45/46"** —
no hay una línea 47 en el manifiesto para un "46/46" literal. Esto
significa que, de los "46" parches históricos que dan nombre a esta
convención, solo se pudieron recuperar y reconstruir 45 en la
práctica (el desfase es un artefacto histórico de esta reconstrucción,
probable consecuencia de una deduplicación/"SALTADO" de un parche en
algún punto anterior del proceso — ver parche #22/46 SALTADO como
ejemplo de ese mecanismo). Con este parche, el manifiesto queda
agotado: no quedan más parches `.patch` por aplicar de los que se
recuperaron del respaldo original.

---

## 30. Migración 048 — dominical proporcional / feriado no laborado / sobretasas / condición de trabajo / Gratificación con 2 denominadores — RESUELVE las brechas #4 y #15, reconstruida desde `backend_dist` (NO desde un `.patch`)

**Estado: resuelta por completo** (cierra la brecha #4 "Dominical
proporcional / feriado no laborado / sobretasa / condición de trabajo"
y la brecha #15 "catálogo `dias_feriados`"). La brecha #4.1 (catálogo
de códigos PLAME para descuentos/aportes) y la brecha #5 (Asiento
Contable) siguen pendientes — no dependían de esta migración.

**Por qué esta sección es distinta a las demás de este documento:** el
manifiesto de 46 parches `.patch` quedó agotado en la sección 29. Esta
reconstrucción NO viene de un parche recuperado — viene de leer el
código YA COMPILADO de producción real (`/root/work/backend_dist` y
`/root/work/frontend_dist`, subido por el usuario el 27-sept-2026,
`dist/*.js` de `tsc` — que solo borra anotaciones de tipo, conservando
comentarios y nombres de variable intactos). Se usó como fuente de
verdad para reconstruir fielmente la lógica de negocio (fórmulas,
redondeos, comentarios) en vez de inventar o adivinar una fórmula legal
peruana — dado lo sensible (legal/financiero) de este dominio, y
siguiendo la misma disciplina de verificación (`tsc`+`jest` antes de
cada commit) que el resto de la reconstrucción por parches.

**Alcance (migración SQL `sql/migracion_048_dominical_proporcional_feriados_condicion_trabajo.sql`, consolida lo que originalmente eran 4 migraciones separadas: 022/023/026/042):**

- **Catálogo `dias_feriados`** (brecha #15): tabla nueva con
  `ambito` (`NACIONAL`/`REGIONAL`/`LOCAL`) + ubicación UBIGEO opcional,
  con un `CHECK` de consistencia ámbito↔ubicación (reforzado también en
  la API) y un índice único (`fecha, ambito, ubigeo_*` con `COALESCE`
  para que Postgres trate los `NULL` como iguales entre sí). CRUD
  completo en `routes/conceptos.ts` (`filaAFeriado`,
  `validarAmbitoFeriado`, `GET/POST/PUT/DELETE /api/conceptos/dias-feriados`),
  con bitácora, y una pantalla nueva ("Días feriados", tarjeta apilada
  en Configuración, mismo criterio que "Límites de tareo"/"Horario por
  proyecto" — el sub-menú de pestañas de Configuración sigue siendo la
  brecha #12, no reconstruido aquí). Semilla vacía: el usuario carga las
  fechas oficiales de cada año.
- **`obtenerFeriadosVigentes(periodoId, contratoId, fechaDesde, fechaHasta)`**
  (routes/planilla.ts): reemplaza los 2 stubs `const esFeriado = false`
  que habían dejado las secciones 28/29 — consulta `dias_feriados` con
  el emparejamiento ámbito↔ubicación del proyecto del periodo (un
  NACIONAL siempre cuenta; un REGIONAL/LOCAL solo si el proyecto tiene
  la ubicación UBIGEO configurada y coincide), acotado a la vigencia del
  contrato (`rangoVigenciaEnPeriodo`, `src/vigenciaContrato.ts` — nuevo
  módulo, faithful port del `dist`, con sus propias 16 pruebas en
  `tests/vigencia_contrato.test.ts`).
- **`agregarTareoDiario` reescrita por completo** (antes: solo sumaba
  horas por tipo de día): ahora, además, (a) acredita automáticamente
  el feriado NO laborado (D.Leg. 713, el feriado se paga se trabaje o
  no) para cada fecha del catálogo dentro del periodo que no tenga
  horas de "Feriado trabajado" cargadas ni una marca explícita de
  FALTA/SUBSIDIO/LICENCIA ese día — `dias_feriado` pasa a ser el TOTAL
  a pagar (trabajado + no laborado), y el nuevo `dias_feriado_trabajado`
  es el subconjunto SÍ trabajado (insumo de la sobretasa); y (b) arma,
  día por día, la lista cruda que necesita
  `calcularDiasDominicalProporcional` (agrupación lunes-a-domingo: un
  día feriado o con marca especial cuenta 8h fijas, un domingo
  trabajado excluye esa semana completa del prorrateo, una semana
  partida entre 2 periodos se prorratea sola porque cada periodo solo
  ve sus propios días).
- **`calcularDiasDominicalProporcional`/`calcularRemuneracionDominicalProporcional`/`calcularSobretasaDominical`/`calcularSobretasaFeriado`**
  (motorCalculo.ts, funciones puras nuevas): el prorrateo del descanso
  semanal (domingo) NO laborado y las 2 sobretasas legales (D.Leg. 713)
  por trabajar sin descanso sustitutorio — la sobretasa de feriado usa
  `dias_feriado_trabajado` (no `dias_feriado` total, que incluye días
  no laborados que no generan sobretasa).
- **`calcularGratificacion` con 2 denominadores por tramo** (antes:
  un solo denominador para todo el año, lo que pagaba de MENOS en
  agosto-diciembre — caso real confirmado con el usuario: contrato
  ALVAREZ CALDERON, periodo 08/2026, jornal 89.30, 17.01/día con el
  denominador viejo vs. 23.81/día real): ahora usa
  `factorDenominadorEneroJulio` (210, sin cambios) o
  `factorDenominadorAgostoDiciembre` (150, nuevo) según `mes >= 8`. Los
  "días computables" de Gratificación y de Asignación por Escolaridad
  ahora también incluyen `dias_dominical_no_laborado` (no lo hacían
  antes de esta migración).
- **`condicion_trabajo`** (D.S. 003-97-TR): monto FIJO mensual por
  contrato (columna nueva en `contratos`, editable desde el formulario
  de Trabajadores), copiado tal cual a cada boleta del periodo
  (`detalle_planilla.condicion_trabajo`) — no remunerativo, no se
  prorratea, no afecta ningún aporte ni se declara en el PLAME (todos
  sus `afecto_*` en `false` en `conceptos_planilla`).
- **3 conceptos nuevos sembrados en `conceptos_planilla`**
  (`SOBRETASA_DOMINICAL`, `SOBRETASA_FERIADO`, `CONDICION_TRABAJO`),
  todos con el interruptor `activo` (migración 039) ya funcionando
  desde el primer commit.
- **`planillaMensual.ts`**: el `INSERT INTO detalle_planilla_mensual`
  ahora persiste los 6 campos nuevos leyéndolos de `resultado.detalle`
  (antes quedaban en su `DEFAULT 0` de tabla, con una `NOTA` explícita
  de que `d` no los tenía todavía).

**Verificación:** `tsc --noEmit` limpio (backend y frontend, incluyendo
un `npm run build` completo de ambos). 449/449 tests (422 previos + 27
nuevos de `tests/dominical_feriado_condicion_trabajo.test.ts`:
Gratificación con el caso real ALVAREZ CALDERON en las 3 categorías de
obrero y en ambos tramos del año, `calcularDiasDominicalProporcional`
con semana completa/parcial/domingo trabajado/múltiples semanas,
sobretasas, y el CRUD completo de `dias_feriados` con sus reglas de
validación ámbito↔ubicación) — más 1 test nuevo en
`tests/dias_computables_construccion_civil.test.ts` (el dominical
proporcional no laborado SÍ entra a la fórmula de Escolaridad, a
diferencia del dominical SÍ trabajado) y actualizaciones a los
fixtures de `AsistenciaEntrada`/`Contrato` en 3 archivos de prueba que
ya anticipaban estos campos con una `NOTA (recon N/46)` explícita.

**Qué queda pendiente, fuera del alcance de esta migración puntual:**
- Brecha #4.1 (catálogo `conceptos_aportes` para códigos PLAME de
  descuentos/aportes) y brecha #5 (`asientoContable.ts`) — ambas
  reconstructibles desde el mismo `backend_dist` en una sesión futura,
  si el usuario lo pide.
- `avisosVigencia`/`avisosUbicacionFeriados` (`POST /:id/calcular`):
  el `dist` agrega 2 avisos puramente informativos (nunca bloquean el
  cálculo ni alteran un monto) — un contrato con tareo cargado fuera de
  su vigencia, y un feriado REGIONAL/LOCAL que no se aplicó a nadie
  porque el proyecto no tiene ubicación configurada. Se dejaron fuera
  de esta migración a propósito (UI/informativo, no afecta montos);
  candidatos para una mejora pequeña posterior si el usuario los quiere.
- Pantalla "Feriados" implementada como tarjeta apilada simple (sin el
  sub-menú de pestañas de Configuración, brecha #12 ya documentada) —
  funcional, pero no exactamente igual a como luce en producción real.
