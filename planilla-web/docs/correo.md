# Enviar boletas por correo

Desde la pestaña **Boletas**, el Administrador o el Encargado de planilla
puede seleccionar boletas de un periodo ya calculado y mandarlas por
correo (en PDF, adjunto) directo al correo que cada trabajador tenga
registrado en la pestaña **Trabajadores**. Si un trabajador no tiene
correo registrado, se salta y queda listado como error al terminar el
envío — no bloquea el resto del lote.

## 1. Crear una cuenta de correo dedicada (una sola vez)

En el panel de hosting de tu dominio (cPanel u otro parecido), busca la
sección **"Cuentas de correo"** y crea una nueva, por ejemplo
`boletas@grupojhcr.com`. No uses tu correo personal — así el trabajador ve
claramente que es un correo automático del sistema, y no se mezcla con tu
bandeja de entrada normal.

## 2. Conseguir los datos de SMTP

Todavía en el panel de hosting, dentro de esa cuenta de correo busca
**"Configurar cliente de correo"** o **"Connect Devices"** (el nombre
exacto varía según el hosting). Ahí vas a ver un bloque que dice algo como
"Configuración manual" con estos datos — son los que necesitas:

- **Servidor de correo saliente (SMTP)**: algo como `mail.grupojhcr.com`
- **Puerto**: normalmente `587` (con SSL/TLS) o `465` (SSL)
- **Usuario**: el correo completo, ej. `boletas@grupojhcr.com`
- **Contraseña**: la que pusiste al crear la cuenta de correo

Si tu hosting no te muestra esto claramente, dime el nombre del proveedor
de hosting (ej. GoDaddy, Hostinger, cPanel genérico, etc.) y te digo
exactamente dónde mirar.

## 3. Configurar el `.env`

Abre el archivo `.env` del proyecto (el mismo donde está `DB_PASSWORD`) y
agrega estas líneas con tus datos reales:

```
SMTP_HOST=mail.grupojhcr.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=boletas@grupojhcr.com
SMTP_PASSWORD=la_contrasena_de_esa_cuenta_de_correo
SMTP_FROM="Planillas JHCR <boletas@grupojhcr.com>"
```

- `SMTP_SECURE` va en `true` **solo** si el puerto es `465`. Para `587`
  déjalo en `false`.
- `SMTP_FROM` es el nombre que va a ver el trabajador como remitente —
  puedes cambiar "Planillas JHCR" por lo que prefieras, pero el correo
  entre `< >` debe ser el mismo de `SMTP_USER`.

Guarda el archivo y reinicia el sistema (`npm run dev`) para que tome los
cambios.

## 4. Usarlo

1. Ve a la pestaña **Boletas**, elige el periodo (debe estar ya calculado).
2. Marca con el check las boletas que quieres enviar (o el check de la
   cabecera para marcar todas).
3. Clic en **"Enviar por correo"**.
4. Al terminar, el sistema te dice cuántas se enviaron y, si alguna
   falló (ej. trabajador sin correo registrado, o un error de conexión con
   el servidor de correo), te lista cuáles y por qué.

Cada envío queda registrado en la **Bitácora** (quién lo hizo, a quiénes,
cuándo).
