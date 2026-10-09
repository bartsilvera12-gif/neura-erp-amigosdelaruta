import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Lectura y alta del módulo Eventos (viajes y rallies).
 *
 * El modelo lo instala `supabase/migrations/20261009120000_eventos_provision.sql`:
 * Tour (`eventos`) → Salida (`salidas`) → Paquete (`paquetes`) → Reserva
 * (`reservas`), con participantes, pagos y kits colgando de la reserva.
 *
 * Los textos son jsonb {es, pt, en}, igual que el resto del contenido del sitio.
 */

/** Columnas que la pantalla puede escribir sobre `eventos`. */
export const CAMPOS_EVENTO = [
  "slug",
  "nombre",
  "resumen",
  "descripcion",
  "pais",
  "ciudad",
  "punto_salida",
  "punto_llegada",
  "duracion_dias",
  "noches",
  "distancia_km",
  "moneda_base",
  "max_participantes",
  "fecha_limite_inscripcion",
  "incluye",
  "no_incluye",
  "hotel",
  "portada_url",
  "estado",
  "destacado",
  "orden",
] as const;

export type EventoRow = Record<string, unknown>;

export type EventoConConteos = EventoRow & {
  salidas_count: number;
  reservas_count: number;
};

/**
 * Lista de eventos con cuántas salidas y reservas tiene cada uno.
 *
 * Los conteos se arman en memoria con dos consultas en vez de una por evento:
 * son pocas filas y evita el N+1 de pedir los conteos uno por uno.
 */
export async function cargarEventos(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<EventoConConteos[]> {
  const { data: eventos, error } = await sb
    .from("eventos")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("orden", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: salidas } = await sb
    .from("salidas")
    .select("id, evento_id")
    .eq("empresa_id", empresaId);
  const { data: reservas } = await sb
    .from("reservas")
    .select("id, evento_id")
    .eq("empresa_id", empresaId);

  const contar = (filas: unknown[] | null | undefined) => {
    const m = new Map<string, number>();
    for (const f of (filas ?? []) as { evento_id?: unknown }[]) {
      const k = String(f.evento_id ?? "");
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const cS = contar(salidas);
  const cR = contar(reservas);

  return ((eventos ?? []) as EventoRow[]).map((e) => ({
    ...e,
    salidas_count: cS.get(String(e.id)) ?? 0,
    reservas_count: cR.get(String(e.id)) ?? 0,
  }));
}

export async function cargarSalidas(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<Record<string, unknown>[]> {
  const { data, error } = await sb
    .from("salidas")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("fecha_inicio", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

export async function cargarReservas(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<Record<string, unknown>[]> {
  const { data, error } = await sb
    .from("reservas")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

/** Alta o edición de un evento, filtrando a las columnas permitidas. */
export async function guardarEvento(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string | null,
  valores: Record<string, unknown>
): Promise<EventoRow> {
  const permitidos = new Set<string>(CAMPOS_EVENTO);
  const campos: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valores ?? {})) {
    if (permitidos.has(k)) campos[k] = v;
  }
  if (Object.keys(campos).length === 0) {
    throw new Error("No hay campos válidos para guardar.");
  }

  if (id) {
    const { data, error } = await sb
      .from("eventos")
      .update(campos)
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as EventoRow;
  }

  // `slug` es la clave con la que el sitio arma la URL del viaje: sin eso el
  // evento no se puede enlazar.
  if (typeof campos.slug !== "string" || !campos.slug.trim()) {
    throw new Error("El slug es obligatorio para crear un evento.");
  }

  const { data, error } = await sb
    .from("eventos")
    .insert({ ...campos, empresa_id: empresaId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as EventoRow;
}
