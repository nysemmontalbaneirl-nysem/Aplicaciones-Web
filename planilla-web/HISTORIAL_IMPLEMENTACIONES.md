# Historial de implementaciones — Sistema de Planillas Web (JHCR)

Este documento resume, en orden cronológico y en lenguaje sencillo, todo lo que
se ha construido y corregido en el Sistema de Planillas Web desde su inicio.
Se basa en el historial real de cambios del código (cada entrega quedó
registrada como un cambio versionado), así que es un registro confiable de lo
que realmente está implementado en el sistema, no solo de lo que se conversó.

La idea es mantener este archivo actualizado: cada vez que se termine una
mejora nueva y se despliegue a producción, se agrega un párrafo aquí antes de
cerrar esa entrega. Así, en cualquier momento futuro (aunque sea en una
conversación distinta) se puede abrir este archivo y saber exactamente qué
tiene el sistema y en qué orden se fue construyendo, sin depender de recordar
conversaciones pasadas.

## Construcción del sistema base (22 de agosto de 2026)

En un solo día se construyó la primera versión funcional completa: el backend
en Node.js/TypeScript/Express con base de datos PostgreSQL, y el frontend en
React. Desde el inicio quedaron cubiertos el alta y edición de trabajadores
(datos personales y de contrato), el cálculo de planilla con gratificación y
CTS proporcional a la antigüedad real de cada trabajador, la vista de boleta
de pago calcada del formato original en Excel, el módulo de parámetros
normativos (tasas AFP y tabla salarial de construcción civil, editables sin
tocar código), la exportación de los archivos oficiales REM (PLAME) y el CSV
para AFPnet, y la carga masiva de trabajadores y de tareo por CSV. Ese mismo
día también se corrigieron varios detalles de cálculo (horas extra, columnas
de ubigeo y cuenta bancaria, límite de tamaño de archivos subidos, y un bug
que permitía crear dos veces el mismo periodo mensual).

## Afinamiento del cálculo y de la navegación (24-25 de agosto)

Se corrigieron varios puntos finos del cálculo de planilla que solo se notan
al comparar con boletas reales: la gratificación y CTS pasaron a calcularse
siempre sobre el sueldo de un mes completo (no el del periodo parcial), se
separó el cálculo de errores por trabajador para que un dato malo en una fila
no tumbe el cálculo de toda la planilla, y se corrigió que un error
inesperado ya no derribe el servidor completo. Se reorganizó la navegación
separando Tareo, Cálculo y Boletas en pestañas distintas, se agregó la
pestaña de Reportes con resumen exportable a Excel, se implementó el login
real con proyectos y datos de la empresa, permisos por proyecto (roles
RESPONSABLE_PLANILLA y TAREADOR), y se reemplazó la navegación por pestañas
horizontales por un menú lateral con submenús. También se agregaron la vista
previa del reporte y la impresión de boletas por bloques.

El día 25 se hizo una revisión profunda del cálculo de construcción civil
contra boletas reales: se reprogramó cómo se calculan gratificación, CTS y
vacaciones para ese régimen, se corrigió la comisión de AFP (la comisión de
flujo solo debía aplicar a afiliados en esa modalidad), se reclasificó la
póliza de vida ley de un descuento del trabajador a un aporte del empleador,
se puso la cuota sindical con la tarifa real de cada proyecto, se corrigió
que la gratificación de construcción civil calculara el factor diario en vez
de leerlo de un campo aparte, se corrigió que los días del periodo estaban
fijos en 30 en vez de calcularse de las fechas reales, y la asignación
familiar de Empleados pasó a calcularse como el 10% de la RMV vigente en vez
de un monto fijo. Se agregó también el módulo de récord vacacional para
Empleados y su boleta de vacaciones por separado, la Tabla 22 de PLAME de
SUNAT como referencia, correcciones a las bases de cálculo de SENATI y Renta
de 5ta categoría, la pestaña de Configuración (afectación y factores
editables por concepto de planilla), y una barra superior con los datos de
la empresa y el usuario conectado.

## Seguridad, respaldo y auditoría (26-27 de agosto)

Se reforzó la seguridad del sistema: restricción de CORS por dominio, freno
anti fuerza bruta en el login, respaldo automático de la base de datos (a la
nube y a disco externo), activación de la bitácora de auditoría, corrección
de dos rutas que no verificaban el rol del usuario (con pruebas automatizadas
nuevas para evitar que se repita), el módulo de roles configurables (el
Administrador define qué puede hacer cada rol desde una pantalla de
checklist de permisos), y la corrección de dos vulnerabilidades de seguridad
detectadas en una librería usada por el sistema (exceljs/uuid).

## Panel de inicio, envío de boletas y despliegue a producción (28 de agosto)

Se agregó la pantalla de Inicio (dashboard) con el resumen del negocio de un
vistazo, y el envío de boletas por correo electrónico (con la opción de
elegirlas desde ADMIN o desde el Encargado de planilla). El resto del día se
dedicó a preparar el sistema para vivir en un hosting real: ajustes para que
funcionara fuera de localhost, mover TypeScript y los paquetes de tipos a
dependencias de producción, definir que la compilación se hace en la
computadora del usuario y se sube ya lista (no en el servidor), y que el
mismo backend sirva directamente los archivos del frontend. Este trabajo dejó
listo el camino para el primer despliegue real en BlueHosting.

## Corrección de EVENTUAL, imagen corporativa y catálogos SUNAT (29-30 de agosto)

Se corrigió el cálculo de planilla para la categoría EVENTUAL y se agregó el
logo de JHCR Recursos Humanos a la pantalla de login. Después se hizo un
trabajo de investigación y modernización importante: se recuperó y analizó
el sistema Excel/VBA legado de la empresa (workbook maestro "Estructuras
Plame - Trabajadores" y el archivo TABLA22.xls) para comparar sus reglas
contra el sistema nuevo, se agregó el Anexo 2 completo de tablas paramétricas
de SUNAT (37 tablas) y un análisis formal de los campos que exige el
T-Registro de SUNAT frente a lo que ya tenía el sistema. Con esa base se
implementaron los catálogos oficiales SUNAT y los campos de T-Registro
faltantes (migración de base de datos, rutas del backend, y los desplegables
correspondientes en la pantalla de alta de trabajador).

## Plantilla de carga masiva, altas y bajas, navegación (30-31 de agosto)

Se fueron sumando las columnas de T-Registro (opcionales) a la carga masiva
de trabajadores por CSV, se agregó la plantilla de Excel descargable para
esa carga masiva con una fila de ejemplo resaltada, se agregó mostrar/ocultar
la contraseña en el login y en el cambio de contraseña, una alerta cuando se
intenta crear un contrato duplicado, el historial de periodos de un
trabajador y el reingreso rápido, y la posibilidad de cesar (dar de baja)
trabajadores directamente desde la carga masiva.

El 31 de agosto se sumaron el filtro Hábiles/Cesados/Todos y la exportación a
Excel/PDF en la pantalla de Trabajadores, la columna de Total de aportes y su
exportación en Boletas, la constancia de vacaciones en PDF por trabajador (y
la corrección de que los PDF salían amontonados, ajustando la altura de fila
y poniendo la constancia en horizontal), una mejora de navegación (buscador y
lista primero en Trabajadores, barra de accesos rápidos fija en Trabajadores,
Tareo y Boletas), y la posibilidad de corregir o anular un cese ya registrado
(cambiar la fecha/motivo, o revertirlo a HABIL).

## Tareo diario y periodos semanales (31 de agosto)

Se agregó el registro de Tareo Diario por trabajador y por día: una pantalla
nueva donde se marca, día por día, el jornal normal, si se trabajó un domingo
o un feriado, hasta tres tramos de horas extra (con el porcentaje correcto
según sea construcción civil o régimen general), y días especiales (falta,
subsidio por enfermedad, subsidio por maternidad, licencia por paternidad) de
forma informativa por ahora. Cada guardado recalcula automáticamente los
totales de asistencia del periodo, sin afectar el motor de cálculo existente
ni la carga masiva por Excel.

En el mismo día se habilitó la creación de periodos quincenales desde la
pantalla de Periodos (con fechas de inicio/fin editables, no fijas en
1-15/16-fin) y se agregó un tercer tipo de periodo, semanal, pensado para
pagar a los obreros de jornal de construcción civil hasta 4 veces al mes con
fechas libres según lo acuerde cada obra. El personal de régimen general
(EMPLEADO) se mantiene siempre en periodo mensual. Se agregó además un aviso
informativo (sin afectar ningún monto) cuando un trabajador de régimen
general queda por error en un periodo no mensual.

## Interfaz: barra lateral colapsable y encabezados fijos (1 de septiembre)

Se agregó la posibilidad de colapsar la barra lateral a solo iconos (para
ganar espacio de pantalla en tablas largas como el Tareo Diario), y se
hicieron fijos (sticky) los encabezados de todas las tablas largas del
sistema, para no perder de vista los títulos de columna al desplazarse hacia
abajo.

## Corrección de la carga masiva y plantilla con macro (3 de septiembre)

Se diagnosticó y corrigió un error real reportado en producción: Excel, en
computadoras configuradas en español/Perú, exporta el CSV separado por punto
y coma aunque se elija la opción "CSV UTF-8 (delimitado por comas)", lo que
hacía fallar la importación con un mensaje de "DNI vacío o inválido" aunque
el dato estuviera bien escrito. Se corrigió de raíz agregando una detección
automática del separador real del archivo, así que ya no importa qué opción
de guardado elija Excel. De paso, se mejoró la plantilla descargable: ahora
trae una hoja de "Instrucciones", el encabezado de las columnas obligatorias
resaltado en rojo (y las condicionales en naranja, con una nota al pasar el
mouse), y una hoja "Macro (opcional)" con el código y la guía paso a paso
para quien quiera un botón en Excel que valide los datos y exporte el CSV ya
listo para subir, con la fecha del día agregada al nombre del archivo para
llevar control de las cargas.

## Catálogo contable, panel de errores y reorganización de pantallas (6 de septiembre)

Se agregó el catálogo contable completo: código PLAME editable por concepto
(antes venía fijo en el código), un catálogo de aportes patronales y
retenciones, un Plan de Cuentas editable (275 cuentas reales, sin
restricción de unicidad en el código), un mapeo contable (concepto ×
proyecto → cuenta) y un reporte nuevo "Descargar Asiento Contable (Excel)"
que arma el asiento consolidado de un periodo (ingresos, aportes
patronales, retenciones y neto a pagar), validando primero que toda cuenta
necesaria esté mapeada.

Se agregó también una pantalla de "Errores del sistema" para el
administrador: cada error inesperado (500) queda registrado
automáticamente con fecha, usuario, ruta, mensaje y detalle técnico,
visible y marcable como resuelto desde una pantalla propia — ya no hace
falta buscar el log del servidor en cPanel para saber qué pasó.

El resto del día se dedicó a reorganizar pantallas que habían crecido
demasiado: Configuración pasó a tener 3 sub-pestañas (Conceptos de ingreso
/ Aportes y retenciones / Plan de cuentas) y Parámetros 2 (Valores anuales
/ Tasas mensuales), ambas antes apiladas en una sola pantalla larga. Se
amplió también el ancho útil de pantalla (de 1200 a 1600 píxeles, para que
tablas con muchas columnas como el Tareo Diario necesiten menos scroll
horizontal) y se corrigió que el Tareo Diario mostrara la fecha "cruda" de
la base de datos en vez de un formato legible.

## Filtro por proyecto y certificado de tareo especial (7 de septiembre)

Se agregó un filtro exacto por proyecto/obra en Trabajadores (además del
filtro por estado), que también se aplica automáticamente a las descargas
en Excel/PDF. En el Tareo Diario, cuando un día se marca como Subsidio por
enfermedad, Subsidio por maternidad o Licencia por paternidad, ahora se
puede adjuntar una foto del certificado médico correspondiente (guardado
en la base de datos, no como archivo suelto, para que sobreviva a los
despliegues). También se ensancharon los campos de horas/minutos de la
grilla para que sea más fácil escribir un número de 2 cifras.

## Sobretasa por feriado/dominical y unificación del Tareo (8 de septiembre)

Se investigó a fondo la obligación legal de pagar una sobretasa (recargo)
cuando se trabaja un feriado o un domingo sin descanso sustitutorio, y se
implementó: un feriado trabajado paga el día normal más una sobretasa del
100%, y si el feriado simplemente no se trabaja igual se le paga al
trabajador (por ley tiene derecho a que se le cancele). Para esto se
agregó una tabla nueva de "Días feriados" (editable desde Configuración,
para que el usuario cargue las fechas de cada año) y dos conceptos nuevos
(sobretasa por feriado y sobretasa dominical), ambos declarados en el
PLAME bajo el código 0107. Se corrigió además, al día siguiente de
desplegarlo, que faltaba un permiso (GRANT) sobre la tabla nueva — un
problema ya conocido de este proyecto (el usuario de la aplicación y el
que corre las migraciones son roles distintos en PostgreSQL).

También se unificaron en un solo menú, con pestañas, las 2 pantallas que
antes vivían separadas ("Tareo" por Excel/mano y "Registrar Tareo Diario"
día por día), y el buscador de trabajador en Tareo Diario pasó a mostrar
siempre la lista completa (filtrable por proyecto y texto) en vez de
exigir escribir 2+ caracteres.

## Reabrir periodo y dominical proporcional (9 de septiembre)

Arrancó la implementación del plan de 4 mejoras sobre el cálculo de
planilla que el usuario fue confirmando en detalle con casos reales
(contrato ALVAREZ CALDERON). Primero (Ronda 1, la de menor riesgo): la
posibilidad de reabrir un periodo ya CALCULADO para corregirlo, sin perder
el Tareo Diario ya cargado — antes la única forma de corregir un periodo
cerrado era eliminarlo entero y volver a cargar todo desde cero.

Después (Ronda 2): el "dominical proporcional". El sistema ya pagaba el
domingo cuando se trabajaba, pero no cubría el caso contrario — un
trabajador que completa su semana de lunes a sábado pero no trabaja el
domingo también tiene derecho, por el D.Leg. 713, a un pago proporcional
de ese descanso. Se implementó agrupando el Tareo Diario por semana
calendario y aplicando la fórmula exacta que el usuario confirmó con su
propio ejemplo real, incluyendo el caso de una semana partida entre 2
periodos consecutivos (el sistema prorratea automáticamente).

De paso se corrigió un bug real de producción: guardar horas de feriado
que no fueran múltiplo de 8 (por ejemplo, 9 horas) fallaba con un error de
base de datos por una diferencia sutil entre cómo Postgres infiere el
tipo de un parámetro con valor de respaldo.

## Ajustes finos al dominical proporcional y a la gratificación (10 de septiembre)

Probando en producción el dominical proporcional recién entregado,
aparecieron varios ajustes en cadena el mismo día: la boleta en pantalla
no mostraba el monto (aunque el backend ya lo calculaba bien), se decidió
fusionarlo con "Remuneración dominical" en vez de mostrarlo como un
concepto aparte (evita configurar una cuenta contable extra para algo
idéntico), y se corrigió un "S/ NaN" causado por sumar 2 columnas que
Postgres entrega como texto sin convertirlas primero a número.

También se revisó la gratificación de construcción civil contra el Excel
de referencia del usuario y se encontraron 2 errores: el denominador (40
jornales entre 210 o 150 días, según el tramo del año) estaba fijo en 210
todo el año, pagando de menos en los periodos de agosto a diciembre; y
los "días computables" no sumaban el dominical proporcional ni los días
de subsidio/licencia ya cargados en el Tareo Diario. Ambos se corrigieron.
Por último, se corrigió que el aporte "Essalud + Vida" leía una casilla
equivocada del contrato (una distinta a la que realmente correspondía),
por lo que nunca se calculaba aunque estuviera marcada.

## Corrección de "Remuneración feriado" en S/0.00 (11 de septiembre)

Se corrigió un caso real donde un feriado no laborado no se acreditaba
porque el Tareo Diario, al pre-llenar automáticamente todas las fechas del
periodo, dejaba una fila "en cero" (no una fila ausente) para los días
que nadie trabajó — y el sistema solo reconocía como "no laborado" la
ausencia total de fila, no una fila con todo en cero.

## Condición de Trabajo, vigencia del contrato y boleta más clara (13 de septiembre)

Arrancó la implementación de las "4 mejoras grandes" pedidas por Claudia
(RRHH del cliente JHCR). Primero (Ronda A): "Condición de Trabajo" pasó a
pagarse de verdad en la boleta (a diferencia de "Viáticos", que es solo
informativo) sin afectar ningún aporte ni descuento ni el PLAME, por ser
un concepto no remunerativo.

Se corrigió también, a pedido explícito del usuario, un vacío importante:
el sistema permitía registrar tareo para un contrato en fechas anteriores
a su ingreso o posteriores a su cese. Ahora esos contratos ni siquiera
aparecen como opción fuera de su vigencia, y cualquier intento de cargar
datos fuera de esas fechas se rechaza (aceptando igual el resto del
periodo cuando el traslape es solo parcial).

Por último (Ronda B, segunda parte): la boleta pasó a mostrar el rango
exacto de fechas del periodo (y la quincena, si aplica) en vez de solo
"mes/año", se agregó el logo de la empresa, y una sección puramente
informativa de "Días considerados en este período" (feriado, descanso
médico, licencia) — sin ser todavía un pago, solo para que el trabajador
y el área de RRHH tengan visibilidad.

## Impresión, periodos por proyecto y correcciones de descuentos (14 de septiembre)

Se hicieron 4 ajustes de impresión pedidos por el usuario (título
centrado, sin la fecha/hora que agrega el navegador al imprimir, la caja
de días informativos debajo de los datos laborales, y los títulos de
sección en azul), y se corrigió un bug real donde una boleta con muchos
conceptos de ingreso salía en 3 hojas en el PDF enviado por correo (se
pasó de una sola columna a 3 columnas lado a lado, igual que en pantalla).

Se entregó la Ronda C del plan de 4 mejoras: cada periodo nuevo ahora
pertenece a un proyecto específico (los periodos ya existentes quedan
como "legado/todos los proyectos" para siempre), con la posibilidad de
editar un periodo aún abierto, y validaciones para que no se mezcle tareo
de un proyecto distinto al del periodo.

También se corrigieron 3 errores reales en descuentos y aportes: la cuota
sindical pasó a poder configurarse por proyecto Y categoría (antes un
solo monto por proyecto), el aporte "Essalud + Vida" se empezó a
prorratear correctamente según el tipo de periodo (antes se cobraba el
monto mensual completo incluso en una quincena), y se corrigió que el BUC
no debía formar parte de la base del Fondo de Capacitación SENATI. Por
último, la boleta pasó a mostrar las horas extra por tramo y la fecha de
cese, y se agregó la descarga de boletas en PDF (todas juntas) o en ZIP
(una por trabajador).

## Pago real del descanso médico y firma digital en la boleta (15 de septiembre)

Día de mucho volumen. Se cambió el tratamiento del descanso médico por
enfermedad y la licencia por paternidad: antes solo se mostraban de forma
informativa, ahora se pagan de verdad, valorizados igual que un día
normal trabajado. El descanso médico por enfermedad se paga hasta 20 días
al año por contrato (a cargo del empleador); desde el día 21 el sistema
bloquea el registro, porque ese subsidio pasa a ser pagado directamente
por EsSalud, fuera de planilla. La licencia por paternidad se paga sin
tope de días. El descanso médico por maternidad se mantiene informativo
(lo paga EsSalud desde el primer día).

Se corrigió también un bug real donde las líneas en S/0.00 no se ocultaban
en la boleta (una comparación de texto contra número que nunca
funcionaba), se agregó la posibilidad de subir el logo de la empresa y la
firma escaneada de cada trabajador (y, a pedido del usuario en la misma
ronda, también la firma del empleador y el nombre de su representante
legal) para que aparezcan en la boleta y en los reportes, y ese mismo
logo pasó a usarse también en la pantalla de Login. Se corrigieron además
2 problemas de maquetación del PDF (el bloque de firmas podía cortarse
entre la imagen y el texto, y la boleta completa podía salir en 2 hojas
al imprimir desde el navegador) hasta dejarla en 1 sola hoja de forma
confiable.

Se agregó una validación para que el Tareo Diario rechace con un mensaje
claro un valor de horas/minutos que no sea un número entero válido (antes
producía un error crudo de base de datos). Y se entregaron 2 mejoras más
del plan de cálculo: la Ronda 3 (un periodo quincenal/semanal que cruza
de mes calendario ahora se parte automáticamente en tramos, usando la
tabla salarial y las tasas AFP correctas de cada mes) y una corrección
para que Vacaciones, CTS y Asignación por Escolaridad de construcción
civil también sumen los días de descanso médico dentro de sus "días
computables" (Gratificación ya lo hacía desde antes) — con un tope de 60
días al año, verificado contra un caso real que el propio usuario aportó
(trabajador ARTEAGA CARCAMO).

## Material de consulta legal: Convenio Colectivo 2026 (16 de septiembre)

Se guardó en el repositorio, como material de consulta permanente, la
"Cartilla de Derechos Laborales del Régimen Especial en Construcción
Civil — Convenio Colectivo por Rama de Actividad 2026", publicada por la
FTCCP (el sindicato que negocia el convenio con CAPECO). Contiene, con su
base legal exacta, los jornales básicos vigentes, gratificación, CTS,
asignación escolar, BUC, BAE y las demás bonificaciones — confirma varias
de las reglas ya implementadas (por ejemplo, el tope de 60 días de
descanso médico en gratificación/CTS/vacaciones).

## Lo que está diseñado pero todavía NO está implementado

Para que quede constancia y nada se pierda: además de todo lo de arriba
(ya en producción), hay 2 mejoras completamente diseñadas y confirmadas
con el usuario, pendientes de construir. El detalle técnico completo de
ambas está en `PLAN_PENDIENTE.md`, en este mismo repositorio:

- **Piso de EsSalud acumulado por mes calendario**: hoy el aporte a
  EsSalud no aplica el piso legal mensual (9% de la RMV) cuando la
  remuneración afecta de una quincena/semana es baja.
- **Conceptos con fórmula propia** (a pedido de Claudia, RRHH de JHCR):
  permitir crear conceptos nuevos de ingreso/aporte/descuento con una
  fórmula tipo Excel (sin tocar código), protegidos por una clave
  secundaria propia, con aviso de posible duplicado contra el catálogo
  SUNAT Anexo 22, opción de habilitar/deshabilitar cada concepto, fecha
  de creación y vigencia, y la posibilidad de elegir "requiere
  programación interna" en vez de fórmula propia.

## Cómo se mantiene este historial

Cada vez que se implemente y despliegue una mejora nueva, se agrega una
sección o un párrafo nuevo a este archivo (al final), describiendo en
lenguaje simple qué cambió y por qué. Como este archivo vive dentro del
mismo repositorio del sistema, queda guardado de forma permanente junto con
el código, y cualquier sesión de trabajo futura puede abrirlo para saber
exactamente en qué quedó el sistema sin depender de recordar conversaciones
anteriores.
