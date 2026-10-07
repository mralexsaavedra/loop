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

// both subsets ship inline: "HC Num" (D-DIN Bold numerals, ~1.5 KB) and "HC Text" (Inter variable,
// Latin + Spanish, ~26 KB). Budgets are on the base64 payload: 40 KB numerals, 48 KB text.
const FONTS = [
  { family: 'HC Num', file: 'hc-num-bold.woff2', budget: 40 * 1024 },
  { family: 'HC Text', file: 'hc-text.woff2', budget: 48 * 1024 },
];

test('the fonts are inlined as base64 woff2 @font-face (no font request, within budget)', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const faces = [...html.matchAll(/@font-face\{[^}]*\}/g)].map((m) => m[0]);
  assert.equal(faces.length, FONTS.length, `exactly ${FONTS.length} @font-face rules`);
  for (const { family, file, budget } of FONTS) {
    const face = faces.find((f) => f.includes(`font-family:"${family}"`));
    assert.ok(face, `an @font-face for "${family}"`);
    const m = face.match(/src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\("woff2"\)/);
    assert.ok(m, `${family}: src must be an inline data: URL, never a fetched file`);
    assert.ok(m[1].length < budget, `${family}: inlined font is ${m[1].length} bytes, budget ${budget / 1024} KB`);
    const woff2 = fs.readFileSync(path.join(WEB_ROOT, 'src', 'fonts', file));
    assert.equal(Buffer.from(m[1], 'base64').equals(woff2), true, `${family}: the committed subset is what gets inlined`);
  }
});

// the @font-face rules are pinned here, not in fixtures/css-expected.json: its declaration map keys
// rules by selector, so it cannot hold two @font-face blocks
test('the numerals font face keeps its glyph-exact unicode-range', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const face = [...html.matchAll(/@font-face\{[^}]*\}/g)].map((m) => m[0]).find((f) => f.includes('"HC Num"'));
  assert.ok(face.includes('unicode-range:U+20,U+25,U+2B-2E,U+30-39,U+68,U+D7'), 'HC Num unicode-range');
  assert.match(face, /font-weight:100 900/);
  assert.match(face, /font-display:swap/);
});

test('the text font face declares exactly the subset\'s unicode-range', async () => {
  const { unicodeRange } = await import('../src/fonts/text-font-ranges.mjs');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const face = [...html.matchAll(/@font-face\{[^}]*\}/g)].map((m) => m[0]).find((f) => f.includes('"HC Text"'));
  assert.ok(face && face.includes(`unicode-range:${unicodeRange()}`), 'unicode-range = text-font-ranges.mjs');
  assert.match(face, /font-weight:400 800/);
  assert.match(face, /font-display:swap/);
});
