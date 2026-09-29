/* Pure programmed-session logic — integrity validation, extracted verbatim
 * from data/training/generate-training.js (astro-plan-web migration, slice
 * 2; that file and its legacy JS-literal serializer were retired at the
 * slice 7 cutover). No I/O.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = { gym: 1, run: 1 };

/* ---------- integrity validation (programmed sessions) ---------- */
export function validateProgram(training) {
  const errors = [];
  if (!training.days || typeof training.days !== 'object') {
    throw new Error('training-data.json must contain a top-level "days" object.');
  }
  const keys = Object.keys(training.days);
  if (!keys.length) errors.push('"days" is empty — add at least one programmed session.');
  for (const date of keys) {
    if (!ISO.test(date)) { errors.push(`day key "${date}" is not an ISO date (YYYY-MM-DD)`); continue; }
    if (isNaN(Date.parse(date + 'T00:00:00'))) { errors.push(`day key "${date}" is not a real calendar date`); continue; }
    const day = training.days[date];
    if (day.kind && !KINDS[day.kind]) errors.push(`${date}: kind "${day.kind}" must be one of gym|run`);
    if (!day.focus || typeof day.focus !== 'string') errors.push(`${date}: missing "focus" text`);
    if (!Array.isArray(day.blocks) || !day.blocks.length) { errors.push(`${date}: "blocks" must be a non-empty array`); continue; }
    day.blocks.forEach((b, i) => {
      if (!b.title || typeof b.title !== 'string') errors.push(`${date} block ${i}: missing "title"`);
      if (b.label != null && typeof b.label !== 'string') errors.push(`${date} block ${i}: "label" must be a string`);
      if (!Array.isArray(b.lines) || !b.lines.length) errors.push(`${date} block ${i}: "lines" must be a non-empty array`);
      else if (!b.lines.every((l) => typeof l === 'string')) errors.push(`${date} block ${i}: every line must be a string`);
    });
  }
  if (errors.length) throw new Error('training-data.json validation failed:\n  - ' + errors.join('\n  - '));
  return { ok: true };
}

/* Shared by the Astro Bake globals (web/src/components/Bake.astro's
 * TRAINING_META, astro-plan-web slice 5). Originally also fed a legacy
 * JS-literal serializer (trainingBlock()), removed at the slice 7 cutover
 * once its only caller (data/training/generate-training.js) was deleted —
 * nothing in the Astro build path ever called it. */
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
