-- =============================================================================
-- 08 · Operación de la salida: tareas y costos.
--
-- Reemplaza al módulo Proyectos, que era la herramienta con la que Neura
-- gestiona los desarrollos de software que le hace a sus clientes (briefs de
-- web, módulos, credenciales, QA, SLA). Amigos de la Ruta no desarrolla
-- software: lo que tiene que preparar antes de cada salida son hoteles, motos,
-- seguros, guías y kits, y saber cuánto le costó.
--
-- Sale del documento funcional, página 6:
--   «Costos asociados a evento: hoteles, motos, seguros, operadores,
--    publicidad, personal y otros proveedores.»
--   «Resultado y margen estimado/real por evento.»
--
-- Todo cuelga de `salidas`, no de `eventos`: el documento es explícito en
-- separar el tour (contenido comercial reutilizable, «Route 66») de la salida
-- (la fecha concreta, «22/07/2027»). Los hoteles se reservan para una fecha,
-- no para un tour.
--
-- Escribe SOLO dentro de `amigosdelarutaerp`. Idempotente.
-- =============================================================================

BEGIN;

DO $OPER$
DECLARE
  v_dst   text := 'amigosdelarutaerp';
  v_guard text;
  v_touch text;
  v_auth  boolean;
  v_svc   boolean;
  t       text;
  v_n     bigint;
BEGIN
  IF to_regnamespace(v_dst) IS NULL THEN
    RAISE EXCEPTION 'No existe el schema %.', v_dst;
  END IF;
  IF to_regclass(format('%I.salidas', v_dst)) IS NULL THEN
    RAISE EXCEPTION 'No existe %.salidas. Corré primero el script del módulo Eventos.', v_dst;
  END IF;

  SELECT quote_ident(n.nspname) || '.puede_acceder_empresa' INTO v_guard
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname = 'puede_acceder_empresa' AND n.nspname IN (v_dst, 'public')
   ORDER BY (n.nspname = v_dst) DESC LIMIT 1;
  IF v_guard IS NULL THEN
    RAISE EXCEPTION 'No se encontro puede_acceder_empresa() ni en % ni en public.', v_dst;
  END IF;

  SELECT quote_ident(n.nspname) || '.set_updated_at' INTO v_touch
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname = 'set_updated_at' AND n.nspname IN (v_dst, 'public')
   ORDER BY (n.nspname = v_dst) DESC LIMIT 1;
  IF v_touch IS NULL THEN
    RAISE EXCEPTION 'No se encontro set_updated_at() ni en % ni en public.', v_dst;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 1) salida_tareas · lo que hay que dejar listo antes de salir
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.salida_tareas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  salida_id     uuid NOT NULL REFERENCES %1$I.salidas(id) ON DELETE CASCADE,
  titulo        text NOT NULL,
  categoria     text NOT NULL DEFAULT 'otro',
  responsable_id uuid,
  fecha_limite  date,
  estado        text NOT NULL DEFAULT 'pendiente',
  nota          text,
  orden         integer NOT NULL DEFAULT 0,
  completada_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salida_tareas_estado_chk
    CHECK (estado IN ('pendiente','en_proceso','hecha','bloqueada')),
  CONSTRAINT salida_tareas_categoria_chk
    CHECK (categoria IN ('hotel','motos','seguros','guia','kit','transporte','publicidad','personal','otro'))
)$ddl$, v_dst);

  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS salida_tareas_salida_idx
    ON %1$I.salida_tareas (empresa_id, salida_id, orden)$ddl$, v_dst);

  -- ---------------------------------------------------------------------------
  -- 2) salida_costos · lo que cuesta esa salida
  --
  --    Estimado y real conviven en la misma fila a propósito: el documento pide
  --    «margen estimado/real», y guardarlos separados obligaría a cruzar dos
  --    listas que nadie mantiene alineadas. Mientras no haya factura, el real
  --    queda NULL y el margen se calcula con el estimado.
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.salida_costos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  salida_id     uuid NOT NULL REFERENCES %1$I.salidas(id) ON DELETE CASCADE,
  concepto      text NOT NULL,
  categoria     text NOT NULL DEFAULT 'otro',
  proveedor_id  uuid,
  monto_estimado numeric NOT NULL DEFAULT 0,
  monto_real     numeric,
  moneda        text NOT NULL DEFAULT 'USD',
  nota          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salida_costos_categoria_chk
    CHECK (categoria IN ('hotel','motos','seguros','operador','publicidad','personal','transporte','kit','otro')),
  CONSTRAINT salida_costos_monto_chk
    CHECK (monto_estimado >= 0 AND (monto_real IS NULL OR monto_real >= 0))
)$ddl$, v_dst);

  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS salida_costos_salida_idx
    ON %1$I.salida_costos (empresa_id, salida_id)$ddl$, v_dst);

  -- ---------------------------------------------------------------------------
  -- 3) updated_at
  -- ---------------------------------------------------------------------------
  FOREACH t IN ARRAY ARRAY['salida_tareas','salida_costos'] LOOP
    EXECUTE format($d$DROP TRIGGER IF EXISTS %2$s_set_updated_at ON %1$I.%2$I$d$, v_dst, t);
    EXECUTE format($d$CREATE TRIGGER %2$s_set_updated_at
      BEFORE UPDATE ON %1$I.%2$I
      FOR EACH ROW EXECUTE FUNCTION %3$s()$d$, v_dst, t, v_touch);
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 4) RLS y grants, igual que el resto de la instancia
  -- ---------------------------------------------------------------------------
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO v_auth;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  INTO v_svc;

  FOREACH t IN ARRAY ARRAY['salida_tareas','salida_costos'] LOOP
    EXECUTE format($d$ALTER TABLE %1$I.%2$I ENABLE ROW LEVEL SECURITY$d$, v_dst, t);

    EXECUTE format($d$DROP POLICY IF EXISTS %2$s_select ON %1$I.%2$I$d$, v_dst, t);
    EXECUTE format($d$CREATE POLICY %2$s_select ON %1$I.%2$I FOR SELECT USING (%3$s(empresa_id))$d$, v_dst, t, v_guard);
    EXECUTE format($d$DROP POLICY IF EXISTS %2$s_insert ON %1$I.%2$I$d$, v_dst, t);
    EXECUTE format($d$CREATE POLICY %2$s_insert ON %1$I.%2$I FOR INSERT WITH CHECK (%3$s(empresa_id))$d$, v_dst, t, v_guard);
    EXECUTE format($d$DROP POLICY IF EXISTS %2$s_update ON %1$I.%2$I$d$, v_dst, t);
    EXECUTE format($d$CREATE POLICY %2$s_update ON %1$I.%2$I FOR UPDATE USING (%3$s(empresa_id)) WITH CHECK (%3$s(empresa_id))$d$, v_dst, t, v_guard);
    EXECUTE format($d$DROP POLICY IF EXISTS %2$s_delete ON %1$I.%2$I$d$, v_dst, t);
    EXECUTE format($d$CREATE POLICY %2$s_delete ON %1$I.%2$I FOR DELETE USING (%3$s(empresa_id))$d$, v_dst, t, v_guard);

    IF v_auth THEN
      EXECUTE format($d$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.%2$I TO authenticated$d$, v_dst, t);
    END IF;
    IF v_svc THEN
      EXECUTE format($d$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.%2$I TO service_role$d$, v_dst, t);
    END IF;
  END LOOP;

  EXECUTE format('SELECT count(*) FROM information_schema.tables
                   WHERE table_schema = %L AND table_name IN (''salida_tareas'',''salida_costos'')', v_dst)
    INTO v_n;
  RAISE NOTICE '[operacion] tablas creadas: % de 2', v_n;
END
$OPER$;

COMMIT;

-- PostgREST cachea el esquema: sin esto las tablas nuevas no se ven.
SELECT pg_notify('pgrst', 'reload schema');
