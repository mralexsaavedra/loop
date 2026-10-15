/* Design-system guard (docs/design-system.md): the role tokens in web/src/styles/tokens.css are the
 * ONE place a card radius, a card padding, a hero-number size or a caps-label size / tracking is
 * chosen. This test scans the source stylesheets (web/src/styles/*.css, parsed with css-scan.mjs, so
 * comments and formatting never matter) and fails when a rule picks its own value instead:
 *
 *   1. cards     — a rule that paints a card fill (var(--card-bg) / var(--surface)) and sets a
 *                  border-radius uses var(--card-radius); no rule uses a raw px radius >= 8px;
 *   2. padding   — every card fill (Inicio's sibling cards first) pads itself with var(--card-pad);
 *   3. numbers   — a rule in the --num face whose size reaches the hero band (>= 18px) uses a step
 *                  of the hero scale, in one weight (700); a dial centre (sized to its ring) is
 *                  listed; no other raw px size reaches the band;
 *   4. caps      — an uppercase rule sizes itself with a caps role token and tracks with
 *                  var(--label-track);
 *   5. components — the section heading, CTA link, chevron, segmented control / chip and trend
 *                  glyph each have ONE style (docs/design-system.md → Components).
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
  '--fs-title-sheet': [13.5, 13.5],
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
  'training.css @media (min-width:900px) .cal-day': 'a 48px calendar tile at >= 900px (a day cell, not a card)',
};

// 3. numbers -------------------------------------------------------------------------------------
const HERO_MIN = 18;
const HERO_SIZES = new Set(['var(--fs-num-row)', 'var(--fs-num-card)', 'var(--fs-dial)', 'var(--fs-hero)']);
const HERO_WEIGHTS = new Set(['700', 'var(--num-weight)']);
// a selector set in the --num face by ANY rule (a grouped `.a, .b { font-family: var(--num) }` too), so a
// later `.b { font-size: 24px }` without its own font-family is still a number (R3-002)
// keyed by file + media + selector: a `.x` in the --num face in one stylesheet (or one media query)
// says nothing about a `.x` elsewhere; a top-level rule still applies inside its own file's media rules
const numKey = (file, media, sel) => `${file}|${media || ''}|${sel}`;
const NUM_SELECTORS = new Set(
  RULES.filter((r) => (r.decl['font-family'] ?? '').includes('var(--num)')).flatMap((r) => r.selector.split(', ').map((s) => numKey(r.file, r.media, s))),
);
const inNumFace = (r) => (r.decl['font-family'] ?? '').includes('var(--num)') ||
  r.selector.split(', ').some((s) => NUM_SELECTORS.has(numKey(r.file, r.media, s)) || NUM_SELECTORS.has(numKey(r.file, '', s)));
const isDialClamp = (v) => /^clamp\(.*var\(--fs-dial\)\)$/.test(v);
// dial centres are sized to their ring (the dial step), plus the one sheet-header value
const HERO_ALLOW = {
  'score.css @media (min-width:900px) .dial-num': "Inicio's dials at >= 900px (168px ring)",
  'nutri.css .nt-kcal': "Nutrición's kcal dial",
  'nutri.css @media (min-width:900px) .nt-kcal': "Nutrición's kcal dial at >= 900px (its larger ring)",
  'detail.css .dd-num': 'the deep-dive sheet dial',
  'detail.css .dt-num': 'the trend sheet header value (sheet scale, audited in DS4)',
};
// raw px font sizes in the hero band that are not numbers
const RAW_SIZE_ALLOW = {
  'detail.css .sh-back': 'the sheet back-arrow glyph',
  'layout.css .wordmark': 'the header logo on the phone, 19px (header stays as is)',
  'layout.css @media (min-width:900px) .wordmark': 'the header logo at >= 900px (header stays as is)',
};

// 4. caps ----------------------------------------------------------------------------------------
const CAPS_SIZES = new Set(['var(--fs-label)', 'var(--fs-title)', 'var(--fs-title-lg)']);
// the sheets' own caps title, one step up — only in the sheet stylesheet (detail.css)
const SHEET_CAPS = { size: 'var(--fs-title-sheet)', file: 'detail.css' };
const CAPS_ALLOW = {
  'layout.css .date-pill-lbl': 'the header date pill, wide 0.14em tracking (header stays as is)',
};

// the allowlist key names the media query too, so an exception at >= 900px never excuses the phone rule
const key = (r) => `${r.file}${r.media ? ` @media ${r.media}` : ''} ${r.selector}`;

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

// a card-fill rule that pads itself uses var(--card-pad); the sheets' own stylesheets sit on the sheet's
// 16px inset and are audited as sheets (docs/design-system.md → Exceptions)
const PAD_SHEET_FILES = new Set(['detail.css', 'profile.css']);
const CARD_PAD_ALLOW = {
  'score.css .db-row, .db-erow': 'a list row (8 x 12px), not a card: rows stack into a list',
  'layout.css details.sec-fold>summary': 'a fold row: its height is a min-height, only side padding',
  'training.css .train-empty': 'an empty state: a centred message with tall padding',
  'food.css .fp-form, .fp-search': "the food sheet's form (a sheet card on the 16px inset)",
};
test('every card fill pads itself with the card padding token', () => {
  const bad = [];
  const seen = new Set();
  for (const r of RULES) {
    const fill = r.decl.background ?? r.decl['background-color'];
    if (!CARD_FILL.has(fill) || r.decl.padding == null || PAD_SHEET_FILES.has(r.file)) continue;
    if (r.decl.padding === 'var(--card-pad)') continue;
    if (CARD_PAD_ALLOW[key(r)]) seen.add(key(r));
    else bad.push(`${where(r)} card padding \`${r.decl.padding}\` (use var(--card-pad))`);
  }
  assert.deepEqual(bad, []);
  const stale = Object.keys(CARD_PAD_ALLOW).filter((k) => !seen.has(k));
  assert.deepEqual(stale, [], 'allowlist entries that no longer match a rule — remove them');
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
    if (raw && n >= HERO_MIN && !inNumFace(r)) {
      if (RAW_SIZE_ALLOW[key(r)]) seen.add(key(r));
      else bad.push(`${where(r)} raw font-size \`${size}\` in the hero band (use a role token)`);
    }
    const isNum = inNumFace(r) || HERO_SIZES.has(size);
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
    if (fs_ != null && !CAPS_SIZES.has(fs_) && !(fs_ === SHEET_CAPS.size && r.file === SHEET_CAPS.file)) {
      bad.push(`${where(r)} caps size \`${fs_}\` (use --fs-label / --fs-title / --fs-title-lg; --fs-title-sheet in detail.css)`);
    }
  }
  assert.deepEqual(bad, []);
  const stale = Object.keys(CAPS_ALLOW).filter((k) => !seen.has(k));
  assert.deepEqual(stale, [], 'allowlist entries that no longer match a rule — remove them');
});

// caps labels are white or grey; colour goes on numbers and glyphs (the reference app's rule). A caps
// rule — or a rule of the same stylesheet for the same selector — paints only a label colour.
const LABEL_COLORS = new Set(['var(--ink)', 'var(--muted)', 'var(--faint)', 'var(--accent)', 'var(--accent-ink)', 'inherit', 'currentColor']);
const CAPS_COLOR_ALLOW = {
  'base.css .cta': 'THE CTA link (--link blue): a link, not a label',
  'base.css .save-btn': 'button text on the white-filled save pill (--on-accent)',
  'detail.css .ds-band': "the stress sheet's band word IS the reading (its band colour), not a label",
  'score.css .hmt-status': "the monitor's within / outside range word IS the reading (its state colour)",
  'score.css .hmt-band': "a monitor tile's band word IS the reading (its band colour)",
};
test('caps labels: white or grey only; colour goes on the number or glyph', () => {
  const capsSel = new Set(RULES.filter((r) => r.decl['text-transform'] === 'uppercase').flatMap((r) => r.selector.split(', ').map((s) => `${r.file}|${s}`)));
  const bad = [];
  const seen = new Set();
  for (const r of RULES) {
    const c = r.decl.color;
    if (c == null || LABEL_COLORS.has(c)) continue;
    const caps = r.decl['text-transform'] === 'uppercase' || r.selector.split(', ').some((s) => capsSel.has(`${r.file}|${s}`));
    if (!caps) continue;
    if (CAPS_COLOR_ALLOW[key(r)]) seen.add(key(r));
    else bad.push(`${where(r)} caps colour \`${c}\` (a label is --ink / --muted / --faint)`);
  }
  assert.deepEqual(bad, []);
  const stale = Object.keys(CAPS_COLOR_ALLOW).filter((k) => !seen.has(k));
  assert.deepEqual(stale, [], 'allowlist entries that no longer match a rule — remove them');
  // the weight status word (caps .pg-status) stays white: only its dot carries the status colour
  const status = RULES.filter((r) => /\.pg-s-\w+ b\b/.test(r.selector) && r.decl.color).map(where);
  assert.deepEqual(status, [], 'the weight status word is a caps label: colour its dot');
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

test('CTA link: only .cta (and the in-sentence .lnk) paint link text; every CTA is the gradient', () => {
  const linkText = RULES.filter((r) => r.decl.color === 'var(--link)').map(key);
  assert.deepEqual(linkText.sort(), ['base.css .cta', 'base.css .lnk'], 'a link-coloured rule outside .cta / .lnk is another link style');
  const gradient = RULES.filter((r) => r.decl['background-clip'] === 'text');
  assert.deepEqual(gradient.map(key), ['base.css .cta'], 'one rule clips the CTA gradient to text');
  assert.equal(gradient[0].decl['background-image'] ?? gradient[0].decl.background, 'linear-gradient(90deg, var(--link), var(--link-end-card))', 'on cards the gradient ends in --link-end-card (AA on --surface / --surface-2)');
  const ground = RULES.filter((r) => /var\(--link-end\)\)/.test(r.decl['background-image'] ?? r.decl.background ?? '') && /\.cta\b/.test(r.selector)).map(key);
  assert.deepEqual(ground, ['detail.css .dd-insight .cta'], 'only the insight card (--ground) ends in the exact --link-end');
  // the `background` shorthand resets background-clip to border-box: a .cta override that uses it paints the
  // gradient as a solid block over the text instead of clipping it to the glyphs
  const shorthand = RULES.filter((r) => /\.cta\b/.test(r.selector) && /gradient/.test(r.decl.background ?? '') && r.decl['background-clip'] !== 'text').map(key);
  assert.deepEqual(shorthand, [], 'a .cta override sets background-image, never the background shorthand');
});

// content cards are flat (the reference app draws no outline on a card); inputs, chips, pills and the
// desktop sheet frame keep theirs. .train-block keeps only its left strain stripe.
const FLAT_CARDS = ['profile.css .pf-sec', 'dia.css .summary', 'dia.css .intake-card', 'training.css .train-block'];
test('content cards: no 1px outline', () => {
  const found = new Set();
  const bad = [];
  for (const r of RULES) {
    if (!FLAT_CARDS.includes(key(r))) continue;
    found.add(key(r));
    if (r.decl.border && r.decl.border !== '0') bad.push(`${where(r)} border: ${r.decl.border}`);
  }
  assert.deepEqual([...found].sort(), [...FLAT_CARDS].sort(), 'every flat card still has a rule');
  assert.deepEqual(bad, []);
});

// THE stale marker is a bare <details>: it undoes tablas.css's global details / summary card look
test('stale marker: no card chrome from the global details / summary rules', () => {
  const own = (sel) => Object.assign({}, ...RULES.filter((r) => !r.media && key(r) === `base.css ${sel}`).map((r) => r.decl));
  const d = own('.stale-mk'), s = own('.stale-mk>summary');
  assert.deepEqual([d.background, d.border, d['border-radius'], d['margin-bottom'], d['box-shadow']], ['none', '0', '0', '0', 'none'], 'details: no fill, outline, radius, gap or shadow');
  assert.equal(own('.stale-mk[open]')['box-shadow'], 'none', 'open: no ring (details[open] outranks a class)');
  assert.deepEqual([s.padding, s['font-size'], s['font-weight']], ['0', 'inherit', 'inherit'], 'summary: the marker\'s own size, no card padding');
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
// sheetHead's .sh-back "‹" (a 44px header control, docs) and the onboarding's own header back (a `bare` view, the same .sh-back)
const GLYPH_ALLOW = { 'web/src/client/util.js': 1, 'web/src/client/onboarding.js': 1 };
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
  'base.css .sw[aria-checked=true]:before': 'THE switch, on (show / hide one item: a track, not a pick)',
  'base.css .sw[aria-checked=true] .sw-knob': "THE switch's knob, on",
  'detail.css .dt-range button[aria-pressed=true]': 'THE segmented control (grey square)',
  'detail.css .dt-day[aria-pressed=true]': "the trend calendar's selected day (a ring on a day cell)",
  'journal.css .jr-x[aria-pressed=true]': "a journal answer (the reference's ✕ / ✓ pair), not a pick among options",
  'journal.css .jr-y[aria-pressed=true]': "a journal answer (the reference's ✕ / ✓ pair), not a pick among options",
  'profile.css .onb-card :checked+.onb-in': "the onboarding's option card (a large .chip stretched into a card: outlined + ✓, the reference's setup flow)",
};
test('selected chip and segmented control: one picked style each; other picked fills are listed', () => {
  const picked = RULES.filter((r) => /\[aria-(pressed|checked|selected)=true\]|:checked/.test(r.selector) && (r.decl.background || r.decl['background-color'] || r.decl['border-color']));
  assert.deepEqual(picked.map(key).filter((k) => !PICKED_ALLOW[k]), [], 'a new picked style: reuse .chip or .dt-range');
  assert.deepEqual(Object.keys(PICKED_ALLOW).filter((k) => !picked.some((r) => key(r) === k)), [], 'stale allowlist entries');
  const chip = picked.find((r) => key(r).startsWith('base.css .chip'));
  assert.deepEqual([chip.decl.background, chip.decl.color], ['var(--accent)', 'var(--on-accent)'], 'the picked chip is white-filled');
});

// Inicio's headings are `.hs-lbl.home-h`: the block spacing must win over .hs-lbl's `margin: 0` by
// specificity, never by which stylesheet loads last
test('section heading: Inicio\'s .home-h spacing out-specifies .hs-lbl (no load-order tie)', () => {
  const lbl = RULES.filter((r) => !r.media && r.decl.margin != null && r.selector.split(/,\s*/).includes('.hs-lbl'));
  const home = RULES.filter((r) => !r.media && r.decl.margin != null && r.selector.split(/,\s*/).some((s) => /\.home-h\b/.test(s)));
  assert.equal(home.length, 1, 'one rule spaces the Inicio heading');
  const hs = home[0].selector.split(/,\s*/).find((s) => /\.home-h\b/.test(s));
  assert.match(hs, /\.hs-lbl/, 'it names the heading it spaces (.hs-lbl.home-h)');
  for (const r of lbl) assert.ok(cmpSpec(specificity(hs), specificity('.hs-lbl')) > 0, `${hs} must beat ${where(r)}`);
});

// every segmented-control button is a 44 × 44 target (the ::after hit area), the visual square stays
// 28px tall, and two neighbours' hit areas never overlap (the gap covers both overhangs)
test('segmented control: a 44 x 44px hit area on every .dt-range button, without overlap', () => {
  const one = (sel) => RULES.find((r) => r.file === 'detail.css' && !r.media && r.selector === sel);
  const btn = one('.dt-range button').decl, hit = one('.dt-range button:after').decl, bar = one('.dt-range').decl;
  const [v, h = v] = hit.inset.split(/\s+/).map((x) => -px(x));
  assert.equal(px(btn['min-height']), 28, 'the visual square keeps its 28px');
  assert.ok(px(btn['min-height']) + 2 * v >= 44, `hit height ${px(btn['min-height']) + 2 * v}px`);
  assert.ok(px(btn['min-width']) + 2 * h >= 44, `hit width ${px(btn['min-width']) + 2 * h}px`);
  assert.ok(px(bar.gap) >= 2 * h, `gap ${px(bar.gap)}px < the two overhangs ${2 * h}px`);
});

// the select: ONE look (base.css .sel, a --rail pill); its owners only size it, never a card fill,
// a border or a radius of their own
const SELECT_OWNERS = /\.(gd-pick|fuel-select|dt-metric-sel)\b/;
const SELECT_LOOK = ['background', 'background-color', 'border', 'border-radius', 'color', 'padding', 'font', 'font-size', 'appearance'];
test('select: one shared pill style; owners only size it', () => {
  const sel = RULES.find((r) => r.file === 'base.css' && !r.media && r.selector === '.sel');
  assert.ok(sel, 'base.css holds the one select rule');
  assert.deepEqual([sel.decl.background, sel.decl.border, sel.decl['border-radius'], sel.decl.appearance], ['var(--rail)', '0', 'var(--r-pill)', 'none']);
  const bad = RULES.filter((r) => SELECT_OWNERS.test(r.selector) && SELECT_LOOK.some((p) => r.decl[p] != null)).map(where);
  assert.deepEqual(bad, [], 'a select owner styles its own look (use the .sel class)');
  const markup = Object.values(SRC).join('\n');
  // the food sheet's form fields (.food-in) keep the text-field look of the inputs beside them
  const selects = [...markup.matchAll(/<select\b[^>]*>/g)].map((m) => m[0]).filter((s) => !/class="food-in"/.test(s));
  assert.equal(selects.length, 3, 'the visible picks: trend metric, food example, ride duration');
  for (const s of selects) assert.match(s, /class=\\?["'][^"'\\]*\bsel\b/, `${s} uses the shared .sel`);
});

// the save button: ONE component (base.css .save-btn, the journal's full-width white caps pill) for every
// primary save — the journal and the food sheets
const SAVES = /<button\b[^>]*(?:data-jr="save"|data-food-act="(?:save|p-save|r-save)")[^>]*>/g;
test('save button: one shared component; every primary save uses it and nobody restyles it', () => {
  const r = RULES.find((x) => x.file === 'base.css' && !x.media && x.selector === '.save-btn');
  assert.ok(r, 'base.css holds the one save-button rule');
  assert.deepEqual([r.decl.width, r.decl.background, r.decl['border-radius'], r.decl['text-transform']], ['100%', 'var(--accent)', 'var(--r-pill)', 'uppercase']);
  const owners = RULES.filter((x) => x.file !== 'base.css' && /\.save-btn\b/.test(x.selector)).map(where);
  assert.deepEqual(owners, [], 'no other stylesheet restyles .save-btn');
  const saves = [...Object.values(SRC).join('\n').matchAll(SAVES)].map((m) => m[0]);
  assert.ok(saves.length >= 6, 'journal + 3 add-sheet saves + product + recipe: ' + saves.length);
  for (const b of saves) assert.match(b, /class="save-btn"/, b);
});

// the select's owners that need a 44px target (.gd-pick, .fuel-select) set min-height on a selector
// that out-specifies base.css .sel's 36px, so the hit area never depends on stylesheet load order
test('select: an owner 44px min-height beats .sel by specificity (no load-order tie)', () => {
  const base = RULES.find((r) => r.file === 'base.css' && !r.media && r.selector === '.sel');
  assert.equal(base.decl['min-height'], '36px');
  for (const owner of ['gd-pick', 'fuel-select']) {
    const rs = RULES.filter((r) => !r.media && r.decl['min-height'] != null && new RegExp(`\\.${owner}\\b`).test(r.selector));
    assert.equal(rs.length, 1, `one rule sizes .${owner}`);
    assert.equal(rs[0].decl['min-height'], '44px', `.${owner} is a 44px target`);
    const s = rs[0].selector.split(/,\s*/).find((x) => x.includes(`.${owner}`));
    assert.ok(cmpSpec(specificity(s), specificity('.sel')) > 0, `${where(rs[0])} must beat .sel by specificity`);
  }
});

// Nutrición's example-food row: the select asks for its chosen name's width (--pick, set by
// nutri-day.js) but never more than the row, and its chevron adds no width (12px box, margins summing to
// minus the row gap), so a long amount wraps under the select and a lone select never passes the card
test('food example row: the select is sized by --pick, capped at the row; the chevron adds no width', () => {
  const one = (sel) => RULES.find((r) => r.file === 'nutri.css' && !r.media && r.selector === sel)?.decl;
  const pick = one('.sel.gd-pick'), row = one('.gd-ex'), chev = one('.gd-ex .sel-chev');
  assert.match(pick.flex, /^1 1 min\(100%, calc\(var\(--pick, \d+\) \* [\d.]+em \+ 52px\)\)$/);
  assert.equal(row['flex-wrap'], 'wrap');
  assert.equal(chev['margin-left'], `calc(-28px - ${row.gap})`, 'pulled back over the pill and the row gap');
  assert.equal(px(chev.width) + px(chev['margin-right']), 28, 'width + right margin give back the 28px pull');
});

// the trend glyph's colours live in ONE block (base.css): arrows are coloured, only the typical /
// steady dot is grey; each tone selector is its class written twice (0,2,0), so it beats a host's
// own colour by specificity, never by stylesheet order
const TONE_CLASS = /\.(db|dd|dt-pill|ld|wp)-(good|bad|watch|neutral|flat|better|worse|typical|up|down)\b/;
const GREY = new Set(['var(--faint)', 'var(--muted)']);
test('trend glyph: one colour block; grey only for the typical dot', () => {
  const toned = RULES.filter((r) => TONE_CLASS.test(r.selector) && r.decl.color);
  assert.ok(toned.every((r) => r.file === 'base.css'), `trend colours outside the block: ${toned.filter((r) => r.file !== 'base.css').map(where)}`);
  const grey = toned.filter((r) => GREY.has(r.decl.color)).flatMap((r) => r.selector.split(', '));
  assert.deepEqual(grey.sort(), ['.db-flat.db-flat', '.dd-typical.dd-typical', '.dt-pill-flat.dt-pill-flat', '.ld-flat.ld-flat'], 'only the dot classes are grey');
  const neutral = toned.find((r) => r.selector.includes('.db-neutral'));
  assert.equal(neutral?.decl.color, 'var(--ink)', 'a change with no good direction is an --ink arrow');
});

// a selector's specificity [ids, classes / attributes / pseudo-classes, elements] (no :is / :not args)
function specificity(sel) {
  const s = sel.replace(/::?(before|after)\b/g, '');
  return [(s.match(/#[\w-]+/g) || []).length, (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length,
    (s.replace(/\.[\w-]+|\[[^\]]+\]|:[\w-]+|#[\w-]+/g, ' ').match(/[a-z][\w-]*/gi) || []).length];
}
const cmpSpec = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
// the elements that carry a tone class, as the client writes them (host class + tone class)
const TONED_HOSTS = [
  ['db-arr', 'db-good'], ['db-arr', 'db-flat'], ['dd-mk', 'dd-worse'], ['dd-mk', 'dd-typical'], ['dt-pill', 'dt-pill-neutral'],
  ['dt-pill', 'dt-pill-flat'], ['ld-pill', 'ld-bad'], ['sc-arrow', 'db-good'], ['sc-arrow', 'db-flat'],
];
test('trend glyph: the tone colour wins the cascade on every host, in ANY stylesheet order', () => {
  // the rules that could colour such an element: a selector whose last compound is made only of the
  // element's own classes (a contextual ancestor, e.g. `.db-stale .db-arr`, is a deliberate override)
  const bad = [];
  for (const cls of TONED_HOSTS) {
    const hits = [];
    for (const r of RULES) {
      if (!r.decl.color || r.media) continue;
      for (const sel of r.selector.split(/,\s*/)) {
        if (/\s|>/.test(sel.trim())) continue;
        const own = sel.match(/\.[\w-]+/g) || [];
        if (!own.length || sel.replace(/\.[\w-]+/g, '') !== '' || !own.every((c) => cls.includes(c.slice(1)))) continue;
        hits.push({ sel, spec: specificity(sel), color: r.decl.color, tone: own.some((c) => cls[1] === c.slice(1)) });
      }
    }
    const tone = hits.filter((h) => h.tone);
    if (tone.length !== 1) { bad.push(`${cls.join(' ')}: ${tone.length} tone rules`); continue; }
    const rivals = hits.filter((h) => !h.tone && cmpSpec(h.spec, tone[0].spec) >= 0);
    if (rivals.length) bad.push(`${cls.join(' ')}: ${rivals.map((h) => h.sel).join(', ')} ties or beats ${tone[0].sel} — the winner would depend on order`);
  }
  assert.deepEqual(bad, []);
});

// Carried values (docs/design-system.md → Carried values): ONE helper decides (HC.carried in util.js)
// and ONE treatment paints it (.carried + .carried-date in base.css); every surface that shows a
// "today" value which may come from an earlier day calls the helper, none rolls its own date compare
// or dim class
const CARRIED_SURFACES = ['web/src/client/score.js', 'web/src/client/deepdive.js', 'web/src/client/monitor.js', 'web/src/client/energy.js', 'web/src/client/timeline.js'];
test('carried values: one helper, one treatment, used by every surface that can carry', () => {
  const own = RULES.filter((x) => /\.carried(-date)?\b/.test(x.selector) && !(x.file === 'base.css' && !x.media && (x.selector === '.carried' || x.selector === '.carried-date')));
  assert.deepEqual(own.map(where), ['score.css `.dial-centre .carried-date`'], 'only base.css styles the treatment (the dial only places the date)');
  const dim = RULES.find((x) => x.file === 'base.css' && x.selector === '.carried');
  assert.ok(dim && dim.decl.opacity && !dim.decl.filter, 'carried = dimmed, colour kept (the stale grey stays the stronger state)');
  for (const f of CARRIED_SURFACES) assert.match(SRC[f], /HC\.carried\(/, `${f} uses HC.carried`);
  // the retired per-surface markers
  for (const [f, src] of Object.entries(SRC)) assert.doesNotMatch(src, /dial-asof/, `${f}: the DS6 .dial-asof is now .carried-date`);
});
