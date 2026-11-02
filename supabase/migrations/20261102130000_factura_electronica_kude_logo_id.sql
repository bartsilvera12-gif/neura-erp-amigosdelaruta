-- =============================================================================
-- KuDE: logo elegido por factura en factura_electronica.kude_logo_id
--
-- Scope:
--   Guardar qué logo de la galería (empresa_sifen_config.kude_logos) se eligió
--   para ESTA factura, de modo que el KuDE emitido y sus reimpresiones usen
--   siempre el mismo logo. NULL = usar el predeterminado de la empresa.
--
--   SOLO afecta la representación gráfica KuDE/PDF. NO toca XML rDE, firma,
--   envío SET, CDC, datos fiscales obligatorios, certificado, cancelación,
--   consulta lote ni notas de crédito. El logo jamás cambia el RUC/razón social.
--
-- Mismo patrón idempotente/multi-tenant que las migraciones KuDE previas:
-- ADD COLUMN IF NOT EXISTS en cada schema donde exista `factura_electronica`.
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
    WHERE c.relname = 'factura_electronica'
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
        'ALTER TABLE %I.factura_electronica
           ADD COLUMN IF NOT EXISTS kude_logo_id text',
        r.schema_name
      );

      EXECUTE format(
        $cmt$COMMENT ON COLUMN %I.factura_electronica.kude_logo_id IS
          'Id del logo de empresa_sifen_config.kude_logos elegido para esta factura. NULL = predeterminado. Solo afecta KuDE/PDF; no toca XML/firma/SET.'$cmt$,
        r.schema_name
      );

      RAISE NOTICE 'kude_logo_id ok: %.factura_electronica', r.schema_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'kude_logo_id fallo en %: %', r.schema_name, SQLERRM;
    END;
  END LOOP;
END;
$$;
