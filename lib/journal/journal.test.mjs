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

test('journal CSV: one row per journaled day, 1/0 for yes/no, the count as is, blank = unanswered, notes quoted', () => {
  const days = [
    { date: '2030-01-11', answers: { nap: true }, notes: null },
    { date: '2030-01-10', answers: { alcohol: 2, ill: false }, notes: 'party, "late"' },
  ];
  const text = J.journalCsv(days);
  const lines = text.trim().split('\n');
  assert.equal(lines[0], ['date', ...J.JOURNAL_BEHAVIORS.map((b) => b.key), 'notes'].join(','));
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('2030-01-10,'), 'sorted by date');
  assert.match(lines[1], /,"party, ""late"""$/);
  const back = J.parseJournalCsv(text);
  assert.deepEqual(back, [
    { date: '2030-01-10', answers: { alcohol: 2, ill: false }, notes: 'party, "late"' },
    { date: '2030-01-11', answers: { nap: true }, notes: null },
  ]);
  assert.deepEqual(J.parseJournalCsv('garbage\n1,2'), [], 'a foreign header yields nothing');
  assert.deepEqual(J.parseJournalCsv(''), []);
});

test('behaviorInsights: mean NEXT-morning recovery after yes vs no; each side needs >= 5 days', () => {
  const days = [];
  const rec = {};
  // 10 days: alcohol on the first 5 (recovery next morning 40), none on the last 5 (next morning 70)
  for (let i = 0; i < 10; i++) {
    const date = `2030-01-${String(1 + 3 * i).padStart(2, '0')}`; // every third day: mornings never overlap
    days.push({ date, answers: { alcohol: i < 5 ? 2 : 0, nap: i < 3 } });
    rec[J.nextIso(date)] = i < 5 ? 40 : 70;
    rec[date] = 0; // the SAME day's recovery must not count
  }
  const out = J.behaviorInsights(days, rec);
  const alcohol = out.find((r) => r.key === 'alcohol');
  assert.deepEqual(alcohol, { key: 'alcohol', yesDays: 5, noDays: 5, status: 'ok', yesMean: 40, noMean: 70, diff: -30 });
  const nap = out.find((r) => r.key === 'nap');
  assert.equal(nap.status, 'need_data', 'only 3 nap days');
  assert.equal(nap.yesDays, 3);
  assert.equal(nap.diff, null);
  const ill = out.find((r) => r.key === 'ill');
  assert.deepEqual([ill.yesDays, ill.noDays, ill.status], [0, 0, 'need_data']);
  assert.equal(out.length, J.JOURNAL_BEHAVIORS.length);
});

test('behaviorInsights: a day without a next-morning score is left out of both sides', () => {
  const days = Array.from({ length: 12 }, (_, i) => ({ date: `2030-02-${String(i + 1).padStart(2, '0')}`, answers: { nap: i % 2 === 0 } }));
  const rec = {};
  days.forEach((d, i) => { if (i < 10) rec[J.nextIso(d.date)] = i % 2 === 0 ? 60 : 50; });
  const nap = J.behaviorInsights(days, rec).find((r) => r.key === 'nap');
  assert.deepEqual([nap.yesDays, nap.noDays, nap.diff], [5, 5, 10]);
});

test('journal CSV is read by header NAME: reordered, missing or unknown columns never shift answers', () => {
  // an older / newer file: columns reordered, `nap` missing, a behaviour this version does not know
  const text = 'date,ill,future_habit,alcohol,notes\n2030-01-10,1,1,3,"a, b"\n2030-01-11,,0,0,\n';
  const days = J.parseJournalCsv(text);
  assert.deepEqual(days.map((d) => d.answers), [{ ill: true, alcohol: 3 }, { alcohol: 0 }]);
  assert.equal(days[0].notes, 'a, b');
  assert.deepEqual(days[0].extra, { future_habit: '1' }, 'an unknown column is kept aside, never mapped');
  // written back: the current header first, the unknown column kept, notes last
  const out = J.journalCsv(days).split('\n');
  assert.equal(out[0], ['date', ...J.JOURNAL_BEHAVIORS.map((b) => b.key), 'future_habit', 'notes'].join(','));
  assert.deepEqual(J.parseJournalCsv(J.journalCsv(days)), days, 'round trip');
  assert.deepEqual(J.parseJournalCsv('day,nap\n2030-01-10,1\n'), [], 'no date column: nothing');
  const odd = J.parseJournalCsv('date,__proto__,constructor,nap\n2030-01-10,1,1,1\n')[0];
  assert.deepEqual(odd.answers, { nap: true }, 'prototype-named columns are never behaviours');
  assert.equal(Object.getPrototypeOf(odd.answers), Object.prototype, 'and never touch a prototype');
  assert.equal(J.didBehavior({ constructor: true }, 'constructor'), null);
});
