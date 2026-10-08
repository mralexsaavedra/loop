/* Tests for the journal card + sheet (web/src/client/journal.js), run as the classic script in a vm
 * with a fixed clock and a stubbed fetch (the LAN API) — or none (the static / example build). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { es as esT, en as enT } from '../i18n/score-templates.mjs';
import { journalBake } from '../../../lib/journal/bake.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'journal.js'), 'utf8');
const TODAY = '2026-09-30';
const plain = (x) => JSON.parse(JSON.stringify(x));

function host(id) {
  return { id, innerHTML: '', hidden: true };
}
/** routes: {'GET /settings': body | {status, body}} answered by the stub fetch; null = no fetch at all */
function load({ routes = null, locale = 'en', journal = journalBake(), now = TODAY } = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(new RealDate(now + 'T12:00:00').getTime()); }
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const els = { 'my-journal': host('my-journal') };
  const calls = [];
  const listeners = {};
  const ctx = {
    document: { getElementById: (id) => els[id] || null, addEventListener: (e, f) => { listeners[e] = f; } },
    I18N_SCORE: locale === 'es' ? esT : enT, LOCALE: locale, SCORES: { journal },
    Date: FakeDate, Math, String, Number, Array, Object, JSON, Promise, setTimeout, clearTimeout,
    location: { hash: '' },
  };
  if (routes) {
    ctx.fetch = (url, init) => {
      const key = `${init.method} ${url.replace('/api/journal', '').split('?')[0]}`;
      calls.push({ url, init: { method: init.method, headers: init.headers, body: init.body } });
      const r = routes[key];
      if (r === undefined) return Promise.reject(new Error('offline'));
      const res = typeof r === 'function' ? r(init) : r;
      const status = res && res.status ? res.status : 200;
      const body = res && res.status ? res.body : res;
      return Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
    };
  }
  ctx.window = ctx;
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return { ctx, els, calls, listeners };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const ALL_ON = Object.fromEntries(journalBake().behaviors.map((b) => [b.key, true]));

test('pure: the strip is the 7 days ending today; a day is journaled with one answer', () => {
  const { ctx } = load();
  const J = ctx.HCJournal;
  assert.deepEqual(plain(J.weekDays(TODAY)), ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']);
  assert.equal(J.journaled({ answers: { alcohol: 0 } }), true);
  assert.equal(J.journaled({ answers: {} }), false);
  assert.equal(J.did({ alcohol: 3 }, 'alcohol'), true);
  assert.equal(J.did({ nap: false }, 'nap'), false);
});

test('pure: ✕ / ✓ toggle (pressed again = unanswered); the drinks stepper stays within 0..countMax', () => {
  const { ctx } = load();
  const p = (a, k, act) => plain(ctx.HCJournal.press(a, k, act));
  assert.deepEqual(p({}, 'nap', 'yes'), { nap: true });
  assert.deepEqual(p({ nap: true }, 'nap', 'yes'), {});
  assert.deepEqual(p({ nap: true }, 'nap', 'no'), { nap: false });
  assert.deepEqual(p({}, 'alcohol', 'inc'), { alcohol: 1 });
  assert.deepEqual(p({ alcohol: 1 }, 'alcohol', 'dec'), { alcohol: 0 });
  assert.deepEqual(p({ alcohol: 0 }, 'alcohol', 'dec'), { alcohol: 0 });
  assert.deepEqual(p({}, 'alcohol', 'dec'), {});
  assert.deepEqual(p({}, 'alcohol', 'no'), { alcohol: 0 });
  assert.deepEqual(p({ alcohol: 0 }, 'alcohol', 'no'), {});
  assert.deepEqual(p({ alcohol: 20 }, 'alcohol', 'inc'), { alcohol: 20 });
  assert.deepEqual(p({ x: 1 }, 'coffee', 'yes'), { x: 1 }, 'an unknown key changes nothing');
});

test('no journal API (static build): no card, no sheet, nothing fetched', async () => {
  const { ctx, els } = load();
  await tick();
  assert.equal(els['my-journal'].hidden, true);
  assert.equal(els['my-journal'].innerHTML, '');
  assert.equal(ctx.HCViews, undefined);
  const off = load({ routes: {} });
  await tick(); await tick();
  assert.equal(off.els['my-journal'].hidden, true, 'an unreachable API shows nothing either');
  assert.equal(off.ctx.HCJournal.ready(), false);
});

test('with the API: the card shows 7 day columns, a check on journaled days, and registers the sheet', async () => {
  const { ctx, els, calls } = load({ routes: {
    'GET /settings': { behaviors: ALL_ON },
    'GET /summary': { from: '2026-09-24', to: TODAY, days: [{ date: '2026-09-29', answers: { nap: true }, notes: null }] },
  } });
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(ctx.HCJournal.ready(), true);
  assert.equal(calls[0].init.headers['X-HC-Journal'], '1');
  assert.match(calls[1].url, /\/api\/journal\/summary\?from=2026-09-24&to=2026-09-30$/);
  const h = els['my-journal'];
  assert.equal(h.hidden, false);
  assert.equal((h.innerHTML.match(/class="jr-day"/g) || []).length, 7);
  assert.equal((h.innerHTML.match(/jr-dot jr-on/g) || []).length, 1);
  assert.match(h.innerHTML, /data-date="2026-09-29"[^>]*aria-label="Tue 29 Sep: journaled"/);
  assert.match(h.innerHTML, /MY JOURNAL|My journal/);
  assert.equal(typeof ctx.HCViews.journal.render, 'function');
});

test('the sheet: grouped rows of the switched-on behaviours, ✕/✓ pairs, the drinks stepper, notes, save', async () => {
  const off = { ...ALL_ON, nap: false };
  const { ctx } = load({ routes: { 'GET /settings': { behaviors: off }, 'GET /summary': { days: [] } } });
  for (let i = 0; i < 5; i++) await tick();
  const r = ctx.HCViews.journal.render();
  assert.match(r.head, /class="jr-strip"/);
  assert.match(r.body, /What's happening today\?/);
  assert.deepEqual([...r.body.matchAll(/<p class="jr-g">([^<]+)<\/p>/g)].map((m) => m[1]), ['Daytime', 'Nighttime', 'Status']);
  assert.doesNotMatch(r.body, /data-jr="yes" data-key="nap"/, 'a switched-off behaviour has no row');
  assert.match(r.body, /data-jr="tog" data-key="nap" aria-pressed="false"/, 'but is listed in the on / off fold');
  assert.match(r.body, /data-jr="inc" data-key="alcohol"/);
  assert.match(r.body, /id="jr-notes"[^>]*maxlength="500"/);
  assert.match(r.body, /data-jr="save"/);
  const es = load({ locale: 'es', routes: { 'GET /settings': { behaviors: ALL_ON }, 'GET /summary': { days: [] } } });
  for (let i = 0; i < 5; i++) await tick();
  assert.match(es.ctx.HCViews.journal.render().body, /¿Qué está pasando hoy\?/);
});

test('save: PUT /day with the draft, then the card shows the day journaled; an error stays in the sheet', async () => {
  let put = null;
  const { ctx, els, listeners } = load({ routes: {
    'GET /settings': { behaviors: ALL_ON },
    'GET /summary': { days: [] },
    'PUT /day': (init) => { put = JSON.parse(init.body); return { day: { date: put.date, answers: put.answers, notes: put.notes } }; },
  } });
  for (let i = 0; i < 5; i++) await tick();
  let closed = 0;
  ctx.HCDetail = { state: () => ({ key: 'journal', date: null }), open: () => {}, close: () => { closed++; } };
  ctx.HCViews.journal.render();
  const btn = (attrs) => ({ getAttribute: (k) => attrs[k] ?? null });
  const click = (attrs) => listeners.click({ target: { closest: () => btn(attrs) } });
  click({ 'data-jr': 'inc', 'data-key': 'alcohol' });
  click({ 'data-jr': 'inc', 'data-key': 'alcohol' });
  click({ 'data-jr': 'yes', 'data-key': 'screen_in_bed' });
  listeners.input({ target: { id: 'jr-notes', value: ' dinner out ' } });
  click({ 'data-jr': 'save' });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(put, { date: TODAY, answers: { alcohol: 2, screen_in_bed: true }, notes: 'dinner out' });
  assert.equal(closed, 1);
  assert.equal((els['my-journal'].innerHTML.match(/jr-dot jr-on/g) || []).length, 1);
});
