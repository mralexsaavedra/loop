/* Inicio dial view-model: 270 degree open-arc geometry + value->arc mapping for the Sleep,
 * Recovery and Load dials. Pure presentation glue over values buildScores()/buildHealth() already
 * produce. TODAY FIRST, the trend as context:
 *   - Recovery: marker = last night's composite (recovery.today) in MAD units, zones cut at the
 *     single-day DAY_BAND_CUTOFF; the 7-day trend + its direction ride along as `trend` for the line
 *     under the dial. With no composite for last night the dial falls back to trend7 (zones at
 *     BAND_CUTOFF) and says so (mode 'trend').
 *   - Load: the arc midpoint is the typical training day of the modality and the end twice it. The
 *     VIEWER's today is picked client-side from `days` (the recent session days, each with its
 *     pre-computed fill/marker when it has RE), so nothing today-relative is baked: a day with rows
 *     but no RE reads "no effort data", a day with no rows reads rest (with `last` as context);
 *     acute/chronic (trendPct/band) stays as context.
 *   - Sleep: the sleep-duration component's newest night over the stated target.
 * No new metric and no percentage score. Baked by components/Bake.astro as DIALS;
 * client/score.js turns it into inline SVG. */
import { BAND_CUTOFF, DAY_BAND_CUTOFF, Z_CLAMP } from '../../../lib/score/recovery.mjs';

// 120-unit viewBox, 50-unit radius, 10-unit stroke; the arc opens at the bottom.
export const DIAL = { c: 60, r: 50, stroke: 10, start: 135, sweep: 270 };
// Load: the arc midpoint is the typical training day (1x), the end is 2x.
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
  // the recovery z is clamped per signal at +-Z_CLAMP MAD; the dial uses the same range
  return isNum(v) ? (clamp(v, -Z_CLAMP, Z_CLAMP) + Z_CLAMP) / (2 * Z_CLAMP) : null;
}

export function sleepFrac(hours, target) {
  return isNum(hours) && isNum(target) && target > 0 ? clamp(hours / target, 0, 1) : null;
}

export function loadFrac(dayOverTypical) {
  return clamp(dayOverTypical / LOAD_MAX_RATIO, 0, 1);
}

/** The day's RE as a fraction of the arc: typical day = midpoint, 2x typical = end. */
export function loadDayFrac(day, typical) {
  return isNum(day) && isNum(typical) && typical > 0 ? loadFrac(day / typical) : null;
}

function zones(edges, bands, toFrac) {
  const cuts = [0, ...edges.map(toFrac), 1];
  return bands.map((band, i) => ({ band, d: arcPath(cuts[i], cuts[i + 1]) }));
}

function recoveryDial(R) {
  if (!R) return { state: 'none' };
  if (R.gated || !isNum(R.trend7)) return { state: 'gated', asOf: R.asOf || null };
  const today = R.today && isNum(R.today.value) ? R.today : null;
  const value = today ? today.value : R.trend7;
  const f = recoveryFrac(value);
  const cut = today ? DAY_BAND_CUTOFF : BAND_CUTOFF;
  return {
    state: 'ok',
    mode: today ? 'today' : 'trend',
    asOf: R.asOf || null,
    date: today ? today.date : null,
    sleep: today ? today.sleep !== false : null,
    band: today ? today.band : R.band,
    value,
    trend: { value: R.trend7, band: R.band, dir: R.trendDir || null },
    zones: zones([-cut, cut], ['below', 'at', 'above'], recoveryFrac),
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
    const t = m.trend || {};
    if (!t.ok || !isNum(t.trendPct)) return { key: m.key, state: 'gated', reason: t.reason || 'baselineBuilding' };
    const typical = m.typical && isNum(m.typical.value) ? m.typical.value : null;
    if (typical == null || !(typical > 0)) return { key: m.key, state: 'gated', reason: 'fewDays' };
    const days = (Array.isArray(m.recent) ? m.recent : []).map((d) => {
      const re = isNum(d.re) ? d.re : 0;
      const out = { date: d.date, re, unscored: d.unscored || 0 };
      if (re > 0) {
        const f = loadDayFrac(re, typical);
        out.fill = arcPath(0, f);
        out.marker = polar(fracToAngle(f));
      }
      return out;
    });
    return { key: m.key, state: 'ok', typical, trendPct: t.trendPct, band: t.band, days, last: m.last || null };
  });
  const first = modalities.find((m) => m.state === 'ok') || modalities[0];
  return {
    state: 'ok',
    asOf: L.asOf || null,
    defaultKey: first.key,
    modalities,
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
