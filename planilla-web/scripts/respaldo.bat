@echo off
REM Doble clic para probar el respaldo a mano, o apunta el Programador de
REM Tareas de Windows a este archivo para que corra solo todos los dias.
REM %~dp0 = la carpeta donde esta este .bat, sin importar desde donde se
REM llame, asi que siempre encuentra el proyecto sin configurar nada mas.
cd /d "%~dp0.."
node scripts\respaldo.js
