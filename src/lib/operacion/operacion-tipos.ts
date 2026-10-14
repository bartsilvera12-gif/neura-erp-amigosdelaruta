/**
 * Operación de las salidas · catálogos y tipos.
 *
 * Vive aparte de `operacion-data.ts` porque ese módulo es `server-only` (abre
 * la conexión a la base) y la pantalla es un componente de cliente: importarlo
 * desde el navegador rompe el build de Next. Acá queda sólo lo que las dos
 * mitades comparten.
 */

export const TAREA_CATEGORIAS = [
  { value: "hotel", label: "Hotel" },
  { value: "motos", label: "Motos" },
  { value: "seguros", label: "Seguros" },
  { value: "guia", label: "Guía" },
  { value: "kit", label: "Kit" },
  { value: "transporte", label: "Transporte" },
  { value: "publicidad", label: "Publicidad" },
  { value: "personal", label: "Personal" },
  { value: "otro", label: "Otro" },
] as const;

export const TAREA_ESTADOS = [
  { value: "pendiente", label: "Pendiente" },
  { value: "en_proceso", label: "En proceso" },
  { value: "hecha", label: "Hecha" },
  { value: "bloqueada", label: "Bloqueada" },
] as const;

export const COSTO_CATEGORIAS = [
  { value: "hotel", label: "Hotel" },
  { value: "motos", label: "Motos" },
  { value: "seguros", label: "Seguros" },
  { value: "operador", label: "Operador" },
  { value: "transporte", label: "Transporte" },
  { value: "kit", label: "Kit" },
  { value: "publicidad", label: "Publicidad" },
  { value: "personal", label: "Personal" },
  { value: "otro", label: "Otro" },
] as const;

export type Tarea = {
  id: string;
  salida_id: string;
  titulo: string;
  categoria: string;
  responsable_id: string | null;
  fecha_limite: string | null;
  estado: string;
  nota: string | null;
  orden: number;
  completada_at: string | null;
};

export type Costo = {
  id: string;
  salida_id: string;
  concepto: string;
  categoria: string;
  monto_estimado: number;
  monto_real: number | null;
  moneda: string;
  nota: string | null;
};

/** Una salida con su contexto comercial y el resumen de su operación. */
export type SalidaOperacion = {
  id: string;
  evento_id: string;
  evento_nombre: string;
  codigo: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
  estado: string;
  cupo_total: number | null;
  /** Reservas que ya cuentan como venta (no cotización ni cancelada). */
  reservas: number;
  participantes: number;
  ingresos: number;
  moneda: string;
  costo_estimado: number;
  costo_real: number;
  /** Real si hay, estimado si no. Es contra esto que se calcula el margen. */
  costo_vigente: number;
  margen: number;
  margen_pct: number | null;
  tareas_total: number;
  tareas_hechas: number;
};
