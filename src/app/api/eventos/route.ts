import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { requireModuleAccess } from "@/lib/modulos/require-module-access";
import { errorResponse, successResponse } from "@/lib/api/response";
import {
  cargarEventos,
  cargarReservas,
  cargarPaquetes,
  cargarParticipantes,
  cargarSalidas,
  borrarFilaEventos,
  guardarEvento,
  guardarPaquete,
  guardarReserva,
  guardarSalida,
} from "@/lib/eventos/eventos-data";

export const dynamic = "force-dynamic";

/** Módulo Eventos — viajes, salidas y reservas de la empresa. */

/** GET — eventos con sus conteos, más salidas y reservas para las pestañas. */
export async function GET(request: Request) {
  const a = await requireModuleAccess(request, "eventos", "Eventos");
  if (!a.ok) return NextResponse.json(errorResponse(a.message), { status: a.status });

  try {
    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    const [eventos, salidas, reservas, participantes, paquetes] = await Promise.all([
      cargarEventos(sb, a.empresaId),
      cargarSalidas(sb, a.empresaId),
      cargarReservas(sb, a.empresaId),
      cargarParticipantes(sb, a.empresaId),
      cargarPaquetes(sb, a.empresaId),
    ]);
    return NextResponse.json(
      successResponse({ eventos, salidas, reservas, participantes, paquetes })
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error"),
      { status: 500 }
    );
  }
}

/**
 * POST — alta o edición de un evento o de una salida.
 * Body: { tipo?: "evento" | "salida", id?, valores }. Sin `tipo` es un evento,
 * que es como venía llamando la pantalla antes de que existieran las salidas.
 */
export async function POST(request: Request) {
  const a = await requireModuleAccess(request, "eventos", "Eventos");
  if (!a.ok) return NextResponse.json(errorResponse(a.message), { status: a.status });

  try {
    const body = (await request.json()) as { tipo?: unknown; id?: unknown; valores?: unknown };
    if (typeof body.valores !== "object" || body.valores === null) {
      return NextResponse.json(errorResponse("Faltan los valores."), { status: 400 });
    }
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : null;
    const valores = body.valores as Record<string, unknown>;

    const sb = await getChatServiceClientForEmpresa(a.empresaId);

    if (body.tipo === "salida") {
      const salida = await guardarSalida(sb, a.empresaId, id, valores);
      return NextResponse.json(successResponse({ salida }));
    }

    if (body.tipo === "paquete") {
      const paquete = await guardarPaquete(sb, a.empresaId, id, valores);
      return NextResponse.json(successResponse({ paquete }));
    }

    if (body.tipo === "reserva") {
      if (!id) return NextResponse.json(errorResponse("Falta la reserva."), { status: 400 });
      const reserva = await guardarReserva(sb, a.empresaId, id, valores);
      return NextResponse.json(successResponse({ reserva }));
    }

    const evento = await guardarEvento(sb, a.empresaId, id, valores);
    return NextResponse.json(successResponse({ evento }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error"),
      { status: 400 }
    );
  }
}

/** DELETE — ?tipo=evento|salida|paquete|reserva&id=… */
export async function DELETE(request: Request) {
  const a = await requireModuleAccess(request, "eventos", "Eventos");
  if (!a.ok) return NextResponse.json(errorResponse(a.message), { status: a.status });

  try {
    const url = new URL(request.url);
    const tipo = url.searchParams.get("tipo");
    const id = url.searchParams.get("id");
    if (!id || !["evento", "salida", "paquete", "reserva"].includes(String(tipo))) {
      return NextResponse.json(errorResponse("Faltan tipo e id."), { status: 400 });
    }
    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    await borrarFilaEventos(sb, a.empresaId, tipo as "evento" | "salida" | "paquete" | "reserva", id);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo borrar."),
      { status: 400 }
    );
  }
}
