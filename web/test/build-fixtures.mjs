#!/usr/bin/env node
/* Pretest fixture builder — wired into `npm run pretest` (which `npm test`
 * depends on via the `pretest` npm lifecycle hook). Builds the example-mode
 * page (always) and the personal-mode page (only if the owner's gitignored
 * plan-data.json exists — fresh clones / CI without it just skip), so
 * web/test/*.test.mjs can assert against already-built static files
 * instead of invoking Astro's build pipeline inside every test run. See
 * design's Testing Strategy: "pretest builds fixtures once ...
 * es-personal only if personal inputs exist".
 *
 * Run: node web/test/build-fixtures.mjs  (normally via `npm run pretest`)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(here)); // web/test -> web -> repo root
const buildScript = path.join(ROOT, 'scripts', 'build-web.mjs');

execFileSync(process.execPath, [buildScript, '--mode', 'example', '--locale', 'en'], {
  stdio: 'inherit',
  cwd: ROOT,
});

const personalPlanPath = path.join(ROOT, 'data', 'nutrition', 'plan-data.json');
if (fs.existsSync(personalPlanPath)) {
  execFileSync(process.execPath, [buildScript, '--mode', 'personal', '--locale', 'es'], {
    stdio: 'inherit',
    cwd: ROOT,
  });
} else {
  console.log('build-fixtures: no personal plan-data.json — skipping the personal-mode fixture.');
}
