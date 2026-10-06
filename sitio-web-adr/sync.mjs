/**
 * Copia `sitio-web-adr/publico/` → `public/sitio/`.
 *
 * El sitio de Amigos de la Ruta vive entero en `sitio-web-adr/` para no mezclarse con
 * el árbol del ERP. Pero Next sólo publica archivos estáticos desde `public/`, así que
 * hay que espejarlo ahí antes de cada build. El destino está en `.gitignore`: es
 * generado, la fuente de verdad es `sitio-web-adr/publico/`.
 *
 * Corre solo vía `predev` / `prebuild` en package.json (también en Vercel).
 */
import { cp, rm, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origen = resolve(raiz, "sitio-web-adr/publico");
const destino = resolve(raiz, "public/sitio");

await rm(destino, { recursive: true, force: true });
await mkdir(dirname(destino), { recursive: true });
await cp(origen, destino, { recursive: true });

console.log("[sitio-web-adr] sitio-web-adr/publico → public/sitio");
