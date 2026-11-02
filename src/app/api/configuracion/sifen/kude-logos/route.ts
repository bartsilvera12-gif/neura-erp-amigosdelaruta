import { NextRequest, NextResponse } from "next/server";
import { getSifenConfigSupabaseFromAuth } from "@/lib/sifen/sifen-config-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ensureSifenStorageBucket,
  removeSifenObject,
  SIFEN_STORAGE_BUCKET,
  uploadKudeLogoPng,
} from "@/lib/sifen/sifen-storage";
import { toEmpresaSifenConfigPublicDto } from "@/lib/sifen/sifen-config-response";
import {
  buildKudeLogoAdicionalObjectPath,
  MAX_KUDE_LOGOS,
  normalizarNombreLogo,
  nuevoIdLogo,
  parseKudeLogos,
} from "@/lib/sifen/kude-logos";
import type { KudeLogoDTO } from "@/lib/sifen/types";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 1 MB: suficiente para un logo de cabecera; se embebe en el PDF. */
const MAX_LOGO_BYTES = 1 * 1024 * 1024;

/** Magic bytes PNG: 89 50 4E 47 0D 0A 1A 0A. */
function isPngBuffer(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

async function leerLogosActuales(
  supabase: AppSupabaseClient,
  empresaId: string
): Promise<{ ok: true; logos: KudeLogoDTO[] } | { ok: false; status: number; message: string }> {
  const { data, error } = await supabase
    .from("empresa_sifen_config")
    .select("id, kude_logos_json")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) return { ok: false, status: 400, message: error.message };
  if (!data) {
    return {
      ok: false,
      status: 400,
      message:
        "No hay configuración SIFEN; creá la configuración base antes de cargar logos del KuDE.",
    };
  }
  return { ok: true, logos: parseKudeLogos((data as Record<string, unknown>).kude_logos_json) };
}

/**
 * POST /api/configuracion/sifen/kude-logos
 * Agrega un logo adicional con nombre al KuDE (multipart: `file` PNG, `nombre`).
 * SOLO afecta el PDF/KuDE: no toca XML, firma, SET, CDC ni datos fiscales.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getSifenConfigSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const nombre = normalizarNombreLogo(form?.get("nombre"));
    if (!(file instanceof File) || file.size < 1) {
      return NextResponse.json(
        errorResponse("Se requiere el archivo PNG en el campo multipart `file`."),
        { status: 400 }
      );
    }
    if (!nombre) {
      return NextResponse.json(
        errorResponse("Indicá un nombre para identificar el logo (campo `nombre`)."),
        { status: 400 }
      );
    }
    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json(errorResponse("El logo supera el tamaño máximo (1 MB)."), {
        status: 400,
      });
    }
    const tipo = String(file.type || "").toLowerCase();
    if (tipo && tipo !== "image/png") {
      return NextResponse.json(errorResponse("Solo se aceptan logos PNG."), { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (!isPngBuffer(buf)) {
      return NextResponse.json(errorResponse("El archivo no es un PNG válido."), { status: 400 });
    }

    const current = await leerLogosActuales(supabase, auth.empresa_id);
    if (!current.ok) {
      return NextResponse.json(errorResponse(current.message), { status: current.status });
    }
    if (current.logos.length >= MAX_KUDE_LOGOS) {
      return NextResponse.json(
        errorResponse(`Máximo ${MAX_KUDE_LOGOS} logos adicionales. Eliminá alguno para agregar otro.`),
        { status: 400 }
      );
    }

    const bucketOk = await ensureSifenStorageBucket(supabase);
    if (!bucketOk.ok) {
      return NextResponse.json(errorResponse(`Storage sifen: ${bucketOk.message}`), { status: 500 });
    }

    const id = nuevoIdLogo();
    const objectPath = buildKudeLogoAdicionalObjectPath(auth.empresa_id, id);
    const up = await uploadKudeLogoPng(supabase, objectPath, buf);
    if (!up.ok) {
      return NextResponse.json(errorResponse(`No se pudo subir el logo: ${up.message}`), {
        status: 500,
      });
    }

    const nuevos: KudeLogoDTO[] = [...current.logos, { id, nombre, path: objectPath }];
    const { data: updated, error: errUpd } = await supabase
      .from("empresa_sifen_config")
      .update({ kude_logos_json: nuevos })
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpd || !updated) {
      await removeSifenObject(supabase, objectPath);
      return NextResponse.json(
        errorResponse(errUpd?.message ?? "El logo se subió pero no se pudo registrar; se eliminó del storage."),
        { status: 500 }
      );
    }

    return NextResponse.json(
      successResponse({
        config: toEmpresaSifenConfigPublicDto(updated as Record<string, unknown>),
        logo: { id, nombre, path: objectPath },
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * DELETE /api/configuracion/sifen/kude-logos?logo_id=...
 * Quita un logo adicional (del json y del storage). No toca el logo
 * predeterminado (`kude_logo_path`) ni el XML/firma/SET.
 */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getSifenConfigSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const url = new URL(request.url);
    let logoId = (url.searchParams.get("logo_id") ?? "").trim();
    if (!logoId) {
      const body = (await request.json().catch(() => null)) as { logo_id?: unknown } | null;
      logoId = String(body?.logo_id ?? "").trim();
    }
    if (!logoId) {
      return NextResponse.json(errorResponse("Falta logo_id."), { status: 400 });
    }

    const current = await leerLogosActuales(supabase, auth.empresa_id);
    if (!current.ok) {
      return NextResponse.json(errorResponse(current.message), { status: current.status });
    }
    const objetivo = current.logos.find((l) => l.id === logoId);
    if (!objetivo) {
      return NextResponse.json(errorResponse("El logo indicado no existe."), { status: 404 });
    }

    const restantes = current.logos.filter((l) => l.id !== logoId);
    const { data: updated, error: errUpd } = await supabase
      .from("empresa_sifen_config")
      .update({ kude_logos_json: restantes })
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpd || !updated) {
      return NextResponse.json(
        errorResponse(errUpd?.message ?? "No se pudo actualizar la lista de logos."),
        { status: 500 }
      );
    }

    // El objeto se elimina después de persistir la lista: si falla, queda huérfano
    // pero la factura ya no lo referencia (mejor que perder la referencia con el objeto vivo).
    await removeSifenObject(supabase, objetivo.path).catch(() => {});

    return NextResponse.json(
      successResponse({
        config: toEmpresaSifenConfigPublicDto(updated as Record<string, unknown>),
        storage_bucket: SIFEN_STORAGE_BUCKET,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
