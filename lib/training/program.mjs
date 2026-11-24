/* Pure programmed-session logic: the integrity validation of training-data.json and the shared meta the
 * page bakes. No I/O.
 */

import { isIsoDate } from '../date.mjs';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// the session kinds (in order of demand, like the nutrition day types they feed: lib/nutrition/daytype.mjs dayTypeOfProgram)
/** @type {Record<string, number>} */
const KINDS = { gym: 1, hybrid: 1, indoor: 1, run: 1, bike: 1 };

/** One block of a programmed session: its title, an optional label, its lines (validateProgram's rules).
 * @typedef {{title: string, label?: string, lines: string[]}} ProgramBlock */
/** One programmed session (training-data.json `days[date]`).
 * @typedef {{kind?: 'gym' | 'hybrid' | 'indoor' | 'run' | 'bike', durationMin?: number, focus: string, blocks: ProgramBlock[]}} ProgramSession */
/** training-data.json: the sessions by ISO date plus the program's header fields.
 * @typedef {{days: Record<string, ProgramSession>, program?: string, coach?: string, source?: string}} Program */

/* ---------- integrity validation (programmed sessions) ---------- */
/** Throws one error listing every problem found; the input is untrusted JSON (any field may be off).
 * @param {{days?: Record<string, any>}} training
 * @returns {{ok: true, skipped?: undefined}} (no `skipped`: callers union it with a skipped result) */
export function validateProgram(training) {
  /** @type {string[]} */
  const errors = [];
  if (!training.days || typeof training.days !== 'object') {
    throw new Error('training-data.json must contain a top-level "days" object.');
  }
  const keys = Object.keys(training.days);
  if (!keys.length) errors.push('"days" is empty — add at least one programmed session.');
  for (const date of keys) {
    if (!ISO.test(date)) { errors.push(`day key "${date}" is not an ISO date (YYYY-MM-DD)`); continue; }
    if (!isIsoDate(date)) { errors.push(`day key "${date}" is not a real calendar date`); continue; }
    const day = training.days[date];
    if (!day || typeof day !== 'object' || Array.isArray(day)) { errors.push(`${date}: must be an object`); continue; }
    if (day.kind && !KINDS[day.kind]) errors.push(`${date}: kind "${day.kind}" must be one of ${Object.keys(KINDS).join('|')}`);
    if (day.durationMin != null && !(typeof day.durationMin === 'number' && day.durationMin > 0)) errors.push(`${date}: durationMin must be a positive number of minutes`);
    if (!day.focus || typeof day.focus !== 'string') errors.push(`${date}: missing "focus" text`);
    if (!Array.isArray(day.blocks) || !day.blocks.length) { errors.push(`${date}: "blocks" must be a non-empty array`); continue; }
    day.blocks.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
      if (!b.title || typeof b.title !== 'string') errors.push(`${date} block ${i}: missing "title"`);
      if (b.label != null && typeof b.label !== 'string') errors.push(`${date} block ${i}: "label" must be a string`);
      if (!Array.isArray(b.lines) || !b.lines.length) errors.push(`${date} block ${i}: "lines" must be a non-empty array`);
      else if (!b.lines.every((/** @type {unknown} */ l) => typeof l === 'string')) errors.push(`${date} block ${i}: every line must be a string`);
    });
  }
  if (errors.length) throw new Error('training-data.json validation failed:\n  - ' + errors.join('\n  - '));
  return { ok: true };
}

/* The program's shared meta, baked as TRAINING_META (web/src/components/Bake.astro). */
/** @param {Program} training */
export function trainingMeta(training) {
  const dates = Object.keys(training.days).sort();
  return {
    program: training.program || '',
    coach: training.coach || '',
    source: training.source || '',
    first: dates[0] || '',
    last: dates[dates.length - 1] || '',
    count: dates.length,
  };
}
