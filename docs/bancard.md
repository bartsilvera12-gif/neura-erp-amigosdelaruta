# Pago con tarjeta por Bancard (vPOS 2.0)

El sitio (amigos-de-la-ruta-web) cobra con tarjeta la **seña de una reserva** y el **total de un pedido de la tienda**.
El ERP es el que habla con Bancard: el sitio nunca ve la tarjeta ni decide el monto.

## Cómo funciona

1. El sitio registra la reserva (`POST /api/web/reserva`) o el pedido (`POST /api/web/pedido`), que ahora devuelven
   también su `id` (uuid).
2. Pide `POST /api/web/pago { tipo: "reserva" | "pedido", id }`. El ERP calcula el importe en guaraníes, crea la fila
   en `bancard_pago`, le pide a Bancard un `single_buy` y devuelve el `process_id`.
3. El sitio dibuja el formulario de Bancard (iframe) en un modal.
4. Bancard avisa en **`POST /api/web/pago/confirmacion`** (firma md5 verificada) y devuelve a la persona a
   `https://amigosderuta.com/?pago=<id>`. El sitio consulta `GET /api/web/pago?id=` cada 3 s; si la confirmación no
   llegó, el ERP se la pregunta a Bancard (`get_confirmation`).
5. Aprobado:
   - **reserva** → un pago en `reserva_pagos` (medio `tarjeta`, pasarela `bancard`, `pasarela_payment_id` =
     shop_process_id) y la reserva pasa de `cotizacion` a `reservada`. El saldo sale de `reserva_saldos` como siempre.
   - **pedido** → `web_pedido.pagado_at` y `pago_referencia`. Sigue `pendiente`: ADR lo confirma al armar la venta.

Acreditar es idempotente (estado `acreditando` + índice único en `reserva_pagos`).

## Montos

- Bancard cobra **solo en PYG**. Lo que está en USD se pasa con `web_config.cobro_bancard.tasa_usd_pyg`.
- Seña: `web_config.cobro_bancard.sena_usd` por reserva (nunca más que el saldo).
- El sitio lee los dos valores del catálogo, así lo que muestra es lo que se cobra. **Mantener la tasa al día.**
- Cada `bancard_pago` guarda moneda e importe de origen, tipo de cambio y monto en Gs.

## Puesta en marcha

1. **Base:** `supabase/instancia/09_bancard.sql`.
2. **Variables en Coolify:** `BANCARD_ENTORNO` (`staging` | `produccion`), `BANCARD_PUBLIC_KEY`, `BANCARD_PRIVATE_KEY`,
   `BANCARD_URL_SITIO` (adónde vuelve la persona después de pagar). Sin las cuatro el pago queda apagado y el sitio sigue
   por WhatsApp. **En staging** `BANCARD_URL_SITIO` es la web de prueba (`http://localhost:8000`, que ya está entre los
   orígenes permitidos), no amigosderuta.com: la web publicada todavía no tiene el pago con tarjeta. En producción,
   `https://amigosderuta.com`.
3. **Portal de Bancard → Perfil de aplicación → URL de confirmación:**
   `https://amigosdelaruta.neura.com.py/api/web/pago/confirmacion`.
4. Si hay Cloudflare delante del ERP, que no desafíe a esa ruta.

## Consultar y devolver un pago (admin)

`/api/web/pagos`, con sesión del ERP y acceso al módulo Web. Todavía no tiene pantalla: se llama desde la consola del
navegador estando logueado en el ERP.

```js
// los últimos 50 pagos (de acá sale el id)
await (await fetch("/api/web/pagos")).json()
// consultar en Bancard (get_confirmation)
await (await fetch("/api/web/pagos?id=<id>")).json()
// devolver (rollback): sólo el mismo día del cobro
await (await fetch("/api/web/pagos", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: "<id>", accion: "devolver" }) })).json()
```

Devolver deja el pago de la reserva en `revertido` (el saldo vuelve solo) y la reserva otra vez en `cotizacion` si no le
queda otro pago; en un pedido, saca la marca de pagado. Si Bancard ya lo pasó al extracto, la devolución se pide en el
portal de comercios (Contactá a Soporte → Solicitá Anulaciones).

## Certificación en staging (lista "Pago ocasional")

| Ítem | Cómo |
|---|---|
| Clave pública y privada | Claves → variables en Coolify |
| Url de confirmación, Logo | Perfil de aplicación |
| Cliente de prueba ejecutado | Cliente de prueba → Pago ocasional, en el portal |
| Recibir creación de pago | Abrir un pago desde la web |
| Confirmamos correctamente al comercio | Pagar con una tarjeta de prueba (pestaña Documentación) |
| Recibir rollback | Devolver ese pago aprobado (arriba) |
| Recibimos pedido de confirmación del comercio | Consultarlo (arriba) |

Con todo en verde se habilita "Solicitar certificación": Bancard hace compras de prueba en la URL que se le dé. Esa
URL **no** puede ser amigosderuta.com mientras el ERP tenga claves de staging (los pagos de mentira quedarían como
pagos reales en las reservas): hace falta una URL pública de prueba, sumada a `WEB_PUBLIC_ORIGINS`.
