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
 * Sync, sequence protocol (no clock comparison at all): POST /api/sync answers 202 {seq, coalesced};
 * then every POLL_MS read /status.json (refresh.sh) and /api/sync/status (ingest):
 *   - status.json processedSeq >= seq            -> reload (a publish that covers the click);
 *   - status.json errorSeq >= seq with `error`   -> fail fast, "No se pudo actualizar: <reason>";
 *   - ingest lastTriggerErrorSeq >= seq          -> fail fast (the trigger file could not be written);
 *   - TIMEOUT_MS without either                  -> the generic failure message.
 * Error codes are mapped through I18N_SYNC.errors; an unknown code shows the generic reason. */
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
    var TIMEOUT_MS = 5 * MIN_MS;

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

    function isSeq(n) {
      return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n;
    }

    function reason(code) {
      var known = Object.prototype.hasOwnProperty.call(T.errors, code) && code !== 'unknown';
      return format(T.failedCode, { reason: known ? T.errors[code] : T.errors.unknown });
    }

    // What the latest reads say about `seq`: 'done', an error code, or null (keep waiting).
    function verdict(seq, page, status) {
      if (page && isSeq(page.processedSeq) && page.processedSeq >= seq) return 'done';
      if (page && page.error && isSeq(page.errorSeq) && page.errorSeq >= seq) return String(page.error);
      if (status && status.lastTriggerError && isSeq(status.lastTriggerErrorSeq) && status.lastTriggerErrorSeq >= seq) {
        return String(status.lastTriggerError);
      }
      return null;
    }

    function poll(seq) {
      var deadline = Date.now() + TIMEOUT_MS;
      function tick() {
        Promise.all([getJson(PAGE_URL), getJson(STATUS_URL)]).then(function (res) {
          var v = verdict(seq, res[0], res[1]);
          if (v === 'done') {
            window.location.reload();
            return;
          }
          if (v) finish(reason(v));
          else if (Date.now() >= deadline) finish(T.failed);
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
      fetch(SYNC_URL, { method: 'POST' })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (body) {
          if (body && isSeq(body.seq)) poll(body.seq);
          else finish(T.failed);
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
