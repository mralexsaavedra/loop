/* Header freshness line + Sync button. Module script (bundled into the page, docs/plan-page.md → Module scripts): reads I18N_SYNC baked by
 * layouts/Plan.astro and the shared HC helpers (util.js).
 *
 * Everything is decided HERE, at view time: the build bakes no time and no URL state, so consecutive
 * builds stay byte-identical. On load it asks the page's own server for
 *   GET /api/sync/status  (loop-ingest via loop-web nginx: timestamps only)
 *   GET /status.json      (written by services/loop-web/refresh.sh after each publish)
 * The top bar stays ONE row: a status dot + the Shortcut age ("hace 5 min", #fresh-sum, the dot carries
 * the worst source level), an icon-only Sync button (spinner class `is-busy` while syncing) and the
 * avatar. The full per-source line "Atajo: hace 5 min · Strava: hace 2 h · Página: hace 1 min" is the
 * summary's title / aria-label and sits in a popover (#fresh-pop) a tap on the summary toggles. A
 * source older than MID_HOURS turns --mid with a short hint, older than LOW_HOURS --low. When /api/sync/status is not
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
import type { PageGlobals } from './page-globals';

// the page globals this script reads (util.js's HC; I18N_SYNC baked by layouts/Plan.astro)
declare const HC: PageGlobals['HC'];
declare const I18N_SYNC: PageGlobals['I18N_SYNC'];

/** GET /api/sync/status (loop-ingest status.js snapshot): timestamps and the trigger's error, never data. */
type SyncStatus = {
  lastShortcutAt?: string | null; lastStravaOkAt?: string | null; stravaConfigured?: boolean;
  lastTriggerError?: string | null; lastTriggerErrorSeq?: number | null;
};
/** GET /status.json (written after each publish): when the page was built and which sync seq it covers. */
type PageStatus = { publishedAt?: string | null; processedSeq?: number | null; error?: string | null; errorSeq?: number | null };
type Level = 'mid' | 'low' | null;
type Age = { text: string; level: Level };
type Source = 'shortcut' | 'strava' | 'page';
type Item = { a: Age; plain: string; html: string };

(function () {
  var found = document.getElementById('freshness');
  if (!found) return;
  var host: HTMLElement = found;
  try {
    if (typeof fetch !== 'function' || typeof I18N_SYNC === 'undefined') return;
    var T = I18N_SYNC;
    // the markup ships all three (layouts/Plan.astro); a missing one throws below and the catch hides the line
    var line = document.getElementById('fresh-line') as HTMLElement;
    var btn = document.getElementById('sync-btn') as HTMLButtonElement;
    var msg = document.getElementById('sync-msg') as HTMLElement;
    var sum = document.getElementById('fresh-sum');
    var short = document.getElementById('fresh-short');
    var pop = document.getElementById('fresh-pop');
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
    var REQ_MS = 15000; // one request (a status read, the Sync POST): a hung service fails it, never a forever-busy button

    var busy = false;

    function getJson(url: string): Promise<any> {
      if (!HC.lan()) return Promise.resolve(null);
      return HC.fetchJson(url, { cache: 'no-store' }, REQ_MS)
        .catch(function () { return null; });
    }

    function age(iso: unknown): Age {
      var t = typeof iso === 'string' ? Date.parse(iso) : NaN;
      if (!isFinite(t)) return { text: T.never, level: 'low' };
      var ms = Math.max(0, Date.now() - t);
      var hours = ms / HOUR_MS;
      var txt: string;
      if (ms < MIN_MS) txt = T.now;
      else if (ms < HOUR_MS) txt = format(T.minAgo, { n: Math.floor(ms / MIN_MS) });
      else if (hours < DAYS_AFTER_HOURS) txt = format(T.hAgo, { n: Math.floor(hours) });
      else txt = format(T.dAgo, { n: Math.floor(hours / 24) });
      return { text: txt, level: hours >= LOW_HOURS ? 'low' : hours >= MID_HOURS ? 'mid' : null };
    }

    function item(key: Source, iso: string | null | undefined): Item {
      var a = age(iso);
      var body = esc(T.labels[key] + ': ' + a.text);
      if (a.level) body += ' <em class="fresh-hint">(' + esc(T.hints[key]) + ')</em>';
      return { a: a, plain: T.labels[key] + ': ' + a.text, html: '<span class="fresh-item' + (a.level ? ' fresh-' + a.level : '') + '">' + body + '</span>' };
    }

    function render(status: SyncStatus, page: PageStatus | null): void {
      var items = [item('shortcut', status.lastShortcutAt)];
      if (status.stravaConfigured) items.push(item('strava', status.lastStravaOkAt));
      if (page && page.publishedAt) items.push(item('page', page.publishedAt));
      line.innerHTML = items.map(function (x) { return x.html; }).join(' · ');
      var worst: Level = null;
      items.forEach(function (x) { if (x.a.level === 'low' || (x.a.level === 'mid' && !worst)) worst = x.a.level; });
      var detail = items.map(function (x) { return x.plain; }).join(' · ');
      if (short) short.textContent = items[0].a.text;
      if (sum) {
        sum.classList.remove('fresh-sum-mid');
        sum.classList.remove('fresh-sum-low');
        if (worst) sum.classList.add('fresh-sum-' + worst);
        sum.setAttribute('title', detail);
        sum.setAttribute('aria-label', T.ariaLabel + ': ' + detail);
      }
    }

    function setPop(open: boolean): void {
      if (!pop || !sum) return;
      pop.hidden = !open;
      sum.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    // the dock's "+" lists Sync only while this group is shown (client/nav-actions.js)
    function actionsChanged() {
      try {
        if (typeof window !== 'undefined' && window.HCActions) window.HCActions.refresh();
      } catch (e) { /* the "+" keeps its last state */ }
    }
    function load(): Promise<void> {
      return Promise.all([getJson(STATUS_URL), getJson(PAGE_URL)]).then(function (res) {
        var status: SyncStatus | null = res[0];
        if (!status || typeof status !== 'object' || !('lastShortcutAt' in status)) {
          host.hidden = true;
          actionsChanged();
          return;
        }
        render(status, res[1]);
        host.hidden = false;
        actionsChanged();
      }).catch(function () { host.hidden = true; actionsChanged(); });
    }

    function setBusy(on: boolean): void {
      busy = on;
      btn.disabled = on;
      btn.classList.toggle('is-busy', on);
      btn.setAttribute('aria-busy', on ? 'true' : 'false');
    }

    function finish(text: string): void {
      setBusy(false);
      msg.textContent = text;
    }

    function isSeq(n: unknown): n is number {
      return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n;
    }

    function reason(code: string): string {
      var known = Object.prototype.hasOwnProperty.call(T.errors, code) && code !== 'unknown';
      return format(T.failedCode, { reason: known ? T.errors[code] : T.errors.unknown });
    }

    // What the latest reads say about `seq`: 'done', an error code, or null (keep waiting).
    function verdict(seq: number, page: PageStatus | null, status: SyncStatus | null): string | null {
      if (page && isSeq(page.processedSeq) && page.processedSeq >= seq) return 'done';
      if (page && page.error && isSeq(page.errorSeq) && page.errorSeq >= seq) return String(page.error);
      if (status && status.lastTriggerError && isSeq(status.lastTriggerErrorSeq) && status.lastTriggerErrorSeq >= seq) {
        return String(status.lastTriggerError);
      }
      return null;
    }

    function poll(seq: number): void {
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
      setBusy(true);
      msg.textContent = T.syncing;
      if (!HC.lan()) { finish(T.failed); return; }
      HC.fetchJson(SYNC_URL, { method: 'POST' }, REQ_MS)
        .then(function (body: { seq?: unknown } | null) {
          if (body && isSeq(body.seq)) poll(body.seq);
          else finish(T.failed);
        })
        .catch(function () { finish(T.failed); });
    }

    btn.addEventListener('click', sync);
    if (sum && pop) {
      var sumEl: HTMLElement = sum, popEl: HTMLElement = pop;
      sumEl.addEventListener('click', function () { setPop(!!popEl.hidden); });
      // Escape or a tap anywhere outside closes the popover (browser only; the stub has no document events)
      if (typeof document.addEventListener === 'function') {
        document.addEventListener('keydown', function (e) { if (e && e.key === 'Escape' && !popEl.hidden) { setPop(false); sumEl.focus(); } });
        document.addEventListener('click', function (e) {
          var t = e && (e.target as Element | null);
          if (!popEl.hidden && t && t.closest && !t.closest('#freshness')) setPop(false);
        });
      }
    }
    load();
  } catch (e) {
    // optional feature: a failure here must never break the page
    host.hidden = true;
  }
})();
