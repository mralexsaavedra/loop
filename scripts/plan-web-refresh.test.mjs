/* services/plan-web/refresh.sh — runs the REAL script inside a throwaway git repo with a stub `npm`
 * on PATH (never the real sync/build, never real data). Covers the branch guard, the per-step
 * timeout, status.json after a successful publish, and the keep-the-last-good-page rules.
 * Needs a POSIX shell with flock/timeout/sha256sum (Linux); skipped elsewhere. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(path.dirname(here), 'services', 'plan-web', 'refresh.sh');
const TOOLS = ['sh', 'flock', 'timeout', 'sha256sum', 'git'];
const missing = TOOLS.filter((t) => spawnSync('sh', ['-c', `command -v ${t}`]).status !== 0);
const skip = missing.length ? `needs ${missing.join(', ')}` : false;

const STUB_NPM = `#!/bin/sh
echo "$*" >> "$STUB_LOG"
case "$*" in
  "run -s sync") [ -n "\${STUB_SYNC_SLEEP:-}" ] && sleep "$STUB_SYNC_SLEEP"; exit "\${STUB_SYNC_EXIT:-0}" ;;
  ci*) exit 0 ;;
  "run -s generate")
    [ "\${STUB_GEN_EXIT:-0}" = 0 ] || exit "$STUB_GEN_EXIT"
    mkdir -p web/dist/personal && echo '<html><body>fresh</body></html>' > web/dist/personal/index.html ;;
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
  return { root, repo, planWeb, bin, log: path.join(root, 'npm.log') };
}

function run(ctx, env = {}) {
  const res = spawnSync('sh', [path.join(ctx.planWeb, 'refresh.sh')], {
    encoding: 'utf8',
    env: { PATH: `${ctx.bin}:${process.env.PATH}`, HOME: ctx.root, STUB_LOG: ctx.log, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env },
  });
  return { code: res.status, stderr: res.stderr };
}

const site = (ctx, f) => path.join(ctx.planWeb, 'site', f);

test('on main: publishes index.html and writes status.json {publishedAt, commit, branch}', { skip }, () => {
  const ctx = makeRepo('main');
  try {
    const before = Date.now() - 1000;
    const { code, stderr } = run(ctx);
    assert.equal(code, 0, stderr);
    assert.match(fs.readFileSync(site(ctx, 'index.html'), 'utf8'), /fresh/);
    const status = JSON.parse(fs.readFileSync(site(ctx, 'status.json'), 'utf8'));
    assert.deepEqual(Object.keys(status).sort(), ['branch', 'commit', 'publishedAt']);
    assert.equal(status.branch, 'main');
    assert.equal(status.commit, git(ctx.repo, 'rev-parse', '--short', 'HEAD'));
    assert.match(status.publishedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(Date.parse(status.publishedAt) >= before - 1000);
    assert.deepEqual(fs.readdirSync(path.join(ctx.planWeb, 'site')).sort(), ['index.html', 'status.json'], 'no temp files left behind');
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('on another branch: skips with a log line, exit 0, nothing run or published', { skip }, () => {
  const ctx = makeRepo('feat/x');
  try {
    const { code, stderr } = run(ctx);
    assert.equal(code, 0);
    assert.match(stderr, /branch 'feat\/x'.*not main.*PLAN_WEB_ALLOW_BRANCH=1/);
    assert.equal(fs.existsSync(ctx.log), false, 'npm never ran');
    assert.equal(fs.existsSync(path.join(ctx.planWeb, 'site')), false);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('PLAN_WEB_ALLOW_BRANCH=1 publishes a non-main branch and records it', { skip }, () => {
  const ctx = makeRepo('feat/x');
  try {
    const { code, stderr } = run(ctx, { PLAN_WEB_ALLOW_BRANCH: '1' });
    assert.equal(code, 0, stderr);
    assert.equal(JSON.parse(fs.readFileSync(site(ctx, 'status.json'), 'utf8')).branch, 'feat/x');
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('a failed generate keeps the last good page AND the last status.json', { skip }, () => {
  const ctx = makeRepo('main');
  try {
    fs.mkdirSync(path.join(ctx.planWeb, 'site'));
    fs.writeFileSync(site(ctx, 'index.html'), 'old page');
    fs.writeFileSync(site(ctx, 'status.json'), '{"publishedAt":"2030-01-01T00:00:00Z"}');
    const { code } = run(ctx, { STUB_GEN_EXIT: '1' });
    assert.equal(code, 1);
    assert.equal(fs.readFileSync(site(ctx, 'index.html'), 'utf8'), 'old page');
    assert.equal(fs.readFileSync(site(ctx, 'status.json'), 'utf8'), '{"publishedAt":"2030-01-01T00:00:00Z"}');
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('a hung sync is cut by the step timeout and the page still rebuilds from existing CSVs', { skip }, () => {
  const ctx = makeRepo('main');
  try {
    const { code, stderr } = run(ctx, { STUB_SYNC_SLEEP: '10', PLAN_WEB_STEP_TIMEOUT: '1' });
    assert.equal(code, 0, stderr);
    assert.match(stderr, /sync failed/);
    assert.ok(fs.existsSync(site(ctx, 'status.json')));
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});
