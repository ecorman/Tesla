/* EJEMPLO de estructura — NO contiene claves reales.
   El valor de window.APP_CONFIG que pegas en el secret APP_CONFIG_JSON
   (Settings -> Secrets and variables -> Actions) debe tener esta forma:

{
  "firebase": {
    "apiKey": "TU_API_KEY",
    "authDomain": "tu-proyecto.firebaseapp.com",
    "databaseURL": "https://tu-proyecto-default-rtdb.europe-west1.firebaseio.com",
    "projectId": "tu-proyecto",
    "storageBucket": "tu-proyecto.appspot.com",
    "messagingSenderId": "000000000000",
    "appId": "1:000000000000:web:0000000000000000000000"
  },
  "keys": {
    "googleMaps": "AIza...",
    "mapbox": "pk.eyJ1...",
    "ocm": "tu-clave-openchargemap",
    "sys_token_v2": "AIza... (la misma que googleMaps, la usa Gemini)"
  },
  "endpoints": {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=TU_API_KEY"
  }
}

El workflow deploy-pages.yml lo convierte en:
  window.APP_CONFIG = { ...el JSON que pegaste... };
y lo escribe en PNG/zbuildgs.js durante el despliegue.
*/
