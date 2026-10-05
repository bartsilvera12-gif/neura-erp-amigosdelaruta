-- =============================================================================
-- 03 · Catálogos que quizá falten (diagnóstico + copiador).
--
-- El 01 clona la estructura SIN datos, y el 02 pobla los dos catálogos que el
-- ERP necesita para arrancar (`modulos`, `dashboard_views`). Pero `neura` puede
-- tener otras tablas de referencia pobladas a mano o por migración: estados,
-- tipos de comprobante, etapas de CRM, categorías por defecto, plan de cuentas.
-- Esas tablas quedan vacías en la instancia nueva.
--
-- Esto es SOLO LECTURA. La parte 2 es un copiador que hay que descomentar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Candidatas a catálogo: tablas de `neura` con filas, SIN columna
--    `empresa_id` (o sea, no son datos de un cliente) y chicas.
--    Revisá la lista y decidí cuáles querés copiar.
-- -----------------------------------------------------------------------------
WITH tablas AS (
  SELECT c.oid, c.relname,
         EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = 'empresa_id'
              AND a.attnum > 0 AND NOT a.attisdropped
         ) AS tiene_empresa_id
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'neura' AND c.relkind = 'r'
), conteo AS (
  SELECT t.relname, t.tiene_empresa_id,
         (xpath('/row/c/text()',
            query_to_xml(format('SELECT count(*) AS c FROM neura.%I', t.relname),
                         false, true, '')))[1]::text::bigint AS filas_en_neura
    FROM tablas t
)
SELECT relname AS tabla, filas_en_neura,
       CASE WHEN tiene_empresa_id THEN 'datos de cliente -> NO copiar'
            ELSE 'posible catalogo -> revisar' END AS veredicto
  FROM conteo
 WHERE filas_en_neura > 0
   AND NOT tiene_empresa_id
   AND relname NOT IN ('modulos', 'dashboard_views')   -- ya los hizo el 02
 ORDER BY filas_en_neura, relname;

-- -----------------------------------------------------------------------------
-- 2) Copiador. Poné en `v_tablas` las tablas que decidiste copiar de la lista
--    de arriba, descomentá el bloque y corrélo.
--
--    Copia filas completas (`SELECT *`, misma estructura por el 01) y saltea las
--    que ya estén, comparando por la primary key. Tablas sin PK las informa y
--    las saltea, para no duplicar.
--
--    No copies acá tablas con `empresa_id`: eso sería arrastrar datos de otro
--    cliente a esta instancia.
-- -----------------------------------------------------------------------------
/*
BEGIN;

DO $COPY$
DECLARE
  v_src    text := 'neura';
  v_dst    text := 'amigosdelarutaerp';
  v_tablas text[] := ARRAY[
    -- 'crm_etapas',
    -- 'tipos_comprobante',
  ];
  t        text;
  v_pk     text;
  v_n      bigint;
BEGIN
  FOREACH t IN ARRAY v_tablas LOOP
    IF to_regclass(format('%I.%I', v_dst, t)) IS NULL THEN
      RAISE EXCEPTION 'La tabla %.% no existe. Corriste el 01?', v_dst, t;
    END IF;

    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
      INTO v_pk
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.conrelid = to_regclass(format('%I.%I', v_src, t)) AND c.contype = 'p';

    IF v_pk IS NULL THEN
      RAISE NOTICE 'SALTEADA %: no tiene primary key, no puedo evitar duplicados.', t;
      CONTINUE;
    END IF;

    EXECUTE format(
      'INSERT INTO %I.%I SELECT s.* FROM %I.%I s
        WHERE NOT EXISTS (SELECT 1 FROM %I.%I d WHERE (d.%s) = (s.%s))',
      v_dst, t, v_src, t, v_dst, t,
      replace(v_pk, ', ', ', d.'), replace(v_pk, ', ', ', s.'));

    EXECUTE format('SELECT count(*) FROM %I.%I', v_dst, t) INTO v_n;
    RAISE NOTICE 'COPIADA %: % filas ahora en %', t, v_n, v_dst;
  END LOOP;
END
$COPY$;

COMMIT;
*/
