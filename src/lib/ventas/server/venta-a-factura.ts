import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { obtenerSiguienteNumeroFacturaEmpresa } from "@/lib/facturacion/factura-suscripcion-servidor";
import { montosFacturaItemParaInsert } from "@/lib/facturacion/factura-item-montos";
import type { CreateVentaItemInput } from "./create-venta-pg";

/**
 * Puente venta → factura.
 *
 * La caja registraba la venta y ahí terminaba: para facturarla había que ir a
 * otra pantalla y cargar los datos de nuevo. Con esto, al confirmar una venta
 * en modo «Factura» nace la factura del ERP con una línea por producto, y de
 * ahí sale el documento electrónico por SIFEN.
 *
 * No copia el puente del ERP de Caacupé al pie de la letra: aquel escribe
 * columnas que esta instancia no tiene (`sucursal_id`, `origen_venta_id`,
 * `cliente_razon_social`). Se reusa el mismo camino que ya usa
 * `/api/facturas`, que es el que está probado contra este esquema.
 */

export type VentaAFacturaResultado = {
  facturaId: string;
  numeroFactura: string;
};

/** Tasa de IVA de la línea, como la espera el ayudante de montos. */
function tasaDe(tipo: CreateVentaItemInput["tipo_iva"]): 0 | 5 | 10 {
  if (tipo === "EXENTA") return 0;
  if (tipo === "5%") return 5;
  return 10;
}

export async function crearFacturaDesdeVenta(
  sb: AppSupabaseClient,
  params: {
    empresaId: string;
    clienteId: string;
    ventaId: string;
    items: CreateVentaItemInput[];
    total: number;
    moneda: "GS" | "USD";
    tipoVenta: "CONTADO" | "CREDITO";
    /** Fecha calendario de la venta, `YYYY-MM-DD`. */
    fecha: string;
    fechaVencimiento: string;
    observaciones?: string | null;
  }
): Promise<VentaAFacturaResultado> {
  const numeroFactura = await obtenerSiguienteNumeroFacturaEmpresa(sb, params.empresaId);
  const esCredito = params.tipoVenta === "CREDITO";

  /*
   * Una venta al contado ya está cobrada: nace con saldo 0 y en «Pagado».
   * Marcarla como pendiente obligaría a registrarle un cobro que ya ocurrió
   * en el mostrador, y la dejaría apareciendo en Cobros como deuda.
   */
  const { data, error } = await sb
    .from("facturas")
    .insert([
      {
        empresa_id: params.empresaId,
        cliente_id: params.clienteId,
        numero_factura: numeroFactura,
        fecha: params.fecha,
        fecha_vencimiento: params.fechaVencimiento,
        monto: params.total,
        saldo: esCredito ? params.total : 0,
        estado: esCredito ? "Pendiente" : "Pagado",
        tipo: esCredito ? "credito" : "contado",
        moneda: params.moneda === "USD" ? "USD" : "GS",
        ...(params.observaciones ? { observaciones: params.observaciones } : {}),
      },
    ])
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? "No se pudo crear la factura de la venta.");
  }
  const facturaId = String((data as { id: string }).id);

  /*
   * Una línea de factura por línea de venta, conservando el IVA de cada
   * producto. Agruparlo todo en una sola línea rompería el desglose por tasa
   * que SIFEN exige cuando conviven 10%, 5% y exentas en la misma venta.
   */
  const filas = params.items.map((it) => {
    const linea = montosFacturaItemParaInsert({
      totalLinea: it.total_linea,
      moneda: params.moneda,
      cantidad: it.cantidad,
      precioUnitario: it.precio_venta,
      tasaIva: tasaDe(it.tipo_iva),
    });
    return {
      empresa_id: params.empresaId,
      factura_id: facturaId,
      descripcion: it.producto_nombre,
      cantidad: it.cantidad,
      precio_unitario: linea.precio_unitario,
      subtotal: linea.subtotal,
      iva: linea.iva,
      total: linea.total,
    };
  });

  const { error: errItems } = await sb.from("factura_items").insert(filas);
  if (errItems) {
    // Sin detalle la factura no sirve ni para SIFEN ni para imprimir: se borra.
    await sb.from("facturas").delete().eq("id", facturaId).eq("empresa_id", params.empresaId);
    throw new Error(`No se pudo registrar el detalle de la factura: ${errItems.message}`);
  }

  /*
   * Enlace venta → factura. Es lo único que puede faltar sin romper nada: si
   * la columna `ventas.factura_id` todavía no existe en el esquema, la venta y
   * la factura quedan creadas igual y sólo se pierde la trazabilidad entre las
   * dos. Por eso no se lanza, se avisa en el log.
   */
  const { error: errLink } = await sb
    .from("ventas")
    .update({ factura_id: facturaId })
    .eq("id", params.ventaId)
    .eq("empresa_id", params.empresaId);
  if (errLink) {
    console.warn("[venta-a-factura] no se pudo enlazar la venta con la factura:", errLink.message);
  }

  return { facturaId, numeroFactura };
}
