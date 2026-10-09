/* Design-system guard (docs/design-system.md): the role tokens in web/src/styles/tokens.css are the
 * ONE place a card radius, a card padding, a hero-number size or a caps-label size / tracking is
 * chosen. This test scans the source stylesheets (web/src/styles/*.css, parsed with css-scan.mjs, so
 * comments and formatting never matter) and fails when a rule picks its own value instead:
 *
 *   1. cards     — a rule that paints a card fill (var(--card-bg) / var(--surface)) and sets a
 *                  border-radius uses var(--card-radius); no rule uses a raw px radius >= 8px;
 *   2. padding   — Inicio's sibling cards share var(--card-pad);
 *   3. numbers   — a rule in the --num face whose size reaches the hero band (>= 18px) uses a step
 *                  of the hero scale, in one weight (700); a dial centre (sized to its ring) is
 *                  listed; no other raw px size reaches the band;
 *   4. caps      — an uppercase rule sizes itself with a caps role token and tracks with
 *                  var(--label-track).
 *
 * Every exception is listed below with its reason; keep the lists short. A new exception is a
 * design decision: document it in docs/design-system.md first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssRules } from './css-scan.mjs';
import { CODE, SRC } from './display-sources.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STYLES = path.join(here, '..', 'src', 'styles');
const FILES = fs.readdirSync(STYLES).filter((f) => f.endsWith('.css')).sort();
const RULES = FILES.flatMap((file) =>
  parseCssRules(fs.readFileSync(path.join(STYLES, file), 'utf8')).map((r) => ({
    file,
    media: r.media,
    selector: r.selector,
    decl: Object.fromEntries(r.decls),
  })),
);
const where = (r) => `${r.file}${r.media ? ` @media ${r.media}` : ''} \`${r.selector}\``;

// the :root custom properties of tokens.css (top level, not the desktop overrides)
const TOKENS = Object.fromEntries(
  RULES.filter((r) => r.file === 'tokens.css' && !r.media && r.selector === ':root')
    .flatMap((r) => Object.entries(r.decl))
    .filter(([k]) => k.startsWith('--')),
);
// a length in px: `12px`, or a token chain that ends in one; anything else (clamp, calc, em) = null
function px(value, depth = 0) {
  if (value == null || depth > 8) return null;
  const raw = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (raw) return Number(raw[1]);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref ? px(TOKENS[ref[1]], depth + 1) : null;
}

// role tokens and the primitive each one must point at (docs/design-system.md → Tokens)
const ROLES = {
  '--card-radius': [10, 12],
  '--card-pad': [12, 12],
  '--fs-num-row': [20, 22],
  '--fs-num-card': [28, 28],
  '--fs-label': [10.5, 10.5],
  '--fs-title': [11.5, 11.5],
  '--fs-title-lg': [12.5, 12.5],
  '--fs-section': [20, 20],
};

// 1. cards ---------------------------------------------------------------------------------------
const CARD_FILL = new Set(['var(--card-bg)', 'var(--surface)']);
// a card-fill rule allowed another radius: `${file} ${selector}` → reason
const CARD_RADIUS_ALLOW = {
  'detail.css .dd-contrib:before': 'a 3px marker bar, not a card',
};
// a raw px radius >= 8px allowed: `${file} ${selector}` → reason
const RAW_RADIUS_ALLOW = {
  'base.css .tabnav': 'the floating dock bar (app shell, not a card)',
  'base.css .tabnav button': 'a dock button inside the 24px bar (inner radius = 24 - 5px padding)',
  'layout.css .act-pop': 'the "+" action popover (app shell, not a card)',
  'training.css .cal-day': 'a 48px calendar tile at >= 900px (a day cell, not a card)',
};

// 3. numbers -------------------------------------------------------------------------------------
const HERO_MIN = 18;
const HERO_SIZES = new Set(['var(--fs-num-row)', 'var(--fs-num-card)', 'var(--fs-dial)', 'var(--fs-hero)']);
const HERO_WEIGHTS = new Set(['700', 'var(--num-weight)']);
const isDialClamp = (v) => /^clamp\(.*var\(--fs-dial\)\)$/.test(v);
// dial centres are sized to their ring (the dial step), plus the one sheet-header value
const HERO_ALLOW = {
  'score.css .dial-num': "Inicio's dials at >= 900px (168px ring)",
  'nutri.css .nt-kcal': "Nutrición's kcal dial",
  'detail.css .dd-num': 'the deep-dive sheet dial',
  'detail.css .dt-num': 'the trend sheet header value (sheet scale, audited in DS4)',
};
// raw px font sizes in the hero band that are not numbers
const RAW_SIZE_ALLOW = {
  'detail.css .sh-back': 'the sheet back-arrow glyph',
  'layout.css .wordmark': 'the header logo at >= 900px (header stays as is)',
};

// 4. caps ----------------------------------------------------------------------------------------
const CAPS_SIZES = new Set(['var(--fs-label)', 'var(--fs-title)', 'var(--fs-title-lg)']);
// detail sheets keep a larger sheet-level label scale (13.5 / 14.5px) — audited in DS4
const CAPS_SIZE_SKIP_FILES = new Set(['detail.css']);
const CAPS_ALLOW = {
  'layout.css .date-pill-lbl': 'the header date pill, wide 0.14em tracking (header stays as is)',
};

const key = (r) => `${r.file} ${r.selector}`;

test('role tokens exist and point at primitive tokens in their documented range', () => {
  for (const [name, [lo, hi]] of Object.entries(ROLES)) {
    const v = TOKENS[name];
    assert.ok(v, `tokens.css :root must define ${name}`);
    assert.match(v, /^var\(--[\w-]+\)$/, `${name} must reference a primitive token, found \`${v}\``);
    const n = px(v);
    assert.ok(n != null && n >= lo && n <= hi, `${name} resolves to ${n}px, expected ${lo}–${hi}px`);
  }
  assert.equal(TOKENS['--num-weight'], '700', '--num-weight is the one hero-number weight');
  assert.equal(TOKENS['--label-track'], '0.08em', '--label-track is the one caps tracking');
});

test('every card uses the card radius token; no raw radius >= 8px outside the allowlist', () => {
  const bad = [];
  const seen = new Set();
  for (const r of RULES) {
    const radius = r.decl['border-radius'];
    if (radius == null) continue;
    const fill = r.decl.background ?? r.decl['background-color'];
    if (CARD_FILL.has(fill) && radius !== 'var(--card-radius)') {
      if (CARD_RADIUS_ALLOW[key(r)]) seen.add(key(r));
      else bad.push(`${where(r)} card radius \`${radius}\` (use var(--card-radius))`);
    }
    const raw = /^(\d+(?:\.\d+)?)px\b/.exec(radius);
    if (raw && Number(raw[1]) >= 8) {
      if (RAW_RADIUS_ALLOW[key(r)]) seen.add(key(r));
      else bad.push(`${where(r)} raw radius \`${radius}\` (use a token)`);
    }
  }
  assert.deepEqual(bad, []);
  const stale = [...Object.keys(CARD_RADIUS_ALLOW), ...Object.keys(RAW_RADIUS_ALLOW)].filter((k) => !seen.has(k));
  assert.deepEqual(stale, [], 'allowlist entries that no longer match a rule — remove them');
});

test("Inicio's sibling cards share the card padding token", () => {
  for (const sel of ['.sc-card', '.eat-card']) {
    const r = RULES.find((x) => !x.media && x.selector === sel && x.decl.padding);
    assert.ok(r, `${sel} must declare its padding`);
    assert.equal(r.decl.padding, 'var(--card-pad)', `${where(r)} padding`);
  }
});

test('hero numbers use the hero scale (row / card / dial) in one weight', () => {
  const bad = [];
  const seen = new Set();
  for (const r of RULES) {
    const size = r.decl['font-size'];
    if (size == null) continue;
    const n = px(size);
    const raw = /^\d+(?:\.\d+)?px$/.test(size);
    if (HERO_ALLOW[key(r)]) {
      seen.add(key(r));
      continue;
    }
    if (raw && n >= HERO_MIN && !(r.decl['font-family'] ?? '').includes('var(--num)')) {
      if (RAW_SIZE_ALLOW[key(r)]) seen.add(key(r));
      else bad.push(`${where(r)} raw font-size \`${size}\` in the hero band (use a role token)`);
    }
    const isNum = (r.decl['font-family'] ?? '').includes('var(--num)') || HERO_SIZES.has(size);
    if (!isNum) continue;
    const hero = HERO_SIZES.has(size) || isDialClamp(size) || (n != null ? n >= HERO_MIN : /^clamp\(/.test(size));
    if (!hero) continue;
    if (!HERO_SIZES.has(size) && !isDialClamp(size)) bad.push(`${where(r)} hero size \`${size}\` (use --fs-num-row / --fs-num-card / --fs-dial)`);
    const w = r.decl['font-weight'];
    if (w != null && !HERO_WEIGHTS.has(w)) bad.push(`${where(r)} hero weight \`${w}\` (use var(--num-weight))`);
  }
  assert.deepEqual(bad, []);
  const stale = [...Object.keys(HERO_ALLOW), ...Object.keys(RAW_SIZE_ALLOW)].filter((k) => !seen.has(k));
  assert.deepEqual(stale, [], 'allowlist entries that no longer match a rule — remove them');
});

test('caps labels use the caps role sizes and the one label tracking', () => {
  const bad = [];
  const seen = new Set();
  for (const r of RULES) {
    if (r.decl['text-transform'] !== 'uppercase') continue;
    if (CAPS_ALLOW[key(r)]) {
      seen.add(key(r));
      continue;
    }
    const ls = r.decl['letter-spacing'];
    if (ls != null && ls !== 'var(--label-track)') bad.push(`${where(r)} tracking \`${ls}\` (use var(--label-track))`);
    const fs_ = r.decl['font-size'];
    if (fs_ != null && !CAPS_SIZE_SKIP_FILES.has(r.file) && !CAPS_SIZES.has(fs_)) {
      bad.push(`${where(r)} caps size \`${fs_}\` (use --fs-label / --fs-title / --fs-title-lg)`);
    }
  }
  assert.deepEqual(bad, []);
  const stale = Object.keys(CAPS_ALLOW).filter((k) => !seen.has(k));
  assert.deepEqual(stale, [], 'allowlist entries that no longer match a rule — remove them');
});

// 5. components (docs/design-system.md → Components) ---------------------------------------------
test('section heading: one class (.hs-lbl) owns the section step, in sentence case', () => {
  const own = RULES.filter((r) => !r.media && r.selector === '.hs-lbl' && r.decl['font-size']);
  assert.equal(own.length, 1, 'one .hs-lbl rule sets the section heading type');
  const d = own[0].decl;
  assert.deepEqual([d['font-size'], d['font-weight'], d['text-transform'], d['letter-spacing']], ['var(--fs-section)', 'var(--fw-section)', 'none', '0']);
  const other = RULES.filter((r) => r !== own[0] && /var\(--f[sw]-section\)/.test(`${r.decl['font-size']} ${r.decl['font-weight']}`));
  assert.deepEqual(other.map(where), [], 'only .hs-lbl uses the section tokens: a section heading reuses the class');
});

test('CTA link: only .cta (and the in-sentence .lnk) paint link text; the gradient only on the insight card', () => {
  const linkText = RULES.filter((r) => r.decl.color === 'var(--link)').map(key);
  assert.deepEqual(linkText.sort(), ['base.css .cta', 'base.css .lnk'], 'a link-coloured rule outside .cta / .lnk is another link style');
  const gradient = RULES.filter((r) => r.decl['background-clip'] === 'text').map(key);
  assert.deepEqual(gradient, ['detail.css .dd-insight .cta'], 'the gradient text is drawn only on --ground (tokens.css)');
});

// the chevron's look lives in ONE rule (base.css); its owners only place / rotate it
const CHEV_RULE = '.chev, [data-detail][role=button]:after, button.meal-name:after, details.rec-raw>summary:after';
const CHEV_LOOK = ['color', 'font-size', 'font-weight', 'line-height', 'font'];
test('chevron: one glyph size and colour; no rule styles a chevron of its own', () => {
  const base = RULES.find((r) => r.file === 'base.css' && r.selector === CHEV_RULE);
  assert.ok(base, 'base.css holds the one chevron rule');
  assert.deepEqual([base.decl.color, base.decl['font-size'], base.decl['font-weight']], ['var(--muted)', 'var(--chev-size)', '400']);
  const bad = [];
  for (const r of RULES) {
    if (r === base) continue;
    const isChev = /(^|[\s.,>])\.?[\w-]*chev\b/.test(r.selector) || /[›‹]/.test(r.decl.content ?? '');
    const look = CHEV_LOOK.filter((p) => r.decl[p] != null);
    if (isChev && look.length) bad.push(`${where(r)} sets ${look.join(', ')} (the chevron's look is base.css's .chev)`);
  }
  assert.deepEqual(bad, []);
});

// a ‹ / › glyph in markup sits in a .chev span; the one exception is the sheet header's back button
const GLYPH_ALLOW = { 'web/src/client/util.js': 1 }; // sheetHead's .sh-back "‹" (a 44px header control, docs)
test('chevron: every ‹ / › written in markup is a .chev span', () => {
  const bad = [];
  for (const f of CODE) {
    let n = 0;
    for (const m of SRC[f].matchAll(/[›‹]/g)) {
      if (/<span class="chev[^"]*"[^>]*>$/.test(SRC[f].slice(Math.max(0, m.index - 80), m.index))) continue;
      n++;
    }
    if (n !== (GLYPH_ALLOW[f] ?? 0)) bad.push(`${f}: ${n} chevron glyph(s) outside a .chev span (allowed ${GLYPH_ALLOW[f] ?? 0})`);
  }
  assert.deepEqual(bad, []);
});

// a "picked" state that fills or outlines: the chip and the segmented control own it; every other
// pressed / checked fill is listed with its reason
const PICKED_ALLOW = {
  'base.css .chip[aria-pressed=true], :checked+.chip': 'THE selected chip (white fill)',
  'detail.css .dt-range button[aria-pressed=true]': 'THE segmented control (grey square)',
  'detail.css .dt-day[aria-pressed=true]': "the trend calendar's selected day (a ring on a day cell)",
  'food.css .fa-tab[aria-pressed=true]': "the food sheet's source tabs (audited in DS4)",
  'journal.css .jr-x[aria-pressed=true]': "a journal answer (yes), not a filter",
  'journal.css .jr-y[aria-pressed=true]': "a journal answer (no), not a filter",
  'score.css .db-tog[aria-pressed=true]': 'Customize panel visibility toggle (DS4)',
};
test('selected chip and segmented control: one picked style each; other picked fills are listed', () => {
  const picked = RULES.filter((r) => /\[aria-(pressed|checked|selected)=true\]|:checked/.test(r.selector) && (r.decl.background || r.decl['background-color'] || r.decl['border-color']));
  assert.deepEqual(picked.map(key).filter((k) => !PICKED_ALLOW[k]), [], 'a new picked style: reuse .chip or .dt-range');
  assert.deepEqual(Object.keys(PICKED_ALLOW).filter((k) => !picked.some((r) => key(r) === k)), [], 'stale allowlist entries');
  const chip = picked.find((r) => key(r).startsWith('base.css .chip'));
  assert.deepEqual([chip.decl.background, chip.decl.color], ['var(--accent)', 'var(--on-accent)'], 'the picked chip is white-filled');
});
