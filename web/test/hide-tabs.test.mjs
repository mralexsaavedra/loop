/* Integration check for plan-data.json's `page.hideTabs[]` (astro-plan-web
 * slice 5) — see lib/nav/tabs.mjs for the unit-tested pure logic. This test
 * exercises the REAL owner data end-to-end: the personal plan-data.json
 * now carries `hideTabs: ["hoy"]` to mirror the owner's live personal page,
 * which has its `t-hoy` nav <button> hand-commented-out (see CLAUDE.md's
 * "Hoy tab is optional and source-agnostic" + the golden fixture at
 * web/test/.golden/personal/plan-web.html). The example build must NOT
 * hide it — CLAUDE.md: "Keep the tab in the public plan-web.template.html
 * seed as a working example — never hide it there."
 *
 * Skips gracefully when the personal fixture is absent (fresh clone / CI
 * without the owner's data), same pattern as web/test/leak.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const personalPath = path.join(WEB_ROOT, 'dist', 'personal', 'index.html');
const examplePath = path.join(WEB_ROOT, 'dist', 'example', 'index.html');

test('personal build (hideTabs: ["hoy"]) omits the t-hoy nav button but keeps the #train-today panel + script intact', { skip: !fs.existsSync(personalPath) && 'personal fixture not built' }, () => {
  const html = fs.readFileSync(personalPath, 'utf8');
  assert.doesNotMatch(html, /id="t-hoy"/, 'the Hoy nav button must be omitted, matching the owner\'s hand-commented legacy button');
  assert.match(html, /id="t-dash"/, 'other nav buttons (e.g. Entrenos) must NOT be affected');
  assert.match(html, /id="train-today"/, 'the Hoy tab-panel itself must still render — hideTabs only removes the nav button');
  assert.match(html, /var TRAINING = /, 'the baked TRAINING global must still be present — the panel stays fully wired, just unreachable via nav');
});

test('example build does not hide any tab — Hoy stays a working example per CLAUDE.md', () => {
  assert.ok(fs.existsSync(examplePath), `missing ${examplePath} — run npm run pretest first`);
  const html = fs.readFileSync(examplePath, 'utf8');
  assert.match(html, /id="t-hoy"/);
  assert.match(html, /id="t-dash"/);
});
