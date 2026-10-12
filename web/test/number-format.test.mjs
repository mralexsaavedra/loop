/* Number-format guard (docs/design-system.md → "Numbers"): every user-visible number goes through
 * the ONE formatter, lib/format/numbers.mjs (HC_FMT in the page; HC.num / HC.int / HC.nf / HC.pct /
 * HC.hours / HC.duration wrap it in client/util.js). This test scans the display sources — the
 * classic client scripts, the view helpers, the Astro tabs / components / layout, the i18n
 * templates and the build-time advice copy — with comments stripped, and fails when one builds a
 * number string by hand instead:
 *
 *   1. no Intl number formatting / toLocaleString (ICU builds disagree; the formatter is pure);
 *   2. no hand-rolled thousands grouping (a `\d{3})+` lookahead) — grouping lives in the formatter;
 *   3. no hand-made decimal comma (`.replace('.', …)`);
 *   4. `.toFixed(` only for SVG / CSS geometry (per-file counts below, never shown as text);
 *   5. the one percent rule: no space before "%" in a code string or an i18n template;
 *   6. hours read as h:mm: no "{value} h" template and no `' h'` string built in code (a whole-hour
 *      RANGE and a relative "3 h ago" are not durations of a value — listed below).
 *
 * Every exception is listed with its reason; keep the lists short. A new exception is a design
 * decision: document it in docs/design-system.md first. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE, I18N, SRC } from './display-sources.mjs';

const hits = (files, re) =>
  files.flatMap((f) => SRC[f].split('\n').flatMap((line, i) => (re.test(line) ? [`${f}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])));

// `.toFixed(` that only places SVG / CSS geometry (coordinates, widths, dash arrays) — never text
const GEOMETRY_TOFIXED = {
  'web/src/client/deepdive.js': 15, // stress / energy-bank charts: points, rects, label positions
  'web/src/client/detail-chart.js': 4, // trend chart: svg coordinates, % positions of the labels
  'web/src/client/detail.js': 1, // the chart's selection rect, moved on a day tap
  'web/src/client/energy.js': 2, // the energy-bank line's x / y
  'web/src/client/health.js': 2, // the macro-split bar's rect x / width
  'web/src/client/intake.js': 2, // the ring's stroke-dasharray
  'web/src/client/journal.js': 2, // an insight bar's left / width
  'web/src/client/nutri-score.js': 4, // the sparkline path + its area's two baseline corners
  'web/src/client/score.js': 2, // the sparkline points
  'web/src/client/training-activity.js': 2, // the modality bar's rect x / width
};
// a hand-made decimal comma that is DATA, not display. None left in the display sources: the logged food
// entry's stored name ("Arroz · 1,5 ud", lib/nutrition/foodlog.mjs basicLabel, run as HC_FOODLOG) and the
// plan's portion factor ("×1,25", lib/nutrition/scale.mjs fmtFactor with the plan's own decimal mark, run
// as HC_SCALE) are built by the lib itself, its bytes pinned by BASIC_CASES and the planFor / solveScale
// tests in the lib, the page and the built page. A new entry here is a design decision (see the header).
const DECIMAL_COMMA_DATA = [];
// "{x} h" templates that are not a value's duration: a whole-hour range before a ride ("2–4 h
// before") and the relative age of a sync ("3 h ago")
const HOUR_TEMPLATES_OK = /^\s*(beforeCarbs|beforeCarbsNoKg|hAgo):/;

test('no Intl number formatting or toLocaleString in display code', () => {
  assert.deepEqual(hits([...CODE, ...I18N], /toLocaleString\(|Intl\.NumberFormat/), []);
});

test('no hand-rolled thousands grouping outside the formatter', () => {
  assert.deepEqual(hits(CODE, /\\d\{3\}\)\+/), []);
});

test('no hand-made decimal comma outside the formatter (data labels listed)', () => {
  const found = hits(CODE.filter((f) => !DECIMAL_COMMA_DATA.includes(f)), /\.replace\(\s*['"]\.['"]/);
  // the regex form too: .replace(/\./, ',') / .replace(/\./g, ",")
  assert.deepEqual(hits(CODE, /\.replace\(\s*\/\\\.\/[a-z]*\s*,\s*['"`],/), [], 'regex-form decimal comma');
  assert.deepEqual(found, []);
  for (const f of DECIMAL_COMMA_DATA) assert.equal(hits([f], /\.replace\(\s*['"]\.['"]/).length, 1, `${f}: only the listed one`);
});

test('.toFixed( only for SVG / CSS geometry (per-file counts)', () => {
  const counts = {};
  for (const f of CODE) {
    const n = (SRC[f].match(/\.toFixed\(/g) || []).length;
    if (n) counts[f] = n;
  }
  assert.deepEqual(counts, GEOMETRY_TOFIXED, 'a new toFixed for TEXT goes through HC.num / HC.pct / HC.hours; a new geometry one is listed here');
});

test('one percent rule: no space before "%"', () => {
  assert.deepEqual(hits(CODE, /['"] %|\d %|\} %/), [], 'code strings and template literals (`${v} %`)');
  assert.deepEqual(hits(I18N, /[\d}] %/), [], 'i18n templates');
});

test('hours are h:mm: no "{value} h" templates, no " h" built in code', () => {
  const tpl = I18N.flatMap((f) =>
    SRC[f].split('\n').flatMap((line, i) => (/\{\w+\} h\b/.test(line) && !HOUR_TEMPLATES_OK.test(line) ? [`${f}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])),
  );
  assert.deepEqual(tpl, []);
  assert.deepEqual(hits(CODE, /['"] h['"]/), []);
  assert.deepEqual(hits(CODE, /\$\{[^}]*\} h\b/), [], 'a template literal `${v} h`');
});
