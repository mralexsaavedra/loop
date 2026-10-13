/* isMain(import.meta.url) — the scripts' shared "run main only when executed directly" guard
 * (scripts/lib/is-main.mjs). Unit cases stub process.argv; the end-to-end cases spawn real scripts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMain } from './lib/is-main.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

function withArgv1(value, fn) {
  const saved = process.argv;
  process.argv = value === undefined ? [saved[0]] : [saved[0], value];
  try {
    return fn();
  } finally {
    process.argv = saved;
  }
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'is-main-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function tempModule(t) {
  const dir = tempDir(t);
  const file = path.join(dir, 'entry.mjs');
  fs.writeFileSync(file, '');
  return { dir, file, url: pathToFileURL(file).href };
}

test('isMain is true when argv[1] is the module path', (t) => {
  const { file, url } = tempModule(t);
  assert.equal(withArgv1(file, () => isMain(url)), true);
});

test('isMain is true for a relative argv[1] (resolved against the cwd)', (t) => {
  const { file, url } = tempModule(t);
  const rel = path.relative(process.cwd(), file);
  assert.equal(withArgv1(rel, () => isMain(url)), true);
});

test('isMain is true when argv[1] is a symlink to the module', (t) => {
  const { dir, file, url } = tempModule(t);
  const link = path.join(dir, 'link.mjs');
  fs.symlinkSync(file, link);
  assert.equal(withArgv1(link, () => isMain(url)), true);
});

test('isMain is false for a different file', (t) => {
  const { dir, url } = tempModule(t);
  const other = path.join(dir, 'other.mjs');
  fs.writeFileSync(other, '');
  assert.equal(withArgv1(other, () => isMain(url)), false);
});

test('isMain is false when argv[1] is missing or does not exist', (t) => {
  const { dir, url } = tempModule(t);
  assert.equal(withArgv1(undefined, () => isMain(url)), false);
  assert.equal(withArgv1(path.join(dir, 'nope.mjs'), () => isMain(url)), false);
});

test('a script run through a symlink still runs its main (gen-journal-calc --check)', (t) => {
  const dir = tempDir(t);
  const link = path.join(dir, 'gen-journal-calc.mjs');
  fs.symlinkSync(path.join(SCRIPTS, 'gen-journal-calc.mjs'), link);
  const r = spawnSync(process.execPath, [link, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /journal-calc\.js is current/);
});

test('importing a script does not run its main', () => {
  const url = pathToFileURL(path.join(SCRIPTS, 'gen-journal-calc.mjs')).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});
