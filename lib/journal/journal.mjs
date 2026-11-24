/**
 * Daily behaviour journal (Q7) — the ONE reference for the journal's behaviours, limits and the
 * build-time behaviour insights. Design: docs/journal.md.
 *
 * The ingest service is built from its own directory, so services/loop-ingest/src/journal-calc.js
 * is GENERATED from the SERVER descriptor below (JOURNAL_GROUPS / JOURNAL_BEHAVIORS / JOURNAL_LIMITS,
 * `npm run gen:journal-calc`; scripts/gen-journal-calc.test.mjs fails while the committed file differs).
 * The page gets them baked (web/src/client/journal.js reads JOURNAL_CONST).
 *
 * A journal day D records what happened on day D (its evening included). Its effect is read on the
 * NEXT morning: the recovery of the night D -> D+1, which the recovery score stores under the wake
 * date D+1 (lib/score/recovery.mjs).
 */

/** Row groups of the sheet, in order. */
export const JOURNAL_GROUPS = ['day', 'night', 'status'];

/** One journal behaviour: its stored answer key, sheet group, answer kind and (optional) the sexes asked it.
 * @typedef {{key: string, group: string, kind: 'yesno' | 'count', sexes?: string[]}} JournalBehavior */
/** A journal day as callers pass it: answers by behaviour key (raw stored values), the note, extra columns.
 * @typedef {{date: string, answers?: Record<string, unknown> | null, notes?: string | null, extra?: Record<string, unknown> | null}} JournalDayIn */
/** A parsed journal day (parseJournalCsv): only valid answers, unknown columns in `extra`.
 * @typedef {{date: string, answers: Record<string, boolean | number>, notes: string | null, extra?: Record<string, string>}} JournalDay */

/**
 * The behaviours. kind `yesno` = true / false; kind `count` = an integer
 * 0..countMax (0 = no). Keys are the stored answer keys: renaming one orphans its history.
 * @type {JournalBehavior[]}
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
  // added in 1.0.3, after the original nine (new CSV columns go last; old exports still parse by header)
  { key: 'travel', group: 'day', kind: 'yesno' },
  { key: 'big_meal', group: 'day', kind: 'yesno' },
  { key: 'meditation', group: 'day', kind: 'yesno' },
  { key: 'sauna', group: 'day', kind: 'yesno' },
  { key: 'reading_before_bed', group: 'night', kind: 'yesno' },
  { key: 'screens_before_bed', group: 'night', kind: 'yesno' },
  { key: 'hot_bedroom', group: 'night', kind: 'yesno' },
  { key: 'sex', group: 'night', kind: 'yesno' },
  { key: 'muscle_soreness', group: 'status', kind: 'yesno' },
  // `sexes`: asked only for a profile of that sex (behaviorsFor); the service still accepts the key from anyone
  { key: 'period', group: 'status', kind: 'yesno', sexes: ['female'] },
];

/** The behaviours asked of a profile of `sex` ('male' | 'female' | null): one with `sexes` only when it matches
 * (an unknown sex gets none of them).
 * @param {string | null} [sex] */
export function behaviorsFor(sex) {
  return JOURNAL_BEHAVIORS.filter((b) => !b.sexes || b.sexes.includes(/** @type {string} */ (sex)));
}

export const JOURNAL_LIMITS = {
  countMax: 20, // drinks in one day
  notesMax: 500, // characters of the day's note
  rangeDaysMax: 366, // days one GET /journal/summary may span
  insightMinDays: 5, // days needed on EACH side (yes / no) before an insight is shown
};

/** What scripts/gen-journal-calc.mjs emits into the ingest service's src/journal-calc.js
 * (lib/build/esm-module.mjs descriptor): the service validates answers with these. */
export const SERVER = {
  consts: { JOURNAL_GROUPS, JOURNAL_BEHAVIORS, JOURNAL_LIMITS },
};

// a Map: a key such as __proto__ or constructor never resolves to a behaviour
const BY_KEY = new Map(JOURNAL_BEHAVIORS.map((b) => [b.key, b]));

/** true / false = the behaviour happened / did not; null = not answered (or unknown key).
 * @param {Record<string, unknown> | null | undefined} answers
 * @param {string} key
 * @returns {boolean | null} */
export function didBehavior(answers, key) {
  const b = BY_KEY.get(key);
  const v = answers && Object.hasOwn(answers, key) ? answers[key] : undefined;
  if (!b || v === undefined || v === null) return null;
  if (b.kind === 'count') return Number.isInteger(v) ? /** @type {number} */ (v) > 0 : null;
  return typeof v === 'boolean' ? v : null;
}

/** true when the day has at least one answer (the "journaled" check of the week strip).
 * @param {JournalDayIn | null | undefined} day */
export function isJournaled(day) {
  return !!day && JOURNAL_BEHAVIORS.some((b) => didBehavior(day.answers, b.key) !== null);
}

const DAY_MS = 86400000;
/** @param {string} iso */
export function nextIso(iso) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + DAY_MS).toISOString().slice(0, 10);
}

const round1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;

/** A behaviour with enough days on both sides: its means and their difference (recovery points).
 * @typedef {{key: string, yesDays: number, noDays: number, status: 'ok', yesMean: number, noMean: number, diff: number}} BehaviorInsightOk */
/** A behaviour still short of days on one side: only its counts.
 * @typedef {{key: string, yesDays: number, noDays: number, status: 'need_data', yesMean: null, noMean: null, diff: null}} BehaviorInsightNeed */
/** @typedef {BehaviorInsightOk | BehaviorInsightNeed} BehaviorInsight */

/**
 * Behaviour insights: for each behaviour, the mean NEXT-morning recovery (0-100 %) on days after
 * "yes" vs after "no". `days` = [{date, answers}], `recoveryByDate` = {wakeDate: score 0-100}.
 * A side counts only days whose next morning has a score. Shown only when BOTH sides have
 * >= insightMinDays days; else `status: 'need_data'` with the counts. diff = yesMean - noMean in
 * recovery points (the page shows it as a signed %), better = diff > 0 (higher recovery after yes).
 * An association, never causation (docs/journal.md, the ⓘ of the card).
 * @param {JournalDayIn[] | null | undefined} days
 * @param {Record<string, number> | null | undefined} recoveryByDate
 * @param {{minDays?: number, behaviors?: JournalBehavior[]}} [opts]
 * @returns {BehaviorInsight[]}
 */
export function behaviorInsights(days, recoveryByDate, { minDays = JOURNAL_LIMITS.insightMinDays, behaviors = JOURNAL_BEHAVIORS } = {}) {
  /** @type {BehaviorInsight[]} */
  const out = [];
  for (const b of behaviors) {
    /** @type {number[]} */
    const yes = [];
    /** @type {number[]} */
    const no = [];
    for (const d of days || []) {
      const did = didBehavior(d.answers, b.key);
      if (did === null) continue;
      const r = recoveryByDate ? recoveryByDate[nextIso(d.date)] : undefined;
      if (typeof r !== 'number' || !Number.isFinite(r)) continue;
      (did ? yes : no).push(r);
    }
    const mean = (/** @type {number[]} */ a) => a.reduce((s, v) => s + v, 0) / a.length;
    const row = { key: b.key, yesDays: yes.length, noDays: no.length };
    if (yes.length < minDays || no.length < minDays) {
      out.push({ ...row, status: 'need_data', yesMean: null, noMean: null, diff: null });
      continue;
    }
    const yesMean = round1(mean(yes));
    const noMean = round1(mean(no));
    out.push({ ...row, status: 'ok', yesMean, noMean, diff: round1(yesMean - noMean) });
  }
  return out;
}

/* ---------- the journal CSV (scripts/sync-journal.mjs writes it into the extract, the build reads it) ---------- */
export const JOURNAL_CSV_HEADER = ['date', ...JOURNAL_BEHAVIORS.map((b) => b.key), 'notes'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {JournalBehavior} b @param {unknown} v */
function cell(b, v) {
  if (v === undefined || v === null) return '';
  if (b.kind === 'count') return Number.isInteger(v) && /** @type {number} */ (v) >= 0 ? String(v) : '';
  return v === true ? '1' : v === false ? '0' : '';
}
/** @param {unknown} s */
function quote(s) {
  if (s == null || s === '') return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  return /[",]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Extra (unknown) column names of the given days, sorted: kept on write, never read as behaviours.
 * @param {JournalDayIn[]} rows
 * @returns {string[]} */
function extraColumns(rows) {
  const known = new Set(JOURNAL_CSV_HEADER);
  const out = new Set();
  for (const d of rows) for (const k of Object.keys(d.extra || {})) if (!known.has(k) && /^[a-z][a-z0-9_]*$/.test(k)) out.add(k);
  return [...out].sort();
}

/** [{date, answers, notes, extra?}] -> CSV text: date, the current behaviours, any extra columns a row
 * carried (a behaviour of another version), notes; one row per day, sorted by date.
 * @param {JournalDayIn[] | null | undefined} days */
export function journalCsv(days) {
  const rows = [...(days || [])].filter((d) => d && ISO_RE.test(d.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const extra = extraColumns(rows);
  const header = ['date', ...JOURNAL_BEHAVIORS.map((b) => b.key), ...extra, 'notes'];
  return [header.join(','), ...rows.map((d) => [
    d.date,
    ...JOURNAL_BEHAVIORS.map((b) => cell(b, d.answers && Object.hasOwn(d.answers, b.key) ? d.answers[b.key] : null)),
    ...extra.map((k) => quote(d.extra && Object.hasOwn(d.extra, k) ? d.extra[k] : '')),
    quote(d.notes),
  ].join(','))].join('\n') + '\n';
}

/** One CSV line -> its fields (double-quoted fields with "" escapes).
 * @param {string} line */
function fields(line) {
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let s = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { s += '"'; i += 2; } else if (line[i] === '"') { i++; break; } else s += line[i++];
      }
      out.push(s);
      i++; // the comma
    } else {
      const j = line.indexOf(',', i);
      const end = j === -1 ? line.length : j;
      out.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return out;
}

/** CSV text -> [{date, answers, notes, extra?}], columns matched by header NAME (any order): a
 * behaviour missing from the header is unanswered, an unknown column goes to `extra` (kept on write,
 * never read as a behaviour). No `date` column -> nothing.
 * @param {string | null | undefined} text
 * @returns {JournalDay[]} */
export function parseJournalCsv(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
  if (!lines.length) return [];
  const head = fields(lines[0]);
  /** @type {Map<string, number>} */
  const at = new Map();
  head.forEach((name, i) => { if (!at.has(name)) at.set(name, i); });
  if (!at.has('date')) return [];
  const extraCols = head.filter((name, i) => at.get(name) === i && name !== 'date' && name !== 'notes' && !BY_KEY.has(name) && /^[a-z][a-z0-9_]*$/.test(name));
  /** @type {JournalDay[]} */
  const out = [];
  for (const line of lines.slice(1)) {
    const f = fields(line);
    const date = f[/** @type {number} */ (at.get('date'))] || '';
    if (!ISO_RE.test(date)) continue;
    /** @type {Record<string, boolean | number>} */
    const answers = {};
    for (const b of JOURNAL_BEHAVIORS) {
      if (!at.has(b.key)) continue;
      const v = f[/** @type {number} */ (at.get(b.key))];
      if (v === undefined || v === '') continue;
      if (b.kind === 'count') {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0 && n <= JOURNAL_LIMITS.countMax) answers[b.key] = n;
      } else if (v === '1' || v === '0') answers[b.key] = v === '1';
    }
    const notes = at.has('notes') ? f[/** @type {number} */ (at.get('notes'))] : '';
    /** @type {JournalDay} */
    const day = { date, answers, notes: notes ? notes : null };
    /** @type {Record<string, string>} */
    const extra = {};
    for (const k of extraCols) { const v = f[/** @type {number} */ (at.get(k))]; if (v !== undefined && v !== '') extra[k] = v; }
    if (Object.keys(extra).length) day.extra = extra;
    out.push(day);
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
