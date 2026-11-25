import { NextResponse } from "next/server";
import { configBancard } from "@/lib/bancard/cliente";
import { acreditarPago, registrarConfirmacion } from "@/lib/bancard/pagos";
import { confirmacionAutentica, leerConfirmacion } from "@/lib/bancard/vpos";
import { empresaDeLaInstancia } from "@/lib/web/publico";

/**
 * LA URL DE CONFIRMACIÓN DE BANCARD: https://amigosdelaruta.neura.com.py/api/web/pago/confirmacion
 *
 * Se carga en el portal de comercios de Bancard (Perfil de aplicación → URL de confirmación). Bancard la llama de
 * servidor a servidor cuando la persona termina de pagar; no lleva CORS porque no la llama un navegador.
 *
 * Se contesta { status: "success" } siempre que la firma sea de Bancard, también para un rechazo: es "recibido", no
 * "aprobado". Bancard espera el 200 en menos de 30 s. Acreditar es idempotente, así que una segunda confirmación del
 * mismo pago no lo carga dos veces.
 */

export const dynamic = "force-dynamic";

const ok = () => NextResponse.json({ status: "success" });
const no = (http: number, motivo: string) =>
  NextResponse.json({ status: "error", messages: [{ key: motivo, level: "error", dsc: motivo }] }, { status: http });

export async function POST(request: Request) {
  const cfg = configBancard();
  if (!cfg) return no(503, "NotConfigured");

  const cuerpo = await request.json().catch(() => null);
  const c = leerConfirmacion(cuerpo);
  if (!c) return no(400, "InvalidBody");

  if (!confirmacionAutentica(c, cfg.privateKey)) {
    console.warn("[bancard] confirmación con firma inválida", c.shopProcessId);
    return no(401, "InvalidToken");
  }

  try {
    const empresaId = await empresaDeLaInstancia();
    const r = await registrarConfirmacion(empresaId, c);
    if (r.tipo === "desconocido") return no(404, "UnknownShopProcessId");
    if (r.estado === "aprobado") {
      // Si falla por algo pasajero queda 'aprobado' y lo reintenta la pantalla de resultado; igual se le contesta a
      // Bancard que se recibió, porque el cobro ya quedó anotado.
      await acreditarPago(empresaId, r.pagoId).catch(() => {});
    }
    return ok();
  } catch (e) {
    console.error("[bancard] error procesando la confirmación", c.shopProcessId, e instanceof Error ? e.message : e);
    return no(500, "InternalError");
  }
}
