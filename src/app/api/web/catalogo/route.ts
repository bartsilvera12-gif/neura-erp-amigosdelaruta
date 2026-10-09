import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import {
  empresaDeLaInstancia,
  errorPublico,
  ipDe,
  jsonPublico,
  preflight,
  rateLimitSuperado,
} from "@/lib/web/publico";

export const dynamic = "force-dynamic";

/**
 * GET /api/web/catalogo — lo que el sitio público muestra.
 *
 * PÚBLICO: sin sesión, con CORS acotado a los orígenes del sitio.
 *
 * Devuelve SOLO lo publicado. Un evento en borrador o un producto sin contenido
 * cargado no sale acá, así que el sitio no puede mostrar algo a medio hacer
 * aunque quiera.
 *
 * Va todo en una sola respuesta a propósito: el sitio es una página única que
 * necesita el conjunto completo para renderizar, y una llamada se cachea mejor
 * que seis.
 */

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(request: Request) {
  if (rateLimitSuperado(ipDe(request), 60)) {
    return errorPublico(request, "Demasiados pedidos. Probá en un minuto.", 429);
  }

  try {
    const empresaId = await empresaDeLaInstancia();
    const sb = await getChatServiceClientForEmpresa(empresaId);

    const [eventos, salidas, paquetes, productos, webProductos, motos, faqs, encuentros, config] =
      await Promise.all([
        sb.from("eventos").select("*").eq("empresa_id", empresaId).eq("estado", "publicado").order("orden"),
        sb.from("salidas").select("*").eq("empresa_id", empresaId).neq("estado", "borrador").order("fecha_inicio"),
        sb.from("paquetes").select("*").eq("empresa_id", empresaId).eq("activo", true).order("orden"),
        sb.from("productos").select("id, sku, precio_venta, stock_actual, stock_minimo, imagen_url").eq("empresa_id", empresaId).eq("activo", true),
        sb.from("web_producto").select("*").eq("empresa_id", empresaId).eq("publicado", true).order("orden"),
        sb.from("web_moto").select("*").eq("empresa_id", empresaId).eq("publicado", true).order("orden"),
        sb.from("web_faq").select("*").eq("empresa_id", empresaId).eq("publicado", true).order("orden"),
        sb.from("web_encuentro").select("*").eq("empresa_id", empresaId).eq("publicado", true).order("orden"),
        sb.from("web_config").select("clave, valor").eq("empresa_id", empresaId),
      ]);

    for (const r of [eventos, salidas, paquetes, productos, webProductos, motos, faqs, encuentros, config]) {
      if (r.error) throw new Error(r.error.message);
    }

    type Fila = Record<string, unknown>;
    const comercial = new Map<string, Fila>(
      ((productos.data ?? []) as Fila[]).map((p) => [String(p.id), p])
    );

    // La tienda: el copy sale de `web_producto` y el precio y el stock de
    // `productos`. Nunca al revés — si el precio viniera del contenido web
    // habría dos fuentes de verdad y se desincronizarían.
    const tienda = ((webProductos.data ?? []) as Fila[])
      .map((w) => {
        const p = comercial.get(String(w.producto_id));
        if (!p) return null; // producto dado de baja en Inventario: no se publica
        const stock = Number(p.stock_actual ?? 0);
        const minimo = Number(p.stock_minimo ?? 0);
        return {
          sku: String(p.sku ?? ""),
          precio: Number(p.precio_venta ?? 0),
          img: p.imagen_url ?? null,
          sin_stock: stock <= 0,
          poco_stock: stock > 0 && stock <= minimo,
          nombre: w.nombre,
          descripcion: w.descripcion,
          variantes: w.variantes,
          specs: w.specs,
          galeria: w.galeria,
          categoria: Number(w.categoria_web ?? 0),
          orden: Number(w.orden ?? 0),
        };
      })
      .filter(Boolean);

    // Las salidas y los paquetes se agrupan por evento: el sitio los muestra
    // adentro de la ficha del viaje, no como listas sueltas.
    const porEvento = <T extends Fila>(filas: T[]) => {
      const m = new Map<string, T[]>();
      for (const f of filas) {
        const k = String(f.evento_id ?? "");
        if (!k) continue;
        const actual = m.get(k);
        if (actual) actual.push(f);
        else m.set(k, [f]);
      }
      return m;
    };
    const sPorEvento = porEvento((salidas.data ?? []) as Fila[]);
    const pPorEvento = porEvento((paquetes.data ?? []) as Fila[]);

    const viajes = ((eventos.data ?? []) as Fila[]).map((e) => ({
      ...e,
      salidas: sPorEvento.get(String(e.id)) ?? [],
      paquetes: pPorEvento.get(String(e.id)) ?? [],
    }));

    const configuracion: Record<string, unknown> = {};
    for (const c of (config.data ?? []) as Fila[]) {
      configuracion[String(c.clave)] = c.valor;
    }

    return jsonPublico(request, {
      ok: true,
      generado: new Date().toISOString(),
      viajes,
      tienda,
      motos: motos.data ?? [],
      faqs: faqs.data ?? [],
      encuentros: encuentros.data ?? [],
      config: configuracion,
    });
  } catch (e) {
    // El detalle va al log del servidor, no al navegador de un visitante.
    console.error("[api/web/catalogo]", e);
    return errorPublico(request, "No se pudo cargar el catálogo.", 500);
  }
}
