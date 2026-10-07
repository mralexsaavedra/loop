/* Drift test for the three coach subagents (.claude/agents/*-coach.md).
 *
 * The span from "## Shared rules" up to (not including) "## Knowledge source" — the shared rules
 * and the "Owner facts" table — must stay byte-identical in every coach, so an edit made in one
 * agent and forgotten in the others fails `npm test` (docs/knowledge-base.md). Also pins the
 * deliberate `model: inherit` frontmatter (coaches run on the session model for citation fidelity).
 *
 * Lives next to the hook tests because `.claude/hooks/*.test.js` is the `.claude/` glob that
 * `npm test` already runs.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('the shared rules + owner facts span is byte-identical across the three coaches', () => {
  const spans = COACHES.map((name) => [name, sharedSpan(read(name), name)]);
  const [refName, ref] = spans[0];
  assert.ok(ref.includes('## Owner facts'), `${refName}: the span must include the Owner facts table`);
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
