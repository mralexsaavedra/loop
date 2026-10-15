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
