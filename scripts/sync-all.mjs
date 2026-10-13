#!/usr/bin/env node
/* Runner behind `npm run sync`: runs the Strava sync, the Shortcut sync, the profile sync, the settings sync, the food log export and the journal export sequentially, even
 * when one fails — a shell `&&` chain would skip the second script the moment the first exits
 * non-zero, and `;` both loses the exit code and is shell-specific. Both scripts write
 * _meta.json, so running them one after another (not in parallel) avoids a write race.
 *
 * Run: node scripts/sync-all.mjs [-- extra args forwarded to each script]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/is-main.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(DIR);
// the profile sync (data/profile/, its own files) comes last: it never touches _meta.json, and a
// failure there must not hide the extract syncs' result (runAll runs every script regardless)
// Strava runs BEFORE the Shortcut sync: its workout-zones.csv activity windows are what the Shortcut
// sync leaves out of hr-hourly.csv (lib/health/hr-hourly.cjs), so a new activity is never
// counted twice in day strain until the next sync.
export const SCRIPTS = [
  path.join(ROOT, 'data', 'apple-health', 'sync-strava.js'),
  path.join(ROOT, 'data', 'apple-health', 'sync-shortcut.mjs'),
  path.join(ROOT, 'data', 'profile', 'sync-profile.js'),
  // the settings snapshot (data/profile/settings.json) never fails the run: a missing / old ingest
  // service is only a warning (exit 0)
  path.join(ROOT, 'data', 'profile', 'sync-settings.js'),
  // the food log export (data/nutrition/foodlog-daily.csv) likewise only warns (exit 0) when the
  // ingest service is missing / old
  path.join(ROOT, 'data', 'nutrition', 'sync-foodlog.js'),
  // the behaviour journal export (journal-daily.csv in the extract, scripts/sync-journal.mjs) likewise
  // only warns (exit 0) when the ingest service is missing / old
  path.join(ROOT, 'scripts', 'sync-journal.mjs'),
];

/**
 * Pure-ish: runs every script in order via `spawn(execPath, [script, ...args])` (args AFTER the
 * script: before it, node would parse `--full` as its own flag and abort), regardless of
 * earlier failures, and returns 0 only if every one of them exited 0. `spawn` is injected for
 * testing (defaults to `spawnSync` with inherited stdio).
 */
export function runAll (scripts, args, spawn) {
  let exitCode = 0;
  for (const script of scripts) {
    const result = spawn(process.execPath, [script, ...args]);
    if (!result || result.status !== 0) exitCode = 1;
  }
  return exitCode;
}

function realSpawn (cmd, spawnArgs) {
  return spawnSync(cmd, spawnArgs, { stdio: 'inherit' });
}

if (isMain(import.meta.url)) {
  process.exit(runAll(SCRIPTS, process.argv.slice(2), realSpawn));
}
