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
const CSS_BUDGET = 90_000;

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
    assert.ok(css.length < CSS_BUDGET, `inline CSS is ${css.length} chars, budget ${CSS_BUDGET}`);
    // The base64 numerals font survives intact.
    assert.match(css, /@font-face\{font-family:"HC Num";src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)/);
  });
}
