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

## Cómo se mantiene este historial

Cada vez que se implemente y despliegue una mejora nueva, se agrega una
sección o un párrafo nuevo a este archivo (al final), describiendo en
lenguaje simple qué cambió y por qué. Como este archivo vive dentro del
mismo repositorio del sistema, queda guardado de forma permanente junto con
el código, y cualquier sesión de trabajo futura puede abrirlo para saber
exactamente en qué quedó el sistema sin depender de recordar conversaciones
anteriores.
