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
| `--fs-section` + `--fw-section` | `--fs-3xl` / 650 | a sentence-case section heading (Inicio's "My day", `.home-h`) |
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

Stub — filled by DS2: one number / duration formatter (es-ES grouping, sleep as h:mm, one % rule).

## Components

Stub — filled by DS3, one shared class per pattern:

- Section heading (one style for every tab's sections).
- CTA link.
- Chevron (one size and colour; also the trend sheet's date navigation).
- Segmented control and the selected chip.
- Trend glyph (coloured ▲▼, grey dot for typical).
