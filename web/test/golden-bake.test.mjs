/* Golden guard: every build-time bake (web/src/bakes.mjs computeBakes, the exact function
 * web/pages/index.astro calls) for the example env, an empty extract dir and no extract dir (null), under a fixed clock,
 * must equal the committed canonical fixtures. A deliberate change: `npm run golden:bake -- --update`
 * and review the fixture diff. Helpers + determinism notes: scripts/golden-bake.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FIXTURES, TRACKED, trackedGoldens, diffPaths, formatDiff, canonical } from '../../scripts/golden-bake.mjs';

const actual = trackedGoldens();

for (const kind of TRACKED) {
  test(`bake golden (${kind}) matches web/test/fixtures/bake-golden.${kind}.json`, () => {
    assert.ok(fs.existsSync(FIXTURES[kind]), `missing ${FIXTURES[kind]} — run: npm run golden:bake -- --update`);
    const expected = JSON.parse(fs.readFileSync(FIXTURES[kind], 'utf8'));
    const diffs = diffPaths(expected, actual[kind]);
    assert.equal(diffs.length, 0, formatDiff(kind, diffs) + '\nIf intended: npm run golden:bake -- --update');
  });
}

test('the golden covers every bake the page destructures', () => {
  for (const kind of TRACKED) {
    assert.deepEqual(Object.keys(actual[kind]), ['activity', 'dash', 'detail', 'health', 'intake', 'nut', 'profile', 'scores']);
  }
});

test('the tracked fixtures are synthetic: no avatar photo in any env', () => {
  assert.equal(actual.example.profile.photo ?? null, null);
  assert.equal(actual.empty.profile.photo ?? null, null);
  assert.equal(actual.null.profile.photo ?? null, null);
});

test('diffPaths reports changed, added and removed paths; canonical sorts keys', () => {
  const d = diffPaths({ a: 1, b: [1, 2], c: 3 }, { a: 2, b: [1], d: 4 });
  assert.deepEqual(d.map((x) => `${x.kind} ${x.path}`), ['changed $.a', 'removed $.b[1]', 'removed $.c', 'added $.d']);
  assert.deepEqual(Object.keys(canonical({ z: 1, a: { y: 1, b: 2 } })), ['a', 'z']);
  assert.ok(!formatDiff('p', d, { values: false }).includes('->'), 'values hidden in personal mode');
});
