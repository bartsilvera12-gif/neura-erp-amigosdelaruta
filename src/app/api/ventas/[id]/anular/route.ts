import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getFacturasServiceClientForEmpresa } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { anularVentaPg } from "@/lib/ventas/server/anular-venta-pg";
import { evaluarAnulacionFactura } from "@/lib/facturacion/anulacion-rules";

export const dynamic = "force-dynamic";

/**
 * POST /api/ventas/:id/anular — devuelve el stock y marca la venta anulada.
 *
 * Si la venta generó una factura, se decide con las mismas reglas que usa la
 * anulación de facturas (`evaluarAnulacionFactura`): una factura con pagos
 * imputados o con documento electrónico aprobado por la SET no se anula acá.
 * Eso no es una restricción del ERP: un documento que la SET aprobó existe, y
 * lo que corresponde es cancelarlo ante la SET o emitir una nota de crédito.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getUserAndEmpresa(request);
    if (!auth) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { id: ventaId } = await params;
    if (!ventaId) {
      return NextResponse.json(errorResponse("Falta la venta."), { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
    /*
     * El motivo es obligatorio y con algo de contenido: una anulación mueve
     * stock y deja una venta sin efecto, y dentro de un mes nadie se acuerda
     * por qué. Cinco caracteres no garantizan una buena explicación, pero
     * descartan el "a" de apuro.
     */
    if (motivo.length < 5) {
      return NextResponse.json(
        errorResponse("Escribí el motivo de la anulación (al menos 5 caracteres)."),
        { status: 400 }
      );
    }

    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const sb = await getFacturasServiceClientForEmpresa(auth.empresa_id);

    const { data: ventaRow, error: errVenta } = await sb
      .from("ventas")
      .select("id, estado, factura_id")
      .eq("id", ventaId)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();
    if (errVenta) throw new Error(errVenta.message);
    if (!ventaRow) {
      return NextResponse.json(errorResponse("La venta no existe."), { status: 404 });
    }
    const venta = ventaRow as { id: string; estado: string | null; factura_id?: string | null };
    if (String(venta.estado ?? "") === "anulada") {
      return NextResponse.json(errorResponse("La venta ya fue anulada."), { status: 409 });
    }

    const facturaId = venta.factura_id ?? null;

    if (facturaId) {
      const [facQ, feQ, pagosQ] = await Promise.all([
        sb.from("facturas").select("estado").eq("id", facturaId).eq("empresa_id", auth.empresa_id).maybeSingle(),
        sb.from("factura_electronica").select("estado_sifen").eq("factura_id", facturaId).eq("empresa_id", auth.empresa_id).maybeSingle(),
        sb.from("pagos").select("id", { count: "exact", head: true }).eq("factura_id", facturaId).eq("empresa_id", auth.empresa_id),
      ]);
      if (facQ.error) throw new Error(facQ.error.message);

      const decision = evaluarAnulacionFactura({
        estadoFactura: (facQ.data as { estado?: string | null } | null)?.estado ?? null,
        pagosCount: pagosQ.count ?? 0,
        estadoSifen: (feQ.data as { estado_sifen?: string | null } | null)?.estado_sifen ?? null,
      });

      if (!decision.puede_anular) {
        return NextResponse.json(
          errorResponse(`No se puede anular esta venta. ${decision.motivo_bloqueo}`),
          { status: 409 }
        );
      }
    }

    const r = await anularVentaPg({
      schema,
      empresaId: auth.empresa_id,
      ventaId,
      motivo,
      facturaId,
      anuladaPor: auth.usuarioCatalogId ?? null,
    });

    return NextResponse.json(successResponse(r));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo anular la venta.";
    console.error("[/api/ventas/[id]/anular]", msg);
    const status = msg.includes("ya fue anulada") || msg.includes("no existe") ? 409 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
