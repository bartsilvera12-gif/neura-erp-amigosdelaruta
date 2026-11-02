-- =============================================================================
-- KuDE: múltiples logos por empresa (galería) en empresa_sifen_config.kude_logos
--
-- Scope:
--   Permitir que la empresa registre VARIOS logos y elija cuál usar en cada
--   factura. La metadata (id, nombre, path, predeterminado) vive en una columna
--   JSONB; los PNG siguen en el bucket privado `sifen`. Si el arreglo está vacío,
--   el renderer cae al comportamiento actual (kude_logo_path legacy → logo Neura).
--
--   SOLO afecta la representación gráfica KuDE/PDF. NO toca XML rDE, firma, envío
--   SET, CDC, datos fiscales obligatorios, certificado, cancelación, consulta
--   lote ni notas de crédito. El logo elegido jamás cambia el RUC/razón social.
--
-- Forma de cada elemento del arreglo kude_logos:
--   {
--     "id":            text  (uuid del logo; nombre del objeto en storage),
--     "nombre":        text  (etiqueta visible en el selector),
--     "path":          text  (ruta dentro del bucket `sifen`),
--     "predeterminado": bool (true en a lo sumo uno; se usa si no se elige otro)
--   }
--
-- Mismo patrón idempotente que 20260513140000_empresa_sifen_config_kude_branding:
-- ADD COLUMN IF NOT EXISTS en cada schema donde exista `empresa_sifen_config`.
-- Cada bloque va en BEGIN/EXCEPTION para no derribar a los demás tenants.
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
      AND (
        n.nspname = 'public'
        OR n.nspname = 'zentra_erp'
        OR n.nspname ~ '^erp_[a-zA-Z0-9_]+$'
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
      )
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.empresa_sifen_config
           ADD COLUMN IF NOT EXISTS kude_logos jsonb NOT NULL DEFAULT ''[]''::jsonb',
        r.schema_name
      );

      EXECUTE format(
        $cmt$COMMENT ON COLUMN %I.empresa_sifen_config.kude_logos IS
          'Galería de logos KuDE: arreglo JSON de {id,nombre,path,predeterminado}. Solo afecta KuDE/PDF; no toca XML/firma/SET. kude_logo_path (legacy) sigue como fallback.'$cmt$,
        r.schema_name
      );

      -- El valor debe ser siempre un arreglo JSON (nunca objeto/escalar/null).
      BEGIN
        EXECUTE format(
          'ALTER TABLE %I.empresa_sifen_config
             ADD CONSTRAINT empresa_sifen_config_kude_logos_is_array_chk
             CHECK (jsonb_typeof(kude_logos) = ''array'')',
          r.schema_name
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END;

      RAISE NOTICE 'kude_logos ok: %.empresa_sifen_config', r.schema_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'kude_logos fallo en %: %', r.schema_name, SQLERRM;
    END;
  END LOOP;
END;
$$;
