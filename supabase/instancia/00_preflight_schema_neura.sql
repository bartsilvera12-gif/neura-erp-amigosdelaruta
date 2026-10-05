-- =============================================================================
-- 00 · PREFLIGHT (solo lectura) — correr ANTES del 01.
--
-- No crea, modifica ni borra nada. Responde dos cosas:
--   1) Qué hay dentro del schema `neura` (volumen por tipo de objeto).
--   2) Si hay algo que el clonador del paso 01 NO sabe replicar y por lo tanto
--      lo haría abortar: tablas particionadas, tablas foráneas, extensiones
--      instaladas dentro del schema.
--
-- Pegar en el SQL editor y revisar las dos salidas antes de seguir.
-- =============================================================================

-- 1) Inventario del schema origen
SELECT 'tablas'                AS objeto, count(*) AS cantidad FROM pg_class      c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'neura' AND c.relkind IN ('r','p')
UNION ALL SELECT 'vistas',             count(*) FROM pg_class      c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'neura' AND c.relkind = 'v'
UNION ALL SELECT 'vistas materializadas', count(*) FROM pg_class   c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'neura' AND c.relkind = 'm'
UNION ALL SELECT 'secuencias',         count(*) FROM pg_class      c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'neura' AND c.relkind = 'S'
UNION ALL SELECT 'indices',            count(*) FROM pg_class      c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'neura' AND c.relkind = 'i'
UNION ALL SELECT 'funciones/procs',    count(*) FROM pg_proc       p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'neura'
UNION ALL SELECT 'tipos enum',         count(*) FROM pg_type       t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'neura' AND t.typtype = 'e'
UNION ALL SELECT 'tipos compuestos',   count(*) FROM pg_type       t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'neura' AND t.typtype = 'c' AND t.typrelid NOT IN (SELECT oid FROM pg_class WHERE relkind <> 'c')
UNION ALL SELECT 'dominios',           count(*) FROM pg_type       t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'neura' AND t.typtype = 'd'
UNION ALL SELECT 'triggers',           count(*) FROM pg_trigger    g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'neura' AND NOT g.tgisinternal
UNION ALL SELECT 'politicas RLS',      count(*) FROM pg_policy     o JOIN pg_class c ON c.oid = o.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'neura'
UNION ALL SELECT 'FK dentro de neura', count(*) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_class f ON f.oid = k.confrelid WHERE n.nspname = 'neura' AND k.contype = 'f' AND f.relnamespace = n.oid
UNION ALL SELECT 'FK hacia OTRO schema', count(*) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_class f ON f.oid = k.confrelid WHERE n.nspname = 'neura' AND k.contype = 'f' AND f.relnamespace <> n.oid
ORDER BY 1;

-- 2) Bloqueantes: si esto devuelve filas, el paso 01 aborta a propósito.
SELECT 'tabla particionada' AS bloqueante, c.relname AS nombre
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'neura' AND c.relkind = 'p'
UNION ALL
SELECT 'tabla foránea', c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'neura' AND c.relkind = 'f'
UNION ALL
SELECT 'extensión instalada en el schema', e.extname
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
 WHERE n.nspname = 'neura'
ORDER BY 1, 2;

-- 3) Detalle de las FK que apuntan fuera de neura (el paso 01 las omite por
--    defecto para no crear dependencias sobre public ni otros schemas).
SELECT c.relname AS tabla_en_neura,
       k.conname  AS constraint_name,
       fn.nspname || '.' || f.relname AS apunta_a,
       pg_get_constraintdef(k.oid)    AS definicion
  FROM pg_constraint k
  JOIN pg_class      c  ON c.oid  = k.conrelid
  JOIN pg_namespace  n  ON n.oid  = c.relnamespace
  JOIN pg_class      f  ON f.oid  = k.confrelid
  JOIN pg_namespace  fn ON fn.oid = f.relnamespace
 WHERE n.nspname = 'neura' AND k.contype = 'f' AND f.relnamespace <> n.oid
 ORDER BY 1, 2;
