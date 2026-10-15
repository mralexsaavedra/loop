/* Salud "Fitness age": the age whose healthy-population MEAN VO2max equals the user's latest one.
 *
 * Reference curve: Loe H, Rognmo Ø, Saltin B, Wisløff U. "Aerobic Capacity Reference Data in 3816
 * Healthy Men and Women 20–90 Years." PLoS ONE 2013;8(5):e64319, Table 2
 * (https://doi.org/10.1371/journal.pone.0064319): treadmill VO2max (mL·kg⁻¹·min⁻¹), arithmetic mean
 * per sex and age group of the healthy HUNT3 Fitness Study population (n per group in
 * analysis/methodology.md). Each group mean is placed at its midpoint (20–29 → 25 … 60–69 → 65; the
 * open 70+ group → 75, a documented choice) and the age is interpolated linearly between midpoints.
 * Outside the curve the age is clamped to 25 / 75 and flagged (`bound`: 'below' = younger than 25,
 * 'above' = older than 75); the page shows "< 25" / "> 75".
 *
 * This is MEAN-based: the fitness-age concept of Nes et al. 2014 (MSSE, doi:10.1249/MSS.0000000000000219)
 * is the background, but its exact reference (mean vs median) is not claimed here.
 * The VO2max is a smartwatch estimate (vo2max.csv); this is not a medical measure.
 * Only the data's own dates are baked (no build-time "now"); the chronological age is computed by the
 * page from the profile's birthdate on the viewer's clock. */
import { addDays } from '../date.mjs';

export const FITNESS_AGE_REF = {
  male: [[25, 54.4], [35, 49.1], [45, 47.2], [55, 42.6], [65, 39.2], [75, 35.3]],
  female: [[25, 43.0], [35, 40.0], [45, 38.4], [55, 34.4], [65, 31.1], [75, 28.3]],
};
// trend windows (days before the latest reading)
const FITNESS_AGE_TREND_DAYS = [30, 90];

const round1 = (x) => Math.round(x * 10) / 10;

/** vo2 (mL/kg/min) + sex ('male' | 'female') -> null | {age, bound: null | 'below' | 'above'}. */
export function fitnessAge(vo2, sex) {
  const ref = FITNESS_AGE_REF[sex];
  if (!ref || !Number.isFinite(vo2) || vo2 <= 0) return null;
  const [first, last] = [ref[0], ref[ref.length - 1]];
  if (vo2 > first[1]) return { age: first[0], bound: 'below' };
  if (vo2 < last[1]) return { age: last[0], bound: 'above' };
  for (let i = 1; i < ref.length; i++) {
    const [a1, v1] = ref[i - 1], [a2, v2] = ref[i];
    if (vo2 <= v1 && vo2 >= v2) return { age: round1(a1 + ((v1 - vo2) / (v1 - v2)) * (a2 - a1)), bound: null };
  }
  return null; // unreachable: the curve is strictly decreasing
}

/** VO2max rows -> one reading per day [{date, value, source}] sorted by date: the MEAN of the day's positive,
 * finite rows; `source` = the day's distinct sources in row order, joined with ' + '. The ONE per-day VO2max
 * series of the fitness age card, the detail sheet (lib/detail/detail.mjs) and Salud (lib/health/aggregate.mjs),
 * so the three show one number for one day. Mean, not "the later row": a day's rows are the watch estimate and
 * its Shortcut copy (usually equal) or two estimates of the same day, none more authoritative, and the row
 * order is the merge order of the files, not a time of day; the mean does not depend on it.
 * @param {Array<{date: string, value: number, source?: string}> | null | undefined} rows
 * @returns {Array<{date: string, value: number, source: string | null}>} */
export function vo2maxDaily(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (!r || !r.date || !Number.isFinite(r.value) || r.value <= 0) continue;
    const d = m.get(r.date) || { sum: 0, n: 0, src: [] };
    d.sum += r.value;
    d.n += 1;
    if (r.source && !d.src.includes(r.source)) d.src.push(r.source);
    m.set(r.date, d);
  }
  return [...m.keys()].sort().map((date) => {
    const d = m.get(date);
    return { date, value: d.sum / d.n, source: d.src.length ? d.src.join(' + ') : null };
  });
}

const point = (r, sex) => ({ date: r.date, vo2: round1(r.value), ...fitnessAge(r.value, sex) });

/** rows: readSeries('vo2max.csv') rows -> {ok: false, reason} | {ok: true, age, bound, sex, vo2, trend, ref}. */
export function fitnessAgeFromSeries(rows, sex) {
  if (!FITNESS_AGE_REF[sex]) return { ok: false, reason: 'no-sex' };
  const days = vo2maxDaily(rows);
  if (!days.length) return { ok: false, reason: 'no-vo2max' };
  const latest = days[days.length - 1];
  const trend = {};
  for (const n of FITNESS_AGE_TREND_DAYS) {
    const cut = addDays(latest.date, -n);
    const prev = days.filter((r) => r.date <= cut).pop();
    trend[`d${n}`] = prev ? point(prev, sex) : null;
  }
  const { age, bound } = fitnessAge(latest.value, sex);
  return {
    ok: true,
    age,
    bound,
    sex,
    vo2: { value: round1(latest.value), date: latest.date, source: latest.source || null },
    trend,
    ref: 'loe2013',
  };
}

/** The pure core over lib/extract/read.mjs readExtract inputs (lib/score/index.mjs buildScoresFrom).
 * @param {{series?: Record<string, any>}} [inputs]
 * @param {{sex?: string | null}} [opts] */
export function fitnessAgeFrom({ series } = {}, { sex = null } = {}) {
  return fitnessAgeFromSeries(series ? series.vo2max : null, sex);
}
