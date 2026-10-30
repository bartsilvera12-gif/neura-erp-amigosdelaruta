import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Emisión completa de la factura electrónica, encadenada desde la caja.
 *
 * El cajero no tiene por qué conocer el circuito de SIFEN —borrador, XML,
 * firma, envío, consulta del lote—. Son cinco pasos técnicos que siempre van
 * en el mismo orden y que el sistema puede hacer solo: lo único que la
 * persona decidió fue vender y facturar.
 *
 * Se informa el avance por `onPaso` para que la pantalla cuente qué está
 * pasando, porque el envío al SET tarda y una espera muda parece un cuelgue.
 */

export type PasoEmision = "venta" | "documento" | "set";

export type ResultadoEmision =
  | { ok: true; estado: "aprobado" | "enviado" }
  | { ok: false; paso: PasoEmision; error: string };

async function post(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetchWithSupabaseSession(path, { method: "POST" });
  if (res.ok) return { ok: true };
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: j?.error ?? `Error ${res.status}` };
}

async function estadoActual(facturaId: string): Promise<string> {
  const res = await fetchWithSupabaseSession(`/api/facturas/${facturaId}/sifen/resumen`, {
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as {
    data?: { factura_electronica?: { estado_sifen?: string } | null };
  };
  return String(j?.data?.factura_electronica?.estado_sifen ?? "");
}

export async function emitirFacturaDesdeCaja(
  facturaId: string,
  onPaso: (p: PasoEmision) => void
): Promise<ResultadoEmision> {
  try {
    onPaso("documento");

    let st = await estadoActual(facturaId);
    if (!st) {
      const r = await post(`/api/facturas/${facturaId}/sifen/borrador`);
      if (!r.ok) return { ok: false, paso: "documento", error: r.error };
      st = await estadoActual(facturaId);
    }
    if (st === "borrador") {
      const r = await post(`/api/facturas/${facturaId}/sifen/xml`);
      if (!r.ok) return { ok: false, paso: "documento", error: r.error };
      st = await estadoActual(facturaId);
    }
    if (st === "generado") {
      const r = await post(`/api/facturas/${facturaId}/sifen/firmar`);
      if (!r.ok) return { ok: false, paso: "documento", error: r.error };
      st = await estadoActual(facturaId);
    }

    onPaso("set");

    if (st === "firmado" || st === "error_envio") {
      const r = await post(`/api/facturas/${facturaId}/sifen/enviar`);
      if (!r.ok) return { ok: false, paso: "set", error: r.error };
      st = await estadoActual(facturaId);
    }

    if (st === "aprobado") return { ok: true, estado: "aprobado" };

    /*
     * El lote es asíncrono: SET lo encola y responde después. Se consulta unas
     * pocas veces con una pausa corta; si para entonces no resolvió, la venta
     * ya está hecha y el documento queda "enviado" para consultarlo más tarde.
     * Esperar indefinidamente dejaría al cajero mirando una pantalla.
     */
    for (let i = 0; i < 5 && (st === "enviado" || st === "en_proceso"); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      await post(`/api/facturas/${facturaId}/sifen/consulta-lote`);
      st = await estadoActual(facturaId);
    }

    if (st === "aprobado") return { ok: true, estado: "aprobado" };
    if (st === "rechazado") {
      return { ok: false, paso: "set", error: "El SET rechazó el documento. Abrí la factura para ver el motivo." };
    }
    return { ok: true, estado: "enviado" };
  } catch (e) {
    return {
      ok: false,
      paso: "set",
      error: e instanceof Error ? e.message : "No se pudo emitir la factura.",
    };
  }
}
