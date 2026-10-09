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
| `--fs-title-sheet` | `--fs-md` (13.5 px) | a sheet's own caps title (`detail.css` only: `.sh-title`, `.dt-month`, `.dt-word`, `.dd-lbl`, `.ds-band`) |
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
  the desktop calendar tile (`.cal-day`, 8 px) and the 2 px contributor marker (`.dd-contrib::before`).
- Hero size: dial centres sized to their ring (Inicio's dials at >= 900 px, Nutrición's kcal dial
  `.nt-kcal`, the deep-dive dial `.dd-num`) and the trend sheet's header value (`.dt-num`); non-number
  glyphs (`.sh-back`, the header `.wordmark`, phone and desktop).
- Caps: the header date pill (`.date-pill-lbl`, 0.14em — the header stays as is). The sheets' own caps
  title (the sheet header, the trend's month and day word, the deep-dive dial label, the stress band
  word) is one step up, `--fs-title-sheet` (13.5 px; the stress band was 14.5 px), allowed in `detail.css`
  only; every other caps size in the sheets is a card caps token like anywhere else.

A new exception is a design decision: add it here first, then to the test's allowlist. An allowlist
key names the file, the media query and the selector (`training.css @media (min-width:900px) .cal-day`),
so an exception at >= 900 px never excuses the phone rule. A selector counts as a number when a rule of
the SAME stylesheet puts it in the `--num` face — at the top level or in the same media query — a grouped
`.a, .b { font-family: var(--num) }` included.

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

The guard `web/test/number-format.test.mjs` scans the display sources (`web/test/display-sources.mjs`:
client scripts, views, tabs, components — sub-folders included — the layout, i18n, the advice copy;
comments stripped) and fails on `toLocaleString` / `Intl.NumberFormat`, a hand-rolled thousands
grouping, a hand-made decimal comma (string or regex form), a `toFixed` that is not geometry (per-file
counts), a space before `%` (a template literal's `${v} %` too), and a `{value} h` template, a `' h'`
or a `${v} h` built in code; each exception above is its allowlist. `lib/format/numbers.test.mjs` pins the rules (es + en,
0, negatives, absent, 999 / 1,000, h:mm rounding) and that `clientSource()` behaves like the module.

## Components

One shared class set per pattern; a new card reuses it instead of styling its own.

### Section heading

`.hs-lbl` (`health.css`) is THE section heading on every tab: sentence case at `--fs-section` /
`--fw-section`, no tracking. In a section it sits in the `.hs-head` row with the optional ⓘ
(`HC.infoBtn`) on the right; on Inicio it stands alone as `.hs-lbl.home-h` (`home-h` adds only the
block spacing, in a rule written `.hs-lbl.home-h` so it beats `.hs-lbl`'s `margin: 0` by specificity,
never by stylesheet order — guarded). Caps at `--fs-title` stay for what is INSIDE a card (card titles, row names), so a
section heading never looks like the card under it.

- **Duplicate titles.** When a section holds one card whose title would repeat the section heading,
  the section heading stays and the card drops its title — but only the title: anything else in the
  card's head (an as-of date, a CTA, its ⓘ) stays. Today: Salud's Recovery card (`score.js`
  `recoveryHtml`). A card with its own name (Entreno "Load vs recovery" → "Weekly cardiovascular
  load") keeps it.
- **Not section headings:** the tab title (`.hs-title`, centred caps), fold rows (`.sec-fold > summary`,
  a card-level row with a caps title) and in-card titles (`.sc-head h3`).

### CTA link

`HC.cta(label, attrs)` (`client/util.js`) writes THE call-to-action link: a `<button class="cta">`, the
label in caps (`--fs-title-lg`, `--label-weight`, `--label-track`) in `--link` blue, then " →" (hidden
from screen readers), at least 44 px tall. Astro writes the same markup (Inicio's eat card "See the full
plan →"). On the deep-dive insight card the text is the `--link` → `--link-end` gradient, the only
place it passes contrast (`--ground`, `tokens-contrast.test.mjs`). Uses: the insight "See my … trend",
the recovery card's "History", Tonight's "See sleep history", the trend sheet's "Learn more".

- **CTA vs button.** A CTA goes somewhere (opens a sheet, scrolls, switches tab). A real action
  (save, add, the journal's behaviour insights, Customize) keeps its button / pill style.
- **CTA vs `.lnk`.** `.lnk` is the underlined link INSIDE a sentence (a table jump, "retry").
- Guard: only `.cta` and `.lnk` paint text in `--link`, and only `.dd-insight .cta` clips the gradient
  to text.

### Chevron and step navigation

ONE chevron: the "›" glyph (‹ for previous) in `--muted`, at `--chev-size` (`--fs-xl`, 15.5 px),
regular weight. `base.css` holds its look in one grouped rule: the `.chev` span (dial labels, monitor
tiles, the outlook bar, My plan, the journal card, folds such as Nutrición's Today's plan and
Equivalences, the trend sheet's metric picker) and the generated chevrons (every opener
`[data-detail][role="button"]`, Nutrición's meal rows, the recovery card's last-14-days fold). Each
owner only places or rotates it (a fold turns it 90°; My plan's points down); it never sets a colour
or size of its own. In markup a ‹ / › is always `<span class="chev" aria-hidden="true">`.

Step navigation (‹ ›) is `.nav-btn`: a bare 44 px target holding a `.chev`, at 35 % when disabled —
the trend sheet's window, its calendar month (formerly 44 px filled circles) and Registrar's day.

- **Exceptions:** the sheet header's back "‹" (`.sh-back`, a header control sized with the title) and
  the top bar's "‹ Today ›" pill (the header stays as is).
- Guards: no CSS rule but the shared one gives a chevron (a `*chev*` class or a `content: "›"`) a
  colour / size / weight; every ‹ › glyph in the display sources sits in a `.chev` span (allowlist:
  `util.js` sheet header).

### Segmented control and selected chip

- **Segmented control** `.dt-range` (`detail.css`): THE switch between views of one thing — the trend
  sheets' W · M · 6M · 1Y, Entreno Activity's W · M · 6M (formerly a big pill track with a white thumb)
  and the food sheet's source tabs (`.dt-range-fill`: full width, one equal column each; formerly their
  own trough and pressed style). Dark 28 px squares (`--rail`, `--r-xs`, min 32 px wide), caps at
  `--fs-label`; the pressed one `--track` with `--ink` text; each button keeps a 44 × 44 px hit area
  (`::after`, 8 px above / below and 6 px each side) and the 12 px gap keeps neighbours' areas apart
  (guard: `design-system.test.mjs`).
- **Chip** `.chip` (`base.css`): a compact 30 px caps pill (1 px `--line` outline) to pick one of a few
  — Nutrición's day type and Constancia window (radios: `.seg-opt` + `.chip.seg-in`) and the load
  sheet's modality switch (`.chip.dial-mod`, which adds the 44 px `::before` hit band). The picked
  chip is white-filled (`--accent` / `--on-accent`), the reference app's selected filter; the load
  sheet's teal outline is gone. Text only: Nutrición's day types dropped their 1440-px-only icons
  (with icons the four chips need ~370 px and wrap at 360–390 px).
- **Switch** `.sw` (`base.css`, `HC.switchBtn(on, label, attrs)`): show / hide ONE item — Customize
  dashboard's metrics and the journal's behaviours (formerly a heavy white "SHOWN" pill next to a bare
  "HIDDEN" word). `role="switch"` + `aria-checked`, no visible word (the label says what it shows); a
  34 × 20 track, knob left on `--rail` (off) or right on `--accent` (on); the button is the 44 px hit
  area. Not a pick of one among several — that is the chip.
- Guard: a pressed / checked state that fills or outlines is the chip's, the segmented control's or
  the switch's; the others are listed with their reason: the trend calendar's selected day (a ring on a
  day cell) and the journal's ✕ / ✓ answers (the reference's answer pair, each a yes / no of its own
  question — not a pick among options, so neither a chip nor a segment).

### Metric row

`HC.metricRow(o)` (`client/util.js`, `.db-*` in `score.css`) is THE list row of Salud, My dashboard, the
monitor and Entreno's run / ride / intensity lists: icon · caps name · value (+ unit) · trend glyph, and ONE
small secondary line under the value, right-aligned (`base`) — nothing under the name (the rides' line
under the date is gone, so run and ride rows are one template). Icons come from ONE set (`metricIcon`,
which falls back to the contributor rows' paths): each row picks the icon of what it measures (a
modality, bed, wake, target …), a neutral one when none fits; never the same icon on every row of a list.

### Contributor row

`HC.contribRow(o)` (`client/util.js`; styles `.dd-row` / `.dd-ico` / `.dd-mk` in `detail.css`) is THE row
for a score's inputs: a stroked icon (`HC.contribIcon`, one 24-unit path per row key), the caps label
(+ an optional small sub line), the value, and the trend glyph with its screen-reader words. Uses: the
deep-dive sheets' contributors (recovery, sleep, load, strain, energy bank) and Salud's Recovery card
(formerly a 2 × 2 grid of state-coloured dots). On the card the glyph is the raw direction of the 7-day
mean vs the baseline (a lower resting HR is ▼) coloured by the band (above = better, below = worse,
at = the grey •).

### Trend glyph

▲ / ▼ for a change, • for typical / steady. `HC.trendTone(arrow, tone)` (`client/util.js`) picks the
colour class: `good` (`--up`) / `bad` (`--down`) / `watch` (`--mid`) by the metric's good direction,
`neutral` (`--ink`) for a change with no good direction (weight, expenditure, light sleep, respiratory
rate, bedtime, training time), and `flat` (`--faint`) ONLY for the •. Never a grey arrow. Used by every
metric row (`HC.metricRow`: Inicio's dashboard, Salud, the monitor), the trend sheet's delta pill and
Entreno's total-time pill; the deep-dive contributors map the same tones (`dd-better` / `dd-worse` /
`dd-neutral` / `dd-typical`), and the Salud recovery card's 7-day trend glyph (`.sc-arrow` + `db-*`;
formerly its own band colours). The colours live in ONE block in `base.css`, each class written twice
(specificity 0,2,0) so it beats a host's own colour (`.dt-pill`'s grey) by specificity, whatever order the
stylesheets load in; `design-system.test.mjs` checks the cascade on every host.

- Guard: no other rule colours a trend class, and only the dot classes are grey; `util.test.mjs` pins
  that `trendTone` never returns `flat` for an arrow.
