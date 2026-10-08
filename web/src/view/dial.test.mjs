/* Dial view-model (web/src/view/dial.mjs): pure geometry + value->arc mapping for the Inicio
 * dials. No new metric: every input is a value buildScores()/buildHealth() already bakes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as dialModule from './dial.mjs';
import {
  DIAL, fracToAngle, polar, arcPath, recoveryFrac, sleepFrac, loadFrac, loadDayFrac, buildDials,
} from './dial.mjs';

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

test('one ring language: the former 270 degree OPEN_ARC is gone; Nutrición bakes the same full ring as Inicio', () => {
  assert.equal('OPEN_ARC' in dialModule, false);
  assert.equal(arcPath(0, 1), 'M60 6A54 54 0 0 1 60 114A54 54 0 0 1 60 6', 'the ring Nutrición\'s kcal ring bakes as NUTRI_ARC');
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

test('buildDials: recovery headline = LAST NIGHT (today composite), ONE band colour (no zone arcs), 7-day trend as context', () => {
  const d = buildDials({ hasData: true, recovery: REC, load: LOAD }, HEALTH);
  const r = d.recovery;
  assert.equal(r.state, 'ok');
  assert.equal(r.mode, 'today');
  assert.equal(r.date, '2026-09-29');
  assert.equal(r.band, 'below', 'coloured by last night, not by the trend');
  assert.equal(r.value, -1.4);
  assert.equal(r.sleep, true);
  assert.equal('zones' in r, false, 'no zone arcs: the whole fill takes the band\'s one state colour');
  assert.equal(r.fill, arcPath(0, recoveryFrac(-1.4)), 'filled clockwise from 12 o\'clock to the value on the -3..+3 scale');
  assert.equal('marker' in r, false, 'no marker dot: the fill ends at the value');
  assert.deepEqual(r.mid, polar(fracToAngle(0.5), DIAL.r - DIAL.stroke), 'baseline tick at the ring\'s midpoint (6 o\'clock)');
  assert.deepEqual(r.trend, { value: 0.8, band: 'above', dir: 'steady' });
  assert.equal(d.track, arcPath(0, 1));
});

test('buildDials: with a percentage, the recovery ring fills to pct %, coloured by its % band, no baseline tick; the SD value rides along', () => {
  const rec = { ...REC, today: { ...REC.today, pct: 85, pctBand: 'good', pctDays: 90 } };
  const r = buildDials({ hasData: true, recovery: rec, load: LOAD }, HEALTH).recovery;
  assert.equal(r.mode, 'today');
  assert.equal(r.pct, 85);
  assert.equal(r.band, 'good', 'the % band (good / mid / low), not the SD day band');
  assert.equal(r.fill, arcPath(0, 0.85), 'ring fill = score %');
  assert.equal(r.mid, null, 'no baseline tick on a % ring');
  assert.equal(r.value, -1.4, 'the SD composite is kept for the notes');
  assert.equal(buildDials({ hasData: true, recovery: { ...rec, today: { ...rec.today, pct: 0, pctBand: 'low' } }, load: LOAD }, HEALTH).recovery.fill, '', '0 % = an empty ring');
});

test('buildDials: no percentage (under 21 prior days) keeps the SD ring and band (pct null)', () => {
  const r = buildDials({ hasData: true, recovery: { ...REC, today: { ...REC.today, pct: null, pctBand: null } }, load: LOAD }, HEALTH).recovery;
  assert.equal(r.pct, null);
  assert.equal(r.band, 'below');
  assert.equal(r.fill, arcPath(0, recoveryFrac(-1.4)));
});

test('buildDials: no composite for last night -> the dial shows the 7-day trend, flagged mode "trend" (never faked)', () => {
  const r = buildDials({ hasData: true, recovery: { ...REC, today: null }, load: LOAD }, HEALTH).recovery;
  assert.equal(r.state, 'ok');
  assert.equal(r.mode, 'trend');
  assert.equal(r.value, 0.8);
  assert.equal(r.band, 'above');
  assert.equal(r.date, null);
  assert.equal(r.fill, arcPath(0, recoveryFrac(0.8)));
  assert.equal('zones' in r, false);
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
  assert.equal(s.pct, 91, 'sleep performance = asleep / need (the target) x 100, lib/score/sleep.mjs');
  const full = buildDials({ hasData: true, recovery: { ...REC, components: [{ key: 'sleepDur', daily: [{ date: '2026-09-29', value: 9.1 }] }] }, load: LOAD }, HEALTH).sleep;
  assert.equal(full.pct, 100, 'capped at 100');
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
  // the deep-dive hero's typical-day tick: a radial line across the stroke at the ring midpoint
  const a = polar(fracToAngle(0.5), DIAL.r - DIAL.stroke / 2 - 1);
  const b = polar(fracToAngle(0.5), DIAL.r + DIAL.stroke / 2 + 1);
  assert.deepEqual(l.tick, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  assert.deepEqual(l.tick, { x1: 60, y1: 109.5, x2: 60, y2: 118.5 }, '6 o\'clock, crossing the 7-unit stroke');
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

test('past days (day stepping): one sleep + recovery dial per SCORES.days entry, in today\'s shapes', () => {
  const scores = {
    hasData: true,
    recovery: null,
    load: null,
    days: {
      from: '2026-09-27', to: '2026-09-29', days: [
        { date: '2026-09-27', sleep: null, rec: 'gated', monitor: {} },
        { date: '2026-09-28', sleep: 6.9, rec: { value: 0.4, band: 'at', sleep: true, pct: 72, pctBand: 'good' }, monitor: {} },
        { date: '2026-09-29', sleep: 8.4, rec: { value: -1.4, band: 'below', sleep: true }, monitor: {} },
      ],
    },
  };
  const D = buildDials(scores, { recovery: { sleep: { target: 7.5 } } });
  assert.deepEqual(D.days.map((d) => d.date), ['2026-09-27', '2026-09-28', '2026-09-29']);
  assert.deepEqual(D.days[0].recovery, { state: 'gated', asOf: '2026-09-27' });
  assert.deepEqual(D.days[0].sleep, { state: 'none' });
  const r = D.days[1].recovery;
  assert.equal(r.state, 'ok');
  assert.equal(r.mode, 'today');
  assert.equal(r.date, '2026-09-28');
  assert.equal(r.pct, 72);
  assert.equal(r.band, 'good', 'with a % the ring takes the % band');
  assert.equal(r.fill, arcPath(0, 0.72));
  assert.equal(r.mid, null);
  const s = D.days[1].sleep;
  assert.deepEqual(s, { state: 'ok', date: '2026-09-28', hours: 6.9, target: 7.5, pct: 92, fill: arcPath(0, 6.9 / 7.5) });
  // without a % (under 21 prior days): the SD composite on the -3..+3 ring with the baseline tick
  const f = D.days[2].recovery;
  assert.equal(f.pct, null);
  assert.equal(f.band, 'below');
  assert.equal(f.fill, arcPath(0, recoveryFrac(-1.4)));
  assert.ok(f.mid);
  assert.equal(D.days[2].sleep.pct, 100, 'capped at the need');
});

test('past days: none without SCORES.days or without data', () => {
  assert.deepEqual(buildDials({ hasData: true }, null).days, []);
  assert.deepEqual(buildDials({ hasData: false, days: { days: [{ date: '2026-09-29', sleep: 7, rec: null }] } }, null).days, []);
  const D = buildDials({ hasData: true, days: { days: [{ date: '2026-09-29', sleep: null, rec: null }] } }, null);
  assert.deepEqual(D.days[0], { date: '2026-09-29', sleep: { state: 'none' }, recovery: { state: 'none' } });
});
