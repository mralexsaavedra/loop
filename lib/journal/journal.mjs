/**
 * Daily behaviour journal (Q7) — the ONE reference for the journal's behaviours, limits and the
 * build-time behaviour insights. Design: docs/journal.md.
 *
 * The ingest service is built from its own directory, so services/health-ingest/src/journal-calc.js
 * carries a LITERAL copy of JOURNAL_GROUPS / JOURNAL_BEHAVIORS / JOURNAL_LIMITS; journal.test.mjs pins
 * the two equal. The page gets them baked (web/src/client/journal.js reads JOURNAL_CONST).
 *
 * A journal day D records what happened on day D (its evening included). Its effect is read on the
 * NEXT morning: the recovery of the night D -> D+1, which the recovery score stores under the wake
 * date D+1 (lib/score/recovery.mjs).
 */

/** Row groups of the sheet, in order. */
export const JOURNAL_GROUPS = ['day', 'night', 'status'];

/**
 * The owner-approved behaviours (2026-10-08). kind `yesno` = true / false; kind `count` = an integer
 * 0..countMax (0 = no). Keys are the stored answer keys: renaming one orphans its history.
 */
export const JOURNAL_BEHAVIORS = [
  { key: 'caffeine_late', group: 'day', kind: 'yesno' },
  { key: 'nap', group: 'day', kind: 'yesno' },
  { key: 'mobility', group: 'day', kind: 'yesno' },
  { key: 'alcohol', group: 'night', kind: 'count' },
  { key: 'late_meal', group: 'night', kind: 'yesno' },
  { key: 'screen_in_bed', group: 'night', kind: 'yesno' },
  { key: 'evening_supplements', group: 'night', kind: 'yesno' },
  { key: 'stressful_day', group: 'status', kind: 'yesno' },
  { key: 'ill', group: 'status', kind: 'yesno' },
];

export const JOURNAL_LIMITS = {
  countMax: 20, // drinks in one day
  notesMax: 500, // characters of the day's note
  rangeDaysMax: 366, // days one GET /journal/summary may span
  insightMinDays: 5, // days needed on EACH side (yes / no) before an insight is shown
};

const BY_KEY = Object.fromEntries(JOURNAL_BEHAVIORS.map((b) => [b.key, b]));

/** true / false = the behaviour happened / did not; null = not answered (or unknown key). */
export function didBehavior(answers, key) {
  const b = BY_KEY[key];
  const v = answers ? answers[key] : undefined;
  if (!b || v === undefined || v === null) return null;
  if (b.kind === 'count') return Number.isInteger(v) ? v > 0 : null;
  return typeof v === 'boolean' ? v : null;
}

/** true when the day has at least one answer (the "journaled" check of the week strip). */
export function isJournaled(day) {
  return !!day && JOURNAL_BEHAVIORS.some((b) => didBehavior(day.answers, b.key) !== null);
}
