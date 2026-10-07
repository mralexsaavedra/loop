/* WCAG contrast of the colour tokens (web/src/styles/tokens.css).
 *
 * Every text token must reach AA for small text (>= 4.5:1) on the card (--surface) and the page
 * (--ground). The tokens.css header lists the ratio of each pair; this test recomputes them so the
 * header can never drift from the values. A token in LARGE_ONLY is kept at its reference value for
 * large numbers / graphics (AA large / non-text: >= 3:1) and has an -ink variant for small text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tokensCss = fs.readFileSync(path.join(here, '..', 'src', 'styles', 'tokens.css'), 'utf8');
const token = (name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(tokensCss);
  assert.ok(m, `--${name} must be a #rrggbb colour`);
  return m[1];
};

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const TEXT = ['ink', 'muted', 'faint', 'good', 'mid', 'low-ink', 'trend', 'strain', 'sleep', 'up', 'down', 'link', 'accent'];
const LARGE_ONLY = ['low'];

test('every text token reaches AA (4.5:1) on --surface and --ground', () => {
  for (const bg of ['surface', 'ground']) {
    for (const fg of TEXT) {
      const r = ratio(token(fg), token(bg));
      assert.ok(r >= 4.5, `--${fg} on --${bg} is ${r.toFixed(2)}:1, AA needs 4.5:1`);
    }
  }
});

test('large-only tokens reach AA large / non-text (3:1) on --surface and --ground', () => {
  for (const bg of ['surface', 'ground']) {
    for (const fg of LARGE_ONLY) {
      const r = ratio(token(fg), token(bg));
      assert.ok(r >= 3, `--${fg} on --${bg} is ${r.toFixed(2)}:1, needs 3:1`);
    }
  }
});

test('filled-button ink reaches AA on its fill', () => {
  assert.ok(ratio(token('on-accent'), token('accent')) >= 4.5, '--on-accent on --accent');
  assert.ok(ratio(token('on-strain'), token('strain')) >= 4.5, '--on-strain on --strain');
});

test('the tokens.css header lists the real ratio of every token on --surface', () => {
  const head = /\/\*[\s\S]*?\*\//.exec(tokensCss)[0];
  for (const fg of [...TEXT, ...LARGE_ONLY]) {
    const m = new RegExp(`(?:^|[\\s·*])${fg} (\\d+\\.\\d\\d)(?=[\\s·;(])`).exec(head);
    assert.ok(m, `header must list "${fg} <ratio>"`);
    assert.equal(m[1], ratio(token(fg), token('surface')).toFixed(2), `header ratio for --${fg}`);
  }
});
