/* The journal's page bake (SCORES.journal, lib/score/index.mjs): the behaviour list, groups and limits
 * the sheet renders (lib/journal/journal.mjs, the one reference), so the page never types them.
 * JSON-safe, no build-time "now". docs/journal.md. */
import { JOURNAL_GROUPS, JOURNAL_BEHAVIORS, JOURNAL_LIMITS } from './journal.mjs';

export function journalBake() {
  return { groups: JOURNAL_GROUPS, behaviors: JOURNAL_BEHAVIORS, limits: JOURNAL_LIMITS };
}
