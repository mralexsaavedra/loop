/* Builds the example page once before the E2E run, into web/.e2e-dist/ (gitignored): never web/dist/<mode>,
 * the live output, and not web/.test-dist/, which `npm test` rebuilds. E2E_SKIP_BUILD=1 (exactly) reuses the last build
 * while iterating on specs. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { STATIC_PAGE, ROOT } from './paths.mjs';

export default function globalSetup() {
  if (process.env.E2E_SKIP_BUILD === '1' && fs.existsSync(STATIC_PAGE)) return;
  execFileSync(
    process.execPath,
    ['scripts/build-web.mjs', '--mode', 'example', '--locale', 'en', '--outdir', 'web/.e2e-dist/en-example'],
    { cwd: ROOT, stdio: 'inherit' },
  );
}
