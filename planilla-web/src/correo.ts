import nodemailer from "nodemailer";

// Configuracion SMTP leida del .env (ver .env.example). No se envia nada si
// falta algun dato: se lanza un error claro en vez de fallar en silencio.
function obtenerTransportador() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  if (!host || !user || !password) {
    throw new Error(
      "Falta configurar el correo (SMTP_HOST, SMTP_USER, SMTP_PASSWORD en el archivo .env). " +
        "Revisa docs/correo.md para los pasos."
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true", // true = puerto 465 (SSL), false = puerto 587 (STARTTLS)
    auth: { user, pass: password },
  });
}

interface Adjunto {
  nombreArchivo: string;
  contenido: Buffer;
}

export async function enviarCorreo(params: {
  para: string;
  asunto: string;
  textoPlano: string;
  adjuntos?: Adjunto[];
}): Promise<void> {
  const transportador = obtenerTransportador();
  const remitente = process.env.SMTP_FROM || process.env.SMTP_USER;

  await transportador.sendMail({
    from: remitente,
    to: params.para,
    subject: params.asunto,
    text: params.textoPlano,
    attachments: params.adjuntos?.map((a) => ({ filename: a.nombreArchivo, content: a.contenido })),
  });
}
