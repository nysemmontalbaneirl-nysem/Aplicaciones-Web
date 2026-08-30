# Tabla 22 PLAME — Ingresos, Tributos y Descuentos (SUNAT)

Catálogo oficial de SUNAT (PDT PLAME) que lista todos los conceptos de
ingresos, indemnizaciones, aportaciones y descuentos usados en planillas en
el Perú, y para cada concepto de INGRESO indica si está afecto ("SI") o no
("NO") a cada tributo/aportación (EsSalud, SCTR, SENATI, SNP, SPP/AFP,
Renta de 5ta, etc.). Es la fuente oficial para responder "¿a qué aportes o
descuentos está afecto el concepto X?".

- **Archivo fuente**: [`TABLA22.xls`](./TABLA22.xls) (proporcionado por el
  usuario, 25/08/2026 — el archivo original ya está guardado en esta misma
  carpeta del repo, no solo su extracción).
- **Extracción completa**: [`tabla22_plame.json`](./tabla22_plame.json) — los
  310 conceptos del catálogo, 225 de ellos con su matriz SI/NO completa por
  columna de tributo (los conceptos de las secciones 600/700/800 -
  aportaciones del trabajador, descuentos, aportaciones del empleador - son
  solo el catálogo de códigos, no tienen matriz: son los tributos en sí, no
  ingresos que se les crucen).

## Cómo leer la matriz

Cada concepto de ingreso (código 100-2999) tiene columnas `SI`/`NO` para:
EsSalud (seguro regular, CBSSP pesquero, agrario/acuicultor, SCTR), Impuesto
Extraord. de Solidaridad (derogado, ya no aplica), Fondo Derechos Sociales
del Artista, SENATI, Fondo Comp. Jub. Trab. Pesquero, SNP (ONP), SPP (AFP),
Fondo Compl. Jubil. Min/Met/Sider, Régimen Pensiones Trab. Pesquero, Renta
5ta categoría, EsSalud Pensionista, Contrib. Solidaria Asistencia
Previsional (derogada).

## Conceptos usados por este sistema (JHCR) y su afectación oficial

Cruce entre los conceptos que ya calcula `motorCalculo.ts` y lo que dice la
Tabla 22. "✅ coincide" = el código ya excluye/incluye igual que la tabla.

| Concepto en el sistema | Código PLAME | EsSalud | SCTR | SENATI | SNP | SPP (AFP) | Renta 5ta | Estado |
|---|---|---|---|---|---|---|---|---|
| Jornal básico / sueldo | 121 Remuneración o jornal básico | SI | SI | SI | SI | SI | SI | ✅ incluido en remuneración afecta |
| Remuneración dominical/feriado | 115 | SI | SI | SI | SI | SI | SI | ✅ incluido |
| Horas extra 25%/35% | 105/106 | SI | SI | SI | SI | SI | SI | ✅ incluido |
| Asignación familiar | 201 | SI | SI | SI | SI | SI | SI | ✅ incluido |
| BUC (Bonif. Unif. Construcción) | 311 | SI | SI | **SI** | SI | SI | SI | ✅ incluido (corregido, ver nota SENATI abajo) |
| Vacaciones (truncas/remun./compensación) | 114/117/118 | SI | SI | SI | SI | SI | SI | ✅ incluido |
| Asignación por escolaridad | 211 | NO | — | NO | NO | NO | **SI** | ✅ incluida en base de Renta 5ta (corregido, ver nota abajo) |
| Movilidad supeditada a asistencia (solo traslado) | 909 | NO | — | NO | NO | NO | SI | ✅ excluido de remuneración afecta (correcto: la movilidad de este sistema es "supeditada a asistencia", no "de libre disposición" -código 908, que sí sería SI a todo) |
| Gratificación Fiestas Patrias/Navidad (Ley 29351/30334, la que exonera EsSalud/pensión) | 406 | NO | — | NO | NO | NO | SI | ✅ excluido de remuneración afecta |
| Bonificación Extraordinaria (Ley 29351/30334) | 312/313 | NO | — | NO | NO | NO | SI | ✅ excluido de remuneración afecta |
| CTS | 904 (sección "Conceptos varios") | NO | — | NO | NO | NO | NO | ✅ excluido de remuneración afecta (totalmente inafecta) |

No aparecen como conceptos de INGRESO con matriz (son tributos/descuentos en
sí, catálogo sin matriz): CONAFOVICER (602), Cuota sindical (702), ESSALUD
+VIDA / Póliza de seguro D.Leg. 688 (803/815), SENATI como aportación del
empleador (807). BAE (Bonificación por Alta Especialización) tampoco
aparece: es un beneficio propio del convenio colectivo de construcción
civil, no un código estándar de PLAME.

## Discrepancias encontradas — ambas ya corregidas

1. **SENATI y el BUC** (corregido): la Tabla 22 dice que el BUC (código 311)
   SÍ está afecto a SENATI. `calcularSenati` ahora incluye el BUC en su
   base (`sueldoBasico + remuneracionDominical + remuneracionFeriado +
   bonificacionBUC`). Antes lo excluía por error (verificado contra boletas
   reales que probablemente tenían el BUC en 0 esos periodos, ocultando la
   diferencia). Probado: Operario con BUC=685.82, SENATI subió de S/11.25 a
   S/14.34.

2. **Renta de 5ta y la asignación por escolaridad** (corregido): la Tabla 22
   dice que la asignación por escolaridad (211) SÍ está afecta a Renta de
   5ta. `calcularRenta5ta` ahora recibe una base propia
   (`remuneracionAfectaRenta5ta = remuneracionAfecta + asignacionEscolaridad`)
   en vez de `remuneracionAfecta` a secas. En la práctica esto no cambia
   ningún monto hoy: la escolaridad solo se calcula para construcción civil
   y la Renta de 5ta solo para EMPLEADO (categorías mutuamente excluyentes
   en este sistema), pero queda correcto por si eso cambia más adelante.

Todo lo demás (jornal básico, dominical/feriado, horas extra, asignación
familiar, BUC, vacaciones, movilidad, gratificación, bonificación
extraordinaria y CTS) coincide exactamente con lo que ya calcula el sistema.
