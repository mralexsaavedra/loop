/* Profile build-time I/O (lib/<area>/read.mjs convention, like lib/journal/read.mjs): reads the profile
 * sheet's sources from disk (lib/profile/manuals.mjs still does its own copying I/O). Compute stays pure: profile.mjs merges the
 * sources (buildProfile) and validates profile.json (validateManual); this file reads profile.json
 * (manual, or the tracked example), the Strava snapshot and the avatar, and the max HR of the
 * per-workout HR zones for data/apple-health/sync-strava.js (readProfileMaxHr). It never reads the extract: the
 * newest weigh-in comes from the caller (web/src/bakes.mjs, over lib/extract/read.mjs readExtract). */
import fs from 'node:fs';
import path from 'node:path';
import { buildProfile, validateManual } from './profile.mjs';
import { validMaxHr, MAX_HR_MIN, MAX_HR_MAX } from '../training/hr-zones.mjs';

/** {data, error}: data = the parsed, valid manual profile (null when absent or broken); error = why it is unusable. */
export function readManualProfile(file) {
  if (!fs.existsSync(file)) return { data: null, error: null, exists: false };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { data: null, error: `${file} — profile.json is not valid JSON (${err.message}).`, exists: true };
  }
  const errs = validateManual(data);
  if (errs.length) return { data: null, error: `${file} — profile.json is invalid:\n  - ${errs.join('\n  - ')}`, exists: true };
  return { data, error: null, exists: true };
}

const manualPath = (repoRoot, example) => path.join(repoRoot, 'profile', example ? 'profile.example.json' : 'profile.json');

/** Strict check for `npm run check`: a malformed manual profile is an error there (the build only warns). */
export function checkManualProfile({ repoRoot, mode }) {
  const { error, exists } = readManualProfile(manualPath(repoRoot, mode === 'example'));
  return { ok: !error, skipped: !exists, error };
}

// machine-written by the sync: a broken file must never fail the build, it is simply ignored
function readSnapshot(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** Build-time loader: personal = the gitignored files, example = the tracked synthetic seeds. `weight` = the
 * newest weigh-in already read by the caller (profile.mjs newestWeight over readExtract's series.weight;
 * null or omitted = none). */
export function loadProfile({ repoRoot, dataMode, weight = null, warn = console.warn }) {
  const example = dataMode === 'example';
  // a hand-edited file with a typo must not take the whole page down: warn, ignore it, keep going
  // with the Strava + derived data (`npm run check` still fails on it, with the same reason)
  const { data: manual, error } = readManualProfile(manualPath(repoRoot, example));
  if (error) warn(`WARNING: ${error}\n  The manual profile is ignored for this build; fix it (npm run check shows the reason).`);
  const strava = readSnapshot(example ? path.join(repoRoot, 'data', 'demo', 'strava-profile.json') : path.join(repoRoot, 'data', 'profile', 'strava-profile.json'));
  const avatarPath = path.join(repoRoot, 'data', 'profile', 'avatar.jpg');
  const avatar = !example && fs.existsSync(avatarPath) ? fs.readFileSync(avatarPath) : null;
  return buildProfile({ manual, strava, avatar, weight });
}

/** profile/profile.json -> {maxHr|null, error|null} for the per-workout HR zones (lib/training/hr-zones.mjs,
 * 100-230 bpm); an absent file or key is not an error. Lenient on purpose: only `maxHr` is read, so a
 * profile that fails validateManual for another field still yields its max HR. */
export function readProfileMaxHr(file) {
  if (!file || !fs.existsSync(file)) return { maxHr: null, error: null };
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (m == null || m.maxHr == null) return { maxHr: null, error: null };
    const v = validMaxHr(m.maxHr);
    return v != null ? { maxHr: v, error: null } : { maxHr: null, error: `maxHr must be a number of bpm (${MAX_HR_MIN}-${MAX_HR_MAX})` };
  } catch (err) {
    return { maxHr: null, error: `profile.json is not valid JSON (${err.message})` };
  }
}
