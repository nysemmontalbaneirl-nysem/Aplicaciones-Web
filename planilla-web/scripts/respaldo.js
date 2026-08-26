#!/usr/bin/env node
// =========================================================================
// Respaldo automatico de la base de datos de planillas.
//
// Pensado para correr SOLO, sin que nadie lo este mirando, todos los dias
// desde el Programador de Tareas de Windows. Genera un dump con pg_dump,
// lo copia a las carpetas configuradas (nube + disco externo) y borra
// respaldos viejos para no llenar el disco. Deja un registro en
// respaldos/respaldo.log de cada corrida - exitosa o fallida - para poder
// revisar despues si algo dejo de funcionar.
//
// Configuracion (agregar al archivo .env, junto a las demas variables):
//   PG_DUMP_PATH        ruta completa a pg_dump.exe si no esta en el PATH
//                       (ej. "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe")
//   BACKUP_DIR_NUBE     carpeta sincronizada con Google Drive/OneDrive
//   BACKUP_DIR_EXTERNO  carpeta en un disco externo/USB
//   BACKUP_RETENCION_DIAS  cuantos dias de respaldos conservar (30 por defecto)
//
// Uso manual (para probar que funciona antes de programarlo):
//   node scripts/respaldo.js
// =========================================================================

require("dotenv").config();
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const CARPETA_LOCAL = path.join(RAIZ, "respaldos");
const ARCHIVO_LOG = path.join(CARPETA_LOCAL, "respaldo.log");

function ahora() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function registrar(mensaje) {
  const linea = `[${ahora()}] ${mensaje}`;
  console.log(linea);
  fs.mkdirSync(CARPETA_LOCAL, { recursive: true });
  fs.appendFileSync(ARCHIVO_LOG, linea + "\n");
}

function nombreArchivo() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fecha = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hora = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `planilla_${fecha}_${hora}.dump`;
}

function borrarRespaldosViejos(carpeta, diasRetencion) {
  if (!fs.existsSync(carpeta)) return;
  const limite = Date.now() - diasRetencion * 24 * 60 * 60 * 1000;
  for (const nombre of fs.readdirSync(carpeta)) {
    if (!nombre.startsWith("planilla_") || !nombre.endsWith(".dump")) continue;
    const ruta = path.join(carpeta, nombre);
    const stat = fs.statSync(ruta);
    if (stat.mtimeMs < limite) {
      fs.unlinkSync(ruta);
      registrar(`Borrado respaldo antiguo: ${ruta}`);
    }
  }
}

function main() {
  const {
    DB_HOST = "localhost",
    DB_PORT = "5432",
    DB_NAME,
    DB_USER = "postgres",
    DB_PASSWORD,
    PG_DUMP_PATH = "pg_dump",
    BACKUP_DIR_NUBE,
    BACKUP_DIR_EXTERNO,
    BACKUP_RETENCION_DIAS = "30",
  } = process.env;

  if (!DB_NAME) {
    registrar('ERROR: falta DB_NAME en .env. No se genero ningun respaldo.');
    process.exit(1);
  }

  fs.mkdirSync(CARPETA_LOCAL, { recursive: true });
  const archivoLocal = path.join(CARPETA_LOCAL, nombreArchivo());

  registrar(`Iniciando respaldo de la base "${DB_NAME}"...`);

  const resultado = spawnSync(
    PG_DUMP_PATH,
    ["-h", DB_HOST, "-p", DB_PORT, "-U", DB_USER, "-F", "c", "-f", archivoLocal, DB_NAME],
    { env: { ...process.env, PGPASSWORD: DB_PASSWORD ?? "" } }
  );

  if (resultado.error || resultado.status !== 0) {
    const detalle = resultado.stderr?.toString().trim() || resultado.error?.message || `codigo ${resultado.status}`;
    registrar(`ERROR: pg_dump fallo. ${detalle}`);
    process.exit(1);
  }

  const tamanoMB = (fs.statSync(archivoLocal).size / (1024 * 1024)).toFixed(2);
  registrar(`Respaldo generado: ${archivoLocal} (${tamanoMB} MB)`);

  const destinos = [
    ["nube", BACKUP_DIR_NUBE],
    ["disco externo", BACKUP_DIR_EXTERNO],
  ];

  let copiadoAlMenosUno = false;
  for (const [etiqueta, carpeta] of destinos) {
    if (!carpeta) {
      registrar(`Aviso: no se configuro carpeta de ${etiqueta} (revisa .env). Se omite ese destino.`);
      continue;
    }
    try {
      fs.mkdirSync(carpeta, { recursive: true });
      const destino = path.join(carpeta, path.basename(archivoLocal));
      fs.copyFileSync(archivoLocal, destino);
      registrar(`Copiado a ${etiqueta}: ${destino}`);
      borrarRespaldosViejos(carpeta, Number(BACKUP_RETENCION_DIAS));
      copiadoAlMenosUno = true;
    } catch (err) {
      registrar(`ERROR copiando a ${etiqueta} (${carpeta}): ${err.message}`);
    }
  }

  borrarRespaldosViejos(CARPETA_LOCAL, Number(BACKUP_RETENCION_DIAS));

  if (!copiadoAlMenosUno) {
    registrar(
      "ERROR: el respaldo se genero pero no se pudo copiar a NINGUN destino externo. " +
        "Solo queda la copia local (misma PC) - eso no protege contra una falla de disco."
    );
    process.exit(1);
  }

  registrar("Respaldo completado correctamente.\n");
}

main();
