/* Journal build-time I/O (lib/<area>/read.mjs convention, like lib/health/read.mjs): the only module
 * of lib/journal that reads the extract. Compute stays pure: bake.mjs builds SCORES.journal from
 * parsed rows (journalFrom over lib/extract/read.mjs readExtract inputs); this file reads
 * journal-daily.csv for lib/extract/read.mjs readExtract. */
import fs from 'node:fs';
import path from 'node:path';
import { parseJournalCsv } from './journal.mjs';
import { JOURNAL_FILE } from './bake.mjs';

/** The journal days of the extract ([] when the file is absent or foreign). */
export function readJournal(extractDir) {
  if (!extractDir) return [];
  const p = path.join(extractDir, JOURNAL_FILE);
  if (!fs.existsSync(p)) return [];
  return parseJournalCsv(fs.readFileSync(p, 'utf8'));
}
