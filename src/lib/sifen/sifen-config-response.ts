import type { AmbienteSifen, EmpresaSifenConfigDTO, KudeLogoEntry } from "./types";
import { normalizePlazoCancelacionHoras } from "./sifen-cancelacion-rules";

/**
 * Normaliza el valor crudo de `kude_logos` (JSONB) a un arreglo tipado.
 * Descarta entradas sin id/path; garantiza a lo sumo un `predeterminado`.
 * Nunca lanza: ante cualquier forma inesperada devuelve `[]`.
 */
export function normalizeKudeLogos(raw: unknown): KudeLogoEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: KudeLogoEntry[] = [];
  let yaHayPredeterminado = false;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = o.id == null ? "" : String(o.id).trim();
    const path = o.path == null ? "" : String(o.path).trim();
    if (!id || !path) continue;
    const nombre = o.nombre == null ? "" : String(o.nombre).trim();
    let predeterminado = Boolean(o.predeterminado);
    if (predeterminado && yaHayPredeterminado) predeterminado = false;
    if (predeterminado) yaHayPredeterminado = true;
    out.push({ id, path, nombre: nombre || "Logo", predeterminado });
  }
  // Si ninguno quedó marcado, el primero actúa como predeterminado implícito.
  if (out.length > 0 && !yaHayPredeterminado) out[0].predeterminado = true;
  return out;
}

/**
 * Convierte una fila de BD (con columna cifrada) al DTO expuesto por la API.
 * Nunca incluye la contraseña ni el ciphertext.
 */
export function toEmpresaSifenConfigPublicDto(
  row: Record<string, unknown> | null
): EmpresaSifenConfigDTO | null {
  if (!row) return null;

  const enc = row.certificado_password_encrypted;
  const legacyPlain = row.certificado_password;
  const has_enc = enc != null && String(enc).trim().length > 0;
  const has_plain =
    legacyPlain != null && String(legacyPlain).trim().length > 0;
  const has_certificado_password = has_enc || has_plain;

  return {
    id: String(row.id),
    empresa_id: String(row.empresa_id),
    ambiente: row.ambiente as AmbienteSifen,
    ruc: String(row.ruc ?? ""),
    razon_social: String(row.razon_social ?? ""),
    direccion_fiscal:
      row.direccion_fiscal == null || String(row.direccion_fiscal).trim() === ""
        ? null
        : String(row.direccion_fiscal).trim(),
    timbrado_numero: String(row.timbrado_numero ?? ""),
    timbrado_fecha_inicio_vigencia:
      row.timbrado_fecha_inicio_vigencia == null || String(row.timbrado_fecha_inicio_vigencia).trim() === ""
        ? null
        : String(row.timbrado_fecha_inicio_vigencia).trim().slice(0, 10),
    actividad_economica_codigo:
      row.actividad_economica_codigo == null || String(row.actividad_economica_codigo).trim() === ""
        ? null
        : String(row.actividad_economica_codigo).trim(),
    actividad_economica_descripcion:
      row.actividad_economica_descripcion == null || String(row.actividad_economica_descripcion).trim() === ""
        ? null
        : String(row.actividad_economica_descripcion).trim(),
    establecimiento: String(row.establecimiento ?? ""),
    punto_expedicion: String(row.punto_expedicion ?? ""),
    csc: row.csc == null ? null : String(row.csc),
    id_csc: row.id_csc == null ? null : String(row.id_csc),
    certificado_path: row.certificado_path == null ? null : String(row.certificado_path),
    certificado_vencimiento:
      row.certificado_vencimiento == null ? null : String(row.certificado_vencimiento),
    activo: Boolean(row.activo),
    sifen_plazo_cancelacion_horas: normalizePlazoCancelacionHoras(row.sifen_plazo_cancelacion_horas),
    has_certificado_password,
    kude_logo_path:
      row.kude_logo_path == null || String(row.kude_logo_path).trim() === ""
        ? null
        : String(row.kude_logo_path).trim(),
    kude_color_primario:
      row.kude_color_primario == null || String(row.kude_color_primario).trim() === ""
        ? null
        : String(row.kude_color_primario).trim().toLowerCase(),
    kude_color_primario_fill:
      row.kude_color_primario_fill == null || String(row.kude_color_primario_fill).trim() === ""
        ? null
        : String(row.kude_color_primario_fill).trim().toLowerCase(),
    kude_logos: normalizeKudeLogos(row.kude_logos),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}
