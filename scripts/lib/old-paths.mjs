/* The old-path guard: a document file (profile, plan, training) left at its pre-data-root path while the data
 * root is in use is never read again, so a hand edit there would be silently lost. `npm run sync`
 * (scripts/sync-documents.mjs) and the page build (scripts/build-web.mjs) print this one WARNING;
 * `npm run migrate:data-root` (scripts/migrate-data-root.mjs) moves the files. */
import fs from 'node:fs';
import { dataPaths, displayPath, legacyPaths } from '../../lib/paths.mjs';

const KINDS = ['profile', 'plan', 'training'];

/** One WARNING line naming the old document files that exist, or null when there are none.
 * @param {{ repoRoot: string, env?: Record<string, string | undefined>, exists?: (file: string) => boolean }} opts */
export function oldDocumentsWarning({ repoRoot, env = process.env, exists = fs.existsSync }) {
  const old = legacyPaths({ repoRoot }).documents;
  const now = dataPaths({ repoRoot, env });
  const found = KINDS.filter((k) => old[k] !== now.documents[k] && exists(old[k])).map((k) => displayPath(repoRoot, old[k]));
  if (!found.length) return null;
  return `WARNING: ${found.join(', ')} ${found.length > 1 ? 'are' : 'is'} at the old path${found.length > 1 ? 's' : ''}, but the data root ${displayPath(repoRoot, now.root)} is in use: edits there are ignored; run npm run migrate:data-root`;
}
