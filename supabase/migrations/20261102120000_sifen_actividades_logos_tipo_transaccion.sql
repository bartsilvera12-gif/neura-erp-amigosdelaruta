-- =============================================================================
-- Facturación electrónica — Solicitud #0229 (Amigos de la Ruta / BLB y Asociados)
--
-- 1) Varias actividades económicas por emisor.
--    SIFEN (DE v150) permite hasta 9 grupos gEmis.gActEco por documento. La
--    actividad PRINCIPAL sigue en actividad_economica_codigo/_descripcion; las
--    secundarias (las demás que figuran en la constancia de RUC) van en
--    `actividades_economicas_json` como arreglo [{codigo, descripcion}].
--
-- 2) Varios logos para el KuDE.
--    `kude_logo_path` sigue siendo el logo predeterminado. Los logos
--    adicionales van en `kude_logos_json` como [{id, nombre, path}]. Solo
--    afectan la representación gráfica (PDF); nunca el XML, la firma ni el CDC.
--
-- 3) Por factura:
--    - `sifen_tipo_transaccion` (gOpeCom.iTipTra): 1 Mercaderías, 2 Servicios,
--      3 Mixto. NULL = 1 (comportamiento anterior).
--    - `kude_logo_id`: logo elegido al facturar (id dentro de kude_logos_json).
--      NULL = logo predeterminado.
--
-- El sufijo `_json` en el nombre de columna hace que el shim Postgres de los
-- tenants erp_* serialice el valor con ::jsonb.
--
-- Idempotente; recorre todos los schemas que tengan las tablas (public,
-- zentra_erp, neura, erp_*, er_<hex>, …). Un schema con estado raro no
-- derriba la migración para los demás.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname::text AS schema_name
    FROM pg_namespace n
    JOIN pg_class c ON c.relnamespace = n.oid
    WHERE c.relname = 'empresa_sifen_config'
      AND c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.empresa_sifen_config
           ADD COLUMN IF NOT EXISTS actividades_economicas_json jsonb NOT NULL DEFAULT ''[]''::jsonb,
           ADD COLUMN IF NOT EXISTS kude_logos_json             jsonb NOT NULL DEFAULT ''[]''::jsonb',
        r.schema_name
      );
      EXECUTE format(
        $cmt$COMMENT ON COLUMN %I.empresa_sifen_config.actividades_economicas_json IS
          'Actividades económicas SECUNDARIAS del RUC [{codigo, descripcion}] (gEmis.gActEco, máx. 8 + la principal).'$cmt$,
        r.schema_name
      );
      EXECUTE format(
        $cmt$COMMENT ON COLUMN %I.empresa_sifen_config.kude_logos_json IS
          'Logos adicionales del KuDE [{id, nombre, path}] (bucket "sifen"). Solo PDF; no toca XML/firma/SET.'$cmt$,
        r.schema_name
      );
      RAISE NOTICE 'sifen #0229 ok: %.empresa_sifen_config', r.schema_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'sifen #0229 fallo en %.empresa_sifen_config: %', r.schema_name, SQLERRM;
    END;
  END LOOP;

  FOR r IN
    SELECT n.nspname::text AS schema_name
    FROM pg_namespace n
    JOIN pg_class c ON c.relnamespace = n.oid
    WHERE c.relname = 'facturas'
      AND c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.facturas
           ADD COLUMN IF NOT EXISTS sifen_tipo_transaccion smallint,
           ADD COLUMN IF NOT EXISTS kude_logo_id           text',
        r.schema_name
      );
      BEGIN
        EXECUTE format(
          'ALTER TABLE %I.facturas
             ADD CONSTRAINT facturas_sifen_tipo_transaccion_chk
             CHECK (sifen_tipo_transaccion IS NULL OR sifen_tipo_transaccion IN (1, 2, 3))',
          r.schema_name
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END;
      EXECUTE format(
        $cmt$COMMENT ON COLUMN %I.facturas.sifen_tipo_transaccion IS
          'SIFEN gOpeCom.iTipTra: 1 Venta de mercadería, 2 Prestación de servicios, 3 Mixto. NULL = 1.'$cmt$,
        r.schema_name
      );
      EXECUTE format(
        $cmt$COMMENT ON COLUMN %I.facturas.kude_logo_id IS
          'Logo del KuDE elegido al facturar (id en empresa_sifen_config.kude_logos_json). NULL = predeterminado.'$cmt$,
        r.schema_name
      );
      RAISE NOTICE 'sifen #0229 ok: %.facturas', r.schema_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'sifen #0229 fallo en %.facturas: %', r.schema_name, SQLERRM;
    END;
  END LOOP;
END;
$$;
