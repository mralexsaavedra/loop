/* Helpers shared by data/apple-health's sync scripts (sync-shortcut.js, sync-strava.js):
 * atomic writes, ingest-token resolution, a timed JSON fetch, generic keyset-paged fetching,
 * and the export-wins/ownership-ledger CSV merge rule. Extracted from sync-shortcut.js so
 * sync-strava.js can reuse the exact same contract instead of duplicating it — pure refactor,
 * no behavior change (sync-shortcut.js re-exports these same names, its own default `isOwn`
 * applied at the call site keeps its test suite green unmodified).
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'http://localhost:8088';
const ENV_FILE = path.join(__dirname, '..', '..', 'services', 'health-ingest', '.env');

// write to a temp file in the same directory, then rename: a crash never leaves a half file
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// token: env first, then INGEST_TOKEN=... from the service's .env text
function resolveToken(env, envFileText) {
  if (env.INGEST_TOKEN) return env.INGEST_TOKEN;
  if (!envFileText) return null;
  const m = /^\s*INGEST_TOKEN\s*=\s*(.*)$/m.exec(envFileText);
  if (!m) return null;
  return m[1].trim().replace(/^(['"])(.*)\1$/, '$2') || null;
}

// resolveToken() + the disk read of the service's .env file, so every sync script's main()
// does the same one-liner instead of repeating the fs.existsSync/readFileSync pair.
function readIngestToken(env, envFile = ENV_FILE) {
  const envText = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null;
  return resolveToken(env, envText);
}

// one request (headers + body) under a hard timeout; the HTTP status (when any) is kept on
// err.status so a 404 can be told apart from a generic failure by the caller.
async function fetchJson(url, token, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal });
    if (!res.ok) throw Object.assign(new Error(`ingest service answered HTTP ${res.status}`), { status: res.status });
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError' || ctrl.signal.aborted) throw new Error(`request timed out after ${timeoutMs / 1000} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// page through a paged GET endpoint from since_id until a short page. `buildUrl({baseUrl, since,
// limit})` builds each page's URL — the caller owns the endpoint path and any extra query params
// (e.g. sync-shortcut's `automation`), fetchPages owns paging + auth + shape validation.
async function fetchPages({ baseUrl, token, buildUrl, sinceId = '0', limit = 500, timeoutMs = 15000, fetchImpl = fetch }) {
  const all = [];
  let since = sinceId;
  for (;;) {
    const url = buildUrl({ baseUrl: baseUrl.replace(/\/+$/, ''), since, limit });
    const page = await fetchJson(url, token, { fetchImpl, timeoutMs });
    if (!Array.isArray(page)) throw new Error('unexpected response shape (expected an array)');
    all.push(...page);
    if (page.length < limit) return all;
    since = page[page.length - 1].id;
  }
}

// Merge sync-written rows into an existing CSV text (null = no file). A row is dropped first
// when its date is in `ownedDates` (the ownership ledger) OR `isOwn(source)` is true (its
// source column tags it as written by this sync) — rebuilt every run — then rows are added only
// for dates with no surviving (export) row. Stable sort keeps export rows' original order.
function mergeCsv(existingText, header, rows, { sourceCol = 2, isOwn = () => false, ownedDates = [] } = {}) {
  const lines = existingText ? existingText.split('\n').filter(Boolean) : [];
  const body = lines.length && lines[0].startsWith('date,') ? lines.slice(1) : lines;
  const owned = new Set(ownedDates);
  const kept = body
    .filter((l) => !owned.has(l.slice(0, 10)) && (sourceCol == null || !isOwn(l.split(',')[sourceCol])))
    .map((line) => ({ date: line.slice(0, 10), line }));
  const covered = new Set(kept.map((r) => r.date));
  const added = rows.filter((r) => !covered.has(r.date));
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

// synchronous sleep (Atomics.wait blocks the event loop deliberately — these are short-lived
// CLI scripts, not servers, so a blocking wait beats a busy-spin loop burning CPU).
function sleepSync (ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Exclusive O_EXCL lockfile guarding a read-compute-write sequence against a lost update when
 * two sync scripts (or two invocations of the same one) touch the same _meta.json concurrently.
 * A lock older than `staleMs` is assumed abandoned by a crashed process and is reclaimed rather
 * than waited out forever.
 */
function acquireLock (lockFile, { staleMs = LOCK_STALE_MS, retryDelayMs = LOCK_RETRY_DELAY_MS, retries = LOCK_RETRIES } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fd = fs.openSync(lockFile, 'wx'); // O_CREAT | O_EXCL: fails if the file already exists
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(lockFile, { force: true });
          continue; // retry immediately, no need to sleep
        }
      } catch {
        continue; // the lock vanished between the failed open and this stat — just retry
      }
      if (attempt === retries) throw new Error(`could not acquire lock ${lockFile} (held and not stale)`);
      sleepSync(retryDelayMs);
    }
  }
}

function releaseLock (lockFile) {
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // already gone — releasing an already-released lock is not an error
  }
}

/** Runs `fn` while holding `lockFile`; the lock is always released, even if `fn` throws. */
function withLock (lockFile, fn, opts) {
  acquireLock(lockFile, opts);
  try {
    return fn();
  } finally {
    releaseLock(lockFile);
  }
}

module.exports = {
  DEFAULT_URL,
  ENV_FILE,
  writeAtomic,
  resolveToken,
  readIngestToken,
  fetchJson,
  fetchPages,
  mergeCsv,
  acquireLock,
  releaseLock,
  withLock,
};
