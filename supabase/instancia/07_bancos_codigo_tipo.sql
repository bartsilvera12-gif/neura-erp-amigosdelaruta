-- =============================================================================
-- 07 · Bancos: código corto y tipo de entidad.
--
-- Alinea el catálogo de bancos con el de `neura-erp-glacial`, que lo llama
-- «entidades bancarias» y además del nombre guarda:
--
--   · `codigo` — abreviatura para que el cajero encuentre la entidad tipeando
--     tres letras («BASA») en vez de leer una lista larga.
--   · `tipo`   — caja, banco, tarjeta/POS, billetera u otro. El cobro no es
--     siempre contra un banco: también entra por POS o por billetera, y
--     mezclarlos en una lista plana obliga a adivinar.
--
-- Las dos columnas son opcionales: la pantalla funciona con o sin ellas (si
-- faltan, simplemente no muestra esas dos columnas), así que correr esto no es
-- urgente, pero sin esto no se puede cargar ni el código ni el tipo.
--
-- Escribe SOLO dentro de `amigosdelarutaerp`. Idempotente.
-- =============================================================================

BEGIN;

DO $BANCOS$
DECLARE
  v_dst text := 'amigosdelarutaerp';
  v_n   bigint;
BEGIN
  IF to_regnamespace(v_dst) IS NULL THEN
    RAISE EXCEPTION 'No existe el schema %.', v_dst;
  END IF;
  IF to_regclass(format('%I.bancos', v_dst)) IS NULL THEN
    RAISE EXCEPTION 'No existe %.bancos.', v_dst;
  END IF;

  EXECUTE format($ddl$ALTER TABLE %1$I.bancos
    ADD COLUMN IF NOT EXISTS codigo text,
    ADD COLUMN IF NOT EXISTS tipo   text NOT NULL DEFAULT 'banco'$ddl$, v_dst);

  -- El tipo se valida en la base y no sólo en la pantalla: los cobros agrupan
  -- por este campo, y un valor escrito distinto quedaría fuera de todo resumen.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bancos_tipo_chk'
       AND conrelid = format('%I.bancos', v_dst)::regclass
  ) THEN
    EXECUTE format($ddl$ALTER TABLE %1$I.bancos
      ADD CONSTRAINT bancos_tipo_chk
      CHECK (tipo IN ('caja','banco','tarjeta','billetera','otro'))$ddl$, v_dst);
  END IF;

  -- El código es opcional, pero si está no se puede repetir dentro de la
  -- empresa: su razón de ser es identificar una entidad sin ambigüedad.
  EXECUTE format($ddl$CREATE UNIQUE INDEX IF NOT EXISTS bancos_codigo_uk
    ON %1$I.bancos (empresa_id, upper(codigo))
    WHERE codigo IS NOT NULL AND btrim(codigo) <> ''$ddl$, v_dst);

  EXECUTE format('SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = %L AND table_name = ''bancos''
                     AND column_name IN (''codigo'',''tipo'')', v_dst)
    INTO v_n;
  RAISE NOTICE '[bancos] columnas nuevas: % de 2', v_n;
END
$BANCOS$;

COMMIT;

-- PostgREST cachea el esquema: sin esto las columnas nuevas no se ven.
SELECT pg_notify('pgrst', 'reload schema');
