/* Drift test for the three coach subagents (.claude/agents/*-coach.md).
 *
 * The span from "## Shared rules" up to (not including) "## Knowledge source" — the shared rules
 * and the "User facts" table — must stay byte-identical in every coach, so an edit made in one
 * agent and forgotten in the others fails `npm test` (docs/knowledge-base.md). Also pins the
 * deliberate `model: inherit` frontmatter (coaches run on the session model for citation fidelity).
 *
 * The coaches are generic templates: every user-specific fact (named experts / creators, gear,
 * program, jurisdiction) lives in the gitignored `profile/coaches.md`, built from the tracked
 * `profile/coaches.example.md`. The last tests pin that split.
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
const AGENTS = path.join(__dirname, '..', 'agents');
const COACHES = ['cycling-coach.md', 'hybrid-coach.md', 'nutrition-coach.md'];
const START = '## Shared rules (identical in every coach subagent)\n';
const END = '\n## Knowledge source\n';

function read(name) {
  return fs.readFileSync(path.join(AGENTS, name), 'utf8');
}

function sharedSpan(text, name) {
  const start = text.indexOf(START);
  assert.notEqual(start, -1, `${name}: missing "${START.trim()}" heading`);
  assert.equal(text.indexOf(START, start + 1), -1, `${name}: "${START.trim()}" appears twice`);
  const end = text.indexOf(END, start);
  assert.notEqual(end, -1, `${name}: missing "${END.trim()}" heading after the shared rules`);
  return text.slice(start, end);
}

test('the shared rules + user facts span is byte-identical across the three coaches', () => {
  const spans = COACHES.map((name) => [name, sharedSpan(read(name), name)]);
  const [refName, ref] = spans[0];
  assert.ok(ref.includes('## User facts'), `${refName}: the span must include the User facts table`);
  assert.ok(ref.includes('`profile/coaches.md`'), `${refName}: the span must point at the per-user coach config`);
  for (const [name, span] of spans.slice(1)) {
    assert.equal(span, ref, `${name} drifted from ${refName}: edit the shared block in all three coaches`);
  }
});

test('every coach runs on the session model (model: inherit) and stays read-only', () => {
  for (const name of COACHES) {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(read(name));
    assert.ok(m, `${name}: missing frontmatter`);
    const lines = m[1].split('\n');
    assert.ok(lines.includes('model: inherit'), `${name}: frontmatter must declare model: inherit`);
    assert.ok(lines.includes('tools: Read, Grep, Glob'), `${name}: tools must stay Read, Grep, Glob`);
  }
});

// Owner-specific tokens that must live only in the gitignored profile/coaches.md: named experts and
// creators, their channels, the owner's gear and his private program sync.
const OWNER_TOKENS = [
  /talavera/i, /edutalfer/i, /\bEdu\b/, /ferrandis/i, /\bSecond\b/, /aoiz/i, /nutrics/i,
  /hyp\(?r\)?odcast/i, /\bferry/i, /training[ -]culture/i, /edge 540/i, /edge-540/i, /sem[ -]42/i,
  /vitalcontrol/i, /hyprogram/i,
];
const GENERIC_FILES = [
  ...COACHES.map((name) => path.join('.claude', 'agents', name)),
  'docs/knowledge-base.md',
  'knowledge/README.md',
];

test('the coach agents and their docs carry no owner-specific sources, gear or program', () => {
  for (const rel of GENERIC_FILES) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const re of OWNER_TOKENS) {
      const m = re.exec(text);
      assert.equal(m, null, `${rel}: owner-specific token ${re} found ("${m && m[0]}") — move it to profile/coaches.md`);
    }
  }
});

test('every coach reads the per-user config first and degrades without it', () => {
  for (const name of COACHES) {
    const text = read(name);
    assert.match(text, /profile\/coaches\.md/, `${name}: must read profile/coaches.md`);
    assert.doesNotMatch(text, /\b(owner|his)\b/i, `${name}: say "the user", not "the owner" / "his"`);
  }
});

test('profile/coaches.example.md is tracked and profile/coaches.md is gitignored', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'profile/coaches.example.md')), 'profile/coaches.example.md missing');
  const tracked = execFileSync('git', ['ls-files', 'profile/coaches.example.md'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(tracked.trim(), 'profile/coaches.example.md', 'profile/coaches.example.md must be tracked');
  // check-ignore exits 0 when the path is ignored, 1 when it is not (execFileSync throws on 1).
  assert.doesNotThrow(
    () => execFileSync('git', ['check-ignore', '-q', '--no-index', 'profile/coaches.md'], { cwd: ROOT }),
    'profile/coaches.md must be gitignored',
  );
  const example = fs.readFileSync(path.join(ROOT, 'profile/coaches.example.md'), 'utf8');
  for (const coach of ['cycling-coach', 'hybrid-coach', 'nutrition-coach']) {
    assert.ok(example.includes(`## ${coach}`), `profile/coaches.example.md: missing the "## ${coach}" section`);
  }
});
