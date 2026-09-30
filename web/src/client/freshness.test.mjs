/* web/src/client/freshness.js — header freshness line + Sync button. Runs the real classic script in
 * node:vm against web/test/dom-stub.mjs with a stubbed fetch, a controllable clock and collected
 * timers (nothing real is requested, nothing waits). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { en as enSync, es as esSync } from '../i18n/sync-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'freshness.js'), 'utf8');

const NOW = Date.parse('2030-01-10T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const text = (html) => html.replace(/<[^>]+>/g, '');

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** routes: { 'GET /api/sync/status': fn|response, ... }; a function gets the call index. */
function setup({ routes = {}, locale = 'es' } = {}) {
  const clock = { t: NOW };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock.t); }
    static now() { return clock.t; }
  }
  const timers = [];
  const calls = [];
  const counts = {};
  const fetch = async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    calls.push(key);
    counts[key] = (counts[key] || 0) + 1;
    const route = routes[key];
    if (route === undefined) throw new TypeError('Failed to fetch');
    const res = typeof route === 'function' ? route(counts[key]) : route;
    if (res instanceof Error) throw res;
    return res;
  };
  const doc = new StubDocument();
  const host = doc.el('freshness', { hidden: true });
  const line = doc.el('fresh-line');
  const btn = doc.el('sync-btn', { tag: 'button' });
  const msg = doc.el('sync-msg');
  const sum = doc.el('fresh-sum', { tag: 'button', attrs: { 'aria-expanded': 'false' } });
  const short = doc.el('fresh-short');
  const pop = doc.el('fresh-pop', { hidden: true });
  const reloads = [];
  const window = { location: { reload: () => reloads.push(clock.t) } };
  const ctx = {
    document: doc, window, fetch, I18N_SYNC: locale === 'es' ? esSync : enSync, LOCALE: locale,
    Math, String, Number, JSON, Promise, Date: FakeDate,
    setTimeout: (fn, ms) => { timers.push({ fn, at: clock.t + ms }); return timers.length; },
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);

  /** advance the clock to `ms` later, firing due timers in order */
  async function advance(ms) {
    const end = clock.t + ms;
    for (;;) {
      await flush();
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      clock.t = next.at;
      next.fn();
    }
    clock.t = end;
    await flush();
  }
  return { host, line, btn, msg, sum, short, pop, calls, reloads, clock, advance };
}

const freshStatus = {
  lastShortcutAt: iso(NOW - 5 * MIN),
  lastStravaOkAt: iso(NOW - 2 * H),
  lastStravaError: null,
  lastTriggerAt: null,
  lastTriggerError: null,
  lastTriggerErrorSeq: null,
  triggerSeq: 0,
  stravaConfigured: true,
};

test('ingest unreachable (example build, file://, no service): line and button stay hidden', async () => {
  const s = setup();
  await s.advance(0);
  assert.equal(s.host.hidden, true);
  assert.equal(s.line.innerHTML, '');
});

test('a non-OK status answer (404/502) also hides everything', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json({ error: 'not found' }, 404), 'GET /status.json': json({ publishedAt: iso(NOW) }) } });
  await s.advance(0);
  assert.equal(s.host.hidden, true);
});

test('fresh sources: "Atajo: hace 5 min · Strava: hace 2 h · Página: hace 1 min", no warning colour', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ publishedAt: iso(NOW - MIN), commit: 'abc1234', branch: 'main' }) } });
  await s.advance(0);
  assert.equal(s.host.hidden, false);
  assert.equal(text(s.line.innerHTML), 'Atajo: hace 5 min · Strava: hace 2 h · Página: hace 1 min');
  assert.doesNotMatch(s.line.innerHTML, /fresh-mid|fresh-low/);
});

test('English copy', async () => {
  const s = setup({ locale: 'en', routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ publishedAt: iso(NOW - 10 * 1000) }) } });
  await s.advance(0);
  assert.equal(text(s.line.innerHTML), 'Shortcut: 5 min ago · Strava: 2 h ago · Page: just now');
});

test('> 24 h = mid colour + hint, > 72 h = low colour + hint', async () => {
  const s = setup({
    routes: {
      'GET /api/sync/status': json({ ...freshStatus, lastShortcutAt: iso(NOW - 30 * H), lastStravaOkAt: iso(NOW - 80 * H), lastStravaError: 'strava_auth' }),
      'GET /status.json': json({ publishedAt: iso(NOW - MIN) }),
    },
  });
  await s.advance(0);
  const html = s.line.innerHTML;
  assert.match(html, /<span class="fresh-item fresh-mid">Atajo: hace 30 h <em class="fresh-hint">\(abre el Atajo en el iPhone\)<\/em><\/span>/);
  assert.match(html, /<span class="fresh-item fresh-low">Strava: hace 3 d <em class="fresh-hint">\(revisa la conexión con Strava\)<\/em><\/span>/);
  assert.match(html, /<span class="fresh-item">Página: hace 1 min<\/span>/);
});

test('Strava not configured -> no Strava item; no status.json yet -> no Página item', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json({ ...freshStatus, stravaConfigured: false, lastStravaOkAt: null }), 'GET /status.json': json({}, 404) } });
  await s.advance(0);
  assert.equal(text(s.line.innerHTML), 'Atajo: hace 5 min');
  assert.equal(s.host.hidden, false, 'the button still works without status.json');
});

test('Strava configured but never succeeded -> "nunca" in the low colour; no Shortcut payload yet -> "nunca"', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json({ ...freshStatus, lastShortcutAt: null, lastStravaOkAt: null }), 'GET /status.json': json({ publishedAt: iso(NOW) }) } });
  await s.advance(0);
  assert.match(s.line.innerHTML, /fresh-low">Atajo: nunca/);
  assert.match(s.line.innerHTML, /fresh-low">Strava: nunca/);
});

const accepted = (seq, coalesced = false) => json({ ok: true, seq, coalesced }, 202);

test('Sync: POST, "Sincronizando…", polls every 5 s, reloads once status.json processedSeq reaches the click seq', async () => {
  const pages = [{ processedSeq: 6 }, { processedSeq: 6 }, { processedSeq: 7 }];
  let polls = 0;
  const s = setup({
    routes: {
      'GET /api/sync/status': json(freshStatus),
      'GET /status.json': (n) => (n === 1 ? json({ publishedAt: iso(NOW - H), processedSeq: 6 }) : json({ publishedAt: iso(NOW - H), ...pages[Math.min(polls++, pages.length - 1)] })),
      'POST /api/sync': accepted(7),
    },
  });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(0);
  assert.ok(s.calls.includes('POST /api/sync'));
  assert.equal(s.msg.textContent, 'Sincronizando…');
  assert.equal(s.btn.disabled, true);

  await s.advance(5000);
  assert.deepEqual(s.reloads, []);
  await s.advance(5000);
  assert.deepEqual(s.reloads, [], 'processedSeq 6 < 7: keep waiting');
  await s.advance(5000);
  assert.equal(s.reloads.length, 1, 'processedSeq 7 >= 7: reload');
  const count = s.calls.filter((c) => c === 'GET /status.json').length;
  await s.advance(60_000);
  assert.equal(s.calls.filter((c) => c === 'GET /status.json').length, count, 'polling stops after the reload');
});

test('Sync: no clock comparison: a publish stamped far in the past still counts when its processedSeq covers the click', async () => {
  const s = setup({
    routes: {
      'GET /api/sync/status': json(freshStatus),
      'GET /status.json': json({ publishedAt: '2001-01-01T00:00:00Z', processedSeq: 9 }),
      'POST /api/sync': accepted(9, true),
    },
  });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(5000);
  assert.equal(s.reloads.length, 1);
});

test('Sync: a newer publishedAt with a LOWER processedSeq does not count (an hourly run that started before the click)', async () => {
  const s = setup({
    routes: {
      'GET /api/sync/status': json(freshStatus),
      'GET /status.json': json({ publishedAt: iso(NOW + 10 * MIN), processedSeq: 3 }),
      'POST /api/sync': accepted(4),
    },
  });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(30_000);
  assert.deepEqual(s.reloads, []);
  assert.equal(s.msg.textContent, 'Sincronizando…');
});

test('Sync: a second click while syncing does nothing', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ processedSeq: 0 }), 'POST /api/sync': accepted(1) } });
  await s.advance(0);
  s.btn.dispatch('click');
  s.btn.dispatch('click');
  await s.advance(0);
  assert.equal(s.calls.filter((c) => c === 'POST /api/sync').length, 1);
});

for (const [code, reason] of [['build', 'falló la generación de la página'], ['branch', 'el servidor no está en la rama main'], ['install', 'falló la instalación de dependencias'], ['sanity', 'la página generada no es válida'], ['lock', 'otra actualización sigue en curso']]) {
  test(`Sync: refresh.sh error "${code}" for this seq fails fast with its reason`, async () => {
    const s = setup({
      routes: {
        'GET /api/sync/status': json(freshStatus),
        'GET /status.json': (n) => (n === 1 ? json({ processedSeq: 4 }) : json({ processedSeq: 4, error: code, errorSeq: 5 })),
        'POST /api/sync': accepted(5),
      },
    });
    await s.advance(0);
    s.btn.dispatch('click');
    await s.advance(5000);
    assert.equal(s.msg.textContent, `No se pudo actualizar: ${reason}`);
    assert.equal(s.btn.disabled, false);
    assert.deepEqual(s.reloads, []);
  });
}

test('Sync: an error from an OLDER seq is ignored (it predates the click)', async () => {
  const s = setup({
    routes: {
      'GET /api/sync/status': json(freshStatus),
      'GET /status.json': json({ processedSeq: 3, error: 'build', errorSeq: 4 }),
      'POST /api/sync': accepted(5),
    },
  });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(15_000);
  assert.equal(s.msg.textContent, 'Sincronizando…');
});

test('Sync: an unknown error code still fails fast, with a generic reason (never the raw code)', async () => {
  const s = setup({
    routes: {
      'GET /api/sync/status': json(freshStatus),
      'GET /status.json': json({ processedSeq: 0, error: '<b>weird</b>', errorSeq: 1 }),
      'POST /api/sync': accepted(1),
    },
  });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(5000);
  assert.equal(s.msg.textContent, 'No se pudo actualizar: error desconocido');
});

test('Sync: the ingest trigger write failing for this seq fails fast (lastTriggerError)', async () => {
  const s = setup({
    routes: {
      'GET /api/sync/status': (n) => json(n === 1 ? freshStatus : { ...freshStatus, lastTriggerError: 'trigger_write', lastTriggerErrorSeq: 2 }),
      'GET /status.json': json({ processedSeq: 1 }),
      'POST /api/sync': accepted(2),
    },
  });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(5000);
  assert.equal(s.msg.textContent, 'No se pudo actualizar: el servicio no pudo avisar al servidor');
});

test('Sync: nothing processed within 5 min -> "No se pudo actualizar, reintenta", no reload', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ processedSeq: 0 }), 'POST /api/sync': accepted(1) } });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(4 * 60_000);
  assert.equal(s.msg.textContent, 'Sincronizando…');
  await s.advance(60_000 + 5000);
  assert.equal(s.msg.textContent, 'No se pudo actualizar, reintenta');
  assert.equal(s.btn.disabled, false);
  assert.deepEqual(s.reloads, []);
});

test('Sync: a network error, a non-2xx answer or a reply without a seq -> the failure message at once', async () => {
  for (const post of [new TypeError('Failed to fetch'), json({ error: 'x' }, 502), json({ ok: true }, 202)]) {
    const s = setup({ routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ processedSeq: 0 }), 'POST /api/sync': post } });
    await s.advance(0);
    s.btn.dispatch('click');
    await s.advance(0);
    assert.equal(s.msg.textContent, 'No se pudo actualizar, reintenta');
    assert.equal(s.btn.disabled, false);
  }
});

test('Sync: English failure copy', async () => {
  const s = setup({
    locale: 'en',
    routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ processedSeq: 0, error: 'build', errorSeq: 1 }), 'POST /api/sync': accepted(1) },
  });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(5000);
  assert.equal(s.msg.textContent, 'Could not update: the page build failed');
});

test('compact top bar: the summary shows the Shortcut age only, with the worst level as a dot class, full detail in its title / label', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ publishedAt: iso(NOW - MIN) }) } });
  await s.advance(0);
  assert.equal(s.short.textContent, 'hace 5 min');
  assert.equal(s.sum.classes.has('fresh-sum-mid') || s.sum.classes.has('fresh-sum-low'), false);
  assert.equal(s.sum.getAttribute('title'), 'Atajo: hace 5 min · Strava: hace 2 h · Página: hace 1 min');
  assert.equal(s.sum.getAttribute('aria-label'), 'Frescura de los datos: Atajo: hace 5 min · Strava: hace 2 h · Página: hace 1 min');
  const stale = setup({ locale: 'en', routes: { 'GET /api/sync/status': json({ ...freshStatus, lastStravaOkAt: iso(NOW - 80 * H) }), 'GET /status.json': json({}, 404) } });
  await stale.advance(0);
  assert.equal(stale.short.textContent, '5 min ago', 'the short text is the Shortcut age');
  assert.equal(stale.sum.classes.has('fresh-sum-low'), true, 'the dot carries the worst source level');
});

test('compact top bar: a tap on the summary toggles the per-source popover (aria-expanded follows)', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ publishedAt: iso(NOW) }) } });
  await s.advance(0);
  assert.equal(s.pop.hidden, true);
  s.sum.dispatch('click');
  assert.equal(s.pop.hidden, false);
  assert.equal(s.sum.getAttribute('aria-expanded'), 'true');
  s.sum.dispatch('click');
  assert.equal(s.pop.hidden, true);
  assert.equal(s.sum.getAttribute('aria-expanded'), 'false');
});

test('icon-only Sync: spinner state (is-busy + aria-busy) while syncing, cleared when it fails', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ processedSeq: 0 }), 'POST /api/sync': json({}, 500) } });
  await s.advance(0);
  s.btn.dispatch('click');
  assert.equal(s.btn.classes.has('is-busy'), true);
  assert.equal(s.btn.getAttribute('aria-busy'), 'true');
  await s.advance(0);
  assert.equal(s.btn.classes.has('is-busy'), false);
  assert.equal(s.btn.getAttribute('aria-busy'), 'false');
  assert.equal(s.msg.textContent, 'No se pudo actualizar, reintenta');
});
