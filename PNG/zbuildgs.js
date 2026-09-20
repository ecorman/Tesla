/* Configuracion local minima (sin servicios en la nube ni claves de Google/Firebase).
   - mapbox: public token para Mapbox GL (restringir por dominio en Mapbox si se desea).
   - ocm: Open Charge Map public key (puntos de recarga).
   Se eliminan los antiguos bloques firebase / googleMaps / gemini (claves expuestas).
   Si no hay claves de mapbox/ocm, el mapa usa OSM raster como respaldo. */
window.APP_CONFIG = {"firebase":{},"keys":{"mapbox":"pk.eyJ1IjoiYm9hcmRpbmdnYXRlMTEiLCJhIjoiY21kOHdtMGU4MDEzaTJpcGh4cng0c3hmMiJ9.hDdGn_5VOMkN_bTuUowtRw","ocm":"be9a78f7-0f5e-4f28-b742-4b7ab4b7eb5a"},"endpoints":{}};