import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import {
  empresaDeLaInstancia,
  errorPublico,
  esBot,
  ipDe,
  jsonPublico,
  leerJson,
  preflight,
  rateLimitSuperado,
  textoLimpio,
} from "@/lib/web/publico";

export const dynamic = "force-dynamic";

/**
 * POST /api/web/pedido — pedido de la tienda desde el sitio.
 *
 * PÚBLICO. Queda en `web_pedido` con estado `pendiente`: NO genera venta ni
 * descuenta stock. Una venta en este ERP es una operación cerrada que entra en
 * los reportes; un pedido del sitio es una solicitud sin confirmar. Al
 * confirmarlo desde el ERP se arma el cliente, la venta y el movimiento de
 * stock.
 *
 * Los precios se leen de `productos` por SKU. El cuerpo del pedido solo dice
 * QUÉ y CUÁNTO; el CUÁNTO SALE lo decide el servidor.
 */

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  if (rateLimitSuperado(ipDe(request), 5)) {
    return errorPublico(request, "Demasiados intentos. Probá en un minuto.", 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await leerJson(request);
  } catch (e) {
    return errorPublico(request, e instanceof Error ? e.message : "Pedido inválido.");
  }

  if (esBot(body)) return jsonPublico(request, { ok: true, numero: null });

  const nombre = textoLimpio(body.nombre, 120);
  if (!nombre) return errorPublico(request, "Falta tu nombre.");

  const crudos = Array.isArray(body.items) ? body.items : [];
  if (crudos.length === 0) return errorPublico(request, "El carrito está vacío.");
  if (crudos.length > 50) return errorPublico(request, "Demasiados ítems en un pedido.");

  type Pedido = { sku: string; cantidad: number; talle: string | null };
  const pedidos: Pedido[] = [];
  for (const [i, it] of crudos.entries()) {
    const o = (typeof it === "object" && it !== null ? it : {}) as Record<string, unknown>;
    const sku = textoLimpio(o.sku, 64);
    if (!sku) return errorPublico(request, `Falta el SKU del ítem ${i + 1}.`);
    const cantidad = Math.floor(Number(o.cantidad ?? 1));
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > 99) {
      return errorPublico(request, `Cantidad inválida en el ítem ${i + 1}.`);
    }
    pedidos.push({ sku, cantidad, talle: textoLimpio(o.talle, 20) });
  }

  try {
    const empresaId = await empresaDeLaInstancia();
    const sb = await getChatServiceClientForEmpresa(empresaId);

    // Solo se venden productos activos que además estén publicados en el
    // sitio: si no tiene contenido web cargado, no es parte de la tienda.
    const { data: prods, error: errP } = await sb
      .from("productos")
      .select("id, sku, nombre, precio_venta, activo")
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .in("sku", pedidos.map((p) => p.sku));
    if (errP) throw new Error(errP.message);

    const porSku = new Map<string, Record<string, unknown>>(
      ((prods ?? []) as Record<string, unknown>[]).map((p) => [String(p.sku), p])
    );

    const { data: pub, error: errW } = await sb
      .from("web_producto")
      .select("producto_id")
      .eq("empresa_id", empresaId)
      .eq("publicado", true);
    if (errW) throw new Error(errW.message);
    const publicados = new Set(
      ((pub ?? []) as Record<string, unknown>[]).map((w) => String(w.producto_id))
    );

    let total = 0;
    const noDisponible = pedidos.find((p) => {
      const prod = porSku.get(p.sku);
      return !prod || !publicados.has(String(prod.id));
    });
    if (noDisponible) {
      return errorPublico(request, `El producto ${noDisponible.sku} ya no está disponible.`, 409);
    }

    const items = pedidos.map((p) => {
      const prod = porSku.get(p.sku) as Record<string, unknown>;
      const precio = Number(prod.precio_venta ?? 0);
      const subtotal = precio * p.cantidad;
      total += subtotal;
      return {
        empresa_id: empresaId,
        producto_id: String(prod.id),
        sku: p.sku,
        descripcion: String(prod.nombre ?? p.sku),
        talle: p.talle,
        cantidad: p.cantidad,
        precio_unit: precio,
        subtotal,
      };
    });

    // Correlativo. La función hace un INSERT ... ON CONFLICT DO UPDATE
    // RETURNING, que toma el lock: dos pedidos simultáneos no sacan el mismo
    // número. No hay fallback a max()+1 a propósito — ese sí tiene carrera, y
    // un pedido con número repetido es peor que un pedido rechazado.
    const { data: num, error: errN } = await sb.rpc("web_pedido_siguiente_numero", {
      p_empresa_id: empresaId,
    });
    if (errN) throw new Error(`Correlativo de pedido: ${errN.message}`);
    const numero = Number(num);

    const { data: pedido, error: errPed } = await sb
      .from("web_pedido")
      .insert({
        empresa_id: empresaId,
        numero,
        estado: "pendiente",
        nombre,
        email: textoLimpio(body.email, 160),
        telefono: textoLimpio(body.telefono, 40),
        documento: textoLimpio(body.documento, 40),
        pais: textoLimpio(body.pais, 60),
        comentario: textoLimpio(body.comentario, 1000),
        moneda: "USD",
        total,
        medio_pago: textoLimpio(body.medio_pago, 40),
        user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300),
      })
      .select("id, numero")
      .single();
    if (errPed) throw errPed;

    const pedidoId = String((pedido as Record<string, unknown>).id);
    const { error: errIt } = await sb
      .from("web_pedido_item")
      .insert(items.map((i) => ({ ...i, pedido_id: pedidoId })));
    if (errIt) throw new Error(errIt.message);

    return jsonPublico(request, {
      ok: true,
      numero: Number((pedido as Record<string, unknown>).numero),
      total,
    });
  } catch (e) {
    console.error("[api/web/pedido]", e);
    return errorPublico(request, "No se pudo registrar el pedido.", 500);
  }
}
