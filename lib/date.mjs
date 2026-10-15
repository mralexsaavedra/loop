/* Calendar-date helpers over 'YYYY-MM-DD' strings: the one copy every lib module, script and test imports.
 * UTC math throughout (a date is parsed as its UTC midnight), so neither the host time zone nor a DST change
 * can move a date or make a day 23 / 25 hours long. Pure.
 *
 * The page's classic client scripts keep their own local-calendar twins (web/src/client/util.js isoDate /
 * shiftIso, the viewer's "today"): they cannot import an ES module. */

export const MS_PER_DAY = 86400000;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in the YYYY-MM-DD shape (2030-02-31 and 2030-13-01 are not). */
export function isIsoDate(v) {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** Whole days from `a` to `b` (b - a; negative when b is earlier); NaN when either is not a real date
 * (2030-02-31 included: it is never rolled over into March). */
export function dayDiff(a, b) {
  if (!isIsoDate(a) || !isIsoDate(b)) return NaN;
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / MS_PER_DAY);
}

/** The date `n` calendar days after `d` (n < 0: before). A `d` that is not a real date (2030-02-31
 * included) throws a RangeError. */
export function addDays(d, n) {
  if (!isIsoDate(d)) throw new RangeError(`addDays: not a calendar date: ${JSON.stringify(d)}`);
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** The Monday of `d`'s week (ISO weeks: Monday to Sunday); null when `d` is not a date. */
export function weekStart(d) {
  if (!isIsoDate(d)) return null;
  return addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
}
