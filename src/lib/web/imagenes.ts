import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Imágenes del sitio público: portadas de viaje, motos, encuentros y galería
 * de tienda.
 *
 * Bucket `web-imagenes`, **PÚBLICO**, a diferencia de `productos-imagenes`,
 * que es privado y se sirve con URL firmada a 1 hora. Acá eso no sirve: el
 * sitio cachea el catálogo y las URLs firmadas se vencerían, dejando las fotos
 * rotas para el visitante. Son fotos de marketing que de todos modos se
 * publican, así que una URL estable es lo correcto.
 *
 * Path: `{empresa_id}/{coleccion}/{id}/{archivo}.{ext}`. El primer segmento es
 * `empresa_id` para que el aislamiento por tenant se vea en la ruta, igual que
 * en el bucket de productos.
 */

export const WEB_IMAGENES_BUCKET = "web-imagenes";

export const MIME_PERMITIDOS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export const MAX_BYTES = 8 * 1024 * 1024; // 8 MB: fotos de ruta, no miniaturas

/** Colecciones que pueden tener imagen. Whitelist: el path no se arma con texto libre. */
export const COLECCIONES = ["evento", "moto", "encuentro", "producto"] as const;
export type ColeccionImagen = (typeof COLECCIONES)[number];

export function esColeccionImagen(x: unknown): x is ColeccionImagen {
  return typeof x === "string" && (COLECCIONES as readonly string[]).includes(x);
}

let bucketListo = false;

/**
 * Crea el bucket público si falta. Idempotente, con un flag en memoria para no
 * llamar a getBucket en cada subida.
 */
export async function asegurarBucket(supabase: AppSupabaseClient): Promise<void> {
  if (bucketListo) return;
  try {
    const { data } = await supabase.storage.getBucket(WEB_IMAGENES_BUCKET);
    if (data) {
      bucketListo = true;
      return;
    }
  } catch {
    /* no existe o no se pudo consultar: se intenta crear */
  }
  const { error } = await supabase.storage.createBucket(WEB_IMAGENES_BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: Object.keys(MIME_PERMITIDOS),
  });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(`No se pudo crear el bucket ${WEB_IMAGENES_BUCKET}: ${error.message}`);
  }
  bucketListo = true;
}

/**
 * Nombre de archivo con marca de tiempo.
 *
 * No se sobrescribe siempre el mismo nombre a propósito: los CDN y el
 * navegador cachean por URL, y reemplazar una foto dejaría la vieja a la vista
 * hasta que venza el caché. Nombre nuevo = la foto nueva se ve al instante.
 */
export function construirPath(
  empresaId: string,
  coleccion: ColeccionImagen,
  idFila: string,
  mime: string
): string {
  const ext = MIME_PERMITIDOS[mime] ?? "bin";
  const seguro = idFila.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "sin-id";
  return `${empresaId}/${coleccion}/${seguro}/${Date.now()}.${ext}`;
}

export function urlPublica(supabase: AppSupabaseClient, path: string): string {
  const { data } = supabase.storage.from(WEB_IMAGENES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** `true` si el path es de esta empresa. Se valida antes de borrar. */
export function esDeLaEmpresa(path: string, empresaId: string): boolean {
  return path.startsWith(`${empresaId}/`);
}
