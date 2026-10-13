export type TipoIvaVenta = "EXENTA" | "5%" | "10%";
export type TipoVenta   = "CONTADO" | "CREDITO";
export type MonedaVenta = "GS" | "USD";
export type MetodoPagoVenta = "efectivo" | "tarjeta" | "transferencia" | "cheque" | "otro";

/** Etiquetas para los selectores. El valor es el que viaja a la base. */
export const METODOS_PAGO_VENTA: { value: MetodoPagoVenta; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "transferencia", label: "Transferencia" },
  { value: "cheque", label: "Cheque" },
  { value: "otro", label: "Otro" },
];

/** Un ítem dentro de una venta (una línea de producto). */
export interface LineaVenta {
  producto_id:           string;
  producto_nombre:       string;
  sku:                   string;
  cantidad:              number;
  precio_venta_original: number;  // en la moneda elegida
  precio_venta:          number;  // siempre en GS
  tipo_iva:              TipoIvaVenta;
  subtotal:              number;  // precio_venta × cantidad
  monto_iva:             number;
  total_linea:           number;  // subtotal + monto_iva
}

/** Cabecera de venta: condiciones comerciales + totales consolidados. */
export interface Venta {
  /** UUID en base de datos (antes del bloque DB-first era numérico local). */
  id:             string;
  numero_control: string;   // VTA-000001, VTA-000002, …

  items: LineaVenta[];       // 1 o más productos

  moneda:      MonedaVenta;
  tipo_cambio: number;       // 1 si moneda === "GS"

  subtotal:  number;         // Σ subtotal de ítems
  monto_iva: number;         // Σ monto_iva de ítems
  total:     number;         // Σ total_linea de ítems

  tipo_venta: TipoVenta;
  plazo_dias?: number;       // solo si tipo_venta === "CREDITO"

  /**
   * Cómo se cobró. Es lo que suma el arqueo del turno de caja, por eso la lista
   * es cerrada y coincide con el CHECK de `ventas.metodo_pago` en la base.
   * `null` en las ventas anteriores al módulo Caja.
   */
  metodo_pago?: MetodoPagoVenta | null;

  fecha: string;             // ISO string, generado automáticamente
}
