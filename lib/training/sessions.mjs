/* The ONE same-day merge rule for workouts.csv rows, shared by every reader: Home's load series
 * (lib/score/series.mjs), Inicio's timeline (lib/score/timeline.mjs), Entreno's calendar and
 * cumulative time (lib/training/activity.mjs) and Entreno's running / cycling tables
 * (lib/health/aggregate.mjs).
 *
 * workouts.csv has no start time and the Watch fragments one session into several records, so all
 * rows of one (date, key) are treated as ONE session. `key` is the caller's modality bucket (Home's
 * gym/run/bike/other, the dashboard's five buckets, or a constant for a single-family table).
 *
 * Per (date, key):
 *   1. rows with dur <= 0 are invalid and dropped;
 *   2. junk rows (short AND effortless, see isJunk) are dropped unless `dropJunk: false`, so a 2-min
 *      Watch stub never turns a rest day into an active one;
 *   3. ONE source: when Strava rows AND other (Watch export) rows exist for the same date and key,
 *      only the Strava rows are kept. sync:strava's date-level precedence should already prevent the
 *      pair, but it has known holes (a mixed day, a re-export after a sync); keeping both would count
 *      the same session twice. Strava wins because it carries RE, elevation and kJ;
 *   4. the remaining rows are the session: callers SUM them (a session logged in parts adds up; a
 *      genuine two-a-day is indistinguishable and is summed too).
 */

// Junk = a fragment that is BOTH short and effortless (an accidental start/stop, a warm-up stub).
// The effort arm is the real protection: a genuinely hard block has RE far above 2 however short,
// so it always survives. The duration cutoff only has to sit above the longest fragment seen
// (unrounded durations reach ~10.4 min) and below the shortest genuine block (~12 min): 11 leaves
// a ~1 min margin either side. A wrong guess costs at most JUNK_MAX_RE points per dropped row.
export const JUNK_MAX_MIN = 11;
export const JUNK_MAX_RE = 2;

/** Short AND negligible effort (see JUNK_MAX_MIN / JUNK_MAX_RE for why both arms). */
export function isJunk(row) {
  return row.dur <= JUNK_MAX_MIN && (row.re == null || row.re <= JUNK_MAX_RE);
}

// sync:strava tags its rows "Strava API"; rows from the retired ingest loop say "Strava".
const PREFERRED_SOURCE_RE = /^Strava\b/i;
export function isPreferredSource(source) {
  return typeof source === 'string' && PREFERRED_SOURCE_RE.test(source);
}

/**
 * rows: [{date, dur, re?, source?, ...}], keyFn: row -> bucket key.
 * Returns [{date, key, rows}] (oldest date first; same-date groups and their rows in file order).
 * Pass `stats: {}` to get the drop counts back ({invalid, junk, superseded}).
 */
export function mergeSameDay(rows, keyFn, { dropJunk = true, stats } = {}) {
  const st = stats || {};
  st.invalid = st.invalid || 0;
  st.junk = st.junk || 0;
  st.superseded = st.superseded || 0;
  const groups = new Map();
  for (const row of rows || []) {
    if (!row || !(row.dur > 0)) { st.invalid++; continue; }
    if (dropJunk && isJunk(row)) { st.junk++; continue; }
    const key = keyFn(row);
    const id = row.date + '\u0000' + key;
    if (!groups.has(id)) groups.set(id, { date: row.date, key, rows: [] });
    groups.get(id).rows.push(row);
  }
  const out = [...groups.values()];
  for (const g of out) {
    const preferred = g.rows.filter((row) => isPreferredSource(row.source));
    if (preferred.length && preferred.length < g.rows.length) {
      st.superseded += g.rows.length - preferred.length;
      g.rows = preferred;
    }
  }
  // Array#sort is stable: same-date groups keep their first-seen order
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
