/* Pure programmed-session logic: the integrity validation of training-data.json and the shared meta the
 * page bakes. No I/O.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date (Date.parse rolls 2026-02-30 over to March 2, so round-trip instead). */
function realDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const KINDS = { gym: 1, run: 1, bike: 1 };

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
    if (!realDate(date)) { errors.push(`day key "${date}" is not a real calendar date`); continue; }
    const day = training.days[date];
    if (!day || typeof day !== 'object' || Array.isArray(day)) { errors.push(`${date}: must be an object`); continue; }
    if (day.kind && !KINDS[day.kind]) errors.push(`${date}: kind "${day.kind}" must be one of gym|run|bike`);
    if (day.durationMin != null && !(typeof day.durationMin === 'number' && day.durationMin > 0)) errors.push(`${date}: durationMin must be a positive number of minutes`);
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

/* The program's shared meta, baked as TRAINING_META (web/src/components/Bake.astro). */
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
