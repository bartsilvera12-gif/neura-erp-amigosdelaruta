import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { getSifenConfigServiceClientForEmpresa } from "@/lib/sifen/sifen-config-service-client";
import { downloadSifenCertificadoObject } from "@/lib/sifen/sifen-certificados-storage";
import { decryptSecret } from "@/lib/sifen/security";
import { consultarRucSifen } from "@/lib/sifen/consulta-ruc-sifen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/configuracion/sifen/consulta-ruc[?ruc=...]
 *
 * Le pregunta a la SET si un RUC está habilitado como facturador electrónico.
 * Sin `ruc` consulta el de la empresa, que es el caso que importa: permite
 * saber, sin depender de nadie, si el código 1264 se debe a que el RUC no está
 * adherido al régimen o a otra cosa.
 *
 * Usa el certificado y el ambiente ya configurados.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getUserAndEmpresa(request);
    if (!auth) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }

    const sb = await getSifenConfigServiceClientForEmpresa(auth.empresa_id);
    const { data: cfg, error } = await sb
      .from("empresa_sifen_config")
      .select("ruc, ambiente, certificado_path, certificado_password_encrypted")
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!cfg) {
      return NextResponse.json(
        errorResponse("No hay configuración de facturación electrónica para esta empresa."),
        { status: 400 }
      );
    }

    const conf = cfg as {
      ruc?: string | null;
      ambiente?: string | null;
      certificado_path?: string | null;
      certificado_password_encrypted?: string | null;
    };

    const rucPedido = (request.nextUrl.searchParams.get("ruc") ?? "").trim();
    const ruc = rucPedido || String(conf.ruc ?? "");
    if (!ruc) {
      return NextResponse.json(errorResponse("No hay RUC configurado."), { status: 400 });
    }

    const certPath = String(conf.certificado_path ?? "").trim();
    if (!certPath) {
      return NextResponse.json(
        errorResponse("No hay certificado cargado. Subilo en Facturación electrónica."),
        { status: 400 }
      );
    }
    const encPwd = String(conf.certificado_password_encrypted ?? "").trim();
    if (!encPwd) {
      return NextResponse.json(errorResponse("Falta la contraseña del certificado."), { status: 400 });
    }
    const password = decryptSecret(encPwd);

    const p12 = await downloadSifenCertificadoObject(sb, certPath);
    if (!p12.ok) {
      return NextResponse.json(
        errorResponse(`No se pudo descargar el certificado: ${p12.message}`),
        { status: 500 }
      );
    }

    const ambiente = conf.ambiente === "produccion" ? "produccion" : "test";
    const r = await consultarRucSifen({
      ruc,
      empresaConfig: { ambiente, certificadoP12: p12.data, certificadoPassword: password },
    });

    /*
     * El veredicto se devuelve ya interpretado: lo que se necesita saber es si
     * la SET reconoce a ese RUC como facturador electrónico, no leer códigos.
     */
    const veredicto =
      r.soapFault
        ? "No se pudo consultar (la SET devolvió un error de servicio)."
        : r.esFacturadorElectronico === "S"
          ? "El RUC SÍ figura como facturador electrónico en la SET."
          : r.esFacturadorElectronico === "N"
            ? "El RUC NO figura como facturador electrónico en la SET. Falta la habilitación del régimen."
            : "La SET respondió, pero no informó si el RUC es facturador electrónico.";

    return NextResponse.json(
      successResponse({
        ambiente,
        /* El normalizado, que es el que viajó a la SET: mostrar `80176053-4`
           cuando se consultó `80176053` hace dudar de qué se pregunto. */
        ruc_consultado: ruc.trim().split("-")[0]?.replace(/[^0-9]/g, "") ?? ruc,
        veredicto,
        facturador_electronico: r.esFacturadorElectronico,
        razon_social: r.razonSocial,
        estado_contribuyente: r.dDesEstCons,
        codigo_respuesta: r.dCodRes,
        mensaje_respuesta: r.dMsgRes,
        http_status: r.httpStatus,
        soap_fault: r.soapFault ? r.faultString : null,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo consultar el RUC.";
    console.error("[/api/configuracion/sifen/consulta-ruc]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
