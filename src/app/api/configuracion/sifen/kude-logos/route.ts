import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSifenConfigSupabaseFromAuth } from "@/lib/sifen/sifen-config-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  buildKudeLogoByIdObjectPath,
  ensureSifenStorageBucket,
  removeSifenObject,
  SIFEN_STORAGE_BUCKET,
  uploadKudeLogoPng,
} from "@/lib/sifen/sifen-storage";
import {
  normalizeKudeLogos,
  toEmpresaSifenConfigPublicDto,
} from "@/lib/sifen/sifen-config-response";
import type { KudeLogoEntry } from "@/lib/sifen/types";

/** Tamaño máximo del PNG (≤ 1 MB), igual que el logo único legacy. */
const MAX_LOGO_BYTES = 1 * 1024 * 1024;
/** Tope de logos por empresa para evitar galerías desmedidas. */
const MAX_LOGOS = 10;

/** Magic bytes mínimos para PNG: 89 50 4E 47 0D 0A 1A 0A. */
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

/**
 * GET /api/configuracion/sifen/kude-logos
 * Lista la galería de logos KuDE de la empresa. Solo metadata (el PNG vive en
 * el bucket privado `sifen`). No toca XML/firma/SET.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getSifenConfigSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    // "*" para tolerar schemas sin la columna `kude_logos` (devuelve []).
    const { data, error } = await supabase
      .from("empresa_sifen_config")
      .select("*")
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    const logos = normalizeKudeLogos((data as { kude_logos?: unknown } | null)?.kude_logos);
    return NextResponse.json(successResponse({ logos }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/configuracion/sifen/kude-logos
 * Sube un PNG (≤ 1 MB) a la galería. Multipart: `file` (image/png) y `nombre`.
 * El primer logo queda como predeterminado. SOLO afecta KuDE/PDF.
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
    const nombreRaw = form?.get("nombre");
    if (!(file instanceof File) || file.size < 1) {
      return NextResponse.json(
        errorResponse("Se requiere el archivo PNG en el campo multipart `file`"),
        { status: 400 }
      );
    }
    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json(
        errorResponse("El logo supera el tamaño máximo permitido (1 MB)"),
        { status: 400 }
      );
    }
    const tipo = String(file.type || "").toLowerCase();
    if (tipo && tipo !== "image/png") {
      return NextResponse.json(
        errorResponse("Solo se aceptan logos en formato PNG (Content-Type image/png)"),
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (!isPngBuffer(buf)) {
      return NextResponse.json(
        errorResponse("El archivo no es un PNG válido (encabezado magic mismatch)"),
        { status: 400 }
      );
    }

    const nombre = (typeof nombreRaw === "string" ? nombreRaw : "").trim().slice(0, 60) || "Logo";

    const { data: configRow, error: errCfg } = await supabase
      .from("empresa_sifen_config")
      .select("*")
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errCfg) {
      return NextResponse.json(errorResponse(errCfg.message), { status: 400 });
    }
    if (!configRow) {
      return NextResponse.json(
        errorResponse(
          "No hay configuración SIFEN; cree la fila con POST /api/configuracion/sifen antes de subir logos del KuDE"
        ),
        { status: 400 }
      );
    }

    const existentes = normalizeKudeLogos((configRow as { kude_logos?: unknown }).kude_logos);
    if (existentes.length >= MAX_LOGOS) {
      return NextResponse.json(
        errorResponse(`Se alcanzó el máximo de ${MAX_LOGOS} logos. Elimine uno antes de subir otro.`),
        { status: 400 }
      );
    }

    const bucketOk = await ensureSifenStorageBucket(supabase);
    if (!bucketOk.ok) {
      return NextResponse.json(errorResponse(`Storage sifen: ${bucketOk.message}`), {
        status: 500,
      });
    }

    const logoId = randomUUID();
    const objectPath = buildKudeLogoByIdObjectPath(auth.empresa_id, logoId);
    const up = await uploadKudeLogoPng(supabase, objectPath, buf);
    if (!up.ok) {
      return NextResponse.json(errorResponse(`No se pudo subir el logo: ${up.message}`), {
        status: 500,
      });
    }

    const nuevo: KudeLogoEntry = {
      id: logoId,
      nombre,
      path: objectPath,
      // Primer logo de la galería → predeterminado.
      predeterminado: existentes.length === 0,
    };
    const logos = [...existentes, nuevo];

    const { data: updated, error: errUpd } = await supabase
      .from("empresa_sifen_config")
      .update({ kude_logos: logos })
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpd || !updated) {
      await removeSifenObject(supabase, objectPath);
      return NextResponse.json(
        errorResponse(
          errUpd?.message ??
            "El archivo se subió pero no se pudo actualizar kude_logos; el objeto en storage fue eliminado."
        ),
        { status: 500 }
      );
    }

    return NextResponse.json(
      successResponse({
        config: toEmpresaSifenConfigPublicDto(updated as Record<string, unknown>),
        logo: nuevo,
        logos,
        storage_bucket: SIFEN_STORAGE_BUCKET,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
