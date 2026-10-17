#!/usr/bin/env node
/* Runner behind `npm run sync`: runs every sync script (SCRIPTS below) sequentially, each one even
 * when an earlier one fails — a shell `&&` chain would skip the rest the moment one exits non-zero,
 * and `;` both loses the exit code and is shell-specific. The Strava and Shortcut syncs both write
 * _meta.json, so running them one after another (not in parallel) avoids a write race.
 *
 * CLIENT MODE (scripts/sync-client.mjs): first it asks the ingest service for its files manifest (GET /export/files,
 * bearer token). A LOOP server in container mode answers it: then this clone is its client and, instead of the
 * scripts, it asks the server to refresh (POST /sync) and waits for it (HC_SYNC_WAIT, default 120 s; --no-refresh
 * skips that), pulls the documents (sync-documents.mjs, with its local-edit protection) and mirrors the server's data
 * root. A 404 (a host-mode or older server), no token or no answer keeps today's behaviour; a 401 is an error naming
 * the token. Inside the server itself (HC_BUILD=container: scripts/refresh.mjs runs this) the scripts always run.
 *
 * Run: node scripts/sync-all.mjs [--full] [--no-refresh]   (--full reaches the Shortcut sync only: it rebuilds its cache)
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/is-main.mjs';
import { runCli, readIngestToken, readBaseUrl } from '../data/apple-health/sync-common.mjs';
import { dataPaths, displayPath } from '../lib/paths.mjs';
import { detectServer, waitForSeq, mirrorFiles, syncWaitSeconds } from './sync-client.mjs';
import { dataRootGuardError } from './lib/data-root-guard.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(DIR);
// the profile sync (data/profile/, its own files) comes last: it never touches _meta.json, and a
// failure there must not hide the extract syncs' result (runAll runs every script regardless)
// Strava runs BEFORE the Shortcut sync: its workout-zones.csv activity windows are what the Shortcut
// sync leaves out of hr-hourly.csv (lib/health/hr-hourly.mjs), so a new activity is never
// counted twice in day strain until the next sync.
export const SCRIPTS = [
  // the owner's documents (profile.json, plan-data.json, training-data.json) come FIRST: sync-strava reads
  // maxHr from profile.json; a missing / old service or no token only warns (exit 0)
  path.join(ROOT, 'scripts', 'sync-documents.mjs'),
  path.join(ROOT, 'data', 'apple-health', 'sync-strava.mjs'),
  path.join(ROOT, 'data', 'apple-health', 'sync-shortcut.mjs'),
  path.join(ROOT, 'data', 'profile', 'sync-profile.mjs'),
  // the settings snapshot (loop-data/profile/settings.json) never fails the run: a missing / old ingest
  // service is only a warning (exit 0)
  path.join(ROOT, 'data', 'profile', 'sync-settings.mjs'),
  // the in-page onboarding document (loop-data/profile/onboarding.json) likewise only warns (exit 0)
  path.join(ROOT, 'scripts', 'sync-onboarding.mjs'),
  // the food log export (loop-data/foodlog/foodlog-daily.csv) likewise only warns (exit 0) when the
  // ingest service is missing / old
  path.join(ROOT, 'data', 'nutrition', 'sync-foodlog.mjs'),
  // the behaviour journal export (journal-daily.csv in the extract, scripts/sync-journal.mjs) likewise
  // only warns (exit 0) when the ingest service is missing / old
  path.join(ROOT, 'scripts', 'sync-journal.mjs'),
];

const SHORTCUT = path.join(ROOT, 'data', 'apple-health', 'sync-shortcut.mjs');
const DOCUMENTS = SCRIPTS[0];

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

/**
 * `npm run sync`: client mode against a container-mode LOOP server, else every script (see the header). Returns the
 * exit code. `deps` are injected by the tests (scripts/sync-client.test.mjs); SYNC_CLIENT_ROOT = the clone root the
 * data root resolves against (tests), default this clone.
 * @param {{ full?: boolean, 'no-refresh'?: boolean, 'allow-empty'?: boolean, 'allow-removals'?: boolean, verbose?: boolean }} [values]
 * @param {{ env?: Record<string, string | undefined>, spawn?: (cmd: string, args: string[]) => { status: number | null }, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, log?: (m: string) => void, warn?: (m: string) => void }} [deps]
 */
export async function main ({ full = false, 'no-refresh': noRefresh = false, 'allow-empty': allowEmpty = false, 'allow-removals': allowRemovals = false, verbose = false } = {}, {
  env = process.env, spawn = realSpawn, fetchImpl = fetch, sleep, log = console.log, warn = console.error,
} = {}) {
  const hostSyncs = () => runAll(SCRIPTS, scriptArgs({ full }), spawn);
  const repoRoot = env.SYNC_CLIENT_ROOT || ROOT;
  // personal data never lands where git could commit it (scripts/lib/data-root-guard.mjs)
  const guard = dataRootGuardError({ repoRoot, env });
  if (guard) {
    warn(`ERROR: ${guard}`);
    return 1;
  }
  // the server's own refresh: it IS the source, never a client of itself
  if (String(env.HC_BUILD ?? '').trim() === 'container') return hostSyncs();
  const token = readIngestToken(env);
  if (!token) return hostSyncs();
  const waitSeconds = syncWaitSeconds(env);
  const base = readBaseUrl(env);
  const server = await detectServer({ base, token, fetchImpl });
  if (server.mode === 'unauthorized') {
    warn(`ERROR: ${base} refused the ingest token (HTTP 401): save the right one with \`npm run connect -- ${base}\` (or set INGEST_TOKEN, or INGEST_TOKEN in services/loop-ingest/.env) to the server's INGEST_TOKEN (docker/.env on a LOOP server)`);
    return 1;
  }
  if (server.mode === 'host') {
    log(`Note: ${base}/export/files ${server.reason}; running the local syncs`);
    const clientOnly = [noRefresh && '--no-refresh', allowEmpty && '--allow-empty', allowRemovals && '--allow-removals', verbose && '--verbose'].filter(Boolean);
    if (clientOnly.length) log(`Note: ${clientOnly.join(', ')} only ${clientOnly.length > 1 ? 'apply' : 'applies'} to a client of a LOOP server; running every sync`);
    return hostSyncs();
  }
  const paths = dataPaths({ repoRoot, env });
  log(`Client mode: ${base} is a LOOP server (container mode); mirroring its data into ${displayPath(repoRoot, paths.root)}`);
  if (full) log('Note: --full is ignored in client mode (the server keeps the Shortcut cache)');
  let manifest = server.manifest;
  if (!noRefresh) ({ manifest } = await waitForSeq({ base, token, waitSeconds, fetchImpl, ...(sleep ? { sleep } : {}), log, warn }));
  const documents = runAll([DOCUMENTS], [], spawn);
  const mirror = await mirrorFiles({ base, token, manifest, root: paths.root, filesDir: paths.filesDir, backupsDir: path.join(repoRoot, 'backups'), allowEmpty, allowRemovals, verbose, fetchImpl, log, warn });
  return Math.max(documents, mirror);
}

const USAGE = `Usage: node scripts/sync-all.mjs [--full] [--no-refresh] [--allow-empty] [--allow-removals] [--verbose]

Runs every sync (Strava, Shortcut, profile, settings, onboarding, food log, journal) in order, even when
one fails; exits 1 if any failed. Against a LOOP server in container mode (it answers GET /export/files)
this clone is its client instead: it asks the server to refresh (POST /sync) and waits for it, pulls the
documents, then mirrors the server's extract/, profile/, foodlog/, files/documents/ and files/manuals/.
  --full         the Shortcut sync ignores its cache and rebuilds it (not in client mode)
  --no-refresh   client mode: mirror what the server has now, without asking it to refresh first
  --allow-empty  client mode: mirror an empty server even though this clone has mirrored files (removes them all)
  --allow-removals  client mode: go ahead when the mirror would remove more than half of the mirrored files (and >5)
  --verbose      client mode: print each downloaded path too (removed paths are always printed)
Client mode removes only files this clone mirrored (the ledger <data root>/.mirror-state.json), never a file of
its own; under files/ a removed file is moved to backups/<path>.mirror.bak.
  -h, --help     this help
Env: INGEST_URL, INGEST_TOKEN (else the server saved by \`npm run connect -- <url>\`, else services/loop-ingest/.env),
HC_DATA_DIR, HC_FILES_DIR, HC_SYNC_WAIT (client mode: seconds to wait for the server, default 120).`;

if (isMain(import.meta.url)) {
  runCli((values) => main(values), { usage: USAGE, options: { full: { type: 'boolean' }, 'no-refresh': { type: 'boolean' }, 'allow-empty': { type: 'boolean' }, 'allow-removals': { type: 'boolean' }, verbose: { type: 'boolean' } } });
}
