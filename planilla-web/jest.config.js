/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  setupFiles: ["<rootDir>/tests/setupEnv.ts"],
  globalSetup: "<rootDir>/tests/globalSetup.ts",
  globalTeardown: "<rootDir>/tests/globalTeardown.ts",
  // Provisiona una base de datos real y hace peticiones HTTP de verdad, asi
  // que corre mas lento que una prueba unitaria comun.
  testTimeout: 20000,
  maxWorkers: 1,
};
