/**
 * LITERAL copy of the journal constants of lib/journal/journal.mjs (the reference; the service is built
 * from its own directory, so it cannot import it). lib/journal/journal.test.mjs pins them equal: change
 * both together.
 */
export var JOURNAL_GROUPS = ['day', 'night', 'status'];

export var JOURNAL_BEHAVIORS = [
  { key: 'caffeine_late', group: 'day', kind: 'yesno' },
  { key: 'nap', group: 'day', kind: 'yesno' },
  { key: 'mobility', group: 'day', kind: 'yesno' },
  { key: 'alcohol', group: 'night', kind: 'count' },
  { key: 'late_meal', group: 'night', kind: 'yesno' },
  { key: 'screen_in_bed', group: 'night', kind: 'yesno' },
  { key: 'evening_supplements', group: 'night', kind: 'yesno' },
  { key: 'stressful_day', group: 'status', kind: 'yesno' },
  { key: 'ill', group: 'status', kind: 'yesno' }
];

export var JOURNAL_LIMITS = {
  countMax: 20,
  notesMax: 500,
  rangeDaysMax: 366,
  insightMinDays: 5
};
