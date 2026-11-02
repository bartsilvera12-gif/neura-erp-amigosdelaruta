-- =============================================================================
-- SIFEN: tipo de transacción por factura (iTipTra) en factura_electronica
--
-- ÁMBITO: SOLO el schema de este proyecto (Amigos de Ruta): `amigosdelarutaerp`.
-- La base es multi-tenant y COMPARTIDA por muchos proyectos. Esta migración NO
-- debe tocar otros schemas/empresas.
--
-- Scope funcional:
--   Guardar qué tipo de transacción se eligió al facturar (gOpeCom.iTipTra):
--   1 = Venta de mercadería, 2 = Prestación de servicios, 3 = Mixto.
--   NULL = 1 (comportamiento actual). Se usa al generar el XML rDE.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CHECK con guard de duplicado.
-- =============================================================================

ALTER TABLE amigosdelarutaerp.factura_electronica
  ADD COLUMN IF NOT EXISTS sifen_tipo_transaccion smallint;

COMMENT ON COLUMN amigosdelarutaerp.factura_electronica.sifen_tipo_transaccion IS
  'Tipo de transacción SIFEN (iTipTra) elegido al facturar: 1 mercadería, 2 servicios, 3 mixto. NULL = 1.';

DO $$
BEGIN
  ALTER TABLE amigosdelarutaerp.factura_electronica
    ADD CONSTRAINT factura_electronica_sifen_tipo_transaccion_chk
    CHECK (sifen_tipo_transaccion IS NULL OR sifen_tipo_transaccion IN (1, 2, 3));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END;
$$;
