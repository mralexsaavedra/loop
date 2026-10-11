/* Nutrition build-time I/O (lib/<area>/read.mjs convention, like lib/health/read.mjs): the only
 * module of lib/nutrition that touches the filesystem. Compute stays in the pure modules —
 * lib/nutrition/score.mjs parses and bakes; this file only finds and reads the food log CSV. */
import fs from 'node:fs';
import path from 'node:path';
import { FOODLOG_FILE, parseFoodlogRows, foodlogBake } from './score.mjs';

/** Where the build reads the food log: the synced snapshot (personal) or the demo extract (example). */
export function foodlogFile({ repoRoot, dataMode, extractDir }) {
  return dataMode === 'example' ? path.join(extractDir || '', FOODLOG_FILE) : path.join(repoRoot, 'data', 'nutrition', FOODLOG_FILE);
}

/** env -> the bake; rows it could not read are skipped and reported once through `warn` (never thrown). */
export function buildFoodlogBake(env, { warn = console.warn } = {}) {
  var file = foodlogFile(env);
  var text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { text = ''; }
  var r = parseFoodlogRows(text);
  if (r.skipped) warn('nutrition score: skipped ' + r.skipped + ' row(s) of ' + path.basename(file) + ' (bad date, no kcal or no entries)');
  return foodlogBake(r.days);
}
