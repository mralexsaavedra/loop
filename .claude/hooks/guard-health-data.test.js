/* Unit tests for guard-health-data.js — the PreToolUse hook that blocks
 * `git add -f` / .gitignore un-ignoring of personal-data paths (CLAUDE.md
 * repo rule: never commit personal / raw health data). Drives the hook as a real
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

// Allow-path preconditions, so an allow test can never pass vacuously (a target
// that is missing, or already ignored, or an edit whose old_string does not apply).
function isIgnored(rel, cwd = repo) {
  return spawnSync('git', ['-C', cwd, 'check-ignore', '-q', '--no-index', '--', rel]).status === 0;
}
function assertRealNonIgnored(rel, cwd = repo) {
  assert.ok(fs.existsSync(path.join(cwd, rel)), `precondition: ${rel} must exist in the fixture`);
  assert.equal(isIgnored(rel, cwd), false, `precondition: ${rel} must not be ignored in the fixture`);
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
  assertRealNonIgnored('README.md');
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
    assertRealNonIgnored(p);
    assertAllowed(runHook(forceAdd(p)), p);
  }
});

test('allows a force-add of several non-ignored files at once', () => {
  for (const p of ['data/profile/sync-settings.js', 'knowledge/README.md', 'README.md']) assertRealNonIgnored(p);
  assertAllowed(runHook(forceAdd('data/profile/sync-settings.js', 'knowledge/README.md', 'README.md')), 'several');
});

test('allows a force-add after cd when the target is not ignored', () => {
  assertRealNonIgnored('sync-settings.js', path.join(repo, 'data/profile'));
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
  assertRealNonIgnored('data/profile/sync-settings.js');
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

// --- Edit / Write / MultiEdit on .gitignore -------------------------------------

function runTool(tool_name, tool_input, { env } = {}) {
  const payload = JSON.stringify({ tool_name, tool_input, cwd: repo });
  return spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8', env: env || process.env });
}
const gitignorePath = () => path.join(repo, '.gitignore');
const currentGitignore = () => fs.readFileSync(gitignorePath(), 'utf8');
// Precondition for allow tests: the edit really applies to the fixture .gitignore
// (an old_string that is missing makes the tool fail and the hook allow vacuously).
function assertEditApplies(oldString) {
  assert.ok(currentGitignore().includes(oldString), `precondition: .gitignore must contain ${JSON.stringify(oldString)}`);
}

test('blocks an Edit that removes an ignore pattern', () => {
  const res = runTool('Edit', {
    file_path: gitignorePath(),
    old_string: 'data/nutrition/foodlog-daily.csv\n',
    new_string: '',
  });
  assertBlocked(res, 'remove pattern');
});

test('blocks an Edit that adds a negation un-ignoring an ignored file', () => {
  const res = runTool('Edit', {
    file_path: gitignorePath(),
    old_string: '!data/gear/.gitkeep\n',
    new_string: '!data/gear/.gitkeep\n!data/gear/*.pdf\n',
  });
  assertBlocked(res, 'negation');
});

test('blocks an Edit with a relative file_path (resolved against cwd)', () => {
  const res = runTool('Edit', { file_path: '.gitignore', old_string: 'knowledge/*\n', new_string: '' });
  assertBlocked(res, 'relative path');
});

test('allows an Edit that adds a new ignore pattern', () => {
  assertEditApplies('data/gear/*\n');
  const res = runTool('Edit', {
    file_path: gitignorePath(),
    old_string: 'data/gear/*\n',
    new_string: 'data/gear/*\ndata/new-personal/\n',
  });
  assertAllowed(res, 'add pattern');
});

test('allows an Edit that adds a negation matching no ignored file', () => {
  assertEditApplies('!data/profile/sync-settings.test.js\n');
  // the negation targets nothing, but the directory does hold ignored files, so the replay really runs
  assert.ok(!fs.existsSync(path.join(repo, 'data/profile/sync-goals.js')), 'precondition: sync-goals.js absent');
  assert.ok(isIgnored('data/profile/settings.json'), 'precondition: data/profile holds an ignored file');
  const res = runTool('Edit', {
    file_path: gitignorePath(),
    old_string: '!data/profile/sync-settings.test.js\n',
    new_string: '!data/profile/sync-settings.test.js\n!data/profile/sync-goals.js\n',
  });
  assertAllowed(res, 'harmless negation');
});

test('allows an Edit that removes a negation or changes a comment', () => {
  assertEditApplies('!data/gear/.gitkeep\n');
  assertEditApplies('# OS / tooling noise\n');
  assertAllowed(
    runTool('Edit', { file_path: gitignorePath(), old_string: '!data/gear/.gitkeep\n', new_string: '' }),
    'remove negation'
  );
  assertAllowed(
    runTool('Edit', {
      file_path: gitignorePath(),
      old_string: '# OS / tooling noise\n',
      new_string: '# OS and tooling noise\n',
    }),
    'comment'
  );
});

test('blocks a Write of .gitignore that drops a pattern, allows one that only adds', () => {
  const old = currentGitignore();
  assertBlocked(
    runTool('Write', { file_path: gitignorePath(), content: old.replace('data/gear/*\n', '') }),
    'write drop'
  );
  assert.ok(old.includes('data/gear/*\n'), 'precondition: the dropped pattern exists');
  assertAllowed(runTool('Write', { file_path: gitignorePath(), content: old + '\nscratch/\n' }), 'write add');
});

test('blocks a MultiEdit where one edit removes a pattern', () => {
  const res = runTool('MultiEdit', {
    file_path: gitignorePath(),
    edits: [
      { old_string: '# OS / tooling noise\n', new_string: '# OS and tooling noise\n' },
      { old_string: 'profile/profile.json\n', new_string: '' },
    ],
  });
  assertBlocked(res, 'multiedit');
});

test('blocks a Write of a nested .gitignore that re-includes an ignored file', () => {
  const res = runTool('Write', { file_path: path.join(repo, 'data/weight/.gitignore'), content: '!weight-log.md\n' });
  assertBlocked(res, 'nested');
});

test('allows Edit / Write on files other than .gitignore', () => {
  assertAllowed(runTool('Write', { file_path: path.join(repo, 'notes.md'), content: '!data/gear/*.pdf\n' }), 'notes');
  assertAllowed(
    runTool('Edit', { file_path: path.join(repo, 'README.md'), old_string: 'synthetic', new_string: 'x' }),
    'readme'
  );
});

test('falls back to a static negation check when git is unavailable', () => {
  const env = { ...process.env, PATH: '' };
  const res = runTool(
    'Edit',
    { file_path: gitignorePath(), old_string: '!data/gear/.gitkeep\n', new_string: '!data/gear/.gitkeep\n!data/gear/*.pdf\n' },
    { env }
  );
  assertBlocked(res, 'fallback negation');
});

test('malformed hook payload fails open (never blocks)', () => {
  const res = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(res.status, 0);
});

// --- review follow-ups: fail closed, wrappers, subshell scope, eval / stdin shells ---

const W = (...words) => words.join(' ');
const PERSONAL_FILE = 'data/weight/weight-log.md';

test('an unexpected exception while judging a force-add blocks (fails closed)', () => {
  // a NUL byte makes child_process throw inside the git check
  const res = runHook(forceAdd('"a\u0000b"'));
  assertBlocked(res, 'NUL target');
  assert.match(res.stderr, /internal error/i);
});

test('an fs error while replaying a .gitignore edit blocks (fails closed)', () => {
  assertEditApplies('!data/gear/.gitkeep\n');
  const env = { ...process.env, TMPDIR: path.join(repo, 'no-such-tmp-dir') };
  const res = runTool(
    'Edit',
    { file_path: gitignorePath(), old_string: '!data/gear/.gitkeep\n', new_string: '!data/gear/.gitkeep\n!data/gear/*.pdf\n' },
    { env }
  );
  assertBlocked(res, 'mkdtemp failure');
  assert.match(res.stderr, /internal error/i);
});

test('an existing .gitignore that cannot be read blocks the edit instead of being treated as empty', () => {
  const dir = path.join(repo, 'unreadable-ignore');
  fs.mkdirSync(path.join(dir, '.gitignore'), { recursive: true }); // EISDIR on read
  try {
    const res = runTool('Write', { file_path: path.join(dir, '.gitignore'), content: '# nothing\n' });
    assertBlocked(res, 'unreadable .gitignore');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wrappers with option arguments are unwrapped (no bypass)', () => {
  const variants = [
    W('sudo', '-u', 'someone', 'git', 'add', '-f', PERSONAL_FILE),
    W('sudo', '--user', 'someone', '--', 'git', 'add', '-f', PERSONAL_FILE),
    W('sudo', '-iu', 'someone', 'git', 'add', '-f', PERSONAL_FILE),
    W('doas', '-u', 'someone', 'git', 'add', '-f', PERSONAL_FILE),
    W('env', '-i', 'A=1', 'git', 'add', '-f', PERSONAL_FILE),
    W('env', '-u', 'HOME', 'git', 'add', '-f', PERSONAL_FILE),
    W('env', '--unset=HOME', 'git', 'add', '-f', PERSONAL_FILE),
    W('rtk', 'proxy', 'git', 'add', '-f', PERSONAL_FILE),
    W('nice', '-n', '10', 'git', 'add', '-f', PERSONAL_FILE),
    W('timeout', '-s', 'KILL', '5', 'git', 'add', '-f', PERSONAL_FILE),
    W('time', '-f', '%e', 'git', 'add', '-f', PERSONAL_FILE),
    W('sudo', '--some-future-option', 'value', 'git', 'add', '-f', PERSONAL_FILE),
  ];
  for (const cmd of variants) assertBlocked(runHook(cmd), cmd);
});

test('wrappers that change directory or split a string are honoured', () => {
  assertBlocked(runHook(W('env', '-C', 'data/weight', 'git', 'add', '-f', 'weight-log.md')), 'env -C');
  assertBlocked(runHook(W('sudo', '-D', 'data/weight', 'git', 'add', '-f', 'weight-log.md')), 'sudo -D');
  assertBlocked(runHook(W('env', '-S', `'git add -f ${PERSONAL_FILE}'`)), 'env -S');
});

test('a cd inside a subshell, pipeline or background job does not leak to later commands', () => {
  // from web/, `profile/profile.json` would not match the root-anchored pattern
  assert.ok(isIgnored('profile/profile.json'), 'precondition: ignored at the root');
  assert.equal(isIgnored('web/profile/profile.json'), false, 'precondition: not ignored under web/');
  for (const cmd of [
    W('(', 'cd', 'web', ')', ';', 'git', 'add', '-f', 'profile/profile.json'),
    W('cd', 'web', '|', 'true', ';', 'git', 'add', '-f', 'profile/profile.json'),
    W('cd', 'web', '&', 'git', 'add', '-f', 'profile/profile.json'),
  ]) {
    assertBlocked(runHook(cmd), cmd);
  }
  // and the leaked cwd must not turn a harmless root file into a false block
  assertRealNonIgnored('README.md');
  const ok = W('(', 'cd', 'data/weight', ')', '&&', 'git', 'add', '-f', 'README.md');
  assertAllowed(runHook(ok), ok);
});

test('a cd inside a subshell still applies within it', () => {
  const cmd = W('(', 'cd', 'data/weight', '&&', 'git', 'add', '-f', 'weight-log.md', ')');
  assertBlocked(runHook(cmd), cmd);
});

test('eval and shells fed on stdin are inspected', () => {
  assertBlocked(runHook(W('eval', `'git add -f ${PERSONAL_FILE}'`)), 'eval');
  assertBlocked(runHook(W('echo', `'git add -f ${PERSONAL_FILE}'`, '|', 'bash')), 'stdin bash');
  assertAllowed(runHook(W('echo', 'hi', '|', 'bash')), 'harmless stdin bash');
  assertAllowed(runHook(W('eval', 'echo', 'hi')), 'harmless eval');
});

test('the fallback exception list is anchored, not a generic suffix', () => {
  const env = { ...process.env, PATH: '' };
  assertBlocked(runHook(forceAdd('data/training/notes.test.js'), { env }), 'fallback generic .test.js');
  assertBlocked(runHook(forceAdd('data/weight/my-extract.js'), { env }), 'fallback generic extract.js');
  assertAllowed(runHook(forceAdd('data/apple-health/samples.test.js'), { env }), 'fallback apple-health test');
  assertAllowed(runHook(forceAdd('data/profile/sync-profile.test.js'), { env }), 'fallback sync-profile test');
});
