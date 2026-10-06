# Sitio web público — Amigos de la Ruta

Esqueleto del sitio institucional/tienda de Amigos de la Ruta, integrado al repo del ERP
para poder desplegarlo en Vercel junto con la app.

## Dónde vive

| Ruta | Qué es |
| --- | --- |
| `public/sitio/index.html` | El sitio completo. Export `.dc.html` (origen: `Sitio Web ADR.dc.html`). |
| `public/sitio/support.js` | Runtime `dc-runtime` que interpreta los tags `<x-dc>` del HTML. Generado, no editar a mano. |
| `public/sitio/assets/` | Imágenes propias del sitio (emblema ADR). |
| `docs/sitio-web-adr/fuentes/` | Material fuente que **no** se publica: manual de identidad visual, el proyecto integral y las capturas de referencia. |

## Cómo se sirve

Es estático: no es un route de Next, no pasa por el layout, la auth ni los providers del
ERP. Next publica `public/` tal cual, y un `rewrite` en `next.config.ts` hace que además
de `/sitio/index.html` funcionen `/sitio` y `/sitio/`.

- Local: `npm run dev` → http://localhost:3000/sitio
- Vercel: `https://<deploy>/sitio`

Las rutas internas del HTML son **absolutas** (`/sitio/support.js`, `/sitio/assets/...`)
para que resuelvan igual con o sin barra final. Si se reemplaza el export por una versión
nueva de DesignCode, hay que volver a absolutizar esas dos rutas (el export las emite
relativas) y re-agregar el `<title>`.

## Dependencias en runtime

`support.js` descarga React 18, ReactDOM y Babel standalone desde unpkg.com y transpila el
HTML en el browser. O sea: el sitio **necesita internet** para pintar, y el primer paint
carga ~1 MB de CDN. Está bien para mostrar el esqueleto; si pasa a producción real conviene
portar las vistas a componentes React del propio Next y dejar de depender de unpkg.
