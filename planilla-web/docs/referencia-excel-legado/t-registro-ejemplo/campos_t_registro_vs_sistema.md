# T-Registro: campos que exige SUNAT vs. lo que ya tiene el sistema

Fuente: `constancia_alta_trabajador_ejemplo.pdf` — Constancia de Alta del
Trabajador real (Formulario 1604-1, T-Registro), aportada por el usuario
30/08/2026. Es el comprobante que emite SUNAT cuando se da de alta a un
trabajador; lista exactamente todos los campos que el T-Registro pide.

Cruzado contra `sql/schema.sql` (tablas `empleados` y `contratos`) y el
formulario actual (`frontend/src/components/Trabajadores.tsx`).

Leyenda: ✅ ya existe | 🔄 existe pero como texto libre (necesita catálogo) |
❌ no existe todavía.

## Datos de identificación del trabajador

| Campo SUNAT | Tabla SUNAT | Estado en el sistema |
|---|---|---|
| Tipo y número de documento | T3 | ✅ `tipo_documento` + `numero_documento` |
| Fecha de nacimiento | — | ✅ `fecha_nacimiento` |
| País emisor del documento | T26 (solo pasaporte) | ❌ falta |
| Apellidos y nombres | — | ✅ |
| Sexo | — | ❌ falta |
| Estado civil | — | ❌ falta |
| Nacionalidad | T4 | ❌ falta |
| Teléfono | — | ✅ `celular` |
| Correo electrónico | — | ✅ `correo` |
| Primera dirección | T5 (vía) / T6 (zona) para el formato completo | 🔄 `direccion` es texto libre, sin desglose vía/zona |
| Segunda dirección | — | ❌ falta |
| Referente para Centro Asistencial EsSalud | — | ❌ falta (SUNAT pide una dirección aparte para EsSalud, aunque en la práctica suele repetir la misma) |
| Ubigeo (departamento/provincia/distrito) | T28 | 🔄 `ubigeo` es texto libre, sin el código oficial |

## Datos laborales

| Campo SUNAT | Tabla SUNAT | Estado en el sistema |
|---|---|---|
| Fecha de inicio / fin del período laboral | — | ✅ `fecha_ingreso` / `fecha_cese` |
| Motivo de baja | T17 | ❌ falta — el sistema no registra por qué terminó un contrato |
| Tipo de trabajador (ej. "CONSTRUCCION CIVIL") | T8 | ❌ falta como campo explícito |
| Régimen laboral (ej. "CONSTRUCCION CIVIL") | T33 | ❌ falta como campo explícito |
| Categoría ocupacional oficial (ej. "OBRERO") | T24 | ❌ falta — distinta de `categoria_ocupacional` del sistema (ver informe anterior) |
| Ocupación (ej. "OFICIAL DE CONSTRUCCION") | T30 | ✅ `ocupacion`, pero como texto libre (podría ser desplegable con la T30) |
| Tipo de contrato (ej. "OBRA DETERM O SERV ESPEC") | T12 | ❌ falta |
| Tipo de pago (ej. "DEPÓSITO EN CUENTA") | T16 | ❌ falta (se puede inferir: si tiene `entidad_bancaria` es depósito) |
| Periodicidad de ingreso (ej. "QUINCENAL") | T13 | ❌ falta como campo explícito (aunque el sistema ya maneja mensual/quincenal a nivel de `periodos_planilla`) |
| Remuneración básica inicial | — | 🔄 existe como `sueldo_base` (solo EMPLEADO) o se deriva de la tabla salarial (construcción civil), no como un campo propio de alta |
| Entidad financiera | T36 | 🔄 `entidad_bancaria` es texto libre — **el que ya pediste arreglar** |
| Número de cuenta | — | ✅ `cuenta_bancaria` |
| ¿Persona con discapacidad? | — | ❌ falta |
| Situación especial (ej. "NINGUNA", dirección, confianza) | T35 | ❌ falta |
| Situación (ej. "Activo") | T15 | 🔄 el sistema tiene `estado`/`estado` de contrato (ACTIVO/HABIL vs INACTIVO/CESADO) pero no el código oficial T15 |
| ¿Sindicalizado? | — | ✅ `sindicalizado` |
| Jornada laboral (ej. "Jornada de trabajo máxima") | — | ❌ falta |
| Establecimientos donde labora (código + tipo + dirección) | — | ❌ falta — el sistema no modela múltiples locales/anexos del empleador (probablemente no aplica si JHCR opera desde un solo domicilio fiscal, a confirmar) |

## Datos de seguridad social

| Campo SUNAT | Tabla SUNAT | Estado en el sistema |
|---|---|---|
| Régimen de aseguramiento de salud (ej. "ESSALUD REGULAR") | T32 | ❌ falta como campo explícito (el sistema solo tiene el booleano `essalud_vida`) |
| Entidad Prestadora de Salud (EPS) | T14 | ❌ falta (no aplica si todos están en EsSalud regular, a confirmar) |
| Régimen pensionario | T11 | ✅ `sistema_pension` + `afp_nombre`, ya como `<select>` en el formulario — solo falta que use los códigos oficiales T11 en vez de nombres libres |
| CUSPP | — | ✅ |
| Aporte al SCTR | — | ✅ `sctr_salud` |
| Cobertura de pensión (ONP/AFP) | — | ✅ (es lo mismo que `sistema_pension`) |
| Cobertura de salud | — | 🔄 relacionado con `essalud_vida`, sin fecha ni detalle propio |

## Situación educativa

| Campo SUNAT | Tabla SUNAT | Estado en el sistema |
|---|---|---|
| Situación educativa (ej. "EDUCACIÓN TÉCNICA COMPLETA") | T9 | 🔄 `grado_instruccion` es texto libre — se puede convertir a desplegable con la T9 |

## Datos adicionales referidos al ingreso (casos especiales, baja prioridad)

| Campo SUNAT | Tabla SUNAT | Estado en el sistema |
|---|---|---|
| Número de RUC (CAS) | — | ❌ falta (solo aplica a contratos CAS del sector público, no debería aplicar a JHCR) |
| ¿Percibe rentas de 5ta exoneradas? | — | ❌ falta (caso especial, poco frecuente) |
| ¿Aplica convenio para evitar doble imposición? | T25 | ❌ falta (solo aplica a extranjeros de países con convenio, poco frecuente en esta empresa) |

## Resumen — qué conviene priorizar

**Ya pediste esto, listo para implementar (desplegables sobre catálogos que
ya tenemos guardados):**
1. Entidad bancaria → T36 (46 bancos)
2. AFP → T11 (ya es `<select>`, solo falta el código oficial)
3. Grado de instrucción / situación educativa → T9

**Campos que faltan por completo y SUNAT sí exige, recomendado agregar
pronto** (todos son catálogos pequeños, fáciles de convertir en
desplegable): sexo, estado civil, nacionalidad (T4 — aunque casi siempre
será "PERÚ"), tipo de contrato (T12), tipo de pago (T16), periodicidad (T13),
motivo de baja (T17, se llena solo al cesar a alguien), situación especial
(T35), ¿persona con discapacidad?, jornada laboral.

**Requieren más definición antes de construirse** (no son solo un
desplegable, cambian el modelo de datos):
- Categoría ocupacional oficial (T24) y tipo/régimen de trabajador (T8/T33):
  hay que decidir si se derivan automáticamente de la categoría actual
  (OPERARIO/OFICIAL/PEON → 02 OBRERO, CONSTRUCCION CIVIL) o se piden aparte.
- Ubigeo con código oficial (T28): reemplazar el texto libre por un
  desplegable en cascada departamento → provincia → distrito (tabla grande).
- Régimen de aseguramiento de salud (T32) y EPS (T14): hoy solo hay un
  booleano `essalud_vida`.
- Establecimientos donde labora: solo aplica si JHCR declara más de un local
  ante SUNAT — hay que confirmar con el usuario si es el caso.

**Baja prioridad / casos especiales poco frecuentes en esta empresa:** RUC
CAS, rentas de 5ta exoneradas, convenio de doble imposición.
