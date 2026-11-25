// BANCARD vPOS 2.0 — la parte pura (sin red ni base), para poder probarla entera.
//
// Lo que hay que saber de Bancard, en un lugar:
//   · Cada pago lleva un `shop_process_id` NUESTRO, entero, que no se puede repetir nunca en el comercio.
//   · Todo pedido a Bancard y toda confirmación de Bancard van firmados con un "token": md5 de la clave privada
//     pegada a otros campos, en un orden que cambia según la operación (ver `tokens`).
//   · Los montos viajan como texto con dos decimales ("150000.00"), también en guaraníes, y siempre en PYG.
//   · Un pago está aprobado sólo si `response === 'S'` Y `response_code === '00'`.

import { createHash, timingSafeEqual } from "node:crypto";

export type EntornoBancard = "staging" | "produccion";

export const BASE_BANCARD: Readonly<Record<EntornoBancard, string>> = Object.freeze({
  staging: "https://vpos.infonet.com.py:8888",
  produccion: "https://vpos.infonet.com.py",
});

/** El script del formulario de la tarjeta (iframe). Se carga desde el mismo host que la API. */
export function urlScriptCheckout(entorno: EntornoBancard): string {
  return `${BASE_BANCARD[entorno]}/checkout/javascript/dist/bancard-checkout-4.0.0.js`;
}

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

/** Los tokens de cada operación, tal cual los define Bancard. */
export const tokens = {
  singleBuy: (priv: string, spid: string | number, monto: string, moneda: string) => md5(`${priv}${spid}${monto}${moneda}`),
  confirmacion: (priv: string, spid: string | number, monto: string, moneda: string) => md5(`${priv}${spid}confirm${monto}${moneda}`),
  consultarConfirmacion: (priv: string, spid: string | number) => md5(`${priv}${spid}get_confirmation`),
  rollback: (priv: string, spid: string | number) => md5(`${priv}${spid}rollback0.00`),
};

/** Comparación de tokens sin filtrar tiempos. */
export function mismoToken(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), "utf8");
  const y = Buffer.from(b.toLowerCase(), "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Guaraníes enteros → el texto que pide Bancard: 150000 → "150000.00". */
export function montoParaBancard(gs: number): string {
  if (!Number.isSafeInteger(gs) || gs <= 0) throw new Error("monto inválido");
  return `${gs}.00`;
}

/** El texto de Bancard ("150000.00", "150000", 150000) → guaraníes enteros. null si no es un monto entero. */
export function montoDeBancard(texto: unknown): number | null {
  if (typeof texto !== "string" && typeof texto !== "number") return null;
  const m = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(String(texto).trim());
  if (!m) return null;
  if (m[2] && Number(m[2]) !== 0) return null; // en guaraníes no hay centavos
  return Number(m[1]);
}

/** Lo que nos interesa de una confirmación (la que Bancard nos manda o la que devuelve la consulta). */
export interface Confirmacion {
  shopProcessId: string;
  token: string;
  response: string;
  responseCode: string;
  responseDescription: string;
  amount: string;
  currency: string;
  authorizationNumber: string | null;
  ticketNumber: string | null;
}

const texto = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const textoONull = (v: unknown): string | null =>
  (typeof v === "string" || typeof v === "number") && String(v) !== "" ? String(v) : null;

/**
 * Lee el cuerpo que manda Bancard a la URL de confirmación ({ operation: {...} }) o el `confirmation` que devuelve
 * la consulta. null si le falta lo mínimo.
 */
export function leerConfirmacion(cuerpo: unknown): Confirmacion | null {
  if (!cuerpo || typeof cuerpo !== "object") return null;
  const c = cuerpo as Record<string, unknown>;
  const op = (c.operation ?? c.confirmation ?? c) as Record<string, unknown>;
  if (!op || typeof op !== "object") return null;
  const shopProcessId = texto(op.shop_process_id);
  if (!/^\d{1,15}$/.test(shopProcessId)) return null;
  const amount = texto(op.amount);
  const currency = texto(op.currency);
  if (!amount || !currency) return null;
  return {
    shopProcessId,
    token: texto(op.token),
    response: texto(op.response),
    responseCode: texto(op.response_code),
    responseDescription: texto(op.response_description),
    amount,
    currency,
    authorizationNumber: textoONull(op.authorization_number),
    ticketNumber: textoONull(op.ticket_number),
  };
}

/**
 * ¿La firma de esta confirmación es de Bancard? El monto se firma tal cual vino en el texto, así que se prueba
 * con el texto recibido y con el normalizado a dos decimales ("10100" y "10100.00").
 */
export function confirmacionAutentica(c: Confirmacion, clavePrivada: string): boolean {
  if (!c.token) return false;
  const gs = montoDeBancard(c.amount);
  const variantes = new Set([c.amount, gs != null ? `${gs}.00` : c.amount]);
  for (const monto of variantes) {
    if (mismoToken(c.token, tokens.confirmacion(clavePrivada, c.shopProcessId, monto, c.currency))) return true;
  }
  return false;
}

export function confirmacionAprobada(c: Pick<Confirmacion, "response" | "responseCode">): boolean {
  return c.response === "S" && c.responseCode === "00";
}
