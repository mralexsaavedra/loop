/* Client-side copy for the header freshness line + Sync button (web/src/client/freshness.js), baked
 * as I18N_SYNC by layouts/Plan.astro. JSON-safe only: `{n}` / `{reason}` placeholders, substituted
 * client-side. `errors` maps the coarse refresh/ingest failure codes (refresh.sh status.json `error`,
 * ingest `lastTriggerError`) to a short reason.
 * Plain text (escaped when rendered), no markup. */
export const es = {
  ariaLabel: 'Frescura de los datos',
  labels: { shortcut: 'Atajo', strava: 'Strava', page: 'Página' },
  now: 'ahora',
  minAgo: 'hace {n} min',
  hAgo: 'hace {n} h',
  dAgo: 'hace {n} d',
  never: 'nunca',
  hints: { shortcut: 'abre el Atajo en el iPhone', strava: 'revisa la conexión con Strava', page: 'la actualización automática no corre' },
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
  labels: { shortcut: 'Shortcut', strava: 'Strava', page: 'Page' },
  now: 'just now',
  minAgo: '{n} min ago',
  hAgo: '{n} h ago',
  dAgo: '{n} d ago',
  never: 'never',
  hints: { shortcut: 'open the Shortcut on the iPhone', strava: 'check the Strava connection', page: 'the automatic refresh is not running' },
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
