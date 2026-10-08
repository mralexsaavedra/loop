/* Mobile guards on the built example page (web/.test-dist/en-example, built by `npm run pretest`):
 *  - no iOS focus zoom: on narrow screens every text input / select / textarea is >= 16px, and no
 *    form-control rule out-ranks the guard;
 *  - the load dial's modality switch keeps a >= 44px hit area while the pill stays compact;
 *  - dark form controls / browser chrome: color-scheme dark + a theme-color equal to the top of the
 *    page's background (the --ground-top token).
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
const html = () => fs.readFileSync(htmlPath, 'utf8');
const css = () => [...html().matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const tokensCss = fs.readFileSync(path.join(WEB_ROOT, 'src', 'styles', 'tokens.css'), 'utf8');
const token = (name) => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(tokensCss);
  return m ? m[1].trim() : null;
};
const NARROW = '(max-width:899px)';

/** [ids, classes + attributes + pseudo-classes, elements] of one compound selector; :is() / :not()
 * count their most specific argument (this project's selectors never go deeper). */
function specificity(sel) {
  let a = 0, b = 0, c = 0;
  const inner = (args) => splitTop(args).map((x) => specificity(x.trim())).reduce((best, x) => (cmp(x, best) > 0 ? x : best), [0, 0, 0]);
  // :is() / :not() / :where() with balanced (possibly nested) parentheses
  let s = '';
  for (let i = 0; i < sel.length;) {
    const m = /^:(is|not|where)\(/.exec(sel.slice(i));
    if (!m) { s += sel[i++]; continue; }
    let depth = 1, j = i + m[0].length;
    for (; j < sel.length && depth; j++) depth += sel[j] === '(' ? 1 : sel[j] === ')' ? -1 : 0;
    if (m[1] !== 'where') { const [x, y, z] = inner(sel.slice(i + m[0].length, j - 1)); a += x; b += y; c += z; }
    s += ' ';
    i = j;
  }
  s = s.replace(/::?[a-z-]+(\([^)]*\))?/g, (m) => { if (m.startsWith('::')) c++; else b++; return ' '; });
  s = s.replace(/\[[^\]]*\]/g, () => { b++; return ' '; });
  s = s.replace(/#[\w-]+/g, () => { a++; return ' '; });
  s = s.replace(/\.[\w-]+/g, () => { b++; return ' '; });
  c += (s.match(/(^|[\s>+~])[a-z][\w-]*/g) || []).length;
  return [a, b, c];
}
/** A selector list split on its top-level commas (never inside parentheses). */
function splitTop(list) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === ',' && !depth) { out.push(cur); cur = ''; continue; }
    depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
    cur += ch;
  }
  out.push(cur);
  return out;
}
function cmp(x, y) {
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Every class a client script or template puts on an <input> / <select> / <textarea>, radios excluded. */
function formControlClasses() {
  const out = new Set();
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(js|astro)$/.test(f.name) && !/\.test\./.test(f.name)) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
          if (/type=\\?["']?radio/.test(m[2])) continue;
          const cls = /class=\\?["']([^"'\\]+)/.exec(m[2]);
          if (cls) cls[1].split(/\s+/).forEach((x) => x && out.add(x));
        }
      }
    }
  };
  walk(path.join(WEB_ROOT, 'src'));
  walk(path.join(WEB_ROOT, 'layouts'));
  return out;
}

test('a 16px input font token exists (iOS zooms into any focused field under 16px)', () => {
  assert.equal(token('fs-input'), '16px');
});

test('narrow screens: every text input, select and textarea is 16px, and no form-control rule out-ranks the guard', () => {
  const rules = parseCssRules(css());
  const guard = rules.find((r) => r.media === NARROW && r.decls.some(([p, v]) => p === 'font-size' && v === 'var(--fs-input)')
    && /\binput\b/.test(r.selector) && /\bselect\b/.test(r.selector) && /\btextarea\b/.test(r.selector));
  assert.ok(guard, 'one rule in @media (max-width: 899px) sets font-size: var(--fs-input) on input, select and textarea');
  assert.match(guard.selector, /:not\(\[type="?radio"?\]\)/, 'radios are not text fields');
  const guardSpec = specificity(guard.selector);

  const classes = formControlClasses();
  for (const k of ['food-in', 'gd-pick', 'fuel-select']) assert.ok(classes.has(k), `found the ${k} controls`);
  const offenders = [];
  for (const r of rules) {
    if (r === guard || r.media === '(min-width:900px)') continue;
    if (!r.decls.some(([p]) => p === 'font-size' || p === 'font')) continue;
    for (const sel of splitTop(r.selector)) {
      const last = sel.trim().split(/[\s>+~]+/).pop();
      const hits = [...classes].some((k) => new RegExp(`\\.${k}(?![\\w-])`).test(last));
      if (hits && cmp(specificity(sel.trim()), guardSpec) >= 0) offenders.push(`${r.media || ''} ${sel}`);
    }
  }
  assert.deepEqual(offenders, [], 'a form-control font-size rule at least as specific as the guard would win over 16px');
});

test('ride-duration select at 16px: min-width only (never a fixed width that clips "5 h 30 min"), capped at its card', () => {
  const rules = parseCssRules(css());
  const d = Object.fromEntries(rules.filter((r) => r.selector === '.fuel-select' && r.media === null).flatMap((r) => r.decls));
  assert.equal(d['min-width'], '180px', 'a floor: the select still grows to its longest option');
  assert.equal(d.width, undefined, 'no fixed width');
  assert.equal(d['max-width'], '100%', 'never wider than the card on a 360px phone');
});

test('specificity helper: the counts the guard test relies on', () => {
  assert.deepEqual(specificity('.food-in'), [0, 1, 0]);
  assert.deepEqual(specificity('.food-in-wrap .food-in'), [0, 2, 0]);
  assert.deepEqual(specificity(':is(input:not([type="radio"]):not([type="checkbox"]), select, textarea)'), [0, 2, 1]);
  assert.deepEqual(specificity('.dial-mod::before'), [0, 1, 1]);
});

test('load dial switch: the pill stays compact but its hit area is 44px tall and wide', () => {
  const rules = parseCssRules(css());
  const decl = (sel, prop, media = null) => {
    const r = rules.filter((x) => x.selector === sel && x.media === media).flatMap((x) => x.decls).filter(([p]) => p === prop);
    return r.length ? r[r.length - 1][1] : undefined;
  };
  assert.equal(decl('.dial-mod', 'min-height'), '30px', 'the visible pill keeps its compact height');
  assert.equal(decl('.dial-mod', 'min-width'), '44px');
  assert.equal(decl('.dial-mod', 'position'), 'relative');
  assert.equal(decl('.dial-mod:before', 'content'), '""');
  assert.equal(decl('.dial-mod:before', 'position'), 'absolute');
  // centred 44px band: top / bottom = 50% - 22px, full width
  assert.equal(decl('.dial-mod:before', 'top'), 'calc(50% - 22px)');
  assert.equal(decl('.dial-mod:before', 'bottom'), 'calc(50% - 22px)');
  assert.equal(decl('.dial-mod:before', 'left'), '0');
  assert.equal(decl('.dial-mod:before', 'right'), '0');
  // wrapped rows never overlap: the band reaches (44 - 30) / 2 = 7px past each pill, so a wrapped
  // row needs >= 14px between rows; side by side the bands stay within each pill's own width
  assert.equal(decl('.dial-switch', 'row-gap'), 'var(--sp-6)');
  assert.equal(token('sp-6'), '14px');
});

test('dark browser chrome and form controls: color-scheme + theme-color from the --ground-top token', () => {
  const page = html();
  const head = page.slice(0, page.indexOf('</head>'));
  assert.match(head, /<meta name="color-scheme" content="dark"\s*\/?>/);
  const theme = /<meta name="theme-color" content="([^"]+)"\s*\/?>/.exec(head);
  assert.ok(theme, 'a theme-color meta');
  assert.equal(theme[1], token('ground-top'), 'the colour at the top of the page background');
  assert.match(token('ground-top'), /^#[0-9a-f]{6}$/i);
  const root = parseCssRules(css()).filter((r) => r.selector === ':root' && r.media === null).flatMap((r) => r.decls);
  assert.ok(root.some(([p, v]) => p === 'color-scheme' && v === 'dark'), ':root { color-scheme: dark }');
});

test('the floating dock never covers the end of a tab: one --dock-room (bar + its offset + air + safe area) pads the page and every scroll target', () => {
  const rules = parseCssRules(css());
  const decl = (sel, prop, media = null) => {
    const r = rules.filter((x) => x.selector === sel && x.media === media).flatMap((x) => x.decls).filter(([p]) => p === prop);
    return r.length ? r[r.length - 1][1] : undefined;
  };
  const room = token('dock-room');
  assert.ok(room, 'a --dock-room token');
  assert.match(room, /env\(safe-area-inset-bottom\)/, 'the home-indicator inset is part of the room');
  // the bar: 52px buttons + 5px padding top and bottom + 1px border each side, lifted 10px off the edge
  assert.equal(decl('.tabnav button', 'min-height'), '52px');
  assert.equal(decl('.dock', 'bottom'), 'calc(10px + env(safe-area-inset-bottom))');
  const px = Number(/(\d+)px/.exec(room)[1]);
  assert.ok(px >= 10 + 52 + 2 * 5 + 2 + 16, `--dock-room ${px}px leaves at least 16px of air above the bar`);
  assert.equal(decl('body', 'padding-bottom'), 'var(--dock-room)', 'the last block of a tab scrolls clear of the bar');
  assert.equal(decl('html', 'scroll-padding-bottom'), 'var(--dock-room)', 'a focused / jumped-to element is never parked under the bar');
});

test('wide screens: the Entreno calendar grid spans the card (7 equal columns) with tiles capped at 64 px tall', () => {
  const rules = parseCssRules(css()).filter((r) => r.media === '(min-width:900px)');
  const decl = (sel, prop) => {
    const d = rules.filter((x) => x.selector.split(',').map((s) => s.trim()).includes(sel)).flatMap((x) => x.decls).find(([p]) => p === prop);
    return d ? String(d[1]).replace(/\s+/g, '') : null;
  };
  assert.equal(decl('.cal-grid', 'display'), 'grid');
  assert.equal(decl('.cal-grid', 'grid-template-columns'), 'repeat(7,1fr)');
  assert.equal(decl('.cal-day', 'width'), '100%', 'definite width, so max-height clamps the height instead of shrinking the tile');
  assert.equal(decl('.cal-day', 'aspect-ratio'), '1');
  assert.equal(decl('.cal-day', 'max-height'), '64px');
});
