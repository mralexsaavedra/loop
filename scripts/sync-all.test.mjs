/* Unit tests for scripts/sync-all.mjs's pure `runAll()` — the small runner behind
 * `npm run sync`, which must run BOTH the Shortcut and Strava syncs even when one fails
 * (a shell `&&` chain would skip the second script on the first failure). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAll } from './sync-all.mjs';

function fakeSpawn (statusByScript) {
  const calls = [];
  return {
    calls,
    spawn: (cmd, args) => {
      calls.push({ cmd, args });
      const script = args[args.length - 1];
      const status = Object.prototype.hasOwnProperty.call(statusByScript, script) ? statusByScript[script] : 0;
      return { status };
    },
  };
}

test('runAll() runs every script even after an earlier one fails', () => {
  const { spawn, calls } = fakeSpawn({ 'a.js': 1, 'b.js': 0 });
  runAll(['a.js', 'b.js'], [], spawn);
  assert.deepEqual(calls.map((c) => c.args[c.args.length - 1]), ['a.js', 'b.js']);
});

test('runAll() forwards argv to every script', () => {
  const { spawn, calls } = fakeSpawn({});
  runAll(['a.js', 'b.js'], ['--full'], spawn);
  for (const call of calls) assert.deepEqual(call.args.slice(0, -1), ['--full']);
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
