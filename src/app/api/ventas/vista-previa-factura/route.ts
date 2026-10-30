import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { validateAndBuildSifenPayload } from "@/lib/sifen/build-payload";
import { kudeParsedDesdeBorrador } from "@/lib/sifen/kude-vista-previa";
import { buildKudePdfBuffer } from "@/lib/sifen/kude-pdf";
import { loadKudeBranding } from "@/lib/sifen/kude-branding";
import { hoyYmdLocal } from "@/lib/fechas/calendario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — vista previa de la factura DESDE EL CARRITO, antes de confirmar.
 *
 * Es la versión que importa: no existe factura, no existe venta, no hay
 * numeración tomada ni stock descontado. Se mira cómo va a quedar y recién
 * después se decide.
 *
 * La que vive en `/api/facturas/[id]/sifen/vista-previa` sigue sirviendo para
 * una factura ya creada, pero llega tarde para esta pregunta.
 *
 * Body: { items: [{descripcion, cantidad, precio_unitario, subtotal, iva,
 * total}], cliente_id?, cliente_nombre?, cliente_ruc?, moneda?, tipo? }
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json(errorResponse("Body inválido."), { status: 400 });

    const crudos = Array.isArray(body.items) ? body.items : [];
    if (crudos.length === 0) {
      return NextResponse.json(errorResponse("No hay ítems para previsualizar."), { status: 400 });
    }

    const items = crudos.map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        descripcion: String(o.descripcion ?? "").slice(0, 200) || "Ítem",
        cantidad: Number(o.cantidad) || 0,
        precio_unitario: Number(o.precio_unitario) || 0,
        subtotal: Number(o.subtotal) || 0,
        iva: Number(o.iva) || 0,
        total: Number(o.total) || 0,
      };
    });

    const { data: config, error: errCfg } = await supabase
      .from("empresa_sifen_config")
      .select(
        "ruc, razon_social, direccion_fiscal, timbrado_numero, timbrado_fecha_inicio_vigencia, actividad_economica_codigo, actividad_economica_descripcion, establecimiento, punto_expedicion, csc, activo"
      )
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();
    if (errCfg) throw new Error(errCfg.message);

    /*
     * El receptor puede venir como cliente ya existente o escrito a mano: en
     * la caja todavía se está decidiendo a quién se le factura.
     */
    const clienteId = typeof body.cliente_id === "string" ? body.cliente_id.trim() : "";
    let cliente: Record<string, unknown> | null = null;
    if (clienteId) {
      const { data } = await supabase
        .from("clientes")
        .select(
          "id, empresa, razon_social, ruc_factura, nombre_contacto, nombre, ruc, documento, direccion, telefono, email, pais, sifen_receptor_extranjero, sifen_codigo_pais, sifen_tipo_doc_receptor, sifen_receptor_manual, sifen_receptor_naturaleza, sifen_ti_ope, sifen_num_id_de, sifen_direccion_de, sifen_num_casa_de, sifen_descripcion_tipo_doc"
        )
        .eq("id", clienteId)
        .eq("empresa_id", auth.empresa_id)
        .maybeSingle();
      cliente = (data as Record<string, unknown>) ?? null;
    }
    if (!cliente) {
      const nombre = String(body.cliente_nombre ?? "").trim();
      const ruc = String(body.cliente_ruc ?? "").trim();
      if (!nombre || !ruc) {
        return NextResponse.json(
          errorResponse("Elegí el cliente o cargá su nombre y RUC para ver la vista previa."),
          { status: 400 }
        );
      }
      cliente = { id: "vista-previa", nombre, nombre_contacto: nombre, razon_social: nombre, ruc, ruc_factura: ruc };
    }

    const total = items.reduce((a, i) => a + i.total, 0);
    const moneda = body.moneda === "USD" ? "USD" : "GS";

    const built = validateAndBuildSifenPayload({
      factura: {
        id: "vista-previa",
        cliente_id: String(cliente.id ?? "vista-previa"),
        /* Sin número todavía: se asigna al confirmar la venta. */
        numero_factura: "—",
        fecha: hoyYmdLocal(),
        tipo: body.tipo === "credito" ? "credito" : "contado",
        moneda,
        monto: total,
        saldo: 0,
      } as Parameters<typeof validateAndBuildSifenPayload>[0]["factura"],
      items: items as unknown as Parameters<typeof validateAndBuildSifenPayload>[0]["items"],
      cliente: cliente as unknown as Parameters<typeof validateAndBuildSifenPayload>[0]["cliente"],
      config: config as Parameters<typeof validateAndBuildSifenPayload>[0]["config"],
      facturaElectronica: { id: "vista-previa", estado_sifen: "borrador" } as Parameters<
        typeof validateAndBuildSifenPayload
      >[0]["facturaElectronica"],
    });

    if (!built.ok) {
      return NextResponse.json(errorResponse(built.error), { status: 400 });
    }

    let branding = null;
    try {
      branding = await loadKudeBranding(supabase, auth.empresa_id);
    } catch {
      /* Sin branding se usa el diseño por defecto. */
    }

    const pdf = await buildKudePdfBuffer({
      parsed: kudeParsedDesdeBorrador(built.payload),
      numeroFactura: "—",
      dProtAut: null,
      qrUrl: "VISTA PREVIA - documento no emitido",
      branding,
      vistaPrevia: true,
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="vista-previa-factura.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo generar la vista previa.";
    console.error("[/api/ventas/vista-previa-factura]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
