/// <reference types="vite/client" />

interface ImportMetaEnv {
  // URL base del backend (ej. https://planillas.grupojhcr.com/api). Si no
  // se define, el frontend usa http://localhost:3000/api (desarrollo).
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
