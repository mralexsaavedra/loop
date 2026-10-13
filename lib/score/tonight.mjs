/* Inicio "Tonight" card: a recommended bedtime from the user's own habit, never an invented score.
 *
 * Rule: usual wake time = the median wake clock of the nights in the last TONIGHT_WINDOW (14) days
 * ending at the newest night with a wake time (sleep-daily.csv, dated the wake-up day); recommended
 * bedtime = usual wake − the stated sleep target (SLEEP_TARGET, 7.5 h, the same target the sleep dial
 * and the sleep sheet use). Fewer than TONIGHT_MIN_NIGHTS (7) nights with a wake time → null (the card
 * is hidden). Wake clocks are decimal hours; one woken just before midnight (≥ WRAP_FROM, 18:00) is
 * unwrapped to a negative hour before the median, so 23:50 and 00:10 sit next to each other.
 * Only the data's own dates are baked (no build-time "now"), so builds stay byte-identical. */
import { readSleep } from '../health/read.mjs';
import { addDays } from '../health/stats.mjs';
import { SLEEP_TARGET } from '../health/aggregate.mjs';

export const TONIGHT_WINDOW = 14;
export const TONIGHT_MIN_NIGHTS = 7;
const WRAP_FROM = 18;

const mod24 = (h) => ((h % 24) + 24) % 24;
const round2 = (x) => Math.round(x * 100) / 100;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** rows: readSleep() rows ({date, value, waketime}) -> null | {asOf, wake, bed, target, nights, window}. */
export function tonightFromSleep(rows, target = SLEEP_TARGET) {
  const nights = new Map();
  for (const r of rows || []) {
    if (!r || !Number.isFinite(r.value) || r.value <= 0 || !Number.isFinite(r.waketime)) continue;
    if (r.waketime < 0 || r.waketime >= 24) continue;
    nights.set(r.date, r.waketime); // one row per night; a later row of the same date wins
  }
  if (!nights.size || !Number.isFinite(target) || target <= 0) return null;
  const asOf = [...nights.keys()].sort().pop();
  const from = addDays(asOf, -(TONIGHT_WINDOW - 1));
  const wakes = [...nights.entries()].filter(([d]) => d >= from && d <= asOf).map(([, h]) => (h >= WRAP_FROM ? h - 24 : h));
  if (wakes.length < TONIGHT_MIN_NIGHTS) return null;
  const wake = mod24(median(wakes));
  return { asOf, wake: round2(wake), bed: round2(mod24(wake - target)), target, nights: wakes.length, window: TONIGHT_WINDOW };
}

/** The pure core over lib/extract/read.mjs readExtract inputs (lib/score/index.mjs buildScoresFrom). */
export function tonightFrom({ sleep } = {}) {
  return tonightFromSleep(sleep);
}

export function buildTonight(extractDir) {
  if (!extractDir) return null;
  return tonightFromSleep(readSleep(extractDir));
}
