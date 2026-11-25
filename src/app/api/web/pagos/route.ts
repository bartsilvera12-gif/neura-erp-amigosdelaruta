import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { configBancard } from "@/lib/bancard/cliente";
import { consultarPagoEnBancard, devolverPago, ErrorPago, ultimosPagos } from "@/lib/bancard/pagos";
import { requireModuleAccess } from "@/lib/modulos/require-module-access";

export const dynamic = "force-dynamic";

/**
 * /api/web/pagos — pagos con tarjeta del sitio, cara ADMIN (con sesión y acceso al módulo Web).
 * La cara pública es /api/web/pago (sin "s").
 *
 * GET               → los últimos 50 pagos.
 * GET ?id=<uuid>    → le pregunta a Bancard cómo está ese pago (get_confirmation) y, si había algo sin anotar, lo
 *                     anota. Es también el ítem "Recibimos pedido de confirmación del comercio" de la certificación.
 * POST { id, accion: "devolver" } → rollback en Bancard y lo deshace en el ERP. Sólo el mismo día del cobro.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fallo = (mensaje: string, status: number) => NextResponse.json(errorResponse(mensaje), { status });

export async function GET(request: Request) {
  const a = await requireModuleAccess(request, "web", "Web");
  if (!a.ok) return fallo(a.message, a.status);

  const id = new URL(request.url).searchParams.get("id");
  try {
    if (!id) return NextResponse.json(successResponse({ pagos: await ultimosPagos(a.empresaId) }));
    if (!UUID.test(id)) return fallo("Pago inválido.", 400);
    const cfg = configBancard();
    if (!cfg) return fallo("Bancard no está configurado (faltan las variables BANCARD_*).", 409);
    const r = await consultarPagoEnBancard(cfg, a.empresaId, id);
    return NextResponse.json(successResponse({ consulta: r }));
  } catch (e) {
    if (e instanceof ErrorPago) return fallo(e.message, e.status);
    console.error("[api/web/pagos GET]", e);
    return fallo(e instanceof Error ? e.message : "Error", 422);
  }
}

export async function POST(request: Request) {
  const a = await requireModuleAccess(request, "web", "Web");
  if (!a.ok) return fallo(a.message, a.status);

  const body = (await request.json().catch(() => ({}))) as { id?: unknown; accion?: unknown };
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!id) return fallo("Pago inválido.", 400);
  if (body.accion !== "devolver") return fallo("Acción desconocida.", 400);

  const cfg = configBancard();
  if (!cfg) return fallo("Bancard no está configurado (faltan las variables BANCARD_*).", 409);
  try {
    const r = await devolverPago(cfg, a.empresaId, id);
    console.info("[bancard] devolución", id, r.estado, "por", a.email ?? a.usuarioCatalogId);
    return NextResponse.json(successResponse(r));
  } catch (e) {
    if (e instanceof ErrorPago) return fallo(e.message, e.status);
    console.error("[api/web/pagos POST]", e);
    return fallo(e instanceof Error ? e.message : "Error", 422);
  }
}
