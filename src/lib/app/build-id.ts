import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Identificador del build que está sirviendo este contenedor.
 *
 * Sirve para que el navegador se entere de que hubo un deploy nuevo: el cliente
 * guarda el valor con el que cargó y, cuando `/api/deploy-info` devuelve otro,
 * ofrece recargar. Sin esto hay que acordarse de hacer Ctrl+F5 a mano, porque
 * el bundle viejo queda cacheado.
 *
 * De dónde sale, en orden:
 *   1. `NEXT_BUILD_ID`, si alguien la define a mano.
 *   2. `.next/BUILD_ID`, que Next genera en cada build y queda dentro del output
 *      standalone que copia el Dockerfile. Es el caso normal en Coolify.
 *   3. El sha de Vercel, para cuando el mismo código se despliega allá.
 *
 * Si ninguna está, devuelve `null` y el aviso simplemente no aparece: preferible
 * a inventar un valor que cambie en cada arranque y moleste pidiendo recargar
 * cada vez que el contenedor se reinicia sirviendo exactamente el mismo bundle.
 */

let cache: string | null | undefined;

function leerArchivoBuildId(): string | null {
  // En el contenedor el standalone se copia a /app, así que el archivo queda en
  // <cwd>/.next/BUILD_ID. En local, el output puede quedar anidado bajo la ruta
  // del proyecto, por eso el segundo candidato.
  const candidatos = [
    join(process.cwd(), ".next", "BUILD_ID"),
    join(process.cwd(), ".next", "standalone", ".next", "BUILD_ID"),
  ];
  for (const ruta of candidatos) {
    try {
      const v = readFileSync(ruta, "utf8").trim();
      if (v) return v;
    } catch {
      /* probamos el siguiente */
    }
  }
  return null;
}

export function getBuildId(): string | null {
  if (cache !== undefined) return cache;

  const porEnv = process.env.NEXT_BUILD_ID?.trim();
  if (porEnv) {
    cache = porEnv;
    return cache;
  }

  const porArchivo = leerArchivoBuildId();
  if (porArchivo) {
    cache = porArchivo;
    return cache;
  }

  cache = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
  return cache;
}
