import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { deleteUbicacion, updateUbicacion } from "@/lib/inventario/server/catalogos-pg";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";

export async function PATCH(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Parameters<typeof updateUbicacion>[3] = {};
    if (body.nombre !== undefined) patch.nombre = normalizeUpperText(body.nombre);
    if (body.codigo !== undefined) patch.codigo = normalizeUpperNullable(body.codigo);
    if (body.tipo !== undefined) patch.tipo = String(body.tipo);
    if (body.parent_id !== undefined) patch.parent_id = body.parent_id == null ? null : String(body.parent_id);
    if (body.descripcion !== undefined) patch.descripcion = normalizeUpperNullable(body.descripcion);
    if (body.activo !== undefined) patch.activo = body.activo === true;
    const row = await updateUbicacion(schema, ctx.auth.empresa_id, id, patch);
    if (!row) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ ubicacion: row }));
  } catch (err) {
    console.error("[/api/inventario/ubicaciones/[id] PATCH]", err);
    return NextResponse.json(errorResponse("No se pudo actualizar la ubicación."), { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const r = await deleteUbicacion(schema, ctx.auth.empresa_id, id);
    if (r.ok) return NextResponse.json(successResponse({ id }));
    if (r.motivo === "no_existe") return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    const partes: string[] = [];
    if (r.conStock > 0) partes.push(`tiene stock de ${r.conStock} producto${r.conStock === 1 ? "" : "s"}`);
    if (r.productos > 0) partes.push(`es la ubicación principal de ${r.productos} producto${r.productos === 1 ? "" : "s"}`);
    if (r.sububicaciones > 0) partes.push(`tiene ${r.sububicaciones} sub-ubicación${r.sububicaciones === 1 ? "" : "es"}`);
    return NextResponse.json(
      errorResponse(
        `No se puede borrar: ${partes.join(", ")}. Mové el stock y reasigná los productos primero, o desactivala.`
      ),
      { status: 409 }
    );
  } catch (err) {
    console.error("[/api/inventario/ubicaciones/[id] DELETE]", err);
    return NextResponse.json(errorResponse("No se pudo borrar la ubicación."), { status: 500 });
  }
}
