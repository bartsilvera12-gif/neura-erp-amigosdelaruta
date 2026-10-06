-- =============================================================================
-- 04 · Catálogos POR EMPRESA del módulo Proyectos.
--
-- Corre DESPUÉS del 02. Hace falta por esto:
--
--   El 01 clona la estructura sin datos y el 02 pobla los catálogos globales
--   (`modulos`, `dashboard_views`). Pero `proyecto_estados`, `proyecto_tipos`,
--   `proyecto_prioridades_config` y `proyecto_slv_objetivos` llevan `empresa_id`:
--   no son globales ni son datos de un cliente, son configuración por empresa que
--   en el repo madre siembra la migración `20260606120000_modulo_proyectos.sql`.
--   Sin estas filas el módulo Proyectos abre sin estados: el Kanban queda vacío y
--   no se puede crear un proyecto.
--
--   Tampoco alcanzaba con re-correr esas migraciones: enumeran los schemas con
--   `nspname IN ('public','zentra_erp') OR ~ '^er_[0-9a-f]{32}$' OR LIKE 'erp\_%'`,
--   y `amigosdelarutaerp` no coincide con ninguno de esos patrones (ver la nota al
--   final). Además recorrerían todos los schemas, que es justo lo que no queremos.
--
-- Los valores son los DEFAULTS de las migraciones del madre, no una copia de la
-- configuración de otra empresa: así el cliente arranca con el catálogo estándar
-- y no hereda customizaciones ajenas.
--
-- Escribe solo dentro de `amigosdelarutaerp` y solo para esta empresa.
-- Idempotente: todo con ON CONFLICT / NOT EXISTS.
-- =============================================================================

BEGIN;

DO $SEED$
DECLARE
  v_dst        text := 'amigosdelarutaerp';
  v_empresa_id uuid := '80349bf4-7735-41a4-ac10-fbed4ce013a8';
  rec          record;
  v_n          int;

  -- Fuente: supabase/migrations/20260606120000_modulo_proyectos.sql
  v_estados jsonb := '[
    {"codigo":"nuevo","nombre":"Nuevo / Pendiente de brief","orden":10,"color":"#94a3b8","tipo":"interno","cuenta":true,"ini":true,"fin":false},
    {"codigo":"brief_cargado","nombre":"Brief cargado","orden":20,"color":"#38bdf8","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"cola_produccion","nombre":"En cola de producción","orden":30,"color":"#6366f1","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"diseno","nombre":"En diseño","orden":40,"color":"#a855f7","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"desarrollo","nombre":"En desarrollo","orden":50,"color":"#8b5cf6","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"revision_interna","nombre":"Revisión interna","orden":60,"color":"#f97316","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"enviado_cliente","nombre":"Enviado al cliente","orden":70,"color":"#22c55e","tipo":"cliente","cuenta":true,"ini":false,"fin":false},
    {"codigo":"espera_cliente","nombre":"Esperando respuesta del cliente","orden":80,"color":"#eab308","tipo":"cliente","cuenta":true,"ini":false,"fin":false},
    {"codigo":"cambios_solicitados","nombre":"Cambios solicitados","orden":90,"color":"#ef4444","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"listo_publicar","nombre":"Listo para publicar","orden":100,"color":"#14b8a6","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"publicado","nombre":"Publicado / Entregado","orden":110,"color":"#22c55e","tipo":"final","cuenta":false,"ini":false,"fin":true},
    {"codigo":"pausado","nombre":"Pausado","orden":120,"color":"#64748b","tipo":"pausado","cuenta":false,"ini":false,"fin":false},
    {"codigo":"cancelado","nombre":"Cancelado","orden":130,"color":"#475569","tipo":"final","cuenta":false,"ini":false,"fin":true}
  ]'::jsonb;

  -- Fuente: supabase/migrations/20260606123000_proyecto_prioridades_config.sql
  v_prioridades jsonb := '[
    {"codigo":"baja","nombre":"Baja","orden":10,"color":"#64748b","bg":"#f1f5f9","text":"#475569","border":"#cbd5e1"},
    {"codigo":"normal","nombre":"Media","orden":20,"color":"#475569","bg":"#e2e8f0","text":"#1e293b","border":"#cbd5e1"},
    {"codigo":"alta","nombre":"Alta","orden":30,"color":"#f97316","bg":"#f97316","text":"#ffffff","border":"#ea580c"},
    {"codigo":"urgente","nombre":"Urgente","orden":40,"color":"#dc2626","bg":"#dc2626","text":"#ffffff","border":"#b91c1c"}
  ]'::jsonb;

  -- Fuente: supabase/migrations/20260907120000_proyectos_dashboards_slv_bloqueos.sql
  v_objetivos jsonb := '[
    {"codigo":"correccion_menor","nombre":"Corrección menor","horas":4,"orden":10},
    {"codigo":"cambio_menor","nombre":"Cambio menor","horas":8,"orden":20},
    {"codigo":"cambio_medio","nombre":"Cambio medio","horas":16,"orden":30},
    {"codigo":"web_estandar","nombre":"Web estándar","horas":24,"orden":40},
    {"codigo":"erp_estandar","nombre":"ERP estándar","horas":40,"orden":50},
    {"codigo":"desarrollo_mayor","nombre":"Desarrollo mayor","horas":80,"orden":60}
  ]'::jsonb;
BEGIN
  IF to_regnamespace(v_dst) IS NULL THEN
    RAISE EXCEPTION 'No existe el schema %. Corré primero el 01.', v_dst;
  END IF;

  EXECUTE format('SELECT count(*) FROM %I.empresas WHERE id = $1', v_dst)
    INTO v_n USING v_empresa_id;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No existe la empresa % en %.empresas. Corré primero el 02.',
      v_empresa_id, v_dst;
  END IF;

  -- -------------------------------------------------------------------------
  -- 1) Tipo de proyecto por defecto
  -- -------------------------------------------------------------------------
  EXECUTE format(
    'INSERT INTO %I.proyecto_tipos (empresa_id, nombre, codigo, descripcion, activo)
     SELECT $1, ''Proyecto Web'', ''web'', ''Sitios y landings vendidos por comercial'', true
      WHERE NOT EXISTS (
        SELECT 1 FROM %I.proyecto_tipos t WHERE t.empresa_id = $1 AND t.codigo = ''web'')',
    v_dst, v_dst) USING v_empresa_id;

  -- -------------------------------------------------------------------------
  -- 2) Estados del Kanban
  -- -------------------------------------------------------------------------
  FOR rec IN SELECT * FROM jsonb_array_elements(v_estados) LOOP
    EXECUTE format(
      'INSERT INTO %I.proyecto_estados (
         empresa_id, nombre, codigo, color, sort_order, cuenta_sla, tipo_sla,
         es_estado_inicial, es_estado_final, activo)
       SELECT $1, $2, $3, $4, ($5)::int, ($6)::boolean, $7, ($8)::boolean, ($9)::boolean, true
        WHERE NOT EXISTS (
          SELECT 1 FROM %I.proyecto_estados e WHERE e.empresa_id = $1 AND e.codigo = $3)',
      v_dst, v_dst)
      USING v_empresa_id,
            rec.value->>'nombre', rec.value->>'codigo', rec.value->>'color',
            rec.value->>'orden',  rec.value->>'cuenta', rec.value->>'tipo',
            rec.value->>'ini',    rec.value->>'fin';
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 3) Prioridades
  -- -------------------------------------------------------------------------
  FOR rec IN SELECT * FROM jsonb_array_elements(v_prioridades) LOOP
    EXECUTE format(
      'INSERT INTO %I.proyecto_prioridades_config (
         empresa_id, codigo, nombre, color, bg_color, text_color, border_color,
         sort_order, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ($8)::int, true)
       ON CONFLICT (empresa_id, codigo) DO NOTHING',
      v_dst)
      USING v_empresa_id,
            rec.value->>'codigo', rec.value->>'nombre', rec.value->>'color',
            rec.value->>'bg',     rec.value->>'text',   rec.value->>'border',
            rec.value->>'orden';
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 4) Objetivos de SLV (horas por tipo de trabajo)
  -- -------------------------------------------------------------------------
  FOR rec IN SELECT * FROM jsonb_array_elements(v_objetivos) LOOP
    EXECUTE format(
      'INSERT INTO %I.proyecto_slv_objetivos (empresa_id, codigo, nombre, horas, sort_order)
       SELECT $1, $2, $3, ($4)::numeric, ($5)::int
        WHERE NOT EXISTS (
          SELECT 1 FROM %I.proyecto_slv_objetivos o
           WHERE o.empresa_id = $1 AND o.codigo = $2)',
      v_dst, v_dst)
      USING v_empresa_id,
            rec.value->>'codigo', rec.value->>'nombre',
            rec.value->>'horas',  rec.value->>'orden';
  END LOOP;

  RAISE NOTICE 'Catalogos de Proyectos sembrados para la empresa %', v_empresa_id;
END
$SEED$;

COMMIT;

-- =============================================================================
-- Verificación: 13 estados (1 inicial, 2 finales), 1 tipo, 4 prioridades,
-- 6 objetivos SLV.
-- =============================================================================
SELECT 'proyecto_estados'            AS catalogo, count(*) AS filas FROM amigosdelarutaerp.proyecto_estados
UNION ALL SELECT 'proyecto_tipos',              count(*) FROM amigosdelarutaerp.proyecto_tipos
UNION ALL SELECT 'proyecto_prioridades_config', count(*) FROM amigosdelarutaerp.proyecto_prioridades_config
UNION ALL SELECT 'proyecto_slv_objetivos',      count(*) FROM amigosdelarutaerp.proyecto_slv_objetivos
ORDER BY 1;

-- El Kanban necesita exactamente un estado inicial; si no, no se puede crear un
-- proyecto. Tiene que devolver inicial = 1 y final = 2.
SELECT count(*) FILTER (WHERE es_estado_inicial) AS inicial,
       count(*) FILTER (WHERE es_estado_final)   AS final
  FROM amigosdelarutaerp.proyecto_estados
 WHERE activo;

-- =============================================================================
-- NOTA PARA EL FUTURO (importa al traer cambios del repo madre)
--
-- Muchas migraciones del madre se aplican a varios schemas a la vez y los
-- enumeran por patrón:
--
--   nspname IN ('public', 'zentra_erp')            -- 59 migraciones
--   nspname IN ('public', 'zentra_erp', 'neura')   -- 28
--   nspname ~ '^er_[0-9a-f]{32}$'                  -- 110
--   nspname LIKE 'erp\_%'                          -- 87
--
-- `amigosdelarutaerp` NO coincide con ninguno. O sea: una migración nueva del
-- madre que agregue una columna o una tabla a "todos los tenants" NO va a tocar
-- esta instancia, y el ERP va a fallar en runtime contra un schema viejo.
--
-- Al traer cambios del madre hay que, para cada migración multi-schema, correrla
-- con `amigosdelarutaerp` agregado al patrón, o aplicarla a mano a este schema.
-- Lo mismo vale para `neura`, que tampoco entra en los patrones de las 110 + 87.
-- =============================================================================
