/* slimScript: the build-time pass every inlined client script goes through (web/layouts/Plan.astro).
 * Comments and whitespace go; identifiers, syntax and non-ASCII copy stay exactly as written. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slimScript } from './slim-script.mjs';

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'client');

test('strips comments and whitespace, keeps identifiers and top-level globals', () => {
  const src = '/* header comment */\nvar answerValue = 42; // trailing\nfunction addOne(longName) {\n  // inside\n  return longName + 1;\n}\n';
  const out = slimScript(src);
  assert.doesNotMatch(out, /comment|trailing|inside/);
  assert.match(out, /var answerValue=42;/);
  assert.match(out, /function addOne\(longName\)\{return longName\+1\}/);
  const ctx = {};
  vm.runInNewContext(out, ctx);
  assert.equal(ctx.answerValue, 42);
  assert.equal(ctx.addOne(1), 2, 'top-level declarations stay script globals (no module wrapper)');
});

test('keeps non-ASCII copy literal (no \\u escapes) and syntax unchanged', () => {
  const out = slimScript("var t = 'Añadir · más';\nif (a) { b(); }\n");
  assert.match(out, /'Añadir · más'|"Añadir · más"/);
  assert.match(out, /if\(a\)\{b\(\)\}/, 'minifySyntax off: no rewriting to a&&b()');
});

test('legal comments are dropped too', () => {
  assert.doesNotMatch(slimScript('/*! keep? */\nvar x = 1;\n'), /keep/);
});

test('is deterministic and every client script gets smaller and still parses', () => {
  const files = fs.readdirSync(CLIENT).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'));
  assert.ok(files.length > 10);
  for (const f of files) {
    const src = fs.readFileSync(path.join(CLIENT, f), 'utf8');
    const a = slimScript(src);
    assert.equal(a, slimScript(src), `${f}: not deterministic`);
    assert.ok(a.length < src.length, `${f}: not smaller`);
    assert.doesNotThrow(() => new vm.Script(a), `${f}: output does not parse`);
  }
});
