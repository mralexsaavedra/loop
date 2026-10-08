/* Unit tests for web/test/html-scan.mjs's scanHtml() — the pure regex scan
 * the build-output guard (output-guard.test.mjs) relies on to catch a
 * regression: an external script/stylesheet, a module-typed script, or a
 * missing charset meta slipping into the single-file build. Characterizes
 * the EXISTING scanner (already exercised indirectly by output-guard.test.mjs
 * against a real build); this file proves it directly, on synthetic HTML,
 * including the NEGATIVE case output-guard.test.mjs alone doesn't cover:
 * that the scanner actually FLAGS a regression, not just "always passes on
 * a good build".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanHtml } from './html-scan.mjs';

const GOOD_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<style>body{color:#000}</style>',
  '</head>',
  '<body>',
  '<script>console.log("inline");</script>',
  '</body>',
  '</html>',
].join('\n');

test('scanHtml reports zero violations on a clean, fully-inlined document', () => {
  const scan = scanHtml(GOOD_HTML);
  assert.equal(scan.hasDoctype, true);
  assert.equal(scan.hasCharsetMeta, true);
  assert.equal(scan.hasViewportMeta, true);
  assert.deepEqual(scan.externalScriptSrcs, []);
  assert.equal(scan.moduleScriptCount, 0);
  assert.deepEqual(scan.externalLinkHrefs, []);
  assert.equal(scan.hasAstroAssetsDir, false);
  assert.equal(scan.hasAstroCidAttr, false);
});

test('scanHtml FLAGS an injected <script type="module"> — regression guard has real discriminating power', () => {
  const html = GOOD_HTML.replace('<script>console.log("inline");</script>', '<script type="module">console.log("bad");</script>');
  const scan = scanHtml(html);
  assert.equal(scan.moduleScriptCount, 1, 'must count the module-typed script');
});

test('scanHtml FLAGS an injected external <script src="...">', () => {
  const html = GOOD_HTML.replace('</body>', '<script src="https://evil.example/x.js"></script></body>');
  const scan = scanHtml(html);
  assert.deepEqual(scan.externalScriptSrcs, ['https://evil.example/x.js']);
});

test('scanHtml FLAGS an injected external stylesheet <link href="...">', () => {
  const html = GOOD_HTML.replace('</head>', '<link rel="stylesheet" href="https://evil.example/x.css"></head>');
  const scan = scanHtml(html);
  assert.deepEqual(scan.externalLinkHrefs, ['https://evil.example/x.css']);
});

test('scanHtml FLAGS a missing <meta charset> (removed regression)', () => {
  const html = GOOD_HTML.replace('<meta charset="utf-8">\n', '');
  const scan = scanHtml(html);
  assert.equal(scan.hasCharsetMeta, false);
});

test('scanHtml FLAGS a missing <!DOCTYPE html> (quirks-mode regression)', () => {
  const html = GOOD_HTML.replace('<!DOCTYPE html>\n', '');
  const scan = scanHtml(html);
  assert.equal(scan.hasDoctype, false);
});

test('scanHtml FLAGS a reintroduced /_astro/ asset reference', () => {
  const html = GOOD_HTML.replace('</body>', '<img src="/_astro/logo.abc123.png"></body>');
  const scan = scanHtml(html);
  assert.equal(scan.hasAstroAssetsDir, true);
});

test('scanHtml FLAGS a reintroduced scoped-style artifact (data-astro-cid-*)', () => {
  const html = GOOD_HTML.replace('<body>', '<body><div data-astro-cid-abc123>x</div>');
  const scan = scanHtml(html);
  assert.equal(scan.hasAstroCidAttr, true);
});

test('scanHtml treats an in-page anchor <link href="#..."> as internal, not external', () => {
  const html = GOOD_HTML.replace('</head>', '<link rel="preload" href="#jump-target"></head>');
  const scan = scanHtml(html);
  assert.deepEqual(scan.externalLinkHrefs, [], 'a fragment-only href must not be flagged as external');
});

test('scanHtml treats a data: URI <link> (the inlined favicon / touch icon) as self-contained, not external', () => {
  const html = GOOD_HTML.replace(
    '</head>',
    '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">\n<link rel="apple-touch-icon" href="https://example.com/i.png">\n</head>',
  );
  assert.deepEqual(scanHtml(html).externalLinkHrefs, ['https://example.com/i.png']);
});
