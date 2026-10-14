import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getClientesSupabaseFromAuthWithRol } from "@/lib/clientes/clientes-service-client";

/**
 * Notas internas de un cliente.
 *
 * Existían antes, pero se guardaban escribiendo a `clientes` DIRECTO desde el
 * navegador, que es lo único de esta pantalla que lo hacía: todo lo demás pasa
 * por `/api/clientes/:id`, que usa rol de servicio precisamente «para no
 * depender de GRANT/PostgREST del authenticated en el navegador». El update se
 * rechazaba, el error se escribía en la consola y la función devolvía la nota
 * igual, así que la pantalla se recargaba sin nada y parecía que no se había
 * guardado. QA lo reportó así.
 *
 * `notas` es una columna JSON, de modo que editar una implica leer, modificar
 * y volver a escribir el arreglo entero. Hacerlo acá y no en el navegador
 * evita además que dos pestañas se pisen las notas.
 */

export const dynamic = "force-dynamic";

type Nota = { id: number; texto: string; fecha: string; editada?: string };

const MAX = 4000;

function parse(v: unknown): Nota[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object")
    .map((n) => ({
      id: typeof n.id === "number" ? n.id : Date.now(),
      texto: typeof n.texto === "string" ? n.texto : "",
      fecha: typeof n.fecha === "string" ? n.fecha : new Date().toISOString(),
      ...(typeof n.editada === "string" ? { editada: n.editada } : {}),
    }));
}

type ClienteCtx = NonNullable<Awaited<ReturnType<typeof getClientesSupabaseFromAuthWithRol>>>;

const texto = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, MAX) : "");

type Leido =
  | { ok: false; error: string; status: 400 | 401 | 404 }
  | { ok: true; ctx: ClienteCtx; notas: Nota[] };

/** Lee las notas del cliente validando que sea de la empresa de la sesión. */
async function leer(request: NextRequest, clienteId: string): Promise<Leido> {
  const ctx = await getClientesSupabaseFromAuthWithRol(request);
  if (!ctx) return { ok: false, error: API_ERRORS.UNAUTHORIZED, status: 401 };
  const { auth, supabase } = ctx;

  const { data, error } = await supabase
    .from("clientes")
    .select("id, notas, deleted_at")
    .eq("id", clienteId)
    .eq("empresa_id", auth.empresa_id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message, status: 400 };
  if (!data) return { ok: false, error: "Cliente no encontrado", status: 404 };

  const fila = data as { notas?: unknown; deleted_at?: string | null };
  if (fila.deleted_at != null && String(fila.deleted_at).trim() !== "") {
    return { ok: false, error: "Cliente no encontrado", status: 404 };
  }
  return { ok: true, ctx, notas: parse(fila.notas) };
}

/** Guarda el arreglo completo. */
async function escribir(ctx: ClienteCtx, clienteId: string, notas: Nota[]): Promise<string | null> {
  const { error } = await ctx.supabase
    .from("clientes")
    .update({ notas, updated_at: new Date().toISOString() })
    .eq("id", clienteId)
    .eq("empresa_id", ctx.auth.empresa_id);
  return error ? error.message : null;
}

/** GET — todas las notas, de la más nueva a la más vieja. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await leer(request, id);
  if (!r.ok) return NextResponse.json(errorResponse(r.error), { status: r.status });
  return NextResponse.json(successResponse(r.notas));
}

/** POST { texto } — agrega una nota. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const t = texto(body.texto);
  if (!t) return NextResponse.json(errorResponse("La nota no puede estar vacía."), { status: 400 });

  const r = await leer(request, id);
  if (!r.ok) return NextResponse.json(errorResponse(r.error), { status: r.status });

  const nota: Nota = { id: Date.now(), texto: t, fecha: new Date().toISOString() };
  const err = await escribir(r.ctx, id, [...r.notas, nota]);
  if (err) {
    console.error("[api/clientes/notas POST]", err);
    return NextResponse.json(errorResponse(err), { status: 400 });
  }
  return NextResponse.json(successResponse(nota));
}

/** PATCH { id, texto } — edita el texto de una nota. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const notaId = Number(body.id);
  const t = texto(body.texto);
  if (!Number.isFinite(notaId)) {
    return NextResponse.json(errorResponse("Falta la nota a editar."), { status: 400 });
  }
  if (!t) return NextResponse.json(errorResponse("La nota no puede estar vacía."), { status: 400 });

  const r = await leer(request, id);
  if (!r.ok) return NextResponse.json(errorResponse(r.error), { status: r.status });
  if (!r.notas.some((n) => n.id === notaId)) {
    return NextResponse.json(errorResponse("Esa nota ya no existe."), { status: 404 });
  }

  // `editada` queda aparte de `fecha`: se ve cuándo se escribió y cuándo se tocó.
  const nuevas = r.notas.map((n) =>
    n.id === notaId ? { ...n, texto: t, editada: new Date().toISOString() } : n
  );
  const err = await escribir(r.ctx, id, nuevas);
  if (err) {
    console.error("[api/clientes/notas PATCH]", err);
    return NextResponse.json(errorResponse(err), { status: 400 });
  }
  return NextResponse.json(successResponse(nuevas.find((n) => n.id === notaId)));
}

/** DELETE ?nota_id=… — borra una nota. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notaId = Number(new URL(request.url).searchParams.get("nota_id"));
  if (!Number.isFinite(notaId)) {
    return NextResponse.json(errorResponse("Falta la nota a borrar."), { status: 400 });
  }

  const r = await leer(request, id);
  if (!r.ok) return NextResponse.json(errorResponse(r.error), { status: r.status });

  const nuevas = r.notas.filter((n) => n.id !== notaId);
  if (nuevas.length === r.notas.length) {
    return NextResponse.json(errorResponse("Esa nota ya no existe."), { status: 404 });
  }
  const err = await escribir(r.ctx, id, nuevas);
  if (err) {
    console.error("[api/clientes/notas DELETE]", err);
    return NextResponse.json(errorResponse(err), { status: 400 });
  }
  return NextResponse.json(successResponse({ ok: true }));
}
