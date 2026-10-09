-- =============================================================================
-- 05 · Contenido del sitio público (amigos-de-la-ruta-web).
--
-- Corre DESPUÉS del 02 y del script del módulo Eventos
-- (docs/eventos-modulo-instalar.sql). Solo agrega lo que Eventos e Inventario
-- NO cubren.
--
-- Qué NO está acá, a propósito:
--   · viajes, salidas, paquetes, reservas, participantes, pagos y kits → los
--     tiene el módulo Eventos
--   · talles y stock por talle → `producto_variantes`, también de Eventos
--   · precio, stock e imagen de los productos de tienda → `productos`, que ya
--     administra Inventario
--
-- Lo que sí está: el copy multilingüe de la tienda, que `productos` no soporta
-- (tiene `nombre` plano y la web muestra nombre, descripción, variantes y
-- specs en es/pt/en), y el contenido suelto del sitio que no es ni evento ni
-- producto.
--
-- Convención de los textos multilingües: jsonb {"es": "...", "pt": "...",
-- "en": "..."}, igual que `eventos.nombre` del módulo Eventos.
--
-- Escribe solo dentro de `amigosdelarutaerp`. Idempotente.
--
-- No depende de `public`: `puede_acceder_empresa` y `set_updated_at` se buscan
-- primero en el schema de la instancia, que es donde las dejó el clonado del 01,
-- y solo se cae a `public` si no estuvieran.
-- =============================================================================

BEGIN;

DO $WEB$
DECLARE
  v_dst   text := 'amigosdelarutaerp';
  v_guard text;
  v_touch text;
  v_auth  boolean;
  v_svc   boolean;
  t       text;
BEGIN
  IF to_regnamespace(v_dst) IS NULL THEN
    RAISE EXCEPTION 'No existe el schema %. Corré primero el 01.', v_dst;
  END IF;

  -- `puede_acceder_empresa` y `set_updated_at` pueden estar en el schema de la
  -- instancia —el 01 las clonó desde `neura`— o en `public` en instalaciones
  -- viejas. Se resuelven PREFIRIENDO el propio, que es lo coherente con una
  -- instancia independiente, y se califican explícitamente en vez de confiar en
  -- el search_path, que dentro de una política RLS no es el que uno cree.
  -- Mismo criterio que usa el módulo Eventos.
  SELECT quote_ident(n.nspname) || '.puede_acceder_empresa'
    INTO v_guard
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname = 'puede_acceder_empresa'
     AND n.nspname IN (v_dst, 'public')
   ORDER BY (n.nspname = v_dst) DESC
   LIMIT 1;
  IF v_guard IS NULL THEN
    RAISE EXCEPTION
      'No se encontro puede_acceder_empresa() ni en % ni en public. Sin guard las tablas quedarian sin RLS, que es peor que no crearlas.', v_dst;
  END IF;

  SELECT quote_ident(n.nspname) || '.set_updated_at'
    INTO v_touch
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname = 'set_updated_at'
     AND n.nspname IN (v_dst, 'public')
   ORDER BY (n.nspname = v_dst) DESC
   LIMIT 1;
  IF v_touch IS NULL THEN
    RAISE EXCEPTION 'No se encontro set_updated_at() ni en % ni en public.', v_dst;
  END IF;

  RAISE NOTICE '[web] guard=%  updated_at=%', v_guard, v_touch;

  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO v_auth;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  INTO v_svc;

  -- ---------------------------------------------------------------------------
  -- web_producto · copy de tienda. El dato comercial NO se duplica: precio,
  -- stock e imagen se leen de `productos`. Un producto sin fila acá no se
  -- publica en el sitio.
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.web_producto (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  producto_id    uuid NOT NULL REFERENCES %1$I.productos(id) ON DELETE CASCADE,
  nombre         jsonb NOT NULL DEFAULT '{}'::jsonb,
  descripcion    jsonb NOT NULL DEFAULT '{}'::jsonb,
  variantes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  specs          jsonb NOT NULL DEFAULT '{}'::jsonb,
  galeria        jsonb NOT NULL DEFAULT '[]'::jsonb,
  categoria_web  integer NOT NULL DEFAULT 0,
  orden          integer NOT NULL DEFAULT 0,
  publicado      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT web_producto_producto_uk UNIQUE (producto_id)
    )$ddl$, v_dst);
  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_web_producto_pub
    ON %1$I.web_producto(empresa_id, publicado, orden)$ddl$, v_dst);

  -- ---------------------------------------------------------------------------
  -- web_moto · las motos del club
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.web_moto (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  nombre       text NOT NULL,
  anio         integer,
  descripcion  jsonb NOT NULL DEFAULT '{}'::jsonb,
  imagen_url   text,
  orden        integer NOT NULL DEFAULT 0,
  publicado    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
    )$ddl$, v_dst);

  -- ---------------------------------------------------------------------------
  -- web_faq
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.web_faq (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  pregunta    jsonb NOT NULL DEFAULT '{}'::jsonb,
  respuesta   jsonb NOT NULL DEFAULT '{}'::jsonb,
  orden       integer NOT NULL DEFAULT 0,
  publicado   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
    )$ddl$, v_dst);

  -- ---------------------------------------------------------------------------
  -- web_encuentro · los encuentros de la sección Nosotros
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.web_encuentro (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  titulo       jsonb NOT NULL DEFAULT '{}'::jsonb,
  descripcion  jsonb NOT NULL DEFAULT '{}'::jsonb,
  imagen_url   text,
  orden        integer NOT NULL DEFAULT 0,
  publicado    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
    )$ddl$, v_dst);

  -- ---------------------------------------------------------------------------
  -- web_config · clave/valor. Acá viven WHATSAPP, TELEFONO_VISIBLE, REDES,
  -- MEDIOS_PAGO, COTIZACIONES, MONEDA_BASE y DEPOSIT, que hoy son constantes
  -- en index.html. `valor` es jsonb para poder guardar tanto un string como el
  -- objeto de redes o el de cotizaciones sin una tabla por cada uno.
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.web_config (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  clave       text NOT NULL,
  valor       jsonb NOT NULL DEFAULT 'null'::jsonb,
  nota        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT web_config_clave_uk UNIQUE (empresa_id, clave)
    )$ddl$, v_dst);

  -- ---------------------------------------------------------------------------
  -- web_pedido · pedidos de la tienda que entran por el sitio.
  --
  -- NO van directo a `ventas`: una venta en este ERP es una operación cerrada,
  -- descuenta stock y entra en los reportes. Un pedido del sitio es una
  -- solicitud sin confirmar; mandarlo a `ventas` llenaría Ventas de pedidos que
  -- no se concretan y abriría una carrera por el stock. Al confirmarlo desde el
  -- ERP se genera cliente + venta + movimiento de stock, y se guarda acá el
  -- `venta_id` resultante.
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.web_pedido (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  numero          integer NOT NULL,
  estado          text NOT NULL DEFAULT 'pendiente',
  nombre          text NOT NULL,
  email           text,
  telefono        text,
  documento       text,
  pais            text,
  comentario      text,
  moneda          text NOT NULL DEFAULT 'USD',
  total           numeric NOT NULL DEFAULT 0,
  medio_pago      text,
  origen_ip       inet,
  user_agent      text,
  cliente_id      uuid REFERENCES %1$I.clientes(id) ON DELETE SET NULL,
  venta_id        uuid REFERENCES %1$I.ventas(id) ON DELETE SET NULL,
  confirmado_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT web_pedido_numero_uk UNIQUE (empresa_id, numero),
  CONSTRAINT web_pedido_estado_chk CHECK (estado IN ('pendiente', 'confirmado', 'cancelado')),
  CONSTRAINT web_pedido_confirmado_chk CHECK (estado <> 'confirmado' OR venta_id IS NOT NULL)
    )$ddl$, v_dst);
  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_web_pedido_estado
    ON %1$I.web_pedido(empresa_id, estado, created_at DESC)$ddl$, v_dst);

  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.web_pedido_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  pedido_id     uuid NOT NULL REFERENCES %1$I.web_pedido(id) ON DELETE CASCADE,
  producto_id   uuid REFERENCES %1$I.productos(id) ON DELETE SET NULL,
  variante_id   uuid,
  sku           text NOT NULL,
  descripcion   text NOT NULL,
  talle         text,
  cantidad      numeric NOT NULL DEFAULT 1,
  precio_unit   numeric NOT NULL DEFAULT 0,
  subtotal      numeric NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT web_pedido_item_cantidad_chk CHECK (cantidad > 0)
    )$ddl$, v_dst);
  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_web_pedido_item_pedido
    ON %1$I.web_pedido_item(pedido_id)$ddl$, v_dst);

  -- Correlativo de pedido por empresa, igual criterio que usa el ERP para los
  -- números de venta: una fila por empresa y un UPDATE ... RETURNING al pedir.
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.web_pedido_correlativo (
  empresa_id  uuid PRIMARY KEY,
  ultimo      integer NOT NULL DEFAULT 0
    )$ddl$, v_dst);

  -- ---------------------------------------------------------------------------
  -- RLS, trigger de updated_at y grants, tabla por tabla.
  -- ---------------------------------------------------------------------------
  FOREACH t IN ARRAY ARRAY[
    'web_producto', 'web_moto', 'web_faq', 'web_encuentro', 'web_config',
    'web_pedido', 'web_pedido_item', 'web_pedido_correlativo'
  ] LOOP
    EXECUTE format($d$ALTER TABLE %1$I.%2$I ENABLE ROW LEVEL SECURITY$d$, v_dst, t);

    EXECUTE format($d$DROP POLICY IF EXISTS %2$s_select ON %1$I.%2$I$d$, v_dst, t);
    EXECUTE format($d$CREATE POLICY %2$s_select ON %1$I.%2$I FOR SELECT USING (%3$s(empresa_id))$d$,
                   v_dst, t, v_guard);
    EXECUTE format($d$DROP POLICY IF EXISTS %2$s_insert ON %1$I.%2$I$d$, v_dst, t);
    EXECUTE format($d$CREATE POLICY %2$s_insert ON %1$I.%2$I FOR INSERT WITH CHECK (%3$s(empresa_id))$d$,
                   v_dst, t, v_guard);
    EXECUTE format($d$DROP POLICY IF EXISTS %2$s_update ON %1$I.%2$I$d$, v_dst, t);
    EXECUTE format($d$CREATE POLICY %2$s_update ON %1$I.%2$I FOR UPDATE USING (%3$s(empresa_id)) WITH CHECK (%3$s(empresa_id))$d$,
                   v_dst, t, v_guard);
    EXECUTE format($d$DROP POLICY IF EXISTS %2$s_delete ON %1$I.%2$I$d$, v_dst, t);
    EXECUTE format($d$CREATE POLICY %2$s_delete ON %1$I.%2$I FOR DELETE USING (%3$s(empresa_id))$d$,
                   v_dst, t, v_guard);

    -- `web_pedido_correlativo` no tiene updated_at: no le va el trigger.
    IF t <> 'web_pedido_correlativo' AND t <> 'web_pedido_item' THEN
      EXECUTE format($d$DROP TRIGGER IF EXISTS %2$s_set_updated_at ON %1$I.%2$I$d$, v_dst, t);
      EXECUTE format($d$CREATE TRIGGER %2$s_set_updated_at BEFORE UPDATE ON %1$I.%2$I
                        FOR EACH ROW EXECUTE FUNCTION %3$s()$d$, v_dst, t, v_touch);
    END IF;

    IF v_auth THEN
      EXECUTE format($d$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.%2$I TO authenticated$d$, v_dst, t);
    END IF;
    IF v_svc THEN
      EXECUTE format($d$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.%2$I TO service_role$d$, v_dst, t);
    END IF;

    RAISE NOTICE '[web] %.%: lista', v_dst, t;
  END LOOP;

  RAISE NOTICE 'Tablas de contenido web listas en %', v_dst;
END
$WEB$;

COMMIT;

-- =============================================================================
-- Verificación: 8 tablas, todas con RLS y con sus 4 políticas.
--
-- El filtro `relkind = 'r'` no es opcional: sin él entran también los índices
-- (`web_producto_pkey`, `web_config_clave_uk`…), que aparecen con rls=false y
-- 0 políticas y hacen parecer que algo falló.
-- =============================================================================
SELECT c.relname AS tabla,
       c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp'
   AND c.relkind = 'r'
   AND c.relname LIKE 'web\_%'
 ORDER BY 1;
