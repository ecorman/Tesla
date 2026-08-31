# Security & Privacy Analysis — BoardingGate (tesla.html)

Fecha: 2026-08-30 (re-audit after GitHub resync)
Alcance: revisión estática de `tesla.html` (26.389 líneas, app web BoardingGate para Tesla).

## 1. Superficies de tracking / publicidad eliminadas

| Eliminado | Riesgo que tenía |
|---|---|
| **StatCounter** (`statcounter.com/counter/counter.js`, proyecto `13126275`) | Analytics de terceros cargado vía `document.write` en cada visita — registraba IP, user-agent, página de referencia y sesión completa, con acceso total al DOM de la app (GPS, rutas, búsquedas). Eliminado del footer y de la CSP. |
| **Google Fonts** (`fonts.googleapis.com` + `@import` de Noto Color Emoji en el modal) | Vector clásico de *fingerprinting*: cada petición de fuente filtra IP, navegador y tiempos de carga a Google. Sustituido por la pila de fuentes del sistema. |
| `translate.google.com` en la CSP | Ya no hay uso legítimo; se elimina de la allow-list para que el navegador bloquee cualquier intento futuro. |
| Referidos/enlaces de afiliado | Enlaces de marketing eliminados del pie de página. |

## 2. Protecciones añadidas

1. **Content-Security-Policy** (meta tag) con allow-list estricta:
   - `script-src`: solo los CDN de librerías (unpkg, jsdelivr, mapbox, Google Maps, gstatic, tailwindcss, html2canvas) + `'unsafe-eval' blob:` requeridos por Mapbox GL.
   - `worker-src 'self' blob:` — necesario para el worker de renderizado de Mapbox GL (lección de la sesión anterior: sin esto el mapa muere en silencio).
   - `img-src` / `connect-src`: allow-list cerrada de tiles y APIs (OSM, Carto, Stamen, Esri, Google, OpenFreeMap, OSRM, Nominatim, Geoapify, Firebase).
   - `frame-src 'none'`, `object-src 'none'`, `form-action 'none'`, `base-uri 'self'`.
2. **Política de referer `no-referrer`** (meta) — la URL de la página nunca viaja a los servidores de tiles/API de terceros.
3. **SRI (Subresource Integrity) + `crossorigin`** en los 4 scripts de CDN (turf, chart.js, driver.js, mapbox-gl): si el CDN es comprometido, el navegador rechaza el script en lugar de ejecutarlo.

## 3. Endpoints restantes (todos funcionales y necesarios)

| Endpoint | Propósito | Datos enviados |
|---|---|---|
| `router.project-osrm.org` / `routing.openstreetmap.de` | Cálculo de rutas | Coordenadas de origen, etapas y destino |
| `nominatim.openstreetmap.org` / `photon.komoot.io` | Búsqueda de direcciones y geocodificación inversa | Texto de búsqueda o coordenadas |
| `api.openchargemap.io` / `overpass-api.de` | Puntos de recarga / POIs | Consulta geográfica |
| Tiles: `tile.openstreetmap.org`, `basemaps.cartocdn.com`, `stamen-tiles.a.ssl.fastly.net`, `server.arcgisonline.com`, `mt1.google.com`, `tiles.openfreemap.org` | Teselas del mapa | Coordenadas de tesela (x/y/z) |
| `api.mapbox.com` / `maps.googleapis.com` | Mapbox GL JS + Google Maps JS API (token vía `window.APP_CONFIG.keys`) | Petición estándar de CDN/API |
| `www.gstatic.com` (Firebase JS SDK) | Sincronización de backup en la nube (Firestore) | Datos que el usuario elige sincronizar |
| `unpkg.com` / `cdn.jsdelivr.net` / `cdn.tailwindcss.com` / `html2canvas.hertzen.com` | Librerías de front-end (fijadas con SRI donde aplica) | Petición estándar de CDN |

## 4. Modelos Google/Firebase/mapas mantenidos

- **Firebase (Firestore + Firebase JS SDK v11.9.1)** — backup y sincronización en la nube, intacto. Config se inyecta vía `window.APP_CONFIG.firebase` (en `PNG/zbuildgs.js`).
- **Google Maps JS API** — carga dinámica vía `maps.googleapis.com` con la key de `window.APP_CONFIG.keys.googleMaps`.
- **Google Maps tiles** (`mt1.google.com/vt`) para el proveedor de mapa Google.
- **Mapbox GL JS** (v3.26.0) + token en `window.APP_CONFIG.keys.mapbox`.
- Todo el flujo de rutas/indicaciones (OSRM/OSM.DE) sigue intacto.

## 5. Riesgos de seguridad detectados en el código

1. **Claves API embebidas en `PNG/zbuildgs.js`** (ofuscado): Google Maps, Mapbox, OpenChargeMap y Gemini viajan al cliente. Es un patrón común pero implica que cualquiera puede extraerlas y gastar la cuota. Mitigación: restricción por referrer/dominio en cada consola de proveedor + cuotas y alertas de gasto.
2. **`document.write`** se usa en varios puntos (patrón antiguo). Ya no se usa para trackers, pero sigue siendo un vector clásico de inyección si se llega a concatenar entrada de usuario. Recomendación: sustituir por `createElement`/`appendChild`.
3. **CSP con `'unsafe-inline'` + `'unsafe-eval'`** — necesario porque toda la lógica vive inline y Mapbox GL necesita eval. Extraer el JS a un archivo externo permitiría eliminar `'unsafe-inline'`.
4. **Búsquedas recientes en `localStorage` sin expiración** — cualquiera con acceso al dispositivo puede leer los destinos frecuentes. Recomendado: botón de "borrar historial".
5. **Sin degradación si los servicios públicos caen** — no hay caché de rutas offline ni proveedor alternativo autenticado.
6. **Sin `eval` directo, `new Function` ni cargas dinámicas de scripts controladas por entrada de usuario** — verificado. Buena base contra inyección de código.

## 6. Conclusión

Los vectores de tracking/publicidad activos (StatCounter) y los vectores de fingerprinting pasivo (Google Fonts) están eliminados, y la CSP bloquea que reaparezcan de forma accidental. Los endpoints restantes son el mínimo necesario para mapas, rutas, geocodificación, POIs y backup en la nube, y son servicios abiertos/gratuitos o infraestructura propia del usuario (Firebase) en lugar de intermediarios con modelo de negocio publicitario.
