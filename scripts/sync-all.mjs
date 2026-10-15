#!/usr/bin/env node
/* Runner behind `npm run sync`: runs the Strava sync, the Shortcut sync, the profile sync, the settings sync, the food log export and the journal export sequentially, even
 * when one fails — a shell `&&` chain would skip the second script the moment the first exits
 * non-zero, and `;` both loses the exit code and is shell-specific. Both scripts write
 * _meta.json, so running them one after another (not in parallel) avoids a write race.
 *
 * Run: node scripts/sync-all.mjs [--full]   (--full reaches the Shortcut sync only: it rebuilds its cache)
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/is-main.mjs';
import { runCli } from '../data/apple-health/sync-common.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(DIR);
// the profile sync (data/profile/, its own files) comes last: it never touches _meta.json, and a
// failure there must not hide the extract syncs' result (runAll runs every script regardless)
// Strava runs BEFORE the Shortcut sync: its workout-zones.csv activity windows are what the Shortcut
// sync leaves out of hr-hourly.csv (lib/health/hr-hourly.mjs), so a new activity is never
// counted twice in day strain until the next sync.
export const SCRIPTS = [
  path.join(ROOT, 'data', 'apple-health', 'sync-strava.mjs'),
  path.join(ROOT, 'data', 'apple-health', 'sync-shortcut.mjs'),
  path.join(ROOT, 'data', 'profile', 'sync-profile.mjs'),
  // the settings snapshot (data/profile/settings.json) never fails the run: a missing / old ingest
  // service is only a warning (exit 0)
  path.join(ROOT, 'data', 'profile', 'sync-settings.mjs'),
  // the in-page onboarding document (data/profile/onboarding.json) likewise only warns (exit 0)
  path.join(ROOT, 'scripts', 'sync-onboarding.mjs'),
  // the food log export (data/nutrition/foodlog-daily.csv) likewise only warns (exit 0) when the
  // ingest service is missing / old
  path.join(ROOT, 'data', 'nutrition', 'sync-foodlog.mjs'),
  // the behaviour journal export (journal-daily.csv in the extract, scripts/sync-journal.mjs) likewise
  // only warns (exit 0) when the ingest service is missing / old
  path.join(ROOT, 'scripts', 'sync-journal.mjs'),
];

const SHORTCUT = SCRIPTS[1];

/** The argv each script gets from sync-all's own flags: --full is the Shortcut sync's (every script parses
 * its flags strictly, so an unknown one would fail it). */
export function scriptArgs ({ full = false } = {}) {
  return (script) => (full && script === SHORTCUT ? ['--full'] : []);
}

/**
 * Pure-ish: runs every script in order via `spawn(execPath, [script, ...args])` (args AFTER the
 * script: before it, node would parse `--full` as its own flag and abort), regardless of
 * earlier failures, and returns 0 only if every one of them exited 0. `args` is one argv for every
 * script, or a function script -> argv. `spawn` is injected for testing (defaults to `spawnSync`
 * with inherited stdio).
 */
export function runAll (scripts, args, spawn) {
  let exitCode = 0;
  for (const script of scripts) {
    const result = spawn(process.execPath, [script, ...(typeof args === 'function' ? args(script) : args)]);
    if (!result || result.status !== 0) exitCode = 1;
  }
  return exitCode;
}

function realSpawn (cmd, spawnArgs) {
  return spawnSync(cmd, spawnArgs, { stdio: 'inherit' });
}

const USAGE = `Usage: node scripts/sync-all.mjs [--full]

Runs every sync (Strava, Shortcut, profile, settings, onboarding, food log, journal) in order, even when
one fails; exits 1 if any failed.
  --full       the Shortcut sync ignores its cache and rebuilds it
  -h, --help   this help`;

if (isMain(import.meta.url)) {
  runCli((values) => runAll(SCRIPTS, scriptArgs(values), realSpawn), { usage: USAGE, options: { full: { type: 'boolean' } } });
}
