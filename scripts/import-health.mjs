#!/usr/bin/env node
/* Apple Health import (npm run import:health): turns the export the owner dropped into the import folder into the
 * extract, without unzipping by hand. The loop-server image runs it before every sync (scripts/refresh.mjs); on a
 * clone it is the command that replaces "unzip, move export.xml, node data/apple-health/extract.mjs".
 *
 *   1. pick the NEWEST *.zip (the iPhone's "Export All Health Data") or plain export.xml in <files>/import/ by mtime
 *   2. skip it when its sha256 equals the last SUCCESSFUL import (<data root>/import-state.json), unless --force
 *   3. a zip: stream its export entry (`apple_health_export/exportación.xml`, `export.xml` or the one other-language
 *      .xml next to export_cda.xml; accent- and case-insensitive) into <data root>/import-work/export.xml.<pid>.tmp,
 *      on the DATA root (the files folder may be read-only or root-owned: it is only read), CRC-32 checked
 *      (scripts/lib/zip.mjs); a plain export.xml is read where it is
 *   4. the truncation guard: an export without its closing </HealthData> is refused before extracting
 *   5. node data/apple-health/extract.mjs --source <export>: the same code path as the manual flow, so the extract is
 *      byte-identical; it writes each file atomically under the extract lock (_meta.json.lock) and only after the
 *      whole export was read
 *   6. record {file, sha256, size, importedAt, exportLastDate, rows} in import-state.json; remove the work file in
 *      every outcome; never modify, move or delete the zip
 *
 * After an import the extract is a fresh export: the iOS Shortcut rows and the ownership ledger are gone until the
 * next `npm run sync` restores them from the Shortcut cache (data/apple-health/sync-shortcut.mjs, the same as after a
 * manual extract). Prints counts only, never a record.
 *
 * Exit: 0 imported, or nothing to do (no import folder, nothing in it, already imported); 1 the file could not be
 * imported (corrupt zip, no export in it, truncated export, the extract failed): the previous extract is untouched
 * and import-state.json gets lastError {at, file, sha256, code, message}; 2 usage. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/is-main.mjs';
import { listZip, extractEntry } from './lib/zip.mjs';
import { runCli, writeAtomic } from '../data/apple-health/sync-common.mjs';
import { dataPaths, displayPath } from '../lib/paths.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXTRACT_SCRIPT = path.join(ROOT, 'data', 'apple-health', 'extract.mjs');
const TAG = 'import:health';
// a work file older than this is left over from a killed import even when its pid is alive again (a restarted container)
const WORK_MAX_AGE_MS = 6 * 3600_000;
const WORK_RE = /^export\.xml\.(\d+)\.tmp$/;

class ImportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const base = (name) => name.split('/').pop();

/** The export entry of a Health zip's entries, or null: `export.xml` / `exportación.xml` (accent- and
 * case-insensitive) at the top or one folder down; else the ONLY other .xml there besides export_cda.xml (an iPhone
 * in another language); never a workout route. */
export function exportEntry(entries) {
  const xml = entries.filter((e) => {
    const parts = e.name.split('/');
    return !e.name.endsWith('/') && parts.length <= 2 && fold(e.name).endsWith('.xml') && fold(base(e.name)) !== 'export_cda.xml';
  });
  const exact = xml.filter((e) => ['export.xml', 'exportacion.xml'].includes(fold(base(e.name))));
  if (exact.length) return exact[0];
  return xml.length === 1 ? xml[0] : null;
}

/** The newest *.zip or export.xml (by mtime, then name) in `dir`: { file, kind: 'zip' | 'xml', size, mtimeMs } or null. */
export function newestCandidate(dir) {
  let best = null;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const kind = /\.zip$/i.test(name) ? 'zip' : /^export\.xml$/i.test(name) ? 'xml' : null;
    if (!kind) continue;
    const file = path.join(dir, name);
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile()) continue;
    if (!best || st.mtimeMs > best.mtimeMs || (st.mtimeMs === best.mtimeMs && name > path.basename(best.file))) {
      best = { file, kind, size: st.size, mtimeMs: st.mtimeMs };
    }
  }
  return best;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex')));
  });
}

function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(state, null, 2) + '\n');
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code !== 'ESRCH'; }
}

/** Removes work files a killed import left: its pid is gone, it is our own pid (a restarted container reuses pids)
 * or it is older than WORK_MAX_AGE_MS. */
function removeStaleWork(dir, now = Date.now()) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    const m = WORK_RE.exec(name);
    if (!m) continue;
    const file = path.join(dir, name);
    const pid = Number(m[1]);
    let old = false;
    try { old = now - fs.statSync(file).mtimeMs > WORK_MAX_AGE_MS; } catch {}
    if (pid === process.pid || !isAlive(pid) || old) fs.rmSync(file, { force: true });
  }
}

/** True when the last 64 KiB of `file` hold the closing </HealthData>. */
function hasClosingTag(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.includes('</HealthData>');
  } finally {
    fs.closeSync(fd);
  }
}

// the running extract child and work file, so a SIGTERM (refresh.mjs's import timeout) can stop and clean them
const running = { child: null, work: null };

/** node extract.mjs --source <file>: its counts are re-printed by the caller, its errors go to stderr. */
function runExtract(source, env) {
  const childEnv = { ...env };
  delete childEnv.EXTRACT_DIR; // the test hook would move the output away from the data root
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [EXTRACT_SCRIPT, '--source', source], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'ignore', 'inherit'] });
    running.child = child;
    child.on('error', () => resolve(null));
    child.on('close', (code) => { running.child = null; resolve(code); });
  });
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);

/** The command; returns the exit code.
 * @param {{ force?: boolean }} [values]
 * @param {{ env?: Record<string, string | undefined>, log?: (m: string) => void, error?: (m: string) => void, now?: () => Date }} [deps] */
export async function main({ force = false } = {}, { env = process.env, log = console.log, error = console.error, now = () => new Date() } = {}) {
  const paths = dataPaths({ repoRoot: ROOT, env });
  const shown = (p) => displayPath(ROOT, p);
  if (!fs.existsSync(paths.importDir)) {
    log(`${TAG}: no import folder at ${shown(paths.importDir)}; nothing to import`);
    return 0;
  }
  const cand = newestCandidate(paths.importDir);
  if (!cand) {
    log(`${TAG}: nothing to import in ${shown(paths.importDir)} (no .zip or export.xml)`);
    return 0;
  }
  const name = path.basename(cand.file);
  const sha256 = await sha256File(cand.file);
  const state = readState(paths.importState);
  if (!force && state.sha256 === sha256) {
    log(`${TAG}: ${name} already imported (sha256 ${sha256.slice(0, 12)}); --force imports it again`);
    return 0;
  }

  const started = Date.now();
  let work = null;
  try {
    let source = cand.file;
    if (cand.kind === 'zip') {
      const entry = exportEntry(await listZip(cand.file));
      if (!entry) throw new ImportError('no-export', 'no Health export (export.xml / exportación.xml) inside the zip');
      fs.mkdirSync(paths.importWorkDir, { recursive: true });
      removeStaleWork(paths.importWorkDir);
      work = path.join(paths.importWorkDir, `export.xml.${process.pid}.tmp`);
      running.work = work;
      await extractEntry(cand.file, entry, work);
      source = work;
    }
    if (!hasClosingTag(source)) throw new ImportError('truncated', 'the export ends before </HealthData> (truncated: an incomplete copy or download)');
    const code = await runExtract(source, env);
    if (code !== 0) throw new ImportError('extract', `extract.mjs failed (exit ${code ?? 'not started'})`);
    const meta = JSON.parse(fs.readFileSync(paths.extractMeta, 'utf8'));
    const next = { file: name, sha256, size: cand.size, importedAt: now().toISOString().replace(/\.\d{3}Z$/, 'Z'), exportLastDate: meta.exportLastDate ?? null, rows: meta.rows ?? {} };
    writeState(paths.importState, next);
    const rows = Object.entries(next.rows).map(([k, n]) => `${k} ${n}`).join(', ');
    log(`${TAG}: ${name} (${mb(cand.size)} MB, sha256 ${sha256.slice(0, 12)}) imported in ${((Date.now() - started) / 1000).toFixed(1)} s: ${(meta.linesScanned ?? 0).toLocaleString('en')} lines, exportLastDate ${next.exportLastDate}; rows: ${rows}`);
    return 0;
  } catch (err) {
    const code = err instanceof ImportError || err?.code === 'corrupt' ? err.code : 'failed';
    const { lastError, ...good } = state;
    try {
      writeState(paths.importState, { ...good, lastError: { at: now().toISOString().replace(/\.\d{3}Z$/, 'Z'), file: name, sha256, code, message: String(err?.message ?? err) } });
    } catch (e) {
      error(`${TAG}: could not record the error in ${shown(paths.importState)}: ${e.message}`);
    }
    error(`ERROR: ${TAG}: ${name}: ${err?.message ?? err}; the previous extract is kept`);
    return 1;
  } finally {
    if (work) fs.rmSync(work, { force: true });
    running.work = null;
  }
}

export const USAGE = `Usage: node scripts/import-health.mjs [--force]

Imports the newest Apple Health export (the iPhone's .zip, or a plain export.xml) in loop-data/files/import/ into
loop-data/extract/: streams the export out of the zip into loop-data/import-work/, checks it is complete, runs
data/apple-health/extract.mjs on it and records the import in loop-data/import-state.json. The zip is never changed.
A file already imported (same sha256) is skipped. Then run npm run sync to layer the iOS Shortcut data on top.
  --force      import the newest file even when it was already imported
  -h, --help   this help
Env: HC_DATA_DIR (the data root), HC_FILES_DIR (the owner files folder, import/ inside it).
Exit: 0 imported or nothing to do, 1 not imported (the previous extract is kept; lastError in import-state.json), 2 usage.`;

if (isMain(import.meta.url)) {
  // refresh.mjs stops a run over HC_IMPORT_TIMEOUT with SIGTERM: stop the extract, remove the work file, record it
  for (const [sig, exit] of /** @type {Array<[NodeJS.Signals, number]>} */ ([['SIGTERM', 143], ['SIGINT', 130]])) {
    process.once(sig, () => {
      if (running.child) running.child.kill('SIGTERM');
      if (running.work) fs.rmSync(running.work, { force: true });
      try {
        const file = dataPaths({ repoRoot: ROOT, env: process.env }).importState;
        const { lastError, ...good } = readState(file);
        writeState(file, { ...good, lastError: { at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), code: 'interrupted', message: `stopped by ${sig} (timeout?)` } });
      } catch {}
      console.error(`ERROR: ${TAG}: stopped by ${sig}; the previous extract is kept`);
      process.exit(exit);
    });
  }
  runCli((values) => main(values), { usage: USAGE, options: { force: { type: 'boolean' } } });
}
