/* Client mode of `npm run sync` (scripts/sync-all.mjs): a coach clone of a LOOP server in container mode (the
 * loop-server image, which owns the processed data in its /data volume) MIRRORS the server's data root instead of
 * syncing on its own (no local fold of the Shortcut payloads or Strava activities). docs/data-pipeline.md -> Coach as
 * a client of a LOOP server.
 *
 *   detectServer  GET <INGEST_URL>/export/files with the bearer token: 200 = a container-mode server (client mode),
 *                 404 = a host-mode or older server (today's syncs), 401 = the token was refused (an error)
 *   waitForSeq    POST /sync (the page's Sync button route), then poll the manifest until the server's published
 *                 processedSeq reaches that seq, bounded by HC_SYNC_WAIT (default 120 s): on a timeout or a failed
 *                 server build for that seq, one WARNING and the data is pulled anyway
 *   mirrorFiles   the allowlisted folders (services/loop-ingest/src/files-export.js EXPORT_DIRS: extract/, profile/,
 *                 foodlog/, files/documents/, files/manuals/) into this clone's data root (lib/paths.mjs): a file is
 *                 downloaded only when its sha256 differs, written to a hidden temp file next to it, checked (size and
 *                 sha256) and renamed into place; a local file in those folders the server no longer lists is removed.
 *                 Never cache/ (scripts/sync-documents.mjs owns it, with its local-edit protection), files/import/,
 *                 hidden, temp, lock or backup files, symlinks, or anything outside the allowlist. A manifest with
 *                 one path outside the allowlist, or a name the server never lists (hidden, *.tmp, *.lock, *.bak),
 *                 is refused as a whole (nothing written or removed); so is an empty manifest while the clone has
 *                 mirrored files (--allow-empty), a run removing more than half of them and more than 5
 *                 (--allow-removals), or an allowlisted folder (or the files folder) that is a symlink in the clone.
 *                 Each removed path is printed (each downloaded one with --verbose), never any content. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { EXPORT_DIRS, exportPathError, exportDirOf, exportableName, listExportFiles } from '../services/loop-ingest/src/files-export.js';

export const DEFAULT_SYNC_WAIT_S = 120;
const POLL_MS = 2000;
const REQUEST_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 300000;
const SHA_RE = /^[0-9a-f]{64}$/;

/** HC_SYNC_WAIT: whole seconds from 1 to 3600, default 120; anything else throws. */
export function syncWaitSeconds(env) {
  const raw = String(env.HC_SYNC_WAIT ?? '').trim();
  if (raw === '') return DEFAULT_SYNC_WAIT_S;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > 3600) throw new Error(`invalid HC_SYNC_WAIT=${JSON.stringify(raw).slice(0, 40)}: expected whole seconds from 1 to 3600`);
  return n;
}

async function request(url, { token = null, method = 'GET', timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: 'error', signal: ctrl.signal });
    return { res, clear: () => clearTimeout(timer) };
  } catch (err) {
    clearTimeout(timer);
    // eslint-disable-next-line preserve-caught-error
    if (ctrl.signal.aborted) throw new Error(`request timed out after ${timeoutMs / 1000} s`);
    throw err;
  }
}

/** The manifest body, or throws on any other shape. */
function manifestOf(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.files) || !body.site || typeof body.site !== 'object') throw new Error('unexpected manifest shape');
  return body;
}

/** GET the manifest: the parsed body, or throws with err.status for a non-200. */
async function fetchManifest(base, token, fetchImpl) {
  const { res, clear } = await request(`${base}/export/files`, { token, fetchImpl });
  try {
    if (res.status !== 200) {
      await res.body?.cancel?.();
      throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    }
    return manifestOf(await res.json());
  } finally {
    clear();
  }
}

/**
 * Which kind of server answers at `base`: {mode: 'client', manifest} | {mode: 'host', reason} | {mode: 'unauthorized'}.
 * A host-mode or older server answers 404; anything that is not a manifest, a 401 or a 404 (no server, a 5xx, a
 * timeout) is 'host' with the reason: today's syncs then run and warn on their own.
 */
export async function detectServer({ base, token, fetchImpl = fetch }) {
  try {
    return { mode: 'client', manifest: await fetchManifest(base, token, fetchImpl) };
  } catch (err) {
    if (err.status === 401) return { mode: 'unauthorized' };
    if (err.status === 404) return { mode: 'host', reason: 'no /export/files (a host-mode server)' };
    return { mode: 'host', reason: err.cause?.code || err.message };
  }
}

/**
 * POST /sync, then poll the manifest every 2 s until its site.processedSeq reaches the returned seq. Returns
 * {waited, seq, manifest}: waited false after a timeout (HC_SYNC_WAIT), a failed server build for that seq or a failed
 * POST, each with one WARNING; the manifest is then the latest one (fetched again when needed).
 */
export async function waitForSeq({ base, token, waitSeconds = DEFAULT_SYNC_WAIT_S, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), log = console.log, warn = console.warn }) {
  let seq;
  try {
    const { res, clear } = await request(`${base}/sync`, { method: 'POST', fetchImpl });
    try {
      const body = /** @type {any} */ (res.ok ? await res.json() : null);
      if (!Number.isSafeInteger(body?.seq)) throw new Error(`HTTP ${res.status}`);
      seq = body.seq;
    } finally {
      clear();
    }
  } catch (err) {
    warn(`WARNING: could not ask the server to refresh (POST /sync: ${err.cause?.code || err.message}); pulling what it has now`);
    return { waited: false, seq: null, manifest: await fetchManifest(base, token, fetchImpl) };
  }
  log(`Server refresh requested (sync ${seq}); waiting up to ${waitSeconds} s for the server to process it`);
  const deadline = now() + waitSeconds * 1000;
  for (;;) {
    const manifest = await fetchManifest(base, token, fetchImpl);
    const { processedSeq, error, errorSeq } = manifest.site;
    if (Number.isSafeInteger(processedSeq) && processedSeq >= seq) {
      log(`Server processed sync ${seq}`);
      return { waited: true, seq, manifest };
    }
    if (typeof error === 'string' && Number.isSafeInteger(errorSeq) && errorSeq >= seq) {
      warn(`WARNING: the server's page build failed (${error}) for sync ${seq}; pulling its data anyway (the server's logs and the page say why)`);
      return { waited: false, seq, manifest };
    }
    if (now() >= deadline) {
      warn(`WARNING: the server has not processed sync ${seq} after ${waitSeconds} s (HC_SYNC_WAIT); pulling what it has now anyway`);
      return { waited: false, seq, manifest };
    }
    await sleep(POLL_MS);
  }
}

/** Why the manifest entry cannot be mirrored, or null. */
function entryError(f) {
  if (!f || typeof f !== 'object') return 'not an object';
  if (exportPathError(f.path)) return `bad path ${JSON.stringify(String(f.path)).slice(0, 80)}`;
  const dir = exportDirOf(f.path);
  if (!dir) return `path outside the allowlist ${JSON.stringify(f.path).slice(0, 80)}`;
  // the server's own listing rules: it never lists a hidden, temp, lock or backup name, at any depth
  if (!f.path.slice(dir.length + 1).split('/').every(exportableName)) return `a name the server never lists ${JSON.stringify(f.path).slice(0, 80)}`;
  if (!Number.isSafeInteger(f.size) || f.size < 0) return `bad size for ${f.path}`;
  if (typeof f.sha256 !== 'string' || !SHA_RE.test(f.sha256)) return `bad sha256 for ${f.path}`;
  return null;
}

async function fileSha(file) {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/** True when `file` is a regular file with the entry's size and sha256. */
async function sameFile(file, entry) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    return false;
  }
  return st.isFile() && st.size === entry.size && (await fileSha(file)) === entry.sha256;
}

/** The first existing component of `rel` below `base` (base excluded) that is a symlink, or null. */
function symlinkBelow(base, rel) {
  let cur = base;
  for (const seg of rel.split('/')) {
    cur = path.join(cur, seg);
    let st;
    try {
      st = fs.lstatSync(cur);
    } catch {
      return null; // missing: created as a real folder
    }
    if (st.isSymbolicLink()) return cur;
  }
  return null;
}

/** Downloads one entry to `dest` atomically (hidden temp file next to it, size + sha256 checked, rename). Throws. */
async function download(base, token, entry, dest, fetchImpl) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${process.pid}.tmp`);
  const { res, clear } = await request(`${base}/export/file?path=${encodeURIComponent(entry.path)}`, { token, fetchImpl, timeoutMs: DOWNLOAD_TIMEOUT_MS });
  try {
    if (res.status !== 200 || !res.body) {
      await res.body?.cancel?.();
      throw new Error(`HTTP ${res.status}`);
    }
    const hash = createHash('sha256');
    let bytes = 0;
    const tap = new Transform({ transform(chunk, _enc, cb) { hash.update(chunk); bytes += chunk.length; cb(null, chunk); } });
    try {
      await pipeline(Readable.fromWeb(res.body), tap, fs.createWriteStream(tmp, { mode: 0o600 }));
      if (bytes !== entry.size) throw new Error(`size ${bytes} instead of ${entry.size}`);
      if (hash.digest('hex') !== entry.sha256) throw new Error('sha256 mismatch (changed on the server meanwhile? run the sync again)');
      fs.renameSync(tmp, dest);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  } finally {
    clear();
  }
}

export const MASS_REMOVAL_MIN = 5;

/**
 * Mirrors the manifest into the clone's data root `root` (files/* into `filesDir`, default <root>/files). Refused as a
 * whole (ERROR, exit 1, nothing written or removed): a bad manifest entry; an allowlisted folder, or a folder between
 * it and the data root (the files folder), that is a symlink in the clone; an empty manifest while the clone has
 * mirrored files (unless `allowEmpty`); a run that would remove more than half of the mirrored files and more than 5
 * (unless `allowRemovals`). Logs `Removed <path>` per removed file, `Downloaded <path>` per download with `verbose`
 * (paths only, never content), then one `Mirror: ...` count line; returns 0, or 1 when refused or a file failed.
 * @param {{ base: string, token: string, manifest: any, root: string, filesDir?: string, allowEmpty?: boolean, allowRemovals?: boolean, verbose?: boolean, fetchImpl?: typeof fetch, log?: (m: string) => void, warn?: (m: string) => void }} opts
 */
export async function mirrorFiles({ base, token, manifest, root, filesDir = path.join(root, 'files'), allowEmpty = false, allowRemovals = false, verbose = false, fetchImpl = fetch, log = console.log, warn = console.warn }) {
  const seen = new Set();
  for (const f of manifest.files) {
    const why = entryError(f) ?? (seen.has(f.path) ? `duplicate path ${f.path}` : null);
    if (why) {
      warn(`ERROR: the server's manifest was refused (${why}); nothing mirrored`);
      return 1;
    }
    seen.add(f.path);
  }
  // files/* sit below the data root when the files folder is the default one (then <root>/files must be a real
  // folder too); a files folder set elsewhere (HC_FILES_DIR) is a base of its own, like the data root
  const filesUnderRoot = path.resolve(filesDir) === path.resolve(root, 'files');
  const place = (p) => (p.startsWith('files/') && !filesUnderRoot ? { base: filesDir, rel: p.slice('files/'.length) } : { base: root, rel: p });
  const show = (abs) => path.relative(root, abs).split(path.sep).join('/');
  for (const dir of EXPORT_DIRS) {
    const { base: b, rel } = place(dir);
    const link = symlinkBelow(b, rel);
    if (link) {
      warn(`ERROR: ${show(link)} in this clone's data root is a symlink: refusing to mirror through it (nothing mirrored); make it a real folder`);
      return 1;
    }
  }
  const localFiles = await listExportFiles({ dataDir: root, filesDir });
  const toRemove = localFiles.filter((f) => !seen.has(f.path));
  if (manifest.files.length === 0 && localFiles.length > 0 && !allowEmpty) {
    warn(`ERROR: the server lists no files while this clone has ${localFiles.length} mirrored files; nothing removed (an empty or wrong data volume on the server?). Run \`npm run sync -- --allow-empty\` to mirror the empty server`);
    return 1;
  }
  if (toRemove.length > MASS_REMOVAL_MIN && toRemove.length * 2 > localFiles.length && !allowRemovals) {
    warn(`ERROR: the server's manifest would remove ${toRemove.length} of the ${localFiles.length} mirrored files; nothing mirrored (check the server's data). Run \`npm run sync -- --allow-removals\` to mirror it anyway`);
    return 1;
  }
  let downloaded = 0;
  let unchanged = 0;
  let removed = 0;
  let failed = 0;
  for (const entry of manifest.files) {
    const { base: b, rel } = place(entry.path);
    const dest = path.join(b, rel);
    if (await sameFile(dest, entry)) {
      unchanged += 1;
      continue;
    }
    // a subfolder that is a symlink in the clone is never written through
    const link = symlinkBelow(b, path.posix.dirname(rel));
    if (link) {
      failed += 1;
      warn(`WARNING: could not mirror ${entry.path} (${show(link)} is a symlink in this clone); nothing written there`);
      continue;
    }
    try {
      await download(base, token, entry, dest, fetchImpl);
      downloaded += 1;
      if (verbose) log(`Downloaded ${entry.path}`);
    } catch (err) {
      failed += 1;
      warn(`WARNING: could not mirror ${entry.path} (${err.cause?.code || err.message}); the local copy is kept`);
    }
  }
  // the same listing rules as the server (no hidden / temp / lock / backup file, no symlink), so only a file the
  // server would list, and does not, is removed
  for (const f of toRemove) {
    try {
      fs.unlinkSync(f.abs);
      removed += 1;
      log(`Removed ${f.path}`);
    } catch (err) {
      failed += 1;
      warn(`WARNING: could not remove ${f.path} (${err.code || err.message})`);
    }
  }
  log(`Mirror: ${manifest.files.length} files on the server: ${downloaded} downloaded, ${unchanged} unchanged, ${removed} removed${failed ? `, ${failed} failed` : ''}`);
  return failed ? 1 : 0;
}
