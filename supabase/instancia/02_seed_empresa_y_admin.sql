-- =============================================================================
-- 02 · Semilla de la instancia: empresa, catálogos y usuario admin.
--
-- Corre DESPUÉS del 01. El 01 clona la estructura sin datos, así que las tablas
-- de catálogo (`modulos`, `dashboard_views`) quedan vacías y hay que poblarlas.
--
-- ANTES de correr esto, creá el usuario de autenticación:
--   Supabase Studio → Authentication → Users → Add user
--     email: admin@amigosdelaruta.com
--     password: la que le vayas a dar al cliente
--     marcá "Auto Confirm User"
-- Este script NO escribe en `auth`: solo lee `auth.users` para encontrar el id.
-- Si el usuario no existe, aborta con un mensaje claro y no deja nada a medias.
--
-- Escribe únicamente dentro de `amigosdelarutaerp`. Lee de `neura` (catálogos) y
-- de `auth.users` (el id del usuario). No modifica ni `neura` ni `auth`.
--
-- Es re-ejecutable: todo va con ON CONFLICT / NOT EXISTS.
-- =============================================================================

BEGIN;

DO $SEED$
DECLARE
  v_dst         text := 'amigosdelarutaerp';
  v_src         text := 'neura';
  v_empresa_id  uuid := '80349bf4-7735-41a4-ac10-fbed4ce013a8';
  v_email       text := 'admin@amigosdelaruta.com';
  v_nombre      text := 'Amigos de la Ruta';
  v_auth_id     uuid;
  v_n           int;
  v_falta       text;

  -- Los 14 slugs de módulo de esta instancia. "Movimientos" no está porque no es
  -- un módulo con slug propio: es la vista `/inventario/movimientos`, que entra
  -- con el permiso de `inventario`.
  -- Debe coincidir con INSTANCIA_MENU_KEYS_PERMITIDAS en
  -- src/components/layout/Sidebar.tsx.
  v_slugs text[] := ARRAY[
    'dashboard',
    'gerencia',
    'ventas',
    'clientes',
    'gestion-clientes',
    'cobranzas',
    'pagos',
    'compras',
    'inventario',
    'gastos',
    'notas_credito',
    'reportes',
    'proyectos',
    'agenda'
  ];
BEGIN
  IF to_regnamespace(v_dst) IS NULL THEN
    RAISE EXCEPTION 'No existe el schema %. Corré primero el script 01.', v_dst;
  END IF;

  -- -------------------------------------------------------------------------
  -- 1) Catálogo de módulos: se copian las filas tal cual desde `neura` (mismos
  --    id, nombre y cualquier columna extra), filtrando por los 14 slugs.
  --    `SELECT *` sirve porque el 01 clonó la tabla con idéntica estructura.
  -- -------------------------------------------------------------------------
  EXECUTE format(
    'INSERT INTO %I.modulos SELECT * FROM %I.modulos m
      WHERE m.slug = ANY($1)
        AND NOT EXISTS (SELECT 1 FROM %I.modulos d WHERE d.slug = m.slug)',
    v_dst, v_src, v_dst) USING v_slugs;

  EXECUTE format('SELECT count(*) FROM %I.modulos', v_dst) INTO v_n;
  RAISE NOTICE '[1] modulos en %: % (esperado %)', v_dst, v_n, array_length(v_slugs, 1);

  IF v_n < array_length(v_slugs, 1) THEN
    EXECUTE format(
      'SELECT string_agg(s, '', '' ORDER BY s) FROM unnest($1) s
        WHERE s NOT IN (SELECT slug FROM %I.modulos)', v_dst)
      INTO v_falta USING v_slugs;
    RAISE EXCEPTION
      'Estos slugs de modulo no existen en %.modulos, asi que no se pudieron copiar: %. Revisa como se llaman en el origen.',
      v_src, v_falta;
  END IF;

  -- -------------------------------------------------------------------------
  -- 2) Catálogo de vistas de dashboard: también se copia desde `neura`.
  -- -------------------------------------------------------------------------
  EXECUTE format(
    'INSERT INTO %I.dashboard_views SELECT * FROM %I.dashboard_views v
      WHERE NOT EXISTS (SELECT 1 FROM %I.dashboard_views d WHERE d.slug = v.slug)',
    v_dst, v_src, v_dst);
  EXECUTE format('SELECT count(*) FROM %I.dashboard_views', v_dst) INTO v_n;
  RAISE NOTICE '[2] dashboard_views en %: %', v_dst, v_n;

  -- -------------------------------------------------------------------------
  -- 3) La empresa, con su propio id. `data_schema` apunta al schema de esta
  --    instancia: los datos de negocio viven acá mismo, no en un tenant aparte.
  -- -------------------------------------------------------------------------
  EXECUTE format(
    'INSERT INTO %I.empresas (id, nombre_empresa, estado, data_schema)
     VALUES ($1, $2, ''activo'', $3)
     ON CONFLICT (id) DO UPDATE
        SET nombre_empresa = EXCLUDED.nombre_empresa,
            data_schema    = EXCLUDED.data_schema',
    v_dst) USING v_empresa_id, v_nombre, v_dst;
  RAISE NOTICE '[3] empresa %: % ', v_empresa_id, v_nombre;

  -- -------------------------------------------------------------------------
  -- 4) Usuario de autenticación (solo lectura sobre `auth.users`).
  -- -------------------------------------------------------------------------
  SELECT id INTO v_auth_id FROM auth.users WHERE lower(email) = v_email;
  IF v_auth_id IS NULL THEN
    RAISE EXCEPTION
      'No existe el usuario % en auth.users. Crealo en Studio (Authentication -> Users -> Add user, con Auto Confirm) y volve a correr este script.',
      v_email;
  END IF;

  -- -------------------------------------------------------------------------
  -- 5) Fila `usuarios` del ERP, rol admin de la empresa.
  -- -------------------------------------------------------------------------
  EXECUTE format(
    'INSERT INTO %I.usuarios (empresa_id, nombre, email, rol, auth_user_id)
     SELECT $1, $2, $3, ''admin'', $4
      WHERE NOT EXISTS (SELECT 1 FROM %I.usuarios u WHERE lower(u.email) = $3)',
    v_dst, v_dst) USING v_empresa_id, 'Administrador', v_email, v_auth_id;

  EXECUTE format(
    'UPDATE %I.usuarios SET empresa_id = $1, rol = ''admin'', auth_user_id = $2
      WHERE lower(email) = $3', v_dst)
    USING v_empresa_id, v_auth_id, v_email;
  RAISE NOTICE '[5] usuario % -> auth %', v_email, v_auth_id;

  -- -------------------------------------------------------------------------
  -- 6) Módulos habilitados para la empresa: los 14 y nada más.
  --    Este es el permiso REAL. El recorte del sidebar es solo visual; lo que
  --    cierra las rutas de los módulos que no van es justamente esta tabla.
  -- -------------------------------------------------------------------------
  EXECUTE format(
    'INSERT INTO %I.empresa_modulos (empresa_id, modulo_id, activo)
     SELECT $1, m.id, true FROM %I.modulos m
      WHERE m.slug = ANY($2)
        AND NOT EXISTS (
          SELECT 1 FROM %I.empresa_modulos em
           WHERE em.empresa_id = $1 AND em.modulo_id = m.id)',
    v_dst, v_dst, v_dst) USING v_empresa_id, v_slugs;

  -- Y si alguno quedó desactivado de una corrida anterior, se reactiva.
  EXECUTE format(
    'UPDATE %I.empresa_modulos em SET activo = true
       FROM %I.modulos m
      WHERE em.modulo_id = m.id AND em.empresa_id = $1 AND m.slug = ANY($2)',
    v_dst, v_dst) USING v_empresa_id, v_slugs;

  EXECUTE format(
    'SELECT count(*) FROM %I.empresa_modulos WHERE empresa_id = $1 AND activo',
    v_dst) INTO v_n USING v_empresa_id;
  RAISE NOTICE '[6] empresa_modulos activos: %', v_n;

  -- -------------------------------------------------------------------------
  -- 7) Vistas de dashboard de la empresa (pestañas del módulo Dashboard).
  -- -------------------------------------------------------------------------
  EXECUTE format(
    'INSERT INTO %I.empresa_dashboard_views (empresa_id, dashboard_view_id, activo)
     SELECT $1, v.id, true FROM %I.dashboard_views v
      WHERE v.activo
        AND NOT EXISTS (
          SELECT 1 FROM %I.empresa_dashboard_views edv
           WHERE edv.empresa_id = $1 AND edv.dashboard_view_id = v.id)',
    v_dst, v_dst, v_dst) USING v_empresa_id;
  RAISE NOTICE '[7] empresa_dashboard_views: listo';

  RAISE NOTICE 'Semilla lista. Entra con % en http://amigosdelaruta.neura.com.py', v_email;
END
$SEED$;

COMMIT;

-- =============================================================================
-- Verificación
-- =============================================================================
SELECT e.id AS empresa_id, e.nombre_empresa, e.estado, e.data_schema
  FROM amigosdelarutaerp.empresas e;

SELECT u.email, u.rol, u.auth_user_id IS NOT NULL AS enlazado_a_auth, u.empresa_id
  FROM amigosdelarutaerp.usuarios u;

-- Debe devolver exactamente 14 filas, todas en true.
SELECT m.slug, m.nombre, em.activo
  FROM amigosdelarutaerp.empresa_modulos em
  JOIN amigosdelarutaerp.modulos m ON m.id = em.modulo_id
 ORDER BY m.slug;
