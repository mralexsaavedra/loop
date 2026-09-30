/* Unit tests for guard-health-data.js — the PreToolUse hook that blocks
 * `git add -f` / .gitignore un-ignoring of personal-data paths (CLAUDE.md
 * HARD RULE: never commit raw health data). Drives the hook as a real
 * subprocess (it reads stdin synchronously and calls process.exit itself,
 * so it can't be `require()`d in-process without killing the test runner).
 *
 * Regression coverage for the astro-plan-web corrective batch: web/dist/,
 * web/test/.golden/, services/plan-web/site/ and web/.test-dist/ are all
 * gitignored and all derived from personal data (baked JSON globals,
 * rendered copy, test fixtures) — same leak surface as the source files.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const HOOK = path.join(__dirname, 'guard-health-data.js');

function runHook(command) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  return spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });
}

const PERSONAL_PATHS = [
  'web/dist/personal/index.html',
  'web/test/.golden/personal/blocks.json',
  'services/plan-web/site/index.html',
  'web/.test-dist/es-personal/index.html',
  'data/profile/strava-profile.json',
  'data/profile/avatar.jpg',
  'profile/profile.json',
];

for (const p of PERSONAL_PATHS) {
  test(`blocks a force-add targeting ${p}`, () => {
    const res = runHook(['git', 'add', '-f', p].join(' '));
    assert.equal(res.status, 2, `expected block (exit 2), got ${res.status}; stderr: ${res.stderr}`);
  });
}

test('allows a force-add of an unrelated tracked file', () => {
  const res = runHook(['git', 'add', '-f', 'README.md'].join(' '));
  assert.equal(res.status, 0);
});

test('allows a force-add of the tracked profile tooling and example', () => {
  for (const p of ['data/profile/sync-profile.js', 'data/profile/sync-profile.test.js', 'data/profile/.gitkeep', 'profile/profile.example.json']) {
    const res = runHook(['git', 'add', '-f', p].join(' '));
    assert.equal(res.status, 0, p);
  }
});

test('allows a plain git add -A', () => {
  const res = runHook(['git', 'add', '-A'].join(' '));
  assert.equal(res.status, 0);
});

test('allows a plain git add . with no force flag, even mentioning a personal path', () => {
  const res = runHook(['git', 'add', '.', '#', 'touches', 'web/dist/personal/index.html'].join(' '));
  assert.equal(res.status, 0, 'no --force / -f flag present, must not block');
});

test('blocks un-ignoring a personal path via sed on .gitignore', () => {
  const res = runHook("sed -i '/web\\/dist\\//d' .gitignore");
  assert.equal(res.status, 2);
});

test('malformed hook payload fails open (never blocks)', () => {
  const res = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(res.status, 0);
});
