/**
 * The server's processed data for a coach clone (docs/data-pipeline.md -> Coach as a client): in container mode
 * (HC_BUILD=container, the loop-server image) the server owns the data root (/data) and a clone's `npm run sync`
 * mirrors part of it (scripts/sync-client.mjs).
 *
 *   GET /export/files           -> 200 {files: [{path, size, sha256, mtimeMs}], site: {processedSeq, error, errorSeq}}
 *                                  files sorted by path; site = the last publish in HC_SITE_DIR/status.json (the client
 *                                  waits on processedSeq after its POST /sync; error/errorSeq = a failed build)
 *   GET /export/file?path=<p>   -> 200 the bytes (application/octet-stream, content-length), streamed
 *
 * ALLOWLIST (EXPORT_DIRS): extract/, profile/, foodlog/, files/documents/, files/manuals/ of the data root (files/ is
 * HC_FILES_DIR when set). Never anything else: not cache/ (the document copies: sync-documents owns them, with their
 * local-edit protection), files/import/ (the Health zips), import-work/, import-state.json. Inside the allowlisted
 * folders only regular files whose name is not hidden (.shortcut-cache.json, .sync-state.json) and not a temp, lock
 * or backup file (*.tmp, *.lock, *.bak); symlinks (files and folders) are never followed, listed or served.
 *
 * Security: bearer token only (INGEST_TOKEN, the shared checker), checked before anything else; the clients are
 * coach clones, never the browser, so loop-web's nginx never proxies /export/* (scripts/loop-web-config.test.mjs).
 * Mounted only in container mode: outside it the routes are not handled at all, so the server answers the plain
 * 404 of an unknown path (that is how a clone tells a host-mode server apart). GET /export/file serves only a path
 * that is in the manifest at request time (listed again, no hashing): a path with `..`, `.`, an empty segment, a
 * backslash, NUL, a leading `/` or over 1024 characters is 400; anything not listed (a folder, a symlink, a cache
 * file, a file gone since) is 404. The file is opened with O_NOFOLLOW and checked to be a regular file again.
 *
 * sha256 is cached per path, keyed by (size, mtimeMs): a manifest polled every 2 s by a waiting client stats the
 * files but hashes only what changed. Logs carry counts and byte sizes, never a path (document names are
 * personal) nor any content.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { writeJson } from './http.js'

export const EXPORT_DIRS = Object.freeze(['extract', 'profile', 'foodlog', 'files/documents', 'files/manuals'])
export const MAX_EXPORT_PATH = 1024
const MAX_DEPTH = 8
const SKIPPED_SUFFIXES = ['.tmp', '.lock', '.bak']
const NO_STORE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }

/** Whether a file or folder name inside an allowlisted folder can be exported (not hidden, temp, lock, backup). */
export function exportableName (name) {
  return !name.startsWith('.') && !SKIPPED_SUFFIXES.some((s) => name.endsWith(s))
}

/** Why `p` can never be an export path (a short reason), or null when its syntax is acceptable. */
export function exportPathError (p) {
  if (typeof p !== 'string' || p === '') return 'empty'
  if (p.length > MAX_EXPORT_PATH) return 'too_long'
  if (p.includes('\0')) return 'nul'
  if (p.includes('\\')) return 'backslash'
  if (p.startsWith('/')) return 'absolute'
  if (p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return 'segment'
  return null
}

/** The allowlisted folder `p` lives in, or null. */
export function exportDirOf (p) {
  return EXPORT_DIRS.find((d) => p.startsWith(`${d}/`)) ?? null
}

/** The absolute folder of an allowlisted dir: files/* under `filesDir` (HC_FILES_DIR), the rest under `dataDir`. */
function absDir (dir, { dataDir, filesDir }) {
  return dir.startsWith('files/') ? path.join(filesDir ?? path.join(dataDir, 'files'), dir.slice('files/'.length)) : path.join(dataDir, dir)
}

/**
 * The sha256 cache: get(file, stat) -> hex, re-hashing only when size or mtimeMs changed. `onHash` (tests) sees each hash.
 * @param {{ onHash?: (file: string) => void }} [opts]
 */
export function createHashCache ({ onHash = (_file) => {} } = {}) {
  const entries = new Map()
  return {
    async get (file, st) {
      const hit = entries.get(file)
      if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.sha256
      onHash(file)
      const hash = createHash('sha256')
      await pipeline(fs.createReadStream(file), hash)
      const sha256 = hash.digest('hex')
      entries.set(file, { size: st.size, mtimeMs: st.mtimeMs, sha256 })
      return sha256
    },
    /** Drops the entries of files no longer listed. */
    keep (files) {
      for (const f of entries.keys()) if (!files.has(f)) entries.delete(f)
    }
  }
}

async function walk (absRoot, rel, depth, out) {
  let entries
  try {
    entries = await fs.promises.readdir(absRoot, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return
    throw err
  }
  for (const e of entries) {
    if (!exportableName(e.name)) continue
    const abs = path.join(absRoot, e.name)
    const r = `${rel}/${e.name}`
    // Dirent types come from lstat: a symlink is neither a file nor a directory here, so it is skipped
    if (e.isDirectory()) {
      if (depth < MAX_DEPTH) await walk(abs, r, depth + 1, out)
    } else if (e.isFile()) {
      out.push({ path: r, abs })
    }
  }
}

/**
 * Every exportable file: [{path, abs, size, mtimeMs, sha256?}] sorted by path. With `cache` each gets its sha256;
 * without it only the listing (GET /export/file's membership check). An allowlisted folder that is itself a
 * symlink, or missing, contributes nothing.
 */
export async function listExportFiles ({ dataDir, filesDir = null, cache = null }) {
  const found = []
  for (const dir of EXPORT_DIRS) {
    const abs = absDir(dir, { dataDir, filesDir })
    let st
    try {
      st = await fs.promises.lstat(abs)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    // the parent of files/<x> (the files folder) may be a bind mount, but never a symlink chain we follow
    await walk(abs, dir, 1, found)
  }
  found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const out = []
  for (const f of found) {
    let st
    try {
      st = await fs.promises.lstat(f.abs)
    } catch {
      continue // removed while listing
    }
    if (!st.isFile()) continue
    const entry = { path: f.path, abs: f.abs, size: st.size, mtimeMs: Math.trunc(st.mtimeMs) }
    if (cache) {
      try {
        entry.sha256 = await cache.get(f.abs, st)
      } catch (err) {
        if (err.code === 'ENOENT') continue
        throw err
      }
    }
    out.push(entry)
  }
  if (cache) cache.keep(new Set(out.map((f) => f.abs)))
  return out
}

/** {processedSeq, error, errorSeq} of <siteDir>/status.json (0 / null when it is missing or broken). */
export function readSiteStatus (siteDir) {
  let s = null
  try {
    s = JSON.parse(fs.readFileSync(path.join(siteDir, 'status.json'), 'utf8'))
  } catch {}
  const seq = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null)
  return {
    processedSeq: seq(s?.processedSeq) ?? 0,
    error: typeof s?.error === 'string' ? s.error : null,
    errorSeq: typeof s?.error === 'string' ? seq(s?.errorSeq) : null
  }
}

export function createFilesExportRoutes ({ available, dataDir, filesDir = null, siteDir, checkBearer, hashCache = createHashCache(), log = console.log }) {
  const fail = (res, status, error, extra = {}) => writeJson(res, status, { error }, { ...NO_STORE, ...extra })

  async function manifest (req, res) {
    req.resume()
    const files = await listExportFiles({ dataDir, filesDir, cache: hashCache })
    const body = { files: files.map(({ path: p, size, sha256, mtimeMs }) => ({ path: p, size, sha256, mtimeMs })), site: readSiteStatus(siteDir) }
    log(JSON.stringify({ event: 'export_files', count: files.length, bytes: files.reduce((n, f) => n + f.size, 0) }))
    writeJson(res, 200, body, NO_STORE)
  }

  async function file (req, res, url) {
    req.resume()
    const values = url.searchParams.getAll('path')
    const p = values.length === 1 ? values[0] : null
    if (exportPathError(p)) return fail(res, 400, 'invalid_path')
    if (!exportDirOf(p)) return fail(res, 404, 'not_found')
    const listed = (await listExportFiles({ dataDir, filesDir })).find((f) => f.path === p)
    if (!listed) return fail(res, 404, 'not_found')
    let handle
    try {
      handle = await fs.promises.open(listed.abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ELOOP') return fail(res, 404, 'not_found')
      throw err
    }
    try {
      const st = await handle.stat()
      if (!st.isFile()) return fail(res, 404, 'not_found')
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, ...NO_STORE })
      if (st.size > 0) {
        // exactly the size announced: a file growing meanwhile can never send more than content-length
        await pipeline(handle.createReadStream({ start: 0, end: st.size - 1, autoClose: false }), res)
      } else {
        res.end()
      }
      log(JSON.stringify({ event: 'export_file', bytes: st.size }))
    } finally {
      await handle.close().catch(() => {})
    }
  }

  return {
    /** Handles GET /export/files and /export/file in container mode; false for anything else (the caller routes on). */
    async handle (req, res, url) {
      const route = url.pathname === '/export/files' ? manifest : url.pathname === '/export/file' ? file : null
      if (!route || !available()) return false
      try {
        if (!checkBearer(req)) {
          req.resume()
          fail(res, 401, 'unauthorized')
          return true
        }
        if (req.method !== 'GET') {
          req.resume()
          fail(res, 405, 'method_not_allowed', { allow: 'GET' })
          return true
        }
        await route(req, res, url)
      } catch (err) {
        // the code only: an fs message carries the path
        log(JSON.stringify({ event: 'export_files_error', code: err?.code ?? null }))
        if (!res.headersSent) fail(res, 500, 'internal')
        else res.destroy()
      }
      return true
    }
  }
}
