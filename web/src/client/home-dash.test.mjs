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
  ctx.__listeners = listeners;
  const click = (attrs) => listeners.click({ target: { closest: (s) => (s === '[data-dash-act]' ? { getAttribute: (k) => attrs[k] } : null) } });
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

test('move: one item from index i to j in a new list; out-of-range or same index = an unchanged copy; up / down are moves by one', () => {
  const { ctx } = load();
  const D = ctx.HCDash;
  const L = [{ key: 'a', on: true }, { key: 'b', on: false }, { key: 'c', on: true }, { key: 'd', on: true }];
  const keys = (l) => plain(l).map((x) => x.key);
  assert.deepEqual(keys(D.move(L, 0, 2)), ['b', 'c', 'a', 'd']);
  assert.deepEqual(keys(D.move(L, 3, 0)), ['d', 'a', 'b', 'c']);
  assert.deepEqual(keys(D.move(L, 1, 1)), ['a', 'b', 'c', 'd']);
  for (const [i, j] of [[-1, 0], [0, 4], [4, 0], [0, NaN], [0, 1.5]]) assert.deepEqual(keys(D.move(L, i, j)), ['a', 'b', 'c', 'd'], `${i} -> ${j}`);
  assert.equal(plain(D.move(L, 1, 3))[3].on, false, 'the item keeps its shown / hidden state');
  assert.deepEqual(keys(L), ['a', 'b', 'c', 'd'], 'the input is not mutated');
  assert.notEqual(D.move(L, 0, 0)[0], L[0], 'a copy, never the input objects');
  assert.deepEqual(keys(D.edit(L, 'c', 'up')), keys(D.move(L, 2, 1)));
  assert.deepEqual(keys(D.edit(L, 'c', 'down')), keys(D.move(L, 2, 3)));
});

// a fake customize list for the pointer drag: rows 60px tall, their box follows their DOM position
function fakeSheet(keys) {
  const ul = { children: [] };
  ul.insertBefore = (node, ref) => {
    ul.children.splice(ul.children.indexOf(node), 1);
    const at = ref ? ul.children.indexOf(ref) : ul.children.length;
    ul.children.splice(at, 0, node);
  };
  const rows = keys.map((k) => {
    const cls = new Set();
    const li = { parentNode: ul, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
      getAttribute: (a) => (a === 'data-key' ? k : null),
      getBoundingClientRect: () => ({ top: ul.children.indexOf(li) * 60, height: 60 }),
      get isConnected() { return !ul.detached && ul.children.includes(li); } };
    const captured = [];
    // gone: the pointer is no longer active (setPointerCapture throws, as in the browser)
    const grip = { captured, gone: false, setPointerCapture: (id) => { if (grip.gone) throw new Error('NotFoundError'); captured.push(id); }, releasePointerCapture: () => {},
      getAttribute: (a) => (a === 'data-key' ? k : null),
      closest: (sel) => (sel === '[data-dash-grip]' ? grip : sel === 'li' ? li : null) };
    li.grip = grip;
    ul.children.push(li);
    return li;
  });
  return { ul, rows, order: () => ul.children.map((li) => li.getAttribute('data-key')) };
}

test('customize: the list opens straight away, no intro paragraph (the reference app\'s edit screen)', () => {
  const { ctx } = load();
  const body = ctx.HCViews['dash-edit'].render().body;
  assert.ok(body.startsWith('<ul class="db-edit">'), body.slice(0, 60));
  assert.doesNotMatch(body, /dt-note/);
});

test('customize: every row has a ≡ drag handle (hidden from screen readers; the ↑ / ↓ buttons stay for the keyboard)', () => {
  const { ctx } = load();
  const body = ctx.HCViews['dash-edit'].render().body;
  assert.equal([...body.matchAll(/<span class="db-grip" data-dash-grip="" data-key="(\w+)" aria-hidden="true"><svg class="db-grip-ico"/g)].length, 6);
  assert.equal([...body.matchAll(/data-dash-act="(up|down)"/g)].length, 12, 'keyboard-operable moves kept');
  assert.match(body, /data-key="rhr" aria-label="Move Resting heart rate down">↓<\/button><span class="db-grip"/, 'the handle sits last, at the row end');
});

test('customize: rows show the SHORT metric names (the trend sheet\'s titles: "HRV", "Resting HR") so they fit 1–2 lines at 360 px; the full name stays in the button labels', () => {
  const { ctx } = load();
  const body = ctx.HCViews['dash-edit'].render().body;
  assert.match(body, /<span class="db-name">HRV<\/span>/);
  assert.match(body, /<span class="db-name">Resting HR<\/span>/);
  assert.doesNotMatch(body, /<span class="db-name">(Heart rate variability|Resting heart rate)</);
  assert.match(body, /aria-label="Move Resting heart rate down"/);
});

test('drag: pointer down on ≡ captures the pointer, a move reorders the rows live, the drop persists exactly like ↑ / ↓', () => {
  const byButtons = load();
  byButtons.click({ 'data-dash-act': 'up', 'data-key': 'steps' });
  byButtons.click({ 'data-dash-act': 'up', 'data-key': 'steps' });
  byButtons.click({ 'data-dash-act': 'up', 'data-key': 'steps' });

  const { ctx, els, ls, opened } = load();
  // the harness keeps the one listener per event name (ctx.__listeners)
  const sheet = fakeSheet(['rhr', 'hrv', 'sleep', 'weight', 'steps', 'vo2max']);
  const steps = sheet.rows[4];
  const fire = (type, target, y, id = 7) => {
    const ev = { type, target, pointerId: id, isPrimary: true, pointerType: 'touch', clientY: y, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    ctx.__listeners[type](ev);
    return ev;
  };
  const down = fire('pointerdown', steps.grip, 4 * 60 + 30);
  assert.ok(down.defaultPrevented, 'no text selection / scroll start');
  assert.deepEqual(steps.grip.captured, [7], 'setPointerCapture keeps the drag on the handle (touch and mouse)');
  assert.ok(steps.classList.contains('db-drag'));
  fire('pointermove', steps.grip, 2 * 60 + 20);
  assert.deepEqual(sheet.order(), ['rhr', 'hrv', 'steps', 'sleep', 'weight', 'vo2max'], 'reordered on move');
  fire('pointermove', steps.grip, 1 * 60 + 20, 9); // another pointer: ignored
  assert.deepEqual(sheet.order(), ['rhr', 'hrv', 'steps', 'sleep', 'weight', 'vo2max']);
  fire('pointermove', steps.grip, 1 * 60 + 20);
  assert.deepEqual(sheet.order(), ['rhr', 'steps', 'hrv', 'sleep', 'weight', 'vo2max']);
  assert.equal(ls.data['hc-dash-v1'], undefined, 'nothing saved while dragging');
  fire('pointerup', steps.grip, 1 * 60 + 20);
  assert.ok(!steps.classList.contains('db-drag'));
  assert.equal(ls.data['hc-dash-v1'], byButtons.ls.data['hc-dash-v1'], 'the same saved prefs as three ↑ clicks');
  assert.equal(els['home-dash'].innerHTML, byButtons.els['home-dash'].innerHTML, 'the dashboard re-renders the same');
  assert.equal(plain(opened.at(-1))[0], 'dash-edit', 'the sheet re-opens on the saved order');
  // a later move without a pointer down does nothing
  fire('pointermove', steps.grip, 0);
  assert.equal(ls.data['hc-dash-v1'], byButtons.ls.data['hc-dash-v1']);
});

test('drag: a drop where it started saves nothing; a cancelled drag (pointercancel) restores the sheet without saving', () => {
  const { ctx, ls, opened } = load();
  const fire = (type, target, y) => ctx.__listeners[type]({ type, target, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientY: y, preventDefault() {} });
  const a = fakeSheet(['rhr', 'hrv', 'sleep']);
  fire('pointerdown', a.rows[0].grip, 30);
  fire('pointermove', a.rows[0].grip, 40);
  fire('pointerup', a.rows[0].grip, 40);
  assert.equal(ls.data['hc-dash-v1'], undefined);
  assert.equal(opened.length, 0, 'nothing to re-render');
  const b = fakeSheet(['rhr', 'hrv', 'sleep']);
  fire('pointerdown', b.rows[0].grip, 30);
  fire('pointermove', b.rows[0].grip, 170);
  assert.deepEqual(b.order(), ['hrv', 'sleep', 'rhr']);
  fire('pointercancel', b.rows[0].grip, 170);
  assert.equal(ls.data['hc-dash-v1'], undefined, 'a cancel never saves');
  assert.deepEqual(plain(opened.at(-1))[0], 'dash-edit', 'the sheet re-renders in the saved order');
  // a pointer down outside a handle is not a drag
  fire('pointerdown', { closest: () => null }, 0);
  fire('pointerup', { closest: () => null }, 0);
  assert.equal(ls.data['hc-dash-v1'], undefined);
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
  assert.match(html, /<b>12,000<\/b>/);
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
  // show / hide is THE switch (no visible word, the state is aria-checked); one control for both states
  assert.match(body, /<button type="button" class="sw" role="switch" aria-checked="false" aria-label="Show VO₂max on the dashboard" data-dash-act="toggle" data-key="vo2max">/);
  assert.equal([...body.matchAll(/class="sw" role="switch" aria-checked="true"/g)].length, 5);
  assert.doesNotMatch(body, /db-tog|>Shown<|>Hidden</, 'no white VISIBLE pill / bare HIDDEN word');
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

test('drag: only the primary pointer, a mouse main button and no drag in progress start one', () => {
  const { ctx, ls } = load();
  const sheet = fakeSheet(['rhr', 'hrv', 'sleep']);
  const fire = (type, target, y, extra) => {
    const ev = { type, target, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientY: y, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    ctx.__listeners[type](ev);
    return ev;
  };
  const [rhr, hrv] = sheet.rows;
  // a second finger (not the primary pointer) is not a drag
  const second = fire('pointerdown', rhr.grip, 30, { pointerId: 2, pointerType: 'touch', isPrimary: false });
  assert.ok(!second.defaultPrevented && !rhr.classList.contains('db-drag'), 'a non-primary pointer is ignored');
  assert.deepEqual(rhr.grip.captured, []);
  // a right click (or middle) is not a drag
  const right = fire('pointerdown', rhr.grip, 30, { button: 2 });
  assert.ok(!right.defaultPrevented && !rhr.classList.contains('db-drag'), 'a non-left mouse button is ignored');
  fire('pointermove', rhr.grip, 170, { button: 2 });
  fire('pointerup', rhr.grip, 170, { button: 2 });
  assert.deepEqual(sheet.order(), ['rhr', 'hrv', 'sleep']);
  assert.equal(ls.data['hc-dash-v1'], undefined);
  // a pointer down while a drag is active does not hijack it
  fire('pointerdown', rhr.grip, 30);
  assert.ok(rhr.classList.contains('db-drag'));
  const again = fire('pointerdown', hrv.grip, 90, { pointerId: 3 });
  assert.ok(!again.defaultPrevented && !hrv.classList.contains('db-drag'), 'a second pointerdown mid-drag is ignored');
  assert.deepEqual(hrv.grip.captured, []);
  fire('pointermove', rhr.grip, 170);
  fire('pointerup', rhr.grip, 170);
  assert.deepEqual(sheet.order(), ['hrv', 'sleep', 'rhr'], 'the first drag still drops');
  assert.ok(ls.data['hc-dash-v1'] != null, 'and saves');
});

test('drag: a lost capture mid-drag (the row moved) is re-taken; once the pointer is gone it cancels like pointercancel', () => {
  const { ctx, ls, opened } = load();
  const fire = (type, target, y, extra) => ctx.__listeners[type]({ type, target, pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientY: y, preventDefault() {}, ...extra });
  const a = fakeSheet(['rhr', 'hrv', 'sleep']);
  fire('pointerdown', a.rows[0].grip, 30);
  fire('pointermove', a.rows[0].grip, 170);
  assert.deepEqual(a.order(), ['hrv', 'sleep', 'rhr']);
  fire('lostpointercapture', a.rows[0].grip, 170, { pointerId: 9 }); // another pointer's capture: ignored
  assert.ok(a.rows[0].classList.contains('db-drag'));
  // the live reorder moved the row: the browser drops the capture, the drag takes it back and goes on
  fire('lostpointercapture', a.rows[0].grip, 170);
  assert.ok(a.rows[0].classList.contains('db-drag'), 'still dragging');
  assert.deepEqual(a.rows[0].grip.captured, [1, 1], 're-captured');
  // the pointer is gone (no pointerup reached the page): re-capturing fails, the drag cancels
  a.rows[0].grip.gone = true;
  fire('lostpointercapture', a.rows[0].grip, 170);
  assert.ok(!a.rows[0].classList.contains('db-drag'));
  assert.equal(ls.data['hc-dash-v1'], undefined, 'a lost capture never saves');
  assert.equal(plain(opened.at(-1))[0], 'dash-edit', 'the sheet re-renders in the saved order');
  fire('pointerup', a.rows[0].grip, 170);
  assert.equal(ls.data['hc-dash-v1'], undefined, 'the late pointerup is not a drop');
  const b = fakeSheet(['rhr', 'hrv', 'sleep']);
  fire('pointerdown', b.rows[0].grip, 30);
  fire('pointermove', b.rows[0].grip, 170);
  fire('pointerup', b.rows[0].grip, 170);
  assert.ok(ls.data['hc-dash-v1'] != null, 'a new drag still drops and saves');
});

test('drag: a stale drag (its row left the page) or a re-render never blocks the next drag', () => {
  const { ctx, ls } = load();
  const fire = (type, target, y, extra) => ctx.__listeners[type]({ type, target, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientY: y, preventDefault() {}, ...extra });
  const a = fakeSheet(['rhr', 'hrv', 'sleep']);
  fire('pointerdown', a.rows[0].grip, 30); // no pointerup ever arrives (e.g. released outside the page)
  a.ul.detached = true; // the sheet closed
  const b = fakeSheet(['rhr', 'hrv', 'sleep']);
  fire('pointerdown', b.rows[0].grip, 30, { pointerId: 2 });
  assert.ok(b.rows[0].classList.contains('db-drag'), 'the stale drag is reset, the new one starts');
  fire('pointermove', b.rows[0].grip, 170, { pointerId: 2 });
  fire('pointerup', b.rows[0].grip, 170, { pointerId: 2 });
  assert.deepEqual(b.order(), ['hrv', 'sleep', 'rhr']);
  assert.ok(ls.data['hc-dash-v1'] != null);
  // a drag interrupted by a re-render of the sheet is dropped too
  const c = fakeSheet(['rhr', 'hrv', 'sleep']);
  fire('pointerdown', c.rows[0].grip, 30, { pointerId: 3 });
  ctx.HCViews['dash-edit'].render();
  assert.ok(!c.rows[0].classList.contains('db-drag'), 'the re-render clears the drag');
  const d = fakeSheet(['rhr', 'hrv', 'sleep']);
  fire('pointerdown', d.rows[1].grip, 90, { pointerId: 4 });
  assert.ok(d.rows[1].classList.contains('db-drag'), 'the next drag starts');
});
