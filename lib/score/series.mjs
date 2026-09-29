/* Per-modality daily RE load series (whoop-daily, design rev 3).
 *
 * Same-day rule, within (date, modality): drop invalid rows (dur <= 0), drop junk rows (short AND
 * negligible effort), then SUM the remainder. Nothing is ever discarded for "not being the
 * biggest": a coached session logged in two parts (e.g. THRESHOLD Part I/II) must add up.
 * Residual limitation: a genuine two-a-day is indistinguishable from a split session (no start
 * time in workouts.csv); the rule errs toward counting real work.
 *
 * RE-only: a row with re == null is `unscored`, excluded from load and counted. Never re > 0
 * (re = 0 and re = 1 are genuine loads). The series starts at the derived RE_EPOCH (first date
 * with any re != null), so no EWMA window can straddle the pre-RE era. All windows anchor to the
 * series' own asOf (max workout date), never to the build clock.
 */
import { readWorkoutLoad, parseRe } from '../health/read.mjs';
import { scoreModality } from './modality.mjs';

export { parseRe };

const SCORED = ['gym', 'run', 'bike'];
const OTHER_WINDOW_DAYS = 28;
export const JUNK_MAX_MIN = 10;
export const JUNK_MAX_RE = 2;

export const addDays = (d, n) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/** Short AND negligible effort. `<= 10`, not `< 10`: the 2026-08-22 junk row is exactly 10 min. */
export function isJunk(row) {
  return row.dur <= JUNK_MAX_MIN && (row.re == null || row.re <= JUNK_MAX_RE);
}

/** Totals for the rows of ONE date. */
export function dayTotals(rows) {
  const out = {
    byModality: { gym: 0, run: 0, bike: 0 },
    other: { minutes: 0, re: 0, sessions: 0 },
    scored: 0, unscored: 0, invalid: 0, droppedJunk: 0,
  };
  for (const r of rows) {
    if (!(r.dur > 0)) { out.invalid++; continue; }
    if (isJunk(r)) { out.droppedJunk++; continue; }
    if (r.re == null) out.unscored++; else out.scored++;
    const m = scoreModality(r.type);
    if (m === 'other') {
      out.other.minutes += r.dur;
      out.other.sessions++;
      if (r.re != null) out.other.re += r.re;
    } else if (r.re != null) {
      out.byModality[m] += r.re;
    }
  }
  return out;
}

/** rows: [{date, type, dur, re}] -> zero-filled daily series per scored modality. */
export function modalitySeries(rows) {
  const valid = (rows || []).filter((r) => r && r.date);
  const empty = () => ({ gym: [], run: [], bike: [] });
  if (!valid.length) {
    return { reEpoch: null, asOf: null, byModality: empty(), other: { minutes: 0, re: 0, sessions: 0, windowDays: OTHER_WINDOW_DAYS }, coverage: { scored: 0, unscored: 0, invalid: 0, droppedJunk: 0, preEpoch: 0 } };
  }
  let asOf = valid[0].date;
  let reEpoch = null;
  for (const r of valid) {
    if (r.date > asOf) asOf = r.date;
    if (r.re != null && r.dur > 0 && (reEpoch == null || r.date < reEpoch)) reEpoch = r.date;
  }

  const byDate = new Map();
  for (const r of valid) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }

  const coverage = { scored: 0, unscored: 0, invalid: 0, droppedJunk: 0, preEpoch: 0 };
  const other = { minutes: 0, re: 0, sessions: 0, windowDays: OTHER_WINDOW_DAYS };
  const byModality = empty();
  if (reEpoch == null) {
    coverage.preEpoch = valid.length;
    return { reEpoch, asOf, byModality, other, coverage };
  }

  const otherFrom = addDays(asOf, -(OTHER_WINDOW_DAYS - 1));
  const totals = new Map();
  for (const [date, dayRows] of byDate) {
    if (date < reEpoch) { coverage.preEpoch += dayRows.length; continue; }
    const t = dayTotals(dayRows);
    totals.set(date, t);
    coverage.scored += t.scored;
    coverage.unscored += t.unscored;
    coverage.invalid += t.invalid;
    coverage.droppedJunk += t.droppedJunk;
    if (date >= otherFrom) {
      other.minutes += t.other.minutes;
      other.re += t.other.re;
      other.sessions += t.other.sessions;
    }
  }
  const span = daysBetween(reEpoch, asOf);
  for (let i = 0; i <= span; i++) {
    const date = addDays(reEpoch, i);
    const t = totals.get(date);
    for (const m of SCORED) byModality[m].push({ date, load: t ? t.byModality[m] : 0 });
  }
  return { reEpoch, asOf, byModality, other, coverage };
}

/** workouts.csv in extractDir -> modalitySeries, or null when there is no readable data. */
export function buildLoadInputs(extractDir) {
  const rows = readWorkoutLoad(extractDir);
  return rows ? modalitySeries(rows) : null;
}
