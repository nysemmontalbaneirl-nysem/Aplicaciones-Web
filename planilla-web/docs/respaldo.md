# Respaldo automático de la base de datos

Genera una copia de la base de datos todos los días, sin que nadie tenga
que acordarse de hacerlo, y la guarda en dos lugares distintos a la PC
donde corre el sistema (nube + disco externo) — así una falla de disco,
un robo, o un incendio no se lleva también el historial de planillas.

## 1. Configurar los destinos (una sola vez)

Abre el archivo `.env` del proyecto (el mismo donde está `DB_PASSWORD`) y
agrega estas líneas, con tus rutas reales:

```
PG_DUMP_PATH=C:\Program Files\PostgreSQL\16\bin\pg_dump.exe
PG_RESTORE_PATH=C:\Program Files\PostgreSQL\16\bin\pg_restore.exe
BACKUP_DIR_NUBE=C:\Users\TU_USUARIO\Google Drive\Respaldos Planilla
BACKUP_DIR_EXTERNO=D:\Respaldos Planilla
BACKUP_RETENCION_DIAS=30
```

- **`PG_DUMP_PATH` / `PG_RESTORE_PATH`**: la carpeta donde quedó instalado
  PostgreSQL (la misma que usa pgAdmin). Si no la recuerdas, abre pgAdmin →
  clic derecho en el servidor → Properties → pestaña Connection, o busca
  en el explorador de Windows la carpeta `PostgreSQL\<versión>\bin`.
- **`BACKUP_DIR_NUBE`**: una carpeta dentro de tu Google Drive o OneDrive
  ya instalado en la PC (la app de escritorio la sincroniza sola, no hace
  falta subir nada a mano).
- **`BACKUP_DIR_EXTERNO`**: una carpeta en un disco externo o USB. Solo
  protege de verdad si ese disco se desconecta y se guarda en otro lugar
  después de cada respaldo — si se queda conectado siempre, un robo o
  incendio se lleva ambas copias.

## 2. Probar que funciona (antes de programarlo)

En PowerShell, parado en la carpeta del proyecto:

```powershell
npm run respaldo
```

Debe terminar con `Respaldo completado correctamente.` y vas a ver un
archivo `planilla_AAAA-MM-DD_HHmmss.dump` tanto en `respaldos/` (copia
local) como en las dos carpetas que configuraste. Si algo falla, el
mensaje de error te dice exactamente qué revisar.

## 3. Programarlo para que corra solo, todos los días

1. Abre el **Programador de tareas** de Windows (búscalo en el menú
   inicio como "Task Scheduler" o "Programador de tareas").
2. **Acción → Crear tarea básica...**
3. Nombre: `Respaldo Planilla JHCR`.
4. Desencadenador: **Diariamente**, a una hora en que la PC normalmente
   esté prendida (ej. 7:00 a.m., o justo después de que sueles cerrar el
   sistema al final del día).
5. Acción: **Iniciar un programa**.
6. En "Programa o script", busca y selecciona
   `scripts\respaldo.bat` dentro de la carpeta del proyecto.
7. Termina el asistente. Luego, en las Propiedades de la tarea ya creada
   (pestaña General), marca **"Ejecutar tanto si el usuario inició sesión
   como si no"** para que corra aunque no tengas una sesión de Windows
   abierta en ese momento.

Con esto, todos los días se genera un respaldo solo, sin que tengas que
acordarte.

## 4. Revisar que se sigue ejecutando (de vez en cuando)

Cada corrida deja una línea en `respaldos/respaldo.log` (dentro de la
carpeta del proyecto), con fecha y si salió bien o mal. Date una vuelta
por ahí de vez en cuando — un respaldo que falla en silencio durante meses
es lo mismo que no tener respaldo.

## 5. Si alguna vez hay que restaurar

Esto reemplaza TODOS los datos actuales de la base por los del archivo
elegido — solo úsalo si de verdad perdiste datos y necesitas recuperarlos.

```powershell
npm run restaurar -- "C:\ruta\al\planilla_2026-08-25_070000.dump" --si
```

El `--si` es obligatorio a propósito, para que nadie lo corra sin querer.
