# Integración ERP ↔ sitio web de Amigos de la Ruta

Une [`amigos-de-la-ruta-web`](https://github.com/bartsilvera12-gif/amigos-de-la-ruta-web)
(estático, Vercel) con este ERP (Next + Supabase, Coolify).

> **Hay trabajo en paralelo.** El módulo Eventos
> (`supabase/migrations/20261009120000_eventos_provision.sql` y
> `…130000_eventos_reglas.sql`) salió de otra sesión. Este documento está
> alineado a ese modelo, no lo reemplaza. Antes de tocar algo de acá, confirmar
> que la otra línea de trabajo no lo esté haciendo también.

## Punto de partida

**La web** es un `index.html` de 2421 líneas con runtime propio (`support.js`,
tags `<x-dc>`, React por unpkg). Todo el contenido son constantes JS: `EVENTS`
(6), `PRODUCTS` (8), `MOTOS` (4), `FAQS` (10), `ENCUENTROS` (3), más `REDES`,
`WHATSAPP`, `MEDIOS_PAGO`, `COTIZACIONES` y `DEPOSIT`.

El propio código deja la nota: *"El pliego las pide administrables; hasta que
exista el CMS del ERP, este objeto es el lugar donde se administran."*

Las acciones del usuario (`submitBooking`, el carrito) arman un texto y abren
`wa.me`. **No queda registro de ninguna inscripción ni pedido.**

**El ERP** no tiene superficie pública: las ~50 rutas de `src/app/api` piden
sesión y no hay CORS configurado.

## Lo que el módulo Eventos ya resuelve

Casi todo el lado de viajes. El mapeo contra las constantes de la web:

| Dato de la web | Tabla del módulo Eventos |
|---|---|
| `EVENTS[].name`, `.desc` (es/pt/en) | `eventos.nombre`, `.resumen`, `.descripcion` — ya son `jsonb` multilingües |
| `.country`, `.recorrido`, `.duration` | `eventos.pais`, `.punto_salida`/`.punto_llegada`/`.distancia_km`, `.duracion_dias`/`.noches` |
| `.hotel` (nombre + categoría multilingüe) | `eventos.hotel` jsonb |
| `.img`, `.foto` | `eventos.portada_url`, `.galeria` |
| `.badge` "Múltiples salidas" | `salidas` (una fila por salida) |
| `.open`, `.year`, orden en la grilla | `eventos.estado`, `.fecha_limite_inscripcion`, `.destacado`, `.orden` |
| itinerario día por día | `evento_itinerario` |
| precios por tipo de paquete | `paquetes` |
| `DEPOSIT` (la seña) | `reserva_pagos` + `reserva_plan_pagos` |
| form de inscripción: nombre, documento, licencia | `reservas` + `participantes` + `participante_documentos` |
| `SIZES` (talles de remera) | `producto_variantes.atributos` + `stock_fisico`/`stock_reservado` |
| kit que se entrega en el evento | `evento_kits` + `reserva_stock` |

No hace falta inventar nada de esto. **Una primera versión de este documento
proponía tablas `web_evento` y `web_producto.talles`: quedaron descartadas**,
duplicaban `eventos` y `producto_variantes`.

## Lo que falta

### 1 · Copy de tienda multilingüe

`productos` tiene `nombre` plano. La web muestra nombre, descripción, variantes
y specs en es/pt/en. `producto_variantes.atributos` resuelve los talles, no el
copy.

Hace falta una tabla chica de contenido por producto (copy jsonb, specs jsonb,
orden, categoría visual), con FK a `productos.id`. El dato comercial sigue en
`productos`: precio, stock e imagen los administra Inventario, que ya es uno de
los 15 módulos habilitados. Un producto sin fila de contenido no se publica.

### 2 · Contenido suelto del sitio

`MOTOS`, `FAQS`, `ENCUENTROS`, `REDES`, `WHATSAPP`, `MEDIOS_PAGO`,
`COTIZACIONES`. No encajan en Eventos ni en Inventario. Tabla de contenido +
tabla clave/valor de configuración.

### 3 · Superficie pública del ERP

Tres endpoints, con CORS restringido al dominio de la web:

| Endpoint | Para qué |
|---|---|
| `GET /api/web/catalogo` | eventos publicados + productos + contenido, en un JSON cacheable |
| `POST /api/web/reserva` | inscripción a un viaje → `reservas` + `participantes` |
| `POST /api/web/pedido` | pedido de tienda |

Con rate limit por IP, honeypot y tope de tamaño. No exponen nada del ERP más
allá de lo publicado.

**Por API propia, no por Supabase directo.** La alternativa era que la web
escriba con la anon key y políticas RLS de inserción pública: obliga a abrir
`INSERT` público sobre tablas del ERP desde una página estática, y cualquier
error en una policy queda expuesto.

### 4 · Un pedido de tienda no es una venta todavía

Una venta en este ERP es una operación cerrada: descuenta stock y entra en los
reportes. Si el pedido web entra directo a `ventas`, Ventas se llena de pedidos
que no se concretan y se abre una carrera por el stock.

El pedido queda pendiente y recién al confirmarlo desde el ERP se genera el
cliente, la venta y el movimiento de stock. Conviene ver si `reserva_stock` del
módulo Eventos ya sirve para esto antes de agregar tablas.

### 5 · Cambios en la web

Reemplazar las constantes por un fetch al catálogo, **con fallback a los valores
actuales**: si el ERP no responde, el sitio sigue mostrando contenido en vez de
secciones vacías. Y `submitBooking` posteando al ERP además del WhatsApp.

## Lo que falta decidir

**Dónde edita ADR este contenido.** Productos ya tiene pantalla: Inventario.
Eventos necesita una. Motos, FAQs, redes y cotizaciones también. Nada de eso
entra en los 15 módulos habilitados, y la instrucción fue que el sidebar tenga
solo esos 15.

1. Un módulo nuevo **"Eventos"** y otro **"Web"** (17 ítems). Lo más claro para
   el usuario final.
2. Un solo módulo **"Web"** con Eventos adentro como pestaña (16 ítems).
3. Pestañas dentro de **Configuración**, que hoy está fuera del sidebar y solo
   se alcanza por URL. Respeta los 15 pero deja la administración escondida.
