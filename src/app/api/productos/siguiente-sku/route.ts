import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { siguienteSkuPg } from "@/lib/inventario/server/productos-pg";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/productos/siguiente-sku
 *
 * Vista previa del SKU que se asignará si el alta deja el campo vacío. Es solo una
 * sugerencia: el número definitivo se calcula al insertar (POST /api/productos).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const sku = await siguienteSkuPg(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ sku }));
  } catch (err) {
    console.error("[/api/productos/siguiente-sku]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo calcular el SKU."), { status: 500 });
  }
}
