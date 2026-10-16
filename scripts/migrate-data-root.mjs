#!/usr/bin/env node
/* Moves the personal files of a clone from the old paths (lib/paths.mjs legacyPaths) into the data root
 * (lib/paths.mjs dataPaths: <repo>/loop-data, or HC_DATA_DIR; HC_FILES_DIR moves files/). One time per clone,
 * right after updating to the data-root release and BEFORE the next `npm run sync` (a sync writes into the data
 * root, and a file there that differs from the old one is a conflict).
 *
 *   npm run migrate:data-root               move
 *   npm run migrate:data-root -- --dry-run  print what would move, write nothing
 *
 * What moves (only files that exist, never a tracked file, never a *.example.json):
 *   extract   data/apple-health/extract/**          -> extract/ (the shared _meta.json.lock and *.tmp stay)
 *   import    data/apple-health/export.xml, *.zip   -> files/import/
 *   foodlog   data/nutrition/foodlog-daily.csv + .meta.json -> foodlog/
 *   profile   data/profile/{settings,onboarding,strava-profile}.json + avatar.jpg -> profile/
 *   cache     profile/profile.json, data/nutrition/plan-data.json, data/training/training-data.json
 *             -> cache/{profile,plan,training}.json; data/profile/documents-sync.json -> cache/.sync-state.json
 *             (its content is kept: it maps each kind to {revision, hash}, no paths)
 *   manuals   data/gear/**                          -> files/manuals/
 *   documents data/training/*.pdf, data/nutritionist/**, data/clinical/** -> files/documents/{training,
 *             nutritionist,clinical}/ (the coach-only PDFs and reports)
 *
 * Safety: nothing is touched when a target already exists with other content (exit 1, each conflict named)
 * or while a sync holds the extract lock (old or new layout). The run holds the new layout's extract lock
 * itself, so a sync started meanwhile waits or gives up instead of writing into the data root. Otherwise: a
 * backup tarball of every source first (backups/data-root-before-<UTC stamp>.tar), then two phases: copy every
 * file (temp file, fsync, rename; the mtime kept), verify every copy by sha256, and only then remove the
 * sources. A target that already holds the same bytes (a run interrupted after its copies) is not copied again,
 * and the temp files an interrupted run left in the data root are removed (counted in the output). After a
 * successful run only the newest data-root-before-*.tar is kept. A second run has nothing to move.
 * Prints counts and sizes, never file contents.
 * Env: HC_DATA_DIR, HC_FILES_DIR (lib/paths.mjs); MIGRATE_REPO_ROOT (tests) the clone, default this one.
 * Exit: 0 done (or nothing to move), 1 refused or failed, 2 bad usage. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataPaths, displayPath, legacyPaths } from '../lib/paths.mjs';
import { runCli } from '../data/apple-health/sync-common.mjs';
import { isMain } from './lib/is-main.mjs';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const GROUPS = ['extract', 'import', 'foodlog', 'profile', 'cache', 'manuals', 'documents'];
const LOCK = '_meta.json.lock';
const LOCK_FRESH_MS = 2 * 60 * 1000; // sync-common.mjs withLock: an older lock is a crashed run's

/** Every file under `dir` (relative paths, sorted); [] when it does not exist. Symlinks are skipped. */
function walk(dir, rel = '') {
  let entries;
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) return walk(dir, r);
    return e.isFile() ? [r] : [];
  });
}

/** The tracked files of the clone (repo-relative, '/' separators); throws when git cannot list them. */
function trackedFiles(repoRoot) {
  const r = spawnSync('git', ['-C', repoRoot, 'ls-files', '-z'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cannot list the tracked files (git ls-files: ${(r.stderr || r.error?.message || '').trim()})`);
  return new Set(r.stdout.split('\0').filter(Boolean));
}

/** The planned moves [{group, from, to}] for the files that exist at the old paths. Pure apart from reading
 * directories and stat. `tracked`: repo-relative paths never moved. */
export function planMoves({ repoRoot, env = process.env, tracked = new Set() }) {
  const old = legacyPaths({ repoRoot });
  const now = dataPaths({ repoRoot, env });
  const moves = [];
  const add = (group, from, to) => {
    const rel = path.relative(repoRoot, from).split(path.sep).join('/');
    if (tracked.has(rel) || /\.example\.json$/.test(from)) return;
    if (fs.existsSync(from) && fs.lstatSync(from).isFile()) moves.push({ group, from, to });
  };
  /** @param {string} group @param {string} fromDir @param {string} toDir @param {(rel: string) => boolean} [keep] */
  const tree = (group, fromDir, toDir, keep = () => true) => {
    for (const rel of walk(fromDir)) if (keep(rel)) add(group, path.join(fromDir, rel), path.join(toDir, rel));
  };
  tree('extract', old.extractDir, now.extractDir, (rel) => path.basename(rel) !== LOCK && !rel.endsWith('.tmp'));
  for (const name of walk(old.importDir).filter((r) => !r.includes(path.sep) && (r === 'export.xml' || r.endsWith('.zip')))) {
    add('import', path.join(old.importDir, name), path.join(now.importDir, name));
  }
  add('foodlog', old.foodlogCsv, now.foodlogCsv);
  add('foodlog', old.foodlogMeta, now.foodlogMeta);
  for (const k of ['settings', 'onboarding', 'stravaProfile', 'avatar']) add('profile', old[k], now[k]);
  for (const k of ['profile', 'plan', 'training']) add('cache', old.documents[k], now.documents[k]);
  add('cache', old.documentsState, now.documentsState);
  tree('manuals', old.manualsDir, now.manualsDir);
  const training = path.join(repoRoot, 'data', 'training');
  for (const name of walk(training).filter((r) => !r.includes(path.sep) && r.toLowerCase().endsWith('.pdf'))) {
    add('documents', path.join(training, name), path.join(now.documentsDir, 'training', name));
  }
  for (const sub of ['nutritionist', 'clinical']) tree('documents', path.join(repoRoot, 'data', sub), path.join(now.documentsDir, sub));
  return moves;
}

/** sha256 of a file, streamed in chunks (export.xml is ~1 GB). */
export function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/** Copies `from` to `to` durably: a temp file next to `to`, fsync, the source's mtime, rename. */
function copyDurable(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const tmp = `${to}.migrate-${process.pid}.tmp`;
  try {
    fs.copyFileSync(from, tmp, fs.constants.COPYFILE_EXCL);
    const fd = fs.openSync(tmp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const st = fs.statSync(from);
    fs.utimesSync(tmp, st.atime, st.mtime);
    fs.renameSync(tmp, to);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** One line per group with files: "extract 27 (1.2 MB)". */
function summary(moves) {
  return GROUPS.map((g) => {
    const of = moves.filter((m) => m.group === g);
    return of.length ? `${g} ${of.length} (${mb(of.reduce((s, m) => s + fs.statSync(m.from).size, 0))})` : null;
  }).filter(Boolean).join(', ');
}

/** The migration; returns the exit code (see the header). */
/** The targets with other content (each named; exit code 1), marking same-bytes targets done; 0 when none. */
function refuseConflicts(moves, warn, shown) {
  // a target with other content is never overwritten; one with the same bytes only lacks its source's removal
  const conflicts = [];
  for (const m of moves) {
    if (!fs.existsSync(m.to)) continue;
    if (!fs.lstatSync(m.to).isFile() || sha256(m.to) !== sha256(m.from)) conflicts.push(m);
    else m.done = true;
  }
  if (!conflicts.length) return 0;
  for (const m of conflicts) warn(`ERROR: ${shown(m.to)} already exists with other content than ${shown(m.from)}`);
  warn(`ERROR: ${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}; nothing moved. Keep one version of each (compare them, then delete or rename the other) and run it again.`);
  return 1;
}

/** The temp files a run killed while copying left next to the targets. */
function orphansOf(moves) {
  return moves.flatMap((m) => {
    const dir = path.dirname(m.to);
    if (!fs.existsSync(dir)) return [];
    const prefix = `${path.basename(m.to)}.migrate-`;
    return fs.readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith('.tmp')).map((n) => path.join(dir, n));
  });
}

/** Backup, copy all, verify all, remove the sources; returns the exit code. */
function moveAll({ repoRoot, target, moves, now, log, warn, shown, lockFile }) {
  const what = summary(moves);
  const orphans = orphansOf(moves);
  for (const f of orphans) fs.rmSync(f, { force: true });

  // the backup of every source, before anything changes
  const backup = path.join(repoRoot, 'backups', `data-root-before-${stamp(now)}.tar`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  const list = moves.map((m) => path.relative(repoRoot, m.from)).join('\0') + '\0';
  const tar = spawnSync('tar', ['-cf', backup, '-C', repoRoot, '--null', '-T', '-'], { input: list, encoding: 'utf8' });
  if (tar.status !== 0) {
    fs.rmSync(backup, { force: true });
    warn(`ERROR: the backup ${shown(backup)} could not be written (tar: ${(tar.stderr || tar.error?.message || '').trim()}); nothing moved.`);
    return 1;
  }

  // phase 1: copy all; phase 2: verify all; phase 3: remove the sources
  // the held lock is refreshed after every file: sync-common takes over a lock untouched for 2 minutes
  const keepLock = () => { try { fs.utimesSync(lockFile, new Date(), new Date()); } catch { /* released */ } };
  for (const m of moves) {
    if (!m.done) copyDurable(m.from, m.to);
    keepLock();
  }
  const bad = moves.filter((m) => { keepLock(); return sha256(m.to) !== sha256(m.from); });
  if (bad.length) {
    for (const m of bad) warn(`ERROR: the copy ${shown(m.to)} differs from ${shown(m.from)}`);
    warn(`ERROR: ${bad.length} cop${bad.length > 1 ? 'ies' : 'y'} failed verification; no source removed (the backup is ${shown(backup)}).`);
    return 1;
  }
  for (const m of moves) fs.rmSync(m.from);
  // the folders the moves emptied (a tracked folder keeps its .gitkeep, so it is never empty)
  const dirs = [...new Set(moves.map((m) => path.dirname(m.from)))].sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    for (let d = dir; d.startsWith(repoRoot + path.sep); d = path.dirname(d)) {
      try { fs.rmdirSync(d); } catch { break; }
    }
  }
  // the backups convention: only the newest one (an interrupted run's older tar is covered by this one's sources)
  const backupsDir = path.dirname(backup);
  for (const n of fs.readdirSync(backupsDir)) {
    if (/^data-root-before-.*\.tar$/.test(n) && n !== path.basename(backup)) fs.rmSync(path.join(backupsDir, n));
  }
  const cleaned = orphans.length ? `. Removed ${orphans.length} temp file${orphans.length > 1 ? 's' : ''} of an interrupted run.` : '';
  log(`migrate:data-root: moved ${moves.length} files into ${shown(target.root)}: ${what}. Backup: ${shown(backup)}${cleaned}`);
  return 0;
}

/** The migration; returns the exit code (see the header). */
export function main({ repoRoot = ROOT, env = process.env, dryRun = false, log = console.log, warn = console.warn, now = new Date() } = {}) {
  const shown = (f) => displayPath(repoRoot, f);
  const target = dataPaths({ repoRoot, env });
  const moves = planMoves({ repoRoot, env, tracked: trackedFiles(repoRoot) });
  if (!moves.length) {
    log(`migrate:data-root: nothing to move (no personal file at the old paths); the data root is ${shown(target.root)}`);
    return 0;
  }
  // a sync running with either layout (the old code writes the old extract, the new code the data root's)
  const newLock = path.join(target.extractDir, LOCK);
  for (const f of [path.join(legacyPaths({ repoRoot }).extractDir, LOCK), newLock]) {
    if (fs.existsSync(f) && now.getTime() - fs.statSync(f).mtimeMs < LOCK_FRESH_MS) {
      warn(`ERROR: a sync is running (${shown(f)}); nothing moved. Run it again when the sync is done.`);
      return 1;
    }
  }
  if (refuseConflicts(moves, warn, shown)) return 1;
  if (dryRun) {
    log(`migrate:data-root --dry-run: would move ${moves.length} files into ${shown(target.root)}: ${summary(moves)}. Nothing written.`);
    return 0;
  }
  // hold the data root's extract lock for the whole run, so a sync started meanwhile waits (sync-common withLock)
  // instead of writing into the data root; a stale one is a crashed run's and is taken over
  fs.mkdirSync(target.extractDir, { recursive: true });
  fs.writeFileSync(newLock, String(process.pid));
  try {
    return moveAll({ repoRoot, target, moves, now, log, warn, shown, lockFile: newLock });
  } finally {
    try { if (fs.readFileSync(newLock, 'utf8') === String(process.pid)) fs.rmSync(newLock); } catch { /* already gone */ }
  }
}

const USAGE = `Usage: npm run migrate:data-root [-- --dry-run]

Moves the personal files from the old paths of this clone (data/apple-health/extract, export.xml,
data/nutrition/foodlog-daily.*, data/profile/*, profile/profile.json, plan-data.json, training-data.json,
data/gear, the coach PDFs) into the data root (loop-data/, or HC_DATA_DIR), after a backup tarball in backups/.
  --dry-run    print what would move, write nothing
  -h, --help   this help
Env: HC_DATA_DIR, HC_FILES_DIR (the data root and its files/ folder).`;

if (isMain(import.meta.url)) {
  runCli(({ 'dry-run': dryRun }) => main({ repoRoot: process.env.MIGRATE_REPO_ROOT || ROOT, dryRun }), {
    usage: USAGE,
    options: { 'dry-run': { type: 'boolean' } },
  });
}
