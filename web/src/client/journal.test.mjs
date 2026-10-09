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
  assert.match(r.body, /<button type="button" class="sw" role="switch" aria-checked="false" aria-label="Track Nap" data-jr="tog" data-key="nap">/, 'but is listed in the on / off fold, as THE switch');
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

const BAKED = {
  ...journalBake(),
  recent: ['2026-09-27', '2026-09-29'],
  insights: { asOf: '2026-09-29', from: '2026-07-02', days: 40, rows: [
    { key: 'alcohol', yesDays: 12, noDays: 20, status: 'ok', yesMean: 60, noMean: 75, diff: -15 },
    { key: 'mobility', yesDays: 9, noDays: 23, status: 'ok', yesMean: 80, noMean: 70, diff: 10 },
    { key: 'ill', yesDays: 1, noDays: 31, status: 'need_data', yesMean: null, noMean: null, diff: null },
  ] },
};

test('static build with a baked journal: the card shows the baked checks read-only, and the insights button', async () => {
  const { ctx, els } = load({ journal: BAKED });
  await tick();
  const h = els['my-journal'];
  assert.equal(h.hidden, false);
  assert.equal((h.innerHTML.match(/jr-dot jr-on/g) || []).length, 2);
  assert.doesNotMatch(h.innerHTML, /data-detail="journal"/, 'no sheet to open without the API');
  assert.match(h.innerHTML, /<span class="jr-day" role="img"/);
  assert.match(h.innerHTML, /data-detail="journal-insights"[^>]*>Behavior insights</);
  assert.equal(typeof ctx.HCViews['journal-insights'].render, 'function');
});

test('insights view: best impact first, signed %, teal / orange bars from the centre, need-more-data rows last, the formula behind ⓘ', () => {
  const { ctx } = load({ journal: BAKED });
  const r = ctx.HCViews['journal-insights'].render();
  const names = [...r.body.matchAll(/<span class="ji-name"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(names, ['Mobility', 'Alcohol', 'Feeling ill']);
  assert.match(r.body, /<b class="ji-pct ji-up" aria-hidden="true">\+10%<\/b>/);
  assert.match(r.body, /<b class="ji-pct ji-down" aria-hidden="true">−15%<\/b>/);
  assert.match(r.body, /class="ji-fill ji-up" style="left:50\.0%;width:25\.0%"/, 'scale = max(20, the largest |diff|) = half the bar');
  assert.match(r.body, /class="ji-fill ji-down" style="left:12\.5%;width:37\.5%"/);
  assert.match(r.body, /Need more data/);
  assert.match(r.body, /1 yes · 31 no days \(5 each needed\)/);
  assert.match(r.body, /id="dd-info" hidden><p>For each behavior: the mean of your recovery %/);
  assert.match(r.body, /An association, not causation/);
  assert.match(r.body, /aria-label="Alcohol: -15\.0 points of recovery the morning after \(60% after yes, 75% after no; 12 and 20 days\)"/);
  assert.equal(ctx.HCJournal.barStyle(5, 20), 'left:50.0%;width:12.5%');
  assert.equal(ctx.HCJournal.barStyle(-40, 20), 'left:0.0%;width:50.0%');
});

// a stand-in for detail.js: open() renders the registered view like the real modal; close() forgets it
function fakeDetail(ctx) {
  const D = { st: null, opens: 0, closes: 0, html: null };
  ctx.HCDetail = {
    state: () => D.st,
    open: (key, date) => { D.st = { key, date: date || null }; D.opens++; D.html = ctx.HCViews[key].render(); },
    close: () => { D.st = null; D.closes++; },
  };
  return D;
}
const press = (listeners, attrs) => listeners.click({ target: { closest: () => ({ getAttribute: (k) => attrs[k] ?? null, parentElement: null }) } });

test('save: one request at a time; edits during the request are refused, never silently dropped', async () => {
  const puts = [];
  let resolvePut;
  const { ctx, listeners } = load({ routes: {
    'GET /settings': { behaviors: ALL_ON },
    'GET /summary': { days: [] },
    'PUT /day': (init) => { puts.push(JSON.parse(init.body)); return new Promise((r) => { resolvePut = r; }); },
  } });
  for (let i = 0; i < 5; i++) await tick();
  // the stub fetch resolves with a promise for this route: wrap it into a response when settled
  const D = fakeDetail(ctx);
  ctx.HCDetail.open('journal', null);
  press(listeners, { 'data-jr': 'yes', 'data-key': 'nap' });
  press(listeners, { 'data-jr': 'save' });
  assert.match(D.html.body, /data-jr="save" disabled/, 'the pill is disabled while saving');
  assert.match(D.html.body, /id="jr-notes"[^>]*readonly/, 'the note is read-only while saving');
  press(listeners, { 'data-jr': 'save' });
  press(listeners, { 'data-jr': 'yes', 'data-key': 'ill' });
  listeners.input({ target: { id: 'jr-notes', value: 'typed while saving' } });
  assert.equal(puts.length, 1, 'a second save waits for the first');
  assert.deepEqual(plain(ctx.HCJournal.state().draft.answers), { nap: true }, 'no edit slips in under the request');
  assert.equal(ctx.HCJournal.state().draft.notes, '');
  resolvePut({ day: { date: TODAY, answers: { nap: true }, notes: null } });
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(D.closes, 1);
  assert.equal(ctx.HCJournal.state().saving, false);
});

test('a closed sheet drops its unsaved draft: reopening shows the saved day', async () => {
  const { ctx, listeners } = load({ routes: {
    'GET /settings': { behaviors: ALL_ON },
    'GET /summary': { days: [{ date: TODAY, answers: { alcohol: 1 }, notes: null }] },
  } });
  for (let i = 0; i < 5; i++) await tick();
  const D = fakeDetail(ctx);
  ctx.HCDetail.open('journal', null);
  press(listeners, { 'data-jr': 'inc', 'data-key': 'alcohol' });
  press(listeners, { 'data-jr': 'yes', 'data-key': 'nap' });
  assert.match(D.html.body, /<b class="jr-n"[^>]*>2</, 'the open sheet keeps the draft across its re-renders');
  ctx.HCDetail.close();
  ctx.HCDetail.open('journal', null);
  assert.match(D.html.body, /<b class="jr-n"[^>]*>1</, 'back to the saved count');
  assert.match(D.html.body, /data-jr="yes" data-key="nap" aria-pressed="false"/);
});

test('baked card: a journal older than the 7-day window shows ITS last week, not an empty one', () => {
  const stale = load({ journal: BAKED, now: '2026-10-20' });
  const h = stale.els['my-journal'].innerHTML;
  assert.match(h, /aria-label="Tue 29 Sep: journaled"/, 'the week ends at the newest baked day');
  assert.equal((h.match(/jr-dot jr-on/g) || []).length, 2);
  const fresh = load({ journal: BAKED, now: '2026-09-30' });
  assert.match(fresh.els['my-journal'].innerHTML, /aria-label="Wed 30 Sep: not journaled"/, 'a recent bake keeps the viewer\'s week');
});
