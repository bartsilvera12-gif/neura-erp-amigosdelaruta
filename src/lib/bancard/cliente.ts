import "server-only";

// BANCARD vPOS 2.0 — la configuración y los pedidos a Bancard (red). La parte pura vive en ./vpos.ts.
//
// VARIABLES (Coolify):
//   BANCARD_ENTORNO      staging | produccion
//   BANCARD_PUBLIC_KEY   clave pública del comercio (portal de comercios de Bancard)
//   BANCARD_PRIVATE_KEY  clave privada del comercio — NUNCA viaja al navegador
//   BANCARD_URL_SITIO    el sitio público, sin barra final (https://amigosderuta.com): ahí vuelve la persona
//                        después de pagar.
// Sin las cuatro, el pago con tarjeta queda APAGADO: el sitio no muestra el botón y /api/web/pago contesta
// "no disponible".

import { BASE_BANCARD, montoParaBancard, tokens, urlScriptCheckout, type EntornoBancard } from "./vpos";

export interface ConfigBancard {
  entorno: EntornoBancard;
  publicKey: string;
  privateKey: string;
  urlSitio: string;
}

export function configBancard(): ConfigBancard | null {
  const e = process.env.BANCARD_ENTORNO?.trim();
  const entorno: EntornoBancard | null = e === "produccion" ? "produccion" : e === "staging" ? "staging" : null;
  const publicKey = process.env.BANCARD_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.BANCARD_PRIVATE_KEY?.trim() ?? "";
  const urlSitio = (process.env.BANCARD_URL_SITIO?.trim() ?? "").replace(/\/+$/, "");
  if (!entorno || !publicKey || !privateKey || !/^https?:\/\//.test(urlSitio)) return null;
  return { entorno, publicKey, privateKey, urlSitio };
}

export const scriptCheckout = (cfg: ConfigBancard) => urlScriptCheckout(cfg.entorno);

const TIEMPO_MAXIMO_MS = 15_000;

async function postBancard(
  cfg: ConfigBancard,
  ruta: string,
  cuerpo: unknown
): Promise<{ http: number; json: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE_BANCARD[cfg.entorno]}${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { http: res.status, json };
}

/** Un mensaje legible de los errores de Bancard ({ status: 'error', messages: [{ key, level, dsc }] }). */
function mensajesDe(json: Record<string, unknown> | null): string {
  const m = json?.messages;
  if (!Array.isArray(m)) return "sin detalle";
  return (
    m
      .map((x) => (x && typeof x === "object" ? `${(x as { key?: string }).key ?? ""}: ${(x as { dsc?: string }).dsc ?? ""}` : ""))
      .join(" | ") || "sin detalle"
  );
}

export type ResultadoSingleBuy = { ok: true; processId: string } | { ok: false; detalle: string };

/** Abre el pago en Bancard. Devuelve el process_id con el que se dibuja el formulario de la tarjeta. */
export async function crearSingleBuy(
  cfg: ConfigBancard,
  p: { shopProcessId: number; montoGs: number; descripcion: string; urlRetorno: string; urlCancelacion: string }
): Promise<ResultadoSingleBuy> {
  const amount = montoParaBancard(p.montoGs);
  const { http, json } = await postBancard(cfg, "/vpos/api/0.3/single_buy", {
    public_key: cfg.publicKey,
    operation: {
      token: tokens.singleBuy(cfg.privateKey, p.shopProcessId, amount, "PYG"),
      shop_process_id: p.shopProcessId,
      currency: "PYG",
      amount,
      additional_data: "",
      description: p.descripcion.slice(0, 20),
      return_url: p.urlRetorno,
      cancel_url: p.urlCancelacion,
    },
  });
  if (json?.status === "success" && typeof json.process_id === "string" && json.process_id) {
    return { ok: true, processId: json.process_id };
  }
  return { ok: false, detalle: `HTTP ${http} · ${mensajesDe(json)}` };
}

export type ResultadoConsulta =
  | { tipo: "confirmado"; cuerpo: Record<string, unknown> }
  | { tipo: "sin_pago" } // Bancard no tiene un cobro para ese número (no pagó, o todavía no)
  | { tipo: "error"; detalle: string };

/** La consulta de respaldo: ¿qué pasó con este pago? Se usa si la confirmación de Bancard no llegó. */
export async function consultarConfirmacion(cfg: ConfigBancard, shopProcessId: number): Promise<ResultadoConsulta> {
  const { http, json } = await postBancard(cfg, "/vpos/api/0.3/single_buy/confirmations", {
    public_key: cfg.publicKey,
    operation: {
      token: tokens.consultarConfirmacion(cfg.privateKey, shopProcessId),
      shop_process_id: shopProcessId,
    },
  });
  if (json?.status === "success" && json.confirmation && typeof json.confirmation === "object") {
    return { tipo: "confirmado", cuerpo: json.confirmation as Record<string, unknown> };
  }
  const detalle = mensajesDe(json);
  if (/PaymentNotFound|BuyNotFound/i.test(detalle)) return { tipo: "sin_pago" };
  return { tipo: "error", detalle: `HTTP ${http} · ${detalle}` };
}

/** Devuelve el cobro a la tarjeta (sólo el mismo día). Lo pide Bancard para certificar y sirve para anular. */
export async function pedirRollback(cfg: ConfigBancard, shopProcessId: number): Promise<{ ok: boolean; detalle: string }> {
  const { http, json } = await postBancard(cfg, "/vpos/api/0.3/single_buy/rollback", {
    public_key: cfg.publicKey,
    operation: { token: tokens.rollback(cfg.privateKey, shopProcessId), shop_process_id: shopProcessId },
  });
  return { ok: json?.status === "success", detalle: `HTTP ${http} · ${json?.status === "success" ? "ok" : mensajesDe(json)}` };
}
