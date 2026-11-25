import "server-only";

// BANCARD — los pagos del sitio en la base: abrir, anotar la confirmación y acreditar.
//
// Una fila de `bancard_pago` por intento. Estados:
//   creado → pendiente (Bancard dio process_id) → aprobado | rechazado
//   aprobado → acreditando → acreditado    (entró en reserva_pagos / se marcó el pedido)
//   error: no se pudo abrir el pago en Bancard; no se cobró nada.
//
// El monto lo decide SIEMPRE el servidor: la seña sale de `web_config.cobro_bancard` y el total del pedido de
// `web_pedido`. El navegador sólo dice qué reserva o qué pedido quiere pagar, por su uuid.

import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { consultarConfirmacion, crearSingleBuy, pedirRollback, scriptCheckout, type ConfigBancard } from "./cliente";
import { confirmacionAprobada, leerConfirmacion, montoDeBancard, type Confirmacion } from "./vpos";

type Sb = Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>;
type Fila = Record<string, unknown>;

export class ErrorPago extends Error {
  constructor(mensaje: string, public status = 400) {
    super(mensaje);
  }
}

/** Lo que se cobra por Bancard: seña por reserva (en USD) y Gs por dólar. */
export interface CobroConfig {
  senaUsd: number;
  tasaUsdPyg: number;
  fechaTasa: string | null;
}

export async function leerCobroConfig(sb: Sb, empresaId: string): Promise<CobroConfig> {
  const { data, error } = await sb
    .from("web_config")
    .select("valor")
    .eq("empresa_id", empresaId)
    .eq("clave", "cobro_bancard")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const v = ((data as Fila | null)?.valor ?? {}) as Fila;
  const senaUsd = Number(v.sena_usd);
  const tasaUsdPyg = Number(v.tasa_usd_pyg);
  if (!(senaUsd > 0) || !(tasaUsdPyg > 0)) {
    throw new ErrorPago("El pago con tarjeta no está configurado (falta la seña o la cotización).", 503);
  }
  return { senaUsd, tasaUsdPyg, fechaTasa: typeof v.fecha_tasa === "string" ? v.fecha_tasa : null };
}

const esGuarani = (m: string) => /^(PYG|GS|G)$/i.test(m.trim());

/** Pasa un importe a Gs enteros. Devuelve también el tipo de cambio aplicado (1 si ya era Gs). */
function aGuaranies(importe: number, moneda: string, cfg: CobroConfig): { gs: number; tipoCambio: number } {
  if (esGuarani(moneda)) return { gs: Math.round(importe), tipoCambio: 1 };
  if (moneda.toUpperCase() === "USD") return { gs: Math.round(importe * cfg.tasaUsdPyg), tipoCambio: cfg.tasaUsdPyg };
  throw new ErrorPago(`No se puede cobrar con tarjeta un importe en ${moneda}.`, 409);
}

export interface PagoAbierto {
  pagoId: string;
  processId: string;
  scriptUrl: string;
  montoGs: number;
  descripcion: string;
}

/** Abre un pago en Bancard para la seña de una reserva o el total de un pedido de la tienda. */
export async function abrirPago(
  cfg: ConfigBancard,
  empresaId: string,
  pedido: { tipo: "reserva" | "pedido"; id: string }
): Promise<PagoAbierto> {
  const sb = await getChatServiceClientForEmpresa(empresaId);
  const cobro = await leerCobroConfig(sb, empresaId);

  let fila: Fila;
  if (pedido.tipo === "reserva") {
    const { data: r, error } = await sb
      .from("reserva_saldos")
      .select("reserva_id, codigo, moneda, estado, total_contratado, total_abonado, saldo")
      .eq("empresa_id", empresaId)
      .eq("reserva_id", pedido.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) throw new ErrorPago("Esa reserva no existe.", 404);
    const res = r as Fila;
    if (res.estado === "cancelada") throw new ErrorPago("Esa reserva está cancelada.", 409);
    if (Number(res.total_abonado) > 0) throw new ErrorPago("Esta reserva ya tiene la seña paga.", 409);
    const moneda = String(res.moneda ?? "USD");
    const saldo = Number(res.saldo ?? 0);
    // La seña es fija en USD; si la reserva está en Gs se pasa a Gs. Nunca más que lo que falta pagar.
    const senaEnMoneda = esGuarani(moneda) ? cobro.senaUsd * cobro.tasaUsdPyg : cobro.senaUsd;
    const importe = saldo > 0 ? Math.min(senaEnMoneda, saldo) : senaEnMoneda;
    const { gs, tipoCambio } = aGuaranies(importe, moneda, cobro);
    fila = {
      tipo: "reserva",
      reserva_id: pedido.id,
      descripcion: `Seña ${String(res.codigo)}`,
      monto_gs: gs,
      moneda_origen: moneda,
      importe_origen: importe,
      tipo_cambio: tipoCambio,
    };
  } else {
    const { data: p, error } = await sb
      .from("web_pedido")
      .select("id, numero, estado, moneda, total, pagado_at")
      .eq("empresa_id", empresaId)
      .eq("id", pedido.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new ErrorPago("Ese pedido no existe.", 404);
    const ped = p as Fila;
    if (ped.estado === "cancelado") throw new ErrorPago("Ese pedido está cancelado.", 409);
    if (ped.pagado_at) throw new ErrorPago("Ese pedido ya está pago.", 409);
    const moneda = String(ped.moneda ?? "USD");
    const importe = Number(ped.total ?? 0);
    if (!(importe > 0)) throw new ErrorPago("El pedido no tiene importe.", 409);
    const { gs, tipoCambio } = aGuaranies(importe, moneda, cobro);
    fila = {
      tipo: "pedido",
      pedido_id: pedido.id,
      descripcion: `Pedido ADR ${String(ped.numero)}`,
      monto_gs: gs,
      moneda_origen: moneda,
      importe_origen: importe,
      tipo_cambio: tipoCambio,
    };
  }

  const { data: nuevo, error: errI } = await sb
    .from("bancard_pago")
    .insert({ ...fila, empresa_id: empresaId, entorno: cfg.entorno, estado: "creado" })
    .select("id, shop_process_id, monto_gs, descripcion")
    .single();
  if (errI) throw new Error(errI.message);
  const pago = nuevo as Fila;
  const pagoId = String(pago.id);
  const spid = Number(pago.shop_process_id);
  const montoGs = Number(pago.monto_gs);
  const descripcion = String(pago.descripcion);

  const urlRetorno = `${cfg.urlSitio}/?pago=${pagoId}`;
  const r = await crearSingleBuy(cfg, {
    shopProcessId: spid,
    montoGs,
    descripcion,
    urlRetorno,
    urlCancelacion: urlRetorno,
  });
  if (!r.ok) {
    await sb.from("bancard_pago").update({ estado: "error", motivo: r.detalle.slice(0, 500) }).eq("id", pagoId);
    console.error("[bancard] single_buy rechazado", spid, r.detalle);
    throw new ErrorPago("No se pudo abrir el pago con tarjeta. Probá de nuevo en un momento.", 502);
  }
  await sb.from("bancard_pago").update({ estado: "pendiente", process_id: r.processId }).eq("id", pagoId);
  return { pagoId, processId: r.processId, scriptUrl: scriptCheckout(cfg), montoGs, descripcion };
}

export type ResultadoRegistro =
  | { tipo: "desconocido" }
  | { tipo: "procesado"; pagoId: string; empresaId: string; estado: string };

/**
 * Anota lo que dice Bancard (de su confirmación o de la consulta). Idempotente: si el pago ya estaba resuelto, no lo
 * toca. Un monto o moneda que no coincide con lo pedido se trata como rechazo y queda el motivo.
 */
export async function registrarConfirmacion(empresaId: string, c: Confirmacion): Promise<ResultadoRegistro> {
  const sb = await getChatServiceClientForEmpresa(empresaId);
  const { data, error } = await sb
    .from("bancard_pago")
    .select("id, estado, monto_gs")
    .eq("empresa_id", empresaId)
    .eq("shop_process_id", Number(c.shopProcessId))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { tipo: "desconocido" };
  const pago = data as Fila;
  const pagoId = String(pago.id);
  const actual = String(pago.estado);
  if (!["creado", "pendiente", "error"].includes(actual)) {
    return { tipo: "procesado", pagoId, empresaId, estado: actual };
  }

  const gs = montoDeBancard(c.amount);
  const coincide = gs === Number(pago.monto_gs) && c.currency.toUpperCase() === "PYG";
  const aprobado = coincide && confirmacionAprobada(c);
  const estado = aprobado ? "aprobado" : "rechazado";

  const { data: upd, error: errU } = await sb
    .from("bancard_pago")
    .update({
      estado,
      response_code: c.responseCode || null,
      response_description: c.responseDescription || null,
      authorization_number: c.authorizationNumber,
      ticket_number: c.ticketNumber,
      confirmado_at: new Date().toISOString(),
      motivo: coincide ? null : `Monto/moneda no coincide: Bancard ${c.amount} ${c.currency}, pedido ${String(pago.monto_gs)} PYG`,
    })
    .eq("id", pagoId)
    .in("estado", ["creado", "pendiente", "error"])
    .select("estado")
    .maybeSingle();
  if (errU) throw new Error(errU.message);
  if (!coincide) console.error("[bancard] confirmación con monto distinto", c.shopProcessId, c.amount, c.currency);
  return { tipo: "procesado", pagoId, empresaId, estado: upd ? estado : actual };
}

/**
 * Lleva un pago aprobado a donde corresponde: un pago de la reserva o la marca de pagado del pedido. Idempotente: se
 * "toma" el pago pasándolo a `acreditando`, y el índice único de reserva_pagos frena un segundo registro.
 */
export async function acreditarPago(empresaId: string, pagoId: string): Promise<void> {
  const sb = await getChatServiceClientForEmpresa(empresaId);
  const { data: tomado, error } = await sb
    .from("bancard_pago")
    .update({ estado: "acreditando" })
    .eq("id", pagoId)
    .eq("estado", "aprobado")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!tomado) return; // otro proceso lo tomó, o no estaba aprobado
  const p = tomado as Fila;
  const spid = String(p.shop_process_id);
  const referencia = `Bancard · ticket ${p.ticket_number ?? "-"} · aut. ${p.authorization_number ?? "-"}`;

  try {
    let reservaPagoId: string | null = null;
    if (p.tipo === "reserva") {
      const { data: rp, error: errR } = await sb
        .from("reserva_pagos")
        .insert({
          empresa_id: empresaId,
          reserva_id: p.reserva_id,
          moneda: "PYG",
          importe: Number(p.monto_gs),
          tipo_cambio: Number(p.tipo_cambio),
          moneda_equivalente: String(p.moneda_origen),
          importe_equivalente: Number(p.importe_origen),
          medio: "tarjeta",
          referencia,
          pasarela_proveedor: "bancard",
          pasarela_payment_id: spid,
          estado: "confirmado",
        })
        .select("id")
        .single();
      if (errR && (errR as { code?: string }).code !== "23505") throw new Error(errR.message);
      if (rp) reservaPagoId = String((rp as Fila).id);
      // La seña paga la pasa de solicitud a reserva firme. Un estado más avanzado no se toca.
      await sb.from("reservas").update({ estado: "reservada" }).eq("id", p.reserva_id).eq("estado", "cotizacion");
    } else {
      const { error: errP } = await sb
        .from("web_pedido")
        .update({ pagado_at: new Date().toISOString(), pago_referencia: referencia, medio_pago: "Tarjeta (Bancard)" })
        .eq("id", p.pedido_id)
        .is("pagado_at", null);
      if (errP) throw new Error(errP.message);
    }
    await sb
      .from("bancard_pago")
      .update({ estado: "acreditado", acreditado_at: new Date().toISOString(), reserva_pago_id: reservaPagoId, motivo: null })
      .eq("id", pagoId);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error("[bancard] no se pudo acreditar", spid, motivo);
    await sb.from("bancard_pago").update({ estado: "aprobado", motivo: `Acreditar: ${motivo}`.slice(0, 500) }).eq("id", pagoId);
    throw e;
  }
}

export interface EstadoPublico {
  estado: "pendiente" | "aprobado" | "rechazado" | "error";
  numero: string;
  montoGs: number;
  descripcion: string;
  respuesta: string | null;
  fecha: string;
}

/**
 * El estado que ve la persona al volver de Bancard. Si la confirmación de Bancard todavía no llegó, se la consulta
 * (pasado un rato, para no consultar mientras está cargando la tarjeta) y se acredita igual.
 *
 * Bancard pide mostrar fecha y hora, número de pedido, importe y descripción de la respuesta, y NO mostrar código de
 * autorización, código de respuesta, respuesta extendida ni información de seguridad.
 */
export async function estadoParaElSitio(cfg: ConfigBancard | null, empresaId: string, pagoId: string): Promise<EstadoPublico | null> {
  const sb = await getChatServiceClientForEmpresa(empresaId);
  const leer = async () => {
    const { data, error } = await sb
      .from("bancard_pago")
      .select("id, shop_process_id, estado, monto_gs, descripcion, response_description, confirmado_at, created_at")
      .eq("empresa_id", empresaId)
      .eq("id", pagoId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as Fila | null;
  };

  let p = await leer();
  if (!p) return null;

  const abierto = p.estado === "creado" || p.estado === "pendiente";
  const edadMs = Date.now() - new Date(String(p.created_at)).getTime();
  if (cfg && abierto && edadMs > 15_000) {
    const r = await consultarConfirmacion(cfg, Number(p.shop_process_id)).catch(() => null);
    if (r?.tipo === "confirmado") {
      const c = leerConfirmacion(r.cuerpo);
      if (c) {
        const reg = await registrarConfirmacion(empresaId, c);
        if (reg.tipo === "procesado" && reg.estado === "aprobado") await acreditarPago(empresaId, pagoId).catch(() => {});
        p = (await leer()) ?? p;
      }
    }
  }
  if (p.estado === "aprobado") await acreditarPago(empresaId, pagoId).catch(() => {});

  const e = String(p.estado);
  const estado: EstadoPublico["estado"] =
    e === "aprobado" || e === "acreditando" || e === "acreditado"
      ? "aprobado"
      : e === "rechazado" || e === "revertido"
        ? "rechazado"
        : e === "error"
          ? "error"
          : "pendiente";
  return {
    estado,
    numero: String(p.shop_process_id),
    montoGs: Number(p.monto_gs),
    descripcion: String(p.descripcion),
    respuesta: (p.response_description as string | null) ?? null,
    fecha: String(p.confirmado_at ?? p.created_at),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Operaciones internas (con sesión del ERP): consultar un pago en Bancard y devolverlo.
// ---------------------------------------------------------------------------------------------------------------------

/** Pide a Bancard la confirmación de un pago y, si llegó algo que no teníamos, lo anota y acredita. */
export async function consultarPagoEnBancard(cfg: ConfigBancard, empresaId: string, pagoId: string) {
  const sb = await getChatServiceClientForEmpresa(empresaId);
  const { data, error } = await sb
    .from("bancard_pago")
    .select("id, shop_process_id, estado")
    .eq("empresa_id", empresaId)
    .eq("id", pagoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ErrorPago("Ese pago no existe.", 404);
  const r = await consultarConfirmacion(cfg, Number((data as Fila).shop_process_id));
  if (r.tipo === "confirmado") {
    const c = leerConfirmacion(r.cuerpo);
    if (c) {
      const reg = await registrarConfirmacion(empresaId, c);
      if (reg.tipo === "procesado" && reg.estado === "aprobado") await acreditarPago(empresaId, pagoId).catch(() => {});
    }
  }
  return r;
}

const COBRADOS = ["aprobado", "acreditando", "acreditado"];

/**
 * Devuelve un pago (rollback de Bancard) y lo deshace en el ERP: el pago de la reserva queda `revertido` (el saldo
 * vuelve solo, la vista suma solo los confirmados) y la reserva vuelve a `cotizacion` si no le queda otro pago; el
 * pedido deja de figurar pagado.
 *
 * Bancard sólo acepta el rollback el mismo día y antes de que el cobro impacte en el extracto. Después hay que pedir la
 * anulación en el portal de comercios (Contactá a Soporte → Solicitá Anulaciones).
 */
export async function devolverPago(
  cfg: ConfigBancard,
  empresaId: string,
  pagoId: string
): Promise<{ estado: string; detalle: string }> {
  const sb = await getChatServiceClientForEmpresa(empresaId);
  const { data, error } = await sb
    .from("bancard_pago")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("id", pagoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ErrorPago("Ese pago no existe.", 404);
  const p = data as Fila;
  const estadoPrevio = String(p.estado);
  if (estadoPrevio === "revertido") throw new ErrorPago("Ese pago ya fue devuelto.", 409);
  if (estadoPrevio === "rechazado" || estadoPrevio === "error") {
    throw new ErrorPago("Ese pago no se cobró: no hay nada que devolver.", 409);
  }

  const r = await pedirRollback(cfg, Number(p.shop_process_id));
  if (!r.ok) {
    if (/TransactionAlreadyConfirmed/i.test(r.detalle)) {
      throw new ErrorPago(
        "Bancard ya lo pasó al extracto de la tarjeta: la devolución se pide en el portal de comercios (Solicitá Anulaciones).",
        409
      );
    }
    if (/PaymentNotFound/i.test(r.detalle) && !COBRADOS.includes(estadoPrevio)) {
      // No había cobro: Bancard canceló el intento. Para nosotros queda como no cobrado.
      await sb.from("bancard_pago").update({ estado: "rechazado", motivo: "Cancelado por rollback (sin cobro)" }).eq("id", pagoId);
      return { estado: "rechazado", detalle: "No había cobro; el intento quedó cancelado." };
    }
    throw new ErrorPago(`Bancard no aceptó la devolución: ${r.detalle}`, 502);
  }

  const motivo = `Devuelto por rollback de Bancard (${new Date().toISOString().slice(0, 16).replace("T", " ")})`;
  if (p.tipo === "reserva") {
    const { error: errRp } = await sb
      .from("reserva_pagos")
      .update({ estado: "revertido", motivo_anulacion: motivo })
      .eq("empresa_id", empresaId)
      .eq("pasarela_proveedor", "bancard")
      .eq("pasarela_payment_id", String(p.shop_process_id))
      .eq("estado", "confirmado");
    if (errRp) throw new Error(errRp.message);
    const { count } = await sb
      .from("reserva_pagos")
      .select("id", { count: "exact", head: true })
      .eq("reserva_id", p.reserva_id)
      .eq("estado", "confirmado");
    if (!count) {
      await sb.from("reservas").update({ estado: "cotizacion" }).eq("id", p.reserva_id).eq("estado", "reservada");
    }
  } else if (p.tipo === "pedido") {
    await sb
      .from("web_pedido")
      .update({ pagado_at: null, pago_referencia: null })
      .eq("id", p.pedido_id)
      .eq("pago_referencia", `Bancard · ticket ${p.ticket_number ?? "-"} · aut. ${p.authorization_number ?? "-"}`);
  }
  await sb.from("bancard_pago").update({ estado: "revertido", motivo }).eq("id", pagoId);
  return { estado: "revertido", detalle: "Devuelto a la tarjeta." };
}

/** Los últimos pagos, para ubicar cuál consultar o devolver. */
export async function ultimosPagos(empresaId: string, limite = 50) {
  const sb = await getChatServiceClientForEmpresa(empresaId);
  const { data, error } = await sb
    .from("bancard_pago")
    .select("id, shop_process_id, tipo, descripcion, monto_gs, estado, response_description, motivo, created_at, confirmado_at")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return data ?? [];
}
