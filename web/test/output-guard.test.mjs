/* Build-output guard — spec: plan-web-single-file-build.
 *
 * GIVEN a configured Astro project (output: 'static', zero islands,
 * is:inline scripts, build.inlineStylesheets: 'always')
 * WHEN `npm run build` (here: `npm run build:example`, run by
 * web/test/build-fixtures.mjs via the `pretest` npm hook) runs
 * THEN the output HTML has no external src/href and no _astro/ directory,
 * every <script> omits type="module", and <head> has <meta charset="utf-8">.
 *
 * Run `npm run pretest` before this file (or just `npm test`, which runs
 * pretest automatically via the npm lifecycle hook) — it reads an
 * already-built fixture, it does not build one itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanHtml } from './html-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const distDir = path.join(WEB_ROOT, '.test-dist', 'en-example');
const htmlPath = path.join(distDir, 'index.html');

test('example build is a single self-contained file with no external references', () => {
  assert.ok(
    fs.existsSync(htmlPath),
    `missing build output at ${htmlPath} — run \`npm run pretest\` (or \`npm run build:example\`) first`,
  );
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scan = scanHtml(html);

  assert.equal(scan.hasDoctype, true, 'expected <!DOCTYPE html> at the top of the document');
  assert.equal(scan.hasCharsetMeta, true, 'expected <meta charset="utf-8"> in <head>');
  assert.equal(scan.hasViewportMeta, true, 'expected a <meta name="viewport"> tag in <head>');
  assert.deepEqual(scan.externalScriptSrcs, [], 'expected zero external <script src="...">');
  assert.equal(scan.moduleScriptCount, 0, 'expected zero <script type="module">');
  assert.deepEqual(scan.externalLinkHrefs, [], 'expected zero external <link href="..."> (stylesheets must be inlined)');
  assert.equal(scan.hasAstroAssetsDir, false, 'expected no /_astro/ asset directory reference');
  assert.equal(scan.hasAstroCidAttr, false, 'expected no data-astro-cid-* attributes (scoped <style> is banned)');
});

test('no _astro/ output directory sits alongside the built file', () => {
  assert.ok(fs.existsSync(distDir), `missing build output directory ${distDir}`);
  const entries = fs.readdirSync(distDir);
  assert.deepEqual(entries, ['index.html'], `expected only index.html in ${distDir}, found: ${entries.join(', ')}`);
});
