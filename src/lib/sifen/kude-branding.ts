import "server-only";
import { downloadSifenObject } from "@/lib/sifen/sifen-storage";
import type { KudeBranding } from "@/lib/sifen/kude-pdf";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { parseKudeLogos, resolverLogoPath } from "@/lib/sifen/kude-logos";

/**
 * Carga branding KuDE/PDF desde `empresa_sifen_config` para la empresa.
 * Devuelve null cuando no hay nada configurado o cuando la lectura no pudo
 * resolverse: en ese caso el renderer usa el diseño Neura por defecto.
 * Solo afecta el PDF; no interactúa con XML/firma/SET/CDC.
 *
 * `logoId` (opcional): id de uno de los logos adicionales elegido al facturar.
 * Si coincide con un logo cargado, se usa ese; si no, se cae al predeterminado
 * (`kude_logo_path`) y, de faltar, al logo Neura del renderer.
 */
export async function loadKudeBranding(
  supabase: AppSupabaseClient,
  empresaId: string,
  logoId?: string | null
): Promise<KudeBranding | null> {
  const { data, error } = await supabase
    .from("empresa_sifen_config")
    .select("kude_logo_path, kude_color_primario, kude_color_primario_fill, kude_logos_json")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as {
    kude_logo_path: string | null;
    kude_color_primario: string | null;
    kude_color_primario_fill: string | null;
    kude_logos_json?: unknown;
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

  let logoBytes: Uint8Array | null = null;
  const defaultPath =
    row.kude_logo_path == null || String(row.kude_logo_path).trim() === ""
      ? null
      : String(row.kude_logo_path).trim();
  const logoPath = resolverLogoPath(logoId, parseKudeLogos(row.kude_logos_json), defaultPath);
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
