/* Dial view-model (web/src/view/dial.mjs): pure geometry + value->arc mapping for the Inicio
 * dials. No new metric: every input is a value buildScores()/buildHealth() already bakes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAL, fracToAngle, polar, arcPath, recoveryFrac, sleepFrac, loadFrac, loadRatio, buildDials,
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

test('loadRatio/loadFrac: ratio = acute/chronic as trendPct expresses it; 1.0x is the arc midpoint', () => {
  assert.equal(loadRatio({ ok: true, trendPct: 20 }), 1.2);
  assert.equal(loadRatio({ ok: true, trendPct: -35 }), 0.65);
  assert.equal(loadRatio({ ok: false, trendPct: null }), null, 'gated -> no number');
  assert.equal(loadRatio(null), null);
  assert.equal(loadFrac(1), 0.5);
  assert.equal(loadFrac(2), 1);
  assert.equal(loadFrac(3), 1, 'capped');
  assert.equal(loadFrac(0), 0);
});

const REC = { asOf: '2026-09-29', gated: false, band: 'above', trend7: 0.8, components: [
  { key: 'hrv', daily: [{ date: '2026-09-29', value: 61 }] },
  { key: 'sleepDur', daily: [{ date: '2026-09-28', value: 7.1 }, { date: '2026-09-29', value: 6.8 }] },
] };
const mod = (key, trend) => ({ key, trend });
const LOAD = { asOf: '2026-09-29', modalities: [
  mod('gym', { ok: false, reason: 'baselineBuilding', trendPct: null, band: null }),
  mod('run', { ok: true, trendPct: 20, band: 'above' }),
  mod('bike', { ok: true, trendPct: -40, band: 'detraining' }),
] };
const HEALTH = { recovery: { hasData: true, sleep: { target: 7.5 } } };

test('buildDials: recovery zones split at +-BAND_CUTOFF, marker at the clamped 7-day trend', () => {
  const d = buildDials({ hasData: true, recovery: REC, load: LOAD }, HEALTH);
  const r = d.recovery;
  assert.equal(r.state, 'ok');
  assert.equal(r.band, 'above');
  assert.equal(r.value, 0.8);
  assert.deepEqual(r.zones.map((z) => z.band), ['below', 'at', 'above']);
  assert.equal(r.zones[1].d, arcPath(recoveryFrac(-BAND_CUTOFF), recoveryFrac(BAND_CUTOFF)));
  assert.equal(r.fill, arcPath(0.5, recoveryFrac(0.8)), 'filled from baseline (centre) to the marker');
  assert.deepEqual(r.marker, polar(fracToAngle(recoveryFrac(0.8))));
  assert.equal(d.track, arcPath(0, 1));
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

test('buildDials: load keeps one entry per modality (never summed); default = first ungated', () => {
  const l = buildDials({ hasData: true, recovery: REC, load: LOAD }, HEALTH).load;
  assert.equal(l.state, 'ok');
  assert.deepEqual(l.modalities.map((m) => m.key), ['gym', 'run', 'bike']);
  assert.equal(l.defaultKey, 'run');
  const gym = l.modalities[0];
  assert.equal(gym.state, 'gated');
  assert.equal(gym.reason, 'baselineBuilding');
  assert.equal(gym.ratio, undefined);
  const run = l.modalities[1];
  assert.equal(run.ratio, 1.2);
  assert.equal(run.band, 'above');
  assert.equal(run.fill, arcPath(0, 0.6));
  assert.deepEqual(l.zones.map((z) => z.band), ['detraining', 'below', 'steady', 'above', 'ramping']);
  assert.deepEqual(l.mid, polar(fracToAngle(0.5), DIAL.r - DIAL.stroke));
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
