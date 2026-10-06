# Sitio web — Amigos de la Ruta

Esqueleto del sitio institucional/tienda de ADR. Vive **entero en esta carpeta**, separado
del árbol del ERP a propósito: no comparte código, layout, auth ni providers con la app.
Lo único que toca del repo son tres líneas (ver "Cómo llega a Vercel").

```
sitio-web-adr/
├── publico/            lo que se publica  ← fuente de verdad
│   ├── index.html      el sitio completo (export .dc.html de DesignCode)
│   ├── support.js      runtime dc-runtime que interpreta los tags <x-dc>. Generado, no editar.
│   └── assets/         imágenes propias del sitio
├── fuentes/            material de referencia, NO se publica: manual de identidad
│                       visual, proyecto integral y capturas
└── sync.mjs            espeja publico/ → public/sitio/
```

## Cómo llega a Vercel

Next sólo sirve estáticos desde `public/`, así que `sync.mjs` copia `publico/` a
`public/sitio/` en el `prebuild` (y en el `predev`). Ese destino está en `.gitignore`:
es generado — **editar siempre `sitio-web-adr/publico/`**, nunca `public/sitio/`.

Lo que el sitio agrega fuera de esta carpeta, y nada más:

1. `package.json` → `predev` y `prebuild` llaman a `sync.mjs`.
2. `next.config.ts` → un `rewrite` para que `/sitio` y `/sitio/` sirvan `/sitio/index.html`
   (Next, por sí solo, sólo responde a la ruta exacta del archivo).
3. `.gitignore` → ignora `/public/sitio/`.

- Local: `npm run dev` → http://localhost:3000/sitio
- Vercel: `https://<deploy>/sitio`

## Si se reemplaza el export

El export de DesignCode emite las rutas internas **relativas** (`./support.js`,
`assets/...`) y sin `<title>`. Hay que volver a pasarlas a absolutas (`/sitio/support.js`,
`/sitio/assets/...`) para que resuelvan igual con y sin barra final, y re-agregar el
`<title>` y el `<link rel="icon">`.

## Límite conocido

`support.js` descarga React 18, ReactDOM y Babel standalone desde unpkg.com y transpila el
HTML en el browser: el sitio **necesita internet** para pintar y el primer paint baja ~1 MB
de CDN. Alcanza para mostrar el esqueleto. Si pasa a producción real, conviene portar las
vistas a componentes React del propio Next y dejar de depender de unpkg.
