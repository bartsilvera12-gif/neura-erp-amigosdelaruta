/**
 * Logos del KuDE por empresa (empresa_sifen_config.kude_logos_json).
 *
 * El `kude_logo_path` de la config sigue siendo el logo PREDETERMINADO. Acá se
 * guardan logos ADICIONALES, cada uno con un id estable y un nombre visible, de
 * modo que al facturar se pueda elegir cuál usar (`facturas.kude_logo_id`).
 *
 * Solo afecta la representación gráfica (PDF/KuDE): nunca el XML, la firma, el
 * CDC ni los datos fiscales declarados ante la SET.
 */
import type { KudeLogoDTO } from "./types";

export const MAX_KUDE_LOGOS = 8;

/** Normaliza un nombre visible de logo (sin romper el PDF ni la UI). */
export function normalizarNombreLogo(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/**
 * Lee el arreglo de logos desde la fila (puede venir como string JSON del shim
 * PG o como arreglo del cliente PostgREST). Descarta entradas sin path.
 */
export function parseKudeLogos(raw: unknown): KudeLogoDTO[] {
  if (raw == null || raw === "") return [];
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: KudeLogoDTO[] = [];
  const vistos = new Set<string>();
  for (const item of arr) {
    const o = (item ?? {}) as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const path = String(o.path ?? "").trim();
    const nombre = normalizarNombreLogo(o.nombre) || "Logo";
    if (!id || !path || vistos.has(id)) continue;
    vistos.add(id);
    out.push({ id, nombre, path });
  }
  return out;
}

/** Genera un id de logo corto y estable (no se reutiliza entre subidas). */
export function nuevoIdLogo(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `logo_${Date.now().toString(36)}_${rnd}`;
}

/** Ruta del objeto de un logo adicional dentro del bucket privado `sifen`. */
export function buildKudeLogoAdicionalObjectPath(empresaId: string, logoId: string): string {
  const safe = logoId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${empresaId}/branding/logos/${safe}.png`;
}

/**
 * Resuelve la ruta del logo a usar para una factura:
 *   - `logoId` coincide con un logo adicional → su path.
 *   - en cualquier otro caso → el predeterminado (`kude_logo_path`), o null.
 * Nunca lanza: si el logo elegido ya no existe, cae al predeterminado.
 */
export function resolverLogoPath(
  logoId: string | null | undefined,
  logos: KudeLogoDTO[],
  defaultPath: string | null
): string | null {
  const id = (logoId ?? "").trim();
  if (id) {
    const encontrado = logos.find((l) => l.id === id);
    if (encontrado) return encontrado.path;
  }
  return defaultPath && defaultPath.trim() !== "" ? defaultPath.trim() : null;
}
