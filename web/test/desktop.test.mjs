/* Wide-screen layout (>= 900 px, docs/plan-page.md "Wide screens"): pins the desktop rules the page relies
 * on, and that they stay desktop-only — every declaration OUTSIDE @media (min-width: 900px) matches the
 * checked-in snapshot (web/test/fixtures/css-expected.json) exactly, both ways, so a desktop fix can never
 * add, drop or change a phone rule. Reads the pretest fixture (`npm run pretest`). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssRules, ruleDeclarationMap, canonicalSelector } from './css-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(path.dirname(here), '.test-dist', 'en-example', 'index.html');
const FIXTURE = path.join(here, 'fixtures', 'css-expected.json');
const WIDE = '(min-width:900px)';

function builtMap() {
  const html = fs.readFileSync(HTML, 'utf8');
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  return ruleDeclarationMap(parseCssRules(css));
}

// the declarations of one selector inside the wide-screen query
function wide(map, selector) {
  const sel = canonicalSelector(selector);
  const out = {};
  for (const [key, value] of map) {
    const [media, s, prop] = key.split('|||');
    if (media === WIDE && s === sel) out[prop] = value;
  }
  return out;
}

test('phone rules are untouched: every declaration outside the >= 900px query equals the snapshot', () => {
  const built = builtMap();
  const expected = new Map(Object.entries(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).map(([key, value]) => {
    const [media, selector, prop] = key.split('|||');
    return [`${media}|||${canonicalSelector(selector)}|||${prop}`, value];
  }));
  const narrow = (map) => new Map([...map].filter(([key]) => key.split('|||')[0] !== WIDE));
  const b = narrow(built), e = narrow(expected);
  const added = [...b.keys()].filter((k) => !e.has(k));
  const changed = [...e.keys()].filter((k) => b.get(k) !== e.get(k));
  assert.deepEqual(added, [], 'a new phone declaration: put desktop fixes inside @media (min-width: 900px)');
  assert.deepEqual(changed, [], 'a phone declaration was dropped or changed');
});

test('Entreno Activity card: summary | calendar in two columns, the calendar scaled to its column', () => {
  const map = builtMap();
  const card = wide(map, '.act-card');
  assert.equal(card.display, 'grid');
  assert.equal(card['grid-template-columns'], 'minmax(0, 1fr) minmax(240px, 300px)');
  assert.equal(card['grid-template-rows'], 'auto auto auto 1fr', 'a trailing 1fr row takes the calendar\'s extra height');
  const cal = wide(map, '.act-card > .act-cal');
  assert.equal(cal['grid-column'], '2');
  assert.equal(cal['grid-row'], '1 / -1');
  assert.equal(cal['margin-top'], '0', 'no stacked-card gap above the calendar column');
  assert.equal(wide(map, '.act-cal .cal-svg')['max-width'], 'none', 'the phone 280px cap is lifted, the column caps it');
});

test('metric-row lists flow into as many >= 340px columns as fit (Salud, Entreno, Balance, My dashboard)', () => {
  const list = wide(builtMap(), '.db-list');
  assert.equal(list.display, 'grid');
  assert.equal(list['grid-template-columns'], 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))',
    'auto-fill: a narrow host (a Salud section column, Inicio\'s column) keeps one column');
});
