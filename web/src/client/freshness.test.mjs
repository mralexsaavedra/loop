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
  return { host, line, btn, msg, calls, reloads, clock, advance };
}

const freshStatus = {
  lastShortcutAt: iso(NOW - 5 * MIN),
  lastStravaOkAt: iso(NOW - 2 * H),
  lastStravaError: null,
  lastTriggerAt: null,
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
      'GET /api/sync/status': json({ ...freshStatus, lastShortcutAt: iso(NOW - 30 * H), lastStravaOkAt: iso(NOW - 80 * H), lastStravaError: 'strava token refresh failed: 401' }),
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

test('Sync: POST, "Sincronizando…", polls status.json every 5 s, reloads once a newer publish lands', async () => {
  const published = [iso(NOW - H), iso(NOW - H), iso(NOW - H), iso(NOW + 40 * 1000)];
  const s = setup({
    routes: {
      'GET /api/sync/status': json(freshStatus),
      'GET /status.json': (n) => json({ publishedAt: published[Math.min(n - 1, published.length - 1)] }),
      'POST /api/sync': json({ ok: true }, 202),
    },
  });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(0);
  assert.ok(s.calls.includes('POST /api/sync'));
  assert.equal(s.msg.textContent, 'Sincronizando…');
  assert.equal(s.btn.disabled, true);
  assert.deepEqual(s.reloads, []);

  await s.advance(5000);
  assert.deepEqual(s.reloads, [], 'first poll still sees the old publish');
  await s.advance(5000);
  assert.equal(s.reloads.length, 1, 'second poll sees the newer publish and reloads');
  const polls = s.calls.filter((c) => c === 'GET /status.json').length;
  await s.advance(60_000);
  assert.equal(s.calls.filter((c) => c === 'GET /status.json').length, polls, 'polling stops after the reload');
});

test('Sync: a second click while syncing does nothing', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ publishedAt: iso(NOW - H) }), 'POST /api/sync': json({ ok: true }, 202) } });
  await s.advance(0);
  s.btn.dispatch('click');
  s.btn.dispatch('click');
  await s.advance(0);
  assert.equal(s.calls.filter((c) => c === 'POST /api/sync').length, 1);
});

test('Sync: 429 -> "Espera un momento", button enabled again, no polling', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ publishedAt: iso(NOW - H) }), 'POST /api/sync': json({ error: 'rate limited' }, 429) } });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(0);
  assert.equal(s.msg.textContent, 'Espera un momento');
  assert.equal(s.btn.disabled, false);
  const polls = s.calls.filter((c) => c === 'GET /status.json').length;
  await s.advance(30_000);
  assert.equal(s.calls.filter((c) => c === 'GET /status.json').length, polls);
});

test('Sync: no newer publish within 4 min -> "No se pudo actualizar, reintenta", no reload', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ publishedAt: iso(NOW - H) }), 'POST /api/sync': json({ ok: true }, 202) } });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(3 * 60_000);
  assert.equal(s.msg.textContent, 'Sincronizando…');
  await s.advance(60_000 + 5000);
  assert.equal(s.msg.textContent, 'No se pudo actualizar, reintenta');
  assert.equal(s.btn.disabled, false);
  assert.deepEqual(s.reloads, []);
});

test('Sync: a network error on POST -> the failure message', async () => {
  const s = setup({ routes: { 'GET /api/sync/status': json(freshStatus), 'GET /status.json': json({ publishedAt: iso(NOW - H) }), 'POST /api/sync': new TypeError('Failed to fetch') } });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(0);
  assert.equal(s.msg.textContent, 'No se pudo actualizar, reintenta');
});

test('an hourly publish that predates the click by more than the skew allowance does not count', async () => {
  // baseline read fails (null), then status.json shows a publish from 10 min before the click
  const s = setup({
    routes: {
      'GET /api/sync/status': json(freshStatus),
      'GET /status.json': (n) => (n <= 2 ? json({}, 404) : json({ publishedAt: iso(NOW - 10 * MIN) })),
      'POST /api/sync': json({ ok: true }, 202),
    },
  });
  await s.advance(0);
  s.btn.dispatch('click');
  await s.advance(15_000);
  assert.deepEqual(s.reloads, []);
});
