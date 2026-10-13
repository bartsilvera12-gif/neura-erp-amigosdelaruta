-- =============================================================================
-- 06 · Módulo Caja (turnos de venta, arqueo y movimientos).
--
-- Portado desde `neura-erp-ferretodo`. El esquema NO se copió de las
-- migraciones de ese repo: están repartidas en tres archivos y ninguna refleja
-- el estado actual del código (les falta `arqueo_apertura_json`, el estado
-- `en_cierre` y `medio_pago = 'cheque'`). Se derivó de `src/lib/caja/types.ts`
-- y de las consultas de `src/lib/caja/server.ts`, que es lo que de verdad se
-- ejecuta.
--
-- Una "caja" es un TURNO: se abre con un monto inicial, mientras está abierta
-- se le cuelgan las ventas (`ventas.caja_id`) y los movimientos manuales, y se
-- cierra contando el efectivo. La diferencia entre lo contado y lo que el
-- sistema esperaba es el resultado del arqueo.
--
-- Escribe SOLO dentro de `amigosdelarutaerp`. Idempotente: se puede correr
-- de nuevo sin romper nada ni perder datos.
--
-- No depende de `public`: `puede_acceder_empresa` y `set_updated_at` se buscan
-- primero en el schema de la instancia, que es donde las dejó el clonado del 01.
--
-- Qué NO crea, a propósito:
--   · `ventas_pagos_detalle` (desglose de pagos mixtos). El código la consulta
--     con `if (!error)`, así que su ausencia no rompe nada: sin ella el método
--     de pago sale de `ventas.metodo_pago`, que alcanza mientras no se cobre
--     una misma venta con dos medios. Si algún día hace falta, se agrega aparte.
-- =============================================================================

BEGIN;

DO $CAJA$
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
    RAISE EXCEPTION 'No existe el schema %. Corré primero el 01.', v_dst;
  END IF;

  IF to_regclass(format('%I.ventas', v_dst)) IS NULL THEN
    RAISE EXCEPTION 'No existe %.ventas. La caja cuelga de las ventas: sin esa tabla no tiene sentido.', v_dst;
  END IF;

  -- Mismo criterio que el 05 y que el módulo Eventos: se prefiere el schema de
  -- la instancia y sólo se cae a `public` si allá no estuvieran. Se califican
  -- explícitamente porque dentro de una política RLS el search_path no es el
  -- que uno cree.
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

  RAISE NOTICE '[caja] schema=%  guard=%  updated_at=%', v_dst, v_guard, v_touch;

  -- ---------------------------------------------------------------------------
  -- 1) cajas · un turno de caja
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.cajas (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL,
  -- Permite Caja 1, Caja 2… El índice único parcial de más abajo es el que
  -- impide dos turnos activos sobre el MISMO número.
  numero_caja             integer NOT NULL DEFAULT 1,
  estado                  text NOT NULL DEFAULT 'abierta',
  abierta_por             uuid,
  cerrada_por             uuid,
  fecha_apertura          timestamptz NOT NULL DEFAULT now(),
  fecha_cierre            timestamptz,
  monto_apertura          numeric NOT NULL DEFAULT 0,
  -- Lo que el cajero contó al cerrar.
  monto_cierre_contado    numeric,
  -- Lo que el sistema calculó que debía haber. La verdad del arqueo.
  monto_esperado_efectivo numeric,
  -- contado − esperado. Positivo sobra, negativo falta.
  diferencia              numeric,
  observacion_apertura    text,
  observacion_cierre      text,
  -- Conteo físico por denominación, para auditoría. Null si se cargó el monto
  -- directo en vez de contar billete por billete.
  arqueo_apertura_json    jsonb,
  arqueo_cierre_json      jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cajas_estado_chk CHECK (estado IN ('abierta','en_cierre','cerrada')),
  CONSTRAINT cajas_numero_chk CHECK (numero_caja >= 1)
)$ddl$, v_dst);

  -- A lo sumo UN turno activo por número de caja. Es la garantía dura contra
  -- "abrir dos veces": no depende de que la aplicación chequee antes.
  EXECUTE format($ddl$CREATE UNIQUE INDEX IF NOT EXISTS cajas_activa_por_numero
    ON %1$I.cajas (empresa_id, numero_caja)
    WHERE estado IN ('abierta','en_cierre')$ddl$, v_dst);

  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS cajas_empresa_fecha_idx
    ON %1$I.cajas (empresa_id, fecha_apertura DESC)$ddl$, v_dst);

  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS cajas_empresa_estado_idx
    ON %1$I.cajas (empresa_id, estado)$ddl$, v_dst);

  -- ---------------------------------------------------------------------------
  -- 2) caja_movimientos · ingresos, egresos, retiros y ajustes manuales
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.caja_movimientos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  caja_id        uuid NOT NULL REFERENCES %1$I.cajas(id) ON DELETE CASCADE,
  tipo           text NOT NULL,
  concepto       text NOT NULL,
  monto          numeric NOT NULL,
  medio_pago     text NOT NULL DEFAULT 'efectivo',
  usuario_id     uuid,
  usuario_email  text,
  observacion    text,
  -- Cuando el movimiento nace de una venta (no de una carga manual).
  venta_id       uuid,
  -- Un movimiento NO se borra: se anula, y deja de contar en el arqueo.
  -- Borrarlo haría que el cierre de ayer dejara de cuadrar.
  anulado_at     timestamptz,
  anulado_por_id uuid,
  anulado_motivo text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caja_movimientos_tipo_chk
    CHECK (tipo IN ('ingreso','egreso','retiro','ajuste')),
  CONSTRAINT caja_movimientos_medio_chk
    CHECK (medio_pago IN ('efectivo','tarjeta','transferencia','cheque','otro'))
)$ddl$, v_dst);

  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS caja_movimientos_caja_idx
    ON %1$I.caja_movimientos (caja_id, created_at)$ddl$, v_dst);

  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS caja_movimientos_empresa_idx
    ON %1$I.caja_movimientos (empresa_id, created_at DESC)$ddl$, v_dst);

  -- ---------------------------------------------------------------------------
  -- 3) Columnas que la caja necesita en `ventas`
  --
  --    Todas nullable: las ventas que ya existen quedan sin caja, que es lo
  --    correcto —se hicieron antes de que hubiera turnos— y el cierre agrupa
  --    por `caja_id`, no por fecha, así que no se cuelan en ningún arqueo.
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$ALTER TABLE %1$I.ventas
    ADD COLUMN IF NOT EXISTS caja_id        uuid,
    ADD COLUMN IF NOT EXISTS metodo_pago    text,
    ADD COLUMN IF NOT EXISTS usuario_nombre text,
    ADD COLUMN IF NOT EXISTS created_by     uuid$ddl$, v_dst);

  -- FK a cajas. Va con ON DELETE SET NULL: si alguna vez se borra un turno, la
  -- venta sobrevive sin caja en vez de desaparecer con él.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ventas_caja_fk'
       AND conrelid = format('%I.ventas', v_dst)::regclass
  ) THEN
    EXECUTE format($ddl$ALTER TABLE %1$I.ventas
      ADD CONSTRAINT ventas_caja_fk FOREIGN KEY (caja_id)
      REFERENCES %1$I.cajas(id) ON DELETE SET NULL$ddl$, v_dst);
  END IF;

  -- El método de pago se valida acá y no sólo en la aplicación: el arqueo suma
  -- por este campo, y un valor escrito distinto ("Efectivo", "efvo") saldría
  -- del cálculo sin que nadie se entere.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ventas_metodo_pago_chk'
       AND conrelid = format('%I.ventas', v_dst)::regclass
  ) THEN
    EXECUTE format($ddl$ALTER TABLE %1$I.ventas
      ADD CONSTRAINT ventas_metodo_pago_chk
      CHECK (metodo_pago IS NULL OR metodo_pago IN
        ('efectivo','tarjeta','transferencia','cheque','otro'))$ddl$, v_dst);
  END IF;

  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ventas_caja_idx
    ON %1$I.ventas (empresa_id, caja_id)$ddl$, v_dst);

  -- ---------------------------------------------------------------------------
  -- 4) updated_at de cajas
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS cajas_set_updated_at ON %1$I.cajas$ddl$, v_dst);
  EXECUTE format($ddl$CREATE TRIGGER cajas_set_updated_at
    BEFORE UPDATE ON %1$I.cajas
    FOR EACH ROW EXECUTE FUNCTION %2$s()$ddl$, v_dst, v_touch);

  -- ---------------------------------------------------------------------------
  -- 5) RLS · igual que el resto de las tablas de la instancia
  -- ---------------------------------------------------------------------------
  FOREACH t IN ARRAY ARRAY['cajas','caja_movimientos'] LOOP
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
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 6) Grants
  -- ---------------------------------------------------------------------------
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO v_auth;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  INTO v_svc;

  FOREACH t IN ARRAY ARRAY['cajas','caja_movimientos'] LOOP
    IF v_auth THEN
      EXECUTE format($d$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.%2$I TO authenticated$d$, v_dst, t);
    END IF;
    IF v_svc THEN
      EXECUTE format($d$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.%2$I TO service_role$d$, v_dst, t);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 7) Resumen
  -- ---------------------------------------------------------------------------
  EXECUTE format('SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = %L AND table_name = ''ventas''
                     AND column_name IN (''caja_id'',''metodo_pago'',''usuario_nombre'',''created_by'')', v_dst)
    INTO v_n;
  RAISE NOTICE '[caja] columnas nuevas en ventas: % de 4', v_n;

  EXECUTE format('SELECT count(*) FROM information_schema.tables
                   WHERE table_schema = %L AND table_name IN (''cajas'',''caja_movimientos'')', v_dst)
    INTO v_n;
  RAISE NOTICE '[caja] tablas creadas: % de 2', v_n;
END
$CAJA$;

COMMIT;

-- PostgREST cachea el esquema: sin esto las tablas nuevas dan
-- "Could not find the table ... in the schema cache" hasta el próximo reinicio.
SELECT pg_notify('pgrst', 'reload schema');
