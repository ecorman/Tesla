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

## 15. Nuevo punto de entrada `nav.html` — navegación limpia y configurable

Se crea un archivo nuevo, independiente de `tesla.html`, con solo lo esencial:

- **Proveedor del mapa**: Mapbox (vector, soporta edificios 3D) u OpenStreetMap /
  Esri World Imagery (raster, sin token).
- **Estilo**: Calles / Oscuro / Satélite / Satélite+Calles.
- **Edificios 3D** on/off (solo con proveedor Mapbox).
- **Proveedor de rutas**: OSRM (`router.project-osrm.org`, gratis, sin key) o
  Mapbox Directions. Respaldo automático si falla el primario.
- **Geocodificado**: Nominatim (gratis) con autocompletado al escribir el destino.
- **Navegación turn-by-turn**: banner de maniobra (distancia / instrucción / ETA),
  recálculo automático al desviarse > 70 m, línea de ruta en el mapa.
- **Voz y sonidos**: los mismos motores que `tesla.html` — pitidos far/medium/near/
  roundabout-exit/arrive/reroute + motor de voz TTS nativo o clips WAV pre-generados.
- **Posición del coche en pantalla**: dos deslizadores simples con porcentajes
  (X: 0=izquierda → 100=derecha; Y: 0=abajo → 100=arriba), guardados en
  localStorage junto al resto de ajustes.
- Todos los ajustes se guardan en localStorage con prefijo `nav_`.

## 16. `nav.html` — animación de arranque estilo Tesla (globo → posición)

La transición inicial en `nav.html` era un `easeTo` **lineal** (duración 1500 ms,
`easing: t => t`) del globo terráqueo a la posición GPS: se percibía brusco y sin
perspectiva durante el vuelo. Se copia la animación de arranque de `tesla.html`
(IACambios.md §2):

- **`flyTo` con perspectiva 3D** (duración 1800 ms, `essential: true`) en lugar de
  `easeTo` lineal. El `flyTo` de Mapbox usa su easing por arco (zoom out → zoom in),
  mucho más fino — es la misma sensación que el arranque de `tesla.html`.
- **Cámara inicial = cámara Tesla**: zoom por defecto 15.5 (antes 16) y pitch 62°
  (antes 55°) — vista cercana al coche con perspectiva 3D real.
- **Guardia `isFlying`**: mientras dura el `flyTo`, `updateCamera()` (el bucle de
  seguimiento GPS) y `syncCam()`/`btn-center` NO tocan la cámara. Igual que en
  `tesla.html` (claves de éxito §2.1/§2.2): un `easeTo` disparado durante el vuelo
  con el zoom intermedio capturado arrastraría de vuelta al globo.
- **Liberación por `setTimeout`** (duración + 100 ms de margen), NO por `moveend`:
  el arranque dispara `moveend` espurios que consumirían un listener `once`.
- El objetivo (center/zoom/pitch/bearing) se fija ANTES de volar y no se vuelve a
  leer de `getZoom()` durante la animación.

El resultado: globo terráqueo → arco de descenso con perspectiva creciente →
aterrizaje suave en la posición GPS con el pitch/zoom configurados, y el bucle de
seguimiento retoma el control sin saltos.

## 17. `nav.html` — arreglo: no salían las indicaciones de la ruta (y ajustes de cámara)

### 17.1 Las indicaciones turn-by-turn no aparecían

`calcRoute()` llamaba a `updateBanner()` justo antes de `startNavLoop()`, pero esa
función **no existía** en `nav.html`. El `ReferenceError` resultante cortaba
`calcRoute()` en seco: el banner se mostraba (display:flex ya aplicado), pero el
bucle `navTick()` nunca arrancaba — ni distancia, ni instrucción, ni ETA, ni voz.

- **Solución**: eliminar la llamada a `updateBanner()`. El primer `navTick()`
  (1 s) rellena el banner y avanza la maniobra, igual que el bucle de `tesla.html`.
  El script completo se validó con un parseo sintáctico (sin errores).

### 17.2 El recálculo por desvío no funcionaba (umbral mal calculado)

En `navTick()`, la distancia al punto más cercano de la ruta se calculaba como
**cuadrado de grados** (`dx²+dy²`) pero se comparaba contra `0.0007` — el comentario
decía "~70 m" cuando en realidad 0.0007 grados² ≈ **2,9 km** al ecuador. El coche
podía desviarse cientos de metros sin recálculo.

- **Solución**: `minD` ahora se calcula con `haversine()` (metros reales) y el
  umbral es `>70` m. Se corrige también la errata "recalculateando…" →
  "recalculando…".

### 17.3 Arranque: sin doble offset en el flyTo

Se descarta el ancla de cámara manual del arranque: `nav.html` ancla el coche con
`setPadding` (`applyCarPadding`, carX/carY), así que el `flyTo` apunta a
`center: userPos` — Mapbox lo pinta exactamente en la posición de pantalla
configurada (misma convención que `updateCamera()`). Sumarle un offset manual
habría descentrado el coche hasta el primer fix de GPS.

- **Mejora**: al liberar `isFlying` (setTimeout), se llama una vez a
  `updateCamera()` para asentar la cámara sobre el coche y corregir cualquier
  desviación residual del aterrizaje.

---

## 18. Motor de voz nuevo: Google TTS online (MP3 por `<audio>`)

### 18.1 El problema: la voz no sonaba en el navegador del Tesla

Los motores anteriores dependían de recursos que **el navegador del Tesla no
proporciona de forma fiable**:

- **TTS nativo** (`speechSynthesis`): en el navegador del coche
  `getVoices()` devuelve una lista vacía (no hay voces instaladas) y `speak()`
  no emite nada.
- **Clips WAV / Web Audio** (`AudioContext`): funciona en muchos casos, pero
  el WebView del Tesla puede dejar el contexto en `suspended` si no hay un
  gesto del usuario previo, y los clips sintetizados suenan robóticos.

### 18.2 La solución adoptada (según experiencia de otros usuarios)

Lo que la comunidad de apps de navegación web en el Tesla confirma que funciona
es **reproducir un MP3 real por el pipeline de audio normal del navegador**
(elemento `<audio>`), el mismo que usan los vídeos/streaming. El nuevo motor
**“Google TTS online”** genera el MP3 al vuelo con el endpoint TTS de Google
(`translate.google.com/translate_tts`, gratuito y sin API key) y lo reproduce
con un `Audio()` reutilizable:

- **Motor nuevo `online`** en `nav.html` y `tesla.html` (`speakOnline()`):
  construye la URL del TTS con el texto de la maniobra (máx. 180 caracteres),
  corta cualquier reproducción anterior y lanza `audio.play()`. Si no hay red
  o el navegador bloquea el autoplay, cae al pitido (`alertSound('info')`).
- **Desbloqueo por gesto** (`unlockAudioOnGesture`): al primer toque/pulsación
  se crean y reanudan los `AudioContext` (pitidos y clips) y se reproduce un
  WAV mudo, lo que habilita el audio en navegadores con política de autoplay
  estricta (incluido el del Tesla). Se registran listeners `pointerdown` y
  `touchstart`.
- **Fallback automático en `speakNative`**: si `speechSynthesis` no existe o
  `getVoices()` está vacío (caso Tesla), se deriva automáticamente a
  `speakOnline()` en lugar de quedarse mudo.
- **Motor recomendado en los ajustes**: nueva opción “Google TTS online (MP3,
  recomendado en Tesla)” en el selector de motor de voz de `nav.html` y en los
  dos selectores de `tesla.html` (modal de voz y modal de ayuda), con el texto
  de ayuda actualizado.
- **Default inteligente**: en `tesla.html`, si no hay `speechSynthesis`, el
  motor por defecto pasa a `online` al cargar ajustes.

---

## 19. Alertas de tráfico: iconos más pequeños con el zoom alto

### 19.1 El problema

Las alertas comunitarias (accidente, obras, control, atasco, vehículo
averiado, peligro...) se dibujan en el mapa de navegación como un círculo de
color con un icono representativo dentro. Su `icon-size` **crecía con el zoom**
(0.30 a zoom 12 → 0.50 a zoom 16+), por lo que con zoom alto los iconos
quedaban demasiado grandes y tapaban la vía.

### 19.2 La solución

Se invierte la interpolación de `icon-size` de la capa `traffic-alerts-layer`
en `tesla.html`: ahora los iconos son ligeramente más pequeños en general y se
**reducen al acercar el zoom** (0.28 a zoom 12 → 0.22 a zoom 16+), quedando
legibles y tocables en la pantalla del Tesla sin tapar la carretera.

---

## 20. Velocidad actual siempre visible en el panel de navegación

### 20.1 El problema

La velocidad ya se mostraba en el panel brújula/altitud (esquina inferior
izquierda), pero ese panel se oculta automáticamente durante las maniobras, así
que el conductor podía quedarse sin ver la velocidad en el momento en que más
la necesita.

### 20.2 La solución

Nuevo **chip de velocidad** (`#nav-speed-chip`) al final del panel inferior de
navegación (`navigation-bottom-progress-bar`), visible tanto en navegación con
ruta como en modo Free Drive:

- Muestra la velocidad actual en km/h con acento azul `#007aff` (estilo de la
  app), redondeada al entero más cercano.
- Se actualiza con cada tick de GPS desde `updateTripStatistics()` mediante la
  nueva función `updateNavSpeedChip()`, reutilizando `window.currentSpeedKmh`
  (sin duplicar el cálculo de velocidad).
- No interfiere con el resto del panel: se añade como elemento flexible con
  `flex-shrink:0` al final de la barra.

---

## 21. POIs de búsqueda: icono de categoría en el marcador

### 21.1 El problema

Los resultados de búsqueda de POIs (categoría o búsqueda libre) se dibujaban en
el mapa como círculos blancos con un **número** dentro; no se veía de un vistazo
qué tipo de lugar era cada resultado.

### 21.2 La solución

Nueva función `getPoiIcon()` con dos mapas de iconos emoji por categoría OSM
(`POI_CATEGORY_ICONS` por clave/valor de Photon y `POI_VALUE_ICONS` como
fallback por valor, cubriendo también los resultados de Overpass del tipo
`node:restaurant`):

- Los marcadores de POI muestran ahora el **icono representativo de su
  categoría** (⛽ gasolinera, 🍽️ restaurante, ☕ cafetería, 🛒 supermercado,
  🏥 hospital, 🅿️ parking, 🔋 recarga…), con el nombre del lugar como tooltip.
- La **lista lateral sigue numerada** (1, 2, 3…) para poder cruzar lista y mapa;
  el filtro de la lista sigue ocultando/mostrando sus marcadores.
- El círculo es ligeramente más pequeño (34 px) y con el icono más legible
  (19 px), de modo que con zoom alto no tapa la vía.
- Si no se reconoce la categoría, se muestra un pin genérico 📍.

---

## 22. nav.html: el zoom inicial no llegaba al coche (se quedaba en el globo)

### 22.1 El problema

Al abrir nav.html sin ajustes guardados, el mapa se quedaba en la vista de globo
(zoom 1.5) y el coche nunca se situaba sobre la posición GPS.

Causa raíz: en el objeto de ajustes `S` de nav.html, los defaults de cámara
usaban el patrón `parseFloat(localStorage.getItem(k))!=null ? ... : default`.
Con localStorage vacío, `parseFloat(null)` devuelve `NaN` y **`NaN != null` es
`true`**, así que el ternario elegía `NaN` en lugar del default. `flyTo()` y
`easeTo()` recibían `zoom: NaN, pitch: NaN` y la cámara nunca se movía del
globo.

### 22.2 La solución

Se sustituye por comprobación robusta con `isFinite()`:

```js
const _savedPitch = parseFloat(localStorage.getItem(LS+'pitch'));
const _savedZoom  = parseFloat(localStorage.getItem(LS+'zoom'));
// ...
pitch: isFinite(_savedPitch) ? _savedPitch : 62,
zoom:  isFinite(_savedZoom)  ? _savedZoom  : 15.5,
```

Verificado con un harness de simulación (jsdom + stub de Mapbox): antes, el
`flyTo` de arranque recibía `zoom/pitch = NaN`; después, recibe `zoom 15.5,
pitch 62` centrado en la posición GPS. El coche vuelve a aterrizar sobre la
posición real con la perspectiva 3D.

## 23. nav.html: ventana de instrucciones estilo tesla.html y botón de búsqueda (se elimina la fila superior fija)

### 23.1 El problema
La fila superior de nav.html tenía el buscador de destino siempre visible, ocupando
espacio y estorbando la vista del mapa. Además, el banner de instrucciones era
simple (distancia + texto), sin icono de maniobra ni cartel del nombre de la calle,
a diferencia de tesla.html que muestra el icono, la calle tipo señal de tráfico y
una barra de progreso roja hacia la maniobra.

### 23.2 La solución
- Se sustituye la fila superior fija por un botón compacto de búsqueda (🔍, 42px)
  que abre el buscador en un panel desplegable con el cuadro de texto, el botón
  "Ruta" y el botón de cerrar (✕).
- Se copia el estilo de las ventanas de instrucciones de tesla.html:
  - Caja blanca con el icono de la maniobra (PNG/S1..S5, turn-left, roundabout…)
  - Texto de la maniobra en blanco con contorno negro
  - Nombre de la calle en un cartel verde estilo señal de tráfico (calle o ref)
  - Distancia a la maniobra en azul, barra de progreso roja que se va llenando
    con el avance, y ETA/llegada a la derecha.
- Nueva función `getManeuverIconFilename()` (igual que tesla.html), con soporte
  para el número de salida de rotondas.
- Se corrige además un efecto colateral del rediseño: el botón ⚙ había perdido su
  posicionamiento absoluto (arriba derecha) y se queda anclado.

Verificado: 0 errores de sintaxis en el script del documento; los 7 elementos del
nuevo banner y los 3 del panel de búsqueda están en el HTML; todas las imágenes de
maniobra existen en PNG/ y el diff queda limitado a los cambios descritos.

## 24. nav.html: capas de mapa (POIs, radares, alertas) y arreglo de edificios 3D

### 24.1 El problema
- nav.html no tenía opción para activar puntos de interés, radares ni alertas
  de tráfico en el mapa.
- El conmutador "Edificios 3D" no funcionaba: dependía de la fuente
  mapbox://mapbox.buildings-v1, que solo existe con el proveedor Mapbox, y el
  valor por defecto es OSM raster -> no se dibujaba nada.

### 24.2 La solución
Nueva sección "Capas de mapa" en Ajustes (⚙):
- 📡 Radares: radar fijo (highway=speed_camera / speed_display) de OpenStreetMap
  via Overpass, insignia roja con icono; toque -> "Radar — máx XX".
- ⚠️ Alertas de tráfico comunitarias: se leen (solo lectura) del mismo Firestore
  que usa tesla.html (users/ALERTAS/events), filtradas a 24 h, con la insignia
  correspondiente (accidente, obras, control, atasco, avería, peligro…).
- 📍 POIs cercanos: conmutador + selector de categoría (gasolineras,
  restaurantes, cafeterías, supermercados, hospitales, aparcamientos, carga
  eléctrica, hoteles, parques), marcador circular blanco con el icono de la
  categoría y el nombre al tocar.
- Todas las capas se refrescan al mover/zoom el mapa (con cooldown de 15 s
  por capa y debounce de 1,2 s al terminar el movimiento).

Edificios 3D rehechos sobre Overpass (way["building"] en el área visible,
altura real de etiqueta height o building:levels*3, colores por altura como
tesla.html): ahora funcionan con OSM raster POR DEFECTO y con Mapbox, con
radio adaptado al zoom y límite de features.

Resiliencia de red: fetchOverpass prueba 3 instancias del API (overpass-api.de,
kumi.systems, private.coffee) con UA de navegador y timeout de 10 s por
instancia (el navegador del Tesla no envía UA por defecto y overpass-api.de
responde 406 a UAs raros).

Verificado: 0 errores de sintaxis en el script principal y en el módulo ESM de
Firebase (node --check); queries Overpass probadas contra instancia real
(osm.ch) con respuesta JSON válida; 4 interruptores + selector presentes en el
HTML; diff limitado a los cambios descritos.

## 25. nav.html: modos de zoom como tesla.html (LIBRE / AUTO / RUTA / ECO)

### 25.1 El problema
nav.html solo tenia un zoom fijo (slider 🔍 en Ajustes); faltaban los modos
de zoom de tesla.html (AUTO por velocidad, RUTA vista general, LIBRE manual,
ECO autopista/ciudad).

### 25.2 La solucion
- Nuevo cluster de zoom en el mapa (derecha, bajo el engranaje): botones
  +/- con nivel de zoom y boton de modo que cicla ECO -> AUTO -> RUTA ->
  LIBRE (mismo ciclo que tesla.html).
- Selector "Modo de zoom" en Ajustes -> Camara, sincronizado con el boton:
  - LIBRE: zoom manual (los botones +/− y el gesto de pellizco se mantienen).
  - AUTO: zoom segun velocidad (mismas tablas de tesla.html: <30 -> 18.7,
    <50 -> 18.4, <80 -> 18.0, <100 -> 17.5, <110 -> 17.1, <120 -> 16.6,
    mas de 120 -> 16.3).
  - RUTA: vista general fija zoom 14.5 con pitch reducido (max(4, pitch-3)).
  - ECO: si vas a mas de 70 km/h y la maniobra esta a mas de 2 km -> vista
    general 14.5 (autopista); si no, zoom por velocidad con su tabla.
- La velocidad real (GPS) alimenta AUTO/ECO via navSpeedKmh, y la distancia a
  la proxima maniobra via lastManeuverDist (actualizada en navTick).
- El nivel de zoom se muestra en el cluster y se refresca al acabar cada zoom.

Verificado: 0 errores de sintaxis en el script principal; botones y selector
presentes; tablas de zoom identicas a tesla.html.

## 26. nav.html: simulador de GPS (avanza por la ruta, resto 100% real)

### 26.1 El problema
Para depurar la navegación (banner, voz, modos de zoom, ETA) había que salir
a la carretera con el coche.

### 26.2 La solución
Simulador de GPS integrado en nav.html:
- Botón "▶ Simular GPS" en la barra inferior (pasa a "■ Fin simulación" en rojo
  mientras está activo).
- Al pulsarlo, si hay una ruta calculada, el coche empieza en el punto de la
  ruta más cercano al GPS actual y avanza por la geometría (routeData.coords)
  a la velocidad elegida (10-160 km/h, ajustable en Ajustes → "Simulador de
  GPS (debug)"; se puede cambiar en marcha).
- Refactor clave: el handler del GPS real (watchPosition) y el simulador
  comparten un único punto de entrada handleGpsFix(coords), de modo que la
  simulación pasa por EXACTAMENTE el mismo código que la realidad: marcador
  del coche, cámara y seguimiento, rotación del icono, velocidad en pantalla
  (spd-top), navTick (distancia a maniobra, banner, ETA, barra de progreso),
  avisos de voz y los modos de zoom AUTO/ECO (que usan la velocidad simulada).
- Al iniciar la simulación se detiene el watchPosition real; al terminarla
  (fin de ruta o botón) se restaura el GPS real automáticamente.

Verificado: 0 errores de sintaxis; lógica de avance probada en node con ruta
sintética de 3,8 km a 72 km/h: 191 ticks, 0 m de error, velocidad media 71,9
km/h; botón y slider presentes en el HTML.

## 27. nav.html: arreglos de zoom +/-, suavidad del simulador y voz/pitido en la salida de rotondas

### 27.1 Los problemas
- Los botones +/− del zoom no hacían nada en la práctica: con el modo AUTO
  (por defecto) la cámara reimpone el zoom según velocidad en cada tick y
  pisaba el zoom manual.
- El simulador de GPS avanzaba 1 vez por segundo: el coche "iba a golpes".
- En rotondas (y en general) no se oía nada en el momento de la salida. Dos
  causas: (1) los flags de voz (far/medium/near) nunca se resetaban al pasar
  de maniobra -> solo la PRIMERA maniobra de la ruta hablaba; (2) la distancia
  a la maniobra se calculaba en linea recta (haversine), asi que en una
  rotonda el aviso se disparaba ~200 m antes y en el momento de salir no
  habia nada.

### 27.2 Las soluciones
- Zoom +/−: nueva funcion zoomBy(delta) que siempre funciona: si el modo no es
  LIBRE pasa automaticamente a LIBRE (el boton muestra "LIBRE") y aplica el
  zoom; con "Mapa anclado" desactivado hace easeTo directo.
- Simulador: tick de 250 ms con paso proporcional (velocidad/4 por tick) ->
  movimiento suave, tambien dentro de las rotondas.
- Voz/pitido por maniobra:
  - Reset de voiceFlags al avanzar de maniobra (ahora CADA maniobra habla y
    pita en sus ventanas de 2 km / 500 m / 230 m).
  - Distancia a la maniobra POR LA RUTA (nueva distanceAlongRoute: proyeccion
    del coche sobre la polilinea + acumulado de step.distance en routeData.
    cumDist), en vez de en linea recta: los avisos llegan en el momento real.
  - Nuevo disparo "immediato": a <=40 m de la maniobra suena el pitido y la
    voz dice "X ahora" (p. ej. "Salga de la rotonda ahora") justo en la
    salida; no se aplica a 'arrive' ni 'depart'.

Verificado: 0 errores de sintaxis; logica probada en node con ruta sintetica
de 3 pasos (salida, salida de rotonda, llegada): MED/NEAR/NOW disparados en
cada maniobra con las distancias correctas (540/210 m en la rotonda, pitido a
17 m) gracias al reset de flags y a la distancia por ruta.

## 28. nav.html: 7 funciones portadas de tesla.html (completar la navegación)

1. **Informar de incidencias de tráfico (⚠️ en la barra superior).** Modal con
   los 9 tipos (accidente, avería, control, atasco, peligro, mal estado, obras,
   vía cerrada, "ya no hay nada") que ESCRIBE en el mismo Firestore que usa
   tesla.html (`users/ALERTAS/events`, doc `timestamp_Guest`), usando la
   posición real del GPS o la simulada si el simulador está activo. La alerta
   se pinta al instante si la capa de alertas está activa.

2. **Radares propios (⚙ → Radares propios).**
   - "＋ Añadir radar en mi posición": modal con velocidad máxima (o tramo);
     radio 350 m por defecto, ajustable con el slider de radio dinámico
     (50–2000 m, el círculo se escala con el zoom en metros reales).
   - Importar desde URL de KML público (mismo formato que tesla.html:
     placemarks con nombre y coordenadas, decode ISO-8859-1) con filtro de
     palabras clave opcional y dedupe por coordenadas.
   - Backup: descarga JSON de los radares propios; Restaurar: sube el JSON.
   - Vaciar todo (con confirmación). Los radares propios se dibujan con
     insignia roja + círculo de radio y avisan al tocarlos.

3. **Resumen de llegada (arrival stats).** Al llegar al destino se muestra un
   modal con salida/duración/llegada, km reales recorridos (acumulados por
   GPS en handleGpsFix), estimados de la ruta, velocidad media y máxima.
   Funciona también con el simulador de GPS.

4. **Rutas guardadas + favoritos (⭐).** Panel desplegable que guarda la ruta
   actual con nombre (o lo carga de la lista), lista las guardadas
   (nombre + distancia + tiempo) con Cargar y borrar (🗑). Persistencia en
   localStorage (`nav_savedRoutes`).

5. **Histórico de versiones (📋).** Modal que carga `updates.txt` del repo
   (mismo origen que tesla.html) con cache 'no-cache'.

6. **Asistente de rutas IA (🤖).** Chat con Gemini (mismo endpoint
   `APP_CONFIG.endpoints.gemini()` que tesla.html): el sistema le pide un
   bloque JSON `{title, waypoints:[{lat,lng,address}]}`, se parsea (bloque de
   código o llaves con "waypoints") y se calcula la ruta al destino; si la IA
   no da coordenadas válidas, geocodifica la dirección con Nominatim.

7. **Integración:** el módulo Firebase ahora también expone `doc`/`setDoc`
   (escritura de alertas); la búsqueda captura el nombre del destino para el
   resumen y las rutas guardadas; `btn-stop` y `arrive()` resetean las
   estadísticas de viaje.

Verificado: 0 errores de sintaxis (script principal + módulo ESM con
node --check), los 92 IDs usados en JS existen en el HTML, y batería de
pruebas con stubs (14/14 PASS): wiring, modal de alertas y escritura en
Firestore, creación/borrado de radares propios, resumen de llegada,
guardado/borrado de rutas, carga de updates.txt, parseo del JSON de la IA y
velocidad del GPS.

## 29. nav.html: arreglo de POIs (invisibles en Calles + tamaño según zoom)

- **POIs invisibles al cambiar de estilo/proveedor:** al recrear el mapa
  (p. ej. Calles → Satélite) el cooldown de 15 s hacía que el refresco de
  capas en `map.on('load')` se saltara, y la capa nueva se quedaba SIN
  marcadores. Ahora el load fuerza el refresco de todas las capas activas
  (`refreshActiveLayers(true)`, con parámetro `force` propagado a
  radares/POIs/alertas/edificios).
- **Iconos pequeños en Satélite:** los marcadores de POIs eran de 34 px fijos.
  Ahora su tamaño depende del zoom (48 px con zoom bajo → 32 px con zoom
  alto) y se reescala en caliente en cada zoomend (`updatePoiMarkerSizes`),
  con fondo más opaco y sombra para que resalten sobre la imagen de satélite.
- `clearLayerMarkers` ahora limpia tanto marcadores sueltos como wrappers
  `{marker, el}` (necesario para el reescalado en caliente).

Verificado: 0 errores de sintaxis; tabla de tamaños probada en node
(48/44/40/36/32 px según zoom); anclas únicas en el HTML.

## 30. nav.html: tamaño de POIs configurable, categorías multi-selección y velocidad como emblema Tesla

- **Tamaño de los iconos de POI configurable (⚙ → POIs cercanos):** nuevo
  slider 24–64 px (defecto 40) que ajusta el tamaño de los marcadores; el
  factor por zoom se mantiene (más grandes con zoom bajo, compactos con zoom
  alto) y se aplica en caliente al mover el slider o el zoom.
- **Categorías multi-selección:** el desplegable único se sustituye por
  "chips" (⛽ Gasolina, 🍽️ Comida, ☕ Café, 🛒 Tiendas, 🏥 Salud, 🅿️ Parking,
  🔋 Carga, 🏨 Hotel, ⛺ Parques) que puedes activar/desactivar varias a la
  vez; cada categoría consulta su propia query de Overpass con su icono y se
  deduplica por coordenadas (máx. 150 marcadores). Si se desactivan todas,
  vuelve a Gasolina. Migración automática del valor antiguo `poiCat`.
- **Velocidad como emblema de Tesla (como tesla.html):** se elimina la cifra
  de velocidad del centro superior (tapaba botones) y pasa a un botón
  circular semi-transparente con el LOGOTESLA de fondo y la velocidad
  encima, en la posición del emblema (arriba-izquierda). **Pulsarlo
  muestra/oculta la fila superior** (🔍 ⭐ 🤖 ⚠️ 📋), que ahora arranca
  oculta, igual que el toggle de tesla.html.

Verificado: 0 errores de sintaxis; 15/15 tests con stubs (toggle del emblema,
chips 9 categorías + activar/quitar, slider de tamaño y poiMarkerSize con el
factor de zoom, refreshPois multi-categoría con 1 query por categoría y dedupe
por coordenadas, velocidad en el emblema); los 97 IDs usados en JS existen en
el HTML.

## 31. nav.html: POIs arreglados (sintaxis Overpass), coche geográfico con cuenta atrás para volver, y Ajustes por pestañas

1. **POIs que no cargaban (a ningún zoom):** la consulta a Overpass usaba
   `node["amenity"="fuel"];(around:...)` (filtro independiente), que es
   sintaxis INVÁLIDA y Overpass estricto rechaza con 400. Ahora se usa la
   forma directa `node["amenity"="fuel"](around:...)` (validada: 200 contra
   una instancia real, también multi-categoría). Además se añade
   `overpass.osm.ch` como segundo endpoint de respaldo (kumi.systems estaba
   caído con 502).

2. **Coche en su posición real al mover el mapa:** el coche era un div fijo
   en pantalla (posición % carX/carY), así que al arrastrar el mapa se
   quedaba «pegado» a la pantalla en vez de a su coordenada GPS. Ahora es un
   **marcador geográfico** (mapboxgl.Marker): se mueve con el mapa. carX/carY
   siguen controlando DÓNDE se ve el coche en pantalla mientras el mapa lo
   sigue (padding).

3. **Cuenta atrás de 15 s (configurable) para volver al coche:** si «Mapa
   anclado» está activo, arrastrar o hacer zoom con rueda/dedo pausa el
   seguimiento (la cámara no pelea con el usuario) y aparece «Vuelta al
   coche en Ns» con botón ✕ (no volver). Cada interacción reinicia la cuenta
   (configurable 0–60 s en Ajustes → Cámara; 0 = no volver solo). ⌖ Centrar
   devuelve la vista al instante.

4. **Ajustes por pestañas:** el panel se organiza en 7 pestañas (Mapa,
   Capas, Ruta, Voz, Cámara, Radares, Simulador) que filtran los grupos; la
   pestaña activa se recuerda.

Verificado: 0 errores de sintaxis; query multi-categoría validada contra
Overpass real (200); 21/21 tests con stubs (marcador del coche geográfico y
su movimiento, pausa/cuenta atrás/retorno/cancelar/timeout 0, ⌖ re-engancha,
updateCamera sin pelear, pestañas mostrar/ocultar/guardar, slider de timeout,
sintaxis directa y dedupe de POIs); 10 grupos repartidos en las 7 pestañas.

## 32. nav.html: emblema de velocidad reubicado y ventana de maniobras compacta

- La velocidad deja de estar en la esquina superior-izquierda (tapaba la barra
  superior y la ventana de navegación). Ahora es un botón circular de 76 px con
  el LOGOTESLA de fondo en la esquina inferior-izquierda, justo encima de la
  barra inferior; pulsarlo sigue mostrando/ocultando la fila superior.
- La ventana de maniobras era de ancho completo (left:12px→right:12px) y se
  comía los controles de zoom de la derecha. Ahora es compacta, centrada
  (máx. 520 px, se estrecha en pantallas pequeñas) y no invade la columna
  derecha de botones.
- Campos de tiempo arreglados: "tiempo restante" y "llegada HH:MM" se
  mostraban pegados en la misma línea ("32 minllegada 14:55"). Ahora van en
  columna con tipografía propia, sin cortarse.

## 33. nav.html: banner arriba del todo y compacto, menú debajo del banner, velocidad más baja

- La ventana de navegación ya no ocupa todo el ancho ni queda en mitad de la
  pantalla: ahora va pegada al borde superior (top:8px), centrada y compacta
  (máx. 440px, se estrecha sola en pantallas pequeñas).
- Al activar la navegación, la fila superior de botones (si se muestra
  pulsando la velocidad) baja automáticamente por debajo de la ventana de
  navegación (top:120px) para no taparla; al terminar la ruta vuelve arriba.
- El emblema de velocidad baja y se reduce (66px, esquina inferior-izquierda)
  para dejar la parte superior totalmente despejada.

## 34. nav.html: flecha del coche, banner compacto arriba, recalculos arreglados y voz más robusta

- El coche usa ahora la flecha de navegación típica (PNG/AVANCE.PNG, el mismo
  icono de tesla.html) en lugar de la gota azul, con rotación por rumbo
  (sombra ligera para verse bien sobre cualquier fondo).
- La ventana de maniobras se ha estrechado (máx. 380px), pegado al borde
  superior (top:2px, por encima de la barra) y con todos los tamaños
  reducidos (caja de maniobra 52px, textos más compactos).
- Recalculo de ruta arreglado: se medía la desviación al VÉRTICE más cercano
  de la polilínea (con geometría simplificada el coche podía estar a >70 m
  del vértice yendo por la carretera → recalculos en bucle cada pocos
  metros). Ahora se mide la distancia PERPENDICULAR a la polilínea y hay
  cooldown de 15 s entre recalculos.
- Voz: el motor online ahora prueba varios proveedores TTS en orden
  (StreamElements con voces Google y CORS → translate_tts clásico → pitido),
  para que funcione aunque uno de los endpoints esté bloqueado en el
  navegador del Tesla. Con la voz funcionando y los recalculos fuera del
  bucle, desaparecen también los pitidos repetidos.

## 35. nav.html: flecha de navegación clásica, pitidos solo cerca, banner a la izquierda y POIs más fiables

- Icono del coche: ahora es la flecha de navegación clásica apuntando hacia
  arriba (PNG/Coche_Sat.PNG, la misma que usa tesla.html en satélite), blanca
  con doble sombra para verse bien sobre mapa claro y satélite, rotando con
  el rumbo.
- Pitidos: lejos (2 km) y medio (500 m) avisan SOLO con voz, sin pitido. El
  pitido queda reservado para cuando queda poco tiempo: <=230 m y en el
  momento exacto de la maniobra (<=40 m).
- Ventana de navegación: alineada a la IZQUIERDA (como tesla.html) y más
  compacta (máx. 350px).
- POIs: el fetch de Overpass ahora lanza TODAS las instancias en paralelo
  (gana la más rápida) con timeout de 8 s por instancia, y añade el mirror
  nchc.org.tw (datos globales). Antes se probaban en serie y, si la primera
  instancia bloqueaba (overpass-api.de responde 406 a según qué IPs/UAs), los
  POIs tardaban o nunca aparecían. Se quita la cabecera User-Agent manual
  (los navegadores la ignoran por ser cabecera prohibida).

## 36. nav.html (2026-09-01): borrar alertas con «Ya no hay nada», fecha/hora del commit en las notas y Overpass por POST

- «Ya no hay nada» (código 9) ya funciona: en vez de crear una alerta nueva
  (que era el punto que seguías viendo), ahora BORRA de Firestore todas las
  alertas que haya a <=800 m de tu posición, como hace tesla.html. Además los
  marcadores de borrado (code 9) ya no se pintan en el mapa.
- El histórico de versiones (📋) muestra ahora la fecha y hora del último
  commit («Última actualización del código»), leída de version.txt, que la
  GitHub Action actualiza en cada push.
- Overpass ahora se consulta por POST (el mismo método que usa tesla.html y
  el probado en el navegador del Tesla): con GET algunas instancias fallaban
  o truncaban la query — era una causa probable de que los POIs no salieran.

## 37. nav.html: modo «Solo voz (sin pitidos)»

- Nueva opción en Ajustes → Voz → «Guiado por voz»: **Solo voz (sin pitidos)**,
  entre «Solo pitidos» y «Voz + pitidos».
- En ese modo la voz habla en los 4 avisos (2 km, 500 m, 230 m y momento
  exacto de la maniobra) pero NO suena ningún pitido, ni en la llegada ni en
  el recálculo por desvío.
- De propina: el modo «Silencio» ahora es silencio de verdad (antes el pitido
  de maniobra cercana seguía sonando).

## 38. nav.html: modos de vista 3D/DEM, Free Drive HUD, minimapa de maniobra y optimizaciones MCU

**1. Modos de vista (Ajustes → Mapa → Modo de vista), como tesla.html:**
- NORTE (norte arriba, pitch 0), AVANCE (sentido de la marcha, pitch 0),
  3D (perspectiva, pitch 62) y 3D RELIEVE (pitch 73 + terreno DEM real de
  Mapbox cuando el token lo permite + atmósfera/fog estilo tesla.html).
- El slider de inclinación (Cámara) sigue funcionando para 3D/RELIEVE; el
  icono del coche rota con el rumbo en NORTE (mapa fijo) y queda arriba en
  AVANCE/3D (mapa que rota).

**2. Free Drive HUD (🧭, abajo-derecha, al conducir SIN ruta):**
- Rosa de los vientos (PNG/ROSA.PNG) rotando con el rumbo + grados y punto
  cardinal, velocidad actual grande, altitud (GPS o terreno), velocidad media
  y máxima, y gráfica de desnivel dibujada en canvas (sin Chart.js, más
  ligera para la MCU).

**3. Minimapa de previsualización de maniobra (🗺️, arriba-derecha, en ruta):**
- Canvas ligero (sin segunda instancia de Mapbox GL): dibuja la ruta ~1,2 km
  por delante, el punto de la próxima maniobra en rojo pulsante, el coche y
  el destino. Alternativa ligera al minimapa de tesla.html.

**4. Optimizaciones MCU (Ajustes → Mapa):**
- Watchdog de memoria (🛡️): monitoriza el JS heap durante navegación; si
  supera el 30% guarda el estado (ruta, destino, simulador) y recarga con
  overlay "Recuperando navegación…", restaurando la ruta al volver.
- Compensación de escala Tesla 0.6536 (📏), activable.
- Planificador de tareas por prioridad: el refresco de capas (POIs/radares/
  alertas/edificios) se cede a un timer de baja prioridad para no bloquear el
  marcador ni el navTick.

## 39. tesla.html: pantalla negra arreglada + iconos POI corregidos

- tesla.html se quedaba en negro por un error de sintaxis introducido en el
  parche de iconos POI: la línea `function displayPoiSearchResults(features,
  map) {` se había perdido y el cuerpo de la función quedaba huérfano (llave
  sobrante -> el script gigante no compilaba y la página no arrancaba).
  Restaurada la declaración; tesla.html vuelve a compilar (0 errores de
  sintaxis en sus 4 scripts inline).
- De paso, los iconos de los POIs de búsqueda estaban rotos: el mapa de
  iconos usaba cadenas literales "U0001F37D" (texto visible) en vez de
  escapes unicode. Corregidos los 222 tokens a `\u{1F37D}` — ahora sí se
  ven los emojis reales (🍽️ ⛽ 🏨 📍…).

## 40. nav.html: selector de punto con confirmación, pulsación larga y ventana de ruta detallada con waypoints reordenables

**1. Buscar un lugar → te lleva al punto con pin arrastrable + ventana de confirmar** (como tesla.html)
- Al pulsar un resultado de búsqueda ya no calcula la ruta directa: vuela al punto, deja un **pin 📍 arrastrable** y abre la ventana **«Nueva Ruta» / «Añadir Punto»** con el nombre y las coordenadas.
- Puedes **hacer clic en el mapa** o arrastrar el pin para ajustar la posición exacta (se actualizan las coordenadas en vivo).

**2. Pulsación larga en el mapa → ventana Nueva Ruta / Añadir Punto**
- Pulsación larga (550 ms, táctil o ratón) sobre el mapa suelta un pin en ese punto y abre la misma ventana de confirmación.

**3. Ventana de ruta detallada debajo de la de navegación**
- **⚙ → Ruta → «Ventana de ruta»**: Normal (solo banner) o **Detallada** (puntos + instrucciones) — por defecto Detallada.
- La ventana muestra: **Salida**, los **puntos intermedios** con icono **☰** (arrastra para reordenar) y **Destino**, más la lista de **instrucciones paso a paso** con icono, texto y distancia (la maniobra actual se resalta).
- **Reordenar arrastrando**: el ☰ permite mover un punto intermedio a otra posición (táctil + ratón); al soltar recalcula la ruta con el nuevo orden.
- Botón **✕** en cada punto intermedio para quitarlo.
- Los **waypoints se guardan** en rutas guardadas, se restauran tras recarga de memoria y se mantienen al recalcular por desvío.

**Verificado:** 0 errores de sintaxis; **34/34 tests con stubs** (pin arrastrable, mover con clic, ventana oculta/visible según ruta activa, merge de steps multi-leg con arrive intermedio → continue, ventana detallada con filas y pasos, reordenación real de waypoints por drag, guardado/restauración de waypoints, select de ventana de ruta). Changelog: entrada 40.

## 41. nav.html: modo de vista en Cámara, ángulo desactivado en modos planos, 3D+Satélite por defecto, HUD siempre visible y agrandable, minimapa sin tapar el zoom

**1. Modo de vista → pestaña Cámara** ⚙
- El selector «Modo de vista» se ha movido de la pestaña Mapa a la pestaña **Cámara**, junto al slider de inclinación.

**2. Ángulo desactivado en modos planos** 📐
- En **NORTE** y **AVANCE** (planos, sin inclinación) el slider de ángulo queda **desactivado** (atenuado). En **3D** y **3D RELIEVE** se activa.
- Al volver de un modo plano a 3D se **restaura el último ángulo** que tenías (ya no se queda clavado en 0°).

**3. Por defecto: 3D + Satélite** 🛰️
- El modo de vista por defecto ahora es **3D** y el estilo del mapa **Satélite** (Google raster, sin token) para instalaciones nuevas.

**4. HUD siempre visible y agrandable** 🧭
- El HUD (brújula, velocidad, altímetro, medias, gráfica de desnivel) **ya no desaparece al navegar**: se queda visible con GPS, con o sin ruta.
- **Toca la tarjeta para agrandarla/reducirla**: en grande la brújula, la velocidad y la gráfica crecen (240×90 vs 200×52).

**5. Minimapa sin tapar los botones** 🗺️
- La «ventanita» que tapaba el botón LIBRE del zoom era el **minimapa de maniobra**: se ha **bajado** (top 212→254) para no solapar los controles de la derecha y ahora lleva una **etiqueta «🗺️ Maniobra»** para que se sepa qué es.

**Verificado:** 0 errores de sintaxis; **27/27 tests con stubs** (defaults 3D/satélite, pitch desactivado en planos, restauración del ángulo 3D, HUD visible navegando y oculto sin GPS, agrandar/reducir con el canvas, minimapa con etiqueta y sin solapar). Changelog: entrada 41.

## 42. nav.html (2026-09-01): HUD a la izquierda con emblema Tesla, escala configurable, rotondas con número de salida y minimapa junto a instrucciones
- HUD (brújula, altímetro, velocímetro, medias, gráfica) movido a la **izquierda abajo** (antes derecha).
- **Emblema Tesla con velocidad arriba** del HUD (logo LOGOTESLA + km/h grande); su pulsación sigue mostrando/ocultando la barra superior, sin propagar el click al agrandar del HUD.
- Botones **− / ＋ de escala del HUD** (60 %–160 %, guardado en ajustes) para ajustarlo a la pantalla.
- **Instrucciones de rotonda con número de salida**: «Tome la 2.ª salida de la rotonda hacia X» / «Salga en la 2.ª salida» (usa m.exit de OSRM/Mapbox en vez del genérico «Entre a la rotonda»).
- **Minimapa de maniobra** movido **junto a la ventana de instrucciones** (izquierda, top 96px, al lado de la ventana de ruta detallada).
- Verificado: 23/23 tests con stubs, 0 errores de sintaxis (incl. módulo ESM).

## 43. nav.html (2026-09-01): POIs activados por defecto (todas las categorías, consultas en paralelo, clic → confirmar destino) y zoom de Ajustes que funciona
- **POIs por defecto**: la capa 📍 arranca **activada** (antes apagada → no veías nada) y con **las 9 categorías marcadas** (gasolina, comida, café, tiendas, salud, parking, carga, hotel, parques). Antes solo traía gasolineras.
- **Carga más rápida y robusta**: las queries de categorías se lanzan **en paralelo** (antes en serie: con 9 categorías hasta ~81 s; ahora ~9 s máx.) y se deduplican por coordenadas.
- **Clic en un POI → ventana de confirmación**: al pulsar un POI ya no es solo un aviso: vuela al punto, deja el pin arrastrable y abre «🛣 Nueva Ruta / ➕ Añadir Punto» (igual que al buscar un lugar).
- **Zoom de Ajustes arreglado**: el slider 🔍 guardaba el zoom pero la cámara lo ignoraba (usaba el modo AUTO/RUTA/ECO y el guard «sin GPS → no hacer nada»). Ahora el slider **aplica el zoom directamente** en el mapa y pasa a **LIBRE** automáticamente — funciona aunque no haya GPS y en cualquier modo.
- Verificado: 0 errores de sintaxis (incl. módulo ESM), **9/9 tests** (defaults, consultas paralelas con dedupe, clic → startPointPick, slider → LIBRE + easeTo).

## 44. nav.html (2026-09-01): HUD sin velocidad duplicada (solo en el emblema Tesla), Mín, gráfica desnivel↔velocidad, escala en Ajustes y POIs con reintento/aviso
- **Velocidad solo en el emblema Tesla**: eliminada la velocidad duplicada de la fila de la brújula; la fila de estadísticas ahora muestra **Altitud, Med, Máx y Mín** (mínima sin contar paradas <1 km/h).
- **Gráfica desnivel ↔ velocidad** (como tesla.html): pulsando la gráfica o el botón bajo ella cambias entre «⛰ Desnivel» (azul, metros) y «🚗 Velocidad» (naranja, km/h). El modo se guarda en ajustes. El muestreo guarda ambos valores para no perder historial al cambiar.
- **Escala de la ventana de brújula también en Ajustes**: nueva fila «🧭 Tamaño HUD» en la pestaña Cámara (60 %–160 %), sincronizada con los botones − / ＋ del propio HUD.
- **POIs**: botón «↻ Actualizar POIs» en Ajustes → Capas, y si ninguna instancia Overpass responde aparece un **aviso visible** con instrucciones (antes fallaba en silencio). Además un **reset de versión de ajustes** borra una sola vez los valores antiguos guardados (`pois=false`, categorías solo gasolina) que impedían ver los POIs por defecto.
- Verificado: 0 errores de sintaxis (incl. módulo ESM), **17/17 tests** (HUD sin hud-speed, Mín, toggle de gráfica con unidades y colores por modo, escala en ajustes, reset de versión, fetchOverpass con detección de fallo).

## 45. nav.html (2026-09-01): Simular GPS y Centrar en la barra superior — eliminada la barra inferior que tapaba la brújula
- **«▶ Simular GPS» y «⌖ Centrar»** movidos a la **barra superior** (junto a 🔍 ⭐ 🤖 ⚠️ 📋), con estilo compacto.
- **Eliminada la barra inferior** (gradiente de abajo) que **tapaba el HUD/brújula** en la esquina inferior izquierda — el HUD queda totalmente visible.
- El botón **«■ Fin»** (finalizar navegación) también pasa a la barra superior; sigue oculto hasta que haya una ruta activa.
- Verificado: 0 errores de sintaxis (incl. módulo ESM), **7/7 tests** (botones en topbar, sin bottombar, wiring intacto).

## 46. nav.html (2026-09-01): velocidad centrada en el emblema Tesla con Med/Máx debajo (redondeadas)
- La velocidad queda **solo en el emblema Tesla**, ahora **centrado** sobre el logo (antes alineada a la derecha).
- **Media y Máxima** pasan al emblema, apiladas en vertical bajo la velocidad (ej. «Med 84 · Máx 118»), **redondeadas a km enteros** (sin decimales).
- La fila de estadísticas del HUD queda con **Altitud y Mín** (Med/Máx ya viven en el emblema).
- Verificado: 0 errores de sintaxis (incl. módulo ESM), **7/7 tests** (sin velocidad duplicada, se-stats en el emblema, emblema centrado en columna, Med/Máx redondeados).

## 47. nav.html (2026-09-01): barra superior visible al navegar y ventanas (brújula, navegación, maniobra) redimensionables con esquina guardada
- **Barra superior ya no queda tapada al navegar**: con ruta activa los botones (🔍 ⭐ 🤖 ⚠️ 📋 ▶ Simular GPS ⌖ Centrar ■ Fin) se mueven a la **derecha** (junto a ⚙), libres de las ventanas de navegación de la izquierda. Antes se situaban bajo la ventana de ruta y quedaban ocultos.
- **Esquina remarcada para redimensionar** en las 3 ventanas: **brújula (HUD), navegación (banner de instrucciones) y maniobra (minimapa)**. Arrastra la esquina (cursor diagonal) para agrandar/reducir; el tamaño **queda guardado** y se reaplica al reabrir la ventana.
- Los canvas de la gráfica del HUD y del minimapa se re-adaptan al nuevo tamaño al redimensionar.
- Verificado: 0 errores de sintaxis (incl. módulo ESM), **12/12 tests** (topbar a la derecha al navegar, 3 asas con guardado/re-aplicado tras arrastre simulado, límites mínimos, canvas fluido).

## 48. nav.html (2026-09-01): proveedor Valhalla, Mapbox con tráfico real y claves fuera de GitHub
- **Nuevo proveedor Valhalla** (Ajustes → Ruta): usa la instancia pública gratuita `valhalla1.openstreetmap.de` (sin clave, CORS), con instrucciones paso a paso en español (rotondas con número de salida, giros, incorporaciones), waypoints múltiples y fallback automático a OSRM/Mapbox si no responde.
- **Mapbox ahora con tráfico real**: el perfil pasa de `driving` a **`driving-traffic`** (rutas y ETA según el tráfico en vivo), dentro de la cuota gratuita de Directions (~100.000 rutas/mes).
- **SEGURIDAD — claves fuera de GitHub**: `PNG/zbuildgs.js` (donde Freebuff inyecta el token de Mapbox y Firebase) estaba **versionado en el repo**. Ahora está en `.gitignore` y retirado del tracking (`git rm --cached`); el fichero sigue en el workspace para la preview. **Importante: rota el token de Mapbox** (el viejo quedó en el historial de git) y pon el nuevo en el panel de Keys/API keys.
- Verificado: 0 errores de sintaxis (incl. módulo ESM), **19/19 tests** (mapeo de tipos Valhalla → OSRM, rotonda con salida, ruta de 2 piernas con waypoint y unión de trazado, llegada intermedia → continue, POST JSON correcto, driving-traffic, zbuildgs.js ignorado).

## 49. Despliegue GitHub Pages con claves inyectadas en build (2026-09-01): el token ya no necesita estar en el repo
- **Workflow nuevo** `.github/workflows/deploy-pages.yml`: en cada push a `main` genera `PNG/zbuildgs.js` **en el momento del despliegue** a partir del secret encriptado **`APP_CONFIG_JSON`** (Settings → Secrets and variables → Actions) y publica el sitio con `actions/deploy-pages`. El token **nunca entra en el repositorio** ni en su historial.
- **`PNG/zbuildgs.example.js`**: fichero de ejemplo con la estructura exacta del JSON que debe contener el secret (sin valores reales).
- **Guard en `nav.html` (línea 777)**: si `PNG/zbuildgs.js` falta o no tiene clave, la app ya no se queda en negro — arranca el mapa igualmente (satélite/POIs sin token) y solo fallan Firebase/Gemini/tráfico Mapbox.
- **IMPORTANTE (pasos manuales en GitHub)**: (1) crear el secret `APP_CONFIG_JSON` con el JSON completo de configuración; (2) en Settings → Pages cambiar Source de «Deploy from a branch» a **«GitHub Actions»**; (3) en Freebuff, re-guardar las claves en Keys/API keys para que se regenere `PNG/zbuildgs.js` en el workspace (ahora mismo falta el fichero local → la preview y el sitio necesitan ese paso).
- Verificado: 0 errores de sintaxis (incl. módulo ESM), guard aplicado, preview sirviendo nav.html.

## 50. tesla.html y nav.html: pantalla negra por fichero de claves ausente (2026-09-01)
- **Causa de la pantalla negra**: `PNG/zbuildgs.js` (claves inyectadas por Freebuff) está **ausente** — se retiró del repo en la entrada 48 y aún no se han re-guardado las claves en el panel Keys/API keys. Sin él, `window.APP_CONFIG` no existe.
- **tesla.html tenía 5 accesos a `APP_CONFIG` sin proteger** (el de `mapboxgl.accessToken` en top-level rompía TODO el script → pantalla negra y barra derecha muerta). Ahora los 5 son a prueba de ausencia: firebase ({}), mapbox accessToken ×2, buildUrl de Mapbox (''), script de Google Maps (''), y `GAUL` de Gemini (null).
- **nav.html** ya tenía el guard (entrada 49); verificado con harness de arranque con ids reales: boot completo sin excepciones sin APP_CONFIG (mapa OSM raster, POIs Overpass y rutas OSRM/Valhalla funcionan sin token).
- **Pendiente del usuario**: (1) re-guardar las claves en Keys/API keys para que Freebuff regenere `PNG/zbuildgs.js` (devuelve Firebase/IA/tráfico); (2) recargar con caché limpia (Ctrl+Shift+R) — el navegador puede tener la versión vieja que crasheaba.
- Verificado: 0 errores de sintaxis en tesla.html (4 scripts + módulo ESM) y nav.html; preview sirviendo ambas versiones con guards.

## 51. nav.html: escala del HUD solo afecta a la gráfica; fuera los botones −/＋ (2026-09-01)
- **La escala (Ajustes → Cámara → Tamaño HUD, 60–160 %) ya NO redimensiona** el emblema Tesla/velocidad, la brújula ni los datos: ahora afecta **solo a la ventana de la gráfica** (canvas de desnivel/velocidad, que además crece en ancho y alto reales y se redibuja).
- **Eliminados los botones − / ＋ de la ventana de la brújula** (ocupaban sitio): el ajuste de tamaño queda solo en el slider de Ajustes → Cámara.
- Verificado: 0 errores de sintaxis (incl. módulo ESM), **9/9 tests** (sin botones, #free-hud sin transform, gráfica con `calc(200px*var)`, var aplicada, slider sincronizado y persistido, gráfica redibujada).

## 52. nav.html: mapa que desaparecía al encontrar posición — culpa del DEM sin token (2026-09-01)
- **Síntoma**: el mapa salía en globo terráqueo, pero al localizar la posición se ponía negro y no acercaba el zoom.
- **Causa**: `PNG/zbuildgs.js` sigue ausente (sin token de Mapbox) y el modo **3D Relieve** añadía la fuente de terreno `mapbox://mapbox.terrain-dem-v1` — sin token los tiles del DEM devuelven error y el renderer de Mapbox se rompe justo cuando la cámara vuela hacia el coche (donde se piden los tiles) → negro + zoom muerto.
- **Fix 1 — `applyRelief`**: el terreno DEM solo se usa **si hay token de Mapbox**; sin token, el modo Relieve se degrada a 3D (proyección mercator, sin relieve) y se elimina cualquier fuente DEM sobrante. Con token, el relieve funciona igual que antes.
- **Fix 2 — `bootFlyTo`**: antes de volar hacia el coche pasa la proyección a **mercator** explícitamente, evitando la transición globo→mercator a mitad de vuelo con pitch alto (otra vía conocida de cámara rota/pantalla negra).
- Verificado: 0 errores de sintaxis (incl. módulo ESM), **9/9 tests** (sin token → no añade nav-dem y setTerrain(null); con token → añade el DEM y aplica terreno; 3D sin token → sin DEM; bootFlyTo → mercator antes del flyTo y zoom guardado 15.5).

## 53. nav.html: mapa negro = mapbox-gl exige token; gráfica que crece con la ventana (2026-09-01)
- **Causa raíz del mapa negro (confirmada en el código de mapbox-gl v3.26)**: sin `mapboxgl.accessToken`, tras el primer render completo el mapa llama a `_authenticate()` → `_revokeAuth()` **limpia los buffers GL → pantalla negra**. No es el DEM ni el flyTo (los arreglos de la entrada 52 eran secundarios): sin token NO hay mapa posible en v3.
- **Respaldo local creado**: `PNG/zbuildgs.js` (gitignored, no se sube) con el token de Mapbox recuperado del historial de git — verificado **vivo** vía `tokens/v2` (TokenValid). El mapa vuelve a renderizar en la preview. ⚠️ **ROTA ese token** (quedó expuesto en el historial) y re-guarda tus claves en el panel Keys/API keys para que Freebuff lo regenere con el tuyo nuevo.
- **Gráfica que crece con la ventana**: al arrastrar la esquina de la brújula, el canvas ahora **llena la ventana** (flex 1 1 auto; la escala actúa como tamaño mínimo) y se **redibuja al cambiar el alto**, no solo el ancho.
- Verificado: 0 errores de sintaxis (incl. módulo ESM), zbuildgs.js servido (200), CSS flex y handler de redibujado presentes en la preview.

## 54. Auditoría de claves + página de instrucciones + redacción de respaldos (2026-09-01)
- **Auditoría**: claves expuestas detectadas y tratadas:
  - **Mapbox** `pk.eyJ1…boardinggate11` (la del respaldo local): en historial de git y en 4 respaldos → **rota** (pasos en instrucciones.html §2).
  - **Google/Firebase** `AIzaSyCEAWL1Pj1OM…`: en los mismos respaldos (probada: inválida; redactada igualmente).
  - **OpenChargeMap** `be9a78f7-0f5e-4f28-…`: estaba **hardcodeada en tesla.html** y en **10 respaldos** → movida a `APP_CONFIG.keys.ocm` en tesla.html (respaldo local actualizado) y redactada en todos los respaldos.
- **Redactadas 21 claves** en 11 ficheros de respaldo (A09, A10tesla, A34, A71, LEFT-ultima-luego-mapbox, TESLAB, tesla2antesrutasalternativas, teslaantesdesvioalt, teslasinmantenersesion, z, más las de la primera pasada). Verificado: 0 claves completas restantes en el árbol (salvo el gitignored PNG/zbuildgs.js).
- **Nueva página `instrucciones.html`** (enlazada desde README): qué claves hay y dónde se usan (tesla vs nav), rotación del token de Mapbox paso a paso (con scopes y URL restriction), secret `APP_CONFIG_JSON` + Pages → GitHub Actions, revisión de reglas de Firestore, y tabla de qué configuración aplica a cada app (googleMaps y ocm solo tesla; mapbox/gemini/firebase en ambas; Valhalla/OSRM sin clave solo nav).
- Verificado: 0 errores de sintaxis en tesla.html (4 scripts + ESM), instrucciones.html servido (200).

## 55. nav.html: Overpass muerto eliminado + aviso visible cuando faltan las claves (2026-09-01)
- **`overpass.private.coffee` eliminado** de la lista de endpoints Overpass: su DNS no resuelve (ERR_NAME_NOT_RESOLVED) y además daba errores de CORS en GitHub Pages. Quedan las 4 instancias públicas fiables con CORS (overpass-api.de, kumi.systems, nchc.org.tw, osm.ch).
- **Aviso visible**: si la app carga sin token de Mapbox (p. ej. en GitHub Pages antes de configurar el secret), aparece un banner «⚠️ Claves no configuradas» con enlace a instrucciones.html, en vez de un mapa negro sin explicación. Dismissible con ✕.
- **Diagnóstico GitHub Pages**: el sitio publicado sigue en modo **legacy (deploy from branch)** → sirve el repo sin `PNG/zbuildgs.js` → sin token → mapbox-gl v3 deja el mapa negro (es el bug de la entrada 53). El workflow `deploy-pages.yml` **falla** porque falta el secret `APP_CONFIG_JSON`. **Solución (2 pasos en GitHub)**: (1) Settings → Pages → Source = **GitHub Actions**; (2) Settings → Secrets and variables → Actions → secret `APP_CONFIG_JSON` con el JSON de `window.APP_CONFIG`.
- Verificado: 0 errores de sintaxis (incl. ESM), `overpass.private` fuera de la lista, banner presente.

## 56. Modo simple: claves en el repositorio para que GitHub Pages funcione sin configuración (2026-09-01)
- El usuario no técnico no podía completar el setup de secret + Actions. Solución pragmática: **PNG/zbuildgs.js vuelve a estar versionado** (con el token actual ya verificado, que de todos modos ya estaba expuesto en el historial de git — no añade exposición nueva). Con el modo legacy de Pages (deploy from branch), el sitio publica el fichero y el mapa carga sin ningún paso.
- El workflow `deploy-pages.yml` **ya no falla si falta el secret**: si `APP_CONFIG_JSON` existe lo usa (modo seguro), si no, usa el fichero del repo (modo simple) con un aviso.
- La rotación del token y el modo secret quedan documentados en instrucciones.html para cuando el usuario quiera (no es necesario para que funcione).

## 57. nav.html: consola limpia — crash del handler de errores arreglado + Overpass con circuit breaker (2026-09-01)
- **Bug `msg.includes is not a function`** (línea 852): el handler `map.on('error')` asumía que `e.error.message` era string; con el fallo de los tiles del terreno (DEM) recibía otra forma y **reventaba todo el handler** (el `Uncaught (in promise) TypeError` de la consola). Ahora se coacciona a `String(...)` y no vuelve a crashear.
- **Aluvión de peticiones Overpass**: en cada movimiento del mapa se relanzaban las 4 instancias (radares + POIs + alertas + edificios = hasta 16 peticiones por movimiento). Ahora: **circuit breaker por instancia** (2 fallos seguidos → desactivada 5 min, cualquier éxito la reactiva) y **cooldown global de 60 s** cuando todas fallan → el aluvión de errores de consola desaparece.
- **Endpoints muertos eliminados**: `overpass.nchc.org.tw` (DNS no resuelve, ERR_NAME_NOT_RESOLVED en el navegador del Tesla). Se añade `overpass-api.ams3.klomp.space` (instancia comunitaria fiable con CORS). Quedan: overpass-api.de, klomp.space, osm.ch, kumi.systems.
- **favicon**: añadido `<link rel="icon">` SVG (🧭) — elimina el 404 de `/favicon.ico`.

## 58. nav.html: banner sin texto de más + tiempo hasta la maniobra + instrucciones con etapa actual pinada y salto en simulación (2026-09-01)
- **Banner simplificado**: el cartel de calle (cartel verde con la vía de destino, más grande) pasa a ser el texto principal; la instrucción larga («Gire a la izquierda en Calle X») se elimina del banner — el icono ya indica la maniobra. El texto breve («Derecha», «Salida 2ª», «Destino»…) solo aparece cuando no hay calle (llegada, salida, rotonda sin nombre).
- **Tiempo hasta la maniobra añadido** (lo que faltaba respecto a tesla): «en 3 min / en 45 s / en 1 h 10 min» bajo la distancia, calculado proporcional al ETA restante por distancia.
- **Instrucciones detalladas**: la etapa actual se marca en azul y **se queda pinada en la primera fila** (la lista se reordena de forma circular al cambiar de maniobra). Las filas son clicables.
- **Clic en una instrucción (en modo simulación)**: salta el GPS simulado a **50 m antes del punto de esa maniobra** (medido sobre la geometría de la ruta) y la etapa clickada pasa a ser la actual en la primera fila. Sin simulación, el clic solo vuela la cámara hasta ese punto.

## 59. nav.html: ventana de maniobra reescalable de verdad + minimapa de ruta completa + barra izquierda con navegación + modo libre como tesla (2026-09-01)

- **Ventana de maniobra**: el canvas del minimapa ahora **rellena la ventana** (flex:1, crece en alto y ancho al arrastrar la esquina) y se redibuja en ambas dimensiones — antes solo crecía la ventana, no el dibujo.
- **Minimapa = ruta completa**: ya no muestra solo 1,2 km por delante. Dibuja el **trayecto entero** (decimado a ~400 puntos para rutas largas) con el coche, la próxima maniobra (marcada en rojo) y el destino — así se entiende para qué sirve.
- **Barra superior con navegación**: los botones quedan **fijos arriba a la izquierda** y la **ventana de navegación va debajo de ellos** (se corrigió en la entrada 63). `placeTopbarBtns()` recalcula la posición al abrir/cerrar ventanas.
- **Navegación libre como tesla**: sin ruta activa y circulando a **más de 20 km/h**, la app detecta modo libre — activa el **Free Drive HUD automáticamente** (si estaba apagado) y avisa una vez con un toast. Se resetea al calcular una ruta o finalizarla.

## 60. nav.html: POIs por fin visibles — 1 query unión por vista + depuración en pantalla (2026-09-01)

### 60.1 Por qué no se veían los POIs (diagnóstico con peticiones reales)

- **9 queries por refresco**: `refreshPois` lanzaba una petición Overpass por cada
  categoría (hasta 9) y **solo creaba los marcadores cuando TODAS terminaban**.
  Con overpass-api.de bajo carga (5–16 s por query), el usuario esperaba 1–2
  minutos sin ver nada.
- **429/504/406 encadenados**: las instancias devuelven 406 a UAs raros sin
  Referer, 429 por exceso de peticiones y 504 bajo carga. Cualquier fallo total
  disparaba el **cooldown global de 60 s** y el refresco abortaba las categorías
  restantes → 0 marcadores y 60 s más de espera.
- **Endpoints muertos en la cadena**: klomp.ams3 (DNS no resuelve), kumi.systems
  (502/timeout), osm.ch (200 pero **siempre 0 elementos** para Madrid) → la
  cadena de fallback perdía 10–20 s antes de declarar el fallo.

### 60.2 La solución

- **UNA query unión por refresco** (todas las categorías seleccionadas en una
  sola petición Overpass, `[out:json][timeout:12]`): 1 petición en vez de 9.
- **Área = viewport visible** (bbox del mapa ampliado un 25 % cuando zoom ≥ 11;
  con zoom de globo se salta el refresco): en zoom de conducción la query tarda
  **1–3 s** y devuelve solo lo que se ve (probado: 4.666 elementos en 3 s en
  Madrid). Con zoom < 11 no se marca `lastLayerFetch`, así el aterrizaje del
  flyTo refresca al instante con bbox.
- **Icono por elemento** (`poiIconFor`): al venir todo mezclado en la unión, el
  icono se deduce de los tags de cada POI (amenity/shop/tourism/leisure), con
  📍 de fallback.
- **Orden por distancia y límite 150**: se ordenan por distancia al centro de
  pantalla y se muestran los 150 más cercanos.
- **No se borran los marcadores si falla la red**: los nuevos se crean primero y
  solo después se limpian los viejos; si Overpass falla, se conservan los POIs
  actuales en vez de quedarse el mapa vacío.
- **Fallback endurecido**: un 200 con 0 elementos solo se acepta de la instancia
  principal (overpass-api.de tiene datos globales; osm.ch devuelve 0 siempre).
  Los fallbacks solo se usan ante fallos de red/HTTP. Timeout 10 s, cooldown
  global reducido a **30 s** con auto-reintento a los 31 s.
- **Lista de endpoints depurada**: se eliminan klomp.ams3 (DNS muerto) y se
  documentan los descartados (private.coffee, nchc.org.tw, openstreetmap.fr
  [403 CORS], osm.jp). Quedan overpass-api.de (principal), kumi.systems y
  osm.ch (último recurso).

### 60.3 Depuración visible (chip + panel)

- **Chip 📍 abajo a la izquierda** (`#poi-status`): muestra el estado en vivo —
  «📍 N POIs», «0 POIs — buscando…», «Overpass sin respuesta, reintento en Xs»
  o «POIs desactivados». Clic → abre el **panel de depuración** (`#dbg-panel`)
  con el log de Overpass/POIs (tiempos, instancia usada, fallos) y botón
  «↻ Reintentar» que limpia el cooldown y refresca al momento.
- **Logs en consola** con prefijo `[nav]` para diagnóstico remoto.

### 60.4 Verificación

- Harness `test-poi-live.cjs` con fetch real (headers de navegador): 12/12 PASS
  — `fetchOverpass` devuelve datos reales (89 gasolineras en Madrid), la query
  unión bbox devuelve 4.666 elementos en ~3 s, `refreshPois` crea **150
  marcadores** con iconos y dedupe por coordenadas. Con el servidor caído/limitado
  se conservan los marcadores actuales y se reintenta a los 30 s.
- 0 errores de sintaxis en el script principal.

## 61. nav.html: brújula más grande, emblema Tesla sin med/máx y brújula = toggle de la curva (2026-09-01)

- **Brújula un poco más grande**: `#hud-compass` pasa de 34 px a **44 px** (56 px en modo agrandado).
- **Emblema Tesla sin vel. media/máx**: se elimina la fila `Med — · Máx —` del icono de Tesla (el emblema queda solo con la velocidad actual). Las medias/máximos siguen visibles en la **gráfica** (modo velocidad).
- **Brújula = toggle de la curva**: tocar la brújula **oculta/muestra la gráfica del HUD** (clase `hud-mini`) en vez de agrandar toda la tarjeta, y ya no propaga el clic al contenedor.
- **Más compacta**: padding/gap del panel reducido, emblema con menos padding y velocidad un punto menor, `min-width` 196→170 px.

## 62. nav.html: brújula = modo compacto que cierra la curva y deja solo brújula + velocidad (2026-09-01)

- **Evolución del toggle de la brújula**: en lugar de solo esconder la gráfica (`hud-nograph`), tocar la brújula activa **`hud-mini`**: cierra la ventana de la gráfica **y su contenedor** (estadísticas alt/mín, orientación y asa de redimensionado) y deja visible **solo la brújula + la velocidad en un emblema Tesla más pequeño** (píldora: brújula 26 px, velocidad 15 px, emblema compacto).
- Al compactar se guarda el tamaño redimensionado del contenedor y se restaura al expandir de nuevo; se preserva la velocidad actual en el emblema.

## 63. nav.html: los botones de la barra superior no bajan — la ventana de navegación va debajo de ellos (2026-09-01)

- **Corrección de la posición de los botones**: la entrada 59 colocaba los botones (🔍 ⭐ 🤖 ⚠️ 📋) **justo debajo** de la ventana de navegación (banner/detallada), lo que el usuario rechazó. Ahora la fila de botones queda **fija arriba a la izquierda** (`top:10`) y es la **ventana de navegación la que se coloca debajo de esa fila** (`btnBottom=54 px`: fila de 42 px + margen).
- `placeTopbarBtns()` ahora posiciona el **banner** a 54 px y la **lista detallada** justo debajo del banner (o a 54 px si no hay banner), y restablece las posiciones al salir de navegación o al mostrar la ruta en previsualización.
- Se elimina la regla CSS `#topbar.banner-on #topbar-btns{top:78px}` (ya no se baja la fila de botones).

## 64. nav.html: sonido de salida de rotonda, coche flecha, instrucciones al clic y ventana de maniobra con mapa de fondo (2026-09-01)

- **Sonido especial al salir de la rotonda**: el tono `roundabout-exit` pasa a un patrón de 4 notas sube-baja (600→900→600→900→1200 Hz, triángulo, más potente) que suena en el momento exacto de salir (≤40 m) y en el aviso cercano. También cubre ahora los tipos `rotary` / `exit-rotary` (antes solo `roundabout`/`exit-roundabout`).
- **Coche otra vez una flecha**: se usaba `PNG/Coche_Sat.PNG` (la «etiqueta»). Se restaura la **flecha** `CAR_ICON` (SVG azul con punta hacia arriba, ya definido pero sin usar) que rota con el rumbo.
- **Instrucciones detalladas al hacer clic en la navegación**: tocar el **banner** de navegación oculta/muestra la lista de instrucciones detalladas (`#route-detail`), y reposiciona la barra de botones (`placeTopbarBtns()`).
- **Ventana de maniobra con mapa de fondo**: el minimapa pasa de un canvas a un **mini mapa real** (segunda instancia mapboxgl ligera, `interactive:false`, con el estilo/proveedor activo) que dibuja la **ruta completa**, la próxima maniobra (rojo), el destino y el coche. Se encuadra (`fitBounds`) a la ruta y se reencuadra al cambiar ruta o al redimensionar.
- **La ventana se puede mover**: ahora se arrastra desde cualquier punto de la ventana (`makeMovableWin`, la esquina sigue redimensionando) y la **posición queda guardada** en localStorage (`nav_mnvX`/`nav_mnvY`). Tamaño por defecto 280×200 px.
