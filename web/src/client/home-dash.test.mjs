/* Tests for Inicio's "My dashboard" (web/src/client/home-dash.js): preferences (defaults, unknown keys
 * ignored, storage failure → in-memory), one row's numbers (value, 30-day baseline, arrow / tone) and
 * the renderer + customize sheet, run as the classic script in a vm with a fixed clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { es as esT, en as enT } from '../i18n/score-templates.mjs';
import { es as esD, en as enD } from '../i18n/detail-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'home-dash.js'), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const NOW = '2026-09-30';

function storage(init = {}, { broken = false } = {}) {
  const data = { ...init };
  return {
    data,
    getItem: (k) => { if (broken) throw new Error('denied'); return k in data ? data[k] : null; },
    setItem: (k, v) => { if (broken) throw new Error('denied'); data[k] = String(v); },
  };
}
// a series of n days ending at `end` (value f(i), i = 0 oldest)
function series(end, n, f, extra = {}) {
  const t = new Date(end + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - (n - 1));
  return { start: t.toISOString().slice(0, 10), v: Array.from({ length: n }, (_, i) => f(i)), ...extra };
}
function detail() {
  return {
    asOf: NOW,
    metrics: {
      rhr: series(NOW, 40, (i) => (i === 39 ? 50 : 54), { kind: 'signal', dir: -1, dec: 0 }),
      hrv: series(NOW, 40, (i) => (i === 39 ? 40 : 50), { kind: 'signal', dir: 1, dec: 0 }),
      sleep: series(NOW, 40, () => 7.5, { kind: 'sleep', dir: 1, dec: 2, target: 7.5 }),
      weight: series(NOW, 40, (i) => (i % 5 === 0 ? 80 : null), { kind: 'sparse', dir: 0, dec: 1 }),
      steps: series(NOW, 40, (i) => (i === 39 ? 300 : i === 38 ? 12000 : 8000), { kind: 'total', dir: 1, dec: 0 }),
      vo2max: series(NOW, 40, (i) => (i === 39 ? 46 : null), { kind: 'sparse', dir: 1, dec: 1 }),
      energy: series(NOW, 40, () => 2500, { kind: 'total', dir: 0, dec: 0 }),
    },
    sessions: [],
  };
}
function load({ locale = 'en', ls = storage(), DETAIL = detail(), noStorage = false } = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(new RealDate(NOW + 'T12:00:00').getTime()); }
    static now() { return new RealDate(NOW + 'T12:00:00').getTime(); }
  }
  const els = { 'my-dash': { hidden: true }, 'home-dash': { innerHTML: '' } };
  const listeners = {};
  const opened = [];
  const ctx = {
    document: { readyState: 'complete', getElementById: (id) => els[id] || null, addEventListener: (e, f) => { listeners[e] = f; } },
    I18N_SCORE: locale === 'es' ? esT : enT, I18N_DETAIL: locale === 'es' ? esD : enD, LOCALE: locale, DETAIL,
    HCDetail: { open: (k, d, o) => opened.push([k, o && o.focus]) },
    Date: FakeDate, Math, String, Number, Array, Object, JSON,
  };
  if (!noStorage) ctx.localStorage = ls;
  ctx.window = ctx;
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  const click = (attrs) => listeners.click({ target: { closest: () => ({ getAttribute: (k) => attrs[k] }) } });
  return { ctx, els, ls, click, opened };
}

test('prefs: defaults = RHR, HRV, sleep, weight, steps shown, the rest of the catalogue hidden; only available metrics', () => {
  const { ctx } = load();
  const D = ctx.HCDash;
  assert.deepEqual(plain(D.DEFAULT_ON), ['rhr', 'hrv', 'sleep', 'weight', 'steps']);
  assert.deepEqual(plain(D.prefsFrom(null, ['steps', 'rhr', 'hrv', 'sleep', 'weight', 'vo2max'])),
    [{ key: 'rhr', on: true }, { key: 'hrv', on: true }, { key: 'sleep', on: true }, { key: 'weight', on: true }, { key: 'steps', on: true }, { key: 'vo2max', on: false }]);
  assert.deepEqual(plain(D.prefsFrom(null, ['hrv', 'energy'])), [{ key: 'hrv', on: true }], 'energy is not a dashboard metric');
});

test('prefs: stored order + hidden apply; unknown, duplicate or unavailable keys are ignored; new keys append with their default', () => {
  const { ctx } = load();
  const raw = JSON.stringify({ order: ['steps', 'bogus', 'hrv', 'steps', 'walkingHr', 'rhr'], hidden: ['hrv', 'bogus'] });
  assert.deepEqual(plain(ctx.HCDash.prefsFrom(raw, ['rhr', 'hrv', 'sleep', 'steps', 'vo2max'])),
    [{ key: 'steps', on: true }, { key: 'hrv', on: false }, { key: 'rhr', on: true }, { key: 'sleep', on: true }, { key: 'vo2max', on: false }]);
  for (const bad of ['{not json', '42', 'null', JSON.stringify({ order: 'x', hidden: 3 })]) {
    assert.deepEqual(plain(ctx.HCDash.prefsFrom(bad, ['rhr', 'hrv'])), [{ key: 'rhr', on: true }, { key: 'hrv', on: true }], bad);
  }
});

test('edit: up / down / toggle return a new list; moves stop at the ends', () => {
  const { ctx } = load();
  const L = [{ key: 'rhr', on: true }, { key: 'hrv', on: true }, { key: 'sleep', on: false }];
  assert.deepEqual(plain(ctx.HCDash.edit(L, 'hrv', 'up')).map((x) => x.key), ['hrv', 'rhr', 'sleep']);
  assert.deepEqual(plain(ctx.HCDash.edit(L, 'rhr', 'up')).map((x) => x.key), ['rhr', 'hrv', 'sleep']);
  assert.deepEqual(plain(ctx.HCDash.edit(L, 'sleep', 'down')).map((x) => x.key), ['rhr', 'hrv', 'sleep']);
  assert.equal(plain(ctx.HCDash.edit(L, 'sleep', 'toggle'))[2].on, true);
  assert.equal(L[2].on, false, 'the input is not mutated');
});

test('row value: newest day, 30-day baseline, arrow + tone by the good direction; a daily total skips today', () => {
  const { ctx } = load();
  const D = detail().metrics, rv = (k) => plain(ctx.HCDash.rowValue(D[k], NOW));
  assert.deepEqual(rv('rhr'), { value: 50, date: NOW, base: 54, arrow: 'down', tone: 'good' }, 'lower RHR is better');
  assert.deepEqual(rv('hrv'), { value: 40, date: NOW, base: 50, arrow: 'down', tone: 'bad' });
  assert.deepEqual(rv('sleep'), { value: 7.5, date: NOW, base: 7.5, arrow: 'flat', tone: 'flat' });
  const st = rv('steps');
  assert.equal(st.date, '2026-09-29', 'today (300 so far) is still filling up');
  assert.equal(st.value, 12000);
  assert.deepEqual([st.arrow, st.tone], ['up', 'good']);
  const w = rv('weight');
  assert.equal(w.value, 80);
  assert.deepEqual([w.arrow, w.tone], ['flat', 'flat'], 'a neutral metric is never coloured');
  assert.deepEqual(rv('vo2max'), { value: 46, date: NOW, base: null, arrow: null, tone: 'flat' }, 'no earlier readings: no baseline, no arrow');
  assert.equal(ctx.HCDash.rowValue(null, NOW), null);
});

test('render: one row per shown metric (full name, value, unit, baseline, arrow, detail opener); sleep as h:mm', () => {
  const { els } = load();
  const html = els['home-dash'].innerHTML;
  assert.equal(els['my-dash'].hidden, false);
  const keys = [...html.matchAll(/data-detail="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['rhr', 'hrv', 'sleep', 'weight', 'steps']);
  assert.match(html, /<span class="db-name">Heart rate variability<\/span>/, 'the full name, not the sheet\'s short title');
  assert.match(html, /<span class="db-name">Hours of sleep<\/span>/);
  assert.match(html, /Resting heart rate<\/span><span class="db-vals"><span class="db-val"><b>50<\/b><small>bpm<\/small><span class="db-arr db-good" aria-hidden="true">▼<\/span><\/span><span class="db-base">54<\/span>/);
  assert.match(html, /<b>7:30<\/b>/);
  assert.match(html, /<b>12000<\/b>/);
});

test('render with stored prefs; storage that throws falls back to defaults and still saves in memory', () => {
  const ls = storage({ 'hc-dash-v1': JSON.stringify({ order: ['steps', 'rhr', 'hrv', 'sleep', 'weight'], hidden: ['rhr', 'hrv', 'sleep', 'weight'] }) });
  const { els } = load({ ls });
  assert.deepEqual([...els['home-dash'].innerHTML.matchAll(/data-detail="([\w-]+)"/g)].map((m) => m[1]), ['steps']);

  const broken = load({ ls: storage({}, { broken: true }) });
  assert.equal([...broken.els['home-dash'].innerHTML.matchAll(/data-detail=/g)].length, 5, 'defaults');
  broken.click({ 'data-dash-act': 'toggle', 'data-key': 'rhr' });
  assert.equal([...broken.els['home-dash'].innerHTML.matchAll(/data-detail=/g)].length, 4, 'the change holds for this visit');

  const none = load({ noStorage: true });
  none.click({ 'data-dash-act': 'down', 'data-key': 'rhr' });
  assert.deepEqual([...none.els['home-dash'].innerHTML.matchAll(/data-detail="([\w-]+)"/g)].map((m) => m[1]).slice(0, 2), ['hrv', 'rhr']);
});

test('customize: the sheet lists every available metric with show / up / down; a click saves, re-renders and re-opens with focus kept', () => {
  const { ctx, els, ls, click, opened } = load();
  const v = ctx.HCViews['dash-edit'];
  assert.equal(v.title(), 'Customize dashboard');
  const body = v.render().body;
  assert.equal([...body.matchAll(/data-dash-act="toggle"/g)].length, 6, 'rhr hrv sleep weight steps vo2max');
  assert.match(body, /data-dash-act="up" data-key="rhr" aria-label="Move Resting heart rate up" disabled/);
  assert.match(body, /data-key="vo2max" aria-pressed="false"/);
  click({ 'data-dash-act': 'toggle', 'data-key': 'vo2max' });
  click({ 'data-dash-act': 'up', 'data-key': 'vo2max' });
  assert.deepEqual(JSON.parse(ls.data['hc-dash-v1']), { order: ['rhr', 'hrv', 'sleep', 'weight', 'vo2max', 'steps'], hidden: [] });
  assert.match(els['home-dash'].innerHTML, /data-detail="vo2max"[\s\S]*data-detail="steps"/);
  assert.deepEqual(plain(opened.at(-1)), ['dash-edit', '[data-dash-act="up"][data-key="vo2max"]']);
});

test('every metric hidden: the section stays (Customize brings one back) with a one-line note; no metric at all → hidden', () => {
  const ls = storage({ 'hc-dash-v1': JSON.stringify({ order: ['rhr', 'hrv', 'sleep', 'weight', 'steps', 'vo2max'], hidden: ['rhr', 'hrv', 'sleep', 'weight', 'steps', 'vo2max'] }) });
  const { els } = load({ ls });
  assert.equal(els['my-dash'].hidden, false);
  assert.match(els['home-dash'].innerHTML, /class="db-empty"/);
  const empty = load({ DETAIL: { asOf: NOW, metrics: {}, sessions: [] } });
  assert.equal(empty.els['my-dash'].hidden, true);
});

test('Spanish: the full names from the dashboard copy, the other titles and the units from the detail copy', () => {
  const { els } = load({ locale: 'es' });
  const html = els['home-dash'].innerHTML;
  assert.match(html, /<span class="db-name">Frecuencia cardiaca en reposo<\/span>/);
  assert.match(html, new RegExp(`<span class="db-name">${esD.metrics.weight.title}</span>`));
  assert.match(html, new RegExp(`<small>${esD.metrics.rhr.unit}</small>`));
});

test('fitness age: an optional row (off by default), whole years, lower = better; a value at a clamp bound reads "≤ 25" / "≥ 75"', () => {
  const D = detail();
  D.metrics.fitnessAge = series(NOW, 40, (i) => (i === 39 ? 25 : i % 10 === 0 ? 31.4 : null), { kind: 'sparse', dir: -1, dec: 1, lo: 25, hi: 75 });
  const ls = storage({ 'hc-dash-v1': JSON.stringify({ order: ['fitnessAge'], hidden: [] }) });
  const { ctx, els } = load({ DETAIL: D, ls });
  assert.ok(ctx.HCDash.CATALOG.includes('fitnessAge'));
  assert.ok(!ctx.HCDash.DEFAULT_ON.includes('fitnessAge'));
  const html = els['home-dash'].innerHTML;
  assert.match(html, /data-detail="fitnessAge"/);
  assert.match(html, /Fitness age<\/span><span class="db-vals"><span class="db-val"><b>≤ 25<\/b><small>years<\/small><span class="db-arr db-good" aria-hidden="true">▼<\/span><\/span><span class="db-base">31<\/span>/);
  D.metrics.fitnessAge.v[39] = 75;
  assert.match(load({ DETAIL: D, ls, locale: 'es' }).els['home-dash'].innerHTML, /Edad física<\/span>[\s\S]*<b>≥ 75<\/b><small>años<\/small>/);
  D.metrics.fitnessAge.v[39] = 40.6;
  assert.match(load({ DETAIL: D, ls }).els['home-dash'].innerHTML, /<b>41<\/b><small>years<\/small>/);
});
