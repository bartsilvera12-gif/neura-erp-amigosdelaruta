import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import {
  empresaDeLaInstancia,
  errorPublico,
  esBot,
  ipDe,
  jsonPublico,
  leerJson,
  preflight,
  rateLimitSuperado,
  textoLimpio,
} from "@/lib/web/publico";

export const dynamic = "force-dynamic";

/**
 * POST /api/web/reserva — inscripción a un viaje desde el sitio.
 *
 * PÚBLICO. Reemplaza al `submitBooking` que solo abría WhatsApp sin dejar
 * registro de nada.
 *
 * Crea la reserva en estado `cotizacion` y origen `web`: todavía no es una
 * venta ni ocupa cupo en firme, es una solicitud que ADR confirma desde el ERP.
 *
 * El precio NO se toma del cuerpo del pedido: se lee del paquete en la base.
 * Si lo mandara el cliente, cualquiera podría reservar un viaje de 5.000 por 1.
 *
 * El cupo lo controla el trigger `reservas_control_cupo` de la base, no esta
 * ruta: así vale también para las reservas cargadas a mano en el ERP.
 */

type Participante = {
  nombre: string;
  documento: string | null;
  licencia_numero: string | null;
  rol: "titular" | "piloto" | "acompanante";
};

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const ip = ipDe(request);
  if (rateLimitSuperado(ip, 5)) {
    return errorPublico(request, "Demasiados intentos. Probá en un minuto.", 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await leerJson(request);
  } catch (e) {
    return errorPublico(request, e instanceof Error ? e.message : "Pedido inválido.");
  }

  // Bot: se responde como si hubiera andado, sin escribir nada.
  if (esBot(body)) {
    return jsonPublico(request, { ok: true, codigo: null });
  }

  const salidaId = textoLimpio(body.salida_id, 64);
  if (!salidaId) return errorPublico(request, "Falta la salida.");

  const crudos = Array.isArray(body.participantes) ? body.participantes : [];
  if (crudos.length === 0) return errorPublico(request, "Hay que cargar al menos un participante.");
  if (crudos.length > 20) return errorPublico(request, "Demasiados participantes en una sola reserva.");

  const participantes: Participante[] = [];
  for (const [i, p] of crudos.entries()) {
    const o = (typeof p === "object" && p !== null ? p : {}) as Record<string, unknown>;
    const nombre = textoLimpio(o.nombre, 120);
    if (!nombre) return errorPublico(request, `Falta el nombre del participante ${i + 1}.`);
    participantes.push({
      nombre,
      documento: textoLimpio(o.documento, 40),
      licencia_numero: textoLimpio(o.licencia, 40) ?? textoLimpio(o.licencia_numero, 40),
      rol: i === 0 ? "titular" : "acompanante",
    });
  }

  try {
    const empresaId = await empresaDeLaInstancia();
    const sb = await getChatServiceClientForEmpresa(empresaId);

    // La salida manda: de ahí salen el evento y el año del correlativo.
    const { data: salida, error: errS } = await sb
      .from("salidas")
      .select("id, evento_id, fecha_inicio, estado")
      .eq("empresa_id", empresaId)
      .eq("id", salidaId)
      .maybeSingle();
    if (errS) throw new Error(errS.message);
    if (!salida) return errorPublico(request, "Esa salida no existe.", 404);
    if (String((salida as Record<string, unknown>).estado) === "borrador") {
      return errorPublico(request, "Esa salida todavía no está abierta.", 409);
    }

    const eventoId = String((salida as Record<string, unknown>).evento_id);
    const fechaInicio = String((salida as Record<string, unknown>).fecha_inicio ?? "");
    const anio = Number(fechaInicio.slice(0, 4)) || new Date().getFullYear();

    // Precio y moneda desde el paquete, nunca desde el cuerpo del pedido.
    const paqueteId = textoLimpio(body.paquete_id, 64);
    let precio = 0;
    let moneda = "USD";
    if (paqueteId) {
      const { data: paq, error: errP } = await sb
        .from("paquetes")
        .select("id, precio, moneda, evento_id, activo")
        .eq("empresa_id", empresaId)
        .eq("id", paqueteId)
        .maybeSingle();
      if (errP) throw new Error(errP.message);
      if (!paq) return errorPublico(request, "Ese paquete no existe.", 404);
      const p = paq as Record<string, unknown>;
      if (p.activo === false) return errorPublico(request, "Ese paquete ya no está disponible.", 409);
      if (String(p.evento_id) !== eventoId) {
        return errorPublico(request, "El paquete no corresponde a esa salida.", 400);
      }
      precio = Number(p.precio ?? 0);
      moneda = String(p.moneda ?? "USD");
    }

    const { data: codigo, error: errC } = await sb.rpc("next_codigo_reserva", {
      p_empresa_id: empresaId,
      p_anio: anio,
    });
    if (errC) throw new Error(errC.message);

    const { data: reserva, error: errR } = await sb
      .from("reservas")
      .insert({
        empresa_id: empresaId,
        codigo: String(codigo),
        evento_id: eventoId,
        salida_id: salidaId,
        paquete_id: paqueteId,
        cantidad_participantes: participantes.length,
        moneda,
        precio_paquete: precio * participantes.length,
        estado: "cotizacion",
        origen: "web",
        idioma_preferido: textoLimpio(body.idioma, 5),
        notas: textoLimpio(body.comentario, 1000),
      })
      .select("id, codigo")
      .single();
    if (errR) throw errR;

    const reservaId = String((reserva as Record<string, unknown>).id);
    const { error: errPart } = await sb.from("participantes").insert(
      participantes.map((p) => ({
        empresa_id: empresaId,
        reserva_id: reservaId,
        nombre: p.nombre,
        documento: p.documento,
        licencia_numero: p.licencia_numero,
        rol: p.rol,
        email: textoLimpio(body.email, 160),
        telefono: textoLimpio(body.telefono, 40),
      }))
    );
    if (errPart) throw new Error(errPart.message);

    return jsonPublico(request, {
      ok: true,
      codigo: String((reserva as Record<string, unknown>).codigo),
    });
  } catch (e) {
    // El trigger de cupo corta con check_violation. Ese sí se le cuenta al
    // visitante: es información que necesita, no un detalle interno.
    const err = e as { code?: string; message?: string };
    if (err?.code === "23514" || /cupo/i.test(err?.message ?? "")) {
      return errorPublico(request, "No quedan lugares en esa salida.", 409);
    }
    console.error("[api/web/reserva]", e);
    return errorPublico(request, "No se pudo registrar la inscripción.", 500);
  }
}
