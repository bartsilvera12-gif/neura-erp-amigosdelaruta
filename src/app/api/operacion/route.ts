import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { requireModuleAccess } from "@/lib/modulos/require-module-access";
import { errorResponse, successResponse } from "@/lib/api/response";
import {
  COSTO_CATEGORIAS,
  TAREA_CATEGORIAS,
  TAREA_ESTADOS,
  cargarOperacion,
} from "@/lib/operacion/operacion-data";

export const dynamic = "force-dynamic";

/**
 * Operación de las salidas: tareas previas al viaje y costos.
 *
 * Usa el permiso del módulo `proyectos`, que es el lugar que ocupa en el menú:
 * reemplaza a aquel tablero sin tocar `empresa_modulos`.
 */

const SLUG = "proyectos";
const ETIQUETA = "Operación";

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const enLista = (v: unknown, lista: readonly { value: string }[]): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return lista.some((x) => x.value === t) ? t : null;
};
const monto = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** GET — salidas con su resumen, más las tareas y los costos para el detalle. */
export async function GET(request: Request) {
  const a = await requireModuleAccess(request, SLUG, ETIQUETA);
  if (!a.ok) return NextResponse.json(errorResponse(a.message), { status: a.status });

  try {
    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    const datos = await cargarOperacion(sb, a.empresaId);
    return NextResponse.json(successResponse(datos));
  } catch (e) {
    console.error("[api/operacion GET]", e);
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo cargar la operación."),
      { status: 500 }
    );
  }
}

/**
 * POST — alta o edición de una tarea o un costo.
 * Body: { tipo: "tarea" | "costo", id?, salida_id, ...campos }
 */
export async function POST(request: Request) {
  const a = await requireModuleAccess(request, SLUG, ETIQUETA);
  if (!a.ok) return NextResponse.json(errorResponse(a.message), { status: a.status });

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json(errorResponse("Body inválido."), { status: 400 });

    const tipo = body.tipo === "costo" ? "costo" : body.tipo === "tarea" ? "tarea" : null;
    if (!tipo) return NextResponse.json(errorResponse("Falta el tipo."), { status: 400 });

    const id = texto(body.id, 64);
    const salidaId = texto(body.salida_id, 64);
    if (!id && !salidaId) {
      return NextResponse.json(errorResponse("Falta la salida."), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    const tabla = tipo === "tarea" ? "salida_tareas" : "salida_costos";

    /*
     * La salida se valida contra la empresa antes de escribir: `salida_id` viene
     * del navegador y sin esta comprobación se podría colgar una tarea de la
     * salida de otra empresa. La RLS protege la fila nueva, no a quién apunta.
     */
    if (salidaId) {
      const { data: salida, error } = await sb
        .from("salidas")
        .select("id")
        .eq("empresa_id", a.empresaId)
        .eq("id", salidaId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!salida) {
        return NextResponse.json(errorResponse("Esa salida no existe."), { status: 404 });
      }
    }

    const fila: Record<string, unknown> = { empresa_id: a.empresaId };
    if (salidaId) fila.salida_id = salidaId;

    if (tipo === "tarea") {
      const titulo = texto(body.titulo, 200);
      if (!id && !titulo) {
        return NextResponse.json(errorResponse("La tarea necesita un título."), { status: 400 });
      }
      if (titulo) fila.titulo = titulo;
      const cat = enLista(body.categoria, TAREA_CATEGORIAS);
      if (cat) fila.categoria = cat;
      const estado = enLista(body.estado, TAREA_ESTADOS);
      if (estado) {
        fila.estado = estado;
        // Queda la marca de cuándo se dio por hecha; al reabrirla se limpia.
        fila.completada_at = estado === "hecha" ? new Date().toISOString() : null;
      }
      if (body.fecha_limite !== undefined) fila.fecha_limite = texto(body.fecha_limite, 10);
      if (body.nota !== undefined) fila.nota = texto(body.nota, 2000);
      if (body.responsable_id !== undefined) fila.responsable_id = texto(body.responsable_id, 64);
      if (body.orden !== undefined) fila.orden = Number(body.orden) || 0;
    } else {
      const concepto = texto(body.concepto, 200);
      if (!id && !concepto) {
        return NextResponse.json(errorResponse("El costo necesita un concepto."), { status: 400 });
      }
      if (concepto) fila.concepto = concepto;
      const cat = enLista(body.categoria, COSTO_CATEGORIAS);
      if (cat) fila.categoria = cat;
      if (body.monto_estimado !== undefined) {
        const m = monto(body.monto_estimado);
        if (m === null) {
          return NextResponse.json(errorResponse("El monto estimado no es válido."), { status: 400 });
        }
        fila.monto_estimado = m;
      }
      if (body.monto_real !== undefined) {
        // Vaciarlo vuelve la línea a "sin facturar", y el margen usa el estimado.
        fila.monto_real = body.monto_real === "" || body.monto_real === null ? null : monto(body.monto_real);
      }
      const moneda = texto(body.moneda, 5);
      if (moneda) fila.moneda = moneda.toUpperCase();
      if (body.nota !== undefined) fila.nota = texto(body.nota, 2000);
    }

    const q = id
      ? sb.from(tabla).update(fila).eq("empresa_id", a.empresaId).eq("id", id).select("id").single()
      : sb.from(tabla).insert(fila).select("id").single();

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ id: (data as { id: string }).id }));
  } catch (e) {
    console.error("[api/operacion POST]", e);
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo guardar."),
      { status: 500 }
    );
  }
}

/** DELETE — ?tipo=tarea|costo&id=… */
export async function DELETE(request: Request) {
  const a = await requireModuleAccess(request, SLUG, ETIQUETA);
  if (!a.ok) return NextResponse.json(errorResponse(a.message), { status: a.status });

  try {
    const url = new URL(request.url);
    const tipo = url.searchParams.get("tipo");
    const id = url.searchParams.get("id");
    if (!id || (tipo !== "tarea" && tipo !== "costo")) {
      return NextResponse.json(errorResponse("Faltan tipo e id."), { status: 400 });
    }
    const sb = await getChatServiceClientForEmpresa(a.empresaId);
    const { error } = await sb
      .from(tipo === "tarea" ? "salida_tareas" : "salida_costos")
      .delete()
      .eq("empresa_id", a.empresaId)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    console.error("[api/operacion DELETE]", e);
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo borrar."),
      { status: 500 }
    );
  }
}
