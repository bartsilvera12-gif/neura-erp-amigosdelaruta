import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { loadValidatedSifenPayload } from "@/lib/sifen/load-factura-payload";
import { kudeParsedDesdeBorrador } from "@/lib/sifen/kude-vista-previa";
import { buildKudePdfBuffer } from "@/lib/sifen/kude-pdf";
import { loadKudeBranding } from "@/lib/sifen/kude-branding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — vista previa del KuDE, ANTES de emitir.
 *
 * Deliberadamente no escribe nada: no crea el borrador del documento
 * electrónico, no genera el XML, no firma, no pide CDC y no toca la
 * numeración fiscal. Lee los mismos datos comerciales que irían al XML y los
 * dibuja con el formato del KuDE, con la marca «vista previa» encima.
 *
 * Es para contestar la pregunta que hoy sólo se puede contestar emitiendo:
 * cómo va a quedar la factura. Si algo está mal —el cliente, un IVA, un
 * total, el logo— se corrige antes, no después de consumir un número.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id: facturaId } = await params;
    const fid = (facturaId ?? "").trim();
    if (!fid) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }

    /*
     * El mismo cargador que usa la generación real. Si los datos no alcanzan
     * para armar un DE —falta el RUC del receptor, no hay ítems, falta el
     * timbrado— el error aparece acá, que es exactamente el momento en que
     * conviene enterarse.
     */
    const loaded = await loadValidatedSifenPayload(supabase, auth.empresa_id, fid, {
      sinBorrador: true,
    });
    if (!loaded.ok) {
      return NextResponse.json(errorResponse(loaded.error.message), {
        status: loaded.error.status,
      });
    }

    const parsed = kudeParsedDesdeBorrador(loaded.payload);

    let branding = null;
    try {
      branding = await loadKudeBranding(supabase, auth.empresa_id);
    } catch {
      /* Sin branding se usa el diseño por defecto; no vale fallar por el logo. */
    }

    const pdf = await buildKudePdfBuffer({
      parsed,
      numeroFactura: loaded.payload.documento.numero_factura,
      dProtAut: null,
      /* El QR del KuDE real apunta a la consulta pública del documento en la
         SET. Como este documento no existe todavía, el código apunta al aviso
         en vez de a una dirección que daría «no encontrado». */
      qrUrl: "VISTA PREVIA - documento no emitido",
      branding,
      vistaPrevia: true,
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="vista-previa-${loaded.payload.documento.numero_factura}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo generar la vista previa.";
    console.error("[/api/facturas/[id]/sifen/vista-previa]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
