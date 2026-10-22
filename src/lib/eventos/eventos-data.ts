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

/**
 * Participantes de las reservas.
 *
 * Las inscripciones de la web ya se guardaban acá —una fila por persona, con
 * nombre, documento y licencia— pero la pantalla solo mostraba cuántas eran,
 * no quiénes. Para una operadora de viajes eso es justamente el dato: a esta
 * gente hay que reservarle hotel, moto y seguro.
 */
export async function cargarParticipantes(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<Record<string, unknown>[]> {
  const { data, error } = await sb
    .from("participantes")
    .select("id, reserva_id, nombre, apellido, documento, telefono, email, rol, licencia_numero")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

/** Columnas que la pantalla puede escribir sobre `paquetes`. */
export const CAMPOS_PAQUETE = [
  "evento_id",
  "salida_id",
  "nombre",
  "detalle",
  "personas",
  "motos",
  "habitacion",
  "precio",
  "moneda",
  "cupo",
  "orden",
  "activo",
] as const;

export async function cargarPaquetes(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<Record<string, unknown>[]> {
  const { data, error } = await sb
    .from("paquetes")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("orden", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

/**
 * Alta y edición de un paquete.
 *
 * El paquete es lo que define QUE se reserva y a QUE precio: cuántas personas,
 * cuántas motos y cuánto sale. El sitio no ofrece reservar un viaje que no
 * tenga al menos uno, porque sin precio no hay nada que cobrar — y hasta ahora
 * no había forma de cargarlos desde el ERP.
 *
 * `salida_id` es opcional: sin él, el paquete vale para todas las salidas del
 * viaje, que es el caso normal. Con él, sólo para esa fecha.
 */
export async function guardarPaquete(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string | null,
  valores: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const permitidos = new Set<string>(CAMPOS_PAQUETE);
  const campos: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valores ?? {})) {
    if (permitidos.has(k)) campos[k] = v === "" ? null : v;
  }
  if (Object.keys(campos).length === 0) {
    throw new Error("No hay campos válidos para guardar.");
  }

  if (!id && (typeof campos.evento_id !== "string" || !campos.evento_id.trim())) {
    throw new Error("Elegí el viaje al que pertenece el paquete.");
  }
  if (campos.personas != null) {
    const n = Number(campos.personas);
    if (!Number.isFinite(n) || n < 1) throw new Error("El paquete tiene que incluir al menos una persona.");
    campos.personas = Math.trunc(n);
  }
  if (campos.motos != null) campos.motos = Math.max(0, Math.trunc(Number(campos.motos) || 0));
  if (campos.precio != null) {
    const n = Number(campos.precio);
    if (!Number.isFinite(n) || n < 0) throw new Error("El precio no puede ser negativo.");
    campos.precio = n;
  }

  if (id) {
    const { data, error } = await sb
      .from("paquetes")
      .update(campos)
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }

  /* El viaje se valida contra la empresa: `evento_id` viene del navegador y la
     RLS protege la fila nueva, no a quién apunta. */
  const { data: evento, error: errEv } = await sb
    .from("eventos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("id", String(campos.evento_id))
    .maybeSingle();
  if (errEv) throw new Error(errEv.message);
  if (!evento) throw new Error("Ese viaje no existe.");

  const { data, error } = await sb
    .from("paquetes")
    .insert({ ...campos, empresa_id: empresaId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export const RESERVA_ESTADOS = [
  { value: "cotizacion", label: "Cotización" },
  { value: "reservada", label: "Reservada" },
  { value: "pago_parcial", label: "Pago parcial" },
  { value: "confirmada", label: "Confirmada" },
  { value: "participo", label: "Participó" },
  { value: "cancelada", label: "Cancelada" },
] as const;

/** Columnas que la pantalla puede escribir sobre `reservas`. */
export const CAMPOS_RESERVA = ["estado", "notas", "motivo_cancelacion"] as const;

/**
 * Cambio de estado de una reserva.
 *
 * Es la decisión comercial sobre lo que llegó de la web: una cotización que se
 * confirma pasa a contar como ingreso en Operación; una que se cae se cancela.
 * Hasta ahora no habia forma de hacerlo y toda reserva quedaba como entro.
 */
export async function guardarReserva(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string,
  valores: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const permitidos = new Set<string>(CAMPOS_RESERVA);
  const campos: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valores ?? {})) {
    if (permitidos.has(k)) campos[k] = v === "" ? null : v;
  }
  if (Object.keys(campos).length === 0) throw new Error("No hay campos válidos para guardar.");

  if (campos.estado != null) {
    const e = String(campos.estado);
    if (!RESERVA_ESTADOS.some((x) => x.value === e)) throw new Error("Ese estado no existe.");
    // Cancelar deja la marca de cuándo: después nadie recuerda la fecha.
    campos.cancelada_at = e === "cancelada" ? new Date().toISOString() : null;
  }

  const { data, error } = await sb
    .from("reservas")
    .update(campos)
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

/**
 * Borrado de una fila del módulo.
 *
 * Un viaje con reservas no se borra: se perderían las de la gente que ya se
 * anotó, y el borrado en cascada de la base las arrastraría sin avisar. Lo
 * mismo con una salida. Para sacar algo de circulación sin perder historia
 * está el estado `cerrado` / `cancelada`.
 */
export async function borrarFilaEventos(
  sb: AppSupabaseClient,
  empresaId: string,
  tipo: "evento" | "salida" | "paquete" | "reserva",
  id: string
): Promise<void> {
  const tabla =
    tipo === "evento" ? "eventos" : tipo === "salida" ? "salidas" : tipo === "paquete" ? "paquetes" : "reservas";

  if (tipo === "evento" || tipo === "salida") {
    const col = tipo === "evento" ? "evento_id" : "salida_id";
    const { count, error } = await sb
      .from("reservas")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq(col, id);
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) {
      throw new Error(
        tipo === "evento"
          ? `No se puede borrar: el viaje tiene ${count} reserva(s). Pasalo a "cerrado" para sacarlo del sitio.`
          : `No se puede borrar: la salida tiene ${count} reserva(s). Pasala a "cerrada" para sacarla del sitio.`
      );
    }
  }

  const { error } = await sb.from(tabla).delete().eq("id", id).eq("empresa_id", empresaId);
  if (error) throw new Error(error.message);
}

/** Alta o edición de un evento, filtrando a las columnas permitidas. */
/** Columnas que la pantalla puede escribir sobre `salidas`. */
export const CAMPOS_SALIDA = [
  "evento_id",
  "codigo",
  "fecha_inicio",
  "fecha_fin",
  "cupo_total",
  "idioma_guia",
  "fecha_limite_inscripcion",
  "estado",
  "notas",
] as const;

export const SALIDA_ESTADOS = [
  { value: "borrador", label: "Borrador" },
  { value: "abierta", label: "Abierta" },
  { value: "confirmada", label: "Confirmada" },
  { value: "lista_espera", label: "Lista de espera" },
  { value: "cerrada", label: "Cerrada" },
  { value: "finalizada", label: "Finalizada" },
] as const;

/**
 * Alta y edición de una salida.
 *
 * La salida es la fecha concreta de un viaje («Route 66, 22/07/2027»): el tour
 * es el contenido comercial y se vende muchas veces, la salida es una sola. De
 * ella cuelgan los paquetes, las reservas y toda la Operación.
 *
 * Hasta ahora la pantalla mostraba las salidas pero no dejaba crearlas, así que
 * Operación no tenía de qué colgarse.
 */
export async function guardarSalida(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string | null,
  valores: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const permitidos = new Set<string>(CAMPOS_SALIDA);
  const campos: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valores ?? {})) {
    if (permitidos.has(k)) campos[k] = v === "" ? null : v;
  }
  if (Object.keys(campos).length === 0) {
    throw new Error("No hay campos válidos para guardar.");
  }

  // Los dos que la base exige y que la pantalla no puede adivinar.
  if (!id) {
    if (typeof campos.evento_id !== "string" || !campos.evento_id.trim()) {
      throw new Error("Elegí el viaje al que pertenece la salida.");
    }
    if (typeof campos.fecha_inicio !== "string" || !campos.fecha_inicio.trim()) {
      throw new Error("La salida necesita una fecha de inicio.");
    }
  }
  // `salidas_fechas_chk`: el mensaje de Postgres no se entiende, este sí.
  const desde = campos.fecha_inicio;
  const hasta = campos.fecha_fin;
  if (typeof desde === "string" && typeof hasta === "string" && hasta && hasta < desde) {
    throw new Error("La fecha de fin no puede ser anterior a la de inicio.");
  }
  if (campos.cupo_total != null && campos.cupo_total !== "") {
    const n = Number(campos.cupo_total);
    if (!Number.isFinite(n) || n < 0) throw new Error("El cupo tiene que ser un número positivo.");
    campos.cupo_total = Math.trunc(n);
  }

  if (id) {
    const { data, error } = await sb
      .from("salidas")
      .update(campos)
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }

  /*
   * El viaje se valida contra la empresa antes de insertar: `evento_id` viene
   * del navegador y sin esto se podría colgar una salida del viaje de otra
   * empresa. La RLS protege la fila nueva, no a quién apunta.
   */
  const { data: evento, error: errEv } = await sb
    .from("eventos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("id", String(campos.evento_id))
    .maybeSingle();
  if (errEv) throw new Error(errEv.message);
  if (!evento) throw new Error("Ese viaje no existe.");

  const { data, error } = await sb
    .from("salidas")
    .insert({ ...campos, empresa_id: empresaId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

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
