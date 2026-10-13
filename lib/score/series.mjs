/* Per-modality daily Relative Effort (RE) load series.
 *
 * Same-day rule, within (date, modality): the ONE shared rule of lib/training/sessions.mjs — drop
 * invalid rows (dur <= 0), drop junk rows (short AND negligible effort), keep one source when a
 * Watch row and a Strava row describe the same session (Strava wins), then SUM the remainder.
 * Nothing is ever discarded for "not being the biggest": a coached session logged in two parts (e.g. threshold Part I / Part II) must add up.
 * Residual limitation: a genuine two-a-day is indistinguishable from a session logged in parts
 * (workouts.csv has no start time), so the rule errs toward counting real work.
 *
 * RE-only: a row with re == null is `unscored`, excluded from load and counted. A day whose rows in a
 * modality are ALL unscored is flagged `unscored: true` on its byModality entry: it is MISSING data,
 * not rest, and load.mjs carries the EWMA forward over it instead of decaying it like a zero day. Test `re != null`,
 * never `re > 0`: re = 0 and re = 1 are genuine values. The series starts at the derived RE epoch
 * (first date with any re != null), so no EWMA window can straddle the era before RE existed. All
 * windows anchor to the series' own asOf (max workout date), never to the build clock.
 */
import { addDays } from '../health/stats.mjs';
import { scoreModality } from './modality.mjs';
import { mergeSameDay } from '../training/sessions.mjs';

// The junk rule lives with the shared same-day rule; re-exported for existing callers.
export { isJunk, JUNK_MAX_MIN, JUNK_MAX_RE } from '../training/sessions.mjs';

const SCORED = ['gym', 'run', 'bike'];
// 4 weeks: long enough that the "other activities" line is not empty after a quiet week, short
// enough to describe the current block rather than the whole history.
const OTHER_WINDOW_DAYS = 28;
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/** Totals for the rows of ONE date. */
export function dayTotals(rows) {
  const out = {
    byModality: { gym: 0, run: 0, bike: 0 },
    // per scored modality: valid non-junk rows, and how many of them carry no RE. A day with rows
    // but no RE is NOT a rest day: the page must say "no effort data", never "rest".
    rowsBy: { gym: 0, run: 0, bike: 0 },
    unscoredBy: { gym: 0, run: 0, bike: 0 },
    other: { minutes: 0, re: 0, sessions: 0 },
    scored: 0, unscored: 0, invalid: 0, droppedJunk: 0, superseded: 0,
  };
  const stats = {};
  for (const g of mergeSameDay(rows, (r) => scoreModality(r.type), { stats })) {
    const m = g.key;
    for (const r of g.rows) {
      if (r.re == null) out.unscored++; else out.scored++;
      if (m === 'other') {
        out.other.minutes += r.dur;
        out.other.sessions++;
        if (r.re != null) out.other.re += r.re;
      } else {
        out.rowsBy[m]++;
        if (r.re != null) out.byModality[m] += r.re;
        else out.unscoredBy[m]++;
      }
    }
  }
  out.invalid = stats.invalid;
  out.droppedJunk = stats.junk;
  out.superseded = stats.superseded;
  return out;
}

/** rows: [{date, type, dur, re}] -> zero-filled daily series per scored modality. */
export function modalitySeries(rows) {
  const valid = (rows || []).filter((r) => r && r.date);
  const empty = () => ({ gym: [], run: [], bike: [] });
  if (!valid.length) {
    return { reEpoch: null, asOf: null, byModality: empty(), days: empty(), other: { minutes: 0, re: 0, sessions: 0, windowDays: OTHER_WINDOW_DAYS }, coverage: { scored: 0, unscored: 0, invalid: 0, droppedJunk: 0, superseded: 0, preEpoch: 0 } };
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

  const coverage = { scored: 0, unscored: 0, invalid: 0, droppedJunk: 0, superseded: 0, preEpoch: 0 };
  const other = { minutes: 0, re: 0, sessions: 0, windowDays: OTHER_WINDOW_DAYS };
  const byModality = empty();
  // session days per modality (only dates with rows in it): {date, re, unscored}
  const days = empty();
  if (reEpoch == null) {
    coverage.preEpoch = valid.length;
    return { reEpoch, asOf, byModality, days, other, coverage };
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
    coverage.superseded += t.superseded;
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
    for (const m of SCORED) {
      const entry = { date, load: t ? t.byModality[m] : 0 };
      if (t && t.rowsBy[m] > 0 && t.unscoredBy[m] === t.rowsBy[m]) entry.unscored = true;
      byModality[m].push(entry);
      if (t && t.rowsBy[m] > 0) days[m].push({ date, re: t.byModality[m], unscored: t.unscoredBy[m] });
    }
  }
  return { reEpoch, asOf, byModality, days, other, coverage };
}
