/* lib/journal/bake.mjs: the SCORES.journal bake over the extract's journal-daily.csv. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { journalBake, morningRecovery, RECENT_DAYS } from './bake.mjs';
import { JOURNAL_BEHAVIORS } from './journal.mjs';
import { recoveryFromInputs } from '../score/recovery.mjs';
import { readSeries, readSleep } from '../health/read.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DEMO = path.join(ROOT, 'data', 'demo', 'extract');

test('no journal file: the behaviour list only, no recent days, no insights', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-bake-'));
  try {
    for (const d of [null, dir]) {
      const b = journalBake(d);
      assert.equal(b.behaviors.length, JOURNAL_BEHAVIORS.length);
      assert.deepEqual(b.recent, []);
      assert.equal(b.insights, null);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

test('demo extract: recent journaled dates and insights over the last 90 days (synthetic data)', () => {
  const b = journalBake(DEMO);
  assert.ok(b.recent.length > 0 && b.recent.length <= RECENT_DAYS);
  assert.equal(b.insights.asOf, b.recent[b.recent.length - 1]);
  assert.equal(b.insights.rows.length, JOURNAL_BEHAVIORS.length);
  assert.ok(b.insights.rows.some((r) => r.status === 'ok'));
  for (const r of b.insights.rows.filter((x) => x.status === 'ok')) assert.ok(r.yesDays >= 5 && r.noDays >= 5, r.key);
  assert.ok(JSON.stringify(b).length < 4000, 'a small bake');
});
