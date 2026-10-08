/* The page's inlined CSS goes through slimStyle (web/src/slim-script.mjs) at build time: no comments,
 * no layout whitespace, and the whole inlined stylesheet stays under a size budget. Reads the pretest
 * fixtures (`npm run pretest`); the personal fixture is checked only when it exists. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(path.dirname(here), '.test-dist');

// Measured 2026-10-07: example ≈ 76 KB of inline CSS after slimming (≈ 108 KB before). Margin for growth.
// The budget counts the stylesheet only: the inlined @font-face fonts (base64) have their own budgets in
// output-guard.test.mjs, so adding the text font (~35 KB of base64) does not eat the CSS margin.
// Re-measured 2026-10-07 after the dial deep-dive pages (hero ring, contributors, insight, weekly bars):
// ≈ 92 KB; budget raised to keep the same ~8 KB margin.
// Re-measured 2026-10-08 before the journal (Q7): 99.9 KB, no margin left; the journal card, sheet and
// insights rows (web/src/styles/journal.css) add ~4 KB, budget raised to keep a ~2 KB margin.
const CSS_BUDGET = 106_000;
const FONT_FACE = /@font-face\{[^}]*\}/g;

function inlineCss(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

for (const fixture of ['en-example', 'es-personal']) {
  const htmlPath = path.join(DIST, fixture, 'index.html');
  test(`${fixture}: inline CSS is slimmed (no comments, no newlines) and within budget`, { skip: fixture === 'es-personal' && !fs.existsSync(htmlPath) }, () => {
    assert.ok(fs.existsSync(htmlPath), `missing build output at ${htmlPath} — run \`npm run pretest\` first`);
    const blocks = inlineCss(fs.readFileSync(htmlPath, 'utf8'));
    assert.ok(blocks.length > 0, 'expected at least one <style> block');
    const css = blocks.join('');
    assert.ok(!css.includes('/*'), 'inline CSS still carries /* comments */');
    assert.ok(!/\n/.test(css), 'inline CSS still carries newlines');
    const sheet = css.replace(FONT_FACE, '');
    assert.ok(sheet.length < CSS_BUDGET, `inline CSS (fonts excluded) is ${sheet.length} chars, budget ${CSS_BUDGET}`);
    // The base64 fonts (numerals + text) survive intact.
    assert.match(css, /@font-face\{font-family:"HC Num";src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)/);
    assert.match(css, /@font-face\{font-family:"HC Text";src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)/);
  });
}
