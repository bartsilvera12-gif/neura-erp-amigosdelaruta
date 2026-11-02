/**
 * Actividades económicas del emisor (SIFEN gEmis.gActEco) y tipo de transacción
 * comercial (gOpeCom.iTipTra). Compartido entre validación de config, armado del
 * payload y generación de XML.
 *
 * SIFEN permite declarar MÁS DE UNA actividad económica en el mismo documento:
 * se repite el grupo gActEco. La actividad PRINCIPAL del RUC va primero y las
 * SECUNDARIAS a continuación (hasta el tope del manual técnico). Todos los
 * códigos y descripciones deben coincidir con el catálogo SET / la constancia
 * del RUC (error 1261 si no).
 */

export interface ActividadEconomica {
  codigo: string;
  descripcion: string;
}

/** Tope defensivo de grupos gActEco en un mismo DE (principal + secundarias). */
export const MAX_ACTIVIDADES_ECONOMICAS = 9;

/** Normaliza y valida UN par (código, descripción) de actividad económica. */
export function normalizarActividad(
  codigoRaw: unknown,
  descRaw: unknown
): { ok: true; actividad: ActividadEconomica } | { ok: false; error: string } {
  const codigo = String(codigoRaw ?? "").trim();
  const descripcion = String(descRaw ?? "").trim();
  if (!codigo) {
    return { ok: false, error: "Falta el código de actividad económica (cActEco)." };
  }
  if (!/^\d{4,8}$/.test(codigo)) {
    return { ok: false, error: `Código de actividad «${codigo}» inválido: debe ser numérico de 4 a 8 dígitos (catálogo SET).` };
  }
  if (!descripcion) {
    return { ok: false, error: `Falta la descripción de la actividad económica ${codigo} (dDesActEco).` };
  }
  if (descripcion.length > 600) {
    return { ok: false, error: `La descripción de la actividad ${codigo} es demasiado larga.` };
  }
  return { ok: true, actividad: { codigo, descripcion } };
}

/**
 * Normaliza la lista de actividades SECUNDARIAS (arreglo persistido en
 * `empresa_sifen_config.actividades_economicas_json`). Entrada laxa (puede
 * venir como string JSON del shim PG o como arreglo), salida tipada.
 *
 * - Descarta entradas vacías.
 * - No lanza por duplicados contra la principal; ese filtrado se hace al armar
 *   el XML (la secundaria igual a la principal simplemente no se re-emite).
 */
export function parseActividadesSecundarias(
  raw: unknown
): { ok: true; actividades: ActividadEconomica[] } | { ok: false; error: string } {
  if (raw == null || raw === "") return { ok: true, actividades: [] };
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return { ok: false, error: "actividades_economicas_json no es JSON válido." };
    }
  }
  if (!Array.isArray(arr)) {
    return { ok: false, error: "Las actividades económicas secundarias deben ser una lista." };
  }
  const out: ActividadEconomica[] = [];
  for (const item of arr) {
    const o = (item ?? {}) as Record<string, unknown>;
    const codigo = String(o.codigo ?? o.cActEco ?? "").trim();
    const descripcion = String(o.descripcion ?? o.dDesActEco ?? "").trim();
    if (!codigo && !descripcion) continue; // fila vacía: se ignora
    const n = normalizarActividad(codigo, descripcion);
    if (!n.ok) return { ok: false, error: n.error };
    out.push(n.actividad);
  }
  if (out.length > MAX_ACTIVIDADES_ECONOMICAS - 1) {
    return {
      ok: false,
      error: `Demasiadas actividades secundarias: máximo ${MAX_ACTIVIDADES_ECONOMICAS - 1} además de la principal.`,
    };
  }
  return { ok: true, actividades: out };
}

/**
 * Combina principal + secundarias para emitir en el XML, sin repetir códigos.
 * La principal queda SIEMPRE primera.
 */
export function actividadesParaEmision(
  principal: ActividadEconomica,
  secundarias: ActividadEconomica[]
): ActividadEconomica[] {
  const vistos = new Set<string>([principal.codigo]);
  const out: ActividadEconomica[] = [principal];
  for (const a of secundarias) {
    if (vistos.has(a.codigo)) continue;
    vistos.add(a.codigo);
    out.push(a);
    if (out.length >= MAX_ACTIVIDADES_ECONOMICAS) break;
  }
  return out;
}

// ─── Tipo de transacción comercial (gOpeCom.iTipTra) ────────────────────────

export type TipoTransaccionSifen = 1 | 2 | 3;

/**
 * Descripciones oficiales (dDesTipTra) de DE_Types_v150.xsd para los tipos que
 * el usuario puede elegir al facturar:
 *   1 = Venta de mercadería
 *   2 = Prestación de servicios
 *   3 = Mixto (Venta de mercadería y servicios)
 */
export const DES_TIPO_TRANSACCION: Record<TipoTransaccionSifen, string> = {
  1: "Venta de mercadería",
  2: "Prestación de servicios",
  3: "Mixto (Venta de mercadería y servicios)",
};

/** Etiquetas cortas para la UI de la caja. */
export const LABEL_TIPO_TRANSACCION: Record<TipoTransaccionSifen, string> = {
  1: "Mercaderías",
  2: "Servicios",
  3: "Mixto",
};

/** Normaliza un valor laxo a 1|2|3; cualquier otra cosa (incluido null) → 1. */
export function normalizarTipoTransaccion(raw: unknown): TipoTransaccionSifen {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? "").trim(), 10);
  return n === 2 || n === 3 ? (n as TipoTransaccionSifen) : 1;
}
