"""Genera 06_eventos_amigosdelaruta.sql: el modulo Eventos acotado a un solo schema.

Toma los CUERPOS de public.neura_provision_eventos y
public.neura_provision_eventos_reglas del script multiempresa y los inlinea en
un unico DO anonimo con s := 'amigosdelarutaerp'. Asi no queda ninguna funcion
en public y no se recorre ningun otro schema.

Se genera con script y no a mano para que el dia que cambie el modulo se pueda
regenerar sin volver a transcribir 800 lineas.
"""
import io
import re

ORIG = r"C:\Users\Neura\Neura\neura-erp-amigosdelaruta\docs\eventos-modulo-instalar.sql"
DEST = r"C:\Users\Neura\Neura\neura-erp-amigosdelaruta\supabase\instancia\06_eventos_amigosdelaruta.sql"

src = io.open(ORIG, encoding="utf-8").read()


def cuerpo(nombre: str) -> str:
    """Devuelve lo que hay entre `AS $fn$` y `$fn$;` de esa funcion."""
    i = src.index(f"CREATE OR REPLACE FUNCTION public.{nombre}(s text)")
    j = src.index("AS $fn$", i) + len("AS $fn$")
    k = src.index("\n$fn$;", j)
    return src[j:k]


b1 = cuerpo("neura_provision_eventos")
b2 = cuerpo("neura_provision_eventos_reglas")

# --- body 1: sacar el BEGIN/END y las guardas de schema, que reemplazamos -----
b1 = b1.strip()
assert b1.startswith("BEGIN") and b1.endswith("END;"), b1[:40]
b1 = b1[len("BEGIN"):-len("END;")]
guarda1 = """  IF s IS NULL OR btrim(s) = '' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
    RETURN;
  END IF;
"""
assert guarda1 in b1
b1 = b1.replace(guarda1, "", 1)

# --- body 2: sacar DECLARE (sus vars pasan al DO) y las guardas --------------
b2 = b2.strip()
i = b2.index("BEGIN")
decl2 = b2[:i]
b2 = b2[i + len("BEGIN"):]
assert b2.rstrip().endswith("END;")
b2 = b2.rstrip()[:-len("END;")]
assert "v_auth" in decl2 and "v_guard text;" in decl2

for g in [
    "  IF s IS NULL OR btrim(s) = '' THEN RETURN; END IF;\n",
    "  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN RETURN; END IF;\n",
]:
    assert g in b2, g
    b2 = b2.replace(g, "", 1)

# la guarda de "el modulo no esta provisionado" ya no aplica: lo acabamos de
# provisionar en el mismo bloque
m = re.search(
    r"  IF NOT EXISTS \(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n\.oid = c\.relnamespace\n"
    r"                 WHERE n\.nspname = s AND c\.relname = 'reservas' AND c\.relkind = 'r'\) THEN\n"
    r"    RETURN;.*?\n  END IF;\n",
    b2,
)
assert m, "no encontre la guarda de reservas"
b2 = b2[: m.start()] + b2[m.end():]

CAB = """-- =============================================================================
-- 06 · Módulo Eventos, acotado a `amigosdelarutaerp`.
--
-- Mismo contenido que `docs/eventos-modulo-instalar.sql` (16 tablas, RLS,
-- triggers, correlativo y vistas de cálculo), con dos diferencias deliberadas:
--
--   1. NO crea nada en `public`. El original deja ahí
--      `public.neura_provision_eventos()` y
--      `public.neura_provision_eventos_reglas()`. Acá los cuerpos van inline en
--      un único DO anónimo.
--
--   2. NO recorre todos los schemas. El original termina con dos bucles sobre
--      cada schema que tenga `productos` + `clientes`, o sea que instalaría el
--      módulo —y agregaría `productos.stock_reservado`— en `neura` y en el ERP
--      de todos los demás clientes. Acá se aplica a un solo schema.
--
-- Lo único que sigue tomando de afuera es `public.set_updated_at()`, que el ERP
-- ya usa en 62 lugares: se la REFERENCIA desde los triggers, no se la modifica.
-- Si no existiera, el script corta en vez de crearla.
--
-- Generado desde el original con scripts/gen-eventos-acotado (ver scratchpad):
-- si el módulo cambia, se regenera en vez de transcribir 800 líneas a mano.
--
-- Idempotente. Todo en una transacción.
-- =============================================================================

BEGIN;

SET LOCAL client_encoding = 'UTF8';
SET LOCAL lock_timeout = '10s';

DO $EVENTOS$
DECLARE
  s       text := 'amigosdelarutaerp';
  v_auth  boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  v_svc   boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
  v_guard text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
    RAISE EXCEPTION 'No existe el schema %. Corré primero el 01.', s;
  END IF;

  -- Ancla del ERP: sin estas dos, el schema no es un ERP instalado y las FK de
  -- `evento_kits` / `reserva_stock` hacia `productos` no tendrían a qué apuntar.
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = s AND c.relname = 'productos' AND c.relkind = 'r')
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = s AND c.relname = 'clientes' AND c.relkind = 'r') THEN
    RAISE EXCEPTION 'El schema % no tiene productos + clientes: no parece un ERP instalado.', s;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'set_updated_at') THEN
    RAISE EXCEPTION
      'Falta public.set_updated_at(), que usan los triggers de este modulo. El original la crea; aca no, para no escribir en public.';
  END IF;

  -- ===========================================================================
  -- Tablas (cuerpo de neura_provision_eventos)
  -- ===========================================================================
"""

PIE = """
  RAISE NOTICE 'Modulo Eventos instalado y configurado en %', s;
END
$EVENTOS$;

COMMIT;

-- =============================================================================
-- Verificación: las 16 tablas, con RLS y políticas, SOLO en este schema.
-- =============================================================================
SELECT c.relname AS tabla,
       c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp'
   AND c.relkind = 'r'
   AND c.relname IN ('eventos','evento_itinerario','salidas','paquetes','adicionales',
                     'reservas','reserva_adicionales','participantes',
                     'participante_documentos','reserva_pagos','reserva_plan_pagos',
                     'producto_variantes','evento_kits','reserva_stock',
                     'eventos_auditoria','reserva_correlativos')
 ORDER BY 1;

-- Las tres vistas de cálculo.
SELECT c.relname AS vista
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'amigosdelarutaerp' AND c.relkind = 'v'
   AND c.relname IN ('reserva_saldos','salida_cupos','kit_necesidad')
 ORDER BY 1;

-- Y la prueba de que NO se tocó nada más: esto tiene que devolver cero filas.
SELECT n.nspname AS schema_ajeno, c.relname AS tabla
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relname IN ('reservas','salidas','paquetes','evento_kits')
   AND c.relkind = 'r'
   AND n.nspname <> 'amigosdelarutaerp'
 ORDER BY 1, 2;

-- Tampoco quedó ninguna función de provisión en public.
SELECT p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'neura_provision_eventos%';
"""

REGLAS_SEP = """
  -- ===========================================================================
  -- RLS, triggers, correlativo y vistas (cuerpo de neura_provision_eventos_reglas)
  -- ===========================================================================
"""

out = CAB + b1.rstrip() + "\n" + REGLAS_SEP + b2.rstrip() + "\n" + PIE
io.open(DEST, "w", encoding="utf-8", newline="").write(out)
print("escrito", DEST, len(out.split("\n")), "lineas")
