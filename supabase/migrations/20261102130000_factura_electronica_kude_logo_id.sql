-- =============================================================================
-- KuDE: logo elegido por factura en factura_electronica.kude_logo_id
--
-- ÁMBITO: SOLO el schema de este proyecto (Amigos de Ruta): `amigosdelarutaerp`.
-- La base es multi-tenant y COMPARTIDA por muchos proyectos. Esta migración NO
-- debe tocar otros schemas/empresas.
--
-- Scope funcional:
--   Guardar qué logo de la galería (empresa_sifen_config.kude_logos) se eligió
--   para ESTA factura, de modo que el KuDE emitido y sus reimpresiones usen
--   siempre el mismo logo. NULL = usar el predeterminado de la empresa.
--
--   SOLO afecta la representación gráfica KuDE/PDF. NO toca XML rDE, firma,
--   envío SET, CDC, datos fiscales, certificado, cancelación, consulta lote ni
--   notas de crédito. El logo jamás cambia el RUC/razón social.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE amigosdelarutaerp.factura_electronica
  ADD COLUMN IF NOT EXISTS kude_logo_id text;

COMMENT ON COLUMN amigosdelarutaerp.factura_electronica.kude_logo_id IS
  'Id del logo de empresa_sifen_config.kude_logos elegido para esta factura. NULL = predeterminado. Solo afecta KuDE/PDF; no toca XML/firma/SET.';
