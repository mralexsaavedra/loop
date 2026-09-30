/* Header freshness line + Sync button. Classic script (is:inline): reads I18N_SYNC baked by
 * layouts/Plan.astro and the shared HC helpers (util.js).
 *
 * Everything is decided HERE, at view time: the build bakes no time and no URL state, so consecutive
 * builds stay byte-identical. On load it asks the page's own server for
 *   GET /api/sync/status  (health-ingest via plan-web nginx: timestamps only)
 *   GET /status.json      (written by services/plan-web/refresh.sh after each publish)
 * and shows "Atajo: hace 5 min · Strava: hace 2 h · Página: hace 1 min". A source older than
 * MID_HOURS turns --mid with a short hint, older than LOW_HOURS --low. When /api/sync/status is not
 * reachable (example build, file://, a claude.ai artifact, a clone without the ingest service) the
 * line AND the button stay hidden — nothing to sync against.
 *
 * Sync: POST /api/sync, then poll /status.json every POLL_MS until a publish newer than the one seen
 * at click time lands (not older than the click minus SKEW_MS, to tolerate a phone/server clock
 * offset), then reload. TIMEOUT_MS without one -> failure message; 429 -> "wait a moment". */
(function () {
  var host = document.getElementById('freshness');
  if (!host) return;
  try {
    if (typeof fetch !== 'function' || typeof I18N_SYNC === 'undefined') return;
    var T = I18N_SYNC;
    var line = document.getElementById('fresh-line');
    var btn = document.getElementById('sync-btn');
    var msg = document.getElementById('sync-msg');
    var esc = HC.esc, format = HC.format;

    var STATUS_URL = '/api/sync/status';
    var SYNC_URL = '/api/sync';
    var PAGE_URL = '/status.json';
    var MIN_MS = 60000;
    var HOUR_MS = 60 * MIN_MS;
    var MID_HOURS = 24;
    var LOW_HOURS = 72;
    var DAYS_AFTER_HOURS = 48; // "hace 30 h" up to 2 days, then "hace 3 d"
    var POLL_MS = 5000;
    var TIMEOUT_MS = 4 * MIN_MS;
    var SKEW_MS = 2 * MIN_MS;

    var busy = false;

    function getJson(url) {
      return fetch(url, { cache: 'no-store' })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }

    function age(iso) {
      var t = typeof iso === 'string' ? Date.parse(iso) : NaN;
      if (!isFinite(t)) return { text: T.never, level: 'low' };
      var ms = Math.max(0, Date.now() - t);
      var hours = ms / HOUR_MS;
      var txt;
      if (ms < MIN_MS) txt = T.now;
      else if (ms < HOUR_MS) txt = format(T.minAgo, { n: Math.floor(ms / MIN_MS) });
      else if (hours < DAYS_AFTER_HOURS) txt = format(T.hAgo, { n: Math.floor(hours) });
      else txt = format(T.dAgo, { n: Math.floor(hours / 24) });
      return { text: txt, level: hours >= LOW_HOURS ? 'low' : hours >= MID_HOURS ? 'mid' : null };
    }

    function item(key, iso) {
      var a = age(iso);
      var body = esc(T.labels[key] + ': ' + a.text);
      if (a.level) body += ' <em class="fresh-hint">(' + esc(T.hints[key]) + ')</em>';
      return '<span class="fresh-item' + (a.level ? ' fresh-' + a.level : '') + '">' + body + '</span>';
    }

    function render(status, page) {
      var items = [item('shortcut', status.lastShortcutAt)];
      if (status.stravaConfigured) items.push(item('strava', status.lastStravaOkAt));
      if (page && page.publishedAt) items.push(item('page', page.publishedAt));
      line.innerHTML = items.join(' · ');
    }

    function load() {
      return Promise.all([getJson(STATUS_URL), getJson(PAGE_URL)]).then(function (res) {
        var status = res[0];
        if (!status || typeof status !== 'object' || !('lastShortcutAt' in status)) {
          host.hidden = true;
          return;
        }
        render(status, res[1]);
        host.hidden = false;
      }).catch(function () { host.hidden = true; });
    }

    function finish(text) {
      busy = false;
      btn.disabled = false;
      msg.textContent = text;
    }

    function poll(clickAt, baseline) {
      var deadline = clickAt + TIMEOUT_MS;
      function tick() {
        getJson(PAGE_URL).then(function (page) {
          var p = page && page.publishedAt;
          var t = p ? Date.parse(p) : NaN;
          if (p && p !== baseline && t > clickAt - SKEW_MS) {
            window.location.reload();
            return;
          }
          if (Date.now() >= deadline) finish(T.failed);
          else setTimeout(tick, POLL_MS);
        });
      }
      setTimeout(tick, POLL_MS);
    }

    function sync() {
      if (busy) return;
      busy = true;
      btn.disabled = true;
      msg.textContent = T.syncing;
      var clickAt = Date.now();
      var baseline = null;
      getJson(PAGE_URL)
        .then(function (page) {
          baseline = (page && page.publishedAt) || null;
          return fetch(SYNC_URL, { method: 'POST' });
        })
        .then(function (r) {
          if (r.status === 429) finish(T.wait);
          else if (!r.ok) finish(T.failed);
          else poll(clickAt, baseline);
        })
        .catch(function () { finish(T.failed); });
    }

    btn.addEventListener('click', sync);
    load();
  } catch (e) {
    // optional feature: a failure here must never break the page
    host.hidden = true;
  }
})();
