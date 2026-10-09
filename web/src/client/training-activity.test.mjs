/* Tests for Entreno's Activity card (web/src/client/training-activity.js): totals + W / M / 6M switch,
 * modality split, 30-day calendar. The classic script in a vm with baked ACTIVITY / I18N_ACTIVITY /
 * LOCALE and a controllable clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activityFromRows, activityBake } from '../../../lib/training/activity.mjs';
import { es as esT, en as enT } from '../i18n/activity-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'training-activity.js'), 'utf8');
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ASOF = '2026-09-29';

// every 2nd day in the last 30 (60 min run), every 3rd day in the previous 30 (30 min gym)
const rows = [];
for (let i = 0; i < 30; i += 2) rows.push({ date: addDays(ASOF, -i), type: 'Running', dur: 60 });
for (let i = 30; i < 60; i += 3) rows.push({ date: addDays(ASOF, -i), type: 'HighIntensityIntervalTraining', dur: 30 });
rows.push({ date: ASOF, type: 'Cycling', dur: 45 });
const ACT = activityFromRows(rows);
// the same plus one old session, so the windows before M and W lie after the first session
const ACT2 = activityFromRows([...rows, { date: addDays(ASOF, -200), type: 'Running', dur: 30 }]);

function render(activity, { locale = 'en', now = ASOF, at, detail = false, stored, win } = {}) {
  const host = { innerHTML: '' };
  const window = win || {};
  if (stored !== undefined) window.localStorage = { getItem: () => stored, setItem: () => {} };
  const RealDate = Date;
  const stamp = at || now + 'T12:00:00';
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [stamp])); }
    static now() { return new RealDate(stamp).getTime(); }
  }
  const ctx = {
    document: { getElementById: (id) => (id === 'train-activity' ? host : null) },
    ACTIVITY: activity == null ? activity : activityBake(activity), I18N_ACTIVITY: locale === 'es' ? esT : enT, LOCALE: locale, Date: FakeDate, Math, String, Number, Array, Object, JSON, window,
  };
  if (detail) ctx.DETAIL = { metrics: {} };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return host.innerHTML;
}
const cells = (html) => [...html.matchAll(/<rect class="cal-cell cal-l(\d)"[^>]*><title>([^<]*)<\/title>/g)].map((m) => ({ level: +m[1], title: m[2] }));

test('ONE Activity card: header + ⓘ, total time with the W / M / 6M switch, stats, split, then the compact calendar', () => {
  const html = render(ACT);
  const order = ['<section class="hs-sec act" aria-labelledby="act-h">', 'id="act-h">Activity</h3>', 'data-hs-info="act-info"', '<div class="hs-info" id="act-info" hidden>',
    '<div class="act-card">', 'class="act-sum"', 'class="dt-range act-range"', 'class="act-stats"', 'class="act-split"', 'class="act-cal"', 'class="cal-svg"'].map((n) => html.indexOf(n));
  assert.ok(order.every((v, i) => v !== -1 && (i === 0 || v > order[i - 1])), `card order ${order}`);
  assert.equal((html.match(/data-act-range="(\d+)"/g) || []).join(','), 'data-act-range="7",data-act-range="30",data-act-range="182"');
  assert.match(html, /data-act-range="30" aria-pressed="true" aria-label="Last month">M</, 'M is the default window');
  assert.doesNotMatch(html, /cum-svg|cum-line|act-pair|class="dash-sec/, 'the cumulative chart and the old two-block layout are gone');
  for (const k of ['help', 'note', 'labelsNote']) assert.ok(html.includes(enT[k].slice(0, 40)), `${k} behind ⓘ`);
});

test('openers: the total and the calendar open the training-time sheet; a day cell opens that day; the switch is not inside an opener', () => {
  const html = render(ACT, { detail: true });
  assert.match(html, /<div class="act-sum" data-detail="workouts" role="button" tabindex="0" aria-haspopup="dialog">/);
  assert.match(html, /<div class="act-cal" data-detail="workouts" role="button" tabindex="0" aria-haspopup="dialog">/);
  const days = [...html.matchAll(/<rect class="cal-cell cal-l\d" data-detail="workouts" data-date="(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]);
  assert.equal(days.length, 30);
  assert.equal(days[29], ASOF);
  assert.doesNotMatch(html, /<rect[^>]*tabindex/, 'cells are mouse targets; the calendar block is the keyboard opener');
  const sum = html.slice(html.indexOf('class="act-sum"'), html.indexOf('class="dt-range act-range"'));
  assert.equal((sum.match(/<div/g) || []).length, (sum.match(/<\/div>/g) || []).length, 'the totals block closes before the switch');
  assert.doesNotMatch(render(ACT), /data-detail/, 'no detail sheet baked: plain card');
});

test('M window: total of the last 30 days vs the 30 before, sessions / days / per week, split with counts', () => {
  assert.match(render(ACT), /<span class="dt-pill">no prior period<\/span>/, 'the month before starts before the first session: no comparison');
  const html = render(ACT2);
  // last 30: 15 runs × 60 + a 45-min ride = 945 min; previous 30: 10 gym × 30 = 300 min -> +215%
  assert.match(html, /<b class="dt-trend-num">15:45<\/b><span class="dt-pill">▲ 215% vs prior month<\/span>/);
  const stats = [...html.matchAll(/<div class="act-stat"><b>([^<]*)<\/b><span>([^<]*)<\/span><\/div>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(stats, [['16', 'Sessions'], ['15', 'Days'], ['3:41', 'Per week']], '16 sessions (15 runs + 1 ride, the run+ride day counts twice) on 15 days');
  const legend = [...html.matchAll(/<li><span class="act-sw act-m-(\w+)" aria-hidden="true"><\/span><b>(\d+)×<\/b> ([^<]+) <small>([^<]+)<\/small><\/li>/g)].map((m) => m.slice(1));
  assert.deepEqual(legend, [['run', '15', 'Run', '95% · 15:00'], ['bike', '1', 'Bike', '5% · 0:45']], 'largest first, sessions ×, share of the minutes');
  const segs = [...html.matchAll(/<rect class="act-m-(\w+)" x="([\d.]+)" y="0" width="([\d.]+)" height="8"\/>/g)].map((m) => [m[1], +m[2], +m[3]]);
  assert.deepEqual(segs.map((x) => x[0]), ['run', 'bike']);
  assert.equal(segs[1][1], segs[0][2], 'stacked: each segment starts where the last ended');
  assert.ok(Math.abs(segs[0][2] + segs[1][2] - 100) < 0.02, 'the bar is the whole window');
  assert.match(html, /<svg class="act-bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="By modality: Run 15 sessions, 95% \(15:00\), Bike 1 sessions, 5% \(0:45\)">/);
});

test('W and 6M windows (HCActivity.summary): totals, sessions and split follow the window; a window before the first session has no comparison', () => {
  const win = {};
  render(ACT, { win });
  const byDate = Object.fromEntries(ACT.days.map((d) => [d.date, d]));
  const w = win.HCActivity.summary(byDate, ASOF, 7);
  // last 7 days: runs on days 0, 2, 4, 6 (4 × 60) + the ride = 285 min; the 7 before: runs on 8, 10, 12 = 180
  assert.deepEqual([w.min, w.sessions, w.days, w.prev], [285, 5, 4, 180]);
  assert.equal(Math.round(w.pct), 58);
  assert.deepEqual(Object.keys(w.mods).sort(), ['bike', 'run']);
  const m6 = win.HCActivity.summary(byDate, ASOF, 182);
  assert.equal(m6.min, 945 + 300, 'every baked session of the last 182 days');
  assert.equal(m6.sessions, 26);
  assert.deepEqual({ ...m6.mods.hiit }, { min: 300, n: 10 });
  assert.equal(m6.prev, null, 'the 6M before starts before the first session: no comparison');
  assert.equal(m6.pct, null);
  const byDate2 = Object.fromEntries(ACT2.days.map((d) => [d.date, d]));
  const win2 = {};
  render(ACT2, { win: win2 });
  const w2 = win2.HCActivity.summary(byDate2, addDays(ASOF, -150), 7);
  assert.equal(w2.prev, 0);
  assert.equal(w2.pct, null, 'no training in the window before: no %');
});

test('the switch: 6M re-renders the card (total, pill, split) and keeps focus; the choice is remembered per viewer', () => {
  const sets = [];
  const win = { localStorage: { getItem: () => null, setItem: (k, v) => sets.push([k, v]) } };
  const host = { innerHTML: '' };
  let onClick = null;
  host.addEventListener = (type, fn) => { if (type === 'click') onClick = fn; };
  const focused = [];
  host.querySelector = (sel) => ({ focus: () => focused.push(sel) });
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [ASOF + 'T12:00:00'])); }
    static now() { return new RealDate(ASOF + 'T12:00:00').getTime(); }
  }
  const ctx = {
    document: { getElementById: (id) => (id === 'train-activity' ? host : null) },
    ACTIVITY: activityBake(ACT), I18N_ACTIVITY: enT, LOCALE: 'en', Math, String, Number, Array, Object, JSON, window: win, Date: FakeDate,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  assert.ok(onClick, 'one delegated click listener on the host');
  const btn = { getAttribute: () => '182' };
  onClick({ target: { closest: (sel) => (sel === '[data-act-range]' ? btn : null) } });
  assert.match(host.innerHTML, /data-act-range="182" aria-pressed="true"/);
  assert.match(host.innerHTML, /<b class="dt-trend-num">20:45<\/b><span class="dt-pill">no prior period<\/span>/);
  assert.match(host.innerHTML, /act-m-hiit/, 'the gym sessions of the previous month are inside 6M');
  assert.deepEqual(sets, [['hc-act-range', '182']]);
  assert.deepEqual(focused, ['[data-act-range="182"]']);
  assert.match(render(ACT, { stored: '7' }), /data-act-range="7" aria-pressed="true"/, 'a remembered window opens the card');
  assert.match(render(ACT, { stored: '99' }), /data-act-range="30" aria-pressed="true"/, 'an unknown stored value falls back to M');
});

test('calendar: 30 day cells ending at the viewer\'s today, level by total minutes, a title per cell (hover)', () => {
  const html = render(ACT);
  const c = cells(html);
  assert.equal(c.length, 30);
  assert.equal(c[29].title, `Tue 29 Sep: 1:45 (Run 1:00, Bike 0:45)`, 'today: run + ride summed into one day, split in the title');
  assert.equal(c[29].level, 4, '105 min -> 90+');
  assert.equal(c[28].level, 0);
  assert.equal(c[28].title, 'Mon 28 Sep: no training');
  assert.equal(c[27].level, 3, '60 min -> 60–89');
  assert.ok(html.includes(enT.calHint.replace('{days}', '15')), '15 distinct active days');
  assert.ok(html.includes('<span class="dt-trend-lbl">Last 30 days</span>'), 'compact calendar label');
  assert.equal((html.match(/class="cal-legend-sw cal-l\d"/g) || []).length, 5, 'a legend for the five levels');
  assert.doesNotMatch(html, /NaN|undefined|<script|href=|style=/);
});

test('the viewer a day ahead of the data: windows end today (today empty), not stale', () => {
  const html = render(ACT, { now: addDays(ASOF, 1) });
  const c = cells(html);
  assert.equal(c[29].level, 0);
  assert.equal(c[28].title, `Tue 29 Sep: 1:45 (Run 1:00, Bike 0:45)`);
  assert.doesNotMatch(html, /sc-stale|act-stale/);
});

test('clock skew: the viewer\'s today EARLIER than the data -> windows end at the data date (its sessions stay visible), not stale', () => {
  for (const opts of [{ now: addDays(ASOF, -1) }, { now: addDays(ASOF, -40) }, { at: addDays(ASOF, -1) + 'T23:59:00' }]) {
    const html = render(ACT, opts);
    assert.equal(cells(html)[29].title, `Tue 29 Sep: 1:45 (Run 1:00, Bike 0:45)`, JSON.stringify(opts));
    assert.doesNotMatch(html, /act-stale/);
  }
});

test('clock edge: 23:59 ends the windows that day, 00:01 the next', () => {
  assert.equal(cells(render(ACT, { at: ASOF + 'T23:59:00' }))[29].title, `Tue 29 Sep: 1:45 (Run 1:00, Bike 0:45)`);
  const next = cells(render(ACT, { at: addDays(ASOF, 1) + 'T00:01:00' }));
  assert.equal(next[29].title, 'Wed 30 Sep: no training');
});

test('stale data (> 3 days old): windows end at the data date, the block is greyed with a note', () => {
  const html = render(ACT, { now: addDays(ASOF, 10) });
  assert.match(html, /act-stale/);
  assert.ok(html.includes(enT.staleNote.replace('{days}', '10').replace('{date}', 'Tue 29 Sep')));
  assert.equal(cells(html)[29].title, `Tue 29 Sep: 1:45 (Run 1:00, Bike 0:45)`);
});

test('empty state and resilience', () => {
  assert.ok(render({ hasData: false }).includes('No workouts yet'));
  assert.doesNotThrow(() => render(undefined));
  const broken = render({ hasData: true, asOf: ASOF, days: 'broken' });
  assert.doesNotMatch(broken, /NaN|undefined/);
});

test('es: Spanish copy and h:mm durations', () => {
  const html = render(ACT2, { locale: 'es' });
  assert.ok(html.includes(esT.calHeading));
  assert.ok(html.includes('15:45'));
  assert.match(html, /▲ 215% vs mes anterior/, 'one percent rule: no space');
});

test('wide screens (>= 900 px): the calendar is a full-width HTML grid with the same levels, titles and day openers', () => {
  let query = null, listened = false;
  const mm = (q) => { query = q; return { matches: true, addEventListener: (ev) => { listened = ev === 'change'; } }; };
  const wide = render(ACT, { detail: true, win: { matchMedia: mm } });
  const phone = render(ACT, { detail: true, win: { matchMedia: () => ({ matches: false }) } });
  assert.equal(query, '(min-width: 900px)');
  assert.ok(listened, 'crossing the breakpoint re-renders');
  assert.doesNotMatch(wide, /cal-svg/);
  assert.match(wide, /<div class="cal-grid" role="img" aria-label="[^"]+">(<span class="cal-wd">[^<]+<\/span>){7}/, 'weekday header row first');
  const days = [...wide.matchAll(/<span class="cal-day cal-l(\d)"[^>]*data-date="(\d{4}-\d\d-\d\d)"[^>]*title="([^"]*)"><\/span>/g)].map((m) => ({ level: +m[1], title: m[3] }));
  assert.deepEqual(days, cells(phone), 'same 30 days, levels and titles as the phone SVG');
  const pads = (wide.match(/class="cal-pad"/g) || []).length;
  const first = addDays(ASOF, -29);
  assert.equal(pads, (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7, 'Monday-first offset');
  assert.match(phone, /class="cal-svg"/, 'phones keep the SVG');
});
