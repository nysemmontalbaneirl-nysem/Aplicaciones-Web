// =========================================================================
// Aviso de posible concepto duplicado contra el catalogo oficial SUNAT
// (Anexo 22 / Tabla 22 PLAME), para "Conceptos con formula propia" (Ronda
// D, migracion 033). Es solo una ADVERTENCIA (nunca bloquea la creacion):
// compara el nombre/descripcion de un concepto nuevo contra el catalogo
// oficial (docs/tabla22_plame.json, copiado a src/assets/ para que viaje
// con el build igual que el logo - ver package.json "build") y contra los
// conceptos ya existentes en conceptos_planilla.
// =========================================================================

import fs from "fs";
import path from "path";

interface ConceptoAnexo22 {
  codigo: number;
  descripcion: string;
  seccion: string;
}

interface CatalogoAnexo22 {
  fuente: string;
  conceptos: ConceptoAnexo22[];
}

let catalogoCache: CatalogoAnexo22 | null = null;

function cargarCatalogo(): CatalogoAnexo22 {
  if (catalogoCache) return catalogoCache;
  const ruta = path.join(__dirname, "assets", "tabla22_plame.json");
  catalogoCache = JSON.parse(fs.readFileSync(ruta, "utf-8")) as CatalogoAnexo22;
  return catalogoCache;
}

/** MAYUSCULAS, sin tildes, solo letras/numeros/espacios - para comparar sin que un acento o una mayuscula distinta oculte un parecido real. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PALABRAS_IGNORADAS = new Set(["DE", "DEL", "LA", "EL", "LOS", "LAS", "EN", "Y", "O", "A", "POR", "CON", "SU"]);

function palabrasClave(texto: string): Set<string> {
  return new Set(normalizar(texto).split(" ").filter((p) => p.length > 2 && !PALABRAS_IGNORADAS.has(p)));
}

/** Interseccion / union de palabras clave (indice de Jaccard) - 0 = nada en comun, 1 = identico. */
function similitud(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let interseccion = 0;
  for (const palabra of a) if (b.has(palabra)) interseccion++;
  const union = a.size + b.size - interseccion;
  return union === 0 ? 0 : interseccion / union;
}

export interface AvisoDuplicado {
  fuente: "ANEXO_22_SUNAT" | "CONCEPTO_EXISTENTE";
  codigo: string | number;
  nombre: string;
  similitud: number;
}

const UMBRAL_SIMILITUD = 0.5;

/**
 * Compara nombre/descripcion de un concepto nuevo contra el catalogo Anexo
 * 22 y contra los conceptos ya existentes en el sistema. Devuelve una
 * lista de posibles duplicados (puede estar vacia) - es responsabilidad de
 * quien llama decidir si solo advertir o tambien mostrarlo en pantalla.
 */
export function buscarPosiblesDuplicados(
  nombre: string,
  descripcion: string | null | undefined,
  conceptosExistentes: Array<{ codigo: string; nombre: string }>
): AvisoDuplicado[] {
  const clave = new Set<string>([...palabrasClave(nombre), ...palabrasClave(descripcion ?? "")]);
  const avisos: AvisoDuplicado[] = [];

  let catalogo: CatalogoAnexo22 | null = null;
  try {
    catalogo = cargarCatalogo();
  } catch {
    // Si el archivo no esta disponible por algun motivo, no se bloquea la
    // creacion del concepto - simplemente no se compara contra Anexo 22.
    catalogo = null;
  }
  if (catalogo) {
    for (const c of catalogo.conceptos) {
      const s = similitud(clave, palabrasClave(c.descripcion));
      if (s >= UMBRAL_SIMILITUD) {
        avisos.push({ fuente: "ANEXO_22_SUNAT", codigo: c.codigo, nombre: c.descripcion, similitud: s });
      }
    }
  }

  for (const c of conceptosExistentes) {
    const s = similitud(clave, palabrasClave(c.nombre));
    if (s >= UMBRAL_SIMILITUD) {
      avisos.push({ fuente: "CONCEPTO_EXISTENTE", codigo: c.codigo, nombre: c.nombre, similitud: s });
    }
  }

  return avisos.sort((a, b) => b.similitud - a.similitud);
}
