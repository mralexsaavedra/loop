#!/usr/bin/env node
/* Pretest fixture builder — wired into `npm run pretest` (which `npm test`
 * depends on via the `pretest` npm lifecycle hook). Builds the example-mode
 * page once, up front, so web/test/*.test.mjs can assert against an
 * already-built static file instead of invoking Astro's build pipeline
 * inside every test run.
 *
 * Run: node web/test/build-fixtures.mjs  (normally via `npm run pretest`)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(here)); // web/test -> web -> repo root
const buildScript = path.join(ROOT, 'scripts', 'build-web.mjs');

execFileSync(process.execPath, [buildScript, '--mode', 'example', '--locale', 'en'], {
  stdio: 'inherit',
  cwd: ROOT,
});
