import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAgendaApiAccess } from "@/lib/agenda/agenda-auth";
import { nombreClienteDisplay } from "@/lib/clientes/display-name";

/** Tipos de cita sugeridos (Fase 1A: estáticos; catálogo configurable en Fase 1.1). */
const TIPOS_SUGERIDOS = [
  "llamada",
  "demo",
  "visita",
  "consulta",
  "servicio",
  "reunion",
  "seguimiento",
  "capacitacion",
  "otro",
];

/**
 * Datos para poblar selects del formulario:
 *  - responsables: usuarios de la empresa (catálogo zentra_erp).
 *  - clientes: del schema de datos del tenant.
 *  - tipos: sugerencias estáticas.
 */
export async function GET(request: Request) {
  const auth = await requireAgendaApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  try {
    const empresaId = auth.empresaId;
    const sb = await getChatServiceClientForEmpresa(empresaId);
    const catalog = createServiceRoleClient();

    const [usuariosR, clientesR] = await Promise.all([
      catalog
        .from("usuarios")
        .select("id,nombre,rol,estado")
        .eq("empresa_id", empresaId)
        .order("nombre", { ascending: true }),
      sb
        .from("clientes")
        .select("id,tipo_cliente,empresa,nombre_contacto,nombre,razon_social,telefono,estado,baja_operativa_at,deleted_at")
        .eq("empresa_id", empresaId)
        // `deleted_at IS NULL` es el filtro de "no borrado" que usa el resto del
        // ERP (ver /api/clientes). Acá faltaba, y por eso la agenda ofrecía
        // clientes que ya no existían en ninguna otra pantalla.
        .is("deleted_at", null)
        .order("nombre_contacto", { ascending: true })
        .limit(1000),
    ]);

    if (usuariosR.error) {
      return NextResponse.json(errorResponse(usuariosR.error.message), { status: 400 });
    }
    /* Antes este error no se miraba: la consulta fallaba y el formulario se
       abria con el selector de clientes vacio, sin decir nada. */
    if (clientesR.error) {
      return NextResponse.json(errorResponse(clientesR.error.message), { status: 400 });
    }

    const responsables = ((usuariosR.data ?? []) as Record<string, unknown>[])
      .filter((u) => (u.estado == null || u.estado === "activo"))
      .map((u) => ({ id: String(u.id), nombre: (u.nombre as string | null) ?? null, rol: (u.rol as string | null) ?? null }));

    /* Un cliente dado de baja no se puede agendar: se filtra con el mismo
       criterio que los usuarios de arriba. La cita que YA lo tenia no se toca
       -- el formulario lo agrega a mano desde los datos de la cita (ver
       CitaFormModal) -- para no romper el historial ni perder el vinculo al
       editar. */
    const clientes = ((clientesR.data ?? []) as Record<string, unknown>[])
      .filter((c) => c.baja_operativa_at == null && (c.estado == null || c.estado === "activo"))
      .map((c) => ({
        id: String(c.id),
        nombre: nombreClienteDisplay(c, "") || null,
        telefono: (c.telefono as string | null) ?? null,
      }));

    return NextResponse.json(
      successResponse({ responsables, clientes, tipos: TIPOS_SUGERIDOS })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
