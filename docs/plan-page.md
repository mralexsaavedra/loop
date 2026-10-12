# Plan page — Astro build, tabs, look

The single-file Astro page in `web/`: build modes, shared client helpers, tabs and sections, URL hash, look & typography.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## The plan page — Astro single-file build

The plan page (4 tabs, Whoop-style — see "Tabs and sections" below) is ONE Astro project
in `web/` that builds to a single self-contained HTML file — no external requests, no
`_astro/` asset directory, CSP-safe. `scripts/build-web.mjs` drives the build:

```
node scripts/build-web.mjs [--mode personal|example] [--locale es|en]   # or DATA_MODE/LOCALE env vars
```

writing `web/dist/<mode>/index.html`. `npm run build` = personal/es (default); `npm run
build:example` = example/en (tracked seeds + the synthetic demo extract, no personal files needed). The domain
compute (macros, training program/dashboard, health aggregation) lives in root `lib/*.mjs`, shared by
the Astro build, `data/nutrition/generate.js`, and the test suite — one source, not three. Most of `lib/` is
pure; some modules still read their input files themselves (`node:fs`), so only the pure ones can be emitted
into the page via `clientSource()`. Convention: an area's file reads live in `lib/<area>/read.mjs`
(`health`, `journal`, `nutrition`, `profile`, `score`, `training` so far) and compute modules take their data as arguments;
`lib/fs-boundary.test.mjs` pins the exact set of `lib/` modules that import `fs`, so a new compute module
that reads files fails the suite (the remaining non-`read.mjs` entries are still to be split).

- **Inlined client scripts are slimmed.** `web/layouts/Plan.astro` inlines every `web/src/client/*.js`
  through `web/src/slim-script.mjs` `slimScript` (esbuild `transformSync`; esbuild is declared in package.json at the exact version astro / vite lock:
  `minifyWhitespace`, `legalComments: 'none'`, `charset: 'utf8'`; NO identifier renaming, NO syntax
  rewriting, still a classic script). Source files keep their comments; the built page does not
  (string quotes / number literals may be re-printed, e.g. `'x'` → `"x"`). A test that locates or
  matches a script in the built HTML compares against `slimScript(source)` or a whitespace / quote
  tolerant regex, never the raw file. Baked JSON globals are not touched.
  The inline CSS gets the same treatment: the `slim-inline-css` integration (`web/astro.config.mjs`) runs
  every built `<style>` through `slimStyle` (same module, esbuild `loader: 'css'`, whitespace + comments
  only; Vite's `cssMinify` stays off), so CSS tests parse it through `web/test/css-scan.mjs` (`a>b`, `[t=x]`).
  `web/test/css-parity.test.mjs` checks the example build's declarations against
  `web/test/fixtures/css-expected.json` both ways (dropped/changed AND added declarations fail); after a
  deliberate CSS change run `npm run test:css:update` (after `npm test` / `npm run pretest`), which rewrites
  the fixture keeping key order, appending new keys and deleting stale ones.
- **Script order: one manifest.** The client scripts are classic `is:inline` scripts that talk only through
  page globals, so their order is a contract. `web/src/client/manifest.mjs` (`CLIENT_SCRIPTS`) is its ONE source:
  `layouts/Plan.astro` inlines every `web/src/client/*.js` (`import.meta.glob` `?raw`) in that order, after the
  bakes and `HC_FMT … HC_GUIDE`. Each entry declares `provides` (top-level `var` / `function` names + every
  `window.X =` write), `requires` (globals READ while it runs at load, each baked or provided EARLIER; reads in
  handlers, timers and fetch answers do not count) and `probes` (load-time reads of a LATER script's global,
  always feature-detected, the later script calls back). `web/test/script-manifest.test.mjs` checks every file is
  listed once and inlined in that order, `provides` against a static scan, `requires` / `probes` against the order,
  and runs a vm load trace of the example page (`web/test/script-trace.mjs`: plain load + the `#profile`,
  `#tonight`, `#detail/sleep` deep links) that fails on any undeclared load-time read or `window` write. A new
  script goes into the manifest at its place; the test names what to declare.

- `LOCALE`: env var → `plan.locale` → `en` (the user's `plan-data.json` sets `locale:"es"`).
- `DATA_MODE=personal|example`: personal reads the gitignored real files; example reads the
  tracked `.example` seeds plus the tracked, clearly SYNTHETIC demo extract in `data/demo/extract/`
  (so the example page shows every dial and section). Optional data (Apple Health extract CSVs)
  renders a defined empty state when absent, in either mode — the build never fails on missing
  optional data.
- **Demo data** — `scripts/make-demo-data.mjs` (`npm run demo:data`) writes the demo extract from a
  seeded PRNG and a FIXED end date (deterministic bytes; `--end/--days/--seed` to change them). Every
  row is tagged `Demo …`; `data/demo/README.md` says it is fake. A test fails if the tracked files
  drift from the generator, so re-run it after changing the generator or a CSV schema. Never put real
  measurements in `data/demo/` (it is tracked); the example page reads as stale a few days after
  the demo end date, which is the normal staleness handling.
- **Shared client helpers.** `web/src/client/util.js` is inlined FIRST (right after `var NAV` and
  `var HC_CONST`, baked by `layouts/Plan.astro` from `lib/stale.mjs`) and exposes the global `HC`
  (window.HC): `lan()` (false when the page is opened from `file://`: every LAN fetch — `/api/food/*`,
  `/api/journal/*`, `/api/sync/status` + Sync, `/status.json`, the `/manuales/` probe — is skipped there and the
  page degrades exactly as with the services down, with no console errors; read at call time, no location = served),
  `esc`, `format`, `isoDate`, `todayIso`, `daysOld`, `shiftIso`, the number helpers `nf`, `num`,
  `int`, `pct`, `hours`, `duration` (h:mm), `numInput` (an input field's value, never grouped) — thin wrappers that
  add the page `LOCALE` to `HC_FMT`, the ONE number formatter (`lib/format/numbers.mjs` `clientSource()`, inlined
  right before util.js; rules in [`design-system.md`](design-system.md) → "Numbers"; the same script carries
  `HC_BAND`, the recovery 0–100 bands `PCT_GOOD` / `PCT_LOW` / `pctBand` from `lib/score/recovery.mjs`
  `clientSource()`, which the recovery % colour and the energy bank read instead of literals, and `HC_ADH`, the
  food log adherence functions from `lib/nutrition/adherence.mjs`, which `client/adherence.js`
  runs instead of a copy, and `HC_PROG`, the weight progress functions from `lib/nutrition/progress.mjs`,
  which `client/progress.js` runs, and `HC_NSCORE`, the nutrition score from
  `lib/nutrition/score.mjs`, which `client/nutri-score.js` runs, and `HC_FOODLOG`, the food log
  formula from `lib/nutrition/foodlog.mjs`, which `client/food-core.js` runs, and `HC_DAYTYPE` / `HC_FUEL`, the
  day type detection and ride fuelling from `lib/nutrition/daytype.mjs` / `fuel.mjs`, `HC_SCALE`, the portion
  scaling from `lib/nutrition/scale.mjs`, and `HC_GUIDE`, the portion guide from `lib/nutrition/guide.mjs`, which `client/nutri-day.js` runs —
  every nutrition global emitted by `lib/nutrition/client.mjs` `clientSource()` from the modules' `CLIENT` descriptors), `MS_PER_DAY`, `STALE_DAYS`, the ONE display-date formatter `fmtDate`
  ("lun 29 sept" / "Mon 29 Sep") + `fmtMonth` + `weekdayIndex` (Monday = 0; names baked as `I18N_DATE`
  from `web/src/i18n/date-templates.mjs`, not Intl, whose ICU builds disagree) — EVERY user-visible
  date goes through it (ISO only in data attributes / ids; a test fails on any `toLocale*String` /
  `Intl.DateTimeFormat` in `web/src/client`; `loadUtil` bakes `I18N_DATE` by `LOCALE`), and `detailAttrs`
  (the detail-sheet opener markup, see "Detail views"), `registerView` / `view` (the detail sheet's
  registered views, the one writer of `window.HCViews`, `docs/detail-views.md`) and `rolloverAction` (the midnight rollover:
  core.js captures the viewer's day at load and, when the page becomes visible on another day,
  reloads once, so the dials, top-bar date, timeline, day type and rings move to the new day; while
  the page is BUSY — the detail sheet `#detail` open, a Mis productos / Mis recetas editor open (a form
  field inside `#fp-body` / `#fr-body`) or a text field focused — it waits: a 1 s watcher runs only
  while there is something to wait for, stops on `none` (hidden page, clock back) and is re-armed by
  `visibilitychange` / `pageshow`; a `location.reload()` that throws (sandboxed frame) is retried only
  by a later event, never in a loop). The client scripts read these instead of
  redefining them (a test guards it), and constants come baked from `lib/` (`STALE_DAYS` via
  `HC_CONST`; the calendar's `windowDays` / `levelMin` via `activityBake` into `ACTIVITY`), never as
  client literals. Tests load it with `web/test/client-util.mjs` `loadUtil(ctx)`.
- All personal COPY (page title/kicker/h1/sub/footer, per-slot notes, which tabs/sections to hide)
  lives in `plan-data.json`'s `page` block (`page.notes.<slotId>`, `page.hideTabs: ["hoy"]`,
  etc.) — never hardcoded in tracked Astro/JS source, which stays fully generic.
- **No hero header** (navigation shell, 2026-10). Only `page.title` is required; `page.h1` /
  `page.sub` / `page.kicker` stay optional and validated when present (h1 a non-empty string, sub a
  string), but the page no longer DRAWS a header block: `layouts/Plan.astro` renders ONE visually
  hidden `<h1 class="sr-only">` with `page.h1` (else the page title), and the kicker / subtitle are not
  shown. The page opens on the top bar and the dials.
- **Brand: LOOP.** The `<title>` and `<meta name="apple-mobile-web-app-title">` are the product name
  (`strings.brand`, the same in every locale; the personal `page.title` only names the hidden h1 when
  `page.h1` is absent). Icons ship as `data:` URIs in `<head>` (the page stays one file; the output
  guard's `html-scan.mjs` treats `data:` hrefs as self-contained): the favicon = `loop-favicon.svg` (a
  32 px rounded dark tile, vertical gradient `#283037` → `#111619`, the three-arc ring) and the
  `apple-touch-icon` = `loop-touch-icon.png` (180×180, full square: iOS rounds it). On every tab the
  **wordmark** (`.wordmark`, rendered by `layouts/Plan.astro` INSIDE `.topbar`, between the avatar and the
  date pill) sits in the top bar's middle column on a phone (avatar · LOOP · freshness / Sync on one row);
  from 900 px it takes the bar's first column on the left (the 960 px column's left edge, 30 px letters
  ≈ 20 px caps) and the avatar moves to the right end beside the freshness / Sync controls, so the pill stays centred (`desktop.test.mjs` pins it): "LOOP" with L and P as
  Syncopate Bold outlines (never the font: Apache 2.0, `web/src/fonts/LICENSE-Syncopate.txt`), the
  first O a plain ring, the second the three-arc ring (sleep · recovery · strain clockwise from 12
  o'clock); 19 px letters (caps ~12.7 px), letters + plain ring `currentColor` (`--ink`), arcs coloured
  by `--sleep` / `--good` / `--strain` in `layout.css` (the svg's hex attributes are only the standalone
  fallback). All four files in `web/src/assets/` are GENERATED: geometry in `scripts/loop-logo.mjs`
  (ring r = 50 − sw/2, arcs C/3 − sw − 3 with round caps, rings 0.71em on the baseline −0.02em, the same
  0.14em gap ink to ink between every pair of neighbours, so P's wide left side bearing adds nothing), written by `node scripts/make-logo.mjs path/to/Syncopate-Bold.ttf`
  (source + sha256 in the script header); `scripts/loop-logo.test.mjs` fails if they are hand-edited,
  `web/test/brand.test.mjs` pins the built head and wordmark.
- **Top bar** (`.topbar`, above the dock, on every tab, a 3-column grid so the middle stays centred;
  phone: avatar · wordmark · freshness / Sync on row 1 and the date pill centred on row 2; from 900 px one
  row: wordmark left · pill · Sync + avatar right. The date pill steps Inicio's day, so it is Inicio only:
  `.wrap:has(> .tab-panel[data-tab="home"][hidden]) > .topbar > .date-pill` hides it and Salud, Entreno
  and Nutrición show their centred title under the header row): avatar left (`components/Avatar.astro`, 36 px circle in a 44 px target, opens the profile
  sheet) · a centred date pill "‹ HOY ›" / "‹ TODAY ›" (`.date-pill`, uppercase, letter-spaced; the
  viewer's full date ("mié 30 sept" / "Wed 30 Sep") is the `<time id="today-date">` inside it, written
  client-side by `web/src/client/today-date.js` with `HC.fmtDate` and read by assistive tech only,
  nothing time-based baked, builds stay byte-identical; day stepping below) · freshness on the right: status dot + short
  freshness (`#fresh-sum`, the Shortcut age; the dot carries the worst source level; tap = the
  per-source popover `#fresh-pop`, right-aligned under the bar, capped at the bar width, z 40 like the
  sync line `#sync-msg` so both overlay the dock (z 30) and the collapsed dial row (z 25) but not the
  detail sheet (z 60)) + icon-only Sync (`#sync-btn`, circular-arrows SVG, `aria-label`, 44 px, class
  `is-busy` spins it while syncing, no spin under reduced motion). **Day stepping** (`client/today-date.js`, `window.HCDay`): `#day-prev` ‹ / `#day-next` › (44 px
  targets overhanging the 32 px pill, line chevrons) step Inicio one day back / forward; › is disabled
  on the viewer's today, ‹ at the oldest reachable day = the baked history's first day
  (`SCORES.days.from`, `lib/score/days.mjs`, 14 days), never more than `NAV.day.maxDays` (30) before
  today. Both ship `hidden` and the script shows them (and adds `.has-steps`) only when a past day is in
  reach: no data, or data far behind the viewer's clock, leaves the pill as it was (no dead control).
  On a past day the label (`#day-word`) shows its date ("mar 6 oct", uppercased by CSS → "MAR 6 OCT")
  and the label button (`#day-lbl`, `aria-live="polite"`, `aria-disabled` on today) returns to today
  (`aria-label` "<date> · Volver a hoy"). Keyboard: ← / → while focus is inside the pill (focus moves
  to the label when the focused chevron turns off). The day is in the hash (`#d=YYYY-MM-DD`, see
  "URL hash" below), replaced — never pushed — and only while Inicio is shown and the sheet is closed.
  `HCDay` = `{sel() (null = today), iso(), oldest(), set(iso|null), step(±1), hash(), on(fn)}`;
  listeners run in their own try/catch. What follows the day on Inicio: `docs/home-tab.md`.
- **Bottom dock** (`.dock`, every width): a floating rounded tab bar (`rgba(var(--nav-rgb), 0.94)`,
  blurred, 24 px radius, max 440 px, centred) with the four tabs as icon + small sentence-case label
  (active white, inactive `--faint` grey), and to its RIGHT, outside the tablist, a separate 56 px
  white circular **"+" action button** (`#act`, `client/nav-actions.js`). The "+" opens a navy → violet
  popover card (12 px radius, a gradient from `--link` at 15 % to `--insight-b` at 62 %, each mixed into `--surface`, 47 px
  icon + uppercase label rows; a scrim under the dock dims the page 40 % with a light 4 px blur;
  the "+" turns 45° into an "×" and its label becomes "Cerrar acciones"); Escape, the button again or a
  tap outside the card closes it, Tab stays inside (button + listed actions) and focus returns to the
  button. It lists only REAL actions available on this page, decided at view time: **Añadir comida**
  (the food log's add sheet, `HCViews['food-add']` via the detail sheet: only once `/api/food/products`
  answered, the same LAN-only gating as Registrar), **Completar el diario** (the journal sheet,
  `HCViews.journal`: only once `/api/journal/settings` answered, `docs/journal.md`) and **Sincronizar** (clicks the top bar's Sync: only
  while the freshness group is shown, i.e. `/api/sync/status` answered). They appear asynchronously, so
  `food-log.js`, `journal.js` and `freshness.js` call `HCActions.refresh()`. The root and every row ship `hidden`: in
  the example build, `file://` or any static copy no action exists and the "+" never shows (no dead
  control). Wide screens (>= 900 px) keep the SAME floating bottom dock, centred (no sticky top nav any
  more), so jump targets only clear the collapsed dial row (`scroll-margin-top: 64px`). One token,
  `--dock-room` (`calc(96px + env(safe-area-inset-bottom))`: the 64 px bar, its 10 px lift, 22 px of
  air, the home-indicator inset), keeps the bottom free: the body pads every tab's end with it and
  `html { scroll-padding-bottom }` keeps a focused or jumped-to element above the bar
  (`web/test/mobile.test.mjs`).

**Tabs and sections.** Four top-level tabs, one question each (Whoop-style: the glance on Inicio,
the detail one tap away). Nav = the floating bottom dock above (four equal buttons that fit a 360px
phone next to the "+", safe-area insets on bottom/left/right) at every width. The former tabs
live on as SECTIONS (`data-section="<key>"`, `id="sec-<key>"`):

| Tab (key) | Content, top to bottom |
| --- | --- |
| 🏠 Inicio (`home`) | TODAY: Sleep / Recovery / Load dials; monitor tiles (summary + HRV); "My day": the advice as the outlook bar + "Today's activities" (last night's sleep, the day's workouts, the programmed session `hoy` as a row); "today you eat" card (today's day type + goal and target kcal/macros, link to Nutrición); Tonight, My plan, My dashboard |
| 🏃 Entreno (`entreno`) | centred title + ⓘ; per-modality load summary cards, caveats behind ⓘ (`load`: `#score-load`, the detail behind the load dial); the Activity card — total time with W / M / 6M, sessions / days / per week, modality split bar, compact 30-day calendar (`calendar`: `#train-activity`); running table, cycling table, load vs recovery (`sessions`: `#health-train`); Intensity (HR), the rest of the former workouts dashboard (`dash`) |
| 💗 Salud (`health`) | centred title + ⓘ over a green glow; the health monitor list (`#monitor`, Inicio's summary tile jumps here); Recovery (`#hl-recovery`: the recovery card `#score-recovery`, plus any of resting HR / HRV / respiratory rate / wrist temp the monitor lacks); Fitness (VO₂max, walking HR); Sleep (`#hl-sleep`); Body composition; Activity; Energy (expenditure + the intake cards until Nutrición takes them) — metric rows, notes behind ⓘ |
| 🍽️ Nutrición (`nutricion`) | the centred title + ⓘ header (like Salud / Entreno), then today (`dia`: Resumen de hoy (kcal ring + macro rows) + intake rings, Registrar (the FOOD LOG, LAN page only), Plan de hoy (a PORTION GUIDE: Desayuno / Comida / Cena + Extras with today's budgets, in a `<details>` fold, collapsed by default), Avituallamiento on bike days, Balance (intake vs expenditure + the macro split, moved from Salud), Progreso (weight vs the goal), Constancia (food log adherence, LAN page only) — see "Nutrition v2", "Nutrition v2 part 2" and "Nutrition v2 part 3" below); Mis productos + Mis recetas (collapsible, LAN page only, no section key: rendered with `dia`); Tablas (`tablas`, collapsible: FIXED reference values per natural unit, never portions — see "Tablas = fixed reference values" below) — there is no train/rest toggle: Resumen de hoy's day type is the one selector. |

`lib/nav/tabs.mjs` is the ONE source of the tab keys (`TAB_KEYS`) and of the legacy-section map
(`SECTION_TAB`); the page derives each tab's section list from it (`sectionsOf`) and bakes both as
`NAV` for core.js. `page.hideTabs` semantics (resolved by `resolveNav`): a top-level key
(`home`/`entreno`/`health`/`nutricion`) removes that nav button; a section key (`hoy`/`load`/
`calendar`/`sessions`/`dash`/`dia`/`tablas`) renders that section `hidden`. Panels,
sections, baked globals and scripts always stay in the build (the shared `components/Bake.astro`
renders once from `web/pages/index.astro`, outside every section; Tablas is server-rendered from
`lib/nutrition/reference.mjs` and needs no bake or script). `registro` (the removed day
builder) is DEPRECATED: `DEPRECATED_SECTIONS` in `lib/nav/tabs.mjs`, still accepted in
`page.hideTabs` (an existing personal plan may carry it) and a no-op — it never counts towards hiding
Nutrición. Nutrición and Entreno are made ONLY of
sections (they carry `sections` in `resolveNav`): each disappears when ALL its sections are hidden —
hiding `dash` alone hides only the dashboard, Entreno stays; the visible tab on load is the first remaining one;
hiding every tab fails the build. `setTab('<legacy key>')` still works (it opens the hosting tab and
scrolls to the section — `setTab('dash')` opens Entreno). The intake rings read today's target from Resumen de hoy (see
"Nutrition v2"), whatever `page.hideTabs` hides; the "today you eat" card drops its link when
Nutrición is hidden.
**The open tab lives in the URL hash** (`#home` / `#entreno` / `#health` / `#nutricion`), so a reload,
a bookmark and the midnight rollover's reload reopen it. core.js `setTab` writes it with
`history.replaceState` (never `pushState`: Back does not walk through tabs, it keeps closing the
detail sheet); a legacy section key writes its HOSTING tab's hash; a tab hidden by `page.hideTabs`
(no nav button) is never written, and nothing is written while the sheet is open (its `#detail/…`
owns the URL). On load: a visible tab hash opens that tab; no hash, a hidden or an unknown one opens
the default tab (the one the server rendered) and the URL is replaced to match; a sheet deep link is
left to detail.js and its HOST tab is shown underneath (`DETAIL_TAB` / `VIEW_TAB` in
`lib/nav/tabs.mjs`, baked in `NAV`: Salud metrics → `health`, `workouts` / `load-*` → `entreno`,
`food-add` → `nutricion`, `hoy-session` / `tonight` / `dash-edit` → `home`, `profile` → none = the default tab; an in-page anchor of `ANCHOR_TAB` (`#monitor` → `health`) shows its tab, keeps the hash and scrolls to the block, on load and on `hashchange`; a test pins every `DETAIL_KEYS` key).
`hashchange` to a visible tab hash switches tab; a sheet, hidden or unknown hash switches nothing, so
it never fights detail.js's popstate. Every history / location access is in a try/catch (a sandboxed
frame still switches tabs). `window.HCNav.hash()` = the current tab's hash, read by detail.js.
**A past day of Inicio** (the top bar's day stepping) is `#d=YYYY-MM-DD` (`DAY_HASH` in
`lib/nav/tabs.mjs`, baked as `NAV.day`; `parseDayHash` / `dayHash` for tests): core.js shows Inicio
for it and KEEPS the hash, on load and on `hashchange` (client/today-date.js validates the day and
replaces an out-of-reach one with `#home`); while a past day is selected Inicio's hash is that day —
`setTab('home')` and `HCNav.hash()` (a closed sheet) write `#d=…`, not `#home` — so a reload, Back to
Inicio and the midnight rollover keep the day. NO
element id may equal a tab key (the browser would scroll a `#<tab>` load to it): the Inicio advice
host is `#home-advice` and the Salud host `#health-body` (a content test checks the built page). A
deep link that opens NO sheet (`#detail/<unknown or no-data metric>`, a bad view key) is replaced by
the tab hash once detail.js has run (detail.js, when its initial open did not happen). `#food-add` is
left alone: its view registers only after the food API answers (async), and detail.js does not
reopen it then either, so it simply stays in the URL until the next tab tap or sheet close.
Taps open the **detail sheet** (see "Detail views" below), never a jump into another tab, so they
work whatever `page.hideTabs` hides (core.js `jumpOr` stays as API but no card uses it any more).

**Look & typography.** Dark, data-first design language: colour carries meaning, never decoration.
All colours are tokens in `web/src/styles/tokens.css`; the palette (2026-10-07) is sampled from a
reference fitness app: a blue-grey page gradient (`--ground-top` → `--ground-mid` → `--ground`), flat
cards (`--card-bg` = `--surface`, one radius `--card-radius` and padding `--card-pad`, no gradient, no shadow, and no border on Inicio's cards, Salud's recovery card and the eat card: `.sc-card`, `.eat-card`, `.wp`), nested tiles `--surface-2`, inset troughs
`--rail`, dial / bar tracks `--track`, three text tiers (`--ink` white, `--muted`, `--faint`).
`--good`/`--mid`/`--low` = state, `--up`/`--down` = better / worse deltas, `--trend` = neutral data
lines/sparklines, `--strain` = load, `--sleep` = sleep, `--accent` = ACTIONS only (white: filled
buttons with black `--on-accent` ink, active nav, focus), `--link` = inline text links (`.lnk`).
The tokens.css header lists every text token's WCAG ratio on `--surface`, and
`web/test/tokens-contrast.test.mjs` recomputes them (AA 4.5:1 on `--surface` and `--ground`). Two
documented exceptions keep the reference value instead of shifting it: `--low` (3.89:1 on a card) is
for large numbers, dials, bars and dots only, small red text uses `--low-ink`; on a nested tile
(`--surface-2`) `--faint` and `--strain` are AA-large only, so small text there prefers `--muted`.
Layout: on wide
screens (>= 900 px) the background stays full-bleed while the top bar, tab panels and footer are ONE
centred column capped at `--content-max` (960 px — a little wider than the 760 px detail sheets). The
rule: no multi-column page grids on desktop ("too compressed"); every tab is the
phone's stack, wider. Only a card's own inner layout may split (Nutrición's summary card: kcal dial |
day type + macro bars). Inicio's three dials are one centred group
(`--dial-size` 168 px, a fixed 72 px gap) with the gym / run / bike pills centred under the load dial;
its monitor tiles take their natural height with the value one size up; Tonight's dashed line is
capped at 560 px, centred; Entreno's 30-day calendar is capped at 640 px, centred, tiles 48 px tall
(`docs/training.md`); `--fs-2xs` (auxiliary text) goes from 10.5 to 11.5 px.
`web/test/desktop.test.mjs` pins the 960 px column and the absence of multi-column grids. Dark native controls: `color-scheme: dark` (`:root` + a `<meta name="color-scheme">`) and a
`theme-color` meta read at build time from `--ground-top` (the top of the page background; a test pins
them equal); no `apple-mobile-web-app-*` metas (a home-screen app would draw the top bar under the
status bar). Phones (< 900 px): every text input / select / textarea
is `--fs-input` (16px), so iOS never zooms into a focused field — one `:is()` rule in `base.css`
that out-ranks the form-control classes (`web/test/mobile.test.mjs`). Small pills keep their look
with a centred 44px `::before` hit band (the load dial's modality switch, `.chip.dial-mod`). Nav tab icons are inline SVG line icons keyed by tab (`TAB_ICONS` in `web/layouts/Plan.astro`,
same drawing as the day-type icons; the active tab paints icon + label white) — no emoji. Headings and
labels (`h2`, dial labels, the date pill, the "+" rows) are caps; the dock's tab labels are small
sentence case. Caps labels are bold (`--label-weight` 700), `--label-track`
(+0.08em), sized by the caps role tokens. Which token an element uses (card radius / padding, the
hero-number scale, section vs caps type) is in [`design-system.md`](design-system.md), enforced by
`web/test/design-system.test.mjs`. Text uses `--sans` = "HC Text", a ~26 KB subset of **Inter 4.1 (variable, SIL OFL 1.1, no
Reserved Font Name)**: Basic Latin + Latin-1 (every Spanish letter and sign) + the typographic signs the
page prints, one code-point list in `web/src/fonts/text-font-ranges.mjs` that feeds both the subset and
the `@font-face` `unicode-range` (emoji and ✓ fall back to the system sans); weight axis cut to 400–800
(every weight the CSS uses), optical size pinned to 14, and NO `tnum` feature — body sets
`tabular-nums` for the numerals, and Inter's tabular set also widens the hyphen, colon and space,
which gaps running text, so text figures stay proportional and aligned numbers use `--num`. Rebuild it
with `node scripts/subset-text-font.mjs path/to/InterVariable.ttf` (from the official
`Inter-4.1.zip` release of rsms/inter; harfbuzz through the `subset-font` devDependency; the output is
deterministic); licence in `web/src/fonts/OFL-Inter.txt`. The page calls it "HC Text" (like "HC
Num") so a locally installed full Inter never mixes with the subset. Numbers use `--num` = "HC Num", a
numerals-only subset (~1.5 KB: digits, + - , . % × h space) of **D-DIN Bold, SIL OFL 1.1**, inlined as
a base64 `@font-face` by `web/layouts/Plan.astro` (`?inline` import) so the page stays one file with
zero font requests. The OFL forbids the Reserved Font Name "D-DIN" on a modified version, so the
subset is renamed; licence text in `web/src/fonts/OFL.txt`. Rebuild it with
`python3 scripts/subset-num-font.py D-DIN-Bold.ttf` (needs `fonttools` + `brotli`). The output guard
test pins both `@font-face` rules (family, weight range, `unicode-range`), that each committed woff2 is
what gets inlined, and the base64 budgets (numerals 40 KB, text 48 KB); the text font adds ~35 KB to
the page. Never embed a commercial font or copy another product's name, logo or icons.
