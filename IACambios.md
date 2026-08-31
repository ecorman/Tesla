# IACambios.md — Modificaciones respecto al programa original (BoardingGate / tesla.html)

Este documento recoge todos los cambios realizados por la IA respecto a la versión
original de `tesla.html`, con especial detalle en las **claves de éxito** para:

1. La **eliminación de la pantalla inicial** (lanzador "BoardingGate Lanzador").
2. El **funcionamiento correcto del zoom** (globo terráqueo → posición GPS, sin volver
   al globo ni saltos al final).

---

## 1. Arranque directo al mapa (sin pantalla inicial)

### 1.1. Clase `boot-map` en el `<body>` desde el HTML

```html
<!-- ANTES -->
<body class="min-h-screen bg-[#ABAB99] flex flex-col items-center p-6">

<!-- DESPUÉS -->
<body class="min-h-screen bg-[#ABAB99] flex flex-col items-center p-6 boot-map">
```

### 1.2. CSS de `body.boot-map` (dentro del `<style>` principal, junto a `body.map-active`)

Oculta **todo el contenido del lanzador con `!important`** desde el primer frame, antes de
que cualquier JavaScript asíncrono (Firebase, `applyMainUISettings`, etc.) renderice nada:

```css
body.boot-map { background-color: #02060e !important; /* espacio */ }
body.boot-map main, body.boot-map footer, body.boot-map .notices-icon-container,
body.boot-map #grid-filter-container, body.boot-map .toggle-sign, body.boot-map .toggle-image,
body.boot-map .scroll-toggle-button, body.boot-map #bookmark-grid,
body.boot-map #config-button, body.boot-map #personal-button, /* ... resto de botones */ {
    display: none !important; visibility: hidden !important; opacity: 0 !important;
}
```

**Clave de éxito #1:** el `<body>` ya lleva la clase en el HTML, por lo que el CSS
la aplica **antes de que se ejecute cualquier JS**. No basta con añadirla desde JS
(DOMContentLoaded) porque `applyMainUISettings()` renderiza el grid y los botones
antes de `openNavigationMap()`, y esos elementos se ven durante todo el tramo asíncrono.

### 1.3. Eliminación de `boot-map` al salir

```js
function closeNavigationMap(force = false) {
    document.body.classList.remove('map-active');
    document.body.classList.remove('boot-map'); // Reaparece el lanzador al salir del mapa.
    ...
}
```

La clase solo se quita en `closeNavigationMap`, que es el único punto donde el
lanzador debe reaparecer legítimamente (botón Salir).

---

## 2. Claves de éxito del zoom (globo → posición GPS)

La transición de arranque es: **globo terráqueo (zoom 1.5) → `flyTo` con perspectiva 3D
hasta la posición GPS (zoom 15.5, pitch 62°/73°) → el bucle de cámara mantiene la vista**.
Los fallos típicos (volver al globo, saltos finales) venían de **tres variables en
conflicto** y cada uno tiene su corrección:

### 2.1. `updateMapCamera` NUNCA toca `targetMapZoom` mientras `isFlying`

En `updateMapCamera()` (función que recalcula el objetivo de cámara en cada tick GPS):

```js
// Durante la transicion inicial (isFlying), NUNCA sobrescribir targetMapZoom:
// getZoom() capturaria la vista mundial (1.5) y el bucle arrastraria al globo.
if (isFlying) {
    // No tocar el objetivo; el flyTo inicial lo controla.
} else if (targetZoom !== null) {
    markerAnimationState.targetMapZoom = targetZoom;
} else {
    const currentTargetZoom = markerAnimationState.targetMapZoom;
    if (currentTargetZoom == null || currentTargetZoom <= 0) {
        markerAnimationState.targetMapZoom = mapInstanceToUse.getZoom();
    }
}
```

**Clave de éxito #2 (la más importante):** durante el `flyTo`, `getZoom()` devuelve el
zoom **actual de la animación** (p.ej. 1.5 al principio). Si `updateMapCamera` ejecuta
`targetMapZoom = getZoom()` en ese momento, el objetivo queda en 1.5 y el bucle
`animateMarkerAndMap` hace lerp de vuelta al globo en los segundos siguientes.
Este fue el bug del "vuelve a la vista global a los pocos segundos".

Además, en el caso sin `isFlying`, si ya existe un objetivo válido (> 0) **no se
sobrescribe con `getZoom()`**: se mantiene el objetivo existente.

### 2.2. `isFlying` se libera por `setTimeout`, no por `moveend`

El `jumpTo` inicial (que sitúa el mapa en la vista mundial antes del `flyTo`) dispara un
evento `moveend` **inmediato y espurio**. Un listener `once('moveend')` se consume con ese
evento y nunca captura el `moveend` real del `flyTo`. Enfoque determinista:

```js
isFlying = true;
// flyTo con perspectiva 3D (duración 1800ms)
navigationMapInstance.flyTo({ center, zoom: 15.5, pitch, bearing, duration: 1800, essential: true });
// Liberar con timeout = duración + margen (NO con moveend, que el jumpTo contamina)
setTimeout(() => {
    if (!navigationMapInstance) return;
    isFlying = false;
    markerAnimationState.currentMapCenter = navigationMapInstance.getCenter();
    markerAnimationState.currentMapZoom = navigationMapInstance.getZoom();
    markerAnimationState.currentMapPitch = navigationMapInstance.getPitch();
    markerAnimationState.currentMapBearing = navigationMapInstance.getBearing();
}, 1900);
```

**Clave de éxito #3:** no depender de `moveend` en el arranque. Mientras `isFlying`
sea `true`, el bucle `animateMarkerAndMap` retorna temprano y no pisa el `flyTo`.

### 2.3. El `flyTo` usa la misma matemática de anclaje que el bucle (sin salto final)

El bucle de cámara centra la cámara **no en el coche, sino en un ancla desplazada**
por `mapOffsetX/Y` (posición del coche en pantalla) y el pitch. Si el `flyTo` inicial
centra en el punto GPS "pelado", al entregar el control al bucle hay un micro-salto.
Solución: calcular el ancla con la misma fórmula del bucle antes de volar:

```js
const pitchRad = (initialViewOptions.pitch * Math.PI) / 180;
const cameraHeightAboveCar = 150;
const verticalOffsetFactor = mapOffsetY / 100;
const groundDistanceOffset = (cameraHeightAboveCar * Math.tan(pitchRad)) * verticalOffsetFactor * -1;
const metersPerPixelBoot = 156543.03 * Math.cos(currentPos.latitude * Math.PI/180) / Math.pow(2, initialViewOptions.zoom);
const pixelOffsetXBoot = navigationMapInstance.getCanvas().clientWidth * (mapOffsetX / 100);
const horizontalDistanceOffset = metersPerPixelBoot * pixelOffsetXBoot * -1;
const totalDistanceBoot = Math.sqrt(groundDistanceOffset**2 + horizontalDistanceOffset**2);
const angleAdjustmentBoot = Math.atan2(horizontalDistanceOffset, groundDistanceOffset) * (180/Math.PI);
const bootCameraAnchor = turf.destination(_turfCarPointForAnimation, totalDistanceBoot/1000,
    (initialViewOptions.bearing||0) - 180 + angleAdjustmentBoot, { units: 'kilometers' });
navigationMapInstance.flyTo({ center: bootCameraAnchor.geometry.coordinates, ... });
```

**Clave de éxito #4:** el punto de aterrizaje del `flyTo` y el punto de partida del
bucle deben ser **el mismo cálculo**. Si difieren aunque sea un píxel, se ve un salto.

### 2.4. Pitch 3D respetado en la transición

Se eliminó el `initialViewOptions.pitch = 0;` forzado que anulaba el modo 3D:

```js
// ANTES: const initialViewOptions = {...}; ... initialViewOptions.pitch = 0;  // forzado
// AHORA:
if (mode === 'perspective' || mode === 'relief') { initialViewOptions.pitch = mapPitchValue; }
```

**Clave de éxito #5:** no forzar `pitch = 0` después de calcularlo del modo activo.
Con `mapViewMode` = relief/perspective (62°/73°), la transición globo→posición se hace
con perspectiva real.

### 2.5. Objetivos apuntados a la posición GPS ANTES de volar

```js
markerAnimationState.targetMapCenter = { lng, lat };   // posición GPS
markerAnimationState.targetMapZoom  = initialViewOptions.zoom;  // 15.5
markerAnimationState.targetMapPitch = initialViewOptions.pitch || 0;
markerAnimationState.targetMapBearing = initialViewOptions.bearing || 0;
```

**Clave de éxito #6:** fijar los objetivos ANTES de `flyTo` y no sincronizarlos después
con `getZoom()` (que capturaría valores intermedios de la animación).

### 2.6. Marcador del coche centrado en el punto GPS

```js
// ANTES: anchor: 'top'   → punta de la flecha en el punto, coche desplazado encima
// AHORA: anchor: 'center' → el CENTRO del coche coincide con el punto GPS
initialUserLocationMarker = new mapboxgl.Marker({
    element: vehicleIconElement,
    rotationAlignment: 'map',
    anchor: 'center'
}).setLngLat(lngLat).addTo(mapInstanceToUse);
```

---

## 3. Motor de mapa: Google Satélite raster (sin 403 de Mapbox)

El token de Mapbox devolvía `403` en teselas satélite **y** streets
(`mapbox.satellite`, `mapbox-streets-v8`, `terrain-rgb`). El mapa se quedaba negro.

```js
const GOOGLE_RASTER_STYLE = {
    version: 8,
    sources: {
        'google-satellite': {
            type: 'raster',
            tiles: ['https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'],
            tileSize: 256, attribution: '© Google'
        }
    },
    layers: [{ id: 'google-satellite-layer', type: 'raster', source: 'google-satellite' }]
};
```

Otros cambios relacionados:

- **Proyección globe por API, no en el estilo:**
  `navigationMapInstance.setProjection('globe')` con try/catch (poner `projection` en el
  objeto de estilo hacía petar el validador de Mapbox GL: `validate_projection`).
- **DEM/Terrain de Mapbox desactivado** (devolvía 403): `configureMapAtmosphere` ya no
  crea `mapbox-dem` ni `setTerrain`; solo aplica `setFog` con espacio oscuro + estrellas:
  `space-color: #02060e`, `star-intensity: 0.5`.
- **CSP única** compatible con Mapbox/Google/Firebase (se eliminó la cabecera duplicada
  y el segundo DOCTYPE/`<html>` que existían en el archivo).
- **Tailwind CDN eliminado** (`cdn.tailwindcss.com` no debe usarse en producción).
- **Favicons externos eliminados** (peticiones a `t*.gstatic.com/faviconV2` y
  `via.placeholder.com` generaban errores; ahora se usa favicon local `./PNG/IMG_4172.png`
  como fallback y `onerror` oculta la imagen).

---

## 4. GPS: solicitud explícita al abrir el mapa

- Al abrir el mapa se muestra un overlay visible "Solicitando ubicación GPS…" y se llama
  a `getCurrentPosition` con `enableHighAccuracy: true, timeout: 20000, maximumAge: 0`.
- Si el GPS falla (permiso denegado, sin señal, timeout), el mapa **carga igualmente**
  usando la última posición conocida (del recovery flag) o Madrid como fallback.
- Los errores muestran el motivo concreto (permiso denegado / no disponible / timeout).
- El seguimiento continuo (`watchPosition`) se inicia después de obtener la primera
  posición, con reintentos cada 5s y aviso de error persistente tras 10 intentos.
- **Nota operativa:** el permiso lo controla el navegador del Tesla. Si se denegó varias
  veces, Chrome lo bloquea; hay que restablecerlo en el icono de ajustes junto a la URL.

---

## 5. Menú de voces (TTS) — sin dependencias externas

Menú con tres modos (`VOICE_MODE_KEY` en localStorage):

- **Silencio:** sin voz ni sonidos.
- **Avisos:** sonidos distintivos por tipo de indicación (giro, rotonda, radar, salida,
  llegada…). Los sonidos se generan con Web Audio API (osciladores, patrones distintos
  por tipo de aviso) — en el navegador del Tesla el TTS no funciona, solo los pitidos.
- **Voz:** selección de motor de voz configurable (`VOICE_ENGINE_KEY`). El motor real
  queda pendiente de encontrar uno compatible con el navegador del Tesla.

---

## 6. Menú rápido de enlaces dentro del mapa (`openQuickLauncher`)

Nueva función + botón `#quick-launcher-button` en la cabecera del mapa:

- **Navegación por secciones arriba**: pestañas generadas desde `currentToggleRanges`
  (etiquetas reales: PdR's, iAs, Útil, Varios + "General" con los marcadores fuera de
  sección). Colores reutilizados de `sectionColors`.
- **Links grandes en 2 columnas**: tarjetas con favicon 52px y nombre grande
  (`.ql-link`, grid `1fr 1fr`).
- Los enlaces usan `currentBookmarks` → cualquier edición del grid del lanzador se
  refleja automáticamente, sin configuración adicional.
- Abre en pestaña nueva (`_blank`), auto-cierre a 2 min, toggle al pulsar de nuevo.

---

## 7. Otros ajustes

- `isMobileSession = false` en arranque sin cuenta: elimina la rama de sincronización
  Firebase móvil (carga local directa, más rápida).
- Ocultación defensiva de `main`/`footer` en el handler `DOMContentLoaded`.
- Toggle de vocabulario: el menú de secciones del lanzador sigue funcionando igual;
  el grid original permanece intacto para la pantalla principal.

---

## 8. Resumen de claves de éxito

| # | Clave | Efecto |
|---|-------|--------|
| 1 | `boot-map` en el `<body>` del HTML + CSS `!important` | Lanzador invisible desde el primer frame |
| 2 | `updateMapCamera` no toca `targetMapZoom` si `isFlying` | Evita el retorno al globo |
| 3 | Liberar `isFlying` con `setTimeout` (no `moveend`) | El jumpTo no corta el flyTo |
| 4 | `flyTo` con la misma matemática de anclaje que el bucle | Sin salto final |
| 5 | No forzar `pitch = 0` en la transición | Perspectiva 3D real |
| 6 | Fijar objetivos (center/zoom/pitch/bearing) antes de volar | Bucle coherente con el flyTo |
| 7 | `anchor: 'center'` en el marcador del coche | Centro del coche = punto GPS |
| 8 | Estilo raster Google + `setProjection('globe')` por API | Mapa sin 403 y globo redondo |
| 9 | GPS con fallback (última posición conocida) | El mapa carga aunque falle el GPS |

## 9. Logs de depuración añadidos (temporales, para diagnóstico)

- `[BOOT-FLY]` — inicio y fin del flyTo de arranque (zoom/pitch/ancla).
- `[CAM-LOG]` — cada decisión de `updateMapCamera` (isFlying, targetZoom, getZoom…).
- `[ANIM-LOG]` — cuando el bucle aplica un jumpTo con zoom bajo o desviado del objetivo.

Se pueden eliminar cuando se considere el arranque estable.

---

## 10. Zoom automático durante la simulación de ruta

`handleAutoZoom()` y `processRouteProgress` estaban bloqueados por `isNavigating`, de modo
que la simulación automática de ruta quedaba clavada en el zoom de arranque (15.5) y el
turn-by-turn no avanzaba. Ahora ambos aceptan la simulación activa
(`isSimulatingGpsLocation && automatedSimulationIntervalId`) como equivalente a navegación:
el zoom por velocidad (eco 18.8–16.3 / route 14.5 / auto 18.7–16.3) y el zoom por maniobra
funcionan igual que en navegación real.

## 11. Menú rápido de enlaces y `boot-map` (corrección de visibilidad)

El panel `#quick-launcher-panel` se añade a `document.body`, por lo que el CSS
`body.boot-map { ... display:none !important }` lo ocultaba al reabrirlo tras volver del
lanzador (la clase `boot-map` solo se elimina en `closeNavigationMap`). Correcciones:

- `body.boot-map #quick-launcher-panel` añadido explícitamente a la lista de ocultos
  (el panel debe ocultarse durante el arranque y ser visible una vez quitada la clase).
- `renderGrid()` retorna temprano si `body` tiene `boot-map` (defensivo: nunca renderiza
  el grid del lanzador durante el arranque directo al mapa).
- `openNavigationMap` retira `boot-map` al abrir el mapa (si no, el panel de enlaces
  permanecía oculto incluso después del arranque).
- `closeNavigationMap` retira también cualquier panel quick-launcher residual.

## 12. Selector de fondo de mapa / estilos (corrección 403)

El selector "Ajustes de mapa" aplicaba URLs `mapbox://styles/...` (HÍBRIDO, SATÉLITE,
CALLES) que devuelven **403** con el token actual → mapa negro y sensación de que "el
proveedor inicial desapareció del listado". Correcciones:

- `updateStyle()` ahora siempre aplica `GOOGLE_RASTER_STYLE` (raster Google satélite, el
  único proveedor que funciona) en vez de una URL 403.
- Opción **GOOGLE** añadida a `baseMapOptions` para poder re-seleccionar/restaurar
  explícitamente el proveedor raster que funciona.
- El estilo inicial del constructor sigue siendo `GOOGLE_RASTER_STYLE` (sin cambios).
- El modal del mapa también recibe `classList.remove('hidden')` al abrirse en frío
  (defensa contra un estado `.hidden` residual).

## 13. Lanzador de salida por secciones (una fuente de datos, dos renderers)

Al pulsar **Salir** ahora se muestra una versión por secciones del lanzador, con el mismo
estilo que el panel rápido del mapa (pestañas de sección arriba + tarjetas grandes en
2 columnas), en lugar del grid clásico de 96 celdas:

- Contenedor `#launcher-sectioned-container` junto a `#bookmark-grid`; la clase
  `body.sectioned-launcher` oculta el grid y muestra el contenedor por secciones.
- `renderSectionedLauncher()` construye las secciones desde **la misma fuente de datos**
  que `openQuickLauncher()` (`currentBookmarks` + `currentToggleRanges` +
  `sectionColors`). Cualquier edición en cualquiera de los dos sitios queda sincronizada.
- `renderGrid()` llama a `renderSectionedLauncher()` al final, así siempre está al día.
- `closeNavigationMap` añade `sectioned-launcher` (Salir → vista por secciones);
  `openNavigationMap` la retira.
- El grid original permanece intacto en el DOM para modos de edición/personalización.

## 14. Audio de guía: volumen reforzado, pitido de rotonda y motor de voz por clips (WAV offline)

- **Pitido más fuerte**: `beep()` ahora aplica un master gain de refuerzo (x4) y una
  envolvente sostenida (el pico de volumen se mantiene durante casi todo el pitido en
  lugar de decaer desde el inicio), de modo que los avisos sonoros se oyen bien sobre
  el motor del coche.
- **Pitido distintivo para salida de rotonda**: nuevo caso `roundabout-exit` en
  `playAlertSound()` (triple tono sube-baja, inconfundible) y nueva lógica
  `isRoundaboutExit` en el bucle de avisos por distancia que sustituye los tonos
  far/medium/near por el pitido de rotonda cuando la maniobra es una salida de
  rotonda/rotary (distancias de 2 km, 500 m y 200 m).
- **Motor de voz por clips pre-generados (compatible Tesla)**: nueva opción `clips`
  en el selector de motor de voz. Genera clips WAV PCM 16-bit 16 kHz en memoria
  (sin archivos externos ni red) y los reproduce con Web Audio (`decodeAudioData`),
  sin depender de SpeechSynthesis, ausente o mudo en el WebView de Tesla. La interfaz
  `NAV_CLIPS` (frase -> AudioBuffer cacheada) permite sustituir los clips sintetizados
  por MP3 reales sin tocar el resto del código. Los clips se eligen por palabras clave
  del texto (rotonda, izquierda, derecha, destino...) con prefijo de distancia
  (2 km / 500 m / ahora).
