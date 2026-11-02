-- =============================================================================
-- SIFEN: actividades económicas adicionales del emisor (varias gActEco)
--
-- ÁMBITO: SOLO el schema de este proyecto (Amigos de Ruta): `amigosdelarutaerp`.
-- La base es multi-tenant y COMPARTIDA por muchos proyectos. Esta migración NO
-- debe tocar otros schemas/empresas.
--
-- Scope funcional:
--   Guardar actividades económicas adicionales/secundarias del emisor. SIFEN
--   admite varias gActEco (1..N). Al facturar se emiten la principal
--   (actividad_economica_codigo/descripcion) + estas. Cada código debe coincidir
--   con el catálogo SET del RUC (error 1261 si no). No cambia los datos fiscales.
--
-- Forma de cada elemento: { "codigo": text, "descripcion": text }
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CHECK con guard de duplicado.
-- =============================================================================

ALTER TABLE amigosdelarutaerp.empresa_sifen_config
  ADD COLUMN IF NOT EXISTS actividades_economicas jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN amigosdelarutaerp.empresa_sifen_config.actividades_economicas IS
  'Actividades económicas adicionales del emisor: arreglo JSON de {codigo,descripcion}. Se emiten como gActEco extra junto a la principal. Deben coincidir con el catálogo SET del RUC.';

DO $$
BEGIN
  ALTER TABLE amigosdelarutaerp.empresa_sifen_config
    ADD CONSTRAINT empresa_sifen_config_actividades_eco_is_array_chk
    CHECK (jsonb_typeof(actividades_economicas) = 'array');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END;
$$;
