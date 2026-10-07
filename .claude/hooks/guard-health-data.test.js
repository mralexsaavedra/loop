/* Unit tests for guard-health-data.js — the PreToolUse hook that blocks
 * `git add -f` / .gitignore un-ignoring of personal-data paths (CLAUDE.md
 * HARD RULE: never commit raw health data). Drives the hook as a real
 * subprocess (it reads stdin synchronously and calls process.exit itself,
 * so it can't be `require()`d in-process without killing the test runner).
 *
 * Every case runs against a TEMPORARY git repo fixture (mkdtemp + `git init`)
 * that carries a copy of this repo's real .gitignore and a few synthetic
 * files, so the tests never depend on the owner's personal files existing and
 * the hook's "gitignored = personal" check is exercised against git itself.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'guard-health-data.js');
const REPO_GITIGNORE = path.join(__dirname, '..', '..', '.gitignore');

// Synthetic files in the fixture. Contents are placeholders, never real data.
const FIXTURE_FILES = [
  'README.md',
  'data/weight/weight-log.md',
  'data/weight/weight-log.example.md',
  'analysis/reports/2026-10-01.md',
  'analysis/reports/.gitkeep',
  'analysis/methodology.md',
  'knowledge/README.md',
  'knowledge/cycling/transcript.md',
  'data/nutrition/foodlog-daily.csv',
  'data/nutrition/foodlog-daily.meta.json',
  'data/nutrition/sync-foodlog.js',
  'backups/profile/about-me.md.before.bak',
  'data/gear/edge-manual.pdf',
  'data/gear/.gitkeep',
  'data/profile/settings.json',
  'data/profile/strava-profile.json',
  'data/profile/avatar.jpg',
  'data/profile/sync-profile.js',
  'data/profile/sync-profile.test.js',
  'data/profile/sync-settings.js',
  'data/profile/.gitkeep',
  'profile/profile.json',
  'profile/profile.example.json',
  'web/dist/personal/index.html',
  'web/test/.golden/personal/blocks.json',
  'services/plan-web/site/index.html',
  'web/.test-dist/es-personal/index.html',
];

let repo;

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-health-data-'));
  const init = spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  fs.copyFileSync(REPO_GITIGNORE, path.join(repo, '.gitignore'));
  for (const rel of FIXTURE_FILES) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'synthetic fixture\n');
  }
});

after(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
});

function runHook(command, { cwd = repo, env } = {}) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd });
  return spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8', env: env || process.env });
}

// Commands are built from word arrays so this file never holds a literal
// force-add command string (the live hook also guards the assistant's shell).
const forceAdd = (...paths) => ['git', 'add', '-f', ...paths].join(' ');

function assertBlocked(res, label) {
  assert.equal(res.status, 2, `${label}: expected block (exit 2), got ${res.status}; stderr: ${res.stderr}`);
}
function assertAllowed(res, label) {
  assert.equal(res.status, 0, `${label}: expected allow (exit 0), got ${res.status}; stderr: ${res.stderr}`);
}

// --- personal paths (gitignored) --------------------------------------------

const PERSONAL_PATHS = [
  'web/dist/personal/index.html',
  'web/test/.golden/personal/blocks.json',
  'services/plan-web/site/index.html',
  'web/.test-dist/es-personal/index.html',
  'data/profile/strava-profile.json',
  'data/profile/avatar.jpg',
  'data/profile/settings.json',
  'profile/profile.json',
  // Missed by the old hand-maintained list (2026-10-07 audit):
  'knowledge/cycling/transcript.md',
  'data/nutrition/foodlog-daily.csv',
  'data/nutrition/foodlog-daily.meta.json',
  'backups/profile/about-me.md.before.bak',
  'data/gear/edge-manual.pdf',
];

for (const p of PERSONAL_PATHS) {
  test(`blocks a force-add targeting ${p}`, () => {
    assertBlocked(runHook(forceAdd(p)), p);
  });
}

test('blocks a force-add of a parent directory holding ignored files (data)', () => {
  assertBlocked(runHook(forceAdd('data')), 'data');
});

test('blocks a force-add of a parent directory holding ignored files (analysis)', () => {
  assertBlocked(runHook(forceAdd('analysis')), 'analysis');
});

test('blocks a force-add of . (the whole tree holds ignored files)', () => {
  assertBlocked(runHook(forceAdd('.')), '.');
});

test('blocks a force-add after cd into a personal directory', () => {
  const cmd = ['cd', 'data/weight', '&&', 'git', 'add', '-f', 'weight-log.md'].join(' ');
  assertBlocked(runHook(cmd), cmd);
});

test('blocks a force-add of a relative path from a subdirectory cwd', () => {
  assertBlocked(runHook(forceAdd('weight-log.md'), { cwd: path.join(repo, 'data/weight') }), 'cwd');
});

test('blocks git -C <dir> add -f of a personal file', () => {
  const cmd = ['git', '-C', 'data/weight', 'add', '-f', 'weight-log.md'].join(' ');
  assertBlocked(runHook(cmd), cmd);
});

test('an allowed argument never cancels a personal one', () => {
  assertBlocked(runHook(forceAdd('data/profile/sync-profile.js', 'data/profile/settings.json')), 'mixed');
  assertBlocked(runHook(forceAdd('data/gear/.gitkeep', 'data/gear/edge-manual.pdf')), 'mixed .gitkeep');
});

test('blocks every flag spelling and position', () => {
  const variants = [
    ['git', 'add', '--force', 'data/weight/weight-log.md'],
    ['git', 'add', 'data/weight/weight-log.md', '-f'],
    ['git', 'add', '-fA', 'data/weight'],
    ['git', 'add', '-vf', '--', 'data/weight/weight-log.md'],
    ['git', 'stage', '-f', 'data/weight/weight-log.md'],
    ['git', 'add', '--forc', 'data/weight/weight-log.md'],
    ['git', 'add', '-f', '-A'],
  ];
  for (const words of variants) assertBlocked(runHook(words.join(' ')), words.join(' '));
});

test('blocks a force-add inside ; and | chains and subshells', () => {
  const variants = [
    ['echo', 'hi', ';', 'git', 'add', '-f', 'knowledge'],
    ['true', '|', 'git', 'add', '-f', 'backups'],
    ['(cd', 'data', '&&', 'git', 'add', '-f', 'gear)'],
    ['bash', '-c', "'cd data/nutrition && git add -f foodlog-daily.csv'"],
  ];
  for (const words of variants) assertBlocked(runHook(words.join(' ')), words.join(' '));
});

test('blocks a quoted personal path', () => {
  assertBlocked(runHook(forceAdd('"data/weight/weight-log.md"')), 'quoted');
});

test('blocks a force-add whose targets cannot be resolved (variables, xargs)', () => {
  assertBlocked(runHook(forceAdd('$TARGET')), '$TARGET');
  assertBlocked(runHook(['ls', '|', 'xargs', 'git', 'add', '-f'].join(' ')), 'xargs');
});

test('blocks a not-yet-existing ignored path (created earlier in the same command)', () => {
  assertBlocked(runHook(forceAdd('data/profile/not-yet-created.json')), 'new file');
});

// --- allowed ------------------------------------------------------------------

test('allows a force-add of an unrelated tracked file', () => {
  assertAllowed(runHook(forceAdd('README.md')), 'README.md');
});

test('allows a force-add of the tracked tooling and examples', () => {
  for (const p of [
    'data/profile/sync-profile.js',
    'data/profile/sync-profile.test.js',
    'data/profile/sync-settings.js',
    'data/profile/.gitkeep',
    'profile/profile.example.json',
    'analysis/reports/.gitkeep',
    'knowledge/README.md',
    'data/gear/.gitkeep',
    'data/nutrition/sync-foodlog.js',
  ]) {
    assertAllowed(runHook(forceAdd(p)), p);
  }
});

test('allows a force-add of several non-ignored files at once', () => {
  assertAllowed(runHook(forceAdd('data/profile/sync-settings.js', 'knowledge/README.md', 'README.md')), 'several');
});

test('allows a force-add after cd when the target is not ignored', () => {
  const cmd = ['cd', 'data/profile', '&&', 'git', 'add', '-f', 'sync-settings.js'].join(' ');
  assertAllowed(runHook(cmd), cmd);
});

test('allows a plain git add -A', () => {
  assertAllowed(runHook(['git', 'add', '-A'].join(' ')), '-A');
});

test('allows a plain git add . with no force flag, even mentioning a personal path', () => {
  assertAllowed(runHook(['git', 'add', '.', '#', 'touches', 'web/dist/personal/index.html'].join(' ')), 'no force');
});

test('allows non-add git commands that mention -f and personal paths', () => {
  assertAllowed(runHook(['git', 'rm', '-f', '--cached', 'data/weight/weight-log.md'].join(' ')), 'git rm');
  assertAllowed(runHook(['git', 'commit', '-m', '"add -f data"'].join(' ')), 'commit message');
});

// --- fallback when git is unavailable -----------------------------------------

test('falls back to the built-in personal list when git is unavailable', () => {
  const env = { ...process.env, PATH: '' };
  assertBlocked(runHook(forceAdd('data'), { env }), 'fallback data');
  assertBlocked(runHook(forceAdd('knowledge/cycling/transcript.md'), { env }), 'fallback knowledge');
  assertBlocked(runHook(forceAdd('data/profile/sync-profile.js', 'data/profile/settings.json'), { env }), 'fallback mixed');
  assertAllowed(runHook(forceAdd('data/profile/sync-settings.js'), { env }), 'fallback sync-settings');
  assertAllowed(runHook(forceAdd('README.md'), { env }), 'fallback README');
});

// --- .gitignore rewrites from the shell ---------------------------------------

test('blocks un-ignoring a personal path via sed on .gitignore', () => {
  assertBlocked(runHook("sed -i '/web\\/dist\\//d' .gitignore"), 'sed');
});

test('an exception name never cancels a personal path in a .gitignore rewrite', () => {
  assertBlocked(runHook("sed -i '/data\\/profile\\//d;/sync-profile.js/d' .gitignore"), 'sed + exception');
});

test('malformed hook payload fails open (never blocks)', () => {
  const res = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(res.status, 0);
});
