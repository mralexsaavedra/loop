/* Client-side copy for the header freshness line + Sync button (web/src/client/freshness.js), baked
 * as I18N_SYNC by layouts/Plan.astro. JSON-safe only: `{n}` placeholders, substituted client-side.
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
  wait: 'Espera un momento',
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
  wait: 'Wait a moment',
};
