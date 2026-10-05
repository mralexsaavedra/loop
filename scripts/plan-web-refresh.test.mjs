/* services/plan-web/refresh.sh — runs the REAL script inside a throwaway git repo with a stub `npm`
 * on PATH (never the real sync/build, never real data). Covers the sequence protocol (processedSeq,
 * the re-check loop, error codes that never touch the last good publish), the branch guard, the
 * per-step timeouts and the keep-the-last-good-page rules.
 * Needs a POSIX shell with flock/timeout/sha256sum (Linux); skipped elsewhere. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(path.dirname(here), 'services', 'plan-web', 'refresh.sh');
const TOOLS = ['sh', 'flock', 'timeout', 'sha256sum', 'git'];
const missing = TOOLS.filter((t) => spawnSync('sh', ['-c', `command -v ${t}`]).status !== 0);
const skip = missing.length ? `needs ${missing.join(', ')}` : false;

// STUB_BUMP=N: the first N sync calls each advance the trigger seq (100+call#), as a click during
// the run would. STUB_GEN_EMPTY=1: generate "succeeds" but writes an empty page.
const STUB_NPM = `#!/bin/sh
echo "$*" >> "$STUB_LOG"
case "$*" in
  "run -s sync")
    [ -n "\${STUB_SYNC_SLEEP:-}" ] && sleep "$STUB_SYNC_SLEEP"
    if [ -n "\${STUB_BUMP:-}" ]; then
      n=$(cat "$STUB_LOG.bumps" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STUB_LOG.bumps"
      [ "$n" -le "$STUB_BUMP" ] && printf '%s\\n' $((100 + n)) > "$STUB_TRIGGER"
    fi
    exit "\${STUB_SYNC_EXIT:-0}" ;;
  "run -s publish:manuals"*)
    [ -f services/plan-web/site/status.json ] && grep -q processedSeq services/plan-web/site/status.json && echo "status-before-manuals" >> "$STUB_LOG"
    [ -n "\${STUB_MANUALS_SLEEP:-}" ] && sleep "$STUB_MANUALS_SLEEP"
    exit "\${STUB_MANUALS_EXIT:-0}" ;;
  ci*) [ -n "\${STUB_CI_SLEEP:-}" ] && sleep "$STUB_CI_SLEEP"; exit "\${STUB_CI_EXIT:-0}" ;;
  "run -s generate")
    [ "\${STUB_GEN_EXIT:-0}" = 0 ] || exit "$STUB_GEN_EXIT"
    mkdir -p web/dist/personal
    if [ "\${STUB_GEN_EMPTY:-0}" = 1 ]; then : > web/dist/personal/index.html
    else echo '<html><body>fresh</body></html>' > web/dist/personal/index.html; fi ;;
esac
exit 0
`;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
}

function makeRepo(branch = 'main') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-'));
  const repo = path.join(root, 'repo');
  const planWeb = path.join(repo, 'services', 'plan-web');
  fs.mkdirSync(planWeb, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(planWeb, 'refresh.sh'));
  fs.writeFileSync(path.join(repo, 'package-lock.json'), '{}\n');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'npm'), STUB_NPM, { mode: 0o755 });
  git(repo, 'init', '-q', '-b', branch);
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init');
  const trigger = path.join(repo, 'services', 'health-ingest', 'trigger', 'refresh');
  fs.mkdirSync(path.dirname(trigger), { recursive: true });
  return { root, repo, planWeb, bin, trigger, log: path.join(root, 'npm.log') };
}

function env(ctx, extra = {}) {
  return { PATH: `${ctx.bin}:${process.env.PATH}`, HOME: ctx.root, STUB_LOG: ctx.log, STUB_TRIGGER: ctx.trigger, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...extra };
}

function run(ctx, extra = {}) {
  const res = spawnSync('sh', [path.join(ctx.planWeb, 'refresh.sh')], { encoding: 'utf8', env: env(ctx, extra) });
  return { code: res.status, stderr: res.stderr };
}

const site = (ctx, f) => path.join(ctx.planWeb, 'site', f);
const status = (ctx) => JSON.parse(fs.readFileSync(site(ctx, 'status.json'), 'utf8'));
const setSeq = (ctx, seq) => fs.writeFileSync(ctx.trigger, `${seq}\n`);
const npmCalls = (ctx, cmd) => (fs.existsSync(ctx.log) ? fs.readFileSync(ctx.log, 'utf8').split('\n').filter((l) => l === cmd).length : 0);

function withRepo(branch, fn) {
  const ctx = makeRepo(branch);
  try { return fn(ctx); } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
}

test('on main: publishes index.html; status.json = {publishedAt, commit, branch, processedSeq = the trigger seq}', { skip }, () => withRepo('main', (ctx) => {
  setSeq(ctx, 7);
  const before = Date.now() - 1000;
  const { code, stderr } = run(ctx);
  assert.equal(code, 0, stderr);
  assert.match(fs.readFileSync(site(ctx, 'index.html'), 'utf8'), /fresh/);
  const s = status(ctx);
  assert.deepEqual(Object.keys(s).sort(), ['branch', 'commit', 'processedSeq', 'publishedAt']);
  assert.equal(s.branch, 'main');
  assert.equal(s.commit, git(ctx.repo, 'rev-parse', '--short', 'HEAD'));
  assert.equal(s.processedSeq, 7);
  assert.match(s.publishedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(Date.parse(s.publishedAt) >= before - 1000);
  assert.deepEqual(fs.readdirSync(path.join(ctx.planWeb, 'site')).sort(), ['index.html', 'status.json'], 'no temp/state files in the served dir');
  assert.equal(npmCalls(ctx, 'run -s sync'), 1, 'one run when nothing advanced');
}));

test('after the page is published, the device manuals are published into site/manuales', { skip }, () => withRepo('main', (ctx) => {
  assert.equal(run(ctx).code, 0);
  const calls = fs.readFileSync(ctx.log, 'utf8').split('\n');
  const manuals = calls.filter((l) => l.startsWith('run -s publish:manuals'));
  assert.deepEqual(manuals, [`run -s publish:manuals -- --out ${path.join(ctx.planWeb, 'site', 'manuales')}`]);
  assert.ok(calls.indexOf(manuals[0]) > calls.indexOf('run -s generate'), 'only after a good build');
  assert.ok(calls.includes('status-before-manuals'), 'status.json (processedSeq) is written before the manuals step');
}));

test('a hung manuals publish is cut by its own timeout and never fails the run', { skip }, () => withRepo('main', (ctx) => {
  setSeq(ctx, 6);
  const t0 = Date.now();
  const { code, stderr } = run(ctx, { STUB_MANUALS_SLEEP: '30', PLAN_WEB_MANUALS_TIMEOUT: '1' });
  assert.equal(code, 0, stderr);
  assert.ok(Date.now() - t0 < 20000, 'cut well before the stub would finish');
  assert.equal(status(ctx).processedSeq, 6);
  assert.match(stderr, /manuals failed/);
}));

test('a failing manuals publish never blocks the page: published, no error in status.json', { skip }, () => withRepo('main', (ctx) => {
  setSeq(ctx, 4);
  const { code, stderr } = run(ctx, { STUB_MANUALS_EXIT: '1' });
  assert.equal(code, 0, stderr);
  assert.match(fs.readFileSync(site(ctx, 'index.html'), 'utf8'), /fresh/);
  assert.equal(status(ctx).processedSeq, 4);
  assert.equal(status(ctx).error, undefined);
  assert.match(stderr, /manuals/);
}));

test('a failed build publishes no manuals either', { skip }, () => withRepo('main', (ctx) => {
  run(ctx, { STUB_GEN_EXIT: '1' });
  assert.equal(npmCalls(ctx, `run -s publish:manuals -- --out ${path.join(ctx.planWeb, 'site', 'manuales')}`), 0);
}));

test('no trigger file (a cron run on a fresh host) publishes processedSeq 0; a garbled/old-format file reads as 0', { skip }, () => withRepo('main', (ctx) => {
  assert.equal(run(ctx).code, 0);
  assert.equal(status(ctx).processedSeq, 0);
  fs.writeFileSync(ctx.trigger, '2030-01-02T10:00:00.000Z\n');
  assert.equal(run(ctx).code, 0);
  assert.equal(status(ctx).processedSeq, 0);
}));

test('processedSeq never goes backwards', { skip }, () => withRepo('main', (ctx) => {
  setSeq(ctx, 9);
  run(ctx);
  setSeq(ctx, 3);
  run(ctx);
  assert.equal(status(ctx).processedSeq, 9);
}));

test('a click during the run (trigger seq advanced) is picked up by a second pass', { skip }, () => withRepo('main', (ctx) => {
  setSeq(ctx, 5);
  const { code, stderr } = run(ctx, { STUB_BUMP: '1' });
  assert.equal(code, 0, stderr);
  assert.equal(npmCalls(ctx, 'run -s sync'), 2);
  assert.equal(status(ctx).processedSeq, 101);
  assert.match(stderr, /advanced/);
}));

test('the re-check loop is capped at 3 passes', { skip }, () => withRepo('main', (ctx) => {
  setSeq(ctx, 1);
  const { code } = run(ctx, { STUB_BUMP: '10' });
  assert.equal(code, 0);
  assert.equal(npmCalls(ctx, 'run -s sync'), 3);
  assert.equal(status(ctx).processedSeq, 102, 'the 3rd pass started from the 2nd bump');
}));

test('on another branch: exit 0, nothing run, status.json gets {error:"branch", errorSeq} only', { skip }, () => withRepo('feat/x', (ctx) => {
  setSeq(ctx, 4);
  const { code, stderr } = run(ctx);
  assert.equal(code, 0);
  assert.match(stderr, /branch 'feat\/x'.*not main.*PLAN_WEB_ALLOW_BRANCH=1/);
  assert.equal(fs.existsSync(ctx.log), false, 'npm never ran');
  assert.equal(fs.existsSync(site(ctx, 'index.html')), false);
  assert.deepEqual(status(ctx), { error: 'branch', errorSeq: 4 });
}));

test('PLAN_WEB_ALLOW_BRANCH=1 publishes a non-main branch and records it', { skip }, () => withRepo('feat/x', (ctx) => {
  const { code, stderr } = run(ctx, { PLAN_WEB_ALLOW_BRANCH: '1' });
  assert.equal(code, 0, stderr);
  assert.equal(status(ctx).branch, 'feat/x');
}));

test('a failed generate keeps the last good page AND its publishedAt/processedSeq, adding {error:"build", errorSeq}', { skip }, () => withRepo('main', (ctx) => {
  setSeq(ctx, 2);
  assert.equal(run(ctx).code, 0);
  const good = status(ctx);
  fs.writeFileSync(site(ctx, 'index.html'), 'old page');
  setSeq(ctx, 3);
  const { code } = run(ctx, { STUB_GEN_EXIT: '1' });
  assert.equal(code, 1);
  assert.equal(fs.readFileSync(site(ctx, 'index.html'), 'utf8'), 'old page');
  assert.deepEqual(status(ctx), { ...good, error: 'build', errorSeq: 3 });
  // the next successful run clears the error
  assert.equal(run(ctx).code, 0);
  const s = status(ctx);
  assert.equal(s.error, undefined);
  assert.equal(s.errorSeq, undefined);
  assert.equal(s.processedSeq, 3);
}));

test('a failed npm ci -> error "install"; the page is not rebuilt', { skip }, () => withRepo('main', (ctx) => {
  setSeq(ctx, 6);
  const { code } = run(ctx, { STUB_CI_EXIT: '1' });
  assert.equal(code, 1);
  assert.deepEqual(status(ctx), { error: 'install', errorSeq: 6 });
  assert.equal(npmCalls(ctx, 'run -s generate'), 0);
}));

test('an empty build output -> error "sanity", nothing copied to site', { skip }, () => withRepo('main', (ctx) => {
  setSeq(ctx, 8);
  const { code } = run(ctx, { STUB_GEN_EMPTY: '1' });
  assert.equal(code, 1);
  assert.equal(fs.existsSync(site(ctx, 'index.html')), false);
  assert.deepEqual(status(ctx), { error: 'sanity', errorSeq: 8 });
}));

test('npm ci has its own longer timeout (PLAN_WEB_CI_TIMEOUT), independent of the step timeout', { skip }, () => withRepo('main', (ctx) => {
  const { code, stderr } = run(ctx, { STUB_CI_SLEEP: '2', PLAN_WEB_STEP_TIMEOUT: '1', PLAN_WEB_CI_TIMEOUT: '20' });
  assert.equal(code, 0, stderr);
  assert.ok(fs.existsSync(site(ctx, 'index.html')));
}));

test('a hung sync is cut by the step timeout and the page still rebuilds from existing CSVs', { skip }, () => withRepo('main', (ctx) => {
  const { code, stderr } = run(ctx, { STUB_SYNC_SLEEP: '10', PLAN_WEB_STEP_TIMEOUT: '1' });
  assert.equal(code, 0, stderr);
  assert.match(stderr, /sync failed/);
  assert.ok(fs.existsSync(site(ctx, 'status.json')));
}));

test('lock: an on-demand run that cannot get the lock in time writes error "lock"; a cron run just skips', { skip }, async () => {
  const ctx = makeRepo('main');
  const holder = spawn('flock', [path.join(ctx.planWeb, '.refresh.lock'), 'sleep', '5'], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 300));
    setSeq(ctx, 11);
    const cron = run(ctx);
    assert.equal(cron.code, 0);
    assert.match(cron.stderr, /still active, skipping/);
    assert.equal(fs.existsSync(site(ctx, 'status.json')), false, 'a cron skip is not an error: the running refresh covers it');

    const onDemand = run(ctx, { PLAN_WEB_WAIT_LOCK: '1', PLAN_WEB_LOCK_WAIT: '1' });
    assert.equal(onDemand.code, 1);
    assert.deepEqual(status(ctx), { error: 'lock', errorSeq: 11 });
    assert.equal(fs.existsSync(ctx.log), false, 'npm never ran');
  } finally {
    holder.kill();
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});
