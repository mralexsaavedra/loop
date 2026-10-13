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
import { detailFrom } from '../../../lib/detail/detail.mjs';
import { readExtract } from '../../../lib/extract/read.mjs';
import { es as esT, en as enT } from '../i18n/detail-templates.mjs';
import { es as esDate, en as enDate } from '../i18n/date-templates.mjs';
import { loadUtil, DETAIL_SOURCE } from '../../test/client-util.mjs';
import { fmtHours, fmtMinutes, fmtInt } from '../../../lib/format/numbers.mjs';
import { StubElement } from '../../test/dom-stub.mjs';
import { TAB_KEYS, SECTION_TAB, DETAIL_TAB, VIEW_TAB } from '../../../lib/nav/tabs.mjs';
import { buildScoresFrom } from '../../../lib/score/index.mjs';
import { healthFrom } from '../../../lib/health/aggregate.mjs';
import { buildDials } from '../view/dial.mjs';

const format = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));

const here = path.dirname(fileURLToPath(import.meta.url));
// the sheet shell (the Tab trap's selector lives there); the vm runs the whole set, DETAIL_SOURCE
const source = fs.readFileSync(path.join(here, 'detail.js'), 'utf8');
// the dial deep-dive pages (sleep, recovery, load-<m>): inlined right before detail.js on the page
const deepSource = fs.readFileSync(path.join(here, 'deepdive.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(here, 'core.js'), 'utf8');
// the synthetic demo extract, read once (lib/extract/read.mjs) like the page build
const DEMO_INPUTS = readExtract(path.join(here, '..', '..', '..', 'data', 'demo', 'extract'));
const DEMO = detailFrom(DEMO_INPUTS);
const NOW = DEMO.asOf; // the viewer opens the page on the demo's newest data day

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayIndex = (m, iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(m.start + 'T00:00:00Z')) / 86400000);
const valueOn = (m, iso) => { const i = dayIndex(m, iso); return i >= 0 && i < m.v.length ? m.v[i] : null; };

// parts: true = the sheet's sub-parts (calendar, day panel, chart selection) resolve to stub elements,
// so a day tap can update them in place; query = extra host.querySelector answers (sel -> element)
function setup({ locale = 'en', now = NOW, detail = DEMO, hash = '', backAsync = false, parts = false, query = {}, views = null, withCore = false, settings = null, dials = null, health = null, scores = null } = {}) {
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
  if (scores) ctx.SCORES = scores;
  if (health) ctx.HEALTH = health;
  win.location = loc;
  vm.createContext(ctx);
  loadUtil(ctx);
  if (withCore) {
    ctx.NAV = { tabs: [...TAB_KEYS], sectionTab: { ...SECTION_TAB }, detailTab: { ...DETAIL_TAB }, viewTab: { ...VIEW_TAB } };
    vm.runInContext(coreSource, ctx);
  }
  vm.runInContext(deepSource, ctx);
  vm.runInContext(DETAIL_SOURCE, ctx);
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
    change: (target) => fire('doc', 'change', { target }),
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
    // a dial page's visible title is its day; the metric stays the dialog's label (screen readers)
    const dial = ['sleep', 'recovery', 'strain'].includes(key) || key.startsWith('load-');
    assert.ok(html.includes(`id="dt-title"><span class="sr-only">${enT.metrics[key].title} · </span>${dial ? '' : enT.trend.title + '<'}`), `${key} title`);
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
  assert.match(html, /<div class="dt-wdays" aria-hidden="true"><span style="left:[\d.]+%">[A-Z][a-z]{2}<b>\d{1,2}<\/b><\/span>/, 'W: a weekday + day label under each bar');
  assert.equal((html.match(/<span style="left:[\d.]+%">[A-Z][a-z]{2}<b>/g) || []).length, 7, 'seven day labels');
  const m = DEMO.metrics.steps;
  const from = addDays(NOW, -6);
  const bars = (html.match(/class="dt-bar/g) || []).length;
  let expected = 0;
  for (let i = 0; i < 7; i++) { const v = valueOn(m, addDays(from, i)); if (v != null && v > 0) expected++; }
  assert.equal(bars, expected, 'one bar per day with data, none for a missing day');
  let withData = 0;
  for (let i = 0; i < 7; i++) if (valueOn(m, addDays(from, i)) != null) withData++;
  assert.equal((html.match(/class="dt-bv"/g) || []).length, withData, 'W: each day with data carries its value on top');
  s.click(act('range', { 'data-range': '30' }));
  assert.match(s.host.innerHTML, /<div class="dt-ax"><span>[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}<\/span>/, 'M: the from / to date axis (HC.fmtDate)');
  assert.equal((s.host.innerHTML.match(/class="dt-lastv"/g) || []).length, 1, 'M: the newest value is labelled once');
  assert.match(s.host.innerHTML, /<circle class="dt-last" /);
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
  assert.match(s.host.innerHTML, /<span class="dt-trend-lbl">Average<\/span><div class="dt-trend-row"><b class="dt-trend-num">60<\/b><small>bpm<\/small><\/div><div class="dt-trend-pill"><span class="dt-pill dt-pill-bad">▲ \d+% vs prior week<\/span><\/div><p class="dt-trend-txt">Your average Resting HR this week was 60 bpm, higher than the week before \(54 bpm\)\.<\/p>/, 'AVERAGE, the pill below, one sentence');
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
  assert.match(s.host.innerHTML, /<span class="dt-pill dt-pill-flat">• 0% vs prior week<\/span>/);
  const rec = JSON.parse(JSON.stringify(s.api.periodStats('recovery', NOW, 7)));
  assert.deepEqual([rec.avg, rec.prev, rec.delta, rec.pct, rec.tone], [0.5, 0, 0.5, null, 'good']);
  s.api.open('recovery');
  s.click(act('range', { 'data-range': '7' }));
  assert.match(s.host.innerHTML, /<b class="dt-trend-num">\+0\.5<\/b><small>SD<\/small><\/div><div class="dt-trend-pill"><span class="dt-pill dt-pill-good">▲ \+0\.5 SD vs prior week<\/span>/);
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

test('step navigation: the trend sheet\'s window and month arrows are .nav-btn + .chev, disabled at their edges', () => {
  const s = setup();
  s.api.open('sleep');
  const html = s.host.innerHTML;
  const btn = (attrs, glyph) => new RegExp(`<button type="button" class="nav-btn" ${attrs} aria-label="[^"]+"( disabled)?><span class="chev" aria-hidden="true">${glyph}</span></button>`);
  const winNext = html.match(btn('data-dt-act="win" data-wdir="1"', '›'));
  const winPrev = html.match(btn('data-dt-act="win" data-wdir="-1"', '‹'));
  const monNext = html.match(btn('data-dt-act="month" data-dir="1"', '›'));
  const monPrev = html.match(btn('data-dt-act="month" data-dir="-1"', '‹'));
  assert.ok(winNext && winPrev && monNext && monPrev, 'all four arrows are the shared step button');
  assert.equal(winNext[1], ' disabled', 'no window after today');
  assert.equal(monNext[1], ' disabled', 'no month after the current one');
  assert.equal(winPrev[1], undefined, 'earlier windows exist');
  assert.equal(monPrev[1], undefined, 'earlier months exist');
  assert.doesNotMatch(html, /dt-nav|dt-mnav|class="[^"]*circle/, 'no second arrow style in the sheet');
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

test('sleep day detail: asleep hours vs target, bedtime – wake, that night\'s HRV / resting HR / respiratory / wrist temp, its stages + efficiency (else the no-stages note)', () => {
  const s = setup();
  const d = addDays(NOW, -1);
  s.api.open('sleep', d);
  const html = s.host.innerHTML;
  const sl = DEMO.metrics.sleep;
  const i = dayIndex(sl, d);
  const clock = (h) => { h = ((h % 24) + 24) % 24; const H = Math.floor(h); let M = Math.round((h - H) * 60); let HH = H; if (M === 60) { M = 0; HH = (H + 1) % 24; } return String(HH).padStart(2, '0') + ':' + String(M).padStart(2, '0'); };
  assert.ok(html.includes(`<b class="dt-row-val">${fmtHours(sl.v[i])}</b>`), 'hours (h:mm)');
  assert.ok(html.includes(`${clock(sl.bed[i])}–${clock(sl.wake[i])}`), 'bedtime – wake');
  assert.ok(html.includes(String(valueOn(DEMO.metrics.hrv, d))), 'HRV that night');
  assert.ok(html.includes(String(valueOn(DEMO.metrics.rhr, d))), 'resting HR that night');
  const f1 = (k) => fmtHours(valueOn({ ...sl, v: sl[k] }, d));
  assert.ok(html.includes(format(enT.day.stages, { rem: f1('rem'), deep: f1('deep'), core: f1('core'), awake: f1('awake') })), 'that night\'s stages');
  assert.ok(html.includes(`${valueOn({ ...sl, v: sl.eff }, d)}%`), 'efficiency');
  assert.ok(!html.includes(enT.day.stagesNote));
  assert.ok(html.includes('Mon 28 Sep') || html.includes('Sun 27 Sep'), 'the day heading uses HC.fmtDate');
  const old = copy();
  for (const k of ['rem', 'deep', 'core', 'awake', 'inbed', 'eff']) delete old.metrics.sleep[k];
  const o = setup({ detail: old });
  o.api.open('sleep', d);
  assert.ok(o.host.innerHTML.includes(enT.day.stagesNote), 'no stages that night: the note');
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
  assert.ok(html.includes(fmtHours(v)), 'sleep as h:mm');
  assert.match(html, /(lun|dom) 2[78] sept/);
  clean(html);
});

/* ---------- the sheet never contradicts the card it opens from ---------- */
const DEMO_DIR = path.join(here, '..', '..', '..', 'data', 'demo', 'extract');
const DIALS = buildDials(buildScoresFrom(DEMO_INPUTS), healthFrom(DEMO_INPUTS));
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
  assert.match(html, /<div class="dt-plot"><div class="dt-svg"><svg class="dt-chart"[^]*<\/svg>(<div class="dt-labels"[^]*?<\/div>)?<\/div><div class="dt-yax" aria-hidden="true">/, 'labels overlay the plot');
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

test('ONE sheet header for dial deep-dives and metric details: "‹" back (= close, focus lands there), the day (dials) or the metric name centred as the dialog title, ⓘ = the shared SVG icon (dials) or an equal spacer', () => {
  const back = '<button type="button" class="sh-back" data-dt-act="close" aria-label="Back">‹</button>';
  for (const key of ['sleep', 'recovery', 'load-gym']) {
    const s = setup({ dials: DIALS });
    const opener = new StubElement('div', { attrs: { 'data-detail': key } });
    opener.focused = 0;
    opener.focus = () => { opener.focused++; };
    s.click(opener);
    const h = headOf(s.host.innerHTML);
    assert.ok(h.includes('<div class="dt-head sh-head">' + back + `<h2 class="sh-title" id="dt-title"><span class="sr-only">${enT.metrics[key].title} · </span>${enT.deep.today}</h2>`), key + ': ' + h.slice(0, 200));
    assert.match(h, /<button type="button" class="sh-info" data-dt-act="info" aria-expanded="false" aria-controls="dd-info" aria-label="How to read this page"><svg viewBox="0 0 24 24" aria-hidden="true">/, 'the ⓘ is the SVG icon, not a serif "i"');
    assert.doesNotMatch(h, /dd-today|dd-back|dd-info-btn|class="dt-close"/, 'the old header is gone');
    assert.equal(s.closeBtn.focused, 1, 'focus moves to the back button');
    assert.ok(s.host.innerHTML.includes('<div class="dd-info" id="dd-info" hidden>'), 'the long notes are collapsed');
    s.click(act('close'));
    assert.equal(s.host.hidden, true, 'back closes the sheet');
    assert.equal(opener.focused, 1, 'focus returns to the dial');
  }
  // stale data (the view ends at the data's last day): that day's date, not "Today"; Spanish "Hoy"
  const late = setup({ now: addDays(NOW, 5), dials: DIALS });
  late.api.open('recovery');
  assert.doesNotMatch(headOf(late.host.innerHTML), new RegExp(`</span>${enT.deep.today}</h2>`));
  assert.match(headOf(late.host.innerHTML), /<\/span>[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}<\/h2>/);
  const es = setup({ locale: 'es', dials: DIALS });
  es.api.open('sleep');
  assert.ok(headOf(es.host.innerHTML).includes(`<span class="sr-only">${esT.metrics.sleep.title} · </span>${esT.deep.today}</h2>`));
  // a metric detail = the trend view: the same header titled "Trend view", its ⓘ holding the latest value + band words (collapsed), no dial parts
  const s = setup();
  s.api.open('hrv');
  const h = headOf(s.host.innerHTML);
  assert.ok(h.includes('<div class="dt-head sh-head">' + back + `<h2 class="sh-title" id="dt-title"><span class="sr-only">${enT.metrics.hrv.title} · </span>${enT.trend.title}</h2><button type="button" class="sh-info" data-dt-act="info" aria-expanded="false" aria-controls="dd-info"`), h.slice(0, 260));
  assert.match(h, /<div class="dd-info dt-info" id="dd-info" hidden><div class="dt-titles"><div class="dt-latest"><b class="dt-num /, 'the latest value moved under ⓘ');
  assert.doesNotMatch(s.host.innerHTML.split('<div class="dt-body">')[1], /class="dt-num /, 'no big current number in the view itself');
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
  assert.ok(s.host.innerHTML.includes(`<button type="button" class="cta" data-dt-act="trend">${enT.deep.ctas.recovery}<span aria-hidden="true"> →</span></button>`));
});

test('recovery deep-dive: the insight card leads with Inicio\'s outlook sentence (window.HCAdvice), the full text behind the one-line bar; nothing without one', () => {
  const s = setup({ dials: DIALS });
  s.ctx.window.HCAdvice = () => 'Over the last 7 days recovery has stayed at baseline.';
  s.api.open('recovery');
  const W = enT.deep.prose;
  const ins = insightOf(s.host.innerHTML);
  assert.ok(ins.startsWith('<p class="dd-ln">Over the last 7 days recovery has stayed at baseline. '), 'one paragraph, the advice first');
  assert.ok(ins.includes(format(W.rec, { when: W.lastNight, band: W.recBands[DIALS.recovery.band] })), 'then last night in words');
  assert.ok(!ins.includes(' it has been '), 'the advice already carries the 7-day trend');
  assert.equal((ins.match(/<p class="dd-ln/g) || []).length, 1);
  const none = setup({ dials: DIALS });
  none.ctx.window.HCAdvice = () => '';
  none.api.open('recovery');
  assert.ok(insightOf(none.host.innerHTML).startsWith('<p class="dd-ln">' + format(W.rec, { when: W.lastNight, band: W.recBands[DIALS.recovery.band] })));
});

test('recovery deep-dive = the dial: the hero ring is last night\'s % with ONE % band colour; the insight says "last night" + the % band and the 7-day trend in its own band colour; the SD value is under ⓘ', () => {
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
  const W = enT.deep.prose;
  assert.ok(ins.includes(format(W.rec, { when: W.lastNight, band: W.recBands[d.band] })), 'last night in words, the % band');
  const sdLine = format(enT.rec.sdLbl, { value: sgn(d.value, 1), band: '' });
  const sdHead = sdLine.slice(0, sdLine.indexOf(' · '));
  assert.ok(!ins.includes(sdHead), 'the insight carries ONE band (the %): the SD line is not there');
  assert.ok(infoOf(html).includes(sdHead), 'the night\'s SD value moved under ⓘ (still reachable)');
  const trend = format(W.recTrend, { dir: W.dirs[d.trend.dir], value: sgn(d.trend.value, 1) + ' ' + enT.metrics.recovery.unit });
  assert.ok(ins.includes(trend), 'the 7-day trend in words (no advice sentence)');
  assert.equal((ins.match(/<p class="dd-ln/g) || []).length, 1, 'one paragraph of prose');
  const later = setup({ now: addDays(NOW, 1), dials: DIALS });
  later.api.open('recovery');
  assert.ok(!insightOf(later.host.innerHTML).includes(enT.deep.prose.lastNight), 'a day later the night is dated, like the dial');
  assert.ok(insightOf(later.host.innerHTML).includes(format(W.on, { date: 'Mon 28 Sep' })));
  // the cut rules are long notes: under ⓘ, not in the insight
  const info = infoOf(html);
  assert.ok(info.includes('±1.2') && info.includes('±0.5'), 'day cut and trend cut both stated');
  assert.ok(info.includes(enT.bands.perDayNote));
  assert.ok(info.includes(enT.rec.pctNote), 'ⓘ explains the % mapping');
  assert.ok(html.includes(`<span class="dt-typ">${enT.trend.baseline}</span>`), 'the history chart stays below, its band named top-right');
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

test('carried values (HC.carried): a recovery or sleep night from an earlier day titles its deep-dive with that night\'s date (weekday kept), names it in the legend and dims the hero (not the stale grey); the night of today is "Today", normal', () => {
  for (const key of ['recovery', 'sleep']) {
    const night = key === 'recovery' ? DEMO.metrics.recovery.head.date : DIALS.sleep.date;
    const s = setup({ now: addDays(night, 2), dials: DIALS });
    s.api.open(key);
    const h = headOf(s.host.innerHTML);
    assert.doesNotMatch(h, new RegExp(`</span>${enT.deep.today}</h2>`), key);
    const d = new Date(night + 'T00:00:00Z');
    const want = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ';
    assert.match(h, new RegExp(`</span>${want}[A-Z][a-z]{2,3}</h2>`), key + ': ' + h.slice(-80));
    assert.match(heroOf(s.host.innerHTML), /^ dd-\w+ carried"/, key + ': the hero is dimmed (carried)');
    assert.doesNotMatch(heroOf(s.host.innerHTML), /dd-stale/, key + ': dimmed, not greyed');
    assert.match(s.host.innerHTML, new RegExp(`<p class="dd-legend">.*?<b>${want}[A-Z][a-z]{2,3}</b> ${enT.deep.contrib.legendRest}`), key + ': the legend names the night too');
    // the night is today's: "Today", not dimmed
    const fresh = setup({ now: night, dials: DIALS });
    fresh.api.open(key);
    assert.ok(headOf(fresh.host.innerHTML).includes(`</span>${enT.deep.today}</h2>`), key + ' today');
    assert.doesNotMatch(heroOf(fresh.host.innerHTML), /carried|dd-stale/, key + ' today');
  }
});

test('carried values: the load deep-dive never carries (its hero reads the viewer\'s day only: the day\'s RE, else rest / no session)', () => {
  const s = setup({ now: addDays(DEMO.asOf, 2), dials: DIALS });
  const key = Object.keys(DEMO.metrics).find((k) => /^load-/.test(k));
  s.api.open(key);
  assert.ok(headOf(s.host.innerHTML).includes(`</span>${enT.deep.today}</h2>`));
  assert.doesNotMatch(heroOf(s.host.innerHTML), /carried/);
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

test('weight: the user\'s target weight (LAN settings) is a dashed line + a "Target" note; none without the settings API', () => {
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
  assert.ok(h.includes(`>${fmtInt(e.roll[e.roll.length - 2], 'en')}<`), 'yesterday\'s rolling value, not the partial day');
  assert.ok(h.includes(format(enT.latestDaySoFar, { value: fmtInt(e.v[e.v.length - 1], 'en'), unit: 'kcal' })));
  const later = setup({ now: addDays(NOW, 1) });
  later.api.open('energy');
  h = headOf(later.host.innerHTML);
  assert.ok(h.includes(`>${fmtInt(e.roll[e.roll.length - 1], 'en')}<`), 'the newest day is complete once the viewer\'s day moved on');
  assert.ok(h.includes(format(enT.latestDay, { value: fmtInt(e.v[e.v.length - 1], 'en'), unit: 'kcal', date: 'Mon 28 Sep' })));
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

test('load deep-dive: the gym / run / bike pills (moved from under Inicio\'s dials) — the page\'s modality pressed, each opens its page and, with score.js loaded, sets Inicio\'s load dial (scMod)', () => {
  const s = setup({ dials: DIALS });
  s.api.open('load-run');
  const html = s.host.innerHTML;
  const mods = ['gym', 'run', 'bike'].filter((k) => DEMO.metrics['load-' + k]);
  assert.ok(mods.length >= 2, 'the demo has several load series');
  const sw = (html.match(/<div class="dial-switch" role="group" aria-label="Load modality">[\s\S]*?<\/div>/) || [''])[0];
  assert.deepEqual([...sw.matchAll(/data-detail="load-([a-z]+)"/g)].map((m) => m[1]), mods);
  assert.match(sw, /<button type="button" class="chip dial-mod" data-detail="load-run" aria-pressed="true">Run<\/button>/);
  assert.equal((sw.match(/aria-pressed="true"/g) || []).length, 1);
  assert.doesNotMatch(sw, /onclick/, 'no scMod on the page: plain links');
  assert.ok(html.indexOf('dial-switch') > html.indexOf('dd-hero') && html.indexOf('dial-switch') < html.indexOf('dd-insight'), 'between the contributors and the insight card');
  // with score.js's scMod present, a pill also switches Inicio's dial
  const t = setup({ dials: DIALS });
  t.ctx.scMod = () => {};
  t.api.open('load-gym');
  assert.match(t.host.innerHTML, /data-detail="load-bike" aria-pressed="false" onclick="scMod\('bike'\)">Bike<\/button>/);
  // other dial pages: no pills
  const r = setup({ dials: DIALS });
  r.api.open('recovery');
  assert.doesNotMatch(r.host.innerHTML, /dial-switch/);
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
  const gl = DEMO.metrics['load-gym'].gate ? '' : format(enT.deep.prose.loadDay, { day: '28', typical: gym.typical.toFixed(0) });
  if (gl) assert.ok(insightOf(s.host.innerHTML).includes(gl));
  s.api.open('load-run');
  const run = DEMO.metrics['load-run'];
  hero = heroOf(s.host.innerHTML);
  assert.ok(hero.includes(`<span class="dd-word">${enT.deep.words.rest}</span>`), 'no session today: the dial\'s word');
  assert.doesNotMatch(hero, /dd-fill/);
  assert.ok(insightOf(s.host.innerHTML).includes(format(enT.deep.prose.loadRestLast, { date: 'Sat 26 Sep', re: String(run.last.re), typical: run.typical.toFixed(0) })));
  const gated = copy();
  gated.metrics['load-bike'].gate = 'fewDays';
  const g = setup({ detail: gated });
  g.api.open('load-bike');
  assert.ok(insightOf(g.host.innerHTML).includes(enT.load.gated.fewDays));
  assert.ok(heroOf(g.host.innerHTML).includes(enT.deep.words.loadGated));
});

test('load deep-dive: the day and the 7-day vs 42-day trend as prose in the insight; the ring scale and the unscored note under ⓘ', () => {
  const run = DIALS.load.modalities.find((m) => m.key === 'run' && m.state === 'ok') || DIALS.load.modalities.find((m) => m.state === 'ok');
  const s = setup({ dials: DIALS });
  s.api.open('load-' + run.key);
  const ins = insightOf(s.host.innerHTML);
  assert.ok(!ins.includes(enT.load.scale) && infoOf(s.host.innerHTML).includes(enT.load.scale), 'the scale explanation moved under ⓘ');
  const trend = format(enT.deep.prose.loadTrend, { band: enT.load.bands[run.band], pct: (run.trendPct > 0 ? '+' : '') + run.trendPct + '%' });
  assert.ok(ins.includes(trend), `acute/chronic context "${trend}"`);
  assert.equal((ins.match(/<p class="dd-ln/g) || []).length, 1, 'one paragraph');
  const sentences = ins.replace(/<[^>]+>/g, '').split('VIEW')[0].split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length;
  assert.ok(sentences >= 2 && sentences <= 3, `2–3 sentences, got ${sentences}`);
  assert.ok(s.host.innerHTML.includes(`>${enT.deep.ctas.load}<`), 'the page\'s own CTA');
  const d2 = JSON.parse(JSON.stringify(DIALS));
  d2.load.modalities.find((m) => m.key === run.key).unscored = 2;
  const u = setup({ dials: d2 });
  u.api.open('load-' + run.key);
  assert.ok(infoOf(u.host.innerHTML).includes(format(enT.load.unscoredNote, { n: 2 })));
  const es = setup({ dials: DIALS, locale: 'es' });
  es.api.open('load-' + run.key);
  assert.ok(infoOf(es.host.innerHTML).includes(esT.load.scale));
  assert.ok(es.host.innerHTML.includes(`>${esT.deep.ctas.load}<`) && es.host.innerHTML.includes(`<span class="sr-only">${esT.metrics['load-' + run.key].title} · </span>${esT.deep.today}<`));
  const none = setup();
  none.api.open('load-' + run.key);
  assert.ok(!insightOf(none.host.innerHTML).includes(enT.load.bands[run.band]));
  assert.doesNotMatch(none.host.innerHTML, /NaN|undefined/);
});

test('sleep deep-dive: the hero is last night\'s sleep performance % in the sleep colour; a stages bar under it; ⓘ explains every formula; the insight states the target and last night vs it', () => {
  const s = setup({ dials: DIALS });
  s.api.open('sleep');
  const html = s.host.innerHTML;
  const hero = heroOf(html);
  assert.ok(hero.startsWith(' dd-sleep"'));
  assert.ok(Number.isInteger(DIALS.sleep.pct));
  assert.ok(hero.includes(`<b class="dd-num">${DIALS.sleep.pct}<small>%</small></b>`), 'same % as the dial');
  assert.ok(hero.includes(`<span class="dd-lbl">${enT.deep.label.sleepPerf}</span>`));
  assert.ok(hero.includes(`d="${DIALS.sleep.fill}"`));
  const ins = insightOf(html);
  const v = valueOn(DEMO.metrics.sleep, NOW);
  assert.ok(ins.includes(format(enT.deep.prose.sleep, { when: enT.deep.prose.lastNight, value: fmtHours(v), delta: fmtHours(v - 7.5, true), target: '7:30' })));
  assert.ok(ins.includes(enT.deep.prose.allOk) || /(was|were) worse than your usual\./.test(ins), 'the contributors in one sentence');
  assert.ok(ins.includes(`>${enT.deep.ctas.sleep}<`));
  const info = infoOf(html);
  assert.ok(info.includes(format(enT.deep.sleepNotes.perf, { target: '7:30' })), 'ⓘ: performance formula, need = target');
  for (const k of ['eff', 'cons', 'stages']) assert.ok(info.includes(enT.deep.sleepNotes[k]), `ⓘ: ${k}`);
  // stages bar: awake / REM / core / deep, widths by hours, legend with hours and % of asleep
  const sl = DEMO.metrics.sleep;
  const st = html.split('<section class="dd-stages"')[1].split('</section>')[0];
  assert.ok(html.indexOf('dd-contrib') > html.indexOf('dd-hero') && html.indexOf('dd-stages') > html.indexOf('dd-insight') && html.indexOf('dd-stages') < html.indexOf('dd-weekly'), 'dial -> contributors -> insight, then the stages bar');
  assert.ok(st.startsWith(`><h3 class="dd-sec">${enT.deep.stages.aria}</h3>`), 'a titled section');
  assert.deepEqual([...st.matchAll(/<i class="dd-st dd-st-([a-z]+)"/g)].map((x) => x[1]), ['awake', 'rem', 'core', 'deep']);
  const rem = valueOn({ ...sl, v: sl.rem }, NOW);
  assert.ok(st.includes(`${enT.deep.stages.rem} <b>${fmtHours(rem)} · ${Math.round((100 * rem) / v)}%</b>`));
  // no DIALS: the hours hero; no stage arrays: no bar
  const bare = setup({ detail: (() => { const c = copy(); for (const k of ['rem', 'deep', 'core', 'awake', 'inbed', 'eff']) delete c.metrics.sleep[k]; return c; })() });
  bare.api.open('sleep');
  assert.ok(heroOf(bare.host.innerHTML).includes(`<b class="dd-num">${fmtHours(v)}</b>`));
  assert.doesNotMatch(bare.host.innerHTML, /dd-stages/);
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

test('a registered view may return `info`: the header gets the shared ⓘ and the block sits collapsed under it; none = no ⓘ', () => {
  const s = setup({ views: profileView({ render: () => ({ head: '', body: '<p class="pf-body">B</p>', info: '<p class="pf-why">W</p>' }) }) });
  s.click(new StubElement('button', { attrs: { 'data-detail': 'profile', 'aria-haspopup': 'dialog' } }));
  const html = s.host.innerHTML;
  assert.match(html, /<button type="button" class="sh-info" data-dt-act="info" aria-expanded="false" aria-controls="dd-info"/);
  assert.ok(html.includes('<div class="dd-info dt-info" id="dd-info" hidden><p class="pf-why">W</p></div>'));
  const plain = setup({ views: profileView() });
  plain.click(new StubElement('button', { attrs: { 'data-detail': 'profile', 'aria-haspopup': 'dialog' } }));
  assert.doesNotMatch(plain.host.innerHTML, /sh-info|dd-info/);
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

test('recovery contributors on the scored night, as the reference: HRV, resting HR, respiratory rate, sleep performance %; ▲▼ vs prior 30 days with a legend; a missing value hides its row', () => {
  const s = setup({ dials: DIALS });
  s.api.open('recovery');
  const html = s.host.innerHTML;
  assert.deepEqual(rowsOf(html), ['hrv', 'rhr', 'resp', 'perf'], 'four rows, in the reference order');
  const night = DEMO.metrics.recovery.head.date;
  const c = contribOf(html);
  assert.ok(c.includes(`<span class="dd-row-lbl">${enT.deep.contrib.rows.hrv}</span><b class="dd-row-val">${valueOn(DEMO.metrics.hrv, night)} ms</b>`));
  assert.ok(c.includes(`<b class="dd-row-val">${valueOn(DEMO.metrics.rhr, night)} bpm</b>`));
  assert.ok(c.includes(`<span class="dd-row-lbl">${enT.deep.contrib.rows.resp}</span><b class="dd-row-val">${valueOn(DEMO.metrics.respiratory, night).toFixed(1)} brpm</b>`), 'respiratory rate that night');
  const sl = DEMO.metrics.sleep;
  assert.ok(c.includes(`<span class="dd-row-lbl">${enT.deep.contrib.rows.perf}</span><b class="dd-row-val">${valueOn({ ...sl, v: sl.perf }, night)}%</b>`), 'sleep performance % replaces hours of sleep');
  assert.match(c, /class="dd-mk dd-(better|worse|typical)" aria-hidden="true">[▲▼•]<\/span><span class="sr-only">/);
  assert.ok(c.includes(`<b>${enT.deep.contrib.legendToday}</b> ${enT.deep.contrib.legendRest}`), 'legend pill');
  assert.ok(html.indexOf('dd-contrib') > html.indexOf('dd-hero') && html.indexOf('dd-contrib') < html.indexOf('dd-insight'), 'under the hero, above the insight');
  assert.ok(infoOf(html).includes(enT.deep.respNote), 'ⓘ: respiratory rate is context, not part of the composite');
  const gap = copy();
  gap.metrics.hrv.v[dayIndex(gap.metrics.hrv, night)] = null;
  const g = setup({ detail: gap, dials: DIALS });
  g.api.open('recovery');
  assert.deepEqual(rowsOf(g.host.innerHTML), ['rhr', 'resp', 'perf'], 'no HRV that night: the row is hidden, never 0 or a dash');
  const noResp = copy();
  noResp.metrics.respiratory.v[dayIndex(noResp.metrics.respiratory, night)] = null;
  const r = setup({ detail: noResp, dials: DIALS });
  r.api.open('recovery');
  assert.deepEqual(rowsOf(r.host.innerHTML), ['hrv', 'rhr', 'perf'], 'no respiratory rate that night: 3 rows');
  const noPerf = copy();
  delete noPerf.metrics.sleep.perf;
  const p = setup({ detail: noPerf, dials: DIALS });
  p.api.open('recovery');
  assert.deepEqual(rowsOf(p.host.innerHTML), ['hrv', 'rhr', 'resp'], 'no baked performance: the row is hidden');
  clean(html);
});

test('recovery respiratory row: no good direction — a neutral ▲ / ▼ outside the prior 30 days\' middle half, a grey dot inside', () => {
  const night = DEMO.metrics.recovery.head.date;
  const rowOf = (h) => contribOf(h).split('data-row="resp"')[1].split('</li>')[0];
  const at = (v) => {
    const d = copy();
    const m = d.metrics.respiratory;
    for (let k = 1; k <= 30; k++) { const i = dayIndex(m, addDays(night, -k)); if (i >= 0) m.v[i] = 14 + (k % 5) * 0.2; }
    m.v[dayIndex(m, night)] = v;
    const s = setup({ detail: d, dials: DIALS });
    s.api.open('recovery');
    return rowOf(s.host.innerHTML);
  };
  assert.ok(at(17).includes('<span class="dd-mk dd-neutral" aria-hidden="true">▲</span>'), 'above usual: neutral up arrow');
  assert.ok(at(12).includes('<span class="dd-mk dd-neutral" aria-hidden="true">▼</span>'), 'below usual: neutral down arrow');
  assert.ok(at(14.4).includes('<span class="dd-mk dd-typical" aria-hidden="true">•</span>'), 'inside the usual range: grey dot');
});

test('sleep contributors: hours vs need, efficiency, consistency, REM + deep; bedtime and wake time fill in without them (neutral arrows, bedtime wraps midnight); load: today\'s RE, 7 vs 42 days, sessions, typical day', () => {
  const s = setup({ dials: DIALS });
  s.api.open('sleep');
  let html = s.host.innerHTML;
  assert.deepEqual(rowsOf(html), ['need', 'eff', 'cons', 'restor'], 'hours vs need, efficiency, consistency, REM + deep');
  const sl = DEMO.metrics.sleep;
  const hv = valueOn(sl, NOW);
  assert.ok(contribOf(html).includes(`<b class="dd-row-val">${fmtHours(hv)} / 7:30</b>`), 'hours vs need');
  assert.ok(contribOf(html).includes(`<b class="dd-row-val">${valueOn({ ...sl, v: sl.eff }, NOW)}%</b>`), 'efficiency');
  assert.ok(contribOf(html).includes(`<b class="dd-row-val">${valueOn({ ...sl, v: sl.cons }, NOW)} min</b>`), 'consistency in minutes');
  // an extract without stages / efficiency / consistency: bedtime and wake time fill in
  const old = copy();
  for (const k of ['rem', 'deep', 'core', 'awake', 'inbed', 'eff', 'cons']) delete old.metrics.sleep[k];
  const o = setup({ detail: old, dials: DIALS });
  o.api.open('sleep');
  assert.deepEqual(rowsOf(o.host.innerHTML), ['need', 'bed', 'wake']);
  const clockOf = (h) => { h = ((h % 24) + 24) % 24; const H = Math.floor(h), M = Math.round((h - H) * 60); return String(M === 60 ? (H + 1) % 24 : H).padStart(2, '0') + ':' + String(M === 60 ? 0 : M).padStart(2, '0'); };
  assert.ok(contribOf(o.host.innerHTML).includes(`<b class="dd-row-val">${clockOf(valueOn({ ...sl, v: sl.bed }, NOW))}</b>`), 'bedtime clock');
  const bedRow = (h) => contribOf(h).split('data-row="bed"')[1].split('</li>')[0];
  assert.doesNotMatch(bedRow(o.host.innerHTML), /dd-better|dd-worse/, 'bedtime has no good direction');
  // a bedtime just after midnight compares as a LATE evening (▲), not as the earliest of the month
  const late = copy();
  late.metrics.sleep.bed[dayIndex(late.metrics.sleep, NOW)] = 0.5;
  for (const k of ['eff', 'cons', 'rem']) delete late.metrics.sleep[k];
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

test('weekly trends: one card per input, 7 bars ending at the page\'s day (highlighted, with its value), values on top; recovery = each night\'s % in its band colour, sleep bars sleep, load bars strain; a missing day has no bar', () => {
  const s = setup({ dials: DIALS });
  s.api.open('recovery');
  let wk = weeklyOf(s.host.innerHTML);
  assert.ok(wk.startsWith(`<h3 class="dd-sec">${enT.deep.weekly.title}</h3>`));
  const cards = wk.split('<section class="dd-wk"').slice(1);
  assert.deepEqual(cards.map((c) => /<h4 class="dd-wk-t">([^<]+)</.exec(c)[1]), ['Recovery', 'HRV', 'Resting HR', 'Sleep']);
  const rec = cards[0];
  assert.equal((rec.match(/<li class="dd-col/g) || []).length, 7);
  assert.equal((rec.match(/dd-col dd-now/g) || []).length, 1, 'the page\'s day highlighted');
  const days = s.ctx.window.HCDeep.weekOf(NOW);
  assert.deepEqual([days[0], days[6]], [addDays(NOW, -6), NOW]);
  // the % the dial showed each morning (DIALS.days), coloured >= 67 good / <= 33 low / else mid, never SD
  const pctOn = (d) => { const x = DIALS.days.find((e) => e.date === d); return x && x.recovery.state === 'ok' && x.recovery.date === d ? x.recovery.pct : null; };
  let shown = 0;
  days.forEach((d) => {
    const v = pctOn(d);
    if (v == null) return;
    shown++;
    const st = v >= 67 ? 'good' : v <= 33 ? 'low' : 'mid';
    assert.ok(rec.includes(`<span class="dd-val dd-v-${st}">${v}%</span><span class="dd-track-col"><i class="dd-bar dd-c-${st}" style="height:${v}%"`), `${d} ${v}% ${st}`);
  });
  assert.ok(shown >= 4, 'most nights of the demo week have a %');
  assert.doesNotMatch(rec, /SD|\+\d\.\d</, 'no z-scores');
  assert.ok(rec.includes(`<li class="dd-col dd-now"><span class="dd-val dd-v-${DIALS.recovery.band}">${DIALS.recovery.pct}%</span>`), 'the headline night = the last, highlighted column, with its value');
  const missing = days.filter((d) => pctOn(d) == null);
  assert.ok(missing.length > 0, 'the demo has a recovery gap this week');
  assert.equal((rec.match(/<span class="dd-val">—<\/span><span class="dd-track-col"><\/span>/g) || []).length, missing.length, 'a night without a %: a dash, no bar');
  // a day later (no data yet today): the week still ends on the headline night, so no empty highlighted column
  const later = setup({ now: addDays(NOW, 1), dials: DIALS });
  later.api.open('recovery');
  const lrec = weeklyOf(later.host.innerHTML).split('<section class="dd-wk"')[1];
  assert.ok(lrec.includes(`<li class="dd-col dd-now"><span class="dd-val dd-v-${DIALS.recovery.band}">${DIALS.recovery.pct}%</span>`));
  // no DIALS: the SD composite by its day band (the documented fallback)
  const bare = setup();
  bare.api.open('recovery');
  const m = DEMO.metrics.recovery;
  const brec = weeklyOf(bare.host.innerHTML).split('<section class="dd-wk"')[1];
  days.forEach((d) => {
    const v = valueOn(m, d);
    if (v == null) return;
    const st = v >= m.cut ? 'good' : v <= -m.cut ? 'low' : 'mid';
    assert.ok(brec.includes(`<span class="dd-val">${sgn(v, 1)}</span><span class="dd-track-col"><i class="dd-bar dd-c-${st}"`), `${d} ${st}`);
  });
  s.api.open('sleep');
  wk = weeklyOf(s.host.innerHTML);
  assert.match(wk, /dd-bar dd-c-sleep/);
  assert.deepEqual([...wk.matchAll(/<h4 class="dd-wk-t">([^<]+)</g)].map((x) => x[1]), ['Sleep', enT.deep.weekly.perf, enT.deep.weekly.restor]);
  s.api.open('load-gym');
  wk = weeklyOf(s.host.innerHTML);
  assert.deepEqual([...wk.matchAll(/<h4 class="dd-wk-t">([^<]+)</g)].map((x) => x[1]), ['Gym load', enT.deep.weekly.minutes]);
  assert.match(wk, /dd-bar dd-c-strain/);
  assert.doesNotMatch(wk, /dd-c-(good|mid|low|sleep)/);
  // a later viewer: sleep ends on the dial's night (within the week); load ends at the viewer's today,
  // its days after the data are empty
  const later2 = setup({ now: addDays(NOW, 2), dials: DIALS });
  later2.api.open('sleep');
  assert.ok(weeklyOf(later2.host.innerHTML).includes(`<li class="dd-col dd-now"><span class="dd-val">${fmtHours(valueOn(DEMO.metrics.sleep, DIALS.sleep.date))}</span>`), 'the dial\'s night, highlighted');
  later2.api.open('load-gym');
  assert.ok(weeklyOf(later2.host.innerHTML).includes('<li class="dd-col dd-now"><span class="dd-val">—</span>'), 'today, no data yet');
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

test('a session with HR zones shows ZONE 5…0 rows (bar, %, duration, bpm range), avg / max HR and the max-HR note; hidden without zones', () => {
  const day = DEMO.sessions.find((x) => x.m === 'run');
  const sessions = DEMO.sessions.map((x) => (x === day ? { ...x, hr: 150, hx: 178, z: [60, 0, 600, 1200, 900, 240] } : (({ z, hx, ...rest }) => rest)(x)));
  const detail = { ...DEMO, zoneMax: { hr: 190, src: 'observed' }, sessions };
  const s = setup({ detail });
  s.api.open('load-run', day.d);
  const html = s.host.innerHTML;
  const block = html.match(/<div class="dt-zones"[\s\S]*?<\/ol>/);
  assert.ok(block, 'a zones block in the session');
  const rows = [...block[0].matchAll(/<li class="dt-zone dt-z(\d)">([\s\S]*?)<\/li>/g)];
  assert.deepEqual(rows.map((r) => r[1]), ['5', '4', '3', '2', '1', '0'], 'ZONE 5 first, down to 0');
  const text = (r) => r[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(text(rows[0]), 'Zone 5 171+ bpm 8% 4:00'); // 240 of 3000 s
  assert.equal(text(rows[2]), 'Zone 3 133–151 bpm 40% 20:00');
  assert.equal(text(rows[4]), 'Zone 1 95–113 bpm 0% 0:00');
  assert.equal(text(rows[5]), 'Zone 0 &lt; 95 bpm 2% 1:00'); // escaped
  assert.match(rows[2][2], /<span class="dt-zbar"><i style="width:40%"><\/i><\/span>/);
  assert.match(html, /avg HR 150 bpm · max 178 bpm/);
  assert.match(html, /Zones = % of a max HR of 190 bpm \(the highest Strava recorded in the last 12 months\)/);
  // another day / modality without zones: no block
  s.api.open('load-gym', DEMO.sessions.find((x) => x.m === 'gym').d);
  assert.doesNotMatch(s.host.innerHTML, /dt-zones/);
  // no zoneMax (never happens with a zones file, but never NaN): rows without the bpm ranges
  const bare = setup({ detail: { ...detail, zoneMax: undefined } });
  bare.api.open('load-run', day.d);
  assert.match(bare.host.innerHTML, /class="dt-zones"/);
  assert.doesNotMatch(bare.host.innerHTML, /bpm<\/span><span class="dt-zpct">|NaN|undefined/);
  assert.match(esT.day.zones.title, /zonas/i);
});

/* ---------- day strain deep-dive (key 'strain') ---------- */
const DEMO_SCORES = buildScoresFrom(DEMO_INPUTS);

test('strain deep-dive: the hero = the day\'s strain in its baked ring, contributors = the day\'s activities + the all-day load, the band in the insight, formula + K under ⓘ', () => {
  const S = DEMO_SCORES.strain;
  assert.equal(S.ok, true, 'the demo extract calibrates day strain');
  const s = setup({ dials: DIALS, scores: DEMO_SCORES });
  s.api.open('strain');
  const html = s.host.innerHTML;
  const day = S.days[S.days.length - 1];
  const dial = DIALS.strain.days.find((d) => d.date === day.date);
  const hero = heroOf(html);
  assert.ok(hero.startsWith(' dd-strain"'));
  assert.ok(hero.includes(`<b class="dd-num">${day.s.toFixed(1)}</b>`));
  assert.ok(hero.includes(`d="${dial.fill}"`), 'the same arc as the Inicio dial');
  const rows = [...contribOf(html).matchAll(/<span class="dd-row-lbl">([^<]+) <small/g)].map((m) => m[1]);
  assert.deepEqual(rows, [...day.acts.map((a) => enT.deep.strain.mods[a.m]), enT.deep.strain.allDay]);
  const band = day.s >= 18 ? 'allOut' : day.s >= 14 ? 'high' : day.s >= 10 ? 'moderate' : 'light';
  assert.ok(insightOf(html).includes(enT.deep.strain.bands[band]));
  const info = infoOf(html);
  assert.ok(info.includes(enT.deep.strain.notes.formula));
  assert.ok(info.includes(`K = ${S.K.toFixed(1)}`));
  assert.match(weeklyOf(html), /dd-c-strain/);
  // Relative Effort per modality stays one tap away
  for (const k of ['gym', 'run', 'bike']) if (DEMO.metrics['load-' + k]) assert.match(html, new RegExp(`class="dd-re-link" data-detail="load-${k}"`));
  clean(html);
});

test('strain deep-dive follows the day it was opened on; a day without all-day heart rate says so', () => {
  const S = DEMO_SCORES.strain;
  const prev = S.days[S.days.length - 2];
  const s = setup({ dials: DIALS, scores: DEMO_SCORES });
  s.api.open('strain', prev.date);
  assert.ok(heroOf(s.host.innerHTML).includes(`<b class="dd-num">${prev.s.toFixed(1)}</b>`));
  const dayLbl = format(enDate.dayTpl, { weekday: enDate.weekdays[(new Date(prev.date + 'T12:00:00Z').getUTCDay() + 6) % 7], day: String(Number(prev.date.slice(8))), month: enDate.months[Number(prev.date.slice(5, 7)) - 1] });
  assert.ok(headOf(s.host.innerHTML).includes(`<span class="sr-only">${enT.metrics.strain.title} · </span>${dayLbl}</h2>`), 'the header names the stepped-to day: ' + headOf(s.host.innerHTML).slice(-160));
  const old = addDays(DEMO.metrics.strain.start, -3);
  const o = setup({ dials: DIALS, scores: DEMO_SCORES });
  o.api.open('strain', old);
  assert.ok(heroOf(o.host.innerHTML).includes(enT.deep.words.none) || !o.host.innerHTML.includes('dd-hero'));
});

/* ---------- trend view controls (Q11a-3) ---------- */
test('trend view: the window steps back and forward by its own length (forward disabled at today, back while the data reaches), the range resets it', () => {
  const s = setup();
  s.api.open('rhr');
  s.click(act('range', { 'data-range': '7' }));
  const winOf = (html) => /<div class="dt-win" role="group" aria-label="Period shown">([^]*?)<\/div>/.exec(html)[1];
  const fmt2 = (iso) => format(enDate.dayNoWeekdayTpl, { day: String(Number(iso.slice(8))), month: enDate.months[Number(iso.slice(5, 7)) - 1] });
  let w = winOf(s.host.innerHTML);
  assert.ok(w.includes(`<span class="dt-win-lbl">${fmt2(addDays(NOW, -6))} – ${fmt2(NOW)}, ${NOW.slice(2, 4)}</span>`), w);
  assert.match(w, /data-wdir="1" aria-label="Later period" disabled>/, 'no window after today');
  assert.doesNotMatch(w, /data-wdir="-1"[^>]*disabled/);
  s.click(act('win', { 'data-wdir': '-1' }));
  w = winOf(s.host.innerHTML);
  assert.ok(w.includes(`${fmt2(addDays(NOW, -13))} – ${fmt2(addDays(NOW, -7))}`), 'one week back');
  assert.doesNotMatch(w, /data-wdir="1"[^>]*disabled/);
  const st = JSON.parse(JSON.stringify(s.api.periodStats('rhr', addDays(NOW, -7), 7)));
  assert.ok(s.host.innerHTML.includes(`<b class="dt-trend-num">${st.avg.toFixed(0)}</b>`) || s.host.innerHTML.includes(`<b class="dt-trend-num">${Math.round(st.avg)}</b>`), 'the average is the shown window\'s');
  const end7 = addDays(NOW, -7);
  const fmtW = format(enDate.dayTpl, { weekday: enDate.weekdays[(new Date(end7 + 'T12:00:00Z').getUTCDay() + 6) % 7], day: String(Number(end7.slice(8))), month: enDate.months[Number(end7.slice(5, 7)) - 1] });
  assert.ok(s.host.innerHTML.includes(` to ${fmtW}">`), 'the chart ends at the window end');
  s.click(act('win', { 'data-wdir': '1' }));
  assert.match(winOf(s.host.innerHTML), /data-wdir="1"[^>]*disabled/, 'back at today');
  s.click(act('win', { 'data-wdir': '1' }));
  assert.match(winOf(s.host.innerHTML), new RegExp(fmt2(NOW)), 'never past today');
  // back to the data's first window: the back arrow disables there
  const m = DEMO.metrics.rhr;
  s.click(act('range', { 'data-range': '182' }));
  for (let i = 0; i < 6; i++) s.click(act('win', { 'data-wdir': '-1' }));
  w = winOf(s.host.innerHTML);
  assert.match(w, /data-wdir="-1"[^>]*disabled/, 'no window before the data');
  assert.ok(s.api.state().shift * 182 <= Math.round((Date.parse(NOW) - Date.parse(m.start)) / 86400000), 'the window still holds data');
  s.click(act('range', { 'data-range': '30' }));
  assert.equal(s.api.state().shift, 0, 'a new range starts at today');
});

test('trend view: "TREND VIEW" header + a metric picker pill (non-dial metrics only); picking one re-opens the sheet there, same range, URL replaced', () => {
  const s = setup();
  s.api.open('rhr');
  const html = s.host.innerHTML;
  const opts = [...html.matchAll(/<option value="([^"]+)"( selected)?>/g)];
  assert.ok(opts.length >= 2);
  assert.deepEqual(opts.filter((o) => o[2]).map((o) => o[1]), ['rhr'], 'the open metric is selected');
  for (const k of ['sleep', 'recovery', 'strain', 'load-gym']) assert.ok(!opts.some((o) => o[1] === k), `${k} keeps its dial page`);
  assert.match(html, /<label class="dt-metric"><span class="sr-only">Metric<\/span><select class="dt-metric-sel sel" data-dt-pick="metric">/);
  assert.match(html, /<\/select><span class="chev sel-chev" aria-hidden="true">›<\/span><\/label>/, 'the shared select: the system chevron, not the browser arrow');
  s.click(act('range', { 'data-range': '182' }));
  const sel = new StubElement('select', { attrs: { 'data-dt-pick': 'metric' } });
  sel.value = 'hrv';
  const pushes = s.calls.filter((c) => c[0] === 'push').length;
  s.change(sel);
  assert.equal(s.api.state().key, 'hrv');
  assert.equal(s.api.state().range, 182, 'the range is kept');
  assert.equal(s.calls.filter((c) => c[0] === 'push').length, pushes, 'no new history entry');
  assert.equal(s.loc.hash, '#detail/hrv');
  sel.value = 'constructor';
  s.change(sel);
  assert.equal(s.api.state().key, 'hrv', 'an unknown value is ignored');
  // a dial page has no picker
  s.api.open('recovery');
  assert.doesNotMatch(s.host.innerHTML, /dt-metric-sel/);
});

/* ---------- trend chart + header (Q11a-4) ---------- */
test('6M on ~7 months of data: the previous window starts before the data but holds over half its days, so the pill is a delta (not "Data since"); under half → no delta', () => {
  const mk = (len) => {
    const start = addDays(NOW, -(len - 1));
    const v = Array.from({ length: len }, (_, i) => (i < len - 182 ? 60 : 55));
    return { asOf: NOW, days: 365, metrics: { rhr: { kind: 'signal', dir: -1, dec: 0, start, v } }, sessions: [] };
  };
  const s = setup({ detail: mk(182 + 120) });
  const st = JSON.parse(JSON.stringify(s.api.periodStats('rhr', NOW, 182)));
  assert.deepEqual([st.clamped, st.prev, st.avg, st.tone], [false, 60, 55, 'good'], '120 of 182 previous days hold data');
  s.api.open('rhr');
  s.click(act('range', { 'data-range': '182' }));
  assert.match(s.host.innerHTML, /<span class="dt-pill dt-pill-good">▼ 8% vs prior 6 months<\/span>/);
  assert.match(s.host.innerHTML, /<p class="dt-trend-txt">Your average Resting HR these 6 months was 55 bpm, lower than the 6 months before \(60 bpm\)\.<\/p>/);
  const few = setup({ detail: mk(182 + 60) });
  assert.equal(few.api.periodStats('rhr', NOW, 182).delta, null, '60 of 182 days: not enough to compare');
});

test('trend chart: no card, the band named "Typical range" top-right (no legend swatch for it), a sentence without a previous window', () => {
  const s = setup();
  s.api.open('rhr');
  const html = s.host.innerHTML;
  assert.ok(html.includes(`<figure class="dt-fig"><div class="dt-fig-top"><span class="dt-typ">${enT.trend.typical}</span></div>`));
  assert.doesNotMatch(html, /dt-k-band/);
  const start = addDays(NOW, -9);
  const detail = { asOf: NOW, days: 365, metrics: { rhr: { kind: 'signal', dir: -1, dec: 0, start, v: Array(10).fill(50) } }, sessions: [] };
  const t = setup({ detail });
  t.api.open('rhr');
  assert.match(t.host.innerHTML, /<p class="dt-trend-txt">Your average Resting HR these 30 days was 50 bpm\.<\/p>/);
  const es = setup({ locale: 'es', detail });
  es.api.open('rhr');
  assert.ok(es.host.innerHTML.includes(`<p class="dt-trend-txt">Tu media de ${esT.metrics.rhr.title} estos 30 días fue 50 lpm.</p>`) || /<p class="dt-trend-txt">Tu media de [^<]+ estos 30 días fue 50/.test(es.host.innerHTML));
});

test('trend sentence: a real change that rounds to the same number gets one more decimal', () => {
  const start = addDays(NOW, -13);
  const v = Array.from({ length: 14 }, (_, i) => (i < 7 ? 54.4 : 53.6));
  const s = setup({ detail: { asOf: NOW, days: 365, metrics: { rhr: { kind: 'signal', dir: -1, dec: 0, start, v } }, sessions: [] } });
  s.api.open('rhr');
  s.click(act('range', { 'data-range': '7' }));
  assert.match(s.host.innerHTML, /was 53\.6 bpm, lower than the week before \(54\.4 bpm\)\./);
});

test('trend sentence: sleep reads h:mm, so two windows that print the same clock are "about the same"', () => {
  const start = addDays(NOW, -13);
  // 18.3 vs 18.0 min: a 1.6% change (not flat), but both print 0:18 — never "lower than" next to equal values
  const v = Array.from({ length: 14 }, (_, i) => (i < 7 ? 0.305 : 0.3));
  const s = setup({ detail: { asOf: NOW, days: 365, metrics: { sleep: { kind: 'sleep', dir: 1, dec: 2, start, v } }, sessions: [] } });
  s.api.open('sleep');
  s.click(act('range', { 'data-range': '7' }));
  const txt = /<p class="dt-trend-txt">([^<]*)<\/p>/.exec(s.host.innerHTML)[1];
  assert.match(txt, /was 0:18, about the same as the week before \(0:18\)\./);
  // sleep has a good direction (up): a 1.6% drop is a real ▼ in the worse colour, never a flat dot
  assert.match(s.host.innerHTML, /<span class="dt-pill dt-pill-bad">▼ 2% vs prior week<\/span>/, 'the pill still shows the real change');
});

test('trend pill: a change with no good direction is a neutral ▲ / ▼ (dt-pill-neutral, --ink), never grey or coloured', () => {
  const start = addDays(NOW, -13);
  const up = Array.from({ length: 14 }, (_, i) => (i < 7 ? 80 : 82));
  const s = setup({ detail: { asOf: NOW, days: 365, metrics: { weight: { kind: 'signal', dir: 0, dec: 1, start, v: up } }, sessions: [] } });
  s.api.open('weight');
  s.click(act('range', { 'data-range': '7' }));
  assert.match(s.host.innerHTML, /<span class="dt-pill dt-pill-neutral">▲ \d+% vs prior week<\/span>/);
  assert.doesNotMatch(s.host.innerHTML, /dt-pill-(good|bad|flat)"/);
  const down = setup({ detail: { asOf: NOW, days: 365, metrics: { weight: { kind: 'signal', dir: 0, dec: 1, start, v: up.slice().reverse() } }, sessions: [] } });
  down.api.open('weight');
  down.click(act('range', { 'data-range': '7' }));
  assert.match(down.host.innerHTML, /<span class="dt-pill dt-pill-neutral">▼ \d+% vs prior week<\/span>/);
});

/* ---------- stress monitor page (key 'stress', SCORES.stress: lib/score/stress.mjs) ---------- */
const curveOf = (html) => (html.split('<section class="ds-curve"')[1] || '').split('</section>')[0];
const bandsOf = (html) => (html.split('<section class="ds-bands"')[1] || '').split('</section>')[0];

test('stress page: hero = the latest scored hour on a 0-3 gauge with its band word + hour; hourly curve over the three shaded bands; time in each band; formula + limits under ⓘ', () => {
  const S = DEMO_SCORES.stress;
  assert.equal(S.ok, true, 'the demo extract scores stress');
  const day = S.days[S.days.length - 1];
  const s = setup({ scores: DEMO_SCORES });
  s.api.open('stress');
  const html = s.host.innerHTML;
  const hero = heroOf(html);
  assert.ok(hero.startsWith(` dd-stress ds-${day.now.band}"`), hero.slice(0, 60));
  assert.match(hero, /<svg class="ds-gauge"/);
  assert.ok(hero.includes(`<b class="dd-num">${day.now.v.toFixed(1)}</b>`));
  assert.ok(hero.includes(`<span class="ds-band">${enT.deep.stress.bands[day.now.band]}</span>`));
  assert.ok(hero.includes(format(enT.deep.stress.updated, { time: day.now.t + ':00' })));
  const curve = curveOf(html);
  for (const b of ['low', 'medium', 'high']) assert.match(curve, new RegExp(`<rect class="ds-zone ds-${b}"`));
  assert.equal((curve.match(/<circle class="ds-pt /g) || []).length, day.hours.length, 'one point per scored hour');
  assert.match(curve, /<path class="ds-line" d="M/);
  const bands = bandsOf(html);
  for (const b of ['low', 'medium', 'high']) assert.ok(bands.includes(enT.deep.stress.bandRows[b]));
  const dur = (min) => fmtMinutes(min);
  for (const b of ['low', 'medium', 'high']) assert.ok(bands.includes(`<b class="ds-bmin">${dur(day.mins[b])}</b>`), b + ': ' + bands);
  assert.ok(insightOf(html).includes(format(enT.deep.stress.avg, { value: day.avg.toFixed(1), band: enT.deep.stress.bands[day.band].toLowerCase() })));
  const info = infoOf(html);
  for (const k of ['formula', 'hours', 'limits', 'estimate']) assert.ok(info.includes(enT.deep.stress.notes[k]), k);
  assert.ok(info.includes(format(enT.deep.stress.notes.inputs, { rhr: day.rhr.toFixed(1), max: String(S.maxHr), min: String(S.minHours) })));
  // the day-average trend lives below (the sheet's chart + calendar), coloured by band
  assert.match(html, /class="dt-period"/);
  assert.match(html, /dt-s-shigh|dt-s-smedium|dt-s-slow/);
  clean(html);
});

test('stress page follows the day it was opened on; a day under the minimum hours says so; no SCORES.stress -> the empty sheet', () => {
  const S = DEMO_SCORES.stress;
  const prev = S.days[S.days.length - 2];
  const s = setup({ scores: DEMO_SCORES });
  s.api.open('stress', prev.date);
  assert.ok(heroOf(s.host.innerHTML).includes(`<b class="dd-num">${prev.now.v.toFixed(1)}</b>`));
  const thin = JSON.parse(JSON.stringify(DEMO_SCORES));
  const last = thin.stress.days[thin.stress.days.length - 1];
  Object.assign(last, { n: 3, avg: null, band: null, now: null, mins: null, hours: last.hours.slice(0, 3) });
  const t = setup({ scores: thin });
  t.api.open('stress', last.date);
  assert.ok(insightOf(t.host.innerHTML).includes(format(enT.deep.stress.few, { n: '3', min: '6' })));
  assert.ok(heroOf(t.host.innerHTML).includes(enT.deep.words.none));
  assert.equal((curveOf(t.host.innerHTML).match(/<circle class="ds-pt /g) || []).length, 3, 'the hours still draw');
  const none = setup({ scores: { ...DEMO_SCORES, stress: null } });
  none.api.open('stress');
  assert.match(none.host.innerHTML, /dt-empty/);
});

test('a dated stress page (the Inicio tile\'s earlier reading) opens at its hero — the hero IS that day — not scrolled to the day panel', () => {
  const S = DEMO_SCORES.stress;
  const prev = S.days[S.days.length - 2];
  const s = setup({ scores: DEMO_SCORES, parts: true });
  const scrolled = [];
  s.part.day.scrollIntoView = (o) => scrolled.push(o);
  s.api.open('stress', prev.date);
  assert.ok(heroOf(s.host.innerHTML).includes(`<b class="dd-num">${prev.now.v.toFixed(1)}</b>`));
  assert.equal(scrolled.length, 0);
});

test('es stress page: Spanish copy, decimal comma', () => {
  const s = setup({ locale: 'es', scores: DEMO_SCORES });
  s.api.open('stress');
  const day = DEMO_SCORES.stress.days[DEMO_SCORES.stress.days.length - 1];
  assert.ok(heroOf(s.host.innerHTML).includes(`<b class="dd-num">${day.now.v.toFixed(1).replace('.', ',')}</b>`));
  assert.ok(s.host.innerHTML.includes(esT.deep.stress.notes.formula));
  assert.equal(esT.metrics.stress.title, 'Estimación de estrés');
});

test('fitness age: the headline reads "≤ 25" / "≥ 75" at a clamp bound of the reference curve, else the value', () => {
  const D = copy();
  const start = addDays(NOW, -1);
  D.metrics.fitnessAge = { kind: 'sparse', dir: -1, dec: 1, lo: 25, hi: 75, start, v: [31.4, 25] };
  const s = setup({ detail: D });
  s.api.open('fitnessAge');
  let h = headOf(s.host.innerHTML);
  assert.ok(h.includes('>≤ 25<'), h.slice(0, 300));
  assert.ok(h.includes('<small>years</small>'));
  D.metrics.fitnessAge.v = [31.4, 75];
  const o = setup({ detail: D });
  o.api.open('fitnessAge');
  assert.ok(headOf(o.host.innerHTML).includes('>≥ 75<'));
  D.metrics.fitnessAge.v = [25, 31.4];
  const n = setup({ detail: D });
  n.api.open('fitnessAge');
  h = headOf(n.host.innerHTML);
  assert.ok(h.includes('>31.4<'));
  clean(n.host.innerHTML);
});

/* ---------- energy bank page (key 'energy', SCORES.energy: lib/score/energy.mjs) ---------- */
const partsOf = (html) => (html.split('<section class="dd-contrib"')[1] || '').split('</section>')[0];

test('energy page: hero = the latest level on a 0-100 gauge with its band; the intraday curve from wake; what moved it; our-model notes + constants under ⓘ', () => {
  const E = DEMO_SCORES.energy;
  assert.equal(E.ok, true, 'the demo extract bakes the energy bank');
  const day = E.days[E.days.length - 1];
  assert.ok(day.now, 'the demo\'s newest day has a value');
  const band = day.now.lv >= 67 ? 'hi' : day.now.lv >= 34 ? 'mid' : 'lo';
  const s = setup({ scores: DEMO_SCORES });
  s.api.open('energy-bank');
  const html = s.host.innerHTML;
  const hero = heroOf(html);
  assert.ok(hero.startsWith(` dd-stress de-${band}"`), hero.slice(0, 60));
  assert.ok(hero.includes(`<b class="dd-num">${day.now.lv}</b>`));
  assert.ok(hero.includes(`<span class="ds-band">${enT.deep.energy.bands[band]}</span>`));
  const curve = curveOf(html);
  for (const b of ['lo', 'mid', 'hi']) assert.match(curve, new RegExp(`<rect class="ds-zone de-${b}"`));
  const path = /<path class="ds-line" d="([^"]+)"/.exec(curve)[1];
  assert.equal((path.match(/[ML]/g) || []).length, day.hours.length + 1, 'the wake point + one per hour');
  const marked = day.hours.filter((h) => h.wo || h.ld >= 5 || h.st >= 2).length;
  assert.equal((curve.match(/<circle class="ds-pt /g) || []).length, marked, 'workout / load and high-stress hours are marked');
  const parts = partsOf(html);
  for (const k of ['start', 'base', 'stress', 'load', 'charge', 'low']) assert.ok(parts.includes(enT.deep.energy.rows[k]), k);
  assert.ok(parts.includes(`<b class="dd-row-val">${day.start}</b>`));
  assert.ok(insightOf(html).includes(format(enT.deep.energy.line, { start: day.start, wake: day.wake, value: day.now.lv, time: String(day.now.h).padStart(2, '0') + ':00' })));
  const info = infoOf(html);
  for (const k of ['model', 'hours', 'limits']) assert.ok(info.includes(enT.deep.energy.notes[k]), k);
  assert.ok(info.includes('−1.5 (being awake)') && info.includes('−30 × (1 − e^(−TRIMP ÷ K))') && info.includes('+1 when stress is under 0.5'), 'the formula with the baked constants');
  assert.ok(info.includes(enT.bands.bank));
  // the trend below: each day's latest level, coloured by the three thirds
  assert.match(html, /class="dt-period"/);
  assert.match(html, /dt-s-good|dt-s-mid|dt-s-bad/);
  clean(html);
});

test('energy page follows the day it was opened on; a day without a recovery % says why; no SCORES.energy -> the empty sheet', () => {
  const E = DEMO_SCORES.energy;
  const valued = E.days.filter((d) => d.now);
  const prev = valued[valued.length - 2];
  const s = setup({ scores: DEMO_SCORES });
  s.api.open('energy-bank', prev.date);
  assert.ok(heroOf(s.host.innerHTML).includes(`<b class="dd-num">${prev.now.lv}</b>`));
  const gap = E.days.find((d) => !d.now && d.date > E.metric.start);
  assert.ok(gap, 'the demo has a day without a recovery %');
  s.api.open('energy-bank', gap.date);
  assert.ok(insightOf(s.host.innerHTML).includes(enT.deep.energy.reasons.noRecovery));
  assert.ok(heroOf(s.host.innerHTML).includes(enT.deep.words.none));
  const none = setup({ scores: { ...DEMO_SCORES, energy: null } });
  none.api.open('energy-bank');
  assert.match(none.host.innerHTML, /dt-empty/);
});

test('es energy page: Spanish copy', () => {
  const s = setup({ locale: 'es', scores: DEMO_SCORES });
  s.api.open('energy-bank');
  assert.ok(s.host.innerHTML.includes(esT.deep.energy.notes.model));
  assert.ok(s.host.innerHTML.includes('−1,5 (estar despierto)'));
  assert.equal(esT.metrics['energy-bank'].title, 'Banco de energía');
});

// the nutrition score: scored by the page at view time (client/nutri-score.js), read through
// window.HCNutriScore.metric(); a SYNTHETIC series ending on the viewer's today (so far)
function nscoreMetric() {
  const start = addDays(NOW, -89), v = Array(90).fill(null), days = {};
  const put = (iso, score, o = {}) => {
    v[dayIndex({ start }, iso)] = score;
    days[iso] = { score, parts: { k: { v: 2100, t: 2000, pts: 100 }, p: { v: 120, t: 150, pts: 75 }, f: null }, inc: true, partial: false, meals: true, assumed: false, ...o };
  };
  put(addDays(NOW, -3), 90, { inc: false, parts: { k: { v: 2000, t: 2000, pts: 100 }, p: { v: 150, t: 150, pts: 100 }, f: { v: 60, t: 70, pts: 100 } } });
  put(addDays(NOW, -2), 70, { meals: false, assumed: true });
  put(addDays(NOW, -1), 50);
  put(NOW, 40, { partial: true, inc: false });
  return { kind: 'nscore', dir: 1, dec: 0, start, v, days, bands: { good: 85, mid: 60 } };
}

test('nutrition score sheet: the trend view of the page-scored series, bands 85 / 60, today so far never in the average', () => {
  const s = setup();
  s.ctx.window.HCNutriScore = { metric: nscoreMetric };
  s.api.open('nutrition');
  const html = s.host.innerHTML;
  assert.ok(html.includes(enT.metrics.nutrition.title));
  assert.ok(html.includes(enT.todaySoFar), 'the newest day is today, so far');
  assert.ok(html.includes(enT.bands.nscore));
  for (const k of ['nsGood', 'nsMid', 'nsLow']) assert.ok(html.includes(enT.legend[k]), k);
  // the 7-day average: (90 + 70 + 50) / 3 = 70, today's 40 left out
  assert.match(html, /<b class="dt-trend-num">70<\/b>/);
  assert.match(html, new RegExp(`class="dt-day dt-s-good" data-dt-act="day" data-date="${addDays(NOW, -3)}"`));
  assert.match(html, new RegExp(`class="dt-day dt-s-mid" data-dt-act="day" data-date="${addDays(NOW, -2)}"`));
  assert.match(html, new RegExp(`class="dt-day dt-s-bad" data-dt-act="day" data-date="${addDays(NOW, -1)}"`));
  assert.match(html, new RegExp(`class="dt-day dt-s-partial" data-dt-act="day" data-date="${NOW}"`));
  clean(html);
});

test('contributor rows use the short metric names the same sheet\'s weekly trends use ("HRV", "Resting HR"), never the long ones beside them', () => {
  for (const T of [enT, esT]) {
    assert.equal(T.deep.contrib.rows.hrv, T.metrics.hrv.title);
    assert.equal(T.deep.contrib.rows.rhr, T.metrics.rhr.title);
  }
  const s = setup({ dials: DIALS });
  s.api.open('recovery');
  assert.ok(s.host.innerHTML.includes('<span class="dd-row-lbl">HRV</span>'));
  assert.doesNotMatch(s.host.innerHTML, /Heart rate variability/);
});

test('nutrition score calendar: today being logged (no score yet: v null, the day result partial, as nutri-score.js metric() bakes it) is a partial mark, not "No data"', () => {
  const s = setup();
  s.ctx.window.HCNutriScore = {
    metric() {
      const m = nscoreMetric();
      m.v[m.v.length - 1] = null; // HCNutriScore.metric(): a partial day has no score on the chart
      return m;
    },
  };
  s.api.open('nutrition');
  const html = s.host.innerHTML;
  const cell = html.match(new RegExp(`<button type="button" class="dt-day ([^"]+)" data-dt-act="day" data-date="${NOW}"[^>]*aria-label="([^"]+)"`));
  assert.ok(cell, 'today has a day cell');
  assert.equal(cell[1], 'dt-s-partial');
  assert.ok(!cell[2].includes(enT.noData), cell[2]);
  assert.ok(cell[2].includes(enT.day.ns.inProgress), cell[2]);
});

test('nutrition score day panel: the score, each component eaten / target and points, and why the day may read short', () => {
  const s = setup();
  s.ctx.window.HCNutriScore = { metric: nscoreMetric };
  s.api.open('nutrition', addDays(NOW, -2));
  const html = s.host.innerHTML, P = enT.day.ns;
  assert.ok(html.includes(`<span class="dt-row-lbl">${P.score}</span><b class="dt-row-val">70%</b>`));
  assert.ok(html.includes(`<span class="dt-row-lbl">${P.k}</span><b class="dt-row-val">2,100 / 2,000 kcal</b><small class="dt-row-sub">100 / 100 pts</small>`));
  assert.ok(html.includes(`<span class="dt-row-lbl">${P.p}</span><b class="dt-row-val">120 / 150 g</b><small class="dt-row-sub">75 / 100 pts</small>`));
  assert.ok(html.includes(`<span class="dt-row-lbl">${P.f}</span><b class="dt-row-val">—</b><small class="dt-row-sub">${P.unknown}</small>`));
  for (const k of ['inc', 'meals', 'assumed']) assert.ok(html.includes(P[k]), k);
  s.api.open('nutrition', NOW);
  // today is still filling up: "In progress" instead of a score, eaten / target without points
  const today = s.host.innerHTML;
  assert.ok(today.includes(`<span class="dt-row-lbl">${P.score}</span><b class="dt-row-val">${P.inProgress}</b><small class="dt-row-sub">${P.inProgressSub}</small>`));
  assert.doesNotMatch(today, /dt-row-val">40%|\/ 100 pts/, 'no partial score, no points');
  const none = setup();
  none.api.open('nutrition');
  assert.match(none.host.innerHTML, /dt-empty/, 'no HCNutriScore / no scored day -> the empty sheet');
});

test('nutrition score: listed in the trend picker (and selected) once the page has a scored day', () => {
  const s = setup();
  s.ctx.window.HCNutriScore = { metric: nscoreMetric };
  s.api.open('nutrition');
  assert.match(s.host.innerHTML, /<option value="nutrition" selected>Nutrition score<\/option>/);
  s.api.open('hrv');
  assert.match(s.host.innerHTML, /<option value="nutrition">Nutrition score<\/option>/);
  const none = setup();
  none.api.open('hrv');
  assert.doesNotMatch(none.host.innerHTML, /value="nutrition"/);
});

test('deep-dive History fold: the month calendar + day panel sit behind one collapsed row, toggled in place and remembered; a dated open starts it open; the trend view has no fold', () => {
  const box = new StubElement('div', { hidden: true });
  const s = setup({ dials: DIALS, query: { '#dd-hist': box } });
  s.api.open('recovery');
  let html = s.host.innerHTML;
  const btn = `<button type="button" class="dd-fold" data-dt-act="hist" aria-expanded="false" aria-controls="dd-hist"><span class="dd-fold-t">${enT.deep.hist.title}</span><span class="dd-fold-s">${enT.deep.hist.sub}</span>`;
  assert.ok(html.includes(btn), 'one collapsed row');
  const fold = html.split('<div class="dd-hist-b" id="dd-hist" hidden>')[1];
  assert.ok(fold && fold.includes('class="dt-cal"') && fold.includes('data-dt-part="day"'), 'calendar + day panel inside, hidden');
  assert.ok(html.indexOf('dd-fold') > html.indexOf('dt-chart'), 'below the trend chart');
  const writes = s.hostWrites();
  const b = act('hist', { 'aria-expanded': 'false' });
  s.click(b);
  assert.equal(box.hidden, false);
  assert.equal(b.getAttribute('aria-expanded'), 'true');
  assert.equal(s.hostWrites(), writes, 'toggled in place, no re-render');
  s.api.open('sleep');
  assert.ok(s.host.innerHTML.includes('aria-expanded="true" aria-controls="dd-hist"') && s.host.innerHTML.includes('<div class="dd-hist-b" id="dd-hist">'), 'remembered for the session');
  s.click(b);
  assert.equal(box.hidden, true);
  // a dated open (a run row, a stepped Inicio day): the day it was opened for is visible
  const d = setup({ dials: DIALS });
  d.api.open('recovery', addDays(NOW, -2));
  assert.ok(d.host.innerHTML.includes('<div class="dd-hist-b" id="dd-hist">'));
  // the trend view keeps its calendar unfolded
  d.api.open('rhr');
  assert.doesNotMatch(d.host.innerHTML, /dd-fold|dd-hist/);
  assert.match(d.host.innerHTML, /class="dt-cal"/);
  const es = setup({ locale: 'es', dials: DIALS });
  es.api.open('recovery');
  assert.ok(es.host.innerHTML.includes(`<span class="dd-fold-t">${esT.deep.hist.title}</span>`));
  clean(html);
});

test('trend view 6M / 1Y: only the days out of the range get a dot (the 7-day line carries the rest); M keeps every day', () => {
  const s = setup();
  const m = DEMO.metrics.rhr;
  const inWin = (from) => { const out = []; for (let d = from < m.start ? m.start : from; d <= NOW; d = addDays(d, 1)) { const v = valueOn(m, d); if (v != null) out.push(v); } return out; };
  s.api.open('rhr');
  let html = s.host.innerHTML;
  assert.equal((html.match(/class="dt-pt/g) || []).length, inWin(addDays(NOW, -29)).length, 'M: a dot per day with data');
  // the "Daily" key shows the dots' own colours: one mark per state drawn, never a stand-in blue swatch
  const keyStates = (h, cls) => {
    const k = h.match(new RegExp(`<span class="dt-k dt-k-pts ${cls}"><svg class="dt-k-sw"[^>]*>([\\s\\S]*?)<\\/svg>([^<]*)<\\/span>`));
    return k ? { label: k[2], sts: [...k[1].matchAll(/class="dt-kd dt-s-(\w+)"/g)].map((x) => x[1]) } : null;
  };
  const drawnStates = (h) => [...new Set([...h.matchAll(/class="dt-pt dt-s-(\w+)"/g)].map((x) => x[1]))].sort();
  const dk = keyStates(html, 'dt-k-daily');
  assert.equal(dk.label, enT.chartKey.daily);
  assert.deepEqual([...dk.sts].sort(), drawnStates(html), 'the key marks = the states the chart drew');
  assert.ok(dk.sts.length > 1, 'the demo month mixes states (so a single blue swatch would lie)');
  s.click(act('range', { 'data-range': '182' }));
  html = s.host.innerHTML;
  const vals = inWin(addDays(NOW, -181));
  const out = vals.filter((v) => v < m.band.lo || v > m.band.hi);
  assert.ok(vals.length > 60 && out.length > 0 && out.length < vals.length / 3, `the demo has a long, mostly in-range window (${out.length}/${vals.length})`);
  assert.equal((html.match(/class="dt-pt/g) || []).length, out.length, '6M: a dot per out-of-range day only');
  assert.doesNotMatch(html, /dt-pt dt-s-normal/, 'no in-range dot');
  assert.match(html, /class="dt-line"/, 'the 7-day line stays');
  const ok = keyStates(html, 'dt-k-out');
  assert.equal(ok.label, enT.chartKey.outside, 'the key says which days are dots');
  assert.deepEqual([...ok.sts].sort(), drawnStates(html), 'in the out-of-range days\' own colours');
  // recovery: out of range = beyond the day cut (the calendar's above / below baseline)
  s.api.open('recovery');
  s.click(act('range', { 'data-range': '182' }));
  const r = DEMO.metrics.recovery;
  let n = 0;
  for (let d = addDays(NOW, -181); d <= NOW; d = addDays(d, 1)) { const v = valueOn(r, d); if (v != null && Math.abs(v) >= r.cut) n++; }
  assert.equal((s.host.innerHTML.match(/class="dt-pt/g) || []).length, n);
  // es copy
  const es = setup({ locale: 'es' });
  es.api.open('rhr');
  es.click(act('range', { 'data-range': '365' }));
  assert.equal(keyStates(es.host.innerHTML, 'dt-k-out').label, esT.chartKey.outside);
});

test('trend view breakdown: one stacked bar of the window\'s days by calendar state with a count each ("6x"), following the window; LEARN MORE opens ⓘ; none for training volume', () => {
  const info = new StubElement('div', { hidden: true });
  info.scrolled = 0;
  info.scrollIntoView = () => { info.scrolled++; };
  const ibtn = new StubElement('button', { attrs: { 'aria-expanded': 'false' } });
  const s = setup({ query: { '#dd-info': info, '.sh-info': ibtn } });
  const m = DEMO.metrics.rhr;
  const count = (from) => {
    const c = { good: 0, normal: 0, bad: 0 };
    for (let d = from; d <= NOW; d = addDays(d, 1)) {
      const v = valueOn(m, d);
      if (v == null) continue;
      const side = v > m.band.hi ? 1 : v < m.band.lo ? -1 : 0;
      c[!side ? 'normal' : side === m.dir ? 'good' : 'bad']++;
    }
    return c;
  };
  const brkOf = (html) => (html.split('<section class="dt-brk"')[1] || '').split('</section>')[0];
  s.api.open('rhr');
  for (const [range, from] of [['30', addDays(NOW, -29)], ['7', addDays(NOW, -6)]]) {
    s.click(act('range', { 'data-range': range }));
    const b = brkOf(s.host.innerHTML);
    const c = count(from);
    const tot = c.good + c.normal + c.bad;
    assert.ok(b.includes(`<h3 class="dt-brk-t">${enT.trend.brk.title}</h3><button type="button" class="cta" data-dt-act="learn">${enT.trend.brk.learn}<span aria-hidden="true"> →</span></button>`));
    assert.deepEqual([...b.matchAll(/<li data-st="([a-z]+)">/g)].map((x) => x[1]), ['good', 'normal', 'bad'], 'the legend\'s order');
    for (const k of ['good', 'normal', 'bad']) {
      assert.ok(b.includes(`${k === 'good' ? enT.legend.good : k === 'bad' ? enT.legend.bad : enT.legend.normal}<b>${c[k]}x</b>`), `${range}: ${k} ${c[k]}x`);
      if (c[k]) assert.ok(b.includes(`<i class="dt-s-${k}" style="width:${Math.round((1000 * c[k]) / tot) / 10}%"></i>`), `${range}: ${k} segment`);
      else assert.ok(!b.includes(`<i class="dt-s-${k}"`), `${range}: no empty segment`);
    }
  }
  const html = s.host.innerHTML;
  assert.ok(html.indexOf('dt-brk') > html.indexOf('dt-chart') && html.indexOf('dt-brk') < html.indexOf('dt-cal'), 'under the chart');
  const writes = s.hostWrites();
  s.click(act('learn'));
  assert.equal(info.hidden, false, 'ⓘ opens');
  assert.equal(ibtn.getAttribute('aria-expanded'), 'true');
  assert.equal(info.scrolled, 1);
  s.click(act('learn'));
  assert.equal(info.hidden, false, 'never closes it');
  assert.equal(s.hostWrites(), writes, 'no re-render');
  // recovery: its day states; training load / volume: no breakdown
  s.api.open('recovery');
  assert.deepEqual([...brkOf(s.host.innerHTML).matchAll(/<li data-st="([a-z]+)">/g)].map((x) => x[1]), ['good', 'normal', 'bad']);
  s.api.open('load-gym');
  assert.doesNotMatch(s.host.innerHTML, /dt-brk/);
  s.api.open('workouts');
  assert.doesNotMatch(s.host.innerHTML, /dt-brk/);
  const es = setup({ locale: 'es' });
  es.api.open('rhr');
  assert.ok(es.host.innerHTML.includes(`>${esT.trend.brk.learn}<span aria-hidden="true"> →</span></button>`) && /<b>\d+x<\/b>/.test(es.host.innerHTML));
  clean(html);
});
