-- =============================================================================
-- 09 · Pago con tarjeta por Bancard (vPOS 2.0) desde el sitio.
--
-- Corre DESPUÉS del 05 (web_pedido, web_config) y del módulo Eventos
-- (reservas, reserva_pagos). Idempotente. Escribe solo en `amigosdelarutaerp`.
--
-- Qué agrega:
--   · bancard_pago   un intento de cobro por fila: la seña de una reserva o el
--                    total de un pedido de la tienda. Su `shop_process_id` es el
--                    número que viaja a Bancard y no se repite nunca.
--   · web_pedido     pagado_at / pago_referencia: un pedido cobrado por Bancard
--                    sigue `pendiente` (lo confirma ADR al armar la venta), pero
--                    se ve que ya está pagado.
--   · web_config     `cobro_bancard`: la seña y la cotización USD → Gs con la que
--                    se cobra. Solo se carga si no existe: no pisa lo que ADR
--                    haya editado.
--
-- Lo que se cobra en una reserva entra como un pago más en `reserva_pagos`
-- (medio `tarjeta`, pasarela `bancard`), así el saldo sale solo de la vista
-- `reserva_saldos` igual que con un pago cargado a mano.
-- =============================================================================

BEGIN;

DO $BC$
DECLARE
  v_dst   text := 'amigosdelarutaerp';
  v_guard text;
  v_touch text;
  v_auth  boolean;
  v_svc   boolean;
BEGIN
  IF to_regnamespace(v_dst) IS NULL THEN
    RAISE EXCEPTION 'No existe el schema %. Corré primero el 01.', v_dst;
  END IF;
  IF to_regclass(v_dst || '.web_pedido') IS NULL OR to_regclass(v_dst || '.reserva_pagos') IS NULL THEN
    RAISE EXCEPTION 'Faltan web_pedido o reserva_pagos en %. Corré primero el 05 y el módulo Eventos.', v_dst;
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

  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO v_auth;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  INTO v_svc;

  -- ---------------------------------------------------------------------------
  -- bancard_pago
  --
  -- `shop_process_id` sale de una secuencia propia: Bancard exige un entero
  -- (hasta 15 dígitos) que el comercio no repita jamás, ni entre intentos del
  -- mismo pedido. Arranca en 100000 para que no se confunda con códigos de
  -- reserva o números de pedido.
  --
  -- Montos: `monto_gs` es lo que se le pidió a Bancard. `moneda_origen`,
  -- `importe_origen` y `tipo_cambio` guardan de dónde salió, como pide el
  -- pliego ("moneda e importe original, tipo de cambio aplicado y equivalente").
  -- ---------------------------------------------------------------------------
  EXECUTE format($ddl$CREATE SEQUENCE IF NOT EXISTS %1$I.bancard_shop_process_seq START 100000$ddl$, v_dst);

  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.bancard_pago (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL,
  shop_process_id       bigint NOT NULL DEFAULT nextval(%2$L::regclass),
  tipo                  text NOT NULL,
  reserva_id            uuid REFERENCES %1$I.reservas(id) ON DELETE RESTRICT,
  pedido_id             uuid REFERENCES %1$I.web_pedido(id) ON DELETE RESTRICT,
  descripcion           text NOT NULL,
  monto_gs              numeric(15,0) NOT NULL,
  moneda_origen         text NOT NULL,
  importe_origen        numeric NOT NULL,
  tipo_cambio           numeric NOT NULL DEFAULT 1,
  entorno               text NOT NULL,
  process_id            text,
  estado                text NOT NULL DEFAULT 'creado',
  response_code         text,
  response_description  text,
  authorization_number  text,
  ticket_number         text,
  motivo                text,
  reserva_pago_id       uuid REFERENCES %1$I.reserva_pagos(id) ON DELETE SET NULL,
  confirmado_at         timestamptz,
  acreditado_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bancard_pago_spid_uk UNIQUE (shop_process_id),
  CONSTRAINT bancard_pago_tipo_chk CHECK (
    (tipo = 'reserva' AND reserva_id IS NOT NULL AND pedido_id IS NULL) OR
    (tipo = 'pedido'  AND pedido_id  IS NOT NULL AND reserva_id IS NULL)),
  CONSTRAINT bancard_pago_monto_chk CHECK (monto_gs > 0),
  CONSTRAINT bancard_pago_entorno_chk CHECK (entorno IN ('staging', 'produccion')),
  CONSTRAINT bancard_pago_estado_chk CHECK (estado IN
    ('creado', 'pendiente', 'aprobado', 'acreditando', 'acreditado', 'rechazado', 'revertido', 'error'))
    )$ddl$, v_dst, v_dst || '.bancard_shop_process_seq');

  EXECUTE format($ddl$ALTER SEQUENCE %1$I.bancard_shop_process_seq OWNED BY %1$I.bancard_pago.shop_process_id$ddl$, v_dst);
  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_bancard_pago_reserva ON %1$I.bancard_pago(reserva_id) WHERE reserva_id IS NOT NULL$ddl$, v_dst);
  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_bancard_pago_pedido  ON %1$I.bancard_pago(pedido_id)  WHERE pedido_id  IS NOT NULL$ddl$, v_dst);
  EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_bancard_pago_estado  ON %1$I.bancard_pago(empresa_id, estado, created_at DESC)$ddl$, v_dst);

  -- Un cobro de Bancard entra una sola vez en reserva_pagos, aunque lleguen dos
  -- confirmaciones a la vez: la segunda choca acá.
  EXECUTE format($ddl$CREATE UNIQUE INDEX IF NOT EXISTS ux_reserva_pagos_pasarela
    ON %1$I.reserva_pagos(pasarela_proveedor, pasarela_payment_id)
    WHERE pasarela_proveedor IS NOT NULL AND pasarela_payment_id IS NOT NULL$ddl$, v_dst);

  EXECUTE format($d$ALTER TABLE %1$I.bancard_pago ENABLE ROW LEVEL SECURITY$d$, v_dst);
  -- Desde el ERP se mira; lo escribe solo el servidor (service_role).
  EXECUTE format($d$DROP POLICY IF EXISTS bancard_pago_select ON %1$I.bancard_pago$d$, v_dst);
  EXECUTE format($d$CREATE POLICY bancard_pago_select ON %1$I.bancard_pago FOR SELECT USING (%2$s(empresa_id))$d$, v_dst, v_guard);
  EXECUTE format($d$DROP TRIGGER IF EXISTS bancard_pago_set_updated_at ON %1$I.bancard_pago$d$, v_dst);
  EXECUTE format($d$CREATE TRIGGER bancard_pago_set_updated_at BEFORE UPDATE ON %1$I.bancard_pago
                    FOR EACH ROW EXECUTE FUNCTION %2$s()$d$, v_dst, v_touch);
  IF v_auth THEN
    EXECUTE format($d$GRANT SELECT ON %1$I.bancard_pago TO authenticated$d$, v_dst);
  END IF;
  IF v_svc THEN
    EXECUTE format($d$GRANT SELECT, INSERT, UPDATE ON %1$I.bancard_pago TO service_role$d$, v_dst);
    EXECUTE format($d$GRANT USAGE ON SEQUENCE %1$I.bancard_shop_process_seq TO service_role$d$, v_dst);
  END IF;

  -- ---------------------------------------------------------------------------
  -- web_pedido: marca de pagado.
  -- ---------------------------------------------------------------------------
  EXECUTE format($d$ALTER TABLE %1$I.web_pedido ADD COLUMN IF NOT EXISTS pagado_at timestamptz$d$, v_dst);
  EXECUTE format($d$ALTER TABLE %1$I.web_pedido ADD COLUMN IF NOT EXISTS pago_referencia text$d$, v_dst);

  -- ---------------------------------------------------------------------------
  -- web_config `cobro_bancard`, una fila por empresa, sin pisar lo editado.
  --   sena_usd      seña de una reserva, por reserva (la web usaba DEPOSIT = 1500)
  --   tasa_usd_pyg  Gs por dólar para cobrar lo que está en USD
  --   fecha_tasa    cuándo se cargó la tasa; la web la muestra al lado
  -- ---------------------------------------------------------------------------
  EXECUTE format($d$
    INSERT INTO %1$I.web_config (empresa_id, clave, valor, nota)
    SELECT e.id, 'cobro_bancard',
           jsonb_build_object('sena_usd', 1500, 'tasa_usd_pyg', 6048, 'fecha_tasa', '2026-10-07'),
           'Seña por reserva (USD) y cotización USD a Gs con la que se cobra por Bancard. Actualizar la tasa.'
      FROM %1$I.empresas e
    ON CONFLICT (empresa_id, clave) DO NOTHING$d$, v_dst);

  RAISE NOTICE '[bancard] % listo', v_dst;
END
$BC$;

COMMIT;

-- Verificación
SELECT c.relname AS tabla, c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp' AND c.relkind = 'r' AND c.relname = 'bancard_pago';

SELECT clave, valor FROM amigosdelarutaerp.web_config WHERE clave = 'cobro_bancard';

SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'amigosdelarutaerp' AND table_name = 'web_pedido'
   AND column_name IN ('pagado_at', 'pago_referencia');

SELECT pg_notify('pgrst', 'reload schema');
