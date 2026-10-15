/* Unit tests for scripts/sync-all.mjs's pure `runAll()` — the small runner behind
 * `npm run sync`, which must run BOTH the Shortcut and Strava syncs even when one fails
 * (a shell `&&` chain would skip the second script on the first failure). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runAll } from './sync-all.mjs';

function fakeSpawn (statusByScript) {
  const calls = [];
  return {
    calls,
    spawn: (cmd, args) => {
      calls.push({ cmd, args });
      const script = args[0];
      const status = Object.prototype.hasOwnProperty.call(statusByScript, script) ? statusByScript[script] : 0;
      return { status };
    },
  };
}

test('runAll() runs every script even after an earlier one fails', () => {
  const { spawn, calls } = fakeSpawn({ 'a.js': 1, 'b.js': 0 });
  runAll(['a.js', 'b.js'], [], spawn);
  assert.deepEqual(calls.map((c) => c.args[0]), ['a.js', 'b.js']);
});

test('runAll() forwards argv to every script AFTER the script path (node would read them as its own flags)', () => {
  const { spawn, calls } = fakeSpawn({});
  runAll(['a.js', 'b.js'], ['--full'], spawn);
  assert.deepEqual(calls.map((c) => c.args), [['a.js', '--full'], ['b.js', '--full']]);
});

test('runAll() with the real node: `--full` reaches the script\'s argv (npm run sync -- --full)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-all-'));
  try {
    const script = path.join(dir, 's.js');
    const out = path.join(dir, 'argv.json');
    fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)))`);
    const code = runAll([script], ['--full'], (cmd, a) => spawnSync(cmd, a, { encoding: 'utf8' }));
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), ['--full']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runAll() returns a non-zero exit code when any script failed', () => {
  const { spawn } = fakeSpawn({ 'a.js': 0, 'b.js': 1 });
  assert.notEqual(runAll(['a.js', 'b.js'], [], spawn), 0);
});

test('runAll() returns 0 when every script succeeded', () => {
  const { spawn } = fakeSpawn({ 'a.js': 0, 'b.js': 0 });
  assert.equal(runAll(['a.js', 'b.js'], [], spawn), 0);
});

test('runAll() treats a null status (spawn itself failed) as a failure', () => {
  const { spawn } = fakeSpawn({ 'a.js': null });
  assert.notEqual(runAll(['a.js'], [], spawn), 0);
});

test('npm run sync runs Strava before the Shortcut sync (its activity windows feed hr-hourly.csv), then profile, settings, the onboarding document, food log', async () => {
  const { SCRIPTS } = await import('./sync-all.mjs');
  const names = SCRIPTS.map((s) => s.split(/[\\/]/).slice(-2).join('/'));
  assert.deepEqual(names, ['apple-health/sync-strava.mjs', 'apple-health/sync-shortcut.mjs', 'profile/sync-profile.mjs', 'profile/sync-settings.mjs', 'scripts/sync-onboarding.mjs', 'nutrition/sync-foodlog.mjs', 'scripts/sync-journal.mjs']);
});

test('runAll() takes per-script argv as a function of the script path', () => {
  const { spawn, calls } = fakeSpawn({});
  runAll(['a.js', 'b.js'], (s) => (s === 'b.js' ? ['--full'] : []), spawn);
  assert.deepEqual(calls.map((c) => c.args), [['a.js'], ['b.js', '--full']]);
});

test('scriptArgs: `npm run sync -- --full` reaches the Shortcut sync only (the other scripts reject flags they do not know)', async () => {
  const { SCRIPTS, scriptArgs } = await import('./sync-all.mjs');
  const full = scriptArgs({ full: true });
  assert.deepEqual(SCRIPTS.filter((s) => full(s).length).map((s) => path.basename(s)), ['sync-shortcut.mjs']);
  assert.deepEqual(full(SCRIPTS[1]), ['--full']);
  assert.deepEqual(SCRIPTS.map(scriptArgs({})), SCRIPTS.map(() => []));
});
