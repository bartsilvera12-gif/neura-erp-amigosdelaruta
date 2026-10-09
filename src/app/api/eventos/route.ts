import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { requireModuleAccess } from "@/lib/modulos/require-module-access";
import { errorResponse, successResponse } from "@/lib/api/response";
import {
  cargarEventos,
  cargarReservas,
  cargarSalidas,
  guardarEvento,
} from "@/lib/eventos/eventos-data";

export const dynamic = "force-dynamic";

/** Módulo Eventos — viajes, salidas y reservas de la empresa. */

/** GET — eventos con sus conteos, más salidas y reservas para las pestañas. */
export async function GET(request: Request) {
  const a = await requireModuleAccess(request, "eventos", "Eventos");
  if (!a.ok) return NextResponse.json(errorResponse(a.message), { status: a.status });

  try {
    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    const [eventos, salidas, reservas] = await Promise.all([
      cargarEventos(sb, a.empresaId),
      cargarSalidas(sb, a.empresaId),
      cargarReservas(sb, a.empresaId),
    ]);
    return NextResponse.json(successResponse({ eventos, salidas, reservas }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error"),
      { status: 500 }
    );
  }
}

/** POST — alta o edición de un evento: { id?, valores }. */
export async function POST(request: Request) {
  const a = await requireModuleAccess(request, "eventos", "Eventos");
  if (!a.ok) return NextResponse.json(errorResponse(a.message), { status: a.status });

  try {
    const body = (await request.json()) as { id?: unknown; valores?: unknown };
    if (typeof body.valores !== "object" || body.valores === null) {
      return NextResponse.json(errorResponse("Faltan los valores."), { status: 400 });
    }
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : null;

    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    const evento = await guardarEvento(
      sb,
      a.empresaId,
      id,
      body.valores as Record<string, unknown>
    );
    return NextResponse.json(successResponse({ evento }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error"),
      { status: 400 }
    );
  }
}
