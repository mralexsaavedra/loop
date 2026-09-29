/* Dial view-model (web/src/view/dial.mjs): pure geometry + value->arc mapping for the Inicio
 * dials. No new metric: every input is a value buildScores()/buildHealth() already bakes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAL, fracToAngle, polar, arcPath, recoveryFrac, sleepFrac, loadFrac, loadDayFrac, buildDials,
} from './dial.mjs';
import { BAND_CUTOFF } from '../../../lib/score/recovery.mjs';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

test('fracToAngle: a 270 degree open arc from bottom-left (135) clockwise to bottom-right (405)', () => {
  assert.equal(DIAL.sweep, 270);
  assert.equal(fracToAngle(0), 135);
  assert.equal(fracToAngle(0.5), 270); // top centre
  assert.equal(fracToAngle(1), 405);
  assert.equal(fracToAngle(-1), 135, 'clamped below');
  assert.equal(fracToAngle(2), 405, 'clamped above');
});

test('polar: the arc midpoint sits straight above the centre', () => {
  const p = polar(270);
  near(p.x, DIAL.c);
  near(p.y, DIAL.c - DIAL.r);
});

test('arcPath: sweep flag follows direction, large-arc flag only past 180 degrees, empty when zero-length', () => {
  assert.equal(arcPath(0.3, 0.3), '');
  const fwd = arcPath(0, 0.5); // 135 degrees
  assert.match(fwd, /^M[\d.]+ [\d.]+A50 50 0 0 1 [\d.]+ [\d.]+$/);
  assert.match(arcPath(0, 1), / 0 1 1 /, '270 degrees -> large arc');
  assert.match(arcPath(0.5, 0.2), / 0 0 0 /, 'backwards -> counter-clockwise');
});

test('recoveryFrac: 0 MAD is the midpoint, +-3 are the ends, beyond is clamped', () => {
  assert.equal(recoveryFrac(0), 0.5);
  assert.equal(recoveryFrac(3), 1);
  assert.equal(recoveryFrac(-3), 0);
  assert.equal(recoveryFrac(9), 1);
  assert.equal(recoveryFrac(-9), 0);
  assert.equal(recoveryFrac(null), null);
});

test('sleepFrac: measured hours over the stated target, capped at a full arc, null without data', () => {
  assert.equal(sleepFrac(7.5, 7.5), 1);
  near(sleepFrac(6, 7.5), 0.8);
  assert.equal(sleepFrac(9.2, 7.5), 1, 'capped at 100 % of the arc');
  assert.equal(sleepFrac(null, 7.5), null);
  assert.equal(sleepFrac(6, null), null);
});

test('loadDayFrac: the day RE over twice the typical training day; typical is the arc midpoint', () => {
  assert.equal(loadDayFrac(110, 110), 0.5);
  assert.equal(loadDayFrac(220, 110), 1);
  assert.equal(loadDayFrac(500, 110), 1, 'capped');
  assert.equal(loadDayFrac(0, 110), 0, 'a rest day sits at the start');
  assert.equal(loadDayFrac(50, null), null, 'no typical day -> no position');
  assert.equal(loadDayFrac(50, 0), null);
  assert.equal(loadFrac(1), 0.5);
  assert.equal(loadFrac(2), 1);
});

const REC = { asOf: '2026-09-29', gated: false, band: 'above', trend7: 0.8, delta7: 0.1, trendDir: 'steady',
  today: { date: '2026-09-29', value: -0.7, band: 'below' }, components: [
  { key: 'hrv', daily: [{ date: '2026-09-29', value: 61 }] },
  { key: 'sleepDur', daily: [{ date: '2026-09-28', value: 7.1 }, { date: '2026-09-29', value: 6.8 }] },
] };
const mod = (key, trend, load = 0, typical = { value: null, n: 0 }) => ({ key, trend, load, typical });
const LOAD = { asOf: '2026-09-29', modalities: [
  mod('gym', { ok: false, reason: 'baselineBuilding', trendPct: null, band: null }, 30, { value: 40, n: 9 }),
  mod('run', { ok: true, trendPct: 20, band: 'above' }, 132, { value: 110, n: 12 }),
  mod('bike', { ok: true, trendPct: -40, band: 'detraining' }, 0, { value: 90, n: 6 }),
] };
const HEALTH = { recovery: { hasData: true, sleep: { target: 7.5 } } };

test('buildDials: recovery headline = LAST NIGHT (today composite), zones split at +-BAND_CUTOFF, 7-day trend as context', () => {
  const d = buildDials({ hasData: true, recovery: REC, load: LOAD }, HEALTH);
  const r = d.recovery;
  assert.equal(r.state, 'ok');
  assert.equal(r.mode, 'today');
  assert.equal(r.date, '2026-09-29');
  assert.equal(r.band, 'below', 'coloured by last night, not by the trend');
  assert.equal(r.value, -0.7);
  assert.deepEqual(r.zones.map((z) => z.band), ['below', 'at', 'above']);
  assert.equal(r.zones[1].d, arcPath(recoveryFrac(-BAND_CUTOFF), recoveryFrac(BAND_CUTOFF)));
  assert.equal(r.fill, arcPath(0.5, recoveryFrac(-0.7)), 'filled from baseline (centre) to the marker');
  assert.deepEqual(r.marker, polar(fracToAngle(recoveryFrac(-0.7))));
  assert.deepEqual(r.trend, { value: 0.8, band: 'above', dir: 'steady' });
  assert.equal(d.track, arcPath(0, 1));
});

test('buildDials: no composite for last night -> the dial shows the 7-day trend, flagged mode "trend" (never faked)', () => {
  const r = buildDials({ hasData: true, recovery: { ...REC, today: null }, load: LOAD }, HEALTH).recovery;
  assert.equal(r.state, 'ok');
  assert.equal(r.mode, 'trend');
  assert.equal(r.value, 0.8);
  assert.equal(r.band, 'above');
  assert.equal(r.date, null);
  assert.equal(r.fill, arcPath(0.5, recoveryFrac(0.8)));
});

test('buildDials: gated / missing recovery carries no number', () => {
  const g = buildDials({ hasData: true, recovery: { asOf: '2026-09-29', gated: true }, load: null }, HEALTH);
  assert.equal(g.recovery.state, 'gated');
  assert.equal(g.recovery.value, undefined);
  assert.equal(g.recovery.fill, undefined);
  assert.equal(buildDials({ hasData: false }, null).recovery.state, 'none');
});

test('buildDials: sleep = the newest night of the sleep-duration component over the baked target', () => {
  const s = buildDials({ hasData: true, recovery: REC, load: LOAD }, HEALTH).sleep;
  assert.equal(s.state, 'ok');
  assert.equal(s.hours, 6.8);
  assert.equal(s.date, '2026-09-29');
  assert.equal(s.target, 7.5);
  assert.equal(s.fill, arcPath(0, sleepFrac(6.8, 7.5)));
  const none = buildDials({ hasData: true, recovery: REC, load: LOAD }, { recovery: { hasData: false } }).sleep;
  assert.equal(none.state, 'none', 'no stated target -> no dial number');
});

test('buildDials: load = the asOf day RE vs the typical training day, per modality (never summed); default = first ungated', () => {
  const l = buildDials({ hasData: true, recovery: REC, load: LOAD }, HEALTH).load;
  assert.equal(l.state, 'ok');
  assert.deepEqual(l.modalities.map((m) => m.key), ['gym', 'run', 'bike']);
  assert.equal(l.defaultKey, 'run');
  const gym = l.modalities[0];
  assert.equal(gym.state, 'gated', 'baselineBuilding gating is kept even with a typical day');
  assert.equal(gym.reason, 'baselineBuilding');
  assert.equal(gym.day, undefined);
  const run = l.modalities[1];
  assert.equal(run.state, 'ok');
  assert.equal(run.day, 132);
  assert.equal(run.typical, 110);
  assert.equal(run.rest, false);
  assert.equal(run.fill, arcPath(0, loadDayFrac(132, 110)));
  assert.deepEqual(run.marker, polar(fracToAngle(loadDayFrac(132, 110))));
  assert.equal(run.trendPct, 20, 'acute/chronic stays as the context line');
  assert.equal(run.band, 'above');
  assert.equal('zones' in l, false, 'the old trend-band zones do not apply to a day-vs-typical scale');
  assert.deepEqual(l.mid, polar(fracToAngle(0.5), DIAL.r - DIAL.stroke));
});

test('buildDials: a rest day (0 RE) reads as rest: no fill, no marker, still has its typical day', () => {
  const bike = buildDials({ hasData: true, recovery: REC, load: LOAD }, HEALTH).load.modalities[2];
  assert.equal(bike.state, 'ok');
  assert.equal(bike.rest, true);
  assert.equal(bike.day, 0);
  assert.equal(bike.typical, 90);
  assert.equal(bike.fill, '');
  assert.equal(bike.marker, null);
});

test('buildDials: an ok trend without enough recent training days has no "normal" -> gated fewDays', () => {
  const few = { asOf: '2026-09-29', modalities: [mod('run', { ok: true, trendPct: 5, band: 'steady' }, 40, { value: null, n: 2 })] };
  const run = buildDials({ hasData: true, recovery: REC, load: few }, HEALTH).load.modalities[0];
  assert.equal(run.state, 'gated');
  assert.equal(run.reason, 'fewDays');
});

test('buildDials: all modalities gated -> default is the first one, still greyed', () => {
  const all = { asOf: '2026-09-29', modalities: LOAD.modalities.map((m) => mod(m.key, { ok: false, reason: 'baselineBuilding' })) };
  const l = buildDials({ hasData: true, recovery: REC, load: all }, HEALTH).load;
  assert.equal(l.defaultKey, 'gym');
  assert.ok(l.modalities.every((m) => m.state === 'gated'));
});

test('buildDials is deterministic and JSON-safe (idempotent builds)', () => {
  const a = JSON.stringify(buildDials({ hasData: true, recovery: REC, load: LOAD }, HEALTH));
  const b = JSON.stringify(buildDials({ hasData: true, recovery: REC, load: LOAD }, HEALTH));
  assert.equal(a, b);
  assert.doesNotMatch(a, /NaN|Infinity/);
});
