# Plan pendiente — Sistema de Planillas Web (JHCR)

Este documento complementa a `HISTORIAL_IMPLEMENTACIONES.md`: mientras ese
archivo cuenta lo que YA está en producción, este cuenta lo que ya se
**diseñó y confirmó con el usuario** pero todavía no se construyó.  La
idea es la misma — que quede escrito en el repositorio, no solo en el
historial de una conversación puntual — para que cualquier sesión futura
(de Claude o de cualquier otro desarrollador) pueda retomar el trabajo
exactamente donde quedó, sin tener que volver a levantar el teléfono para
reconfirmar decisiones que el usuario ya tomó.

Última actualización: 16 de septiembre de 2026.

---

## 1. Piso de EsSalud acumulado por mes calendario

### El problema

El aporte a EsSalud tiene un piso legal **mensual**: 9% de la Remuneración
Mínima Vital (con RMV = S/1130 en 2026, el piso es S/101.70). Hoy
`calcularEssalud` es simplemente `remuneracionAfecta × 9%`, sin piso — en
una quincena o semana con poca remuneración afecta, el sistema puede pagar
menos de lo que corresponde si se mira el mes completo.

### Diseño confirmado

- El sistema acumula el EsSalud ya calculado en los periodos previos del
  MISMO mes calendario para el mismo contrato, y solo en el **último
  periodo de ese mes** ajusta el monto para que el total del mes no quede
  por debajo del piso (si hubo al menos un día trabajado en el mes).
  Aplica igual a construcción civil y régimen general.
- **Regla de recálculo fuera de orden (Opción B, ya confirmada)**: cada
  cálculo solo escribe **su propia** boleta, nunca modifica boletas de
  otros periodos ya calculados. Si se recalcula un periodo anterior
  después de que un periodo posterior del mismo mes ya absorbió el
  ajuste, el sistema NO lo corrige solo — muestra un aviso pidiendo
  revisar el periodo posterior a mano (usando "Reabrir periodo", ya
  implementado, para corregirlo). Se prefirió esto sobre ajustar en
  cascada boletas de otros periodos ya calculados, que sería más
  "correcto" matemáticamente pero con efectos colaterales silenciosos
  sobre boletas que el usuario podría considerar cerradas.

### Cambios técnicos previstos

- Migración nueva: `ALTER TABLE detalle_planilla ADD COLUMN essalud_base
  NUMERIC(10,2) NOT NULL DEFAULT 0;` — `essalud` (columna existente) pasa
  a ser el monto FINAL (ya con el ajuste de piso si corresponde), y
  `essalud_base` es el monto SIN ajuste, necesario para poder recalcular
  el acumulado del mes sin arrastrar ajustes de cálculos anteriores.
- `motorCalculo.ts`: función pura `calcularEssaludConPiso(essaludBaseActual,
  essaludBaseOtrosPeriodosDelMes, esUltimoPeriodoDelMes, huboTrabajoEnElMes,
  pisoMensual)` → `{essaludFinal, ajuste}`. El piso mensual se calcula al
  vuelo (`remuneracion_minima_vital × tasa_essalud`, ambos ya existentes en
  `parametros_normativos`), sin columna nueva.
- `routes/planilla.ts`: nueva función `ajustarPisoEssaludDelMes` que
  consulta `detalle_planilla JOIN periodos_planilla` por contrato y mes
  calendario (usando `periodos_planilla.fecha_fin` para decidir a qué mes
  se atribuye el periodo, incluso si la Ronda 3 —cruce de mes, ya
  implementada— lo partió en tramos internamente), determina si este es
  el último periodo del mes, y ajusta `essalud`/`essalud_base` antes del
  INSERT. Si detecta un periodo posterior ya calculado, agrega un aviso
  `avisos_essalud` a la respuesta de `/calcular`.

### Supuesto pendiente de confirmar al implementar

Si un periodo se partió en 2 tramos de mes distintos (Ronda 3), este
diseño atribuye TODO el EsSalud del periodo a un solo mes calendario (el
de `fecha_fin`), en vez de desglosarlo entre los 2 meses reales del
tramo — una separación exacta obligaría a que `detalle_planilla` (una
fila por periodo, no por tramo) guarde 2 montos de EsSalud por separado.
Se recomienda esta simplificación, pero debe confirmarse explícitamente
con el usuario en el momento de implementar esta ronda (no se ha hecho
todavía).

### Pruebas previstas

Mes con 2 quincenas y remuneración afecta baja en ambas → la segunda
absorbe el ajuste y el total del mes da exactamente S/101.70. Mes ya por
encima del piso en la primera quincena → la segunda no agrega ajuste.
Contrato sin ningún día trabajado en el mes → no se fuerza el piso.
Recálculo fuera de orden (calcular Q2 primero, luego recalcular Q1) → Q1
no absorbe nada y aparece `avisos_essalud`. Aplica igual a una categoría
de construcción civil (PEON) y una de régimen general (EMPLEADO) en el
mismo mes.

---

## 2. Conceptos con fórmula propia ("Ronda D")

Es, por lejos, la mejora más grande y riesgosa de las pendientes — un
motor de fórmulas nuevo que toca Configuración, el motor de cálculo, el
asiento contable y el PLAME a la vez. Se benefició de una revisión de
código previa (RBAC/permisos, estructura de `conceptos_planilla`) y de
varias rondas de preguntas al usuario, todas ya respondidas. **No se ha
escrito ni una línea de código todavía**: todo lo de abajo es diseño
confirmado en conversación, pendiente de construir.

### Motivación del usuario

Que los procedimientos de cálculo de ingresos, descuentos y aportes no
queden únicamente en código interno (dependencia de un programador si
falla algún cálculo), sino que un administrador que conoce las fórmulas
pueda crearlas/editarlas desde una pantalla de Configuración.

### Decisiones confirmadas con el usuario, una por una

1. **No es una reestructuración del sistema.** Es aditivo: convive con los
   14+ conceptos hardcodeados actuales (que siguen funcionando exactamente
   igual, sin fórmula) y solo aplica a conceptos NUEVOS que el usuario cree
   desde Configuración.
2. **Sintaxis de fórmula**: texto libre tipo Excel (ej. `jornal_diario *
   dias_trabajados * 0.09`), no un constructor de menús — más natural para
   un contador acostumbrado a fórmulas de hoja de cálculo.
3. **Seguridad — clave secundaria propia (elegida entre varias opciones)**:
   toda creación/edición/eliminación de un concepto con fórmula exige una
   clave secundaria independiente del usuario y del rol — **incluso el
   ADMIN la necesita, sin excepción**. Motivo técnico real encontrado al
   revisar el código: el rol ADMIN lleva un permiso comodín (`"*"`) que
   pasa automáticamente CUALQUIER chequeo de permiso normal
   (`requierePermiso`, en `src/authMiddleware.ts`), así que un permiso
   nuevo del catálogo de Roles no habría restringido a un ADMIN. Por eso
   se optó por un mecanismo aparte, no por el sistema de roles/permisos ya
   existente.
4. **Habilitar/deshabilitar concepto**: si un concepto con fórmula queda
   mal creado, se puede desactivar sin borrarlo (para no perder su
   historial de montos ya calculados).
5. **Elegir el tipo de concepto al crearlo**: "Fórmula propia" (el usuario
   la escribe y la sistema valida) o "Requiere programación interna" (crea
   una fila de catálogo en estado `PENDIENTE_DESARROLLO`, visible pero
   inactiva, y se le pide al programador/Claude que la implemente en
   código basándose en documentación legal — ej. el Convenio Colectivo o
   una norma SUNAFIL/SUNAT).
6. **CRUD completo** con reglas de borrado: si un concepto personalizado
   nunca se usó en ningún cálculo, se puede eliminar de verdad; si ya se
   usó, solo se puede deshabilitar (nunca se pierde el historial).
7. **Aviso de posible duplicado contra el catálogo SUNAT**: al crear un
   concepto nuevo, el sistema compara su nombre/descripción contra el
   catálogo oficial `docs/tabla22_plame.json` (Anexo 22 de SUNAT, ya
   guardado en el repo) y contra los conceptos ya existentes, mostrando
   una advertencia (no un bloqueo duro) si encuentra un parecido cercano.
8. **3 campos de fecha/estado por concepto, confirmados explícitamente por
   el usuario ("me parece bien 3 campos")**:
   - `creado_en`: marca de tiempo automática, informativa.
   - `vigente_desde` / `vigente_hasta`: ventana de validez LEGAL, que se
     verifica contra la fecha del PERIODO que se está calculando (no
     contra "hoy") — esto es clave para que recalcular un periodo antiguo
     ya reabierto (función "Reabrir periodo", ya implementada) siga usando
     las reglas vigentes en ese momento, aunque hoy ya haya una fecha de
     derogación posterior.
   - `activo`: interruptor administrativo inmediato (independiente de las
     fechas), para errores humanos o de fórmula — afecta solo los cálculos
     desde "ahora" en adelante. Se recomendó restringir este campo a
     conceptos personalizados únicamente (los 14+ conceptos originales no
     lo necesitan) — **esta restricción específica quedó propuesta, sin
     confirmación explícita final del usuario** al momento de escribir
     este documento.

### Ejemplos de fórmula ya validados con el usuario (para no reinterpretarlos)

- **CTS**: `(Jornal Básico + Descanso Médico) × Factor(15%)` — coincide
  exactamente con la fórmula ya programada en código para CTS de
  construcción civil (migración 032), así que sirve como caso de prueba
  cruzado entre el cálculo hardcodeado y lo que debería dar el motor de
  fórmulas si alguien lo reimplementara ahí.
- **Escolaridad**: el usuario inicialmente propuso un divisor estacional
  (7 en enero-julio, 5 en agosto-diciembre, igual que Gratificación) pero
  se autocorrigió: **Escolaridad usa un divisor fijo de 12 todo el año**,
  sin relación con el divisor estacional de Gratificación. No se toca el
  código existente por este tema — ya está bien.

### Diseño técnico (motor de fórmulas y almacenamiento)

- **Librería de evaluación**: `expr-eval` (sin `eval`/`new Function`, sin
  acceso a nada del sistema — solo aritmética/comparaciones con variables).
  Alternativa considerada: `mathjs` (más pesada, más funciones) — decidir
  cuál exactamente al implementar.
- **Variables expuestas a la fórmula** (lista blanca explícita, congelada
  en el momento de implementar, documentada en pantalla): `jornal_diario`,
  `dias_trabajados`, `dias_dominical`, `dias_dominical_no_laborado`,
  `dias_feriado`, `dias_feriado_trabajado`, `dias_falta`,
  `dias_subsidio_enfermedad`, `dias_subsidio_enfermedad_computable` (el
  campo con tope de 60 días agregado en la migración 032),
  `dias_subsidio_maternidad`, `dias_licencia_paternidad`, `horas_extra_25`,
  `horas_extra_35`, `horas_extra_100`, `sueldo_basico`,
  `remuneracion_computable`, `numero_hijos`, `uit`,
  `remuneracion_minima_vital`, y los 3 factores propios del concepto
  (`factor1`, `factor2`, `factor3`, ya existen en el catálogo). No se
  expone el objeto completo de `Contrato`/`AsistenciaEntrada` por
  seguridad y simplicidad.
- **Nueva tabla `detalle_planilla_conceptos`** (para no agregar una
  columna nueva en `detalle_planilla` por cada concepto — inviable para
  un catálogo abierto): `id SERIAL, detalle_id INT REFERENCES
  detalle_planilla(id) ON DELETE CASCADE, concepto_codigo VARCHAR(60)
  REFERENCES conceptos_planilla(codigo), monto NUMERIC(10,2) NOT NULL,
  UNIQUE(detalle_id, concepto_codigo)`. Los conceptos ya existentes
  (hardcodeados) NO usan esta tabla, siguen con sus columnas propias — se
  acepta esta inconsistencia (2 mecanismos según el origen del concepto)
  para no arriesgar romper el cálculo de los conceptos ya en producción.
- **`conceptos_planilla` gana columnas nuevas**: `tipo` (`INGRESO` /
  `APORTE` / `DESCUENTO`), `formula` (TEXT, NULL para los conceptos
  originales), `es_personalizado` (boolean), más las 3 de fecha/estado del
  punto 8 de arriba.
- **Rutas nuevas** en `routes/conceptos.ts`: `POST /` (crear, valida
  sintaxis y variables de la fórmula con `expr-eval` antes de guardar),
  `PUT /:codigo` (editar, solo permite tocar `formula` si
  `es_personalizado = true`), `DELETE /:codigo` (solo si nunca se usó en
  `detalle_planilla_conceptos`) — todas exigiendo la clave secundaria del
  punto 3.
- **`motorCalculo.ts`**: al final de `calcularLineaPlanilla`, un loop
  nuevo evalúa la fórmula de cada concepto personalizado activo y vigente
  para la fecha del periodo, usando las variables expuestas, y devuelve
  los montos para que la ruta de `/calcular` los guarde en
  `detalle_planilla_conceptos`.
- **`asientoContable.ts` y `plame.ts`**: cada uno gana un loop genérico
  adicional (junto a su lógica hardcodeada actual) que recorre
  `detalle_planilla_conceptos` y aplica el mismo mecanismo de mapeo de
  cuenta contable / código PLAME ya usado para los demás conceptos.
- **`frontend/Configuracion.tsx`**: botón "Agregar concepto" con
  formulario (código, nombre, tipo, fórmula con ejemplo de sintaxis y
  lista de variables visible, los 7 flags `afecto_*`, código PLAME
  opcional, fechas de vigencia, activo/inactivo). Si el backend rechaza la
  fórmula, se muestra el error de sintaxis de `expr-eval` tal cual (ya es
  suficientemente claro).

### Pruebas previstas

Crear un concepto con fórmula válida → aparece en
`detalle_planilla_conceptos` con el monto correcto tras calcular; fórmula
con variable inexistente o sintaxis inválida → rechazada al guardar;
intentar poner `formula` en un concepto NO personalizado (ej.
`GRATIFICACION`) → rechazado; concepto con `afecto_essalud = true` → su
monto sí entra a la base de EsSalud; aparece en el asiento contable (con
mapeo de cuenta sembrado) y en el PLAME si tiene código; acción sin la
clave secundaria → rechazada aunque el usuario sea ADMIN; concepto con
`vigente_hasta` en el pasado respecto a la fecha del periodo que se
calcula → no se aplica (pero si el periodo es de una fecha anterior a esa
derogación, sí se aplica); aviso de duplicado contra Anexo 22 al crear un
concepto con nombre parecido a uno ya existente.

### Orden recomendado de implementación (no vinculante, se puede revisar)

1. Migración de columnas/tabla nuevas.
2. Motor de fórmulas + validación de sintaxis (sin UI todavía, solo
   backend + pruebas unitarias).
3. CRUD de conceptos personalizados (rutas + clave secundaria).
4. Integración con `calcularLineaPlanilla` + asiento contable + PLAME.
5. Frontend (Configuración).
6. Aviso de duplicado contra Anexo 22 (puede ir al final, es aditivo).

---

## Cómo se mantiene este documento

Igual que `HISTORIAL_IMPLEMENTACIONES.md`: cuando el usuario confirme un
cambio de diseño sobre estas 2 rondas, se actualiza este archivo antes de
seguir conversando — así ninguna decisión queda solo en el historial de
una conversación puntual. Y cuando una de estas rondas se termine de
implementar y desplegar, su sección se **mueve** de este archivo a
`HISTORIAL_IMPLEMENTACIONES.md` (ya no es "pendiente", pasa a ser
historia real).
