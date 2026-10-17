/* The data-root guard: personal data must never land where git could commit it. A data root (HC_DATA_DIR) or files
 * folder (HC_FILES_DIR) INSIDE the clone is accepted only when `git check-ignore` matches it (the default
 * loop-data/ is in .gitignore); anything else is refused before the command writes there. Outside the clone, or in
 * a folder that is not a git work tree (the loop-server image, a zip download), there is nothing to commit: accepted.
 *
 *   dataRootGuardError({ repoRoot, env }) -> null | the one-line reason (the caller prints `ERROR: <reason>`, exit 1)
 *
 * Called by every command that writes the data root: npm run sync (scripts/sync-all.mjs), import:health,
 * migrate:data-root, connect, documents, and the single sync scripts and extract.mjs through
 * runCli({ guardDataRoot: true }) (data/apple-health/sync-common.mjs). docs/data-pipeline.md -> The data root guard. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dataPaths, DATA_DIR_ENV, FILES_DIR_ENV } from '../../lib/paths.mjs';

/** `p` with its longest existing prefix resolved through realpath (a symlink into the clone counts as inside). */
function realish(p) {
  const rest = [];
  let cur = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** The folder relative to the clone ('' = the clone itself), or null when it is outside. */
function insideRel(repoRoot, dir) {
  const rel = path.relative(realish(repoRoot), realish(dir));
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}

/**
 * Why the data root or the files folder of the clone at `repoRoot` for `env` must not be written, or null.
 * `spawn` (tests) runs git.
 * @param {{ repoRoot: string, env?: Record<string, string | undefined>, spawn?: typeof spawnSync }} opts
 */
export function dataRootGuardError({ repoRoot, env = process.env, spawn = spawnSync }) {
  const paths = dataPaths({ repoRoot, env });
  const checks = [[paths.root, DATA_DIR_ENV, 'data root'], [paths.filesDir, FILES_DIR_ENV, 'files folder']];
  for (const [dir, setting, what] of checks) {
    const name = env[setting] && String(env[setting]).trim() ? setting : 'the default';
    const rel = insideRel(repoRoot, dir);
    if (rel === null) continue;
    if (rel === '') return `the ${what} (${name}) is this clone itself: personal data there could be committed; use the default loop-data/ or a folder outside the clone`;
    const relSlash = `${rel.split(path.sep).join('/')}/`;
    const r = spawn('git', ['-C', realish(repoRoot), 'check-ignore', '-q', '--', relSlash], { encoding: 'utf8' });
    // 0 = ignored; 1 = not ignored; anything else (not a git work tree, no git) = nothing could commit it
    if (r.status === 1) {
      return `the ${what} ${relSlash} (${name}) is inside this clone and git does not ignore it: personal data there could be committed. Use the default loop-data/, a folder outside the clone, or one .gitignore already covers (backups/...); nothing written`;
    }
  }
  return null;
}
