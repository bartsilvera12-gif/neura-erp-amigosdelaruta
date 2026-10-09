import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { requireModuleAccess } from "@/lib/modulos/require-module-access";
import { errorResponse, successResponse } from "@/lib/api/response";
import {
  MAX_BYTES,
  MIME_PERMITIDOS,
  asegurarBucket,
  construirPath,
  esColeccionImagen,
  urlPublica,
} from "@/lib/web/imagenes";

export const dynamic = "force-dynamic";

/**
 * POST /api/web/imagen — sube una imagen del sitio y devuelve su URL pública.
 *
 * CON SESIÓN: la usan las pantallas de los módulos Web y Eventos. Quien sube
 * tiene que tener el módulo correspondiente; no es una ruta pública.
 *
 * Devuelve la URL y no persiste nada: la pantalla la pone en el campo
 * (`imagen_url`, `portada_url`, `galeria`) y guarda la fila como cualquier
 * otro cambio. Así subir una foto y descartar la edición no deja la fila
 * apuntando a algo que el usuario no confirmó.
 *
 * Multipart: `archivo`, `coleccion` (evento|moto|encuentro|producto), `id`.
 */
export async function POST(request: Request) {
  // El módulo Eventos sube portadas y el módulo Web el resto: alcanza con
  // tener cualquiera de los dos.
  let auth = await requireModuleAccess(request, "web", "Web");
  if (!auth.ok) {
    const alt = await requireModuleAccess(request, "eventos", "Eventos");
    if (alt.ok) auth = alt;
    else return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const form = await request.formData();
    const archivo = form.get("archivo");
    const coleccion = form.get("coleccion");
    const idFila = String(form.get("id") ?? "").trim();

    if (!(archivo instanceof File)) {
      return NextResponse.json(errorResponse("Falta el archivo."), { status: 400 });
    }
    if (!esColeccionImagen(coleccion)) {
      return NextResponse.json(errorResponse("Colección inválida."), { status: 400 });
    }
    if (!idFila) {
      return NextResponse.json(
        errorResponse("Falta el id de la fila. Guardá primero y después subí la imagen."),
        { status: 400 }
      );
    }
    if (!MIME_PERMITIDOS[archivo.type]) {
      return NextResponse.json(
        errorResponse(`Formato no permitido (${archivo.type || "desconocido"}). Usá JPG, PNG, WebP o AVIF.`),
        { status: 415 }
      );
    }
    if (archivo.size > MAX_BYTES) {
      return NextResponse.json(
        errorResponse(`La imagen pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB; el máximo son ${MAX_BYTES / 1024 / 1024} MB.`),
        { status: 413 }
      );
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    await asegurarBucket(sb);

    const path = construirPath(auth.empresaId, coleccion, idFila, archivo.type);
    const { error } = await sb.storage
      .from("web-imagenes")
      .upload(path, archivo, { contentType: archivo.type, upsert: false });
    if (error) throw new Error(error.message);

    return NextResponse.json(successResponse({ path, url: urlPublica(sb, path) }));
  } catch (e) {
    console.error("[api/web/imagen]", e);
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo subir la imagen."),
      { status: 500 }
    );
  }
}
