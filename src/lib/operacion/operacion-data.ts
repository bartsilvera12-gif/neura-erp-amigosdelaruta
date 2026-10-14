import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Operación de las salidas: lo que hay que dejar listo antes de un viaje y lo
 * que ese viaje cuesta.
 *
 * Reemplaza al módulo Proyectos, que venía del sistema base y servía para
 * gestionar desarrollos de software. Esto sale del documento funcional de ADR
 * (página 6): «costos asociados a evento: hoteles, motos, seguros, operadores,
 * publicidad, personal» y «resultado y margen estimado/real por evento».
 *
 * Todo cuelga de la SALIDA y no del evento, siguiendo la estructura que el
 * mismo documento define: el tour es contenido comercial reutilizable
 * («Route 66») y la salida es la fecha concreta («22/07/2027»). Un hotel se
 * reserva para una fecha.
 */

/*
 * Los catálogos y los tipos viven en `operacion-tipos.ts`: este módulo es
 * `server-only` y la pantalla los necesita desde el navegador. Se re-exportan
 * para que la ruta de API pueda seguir importando todo de un solo lugar.
 */
export {
  TAREA_CATEGORIAS,
  TAREA_ESTADOS,
  COSTO_CATEGORIAS,
} from "./operacion-tipos";
export type { Tarea, Costo, SalidaOperacion } from "./operacion-tipos";

import type { Tarea, Costo, SalidaOperacion } from "./operacion-tipos";


const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Texto de un jsonb multilingüe, con castellano como respaldo. */
function textoI18n(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["es", "pt", "en"]) {
      const x = o[k];
      if (typeof x === "string" && x.trim()) return x;
    }
  }
  return "";
}

/**
 * Estados de reserva que cuentan como ingreso.
 *
 * `cotizacion` queda afuera porque es una consulta, no una venta: contarla
 * inflaría el margen de todas las salidas con un número que nadie prometió
 * pagar. `cancelada`, obviamente, tampoco.
 */
const RESERVA_CUENTA = new Set(["reservada", "pago_parcial", "confirmada", "participo"]);

export async function cargarOperacion(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<{ salidas: SalidaOperacion[]; tareas: Tarea[]; costos: Costo[] }> {
  const [salidasQ, eventosQ, reservasQ, tareasQ, costosQ] = await Promise.all([
    sb.from("salidas").select("id, evento_id, codigo, fecha_inicio, fecha_fin, estado, cupo_total")
      .eq("empresa_id", empresaId).order("fecha_inicio", { ascending: true }),
    sb.from("eventos").select("id, nombre, moneda_base").eq("empresa_id", empresaId),
    sb.from("reservas").select("salida_id, estado, precio_paquete, cantidad_participantes, moneda")
      .eq("empresa_id", empresaId),
    sb.from("salida_tareas").select("*").eq("empresa_id", empresaId).order("orden", { ascending: true }),
    sb.from("salida_costos").select("*").eq("empresa_id", empresaId),
  ]);

  for (const r of [salidasQ, eventosQ, reservasQ, tareasQ, costosQ]) {
    if (r.error) throw new Error(r.error.message);
  }

  type Fila = Record<string, unknown>;
  const eventos = new Map<string, Fila>(
    ((eventosQ.data ?? []) as Fila[]).map((e) => [String(e.id), e])
  );

  const tareas = ((tareasQ.data ?? []) as Fila[]).map((t) => ({
    id: String(t.id),
    salida_id: String(t.salida_id),
    titulo: String(t.titulo ?? ""),
    categoria: String(t.categoria ?? "otro"),
    responsable_id: t.responsable_id ? String(t.responsable_id) : null,
    fecha_limite: t.fecha_limite ? String(t.fecha_limite) : null,
    estado: String(t.estado ?? "pendiente"),
    nota: t.nota ? String(t.nota) : null,
    orden: num(t.orden),
    completada_at: t.completada_at ? String(t.completada_at) : null,
  }));

  const costos = ((costosQ.data ?? []) as Fila[]).map((c) => ({
    id: String(c.id),
    salida_id: String(c.salida_id),
    concepto: String(c.concepto ?? ""),
    categoria: String(c.categoria ?? "otro"),
    monto_estimado: num(c.monto_estimado),
    monto_real: c.monto_real == null ? null : num(c.monto_real),
    moneda: String(c.moneda ?? "USD"),
    nota: c.nota ? String(c.nota) : null,
  }));

  const salidas: SalidaOperacion[] = ((salidasQ.data ?? []) as Fila[]).map((s) => {
    const id = String(s.id);
    const evento = eventos.get(String(s.evento_id));

    const deLaSalida = ((reservasQ.data ?? []) as Fila[]).filter(
      (r) => String(r.salida_id) === id && RESERVA_CUENTA.has(String(r.estado))
    );
    const ingresos = deLaSalida.reduce((a, r) => a + num(r.precio_paquete), 0);
    const participantes = deLaSalida.reduce((a, r) => a + num(r.cantidad_participantes), 0);

    const propios = costos.filter((c) => c.salida_id === id);
    const costoEstimado = propios.reduce((a, c) => a + c.monto_estimado, 0);
    const costoReal = propios.reduce((a, c) => a + (c.monto_real ?? 0), 0);
    /* Por línea: si esa línea ya tiene su monto real se usa ese, y si todavía
       no llegó la factura se sigue usando el estimado. Mezclar los totales
       (todo real o todo estimado) daría un margen falso mientras la mitad de
       los proveedores facturó y la otra mitad no. */
    const costoVigente = propios.reduce((a, c) => a + (c.monto_real ?? c.monto_estimado), 0);

    const tareasSalida = tareas.filter((t) => t.salida_id === id);

    return {
      id,
      evento_id: String(s.evento_id),
      evento_nombre: textoI18n(evento?.nombre) || "Sin viaje",
      codigo: s.codigo ? String(s.codigo) : null,
      fecha_inicio: String(s.fecha_inicio ?? ""),
      fecha_fin: s.fecha_fin ? String(s.fecha_fin) : null,
      estado: String(s.estado ?? "borrador"),
      cupo_total: s.cupo_total == null ? null : num(s.cupo_total),
      reservas: deLaSalida.length,
      participantes,
      ingresos,
      moneda: String(deLaSalida[0]?.moneda ?? evento?.moneda_base ?? "USD"),
      costo_estimado: costoEstimado,
      costo_real: costoReal,
      costo_vigente: costoVigente,
      margen: ingresos - costoVigente,
      margen_pct: ingresos > 0 ? ((ingresos - costoVigente) / ingresos) * 100 : null,
      tareas_total: tareasSalida.length,
      tareas_hechas: tareasSalida.filter((t) => t.estado === "hecha").length,
    };
  });

  return { salidas, tareas, costos };
}
