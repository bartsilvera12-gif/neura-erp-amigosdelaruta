-- =============================================================================
-- 01 · Clona la ESTRUCTURA del schema `neura` en `amigosdelarutaerp`.
--
-- Qué hace:
--   tipos (enum/dominio/compuesto) · secuencias · funciones y procedimientos ·
--   nombres originales de constraints e indices ·
--   tablas (columnas, defaults, NOT NULL, CHECK, PK, UNIQUE, índices, identity,
--   generated, comentarios, storage, reloptions) · FK internas · vistas ·
--   vistas materializadas (WITH NO DATA) · triggers · RLS y políticas ·
--   permisos (ACL) y default privileges.
--
-- Qué NO hace, a propósito:
--   · NO copia ni una fila de datos.
--   · NO toca `neura`, `public`, `auth`, `storage` ni ningún otro schema. Solo
--     los LEE del catálogo. Lo único que escribe es dentro de `amigosdelarutaerp`.
--   · NO toca `public`. Las 9 FK de `neura` que salen del schema apuntan todas
--     a `auth.users`, no a `public`, y se replican (ver `v_fk_cross_schema`).
--     Una FK instala un trigger de integridad sobre la tabla referenciada, así
--     que esas 9 sí escriben en `auth.users`, que es infraestructura compartida
--     de Supabase. Con el flag en false el schema no referencia nada afuera.
--   · NO expone el schema en PostgREST (eso lo hacés aparte, como dijiste).
--
-- Cómo reescribe los nombres: `regexp_replace(def, '\mneura\M', ...)`. `\m` y
-- `\M` son límites de palabra, así que toca `neura.tabla` y `search_path = neura`
-- pero NO `neura_algo`, `zentra_neura` ni `public.neura_fn`.
--
-- Orden de creacion (importa): tipos -> secuencias -> tablas -> nombres de
-- constraints e indices -> funciones y vistas (juntas, con reintentos) ->
-- defaults -> FK -> indices de matviews -> triggers -> RLS -> permisos ->
-- comentarios. Las funciones van despues de las
-- tablas porque una puede devolver `SETOF tabla`, y ese tipo de retorno se
-- resuelve al crearla.
--
-- Todo va en UNA transacción: si algo falla, no queda nada a medias.
-- Es re-ejecutable: cada objeto se saltea si ya existe en el destino.
--
-- Correr con un rol dueño/superusuario (el SQL editor de Supabase ya lo es).
-- =============================================================================

BEGIN;

-- Las funciones en lenguaje SQL se validan al crearse y algunas referencian
-- tablas que todavía no existen en el destino. Solo para esta transacción.
SET LOCAL check_function_bodies = off;

-- pg_trgm y otras extensiones instalan sus clases de operadores en su propio
-- schema. El paso 6 recrea indices a partir de su texto SQL, y ahi un
-- `gin_trgm_ops` sin calificar tiene que resolverse por search_path o falla con
-- "operator class does not exist". Todo el DDL de este script califica schema
-- explicitamente, asi que ampliar el search_path no cambia nada mas.
SET LOCAL search_path = public, extensions, pg_catalog;

DO $CLONE$
DECLARE
  v_src  text := 'neura';
  v_dst  text := 'amigosdelarutaerp';

  -- FK que apuntan fuera del schema. En `neura` son 9 y TODAS van a
  -- `auth.users(id) ON DELETE SET NULL` (verificado contra las migraciones:
  -- usuarios.auth_user_id, pagos.usuario_id, clientes.created_by_user_id,
  -- clientes.deleted_by_user_id, clientes.baja_operativa_by_user_id,
  -- marketing_tasks.responsable_user_id, nota_credito.created_by_user_id,
  -- nota_credito_evento.actor_user_id, cliente_historial.creado_por_auth_user_id).
  -- Ninguna va a `public`.
  --
  -- Se crean, igual que en `neura`: `auth.users` es infraestructura compartida
  -- de Supabase y ya tiene FK de todas las instancias. Sin ellas el
  -- ON DELETE SET NULL no dispara y borrar un usuario en Authentication deja
  -- UUIDs huerfanos en esas 9 columnas.
  --
  -- Poner en false si el objetivo es que el schema no referencie NADA afuera.
  -- Antes de hacerlo, mira la salida 3 del script 00.
  v_fk_cross_schema boolean := true;

  v_src_oid oid;
  v_dst_oid oid;
  r         record;
  v_sql     text;
  v_def     text;
  v_n       int;
  v_cols    text;
  v_pend    int;
  v_prev    int;
  v_pasada  int;
  v_nf      int;
  v_nv      int;
  v_err     text;
BEGIN
  SELECT oid INTO v_src_oid FROM pg_namespace WHERE nspname = v_src;
  IF v_src_oid IS NULL THEN
    RAISE EXCEPTION 'No existe el schema origen "%"', v_src;
  END IF;

  -- -------------------------------------------------------------------------
  -- Guardas: objetos que este clonador no sabe replicar bien.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_n
    FROM pg_class WHERE relnamespace = v_src_oid AND relkind IN ('p', 'f');
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'El schema % tiene % tabla(s) particionada(s)/foranea(s). Corre el script 00 para verlas: hay que replicarlas a mano.',
      v_src, v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_proc WHERE pronamespace = v_src_oid AND prokind NOT IN ('f', 'p');
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'El schema % tiene % agregado(s) o funcion(es) ventana. pg_get_functiondef no los sabe emitir: hay que replicarlos a mano con CREATE AGGREGATE.',
      v_src, v_n;
  END IF;

  SELECT count(*) INTO v_n FROM pg_extension WHERE extnamespace = v_src_oid;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'El schema % tiene % extension(es) instalada(s) dentro. Hay que decidir a mano si se comparten o se duplican.',
      v_src, v_n;
  END IF;

  -- -------------------------------------------------------------------------
  -- 1) Schema destino
  -- -------------------------------------------------------------------------
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v_dst);
  SELECT oid INTO v_dst_oid FROM pg_namespace WHERE nspname = v_dst;
  RAISE NOTICE '[1] schema %: listo', v_dst;

  -- -------------------------------------------------------------------------
  -- 2) Tipos: enum, dominio, compuesto. Con reintentos, porque un compuesto
  --    puede usar un enum que todavia no se creo.
  -- -------------------------------------------------------------------------
  v_pend := -1;
  LOOP
    v_prev := v_pend;
    v_pend := 0;
    FOR r IN
      SELECT t.oid, t.typname, t.typtype
        FROM pg_type t
        LEFT JOIN pg_class c ON c.oid = t.typrelid
       WHERE t.typnamespace = v_src_oid
         AND t.typtype IN ('e', 'd', 'c')
         -- los compuestos "implicitos" de cada tabla/vista no son tipos propios
         AND (t.typtype <> 'c' OR c.relkind = 'c')
         AND NOT EXISTS (
               SELECT 1 FROM pg_type d
                WHERE d.typnamespace = v_dst_oid AND d.typname = t.typname)
       ORDER BY t.typname
    LOOP
      BEGIN
        IF r.typtype = 'e' THEN
          SELECT string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)
            INTO v_cols FROM pg_enum e WHERE e.enumtypid = r.oid;
          EXECUTE format('CREATE TYPE %I.%I AS ENUM (%s)', v_dst, r.typname, coalesce(v_cols, ''));

        ELSIF r.typtype = 'c' THEN
          SELECT string_agg(
                   format('%I %s', a.attname,
                          regexp_replace(format_type(a.atttypid, a.atttypmod),
                                         '\m' || v_src || '\M', v_dst, 'g')),
                   ', ' ORDER BY a.attnum)
            INTO v_cols
            FROM pg_attribute a
           WHERE a.attrelid = (SELECT typrelid FROM pg_type WHERE oid = r.oid)
             AND a.attnum > 0 AND NOT a.attisdropped;
          EXECUTE format('CREATE TYPE %I.%I AS (%s)', v_dst, r.typname, coalesce(v_cols, ''));

        ELSE -- dominio
          SELECT format('CREATE DOMAIN %I.%I AS %s%s%s%s',
                   v_dst, t.typname,
                   regexp_replace(format_type(t.typbasetype, t.typtypmod),
                                  '\m' || v_src || '\M', v_dst, 'g'),
                   CASE WHEN t.typnotnull THEN ' NOT NULL' ELSE '' END,
                   CASE WHEN t.typdefault IS NOT NULL
                        THEN ' DEFAULT ' || quote_literal(t.typdefault) ELSE '' END,
                   coalesce((SELECT string_agg(' CONSTRAINT ' || quote_ident(k.conname) || ' ' ||
                                               regexp_replace(pg_get_constraintdef(k.oid),
                                                              '\m' || v_src || '\M', v_dst, 'g'), '')
                               FROM pg_constraint k WHERE k.contypid = t.oid), ''))
            INTO v_sql FROM pg_type t WHERE t.oid = r.oid;
          EXECUTE v_sql;
        END IF;
        RAISE NOTICE '[2] tipo %.%: creado', v_dst, r.typname;
      EXCEPTION WHEN others THEN
        v_pend := v_pend + 1;
        v_err  := SQLERRM;
      END;
    END LOOP;
    EXIT WHEN v_pend = 0;
    IF v_pend = v_prev THEN
      RAISE EXCEPTION '[2] no se pudieron crear % tipo(s). Ultimo error: %', v_pend, v_err;
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 3) Secuencias. Se saltean las de columnas IDENTITY: esas las crea solo
  --    Postgres al crear la tabla (paso 5) y duplicarlas aca chocaria de nombre.
  --    Arrancan en su valor inicial: el destino no tiene datos.
  -- -------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, s.seqtypid, s.seqstart, s.seqincrement,
           s.seqmax, s.seqmin, s.seqcache, s.seqcycle
      FROM pg_class    c
      JOIN pg_sequence s ON s.seqrelid = c.oid
     WHERE c.relnamespace = v_src_oid
       AND NOT EXISTS (                       -- no es secuencia de IDENTITY
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                AND d.deptype = 'i')
       AND NOT EXISTS (
             SELECT 1 FROM pg_class x
              WHERE x.relnamespace = v_dst_oid AND x.relname = c.relname AND x.relkind = 'S')
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'CREATE SEQUENCE %I.%I AS %s INCREMENT BY %s MINVALUE %s MAXVALUE %s START WITH %s CACHE %s %s',
      v_dst, r.relname, format_type(r.seqtypid, NULL),
      r.seqincrement, r.seqmin, r.seqmax, r.seqstart, r.seqcache,
      CASE WHEN r.seqcycle THEN 'CYCLE' ELSE 'NO CYCLE' END);
    RAISE NOTICE '[3] secuencia %.%: creada', v_dst, r.relname;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 4) Tablas. `INCLUDING ALL` trae columnas, defaults, NOT NULL, CHECK, PK,
  --    UNIQUE, indices, IDENTITY, GENERATED, comentarios, storage y estadisticas.
  --    No trae FK, triggers ni RLS: eso va en los pasos 7, 9 y 10.
  --    Van ANTES de las funciones: una funcion puede devolver `SETOF tabla`.
  -- -------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, c.relpersistence, c.reloptions
      FROM pg_class c
     WHERE c.relnamespace = v_src_oid AND c.relkind = 'r'
       AND NOT EXISTS (
             SELECT 1 FROM pg_class x
              WHERE x.relnamespace = v_dst_oid AND x.relname = c.relname
                AND x.relkind IN ('r', 'p'))
     ORDER BY c.relname
  LOOP
    EXECUTE format('CREATE %s TABLE %I.%I (LIKE %I.%I INCLUDING ALL)',
                   CASE WHEN r.relpersistence = 'u' THEN 'UNLOGGED' ELSE '' END,
                   v_dst, r.relname, v_src, r.relname);
    IF r.reloptions IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I.%I SET (%s)', v_dst, r.relname,
                     array_to_string(r.reloptions, ', '));
    END IF;
    RAISE NOTICE '[4] tabla %.%: creada', v_dst, r.relname;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 4b) Nombres de constraints e indices que `LIKE` regenero.
  --
  --     `INCLUDING ALL` recrea los PK/UNIQUE y los indices, pero les pone el
  --     nombre POR DEFECTO de Postgres en lugar del original: un
  --     `asientos_numero_uk` del origen aparece como
  --     `asientos_contables_empresa_id_numero_asiento_key` en el destino.
  --     Funcionalmente es lo mismo, pero no es un clon exacto y rompe cosas:
  --       · el codigo matchea nombres de constraint en los mensajes de error
  --         (ver `esErrorNumeroDuplicado` en src/lib/proyectos/qa-shared.ts y
  --         `uq_nota_credito_factura_estado_activo` en create-nota-credito.ts);
  --       · una migracion futura con `DROP CONSTRAINT <nombre>` fallaria solo
  --         en esta instancia.
  --
  --     El emparejamiento es por DEFINICION, no por nombre: para constraints
  --     (tabla, tipo, definicion) y para indices (unique, y el texto del
  --     CREATE INDEX desde ' ON ' -- o sea tabla, columnas/expresion y WHERE --,
  --     que es justo todo menos el nombre).
  --
  --     Va en lazo con reintentos porque el nombre por defecto que Postgres le
  --     puso a un objeto puede ser el nombre original de OTRO: ahi el primer
  --     rename choca y sale bien en la pasada siguiente, cuando el que ocupaba
  --     el nombre ya se movio.
  -- -------------------------------------------------------------------------
  v_pend := -1;
  v_pasada := 0;
  LOOP
    v_prev   := v_pend;
    v_pend   := 0;
    v_pasada := v_pasada + 1;
    v_nf     := 0;

    -- 4b.1) Constraints (PK, UNIQUE, CHECK, EXCLUDE).
    FOR r IN
      WITH s AS (
        SELECT c.relname AS tabla, k.conname, k.contype,
               regexp_replace(pg_get_constraintdef(k.oid), '\m' || v_src || '\M', v_dst, 'g') AS def,
               row_number() OVER (
                 PARTITION BY c.relname, k.contype,
                              regexp_replace(pg_get_constraintdef(k.oid), '\m' || v_src || '\M', v_dst, 'g')
                 ORDER BY k.conname) AS rn
          FROM pg_constraint k
          JOIN pg_class c ON c.oid = k.conrelid
         WHERE c.relnamespace = v_src_oid AND k.contype IN ('p', 'u', 'c', 'x')
      ), d AS (
        SELECT c.relname AS tabla, k.conname, k.contype,
               pg_get_constraintdef(k.oid) AS def,
               row_number() OVER (
                 PARTITION BY c.relname, k.contype, pg_get_constraintdef(k.oid)
                 ORDER BY k.conname) AS rn
          FROM pg_constraint k
          JOIN pg_class c ON c.oid = k.conrelid
         WHERE c.relnamespace = v_dst_oid AND k.contype IN ('p', 'u', 'c', 'x')
      )
      SELECT d.tabla, d.conname AS actual, s.conname AS original
        FROM d
        JOIN s ON s.tabla = d.tabla AND s.contype = d.contype
              AND s.def = d.def AND s.rn = d.rn
       WHERE d.conname <> s.conname
       ORDER BY d.tabla, d.conname
    LOOP
      BEGIN
        EXECUTE format('ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
                       v_dst, r.tabla, r.actual, r.original);
        v_nf := v_nf + 1;
      EXCEPTION WHEN others THEN
        v_pend := v_pend + 1;
        v_err  := format('constraint %s.%s: %s -> %s: %s',
                         v_dst, r.tabla, r.actual, r.original, SQLERRM);
      END;
    END LOOP;

    -- 4b.2) Indices que NO respaldan un constraint (esos ya se renombraron
    --       solos en 4b.1, porque RENAME CONSTRAINT renombra su indice).
    FOR r IN
      WITH s AS (
        SELECT i.relname AS idx, x.indisunique,
               regexp_replace(substring(pg_get_indexdef(i.oid) from position(' ON ' in pg_get_indexdef(i.oid))), '\m' || v_src || '\M', v_dst, 'g') AS firma,
               row_number() OVER (PARTITION BY x.indisunique, regexp_replace(substring(pg_get_indexdef(i.oid) from position(' ON ' in pg_get_indexdef(i.oid))), '\m' || v_src || '\M', v_dst, 'g')
                                  ORDER BY i.relname) AS rn
          FROM pg_index x
          JOIN pg_class i ON i.oid = x.indexrelid
          JOIN pg_class m ON m.oid = x.indrelid
         WHERE m.relnamespace = v_src_oid
           AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.oid)
      ), d AS (
        SELECT i.relname AS idx, x.indisunique,
               substring(pg_get_indexdef(i.oid) from position(' ON ' in pg_get_indexdef(i.oid))) AS firma,
               row_number() OVER (PARTITION BY x.indisunique, substring(pg_get_indexdef(i.oid) from position(' ON ' in pg_get_indexdef(i.oid)))
                                  ORDER BY i.relname) AS rn
          FROM pg_index x
          JOIN pg_class i ON i.oid = x.indexrelid
          JOIN pg_class m ON m.oid = x.indrelid
         WHERE m.relnamespace = v_dst_oid
           AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.oid)
      )
      SELECT d.idx AS actual, s.idx AS original
        FROM d
        JOIN s ON s.indisunique = d.indisunique AND s.firma = d.firma AND s.rn = d.rn
       WHERE d.idx <> s.idx
       ORDER BY d.idx
    LOOP
      BEGIN
        EXECUTE format('ALTER INDEX %I.%I RENAME TO %I', v_dst, r.actual, r.original);
        v_nf := v_nf + 1;
      EXCEPTION WHEN others THEN
        v_pend := v_pend + 1;
        v_err  := format('indice %s.%s -> %s: %s', v_dst, r.actual, r.original, SQLERRM);
      END;
    END LOOP;

    RAISE NOTICE '[4b] pasada %: % renombrado(s), % pendiente(s)',
                 v_pasada, v_nf, v_pend;

    EXIT WHEN v_pend = 0;
    IF v_pend = v_prev THEN
      RAISE EXCEPTION
        '[4b] quedaron % rename(s) sin aplicar y la ultima pasada no avanzo. Ultimo error: %',
        v_pend, v_err;
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 5) Funciones, procedimientos y vistas, en UN solo lazo con reintentos.
  --
  --    Van todos juntos y DESPUES de las tablas porque las dependencias cruzan
  --    en los dos sentidos: una funcion puede devolver `SETOF tabla` o
  --    `SETOF vista`, y el tipo de retorno se resuelve al CREAR la funcion,
  --    que es justo lo que `check_function_bodies = off` NO cubre. A la vez,
  --    una vista puede llamar a una funcion. El lazo repite hasta que una
  --    pasada completa no logra crear nada nuevo.
  --
  --    Las funciones se reintentan todas en cada pasada: pg_get_functiondef
  --    emite CREATE OR REPLACE, asi que volver a crear una que ya esta es
  --    inofensivo y ahorra comparar firmas entre schemas distintos.
  -- -------------------------------------------------------------------------
  v_pend := -1;
  v_pasada := 0;
  LOOP
    v_prev   := v_pend;
    v_pend   := 0;
    v_pasada := v_pasada + 1;
    v_nf     := 0;
    v_nv     := 0;

    -- 5a) funciones y procedimientos
    FOR r IN
      SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
       WHERE p.pronamespace = v_src_oid
         AND p.prokind IN ('f', 'p')
         AND NOT EXISTS (                     -- no viene de una extension
               SELECT 1 FROM pg_depend d
                WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                  AND d.deptype = 'e')
       ORDER BY p.proname
    LOOP
      BEGIN
        EXECUTE regexp_replace(pg_get_functiondef(r.oid), '\m' || v_src || '\M', v_dst, 'g');
        v_nf := v_nf + 1;
      EXCEPTION WHEN others THEN
        v_pend := v_pend + 1;
        v_err  := format('funcion %s.%s(%s): %s', v_dst, r.proname, r.args, SQLERRM);
      END;
    END LOOP;

    -- 5b) vistas y vistas materializadas (estas si se saltean si ya existen)
    FOR r IN
      SELECT c.oid, c.relname, c.relkind
        FROM pg_class c
       WHERE c.relnamespace = v_src_oid AND c.relkind IN ('v', 'm')
         AND NOT EXISTS (
               SELECT 1 FROM pg_class x
                WHERE x.relnamespace = v_dst_oid AND x.relname = c.relname
                  AND x.relkind IN ('v', 'm'))
       ORDER BY c.relname
    LOOP
      BEGIN
        v_def := regexp_replace(pg_get_viewdef(r.oid, true), '\m' || v_src || '\M', v_dst, 'g');
        IF r.relkind = 'v' THEN
          EXECUTE format('CREATE VIEW %I.%I AS %s', v_dst, r.relname, v_def);
        ELSE
          -- WITH NO DATA: la instancia nueva arranca sin datos.
          EXECUTE format('CREATE MATERIALIZED VIEW %I.%I AS %s WITH NO DATA',
                         v_dst, r.relname, v_def);
        END IF;
        v_nv := v_nv + 1;
      EXCEPTION WHEN others THEN
        v_pend := v_pend + 1;
        v_err  := format('vista %s.%s: %s', v_dst, r.relname, SQLERRM);
      END;
    END LOOP;

    RAISE NOTICE '[5] pasada %: % funcion(es), % vista(s), % pendiente(s)',
                 v_pasada, v_nf, v_nv, v_pend;

    EXIT WHEN v_pend = 0;
    IF v_pend = v_prev THEN
      RAISE EXCEPTION
        '[5] quedaron % objeto(s) sin crear y la ultima pasada no avanzo. Ultimo error: %',
        v_pend, v_err;
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 6) Reescribir TODO lo que `LIKE` copio literal apuntando al schema origen.
  --
  --    `LIKE ... INCLUDING ALL` no traduce nombres: copia el texto tal cual. Eso
  --    deja cuatro clases de fuga hacia el origen, y hay que tratarlas todas o
  --    el schema nuevo queda dependiendo de `neura`:
  --      6a. defaults de columna  -> p. ej. `nextval('neura.t_id_seq')` en un serial
  --      6b. expresiones de indice -> p. ej. `gin (neura.sin_tildes(name))`
  --      6c. CHECK                 -> p. ej. `CHECK (neura.validar(x))`
  --      6d. columnas generadas    -> no se pueden reescribir en el lugar
  --    La auditoria del final del script vuelve a verificar que no quedo nada.
  -- -------------------------------------------------------------------------
  -- 6a) Defaults de columna.
  FOR r IN
    SELECT c.relname, a.attname, pg_get_expr(ad.adbin, ad.adrelid) AS def
      FROM pg_class     c
      JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_attrdef   ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
     WHERE c.relnamespace = v_dst_oid AND c.relkind = 'r'
       AND pg_get_expr(ad.adbin, ad.adrelid) ~ ('\m' || v_src || '\M')
     ORDER BY c.relname, a.attnum
  LOOP
    v_def := regexp_replace(r.def, '\m' || v_src || '\M', v_dst, 'g');
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %s',
                   v_dst, r.relname, r.attname, v_def);
    RAISE NOTICE '[6a] default %.%.%: -> %', v_dst, r.relname, r.attname, v_def;
  END LOOP;

  -- 6b) Expresiones de indice. Se recrea el indice con el nombre reescrito.
  --     Los indices que respaldan un constraint (PK/UNIQUE) no se pueden dropear
  --     directo, asi que si aparece uno se corta y se avisa en vez de dejarlo.
  FOR r IN
    SELECT m.relname AS tabla, i.relname AS idxname,
           pg_get_indexdef(i.oid) AS def,
           EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.oid) AS de_constraint
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class m ON m.oid = x.indrelid
     WHERE m.relnamespace = v_dst_oid
       AND pg_get_indexdef(i.oid) ~ ('\m' || v_src || '\M')
     ORDER BY m.relname, i.relname
  LOOP
    IF r.de_constraint THEN
      RAISE EXCEPTION
        '[6b] el indice %.% respalda un constraint y su expresion llama a %. Hay que resolverlo a mano (ALTER TABLE ... DROP CONSTRAINT).',
        v_dst, r.idxname, v_src;
    END IF;
    v_def := regexp_replace(r.def, '\m' || v_src || '\M', v_dst, 'g');
    EXECUTE format('DROP INDEX %I.%I', v_dst, r.idxname);
    EXECUTE v_def;
    RAISE NOTICE '[6b] indice %.%: reescrito', v_dst, r.idxname;
  END LOOP;

  -- 6c) CHECK constraints.
  FOR r IN
    SELECT c.relname, k.conname, pg_get_constraintdef(k.oid) AS def
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
     WHERE c.relnamespace = v_dst_oid AND k.contype = 'c'
       AND pg_get_constraintdef(k.oid) ~ ('\m' || v_src || '\M')
     ORDER BY c.relname, k.conname
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', v_dst, r.relname, r.conname);
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
                   v_dst, r.relname, r.conname,
                   regexp_replace(r.def, '\m' || v_src || '\M', v_dst, 'g'));
    RAISE NOTICE '[6c] check %.% %: reescrito', v_dst, r.relname, r.conname;
  END LOOP;

  -- 6d) Columnas generadas: no hay forma limpia de reescribir la expresion sin
  --     recrear la columna, asi que se corta y se avisa cual es.
  FOR r IN
    SELECT c.relname, a.attname, pg_get_expr(ad.adbin, ad.adrelid) AS def
      FROM pg_attribute a
      JOIN pg_class     c  ON c.oid = a.attrelid
      JOIN pg_attrdef   ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
     WHERE c.relnamespace = v_dst_oid AND a.attgenerated <> ''
       AND pg_get_expr(ad.adbin, ad.adrelid) ~ ('\m' || v_src || '\M')
  LOOP
    RAISE EXCEPTION
      '[6d] la columna generada %.%.% llama a %: %. Hay que reescribirla a mano.',
      v_dst, r.relname, r.attname, v_src, r.def;
  END LOOP;

  -- OWNED BY: ata cada secuencia `serial` del destino a su columna del destino,
  -- para que se borre junto con la tabla (como en el origen).
  FOR r IN
    SELECT s.relname AS seqname, t.relname AS tabname, a.attname
      FROM pg_class     s
      JOIN pg_depend    d ON d.classid = 'pg_class'::regclass AND d.objid = s.oid
                         AND d.deptype = 'a' AND d.refclassid = 'pg_class'::regclass
      JOIN pg_class     t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
     WHERE s.relnamespace = v_src_oid AND s.relkind = 'S'
       AND EXISTS (SELECT 1 FROM pg_class x
                    WHERE x.relnamespace = v_dst_oid AND x.relname = s.relname AND x.relkind = 'S')
       AND EXISTS (SELECT 1 FROM pg_class x
                    WHERE x.relnamespace = v_dst_oid AND x.relname = t.relname AND x.relkind = 'r')
  LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNED BY %I.%I.%I',
                   v_dst, r.seqname, v_dst, r.tabname, r.attname);
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 7) Foreign keys. Las internas se reescriben al schema destino; las que
  --    salen afuera (las 9 a `auth.users`) se copian tal cual si
  --    `v_fk_cross_schema` esta en true.
  -- -------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, k.conname, pg_get_constraintdef(k.oid) AS def,
           (f.relnamespace = v_src_oid) AS interna
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_class f ON f.oid = k.confrelid
     WHERE c.relnamespace = v_src_oid AND k.contype = 'f'
       AND EXISTS (SELECT 1 FROM pg_class x
                    WHERE x.relnamespace = v_dst_oid AND x.relname = c.relname AND x.relkind = 'r')
       AND NOT EXISTS (
             SELECT 1 FROM pg_constraint x
               JOIN pg_class xc ON xc.oid = x.conrelid
              WHERE xc.relnamespace = v_dst_oid AND xc.relname = c.relname
                AND x.conname = k.conname)
     ORDER BY c.relname, k.conname
  LOOP
    IF NOT r.interna AND NOT v_fk_cross_schema THEN
      RAISE NOTICE '[7] OMITIDA (cross-schema) %.% %: %', v_dst, r.relname, r.conname, r.def;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
                   v_dst, r.relname, r.conname,
                   CASE WHEN r.interna
                        THEN regexp_replace(r.def, '\m' || v_src || '\M', v_dst, 'g')
                        ELSE r.def END);
    RAISE NOTICE '[7] FK %.% %: creada', v_dst, r.relname, r.conname;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 8) Indices de las vistas materializadas. Las vistas en si se crearon en
  --    el paso 5; los indices de tablas ya vinieron con LIKE INCLUDING ALL.
  -- -------------------------------------------------------------------------
  FOR r IN
    SELECT i.relname AS idxname, pg_get_indexdef(i.oid) AS def
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class m ON m.oid = x.indrelid
     WHERE m.relnamespace = v_src_oid AND m.relkind = 'm'
       AND NOT EXISTS (SELECT 1 FROM pg_class y
                        WHERE y.relnamespace = v_dst_oid AND y.relname = i.relname)
  LOOP
    EXECUTE regexp_replace(r.def, '\m' || v_src || '\M', v_dst, 'g');
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 9) Triggers. Las funciones de trigger que viven en otro schema (p. ej.
  --    `public.set_updated_at`) se dejan apuntando ahi: se las referencia, no
  --    se las modifica.
  -- -------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, g.tgname, pg_get_triggerdef(g.oid) AS def
      FROM pg_trigger g
      JOIN pg_class   c ON c.oid = g.tgrelid
     WHERE c.relnamespace = v_src_oid AND NOT g.tgisinternal
       AND EXISTS (SELECT 1 FROM pg_class x
                    WHERE x.relnamespace = v_dst_oid AND x.relname = c.relname)
       AND NOT EXISTS (
             SELECT 1 FROM pg_trigger y
               JOIN pg_class yc ON yc.oid = y.tgrelid
              WHERE yc.relnamespace = v_dst_oid AND yc.relname = c.relname
                AND y.tgname = g.tgname)
     ORDER BY c.relname, g.tgname
  LOOP
    EXECUTE regexp_replace(r.def, '\m' || v_src || '\M', v_dst, 'g');
    RAISE NOTICE '[9] trigger %.% %: creado', v_dst, r.relname, r.tgname;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 10) RLS y politicas.
  -- -------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, c.relforcerowsecurity
      FROM pg_class c
     WHERE c.relnamespace = v_src_oid AND c.relkind = 'r' AND c.relrowsecurity
       AND EXISTS (SELECT 1 FROM pg_class x
                    WHERE x.relnamespace = v_dst_oid AND x.relname = c.relname)
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_dst, r.relname);
    IF r.relforcerowsecurity THEN
      EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', v_dst, r.relname);
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.relname, p.polname, p.polpermissive, p.polcmd,
           pg_get_expr(p.polqual,      p.polrelid) AS usng,
           pg_get_expr(p.polwithcheck, p.polrelid) AS chk,
           CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC'
                ELSE (SELECT string_agg(quote_ident(a.rolname), ', ' ORDER BY a.rolname)
                        FROM pg_authid a WHERE a.oid = ANY (p.polroles)) END AS roles
      FROM pg_policy p
      JOIN pg_class  c ON c.oid = p.polrelid
     WHERE c.relnamespace = v_src_oid
       AND EXISTS (SELECT 1 FROM pg_class x
                    WHERE x.relnamespace = v_dst_oid AND x.relname = c.relname)
       AND NOT EXISTS (
             SELECT 1 FROM pg_policy y
               JOIN pg_class yc ON yc.oid = y.polrelid
              WHERE yc.relnamespace = v_dst_oid AND yc.relname = c.relname
                AND y.polname = p.polname)
     ORDER BY c.relname, p.polname
  LOOP
    v_sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
               r.polname, v_dst, r.relname,
               CASE WHEN r.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
               CASE r.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                             WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                             ELSE 'ALL' END,
               coalesce(r.roles, 'PUBLIC'));
    IF r.usng IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)',
                 regexp_replace(r.usng, '\m' || v_src || '\M', v_dst, 'g'));
    END IF;
    IF r.chk IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)',
                 regexp_replace(r.chk, '\m' || v_src || '\M', v_dst, 'g'));
    END IF;
    EXECUTE v_sql;
    RAISE NOTICE '[10] policy %.% %: creada', v_dst, r.relname, r.polname;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 11) Permisos: mismos grants que tiene el origen (schema, relaciones,
  --     funciones) + default privileges. Sin esto PostgREST no ve nada.
  -- -------------------------------------------------------------------------
  FOR r IN
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(g.rolname) END AS grantee,
           a.privilege_type
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(n.nspacl) a
      LEFT JOIN pg_authid g ON g.oid = a.grantee
     WHERE n.oid = v_src_oid
  LOOP
    EXECUTE format('GRANT %s ON SCHEMA %I TO %s', r.privilege_type, v_dst, r.grantee);
  END LOOP;

  FOR r IN
    SELECT c.relname, c.relkind,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(g.rolname) END AS grantee,
           a.privilege_type
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(c.relacl) a
      LEFT JOIN pg_authid g ON g.oid = a.grantee
     WHERE c.relnamespace = v_src_oid AND c.relkind IN ('r', 'v', 'm', 'S')
       AND EXISTS (SELECT 1 FROM pg_class x
                    WHERE x.relnamespace = v_dst_oid AND x.relname = c.relname)
  LOOP
    EXECUTE format('GRANT %s ON %s %I.%I TO %s',
                   r.privilege_type,
                   CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
                   v_dst, r.relname, r.grantee);
  END LOOP;

  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS kind,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(g.rolname) END AS grantee,
           a.privilege_type
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(p.proacl) a
      LEFT JOIN pg_authid g ON g.oid = a.grantee
     WHERE p.pronamespace = v_src_oid
  LOOP
    BEGIN
      EXECUTE format('GRANT %s ON %s %I.%I(%s) TO %s',
                     r.privilege_type, r.kind, v_dst, r.proname, r.args, r.grantee);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE '[11] grant salteado: %.%(%) no existe en destino', v_dst, r.proname, r.args;
    END;
  END LOOP;

  FOR r IN
    SELECT d.defaclobjtype AS objtype,
           pg_get_userbyid(d.defaclrole) AS owner,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(g.rolname) END AS grantee,
           a.privilege_type
      FROM pg_default_acl d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      LEFT JOIN pg_authid g ON g.oid = a.grantee
     WHERE d.defaclnamespace = v_src_oid
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT %s ON %s TO %s',
                   r.owner, v_dst, r.privilege_type,
                   CASE r.objtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
                                  WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES'
                                  ELSE 'TABLES' END,
                   r.grantee);
  END LOOP;
  RAISE NOTICE '[11] permisos: listo';

  -- -------------------------------------------------------------------------
  -- 12) Comentarios de objetos que `LIKE` no cubre (funciones, vistas, tipos,
  --     secuencias) y del schema.
  -- -------------------------------------------------------------------------
  v_def := obj_description(v_src_oid, 'pg_namespace');
  IF v_def IS NOT NULL THEN
    EXECUTE format('COMMENT ON SCHEMA %I IS %L', v_dst, v_def);
  END IF;

  FOR r IN
    SELECT c.relname, c.relkind, obj_description(c.oid, 'pg_class') AS cmt
      FROM pg_class c
     WHERE c.relnamespace = v_src_oid AND c.relkind IN ('v', 'm', 'S')
       AND obj_description(c.oid, 'pg_class') IS NOT NULL
       AND EXISTS (SELECT 1 FROM pg_class x
                    WHERE x.relnamespace = v_dst_oid AND x.relname = c.relname)
  LOOP
    EXECUTE format('COMMENT ON %s %I.%I IS %L',
                   CASE r.relkind WHEN 'v' THEN 'VIEW'
                                  WHEN 'm' THEN 'MATERIALIZED VIEW'
                                  ELSE 'SEQUENCE' END,
                   v_dst, r.relname, r.cmt);
  END LOOP;

  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS kind,
           obj_description(p.oid, 'pg_proc') AS cmt
      FROM pg_proc p
     WHERE p.pronamespace = v_src_oid AND obj_description(p.oid, 'pg_proc') IS NOT NULL
  LOOP
    BEGIN
      EXECUTE format('COMMENT ON %s %I.%I(%s) IS %L', r.kind, v_dst, r.proname, r.args, r.cmt);
    EXCEPTION WHEN undefined_function THEN NULL;
    END;
  END LOOP;

  FOR r IN
    SELECT t.typname, obj_description(t.oid, 'pg_type') AS cmt
      FROM pg_type t
     WHERE t.typnamespace = v_src_oid AND t.typtype IN ('e', 'd', 'c')
       AND obj_description(t.oid, 'pg_type') IS NOT NULL
       AND EXISTS (SELECT 1 FROM pg_type x
                    WHERE x.typnamespace = v_dst_oid AND x.typname = t.typname)
  LOOP
    EXECUTE format('COMMENT ON TYPE %I.%I IS %L', v_dst, r.typname, r.cmt);
  END LOOP;
  RAISE NOTICE '[12] comentarios: listo';

  RAISE NOTICE 'Clon de % -> % terminado. Revisa el resumen de abajo.', v_src, v_dst;
END
$CLONE$;

COMMIT;

-- =============================================================================
-- Resumen: origen vs destino. Con `v_fk_cross_schema` en true tienen que dar
-- IGUAL en todo. Si `constraints` difiere, mira el diff de nombres de mas abajo
-- para ver exactamente cual falta.
-- =============================================================================
WITH conteo AS (
  SELECT n.nspname AS schema, 'tablas' AS objeto, count(*) AS cantidad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('neura', 'amigosdelarutaerp') AND c.relkind = 'r' GROUP BY 1
  UNION ALL
  SELECT n.nspname, 'columnas', count(*)
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('neura', 'amigosdelarutaerp') AND c.relkind = 'r'
     AND a.attnum > 0 AND NOT a.attisdropped GROUP BY 1
  UNION ALL
  SELECT n.nspname, 'indices', count(*)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('neura', 'amigosdelarutaerp') AND c.relkind = 'i' GROUP BY 1
  UNION ALL
  SELECT n.nspname, 'vistas', count(*)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('neura', 'amigosdelarutaerp') AND c.relkind IN ('v', 'm') GROUP BY 1
  UNION ALL
  SELECT n.nspname, 'secuencias', count(*)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('neura', 'amigosdelarutaerp') AND c.relkind = 'S' GROUP BY 1
  UNION ALL
  SELECT n.nspname, 'funciones', count(*)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('neura', 'amigosdelarutaerp') GROUP BY 1
  UNION ALL
  SELECT n.nspname, 'triggers', count(*)
    FROM pg_trigger g
    JOIN pg_class c ON c.oid = g.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('neura', 'amigosdelarutaerp') AND NOT g.tgisinternal GROUP BY 1
  UNION ALL
  SELECT n.nspname, 'politicas RLS', count(*)
    FROM pg_policy o
    JOIN pg_class c ON c.oid = o.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('neura', 'amigosdelarutaerp') GROUP BY 1
  UNION ALL
  SELECT n.nspname, 'constraints', count(*)
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('neura', 'amigosdelarutaerp') GROUP BY 1
  UNION ALL
  SELECT n.nspname, 'tipos', count(*)
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname IN ('neura', 'amigosdelarutaerp') AND t.typtype IN ('e', 'd') GROUP BY 1
)
SELECT objeto,
       max(cantidad) FILTER (WHERE schema = 'neura')             AS neura,
       max(cantidad) FILTER (WHERE schema = 'amigosdelarutaerp') AS amigosdelarutaerp
  FROM conteo GROUP BY objeto ORDER BY objeto;

-- =============================================================================
-- Auditoria de independencia: busca CUALQUIER referencia a `neura` que haya
-- quedado dentro de `amigosdelarutaerp`.
--
-- Lo esperado es CERO FILAS. El paso 6 ya reescribe defaults, expresiones de
-- indice y CHECK, y aborta si encuentra una columna generada que no puede
-- reescribir. Esta consulta es la verificacion independiente de que no quedo
-- ninguna fuga: si devuelve algo, es un caso que el paso 6 todavia no cubre.
--
-- Dos excepciones esperadas:
--   · 'FK a otro schema': 9 filas hacia `auth.users`, iguales a las de `neura`
--     (ver `v_fk_cross_schema`). Ninguna debe apuntar a `public` ni a otro
--     schema de datos.
--   · 'funcion' cuyo cuerpo menciona `neura` dentro de un literal (p. ej. una
--     migracion que itera schemas): revisalas, pero puede estar bien.
-- Las de tipo 'check', 'indice', 'default' y 'columna generada' no tienen
-- excusa: son dependencias reales y rompen la independencia.
-- =============================================================================
SELECT 'check' AS tipo, c.relname AS objeto, k.conname AS detalle,
       pg_get_constraintdef(k.oid) AS definicion
  FROM pg_constraint k
  JOIN pg_class c ON c.oid = k.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp' AND k.contype = 'c'
   AND pg_get_constraintdef(k.oid) ~ '\mneura\M'
UNION ALL
SELECT 'indice', m.relname, i.relname, pg_get_indexdef(i.oid)
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class m ON m.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = m.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp' AND pg_get_indexdef(i.oid) ~ '\mneura\M'
UNION ALL
SELECT 'columna generada', c.relname, a.attname,
       pg_get_expr(ad.adbin, ad.adrelid)
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
 WHERE n.nspname = 'amigosdelarutaerp' AND a.attgenerated <> ''
   AND pg_get_expr(ad.adbin, ad.adrelid) ~ '\mneura\M'
UNION ALL
SELECT 'default', c.relname, a.attname, pg_get_expr(ad.adbin, ad.adrelid)
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
 WHERE n.nspname = 'amigosdelarutaerp' AND a.attgenerated = ''
   AND pg_get_expr(ad.adbin, ad.adrelid) ~ '\mneura\M'
UNION ALL
SELECT 'politica RLS', c.relname, p.polname,
       coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' | ' ||
       coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp'
   AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
        coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ '\mneura\M'
UNION ALL
SELECT 'trigger', c.relname, g.tgname, pg_get_triggerdef(g.oid)
  FROM pg_trigger g
  JOIN pg_class c ON c.oid = g.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp' AND NOT g.tgisinternal
   AND pg_get_triggerdef(g.oid) ~ '\mneura\M'
UNION ALL
SELECT 'vista', c.relname, '', left(pg_get_viewdef(c.oid, true), 400)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp' AND c.relkind IN ('v', 'm')
   AND pg_get_viewdef(c.oid, true) ~ '\mneura\M'
UNION ALL
SELECT 'funcion', p.proname, pg_get_function_identity_arguments(p.oid),
       left(pg_get_functiondef(p.oid), 400)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'amigosdelarutaerp' AND p.prokind IN ('f', 'p')
   AND pg_get_functiondef(p.oid) ~ '\mneura\M'
UNION ALL
SELECT 'FK a otro schema', c.relname, k.conname, pg_get_constraintdef(k.oid)
  FROM pg_constraint k
  JOIN pg_class c ON c.oid = k.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class f ON f.oid = k.confrelid
 WHERE n.nspname = 'amigosdelarutaerp' AND k.contype = 'f'
   AND f.relnamespace <> n.oid
 ORDER BY 1, 2, 3;

-- =============================================================================
-- Diff de NOMBRES de constraints e indices, origen vs destino.
--
-- Lo esperado con `v_fk_cross_schema` en true: CERO FILAS. El paso 4b le devuelve
-- el nombre original a todo PK/UNIQUE/CHECK e indice que `LIKE INCLUDING ALL`
-- haya renombrado, y el paso 7 crea todas las FK.
--
-- Si aparece un UNIQUE o un indice con nombre auto-generado del estilo
-- `tabla_col1_col2_key`, es que 4b no lo pudo emparejar: pasalo y lo vemos.
-- =============================================================================
SELECT 'falta en el nuevo' AS donde,
       CASE k.contype WHEN 'f' THEN 'FK' WHEN 'c' THEN 'CHECK' WHEN 'p' THEN 'PK'
                      WHEN 'u' THEN 'UNIQUE' WHEN 'x' THEN 'EXCLUDE'
                      ELSE k.contype::text END AS tipo,
       c.relname AS tabla, k.conname AS nombre,
       pg_get_constraintdef(k.oid) AS definicion
  FROM pg_constraint k
  JOIN pg_class c ON c.oid = k.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'neura'
   AND NOT EXISTS (
         SELECT 1 FROM pg_constraint x
           JOIN pg_class xc ON xc.oid = x.conrelid
           JOIN pg_namespace xn ON xn.oid = xc.relnamespace
          WHERE xn.nspname = 'amigosdelarutaerp'
            AND xc.relname = c.relname AND x.conname = k.conname)

UNION ALL
SELECT 'falta en el nuevo', 'INDICE', m.relname, i.relname, pg_get_indexdef(i.oid)
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class m ON m.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = m.relnamespace
 WHERE n.nspname = 'neura'
   AND NOT EXISTS (
         SELECT 1 FROM pg_class y
           JOIN pg_namespace yn ON yn.oid = y.relnamespace
          WHERE yn.nspname = 'amigosdelarutaerp' AND y.relname = i.relname)

UNION ALL
SELECT 'sobra en el nuevo',
       CASE k.contype WHEN 'f' THEN 'FK' WHEN 'c' THEN 'CHECK' WHEN 'p' THEN 'PK'
                      WHEN 'u' THEN 'UNIQUE' WHEN 'x' THEN 'EXCLUDE'
                      ELSE k.contype::text END,
       c.relname, k.conname, pg_get_constraintdef(k.oid)
  FROM pg_constraint k
  JOIN pg_class c ON c.oid = k.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp'
   AND NOT EXISTS (
         SELECT 1 FROM pg_constraint x
           JOIN pg_class xc ON xc.oid = x.conrelid
           JOIN pg_namespace xn ON xn.oid = xc.relnamespace
          WHERE xn.nspname = 'neura'
            AND xc.relname = c.relname AND x.conname = k.conname)

UNION ALL
SELECT 'sobra en el nuevo', 'INDICE', m.relname, i.relname, pg_get_indexdef(i.oid)
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class m ON m.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = m.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp'
   AND NOT EXISTS (
         SELECT 1 FROM pg_class y
           JOIN pg_namespace yn ON yn.oid = y.relnamespace
          WHERE yn.nspname = 'neura' AND y.relname = i.relname)

 ORDER BY 1, 2, 3, 4;

-- Y que no haya quedado NI UNA fila de datos en el destino.
SELECT c.relname AS tabla_con_datos,
       (xpath('/row/c/text()',
          query_to_xml(format('SELECT count(*) AS c FROM %I.%I', 'amigosdelarutaerp', c.relname),
                       false, true, '')))[1]::text::bigint AS filas
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp' AND c.relkind = 'r'
   AND (xpath('/row/c/text()',
          query_to_xml(format('SELECT count(*) AS c FROM %I.%I', 'amigosdelarutaerp', c.relname),
                       false, true, '')))[1]::text::bigint > 0
 ORDER BY 2 DESC;
