/* lib/journal/read.mjs: readJournal (and journalFrom over readExtract) on temp extracts and the synthetic demo extract. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJournal } from './read.mjs';
import { JOURNAL_FILE, journalFrom, journalFromInputs, RECENT_DAYS } from './bake.mjs';
import { readExtract } from '../extract/read.mjs';
import { JOURNAL_BEHAVIORS } from './journal.mjs';
import { readSeries, readSleep } from '../health/read.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DEMO = path.join(ROOT, 'data', 'demo', 'extract');

test('no journal file: the behaviour list only, no recent days, no insights', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-bake-'));
  try {
    for (const d of [null, dir]) {
      assert.deepEqual(readJournal(d), []);
      const b = journalFrom(readExtract(d));
      assert.equal(b.behaviors.length, JOURNAL_BEHAVIORS.length);
      assert.deepEqual(b.recent, []);
      assert.equal(b.insights, null);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readJournal parses journal-daily.csv of the extract', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-read-'));
  try {
    fs.writeFileSync(path.join(dir, JOURNAL_FILE), 'date,nap,notes\n2030-01-01,1,\nbad,1,\n');
    const rows = readJournal(dir);
    assert.deepEqual(rows.map((r) => r.date), ['2030-01-01']);
    assert.equal(journalFrom(readExtract(dir)).recent[0], '2030-01-01');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('demo extract: recent journaled dates and insights over the last 90 days (synthetic data)', () => {
  const b = journalFrom(readExtract(DEMO));
  assert.ok(b.recent.length > 0 && b.recent.length <= RECENT_DAYS);
  assert.equal(b.insights.asOf, b.recent[b.recent.length - 1]);
  assert.equal(b.insights.rows.length, JOURNAL_BEHAVIORS.length);
  assert.ok(b.insights.rows.some((r) => r.status === 'ok'));
  for (const r of b.insights.rows.filter((x) => x.status === 'ok')) assert.ok(r.yesDays >= 5 && r.noDays >= 5, r.key);
  assert.ok(JSON.stringify(b).length < 4000, 'a small bake');
  // journalFrom maps the readExtract inputs onto the pure bake
  assert.deepEqual(b, journalFromInputs({
    journal: readJournal(DEMO), hrv: readSeries(DEMO, 'hrv.csv'), rhr: readSeries(DEMO, 'rhr.csv'), sleep: readSleep(DEMO),
  }));
});
