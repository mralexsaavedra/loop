/* The ONLY place that runs the Astro binary (scripts/astro-build.test.mjs enforces it). Astro keeps its prerender
 * chunks in one shared <repo>/.astro/.prerender whatever --outDir says, so two builds at the same time (the parallel
 * test suite, two refreshes) delete each other's chunks (ERR_MODULE_NOT_FOUND). Every build runs under one lock,
 * `.astro/build.lock`: a build takes seconds to a few minutes; a holder silent for 10 minutes is a crashed run and is
 * taken over. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withLock } from '../../data/apple-health/sync-common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ASTRO_BIN = path.join(ROOT, 'node_modules', '.bin', 'astro');
export const BUILD_LOCK = path.join(ROOT, '.astro', 'build.lock');
const LOCK_OPTS = { staleMs: 10 * 60 * 1000, retryDelayMs: 200, retries: 3000 };

/**
 * `astro build --root <root> --outDir <outDir>` under the build lock: spawnSync's result ({status, stdout, stderr, …}).
 * @param {{ root: string, outDir: string, env?: NodeJS.ProcessEnv, stdio?: import('node:child_process').StdioOptions }} opts
 */
export function astroBuild({ root, outDir, env = process.env, stdio }) {
  fs.mkdirSync(path.dirname(BUILD_LOCK), { recursive: true });
  return withLock(BUILD_LOCK, () => spawnSync(ASTRO_BIN, ['build', '--root', root, '--outDir', outDir], {
    env, encoding: 'utf8', ...(stdio ? { stdio } : {}),
  }), LOCK_OPTS);
}
