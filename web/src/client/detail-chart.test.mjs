/* Tests for the detail sheet's trend chart (web/src/client/detail-chart.js, window.HCDetailChart): the
 * classic script runs in a vm after util.js and detail-state.js, over small hand-made series and a fixed
 * clock, so the slot geometry (selX + the caller's state.geo), the round Y ticks, the long-window
 * "out of range only" dots and the breakdown counts are checked without the sheet. The rendered sheet
 * (every metric's view, gaps, the key, the breakdown's placement and copy) is covered by detail.test.mjs.
 * Characterization tests of existing code: no behaviour change came with them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { en as enT } from '../i18n/detail-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const stateSource = fs.readFileSync(path.join(here, 'detail-state.js'), 'utf8');
const source = fs.readFileSync(path.join(here, 'detail-chart.js'), 'utf8');
const TODAY = '2026-10-10';
// the chart's SVG geometry (detail-chart.js): width 320, inner padding 8
const CW = 320, CPAD = 8;

function load({ now = TODAY } = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now + 'T12:00:00'])); }
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const win = {};
  const ctx = vm.createContext({ window: win, LOCALE: 'en', Date: FakeDate, Math, String, Number, Array, Object, JSON, isFinite });
  loadUtil(ctx);
  vm.runInContext(stateSource, ctx);
  vm.runInContext(source, ctx);
  const DS = win.HCDetailState(enT, { asOf: now, metrics: {}, sessions: [] });
  return win.HCDetailChart(enT, DS);
}
// a dense daily series from `start` (index 0)
const series = (v, extra = {}) => ({ start: '2026-10-01', v, dec: 0, kind: 'signal', dir: 1, ...extra });
const yLabels = (html) => [...html.split('<div class="dt-yax"')[1].split('</div>')[0].matchAll(/>([^<]+)<\/span>/g)].map((m) => m[1]);
const dots = (html) => [...html.matchAll(/<circle class="dt-pt dt-s-(\w+)"/g)].map((m) => m[1]);

test('detail-chart.js defines only window.HCDetailChart, and reads nothing else at load', () => {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(source, ctx);
  assert.equal(typeof ctx.window.HCDetailChart, 'function');
  assert.deepEqual(Object.keys(ctx.window), ['HCDetailChart']);
});

test('selX: the x of a day\'s slot from the recorded geometry; null without a chart, a day or outside the window', () => {
  const C = load();
  const g = { from: '2026-10-01', n: 10, slot: 30 };
  assert.equal(C.selX(null, '2026-10-05'), null, 'no chart drawn yet');
  assert.equal(C.selX(g, null), null, 'no selected day');
  assert.equal(C.selX(g, '2026-10-01'), CPAD);
  assert.equal(C.selX(g, '2026-10-05'), CPAD + 4 * 30);
  assert.equal(C.selX(g, '2026-10-10'), CPAD + 9 * 30, 'the last slot');
  assert.equal(C.selX(g, '2026-09-30'), null, 'the day before the window');
  assert.equal(C.selX(g, '2026-10-11'), null, 'the day after the window');
});

test('chartHtml records its geometry in the caller\'s state.geo and draws the selection at selX', () => {
  const C = load();
  const state = { geo: { stale: true }, other: 1 };
  const m = series([50, 52, 51, 53, 55, 54, 56, 57, 58, 60]);
  C.chartHtml('hrv', m, '2026-10-01', '2026-10-10', '2026-10-04', state);
  // a vm object: compare its own fields, not its (other-realm) prototype
  assert.deepEqual({ ...state.geo }, { from: '2026-10-01', n: 10, slot: (CW - 2 * CPAD) / 10 }, 'replaced, not merged');
  assert.equal(state.other, 1, 'the rest of the caller\'s state is untouched');
  const html = C.chartHtml('hrv', m, '2026-10-01', '2026-10-10', '2026-10-04', state);
  assert.ok(html.includes(`<rect class="dt-sel" x="${C.selX(state.geo, '2026-10-04').toFixed(1)}" y="0" width="30.4" height="140"/>`));
  // a selected day outside the window: the slot is still drawn, hidden, so a tap only moves it
  const off = C.chartHtml('hrv', m, '2026-10-01', '2026-10-10', '2026-09-20', state);
  assert.ok(off.includes('<rect class="dt-sel" x="0.0" y="0" width="30.4" height="140" visibility="hidden"/>'));
});

test('Y ticks: three round values, centred on the range for points and from 0 for bars', () => {
  const C = load();
  const state = {};
  // points 50…70, no band / target: span 20 → step 10 around the middle (60)
  const pts = series([50, 55, 60, 65, 70, 52, 58, 62, 68, 70]);
  assert.deepEqual(yLabels(C.chartHtml('hrv', pts, '2026-10-01', '2026-10-10', null, state)), ['70', '60', '50']);
  // bars (a daily total over more than a week) 0…1000: step 500 from 0
  const bars = series([100, 1000, 400, 800, 0, 600, 300, 900, 200, 700], { kind: 'total', dir: 0 });
  assert.deepEqual(yLabels(C.chartHtml('steps', bars, '2026-10-01', '2026-10-10', null, state)), ['1,000', '500', '0']);
  // a flat series never divides by zero: still three finite, evenly spaced ticks
  const flat = yLabels(C.chartHtml('hrv', series(new Array(10).fill(42)), '2026-10-01', '2026-10-10', null, state)).map(Number);
  assert.equal(flat.length, 3);
  assert.ok(flat.every(Number.isFinite), String(flat));
  assert.equal(flat[0] - flat[1], flat[1] - flat[2]);
});

test('long windows of points: only the days out of range get a dot (band, or recovery\'s |v| < cut)', () => {
  const C = load({ now: '2026-12-29' });
  const state = {};
  // 90 days alternating inside (50) and above (70) the 40–60 band; dir 1 → above is "good"
  const banded = series(Array.from({ length: 90 }, (_, i) => (i % 2 ? 70 : 50)), { band: { lo: 40, hi: 60, median: 50 } });
  const b = dots(C.chartHtml('hrv', banded, '2026-10-01', '2026-12-29', null, state));
  assert.equal(b.length, 45);
  assert.ok(b.every((s) => s === 'good'), 'no in-band (normal) dot');
  // recovery: |v| < cut is "at baseline" (no dot); the band edges themselves are out of range
  const rec = series(Array.from({ length: 90 }, (_, i) => [0.5, 1, -1.5][i % 3]), { kind: 'recovery', cut: 1, t7: [] });
  const r = dots(C.chartHtml('recovery', rec, '2026-10-01', '2026-12-29', null, state));
  assert.equal(r.length, 60);
  assert.deepEqual([...new Set(r)].sort(), ['bad', 'good']);
  // a short window keeps every day's dot
  assert.equal(dots(C.chartHtml('hrv', banded, '2026-10-01', '2026-10-30', null, state)).length, 30);
});

test('breakdownHtml: nothing for an empty window or a metric without states; counts and widths for a small one', () => {
  const C = load();
  const banded = series([70, 50, 30, null, 70], { band: { lo: 40, hi: 60, median: 50 } });
  assert.equal(C.breakdownHtml(series([null, null, null], { band: { lo: 40, hi: 60, median: 50 } }), '2026-10-01', '2026-10-03'), '', 'no day with data');
  assert.equal(C.breakdownHtml(series([1, 2, 3]), '2026-10-01', '2026-10-03'), '', 'no band: one state only');
  assert.equal(C.breakdownHtml(series([1, 2, 3], { kind: 'load' }), '2026-10-01', '2026-10-03'), '', 'training volume: skipped');
  const html = C.breakdownHtml(banded, '2026-10-01', '2026-10-05');
  // 4 days with data: good ×2, normal ×1, bad ×1 (the null day is not counted)
  assert.ok(html.includes('<div class="dt-brk-bar" aria-hidden="true"><i class="dt-s-good" style="width:50%"></i><i class="dt-s-normal" style="width:25%"></i><i class="dt-s-bad" style="width:25%"></i></div>'), html);
  const counts = [...html.matchAll(/<li data-st="(\w+)">[^]*?<b>([^<]+)<\/b><\/li>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(counts.map((c) => c[0]), ['good', 'normal', 'bad'], 'the legend\'s order');
  assert.deepEqual(counts.map((c) => c[1]), ['2', '1', '1'].map((n) => enT.trend.brk.count.replace('{n}', n)));
});
