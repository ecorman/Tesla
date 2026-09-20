/* Configuracion local minima (sin servicios en la nube ni claves de Google/Firebase).
   - mapbox: SIN clave en el repo. La clave real se inyecta en el despliegue de
     GitHub Pages por .github/workflows/pages.yml desde el Actions secret MAPBOX.
   - ocm: Open Charge Map public key (puntos de recarga).
   Sin clave de mapbox, el mapa usa OSM/Esri raster como respaldo automatico. */
window.APP_CONFIG = {"firebase":{},"keys":{"mapbox":"","ocm":"be9a78f7-0f5e-4f28-b742-4b7ab4b7eb5a"},"endpoints":{}};