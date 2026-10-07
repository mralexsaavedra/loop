/* Contract test for the project skills (.claude/skills/<name>/SKILL.md).
 *
 * Every project-owned skill (a real directory, not a symlink to a vendored skill) must start with
 * YAML frontmatter carrying a `name` equal to its folder and a one-line `description`, or Claude Code
 * never offers it. The `/setup` skill walks a newcomer through the install, so every repo path it
 * names must exist — or be gitignored, i.e. a personal file the walkthrough itself creates — so a
 * renamed doc or seed fails `npm test` instead of sending the user to a dead path.
 *
 * Lives next to the hook tests because `.claude/hooks/*.test.js` is the `.claude/` glob that
 * `npm test` already runs.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SKILLS = path.join(__dirname, '..', 'skills');

function projectSkills() {
  return fs
    .readdirSync(SKILLS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.isSymbolicLink())
    .map((d) => d.name);
}

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return fields;
}

function isIgnored(rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: ROOT });
    return true; // exit 0 = ignored
  } catch {
    return false;
  }
}

// Repo paths named in backticks: a top-level repo folder, then path characters only (placeholders such
// as `knowledge/<domain>` and globs are skipped by the character class).
const PATH_RE = /`((?:docs|services|scripts|profile|data|knowledge|web|lib|\.claude)\/[\w./-]+|README\.md|CLAUDE\.md|package\.json)`/g;

test('the setup skill exists', () => {
  assert.ok(projectSkills().includes('setup'), '.claude/skills/setup/SKILL.md missing');
});

test('every project skill has frontmatter with its folder name and a one-line description', () => {
  for (const dir of projectSkills()) {
    const text = fs.readFileSync(path.join(SKILLS, dir, 'SKILL.md'), 'utf8');
    const fm = frontmatter(text);
    assert.ok(fm, `${dir}: SKILL.md must start with --- frontmatter ---`);
    assert.equal(fm.name, dir, `${dir}: frontmatter name must equal the folder name`);
    assert.ok(fm.description && fm.description.length >= 40, `${dir}: description missing or too short`);
    assert.match(fm.description, /^Trigger: /, `${dir}: description must start with "Trigger: "`);
  }
});

test('the setup skill triggers on install words in English and Spanish', () => {
  const fm = frontmatter(fs.readFileSync(path.join(SKILLS, 'setup', 'SKILL.md'), 'utf8'));
  for (const word of ['setup', 'install', 'instalar', 'configurar', 'get started', 'first run']) {
    assert.ok(fm.description.includes(word), `setup: description must mention "${word}"`);
  }
});

test('every repo path the setup skill names exists or is a gitignored personal file', () => {
  const text = fs.readFileSync(path.join(SKILLS, 'setup', 'SKILL.md'), 'utf8');
  const paths = [...new Set([...text.matchAll(PATH_RE)].map((m) => m[1].replace(/\/$/, '')))];
  assert.ok(paths.length >= 10, `setup: expected many repo paths, found ${paths.length}`);
  const dead = paths.filter((rel) => !fs.existsSync(path.join(ROOT, rel)) && !isIgnored(rel));
  assert.deepEqual(dead, [], `setup: these paths neither exist nor are gitignored: ${dead.join(', ')}`);
  for (const rel of paths.filter((p) => p.endsWith('.example.md') || p.endsWith('.example.json') || p.endsWith('.env.example'))) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `setup: seed ${rel} must be tracked in the repo`);
  }
});
