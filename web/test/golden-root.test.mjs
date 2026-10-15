/* `golden:bake --personal --root <clone>` (scripts/golden-bake.mjs): the argument parser, the CLI exit codes
 * and the read-only contract on the foreign clone (nothing written there without --update). The foreign
 * clone is a temp dir holding only the tracked seeds copied as "personal" inputs (synthetic, no extract).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, runPersonal, FIXTURES } from '../../scripts/golden-bake.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SCRIPT = path.join(ROOT, 'scripts', 'golden-bake.mjs');

/** A temp clone with personal-mode inputs (the example seeds), and the path its golden would live at. */
function fakeClone() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-golden-root-'));
  const nut = path.join(root, 'data', 'nutrition');
  fs.mkdirSync(nut, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'nutrition', 'ingredients.json'), path.join(nut, 'ingredients.json'));
  fs.copyFileSync(path.join(ROOT, 'data', 'nutrition', 'plan-data.example.json'), path.join(nut, 'plan-data.json'));
  return { root, golden: path.join(root, path.relative(ROOT, FIXTURES.personal)) };
}

/** Run fn with console output silenced (runPersonal reports on stdout / stderr). */
function quiet(fn) {
  const { log, error, warn } = console;
  console.log = console.error = console.warn = () => {};
  try { return fn(); } finally { Object.assign(console, { log, error, warn }); }
}

test('parseArgs: --root dir and --root=dir resolve the same absolute clone', () => {
  const want = { update: false, personal: true, root: path.resolve('some/clone') };
  assert.deepEqual(parseArgs(['--personal', '--root', 'some/clone']), want);
  assert.deepEqual(parseArgs(['--personal', '--root=some/clone']), want);
  assert.deepEqual(parseArgs(['--root=some/clone', '--update', '--personal']), { ...want, update: true });
  assert.deepEqual(parseArgs([]), { update: false, personal: false, root: null });
  assert.deepEqual(parseArgs(['--personal', '--update']), { update: true, personal: true, root: null });
});

test('parseArgs: a missing --root value or --root without --personal is an error', () => {
  for (const args of [['--personal', '--root'], ['--personal', '--root='], ['--personal', '--root', '--update'], ['--root', 'x'], ['--root=x']]) {
    assert.match(parseArgs(args).error ?? '', /--root <clone> takes a directory/, args.join(' '));
  }
});

test('parseArgs: strict — a typo (--updte) or a stray argument is an error, --help returns the usage', () => {
  for (const args of [['--updte'], ['--update', 'x'], ['--persnal']]) {
    assert.match(parseArgs(args).error ?? '', /unknown argument/, args.join(' '));
  }
  assert.match(parseArgs(['--help']).help, /^Usage: npm run golden:bake/);
});

test('the CLI: --help exits 0 and a typo exits 2, both before computing anything', () => {
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: npm run golden:bake/);
  const typo = spawnSync(process.execPath, [SCRIPT, '--updte'], { encoding: 'utf8' });
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /unknown argument "--updte"/);
  assert.doesNotMatch(typo.stdout, /identical/);
});

test('the CLI exits 2 on a bad --root before computing anything', () => {
  for (const args of [['--personal', '--root'], ['--root', ROOT], [`--root=${ROOT}`]]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /--root <clone>/);
  }
});

test('runPersonal: a foreign clone without a golden is exit 2 and nothing is written', () => {
  const { root, golden } = fakeClone();
  try {
    assert.equal(quiet(() => runPersonal(false, root)), 2);
    assert.equal(fs.existsSync(golden), false);
    assert.equal(fs.existsSync(path.dirname(golden)), false, 'not even the .golden dir');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runPersonal: read-only on a foreign clone unless --update', () => {
  const { root, golden } = fakeClone();
  try {
    fs.mkdirSync(path.dirname(golden), { recursive: true });
    fs.writeFileSync(golden, '{"stale":true}\n');
    assert.equal(quiet(() => runPersonal(false, root)), 1, 'a differing golden is a diff');
    assert.equal(fs.readFileSync(golden, 'utf8'), '{"stale":true}\n', 'compare never rewrites it');
    assert.equal(quiet(() => runPersonal(true, root)), 0, '--update rewrites it');
    const written = fs.readFileSync(golden, 'utf8');
    assert.notEqual(written, '{"stale":true}\n');
    assert.equal(quiet(() => runPersonal(false, root)), 0, 'then identical');
    assert.equal(fs.readFileSync(golden, 'utf8'), written);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runPersonal: a clone without personal inputs is exit 2', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-golden-root-'));
  try {
    assert.equal(quiet(() => runPersonal(false, root)), 2);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
