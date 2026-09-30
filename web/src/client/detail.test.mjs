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

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'detail.js'), 'utf8');
const DEMO = buildDetail(path.join(here, '..', '..', '..', 'data', 'demo', 'extract'));
const NOW = DEMO.asOf; // the viewer opens the page on the demo's newest data day

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayIndex = (m, iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(m.start + 'T00:00:00Z')) / 86400000);
const valueOn = (m, iso) => { const i = dayIndex(m, iso); return i >= 0 && i < m.v.length ? m.v[i] : null; };

function setup({ locale = 'en', now = NOW, detail = DEMO, hash = '' } = {}) {
  const listeners = { doc: {}, win: {} };
  const host = new StubElement('div', { attrs: { id: 'detail' }, hidden: true });
  const closeBtn = { focused: 0, focus() { this.focused++; } };
  host.querySelector = (sel) => (sel.includes('close') ? closeBtn : null);
  host.querySelectorAll = () => [];
  const wrap = new StubElement('div', { classes: ['wrap'] });
  const root = new StubElement('html');
  const loc = { hash, pathname: '/', search: '' };
  const calls = [];
  const fire = (bucket, type, evt) => (listeners[bucket][type] || []).forEach((fn) => fn(evt));
  const history = {
    state: null,
    pushState(state, _t, url) { calls.push(['push', url]); this.state = state; loc.hash = url; },
    replaceState(state, _t, url) { calls.push(['replace', url]); this.state = state; loc.hash = url.startsWith('#') ? url : ''; },
    back() { calls.push(['back']); this.state = null; loc.hash = ''; fire('win', 'popstate', {}); },
  };
  const doc = {
    getElementById: (id) => (id === 'detail' ? host : null),
    querySelector: (sel) => (sel === '.wrap' ? wrap : null),
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
  win.location = loc;
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  const api = win.HCDetail;
  return {
    ctx, host, wrap, root, loc, calls, api, closeBtn,
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
