#!/usr/bin/env node
// =========================================================================
// Restaura la base de datos desde un archivo de respaldo generado por
// scripts/respaldo.js. SOLO se usa si algo salio mal y hay que recuperar
// los datos - no es parte del uso normal del sistema.
//
// IMPORTANTE: esto reemplaza TODOS los datos actuales de la base por los
// del archivo de respaldo. El flag --si es obligatorio a proposito, para
// que nadie lo ejecute sin querer.
//
// Uso:
//   node scripts/restaurar.js "C:\ruta\al\planilla_2026-08-25_030000.dump" --si
// =========================================================================

require("dotenv").config();
const { spawnSync } = require("child_process");
const fs = require("fs");

const archivo = process.argv[2];
const confirmado = process.argv.includes("--si");

if (!archivo || !confirmado) {
  console.error("Uso: node scripts/restaurar.js <ruta-al-archivo.dump> --si");
  console.error("");
  console.error(
    "IMPORTANTE: esto reemplaza TODOS los datos actuales de la base de datos por los del " +
      "archivo de respaldo. El flag --si es obligatorio para confirmar que entiendes esto."
  );
  process.exit(1);
}

if (!fs.existsSync(archivo)) {
  console.error(`ERROR: no se encontro el archivo "${archivo}"`);
  process.exit(1);
}

const {
  DB_HOST = "localhost",
  DB_PORT = "5432",
  DB_NAME,
  DB_USER = "postgres",
  DB_PASSWORD,
  PG_RESTORE_PATH = "pg_restore",
} = process.env;

if (!DB_NAME) {
  console.error("ERROR: falta DB_NAME en .env");
  process.exit(1);
}

console.log(`Restaurando "${archivo}" sobre la base "${DB_NAME}"...`);
console.log("(esto puede tardar varios minutos segun el tamaño del respaldo)");

const resultado = spawnSync(
  PG_RESTORE_PATH,
  ["-h", DB_HOST, "-p", DB_PORT, "-U", DB_USER, "-d", DB_NAME, "--clean", "--if-exists", archivo],
  { env: { ...process.env, PGPASSWORD: DB_PASSWORD ?? "" }, stdio: "inherit" }
);

if (resultado.status !== 0) {
  console.error(`\npg_restore termino con errores (código ${resultado.status}). Revisa el detalle arriba.`);
  process.exit(1);
}

console.log("\nRestauración completada.");
