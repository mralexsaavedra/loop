/* scripts/refresh.mjs — the loop-server image's page refresh, with stubbed steps and a temp site dir (never the real
 * sync / build / data): the sequence protocol (processedSeq never goes backwards), the error codes that never touch the
 * last good publish, the sanity check, the lock, the image version as `commit`, the step timeout and the CLI checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  refresh, imageVersion, readPublished, pageIsSane, tryLock, acquireLock, runNode, main, ERROR_CODES, secondsEnv,
} from './refresh.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'refresh.mjs');
const GOOD = '<!doctype html><html><body>fresh</body></html>\n';
const AT = new Date('2026-10-16T10:00:00.123Z');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-mjs-'));
  return {
    root,
    siteDir: path.join(root, 'site'),
    buildDir: path.join(root, 'build', 'personal'),
    lockFile: path.join(root, 'refresh.lock'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Stub steps: `page` is what generate writes (null = nothing), each step's result is configurable, calls are logged. */
function stubSteps(env, { sync = true, generate = true, manuals = true, page = GOOD, onManuals = () => {} } = {}) {
  const calls = [];
  return {
    calls,
    steps: {
      sync: async () => { calls.push('sync'); return sync; },
      generate: async () => {
        calls.push('generate');
        if (page != null) { fs.mkdirSync(env.buildDir, { recursive: true }); fs.writeFileSync(path.join(env.buildDir, 'index.html'), page); }
        return generate;
      },
      manuals: async () => { calls.push('manuals'); onManuals(); return manuals; },
    },
  };
}

const status = (env) => JSON.parse(fs.readFileSync(path.join(env.siteDir, 'status.json'), 'utf8'));
const run = (env, steps, opts = {}) => refresh({ siteDir: env.siteDir, buildDir: env.buildDir, lockFile: env.lockFile, steps, version: '1.2.3', now: () => AT, log: () => {}, ...opts });

test('a pass publishes the page and status.json {publishedAt, commit: <version>, processedSeq}, then the manuals', async () => {
  const env = setup();
  try {
    let statusAtManuals = null;
    const { steps, calls } = stubSteps(env, { onManuals: () => { statusAtManuals = status(env); } });
    const r = await run(env, steps, { seq: 7 });
    assert.deepEqual(r, { ok: true, processedSeq: 7 });
    assert.deepEqual(calls, ['sync', 'generate', 'manuals']);
    assert.equal(fs.readFileSync(path.join(env.siteDir, 'index.html'), 'utf8'), GOOD);
    assert.deepEqual(status(env), { publishedAt: '2026-10-16T10:00:00Z', commit: '1.2.3', processedSeq: 7 });
    assert.deepEqual(statusAtManuals, status(env), 'status.json is written BEFORE the manuals');
    assert.deepEqual(fs.readdirSync(env.siteDir).sort(), ['index.html', 'status.json'], 'no temp file left in the site');
    assert.ok(!fs.existsSync(env.lockFile), 'the lock is released');
  } finally { env.cleanup(); }
});

test('a failed sync is not fatal: the page is rebuilt from the files on disk and published', async () => {
  const env = setup();
  try {
    const { steps } = stubSteps(env, { sync: false });
    assert.equal((await run(env, steps, { seq: 3 })).ok, true);
    assert.equal(status(env).processedSeq, 3);
    assert.equal(status(env).error, undefined);
  } finally { env.cleanup(); }
});

test('generate failing -> error build with errorSeq; the last good page and publish fields are kept', async () => {
  const env = setup();
  try {
    await run(env, stubSteps(env).steps, { seq: 4 });
    const before = status(env);
    const { steps, calls } = stubSteps(env, { generate: false, page: '<html>half' });
    const r = await run(env, steps, { seq: 5 });
    assert.deepEqual(r, { ok: false, code: 'build' });
    assert.deepEqual(status(env), { ...before, error: 'build', errorSeq: 5 });
    assert.equal(fs.readFileSync(path.join(env.siteDir, 'index.html'), 'utf8'), GOOD, 'previous page kept');
    assert.deepEqual(calls, ['sync', 'generate'], 'no manuals after a failed build');
  } finally { env.cleanup(); }
});

test('an empty or truncated page fails the sanity check (error sanity) and is never copied into the site', async () => {
  for (const page of ['', '<html><body>cut', null]) {
    const env = setup();
    try {
      await run(env, stubSteps(env).steps, { seq: 1 });
      fs.rmSync(env.buildDir, { recursive: true, force: true });
      const r = await run(env, stubSteps(env, { page }).steps, { seq: 2 });
      assert.deepEqual(r, { ok: false, code: 'sanity' }, JSON.stringify(page));
      assert.equal(status(env).errorSeq, 2);
      assert.equal(status(env).processedSeq, 1);
      assert.equal(fs.readFileSync(path.join(env.siteDir, 'index.html'), 'utf8'), GOOD);
    } finally { env.cleanup(); }
  }
});

test('a first install that fails has no publish fields, only the error (the page fails fast)', async () => {
  const env = setup();
  try {
    await run(env, stubSteps(env, { generate: false }).steps, { seq: 1 });
    assert.deepEqual(status(env), { error: 'build', errorSeq: 1 });
    assert.ok(!fs.existsSync(path.join(env.siteDir, 'index.html')));
  } finally { env.cleanup(); }
});

test('a later success clears the error; processedSeq never goes backwards', async () => {
  const env = setup();
  try {
    await run(env, stubSteps(env).steps, { seq: 10 });
    await run(env, stubSteps(env, { generate: false }).steps, { seq: 11 });
    await run(env, stubSteps(env).steps, { seq: 4 });
    assert.deepEqual(status(env), { publishedAt: '2026-10-16T10:00:00Z', commit: '1.2.3', processedSeq: 10 });
    // no --seq: keeps the published sequence
    assert.equal((await run(env, stubSteps(env).steps, {})).processedSeq, 10);
  } finally { env.cleanup(); }
});

test('a failed manuals step is logged only: the publish stands, no error code', async () => {
  const env = setup();
  try {
    const logs = [];
    const r = await run(env, stubSteps(env, { manuals: false }).steps, { seq: 2, log: (m) => logs.push(m) });
    assert.equal(r.ok, true);
    assert.equal(status(env).error, undefined);
    assert.ok(logs.some((l) => /manuals failed/.test(l)));
  } finally { env.cleanup(); }
});

test('a busy lock skips the run without --wait-lock (exit ok, nothing touched), and fails with lock when waiting', async () => {
  const env = setup();
  try {
    await run(env, stubSteps(env).steps, { seq: 1 });
    const before = status(env);
    const held = tryLock(env.lockFile);
    assert.ok(held);
    try {
      const skip = stubSteps(env);
      assert.deepEqual(await run(env, skip.steps, { seq: 2 }), { ok: true, skipped: true });
      assert.deepEqual(skip.calls, []);
      assert.deepEqual(status(env), before);
      const wait = stubSteps(env);
      assert.deepEqual(await run(env, wait.steps, { seq: 3, waitLock: true, lockWaitMs: 50 }), { ok: false, code: 'lock' });
      assert.deepEqual(wait.calls, []);
      assert.deepEqual(status(env), { ...before, error: 'lock', errorSeq: 3 });
    } finally { held.release(); }
    assert.equal((await run(env, stubSteps(env).steps, { seq: 3, waitLock: true })).ok, true, 'free again once released');
  } finally { env.cleanup(); }
});

test('the lock is taken over from a dead holder or a holder that stopped refreshing it', async () => {
  const env = setup();
  try {
    const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
    fs.writeFileSync(env.lockFile, `${dead.stdout.trim()}\n`);
    const a = tryLock(env.lockFile);
    assert.ok(a, 'dead pid -> taken over');
    a.release();
    fs.writeFileSync(env.lockFile, `${process.pid}\n`);
    const old = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(env.lockFile, old, old);
    const b = tryLock(env.lockFile);
    assert.ok(b, 'stale mtime -> taken over');
    assert.equal(tryLock(env.lockFile), null, 'a live, fresh holder keeps it');
    b.release();
    assert.ok(await acquireLock(env.lockFile, { waitMs: 0 }));
  } finally { env.cleanup(); }
});

test('the error codes are the container subset of refresh.sh (no branch / install)', () => {
  assert.deepEqual([...ERROR_CODES], ['build', 'sanity', 'lock']);
});

test('imageVersion: HC_VERSION (sanitized), else package.json version, never git', () => {
  const env = setup();
  try {
    assert.equal(imageVersion({ env: { HC_VERSION: '1.4.0' } }), '1.4.0');
    assert.equal(imageVersion({ env: { HC_VERSION: '1.4.0"<x>' } }), '1.4.0x');
    fs.writeFileSync(path.join(env.root, 'package.json'), JSON.stringify({ version: '9.8.7' }));
    assert.equal(imageVersion({ env: {}, repoRoot: env.root }), '9.8.7');
    assert.equal(imageVersion({ env: { HC_VERSION: '  ' }, repoRoot: env.root }), '9.8.7');
    assert.equal(imageVersion({ env: {}, repoRoot: path.join(env.root, 'none') }), 'unknown');
  } finally { env.cleanup(); }
});

test('readPublished ignores a garbled status.json; pageIsSane needs a whole document', () => {
  const env = setup();
  try {
    fs.mkdirSync(env.siteDir);
    fs.writeFileSync(path.join(env.siteDir, 'status.json'), '{not json');
    assert.equal(readPublished(env.siteDir), null);
    fs.writeFileSync(path.join(env.siteDir, 'status.json'), JSON.stringify({ error: 'build', errorSeq: 1 }));
    assert.equal(readPublished(env.siteDir), null);
    const f = path.join(env.root, 'p.html');
    fs.writeFileSync(f, GOOD);
    assert.equal(pageIsSane(f), true);
    assert.equal(pageIsSane(path.join(env.root, 'missing.html')), false);
  } finally { env.cleanup(); }
});

test('runNode: exit 0 -> true, non-zero -> false, a step over its timeout is killed -> false', async () => {
  assert.equal(await runNode(['-e', 'process.exit(0)'], { timeoutMs: 5000, log: () => {} }), true);
  assert.equal(await runNode(['-e', 'process.exit(3)'], { timeoutMs: 5000, log: () => {} }), false);
  const t0 = Date.now();
  assert.equal(await runNode(['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 200, log: () => {} }), false);
  assert.ok(Date.now() - t0 < 5000, 'killed at the timeout');
});

test('CLI: HC_SITE_DIR is required, --seq must be a number, bad timeouts are refused, a good run exits 0', async () => {
  const env = setup();
  try {
    const errors = [];
    const error = (m) => errors.push(m);
    assert.equal(await main({}, { env: {}, error }), 2);
    assert.match(errors.pop(), /HC_SITE_DIR is not set/);
    assert.equal(await main({ seq: '1x' }, { env: { HC_SITE_DIR: env.siteDir }, error }), 2);
    assert.match(errors.pop(), /--seq must be a whole number/);
    assert.throws(() => secondsEnv({ X: '5m' }, 'X', 1), /invalid X="5m"/);
    let got = null;
    const stepsFor = (o) => { got = o; return stubSteps({ buildDir: o.buildDir }).steps; };
    const cliEnv = { HC_SITE_DIR: env.siteDir, HC_BUILD_DIR: env.buildDir, HC_VERSION: '2.0.0', HC_REFRESH_STEP_TIMEOUT: '12' };
    assert.equal(await main({ seq: '5', 'wait-lock': true }, { env: cliEnv, stepsFor, error }), 0);
    assert.equal(got.stepTimeoutMs, 12_000);
    assert.equal(got.manualsTimeoutMs, 30_000);
    assert.equal(status(env).commit, '2.0.0');
    assert.equal(status(env).processedSeq, 5);
    assert.equal(await main({ seq: '6' }, { env: cliEnv, stepsFor: (o) => stubSteps({ buildDir: o.buildDir }, { generate: false }).steps, error }), 1);
  } finally { env.cleanup(); }
});

test('CLI: --help prints the usage, an unknown flag exits 2 before anything runs', () => {
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: node scripts\/refresh\.mjs/);
  const bad = spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8', env: { ...process.env, HC_SITE_DIR: '' } });
  assert.equal(bad.status, 2);
});

test('every error code refresh.mjs writes, and the ingest build code, has a human reason in the page copy (es + en)', async () => {
  const { es, en } = await import('../web/src/i18n/sync-templates.mjs');
  for (const code of [...ERROR_CODES, 'build']) assert.ok(es.errors[code] && en.errors[code], code);
});
