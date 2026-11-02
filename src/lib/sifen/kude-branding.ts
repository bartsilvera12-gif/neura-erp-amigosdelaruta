import "server-only";
import { downloadSifenObject } from "@/lib/sifen/sifen-storage";
import { normalizeKudeLogos } from "@/lib/sifen/sifen-config-response";
import type { KudeBranding } from "@/lib/sifen/kude-pdf";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/** Opciones de resolución del logo al renderizar un KuDE. */
export type LoadKudeBrandingOptions = {
  /**
   * Id del logo de la galería (`kude_logos`) elegido para esta factura.
   * Se resuelve a su `path` contra la config de la empresa, por lo que no se
   * puede forzar la descarga de rutas arbitrarias. Si no existe o es null, se
   * usa el predeterminado de la galería y, en su defecto, el logo legacy.
   */
  logoId?: string | null;
};

/**
 * Carga branding KuDE/PDF desde `empresa_sifen_config` para la empresa.
 * Devuelve null cuando no hay nada configurado o cuando la lectura no pudo
 * resolverse: en ese caso el renderer usa el diseño Neura por defecto.
 * Solo afecta el PDF; no interactúa con XML/firma/SET/CDC.
 *
 * Resolución del logo (en orden):
 *   1) El logo de la galería cuyo id coincide con `opts.logoId`.
 *   2) El logo marcado como predeterminado en la galería `kude_logos`.
 *   3) El logo único legacy `kude_logo_path`.
 *   4) Sin logo → el renderer cae al logo Neura.
 */
export async function loadKudeBranding(
  supabase: AppSupabaseClient,
  empresaId: string,
  opts: LoadKudeBrandingOptions = {}
): Promise<KudeBranding | null> {
  // `select("*")` a propósito: en schemas donde todavía no existe `kude_logos`
  // (tenants sin la migración), pedir la columna explícita haría fallar el query
  // y se perdería el branding. Con "*" la columna simplemente viene undefined y
  // se cae al logo legacy/Neura. Mismo criterio en borrador y KuDE.
  const { data, error } = await supabase
    .from("empresa_sifen_config")
    .select("*")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as {
    kude_logo_path: string | null;
    kude_logos: unknown;
    kude_color_primario: string | null;
    kude_color_primario_fill: string | null;
  };

  const colorPrimario =
    row.kude_color_primario == null || String(row.kude_color_primario).trim() === ""
      ? null
      : String(row.kude_color_primario).trim();
  const colorPrimarioFill =
    row.kude_color_primario_fill == null ||
    String(row.kude_color_primario_fill).trim() === ""
      ? null
      : String(row.kude_color_primario_fill).trim();

  // Resolver qué logo usar: elegido → predeterminado de galería → legacy.
  const logos = normalizeKudeLogos(row.kude_logos);
  const idElegido = opts.logoId == null ? "" : String(opts.logoId).trim();
  const logoElegido =
    (idElegido ? logos.find((l) => l.id === idElegido) : undefined) ??
    logos.find((l) => l.predeterminado) ??
    null;

  const legacyPath =
    row.kude_logo_path == null || String(row.kude_logo_path).trim() === ""
      ? null
      : String(row.kude_logo_path).trim();

  let logoBytes: Uint8Array | null = null;
  const logoPath = logoElegido?.path ?? legacyPath;
  if (logoPath) {
    const dl = await downloadSifenObject(supabase, logoPath);
    if (dl.ok) {
      logoBytes = new Uint8Array(dl.data);
    } else {
      console.warn("[kude] logo download failed, falling back to default", {
        empresa_id: empresaId,
        path: logoPath,
        message: dl.message,
      });
    }
  }

  if (!logoBytes && !colorPrimario && !colorPrimarioFill) return null;
  return { logoBytes, colorPrimario, colorPrimarioFill };
}
