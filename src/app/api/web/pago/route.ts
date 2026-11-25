import { configBancard } from "@/lib/bancard/cliente";
import { abrirPago, ErrorPago, estadoParaElSitio } from "@/lib/bancard/pagos";
import {
  empresaDeLaInstancia,
  errorPublico,
  ipDe,
  jsonPublico,
  leerJson,
  preflight,
  rateLimitSuperado,
} from "@/lib/web/publico";

export const dynamic = "force-dynamic";

/**
 * /api/web/pago — pago con tarjeta (Bancard) desde el sitio. PÚBLICO.
 *
 * POST { tipo: "reserva" | "pedido", id }  → abre el pago y devuelve el process_id para dibujar el formulario de
 *   Bancard. El monto NO viene del navegador: lo calcula el servidor (seña de la reserva o total del pedido).
 * GET  ?id=<uuid del pago>                → cómo terminó, para la pantalla de resultado.
 *
 * Los ids son uuid, no el código de reserva ni el número de pedido: esos son correlativos y se adivinan.
 *
 * Ningún error con mensaje sale con 5xx: el proxy delante del ERP reemplaza el cuerpo de un 5xx por una página suya
 * sin CORS, y el navegador sólo ve "Failed to fetch". Por eso 409/422.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  if (rateLimitSuperado(ipDe(request), 8)) {
    return errorPublico(request, "Demasiados intentos. Probá en un minuto.", 429);
  }
  const cfg = configBancard();
  if (!cfg) return errorPublico(request, "El pago con tarjeta no está disponible.", 409);

  let body: Record<string, unknown>;
  try {
    body = await leerJson(request);
  } catch (e) {
    return errorPublico(request, e instanceof Error ? e.message : "Pedido inválido.");
  }
  const tipo = body.tipo === "reserva" || body.tipo === "pedido" ? body.tipo : null;
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!tipo || !id) return errorPublico(request, "Falta qué pagar.");

  try {
    const empresaId = await empresaDeLaInstancia();
    const p = await abrirPago(cfg, empresaId, { tipo, id });
    return jsonPublico(request, {
      ok: true,
      pago_id: p.pagoId,
      process_id: p.processId,
      script: p.scriptUrl,
      monto_gs: p.montoGs,
      descripcion: p.descripcion,
    });
  } catch (e) {
    if (e instanceof ErrorPago) return errorPublico(request, e.message, e.status);
    console.error("[api/web/pago]", e);
    return errorPublico(request, "No se pudo abrir el pago con tarjeta.", 422);
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return errorPublico(request, "Pago inválido.");
  if (rateLimitSuperado(ipDe(request), 60)) {
    return errorPublico(request, "Demasiados intentos. Probá en un minuto.", 429);
  }
  try {
    const empresaId = await empresaDeLaInstancia();
    const r = await estadoParaElSitio(configBancard(), empresaId, id);
    if (!r) return errorPublico(request, "Ese pago no existe.", 404);
    return jsonPublico(request, {
      ok: true,
      estado: r.estado,
      numero: r.numero,
      monto_gs: r.montoGs,
      descripcion: r.descripcion,
      respuesta: r.respuesta,
      fecha: r.fecha,
    });
  } catch (e) {
    console.error("[api/web/pago GET]", e);
    return errorPublico(request, "No se pudo consultar el pago.", 422);
  }
}
