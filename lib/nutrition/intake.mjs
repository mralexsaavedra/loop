/* Nutrición intake rings — baked view-model. Pairs the most recent LOGGED day of
 * dietary-daily.csv (a food app writing nutrition to Apple Health, via extract.js or the
 * Shortcut diet_* keys) with the plan's day totals for a train and a rest day. The client
 * (web/src/client/intake.js) picks the target from the day toggle and decides freshness against
 * the viewer's clock, so nothing here depends on the build date and builds stay byte-identical.
 *
 * Data honesty: a ring only ever fills from REAL intake. No logged day -> latest is null and the
 * page shows an empty state; a macro missing on the logged day -> that ring shows no fill. */
import { readDietary } from '../health/read.mjs';

// Intake older than this many days is not "today's picture" any more -> empty state.
export const INTAKE_FRESH_DAYS = 3;

const r0 = (v) => (v == null ? null : Math.round(v));
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** rows from readDietary ([{date, value:kcal, p, c, g}]) -> the newest day with kcal > 0. */
export function latestIntake(rows) {
  const logged = (rows || []).filter((r) => r && r.value > 0);
  if (!logged.length) return null;
  const last = logged[logged.length - 1];
  return { date: last.date, k: r0(last.value), p: r1(last.p), c: r0(last.c), g: r0(last.g) };
}

/** actual / target, or null when either is missing (a ring never fills from the target). */
export function ringFrac(actual, target) {
  if (actual == null || !Number.isFinite(actual) || !(target > 0)) return null;
  return Math.round((actual / target) * 1000) / 1000;
}

const dayNum = (iso) => Date.parse(iso + 'T00:00:00Z') / 86400000;
/** true when `date` is today or up to `days` days before `today` (both "YYYY-MM-DD"). */
export function isFresh(date, today, days = INTAKE_FRESH_DAYS) {
  if (!date || !today) return false;
  const age = dayNum(today) - dayNum(date);
  return age >= 0 && age <= days;
}

const roundTarget = (t) => ({ k: r0(t.k), p: r0(t.p), c: r0(t.c), g: r0(t.g) });

/** extractDir (or null) + plan day totals {train:{k,p,c,g}, rest:{…}} -> JSON-safe block. */
export function buildIntake(extractDir, targets) {
  return {
    latest: latestIntake(readDietary(extractDir)),
    target: { train: roundTarget(targets.train), rest: roundTarget(targets.rest) },
    freshDays: INTAKE_FRESH_DAYS,
  };
}
