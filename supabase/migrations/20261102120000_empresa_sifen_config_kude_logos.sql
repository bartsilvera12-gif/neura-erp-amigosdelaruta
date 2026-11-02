-- =============================================================================
-- KuDE: múltiples logos por empresa (galería) en empresa_sifen_config.kude_logos
--
-- ÁMBITO: SOLO el schema de este proyecto (Amigos de Ruta): `amigosdelarutaerp`.
-- La base es multi-tenant y COMPARTIDA por muchos proyectos. Esta migración NO
-- debe tocar otros schemas/empresas. Si se despliega en otro tenant, cambiar el
-- nombre del schema abajo (o resolverlo por APP_DB_SCHEMA al aplicar).
--
-- Scope funcional:
--   Registrar VARIOS logos y elegir cuál usar en cada factura. La metadata
--   (id, nombre, path, predeterminado) vive en una columna JSONB; los PNG siguen
--   en el bucket privado `sifen`. Arreglo vacío → fallback a kude_logo_path
--   (legacy) y, en su defecto, al logo Neura.
--
--   SOLO afecta la representación gráfica KuDE/PDF. NO toca XML rDE, firma, envío
--   SET, CDC, datos fiscales obligatorios, certificado, cancelación, consulta
--   lote ni notas de crédito. El logo elegido jamás cambia el RUC/razón social.
--
-- Forma de cada elemento de kude_logos:
--   { "id": text, "nombre": text, "path": text, "predeterminado": bool }
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CHECK con guard de duplicado.
-- =============================================================================

ALTER TABLE amigosdelarutaerp.empresa_sifen_config
  ADD COLUMN IF NOT EXISTS kude_logos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN amigosdelarutaerp.empresa_sifen_config.kude_logos IS
  'Galería de logos KuDE: arreglo JSON de {id,nombre,path,predeterminado}. Solo afecta KuDE/PDF; no toca XML/firma/SET. kude_logo_path (legacy) sigue como fallback.';

-- El valor debe ser siempre un arreglo JSON (nunca objeto/escalar/null).
DO $$
BEGIN
  ALTER TABLE amigosdelarutaerp.empresa_sifen_config
    ADD CONSTRAINT empresa_sifen_config_kude_logos_is_array_chk
    CHECK (jsonb_typeof(kude_logos) = 'array');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END;
$$;
