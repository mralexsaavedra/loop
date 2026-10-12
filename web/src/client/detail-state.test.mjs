/* Tests for the detail sheet's data / state helpers (web/src/client/detail-state.js,
 * window.HCDetailState): the classic script runs in a vm after util.js, over small hand-made series and
 * a fixed clock, so the window maths, the 7-day line, the partial-today rule and the formatting are
 * checked without the sheet. The sheet itself (periodStats and dayState through window.HCDetail, the
 * rendered views) is covered by detail.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { en as enT } from '../i18n/detail-templates.mjs';
import { loadUtil, HC_CONST_BAKE } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'detail-state.js'), 'utf8');
const TODAY = '2026-10-10';

function load({ now = TODAY, D = { asOf: TODAY, metrics: {}, sessions: [] }, settings = null } = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now + 'T12:00:00'])); }
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const win = {};
  if (settings) win.HCSettings = settings;
  const ctx = vm.createContext({ window: win, LOCALE: 'en', Date: FakeDate, Math, String, Number, Array, Object, JSON, isFinite });
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return win.HCDetailState(enT, D);
}
// a dense daily series ending on TODAY (index 0 = start)
const series = (v, extra = {}) => ({ start: '2026-10-01', v, dec: 0, kind: 'signal', dir: 1, ...extra });

test('detail-state.js defines only window.HCDetailState, and reads nothing else at load', () => {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(source, ctx);
  assert.equal(typeof ctx.window.HCDetailState, 'function');
  assert.deepEqual(Object.keys(ctx.window), ['HCDetailState']);
});

test('clock: hours as hh:mm, wrapping past midnight and rounding 59.5 min up to the next hour', () => {
  const S = load();
  assert.equal(S.clock(23.5), '23:30');
  assert.equal(S.clock(25.25), '01:15');
  assert.equal(S.clock(-1), '23:00');
  assert.equal(S.clock(6 + 59.6 / 60), '07:00');
  assert.equal(S.clock(null), '—');
  assert.equal(S.clock(NaN), '—');
});

test('roll7: the mean of the last 7 days with data, null under 3 days', () => {
  const S = load();
  const m = series([10, null, 20, null, null, 30, null, 40, null, 50]);
  // 2026-10-10 looks back to 10-04: 30 (10-06), 40 (10-08), 50 (10-10)
  assert.equal(S.roll7(m, '2026-10-10'), 40);
  // 2026-10-04 looks back to 09-28: 10, 20 only
  assert.equal(S.roll7(m, '2026-10-04'), null);
});

test('meanOf / periodStats skip a daily total\'s today, still filling up', () => {
  const S = load();
  const m = series([100, 100, 100, 100, 100, 100, 100, 100, 100, 5], { kind: 'total' });
  assert.ok(S.isPartial(m, TODAY));
  assert.equal(S.isPartial(m, '2026-10-09'), false);
  assert.deepEqual({ ...S.meanOf(m, '2026-10-04', TODAY) }, { avg: 100, n: 6 });
  assert.equal(S.stateOn(m, TODAY, 5), 'partial');
  assert.equal(S.stateOn(series([1], { kind: 'signal', band: null }), TODAY, 5), 'normal', 'only totals are partial');
});

test('windowFrom clamps to the data\'s first day; windowEnd steps whole windows back', () => {
  const S = load();
  const m = series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(S.windowFrom(m, TODAY, 7), '2026-10-04');
  assert.equal(S.windowFrom(m, TODAY, 30), '2026-10-01');
  assert.equal(S.windowEnd(m, TODAY, 7, 0), TODAY);
  assert.equal(S.windowEnd(m, TODAY, 7, 1), '2026-10-03');
});

test('lastDataDate: the newest day with a value, never after the end', () => {
  const S = load();
  const m = series([1, null, 3, null, null]);
  assert.equal(S.lastDataDate(m, TODAY), '2026-10-03');
  assert.equal(S.lastDataDate(m, '2026-10-02'), '2026-10-01');
  assert.equal(S.lastDataDate(series([null, null]), TODAY), null);
});

test('lineFor: recovery reads its baked trend, a sparse series has none, the rest roll7; cached per view', () => {
  const S = load();
  const rec = series([0.1, 0.2, 0.3], { kind: 'recovery', t7: [null, 0.5, 0.6] });
  assert.deepEqual([...S.lineFor('recovery', rec, '2026-10-01', 3)], [null, 0.5, 0.6]);
  assert.deepEqual([...S.lineFor('weight', series([70, null, 71], { kind: 'sparse' }), '2026-10-01', 3)], [null, null, null]);
  const m = series([10, 20, 30, 40]);
  const a = S.lineFor('rhr', m, '2026-10-01', 4);
  assert.deepEqual([...a], [null, null, 20, 25]);
  assert.equal(S.lineFor('rhr', m, '2026-10-01', 4), a, 'the same array on a re-render');
  assert.notEqual(load().lineFor('rhr', m, '2026-10-01', 4), a, 'each HCDetailState instance has its own cache');
});

test('viewEnd: today, or the data\'s asOf when stale or ahead of the clock', () => {
  assert.deepEqual({ ...load({ D: { asOf: '2026-10-09', metrics: {} } }).viewEnd() }, { end: TODAY, stale: false });
  const old = '2026-09-01';
  assert.deepEqual({ ...load({ D: { asOf: old, metrics: {} } }).viewEnd() }, { end: old, stale: true });
  assert.ok(HC_CONST_BAKE.staleDays < 39, 'the stale case above is past STALE_DAYS');
  assert.deepEqual({ ...load({ D: { asOf: '2026-10-12', metrics: {} } }).viewEnd() }, { end: '2026-10-12', stale: false });
  assert.deepEqual({ ...load({ D: { asOf: null, metrics: {} } }).viewEnd() }, { end: TODAY, stale: false });
});

test('monthOf / addMonths walk calendar months from the first', () => {
  const S = load();
  assert.equal(S.monthOf('2026-10-31'), '2026-10-01');
  assert.equal(S.addMonths('2026-10-01', 1), '2026-11-01');
  assert.equal(S.addMonths('2026-01-01', -1), '2025-12-01');
  assert.equal(S.addMonths('2026-12-01', 1), '2027-01-01');
});

test('targetOf: a baked target, else the user\'s target weight (only on weight, only when settings are ready)', () => {
  const ready = { ready: () => true, targetWeight: () => 72.5 };
  assert.equal(load().targetOf('sleep', { target: 8 }), 8);
  assert.equal(load({ settings: ready }).targetOf('weight', {}), 72.5);
  assert.equal(load({ settings: ready }).targetOf('bodyfat', {}), null);
  assert.equal(load({ settings: { ready: () => false, targetWeight: () => 72.5 } }).targetOf('weight', {}), null);
  assert.equal(load().targetOf('weight', {}), null);
});

test('formatting: a dash for no value, sleep hours as h:mm, units from the copy (hours carry none)', () => {
  const S = load();
  assert.equal(S.fmt(null, 1), '—');
  assert.equal(S.fmt(NaN, 1), '—');
  assert.equal(S.valUnit(null, 0, 'bpm'), '—');
  assert.equal(S.valUnit(52, 0, 'bpm'), '52 bpm');
  assert.equal(S.fmtM({ kind: 'sleep' }, 7.5, 1), '7:30');
  assert.equal(S.unitOf('sleep'), '');
  assert.equal(S.unitOf('rhr'), enT.metrics.rhr.unit);
  assert.equal(S.unitOf('constructor'), '', 'own keys only');
  assert.equal(S.titleOf('rhr'), enT.metrics.rhr.title);
  assert.equal(S.titleOf('nope'), 'nope');
});

test('legendItems: the calendar states in the legend\'s order, per metric kind', () => {
  const S = load();
  const states = (m) => [...S.legendItems(m)].map((it) => it[0]);
  assert.deepEqual(states({ kind: 'load' }), ['l1', 'l2', 'l3', 'l4']);
  assert.deepEqual(states({ kind: 'recovery' }), ['good', 'normal', 'bad']);
  assert.deepEqual(states({ kind: 'total', dir: 0, band: { lo: 1, hi: 2 } }), ['hi', 'normal', 'lo']);
  assert.deepEqual(states({ kind: 'signal', dir: 0, band: { lo: 1, hi: 2 } }), ['normal', 'watch']);
  assert.deepEqual(states({ kind: 'signal', dir: 1 }), ['normal'], 'no band: measured only');
});

test('metric: an own DETAIL key with an ISO start, never an inherited name', () => {
  const S = load({ D: { asOf: TODAY, metrics: { rhr: series([50]), bad: { start: 'x', v: [] } } } });
  assert.ok(S.metric('rhr'));
  assert.equal(S.metric('bad'), null);
  assert.equal(S.metric('toString'), null);
  assert.equal(S.metric('stress'), null, 'no SCORES baked');
});
