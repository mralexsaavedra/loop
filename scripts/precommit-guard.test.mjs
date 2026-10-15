/* The opt-in git pre-commit hook (scripts/git-hooks/pre-commit -> scripts/precommit-guard.mjs, docs/guard-hook.md):
 * real commits in a scratch repo whose core.hooksPath points at this checkout's hooks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOKS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'git-hooks');

function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-precommit-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  git('init', '-q', '-b', 'main');
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  write('.gitignore', 'data/profile/\nprofile/about-me.md\n*.bak\n!keep.bak\n');
  write('README.md', 'x\n');
  git('add', '.');
  assert.equal(git('commit', '-qm', 'init').status, 0);
  git('config', 'core.hooksPath', HOOKS);
  return { dir, git, write, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('the hook script is tracked as executable and runs the guard', () => {
  const hook = path.join(HOOKS, 'pre-commit');
  assert.ok(fs.statSync(hook).mode & 0o111, 'executable (git skips a non-executable hook)');
  assert.match(fs.readFileSync(hook, 'utf8'), /precommit-guard\.mjs/);
});

test('a force-added personal (gitignored) file is refused, naming it; nothing is committed', () => {
  const r = scratchRepo();
  try {
    r.write('data/profile/settings.json', '{"goal":"cut"}');
    r.write('notes.md', 'fine\n');
    r.git('add', '-f', 'data/profile/settings.json', 'notes.md');
    const c = r.git('commit', '-m', 'oops');
    assert.notEqual(c.status, 0);
    assert.match(c.stderr, /data\/profile\/settings\.json/);
    assert.match(c.stderr, /personal/i);
    assert.match(c.stderr, /git restore --staged/);
    assert.doesNotMatch(c.stderr, /notes\.md/, 'only the personal file is named');
    assert.equal(r.git('rev-list', '--count', 'HEAD').stdout.trim(), '1');
  } finally { r.cleanup(); }
});

test('ordinary commits pass: new and changed tracked files, a negated (!) exception, deletions', () => {
  const r = scratchRepo();
  try {
    r.write('README.md', 'changed\n');
    r.write('lib/a.mjs', 'export {}\n');
    r.write('keep.bak', 'allowed by !keep.bak\n');
    r.git('add', 'README.md', 'lib/a.mjs', 'keep.bak');
    assert.equal(r.git('commit', '-qm', 'ok').status, 0, r.git('status').stdout);
    r.git('rm', '-q', 'lib/a.mjs');
    assert.equal(r.git('commit', '-qm', 'rm').status, 0);
  } finally { r.cleanup(); }
});

test('a staged .gitignore that drops an ignore pattern or adds a ! negation is refused; adding patterns is fine', () => {
  const r = scratchRepo();
  try {
    r.write('.gitignore', 'data/profile/\nprofile/about-me.md\n*.bak\n!keep.bak\nbuild/\n');
    r.git('add', '.gitignore');
    assert.equal(r.git('commit', '-qm', 'more ignores').status, 0);
    r.write('.gitignore', 'profile/about-me.md\n*.bak\n!keep.bak\nbuild/\n');
    r.git('add', '.gitignore');
    const drop = r.git('commit', '-m', 'unignore');
    assert.notEqual(drop.status, 0);
    assert.match(drop.stderr, /\.gitignore/);
    assert.match(drop.stderr, /data\/profile\//);
    r.write('.gitignore', 'data/profile/\nprofile/about-me.md\n*.bak\n!keep.bak\nbuild/\n!data/profile/settings.json\n');
    r.git('add', '.gitignore');
    const neg = r.git('commit', '-m', 'negate');
    assert.notEqual(neg.status, 0);
    assert.match(neg.stderr, /!data\/profile\/settings\.json/);
  } finally { r.cleanup(); }
});

test('the documented opt-in (a RELATIVE core.hooksPath) works from a subdirectory too', () => {
  const r = scratchRepo();
  try {
    const scripts = path.dirname(HOOKS);
    for (const f of ['git-hooks/pre-commit', 'precommit-guard.mjs', 'lib/is-main.mjs']) {
      fs.mkdirSync(path.dirname(path.join(r.dir, 'scripts', f)), { recursive: true });
      fs.copyFileSync(path.join(scripts, f), path.join(r.dir, 'scripts', f));
    }
    fs.chmodSync(path.join(r.dir, 'scripts/git-hooks/pre-commit'), 0o755);
    r.git('config', 'core.hooksPath', 'scripts/git-hooks');
    r.write('data/profile/onboarding.json', '{}');
    r.write('sub/x.md', 'x\n');
    r.git('add', '-f', 'data/profile/onboarding.json');
    const c = spawnSync('git', ['commit', '-m', 'oops'], { cwd: path.join(r.dir, 'sub'), encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
    assert.notEqual(c.status, 0);
    assert.match(c.stderr, /data\/profile\/onboarding\.json/);
  } finally { r.cleanup(); }
});
