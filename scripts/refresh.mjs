#!/usr/bin/env node
/* The page refresh of the loop-server image (docker/loop-server.Dockerfile): the Node port of the container-relevant
 * part of services/loop-web/refresh.sh, which keeps serving the host installs unchanged. One pass:
 *
 *   sync (non-fatal) -> generate (validate the plan + build the page, under a timeout) -> sanity check of the built
 *   page -> atomic publish into HC_SITE_DIR -> status.json -> device manuals (best effort)
 *
 * Sequence protocol (the page's Sync button waits on it, web/src/client/freshness.js): the ingest service runs
 * `node scripts/refresh.mjs --seq N --wait-lock` for the sync sequence N it handed out (services/loop-ingest
 * src/builder.js; it serializes the runs and coalesces the clicks, so one pass per call is enough). A publish
 * writes <site>/status.json = {publishedAt, commit, processedSeq}, processedSeq = max(previous, N), never going
 * backwards; `commit` is the IMAGE VERSION (env HC_VERSION, else package.json's version), never git. A failure
 * adds {error: <code>, errorSeq: N} WITHOUT touching publishedAt / processedSeq, and keeps the last good page
 * untouched (nothing is copied into the site unless the new build passed the sanity check). Codes (a subset of
 * refresh.sh's: there is no branch guard and no npm ci in the image):
 *   build   the plan validation or the page build failed or timed out
 *   sanity  the built page is missing / empty / not a whole HTML document, or copying it into the site failed
 *   lock    --wait-lock and another refresh still held the lock after HC_REFRESH_LOCK_WAIT seconds
 * Without --wait-lock a busy lock skips the run (exit 0, no error): the running pass publishes the newer data.
 *
 * Resilience rules (as refresh.sh): a failed sync still rebuilds from the files already on disk; sync and generate
 * each run under HC_REFRESH_STEP_TIMEOUT (default 300 s), the manuals under HC_REFRESH_MANUALS_TIMEOUT (30 s) AFTER
 * status.json (a waiting Sync has already completed; a failure there is logged, never an error code); one refresh at
 * a time (a lock file in the temp dir, keyed by the site dir; a lock whose holder died is taken over).
 *
 * Usage: node scripts/refresh.mjs [--seq N] [--wait-lock]
 * Env:   HC_SITE_DIR (required: the published folder), HC_BUILD_DIR (the build output, default
 *        <tmp>/loop-build/personal), HC_VERSION, HC_DATA_DIR / INGEST_URL / INGEST_TOKEN (read by the syncs and the
 *        build), HC_REFRESH_STEP_TIMEOUT, HC_REFRESH_MANUALS_TIMEOUT, HC_REFRESH_LOCK_WAIT (seconds).
 * Exit:  0 published (or skipped: lock busy without --wait-lock), 1 failed (status.json carries the code), 2 usage. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/is-main.mjs';
import { runCli } from '../data/apple-health/sync-common.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const ERROR_CODES = Object.freeze(['build', 'sanity', 'lock']);
export const DEFAULTS = Object.freeze({ stepTimeoutS: 300, manualsTimeoutS: 30, lockWaitS: 900 });
// a lock file not refreshed for this long belongs to a dead holder (the holder touches it every LOCK_TOUCH_MS)
export const LOCK_STALE_MS = 2 * 60_000;
const LOCK_TOUCH_MS = 30_000;
const KILL_GRACE_MS = 10_000;
const SEQ = /^\d{1,15}$/;

/** The version status.json reports as `commit`: HC_VERSION, else the repo's package.json version; only the
 * characters a version tag uses (so it is always a safe JSON string), at most 64. */
export function imageVersion({ env = process.env, repoRoot = ROOT } = {}) {
  const clean = (v) => String(v ?? '').replace(/[^A-Za-z0-9._+-]/g, '').slice(0, 64);
  const fromEnv = clean(env.HC_VERSION);
  if (fromEnv) return fromEnv;
  try {
    return clean(JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version) || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The last good publish recorded in <site>/status.json ({publishedAt, commit, processedSeq}), or null. */
export function readPublished(siteDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(siteDir, 'status.json'), 'utf8'));
    if (!s || typeof s !== 'object' || typeof s.publishedAt !== 'string' || !Number.isSafeInteger(s.processedSeq) || s.processedSeq < 0) return null;
    return { publishedAt: s.publishedAt, commit: typeof s.commit === 'string' ? s.commit : 'unknown', processedSeq: s.processedSeq };
  } catch {
    return null;
  }
}

/** Writes <site>/status.json atomically (temp file + rename in the same folder). */
export function writeStatus(siteDir, body) {
  fs.mkdirSync(siteDir, { recursive: true });
  const tmp = path.join(siteDir, `.status.json.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(body) + '\n');
  fs.renameSync(tmp, path.join(siteDir, 'status.json'));
}

/** True when `file` is a non-empty, whole HTML document (it ends its <html>). */
export function pageIsSane(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) return false;
    return fs.readFileSync(file, 'utf8').includes('</html>');
  } catch {
    return false;
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

/** One lock file per site dir, in the temp dir (a container's /tmp starts empty, so a restart never inherits it). */
export function defaultLockFile(siteDir) {
  return path.join(os.tmpdir(), `loop-refresh-${createHash('sha256').update(path.resolve(siteDir)).digest('hex').slice(0, 12)}.lock`);
}

/** Takes the lock now, or returns null when a live holder has it. A lock file whose pid is gone, or that was not
 * refreshed for `staleMs`, is taken over. Returns { release }; the holder's mtime is refreshed while held. */
export function tryLock(file, { staleMs = LOCK_STALE_MS, now = Date.now } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      fs.writeSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      const touch = setInterval(() => { try { const t = new Date(); fs.utimesSync(file, t, t); } catch {} }, LOCK_TOUCH_MS);
      touch.unref();
      return { release() { clearInterval(touch); try { fs.unlinkSync(file); } catch {} } };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let stale;
    try {
      const pid = Number(fs.readFileSync(file, 'utf8').trim());
      stale = !isAlive(pid) || now() - fs.statSync(file).mtimeMs > staleMs;
    } catch (err) {
      stale = err.code === 'ENOENT';
    }
    if (!stale) return null;
    try { fs.unlinkSync(file); } catch {}
  }
  return null;
}

/** tryLock, retried every `pollMs` for up to `waitMs` (0 = one attempt). */
export async function acquireLock(file, { waitMs = 0, pollMs = 1000, staleMs = LOCK_STALE_MS } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const lock = tryLock(file, { staleMs });
    if (lock || Date.now() >= deadline) return lock;
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
}

/** Runs `node <args>` from the repo root with inherited stdio, under `timeoutMs` (SIGTERM, then SIGKILL after 10 s).
 * Resolves true on exit 0, false on any failure (never rejects).
 * @param {string[]} args
 * @param {{ timeoutMs: number, cwd?: string, env?: NodeJS.ProcessEnv, log?: (m: string) => void }} opts */
export function runNode(args, { timeoutMs, cwd = ROOT, env = process.env, log = console.error }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
    } catch (err) {
      log(`refresh: could not start ${args[0]}: ${err.message}`);
      resolve(false);
      return;
    }
    let killer = null;
    const timer = setTimeout(() => {
      log(`refresh: ${args[0]} timed out after ${Math.round(timeoutMs / 1000)} s`);
      child.kill('SIGTERM');
      killer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      killer.unref();
    }, timeoutMs);
    child.on('error', (err) => { log(`refresh: ${args[0]}: ${err.message}`); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killer) clearTimeout(killer);
      resolve(code === 0);
    });
  });
}

/** The real steps (each resolves true on success): the syncs, the plan validation + page build into `buildDir`,
 * the manuals into <site>/manuales. */
export function realSteps({ buildDir, siteDir, stepTimeoutMs, manualsTimeoutMs, env = process.env }) {
  const run = (args, timeoutMs) => runNode(args, { timeoutMs, env });
  return {
    sync: () => run(['scripts/sync-all.mjs'], stepTimeoutMs),
    // generate.mjs --check validates the plan without writing plan-tables.md (the image's code is read-only)
    generate: async () =>
      (await run(['data/nutrition/generate.mjs', '--check'], stepTimeoutMs)) &&
      run(['scripts/build-web.mjs', '--mode', 'personal', '--outdir', buildDir], stepTimeoutMs),
    manuals: () => run(['scripts/publish-manuals.mjs', '--out', path.join(siteDir, 'manuales')], manualsTimeoutMs),
  };
}

/**
 * One refresh pass for `seq` (see the header). `steps` = { sync, generate, manuals }, async, each resolving true on
 * success (injected by the tests). Returns { ok, code?, skipped?, processedSeq? }.
 */
export async function refresh({
  seq = null,
  siteDir,
  buildDir,
  steps,
  version = imageVersion(),
  waitLock = false,
  lockWaitMs = DEFAULTS.lockWaitS * 1000,
  lockFile = defaultLockFile(siteDir),
  now = () => new Date(),
  log = (m) => console.error(`refresh: ${m}`),
}) {
  const fail = (code, at, message) => {
    log(message);
    const published = readPublished(siteDir);
    try {
      writeStatus(siteDir, { ...(published || {}), error: code, errorSeq: at });
    } catch (err) {
      log(`could not write status.json: ${err.message}`);
    }
    return { ok: false, code };
  };

  const lock = await acquireLock(lockFile, { waitMs: waitLock ? lockWaitMs : 0 });
  if (!lock) {
    const at = seq ?? readPublished(siteDir)?.processedSeq ?? 0;
    if (waitLock) return fail('lock', at, 'previous run still active after waiting, giving up');
    log('previous run still active, skipping');
    return { ok: true, skipped: true };
  }
  try {
    // no --seq (a manual run): publish without advancing the sequence
    const start = seq ?? readPublished(siteDir)?.processedSeq ?? 0;
    if (!(await steps.sync())) log('sync failed, rebuilding from the files already on disk');
    if (!(await steps.generate())) return fail('build', start, 'generate failed, keeping previous page');

    const out = path.join(buildDir, 'index.html');
    if (!pageIsSane(out)) return fail('sanity', start, `build output missing/empty/invalid (${out}), keeping previous page`);
    try {
      fs.mkdirSync(siteDir, { recursive: true });
      const tmp = path.join(siteDir, `.index.html.${process.pid}.tmp`);
      fs.copyFileSync(out, tmp);
      fs.renameSync(tmp, path.join(siteDir, 'index.html'));
    } catch (err) {
      return fail('sanity', start, `copy to site failed (${err.message}), keeping previous page`);
    }

    const processedSeq = Math.max(readPublished(siteDir)?.processedSeq ?? 0, start);
    const publishedAt = now().toISOString().replace(/\.\d{3}Z$/, 'Z');
    try {
      writeStatus(siteDir, { publishedAt, commit: version, processedSeq });
    } catch (err) {
      log(`could not write status.json: ${err.message}`);
      return { ok: false, code: null };
    }
    log(`published ${publishedAt} (processedSeq ${processedSeq}, version ${version})`);

    if (!(await steps.manuals())) log('publishing device manuals failed, page published anyway');
    return { ok: true, processedSeq };
  } finally {
    lock.release();
  }
}

export const USAGE = `Usage: node scripts/refresh.mjs [--seq N] [--wait-lock]

Syncs, builds the personal page and publishes it into HC_SITE_DIR with status.json (the loop-server image's refresh).
  --seq N       the sync sequence this run publishes (default: keep the published one)
  --wait-lock   wait for a running refresh (up to HC_REFRESH_LOCK_WAIT s) instead of skipping
  -h, --help    this help
Env: HC_SITE_DIR (required), HC_BUILD_DIR, HC_VERSION, HC_REFRESH_STEP_TIMEOUT, HC_REFRESH_MANUALS_TIMEOUT,
HC_REFRESH_LOCK_WAIT (seconds); the syncs read INGEST_URL / INGEST_TOKEN, the build HC_DATA_DIR.`;

/** A positive whole number of seconds from env `name`, else `def`. */
export function secondsEnv(env, name, def) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return def;
  const n = Number(String(raw).trim());
  if (!/^\d+$/.test(String(raw).trim()) || n < 1 || n > 86_400) throw new Error(`invalid ${name}=${JSON.stringify(String(raw)).slice(0, 40)}: expected whole seconds from 1 to 86400`);
  return n;
}

/** The CLI after its flags are parsed; returns the exit code.
 * @param {{ seq?: string, 'wait-lock'?: boolean }} [values]
 * @param {{ env?: Record<string, string | undefined>, stepsFor?: typeof realSteps, error?: (m: string) => void }} [deps] */
export async function main({ seq, 'wait-lock': waitLock = false } = {}, { env = process.env, stepsFor = realSteps, error = console.error } = {}) {
  if (seq !== undefined && !SEQ.test(String(seq))) { error(`ERROR: --seq must be a whole number, got ${JSON.stringify(seq)}\n\n${USAGE}`); return 2; }
  const site = String(env.HC_SITE_DIR ?? '').trim();
  if (!site) { error(`ERROR: HC_SITE_DIR is not set (the folder the page is published into)\n\n${USAGE}`); return 2; }
  const siteDir = path.resolve(site);
  const buildDir = path.resolve(String(env.HC_BUILD_DIR ?? '').trim() || path.join(os.tmpdir(), 'loop-build', 'personal'));
  const stepTimeoutMs = secondsEnv(env, 'HC_REFRESH_STEP_TIMEOUT', DEFAULTS.stepTimeoutS) * 1000;
  const manualsTimeoutMs = secondsEnv(env, 'HC_REFRESH_MANUALS_TIMEOUT', DEFAULTS.manualsTimeoutS) * 1000;
  const lockWaitMs = secondsEnv(env, 'HC_REFRESH_LOCK_WAIT', DEFAULTS.lockWaitS) * 1000;
  const r = await refresh({
    seq: seq === undefined ? null : Number(seq),
    siteDir,
    buildDir,
    steps: stepsFor({ buildDir, siteDir, stepTimeoutMs, manualsTimeoutMs, env }),
    version: imageVersion({ env }),
    waitLock,
    lockWaitMs,
  });
  return r.ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  runCli((values) => main(values), { usage: USAGE, options: { seq: { type: 'string' }, 'wait-lock': { type: 'boolean' } } });
}
