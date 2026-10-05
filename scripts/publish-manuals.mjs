#!/usr/bin/env node
/* Publishes the device manuals profile/profile.json names (devices[].manual) from data/gear/ into the
 * LAN page's site folder (lib/profile/manuals.mjs has the rules). Called by
 * services/plan-web/refresh.sh as `npm run -s publish:manuals`; a missing / refused file is a warning
 * (exit 0), only an unusable output folder or an unexpected error exits 1.
 *
 *   node scripts/publish-manuals.mjs [--profile <file>] [--gear <dir>] [--out <dir>]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishManuals } from '../lib/profile/manuals.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : def;
};

try {
  const r = publishManuals({
    profileFile: opt('--profile', path.join(ROOT, 'profile', 'profile.json')),
    gearDir: opt('--gear', path.join(ROOT, 'data', 'gear')),
    outDir: opt('--out', path.join(ROOT, 'services', 'plan-web', 'site', 'manuales')),
    warn: (m) => console.error(m),
  });
  if (!r.skipped) {
    console.log(`manuals: ${r.published.length} published, ${r.missing.length} missing, ${r.refused.length} refused, ${r.removed.length} removed`);
  }
} catch (err) {
  console.error(`ERROR: device manuals not published: ${err.message}`);
  process.exit(1);
}
