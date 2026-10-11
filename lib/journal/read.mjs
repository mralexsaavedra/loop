/* Journal build-time I/O (lib/<area>/read.mjs convention, like lib/health/read.mjs): the only module
 * of lib/journal that reads the extract. Compute stays pure: bake.mjs builds SCORES.journal from
 * parsed rows (journalFromInputs); this file reads journal-daily.csv and, when there are journaled
 * days, the recovery inputs (hrv.csv, rhr.csv, sleep-daily.csv) for the next-morning scores. */
import fs from 'node:fs';
import path from 'node:path';
import { parseJournalCsv, isJournaled } from './journal.mjs';
import { JOURNAL_FILE, journalFromInputs } from './bake.mjs';
import { readSeries, readSleep } from '../health/read.mjs';

/** The journal days of the extract ([] when the file is absent or foreign). */
export function readJournal(extractDir) {
  if (!extractDir) return [];
  const p = path.join(extractDir, JOURNAL_FILE);
  if (!fs.existsSync(p)) return [];
  return parseJournalCsv(fs.readFileSync(p, 'utf8'));
}

/** SCORES.journal for the extract (lib/score/index.mjs); no extract or no journaled day -> the
 * behaviour list only. */
export function journalBake(extractDir) {
  const journal = readJournal(extractDir);
  if (!journal.some(isJournaled)) return journalFromInputs({ journal });
  return journalFromInputs({
    journal, hrv: readSeries(extractDir, 'hrv.csv'), rhr: readSeries(extractDir, 'rhr.csv'), sleep: readSleep(extractDir),
  });
}
