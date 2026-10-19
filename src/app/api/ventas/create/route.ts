import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { createVentaTransaccionalPg } from "@/lib/ventas/server/create-venta-pg";
import type { CreateVentaItemInput } from "@/lib/ventas/server/create-venta-pg";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { Venta, LineaVenta } from "@/lib/ventas/types";
import { getFacturasServiceClientForEmpresa } from "@/lib/facturacion/facturas-service-client";
import { crearFacturaDesdeVenta } from "@/lib/ventas/server/venta-a-factura";
import { fechaMasDiasCalendario } from "@/lib/fechas/calendario";

function asItems(body: unknown): CreateVentaItemInput[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { items?: unknown }).items;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CreateVentaItemInput[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") return null;
    const r = x as Record<string, unknown>;
    const tipoIva = r.tipo_iva;
    if (tipoIva !== "EXENTA" && tipoIva !== "5%" && tipoIva !== "10%") return null;
    out.push({
      producto_id: String(r.producto_id ?? ""),
      producto_nombre: String(r.producto_nombre ?? ""),
      sku: String(r.sku ?? ""),
      cantidad: Number(r.cantidad),
      precio_venta_original: Number(r.precio_venta_original),
      precio_venta: Number(r.precio_venta),
      tipo_iva: tipoIva,
      subtotal: Number(r.subtotal),
      monto_iva: Number(r.monto_iva),
      total_linea: Number(r.total_linea),
    });
  }
  if (out.some((i) => !i.producto_id || !(i.cantidad > 0))) return null;
  return out;
}

function toVentaResponse(
  items: CreateVentaItemInput[],
  meta: {
    id: string;
    numero_control: string;
    fechaIso: string;
    moneda: Venta["moneda"];
    tipo_cambio: number;
    tipo_venta: Venta["tipo_venta"];
    plazo_dias?: number;
    subtotal: number;
    monto_iva: number;
    total: number;
  }
): Venta {
  const lineas: LineaVenta[] = items.map((i) => ({
    producto_id: i.producto_id,
    producto_nombre: i.producto_nombre,
    sku: i.sku,
    cantidad: i.cantidad,
    precio_venta_original: i.precio_venta_original,
    precio_venta: i.precio_venta,
    tipo_iva: i.tipo_iva,
    subtotal: i.subtotal,
    monto_iva: i.monto_iva,
    total_linea: i.total_linea,
  }));
  return {
    id: meta.id,
    numero_control: meta.numero_control,
    items: lineas,
    moneda: meta.moneda,
    tipo_cambio: meta.tipo_cambio,
    subtotal: meta.subtotal,
    monto_iva: meta.monto_iva,
    total: meta.total,
    tipo_venta: meta.tipo_venta,
    plazo_dias: meta.plazo_dias,
    fecha: meta.fechaIso,
  };
}

/**
 * POST /api/ventas/create — venta + ítems + stock + movimientos (una transacción Postgres).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getUserAndEmpresa(request);
    if (!auth) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const items = asItems(body);
    if (!items) {
      return NextResponse.json(errorResponse("Payload inválido: items requeridos."), { status: 400 });
    }

    const o = body as Record<string, unknown>;
    const moneda = o.moneda === "USD" ? "USD" : "GS";
    const tipoCambio = Number(o.tipo_cambio) || 1;
    const tipoVenta = o.tipo_venta === "CREDITO" ? "CREDITO" : "CONTADO";
    /*
     * `emitir_factura`: la caja elige entre factura y ticket interno. Sin el
     * campo se asume ticket, que es el comportamiento que tenia esta ruta
     * antes del puente: asi un cliente viejo de la API no empieza a emitir
     * documentos sin haberlo pedido.
     */
    const emitirFactura = o.emitir_factura === true;
    const plazoDias =
      tipoVenta === "CREDITO" && o.plazo_dias != null && String(o.plazo_dias).trim() !== ""
        ? parseInt(String(o.plazo_dias), 10)
        : null;
    const clienteRaw = o.cliente_id;
    const clienteId =
      clienteRaw === null || clienteRaw === undefined || clienteRaw === ""
        ? null
        : String(clienteRaw);
    const observaciones =
      o.observaciones === null || o.observaciones === undefined
        ? null
        : String(o.observaciones).slice(0, 4000);

    /*
     * Cómo se cobró. Lo suma el arqueo de la caja, así que se valida contra la
     * lista cerrada en vez de guardar lo que venga: un "Efectivo" con mayúscula
     * saldría del cálculo sin que nadie se entere. Si no viene, queda null y la
     * venta no suma a ningún medio.
     */
    const METODOS_PAGO = ["efectivo", "tarjeta", "transferencia", "cheque", "otro"];
    const metodoPagoRaw = typeof o.metodo_pago === "string" ? o.metodo_pago.trim().toLowerCase() : "";
    const metodoPago = METODOS_PAGO.includes(metodoPagoRaw) ? metodoPagoRaw : null;

    const subtotalDeclarado = Number(o.subtotal);
    const montoIvaDeclarado = Number(o.monto_iva);
    const totalDeclarado = Number(o.total);

    if ([subtotalDeclarado, montoIvaDeclarado, totalDeclarado].some((n) => Number.isNaN(n))) {
      return NextResponse.json(errorResponse("Totales inválidos."), { status: 400 });
    }

    if (moneda === "USD" && tipoCambio <= 0) {
      return NextResponse.json(errorResponse("Tipo de cambio inválido para USD."), { status: 400 });
    }

    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);

    const { ventaId, numeroControl, fechaIso } = await createVentaTransaccionalPg({
      schema,
      empresaId: auth.empresa_id,
      clienteId,
      observaciones,
      moneda,
      tipoCambio,
      tipoVenta,
      plazoDias: Number.isFinite(plazoDias as number) ? plazoDias : null,
      items,
      subtotalDeclarado,
      montoIvaDeclarado,
      totalDeclarado,
      metodoPago,
      createdBy: auth.usuarioCatalogId ?? null,
      // Se guarda el nombre además del id: el detalle del turno tiene que
      // seguir diciendo quién vendió aunque después se borre el usuario.
      usuarioNombre:
        (auth.user?.user_metadata?.nombre as string | undefined)?.trim() ||
        auth.user?.email ||
        null,
    });

    let sub = 0;
    let iv = 0;
    let tot = 0;
    for (const it of items) {
      sub += it.subtotal;
      iv += it.monto_iva;
      tot += it.total_linea;
    }

    const venta = toVentaResponse(items, {
      id: ventaId,
      numero_control: numeroControl,
      fechaIso,
      moneda,
      tipo_cambio: tipoCambio,
      tipo_venta: tipoVenta,
      plazo_dias: tipoVenta === "CREDITO" ? plazoDias ?? undefined : undefined,
      subtotal: sub,
      monto_iva: iv,
      total: tot,
    });

    /*
     * Puente venta → factura. Solo si la caja lo pidió (`emitir_factura`): el
     * cajero puede estar haciendo un ticket interno, y en ese caso no
     * corresponde emitir un documento.
     *
     * Es best-effort a propósito. La venta ya está confirmada y el stock ya se
     * descontó: si falla la factura no se puede deshacer eso sin inventar una
     * devolución. Se devuelve `factura_warning` y la caja avisa, en vez de
     * perder una venta que ya ocurrió en el mostrador.
     */
    let factura: { id: string; numero_factura: string } | null = null;
    let facturaWarning: string | null = null;

    if (emitirFactura) {
      try {
        if (!clienteId) {
          throw new Error("Para emitir una factura hace falta elegir el cliente.");
        }
        const sbFac = await getFacturasServiceClientForEmpresa(auth.empresa_id);
        const fechaCal = fechaIso.slice(0, 10);
        const r = await crearFacturaDesdeVenta(sbFac, {
          empresaId: auth.empresa_id,
          clienteId,
          ventaId,
          items,
          total: tot,
          moneda,
          tipoVenta,
          fecha: fechaCal,
          fechaVencimiento:
            tipoVenta === "CREDITO" && Number.isFinite(plazoDias as number) && (plazoDias as number) > 0
              ? fechaMasDiasCalendario(fechaCal, plazoDias as number)
              : fechaCal,
          observaciones,
        });
        factura = { id: r.facturaId, numero_factura: r.numeroFactura };
      } catch (e) {
        facturaWarning = e instanceof Error ? e.message : "No se pudo crear la factura de la venta.";
        console.error("[ventas/create] puente venta→factura:", facturaWarning);
      }
    }

    return NextResponse.json(successResponse({ venta, factura, factura_warning: facturaWarning }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al crear la venta.";
    const status =
      msg.includes("Stock insuficiente") ||
      msg.includes("no existen") ||
      msg.includes("Cliente no encontrado") ||
      msg.includes("Totales no coinciden") ||
      msg.includes("al menos un")
        ? 400
        : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
