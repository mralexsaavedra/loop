/* Inicio dial view-model: full-ring geometry (starts at 12 o'clock, fills clockwise) + value->ring
 * mapping for the Sleep, Recovery and Load dials. Pure presentation glue over values
 * buildScores()/buildHealth() already produce. TODAY FIRST, the trend as context:
 *   - Recovery: the fill ends at last night's composite (recovery.today) on the -3..+3 MAD scale
 *     (baseline = the tick at 6 o'clock) and takes ONE state colour, its band (cut at the single-day
 *     DAY_BAND_CUTOFF, or BAND_CUTOFF for the trend): no zone arcs on the ring; the 7-day
 *     trend + its direction ride along as `trend` for the dial's detail sheet. With no composite for last night the dial falls back to trend7 (zones at
 *     BAND_CUTOFF) and says so (mode 'trend').
 *   - Load: the ring midpoint is the typical training day of the modality and the end twice it. The
 *     VIEWER's today is picked client-side from `days` (the recent session days, each with its
 *     pre-computed fill when it has RE), so nothing today-relative is baked: a day with rows
 *     but no RE reads "no effort data", a day with no rows reads rest (with `last` as context);
 *     acute/chronic (trendPct/band) stays as context.
 *   - Sleep: the sleep-duration component's newest night over the stated target.
 * No new metric and no percentage score. Baked by components/Bake.astro as DIALS;
 * client/score.js turns it into inline SVG. */
import { Z_CLAMP } from '../../../lib/score/recovery.mjs';

// 120-unit viewBox, 54-unit radius, 7-unit stroke (~6 % of the ring's diameter): a full ring that
// starts at 12 o'clock (-90 degrees) and fills clockwise; the midpoint (0.5) sits at 6 o'clock.
export const DIAL = { c: 60, r: 54, stroke: 7, start: -90, sweep: 360 };
// The former 270 degree open arc (opens at the bottom), kept ONLY for Nutrición's kcal dial
// (tabs/Dia.astro NUTRI_ARC) until that tab moves to the ring language too.
export const OPEN_ARC = { c: 60, r: 50, stroke: 10, start: 135, sweep: 270 };
// Load: the ring midpoint is the typical training day (1x), the end is 2x.
const LOAD_MAX_RATIO = 2;

const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function fracToAngle(f, g = DIAL) {
  return g.start + g.sweep * clamp(f, 0, 1);
}

export function polar(angle, r = DIAL.r, g = DIAL) {
  const a = (angle * Math.PI) / 180;
  return { x: r2(g.c + r * Math.cos(a)), y: r2(g.c + r * Math.sin(a)) };
}

/** SVG path for the arc between two fractions of the sweep (direction preserved). A full ring is
 * two half arcs: one SVG arc cannot start and end on the same point. `g` = the geometry (default the
 * Inicio ring; Nutrición's kcal dial still passes OPEN_ARC). */
export function arcPath(f0, f1, g = DIAL) {
  const a0 = fracToAngle(f0, g);
  const a1 = fracToAngle(f1, g);
  if (a0 === a1) return '';
  if (Math.abs(a1 - a0) >= 360) {
    const p0 = polar(a0, g.r, g);
    const pm = polar((a0 + a1) / 2, g.r, g);
    const sw = a1 > a0 ? 1 : 0;
    return `M${p0.x} ${p0.y}A${g.r} ${g.r} 0 0 ${sw} ${pm.x} ${pm.y}A${g.r} ${g.r} 0 0 ${sw} ${p0.x} ${p0.y}`;
  }
  const p0 = polar(a0, g.r, g);
  const p1 = polar(a1, g.r, g);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M${p0.x} ${p0.y}A${g.r} ${g.r} 0 ${large} ${sweep} ${p1.x} ${p1.y}`;
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

/** A radial tick across the ring's stroke at fraction `f` (1 unit past each edge): the load dial's
 * typical-day mark on the detail sheet's hero ring. */
export function radialTick(f, g = DIAL) {
  const a = fracToAngle(f, g);
  const p0 = polar(a, g.r - g.stroke / 2 - 1, g);
  const p1 = polar(a, g.r + g.stroke / 2 + 1, g);
  return { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y };
}

function recoveryDial(R) {
  if (!R) return { state: 'none' };
  if (R.gated || !isNum(R.trend7)) return { state: 'gated', asOf: R.asOf || null };
  const today = R.today && isNum(R.today.value) ? R.today : null;
  const value = today ? today.value : R.trend7;
  const f = recoveryFrac(value);
  return {
    state: 'ok',
    mode: today ? 'today' : 'trend',
    asOf: R.asOf || null,
    date: today ? today.date : null,
    sleep: today ? today.sleep !== false : null,
    band: today ? today.band : R.band,
    value,
    trend: { value: R.trend7, band: R.band, dir: R.trendDir || null },
    // filled clockwise from 12 o'clock to the value on the -3..+3 scale; the baseline (0) is the tick
    // at the ring's midpoint (6 o'clock)
    fill: arcPath(0, f),
    mid: polar(fracToAngle(0.5), DIAL.r - DIAL.stroke),
  };
}

function sleepDial(R, H) {
  const target = H && H.recovery && H.recovery.sleep ? H.recovery.sleep.target : null;
  const comp = R && Array.isArray(R.components) ? R.components.find((c) => c.key === 'sleepDur') : null;
  const last = comp && comp.daily && comp.daily.length ? comp.daily[comp.daily.length - 1] : null;
  const f = last ? sleepFrac(last.value, target) : null;
  if (f == null) return { state: 'none' };
  return { state: 'ok', date: last.date, hours: last.value, target, fill: arcPath(0, f) };
}

function loadDial(L) {
  if (!L || !Array.isArray(L.modalities) || !L.modalities.length) return { state: 'none' };
  const modalities = L.modalities.map((m) => {
    const t = m.trend || {};
    const recent = Array.isArray(m.recent) ? m.recent : [];
    // a gated modality keeps its session days WITHOUT geometry: the client may open the switch on
    // today's session (showing the gated state), but a gated dial never shows a number
    const plainDays = () => recent.map((d) => ({ date: d.date, re: isNum(d.re) ? d.re : 0, unscored: d.unscored || 0 }));
    if (!t.ok || !isNum(t.trendPct)) return { key: m.key, state: 'gated', reason: t.reason || 'baselineBuilding', days: plainDays() };
    const typical = m.typical && isNum(m.typical.value) ? m.typical.value : null;
    if (typical == null || !(typical > 0)) return { key: m.key, state: 'gated', reason: 'fewDays', days: plainDays() };
    const days = recent.map((d) => {
      const re = isNum(d.re) ? d.re : 0;
      const out = { date: d.date, re, unscored: d.unscored || 0 };
      if (re > 0) {
        const f = loadDayFrac(re, typical);
        out.fill = arcPath(0, f);
      }
      return out;
    });
    return { key: m.key, state: 'ok', typical, trendPct: t.trendPct, band: t.band, days, last: m.last || null, unscored: m.unscoredAcute || 0 };
  });
  const first = modalities.find((m) => m.state === 'ok') || modalities[0];
  return {
    state: 'ok',
    asOf: L.asOf || null,
    defaultKey: first.key,
    modalities,
    mid: polar(fracToAngle(0.5), DIAL.r - DIAL.stroke),
    tick: radialTick(0.5),
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
