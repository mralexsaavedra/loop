/* Client-side copy for the header freshness line + Sync button (web/src/client/freshness.ts), baked
 * as I18N_SYNC by layouts/Plan.astro. JSON-safe only: `{n}` / `{reason}` placeholders, substituted
 * client-side (`{date}`: the Garmin key's expiry date). `errors` maps the coarse refresh/ingest failure codes (refresh.sh status.json `error`,
 * ingest `lastTriggerError`) to a short reason.
 * Plain text (escaped when rendered), no markup. */
export const es = {
  ariaLabel: 'Frescura de los datos',
  labels: { shortcut: 'Atajo', strava: 'Strava', garmin: 'Garmin', page: 'Página' },
  now: 'ahora',
  minAgo: 'hace {n} min',
  hAgo: 'hace {n} h',
  dAgo: 'hace {n} d',
  never: 'nunca',
  hints: { shortcut: 'abre el Atajo en el iPhone', strava: 'revisa la conexión con Strava', garmin: 'revisa la conexión con Garmin', page: 'la actualización automática no corre' },
  // the Garmin key (GARMIN_API_KEY on the server, optional GARMIN_API_KEY_EXPIRES = the date Garmin showed for it)
  garminKey: {
    refused: 'Garmin rechaza la clave: crea una nueva en Garmin Connect y cámbiala en GARMIN_API_KEY y GARMIN_API_KEY_EXPIRES del servidor',
    expires: 'la clave de Garmin caduca el {date}: crea una nueva en Garmin Connect y cámbiala en GARMIN_API_KEY y GARMIN_API_KEY_EXPIRES del servidor',
    expired: 'la clave de Garmin caducó el {date}: crea una nueva en Garmin Connect y cámbiala en GARMIN_API_KEY y GARMIN_API_KEY_EXPIRES del servidor',
  },
  button: 'Sincronizar',
  syncing: 'Sincronizando…',
  failed: 'No se pudo actualizar, reintenta',
  failedCode: 'No se pudo actualizar: {reason}',
  errors: {
    branch: 'el servidor no está en la rama main',
    install: 'falló la instalación de dependencias',
    build: 'falló la generación de la página',
    sanity: 'la página generada no es válida',
    lock: 'otra actualización sigue en curso',
    trigger_write: 'el servicio no pudo avisar al servidor',
    unknown: 'error desconocido',
  },
};

export const en = {
  ariaLabel: 'Data freshness',
  labels: { shortcut: 'Shortcut', strava: 'Strava', garmin: 'Garmin', page: 'Page' },
  now: 'just now',
  minAgo: '{n} min ago',
  hAgo: '{n} h ago',
  dAgo: '{n} d ago',
  never: 'never',
  hints: { shortcut: 'open the Shortcut on the iPhone', strava: 'check the Strava connection', garmin: 'check the Garmin connection', page: 'the automatic refresh is not running' },
  garminKey: {
    refused: 'Garmin refuses the key: create a new one in Garmin Connect and set it as GARMIN_API_KEY and GARMIN_API_KEY_EXPIRES on the server',
    expires: 'the Garmin key expires on {date}: create a new one in Garmin Connect and set it as GARMIN_API_KEY and GARMIN_API_KEY_EXPIRES on the server',
    expired: 'the Garmin key expired on {date}: create a new one in Garmin Connect and set it as GARMIN_API_KEY and GARMIN_API_KEY_EXPIRES on the server',
  },
  button: 'Sync',
  syncing: 'Syncing…',
  failed: 'Could not update, try again',
  failedCode: 'Could not update: {reason}',
  errors: {
    branch: 'the server is not on the main branch',
    install: 'installing dependencies failed',
    build: 'the page build failed',
    sanity: 'the built page is not valid',
    lock: 'another refresh is still running',
    trigger_write: 'the service could not notify the server',
    unknown: 'unknown error',
  },
};
