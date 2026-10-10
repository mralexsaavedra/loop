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
const crypto = require('node:crypto');

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

// User-specific tokens that must live only in the gitignored profile/coaches.md (named experts and
// creators, their channels, personal gear and a private program sync). Stored as SHA-256 hashes of the
// lowercased token so this public test never names anyone. A token is one word or two adjacent words
// joined by one space, after splitting the text on anything that is not a letter or digit. To add one:
//   node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1].toLowerCase()).digest('hex'))" 'some token'
const PERSONAL_TOKEN_HASHES = new Set([
  '76e235e629bf38efd3e544139d9ce4fc522044db046302b1c9313895e320becf',
  'e813cdbca3bbc8c4df9cd02973d03fe9e1563674e565237c6cff1306733600c7',
  'e613bb442bf089c035920266fa19f94a0972c896f212eda804d265c3b3f0e3f9',
  'a7c7b7c49a65a9a6242dc40a197668ba35c042e48ac1cc740a7b7421236fc297',
  '5f3d6952c5c5e22077fabf461de80f1ce475752fe75afcf5ca46bac438405619',
  '38458b2aa5e3bc9e6058ad375e1a2be3290a7f8c030c08d16a2132b6ab26a3bd',
  'd24c54b6dd182bf9965259b5385802ddb141025164cd989f5452241345f63d8c',
  'b3c2bf2ffc0bce0887ca5ff226381d0f7daec2615684a1941861f15935f0790a',
  '4919afa90a5e09c5aaf84221261362342bd2313030f684fc6dc8c12682a58d71',
  'e9087d0b20d80d3e12bc8530d883d7ad9c1eb3ebc5cb61824a2b460816503797',
  '2b242a81def4ea52fd58ceec89e4acb0f7c34a1bbde539d5a8703754467b0fa6',
  '78ce8f34d2f17b204f20009a50e32174b10f86d21ac684149241178c4a839bc1',
  'aefec2dc05f5565f6a466b4b85efbff8c64504f2ea28cae2e47c8059b323789d',
  'e2aafc3b56f58bad439412e0ba36d0563a21161007291935625880e2e4324b49',
  '04ea8facf6457ccd118dbbbf624c06886a096f2526e5a82faa11dcec6b74ad91',
  '7d0578809d0b1f4814e35ec6cfa00f91618d07f66b788347a27a9e7adf720b62',
  '06556416a0cc370c80fa7553a48afc5b9e934c28e581cc5ebf0113ceac6657b2',
  '5f5f096fd0b165744f0d0283e17290f1e2792860e30cf314db3b70d593a33661',
]);
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
/** The tokens of `text` (words and adjacent-word pairs, lowercased) whose hash is in `hashes`. */
function personalHits(text, hashes = PERSONAL_TOKEN_HASHES) {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const hits = new Set();
  words.forEach((w, i) => {
    for (const t of [w, i + 1 < words.length ? w + ' ' + words[i + 1] : null]) {
      if (t && hashes.has(sha256(t))) hits.add(t);
    }
  });
  return [...hits];
}
const GENERIC_FILES = [
  ...COACHES.map((name) => path.join('.claude', 'agents', name)),
  'docs/knowledge-base.md',
  'knowledge/README.md',
];

test('the coach agents and their docs carry no user-specific sources, gear or program', () => {
  for (const rel of GENERIC_FILES) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.deepEqual(personalHits(text), [], `${rel}: a user-specific token was found — move it to profile/coaches.md`);
  }
});

test('the hashed token guard matches whole words and adjacent pairs, case-insensitively', () => {
  const demo = new Set([sha256('zone 2'), sha256('ftp')]);
  assert.deepEqual(personalHits('Ride in ZONE-2, then test your FTP.', demo), ['zone 2', 'ftp']);
  assert.deepEqual(personalHits('zones 2 and ftps', demo), [], 'whole tokens only, no prefixes');
  assert.ok([...PERSONAL_TOKEN_HASHES].every((h) => /^[0-9a-f]{64}$/.test(h)), 'every entry is a SHA-256 hex digest');
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
