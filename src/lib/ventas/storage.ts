import type { Venta } from "./types";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export type ResultadoGuardarVenta =
  | {
      success: true;
      venta: Venta;
      /** Factura del ERP creada por el puente, si la caja la pidió. */
      factura: { id: string; numero_factura: string } | null;
      /** La venta se registró pero la factura no pudo crearse. */
      facturaWarning: string | null;
    }
  | { success: false; error: string };

/** Datos de facturación que la caja decide por venta. */
export type OpcionesFacturaVenta = {
  /** `true` emite factura del ERP; `false` registra solo la venta. */
  emitirFactura?: boolean;
  /** Obligatorio si se emite factura: SIFEN necesita un receptor. */
  clienteId?: string | null;
};

/**
 * Lista ventas del tenant (misma fuente que el dashboard: tablas `ventas` / `ventas_items`).
 */
export async function getVentas(): Promise<Venta[]> {
  try {
    const res = await fetchWithSupabaseSession("/api/ventas", { cache: "no-store" });
    const json = (await res.json()) as {
      success?: boolean;
      data?: { ventas?: Venta[] };
      error?: string;
    };
    if (!res.ok || !json.success || !json.data?.ventas) {
      console.error("[ventas] getVentas:", json.error ?? res.statusText);
      return [];
    }
    return json.data.ventas;
  } catch (e) {
    console.error("[ventas] getVentas:", e);
    return [];
  }
}

/**
 * Crea una venta en base de datos (transacción servidor: ítems, stock, movimientos).
 */
export async function saveVenta(
  datos: Omit<Venta, "id" | "numero_control" | "fecha">,
  opciones: OpcionesFacturaVenta = {}
): Promise<ResultadoGuardarVenta> {
  if (!datos.items || datos.items.length === 0) {
    return { success: false, error: "La venta debe tener al menos un producto." };
  }

  try {
    const res = await fetchWithSupabaseSession("/api/ventas/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: datos.items,
        moneda: datos.moneda,
        tipo_cambio: datos.tipo_cambio,
        subtotal: datos.subtotal,
        monto_iva: datos.monto_iva,
        total: datos.total,
        tipo_venta: datos.tipo_venta,
        plazo_dias: datos.plazo_dias,
        metodo_pago: datos.metodo_pago ?? null,
        cliente_id: opciones.clienteId ?? null,
        observaciones: null,
        emitir_factura: opciones.emitirFactura === true,
      }),
    });

    const json = (await res.json()) as {
      success?: boolean;
      data?: {
        venta?: Venta;
        factura?: { id: string; numero_factura: string } | null;
        factura_warning?: string | null;
      };
      error?: string;
    };

    if (!res.ok || !json.success || !json.data?.venta) {
      return {
        success: false,
        error: json.error ?? `No se pudo registrar la venta (${res.status}).`,
      };
    }

    return {
      success: true,
      venta: json.data.venta,
      factura: json.data.factura ?? null,
      facturaWarning: json.data.factura_warning ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de red.";
    return { success: false, error: msg };
  }
}
