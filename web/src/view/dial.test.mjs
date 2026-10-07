/* Dial view-model (web/src/view/dial.mjs): pure geometry + value->arc mapping for the Inicio
 * dials. No new metric: every input is a value buildScores()/buildHealth() already bakes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAL, OPEN_ARC, fracToAngle, polar, arcPath, recoveryFrac, sleepFrac, loadFrac, loadDayFrac, buildDials,
} from './dial.mjs';
import { BAND_CUTOFF, DAY_BAND_CUTOFF } from '../../../lib/score/recovery.mjs';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

test('fracToAngle: a full ring from 12 o\'clock (-90) clockwise back to 12 o\'clock (270)', () => {
  assert.equal(DIAL.sweep, 360);
  assert.equal(fracToAngle(0), -90);
  assert.equal(fracToAngle(0.5), 90); // 6 o'clock
  assert.equal(fracToAngle(1), 270);
  assert.equal(fracToAngle(-1), -90, 'clamped below');
  assert.equal(fracToAngle(2), 270, 'clamped above');
});

test('polar: the ring starts straight above the centre; its midpoint is straight below', () => {
  const top = polar(-90);
  near(top.x, DIAL.c);
  near(top.y, DIAL.c - DIAL.r);
  const bottom = polar(90);
  near(bottom.x, DIAL.c);
  near(bottom.y, DIAL.c + DIAL.r);
});

test('ring geometry: thin stroke (~6 % of the ring\'s diameter) that fits the 120-unit viewBox', () => {
  const ratio = DIAL.stroke / (2 * DIAL.r);
  assert.ok(ratio >= 0.05 && ratio <= 0.075, `stroke ratio ${ratio}`);
  assert.ok(DIAL.c + DIAL.r + DIAL.stroke / 2 <= 120, 'the stroke stays inside the viewBox');
});

test('arcPath: sweep flag follows direction, large-arc flag only past 180 degrees, empty when zero-length', () => {
  assert.equal(arcPath(0.3, 0.3), '');
  const fwd = arcPath(0, 0.25); // 90 degrees
  assert.match(fwd, new RegExp(`^M[\\d.]+ [\\d.]+A${DIAL.r} ${DIAL.r} 0 0 1 [\\d.]+ [\\d.]+$`));
  assert.match(arcPath(0, 0.75), / 0 1 1 /, '270 degrees -> large arc');
  assert.match(arcPath(0.5, 0.2), / 0 0 0 /, 'backwards -> counter-clockwise');
});

test('arcPath: a full ring is drawn as two half arcs (one SVG arc cannot start and end on the same point)', () => {
  const full = arcPath(0, 1);
  assert.equal((full.match(/A/g) || []).length, 2);
  assert.ok(full.startsWith(`M${DIAL.c} ${DIAL.c - DIAL.r}`), 'starts at 12 o\'clock');
  assert.ok(full.includes(`${DIAL.c} ${DIAL.c + DIAL.r}`), 'passes through 6 o\'clock');
  assert.ok(full.endsWith(`${DIAL.c} ${DIAL.c - DIAL.r}`), 'and closes at 12 o\'clock');
});

test('OPEN_ARC (Nutrición\'s kcal dial only): the former 270 degree arc, unchanged', () => {
  assert.equal(arcPath(0, 1, OPEN_ARC), 'M24.64 95.36A50 50 0 1 1 95.36 95.36');
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
  today: { date: '2026-09-29', value: -1.4, band: 'below', sleep: true }, components: [
  { key: 'hrv', daily: [{ date: '2026-09-29', value: 61 }] },
  { key: 'sleepDur', daily: [{ date: '2026-09-28', value: 7.1 }, { date: '2026-09-29', value: 6.8 }] },
] };
const mod = (key, trend, recent = [], typical = { value: null, n: 0 }, last = null) => ({ key, trend, recent, typical, last });
const LOAD = { asOf: '2026-09-29', modalities: [
  mod('gym', { ok: false, reason: 'baselineBuilding', trendPct: null, band: null }, [{ date: '2026-09-29', re: 30, unscored: 0 }], { value: 40, n: 9 }),
  mod('run', { ok: true, trendPct: 20, band: 'above' }, [{ date: '2026-09-27', re: 0, unscored: 1 }, { date: '2026-09-29', re: 132, unscored: 0 }], { value: 110, n: 12 }, { date: '2026-09-29', re: 132 }),
  mod('bike', { ok: true, trendPct: -40, band: 'wellBelow' }, [], { value: 90, n: 6 }, { date: '2026-09-01', re: 70 }),
] };
const HEALTH = { recovery: { hasData: true, sleep: { target: 7.5 } } };

test('buildDials: recovery headline = LAST NIGHT (today composite), zones split at +-BAND_CUTOFF, 7-day trend as context', () => {
  const d = buildDials({ hasData: true, recovery: REC, load: LOAD }, HEALTH);
  const r = d.recovery;
  assert.equal(r.state, 'ok');
  assert.equal(r.mode, 'today');
  assert.equal(r.date, '2026-09-29');
  assert.equal(r.band, 'below', 'coloured by last night, not by the trend');
  assert.equal(r.value, -1.4);
  assert.equal(r.sleep, true);
  assert.deepEqual(r.zones.map((z) => z.band), ['below', 'at', 'above']);
  assert.equal(r.zones[1].d, arcPath(recoveryFrac(-DAY_BAND_CUTOFF), recoveryFrac(DAY_BAND_CUTOFF)), 'single-day zones are cut at DAY_BAND_CUTOFF');
  assert.equal(r.fill, arcPath(0, recoveryFrac(-1.4)), 'filled clockwise from 12 o\'clock to the value on the -3..+3 scale');
  assert.equal('marker' in r, false, 'no marker dot: the fill ends at the value');
  assert.deepEqual(r.mid, polar(fracToAngle(0.5), DIAL.r - DIAL.stroke), 'baseline tick at the ring\'s midpoint (6 o\'clock)');
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
  assert.equal(r.fill, arcPath(0, recoveryFrac(0.8)));
  assert.equal(r.zones[1].d, arcPath(recoveryFrac(-BAND_CUTOFF), recoveryFrac(BAND_CUTOFF)), 'trend zones stay at BAND_CUTOFF');
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

test('buildDials: load bakes the typical day + each recent session day with its geometry; the client picks today', () => {
  const l = buildDials({ hasData: true, recovery: REC, load: LOAD }, HEALTH).load;
  assert.equal(l.state, 'ok');
  assert.deepEqual(l.modalities.map((m) => m.key), ['gym', 'run', 'bike']);
  assert.equal(l.defaultKey, 'run');
  const gym = l.modalities[0];
  assert.equal(gym.state, 'gated', 'baselineBuilding gating is kept even with a typical day');
  assert.equal(gym.reason, 'baselineBuilding');
  assert.ok(Array.isArray(gym.days), 'a gated modality still carries its session days (the switch can open on today\'s session)');
  assert.ok(gym.days.every((d) => !('fill' in d)), 'but no geometry: a gated dial shows no number');
  const run = l.modalities[1];
  assert.equal(run.state, 'ok');
  assert.equal(run.typical, 110);
  assert.equal(run.trendPct, 20, 'acute/chronic stays as the context line');
  assert.equal(run.band, 'above');
  assert.deepEqual(run.last, { date: '2026-09-29', re: 132 });
  const [unscored, trained] = run.days;
  assert.deepEqual(unscored, { date: '2026-09-27', re: 0, unscored: 1 }, 'rows without RE: no geometry, flagged unscored');
  assert.equal(trained.fill, arcPath(0, loadDayFrac(132, 110)));
  assert.equal('marker' in trained, false, 'no marker dot');
  assert.deepEqual(l.modalities[2].days, [], 'no sessions in the last two weeks');
  assert.equal('zones' in l, false, 'the old trend-band zones do not apply to a day-vs-typical scale');
  assert.deepEqual(l.mid, polar(fracToAngle(0.5), DIAL.r - DIAL.stroke));
});

test('buildDials: an ok trend without enough recent training days has no "normal" -> gated fewDays', () => {
  const few = { asOf: '2026-09-29', modalities: [mod('run', { ok: true, trendPct: 5, band: 'steady' }, [], { value: null, n: 2 })] };
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
