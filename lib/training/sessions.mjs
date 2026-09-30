/* The ONE same-day merge rule for workouts.csv rows, shared by every reader: Home's load series
 * (lib/score/series.mjs), Inicio's timeline (lib/score/timeline.mjs), Entreno's calendar and
 * cumulative time (lib/training/activity.mjs), Entreno's dashboard (lib/training/dashboard.mjs) and
 * Salud's running / cycling tables and load-vs-recovery (lib/health/aggregate.mjs).
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
 *   3. ONE source per session: several apps mirror the SAME physical workout into Apple Health (the
 *      Watch records it, Hevy / Zepp / ROXFIT / Nike log it again, the Strava app writes its own
 *      HealthKit copy tagged "Strava", and sync:strava adds the "Strava API" row on top — it ALWAYS
 *      writes its rows, also on dates the export covers). Rows are grouped by source: fragments of ONE
 *      source are kept together (the Watch splits a session into several records); across sources
 *      ONE source's rows are kept, never a sum, by SOURCE_PRECEDENCE (Strava API > Strava > Apple
 *      Watch > any other app; among other apps the longest total wins). A higher-precedence source
 *      replaces a lower one only when its total duration covers at least SUPERSEDE_MIN_COVERAGE of
 *      the lower one's total; below that they are most likely DIFFERENT sessions and both are kept.
 *      When the kept source carries no HR (or no RE) and a replaced copy does, the kept rows inherit
 *      it (see carryFrom), so HR-based readers (load vs recovery) do not lose the session;
 *   4. the remaining rows are the session(s): callers SUM them (a session logged in parts adds up; a
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

// Two copies of one workout have roughly the same duration (the Watch often runs a little longer:
// auto-pause, a late stop; an app may log only the working sets). When the higher-precedence source
// covers less than half of the lower one's minutes, it is not a copy of the same session (e.g. a
// 20-min Strava commute vs a 90-min Watch ride), so both are kept. Half leaves wide room for
// fragments and pauses on either side.
export const SUPERSEDE_MIN_COVERAGE = 0.5;

const sumDur = (rows) => rows.reduce((a, row) => a + row.dur, 0);

// Which copy of a mirrored workout wins (first match = highest). "Strava API" = our sync:strava rows
// (the only source of RE, kJ and elevation); "Strava" = the Strava app's own HealthKit copy of the
// same activity (arrives through export.xml, no RE); then the Watch, which records HR for every
// session; any other app (Hevy, Zepp, ROXFIT, Nike, timers...) ranks last.
export const SOURCE_PRECEDENCE = Object.freeze([
  Object.freeze({ name: 'Strava API', re: /^\s*Strava API\s*$/i }),
  Object.freeze({ name: 'Strava', re: /^\s*Strava\s*$/i }),
  Object.freeze({ name: 'Apple Watch', re: /Apple Watch/i }),
]);

/** Precedence of a row source: index in SOURCE_PRECEDENCE, SOURCE_PRECEDENCE.length for any other app (lower wins). */
export function sourceRank(source) {
  const s = typeof source === 'string' ? source : '';
  const i = SOURCE_PRECEDENCE.findIndex((p) => p.re.test(s));
  return i < 0 ? SOURCE_PRECEDENCE.length : i;
}

// Kept rows with no HR take the HR of the highest-precedence replaced copy that has it: avg weighted
// by the duration of its rows that carry HR, max of their max. Kept rows with no RE take the replaced
// copy's total RE, spread over the kept rows by duration (callers sum RE, so the total is preserved).
// Rows are copied, never mutated.
function carryFrom(kept, absorbed) {
  let rows = kept.rows;
  if (!rows.some((r) => r.hrAvg != null)) {
    const src = absorbed.find((g) => g.rows.some((r) => r.hrAvg != null));
    if (src) {
      const hr = src.rows.filter((r) => r.hrAvg != null);
      const hrAvg = hr.reduce((a, r) => a + r.hrAvg * r.dur, 0) / sumDur(hr);
      const maxes = src.rows.map((r) => r.hrMax).filter((v) => v != null);
      rows = rows.map((r) => ({ ...r, hrAvg, ...(maxes.length ? { hrMax: Math.max(...maxes) } : {}) }));
    }
  }
  if (!rows.some((r) => r.re != null)) {
    const src = absorbed.find((g) => g.rows.some((r) => r.re != null));
    if (src) {
      const total = src.rows.reduce((a, r) => a + (r.re ?? 0), 0);
      const dur = sumDur(rows);
      rows = rows.map((r) => ({ ...r, re: total * r.dur / dur }));
    }
  }
  return rows;
}

// One (date, key) group -> the rows of the kept source(s), per step 3 above. Returns the rows and how
// many rows were replaced.
function pickSources(rows) {
  const bySource = new Map();
  for (const row of rows) {
    const src = typeof row.source === 'string' ? row.source : '';
    if (!bySource.has(src)) bySource.set(src, { rank: sourceRank(src), rows: [] });
    bySource.get(src).rows.push(row);
  }
  if (bySource.size < 2) return { rows, replaced: 0 };
  const groups = [...bySource.values()].map((g, order) => ({ ...g, order, total: sumDur(g.rows), absorbed: [] }));
  groups.sort((a, b) => a.rank - b.rank || b.total - a.total || a.order - b.order);
  const kept = [];
  let replaced = 0;
  for (const g of groups) {
    const copyOf = kept.find((k) => k.total >= SUPERSEDE_MIN_COVERAGE * g.total);
    if (copyOf) { copyOf.absorbed.push(g); replaced += g.rows.length; } else kept.push(g);
  }
  // keep the file order of the surviving rows
  const out = new Map();
  for (const k of kept) carryFrom(k, k.absorbed).forEach((r, i) => out.set(k.rows[i], r));
  return { rows: rows.filter((r) => out.has(r)).map((r) => out.get(r)), replaced };
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
    const picked = pickSources(g.rows);
    st.superseded += picked.replaced;
    g.rows = picked.rows;
  }
  // Array#sort is stable: same-date groups keep their first-seen order
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
