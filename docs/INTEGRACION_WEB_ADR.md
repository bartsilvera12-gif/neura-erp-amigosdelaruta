# Integración ERP ↔ sitio web de Amigos de la Ruta

Une [`amigos-de-la-ruta-web`](https://github.com/bartsilvera12-gif/amigos-de-la-ruta-web)
(estático, Vercel) con este ERP (Next + Supabase, Coolify). Hoy no comparten nada.

## Punto de partida

**La web** es un `index.html` de 2421 líneas con runtime propio (`support.js`,
tags `<x-dc>`, React por unpkg). Todo el contenido son constantes JS:

| Constante | Qué es | Tamaño |
|---|---|---|
| `EVENTS` | viajes/rallies con hotel, recorrido, precios, copy es/pt/en | 6 |
| `PRODUCTS` | tienda: SKU, precio, talles, specs, copy es/pt/en | 8 |
| `MOTOS` | motos del club | 4 |
| `FAQS` | preguntas frecuentes | 10 |
| `ENCUENTROS` | encuentros | 3 |
| `REDES`, `WHATSAPP`, `MEDIOS_PAGO`, `COTIZACIONES`, `DEPOSIT` | configuración | — |

El propio código deja la nota: *"El pliego las pide administrables; hasta que
exista el CMS del ERP, este objeto es el lugar donde se administran."*

Las acciones del usuario (`submitBooking`, el carrito) arman un texto y abren
`wa.me`. **No queda registro de ninguna inscripción ni pedido.**

**El ERP** no tiene superficie pública: las ~50 rutas de `src/app/api` piden
sesión y no hay CORS configurado.

## Decisiones de diseño

### 1 · La tienda usa `productos`, con una tabla de copy al lado

`productos` ya tiene `sku`, `precio_venta`, `stock_actual`, `imagen_url`,
`categoria_principal_id`, y lo administra Inventario, que es uno de los 15
módulos habilitados. Pero no tiene nada multilingüe, ni talles, ni specs.

Entonces: el **dato comercial** vive en `productos` (fuente de verdad de precio
y stock) y el **copy de la tienda** en `web_producto`, con FK a `productos.id`.
Un producto sin fila en `web_producto` simplemente no se publica.

| Campo web | Dónde va |
|---|---|
| `sku`, `price` | `productos.sku`, `productos.precio_venta` |
| `img` | `productos.imagen_url` |
| `low` (poco stock) | se calcula de `productos.stock_actual` vs `stock_minimo` |
| `name`, `desc`, `variants`, `specs` (es/pt/en) | `web_producto.copy` jsonb |
| `sizes`, `rank`, `c` (categoría visual) | `web_producto.talles`, `.orden`, `.categoria_web` |

### 2 · Los viajes son tabla nueva, no productos

Un viaje tiene hotel, itinerario, recorrido, salidas múltiples y copy en tres
idiomas. Forzarlo dentro de `productos` sería pelearse con el modelo. Va en
`web_evento`, con un `producto_id` opcional por si más adelante se quiere
facturar la seña como producto.

### 3 · Un pedido web NO es una venta todavía

Tentador mandarlo directo a `ventas`, pero una venta en este ERP es una
operación cerrada: descuenta stock y entra en los reportes. Un pedido web es una
solicitud sin confirmar, y si entra directo a `ventas` ensucia Ventas con
pedidos que nunca se concretan y abre una carrera por el stock.

Entonces: el pedido entra en `web_pedido` + `web_pedido_item` con estado
`pendiente`. Cuando ADR lo confirma desde el ERP, **ahí** se genera el cliente,
la venta y el movimiento de stock, reusando el flujo que ya existe.

Lo mismo con las inscripciones a viajes: `web_inscripcion` con estado.

### 4 · El contacto con el ERP es por API propia, no por Supabase directo

La alternativa era que la web escriba a Supabase con la anon key y políticas RLS
de inserción pública. Se descarta: obliga a abrir `INSERT` público sobre tablas
del ERP y cualquier error en una policy queda expuesto en una página estática.

En su lugar, tres endpoints en el ERP, con CORS restringido al dominio de la web:

| Endpoint | Para qué |
|---|---|
| `GET /api/web/catalogo` | todo el contenido publicado, en un solo JSON cacheable |
| `POST /api/web/inscripcion` | inscripción a un viaje |
| `POST /api/web/pedido` | pedido de la tienda |

Los POST llevan rate limit por IP, honeypot y tope de tamaño. No exponen nada
del ERP: solo escriben en las tablas `web_*`.

### 5 · La web nunca se queda en blanco

El fetch al catálogo va con fallback a las constantes actuales. Si el ERP está
caído o el deploy del ERP falla, el sitio sigue mostrando contenido en vez de
secciones vacías. Las constantes dejan de ser la fuente de verdad pero quedan
como red de seguridad.

## Tablas nuevas, todas en `amigosdelarutaerp`

```
web_producto      copy de tienda           → FK productos(id)
web_evento        viajes y rallies         → FK opcional productos(id)
web_moto          motos del club
web_faq           preguntas frecuentes
web_encuentro     encuentros
web_config        clave/valor: redes, whatsapp, medios de pago, cotizaciones, seña
web_inscripcion   lo que entra del form de viajes
web_pedido        cabecera de pedido de tienda
web_pedido_item   líneas del pedido        → FK productos(id)
```

Todas con `empresa_id`, RLS por `public.puede_acceder_empresa` y el prefijo
`web_` para que se distingan de las tablas del repo madre y no choquen con una
migración futura de allá.

## Lo que falta decidir

**Dónde edita ADR este contenido.** Productos ya tiene pantalla: Inventario.
Pero viajes, motos, FAQs, redes y cotizaciones no entran en ninguno de los 15
módulos habilitados, y la instrucción fue que el sidebar tenga solo esos 15.

Opciones:

1. Un módulo nuevo **"Web"** (16 ítems en el sidebar) con pestañas para viajes,
   motos, FAQs y configuración. Es lo más claro para el usuario final.
2. Meterlo como pestañas dentro de **Configuración**, que hoy está fuera del
   sidebar y solo se alcanza por URL. Respeta los 15 ítems pero deja la
   administración escondida.
3. Sin pantalla: el contenido se edita por SQL. Descarta el punto del pliego
   sobre que sea administrable.

## Orden de trabajo

1. Migración con las tablas `web_*` → `supabase/instancia/05_web_adr.sql`
2. Script que extrae las constantes de `index.html` y genera el seed, para no
   transcribir 24 KB de contenido a mano y poder repetirlo si la web cambia
3. Endpoints `GET /api/web/catalogo`, `POST /api/web/inscripcion`, `POST /api/web/pedido`
4. Pantalla de administración (según lo que se decida arriba)
5. Cambios en la web: fetch con fallback, y `submitBooking` posteando al ERP
6. Confirmación de pedido en el ERP → cliente + venta + stock
