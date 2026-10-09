import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { requireModuleAccess } from "@/lib/modulos/require-module-access";
import { errorResponse, successResponse } from "@/lib/api/response";
import {
  borrarFila,
  cargarColeccion,
  cargarProductosTienda,
  esColeccionWeb,
  guardarFila,
} from "@/lib/web/contenido";

export const dynamic = "force-dynamic";

/**
 * Contenido del sitio público, para la pantalla del módulo Web.
 *
 * Una sola ruta para las cinco colecciones en vez de cinco rutas con el mismo
 * cuerpo. Es seguro porque `coleccion` no se interpola en ningún lado: se
 * valida contra la whitelist de `lib/web/contenido.ts`, que además decide qué
 * columnas son escribibles.
 *
 * Esto es la cara ADMIN, con sesión. La cara pública que consume el sitio es
 * `GET /api/web/catalogo`, que es otra ruta y solo devuelve lo publicado.
 */

async function auth(request: Request) {
  return requireModuleAccess(request, "web", "Web");
}

/** GET — todo el contenido junto: la pantalla lo necesita completo igual. */
export async function GET(request: Request) {
  const a = await auth(request);
  if (!a.ok) return NextResponse.json(errorResponse(a.message), { status: a.status });

  try {
    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    const [productos, motos, faqs, encuentros, config] = await Promise.all([
      cargarProductosTienda(sb, a.empresaId),
      cargarColeccion(sb, a.empresaId, "moto"),
      cargarColeccion(sb, a.empresaId, "faq"),
      cargarColeccion(sb, a.empresaId, "encuentro"),
      cargarColeccion(sb, a.empresaId, "config"),
    ]);
    return NextResponse.json(successResponse({ productos, motos, faqs, encuentros, config }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error"),
      { status: 500 }
    );
  }
}

/** POST — alta o edición de una fila: { coleccion, id?, valores }. */
export async function POST(request: Request) {
  const a = await auth(request);
  if (!a.ok) return NextResponse.json(errorResponse(a.message), { status: a.status });

  try {
    const body = (await request.json()) as {
      coleccion?: unknown;
      id?: unknown;
      valores?: unknown;
    };

    if (!esColeccionWeb(body.coleccion)) {
      return NextResponse.json(errorResponse("Colección inválida."), { status: 400 });
    }
    if (typeof body.valores !== "object" || body.valores === null) {
      return NextResponse.json(errorResponse("Faltan los valores."), { status: 400 });
    }
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : null;

    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    const fila = await guardarFila(
      sb,
      a.empresaId,
      body.coleccion,
      id,
      body.valores as Record<string, unknown>
    );
    return NextResponse.json(successResponse({ fila }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error"),
      { status: 400 }
    );
  }
}

/** DELETE — { coleccion, id }. */
export async function DELETE(request: Request) {
  const a = await auth(request);
  if (!a.ok) return NextResponse.json(errorResponse(a.message), { status: a.status });

  try {
    const body = (await request.json()) as { coleccion?: unknown; id?: unknown };
    if (!esColeccionWeb(body.coleccion)) {
      return NextResponse.json(errorResponse("Colección inválida."), { status: 400 });
    }
    if (typeof body.id !== "string" || !body.id.trim()) {
      return NextResponse.json(errorResponse("Falta el id."), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    await borrarFila(sb, a.empresaId, body.coleccion, body.id.trim());
    return NextResponse.json(successResponse({ borrado: true }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error"),
      { status: 400 }
    );
  }
}
