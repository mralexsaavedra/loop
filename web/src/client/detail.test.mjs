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
import { TAB_KEYS, SECTION_TAB, DETAIL_TAB, VIEW_TAB } from '../../../lib/nav/tabs.mjs';
import { buildScores } from '../../../lib/score/index.mjs';
import { buildHealth } from '../../../lib/health/aggregate.mjs';
import { buildDials } from '../view/dial.mjs';

const format = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'detail.js'), 'utf8');
// the dial deep-dive pages (sleep, recovery, load-<m>): inlined right before detail.js on the page
const deepSource = fs.readFileSync(path.join(here, 'deepdive.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(here, 'core.js'), 'utf8');
const DEMO = buildDetail(path.join(here, '..', '..', '..', 'data', 'demo', 'extract'));
const NOW = DEMO.asOf; // the viewer opens the page on the demo's newest data day

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayIndex = (m, iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(m.start + 'T00:00:00Z')) / 86400000);
const valueOn = (m, iso) => { const i = dayIndex(m, iso); return i >= 0 && i < m.v.length ? m.v[i] : null; };

// parts: true = the sheet's sub-parts (calendar, day panel, chart selection) resolve to stub elements,
// so a day tap can update them in place; query = extra host.querySelector answers (sel -> element)
function setup({ locale = 'en', now = NOW, detail = DEMO, hash = '', backAsync = false, parts = false, query = {}, views = null, withCore = false, settings = null, dials = null, health = null } = {}) {
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
  const hashOfUrl = (url) => { const i = String(url).indexOf('#'); return i === -1 ? '' : String(url).slice(i); };
  // the entries below the current one ({state, hash}): Back returns to the previous entry's hash
  const below = [];
  const history = {
    state: null,
    pushState(state, _t, url) { calls.push(['push', url]); below.push({ state: this.state, hash: loc.hash }); this.state = state; loc.hash = hashOfUrl(url); },
    replaceState(state, _t, url) { calls.push(['replace', url]); this.state = state; loc.hash = hashOfUrl(url); },
    back() {
      calls.push(['back']);
      const pop = () => {
        const prev = below.pop() || { state: null, hash: '' };
        const changed = prev.hash !== loc.hash;
        this.state = prev.state;
        loc.hash = prev.hash;
        fire('win', 'popstate', {});
        if (changed) fire('win', 'hashchange', {});
      };
      if (backAsync) pendingPops.push(pop); else pop();
    },
  };
  const pendingPops = [];
  // withCore: the real core.js runs first over four tab panels + nav buttons (home shown, as served)
  const ids = { detail: host };
  const tabPanels = withCore ? TAB_KEYS.map((t) => {
    ids['t-' + t] = new StubElement('button', { attrs: { 'aria-pressed': String(t === 'home') } });
    const el = new StubElement('div', { classes: ['tab-panel'], attrs: { 'data-tab': t }, hidden: t !== 'home' });
    el.querySelector = () => null;
    return el;
  }) : null;
  const doc = {
    getElementById: (id) => ids[id] || null,
    querySelector: (sel) => (sel === '.wrap' ? wrap : null),
    querySelectorAll: (sel) => (sel === '.tab-panel' ? tabPanels || [{ hidden: true, querySelector: () => null }, panel] : []),
    addEventListener: (t, fn) => { (listeners.doc[t] = listeners.doc[t] || []).push(fn); },
    documentElement: root,
    activeElement: null,
  };
  const win = { scrollTo() {}, addEventListener: (t, fn) => { (listeners.win[t] = listeners.win[t] || []).push(fn); } };
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
  if (settings) win.HCSettings = settings;
  if (dials) ctx.DIALS = dials;
  if (health) ctx.HEALTH = health;
  win.location = loc;
  vm.createContext(ctx);
  loadUtil(ctx);
  if (withCore) {
    ctx.NAV = { tabs: [...TAB_KEYS], sectionTab: { ...SECTION_TAB }, detailTab: { ...DETAIL_TAB }, viewTab: { ...VIEW_TAB } };
    vm.runInContext(coreSource, ctx);
  }
  vm.runInContext(deepSource, ctx);
  vm.runInContext(source, ctx);
  const api = win.HCDetail;
  const shownTab = () => (tabPanels || []).filter((el) => !el.hidden).map((el) => el.getAttribute('data-tab'));
  return {
    ctx, host, wrap, root, loc, calls, api, closeBtn, part, heading, shownTab,
    hostWrites: () => hostWrites,
    flushBack: () => { while (pendingPops.length) pendingPops.shift()(); },
    click: (target) => fire('doc', 'click', { target, preventDefault() {} }),
    key: (key, target = host) => { const e = { key, target, prevented: false, preventDefault() { this.prevented = true; } }; fire('doc', 'keydown', e); return e; },
    keyEvent: (e) => fire('doc', 'keydown', e),
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

test('range switch: W / M / 6M / 1Y, opens on M; the pressed button follows, the chart spans that many days ending at the viewer\'s today', () => {
  const s = setup();
  s.api.open('steps');
  assert.match(s.host.innerHTML, /data-range="30" aria-pressed="true" aria-label="Month \(30 days\)">M</, 'opens on the month');
  for (const [r, lbl] of [['7', 'W'], ['182', '6M'], ['365', '1Y']]) assert.match(s.host.innerHTML, new RegExp(`data-range="${r}" aria-pressed="false"[^>]*>${lbl}<`));
  s.click(act('range', { 'data-range': '7' }));
  const html = s.host.innerHTML;
  assert.match(html, /data-range="7" aria-pressed="true"/);
  assert.match(html, /data-range="30" aria-pressed="false"/);
  assert.match(html, /<div class="dt-ax"><span>[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}<\/span>/, 'date axis written with HC.fmtDate');
  const m = DEMO.metrics.steps;
  const from = addDays(NOW, -6);
  const bars = (html.match(/class="dt-bar/g) || []).length;
  let expected = 0;
  for (let i = 0; i < 7; i++) { const v = valueOn(m, addDays(from, i)); if (v != null && v > 0) expected++; }
  assert.equal(bars, expected, 'one bar per day with data, none for a missing day');
  s.click(act('range', { 'data-range': '13' }));
  assert.match(s.host.innerHTML, /data-range="30" aria-pressed="true"/, 'an unknown range falls back to the month');
});

test('W / M / 6M windowing: the period average, the delta vs the previous period, clamping to the data\'s first day', () => {
  // a synthetic signal: 20 days of 50 then 10 days of 60, lower is better (like RHR)
  const start = addDays(NOW, -29);
  const v = Array.from({ length: 30 }, (_, i) => (i < 20 ? 50 : 60));
  v[25] = null; // a missing day is skipped, never 0
  const detail = { asOf: NOW, days: 365, metrics: { rhr: { kind: 'signal', dir: -1, dec: 0, start, v } }, sessions: [] };
  const s = setup({ detail });
  const P = (days) => JSON.parse(JSON.stringify(s.api.periodStats('rhr', NOW, days)));
  const w = P(7);
  assert.deepEqual([w.from, w.to, w.clamped, w.avg, w.n], [addDays(NOW, -6), NOW, false, 60, 6]);
  assert.equal(w.prev, (4 * 50 + 3 * 60) / 7, 'the 7 days before the week');
  assert.ok(Math.abs(w.pct - 100 * (60 - w.prev) / w.prev) < 1e-9);
  assert.equal(w.tone, 'bad', 'higher RHR is worse');
  const m = P(30);
  assert.deepEqual([m.from, m.clamped, m.prev, m.delta], [start, false, null, null], 'the previous month is outside the data: no delta');
  const m6 = P(182);
  assert.deepEqual([m6.from, m6.clamped, m6.n], [start, true, 29], 'six months clamp to the first day');
  s.api.open('rhr');
  s.click(act('range', { 'data-range': '182' }));
  const html = s.host.innerHTML;
  assert.match(html, /data-range="182" aria-pressed="true"/, 'the toggle stays, clamped');
  assert.match(html, new RegExp(`<span class="dt-pill dt-pill-none">Data since ${format(enDate.dayTpl, { weekday: '[A-Z][a-z]{2}', day: '\\d+', month: '[A-Z][a-z]{2}' })}</span>`));
  assert.equal((html.match(/class="dt-pt/g) || []).length, 29, 'the chart starts at the first day');
  s.click(act('range', { 'data-range': '7' }));
  assert.match(s.host.innerHTML, /<span class="dt-trend-lbl">Average<\/span><div class="dt-trend-row"><b class="dt-trend-num">60<\/b><small>bpm<\/small><span class="dt-pill dt-pill-bad">▲ \d+% vs prior week<\/span>/);
});

test('trend view: a daily total skips today (still filling up); recovery deltas are in sd; a tiny change is neutral (•)', () => {
  const start = addDays(NOW, -13);
  const detail = {
    asOf: NOW, days: 365, sessions: [],
    metrics: {
      steps: { kind: 'total', dir: 1, dec: 0, start, v: Array.from({ length: 14 }, (_, i) => (i === 13 ? 100 : 8000)) },
      recovery: { kind: 'recovery', dir: 1, dec: 2, cut: 1.2, cutTrend: 0.5, start, v: Array.from({ length: 14 }, (_, i) => (i < 7 ? 0 : 0.5)), t7: Array(14).fill(null) },
    },
  };
  const s = setup({ detail });
  const st = JSON.parse(JSON.stringify(s.api.periodStats('steps', NOW, 7)));
  assert.deepEqual([st.avg, st.n, st.prev, st.flat, st.tone], [8000, 6, 8000, true, 'normal'], 'today\'s 100 so far is left out');
  s.api.open('steps');
  s.click(act('range', { 'data-range': '7' }));
  assert.match(s.host.innerHTML, /<span class="dt-pill dt-pill-normal">• 0% vs prior week<\/span>/);
  const rec = JSON.parse(JSON.stringify(s.api.periodStats('recovery', NOW, 7)));
  assert.deepEqual([rec.avg, rec.prev, rec.delta, rec.pct, rec.tone], [0.5, 0, 0.5, null, 'good']);
  s.api.open('recovery');
  s.click(act('range', { 'data-range': '7' }));
  assert.match(s.host.innerHTML, /<b class="dt-trend-num">\+0\.5<\/b><small>SD<\/small><span class="dt-pill dt-pill-good">▲ \+0\.5 SD vs prior week<\/span>/);
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

test('energy: a power-meter-corrected day shows the Watch value + the correction, and says so in the header', () => {
  const e = DEMO.metrics.energy;
  const last = addDays(e.start, e.v.length - 1);
  const d = addDays(last, -2);
  const i = dayIndex(e, d);
  const watch = new Array(e.v.length).fill(null);
  watch[i] = e.active[i] - 500;
  watch[e.v.length - 1] = e.active[e.v.length - 1] - 400;
  const detail = { ...DEMO, metrics: { ...DEMO.metrics, energy: { ...e, watch } } };
  const s = setup({ detail, now: addDays(last, 1) });
  s.api.open('energy', d);
  const html = s.host.innerHTML;
  assert.ok(html.includes(format(enT.day.activeWatch, { watch: String(watch[i]) })), 'watch value + correction under Active');
  assert.ok(html.includes(enT.rideNote), 'the ride note');
  // a plain day: the day panel carries no ride copy; the header (newest day corrected) still does
  const plainDay = addDays(last, -5);
  const p = setup({ detail, now: addDays(last, 1) });
  p.api.open('energy', plainDay);
  assert.ok(!p.host.innerHTML.includes(format(enT.day.activeWatch, { watch: String(watch[e.v.length - 1]) })));
  assert.equal((p.host.innerHTML.match(new RegExp(enT.rideNote, 'g')) || []).length, 1, 'only the header (newest day corrected) carries it');
  // uncorrected bake: never mentioned
  const q = setup({ now: addDays(last, 1) });
  q.api.open('energy', d);
  assert.ok(!q.host.innerHTML.includes(enT.rideNote));
});

test('energy: a power-ride day that could not be corrected says so in the day panel', () => {
  const e = DEMO.metrics.energy;
  const last = addDays(e.start, e.v.length - 1);
  const d = addDays(last, -3);
  const uncov = new Array(e.v.length).fill(null);
  uncov[dayIndex(e, d)] = 1;
  const s = setup({ detail: { ...DEMO, metrics: { ...DEMO.metrics, energy: { ...e, uncov } } }, now: addDays(last, 1) });
  s.api.open('energy', d);
  assert.ok(s.host.innerHTML.includes(enT.rideUncovered));
  s.api.open('energy', addDays(last, -6));
  assert.ok(!s.host.innerHTML.includes(enT.rideUncovered));
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

// the dial deep-dive pages (client/deepdive.js): the top of the body, its insight card, its ⓘ block
const topOf = (html) => html.split('<div class="dt-period">')[0];
const insightOf = (html) => (html.split('<div class="dd-insight">')[1] || '').split('</div>')[0];
const infoOf = (html) => (html.split('<div class="dd-info" id="dd-info" hidden>')[1] || '').split('</div><section')[0];
const heroOf = (html) => (html.split('<section class="dd-hero')[1] || '').split('</section>')[0];

test('metric chart: 3 round Y-axis ticks (grid lines + labels), and the Y range leaves room past the outermost point so out-of-range days are never pinned to the edge', () => {
  const s = setup();
  s.api.open('rhr');
  s.click(act('range', { 'data-range': '182' }));
  const html = s.host.innerHTML;
  const grid = [...html.matchAll(/<line class="dt-grid" x1="0" x2="320" y1="([\d.]+)" y2="\1"\/>/g)].map((m) => Number(m[1]));
  assert.equal(grid.length, 3, 'three horizontal grid lines');
  const ticks = [...html.matchAll(/<span style="top:([\d.]+)%">([^<]+)<\/span>/g)];
  assert.match(html, /<div class="dt-plot"><svg class="dt-chart"[^]*<\/svg><div class="dt-yax" aria-hidden="true">/, 'labels overlay the plot');
  assert.equal(ticks.length, 3, 'three labels');
  const vals = ticks.map((t) => Number(t[2]));
  assert.ok(vals.every((v) => Number.isFinite(v)), 'labels are numbers: ' + vals);
  assert.ok(vals[0] > vals[1] && vals[1] > vals[2], 'top to bottom: high → low');
  assert.equal(vals[0] - vals[1], vals[1] - vals[2], 'evenly spaced');
  ticks.forEach((t, i) => assert.ok(Math.abs(Number(t[1]) - (grid[i] / 140) * 100) < 0.2, 'a label sits on its grid line'));
  const cys = [...html.matchAll(/<circle class="dt-pt[^"]*" cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(cys.length > 0);
  assert.ok(Math.min(...cys) >= 14 && Math.max(...cys) <= 140 - 14, `points keep >= 14 units from the edges (${Math.min(...cys)}–${Math.max(...cys)})`);
});

test('ONE sheet header for dial deep-dives and metric details: "‹" back (= close, focus lands there), the metric name centred as the dialog title, ⓘ = the shared SVG icon (dials) or an equal spacer', () => {
  const back = '<button type="button" class="sh-back" data-dt-act="close" aria-label="Back">‹</button>';
  for (const key of ['sleep', 'recovery', 'load-gym']) {
    const s = setup({ dials: DIALS });
    const opener = new StubElement('div', { attrs: { 'data-detail': key } });
    opener.focused = 0;
    opener.focus = () => { opener.focused++; };
    s.click(opener);
    const h = headOf(s.host.innerHTML);
    assert.ok(h.includes('<div class="dt-head sh-head">' + back + `<h2 class="sh-title" id="dt-title">${enT.metrics[key].title}</h2>`), key + ': ' + h.slice(0, 200));
    assert.match(h, /<button type="button" class="sh-info" data-dt-act="info" aria-expanded="false" aria-controls="dd-info" aria-label="How to read this page"><svg viewBox="0 0 24 24" aria-hidden="true">/, 'the ⓘ is the SVG icon, not a serif "i"');
    assert.doesNotMatch(h, /dd-today|dd-back|dd-info-btn|class="dt-close"/, 'the old header is gone');
    assert.equal(s.closeBtn.focused, 1, 'focus moves to the back button');
    assert.ok(s.host.innerHTML.includes('<div class="dd-info" id="dd-info" hidden>'), 'the long notes are collapsed');
    s.click(act('close'));
    assert.equal(s.host.hidden, true, 'back closes the sheet');
    assert.equal(opener.focused, 1, 'focus returns to the dial');
  }
  // a metric detail: the same header (no ⓘ: an equal spacer keeps the title centred), no dial parts
  const s = setup();
  s.api.open('hrv');
  const h = headOf(s.host.innerHTML);
  assert.ok(h.includes('<div class="dt-head sh-head">' + back + `<h2 class="sh-title" id="dt-title">${enT.metrics.hrv.title}</h2><span class="sh-pad" aria-hidden="true"></span></div>`), h.slice(0, 260));
  assert.doesNotMatch(s.host.innerHTML, /dd-head|dd-hero|dd-insight|class="dt-close"/);
});

test('ⓘ toggles the long-notes block in place (no re-render); the CTA jumps to the history chart and focuses its pressed range', () => {
  const info = new StubElement('div', { hidden: true });
  const period = new StubElement('div');
  period.scrolled = 0;
  period.scrollIntoView = () => { period.scrolled++; };
  const pressed = { focused: 0, focus() { this.focused++; } };
  const s = setup({ query: { '#dd-info': info, '.dt-period': period, '.dt-range [aria-pressed="true"]': pressed } });
  s.api.open('recovery');
  const writes = s.hostWrites();
  const btn = act('info', { 'aria-expanded': 'false' });
  s.click(btn);
  assert.equal(info.hidden, false);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  s.click(btn);
  assert.equal(info.hidden, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  s.click(act('trend'));
  assert.equal(period.scrolled, 1);
  assert.equal(pressed.focused, 1);
  assert.equal(s.hostWrites(), writes, 'neither action re-renders the sheet');
  assert.ok(s.host.innerHTML.includes(`<button type="button" class="dd-cta" data-dt-act="trend">${enT.deep.cta}<span aria-hidden="true"> →</span></button>`));
});

test('recovery deep-dive = the dial: the hero ring is last night\'s % with ONE % band colour; the insight says "last night" + band, the SD value and the 7-day trend in its own band colour', () => {
  const s = setup({ dials: DIALS });
  s.api.open('recovery');
  const html = s.host.innerHTML;
  const d = DIALS.recovery;
  assert.equal(d.mode, 'today');
  assert.ok(Number.isInteger(d.pct), 'the demo extract has 90+ prior nights');
  const hero = heroOf(html);
  assert.ok(hero.startsWith(` dd-${d.band}"`), `one state colour for the whole ring (${d.band})`);
  assert.ok(hero.includes(`<b class="dd-num">${d.pct}<small>%</small></b>`), 'same % as the dial');
  assert.equal((hero.match(/class="dd-fill"/g) || []).length, 1, 'one fill path, no zone arcs');
  assert.ok(hero.includes(`d="${d.fill}"`), 'the dial\'s own baked arc');
  assert.ok(hero.includes(`<span class="dd-lbl">${enT.deep.label.recovery}</span>`));
  const ins = insightOf(html);
  assert.ok(ins.includes(format(enT.deep.nightLine, { when: enT.rec.lastNight, band: enT.rec.pctBands[d.band] })));
  const sdLine = format(enT.rec.sdLbl, { value: sgn(d.value, 1), band: '' });
  assert.ok(ins.includes(sdLine.slice(0, sdLine.indexOf(' · '))), 'the night\'s SD value stays in the insight');
  const bandState = { above: 'good', at: 'normal', below: 'bad' };
  const trend = format(enT.rec.trendLine, { dir: enT.rec.dirs[d.trend.dir], value: sgn(d.trend.value, 1) });
  assert.ok(ins.includes(`dd-ln dt-c-${bandState[d.trend.band]}">${trend}`), 'trend line coloured by the TREND band');
  const later = setup({ now: addDays(NOW, 1), dials: DIALS });
  later.api.open('recovery');
  assert.ok(!insightOf(later.host.innerHTML).includes(enT.rec.lastNight), 'a day later the night is dated, like the dial');
  assert.ok(insightOf(later.host.innerHTML).includes('Mon 28 Sep'));
  // the cut rules are long notes: under ⓘ, not in the insight
  const info = infoOf(html);
  assert.ok(info.includes('±1.2') && info.includes('±0.5'), 'day cut and trend cut both stated');
  assert.ok(info.includes(enT.bands.perDayNote));
  assert.ok(info.includes(enT.rec.pctNote), 'ⓘ explains the % mapping');
  assert.ok(html.includes(enT.chartKey.baseline), 'the history chart stays below');
  // fallback: a dial without a % (under 21 prior nights) keeps the SD hero
  const noPct = setup({ dials: { ...DIALS, recovery: { ...d, pct: null, band: 'above', mid: { x: 60, y: 107 } } } });
  noPct.api.open('recovery');
  assert.ok(heroOf(noPct.host.innerHTML).includes(`<b class="dd-num">${sgn(d.value, 1)}<small>SD</small></b>`));
  assert.ok(!infoOf(noPct.host.innerHTML).includes(enT.rec.pctNote));
  // no DIALS: the number still shows, from the same baked headline, with an empty ring
  const bare = setup();
  bare.api.open('recovery');
  assert.ok(heroOf(bare.host.innerHTML).includes(`<b class="dd-num">${sgn(d.value, 1)}<small>SD</small></b>`));
  assert.doesNotMatch(heroOf(bare.host.innerHTML), /dd-fill/);
  clean(html);
});

test('recovery deep-dive: a gated recovery shows the dial\'s word in an empty ring; a stale one is greyed', () => {
  const g = copy();
  g.metrics.recovery.head = null;
  const s = setup({ detail: g, dials: DIALS });
  s.api.open('recovery');
  const hero = heroOf(s.host.innerHTML);
  assert.ok(hero.startsWith(' dd-off dd-off"') || hero.startsWith(' dd-off'), hero.slice(0, 40));
  assert.ok(hero.includes(`<span class="dd-word">${enT.deep.words.gated}</span>`));
  assert.ok(insightOf(s.host.innerHTML).includes(enT.rec.gated));
  const old = setup({ now: addDays(NOW, 9), dials: DIALS });
  old.api.open('recovery');
  assert.match(heroOf(old.host.innerHTML), /^ dd-\w+ dd-stale"/, 'stale data greys the hero like the dial');
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

test('weight: the owner\'s target weight (LAN settings) is a dashed line + a "Target" note; none without the settings API', () => {
  const settings = (ready, kg) => ({ ready: () => ready, targetWeight: () => kg });
  const s = setup({ settings: settings(true, 66.5) });
  s.api.open('weight');
  assert.match(s.host.innerHTML, /<line class="dt-target"/);
  assert.ok(s.host.innerHTML.includes('<span class="dt-k dt-k-target">Target</span>'));
  assert.ok(headOf(s.host.innerHTML).includes(format(enT.bands.target, { value: '66.5', unit: 'kg' })));
  for (const off of [null, settings(false, 66.5), settings(true, null)]) {
    const o = setup({ settings: off });
    o.api.open('weight');
    assert.doesNotMatch(o.host.innerHTML, /dt-target/);
  }
  // only the weight view takes it
  const e = setup({ settings: settings(true, 66.5) });
  e.api.open('energy');
  assert.doesNotMatch(e.host.innerHTML, /dt-target/);
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

test('load deep-dive = the dial: today\'s RE in a strain ring with the typical-day tick, else the dial\'s word; the insight carries today\'s line', () => {
  for (const m of DIALS.load.modalities) assert.equal(DEMO.metrics['load-' + m.key].typical, m.typical, `${m.key}: same typical day as the dial`);
  const s = setup({ dials: DIALS });
  s.api.open('load-gym');
  const gym = DEMO.metrics['load-gym'];
  let hero = heroOf(s.host.innerHTML);
  const t = DIALS.load.tick;
  assert.ok(hero.includes(`<line class="dd-tick" x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}"/>`), 'typical day = the white tick at 6 o\'clock');
  const gd = DIALS.load.modalities.find((m) => m.key === 'gym');
  if (gd.state === 'ok') {
    assert.ok(hero.startsWith(' dd-strain"'));
    assert.ok(hero.includes('<b class="dd-num">28<small>RE</small></b>'));
  } else {
    assert.ok(hero.includes(enT.deep.words.loadGated));
  }
  const gl = DEMO.metrics['load-gym'].gate ? '' : format(enT.load.dayLine, { day: '28', typical: gym.typical.toFixed(0) });
  if (gl) assert.ok(insightOf(s.host.innerHTML).includes(gl));
  s.api.open('load-run');
  const run = DEMO.metrics['load-run'];
  hero = heroOf(s.host.innerHTML);
  assert.ok(hero.includes(`<span class="dd-word">${enT.deep.words.rest}</span>`), 'no session today: the dial\'s word');
  assert.doesNotMatch(hero, /dd-fill/);
  assert.ok(insightOf(s.host.innerHTML).includes(format(enT.load.restLastLine, { date: 'Sat 26 Sep', re: String(run.last.re), typical: run.typical.toFixed(0) })));
  const gated = copy();
  gated.metrics['load-bike'].gate = 'fewDays';
  const g = setup({ detail: gated });
  g.api.open('load-bike');
  assert.ok(insightOf(g.host.innerHTML).includes(enT.load.gated.fewDays));
  assert.ok(heroOf(g.host.innerHTML).includes(enT.deep.words.loadGated));
});

test('load deep-dive keeps the dial\'s former captions: the ring scale + the 7-day vs 42-day trend in the insight, the unscored note under ⓘ', () => {
  const run = DIALS.load.modalities.find((m) => m.key === 'run' && m.state === 'ok') || DIALS.load.modalities.find((m) => m.state === 'ok');
  const s = setup({ dials: DIALS });
  s.api.open('load-' + run.key);
  const ins = insightOf(s.host.innerHTML);
  assert.ok(ins.includes(enT.load.scale), 'the scale explanation that sat under the dial');
  const trend = format(enT.load.trendLbl, { pct: (run.trendPct > 0 ? '+' : '') + run.trendPct + '%' }) + ' · ' + enT.load.bands[run.band];
  assert.ok(ins.includes(trend), `acute/chronic context "${trend}"`);
  const lines = (ins.match(/<p class="dd-ln/g) || []).length;
  assert.ok(lines >= 2 && lines <= 4, `2–4 insight lines, got ${lines}`);
  const d2 = JSON.parse(JSON.stringify(DIALS));
  d2.load.modalities.find((m) => m.key === run.key).unscored = 2;
  const u = setup({ dials: d2 });
  u.api.open('load-' + run.key);
  assert.ok(infoOf(u.host.innerHTML).includes(format(enT.load.unscoredNote, { n: 2 })));
  const es = setup({ dials: DIALS, locale: 'es' });
  es.api.open('load-' + run.key);
  assert.ok(insightOf(es.host.innerHTML).includes(esT.load.scale));
  assert.ok(es.host.innerHTML.includes(`>${esT.deep.cta}<`) && es.host.innerHTML.includes(`id="dt-title">${esT.metrics['load-' + run.key].title}<`));
  const none = setup();
  none.api.open('load-' + run.key);
  assert.ok(!insightOf(none.host.innerHTML).includes(enT.load.bands[run.band]));
  assert.doesNotMatch(none.host.innerHTML, /NaN|undefined/);
});

test('sleep deep-dive: the hero is last night\'s hours in the sleep colour; the insight states the target and last night vs it', () => {
  const s = setup({ dials: DIALS });
  s.api.open('sleep');
  const html = s.host.innerHTML;
  const hero = heroOf(html);
  assert.ok(hero.startsWith(' dd-sleep"'));
  assert.ok(hero.includes(`<b class="dd-num">${DIALS.sleep.hours.toFixed(1)}<small>h</small></b>`));
  assert.ok(hero.includes(`d="${DIALS.sleep.fill}"`));
  const ins = insightOf(html);
  assert.ok(ins.includes(format(enT.bands.target, { value: '7.5', unit: 'h' })), 'Target 7.5 h');
  const v = valueOn(DEMO.metrics.sleep, NOW);
  assert.ok(ins.includes(format(enT.deep.sleepLine, { when: enT.rec.lastNight, value: v.toFixed(1), delta: Number((v - 7.5).toFixed(1)) === 0 ? '0.0' : sgn(v - 7.5, 1), target: '7.5' })));
  assert.ok(infoOf(html).includes(enT.day.stagesNote));
  clean(html);
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

test('Shift+Tab across text fields moves back normally; from the first stop it wraps to the last', () => {
  const s = setup({ views: profileView() });
  s.api.open('profile');
  const mk = () => ({ focused: 0, focus() { this.focused++; } });
  const first = mk(), a = mk(), b = mk(), last = mk();
  s.host.querySelectorAll = () => [first, a, b, last];
  // a Shift+Tab from a middle field, then from the first stop
  const fireKey = (target) => { const ev = { key: 'Tab', shiftKey: true, target, prevented: false, preventDefault() { this.prevented = true; } }; s.ctx.document.activeElement = target; s.keyEvent(ev); return ev; };
  assert.equal(fireKey(b).prevented, false, 'the browser moves focus to the previous field');
  assert.equal(fireKey(first).prevented, true);
  assert.equal(last.focused, 1);
  assert.equal(a.focused + b.focused, 0);
});

test('the Tab trap skips controls the browser cannot focus (disabled, hidden, inside [hidden], a closed <details>, a disabled fieldset)', () => {
  const s = setup({ views: profileView() });
  s.api.open('profile');
  const mk = (o = {}) => ({ focused: 0, focus() { this.focused++; }, closest: () => null, ...o });
  const first = mk(), last = mk();
  const skipped = [mk({ disabled: true }), mk({ hidden: true }), mk({ closest: (sel) => (sel === '[hidden]' ? {} : null) }),
    mk({ closest: (sel) => (sel === 'fieldset[disabled]' ? {} : null) }), mk({ tagName: 'INPUT', closest: (sel) => (sel === 'details' ? { open: false } : null) })];
  s.host.querySelectorAll = () => [first, ...skipped, last];
  s.ctx.document.activeElement = last;
  const ev = s.key('Tab', last);
  assert.equal(ev.prevented, true, 'last REAL stop wraps even with unfocusable ones after it in the list');
  assert.equal(first.focused, 1);
  const hiddenLast = [first, last, ...skipped];
  s.host.querySelectorAll = () => hiddenLast;
  s.ctx.document.activeElement = last;
  assert.equal(s.key('Tab', last).prevented, true, 'trailing unfocusable controls are not treated as stops');
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

/* ---------- with core.js: the open tab lives in the URL hash underneath the sheet ---------- */

test('Back after opening a sheet from a tab closes it and leaves #<tab>; so does the close button', () => {
  const s = setup({ withCore: true, hash: '#nutricion' });
  assert.deepEqual(s.shownTab(), ['nutricion']);
  s.click(new StubElement('div', { attrs: { 'data-detail': 'sleep' } }));
  assert.equal(s.loc.hash, '#detail/sleep');
  s.ctx.history.back(); // the browser Back button
  assert.equal(s.host.hidden, true);
  assert.equal(s.loc.hash, '#nutricion');
  assert.deepEqual(s.shownTab(), ['nutricion'], 'Back never switches the tab underneath');
  s.click(new StubElement('div', { attrs: { 'data-detail': 'steps' } }));
  s.click(act('close'));
  assert.deepEqual(s.calls.at(-1), ['back']);
  assert.equal(s.loc.hash, '#nutricion');
  assert.equal(s.calls.filter((c) => c[0] === 'replace').length, 0, 'the tab entry is never rewritten');
});

test('a page first opened with #detail/<metric> shows its host tab underneath; closing shows #<host tab>', () => {
  const s = setup({ withCore: true, hash: '#detail/sleep' });
  assert.equal(s.host.hidden, false);
  assert.deepEqual(s.shownTab(), ['health']);
  s.key('Escape');
  assert.equal(s.host.hidden, true);
  assert.deepEqual(s.calls.at(-1), ['replace', '/#health']);
  assert.equal(s.loc.hash, '#health');
  const t = setup({ withCore: true, hash: '#detail/load-run' });
  assert.deepEqual(t.shownTab(), ['entreno']);
  t.click(act('close'));
  assert.equal(t.loc.hash, '#entreno');
});

test('a #profile deep link keeps the default tab; closing it names that tab', () => {
  const s = setup({ withCore: true, hash: '#profile', views: profileView() });
  assert.equal(s.host.hidden, false);
  assert.deepEqual(s.shownTab(), ['home']);
  s.key('Escape');
  assert.equal(s.loc.hash, '#home');
});

test('without core.js (no HCNav) a closed deep link clears the hash as before', () => {
  const s = setup({ hash: '#detail/sleep' });
  s.key('Escape');
  assert.equal(s.loc.hash, '');
});

test('history writes that throw: tabs still switch and sheets still open and close (sandboxed frame)', () => {
  const s = setup({ withCore: true, hash: '#home' });
  s.ctx.history.pushState = () => { throw new Error('SecurityError'); };
  s.ctx.history.replaceState = () => { throw new Error('SecurityError'); };
  s.ctx.window.setTab('health');
  assert.deepEqual(s.shownTab(), ['health']);
  s.api.open('hrv');
  assert.equal(s.host.hidden, false);
  s.click(act('close'));
  assert.equal(s.host.hidden, true);
  assert.equal(s.calls.filter((c) => c[0] === 'back').length, 0);
  assert.deepEqual(s.shownTab(), ['health']);
});

test('a deep link that opens no sheet does not leave a stale hash: it becomes the tab hash', () => {
  let s = setup({ withCore: true, hash: '#detail/bogus' });
  assert.equal(s.host.hidden, true);
  assert.equal(s.loc.hash, '#home');
  const noSleep = copy();
  delete noSleep.metrics.sleep;
  s = setup({ withCore: true, hash: '#detail/sleep', detail: noSleep });
  assert.equal(s.host.hidden, true, 'a metric without data opens nothing');
  assert.deepEqual(s.shownTab(), ['health']);
  assert.equal(s.loc.hash, '#health', 'the host tab underneath');
  s = setup({ withCore: true, hash: '#detail/sleep/2026-13-99x' });
  assert.equal(s.loc.hash, '#health');
  s = setup({ withCore: true, hash: '#profile' }); // no profile view on this page
  assert.equal(s.loc.hash, '#home');
  s = setup({ hash: '#detail/nope' }); // without core.js: cleared
  assert.equal(s.loc.hash, '');
});

test('#food-add is left alone: its view registers only after the food API answers', () => {
  const s = setup({ withCore: true, hash: '#food-add' });
  assert.equal(s.host.hidden, true);
  assert.deepEqual(s.shownTab(), ['nutricion']);
  assert.equal(s.loc.hash, '#food-add');
  assert.equal(s.calls.length, 0);
});

test('an opened deep link and a plain tab hash are never rewritten at load', () => {
  let s = setup({ withCore: true, hash: '#detail/rhr' });
  assert.equal(s.host.hidden, false);
  assert.equal(s.loc.hash, '#detail/rhr');
  s = setup({ withCore: true, hash: '#entreno' });
  assert.equal(s.calls.length, 0);
  assert.equal(s.loc.hash, '#entreno');
});

/* ---------- dial deep-dive: contributors (today vs the prior 30 days) + weekly trends ---------- */
const contribOf = (html) => (html.split('<section class="dd-contrib"')[1] || '').split('</section>')[0];
const rowsOf = (html) => [...contribOf(html).matchAll(/data-row="([a-zA-Z]+)"/g)].map((x) => x[1]);
const weeklyOf = (html) => (html.split('<section class="dd-weekly">')[1] || '');

test('contributors compare today with the middle half of the prior 30 days, direction-aware: teal better, orange worse, grey dot typical, neutral grey arrow without a good direction', () => {
  const s = setup();
  const H = s.ctx.window.HCDeep;
  const day = '2026-09-28';
  const series = (today, prior) => (iso) => (iso === day ? today : iso < day && iso >= addDays(day, -30) ? prior[(Date.parse(iso) / 864e5) % prior.length] : null);
  const prior = [50, 52, 54, 56, 58, 60];
  assert.deepEqual(pick(H.compare(series(70, prior), day, 1)), { side: 1, tone: 'better' }, 'HRV up = better');
  assert.deepEqual(pick(H.compare(series(70, prior), day, -1)), { side: 1, tone: 'worse' }, 'resting HR up = worse');
  assert.deepEqual(pick(H.compare(series(40, prior), day, -1)), { side: -1, tone: 'better' }, 'resting HR down = better');
  assert.deepEqual(pick(H.compare(series(55, prior), day, 1)), { side: 0, tone: 'typical' }, 'inside p25–p75 = typical');
  assert.deepEqual(pick(H.compare(series(70, prior), day, 0)), { side: 1, tone: 'neutral' }, 'no good direction = neutral');
  assert.equal(H.compare(series(null, prior), day, 1), null, 'no value today: the row is hidden');
  const sparse = (iso) => (iso === day ? 70 : iso === addDays(day, -1) ? 50 : null);
  assert.deepEqual(pick(H.compare(sparse, day, 1)), { side: null, tone: null }, 'too few prior days: a value without a marker');
  assert.deepEqual(pick(H.compare(series(30, prior), day, 0, (x) => x > 54)), { side: -1, tone: 'neutral' }, 'keep filters the prior days');
});
function pick(c) { return c && { side: c.side, tone: c.tone }; }

test('recovery contributors = the composite\'s inputs on the scored night (HRV, resting HR, sleep), ▲▼ vs prior 30 days with a legend; a missing value hides its row', () => {
  const s = setup({ dials: DIALS });
  s.api.open('recovery');
  const html = s.host.innerHTML;
  assert.deepEqual(rowsOf(html), ['hrv', 'rhr', 'sleep'], 'sleep consistency has no daily series: not shown');
  const night = DEMO.metrics.recovery.head.date;
  const c = contribOf(html);
  assert.ok(c.includes(`<span class="dd-row-lbl">${enT.deep.contrib.rows.hrv}</span><b class="dd-row-val">${valueOn(DEMO.metrics.hrv, night)} ms</b>`));
  assert.ok(c.includes(`<b class="dd-row-val">${valueOn(DEMO.metrics.rhr, night)} bpm</b>`));
  assert.ok(c.includes(`<b class="dd-row-val">${valueOn(DEMO.metrics.sleep, night).toFixed(1)} h</b>`));
  assert.match(c, /class="dd-mk dd-(better|worse|typical)" aria-hidden="true">[▲▼•]<\/span><span class="sr-only">/);
  assert.ok(c.includes(`<b>${enT.deep.contrib.legendToday}</b> ${enT.deep.contrib.legendRest}`), 'legend pill');
  assert.ok(html.indexOf('dd-contrib') > html.indexOf('dd-hero') && html.indexOf('dd-contrib') < html.indexOf('dd-insight'), 'under the hero, above the insight');
  const gap = copy();
  gap.metrics.hrv.v[dayIndex(gap.metrics.hrv, night)] = null;
  const g = setup({ detail: gap, dials: DIALS });
  g.api.open('recovery');
  assert.deepEqual(rowsOf(g.host.innerHTML), ['rhr', 'sleep'], 'no HRV that night: the row is hidden, never 0 or a dash');
  clean(html);
});

test('sleep contributors: hours (▲▼), vs target, bedtime and wake time (neutral arrows, bedtime wraps midnight); load: today\'s RE, 7 vs 42 days, sessions, typical day', () => {
  const s = setup({ dials: DIALS });
  s.api.open('sleep');
  let html = s.host.innerHTML;
  assert.deepEqual(rowsOf(html), ['sleep', 'vsTarget', 'bed', 'wake']);
  const sl = DEMO.metrics.sleep;
  const clockOf = (h) => { h = ((h % 24) + 24) % 24; const H = Math.floor(h), M = Math.round((h - H) * 60); return String(M === 60 ? (H + 1) % 24 : H).padStart(2, '0') + ':' + String(M === 60 ? 0 : M).padStart(2, '0'); };
  assert.ok(contribOf(html).includes(`<b class="dd-row-val">${clockOf(valueOn({ ...sl, v: sl.bed }, NOW))}</b>`), 'bedtime clock');
  const bedRow = (h) => contribOf(h).split('data-row="bed"')[1].split('</li>')[0];
  assert.doesNotMatch(bedRow(html), /dd-better|dd-worse/, 'bedtime has no good direction');
  // a bedtime just after midnight compares as a LATE evening (▲), not as the earliest of the month
  const late = copy();
  late.metrics.sleep.bed[dayIndex(late.metrics.sleep, NOW)] = 0.5;
  const l = setup({ detail: late, dials: DIALS });
  l.api.open('sleep');
  assert.ok(bedRow(l.host.innerHTML).includes('<b class="dd-row-val">00:30</b><span class="dd-mk dd-neutral" aria-hidden="true">▲</span>'));
  s.api.open('load-gym');
  html = s.host.innerHTML;
  const gym = DEMO.metrics['load-gym'];
  const rows = rowsOf(html);
  if (valueOn(gym, NOW) > 0) assert.equal(rows[0], 're', 'trained today: today\'s RE first');
  assert.ok(rows.includes('sessions') && rows.includes('typical'));
  const n = DEMO.sessions.filter((x) => x.m === 'gym' && x.d >= addDays(NOW, -6) && x.d <= NOW).length;
  assert.ok(contribOf(html).includes(`data-row="sessions">`) && contribOf(html).split('data-row="sessions"')[1].includes(`<b class="dd-row-val">${n}</b>`));
  s.api.open('load-run');
  assert.ok(!rowsOf(s.host.innerHTML).includes('re'), 'no session today: no effort row');
  assert.ok(rowsOf(s.host.innerHTML).length <= 4);
});

test('weekly trends: one card per input, 7 bars ending at the view\'s last day (today highlighted), values on top; recovery bars by day state, sleep bars sleep, load bars strain; a missing day has no bar', () => {
  const s = setup({ dials: DIALS });
  s.api.open('recovery');
  let wk = weeklyOf(s.host.innerHTML);
  assert.ok(wk.startsWith(`<h3 class="dd-sec">${enT.deep.weekly.title}</h3>`));
  const cards = wk.split('<section class="dd-wk"').slice(1);
  assert.deepEqual(cards.map((c) => /<h4 class="dd-wk-t">([^<]+)</.exec(c)[1]), ['Recovery', 'HRV', 'Resting HR', 'Sleep']);
  const rec = cards[0];
  assert.equal((rec.match(/<li class="dd-col/g) || []).length, 7);
  assert.equal((rec.match(/dd-col dd-now/g) || []).length, 1, 'today\'s column highlighted');
  const days = s.ctx.window.HCDeep.weekOf(NOW);
  assert.deepEqual([days[0], days[6]], [addDays(NOW, -6), NOW]);
  const m = DEMO.metrics.recovery;
  days.forEach((d) => {
    const v = valueOn(m, d);
    if (v == null) return;
    const st = v >= m.cut ? 'good' : v <= -m.cut ? 'low' : 'mid';
    assert.ok(rec.includes(`<span class="dd-val">${sgn(v, 1)}</span><span class="dd-track-col"><i class="dd-bar dd-c-${st}"`), `${d} ${st}`);
  });
  const missing = days.filter((d) => valueOn(m, d) == null);
  assert.ok(missing.length > 0, 'the demo has a recovery gap this week');
  assert.equal((rec.match(/<span class="dd-val">—<\/span><span class="dd-track-col"><\/span>/g) || []).length, missing.length, 'a missing day: a dash, no bar');
  s.api.open('sleep');
  wk = weeklyOf(s.host.innerHTML);
  assert.match(wk, /dd-bar dd-c-sleep/);
  s.api.open('load-gym');
  wk = weeklyOf(s.host.innerHTML);
  assert.deepEqual([...wk.matchAll(/<h4 class="dd-wk-t">([^<]+)</g)].map((x) => x[1]), ['Gym load', enT.deep.weekly.minutes]);
  assert.match(wk, /dd-bar dd-c-strain/);
  assert.doesNotMatch(wk, /dd-c-(good|mid|low|sleep)/);
  // a later viewer: the window ends at the viewer's today, its days after the data are empty
  const later = setup({ now: addDays(NOW, 2), dials: DIALS });
  later.api.open('sleep');
  const lw = weeklyOf(later.host.innerHTML);
  assert.ok(lw.includes('<li class="dd-col dd-now"><span class="dd-val">—</span>'), 'today, no data yet');
  clean(s.host.innerHTML);
});

test('a run day shows the watch running dynamics the Entreno run row no longer prints (power, GCT, oscillation, stride)', () => {
  const day = DEMO.sessions.find((x) => x.m === 'run');
  const health = { running: { hasData: true, sessions: [{ date: day.d, dist: 8, power: 276, gct: 242, vosc: 8.3, stride: 1.14 }] } };
  const s = setup({ health });
  s.api.open('load-run', day.d);
  const html = s.host.innerHTML;
  const dyn = html.match(/<p class="dt-sub dt-dyn">([^<]*)<\/p>/);
  assert.ok(dyn, 'a dynamics line in the day panel');
  assert.equal(dyn[1], `${enT.day.dyn.label}: 276 W · GCT 242 ms · Osc. 8.3 cm · Stride 1.14 m`);
  assert.ok(html.indexOf('dt-dyn') > html.indexOf('class="dt-sessions"'), 'under the sessions of that day');
  s.api.open('workouts', day.d);
  assert.match(s.host.innerHTML, /dt-dyn/, 'the training-time view of that day too');
  // another day, a gym view, no HEALTH or no dynamics recorded: no line
  s.api.open('load-gym', day.d);
  assert.doesNotMatch(s.host.innerHTML, /dt-dyn/);
  const bare = setup({ health: { running: { hasData: true, sessions: [{ date: day.d, dist: 8, power: null, gct: null, vosc: null, stride: null }] } } });
  bare.api.open('load-run', day.d);
  assert.doesNotMatch(bare.host.innerHTML, /dt-dyn/);
  const none = setup();
  none.api.open('load-run', day.d);
  assert.doesNotMatch(none.host.innerHTML, /dt-dyn/);
  assert.match(esT.day.dyn.label, /carrera/i);
});

test('a dated dial sheet (a run / ride row) opens scrolled to that day\'s panel; an undated one stays at the top', () => {
  const day = DEMO.sessions.find((x) => x.m === 'run');
  const s = setup({ parts: true });
  let scrolled = [];
  s.part.day.scrollIntoView = (o) => scrolled.push(o);
  s.api.open('load-run', day.d);
  assert.equal(scrolled.length, 1, 'scrolled to the day panel');
  assert.equal(scrolled[0].block, 'start');
  assert.equal(s.closeBtn.focused, 1, 'focus still lands on the back button');
  s.api.close();
  scrolled = [];
  s.api.open('load-run');
  assert.equal(scrolled.length, 0, 'the dial itself opens on the hero');
  s.api.close();
  s.api.open('hrv', day.d);
  assert.equal(scrolled.length, 0, 'a plain metric view already shows the day near its top');
});
