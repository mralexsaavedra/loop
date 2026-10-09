# Design system — tokens, roles, rules

The plan page's small in-code design system: which token an element uses, by what it IS, so a new
card or number never picks its own value. Colours, fonts and the page layout are in
[`plan-page.md`](plan-page.md) → "Look & typography"; this doc covers the ROLE layer on top.

> Area design doc. Read it before changing `web/src/styles/` and keep it in sync with the code in the
> same commit. The guard test `web/test/design-system.test.mjs` enforces the rules below.

## Why

The redesign follows a reference fitness app (WHOOP) as its design reference: flat dark cards with
one small corner radius, one numerals face in a few large steps, and small bold tracked caps for
labels. The page never ships the reference's name, logo, icons or paid fonts — only the look.

A 2026-10-09 audit found no broken screens but drift: primitive tokens existed (`--r-xs … --r-xl`,
`--fs-2xs … --fs-hero`) and nothing bound a role to one, so each card chose its own (Inicio cards at
16 px vs 11 px elsewhere, hero numbers at 20/22/23.4/24/26/28 px in two weights, caps labels at 9.5 px
and 0.06em next to 10.5 px and 0.08em). Role tokens name the choice once; the guard test keeps it.

## Tokens

Primitives (`tokens.css`) stay the scale; ROLE tokens reference them (never a raw value):

| Role token | = primitive | Use it for |
| --- | --- | --- |
| `--card-radius` | `--r-sm` (11 px) | the corner of EVERY card-level fill: tab cards, list rows (`.db-row`), folds (`details`, `.sec-fold > summary`), sheet cards |
| `--card-pad` | `--sp-5` (12 px) | a card's inner padding (Inicio's `.sc-card` and `.eat-card` share it) |
| `--fs-num-row` | `--fs-3xl` (20 px) | a number that heads a row or a small block (Inicio panel rows, meal kcal, fuelling key, adherence) |
| `--fs-num-card` | `--fs-4xl` (28 px) | a card's headline value (eat card kcal, Tonight's clocks, the energy / nutrition %, load cards, recovery card, weight, monitor tiles at >= 900 px) |
| `--fs-dial`, `--fs-hero` | 26 / 56 px | a dial centre — sized to its ring (see "Exceptions") |
| `--num-weight` | 700 | the one weight of a hero number |
| `--fs-section` + `--fw-section` | `--fs-3xl` / 650 | THE section heading, every tab (`.hs-lbl`; see Components) |
| `--fs-title-lg` | `--fs-sm` (12.5 px) | caps tab / page title (`.hs-title`), the Hoy date, journal buttons |
| `--fs-title` | `--fs-xs` (11.5 px) | caps card title, row name, section label (`h2`, `.sc-head h3`, `.db-name`, `.tl-name`) |
| `--fs-label` | `--fs-2xs` (10.5 px; 11.5 at >= 900 px) | caps small label: stat / dial / chip / table head |
| `--label-track` + `--label-weight` | 0.08em / 700 | every caps text |

## Rules

- **Cards.** A rule that paints `var(--card-bg)` or `var(--surface)` and rounds its corners uses
  `var(--card-radius)`. No rule uses a raw px radius >= 8 px; smaller raw radii (bar ends, swatches,
  3 px markers) are fine.
- **Hero numbers.** In the `--num` face, a size of 18 px or more is a step of the scale: row
  (`--fs-num-row`), card (`--fs-num-card`) or a dial centre; weight 700 (`--num-weight`), never 800.
  No other rule sets a raw px size of 18 px or more.
- **Caps.** An uppercase rule sizes itself with `--fs-label`, `--fs-title` or `--fs-title-lg` and
  tracks with `var(--label-track)` — no raw em tracking.
- **Empty states** read in sentence case, like the source strings: a dial word ("Sin sesión aún",
  "Sin datos", `.dial-word`) is muted sentence case at `--fs-label`, as in the deep-dive hero.

### Exceptions (the guard's allowlists, each with its reason)

- Radius: the dock bar and its buttons (`.tabnav`, 24 / 19 px), the "+" popover (`.act-pop`, 12 px),
  the desktop calendar tile (`.cal-day`, 8 px), the segmented-control track (`.dt-range`, a pill) and
  the 2 px contributor marker (`.dd-contrib::before`).
- Hero size: dial centres sized to their ring (Inicio's dials at >= 900 px, Nutrición's kcal dial
  `.nt-kcal`, the deep-dive dial `.dd-num`) and the trend sheet's header value (`.dt-num`); non-number
  glyphs (`.sh-back`, the desktop `.wordmark`).
- Caps: the header date pill (`.date-pill-lbl`, 0.14em — the header stays as is). Caps SIZES in
  `detail.css` are not checked yet: the sheets keep a larger label scale (13.5 / 14.5 px), audited in DS4.

A new exception is a design decision: add it here first, then to the test's allowlist.

## Numbers

ONE formatter for every number a viewer reads: `lib/format/numbers.mjs` (pure, no `Intl`, so every
browser and Node ICU build prints the same bytes). The build imports it (Tablas' `RefTable.astro`,
the advice copy); the page gets the SAME functions as a classic script, `clientSource()` →
`var HC_FMT`, inlined by `layouts/Plan.astro` right before `client/util.js`, whose `HC.num` /
`HC.int` / `HC.nf` / `HC.pct` / `HC.hours` / `HC.duration` add the page `LOCALE`.

| Rule | es | en | Call |
| --- | --- | --- | --- |
| Grouping: EVERY value ≥ 1,000, 4 digits too | `2.500`, `13.463` | `2,500` | `HC.int(v)`, `HC.num(v, dec)` |
| Decimals: fixed per call site, comma in es | `7,5`, `1.234,6` | `7.5` | `HC.num(v, 1)`; `HC.nf(v)` keeps the value's own decimals |
| Sign: `+` only when asked; a value that rounds to 0 has none | `+0,3`, `0,0` | `+0.3` | `HC.num(v, 1, true)` |
| Percent: no space | `97%`, `+12%` | `97%` | `HC.pct(v[, signed])` |
| Durations: h:mm, minutes rounded first (7.999 h → `8:00`) | `7:01`, `0:37`, `27:06` | same | `HC.hours(h)`, `HC.duration(min)` |
| Absent (null, NaN, ±Infinity, '') | `—` | `—` | every function |

- **Why force 4-digit grouping.** es-ES `Intl` leaves 4 digits ungrouped (minimum grouping digits 2),
  so the page printed "2500 kcal" next to "13.463 pasos" and "2.300 kcal" (one hand-rolled grouper).
  One rule everywhere reads better than the locale's edge case.
- **Hours.** Sleep, time in bed, stages, REM + deep, activity and ride durations, the sleep target and
  every delta of them are h:mm WITHOUT a unit ("7:32", "+0:02 vs your 7:30 target"); the old
  decimal hours ("7,5 h") and "1 h 45 min" are gone. A metric whose unit is `h` drops the unit where it
  is shown (`unitOf` in `detail.js`, `mrow` in `health.js`, `compUnit` in `score.js`, the monitor).
  Baked sleep hours keep 2 decimals so h:mm is exact to the minute.
- **Units** stay a separate, smaller span where they already were (`<b>2.532</b><small>kcal</small>`).
- **Input fields** (food amounts, the target weight) are NOT display: `HC.numInput` keeps the decimal
  comma but never groups, so the field parses its own value back.
- **Not durations of a value, left as words:** minute COUNTS that are a metric of their own (Apple
  exercise minutes "45 min", sleep consistency "19 min", the ±′ bedtime spread), whole-hour ranges
  ("2–3 h before"), relative ages ("3 h ago") and category labels ("< 30 min", "Ride ~2 h").
- **Not display:** CSV / data outputs, the food log's stored entry names ("Arroz · 1,5 ud", mirrors
  `lib/nutrition/basics.mjs`), the plan's portion factor port (pinned to `lib/nutrition/scale.mjs`)
  and SVG / CSS geometry (`toFixed` for coordinates) keep their own code.

The guard `web/test/number-format.test.mjs` scans the display sources (client scripts, views, tabs,
components, the layout, i18n, the advice copy; comments stripped) and fails on `toLocaleString` /
`Intl.NumberFormat`, a hand-rolled thousands grouping, a hand-made decimal comma, a `toFixed` that is
not geometry (per-file counts), a space before `%`, and a `{value} h` template or a `' h'` built in
code; each exception above is its allowlist. `lib/format/numbers.test.mjs` pins the rules (es + en,
0, negatives, absent, 999 / 1,000, h:mm rounding) and that `clientSource()` behaves like the module.

## Components

One shared class set per pattern; a new card reuses it instead of styling its own.

### Section heading

`.hs-lbl` (`health.css`) is THE section heading on every tab: sentence case at `--fs-section` /
`--fw-section`, no tracking. In a section it sits in the `.hs-head` row with the optional ⓘ
(`HC.infoBtn`) on the right; on Inicio it stands alone as `.hs-lbl.home-h` (`home-h` adds only the
block spacing). Caps at `--fs-title` stay for what is INSIDE a card (card titles, row names), so a
section heading never looks like the card under it.

- **Duplicate titles.** When a section holds one card whose title would repeat the section heading,
  the section heading stays and the card drops its title — but only the title: anything else in the
  card's head (an as-of date, a CTA, its ⓘ) stays. Today: Salud's Recovery card (`score.js`
  `recoveryHtml`). A card with its own name (Entreno "Load vs recovery" → "Weekly cardiovascular
  load") keeps it.
- **Not section headings:** the tab title (`.hs-title`, centred caps), fold rows (`.sec-fold > summary`,
  a card-level row with a caps title) and in-card titles (`.sc-head h3`).
