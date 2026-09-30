/* The ONE same-day merge rule for workouts.csv rows, shared by every reader: Home's load series
 * (lib/score/series.mjs), Inicio's timeline (lib/score/timeline.mjs), Entreno's calendar and
 * cumulative time (lib/training/activity.mjs), Entreno's dashboard (lib/training/dashboard.mjs) and
 * Salud's running / cycling tables (lib/health/aggregate.mjs).
 *
 * workouts.csv has no start time and the Watch fragments one session into several records, so all
 * rows of one (date, key) are treated as ONE session. `key` is the caller's modality bucket (Home's
 * gym/run/bike/other, the dashboard's five buckets, or a constant for a single-family table).
 *
 * Per (date, key):
 *   1. rows with dur <= 0 are invalid and dropped;
 *   2. the short-row filter depends on the reader's job:
 *      - LOAD scoring (the default, `dropJunk: true`) drops junk rows (short AND effortless, see
 *        isJunk): they would add ~0 RE and only inflate the unscored count;
 *      - DISPLAY readers (calendar, cumulative time, timeline, dashboard, run / ride tables) pass
 *        DISPLAY_RULE, which drops only stubs (under STUB_MAX_MIN, see isStub). Watch rows and
 *        no-HR Strava rows have re == null by design, so the junk rule would hide real 9-10 min
 *        sessions from the pages that list sessions;
 *   3. ONE source: when Strava rows AND other (Watch export) rows exist for the same date and key,
 *      and the Strava rows cover at least SUPERSEDE_MIN_COVERAGE of the Watch minutes, only the
 *      Strava rows are kept. sync:strava's date-level precedence should already prevent the pair,
 *      but it has known holes (a mixed day, a re-export after a sync); keeping both would count the
 *      same session twice. Strava wins because it carries RE, elevation and kJ. When the coverage
 *      is lower, the rows are most likely DIFFERENT sessions and both are kept;
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

// Stub = an accidental Watch start/stop: shorter than any real session, whatever its effort. Used by
// the DISPLAY readers instead of isJunk, so a real 9-min walk (Watch, no RE) still shows up.
export const STUB_MAX_MIN = 3;

/** Shorter than STUB_MAX_MIN minutes (strict): an accidental start, never a session. */
export function isStub(row) {
  return row.dur < STUB_MAX_MIN;
}

/** Options for readers that SHOW sessions (not load scoring): keep short unscored sessions, drop stubs. */
export const DISPLAY_RULE = Object.freeze({ dropJunk: false, dropStub: true });

// A Watch copy of a Strava session has roughly the same duration (the Watch often runs a little
// longer: auto-pause, a late stop). When the Strava rows cover less than half of the Watch minutes,
// they are not a copy of the same session (e.g. a 20-min Strava commute vs a 90-min Watch ride), so
// both are kept. Half leaves wide room for fragments and pauses on either side.
export const SUPERSEDE_MIN_COVERAGE = 0.5;

const sumDur = (rows) => rows.reduce((a, row) => a + row.dur, 0);

// sync:strava tags its rows "Strava API"; rows from the retired ingest loop say "Strava".
const PREFERRED_SOURCE_RE = /^Strava\b/i;
export function isPreferredSource(source) {
  return typeof source === 'string' && PREFERRED_SOURCE_RE.test(source);
}

/**
 * rows: [{date, dur, re?, source?, ...}], keyFn: row -> bucket key.
 * Returns [{date, key, rows}] (oldest date first; same-date groups and their rows in file order).
 * Options: `dropJunk` (default true, load scoring) and `dropStub` (default false); display readers
 * pass DISPLAY_RULE. Pass `stats: {}` to get the drop counts back ({invalid, junk, stub, superseded}).
 */
export function mergeSameDay(rows, keyFn, { dropJunk = true, dropStub = false, stats } = {}) {
  const st = stats || {};
  st.invalid = st.invalid || 0;
  st.junk = st.junk || 0;
  st.stub = st.stub || 0;
  st.superseded = st.superseded || 0;
  const groups = new Map();
  for (const row of rows || []) {
    if (!row || !(row.dur > 0)) { st.invalid++; continue; }
    if (dropJunk && isJunk(row)) { st.junk++; continue; }
    if (dropStub && isStub(row)) { st.stub++; continue; }
    const key = keyFn(row);
    const id = row.date + '\u0000' + key;
    if (!groups.has(id)) groups.set(id, { date: row.date, key, rows: [] });
    groups.get(id).rows.push(row);
  }
  const out = [...groups.values()];
  for (const g of out) {
    const preferred = g.rows.filter((row) => isPreferredSource(row.source));
    if (!preferred.length || preferred.length === g.rows.length) continue;
    const others = g.rows.filter((row) => !isPreferredSource(row.source));
    if (sumDur(preferred) >= SUPERSEDE_MIN_COVERAGE * sumDur(others)) {
      st.superseded += g.rows.length - preferred.length;
      g.rows = preferred;
    }
  }
  // Array#sort is stable: same-date groups keep their first-seen order
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
