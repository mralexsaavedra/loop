/* Nutrition build-time I/O (lib/<area>/read.mjs convention, like lib/health/read.mjs): the only
 * module of lib/nutrition that touches the filesystem. Compute stays in the pure modules —
 * lib/nutrition/nutri-score.mjs parses and bakes; this file only finds and reads the food log CSV. */
import fs from 'node:fs';
import path from 'node:path';
import { FOODLOG_FILE, parseFoodlogRows, foodlogBake } from './nutri-score.mjs';
import { dataPaths } from '../paths.mjs';

/** The build environment the food log is read from (web/src/bakes.mjs passes it).
 * @typedef {{repoRoot: string, dataMode?: string, extractDir?: string | null, paths?: {foodlogCsv: string} | null}} FoodlogEnv */

/** Where the build reads the food log: the synced snapshot (personal: lib/paths.mjs foodlogCsv, from `paths`
 * when the caller resolved them, else from repoRoot + process.env) or the demo extract (example).
 * @param {FoodlogEnv} env @returns {string} */
export function foodlogFile({ repoRoot, dataMode, extractDir, paths = null }) {
  return dataMode === 'example' ? path.join(extractDir || '', FOODLOG_FILE) : (paths || dataPaths({ repoRoot })).foodlogCsv;
}

/** env -> the bake; rows it could not read are skipped and reported once through `warn` (never thrown).
 * @param {FoodlogEnv} env @param {{warn?: (msg: string) => void}} [opts] */
export function buildFoodlogBake(env, { warn = console.warn } = {}) {
  var file = foodlogFile(env);
  var text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { text = ''; }
  var r = parseFoodlogRows(text);
  if (r.skipped) warn('nutrition score: skipped ' + r.skipped + ' row(s) of ' + path.basename(file) + ' (bad date, no kcal or no entries)');
  return foodlogBake(r.days);
}
