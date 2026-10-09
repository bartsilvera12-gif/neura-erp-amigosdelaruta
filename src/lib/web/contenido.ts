import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Contenido del sitio público (amigos-de-la-ruta-web) administrado desde el ERP.
 *
 * Los viajes NO están acá: los maneja el módulo Eventos (`eventos`, `salidas`,
 * `paquetes`, `reservas`…). Esto es solo lo que ese módulo e Inventario no
 * cubren — ver `supabase/instancia/05_web_adr.sql`.
 *
 * Todas las colecciones pasan por el mismo endpoint, así que el nombre de tabla
 * y las columnas escribibles salen SIEMPRE de este mapa: nada que venga del
 * request se interpola en SQL ni se usa como nombre de columna.
 */

export type ColeccionWeb = "producto" | "moto" | "faq" | "encuentro" | "config";

type Definicion = {
  tabla: string;
  /** Columnas que el cliente puede escribir. El resto se ignora en silencio. */
  campos: readonly string[];
  /** Orden de lectura. */
  orden: { columna: string; asc: boolean }[];
  /** `false` para colecciones donde borrar no tiene sentido. */
  permiteBorrar: boolean;
};

const DEFS: Record<ColeccionWeb, Definicion> = {
  // El copy de tienda. El dato comercial (precio, stock, imagen) NO se toca
  // desde acá: vive en `productos` y lo administra Inventario.
  producto: {
    tabla: "web_producto",
    campos: ["producto_id", "nombre", "descripcion", "variantes", "specs", "galeria", "categoria_web", "orden", "publicado"],
    orden: [{ columna: "orden", asc: true }],
    permiteBorrar: true,
  },
  moto: {
    tabla: "web_moto",
    campos: ["nombre", "anio", "descripcion", "imagen_url", "orden", "publicado"],
    orden: [{ columna: "orden", asc: true }],
    permiteBorrar: true,
  },
  faq: {
    tabla: "web_faq",
    campos: ["pregunta", "respuesta", "orden", "publicado"],
    orden: [{ columna: "orden", asc: true }],
    permiteBorrar: true,
  },
  encuentro: {
    tabla: "web_encuentro",
    campos: ["titulo", "descripcion", "imagen_url", "orden", "publicado"],
    orden: [{ columna: "orden", asc: true }],
    permiteBorrar: true,
  },
  // Clave/valor. No se borra: una clave que desaparece deja al sitio sin ese
  // dato y es más difícil de diagnosticar que una con el valor vacío.
  config: {
    tabla: "web_config",
    campos: ["clave", "valor", "nota"],
    orden: [{ columna: "clave", asc: true }],
    permiteBorrar: false,
  },
};

export function esColeccionWeb(x: unknown): x is ColeccionWeb {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(DEFS, x);
}

export function definicionDe(coleccion: ColeccionWeb): Definicion {
  return DEFS[coleccion];
}

/** Deja solo las columnas escribibles de la colección. */
export function filtrarCampos(
  coleccion: ColeccionWeb,
  valores: Record<string, unknown>
): Record<string, unknown> {
  const permitidos = new Set(DEFS[coleccion].campos);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valores ?? {})) {
    if (permitidos.has(k)) out[k] = v;
  }
  return out;
}

export type ProductoTienda = {
  producto_id: string;
  sku: string;
  nombre_erp: string;
  precio_venta: number;
  stock_actual: number;
  stock_minimo: number;
  imagen_url: string | null;
  activo: boolean;
  /** `null` cuando el producto todavía no tiene contenido web cargado. */
  web: Record<string, unknown> | null;
};

/**
 * Productos de Inventario con su contenido web al lado.
 *
 * Se listan TODOS los productos activos, no solo los que ya tienen contenido:
 * la pantalla necesita poder mostrar "este producto todavía no está publicado"
 * para que alguien pueda publicarlo.
 */
export async function cargarProductosTienda(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<ProductoTienda[]> {
  const { data: productos, error: errP } = await sb
    .from("productos")
    .select("id, sku, nombre, precio_venta, stock_actual, stock_minimo, imagen_url, activo")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .order("nombre");
  if (errP) throw new Error(errP.message);

  const { data: web, error: errW } = await sb
    .from("web_producto")
    .select("*")
    .eq("empresa_id", empresaId);
  if (errW) throw new Error(errW.message);

  const porProducto = new Map<string, Record<string, unknown>>();
  for (const w of (web ?? []) as Record<string, unknown>[]) {
    porProducto.set(String(w.producto_id), w);
  }

  return ((productos ?? []) as Record<string, unknown>[]).map((p) => ({
    producto_id: String(p.id),
    sku: String(p.sku ?? ""),
    nombre_erp: String(p.nombre ?? ""),
    precio_venta: Number(p.precio_venta ?? 0),
    stock_actual: Number(p.stock_actual ?? 0),
    stock_minimo: Number(p.stock_minimo ?? 0),
    imagen_url: (p.imagen_url as string | null) ?? null,
    activo: Boolean(p.activo),
    web: porProducto.get(String(p.id)) ?? null,
  }));
}

/** Lee una colección simple (motos, faq, encuentros, config). */
export async function cargarColeccion(
  sb: AppSupabaseClient,
  empresaId: string,
  coleccion: Exclude<ColeccionWeb, "producto">
): Promise<Record<string, unknown>[]> {
  const def = DEFS[coleccion];
  let q = sb.from(def.tabla).select("*").eq("empresa_id", empresaId);
  for (const o of def.orden) q = q.order(o.columna, { ascending: o.asc });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

/**
 * Alta o edición de una fila.
 *
 * `producto` y `config` se tratan como upsert por su clave natural
 * (`producto_id` y `clave`): la pantalla los edita sin conocer el id de la fila,
 * y así dos guardados seguidos no crean duplicados.
 */
export async function guardarFila(
  sb: AppSupabaseClient,
  empresaId: string,
  coleccion: ColeccionWeb,
  id: string | null,
  valores: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const def = DEFS[coleccion];
  const campos = filtrarCampos(coleccion, valores);
  if (Object.keys(campos).length === 0) {
    throw new Error("No hay campos válidos para guardar.");
  }

  if (id) {
    const { data, error } = await sb
      .from(def.tabla)
      .update(campos)
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }

  const fila = { ...campos, empresa_id: empresaId };
  const conflicto =
    coleccion === "producto" ? "producto_id" : coleccion === "config" ? "empresa_id,clave" : null;

  if (conflicto) {
    const { data, error } = await sb
      .from(def.tabla)
      .upsert(fila, { onConflict: conflicto })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }

  const { data, error } = await sb.from(def.tabla).insert(fila).select("*").single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export async function borrarFila(
  sb: AppSupabaseClient,
  empresaId: string,
  coleccion: ColeccionWeb,
  id: string
): Promise<void> {
  const def = DEFS[coleccion];
  if (!def.permiteBorrar) {
    throw new Error(`La colección ${coleccion} no admite borrado.`);
  }
  const { error } = await sb.from(def.tabla).delete().eq("id", id).eq("empresa_id", empresaId);
  if (error) throw new Error(error.message);
}
