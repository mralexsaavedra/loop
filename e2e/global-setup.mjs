/* Builds the example page once before the E2E run, in every page language (English and Spanish), into
 * web/.e2e-dist/<locale>-example/ (gitignored): never web/dist/<mode>,
 * the live output, and not web/.test-dist/, which `npm test` rebuilds. E2E_SKIP_BUILD=1 (exactly) reuses the last build
 * while iterating on specs. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { ROOT, PAGE_LOCALES, staticPage } from './paths.mjs';

export default function globalSetup() {
  for (const locale of PAGE_LOCALES) {
    if (process.env.E2E_SKIP_BUILD === '1' && fs.existsSync(staticPage(locale))) continue;
    execFileSync(
      process.execPath,
      ['scripts/build-web.mjs', '--mode', 'example', '--locale', locale, '--outdir', `web/.e2e-dist/${locale}-example`],
      { cwd: ROOT, stdio: 'inherit' },
    );
  }
}
