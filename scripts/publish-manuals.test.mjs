/* scripts/publish-manuals.mjs: strict flags; --help and a bad flag never publish. The CLI runs in a scratch
 * copy of the flags only (every folder is under a temp dir), never against the real site. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './publish-manuals.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'publish-manuals.mjs');
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('--help prints the usage and exits 0; an unknown flag, a stray argument or --out without a value exits 2', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: node scripts\/publish-manuals\.mjs/);
  for (const args of [['--bogus'], ['stray'], ['--out']]) {
    const r = run(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /^ERROR: /);
  }
});

test('main: an empty flag value exits 2 and never publishes; flags resolve to the publish folders', () => {
  const calls = [];
  const publish = (o) => { calls.push(o); return { skipped: false, published: [], missing: [], refused: [], removed: [] }; };
  const io = { log: () => {}, error: () => {} };
  assert.equal(main({ out: '' }, { publish, ...io }), 2);
  assert.equal(main({ profile: ' ' }, { publish, ...io }), 2);
  assert.equal(calls.length, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manuals-'));
  assert.equal(main({ out: path.join(dir, 'm'), gear: dir, profile: path.join(dir, 'p.json') }, { publish, ...io }), 0);
  assert.deepEqual([calls[0].outDir, calls[0].gearDir, calls[0].profileFile], [path.join(dir, 'm'), dir, path.join(dir, 'p.json')]);
  const err = [];
  assert.equal(main({ out: dir }, { publish: () => { throw new Error('boom'); }, log: () => {}, error: (m) => err.push(m) }), 1);
  assert.match(err[0], /^ERROR: device manuals not published: boom/);
  fs.rmSync(dir, { recursive: true });
});

test('main: without flags the profile and the manuals folder come from lib/paths.mjs (HC_DATA_DIR / HC_FILES_DIR); flags still win', () => {
  const calls = [];
  const publish = (o) => { calls.push(o); return { skipped: true }; };
  const io = { log: () => {}, error: () => {} };
  const root = path.join(os.tmpdir(), 'hc-manuals-root');
  assert.equal(main({ out: path.join(root, 'site') }, { publish, ...io, env: { HC_DATA_DIR: root } }), 0);
  assert.deepEqual([calls[0].profileFile, calls[0].gearDir], [path.join(root, 'cache', 'profile.json'), path.join(root, 'files', 'manuals')]);
  assert.equal(main({ out: path.join(root, 'site') }, { publish, ...io, env: { HC_DATA_DIR: root, HC_FILES_DIR: path.join(root, 'owner') } }), 0);
  assert.equal(calls[1].gearDir, path.join(root, 'owner', 'manuals'));
  const repo = path.dirname(path.dirname(SCRIPT));
  assert.equal(main({ out: path.join(root, 'site') }, { publish, ...io, env: {} }), 0);
  assert.deepEqual([calls[2].profileFile, calls[2].gearDir], [path.join(repo, 'loop-data', 'cache', 'profile.json'), path.join(repo, 'loop-data', 'files', 'manuals')], 'the default data root');
  assert.equal(main({ out: path.join(root, 'site'), gear: path.join(root, 'g'), profile: path.join(root, 'p.json') }, { publish, ...io, env: { HC_DATA_DIR: root } }), 0);
  assert.deepEqual([calls[3].profileFile, calls[3].gearDir], [path.join(root, 'p.json'), path.join(root, 'g')]);
});
