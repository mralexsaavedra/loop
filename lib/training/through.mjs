/* trainingThrough(inputs) — the day training data is covered through (pure, readExtract inputs).
 *
 * workouts.csv only has rows on days with a session, so its last row is the last SESSION, not the
 * last day the data was synced: rest days after it would read as stale data. The Watch's own nightly
 * and hourly data (HRV, resting HR, sleep, hourly HR) is synced with the Watch's workouts, so its newest
 * day says the sources were read through then: a day without a session up to it is rest. A Strava-only
 * session (the bike computer) not yet synced is not seen here; the LAN page's sync status shows that.
 * null without any of that data (training then ends at its own last session, as before). */
/** @param {unknown} rows (an array of {date} rows, anything else -> null) @returns {string | null} */
const last = (rows) => (Array.isArray(rows) && rows.length ? rows.reduce((/** @type {string} */ m, /** @type {{date: string} | null} */ r) => (r && r.date > m ? r.date : m), '') || null : null);

/** @param {{series?: {hrv?: unknown, rhr?: unknown} | null, sleep?: unknown, hrHourly?: unknown} | null | undefined} inputs
 * @returns {string | null} */
export function trainingThrough(inputs) {
  const I = inputs || {};
  const S = /** @type {{hrv?: unknown, rhr?: unknown}} */ (I.series || {});
  const dates = [S.hrv, S.rhr, I.sleep, I.hrHourly].map(last).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}
