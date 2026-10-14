import { NextResponse } from "next/server";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireTenantUserApiAccess } from "@/lib/contabilidad/contabilidad-auth";

export const runtime = "nodejs";

/** Normaliza el nombre para el control de duplicados (mayúsculas + espacios colapsados). */
function normNombre(s: string): string {
  return String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** Tipos de entidad, igual que en `neura-erp-glacial`. Se valida también en la base (script 07). */
export const TIPOS_ENTIDAD: string[] = ["caja", "banco", "tarjeta", "billetera", "otro"];

function esAdmin(rol: string | null): boolean {
  const r = String(rol ?? "").trim();
  return r === "super_admin" || esRolAdminEmpresaOGlobal(r);
}

/** GET — lista de bancos de la empresa. Accesible a cualquier usuario (alimenta el dropdown de cobros). */
export async function GET(request: Request) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    /*
     * `select("*")` en vez de la lista fija: `codigo` y `tipo` los agrega el
     * script 07 y puede no estar corrido todavía. Pidiéndolos por nombre, la
     * pantalla entera se caería en esa instancia; así se adapta sola.
     */
    const { data, error } = await supabase
      .from("bancos")
      .select("*")
      .eq("empresa_id", auth.empresaId)
      .order("sort_order", { ascending: true })
      .order("nombre", { ascending: true });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    /*
     * Si no hay ninguna fila no se puede saber por las filas qué columnas
     * existen, así que se pregunta. Es una consulta de una fila y sólo cuando
     * el catálogo está vacío.
     */
    let campos = { codigo: false, tipo: false };
    const fila = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (fila) {
      campos = { codigo: "codigo" in fila, tipo: "tipo" in fila };
    } else {
      const probe = await supabase.from("bancos").select("codigo, tipo").limit(1);
      if (!probe.error) campos = { codigo: true, tipo: true };
    }

    return NextResponse.json(
      successResponse({
        bancos: data ?? [],
        meta: { can_edit: esAdmin(auth.rol), campos },
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudieron cargar los bancos";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}

/** POST — alta de un banco (solo admin). */
export async function POST(request: Request) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    if (!esAdmin(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar el catálogo de bancos"), { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      nombre?: unknown;
      sort_order?: unknown;
      codigo?: unknown;
      tipo?: unknown;
    };
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre) return NextResponse.json(errorResponse("Indicá el nombre del banco"), { status: 400 });

    /* `codigo` y `tipo` sólo viajan si la pantalla los mandó, y la pantalla sólo
       los muestra cuando la base los tiene (ver el `meta.campos` del GET). */
    const extra: Record<string, unknown> = {};
    if (typeof body.codigo === "string" && body.codigo.trim()) {
      extra.codigo = body.codigo.trim().toUpperCase().slice(0, 20);
    }
    if (typeof body.tipo === "string" && TIPOS_ENTIDAD.includes(body.tipo)) {
      extra.tipo = body.tipo;
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await supabase
      .from("bancos")
      .insert({
        empresa_id: auth.empresaId,
        nombre,
        nombre_norm: normNombre(nombre),
        sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
        ...extra,
      })
      .select("*")
      .single();

    if (error) {
      const status = error.code === "23505" ? 409 : 400;
      const msg = error.code === "23505" ? "Ya existe un banco con ese nombre" : error.message;
      return NextResponse.json(errorResponse(msg), { status });
    }
    return NextResponse.json(successResponse({ banco: data }), { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo crear el banco";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
