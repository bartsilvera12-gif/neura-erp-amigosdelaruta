-- =============================================================================
-- Módulo Eventos — provisión multi-schema.
--
-- REEMPLAZA a 20261006120000 y 20261006130000, que creaban las tablas en un
-- schema fijo. Eso estaba mal para este ERP: cada empresa tiene su propio
-- schema clonado de la plantilla (`erp_*` / `er_*`), así que un schema fijo
-- habría dejado el módulo en una sola empresa.
--
-- El patrón es el mismo que usa 20260916120000_soporte_flujo_subtareas: se
-- descubren los schemas que ya tienen el ERP instalado (ancla: `productos` +
-- `clientes`) y se provisiona en cada uno. Idempotente: se puede correr de
-- nuevo sin romper nada, y una empresa nueva se provisiona llamando a
-- `neura_provision_eventos` con su schema.
--
-- Modelo: Tour → Salida → Paquete → Reserva → Participante, más pagos de
-- reserva multimoneda, kits y reserva de stock. Las reglas que el pliego pide
-- hacer cumplir en la base (cupo, saldos derivados, pagos que no se borran)
-- viven en la migración siguiente.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout = '10s';

DO $EVENTOS$
DECLARE
  s text := 'amigosdelarutaerp';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
    RAISE EXCEPTION 'No existe el schema %.', s;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = s AND c.relname = 'productos' AND c.relkind = 'r') THEN
    RAISE EXCEPTION 'El schema % no tiene productos: no parece un ERP instalado.', s;
  END IF;


    -- eventos
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.eventos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL,
  slug                     text NOT NULL,
  nombre                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  resumen                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  descripcion              jsonb NOT NULL DEFAULT '{}'::jsonb,
  pais                     text,
  ciudad                   text,
  punto_salida             text,
  punto_llegada            text,
  duracion_dias            integer,
  noches                   integer,
  distancia_km             numeric,
  mapa_url                 text,
  idioma_tour              text,
  moneda_base              text NOT NULL DEFAULT 'USD',
  max_participantes        integer,
  fecha_limite_inscripcion date,
  incluye                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  no_incluye               jsonb NOT NULL DEFAULT '{}'::jsonb,
  condiciones              jsonb NOT NULL DEFAULT '{}'::jsonb,
  politica_cancelacion     jsonb NOT NULL DEFAULT '{}'::jsonb,
  hotel                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  portada_url              text,
  galeria                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  documentos               jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_titulo               jsonb NOT NULL DEFAULT '{}'::jsonb,
  seo_descripcion          jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado                   text NOT NULL DEFAULT 'borrador',
  destacado                boolean NOT NULL DEFAULT false,
  orden                    integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eventos_estado_chk CHECK (estado IN ('borrador','publicado','cerrado','finalizado')),
  CONSTRAINT eventos_slug_chk CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    )$ddl$, s);
    EXECUTE format($ddl$CREATE UNIQUE INDEX IF NOT EXISTS ux_eventos_empresa_slug ON %1$I.eventos(empresa_id, slug)$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_eventos_estado ON %1$I.eventos(empresa_id, estado)$ddl$, s);

    -- evento_itinerario
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.evento_itinerario (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  evento_id  uuid NOT NULL REFERENCES %1$I.eventos(id) ON DELETE CASCADE,
  dia        integer,
  etiqueta   jsonb NOT NULL DEFAULT '{}'::jsonb,
  lugar      text,
  nota       jsonb NOT NULL DEFAULT '{}'::jsonb,
  orden      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
    )$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_evento_itinerario_evento ON %1$I.evento_itinerario(evento_id, orden)$ddl$, s);

    -- salidas
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.salidas (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL,
  evento_id                uuid NOT NULL REFERENCES %1$I.eventos(id) ON DELETE CASCADE,
  codigo                   text,
  fecha_inicio             date NOT NULL,
  fecha_fin                date,
  cupo_total               integer,
  idioma_guia              text,
  fecha_limite_inscripcion date,
  estado                   text NOT NULL DEFAULT 'borrador',
  notas                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salidas_estado_chk CHECK (estado IN ('borrador','abierta','confirmada','lista_espera','cerrada','finalizada')),
  CONSTRAINT salidas_fechas_chk CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
  CONSTRAINT salidas_cupo_chk CHECK (cupo_total IS NULL OR cupo_total >= 0)
    )$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_salidas_evento ON %1$I.salidas(evento_id, fecha_inicio)$ddl$, s);

    -- paquetes
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.paquetes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  evento_id  uuid NOT NULL REFERENCES %1$I.eventos(id) ON DELETE CASCADE,
  salida_id  uuid REFERENCES %1$I.salidas(id) ON DELETE CASCADE,
  nombre     jsonb NOT NULL DEFAULT '{}'::jsonb,
  detalle    jsonb NOT NULL DEFAULT '{}'::jsonb,
  personas   integer NOT NULL DEFAULT 1,
  motos      integer NOT NULL DEFAULT 0,
  habitacion text,
  precio     numeric NOT NULL DEFAULT 0,
  moneda     text NOT NULL DEFAULT 'USD',
  cupo       integer,
  orden      integer NOT NULL DEFAULT 0,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paquetes_personas_chk CHECK (personas >= 1),
  CONSTRAINT paquetes_precio_chk CHECK (precio >= 0)
    )$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_paquetes_evento ON %1$I.paquetes(evento_id, orden)$ddl$, s);

    -- adicionales
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.adicionales (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  evento_id   uuid REFERENCES %1$I.eventos(id) ON DELETE CASCADE,
  nombre      jsonb NOT NULL DEFAULT '{}'::jsonb,
  detalle     jsonb NOT NULL DEFAULT '{}'::jsonb,
  precio      numeric NOT NULL DEFAULT 0,
  moneda      text NOT NULL DEFAULT 'USD',
  cupo        integer,
  producto_id uuid,
  activo      boolean NOT NULL DEFAULT true,
  orden       integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adicionales_precio_chk CHECK (precio >= 0)
    )$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_adicionales_evento ON %1$I.adicionales(evento_id, orden)$ddl$, s);

    -- reservas
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.reservas (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                uuid NOT NULL,
  codigo                    text NOT NULL,
  cliente_id                uuid,
  evento_id                 uuid NOT NULL REFERENCES %1$I.eventos(id) ON DELETE RESTRICT,
  salida_id                 uuid NOT NULL REFERENCES %1$I.salidas(id) ON DELETE RESTRICT,
  paquete_id                uuid REFERENCES %1$I.paquetes(id) ON DELETE RESTRICT,
  cantidad_participantes    integer NOT NULL DEFAULT 1,
  moneda                    text NOT NULL DEFAULT 'USD',
  precio_paquete            numeric NOT NULL DEFAULT 0,
  estado                    text NOT NULL DEFAULT 'cotizacion',
  origen                    text NOT NULL DEFAULT 'erp',
  idioma_preferido          text,
  asesor_id                 uuid,
  sobreventa_autorizada     boolean NOT NULL DEFAULT false,
  sobreventa_autorizada_por uuid,
  notas                     text,
  cancelada_at              timestamptz,
  motivo_cancelacion        text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservas_estado_chk CHECK (estado IN ('cotizacion','reservada','pago_parcial','confirmada','participo','cancelada')),
  CONSTRAINT reservas_origen_chk CHECK (origen IN ('web','erp','whatsapp','otro')),
  CONSTRAINT reservas_cantidad_chk CHECK (cantidad_participantes >= 1),
  CONSTRAINT reservas_precio_chk CHECK (precio_paquete >= 0)
    )$ddl$, s);
    EXECUTE format($ddl$CREATE UNIQUE INDEX IF NOT EXISTS ux_reservas_empresa_codigo ON %1$I.reservas(empresa_id, codigo)$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_reservas_cliente ON %1$I.reservas(empresa_id, cliente_id)$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_reservas_salida_estado ON %1$I.reservas(salida_id, estado)$ddl$, s);

    -- reserva_adicionales
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.reserva_adicionales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  reserva_id      uuid NOT NULL REFERENCES %1$I.reservas(id) ON DELETE CASCADE,
  adicional_id    uuid REFERENCES %1$I.adicionales(id) ON DELETE RESTRICT,
  descripcion     jsonb NOT NULL DEFAULT '{}'::jsonb,
  cantidad        numeric NOT NULL DEFAULT 1,
  precio_unitario numeric NOT NULL DEFAULT 0,
  moneda          text NOT NULL DEFAULT 'USD',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reserva_adicionales_cantidad_chk CHECK (cantidad > 0),
  CONSTRAINT reserva_adicionales_precio_chk CHECK (precio_unitario >= 0)
    )$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_reserva_adicionales_reserva ON %1$I.reserva_adicionales(reserva_id)$ddl$, s);

    -- participantes
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.participantes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL,
  reserva_id           uuid NOT NULL REFERENCES %1$I.reservas(id) ON DELETE CASCADE,
  cliente_id           uuid,
  nombre               text NOT NULL,
  apellido             text,
  documento            text,
  pasaporte            text,
  nacionalidad         text,
  fecha_nacimiento     date,
  pais                 text,
  ciudad               text,
  telefono             text,
  email                text,
  rol                  text NOT NULL DEFAULT 'acompanante',
  licencia_numero      text,
  licencia_pais        text,
  licencia_categoria   text,
  licencia_vencimiento date,
  talles               jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado_documental    text NOT NULL DEFAULT 'pendiente',
  qr_token             text,
  checkin_at           timestamptz,
  checkin_por          uuid,
  kit_entregado_at     timestamptz,
  kit_entregado_por    uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participantes_rol_chk CHECK (rol IN ('titular','piloto','acompanante')),
  CONSTRAINT participantes_doc_chk CHECK (estado_documental IN ('completo','pendiente','observado'))
    )$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_participantes_reserva ON %1$I.participantes(reserva_id)$ddl$, s);
    EXECUTE format($ddl$CREATE UNIQUE INDEX IF NOT EXISTS ux_participantes_qr ON %1$I.participantes(qr_token) WHERE qr_token IS NOT NULL$ddl$, s);

    -- participante_documentos
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.participante_documentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  participante_id uuid NOT NULL REFERENCES %1$I.participantes(id) ON DELETE CASCADE,
  tipo            text NOT NULL,
  archivo_url     text,
  estado          text NOT NULL DEFAULT 'pendiente',
  observacion     text,
  subido_at       timestamptz,
  subido_por      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participante_documentos_estado_chk CHECK (estado IN ('pendiente','cargado','aprobado','observado','vencido'))
    )$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_participante_documentos_part ON %1$I.participante_documentos(participante_id)$ddl$, s);

    -- reserva_pagos
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.reserva_pagos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  reserva_id          uuid NOT NULL REFERENCES %1$I.reservas(id) ON DELETE RESTRICT,
  fecha               date NOT NULL DEFAULT CURRENT_DATE,
  moneda              text NOT NULL,
  importe             numeric NOT NULL,
  tipo_cambio         numeric NOT NULL DEFAULT 1,
  moneda_equivalente  text NOT NULL,
  importe_equivalente numeric NOT NULL,
  medio               text NOT NULL DEFAULT 'transferencia',
  referencia          text,
  comprobante_url     text,
  pasarela_proveedor  text,
  pasarela_payment_id text,
  estado              text NOT NULL DEFAULT 'confirmado',
  anulado_at          timestamptz,
  anulado_por         uuid,
  motivo_anulacion    text,
  revierte_pago_id    uuid,
  factura_id          uuid,
  usuario_id          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reserva_pagos_importe_chk CHECK (importe <> 0),
  CONSTRAINT reserva_pagos_tipo_cambio_chk CHECK (tipo_cambio > 0),
  CONSTRAINT reserva_pagos_medio_chk CHECK (medio IN ('efectivo','transferencia','tarjeta','pix','pasarela','cheque','otro')),
  CONSTRAINT reserva_pagos_estado_chk CHECK (estado IN ('pendiente','confirmado','anulado','revertido')),
  CONSTRAINT reserva_pagos_anulacion_chk CHECK (estado <> 'anulado' OR (anulado_at IS NOT NULL AND anulado_por IS NOT NULL))
    )$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_reserva_pagos_reserva ON %1$I.reserva_pagos(reserva_id, fecha)$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_reserva_pagos_factura ON %1$I.reserva_pagos(factura_id) WHERE factura_id IS NOT NULL$ddl$, s);

    -- reserva_plan_pagos
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.reserva_plan_pagos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  reserva_id  uuid NOT NULL REFERENCES %1$I.reservas(id) ON DELETE CASCADE,
  numero      integer NOT NULL,
  concepto    text NOT NULL DEFAULT 'cuota',
  vencimiento date,
  importe     numeric NOT NULL,
  moneda      text NOT NULL DEFAULT 'USD',
  estado      text NOT NULL DEFAULT 'pendiente',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reserva_plan_pagos_concepto_chk CHECK (concepto IN ('sena','cuota','saldo','extraordinario')),
  CONSTRAINT reserva_plan_pagos_estado_chk CHECK (estado IN ('pendiente','pagada','vencida','anulada')),
  CONSTRAINT reserva_plan_pagos_importe_chk CHECK (importe > 0)
    )$ddl$, s);
    EXECUTE format($ddl$CREATE UNIQUE INDEX IF NOT EXISTS ux_reserva_plan_pagos_num ON %1$I.reserva_plan_pagos(reserva_id, numero)$ddl$, s);

    -- producto_variantes
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.producto_variantes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  producto_id     uuid NOT NULL,
  sku             text NOT NULL,
  atributos       jsonb NOT NULL DEFAULT '{}'::jsonb,
  precio_extra    numeric NOT NULL DEFAULT 0,
  stock_fisico    numeric NOT NULL DEFAULT 0,
  stock_reservado numeric NOT NULL DEFAULT 0,
  stock_minimo    numeric NOT NULL DEFAULT 0,
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT producto_variantes_reservado_chk CHECK (stock_reservado >= 0)
    )$ddl$, s);
    EXECUTE format($ddl$CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_variantes_sku ON %1$I.producto_variantes(empresa_id, sku)$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_producto_variantes_producto ON %1$I.producto_variantes(producto_id)$ddl$, s);

    -- evento_kits
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.evento_kits (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                uuid NOT NULL,
  evento_id                 uuid NOT NULL REFERENCES %1$I.eventos(id) ON DELETE CASCADE,
  paquete_id                uuid REFERENCES %1$I.paquetes(id) ON DELETE CASCADE,
  producto_id               uuid NOT NULL,
  cantidad_por_participante numeric NOT NULL DEFAULT 1,
  considera_talle           boolean NOT NULL DEFAULT false,
  campo_talle               text,
  requiere_entrega          boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evento_kits_cantidad_chk CHECK (cantidad_por_participante > 0),
  CONSTRAINT evento_kits_talle_chk CHECK (NOT considera_talle OR campo_talle IS NOT NULL)
    )$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_evento_kits_evento ON %1$I.evento_kits(evento_id)$ddl$, s);

    -- reserva_stock
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.reserva_stock (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  reserva_id      uuid NOT NULL REFERENCES %1$I.reservas(id) ON DELETE CASCADE,
  participante_id uuid REFERENCES %1$I.participantes(id) ON DELETE CASCADE,
  producto_id     uuid NOT NULL,
  variante_id     uuid REFERENCES %1$I.producto_variantes(id) ON DELETE RESTRICT,
  cantidad        numeric NOT NULL DEFAULT 1,
  estado          text NOT NULL DEFAULT 'reservado',
  entregado_at    timestamptz,
  entregado_por   uuid,
  liberado_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reserva_stock_cantidad_chk CHECK (cantidad > 0),
  CONSTRAINT reserva_stock_estado_chk CHECK (estado IN ('reservado','entregado','liberado')),
  CONSTRAINT reserva_stock_entrega_chk CHECK (estado <> 'entregado' OR entregado_at IS NOT NULL)
    )$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_reserva_stock_reserva ON %1$I.reserva_stock(reserva_id)$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_reserva_stock_producto ON %1$I.reserva_stock(empresa_id, producto_id, estado)$ddl$, s);

    -- eventos_auditoria
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.eventos_auditoria (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  entidad       text NOT NULL,
  entidad_id    uuid,
  accion        text NOT NULL,
  usuario_id    uuid,
  datos_antes   jsonb,
  datos_despues jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
    )$ddl$, s);
    EXECUTE format($ddl$CREATE INDEX IF NOT EXISTS ix_eventos_auditoria_entidad ON %1$I.eventos_auditoria(empresa_id, entidad, entidad_id, created_at DESC)$ddl$, s);

    -- reserva_correlativos
    EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.reserva_correlativos (
  empresa_id    uuid NOT NULL,
  anio          integer NOT NULL,
  ultimo_numero bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, anio)
    )$ddl$, s);

  -- `productos` ya existe en el schema: se le agrega el stock comprometido que
  -- pide el pliego ("stock físico, reservado y disponible"). Aditivo.
  EXECUTE format($ddl$
    ALTER TABLE %1$I.productos ADD COLUMN IF NOT EXISTS stock_reservado numeric NOT NULL DEFAULT 0
  $ddl$, s);
  RAISE NOTICE 'modulo eventos provisionado en %', s;
END
$EVENTOS$;
SELECT pg_notify('pgrst', 'reload schema');
