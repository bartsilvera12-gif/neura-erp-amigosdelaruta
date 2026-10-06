# Instancia Amigos de la Ruta

ERP dedicado para **Amigos de la Ruta**. Independiente: repo propio, app propia en
Coolify, schema propio en Postgres y su propio id de empresa.

| | |
|---|---|
| Código base | `bartsilvera12-gif/neura-erp-sistemas-propio` (copia completa, historia git nueva) |
| Repo | `bartsilvera12-gif/neura-erp-amigosdelaruta` |
| URL | `http://amigosdelaruta.neura.com.py` (http a propósito: Cloudflare termina TLS delante del origen) |
| Schema de datos | `amigosdelarutaerp` |
| Id de empresa | `80349bf4-7735-41a4-ac10-fbed4ce013a8` |
| Usuario admin | `admin@amigosdelaruta.com` |

No comparte nada con `neura` ni con ningún otro schema de datos. Lo único
compartido es la infraestructura de Supabase, igual que en todos los ERP: las
funciones base de `public` (`puede_acceder_empresa`, `set_updated_at`) y
`auth.users`, al que apuntan 9 foreign keys con `ON DELETE SET NULL`.

## Módulos habilitados

15 vistas, y nada más:

Agenda · Clientes · Cobranzas · Compras · Dashboard · Gastos · Gerencia ·
Gestión Clientes · Inventario · Movimientos · Notas de crédito · Pagos ·
Proyectos · Reportes · Ventas

Son 14 slugs de módulo: **Movimientos** no tiene slug propio, es la vista
`/inventario/movimientos` y entra con el permiso de `inventario`.

El recorte vive en dos lugares, y los dos tienen que coincidir:

1. `src/components/layout/Sidebar.tsx` → `INSTANCIA_MENU_KEYS_PERMITIDAS`.
   Solo visibilidad del menú. El catálogo completo del repo madre queda intacto
   en `MENU_STRUCTURE_COMPLETO`, así que habilitar un módulo es agregar una línea.
2. `amigosdelarutaerp.empresa_modulos` (lo carga el script 02). **Este es el
   permiso real**: cierra también la URL directa y las APIs, vía
   `pathRequiresModuleSlug` + `AuthGuard` y la verificación de cada endpoint.

Ojo: **Usuarios y Configuración quedaron fuera a pedido**. El alta de usuarios y
la configuración de facturación/timbrado de esta instancia se hace por SQL o
entrando por URL directa con una cuenta super admin.

## Puesta en marcha

### 1 · Base de datos

En el SQL editor del Supabase self-hosted, en este orden:

| Script | Qué hace |
|---|---|
| `supabase/instancia/00_preflight_schema_neura.sql` | Solo lee. Inventario de `neura` y aviso de lo que el clonador no sabe replicar. |
| `supabase/instancia/01_clonar_schema_amigosdelarutaerp.sql` | Crea `amigosdelarutaerp` como clon estructural de `neura`, sin una sola fila. |
| `supabase/instancia/02_seed_empresa_y_admin.sql` | Empresa, catálogos globales, usuario admin y los 14 módulos. |
| `supabase/instancia/04_catalogos_por_empresa.sql` | Catálogos por empresa de Proyectos: estados, tipos, prioridades, objetivos SLV. Sin esto el Kanban abre vacío. |
| `supabase/instancia/03_catalogos_pendientes.sql` | Opcional, al final. Lista otras tablas de referencia que quedaron vacías. |

Entre el 01 y el 02 hay que crear el usuario de login: Studio →
Authentication → Users → Add user → `admin@amigosdelaruta.com`, con *Auto
Confirm User* marcado. El 02 no escribe en `auth`, solo busca ahí el id.

El 01 y el 02 van cada uno en una transacción: si algo falla no queda nada a
medias, y se pueden volver a correr.

Después, aparte: exponer `amigosdelarutaerp` en PostgREST (Settings → API →
Exposed schemas).

### 2 · Coolify

App: `neura-erp-amigosdelaruta`, uuid `atj1neqbesmov1vhi0xnwlvk`, proyecto
`neura`, server `localhost`, entorno `production`, branch `main`, FQDN
`http://amigosdelaruta.neura.com.py`, puerto 3000, build pack **Dockerfile**
(igual que sistemas-propio): el `Dockerfile` del repo hace el build multi-stage
de Next, instala ffmpeg a nivel sistema y expone 3000.

Las `NEXT_PUBLIC_*` no necesitan marcarse como build variable: el `Dockerfile`
ya las declara como `ARG`/`ENV` en el stage builder, y Coolify pasa las
variables de la app como build args. Si agregás una `NEXT_PUBLIC_*` nueva, hay
que sumarla a esa lista de `ARG`/`ENV` o Next la compila vacía.

Variables de entorno — copiar de la app **neura-erp-sistemas-propio**, que corre
este mismo código:

```
# Propias de esta instancia — YA CARGADAS en la app
APP_DB_SCHEMA=amigosdelarutaerp
NEXT_PUBLIC_APP_URL=http://amigosdelaruta.neura.com.py

# Iguales a sistemas-propio (misma instancia de Supabase) — FALTAN
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
# NIXPACKS_NODE_VERSION no hace falta: el build es por Dockerfile

# Secretos de la app (se pueden compartir o rotar para esta instancia)
SIFEN_SECRETS_KEY        # si se rota, los certificados ya guardados no se descifran
CRON_SECRET
QA_SORTEO_TICKET_SECRET

# Opcionales, solo si se quieren esas funciones acá
ASSISTANT_ENABLED / NEXT_PUBLIC_ASSISTANT_ENABLED / ANTHROPIC_API_KEY
VAPID_SUBJECT / VAPID_PRIVATE_KEY / NEXT_PUBLIC_VAPID_PUBLIC_KEY
FIREBASE_SERVICE_ACCOUNT_JSON_BASE64
CONTACT_CENTER_V1
```

`SUPABASE_DB_URL` apunta al mismo Postgres: el aislamiento lo da
`APP_DB_SCHEMA`, no una base distinta.

### 3 · Cloudflare

Registro `amigosdelaruta` → IP del server de Coolify, proxy activado. El origen
escucha en http y Cloudflare sirve https hacia afuera.

## Qué se cambió respecto del repo madre

- `src/components/layout/Sidebar.tsx`: allowlist de instancia; alta del ítem
  **Gerencia** (la ruta `/dashboard/gerencia` existía sin entrada de menú);
  "Caja" pasó a llamarse **Ventas** y "Gastos y Servicios" a **Gastos**.
- `src/lib/modulos/route-slug-map.ts`: `SIDEBAR_SLUG_HREF_ORDER` recortado a los
  módulos de esta instancia (define a dónde cae el usuario después del login).
- `src/app/layout.tsx`: título y descripción.
- `capacitor.config.ts`, `src/lib/cobranzas/cobro-pendiente-notificar.ts`: URL de
  la instancia en lugar de `sistemas.neura.com.py`.
- `supabase/instancia/`: los scripts de arriba.

El resto del código quedó igual al madre a propósito, para que un `git diff`
contra `neura-erp-sistemas-propio` siga siendo legible y se puedan traer
arreglos de allá sin conflictos.

## Al traer cambios del repo madre

Hay una trampa que no se ve en el código. Muchas migraciones del madre se
aplican a varios schemas de una y los enumeran por patrón:

| Patrón | Migraciones |
|---|---|
| `nspname ~ '^er_[0-9a-f]{32}$'` | 110 |
| `nspname LIKE 'erp\_%'` | 87 |
| `nspname IN ('public', 'zentra_erp')` | 59 |
| `nspname IN ('public', 'zentra_erp', 'neura')` | 28 |

**`amigosdelarutaerp` no coincide con ninguno.** Una migración nueva que agregue
una columna o una tabla "a todos los tenants" no va a tocar esta instancia, y el
ERP va a fallar en runtime contra un schema viejo — sin error en el deploy, nada
más una API que explota.

Así que por cada migración multi-schema que traigas hay que correrla con
`amigosdelarutaerp` sumado al patrón, o aplicarla a mano a este schema. Lo mismo
le pasa a `neura`, que tampoco entra en los patrones de las 110 + 87.

Para verificar que el schema no quedó atrás, el script 01 sirve de diff: corrélo
y mirá el resumen origen vs destino y el diff de nombres. Si aparecen tablas,
columnas o constraints que están en `neura` y no acá, es drift.
