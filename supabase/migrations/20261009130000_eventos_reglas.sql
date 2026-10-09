-- =============================================================================
-- Módulo Eventos — reglas: RLS, triggers, correlativo y vistas de cálculo.
-- Continúa 20261009120000_eventos_provision.sql con el mismo patrón
-- multi-schema: una función de provisión por schema y un bucle que la aplica a
-- todos los que ya tienen el módulo.
--
-- Lo que esta migración hace cumplir EN LA BASE, porque la web va a escribir
-- contra estas tablas y no alcanza con confiar en el cliente:
--   · los cupos no se sobre-venden sin una autorización explícita, que queda
--     registrada en auditoría;
--   · los pagos no se borran: se anulan o se revierten;
--   · los saldos no se guardan, se derivan de los movimientos.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout = '10s';

-- `public.set_updated_at()` ya existe en el ERP y se usa en 62 lugares: los
-- triggers de este modulo la reusan en vez de duplicarla. Solo se crea si
-- faltara, para que el modulo tambien instale en una base limpia.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc pp JOIN pg_namespace nn ON nn.oid = pp.pronamespace
    WHERE nn.nspname = 'public' AND pp.proname = 'set_updated_at'
  ) THEN
    EXECUTE $crea$
      CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
      $body$
    $crea$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.neura_provision_eventos_reglas(s text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  v_svc  boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
  v_guard text;
BEGIN
  IF s IS NULL OR btrim(s) = '' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN RETURN; END IF;

  -- `puede_acceder_empresa` vive en el schema del tenant en instalaciones
  -- nuevas y en `public` en las viejas. Se resuelve explícitamente en vez de
  -- confiar en el search_path, que dentro de una política RLS no es el que uno
  -- cree. Si no aparece, se corta: una política sin guard sería una tabla
  -- multiempresa abierta.
  SELECT quote_ident(n.nspname) || '.puede_acceder_empresa'
    INTO v_guard
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE pr.proname = 'puede_acceder_empresa'
    AND n.nspname IN (s, 'public')
  ORDER BY (n.nspname = s) DESC
  LIMIT 1;

  IF v_guard IS NULL THEN
    RAISE EXCEPTION 'No se encontro puede_acceder_empresa() para el schema %. Sin guard no se crean politicas RLS.', s;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = s AND c.relname = 'reservas' AND c.relkind = 'r') THEN
    RETURN;   -- el módulo no está provisionado en este schema
  END IF;

  -- RLS + políticas + grants + updated_at
  EXECUTE format($ddl$ALTER TABLE %1$I.eventos ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS eventos_select ON %1$I.eventos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY eventos_select ON %1$I.eventos FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS eventos_insert ON %1$I.eventos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY eventos_insert ON %1$I.eventos FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS eventos_update ON %1$I.eventos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY eventos_update ON %1$I.eventos FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS eventos_delete ON %1$I.eventos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY eventos_delete ON %1$I.eventos FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS eventos_set_updated_at ON %1$I.eventos$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER eventos_set_updated_at BEFORE UPDATE ON %1$I.eventos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.eventos TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.eventos TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.evento_itinerario ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS evento_itinerario_select ON %1$I.evento_itinerario$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY evento_itinerario_select ON %1$I.evento_itinerario FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS evento_itinerario_insert ON %1$I.evento_itinerario$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY evento_itinerario_insert ON %1$I.evento_itinerario FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS evento_itinerario_update ON %1$I.evento_itinerario$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY evento_itinerario_update ON %1$I.evento_itinerario FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS evento_itinerario_delete ON %1$I.evento_itinerario$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY evento_itinerario_delete ON %1$I.evento_itinerario FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS evento_itinerario_set_updated_at ON %1$I.evento_itinerario$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER evento_itinerario_set_updated_at BEFORE UPDATE ON %1$I.evento_itinerario FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.evento_itinerario TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.evento_itinerario TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.salidas ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS salidas_select ON %1$I.salidas$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY salidas_select ON %1$I.salidas FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS salidas_insert ON %1$I.salidas$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY salidas_insert ON %1$I.salidas FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS salidas_update ON %1$I.salidas$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY salidas_update ON %1$I.salidas FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS salidas_delete ON %1$I.salidas$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY salidas_delete ON %1$I.salidas FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS salidas_set_updated_at ON %1$I.salidas$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER salidas_set_updated_at BEFORE UPDATE ON %1$I.salidas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.salidas TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.salidas TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.paquetes ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS paquetes_select ON %1$I.paquetes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY paquetes_select ON %1$I.paquetes FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS paquetes_insert ON %1$I.paquetes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY paquetes_insert ON %1$I.paquetes FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS paquetes_update ON %1$I.paquetes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY paquetes_update ON %1$I.paquetes FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS paquetes_delete ON %1$I.paquetes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY paquetes_delete ON %1$I.paquetes FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS paquetes_set_updated_at ON %1$I.paquetes$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER paquetes_set_updated_at BEFORE UPDATE ON %1$I.paquetes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.paquetes TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.paquetes TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.adicionales ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS adicionales_select ON %1$I.adicionales$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY adicionales_select ON %1$I.adicionales FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS adicionales_insert ON %1$I.adicionales$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY adicionales_insert ON %1$I.adicionales FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS adicionales_update ON %1$I.adicionales$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY adicionales_update ON %1$I.adicionales FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS adicionales_delete ON %1$I.adicionales$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY adicionales_delete ON %1$I.adicionales FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS adicionales_set_updated_at ON %1$I.adicionales$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER adicionales_set_updated_at BEFORE UPDATE ON %1$I.adicionales FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.adicionales TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.adicionales TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.reservas ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reservas_select ON %1$I.reservas$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reservas_select ON %1$I.reservas FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reservas_insert ON %1$I.reservas$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reservas_insert ON %1$I.reservas FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reservas_update ON %1$I.reservas$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reservas_update ON %1$I.reservas FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reservas_delete ON %1$I.reservas$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reservas_delete ON %1$I.reservas FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS reservas_set_updated_at ON %1$I.reservas$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER reservas_set_updated_at BEFORE UPDATE ON %1$I.reservas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reservas TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reservas TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.reserva_adicionales ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_adicionales_select ON %1$I.reserva_adicionales$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_adicionales_select ON %1$I.reserva_adicionales FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_adicionales_insert ON %1$I.reserva_adicionales$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_adicionales_insert ON %1$I.reserva_adicionales FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_adicionales_update ON %1$I.reserva_adicionales$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_adicionales_update ON %1$I.reserva_adicionales FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_adicionales_delete ON %1$I.reserva_adicionales$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_adicionales_delete ON %1$I.reserva_adicionales FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reserva_adicionales TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reserva_adicionales TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.participantes ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS participantes_select ON %1$I.participantes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY participantes_select ON %1$I.participantes FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS participantes_insert ON %1$I.participantes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY participantes_insert ON %1$I.participantes FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS participantes_update ON %1$I.participantes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY participantes_update ON %1$I.participantes FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS participantes_delete ON %1$I.participantes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY participantes_delete ON %1$I.participantes FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS participantes_set_updated_at ON %1$I.participantes$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER participantes_set_updated_at BEFORE UPDATE ON %1$I.participantes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.participantes TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.participantes TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.participante_documentos ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS participante_documentos_select ON %1$I.participante_documentos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY participante_documentos_select ON %1$I.participante_documentos FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS participante_documentos_insert ON %1$I.participante_documentos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY participante_documentos_insert ON %1$I.participante_documentos FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS participante_documentos_update ON %1$I.participante_documentos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY participante_documentos_update ON %1$I.participante_documentos FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS participante_documentos_delete ON %1$I.participante_documentos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY participante_documentos_delete ON %1$I.participante_documentos FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS participante_documentos_set_updated_at ON %1$I.participante_documentos$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER participante_documentos_set_updated_at BEFORE UPDATE ON %1$I.participante_documentos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.participante_documentos TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.participante_documentos TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.reserva_pagos ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_pagos_select ON %1$I.reserva_pagos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_pagos_select ON %1$I.reserva_pagos FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_pagos_insert ON %1$I.reserva_pagos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_pagos_insert ON %1$I.reserva_pagos FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_pagos_update ON %1$I.reserva_pagos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_pagos_update ON %1$I.reserva_pagos FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_pagos_delete ON %1$I.reserva_pagos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_pagos_delete ON %1$I.reserva_pagos FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS reserva_pagos_set_updated_at ON %1$I.reserva_pagos$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER reserva_pagos_set_updated_at BEFORE UPDATE ON %1$I.reserva_pagos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reserva_pagos TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reserva_pagos TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.reserva_plan_pagos ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_plan_pagos_select ON %1$I.reserva_plan_pagos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_plan_pagos_select ON %1$I.reserva_plan_pagos FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_plan_pagos_insert ON %1$I.reserva_plan_pagos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_plan_pagos_insert ON %1$I.reserva_plan_pagos FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_plan_pagos_update ON %1$I.reserva_plan_pagos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_plan_pagos_update ON %1$I.reserva_plan_pagos FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_plan_pagos_delete ON %1$I.reserva_plan_pagos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_plan_pagos_delete ON %1$I.reserva_plan_pagos FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS reserva_plan_pagos_set_updated_at ON %1$I.reserva_plan_pagos$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER reserva_plan_pagos_set_updated_at BEFORE UPDATE ON %1$I.reserva_plan_pagos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reserva_plan_pagos TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reserva_plan_pagos TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.producto_variantes ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS producto_variantes_select ON %1$I.producto_variantes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY producto_variantes_select ON %1$I.producto_variantes FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS producto_variantes_insert ON %1$I.producto_variantes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY producto_variantes_insert ON %1$I.producto_variantes FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS producto_variantes_update ON %1$I.producto_variantes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY producto_variantes_update ON %1$I.producto_variantes FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS producto_variantes_delete ON %1$I.producto_variantes$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY producto_variantes_delete ON %1$I.producto_variantes FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS producto_variantes_set_updated_at ON %1$I.producto_variantes$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER producto_variantes_set_updated_at BEFORE UPDATE ON %1$I.producto_variantes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.producto_variantes TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.producto_variantes TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.evento_kits ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS evento_kits_select ON %1$I.evento_kits$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY evento_kits_select ON %1$I.evento_kits FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS evento_kits_insert ON %1$I.evento_kits$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY evento_kits_insert ON %1$I.evento_kits FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS evento_kits_update ON %1$I.evento_kits$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY evento_kits_update ON %1$I.evento_kits FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS evento_kits_delete ON %1$I.evento_kits$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY evento_kits_delete ON %1$I.evento_kits FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS evento_kits_set_updated_at ON %1$I.evento_kits$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER evento_kits_set_updated_at BEFORE UPDATE ON %1$I.evento_kits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.evento_kits TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.evento_kits TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.reserva_stock ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_stock_select ON %1$I.reserva_stock$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_stock_select ON %1$I.reserva_stock FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_stock_insert ON %1$I.reserva_stock$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_stock_insert ON %1$I.reserva_stock FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_stock_update ON %1$I.reserva_stock$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_stock_update ON %1$I.reserva_stock FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_stock_delete ON %1$I.reserva_stock$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_stock_delete ON %1$I.reserva_stock FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS reserva_stock_set_updated_at ON %1$I.reserva_stock$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER reserva_stock_set_updated_at BEFORE UPDATE ON %1$I.reserva_stock FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reserva_stock TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reserva_stock TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.eventos_auditoria ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS eventos_auditoria_select ON %1$I.eventos_auditoria$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY eventos_auditoria_select ON %1$I.eventos_auditoria FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS eventos_auditoria_insert ON %1$I.eventos_auditoria$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY eventos_auditoria_insert ON %1$I.eventos_auditoria FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS eventos_auditoria_update ON %1$I.eventos_auditoria$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY eventos_auditoria_update ON %1$I.eventos_auditoria FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS eventos_auditoria_delete ON %1$I.eventos_auditoria$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY eventos_auditoria_delete ON %1$I.eventos_auditoria FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.eventos_auditoria TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.eventos_auditoria TO service_role$ddl$, s); END IF;
  EXECUTE format($ddl$ALTER TABLE %1$I.reserva_correlativos ENABLE ROW LEVEL SECURITY$ddl$, s);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_correlativos_select ON %1$I.reserva_correlativos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_correlativos_select ON %1$I.reserva_correlativos FOR SELECT USING (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_correlativos_insert ON %1$I.reserva_correlativos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_correlativos_insert ON %1$I.reserva_correlativos FOR INSERT WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_correlativos_update ON %1$I.reserva_correlativos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_correlativos_update ON %1$I.reserva_correlativos FOR UPDATE USING (%2$s(empresa_id)) WITH CHECK (%2$s(empresa_id))$ddl$, s, v_guard);
  EXECUTE format($ddl$DROP POLICY IF EXISTS reserva_correlativos_delete ON %1$I.reserva_correlativos$ddl$, s);
  EXECUTE format($ddl$CREATE POLICY reserva_correlativos_delete ON %1$I.reserva_correlativos FOR DELETE USING (%2$s(empresa_id))$ddl$, s, v_guard);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reserva_correlativos TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.reserva_correlativos TO service_role$ddl$, s); END IF;

  -- Correlativo de reservas: ADR-2027-00128. Por empresa y por AÑO DE SALIDA,
  -- no por año calendario: una reserva al viaje 2027 dice 2027 aunque se venda
  -- en 2026. El UPDATE ... RETURNING toma el lock, así que dos reservas
  -- simultáneas no pueden sacar el mismo número.
  EXECUTE format($ddl$
    CREATE OR REPLACE FUNCTION %1$I.next_codigo_reserva(p_empresa_id uuid, p_anio integer, p_prefijo text DEFAULT 'ADR')
    RETURNS text LANGUAGE plpgsql AS $body$
    DECLARE v_num bigint;
    BEGIN
      INSERT INTO %1$I.reserva_correlativos (empresa_id, anio, ultimo_numero)
      VALUES (p_empresa_id, p_anio, 1)
      ON CONFLICT (empresa_id, anio)
      DO UPDATE SET ultimo_numero = %1$I.reserva_correlativos.ultimo_numero + 1, updated_at = now()
      RETURNING ultimo_numero INTO v_num;
      RETURN p_prefijo || '-' || p_anio::text || '-' || lpad(v_num::text, 5, '0');
    END;
    $body$$ddl$, s);

  -- Control de cupo. El pliego deja abierta la regla fina ("por persona,
  -- paquete, moto u otros recursos" es definición pendiente del cliente), así
  -- que se implementa la del propio documento: PERSONAS contra salidas.cupo_total.
  -- Cambiar la regla es cambiar esta función y nada más.
  EXECUTE format($ddl$
    CREATE OR REPLACE FUNCTION %1$I.reservas_control_cupo()
    RETURNS trigger LANGUAGE plpgsql AS $body$
    DECLARE v_cupo integer; v_ocupados integer; v_sch text := TG_TABLE_SCHEMA;
    BEGIN
      IF NEW.estado = 'cancelada' THEN RETURN NEW; END IF;

      EXECUTE format('SELECT cupo_total FROM %%%%I.salidas WHERE id = $1', v_sch)
        INTO v_cupo USING NEW.salida_id;
      IF v_cupo IS NULL THEN RETURN NEW; END IF;

      EXECUTE format('SELECT COALESCE(SUM(cantidad_participantes),0) FROM %%%%I.reservas WHERE salida_id = $1 AND estado <> ''cancelada'' AND id <> $2', v_sch)
        INTO v_ocupados USING NEW.salida_id, NEW.id;

      IF v_ocupados + NEW.cantidad_participantes > v_cupo THEN
        IF COALESCE(NEW.sobreventa_autorizada, false) THEN
          EXECUTE format('INSERT INTO %%%%I.eventos_auditoria (empresa_id, entidad, entidad_id, accion, usuario_id, datos_despues) VALUES ($1,''reservas'',$2,''sobreventa_autorizada'',$3,$4)', v_sch)
            USING NEW.empresa_id, NEW.id, NEW.sobreventa_autorizada_por,
                  jsonb_build_object('cupo_total', v_cupo, 'ocupados', v_ocupados, 'solicitados', NEW.cantidad_participantes);
        ELSE
          RAISE EXCEPTION 'Cupo insuficiente en la salida %%%%: %%%% ocupados de %%%%, se piden %%%% mas. Requiere sobreventa autorizada.',
            NEW.salida_id, v_ocupados, v_cupo, NEW.cantidad_participantes USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $body$$ddl$, s);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS reservas_control_cupo ON %1$I.reservas$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER reservas_control_cupo BEFORE INSERT OR UPDATE OF cantidad_participantes, salida_id, estado ON %1$I.reservas FOR EACH ROW EXECUTE FUNCTION %1$I.reservas_control_cupo()$ddl$, s);

  -- "Nunca eliminar pagos: anular o revertir manteniendo auditoría."
  -- Se hace cumplir en la base, no en la aplicación: la web va a escribir acá.
  EXECUTE format($ddl$
    CREATE OR REPLACE FUNCTION %1$I.reserva_pagos_no_delete()
    RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      RAISE EXCEPTION 'Los pagos de reserva no se eliminan: anular (estado = anulado) o registrar una reversion.'
        USING ERRCODE = 'restrict_violation';
    END;
    $body$$ddl$, s);
  EXECUTE format($ddl$DROP TRIGGER IF EXISTS reserva_pagos_bloquear_delete ON %1$I.reserva_pagos$ddl$, s);
  EXECUTE format($ddl$CREATE TRIGGER reserva_pagos_bloquear_delete BEFORE DELETE ON %1$I.reserva_pagos FOR EACH ROW EXECUTE FUNCTION %1$I.reserva_pagos_no_delete()$ddl$, s);

  -- Vistas de cálculo. Ninguna tabla guarda saldo ni cupo ocupado: el pliego
  -- pide que los saldos salgan de los movimientos, no de una edición manual.
  EXECUTE format($ddl$
    CREATE OR REPLACE VIEW %1$I.reserva_saldos AS
    SELECT r.id AS reserva_id, r.empresa_id, r.codigo, r.moneda, r.estado,
           r.precio_paquete + COALESCE(ad.total_adicionales, 0) AS total_contratado,
           COALESCE(pg.total_abonado, 0) AS total_abonado,
           r.precio_paquete + COALESCE(ad.total_adicionales, 0) - COALESCE(pg.total_abonado, 0) AS saldo,
           pl.proximo_vencimiento
    FROM %1$I.reservas r
    LEFT JOIN LATERAL (SELECT SUM(ra.cantidad * ra.precio_unitario) AS total_adicionales
                       FROM %1$I.reserva_adicionales ra WHERE ra.reserva_id = r.id) ad ON true
    LEFT JOIN LATERAL (SELECT SUM(rp.importe_equivalente) AS total_abonado
                       FROM %1$I.reserva_pagos rp WHERE rp.reserva_id = r.id AND rp.estado = 'confirmado') pg ON true
    LEFT JOIN LATERAL (SELECT MIN(pp.vencimiento) AS proximo_vencimiento
                       FROM %1$I.reserva_plan_pagos pp WHERE pp.reserva_id = r.id AND pp.estado = 'pendiente') pl ON true$ddl$, s);
  EXECUTE format($ddl$
    CREATE OR REPLACE VIEW %1$I.salida_cupos AS
    SELECT s2.id AS salida_id, s2.empresa_id, s2.evento_id, s2.fecha_inicio, s2.estado, s2.cupo_total,
           COALESCE(oc.ocupados, 0) AS ocupados,
           CASE WHEN s2.cupo_total IS NULL THEN NULL ELSE s2.cupo_total - COALESCE(oc.ocupados, 0) END AS disponibles
    FROM %1$I.salidas s2
    LEFT JOIN LATERAL (SELECT SUM(r.cantidad_participantes) AS ocupados
                       FROM %1$I.reservas r WHERE r.salida_id = s2.id AND r.estado <> 'cancelada') oc ON true$ddl$, s);
  EXECUTE format($ddl$
    CREATE OR REPLACE VIEW %1$I.kit_necesidad AS
    SELECT s2.id AS salida_id, s2.empresa_id, s2.evento_id, k.producto_id, k.considera_talle,
           SUM(r.cantidad_participantes * k.cantidad_por_participante) AS requerido,
           COALESCE(pr.stock_actual, 0) AS stock_actual,
           COALESCE(pr.stock_reservado, 0) AS stock_reservado,
           COALESCE(pr.stock_actual, 0) - COALESCE(pr.stock_reservado, 0) AS stock_disponible,
           SUM(r.cantidad_participantes * k.cantidad_por_participante)
             - (COALESCE(pr.stock_actual, 0) - COALESCE(pr.stock_reservado, 0)) AS faltante
    FROM %1$I.salidas s2
    JOIN %1$I.reservas r ON r.salida_id = s2.id AND r.estado IN ('confirmada','pago_parcial','reservada')
    JOIN %1$I.evento_kits k ON k.evento_id = s2.evento_id AND (k.paquete_id IS NULL OR k.paquete_id = r.paquete_id)
    LEFT JOIN %1$I.productos pr ON pr.id = k.producto_id
    GROUP BY s2.id, s2.empresa_id, s2.evento_id, k.producto_id, k.considera_talle, pr.stock_actual, pr.stock_reservado$ddl$, s);
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT ON %1$I.reserva_saldos TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT ON %1$I.reserva_saldos TO service_role$ddl$, s); END IF;
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT ON %1$I.salida_cupos TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT ON %1$I.salida_cupos TO service_role$ddl$, s); END IF;
  IF v_auth THEN EXECUTE format($ddl$GRANT SELECT ON %1$I.kit_necesidad TO authenticated$ddl$, s); END IF;
  IF v_svc  THEN EXECUTE format($ddl$GRANT SELECT ON %1$I.kit_necesidad TO service_role$ddl$, s); END IF;
END;
$fn$;

COMMENT ON FUNCTION public.neura_provision_eventos_reglas(text) IS
  'Aplica RLS, triggers, correlativo y vistas del módulo Eventos en el schema indicado. Idempotente.';

-- Ejecuta DDL y `public` está expuesto por PostgREST en Supabase: sin esto
-- quedaría alcanzable como RPC. Mismo criterio que usa el repo con
-- public.sorteos_ensure_order_from_chat.
REVOKE ALL ON FUNCTION public.neura_provision_eventos_reglas(text) FROM PUBLIC;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_namespace n
    WHERE EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relname = 'reservas' AND c.relkind = 'r')
      AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relname = 'productos' AND c.relkind = 'r')
    ORDER BY 1
  LOOP
    PERFORM public.neura_provision_eventos_reglas(r.sch);
    RAISE NOTICE 'reglas del modulo eventos aplicadas en %', r.sch;
  END LOOP;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
