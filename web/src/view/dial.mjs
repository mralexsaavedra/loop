/* Inicio dial view-model: 270 degree open-arc geometry + value->arc mapping for the Sleep,
 * Recovery and Load dials. Pure presentation glue over values buildScores()/buildHealth() already
 * produce (recovery 7-day trend + band, per-modality trend band/trendPct, the sleep-duration
 * component's newest night, the stated sleep target). No new metric and no percentage score.
 * Baked by components/Bake.astro as DIALS; client/score.js turns it into inline SVG. */
import { BAND_CUTOFF } from '../../../lib/score/recovery.mjs';
import { RAMPING_PCT, ABOVE_PCT, EASING_PCT, DETRAINING_PCT } from '../../../lib/score/load.mjs';

// 120-unit viewBox, 50-unit radius, 10-unit stroke; the arc opens at the bottom.
export const DIAL = { c: 60, r: 50, stroke: 10, start: 135, sweep: 270 };
// The recovery trend is already clamped per signal at +-3 MAD; the dial uses the same range.
const RECOVERY_CLAMP = 3;
// Load: the arc midpoint is 1.0x (this week = the six-week norm), the end is 2x.
const LOAD_MAX_RATIO = 2;

const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function fracToAngle(f) {
  return DIAL.start + DIAL.sweep * clamp(f, 0, 1);
}

export function polar(angle, r = DIAL.r) {
  const a = (angle * Math.PI) / 180;
  return { x: r2(DIAL.c + r * Math.cos(a)), y: r2(DIAL.c + r * Math.sin(a)) };
}

/** SVG path for the arc between two fractions of the sweep (direction preserved). */
export function arcPath(f0, f1) {
  const a0 = fracToAngle(f0);
  const a1 = fracToAngle(f1);
  if (a0 === a1) return '';
  const p0 = polar(a0);
  const p1 = polar(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M${p0.x} ${p0.y}A${DIAL.r} ${DIAL.r} 0 ${large} ${sweep} ${p1.x} ${p1.y}`;
}

export function recoveryFrac(v) {
  return isNum(v) ? (clamp(v, -RECOVERY_CLAMP, RECOVERY_CLAMP) + RECOVERY_CLAMP) / (2 * RECOVERY_CLAMP) : null;
}

export function sleepFrac(hours, target) {
  return isNum(hours) && isNum(target) && target > 0 ? clamp(hours / target, 0, 1) : null;
}

/** acute/chronic, exactly as the baked trendPct states it (the value the band was cut from). */
export function loadRatio(trend) {
  return trend && trend.ok && isNum(trend.trendPct) ? r2(1 + trend.trendPct / 100) : null;
}

export function loadFrac(ratio) {
  return clamp(ratio / LOAD_MAX_RATIO, 0, 1);
}

function zones(edges, bands, toFrac) {
  const cuts = [0, ...edges.map(toFrac), 1];
  return bands.map((band, i) => ({ band, d: arcPath(cuts[i], cuts[i + 1]) }));
}

function recoveryDial(R) {
  if (!R) return { state: 'none' };
  if (R.gated || !isNum(R.trend7)) return { state: 'gated', asOf: R.asOf || null };
  const f = recoveryFrac(R.trend7);
  return {
    state: 'ok',
    asOf: R.asOf || null,
    band: R.band,
    value: R.trend7,
    zones: zones([-BAND_CUTOFF, BAND_CUTOFF], ['below', 'at', 'above'], recoveryFrac),
    fill: arcPath(0.5, f),
    marker: polar(fracToAngle(f)),
  };
}

function sleepDial(R, H) {
  const target = H && H.recovery && H.recovery.sleep ? H.recovery.sleep.target : null;
  const comp = R && Array.isArray(R.components) ? R.components.find((c) => c.key === 'sleepDur') : null;
  const last = comp && comp.daily && comp.daily.length ? comp.daily[comp.daily.length - 1] : null;
  const f = last ? sleepFrac(last.value, target) : null;
  if (f == null) return { state: 'none' };
  return { state: 'ok', date: last.date, hours: last.value, target, fill: arcPath(0, f), marker: polar(fracToAngle(f)) };
}

function loadDial(L) {
  if (!L || !Array.isArray(L.modalities) || !L.modalities.length) return { state: 'none' };
  const modalities = L.modalities.map((m) => {
    const ratio = loadRatio(m.trend);
    if (ratio == null) return { key: m.key, state: 'gated', reason: (m.trend && m.trend.reason) || 'baselineBuilding' };
    const f = loadFrac(ratio);
    return { key: m.key, state: 'ok', ratio, trendPct: m.trend.trendPct, band: m.trend.band, fill: arcPath(0, f), marker: polar(fracToAngle(f)) };
  });
  const first = modalities.find((m) => m.state === 'ok') || modalities[0];
  const edges = [DETRAINING_PCT, EASING_PCT, ABOVE_PCT, RAMPING_PCT].map((p) => 1 + p / 100);
  return {
    state: 'ok',
    asOf: L.asOf || null,
    defaultKey: first.key,
    modalities,
    zones: zones(edges, ['detraining', 'below', 'steady', 'above', 'ramping'], loadFrac),
    mid: polar(fracToAngle(0.5), DIAL.r - DIAL.stroke),
  };
}

/** scores = buildScores() result, health = buildHealth() result (for the stated sleep target). */
export function buildDials(scores, health) {
  const S = scores && scores.hasData ? scores : {};
  return {
    track: arcPath(0, 1),
    sleep: sleepDial(S.recovery, health),
    recovery: recoveryDial(S.recovery),
    load: loadDial(S.load),
  };
}
