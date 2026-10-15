/* Every sync script shares one command line (data/apple-health/sync-common.mjs parseCli / runCli): --help
 * prints its usage and exits 0; an unknown flag or a stray argument exits 2 before any request or write. Run
 * as child processes against an ingest URL nothing listens on, so a script that ignored the flag would fail
 * differently (and slowly). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRIPTS } from './sync-all.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ALL = [...SCRIPTS, path.join(ROOT, 'scripts', 'sync-all.mjs')];
const ENV = { PATH: process.env.PATH, INGEST_URL: 'http://127.0.0.1:9', INGEST_ENV_FILE: path.join(ROOT, 'no-such.env') };
const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: ENV, timeout: 20000 });

for (const script of ALL) {
  const name = path.relative(ROOT, script);
  test(`${name} --help: its usage on stdout, exit 0, nothing else runs`, () => {
    const r = run(script, ['--help']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp('^Usage: node ' + name.replace(/[.]/g, '\\.') + '\\b'));
    assert.equal(r.stderr, '');
  });
  test(`${name} with an unknown flag: ERROR + usage on stderr, exit 2, nothing else runs`, () => {
    const r = run(script, ['--no-such-flag']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^ERROR: .*--no-such-flag[\s\S]*Usage: node /);
    assert.equal(r.stdout, '');
  });
}
