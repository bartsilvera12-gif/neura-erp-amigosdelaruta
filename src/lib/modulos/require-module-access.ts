import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { esRolAdminEmpresa, resolveEffectiveModules } from "@/lib/modulos/resolve-effective-modules";

export type ModuleApiAuth =
  | { ok: true; empresaId: string; usuarioCatalogId: string; rol: string | null; email: string | null }
  | { ok: false; status: number; message: string };

/**
 * Guard de acceso a un módulo por slug, para rutas de API.
 *
 * Es la misma lógica que `requireCobranzasModuleAccess` y sus hermanas
 * (`requireComisionesModuleAccess`, `requireProyectosModuleAccess`…), que en el
 * repo madre están copiadas una por módulo. Acá va una sola vez y recibe el
 * slug: los módulos nuevos de esta instancia (`eventos`, `web`) no necesitan
 * cada uno su archivo con el mismo cuerpo.
 *
 * Pasan super_admin, el admin de la empresa, y el usuario que tenga el módulo
 * en `empresa_modulos` ∩ `usuario_modulos`.
 *
 * Ocultar el ítem del sidebar NO es el permiso: el permiso es esto, y cada
 * ruta lo vuelve a comprobar en el servidor.
 */
export async function requireModuleAccess(
  request: Request,
  slug: string,
  etiqueta: string
): Promise<ModuleApiAuth> {
  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) {
    return { ok: false, status: 401, message: "No autenticado" };
  }

  const catalog = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(catalog, user);

  if (!usuario?.empresa_id) {
    return { ok: false, status: 403, message: "Usuario sin empresa" };
  }

  const rol = (usuario.rol ?? "").trim();
  const base = {
    ok: true as const,
    empresaId: usuario.empresa_id,
    usuarioCatalogId: usuario.id,
    rol,
    email: user.email ?? null,
  };

  if (rol === "super_admin" || isBootstrapSuperAdminEmail(user.email) || esRolAdminEmpresa(usuario.rol)) {
    return base;
  }

  const modulos = await resolveEffectiveModules(catalog, {
    id: usuario.id,
    empresa_id: usuario.empresa_id,
    rol: usuario.rol,
  });
  const slugs = new Set(modulos.map((m) => (m.slug ?? "").trim().toLowerCase()));
  if (!slugs.has(slug.trim().toLowerCase())) {
    return { ok: false, status: 403, message: `Sin acceso al módulo ${etiqueta}.` };
  }

  return base;
}
