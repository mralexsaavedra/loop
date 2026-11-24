/* Helpers shared by every sync script (data/apple-health/sync-*.mjs, data/nutrition/sync-foodlog.mjs,
 * data/profile/sync-*.mjs, scripts/sync-*.mjs): atomic writes, the ingest .env (INGEST_ENV_FILE), token
 * and base-URL resolution (env, then the saved server <data root>/server.json of `npm run connect`, then the
 * clone's services/loop-ingest/.env), a timed JSON fetch, generic keyset-paged fetching, the export-wins /
 * ownership-ledger CSV merge rule, a lockfile, and the one command line (parseCli / runCli).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { addDays } from '../../lib/date.mjs';
import { dataPaths } from '../../lib/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_URL = 'http://localhost:8088';
const ENV_FILE = path.join(__dirname, '..', '..', 'services', 'loop-ingest', '.env');
const REPO_ROOT = path.join(__dirname, '..', '..');
/** The saved server of `npm run connect` (scripts/connect.mjs), in the data root. */
const SERVER_FILE = 'server.json';

/** A process environment (process.env, or a test's plain object). @typedef {Record<string, string | undefined>} Env */
/** What a sync step may throw: an Error, with the HTTP status when the server answered (fetchJson) and the
 * cause of a failed connection (cause.code, e.g. ECONNREFUSED); the warnings read it through a cast.
 * @typedef {Error & { status?: number, code?: string, cause?: { code?: string, message?: string } }} SyncError */
/** The values util.parseArgs gives for the options `O` (strict, no positionals, no `multiple` option; --help removed):
 * a boolean flag true when given, a string option its value, each absent when not given.
 * @template {import('node:util').ParseArgsOptionsConfig} O
 * @typedef {{ [K in keyof O]?: O[K]['type'] extends 'boolean' ? boolean : string }} CliValues */
/** parseCli's result: the values, or the exit code with what to print (--help: out, a bad flag: err).
 * @template {import('node:util').ParseArgsOptionsConfig} O
 * @typedef {{ values: CliValues<O>, exit?: undefined, out?: undefined, err?: undefined }
 *   | { exit: 0, out: string, values?: undefined, err?: undefined }
 *   | { exit: 2, err: string, values?: undefined, out?: undefined }} CliResult */

// write to a temp file in the same directory, then rename: a crash never leaves a half file; a failed
// write or rename removes the temp file (it holds personal data) before the error goes up
/** @param {string} file @param {string | NodeJS.ArrayBufferView} text */
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// token: env first, then INGEST_TOKEN=... from the service's .env text
/** @param {Env} env @param {string | null} envFileText @returns {string | null} */
function resolveToken(env, envFileText) {
  if (env.INGEST_TOKEN) return env.INGEST_TOKEN;
  if (!envFileText) return null;
  const m = /^\s*INGEST_TOKEN\s*=\s*(.*)$/m.exec(envFileText);
  if (!m) return null;
  return m[1].trim().replace(/^(['"])(.*)\1$/, '$2') || null;
}

// The service .env a script reads: INGEST_ENV_FILE when set (the child-process tests point it at a
// throwaway file), else this clone's services/loop-ingest/.env.
/** @param {Env} env */
function envFileOf(env) {
  return env.INGEST_ENV_FILE || ENV_FILE;
}

// <data root>/server.json for `env` (HC_DATA_DIR, else this clone's loop-data/): where `npm run connect` saves
// the LOOP server this clone is a client of
/** @param {Env} env */
function serverFileOf(env) {
  return path.join(dataPaths({ repoRoot: REPO_ROOT, env }).root, SERVER_FILE);
}

// {url, token} of the saved server, each null when missing or malformed (a broken file is skipped, never fatal):
// url an http(s) URL without its trailing slash, token a non-empty string
/** @param {Env} env @returns {{ url: string | null, token: string | null }} */
function readSavedServer(env) {
  /** @type {any} untrusted JSON, each field checked below */
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(serverFileOf(env), 'utf8'));
  } catch {
    return { url: null, token: null };
  }
  const url = typeof raw?.url === 'string' && /^https?:\/\/[^\s]+$/.test(raw.url) ? raw.url.replace(/\/+$/, '') : null;
  const token = typeof raw?.token === 'string' && raw.token.trim() ? raw.token.trim() : null;
  return { url, token };
}

// A base URL in one spelling for comparison: lower-case scheme and host, no trailing slash (the raw string, minus
// its trailing slashes, when it does not parse).
/** @param {unknown} u */
function normalizeUrl(u) {
  const s = String(u).trim().replace(/\/+$/, '');
  try {
    const url = new URL(s);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return s;
  }
}

// resolveToken() + the disk reads, so every sync script's main() does the same one-liner: INGEST_TOKEN from env,
// then the saved server's token (npm run connect) -- only when the URL resolves to that saved server, so an env
// INGEST_URL pointing elsewhere never receives it -- then the service's .env file.
/** @param {Env} env @param {string} [envFile] @returns {string | null} */
function readIngestToken(env, envFile = envFileOf(env)) {
  if (env.INGEST_TOKEN) return env.INGEST_TOKEN;
  const saved = readSavedServer(env);
  if (saved.token && saved.url && (!env.INGEST_URL || normalizeUrl(env.INGEST_URL) === normalizeUrl(saved.url))) return saved.token;
  const envText = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null;
  return resolveToken(env, envText);
}

// base URL: INGEST_URL env first, then http://localhost:<INGEST_PORT> from THIS clone's service .env, then
// DEFAULT_URL. A second clone on the same host (another person's install) runs its own service on another
// port; reading the port from the clone's own .env keeps each person's sync on their own data.
/** @param {Env} env @param {string | null} envFileText @returns {string} */
function resolveBaseUrl(env, envFileText) {
  if (env.INGEST_URL) return env.INGEST_URL.replace(/\/+$/, '');
  const m = envFileText ? /^\s*INGEST_PORT\s*=\s*(['"]?)(\d{1,5})\1\s*$/m.exec(envFileText) : null;
  return m ? `http://localhost:${m[2]}` : DEFAULT_URL;
}

// resolveBaseUrl() + the disk reads (the readIngestToken() order: env, the saved server, the .env file).
/** @param {Env} env @param {string} [envFile] @returns {string} */
function readBaseUrl(env, envFile = envFileOf(env)) {
  if (!env.INGEST_URL) {
    const saved = readSavedServer(env).url;
    if (saved) return saved;
  }
  const envText = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null;
  return resolveBaseUrl(env, envText);
}

// One GET (headers + body) under a hard timeout; the HTTP status (when any) is kept on err.status so a
// 404 can be told apart from a generic failure by the caller. `token` null = no authorization header
// (the LAN-only /food/* and /journal/* layers, which take their own `headers` and `redirect: 'error'`).
/**
 * @param {string} url
 * @param {string | null} token
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, headers?: Record<string, string>, redirect?: 'follow' | 'error' | 'manual', onResponse?: (res: Response) => void }} [opts]
 */
async function fetchJson(url, token, { fetchImpl = fetch, timeoutMs = 15000, headers = {}, redirect, onResponse } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    /** @type {RequestInit} */
    const init = { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, signal: ctrl.signal };
    if (redirect) init.redirect = redirect;
    const res = await fetchImpl(url, init);
    if (!res.ok) throw Object.assign(new Error(`ingest service answered HTTP ${res.status}`), { status: res.status });
    if (onResponse) onResponse(res); // e.g. fetchPages reads the X-Has-More header
    return await res.json();
  } catch (err) {
    // no `cause`: the scripts print err.cause.code first (a refused connection), and a timeout must print this
    // eslint-disable-next-line preserve-caught-error
    if (/** @type {Error} */ (err).name === 'AbortError' || ctrl.signal.aborted) throw new Error(`request timed out after ${timeoutMs / 1000} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// page through a paged GET endpoint from since_id until a short page. `buildUrl({baseUrl, since,
// limit})` builds each page's URL — the caller owns the endpoint path and any extra query params
// (e.g. sync-shortcut's `automation`), fetchPages owns paging + auth + shape validation. The cursor
// must advance: a full page whose last id is missing, non-numeric or not greater than `since` throws
// `unexpected paging cursor` (ids are compared as BigInt, exact past 2^53), and `maxPages` is a hard cap,
// so a misbehaving server can never loop it forever. A short page normally ends the paging, unless the
// server answers `X-Has-More: true` (loop-ingest's /export/raw cuts a page at its byte budget): then the
// next page is requested from the last id of this one.
const MAX_PAGES = 10000;
/** @param {unknown} v */
const cursorOf = (v) => (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string') && /^\d+$/.test(String(v)) ? BigInt(v) : null;
/**
 * @param {{ baseUrl: string, token: string | null, buildUrl: (q: { baseUrl: string, since: string, limit: number }) => string,
 *   sinceId?: string, limit?: number, timeoutMs?: number, fetchImpl?: typeof fetch, maxPages?: number }} opts
 * @returns {Promise<any[]>} the rows as parsed (untrusted JSON: the callers check each field)
 */
async function fetchPages({ baseUrl, token, buildUrl, sinceId = '0', limit = 500, timeoutMs = 15000, fetchImpl = fetch, maxPages = MAX_PAGES }) {
  const all = [];
  let since = sinceId;
  for (let pages = 0; ; ) {
    if (pages >= maxPages) throw new Error(`unexpected paging: more than ${maxPages} pages`);
    pages++;
    const url = buildUrl({ baseUrl: baseUrl.replace(/\/+$/, ''), since, limit });
    let more = false;
    const page = await fetchJson(url, token, {
      fetchImpl, timeoutMs,
      onResponse: (res) => { more = String(res.headers?.get?.('x-has-more') ?? '').toLowerCase() === 'true'; },
    });
    if (!Array.isArray(page)) throw new Error('unexpected response shape (expected an array)');
    all.push(...page);
    if (page.length < limit && !more) return all;
    const next = page[page.length - 1] && page[page.length - 1].id;
    const nextN = cursorOf(next), sinceN = cursorOf(since);
    if (nextN == null || (sinceN != null && nextN <= sinceN)) {
      throw new Error(`unexpected paging cursor (last id ${JSON.stringify(next ?? null)} after since_id ${since})`);
    }
    since = next;
  }
}

// Merge sync-written rows into an existing CSV text (null = no file). A row is dropped first
// when its date is in `ownedDates` (the ownership ledger) OR `isOwn(source)` is true (its
// source column tags it as written by this sync) — rebuilt every run — then rows are added only
// for dates with no surviving (export) row. `exportWins: false` skips that date filter and adds
// EVERY row (sync-strava: its rows carry data the export never has, and the readers dedupe a
// Watch + Strava copy of one session themselves). Stable sort keeps export rows' original order.
/**
 * @param {string | null} existingText
 * @param {string} header
 * @param {{ date: string, line: string }[]} rows
 * @param {{ sourceCol?: number | null, isOwn?: (source: string) => boolean, ownedDates?: string[], exportWins?: boolean }} [opts]
 */
function mergeCsv(existingText, header, rows, { sourceCol = 2, isOwn = () => false, ownedDates = [], exportWins = true } = {}) {
  const lines = existingText ? existingText.split('\n').filter(Boolean) : [];
  const body = lines.length && lines[0].startsWith('date,') ? lines.slice(1) : lines;
  const owned = new Set(ownedDates);
  const kept = body
    .filter((l) => !owned.has(l.slice(0, 10)) && (sourceCol == null || !isOwn(l.split(',')[sourceCol])))
    .map((line) => ({ date: line.slice(0, 10), line }));
  const covered = new Set(kept.map((r) => r.date));
  const added = exportWins ? rows.filter((r) => !covered.has(r.date)) : rows;
  const all = [...kept, ...added].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    text: [header, ...all.map((r) => r.line)].join('\n') + '\n',
    added: added.length,
    rows: all.length,
    dates: [...new Set(all.map((r) => r.date))],
    addedDates: [...new Set(added.map((r) => r.date))].sort(),
  };
}

const LOCK_STALE_MS = 2 * 60 * 1000; // 2 minutes — long enough for any real sync, short enough not to wedge a retry indefinitely
const LOCK_RETRY_DELAY_MS = 100;
const LOCK_RETRIES = 50; // ~5s total wait against a fresh (non-stale) lock before giving up
/** @typedef {{ staleMs?: number, retryDelayMs?: number, retries?: number }} LockOptions */

// synchronous sleep (Atomics.wait blocks the event loop deliberately — these are short-lived
// CLI scripts, not servers, so a blocking wait beats a busy-spin loop burning CPU).
/** @param {number} ms */
function sleepSync (ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Exclusive O_EXCL lockfile guarding a read-compute-write sequence against a lost update when
 * two sync scripts (or two invocations of the same one) touch the same _meta.json concurrently.
 * A lock older than `staleMs` is assumed abandoned by a crashed process and is reclaimed rather
 * than waited out forever.
 * @param {string} lockFile
 * @param {LockOptions} [opts]
 */
function acquireLock (lockFile, { staleMs = LOCK_STALE_MS, retryDelayMs = LOCK_RETRY_DELAY_MS, retries = LOCK_RETRIES } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fd = fs.openSync(lockFile, 'wx'); // O_CREAT | O_EXCL: fails if the file already exists
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > staleMs) {
          reclaimStaleLock(lockFile, stat);
          continue; // retry immediately (reclaimed, or another process got there first), no need to sleep
        }
      } catch {
        continue; // the lock vanished between the failed open and this stat — just retry
      }
      if (attempt === retries) throw new Error(`could not acquire lock ${lockFile} (held and not stale)`, { cause: err });
      sleepSync(retryDelayMs);
    }
  }
}

/**
 * Removes the stale lock `seen` (the fs.Stats that judged it stale) and nothing else: the lock is renamed to a
 * claim file first (atomic, so of two processes that judged the same lock stale only one gets it), and the
 * claim is deleted only when it is still that file (same dev, inode and mtime). If a fresh lock had already
 * replaced it, it is linked back into place (unless yet another lock took the path meanwhile). True when this
 * call removed the stale lock.
 * @param {string} lockFile @param {fs.Stats} seen
 */
function reclaimStaleLock (lockFile, seen) {
  const claim = `${lockFile}.${process.pid}.reclaim`;
  try {
    fs.renameSync(lockFile, claim);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return false; // another process reclaimed (or released) it first
    throw err;
  }
  const st = fs.statSync(claim);
  if (st.dev === seen.dev && st.ino === seen.ino && st.mtimeMs === seen.mtimeMs) {
    fs.rmSync(claim, { force: true });
    return true;
  }
  try {
    fs.linkSync(claim, lockFile); // not the stale lock: give the fresh one back to its holder
  } catch {
    // EEXIST: a newer lock already holds the path; the displaced holder never removes it (releaseLock checks the pid)
  }
  fs.rmSync(claim, { force: true });
  return false;
}

/** Removes the lock only when it holds OUR pid: after a run that outlived staleMs, another process may have
 * reclaimed it, and its lock must survive.
 * @param {string} lockFile */
function releaseLock (lockFile) {
  let owner;
  try {
    owner = fs.readFileSync(lockFile, 'utf8').trim();
  } catch {
    return; // already gone — releasing an already-released lock is not an error
  }
  if (owner !== String(process.pid)) return;
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // gone in between
  }
}

/** Runs `fn` while holding `lockFile`; the lock is always released, even if `fn` throws.
 * @template T @param {string} lockFile @param {() => T} fn @param {LockOptions} [opts] @returns {T} */
function withLock (lockFile, fn, opts) {
  acquireLock(lockFile, opts);
  try {
    return fn();
  } finally {
    releaseLock(lockFile);
  }
}

/* ---------- the date window the LAN-page syncs (food log, journal) ask for ---------- */

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');
/** A Date -> its LOCAL calendar date, YYYY-MM-DD (the viewer's day, not UTC's). @param {Date} d */
function localIso(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** {from, to}: `days` days inclusive, ending on the local date of `now`. @param {Date} now @param {number} days */
function windowEndingOn(now, days) {
  const to = localIso(now);
  return { from: addDays(to, -(days - 1)), to };
}

/* ---------- the command line every sync script shares ---------- */

/** argv (without node and the script) -> {values} | {exit: 0, out: usage} (--help / -h) | {exit: 2, err}
 * (an unknown flag, a missing value or a stray argument: strict, no positionals). `options` are
 * util.parseArgs options; --help is always there. Pure.
 * @template {import('node:util').ParseArgsOptionsConfig} O
 * @param {string[]} argv @param {{ usage: string, options?: O }} opts
 * @returns {CliResult<O>} */
function parseCli(argv, { usage, options = /** @type {O} */ ({}) }) {
  /** @type {Record<string, unknown>} */
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { help: { type: 'boolean', short: 'h' }, ...options }, strict: true, allowPositionals: false }));
  } catch (err) {
    return { exit: 2, err: `ERROR: ${/** @type {Error} */ (err).message}\n\n${usage}` };
  }
  if (values.help) return { exit: 0, out: usage };
  const { help, ...rest } = values;
  return { values: /** @type {CliValues<O>} */ (rest) };
}

/** A sync script's entry point: parseCli first (--help / a bad flag never reaches main), then
 * `await main(values)`; a number main returns is the exit code (none = 0), a rejected main prints one
 * `ERROR:` line and exits 1. The exit code is set, not forced, so the output is flushed first.
 * @template {import('node:util').ParseArgsOptionsConfig} O
 * @param {(values: CliValues<O>) => unknown} main
 * @param {{ usage: string, options?: O, argv?: string[], guardDataRoot?: boolean }} opts */
async function runCli(main, { usage, options = /** @type {O} */ ({}), argv = process.argv.slice(2), guardDataRoot = false }) {
  const cli = parseCli(argv, { usage, options });
  if (cli.exit != null) {
    if (cli.exit) console.error(cli.err);
    else console.log(cli.out);
    process.exitCode = cli.exit;
    return;
  }
  // a script that writes the data root refuses one git could commit before anything is read or written
  // (scripts/lib/data-root-guard.mjs, the same check npm run sync makes; imported only here, so a read-only
  // command such as generate.mjs does not depend on it)
  const guard = guardDataRoot
    ? (await import('./data-root-guard.mjs')).dataRootGuardError({ repoRoot: REPO_ROOT, env: process.env })
    : null;
  if (guard) {
    console.error(`ERROR: ${guard}`);
    process.exitCode = 1;
    return;
  }
  try {
    const code = await main(cli.values);
    process.exitCode = typeof code === 'number' ? code : 0;
  } catch (err) {
    console.error(`ERROR: ${(err && /** @type {Error} */ (err).message) || err}`);
    process.exitCode = 1;
  }
}

export {
  DEFAULT_URL,
  ENV_FILE,
  envFileOf,
  serverFileOf,
  readSavedServer,
  writeAtomic,
  localIso,
  windowEndingOn,
  resolveToken,
  readIngestToken,
  resolveBaseUrl,
  readBaseUrl,
  fetchJson,
  fetchPages,
  mergeCsv,
  acquireLock,
  releaseLock,
  reclaimStaleLock,
  withLock,
  parseCli,
  runCli,
};
