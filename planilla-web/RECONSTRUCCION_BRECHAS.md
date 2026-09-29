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
