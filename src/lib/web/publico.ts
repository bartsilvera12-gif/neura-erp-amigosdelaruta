import "server-only";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

/**
 * Piso común de los endpoints PÚBLICOS que consume amigos-de-la-ruta-web.
 *
 * Son las únicas rutas del ERP sin sesión, así que todo lo que las protege está
 * acá y no repartido: orígenes permitidos, límite de tamaño, rate limit y
 * honeypot. Las rutas de adentro (`/api/web/contenido` y el resto del ERP)
 * siguen pidiendo sesión como siempre.
 */

/**
 * Orígenes que pueden llamar. Se configuran con `WEB_PUBLIC_ORIGINS`, separados
 * por coma. El default cubre el dominio propio y el de Vercel, que es donde
 * está publicado el sitio hoy.
 *
 * No se usa `*`: estos endpoints escriben en la base, y un comodín deja que
 * cualquier página de internet los llame desde el navegador de un visitante.
 */
function origenesPermitidos(): string[] {
  const raw = process.env.WEB_PUBLIC_ORIGINS?.trim();
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [
    "https://amigosdelaruta.com.py",
    "https://www.amigosdelaruta.com.py",
    "https://amigos-de-la-ruta-web.vercel.app",
    "http://localhost:8000",
  ];
}

export function corsHeaders(request: Request): Record<string, string> {
  const origen = request.headers.get("origin") ?? "";
  const permitidos = origenesPermitidos();
  const ok = permitidos.includes(origen);
  return {
    // Sin coincidencia no se manda el header: el navegador bloquea la respuesta.
    // Mejor eso que reflejar cualquier origen.
    ...(ok ? { "Access-Control-Allow-Origin": origen } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

/** Preflight. Se exporta como OPTIONS en cada ruta pública. */
export function preflight(request: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export function jsonPublico(request: Request, body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders(request) });
}

export function errorPublico(request: Request, mensaje: string, status = 400): NextResponse {
  return jsonPublico(request, { ok: false, error: mensaje }, status);
}

/**
 * Rate limit por IP, en memoria del proceso.
 *
 * Es a propósito simple: frena el abuso casual de un script, que es el riesgo
 * real de un formulario público. NO es una defensa seria — se reinicia con el
 * contenedor y no se comparte entre réplicas. Si algún día hace falta algo
 * firme, va en Cloudflare, que ya está delante del dominio.
 */
const golpes = new Map<string, number[]>();

export function ipDe(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim();
  return ip || request.headers.get("cf-connecting-ip") || "desconocida";
}

export function rateLimitSuperado(ip: string, maximo = 10, ventanaMs = 60_000): boolean {
  const ahora = Date.now();
  const previos = (golpes.get(ip) ?? []).filter((t) => ahora - t < ventanaMs);
  previos.push(ahora);
  golpes.set(ip, previos);

  // Poda barata para que el Map no crezca sin límite en un proceso largo.
  if (golpes.size > 5000) {
    for (const [k, v] of golpes) {
      if (v.every((t) => ahora - t >= ventanaMs)) golpes.delete(k);
    }
  }
  return previos.length > maximo;
}

/** Tope de cuerpo. Un formulario de reserva no pesa más que esto ni cerca. */
const MAX_BYTES = 64 * 1024;

export async function leerJson(request: Request): Promise<Record<string, unknown>> {
  const largo = Number(request.headers.get("content-length") ?? 0);
  if (largo > MAX_BYTES) throw new Error("El cuerpo del pedido es demasiado grande.");
  const texto = await request.text();
  if (texto.length > MAX_BYTES) throw new Error("El cuerpo del pedido es demasiado grande.");
  try {
    const j = JSON.parse(texto) as unknown;
    if (typeof j !== "object" || j === null || Array.isArray(j)) {
      throw new Error("Se esperaba un objeto JSON.");
    }
    return j as Record<string, unknown>;
  } catch (e) {
    throw new Error(e instanceof Error && e.message.startsWith("Se esperaba") ? e.message : "JSON inválido.");
  }
}

/**
 * Honeypot: un campo que el formulario deja vacío y oculto. Un humano no lo ve;
 * un bot que completa todo lo llena. Si viene con algo, se responde 200 como si
 * hubiera andado — decirle "sos un bot" solo le enseña a esquivarlo.
 */
export function esBot(body: Record<string, unknown>): boolean {
  const v = body.website ?? body._gotcha ?? body.apellido2;
  return typeof v === "string" && v.trim().length > 0;
}

export function textoLimpio(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

/**
 * La empresa de esta instancia.
 *
 * El ERP es de un solo cliente, así que se resuelve sola: es la única fila de
 * `empresas`. `WEB_EMPRESA_ID` la fija explícitamente por si algún día hubiera
 * más de una. Si hay varias y no está la variable, corta en vez de elegir al
 * azar y escribirle la reserva al cliente equivocado.
 */
let empresaCache: string | null = null;

export async function empresaDeLaInstancia(): Promise<string> {
  if (empresaCache) return empresaCache;

  const fijada = process.env.WEB_EMPRESA_ID?.trim();
  if (fijada) {
    empresaCache = fijada;
    return fijada;
  }

  const sb = createServiceRoleClient();
  const { data, error } = await sb.from("empresas").select("id").limit(2);
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as { id: string }[];
  if (filas.length === 0) throw new Error("No hay ninguna empresa configurada.");
  if (filas.length > 1) {
    throw new Error("Hay más de una empresa en el schema: definí WEB_EMPRESA_ID.");
  }
  empresaCache = filas[0].id;
  return empresaCache;
}

/** Texto multilingüe tal cual se guarda: {es, pt, en}. */
export type Multilingue = Record<string, string>;

export function soloPublicado<T extends { publicado?: unknown }>(filas: T[]): T[] {
  return filas.filter((f) => f.publicado !== false);
}
