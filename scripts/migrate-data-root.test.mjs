/* scripts/migrate-data-root.mjs on a throwaway git clone holding SYNTHETIC personal files at the old paths:
 * the full move, an idempotent rerun, conflict refusal, --dry-run, tracked files left alone, the backup. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from './migrate-data-root.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrate-data-root.mjs');
const NOW = new Date('2030-01-02T03:04:05.678Z');

// old path -> its place under the data root
const PERSONAL = {
  'data/apple-health/extract/weight.csv': 'extract/weight.csv',
  'data/apple-health/extract/_meta.json': 'extract/_meta.json',
  'data/apple-health/extract/.shortcut-cache.json': 'extract/.shortcut-cache.json',
  'data/apple-health/extract/journal-daily.csv': 'extract/journal-daily.csv',
  'data/apple-health/extract/journal-daily.meta.json': 'extract/journal-daily.meta.json',
  'data/apple-health/export.xml': 'files/import/export.xml',
  'data/apple-health/exportar.zip': 'files/import/exportar.zip',
  'data/nutrition/foodlog-daily.csv': 'foodlog/foodlog-daily.csv',
  'data/nutrition/foodlog-daily.meta.json': 'foodlog/foodlog-daily.meta.json',
  'data/profile/settings.json': 'profile/settings.json',
  'data/profile/onboarding.json': 'profile/onboarding.json',
  'data/profile/strava-profile.json': 'profile/strava-profile.json',
  'data/profile/avatar.jpg': 'profile/avatar.jpg',
  'profile/profile.json': 'cache/profile.json',
  'data/nutrition/plan-data.json': 'cache/plan.json',
  'data/training/training-data.json': 'cache/training.json',
  'data/profile/documents-sync.json': 'cache/.sync-state.json',
  'data/gear/edge-manual.pdf': 'files/manuals/edge-manual.pdf',
  'data/gear/notes/scan.png': 'files/manuals/notes/scan.png',
  'data/training/Program March.pdf': 'files/documents/training/Program March.pdf',
  'data/nutritionist/report.pdf': 'files/documents/nutritionist/report.pdf',
  'data/clinical/history.pdf': 'files/documents/clinical/history.pdf',
};
// tracked seeds and files the migration never moves
const TRACKED = [
  'data/gear/.gitkeep', 'data/profile/.gitkeep', 'data/training/.gitkeep', 'data/nutritionist/.gitkeep',
  'data/nutrition/plan-data.example.json', 'data/training/training-data.example.json', 'profile/profile.example.json',
  'data/apple-health/extract.mjs', 'data/profile/sync-profile.mjs',
];
const STAYS = ['data/training/podcasts/ep1.md', 'data/training/.env.hyprogram', 'data/nutrition/food-log.md', 'data/nutrition/plan-tables.md', 'profile/about-me.md'];

const content = (rel) => `synthetic ${rel}\n`;
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const put = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

/** A git clone with TRACKED committed, PERSONAL + STAYS untracked at the old paths. */
function clone() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-migrate-'));
  git(dir, 'init', '-q');
  for (const rel of TRACKED) put(path.join(dir, rel), content(rel));
  git(dir, 'add', '.');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'seed');
  for (const rel of [...Object.keys(PERSONAL), ...STAYS]) put(path.join(dir, rel), content(rel));
  fs.writeFileSync(path.join(dir, 'data/profile/documents-sync.json'), '{"plan":{"revision":3,"hash":"abc"}}\n');
  return dir;
}

function run(dir, opts = {}) {
  const logs = []; const warns = [];
  const code = main({ repoRoot: dir, env: {}, now: NOW, log: (l) => logs.push(l), warn: (w) => warns.push(w), ...opts });
  return { code, logs, warns };
}

/** Every file under dir (relative, sorted) with its bytes. */
function snapshot(dir) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (r === '.git') continue;
      if (e.isDirectory()) walk(r); else out[r] = fs.readFileSync(path.join(dir, r)).toString('base64');
    }
  };
  walk('');
  return out;
}

test('the full move: every personal file lands in loop-data/ with the same bytes, the sources are gone, the rest stays', (t) => {
  const dir = clone();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const mtime = fs.statSync(path.join(dir, 'data/apple-health/extract/weight.csv')).mtimeMs;
  const r = run(dir);
  assert.equal(r.code, 0, r.warns.join('\n'));
  assert.deepEqual(r.warns, []);
  for (const [from, to] of Object.entries(PERSONAL)) {
    assert.equal(fs.existsSync(path.join(dir, from)), false, `${from} removed`);
    const want = from === 'data/profile/documents-sync.json' ? '{"plan":{"revision":3,"hash":"abc"}}\n' : content(from);
    assert.equal(fs.readFileSync(path.join(dir, 'loop-data', to), 'utf8'), want, to);
  }
  assert.equal(Math.round(fs.statSync(path.join(dir, 'loop-data/extract/weight.csv')).mtimeMs), Math.round(mtime), 'the mtime is kept');
  for (const rel of [...TRACKED, ...STAYS]) assert.equal(fs.readFileSync(path.join(dir, rel), 'utf8'), content(rel), `${rel} untouched`);
  assert.equal(git(dir, 'status', '--porcelain', '--', ...TRACKED), '', 'no tracked file changed');
  assert.equal(fs.existsSync(path.join(dir, 'data/apple-health/extract')), false, 'the emptied extract folder is removed');
  assert.equal(fs.existsSync(path.join(dir, 'data/clinical')), false);
  assert.ok(fs.existsSync(path.join(dir, 'data/gear/.gitkeep')));
  assert.deepEqual(r.logs, [`migrate:data-root: moved ${Object.keys(PERSONAL).length} files into loop-data: extract 5 (0.0 MB), import 2 (0.0 MB), foodlog 2 (0.0 MB), profile 4 (0.0 MB), cache 4 (0.0 MB), manuals 2 (0.0 MB), documents 3 (0.0 MB). Backup: backups/data-root-before-20300102T030405Z.tar`]);
  assert.doesNotMatch(r.logs.join('\n'), /synthetic/, 'never a file content');
});

test('the backup tarball holds every source, written before anything moved', (t) => {
  const dir = clone();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir).code, 0);
  const tar = path.join(dir, 'backups', 'data-root-before-20300102T030405Z.tar');
  const listed = spawnSync('tar', ['-tf', tar], { encoding: 'utf8' }).stdout.trim().split('\n').sort();
  assert.deepEqual(listed, Object.keys(PERSONAL).sort());
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-migrate-untar-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  spawnSync('tar', ['-xf', tar, '-C', out]);
  assert.equal(fs.readFileSync(path.join(out, 'data/nutrition/plan-data.json'), 'utf8'), content('data/nutrition/plan-data.json'));
});

test('idempotent: a second run has nothing to move and writes nothing', (t) => {
  const dir = clone();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir).code, 0);
  const before = snapshot(dir);
  const again = run(dir, { now: new Date('2030-01-03T00:00:00Z') });
  assert.deepEqual([again.code, again.warns], [0, []]);
  assert.deepEqual(again.logs, ['migrate:data-root: nothing to move (no personal file at the old paths); the data root is loop-data']);
  assert.deepEqual(snapshot(dir), before, 'no second backup, nothing changed');
});

test('a run interrupted after its copies: a target with the same bytes is kept and its source removed', (t) => {
  const dir = clone();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  put(path.join(dir, 'loop-data/cache/plan.json'), content('data/nutrition/plan-data.json'));
  const r = run(dir);
  assert.equal(r.code, 0, r.warns.join('\n'));
  assert.equal(fs.existsSync(path.join(dir, 'data/nutrition/plan-data.json')), false);
});

test('a target with other content is a conflict: exit 1, every conflict named, nothing written or removed', (t) => {
  const dir = clone();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  put(path.join(dir, 'loop-data/cache/plan.json'), '{"newer":true}');
  put(path.join(dir, 'loop-data/extract/weight.csv'), 'date,value,source\n');
  const before = snapshot(dir);
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.deepEqual(r.warns, [
    'ERROR: loop-data/extract/weight.csv already exists with other content than data/apple-health/extract/weight.csv',
    'ERROR: loop-data/cache/plan.json already exists with other content than data/nutrition/plan-data.json',
    'ERROR: 2 conflicts; nothing moved. Keep one version of each (compare them, then delete or rename the other) and run it again.',
  ]);
  assert.deepEqual(snapshot(dir), before, 'no backup, no copy, no removal');
});

test('--dry-run prints the plan and writes nothing', (t) => {
  const dir = clone();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const before = snapshot(dir);
  const r = run(dir, { dryRun: true });
  assert.equal(r.code, 0);
  assert.deepEqual(r.logs, [`migrate:data-root --dry-run: would move ${Object.keys(PERSONAL).length} files into loop-data: extract 5 (0.0 MB), import 2 (0.0 MB), foodlog 2 (0.0 MB), profile 4 (0.0 MB), cache 4 (0.0 MB), manuals 2 (0.0 MB), documents 3 (0.0 MB). Nothing written.`]);
  assert.deepEqual(snapshot(dir), before);
});

test('HC_DATA_DIR / HC_FILES_DIR: the files go to that data root and files folder', (t) => {
  const dir = clone();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-migrate-root-'));
  const files = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-migrate-files-'));
  t.after(() => [dir, data, files].forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const r = run(dir, { env: { HC_DATA_DIR: data, HC_FILES_DIR: files } });
  assert.equal(r.code, 0, r.warns.join('\n'));
  assert.equal(fs.readFileSync(path.join(data, 'cache', 'plan.json'), 'utf8'), content('data/nutrition/plan-data.json'));
  assert.equal(fs.readFileSync(path.join(files, 'import', 'export.xml'), 'utf8'), content('data/apple-health/export.xml'));
  assert.equal(fs.readFileSync(path.join(files, 'manuals', 'edge-manual.pdf'), 'utf8'), content('data/gear/edge-manual.pdf'));
  assert.equal(fs.existsSync(path.join(dir, 'loop-data')), false);
});

test('a running sync (a fresh extract lock) refuses; the lock file itself never moves', (t) => {
  const dir = clone();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'data/apple-health/extract/_meta.json.lock');
  fs.writeFileSync(lock, '');
  const before = snapshot(dir);
  const fresh = run(dir, { now: new Date() });
  assert.equal(fresh.code, 1);
  assert.match(fresh.warns[0], /^ERROR: a sync is running \(data\/apple-health\/extract\/_meta\.json\.lock\); nothing moved/);
  assert.deepEqual(snapshot(dir), before);
  // a stale lock (a crashed run) does not block, and stays where it is
  const stale = run(dir, { now: new Date(Date.now() + 10 * 60 * 1000) });
  assert.equal(stale.code, 0, stale.warns.join('\n'));
  assert.ok(fs.existsSync(lock));
  assert.equal(fs.existsSync(path.join(dir, 'loop-data/extract/_meta.json.lock')), false);
});

test('the CLI: --help exits 0, a typo exits 2, --dry-run on a clone writes nothing', (t) => {
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: npm run migrate:data-root/);
  const typo = spawnSync(process.execPath, [SCRIPT, '--dry-rn'], { encoding: 'utf8' });
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /^ERROR: /);
  const dir = clone();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const before = snapshot(dir);
  const dry = spawnSync(process.execPath, [SCRIPT, '--dry-run'], { encoding: 'utf8', env: { ...process.env, MIGRATE_REPO_ROOT: dir, HC_DATA_DIR: '', HC_FILES_DIR: '' } });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would move 22 files into loop-data/);
  assert.deepEqual(snapshot(dir), before);
});
