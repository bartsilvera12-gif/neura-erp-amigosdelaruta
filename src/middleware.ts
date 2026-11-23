import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { BLOQUEO_PAGO_MENSAJE, BLOQUEO_PAGO_PATH, erpBloqueadoPorFaltaDePago } from "@/lib/bloqueo-pago";
import { DEVICE_COOKIE_NAME, isMobileUserAgent } from "@/shared/device/detect";

/**
 * Middleware combinado: (a) refresca la sesión Supabase en cookies antes de Route
 * Handlers / RSC; (b) setea la cookie `neura-device` a partir del User-Agent si todavía
 * no fue seteada. La cookie permite que el server-side render del DeviceRouter decida
 * mobile vs desktop sin esperar al cliente (evita flash en el primer paint).
 *
 * Optimización clave: saltamos el `supabase.auth.getUser()` (que es una llamada remota
 * al servicio de auth de Supabase, ~100-300ms) para requests que son SOLO prefetches
 * RSC de Next.js. Estos requests:
 *   - los dispara `next/link` automáticamente para cada link visible en el viewport,
 *   - reusan las cookies del browser que ya están vigentes,
 *   - no necesitan refrescar tokens — la próxima navegación real los refresca.
 * Sin este skip, una pantalla con 10 links visibles disparaba 10 auth-refresh ocultos.
 */
export async function middleware(request: NextRequest) {
  // ===== Acceso suspendido por falta de pago (sistema de Neura, por dominio) =====
  if (await erpBloqueadoPorFaltaDePago(request.headers)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: BLOQUEO_PAGO_MENSAJE }, { status: 402 });
    }
    if (request.nextUrl.pathname !== BLOQUEO_PAGO_PATH) {
      const bloqueoUrl = request.nextUrl.clone();
      bloqueoUrl.pathname = BLOQUEO_PAGO_PATH;
      bloqueoUrl.search = "";
      return NextResponse.redirect(bloqueoUrl, 307);
    }
    return NextResponse.next({ request });
  }
  // Rehabilitado: quien quedó en /bloqueado vuelve al inicio.
  if (request.nextUrl.pathname === BLOQUEO_PAGO_PATH) {
    const inicio = request.nextUrl.clone();
    inicio.pathname = "/";
    inicio.search = "";
    return NextResponse.redirect(inicio, 307);
  }

  let supabaseResponse = NextResponse.next({ request });

  // Seteo de cookie de device: solo si no existe todavía, para no pisar la corrección
  // que el cliente pueda haber escrito (caso iPad-as-Mac).
  if (!request.cookies.get(DEVICE_COOKIE_NAME)) {
    const ua = request.headers.get("user-agent");
    const device = isMobileUserAgent(ua) ? "mobile" : "desktop";
    request.cookies.set(DEVICE_COOKIE_NAME, device);
    supabaseResponse = NextResponse.next({ request });
    supabaseResponse.cookies.set(DEVICE_COOKIE_NAME, device, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  // Detectamos PREFETCH (no toda navegación RSC). Estos son disparados automáticamente
  // por next/link en background para cada link visible. Las cookies ya están vigentes;
  // no hace falta refrescar el token para una nav que el usuario quizás ni haga.
  const isPrefetch =
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch";

  if (isPrefetch) {
    return supabaseResponse;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  await supabase.auth.getUser();

  return supabaseResponse;
}

/**
 * Excluir `/api/webhooks/*`: Meta hace GET sin cookies para verificar el webhook;
 * no debe pasar por refresh de sesión Supabase (y queda listo para proxies estrictos).
 */
export const config = {
  matcher: [
    "/((?!api/webhooks|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
