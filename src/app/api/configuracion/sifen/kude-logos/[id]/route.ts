import { NextRequest, NextResponse } from "next/server";
import { getSifenConfigSupabaseFromAuth } from "@/lib/sifen/sifen-config-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { removeSifenObject } from "@/lib/sifen/sifen-storage";
import {
  normalizeKudeLogos,
  toEmpresaSifenConfigPublicDto,
} from "@/lib/sifen/sifen-config-response";
import type { KudeLogoEntry } from "@/lib/sifen/types";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/** Lee la config y devuelve la galería normalizada. */
async function cargarLogos(
  supabase: AppSupabaseClient,
  empresaId: string
): Promise<
  | { ok: true; logos: KudeLogoEntry[] }
  | { ok: false; status: number; message: string }
> {
  const { data, error } = await supabase
    .from("empresa_sifen_config")
    .select("id, kude_logos")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) return { ok: false, status: 400, message: error.message };
  if (!data) return { ok: false, status: 404, message: "No hay configuración SIFEN para esta empresa" };
  return { ok: true, logos: normalizeKudeLogos((data as { kude_logos?: unknown }).kude_logos) };
}

/**
 * DELETE /api/configuracion/sifen/kude-logos/[id]
 * Quita un logo de la galería y borra su PNG del storage. Si era el
 * predeterminado y quedan otros, el primero pasa a predeterminado.
 * SOLO afecta KuDE/PDF.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getSifenConfigSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const { id } = await params;
    const logoId = String(id ?? "").trim();

    const cargada = await cargarLogos(supabase, auth.empresa_id);
    if (!cargada.ok) {
      return NextResponse.json(errorResponse(cargada.message), { status: cargada.status });
    }

    const objetivo = cargada.logos.find((l) => l.id === logoId);
    if (!objetivo) {
      return NextResponse.json(errorResponse("Logo no encontrado en la galería"), { status: 404 });
    }

    let restantes = cargada.logos.filter((l) => l.id !== logoId);
    if (objetivo.predeterminado && restantes.length > 0 && !restantes.some((l) => l.predeterminado)) {
      restantes = restantes.map((l, i) => ({ ...l, predeterminado: i === 0 }));
    }

    const { data: updated, error: errUpd } = await supabase
      .from("empresa_sifen_config")
      .update({ kude_logos: restantes })
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpd || !updated) {
      return NextResponse.json(
        errorResponse(errUpd?.message ?? "No se pudo actualizar la galería de logos"),
        { status: 500 }
      );
    }

    // El objeto en storage se borra después de persistir la metadata.
    await removeSifenObject(supabase, objetivo.path);

    return NextResponse.json(
      successResponse({
        config: toEmpresaSifenConfigPublicDto(updated as Record<string, unknown>),
        logos: restantes,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * PATCH /api/configuracion/sifen/kude-logos/[id]
 * Body JSON: { predeterminado?: true, nombre?: string }.
 * Marca este logo como predeterminado (desmarca los demás) y/o lo renombra.
 * SOLO afecta KuDE/PDF.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getSifenConfigSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const { id } = await params;
    const logoId = String(id ?? "").trim();

    const body = (await request.json().catch(() => null)) as
      | { predeterminado?: unknown; nombre?: unknown }
      | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(errorResponse("Body JSON inválido"), { status: 400 });
    }

    const cargada = await cargarLogos(supabase, auth.empresa_id);
    if (!cargada.ok) {
      return NextResponse.json(errorResponse(cargada.message), { status: cargada.status });
    }
    if (!cargada.logos.some((l) => l.id === logoId)) {
      return NextResponse.json(errorResponse("Logo no encontrado en la galería"), { status: 404 });
    }

    const quierePredeterminado = body.predeterminado === true;
    const nuevoNombre =
      typeof body.nombre === "string" ? body.nombre.trim().slice(0, 60) : undefined;

    const logos = cargada.logos.map((l) => {
      const esObjetivo = l.id === logoId;
      return {
        ...l,
        nombre: esObjetivo && nuevoNombre !== undefined && nuevoNombre !== "" ? nuevoNombre : l.nombre,
        predeterminado: quierePredeterminado ? esObjetivo : l.predeterminado,
      };
    });

    const { data: updated, error: errUpd } = await supabase
      .from("empresa_sifen_config")
      .update({ kude_logos: logos })
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpd || !updated) {
      return NextResponse.json(
        errorResponse(errUpd?.message ?? "No se pudo actualizar la galería de logos"),
        { status: 500 }
      );
    }

    return NextResponse.json(
      successResponse({
        config: toEmpresaSifenConfigPublicDto(updated as Record<string, unknown>),
        logos,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
