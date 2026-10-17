/* The data-root guard (scripts/lib/data-root-guard.mjs) and the commands that call it before writing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dataRootGuardError } from './lib/data-root-guard.mjs';
import { main as syncAll } from './sync-all.mjs';
import { main as connect } from './connect.mjs';
import { main as documents } from './documents.mjs';
import { main as migrate } from './migrate-data-root.mjs';

/** A throwaway git work tree whose .gitignore ignores loop-data/ and backups/. */
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-guard-'));
  assert.equal(spawnSync('git', ['init', '-q', dir]).status, 0);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'loop-data/\nbackups/\n');
  return dir;
}

test('dataRootGuardError: the default loop-data/, an ignored folder and a folder outside the clone pass; an unignored one inside is refused', (t) => {
  const r = repo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-guard-out-'));
  t.after(() => { fs.rmSync(r, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  assert.equal(dataRootGuardError({ repoRoot: r, env: {} }), null);
  assert.equal(dataRootGuardError({ repoRoot: r, env: { HC_DATA_DIR: 'backups/mine' } }), null);
  assert.equal(dataRootGuardError({ repoRoot: r, env: { HC_DATA_DIR: outside } }), null);
  assert.match(dataRootGuardError({ repoRoot: r, env: { HC_DATA_DIR: 'my-data' } }), /data root my-data\/ \(HC_DATA_DIR\) is inside this clone and git does not ignore it/);
  assert.match(dataRootGuardError({ repoRoot: r, env: { HC_DATA_DIR: path.join(r, 'data', 'x') } }), /data root data\/x\/ /);
  assert.match(dataRootGuardError({ repoRoot: r, env: { HC_FILES_DIR: 'docs/files' } }), /files folder docs\/files\/ \(HC_FILES_DIR\)/);
  assert.match(dataRootGuardError({ repoRoot: r, env: { HC_DATA_DIR: '.' } }), /is this clone itself/);
  // a symlink outside the clone pointing into it is inside
  const link = path.join(outside, 'link');
  fs.mkdirSync(path.join(r, 'tracked-dir'));
  fs.symlinkSync(path.join(r, 'tracked-dir'), link);
  assert.match(dataRootGuardError({ repoRoot: r, env: { HC_DATA_DIR: link } }), /tracked-dir\//);
  // not a git work tree: nothing could commit it
  assert.equal(dataRootGuardError({ repoRoot: outside, env: { HC_DATA_DIR: 'x' } }), null);
});

test('the commands that write the data root refuse an unignored one inside the clone before writing anything', async (t) => {
  const r = repo();
  t.after(() => fs.rmSync(r, { recursive: true, force: true }));
  const env = { HC_DATA_DIR: 'my-data', INGEST_URL: 'http://127.0.0.1:9', INGEST_TOKEN: 'x'.repeat(32), INGEST_ENV_FILE: path.join(r, 'none.env') };
  const warns = [];
  const warn = (m) => warns.push(m);
  const spawn = () => { throw new Error('no sync script may run'); };
  assert.equal(await syncAll({}, { env: { ...env, SYNC_CLIENT_ROOT: r }, spawn, log: () => {}, warn }), 1);
  assert.equal(await connect({ argv: ['http://127.0.0.1:9'], env: { ...env, SYNC_CLIENT_ROOT: r }, log: () => {}, warn, isTTY: false }), 1);
  assert.equal(await documents({ argv: ['pull', 'plan'], env: { ...env, SYNC_DOCUMENTS_ROOT: r }, log: () => {}, warn }), 1);
  assert.equal(migrate({ repoRoot: r, env, log: () => {}, warn }), 1);
  assert.equal(warns.length, 4, warns.join('\n'));
  for (const w of warns) assert.match(w, /^ERROR: the data root my-data\/ \(HC_DATA_DIR\) is inside this clone and git does not ignore it/);
  assert.equal(fs.existsSync(path.join(r, 'my-data')), false);
});

test('npm run import:health refuses an unignored data root inside the clone (exit 1, nothing created)', () => {
  const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));
  const res = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'import-health.mjs')], { encoding: 'utf8', env: { ...process.env, HC_DATA_DIR: 'scripts/hc-guard-probe' } });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /ERROR: the data root scripts\/hc-guard-probe\/ \(HC_DATA_DIR\) is inside this clone and git does not ignore it/);
  assert.equal(fs.existsSync(path.join(REPO, 'scripts', 'hc-guard-probe')), false);
});

test('the single sync scripts that write the data root (npm run sync:strava, node data/apple-health/extract.mjs) refuse an unignored one inside the clone (exit 1, nothing created)', () => {
  const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));
  for (const script of [['data', 'apple-health', 'sync-strava.mjs'], ['data', 'apple-health', 'extract.mjs']]) {
    const res = spawnSync(process.execPath, [path.join(REPO, ...script)], {
      encoding: 'utf8',
      env: { ...process.env, HC_DATA_DIR: 'scripts/hc-guard-probe', INGEST_URL: 'http://127.0.0.1:9', INGEST_TOKEN: 'x'.repeat(32), INGEST_ENV_FILE: path.join(REPO, 'scripts', 'hc-guard-none.env') },
    });
    assert.equal(res.status, 1, `${script.join('/')}: ${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /^ERROR: the data root scripts\/hc-guard-probe\/ \(HC_DATA_DIR\) is inside this clone and git does not ignore it/m, script.join('/'));
    assert.equal(fs.existsSync(path.join(REPO, 'scripts', 'hc-guard-probe')), false, script.join('/'));
  }
});

test('--help of a guarded sync script still prints its usage (the guard runs only before the work)', () => {
  const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));
  const res = spawnSync(process.execPath, [path.join(REPO, 'data', 'apple-health', 'sync-strava.mjs'), '--help'], { encoding: 'utf8', env: { ...process.env, HC_DATA_DIR: 'scripts/hc-guard-probe' } });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Usage:/);
});
