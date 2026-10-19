/* lib/journal/bake.mjs: the SCORES.journal bake over parsed journal rows (pure; the extract reader is
 * lib/journal/read.mjs). SYNTHETIC values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { journalFromInputs, journalFrom, morningRecovery, RECENT_DAYS, INSIGHT_DAYS } from './bake.mjs';
import { JOURNAL_BEHAVIORS, parseJournalCsv } from './journal.mjs';
import { recoveryFromInputs } from '../score/recovery.mjs';
import { readSeries, readSleep } from '../health/read.mjs';
import { addDays } from '../date.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DEMO = path.join(ROOT, 'data', 'demo', 'extract');

test('journalFromInputs: no journaled day -> the behaviour list only, no recent days, no insights', () => {
  const blank = parseJournalCsv('date,nap,notes\n2030-01-01,,just a note\n');
  for (const inputs of [undefined, {}, { journal: [] }, { journal: blank }]) {
    const b = journalFromInputs(inputs);
    assert.equal(b.behaviors.length, JOURNAL_BEHAVIORS.length - 1, 'no profile sex: everything but the period question');
    assert.deepEqual(b.recent, []);
    assert.equal(b.insights, null);
  }
});

test('journalFromInputs: recent = the last RECENT_DAYS journaled dates, insights over INSIGHT_DAYS; no recovery -> need_data', () => {
  const start = '2030-01-01';
  const lines = ['date,nap,notes'];
  for (let i = 0; i < 100; i++) lines.push(`${addDays(start, i)},${i % 2},`);
  // a day with no answer is not journaled: neither recent nor insights count it
  lines.push(`${addDays(start, 100)},,`);
  const b = journalFromInputs({ journal: parseJournalCsv(lines.join('\n') + '\n') });
  const asOf = addDays(start, 99);
  assert.equal(b.recent.length, RECENT_DAYS);
  assert.equal(b.recent[b.recent.length - 1], asOf);
  assert.deepEqual(b.insights && [b.insights.asOf, b.insights.from, b.insights.days],
    [asOf, addDays(asOf, -(INSIGHT_DAYS - 1)), INSIGHT_DAYS]);
  assert.equal(b.insights.rows.length, JOURNAL_BEHAVIORS.length - 1, 'one row per question of this profile (no sex: no period)');
  assert.ok(b.insights.rows.every((r) => r.status === 'need_data'), 'no hrv / rhr / sleep -> no next-morning scores');
});

test('morningRecovery = the recovery dial\'s percentile of that morning, with the inputs cut at it', () => {
  const inputs = { hrv: readSeries(DEMO, 'hrv.csv'), rhr: readSeries(DEMO, 'rhr.csv'), sleep: readSleep(DEMO) };
  const dial = (t) => {
    const cut = (rows) => rows.filter((r) => r.date <= t);
    return recoveryFromInputs({ hrv: cut(inputs.hrv), rhr: cut(inputs.rhr), sleep: cut(inputs.sleep) }).today;
  };
  // 2026-09-20 was not a complete night (the dial fell back to the 19th): no score for that morning
  assert.equal(dial('2026-09-20').date, '2026-09-19');
  const want = dial('2026-09-19');
  assert.equal(want.date, '2026-09-19');
  const got = morningRecovery(inputs, ['2026-09-19', '2026-09-20', '2026-05-01']);
  assert.deepEqual(got, { '2026-09-19': want.pct }, 'a fallback night or a morning before the data has no score');
});

test('journalFrom: no journaled day -> the behaviour list only, the recovery series are not used', () => {
  const series = { hrv: [{ date: '2030-01-01', value: 60 }], rhr: [{ date: '2030-01-01', value: 50 }] };
  const sleep = [{ date: '2030-01-01', value: 7 }];
  assert.deepEqual(journalFrom({ journal: [], series, sleep }), journalFromInputs({ journal: [] }));
  assert.deepEqual(journalFrom({ journal: [], series: { hrv: null, rhr: null }, sleep: null }), journalFromInputs({ journal: [] }));
  assert.deepEqual(journalFrom({}), journalFromInputs({}));
});


test('journalFromInputs: the behaviour list and the insight rows follow the profile sex (period only for female)', () => {
  const journal = parseJournalCsv('date,nap,period,notes\n2030-01-01,1,1,\n');
  const f = journalFromInputs({ journal, sex: 'female' });
  const m = journalFromInputs({ journal, sex: 'male' });
  assert.ok(f.behaviors.some((b) => b.key === 'period') && f.insights.rows.some((r) => r.key === 'period'));
  assert.ok(!m.behaviors.some((b) => b.key === 'period') && !m.insights.rows.some((r) => r.key === 'period'));
  assert.equal(journalFromInputs({ journal }).behaviors.length, JOURNAL_BEHAVIORS.length - 1, 'unknown sex: no period');
});
