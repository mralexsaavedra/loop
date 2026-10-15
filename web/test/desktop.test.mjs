/* Desktop guards on the built example page (web/.test-dist/en-example, built by `npm run pretest`).
 * The rule: on a wide screen the page is ONE centred column of ~960px, the
 * phone's stack made wider; no multi-column page grids ("too compressed"). Detail sheets stay 760px.
 * Run `npm run pretest` (or `npm test`) first: it reads an already-built fixture. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssRules } from './css-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const htmlPath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');
const css = () => [...fs.readFileSync(htmlPath, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const WIDE = '(min-width:900px)';
const norm = (v) => String(v).replace(/\s+/g, '');
const rules = () => parseCssRules(css());
const decl = (list, sel, prop) => {
  const d = list.filter((x) => x.selector.split(',').map((s) => s.trim()).includes(sel)).flatMap((x) => x.decls).filter(([p]) => p === prop).pop();
  return d ? norm(d[1]) : null;
};

test('wide screens: the content column is 960px, centred (top bar, main with the tab panels, footer)', () => {
  const all = rules();
  assert.equal(decl(all.filter((r) => !r.media), ':root', '--content-max'), '960px');
  const wide = all.filter((r) => r.media === WIDE);
  for (const sel of ['.wrap>.topbar', '.wrap>main', '.wrap>footer']) {
    assert.equal(decl(wide, sel, 'max-width'), 'var(--content-max)', sel);
    assert.equal(decl(wide, sel, 'margin-left'), 'auto', sel);
    assert.equal(decl(wide, sel, 'margin-right'), 'auto', sel);
  }
});

test('wide screens: no page-level multi-column layout survives (Salud sections, meals, plan, recovery card)', () => {
  const wide = rules().filter((r) => r.media === WIDE);
  const multi = wide.filter((r) => r.decls.some(([p, v]) => (p === 'grid-template-columns' && /repeat\((auto-fit|auto-fill|2),/.test(norm(v))) || p === 'columns' || p === 'column-count'));
  const sels = multi.map((r) => r.selector);
  for (const banned of ['#health-body', '.food-meals', '.day-panel', '#nutri-plan', '.rec-layout']) {
    assert.ok(!sels.some((s) => s.split(',').map((x) => x.trim()).includes(banned)), `${banned} must stay one column on desktop`);
  }
  assert.equal(decl(wide, '#nutri-progress>.nutri-card', 'max-width'), null, 'Progreso is as wide as everything else');
  assert.equal(decl(wide, '#food-adherence>.nutri-card', 'max-width'), null, 'Constancia is as wide as everything else');
});

test('wide screens: the three dials are one centred group, the load pills centred under the load dial', () => {
  const wide = rules().filter((r) => r.media === WIDE);
  assert.equal(decl(wide, '.dials', 'grid-template-columns'), 'repeat(3,var(--dial-size))');
  assert.equal(decl(wide, '.dials', 'justify-content'), 'center');
  assert.equal(decl(wide, '.dial-switch', 'justify-content'), 'center');
  assert.equal(decl(wide, '.dial-switch', 'width'), 'calc(var(--dial-size)+2*var(--dial-gap))');
});

test('wide screens: monitor tiles at natural height, Tonight bounded, aux text one step up', () => {
  const wide = rules().filter((r) => r.media === WIDE);
  assert.equal(decl(wide, '.hmt', 'min-height'), '0');
  assert.equal(decl(wide, '.hmt-val b', 'font-size'), 'var(--fs-num-card)');
  assert.equal(decl(wide, '.tn-row', 'max-width'), '560px');
  assert.equal(decl(wide, ':root', '--fs-2xs'), '11.5px');
});

test('wide screens: the wordmark sits in the top bar first column (left, ~20px caps), the pill centred, the avatar right beside Sync; the phone: avatar · LOOP · Sync, the pill on its own row', () => {
  const all = rules();
  const wide = all.filter((r) => r.media === WIDE);
  const base = all.filter((r) => !r.media);
  assert.equal(decl(wide, '.wordmark', 'position'), null, 'a grid item, not pinned absolutely');
  assert.equal(decl(wide, '.topbar>.wordmark', 'grid-column'), '1');
  assert.equal(decl(wide, '.topbar>.wordmark', 'justify-self'), 'start');
  assert.equal(decl(wide, '.wordmark', 'font-size'), '30px', '30px letters = ~20px caps');
  assert.equal(decl(wide, '.topbar>.date-pill', 'grid-column'), '2');
  assert.equal(decl(wide, '.topbar>.date-pill', 'grid-row'), '1');
  assert.equal(decl(wide, '.topbar>.avatar-btn', 'grid-column'), '3');
  assert.equal(decl(wide, '.topbar>.avatar-btn', 'justify-self'), 'end');
  assert.equal(decl(wide, '.topbar>.fresh', 'margin-right'), '48px', 'a lane for the avatar');
  // the phone: avatar · centred wordmark · freshness on row 1, the date pill centred on row 2
  assert.equal(decl(base, '.wordmark', 'justify-content'), 'center');
  assert.equal(decl(base, '.wordmark', 'font-size'), '19px');
  assert.equal(decl(base, '.wordmark', 'position'), null);
  assert.equal(decl(base, '.topbar>.wordmark', 'grid-column'), '2');
  assert.equal(decl(base, '.avatar-btn', 'grid-column'), '1');
  assert.equal(decl(base, '.date-pill', 'grid-column'), '1/-1');
  assert.equal(decl(base, '.date-pill', 'grid-row'), '2');
});
