/* Inicio dial view-model: full-ring geometry (starts at 12 o'clock, fills clockwise) + value->ring
 * mapping for the Sleep, Recovery and Load dials. Pure presentation glue over values
 * buildScoresFrom()/healthFrom() already produce. TODAY FIRST, the trend as context:
 *   - Recovery: with a percentage (recovery.today.pct, its rank within the previous 90 days) the
 *     ring fills to pct % and takes its % band colour (good >= 67 / mid / low <= 33), no baseline
 *     tick; `value` keeps the SD composite for the notes. Without one (under 21 prior days):
 *     the fill ends at last night's composite (recovery.today) on the -3..+3 MAD scale
 *     (baseline = the tick at 6 o'clock) and takes ONE state colour, its band (cut at the single-day
 *     DAY_BAND_CUTOFF, or BAND_CUTOFF for the trend): no zone arcs on the ring; the 7-day
 *     trend + its direction ride along as `trend` for the dial's detail sheet. With no composite for last night the dial falls back to trend7 (zones at
 *     BAND_CUTOFF) and says so (mode 'trend').
 *   - Load: the ring midpoint is the typical training day of the modality and the end twice it. The
 *     VIEWER's today is picked client-side from `days` (the recent session days, each with its
 *     pre-computed fill when it has RE), so nothing today-relative is baked: a day with rows
 *     but no RE reads "no effort data", a day with no rows reads rest (with `last` as context);
 *     acute/chronic (trendPct/band) stays as context.
 *   - Sleep: the sleep-duration component's newest night over the stated target; `pct` = sleep
 *     performance (lib/score/sleep.mjs: asleep / need × 100, capped at 100, need = the target), the
 *     number the dial shows. The ring fills to the same fraction.
 *   - Strain (when calibrated, lib/score/strain.mjs): the day strain 0-21, the ring filled to
 *     strain / 21; each of the recent `days` carries its pre-computed fill and the client picks the
 *     viewer's day (or the stepped-to past day). It REPLACES the load dial on Inicio; without it
 *     (`strain` null: too little all-day HR, no max HR) the load dial below stays, unchanged.
 *   - Past days (`days`, the top bar's day stepping): the sleep + recovery dials of each SCORES.days
 *     entry, scored on that day by the same lib functions, in the same shapes.
 * No new metric: the recovery % is a rank of the same composite (lib/score/recovery.mjs). Baked by components/Bake.astro as DIALS;
 * client/score.js turns it into inline SVG. */
import { Z_CLAMP } from '../../../lib/score/recovery.mjs';
import { sleepPerformance } from '../../../lib/score/sleep.mjs';

// 120-unit viewBox, 54-unit radius, 9.5-unit stroke (~8 % of the 120-unit dial): a full ring that
// starts at 12 o'clock (-90 degrees) and fills clockwise; the midpoint (0.5) sits at 6 o'clock.
export const DIAL = { c: 60, r: 54, stroke: 9.5, start: -90, sweep: 360 };
// the deep-dive hero ring (client/deepdive.js, styles/detail.css .dd-track): the same circle with a
// lighter 7.5-unit stroke, so its typical-day tick crosses THAT stroke
export const HERO = { ...DIAL, stroke: 7.5 };
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
 * Inicio ring, which Nutrición's kcal ring bakes too: tabs/Dia.astro NUTRI_ARC). */
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

// filled clockwise from 12 o'clock to pct %, else to the value on the -3..+3 scale with the
// baseline (0) as the tick at the ring's midpoint (6 o'clock)
function recoveryRing(value, pct) {
  const f = pct != null ? pct / 100 : recoveryFrac(value);
  return { fill: arcPath(0, f), mid: pct != null ? null : polar(fracToAngle(0.5), DIAL.r - DIAL.stroke) };
}

function recoveryDial(R) {
  if (!R) return { state: 'none' };
  if (R.gated || !isNum(R.trend7)) return { state: 'gated', asOf: R.asOf || null };
  const today = R.today && isNum(R.today.value) ? R.today : null;
  const value = today ? today.value : R.trend7;
  const pct = today && isNum(today.pct) ? today.pct : null;
  return {
    state: 'ok',
    mode: today ? 'today' : 'trend',
    asOf: R.asOf || null,
    date: today ? today.date : null,
    sleep: today ? today.sleep !== false : null,
    band: pct != null ? today.pctBand : today ? today.band : R.band,
    pct,
    value,
    trend: { value: R.trend7, band: R.band, dir: R.trendDir || null },
    ...recoveryRing(value, pct),
  };
}

function sleepTarget(H) {
  return H && H.recovery && H.recovery.sleep ? H.recovery.sleep.target : null;
}

function sleepNight(date, hours, target) {
  const f = isNum(hours) ? sleepFrac(hours, target) : null;
  if (f == null) return { state: 'none' };
  return { state: 'ok', date, hours, target, pct: sleepPerformance(hours, target), fill: arcPath(0, f) };
}

function sleepDial(R, H) {
  const comp = R && Array.isArray(R.components) ? R.components.find((c) => c.key === 'sleepDur') : null;
  const last = comp && comp.daily && comp.daily.length ? comp.daily[comp.daily.length - 1] : null;
  return last ? sleepNight(last.date, last.value, sleepTarget(H)) : { state: 'none' };
}

/** A PAST day's sleep + recovery dials (Inicio day stepping) from one SCORES.days entry
 * (lib/score/days.mjs): the same shapes as today's, always mode 'today' for that day's own night
 * (no trend fallback: a day without its night reads "no data"). */
function pastDay(d, H) {
  const n = d.rec && typeof d.rec === 'object' && isNum(d.rec.value) ? d.rec : null;
  const pct = n && isNum(n.pct) ? n.pct : null;
  const recovery = d.rec === 'gated' ? { state: 'gated', asOf: d.date }
    : !n ? { state: 'none' }
    : { state: 'ok', mode: 'today', asOf: d.date, date: d.date, sleep: n.sleep !== false, band: pct != null ? n.pctBand : n.band, pct, value: n.value, ...recoveryRing(n.value, pct) };
  return { date: d.date, sleep: sleepNight(d.date, d.sleep, sleepTarget(H)), recovery };
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
    tick: radialTick(0.5, HERO),
  };
}

const STRAIN_MAX = 21;

/** SCORES.strain -> null (not calibrated: Inicio keeps the load dial) | {state, asOf, days: [{date, s,
 * fill}]}: the recent days with their strain and its ring arc (strain / 21). */
export function strainDial(St) {
  if (!St || !St.ok || !Array.isArray(St.days)) return null;
  const days = St.days.filter((d) => d && isNum(d.s)).map((d) => ({ date: d.date, s: d.s, fill: arcPath(0, clamp(d.s / STRAIN_MAX, 0, 1)) }));
  return { state: 'ok', asOf: St.asOf || null, days };
}

/** scores = buildScoresFrom() result, health = healthFrom() result (for the stated sleep target). */
export function buildDials(scores, health) {
  const S = scores && scores.hasData ? scores : {};
  return {
    track: arcPath(0, 1),
    sleep: sleepDial(S.recovery, health),
    recovery: recoveryDial(S.recovery),
    load: loadDial(S.load),
    strain: strainDial(S.strain),
    // the past days the top bar's "‹" reaches (the load dial already carries them in `days`)
    days: S.days && Array.isArray(S.days.days) ? S.days.days.map((d) => pastDay(d, health)) : [],
  };
}
