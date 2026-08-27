// Se ejecuta antes de importar la app en cada archivo de prueba (ver
// "setupFiles" en jest.config.js). Carga el .env real del proyecto para
// reusar las mismas credenciales de Postgres que ya tienes configuradas
// (host/usuario/contraseña) - pero SIEMPRE fuerza el nombre de la base a
// una dedicada y desechable para pruebas, nunca la base real, sin importar
// en que maquina corran las pruebas.
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

process.env.DB_HOST = process.env.DB_HOST ?? "localhost";
process.env.DB_PORT = process.env.DB_PORT ?? "5432";
process.env.DB_USER = process.env.DB_USER ?? "postgres";
process.env.DB_PASSWORD = process.env.DB_PASSWORD ?? "postgres";
process.env.DB_NAME = "planilla_test_jest";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "clave_de_pruebas_automatizadas_no_usar_en_produccion";
process.env.CORS_ORIGIN = "http://localhost:5173";
