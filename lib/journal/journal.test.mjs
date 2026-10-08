/* The journal reference (lib/journal/journal.mjs) and its LITERAL copy in the ingest service
 * (services/health-ingest/src/journal-calc.js, built from its own directory) must stay equal. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as J from './journal.mjs';
import * as S from '../../services/health-ingest/src/journal-calc.js';

test('the service copy of the behaviours, groups and limits equals the reference', () => {
  assert.deepEqual(S.JOURNAL_GROUPS, J.JOURNAL_GROUPS);
  assert.deepEqual(S.JOURNAL_BEHAVIORS, J.JOURNAL_BEHAVIORS);
  assert.deepEqual(S.JOURNAL_LIMITS, J.JOURNAL_LIMITS);
});

test('the owner-approved behaviours: nine, unique keys, one count (alcohol), every group used', () => {
  const keys = J.JOURNAL_BEHAVIORS.map((b) => b.key);
  assert.equal(keys.length, 9);
  assert.equal(new Set(keys).size, 9);
  assert.deepEqual(J.JOURNAL_BEHAVIORS.filter((b) => b.kind === 'count').map((b) => b.key), ['alcohol']);
  for (const b of J.JOURNAL_BEHAVIORS) assert.ok(J.JOURNAL_GROUPS.includes(b.group), b.key);
  for (const g of J.JOURNAL_GROUPS) assert.ok(J.JOURNAL_BEHAVIORS.some((b) => b.group === g), g);
});

test('didBehavior / isJournaled: yes/no booleans, a count > 0 is yes, anything else unanswered', () => {
  assert.equal(J.didBehavior({ nap: true }, 'nap'), true);
  assert.equal(J.didBehavior({ nap: false }, 'nap'), false);
  assert.equal(J.didBehavior({ alcohol: 0 }, 'alcohol'), false);
  assert.equal(J.didBehavior({ alcohol: 2 }, 'alcohol'), true);
  assert.equal(J.didBehavior({ alcohol: true }, 'alcohol'), null);
  assert.equal(J.didBehavior({ nap: 1 }, 'nap'), null);
  assert.equal(J.didBehavior({}, 'nap'), null);
  assert.equal(J.didBehavior({ coffee: true }, 'coffee'), null);
  assert.equal(J.isJournaled({ answers: { alcohol: 0 } }), true);
  assert.equal(J.isJournaled({ answers: {} }), false);
  assert.equal(J.isJournaled(null), false);
});
