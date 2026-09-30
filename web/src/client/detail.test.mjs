/* Tests for the detail sheet renderer (web/src/client/detail.js): runs the classic script in a vm with
 * the baked DETAIL (built from the tracked synthetic demo extract) + I18N_DETAIL, a controllable clock,
 * and stubbed document / history / location, so opening, deep links, Back, Esc, the range switch, the
 * month calendar and the day detail are exercised without a browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDetail } from '../../../lib/detail/detail.mjs';
import { es as esT, en as enT } from '../i18n/detail-templates.mjs';
import { es as esDate, en as enDate } from '../i18n/date-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';
import { StubElement } from '../../test/dom-stub.mjs';
import { buildScores } from '../../../lib/score/index.mjs';
import { buildHealth } from '../../../lib/health/aggregate.mjs';
import { buildDials } from '../view/dial.mjs';

const format = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'detail.js'), 'utf8');
const DEMO = buildDetail(path.join(here, '..', '..', '..', 'data', 'demo', 'extract'));
const NOW = DEMO.asOf; // the viewer opens the page on the demo's newest data day

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayIndex = (m, iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(m.start + 'T00:00:00Z')) / 86400000);
const valueOn = (m, iso) => { const i = dayIndex(m, iso); return i >= 0 && i < m.v.length ? m.v[i] : null; };

// parts: true = the sheet's sub-parts (calendar, day panel, chart selection) resolve to stub elements,
// so a day tap can update them in place; query = extra host.querySelector answers (sel -> element)
function setup({ locale = 'en', now = NOW, detail = DEMO, hash = '', backAsync = false, parts = false, query = {}, views = null } = {}) {
  const listeners = { doc: {}, win: {} };
  const host = new StubElement('div', { attrs: { id: 'detail' }, hidden: true });
  const closeBtn = { focused: 0, focus() { this.focused++; } };
  const part = { cal: new StubElement('div'), day: new StubElement('div'), sel: new StubElement('rect') };
  let hostWrites = 0;
  const desc = Object.getOwnPropertyDescriptor(host, 'innerHTML');
  Object.defineProperty(host, 'innerHTML', { configurable: true, get: desc.get, set: (v) => { hostWrites++; desc.set(v); } });
  host.querySelector = (sel) => {
    if (sel in query) return query[sel];
    if (sel.includes('close')) return closeBtn;
    if (parts && sel === '[data-dt-part="cal"]') return part.cal;
    if (parts && sel === '[data-dt-part="day"]') return part.day;
    if (parts && sel === '.dt-sel') return part.sel;
    return null;
  };
  host.querySelectorAll = () => [];
  const wrap = new StubElement('div', { classes: ['wrap'] });
  const heading = { focused: 0, attrs: {}, focus() { this.focused++; }, hasAttribute(k) { return k in this.attrs; }, setAttribute(k, v) { this.attrs[k] = v; } };
  const panel = { hidden: false, querySelector: (sel) => (sel.includes('h2') ? heading : null) };
  const root = new StubElement('html');
  const loc = { hash, pathname: '/', search: '' };
  const calls = [];
  const fire = (bucket, type, evt) => (listeners[bucket][type] || []).forEach((fn) => fn(evt));
  const history = {
    state: null,
    pushState(state, _t, url) { calls.push(['push', url]); this.state = state; loc.hash = url; },
    replaceState(state, _t, url) { calls.push(['replace', url]); this.state = state; loc.hash = url.startsWith('#') ? url : ''; },
    back() {
      calls.push(['back']);
      const pop = () => { this.state = null; loc.hash = ''; fire('win', 'popstate', {}); };
      if (backAsync) pendingPops.push(pop); else pop();
    },
  };
  const pendingPops = [];
  const doc = {
    getElementById: (id) => (id === 'detail' ? host : null),
    querySelector: (sel) => (sel === '.wrap' ? wrap : null),
    querySelectorAll: (sel) => (sel === '.tab-panel' ? [{ hidden: true, querySelector: () => null }, panel] : []),
    addEventListener: (t, fn) => { (listeners.doc[t] = listeners.doc[t] || []).push(fn); },
    documentElement: root,
    activeElement: null,
  };
  const win = { addEventListener: (t, fn) => { (listeners.win[t] = listeners.win[t] || []).push(fn); } };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now + 'T12:00:00'])); }
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const ctx = {
    document: doc, window: win, history, location: loc,
    DETAIL: detail, I18N_DETAIL: locale === 'es' ? esT : enT, I18N_DATE: locale === 'es' ? esDate : enDate, LOCALE: locale,
    Date: FakeDate, Math, String, Number, Array, Object, JSON, isFinite, parseInt, setTimeout: (fn) => fn(),
  };
  win.history = history;
  if (views) win.HCViews = views;
  win.location = loc;
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  const api = win.HCDetail;
  return {
    ctx, host, wrap, root, loc, calls, api, closeBtn, part, heading,
    hostWrites: () => hostWrites,
    flushBack: () => { while (pendingPops.length) pendingPops.shift()(); },
    click: (target) => fire('doc', 'click', { target, preventDefault() {} }),
    key: (key, target = host) => { const e = { key, target, prevented: false, preventDefault() { this.prevented = true; } }; fire('doc', 'keydown', e); return e; },
    popstate: () => fire('win', 'popstate', {}),
  };
}
const act = (a, extra = {}) => new StubElement('button', { attrs: { 'data-dt-act': a, ...extra } });
const clean = (html) => assert.doesNotMatch(html, /NaN|undefined|null|Infinity|<script|src=|href=/);

test('every DETAIL key of the demo build renders a view: title, latest value + date, range switch, chart, month calendar, no NaN', () => {
  const s = setup();
  for (const key of Object.keys(DEMO.metrics)) {
    s.api.open(key);
    const html = s.host.innerHTML;
    assert.equal(s.host.hidden, false, key);
    assert.ok(html.includes(`id="dt-title">${enT.metrics[key].title}<`), `${key} title`);
    assert.match(html, /class="dt-range"/, `${key} range switch`);
    assert.match(html, /<svg class="dt-chart"/, `${key} chart`);
    assert.match(html, /class="dt-cal"/, `${key} calendar`);
    clean(html);
  }
});

test('the sheet is an accessible modal: focus moves in, the page behind is inert, Esc closes and focus returns to the opener', () => {
  const s = setup();
  const opener = new StubElement('div', { attrs: { 'data-detail': 'hrv' } });
  opener.focused = 0;
  opener.focus = () => { opener.focused++; };
  assert.equal(s.host.getAttribute('role'), 'dialog');
  assert.equal(s.host.getAttribute('aria-modal'), 'true');
  assert.equal(s.host.getAttribute('aria-labelledby'), 'dt-title');
  s.click(opener);
  assert.equal(s.api.state().key, 'hrv');
  assert.equal(s.closeBtn.focused, 1, 'focus moves to the close button');
  assert.equal(s.wrap.getAttribute('inert'), '');
  assert.ok(s.root.classes.has('dt-lock'), 'page scroll locked');
  const e = s.key('Escape');
  assert.equal(e.prevented, true);
  assert.equal(s.host.hidden, true);
  assert.equal(s.wrap.getAttribute('inert'), null);
  assert.equal(opener.focused, 1, 'focus returns to the card that opened it');
});

test('history: opening pushes #detail/<metric>[/<date>], Back (popstate) closes, closing pops the pushed entry', () => {
  const s = setup();
  const d = addDays(NOW, -3);
  s.click(new StubElement('div', { attrs: { 'data-detail': 'sleep', 'data-date': d } }));
  assert.deepEqual(s.calls[0], ['push', `#detail/sleep/${d}`]);
  assert.equal(s.api.state().date, d);
  s.loc.hash = '';
  s.popstate();
  assert.equal(s.host.hidden, true, 'browser Back closes the sheet');
  s.api.open('steps');
  s.click(act('close'));
  assert.deepEqual(s.calls.at(-1), ['back'], 'the close button pops the entry it pushed');
  assert.equal(s.host.hidden, true);
});

test('deep link: a page opened with #detail/<metric>/<date> opens that view on load (no extra history entry); closing clears the hash', () => {
  const d = addDays(NOW, -2);
  const s = setup({ hash: `#detail/rhr/${d}` });
  assert.equal(s.host.hidden, false);
  assert.equal(s.api.state().key, 'rhr');
  assert.equal(s.api.state().date, d);
  assert.equal(s.calls.filter((c) => c[0] === 'push').length, 0);
  s.key('Escape');
  assert.equal(s.calls.at(-1)[0], 'replace');
  assert.equal(s.loc.hash, '');
  // junk hashes are ignored
  assert.equal(setup({ hash: '#detail/nope' }).host.hidden, true);
  assert.equal(setup({ hash: '#detail/sleep/2026-13-99x' }).host.hidden, true);
});

test('a frame that refuses history writes (sandboxed artifact): the view still opens and closing never calls history.back()', () => {
  const s = setup();
  s.ctx.history.pushState = () => { throw new Error('SecurityError'); };
  s.ctx.history.replaceState = () => { throw new Error('SecurityError'); };
  s.api.open('sleep');
  assert.equal(s.host.hidden, false);
  s.click(act('close'));
  assert.equal(s.host.hidden, true);
  assert.equal(s.calls.filter((c) => c[0] === 'back').length, 0, 'back() would navigate away from the page');
});

test('walking HR (a daytime signal) shows the day value vs its personal median, not a night', () => {
  const s = setup();
  const m = DEMO.metrics.walkingHr;
  const d = addDays(m.start, m.v.length - 2);
  s.api.open('walkingHr', d);
  const html = s.host.innerHTML;
  assert.ok(html.includes('vs your median'));
  assert.ok(!html.includes(enT.day.asleep), 'no sleep rows');
});

test('Enter or Space on a card opener opens its view', () => {
  const s = setup();
  const e = s.key('Enter', new StubElement('div', { attrs: { 'data-detail': 'weight' } }));
  assert.equal(e.prevented, true);
  assert.equal(s.api.state().key, 'weight');
});

test('range switch: 30 d / 90 d / 1 yr, the pressed button follows, the chart spans that many days ending at the viewer\'s today', () => {
  const s = setup();
  s.api.open('steps');
  assert.match(s.host.innerHTML, /data-range="30" aria-pressed="true"/, 'opens on 30 days');
  s.click(act('range', { 'data-range': '90' }));
  const html = s.host.innerHTML;
  assert.match(html, /data-range="90" aria-pressed="true"/);
  assert.match(html, /data-range="30" aria-pressed="false"/);
  assert.match(html, /<div class="dt-ax"><span>[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}<\/span>/, 'date axis written with HC.fmtDate');
  const m = DEMO.metrics.steps;
  const from = addDays(NOW, -89);
  const bars = (html.match(/class="dt-bar/g) || []).length;
  let expected = 0;
  for (let i = 0; i < 90; i++) { const v = valueOn(m, addDays(from, i)); if (v != null && v > 0) expected++; }
  assert.equal(bars, expected, 'one bar per day with data, none for a missing day');
});

test('missing days are gaps, never zero: no point, no bar, an empty calendar cell and "no data" in the day detail', () => {
  const detail = JSON.parse(JSON.stringify(DEMO));
  const m = detail.metrics.hrv;
  const gap = addDays(NOW, -4);
  m.v[dayIndex(m, gap)] = null;
  const s = setup({ detail });
  s.api.open('hrv', gap);
  const html = s.host.innerHTML;
  assert.match(html, new RegExp(`class="dt-day dt-s-none"[^>]*data-date="${gap}"`));
  assert.ok(html.includes(enT.day.noData));
  const pts = (html.match(/class="dt-pt/g) || []).length;
  const from = addDays(NOW, -29);
  let expected = 0;
  for (let i = 0; i < 30; i++) if (valueOn(m, addDays(from, i)) != null) expected++;
  assert.equal(pts, expected);
});

test('calendar: Monday-first weekday header (es / en), prev / next month bounded by the baked range, tapping a day shows it', () => {
  const s = setup();
  s.api.open('sleep');
  let html = s.host.innerHTML;
  assert.ok(html.includes('<span class="dt-wd">M</span><span class="dt-wd">T</span><span class="dt-wd">W</span>'));
  assert.match(html, /data-dt-act="month" data-dir="1"[^>]*disabled/, 'no month after the viewer\'s current one');
  const first = DEMO.metrics.sleep.start.slice(0, 7);
  for (let i = 0; i < 12; i++) s.click(act('month', { 'data-dir': '-1' }));
  assert.equal(s.api.state().month.slice(0, 7), first, 'never earlier than the first baked month');
  assert.match(s.host.innerHTML, /data-dt-act="month" data-dir="-1"[^>]*disabled/);
  const d = addDays(DEMO.metrics.sleep.start, 3);
  s.click(act('day', { 'data-date': d }));
  html = s.host.innerHTML;
  assert.equal(s.api.state().date, d);
  assert.match(html, new RegExp(`data-date="${d}" aria-pressed="true"`));
  assert.deepEqual(s.calls.at(-1), ['replace', `#detail/sleep/${d}`], 'the hash follows the picked day');
  const es = setup({ locale: 'es' });
  es.api.open('sleep');
  assert.ok(es.host.innerHTML.includes('<span class="dt-wd">L</span><span class="dt-wd">M</span><span class="dt-wd">X</span>'));
});

test('sleep day detail: asleep hours vs target, bedtime – wake, that night\'s HRV / resting HR / respiratory / wrist temp, and the no-stages note', () => {
  const s = setup();
  const d = addDays(NOW, -1);
  s.api.open('sleep', d);
  const html = s.host.innerHTML;
  const sl = DEMO.metrics.sleep;
  const i = dayIndex(sl, d);
  const clock = (h) => { h = ((h % 24) + 24) % 24; const H = Math.floor(h); let M = Math.round((h - H) * 60); let HH = H; if (M === 60) { M = 0; HH = (H + 1) % 24; } return String(HH).padStart(2, '0') + ':' + String(M).padStart(2, '0'); };
  assert.ok(html.includes(`${sl.v[i].toFixed(1)} h`), 'hours');
  assert.ok(html.includes(`${clock(sl.bed[i])}–${clock(sl.wake[i])}`), 'bedtime – wake');
  assert.ok(html.includes(String(valueOn(DEMO.metrics.hrv, d))), 'HRV that night');
  assert.ok(html.includes(String(valueOn(DEMO.metrics.rhr, d))), 'resting HR that night');
  assert.ok(html.includes(enT.day.stagesNote));
  assert.ok(html.includes('Mon 28 Sep') || html.includes('Sun 27 Sep'), 'the day heading uses HC.fmtDate');
});

test('workouts / load day detail lists that day\'s sessions after the same-day rule; a load view shows only its modality', () => {
  const s = setup();
  const day = DEMO.sessions.find((x) => x.m === 'run');
  s.api.open('workouts', day.d);
  let html = s.host.innerHTML;
  const all = DEMO.sessions.filter((x) => x.d === day.d);
  assert.equal((html.match(/class="dt-sess"/g) || []).length, all.length);
  assert.ok(html.includes(enT.modalities.run));
  assert.ok(html.includes(`${day.min} min`));
  if (day.re != null) assert.ok(html.includes(`RE ${day.re}`));
  s.api.open('load-gym', day.d);
  html = s.host.innerHTML;
  assert.equal((html.match(/class="dt-sess"/g) || []).length, all.filter((x) => x.m === 'gym').length);
  const w = DEMO.metrics.workouts;
  const rest = addDays(w.start, w.v.findIndex((x) => x === 0));
  s.api.open('workouts', rest);
  assert.ok(!s.host.innerHTML.includes('class="dt-sess"'));
  assert.ok(s.host.innerHTML.includes(enT.day.rest), 'a day without a session reads as rest');
});

test('daily totals: the day value vs the personal median; energy splits active and basal', () => {
  const s = setup();
  const d = addDays(NOW, -2);
  s.api.open('steps', d);
  const m = DEMO.metrics.steps;
  const v = valueOn(m, d);
  const pct = Math.round(100 * (v / m.band.median - 1));
  assert.ok(s.host.innerHTML.includes(`${pct > 0 ? '+' : ''}${pct}%`), 'percent vs median');
  s.api.open('energy', d);
  assert.ok(s.host.innerHTML.includes(enT.day.active) && s.host.innerHTML.includes(enT.day.basal));
});

test('calendar state colours follow the personal band / target (dayState)', () => {
  const s = setup();
  const S = s.api.dayState;
  const band = { lo: 40, median: 50, hi: 60 };
  assert.equal(S({ kind: 'signal', dir: 1, band }, 70), 'good');
  assert.equal(S({ kind: 'signal', dir: 1, band }, 30), 'bad');
  assert.equal(S({ kind: 'signal', dir: -1, band }, 70), 'bad');
  assert.equal(S({ kind: 'signal', dir: 0, band }, 70), 'watch');
  assert.equal(S({ kind: 'signal', dir: 1, band }, 50), 'normal');
  assert.equal(S({ kind: 'total', dir: 0, band }, 70), 'hi');
  assert.equal(S({ kind: 'total', dir: 0, band }, 30), 'lo');
  assert.equal(S({ kind: 'sleep', dir: 1, target: 7.5, band: { lo: 6, median: 7, hi: 8 } }, 7.6), 'good');
  assert.equal(S({ kind: 'sleep', dir: 1, target: 7.5, band: { lo: 6, median: 7, hi: 8 } }, 7), 'mid');
  assert.equal(S({ kind: 'sleep', dir: 1, target: 7.5, band: { lo: 6, median: 7, hi: 8 } }, 5.5), 'bad');
  assert.equal(S({ kind: 'recovery', cut: 1.2 }, 1.5), 'good');
  assert.equal(S({ kind: 'recovery', cut: 1.2 }, -1.5), 'bad');
  assert.equal(S({ kind: 'recovery', cut: 1.2 }, 0.2), 'normal');
  assert.equal(S({ kind: 'workouts', levels: [1, 30, 60, 90] }, 65), 'l3');
  assert.equal(S({ kind: 'workouts', levels: [1, 30, 60, 90] }, 0), 'rest');
  assert.equal(S({ kind: 'sparse' }, 80), 'measured');
  assert.equal(S({ kind: 'signal', dir: 1, band: null }, 50), 'normal', 'no band yet: neutral');
  assert.equal(S({ kind: 'signal', dir: 1, band }, null), 'none');
});

test('stale data: the view ends at the newest data date and says so; clock ahead of the data does the same', () => {
  const s = setup({ now: addDays(NOW, 10) });
  s.api.open('rhr');
  assert.ok(s.host.innerHTML.includes('class="dt-stale"'));
  assert.equal(s.api.state().month.slice(0, 7), NOW.slice(0, 7));
  const early = setup({ now: addDays(NOW, -5) });
  early.api.open('rhr');
  assert.match(early.host.innerHTML, /<svg class="dt-chart"/);
});

test('empty and broken views fall back to a message, never a blank or broken sheet', () => {
  const s = setup({ detail: { asOf: null, days: 365, metrics: {}, sessions: [] } });
  s.api.open('sleep');
  assert.ok(s.host.innerHTML.includes(enT.empty));
  assert.ok(s.host.innerHTML.includes('data-dt-act="close"'), 'always closable');
  const broken = JSON.parse(JSON.stringify(DEMO));
  broken.metrics.hrv.v = 'garbage';
  const b = setup({ detail: broken });
  b.api.open('hrv');
  assert.ok(b.host.innerHTML.includes(enT.viewError));
  assert.ok(b.host.innerHTML.includes('data-dt-act="close"'));
  const none = setup({ detail: null });
  none.api.open('hrv');
  assert.ok(none.host.innerHTML.includes(enT.empty));
});

test('es: Spanish copy, decimal comma, Spanish dates', () => {
  const s = setup({ locale: 'es' });
  const d = addDays(NOW, -1);
  s.api.open('sleep', d);
  const html = s.host.innerHTML;
  assert.ok(html.includes(esT.metrics.sleep.title));
  const v = valueOn(DEMO.metrics.sleep, d);
  assert.ok(html.includes(`${v.toFixed(1).replace('.', ',')} h`));
  assert.match(html, /(lun|dom) 2[78] sept/);
  clean(html);
});

/* ---------- the sheet never contradicts the card it opens from ---------- */

const DEMO_DIR = path.join(here, '..', '..', '..', 'data', 'demo', 'extract');
const DIALS = buildDials(buildScores(DEMO_DIR), buildHealth(DEMO_DIR));
const headOf = (html) => html.split('<div class="dt-body">')[0];
const sgn = (v, dec) => (v > 0 ? '+' : '') + v.toFixed(dec);
const copy = () => JSON.parse(JSON.stringify(DEMO));

test('recovery header = the dial: last night\'s value, day band and "last night" label; the 7-day trend is the secondary line with its own band', () => {
  const s = setup();
  s.api.open('recovery');
  const h = headOf(s.host.innerHTML);
  const d = DIALS.recovery;
  assert.equal(d.mode, 'today');
  const bandState = { above: 'good', at: 'normal', below: 'bad' };
  assert.ok(h.includes(`dt-c-${bandState[d.band]}">${sgn(d.value, 1)}<`), 'same value and band as the dial');
  assert.ok(h.includes(enT.day.bands[d.band]), 'band word');
  assert.ok(h.includes(enT.rec.lastNight), 'dated the viewer\'s today: "last night"');
  const trend = format(enT.rec.trendLine, { dir: enT.rec.dirs[d.trend.dir], value: sgn(d.trend.value, 1) });
  assert.ok(h.includes(`dt-sub dt-c-${bandState[d.trend.band]}">${trend}`), 'trend line coloured by the TREND band');
  const later = setup({ now: addDays(NOW, 1) });
  later.api.open('recovery');
  assert.ok(!headOf(later.host.innerHTML).includes(enT.rec.lastNight), 'a day later the night is dated, like the dial');
  assert.ok(headOf(later.host.innerHTML).includes('Mon 28 Sep'));
  // the chart's zone is the 7-day trend band; both cuts are stated
  const html = s.host.innerHTML;
  assert.ok(html.includes(enT.chartKey.baseline));
  assert.ok(html.includes('±1.2') && html.includes('±0.5'), 'day cut and trend cut both stated');
  assert.ok(html.includes(enT.bands.perDayNote), 'recovery colours are per day');
});

test('weight header = the Salud card\'s 7-day rolling average (the chart line), with the latest raw reading underneath', () => {
  const s = setup();
  s.api.open('weight');
  const h = headOf(s.host.innerHTML);
  const w = DEMO.metrics.weight;
  const roll = w.roll[w.roll.length - 1];
  assert.ok(h.includes(`>${roll.toFixed(1)}<`), 'rolling average as the headline');
  assert.ok(h.includes(format(enT.roll7Lbl, { date: 'Mon 28 Sep' })));
  assert.ok(h.includes(format(enT.latestReading, { value: w.latest.value.toFixed(1), unit: 'kg', date: 'Mon 28 Sep' })));
  assert.match(s.host.innerHTML, /<path class="dt-line"/, 'the baked rolling line is drawn');
});

test('energy header = the 7-day rolling expenditure of the newest COMPLETE day; today (in progress) is only the secondary line', () => {
  const e = DEMO.metrics.energy;
  const s = setup(); // the viewer's today = the newest data day
  s.api.open('energy');
  let h = headOf(s.host.innerHTML);
  assert.ok(h.includes(`>${e.roll[e.roll.length - 2]}<`), 'yesterday\'s rolling value, not the partial day');
  assert.ok(h.includes(format(enT.latestDaySoFar, { value: String(e.v[e.v.length - 1]), unit: 'kcal' })));
  const later = setup({ now: addDays(NOW, 1) });
  later.api.open('energy');
  h = headOf(later.host.innerHTML);
  assert.ok(h.includes(`>${e.roll[e.roll.length - 1]}<`), 'the newest day is complete once the viewer\'s day moved on');
  assert.ok(h.includes(format(enT.latestDay, { value: String(e.v[e.v.length - 1]), unit: 'kcal', date: 'Mon 28 Sep' })));
});

test('a daily total\'s newest day, when it is the viewer\'s today, reads "today, in progress" in neutral colour everywhere and is not compared', () => {
  const s = setup();
  s.api.open('steps', NOW);
  const html = s.host.innerHTML;
  assert.ok(headOf(html).includes(enT.todaySoFar));
  assert.ok(headOf(html).includes('dt-c-partial'));
  assert.match(html, new RegExp(`class="dt-day dt-s-partial"[^>]*data-date="${NOW}"`));
  assert.match(html, /class="dt-bar dt-s-partial"/);
  const day = html.split('class="dt-dayd"')[1];
  assert.ok(day.includes(enT.todaySoFar) && !day.includes('vs your median'), 'the day detail is not compared with the median');
  const later = setup({ now: addDays(NOW, 1) });
  later.api.open('steps', NOW);
  assert.doesNotMatch(later.host.innerHTML, /dt-s-partial/, 'a finished day gets its state again');
});

test('load header = the dial: today\'s RE vs the typical day, else "no session yet today" + the last session; the typical line is the dial\'s typical day', () => {
  for (const m of DIALS.load.modalities) assert.equal(DEMO.metrics['load-' + m.key].typical, m.typical, `${m.key}: same typical day as the dial`);
  const s = setup();
  s.api.open('load-gym');
  const gym = DEMO.metrics['load-gym'];
  assert.ok(headOf(s.host.innerHTML).includes(format(enT.load.dayLine, { day: '28', typical: gym.typical.toFixed(0) })));
  s.api.open('load-run');
  const run = DEMO.metrics['load-run'];
  assert.ok(headOf(s.host.innerHTML).includes(format(enT.load.restLastLine, { date: 'Sat 26 Sep', re: String(run.last.re), typical: run.typical.toFixed(0) })));
  const gated = copy();
  gated.metrics['load-bike'].gate = 'fewDays';
  const g = setup({ detail: gated });
  g.api.open('load-bike');
  assert.ok(headOf(g.host.innerHTML).includes(enT.load.gated.fewDays));
});

test('training time: rest days are 0 up to the data\'s asOf, days after it are missing; the header\'s latest is the newest day ("rest" on a rest day)', () => {
  const s = setup({ now: addDays(NOW, 2) });
  s.api.open('workouts');
  const html = s.host.innerHTML;
  assert.match(html, new RegExp(`class="dt-day dt-s-none"[^>]*data-date="${addDays(NOW, 1)}"`), 'after asOf: no data yet');
  assert.match(html, new RegExp(`class="dt-day dt-s-rest"[^>]*data-date="${addDays(NOW, -1)}"`), 'a day without a session: rest');
  assert.ok(headOf(html).includes('>37<'));
  const rest = copy();
  rest.metrics.workouts.v[rest.metrics.workouts.v.length - 1] = 0;
  const r = setup({ detail: rest });
  r.api.open('workouts');
  assert.ok(headOf(r.host.innerHTML).includes(enT.restDay));
});

test('notes: colours are against the current range (static); a metric whose own last day is > 3 days old says so', () => {
  const s = setup();
  s.api.open('hrv');
  assert.ok(s.host.innerHTML.includes(enT.bands.staticNote));
  assert.ok(!s.host.innerHTML.includes('dt-mstale'));
  const old = copy();
  const m = old.metrics.hrv;
  for (let i = 1; i <= 5; i++) m.v[m.v.length - i] = null;
  const o = setup({ detail: old });
  o.api.open('hrv');
  assert.ok(o.host.innerHTML.includes(format(enT.metricStale, { date: 'Wed 23 Sep' })));
});

/* ---------- resilience / accessibility ---------- */

test('close then an immediate re-open (Back still pending) keeps the new sheet open and gives it its own history entry', () => {
  const s = setup({ backAsync: true });
  s.click(new StubElement('div', { attrs: { 'data-detail': 'sleep' } }));
  s.click(act('close'));
  assert.deepEqual(s.calls.at(-1), ['back']);
  s.api.open('steps');
  assert.equal(s.calls.filter((c) => c[0] === 'push').length, 1, 'no history write while Back is in flight');
  s.flushBack();
  assert.equal(s.host.hidden, false, 'the late popstate does not close the new sheet');
  assert.deepEqual(s.calls.at(-1), ['push', '#detail/steps']);
  assert.equal(s.api.state().pushed, true);
  s.click(act('close'));
  s.flushBack();
  assert.equal(s.host.hidden, true);
  assert.equal(s.calls.filter((c) => c[0] === 'push').length, 2, 'a plain close + popstate writes nothing more');
});

test('hash validation: the metric must be an own key of both DETAIL and the copy; a bad or out-of-range date falls back and the URL follows', () => {
  assert.equal(setup({ hash: '#detail/constructor' }).host.hidden, true);
  assert.equal(setup({ hash: '#detail/toString' }).host.hidden, true);
  const noVo2 = copy();
  delete noVo2.metrics.vo2max;
  assert.equal(setup({ detail: noVo2, hash: '#detail/vo2max' }).host.hidden, true, 'no data for that metric: no deep link');
  for (const bad of ['2026-02-31', '2020-01-01']) {
    const s = setup({ hash: `#detail/sleep/${bad}` });
    assert.equal(s.host.hidden, false);
    assert.equal(s.api.state().date, NOW);
    assert.deepEqual(s.calls.at(-1), ['replace', `#detail/sleep/${NOW}`]);
  }
});

test('focus: a disabled or missing control after a re-render hands focus to the close button; a deep-linked sheet returns focus to the tab heading', () => {
  const disabled = { disabled: true, focused: 0, focus() { this.focused++; } };
  const s = setup({ query: { '[data-dir="-1"]': disabled } });
  s.api.open('sleep');
  const before = s.closeBtn.focused;
  s.click(act('month', { 'data-dir': '-1' }));
  assert.equal(disabled.focused, 0);
  assert.equal(s.closeBtn.focused, before + 1);
  const d = setup({ hash: '#detail/rhr' });
  assert.equal(d.wrap.getAttribute('aria-hidden'), 'true', 'page hidden from assistive tech while open');
  d.key('Escape');
  assert.equal(d.heading.focused, 1, 'no opener: the visible tab\'s heading');
  assert.equal(d.heading.attrs.tabindex, '-1');
  assert.equal(d.wrap.getAttribute('aria-hidden'), null);
});

test('a throwing history.pushState leaves no lock behind: no dt-lock, inert or aria-hidden after close', () => {
  const s = setup();
  s.ctx.history.pushState = () => { throw new Error('SecurityError'); };
  s.click(new StubElement('div', { attrs: { 'data-detail': 'sleep' } }));
  assert.equal(s.host.hidden, false);
  s.click(act('close'));
  assert.equal(s.host.hidden, true);
  assert.ok(!s.root.classes.has('dt-lock'));
  assert.equal(s.wrap.getAttribute('inert'), null);
  assert.equal(s.wrap.getAttribute('aria-hidden'), null);
});

test('a day tap re-renders only the calendar and the day panel (the chart is not rebuilt; its selection moves)', () => {
  const s = setup({ parts: true });
  s.api.open('sleep');
  const writes = s.hostWrites();
  const d = addDays(NOW, -5);
  s.click(act('day', { 'data-date': d }));
  assert.equal(s.hostWrites(), writes, 'the sheet (and its SVG chart) is not re-rendered');
  assert.match(s.part.cal.innerHTML, new RegExp(`data-date="${d}" aria-pressed="true"`));
  assert.ok(s.part.day.innerHTML.includes('Wed 23 Sep'));
  assert.ok(s.part.sel.getAttribute('x') != null, 'the chart selection moved');
  assert.deepEqual(s.calls.at(-1), ['replace', `#detail/sleep/${d}`]);
});

test('opener delegation: a click on a control inside a card opens nothing; the card itself (or plain content in it) opens the sheet', () => {
  const s = setup();
  const card = new StubElement('div', { attrs: { 'data-detail': 'hrv', role: 'button' } });
  const inner = new StubElement('button', { parent: card });
  const link = new StubElement('a', { parent: card });
  const text = new StubElement('span', { parent: card });
  s.click(inner);
  s.click(link);
  assert.equal(s.host.hidden, true);
  assert.equal(s.key('Enter', inner).prevented, false);
  s.click(text);
  assert.equal(s.api.state().key, 'hrv');
  s.key('Escape');
  s.click(card);
  assert.equal(s.host.hidden, false);
});

/* ---------- registered views (window.HCViews): the profile sheet reuses the modal ---------- */
const profileView = (over = {}) => ({
  profile: { title: () => 'Profile', render: () => ({ head: '<div class="pf-head">H</div>', body: '<p class="pf-body">B</p>' }), ...over },
});

test('a registered view opens from its opener: its title + head + body in the same modal, #<key> pushed, Esc closes', () => {
  const s = setup({ views: profileView() });
  const btn = new StubElement('button', { attrs: { 'data-detail': 'profile', 'aria-haspopup': 'dialog' } });
  btn.focused = 0;
  btn.focus = () => { btn.focused++; };
  s.click(btn);
  const html = s.host.innerHTML;
  assert.equal(s.host.hidden, false);
  assert.ok(html.includes('id="dt-title">Profile<'));
  assert.ok(html.includes('class="pf-head"') && html.includes('class="pf-body"'));
  assert.doesNotMatch(html, /dt-range|dt-chart|dt-cal/, 'no metric chrome');
  assert.deepEqual(s.calls[0], ['push', '#profile']);
  assert.equal(s.wrap.getAttribute('inert'), '');
  s.key('Escape');
  assert.equal(s.host.hidden, true);
  assert.equal(btn.focused, 1, 'focus returns to the avatar');
});

test('deep link #profile opens the registered view on load; an unregistered #profile is ignored', () => {
  const s = setup({ views: profileView(), hash: '#profile' });
  assert.equal(s.host.hidden, false);
  assert.equal(s.api.state().key, 'profile');
  assert.equal(s.calls.filter((c) => c[0] === 'push').length, 0);
  assert.equal(setup({ hash: '#profile' }).host.hidden, true);
  assert.equal(setup({ views: profileView(), hash: '#constructor' }).host.hidden, true, 'own keys only');
});

test('Back (popstate to #profile) reopens the view; to no hash closes it', () => {
  const s = setup({ views: profileView() });
  s.loc.hash = '#profile';
  s.popstate();
  assert.equal(s.api.state().key, 'profile');
  s.loc.hash = '';
  s.popstate();
  assert.equal(s.host.hidden, true);
});

test('a view that throws renders the error message, never a blank sheet', () => {
  const s = setup({ views: profileView({ render: () => { throw new Error('boom'); } }) });
  s.api.open('profile');
  assert.equal(s.host.hidden, false);
  assert.ok(s.host.innerHTML.includes(enT.viewError));
});

test('the Tab trap also cycles through <summary> (a view may fold content in <details>), a radio group (its checked radio) and form fields (the food log add sheet)', () => {
  assert.match(source, /'button:not\(\[disabled\]\), summary, input\[type="radio"\]:checked, input:not\(\[type="radio"\]\):not\(\[type="hidden"\]\):not\(\[disabled\]\), select:not\(\[disabled\]\), textarea:not\(\[disabled\]\)'/);
});

test('Tab from a text field inside a view moves on normally; only the last control wraps to the first', () => {
  const s = setup({ views: profileView() });
  s.api.open('profile');
  const mk = () => ({ focused: 0, focus() { this.focused++; } });
  const first = mk(), field = mk(), last = mk();
  s.host.querySelectorAll = () => [first, field, last];
  s.ctx.document.activeElement = field;
  const mid = s.key('Tab', field);
  assert.equal(mid.prevented, false, 'the browser moves focus to the next control');
  s.ctx.document.activeElement = last;
  const wrap = s.key('Tab', last);
  assert.equal(wrap.prevented, true);
  assert.equal(first.focused, 1);
});

test('HCDetail.open(key, date, {opener}) returns focus to that opener on close (a tapped button that the browser did not focus)', () => {
  const s = setup({ views: profileView() });
  const opener = { focused: 0, focus() { this.focused++; }, isConnected: true };
  s.api.open('profile', null, { opener });
  s.api.close();
  assert.equal(opener.focused, 1);
});

test('HCDetail.open(key, date, {focus}) moves focus to that control of the view (the goal chip -> the goal radio), else the close button', () => {
  const radio = { focused: 0, focus() { this.focused++; } };
  const s = setup({ views: profileView(), query: { '#pf-goal input:checked': radio } });
  s.api.open('profile', null, { focus: '#pf-goal input:checked' });
  assert.equal(radio.focused, 1);
  assert.equal(s.api.state().key, 'profile');
  const t = setup({ views: profileView() });
  const before = t.closeBtn.focused;
  t.api.open('profile', null, { focus: '#pf-goal input:checked' });
  assert.equal(t.closeBtn.focused, before + 1, 'no such control: the close button');
});
