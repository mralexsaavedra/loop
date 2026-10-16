#!/usr/bin/env node
/* Publishes the device manuals profile/profile.json names (devices[].manual) from data/gear/ into the
 * LAN page's site folder (lib/profile/manuals.mjs has the rules). Called by
 * services/loop-web/refresh.sh as `npm run -s publish:manuals -- --out <site>/manuales`; a missing / refused
 * file is a warning (exit 0), only an unusable output folder or an unexpected error exits 1. Strict flags
 * (parseCli): `--help` prints the usage, an unknown flag, a flag without its value or a stray argument exits 2
 * before anything is read or written. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishManuals } from '../lib/profile/manuals.mjs';
import { runCli } from '../data/apple-health/sync-common.mjs';
import { dataPaths } from '../lib/paths.mjs';
import { isMain } from './lib/is-main.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const USAGE = `Usage: node scripts/publish-manuals.mjs [--profile <file>] [--gear <dir>] [--out <dir>]

Copies the device manuals profile.json names from the gear folder into the LAN page's site folder.
  --profile <file>  the profile (default profile/profile.json; cache/profile.json under HC_DATA_DIR)
  --gear <dir>      the manuals' folder (default data/gear; files/manuals under HC_DATA_DIR / HC_FILES_DIR)
  --out <dir>       the published folder (default services/loop-web/site/manuales)
  --help, -h        this text`;

export const OPTIONS = { profile: { type: 'string' }, gear: { type: 'string' }, out: { type: 'string' } };

/** The CLI after its flags are parsed; `publish` is injectable for tests. Returns the exit code.
 * @param {{profile?: string, gear?: string, out?: string}} [values] */
export function main({ profile, gear, out } = {}, { publish = publishManuals, log = console.log, error = console.error, env = process.env } = {}) {
  // an empty value is a missing value, never "the default folder" (it would publish into the real site)
  for (const [k, v] of Object.entries({ profile, gear, out })) {
    if (v !== undefined && !String(v).trim()) { error(`ERROR: --${k} needs a value\n\n${USAGE}`); return 2; }
  }
  try {
    const paths = dataPaths({ repoRoot: ROOT, env });
    const r = publish({
      profileFile: profile ? path.resolve(profile) : paths.documents.profile,
      gearDir: gear ? path.resolve(gear) : paths.manualsDir,
      outDir: out ? path.resolve(out) : path.join(ROOT, 'services', 'loop-web', 'site', 'manuales'),
      warn: (m) => error(m),
    });
    if (!r.skipped) {
      log(`manuals: ${r.published.length} published, ${r.missing.length} missing, ${r.refused.length} refused, ${r.removed.length} removed`);
    }
    return 0;
  } catch (err) {
    error(`ERROR: device manuals not published: ${err.message}`);
    return 1;
  }
}

if (isMain(import.meta.url)) runCli((values) => main(values), { usage: USAGE, options: OPTIONS });
