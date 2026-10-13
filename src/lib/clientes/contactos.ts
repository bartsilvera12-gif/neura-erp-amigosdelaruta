import "server-only";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { errorEmail, normalizarEmail } from "@/lib/clientes/validar-contacto";

export type ContactoCliente = {
  id: string;
  cliente_id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  cargo: string | null;
  notas: string | null;
  created_at: string;
};

export const CONTACTO_CAMPOS = "id, cliente_id, nombre, telefono, email, cargo, notas, created_at";

const UUID = /^[0-9a-f-]{36}$/i;

/** Usuario autenticado y cliente de SU empresa (nunca desde el body). */
export async function contextoContactos(request: Request, clienteIdRaw: string) {
  const auth = await getUserAndEmpresa(request);
  if (!auth) return { ok: false as const, status: 401, mensaje: "No autenticado" };
  const clienteId = clienteIdRaw?.trim() ?? "";
  if (!UUID.test(clienteId)) return { ok: false as const, status: 400, mensaje: "Cliente inválido" };
  const sb = await getChatServiceClientForEmpresa(auth.empresa_id);
  const { data } = await sb.from("clientes").select("id").eq("empresa_id", auth.empresa_id).eq("id", clienteId).maybeSingle();
  if (!data) return { ok: false as const, status: 404, mensaje: "Cliente no encontrado" };
  return { ok: true as const, auth, sb, clienteId };
}

const texto = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Valida los datos de un contacto. Nombre obligatorio y al menos un teléfono o correo. */
export function leerContacto(body: Record<string, unknown> | null):
  | { ok: true; datos: { nombre: string; telefono: string | null; email: string | null; cargo: string | null; notas: string | null } }
  | { ok: false; mensaje: string } {
  if (!body) return { ok: false, mensaje: "Datos inválidos" };
  const nombre = texto(body.nombre, 150);
  if (!nombre) return { ok: false, mensaje: "El nombre es obligatorio" };
  const telefono = texto(body.telefono, 40);
  if (telefono && telefono.replace(/\D/g, "").length < 6) return { ok: false, mensaje: "Teléfono inválido" };
  /*
   * El correo se guarda SIEMPRE en minúsculas. Se validaba con una expresión
   * suelta y se guardaba tal cual vino, así que "MATIAS@GMAIL.COM" quedaba en
   * mayúsculas y el mismo contacto cargado dos veces con distinta caja parecía
   * dos contactos distintos. Se normaliza acá, en el único punto por el que
   * pasan tanto el alta como la edición.
   *
   * La validación pasa a ser la misma que usan Clientes y Proveedores, que
   * además detecta dominios mal escritos ("gmail.commpresa").
   */
  const emailCrudo = texto(body.email, 150);
  const email = emailCrudo ? normalizarEmail(emailCrudo) : null;
  if (email) {
    const malEmail = errorEmail(email, "El correo");
    if (malEmail) return { ok: false, mensaje: malEmail };
  }
  if (!telefono && !email) return { ok: false, mensaje: "Cargá al menos un teléfono o un correo" };
  return { ok: true, datos: { nombre, telefono, email, cargo: texto(body.cargo, 100), notas: texto(body.notas, 1000) } };
}
