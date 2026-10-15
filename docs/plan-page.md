# Plan page — Astro build, tabs, look

The single-file Astro page in `web/`: build modes, shared client helpers, tabs and sections, URL hash, look & typography.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

**On this page**

- [Build & single-file output](#build--single-file-output)
- [Compute modules & the fs boundary](#compute-modules--the-fs-boundary)
- [Bakes & the golden guard](#bakes--the-golden-guard)
- [Client scripts](#client-scripts)
- [Shared client helpers (`HC`)](#shared-client-helpers-hc)
- [Page copy, brand & header](#page-copy-brand--header)
- [Top bar](#top-bar)
- [Bottom dock & the "+" button](#bottom-dock--the--button)
- [Tabs and sections](#tabs-and-sections)
- [URL hash & navigation](#url-hash--navigation)
- [Look & typography](#look--typography)

## Build & single-file output

ONE Astro project in `web/` builds to a single self-contained HTML file: no external requests, no
`_astro/` asset directory, with its own Content-Security-Policy ([below](#content-security-policy)).
`scripts/build-web.mjs` drives the build:

```
node scripts/build-web.mjs [--mode personal|example] [--locale es|en]   # or DATA_MODE/LOCALE env vars
```

It writes `web/dist/<mode>/index.html`.

- `npm run build` = personal / es (default, the gitignored real files); `npm run build:example` =
  example / en: the tracked `.example` seeds plus the tracked, clearly SYNTHETIC demo extract in
  `data/demo/extract/` (no personal files needed; shows every dial and section).
- `DATA_MODE=personal|example` selects the mode (env var or `--mode`).
- `LOCALE`: env var → `plan.locale` → `en` (the user's `plan-data.json` sets `locale:"es"`).
- Optional data (Apple Health extract CSVs) renders a defined empty state when absent, in either mode —
  the build never fails on missing optional data.

### Demo data

- `scripts/make-demo-data.mjs` (`npm run demo:data`) writes it from a seeded PRNG and a FIXED end date
  (deterministic bytes; `--end/--days/--seed`). Every row is tagged `Demo …`; `data/demo/README.md` says
  it is fake. Never put real measurements in `data/demo/` (it is tracked).
- A test fails if the tracked files drift from the generator: re-run it after changing the generator or a
  CSV schema.
- The example page reads as stale a few days after the demo end date (normal staleness handling).

### Inlined scripts and CSS are slimmed

- `web/layouts/Plan.astro` inlines every `web/src/client/*.js` through `web/src/slim-script.mjs`
  `slimScript` (esbuild `transformSync`; esbuild is declared in package.json at the exact version astro /
  vite lock): `minifyWhitespace`, `legalComments: 'none'`, `charset: 'utf8'`; NO identifier renaming, NO
  syntax rewriting, still a classic script.
- The built page drops comments and may re-print quotes / number literals (`'x'` → `"x"`): a test that
  matches a script in the built HTML compares against `slimScript(source)` or a whitespace / quote
  tolerant regex, never the raw file. Baked JSON globals are not touched.
- CSS: the `page-post-build` integration (`web/astro.config.mjs`) runs every built `<style>` through
  `slimStyle` (same module, esbuild `loader: 'css'`, whitespace + comments only; Vite's `cssMinify` stays
  off), so CSS tests parse it through `web/test/css-scan.mjs` (`a>b`, `[t=x]`).
- `web/test/css-parity.test.mjs` checks the example build's declarations against
  `web/test/fixtures/css-expected.json` both ways (dropped/changed AND added fail). After a deliberate CSS
  change: `npm run test:css:update` (after `npm test` / `npm run pretest`; keeps key order, appends new
  keys, deletes stale ones).

### Content-Security-Policy

The `page-post-build` integration (`web/astro.config.mjs`) writes the policy LAST, after the CSS is slimmed,
from `web/src/csp.mjs`, as a `<meta http-equiv="Content-Security-Policy">` right after `<meta charset>`
(so it also applies when the file opens from disk):

| Directive | Value | Why |
| --- | --- | --- |
| `default-src` | `'none'` | anything not listed is refused |
| `script-src` | one `'sha256-…'` per distinct inline `<script>` body | every script is `is:inline`; never `'unsafe-inline'`, so inline event handlers are blocked |
| `style-src` | `'unsafe-inline'` | the client writes computed `style="width:…"` attributes into its markup, which no hash can cover |
| `img-src`, `font-src` | `data:` | favicon, touch icon, avatar and the two fonts are inlined data URIs |
| `connect-src` | `'self'` | the LAN APIs (`/api/*`, `/status.json`, the `/manuales/` probe) are same-origin |
| `base-uri`, `form-action`, `object-src` | `'none'` | no `<base>`, no native form submit, no plugins |

- No inline `on*=` handler anywhere: navigation is delegated. `client/core.js` listens on the document for
  `data-tab-go="<tab>"` (empty = the default tab: the wordmark) and `data-jump="<id>"` (in-page links);
  `client/score.js` for the load pages' `data-mod="<modality>"` pills (it exposes the setter as `window.HCScore.setMod`, never a bare global).
- The personal plan's trusted notes (`page.notes`) may still write the legacy `onclick="jump('<id>')"` /
  `onclick="setTab('<tab>')"`: the build rewrites exactly those two into `data-jump` / `data-tab-go` and
  warns (`page-csp: … inline handler(s)`) about any other handler, which the browser would block.
- A change to a script body after the policy is written breaks its hash: the policy step stays last.
- The LAN server adds only `frame-ancestors 'none'` as a header (a meta policy cannot carry it;
  `services/loop-web/nginx.conf.template`); browsers enforce both.
- Guards: `web/test/csp.test.mjs` (built page: no `on*=` handler, the meta first in `<head>`, `script-src`
  = exactly the hashes of its scripts, no `'unsafe-*'`) and `web/src/csp.test.mjs` (the helpers).

## Compute modules & the fs boundary

The domain compute (macros, training program/dashboard, health aggregation) lives in root `lib/*.mjs`,
shared by the Astro build, `data/nutrition/generate.mjs` and the test suite — one source, not three.

- Compute modules take their data as arguments and never import `fs`. Disk I/O is confined to the area readers `lib/<area>/read.mjs` (`health`, `journal`, `nutrition`,
  `profile`, `score`, `training`) plus two named exceptions: `lib/load/inputs.mjs` (the build-input loader)
  and `lib/profile/manuals.mjs` (write-side manual publisher).
- The HR zone model `lib/training/hr-zones.mjs` is pure; the `profile.json` max HR the Strava sync cuts
  zones with is read by `lib/profile/read.mjs` `readProfileMaxHr`.
- `lib/fs-boundary.test.mjs` pins that exact set (a new compute module that imports `fs` fails the suite)
  and that no compute module imports a reader: only the `read.mjs` files (`lib/extract/read.mjs`
  included) and the three `fs` exceptions may import a `read.mjs`.

### Read at the edge

- `lib/extract/read.mjs` `readExtract(extractDir)` is the only extract reader; its only caller (tests
  aside) is the composition root `web/src/bakes.mjs` `computeBakes`, which calls it once and passes the
  result to the pure cores:
  `lib/score/index.mjs` `buildScoresFrom(inputs, {sex})` over `recoveryFrom`, `loadFrom`, `strainFrom`,
  `stressFrom`, `energyFrom`, `journalFrom`, …; `lib/health/aggregate.mjs` `healthFrom`,
  `lib/detail/detail.mjs` `detailFrom`, `lib/nutrition/intake.mjs` `intakeFrom`,
  `lib/training/{dashboard,activity}.mjs` `dashboardFrom` / `activityFrom`. A build reads every extract
  file exactly once; the profile's newest weigh-in comes from `series.weight` (`lib/profile/read.mjs`
  never reads the extract).
- `computeBakes` otherwise reads only non-extract files (the profile JSONs, the avatar, the synced food
  log), parses nothing and imports no `fs` (it only calls the area readers, so it is not in the
  fs-boundary set).
- `workouts.csv`, `hr-hourly.csv` and `workout-zones.csv` are read once and projected several ways: the
  readers expose the cells / lines read and pure `*FromCells` / `*FromLines` projections.
- `readExtract(null)` = every value null, `journal` `[]`. The result is deep-frozen, so a core that sorts
  or assigns into its shared inputs throws instead of changing another score.
- No per-directory `build*(extractDir)` wrappers: tests run the pure `*From` cores over `readExtract` or
  over readExtract-shaped literals.

### Emitting lib code into the page

- Only modules that neither import `fs` nor import a reader can be emitted into the page via
  `clientSource()`.
- The emitter (`lib/format/numbers.mjs` `classicGlobal`) declares each constant under its own name and
  under every Rollup rename (`NAME$n`, the only form Rollup emits) the function bodies reference in CODE.
- Comments and string / template / regex literal contents are stripped first by the string-aware scanner
  `lib/format/js-scan.mjs`, so a `'NAME$2'` string or an unrelated local `NAME2` adds no declaration.
- The registerView static scan (`web/src/client/util.test.mjs`) uses the same scanner over every client
  script, subdirectories included.

## Bakes & the golden guard

- `web/pages/index.astro` gets every extract-dependent view-model (`nut`, `dash`, `activity`, `health`,
  `profile`, `scores`, `detail`, `intake`) from ONE Astro-free call, `web/src/bakes.mjs`
  `computeBakes(env)` (env = `resolveEnv()`).
- `web/test/golden-bake.test.mjs` runs that function for the example env (tracked seeds +
  `data/demo/extract`), for an EMPTY extract dir and for NO extract dir (`extractDir` null), under a fixed
  clock (`2026-09-28T20:00:00Z`, the demo extract's last day) and `TZ=UTC`. It canonicalises the result
  (sorted keys; `profile.photo` reduced to `'[photo]'` / `null`), compares it to
  `web/test/fixtures/bake-golden.{example,empty,null}.json` and fails with the first differing JSON paths.
- A refactor of a compute module must leave all three unchanged; a deliberate output change runs
  `npm run golden:bake -- --update` and reviews the fixture diff.

### Personal golden (owner-local)

The personal data has what the demo lacks (rides, power). Run it before and after a refactor in the
clone that holds the data.

| Command | Behaviour |
| --- | --- |
| `npm run golden:bake -- --personal` | First run writes `web/test/.golden/bake-golden.personal.json` (gitignored, never commit it); later runs compare (exit 1 on a diff, paths and counts only, never values); exit 2 when `data/nutrition/plan-data.json` is missing |
| `… --personal --update` | Rewrites it |
| `… --personal --root <clone>` (or `--root=<clone>`) | From a branch worktree without personal data: reads the data AND the golden from `<clone>` (e.g. the main clone, where the golden was just written) while this checkout's code computes the bakes; never writes into `<clone>` (a missing golden there is exit 2) unless `--update` is passed |

A missing `--root` value or `--root` without `--personal` is exit 2 (`web/test/golden-root.test.mjs`).

## Client scripts

### Script order: one manifest

The client scripts are classic `is:inline` scripts that talk only through page globals, so their order is
a contract. `web/src/client/manifest.mjs` (`CLIENT_SCRIPTS`) is its ONE source: `layouts/Plan.astro`
inlines every `web/src/client/*.js` (`import.meta.glob` `?raw`) in that order, after the bakes and
`HC_FMT … HC_GUIDE`. Each entry declares:

| Field | Meaning |
| --- | --- |
| `provides` | top-level `var` / `function` names + every `window.X =` write |
| `requires` | globals READ while it runs at load, each baked or provided EARLIER (reads in handlers, timers and fetch answers do not count) |
| `probes` | load-time reads of a LATER script's global, always feature-detected; the later script calls back |

- `web/test/script-manifest.test.mjs` checks every file is listed once and inlined in that order,
  `provides` against a static scan, `requires` / `probes` against the order, and runs a vm load trace of
  the example page (`web/test/script-trace.mjs`: plain load + the `#profile`, `#tonight`, `#detail/sleep`
  deep links) that fails on any undeclared load-time read or `window` write.
- A new script goes into the manifest at its place; the test names what to declare.
- A factory-only script (`detail-state.js`, `detail-chart.js`: one `window.X = function`, nothing read at
  load) declares `requires: []`: its reads happen when its caller invokes it, so the trace counts them on
  the caller (`detail.js`), and a load-time read added to the factory itself fails the trace as an
  undeclared require.

## Shared client helpers (`HC`)

`web/src/client/util.js` is inlined FIRST (right after `var NAV` and `var HC_CONST`, baked by
`layouts/Plan.astro` from `lib/stale.mjs`) and exposes the global `HC` (window.HC). The client scripts
read these instead of redefining them (a test guards it). Tests load it with `web/test/client-util.mjs`
`loadUtil(ctx)`.

| Helper | What it does |
| --- | --- |
| `lan()` | false when the page is opened from `file://`: every LAN fetch — `/api/food/*`, `/api/journal/*`, `/api/sync/status` + Sync, `/status.json`, the `/manuales/` probe — is skipped there and the page degrades exactly as with the services down, with no console errors; read at call time, no location = served |
| `jsonApi(base, header, timeoutMs)` | THE fetch wrapper of the LAN JSON APIs (`food-core.js`: `/api/food` + `X-HC-Food`, `journal.js`: `/api/journal` + `X-HC-Journal`): `api(method, path, body?)` resolves a 2xx's JSON (`{}` without one), rejects `{code, field, status}` (`offline` / status 0 with no answer, a timeout or `file://`); built on `fetchTimeout` |
| `fetchTimeout(url, init, ms)` | THE timed fetch (`jsonApi`, `freshness.js`'s status reads + Sync POST at 15 s, `profile.js`'s `/manuales/` probe at 10 s): rejects `{name: 'TimeoutError'}` after `ms` and aborts the request (`AbortController` when present), so a hung service never leaves the Sync button busy |
| `esc` (`null` / `undefined` → `''`), `format`, `isoDate`, `todayIso`, `daysOld`, `shiftIso`, `MS_PER_DAY`, `STALE_DAYS` | string / ISO date helpers, constants |
| `nf`, `num`, `int`, `pct`, `hours`, `duration` (h:mm), `numInput` (an input's value, never grouped) | thin wrappers adding the page `LOCALE` to `HC_FMT` |
| `fmtDate`, `fmtMonth`, `weekdayIndex` | the ONE display-date formatter (below) |
| `detailAttrs`, `registerView` / `view` | detail-sheet openers and registered views; `registerView` is the one writer of `window.HCViews` ([`detail-views.md`](detail-views.md)) |
| `rolloverAction` | the midnight rollover (below) |

### Globals emitted from `lib/`

`HC_FMT` is the ONE number formatter (`lib/format/numbers.mjs` `clientSource()`, inlined right before
util.js; rules in [`design-system.md`](design-system.md) → "Numbers"). The same inlined script carries:

| Global | Source | Read by |
| --- | --- | --- |
| `HC_BAND` — recovery 0–100 bands `PCT_GOOD` / `PCT_LOW` / `pctBand` | `lib/score/recovery.mjs` `clientSource()` | the recovery % colour and the energy bank (instead of literals) |
| `HC_ADH` — food log adherence | `lib/nutrition/adherence.mjs` | `client/adherence.js` (instead of a copy) |
| `HC_PROG` — weight progress | `lib/nutrition/progress.mjs` | `client/progress.js` |
| `HC_NSCORE` — nutrition score | `lib/nutrition/score.mjs` | `client/nutri-score.js` |
| `HC_FOODLOG` — food log formula | `lib/nutrition/foodlog.mjs` | `client/food-core.js` |
| `HC_DAYTYPE` / `HC_FUEL` — day type detection, ride fuelling | `lib/nutrition/daytype.mjs` / `fuel.mjs` | `client/nutri-day.js` |
| `HC_SCALE` — portion scaling | `lib/nutrition/scale.mjs` | `client/nutri-day.js` |
| `HC_GUIDE` — portion guide | `lib/nutrition/guide.mjs` | `client/nutri-day.js` |

Every nutrition global is emitted by `lib/nutrition/client.mjs` `clientSource()` from the modules'
`CLIENT` descriptors. Constants come baked from `lib/` (`STALE_DAYS` via `HC_CONST`; the calendar's
`windowDays` / `levelMin` via `activityBake` into `ACTIVITY`), never as client literals.

### Dates

- `fmtDate` ("lun 29 sept" / "Mon 29 Sep"); `weekdayIndex`: Monday = 0. Names are baked as `I18N_DATE`
  from `web/src/i18n/date-templates.mjs`, not Intl, whose ICU builds disagree.
- EVERY user-visible date goes through it (ISO only in data attributes / ids). A test fails on any
  `toLocale*String` / `Intl.DateTimeFormat` in `web/src/client`; `loadUtil` bakes `I18N_DATE` by `LOCALE`.

### Midnight rollover

- core.js captures the viewer's day at load and, when the page becomes visible on another day, reloads
  once, so the dials, top-bar date, timeline, day type and rings move to the new day.
- While the page is BUSY — the detail sheet `#detail` open, a My products / My recipes editor open (a
  form field inside `#fp-body` / `#fr-body`) or a text field focused — it waits: a 1 s watcher runs only
  while there is something to wait for, stops on `none` (hidden page, clock back) and is re-armed by
  `visibilitychange` / `pageshow`.
- A `location.reload()` that throws (sandboxed frame) is retried only by a later event, never in a loop.

## Page copy, brand & header

### Personal copy

All personal COPY (page title/kicker/h1/sub/footer, per-slot notes, which tabs/sections to hide) lives in
`plan-data.json`'s `page` block (`page.notes.<slotId>`, `page.hideTabs: ["hoy"]`, etc.) — never hardcoded
in tracked Astro/JS source, which stays fully generic.

### No hero header

- Only `page.title` is required; `page.h1` / `page.sub` / `page.kicker` are optional and validated when
  present (h1 a non-empty string, sub a string).
- The page draws no header block: `layouts/Plan.astro` renders ONE visually hidden `<h1 class="sr-only">`
  with `page.h1` (else the page title); the kicker / subtitle are not shown. The page opens on the top bar
  and the dials.

### Brand

- **LOOP.** `<title>` and `<meta name="apple-mobile-web-app-title">` = the product name (`strings.brand`,
  every locale; `page.title` only names the hidden h1 when `page.h1` is absent).
- Icons ship as `data:` URIs in `<head>` (the output guard's `html-scan.mjs` treats `data:` hrefs as
  self-contained): favicon = `loop-favicon.svg` (32 px rounded dark tile, vertical gradient `#283037` →
  `#111619`, the three-arc ring); `apple-touch-icon` = `loop-touch-icon.png` (180×180, full square: iOS
  rounds it).
- **Wordmark** (`.wordmark`, rendered by `layouts/Plan.astro` INSIDE `.topbar` between the avatar and the
  date pill, every tab): a `<button>` named "LOOP · Home" that opens Home — `data-tab-go=""`, the
  first visible tab, scrolled to the top.
  - Phone: the bar's middle column. From 900 px: the bar's first column on the left (the 960 px column's
    left edge, 30 px letters ≈ 20 px caps) and the avatar moves to the right end beside freshness / Sync,
    so the pill stays centred (`desktop.test.mjs` pins it).
  - "LOOP": L and P as Syncopate Bold outlines (never the font: Apache 2.0,
    `web/src/fonts/LICENSE-Syncopate.txt`), the first O a plain ring, the second the three-arc ring (sleep
    · recovery · strain clockwise from 12 o'clock).
  - 19 px letters (caps ~12.7 px); letters + plain ring `currentColor` (`--ink`); arcs coloured by
    `--sleep` / `--good` / `--strain` in `layout.css` (the svg's hex attributes are only the standalone
    fallback).
- All four files in `web/src/assets/` are GENERATED: geometry in `scripts/loop-logo.mjs` (ring r = 50 −
  sw/2, arcs C/3 − sw − 3 with round caps, rings 0.71em on the baseline −0.02em, the same 0.14em gap ink
  to ink between every pair of neighbours, so P's wide left side bearing adds nothing), written by
  `node scripts/make-logo.mjs path/to/Syncopate-Bold.ttf` (source + sha256 in the script header).
  `scripts/loop-logo.test.mjs` fails if they are hand-edited; `web/test/brand.test.mjs` pins the built
  head and wordmark.

## Top bar

`<header class="topbar">` (the page's banner landmark), above the dock, on every tab: a 3-column grid so the middle stays centred.

| Width | Layout |
| --- | --- |
| Phone | row 1: avatar · wordmark · freshness / Sync; row 2: the date pill, centred |
| ≥ 900 px | one row: wordmark left · pill · Sync + avatar right |

- **Avatar** (`components/Avatar.astro`): 36 px circle in a 44 px target; opens the profile sheet.
- **Date pill** (`.date-pill`, uppercase, letter-spaced): "‹ HOY ›" / "‹ TODAY ›". Home only:
  `.wrap:has(> main > .tab-panel[data-tab="home"][hidden]) > .topbar > .date-pill` hides it, and the other tabs
  show their centred title under the header row. Inside it, `<time id="today-date">` holds the viewer's
  full date ("mié 30 sept" / "Wed 30 Sep"), written client-side by `web/src/client/today-date.js` with
  `HC.fmtDate`, for assistive tech only (nothing time-based baked: builds stay byte-identical).
- **Freshness**: status dot (worst source level) + `#fresh-sum` (the Shortcut age); tap = the per-source
  popover `#fresh-pop`, right-aligned under the bar, capped at its width.
- **Sync** (`#sync-btn`): icon-only circular-arrows SVG, `aria-label`, 44 px; `is-busy` spins it while
  syncing (no spin under reduced motion).
- **Stacking**: `#fresh-pop` and the sync line `#sync-msg` are z 40 — over the dock (z 30) and the
  collapsed dial row (z 25), under the detail sheet (z 60).

### Day stepping

`client/today-date.js`, `window.HCDay`.

- `#day-prev` ‹ / `#day-next` › (44 px targets overhanging the 32 px pill, line chevrons) step Home one day
  back / forward.
- › is disabled on the viewer's today; ‹ at the oldest reachable day = the baked history's first day
  (`SCORES.days.from`, `lib/score/days.mjs`, 14 days), never more than `NAV.day.maxDays` (30) before today.
- Both ship `hidden`; the script shows them (and adds `.has-steps`) only when a past day is in reach. No
  data, or data far behind the viewer's clock, leaves the pill as it is (no dead control).
- On a past day the label (`#day-word`) shows its date ("mar 6 oct", uppercased by CSS → "MAR 6 OCT"), and
  the label button (`#day-lbl`, `aria-live="polite"`, `aria-disabled` on today) returns to today
  (`aria-label` "<date> · Volver a hoy"). The pill stays 32 px tall; the label's hit area is a 44 px band
  (`.day-lbl::before`, like the chips') and the chevrons are 44 px targets that overhang it.
- Keyboard: ← / → while focus is inside the pill (focus moves to the label when the focused chevron turns
  off).
- The day is in the hash (`#d=YYYY-MM-DD`, see [URL hash & navigation](#url-hash--navigation)), replaced —
  never pushed — and only while Home is shown and the sheet is closed.
- `HCDay` = `{sel() (null = today), iso(), oldest(), set(iso|null), step(±1), hash(), on(fn)}`; listeners
  run in their own try/catch.
- What follows the day on Home: [`home-tab.md`](home-tab.md).

## Bottom dock & the "+" button

### Dock

- `.dock`, every width (the only nav): a floating rounded tab bar (`rgba(var(--nav-rgb), 0.94)`,
  blurred, 24 px radius, max 440 px, centred); four equal icon + small sentence-case label buttons
  (active white, inactive `--faint`) that fit a 360 px phone next to the "+", safe-area insets on
  bottom/left/right.
- Markup: a labelled `<nav class="tabnav">` of plain `<button type="button" id="t-<tab>" data-tab-go="<tab>">`;
  the shown tab's button carries `aria-current="page"` (moved by `client/core.js` `showTab`). No
  `role="tab"` / `aria-pressed` (that mix is invalid ARIA); `web/test/nav-shell.test.mjs` pins it.
- No top nav at any width, so jump targets only clear the collapsed dial row (`scroll-margin-top: 64px`).
- `--dock-room` (`calc(96px + env(safe-area-inset-bottom))`: the 64 px bar, its 10 px lift, 22 px of air,
  the home-indicator inset) keeps the bottom free: the body pads every tab's end with it and
  `html { scroll-padding-bottom }` keeps a focused or jumped-to element above the bar
  (`web/test/mobile.test.mjs`).

### "+" action button

- `#act` (`client/nav-actions.js`): a separate 56 px white circular button to the RIGHT of the dock,
  outside the tab nav. Its popover `#act-pop` is a labelled `role="group"` of buttons, not a dialog.
- Opens a navy → violet popover card (12 px radius, gradient from `--link` at 15 % to `--insight-b` at
  62 %, each mixed into `--surface`; 47 px icon + uppercase label rows) over a scrim that dims the page
  40 % with a 4 px blur; the "+" turns 45° into an "×" labelled "Cerrar acciones".
- Escape, the button or a tap outside closes it; Tab stays inside; focus returns to the button.
- Lists only REAL actions available on this page, decided at view time:

| Action | Opens | Shown only once |
| --- | --- | --- |
| **Añadir comida** | the food log's add sheet, `HCViews['food-add']` via the detail sheet | `/api/food/products` answered (the same LAN-only gating as Registrar) |
| **Completar el diario** | the journal sheet, `HCViews.journal` ([`journal.md`](journal.md)) | `/api/journal/settings` answered |
| **Sincronizar** | clicks the top bar's Sync | the freshness group is shown, i.e. `/api/sync/status` answered |

- They appear asynchronously (`food-log.js`, `journal.js`, `freshness.js` call `HCActions.refresh()`).
  The root and every row ship `hidden`: in the example build, `file://` or a static copy the "+" never
  shows (no dead control).

## Tabs and sections

Four tabs, one question each (WHOOP-style: the glance on Home, the detail one tap away), switched by the
bottom dock. Blocks inside a tab are SECTIONS (`data-section="<key>"`,
`id="sec-<key>"`).

- **Landmarks**: the top bar is the `<header>`, the four `.tab-panel`s sit in one `<main class="panels">`
  (`layouts/Plan.astro`; the dock and the footer stay outside it), and each panel is a `role="region"` named
  by its nav button (`aria-labelledby="t-<key>"`); a tab `page.hideTabs` removes has no button, so its panel
  gets neither attribute (`web/test/nav-shell.test.mjs`, `hide-tabs.test.mjs`).
- **Focus on a tab switch**: only a USER's switch (`client/core.js`, the delegated `data-tab-go` click) moves
  focus to the new panel's first visible `h1`–`h3` (made `tabindex="-1"`, focused with `preventScroll`), or the
  panel itself without one; the initial load, a hash restore and Back never move focus.
- **Live regions**: never on a whole card re-rendered with `innerHTML` (`#eat-body`, `#nutri-target`,
  `#nutri-score`, `#nutri-progress`, `#food-adherence`: a screen reader would re-read the card on every render);
  a short `role="status"` line announces the change instead (the food log's `#food-msg`: "Added …", "Deleted …")
  (`web/test/content.test.mjs`).

| Tab (key) | Content, top to bottom |
| --- | --- |
| 🏠 Home (`home`) | TODAY: Sleep / Recovery / Load dials; monitor tiles (summary + HRV); "My day": the advice as the outlook bar + "Today's activities" (last night's sleep, the day's workouts, the programmed session `hoy` as a row); "today you eat" card (today's day type + goal and target kcal/macros, link to Nutrition); Tonight, My plan, My dashboard |
| 🏃 Training (`entreno`) | centred title + ⓘ; per-modality load summary cards, caveats behind ⓘ (`load`: `#score-load`, the detail behind the load dial); the Activity card — total time with W / M / 6M, sessions / days / per week, modality split bar, compact 30-day calendar (`calendar`: `#train-activity`); running table, cycling table, load vs recovery (`sessions`: `#health-train`); Intensity (HR) and the rest of the workouts dashboard (`dash`) |
| 💗 Health (`health`) | centred title + ⓘ over a green glow; the health monitor list (`#monitor`, Home's summary tile jumps here); Recovery (`#hl-recovery`: the recovery card `#score-recovery`, plus any of resting HR / HRV / respiratory rate / wrist temp the monitor lacks); Fitness (VO₂max, walking HR); Sleep (`#hl-sleep`); Body composition; Activity; Energy (expenditure + the intake cards until Nutrition takes them) — metric rows, notes behind ⓘ |
| 🍽️ Nutrition (`nutricion`) | the centred title + ⓘ header (like Health / Training), then today (`dia`: Resumen de hoy (kcal ring + macro rows) + intake rings, Registrar (the FOOD LOG, LAN page only), Plan de hoy (a PORTION GUIDE: Desayuno / Comida / Cena + Extras with today's budgets, in a `<details>` fold, collapsed by default), Avituallamiento on bike days, Balance (intake vs expenditure + the macro split), Progreso (weight vs the goal), Constancia (food log adherence, LAN page only)); Mis productos + Mis recetas (collapsible, LAN page only, no section key: rendered with `dia`); Tablas (`tablas`, collapsible: FIXED reference values per natural unit, never portions). There is no train/rest toggle: Resumen de hoy's day type is the one selector. Details: [`nutrition.md`](nutrition.md), [`nutrition-food-log.md`](nutrition-food-log.md) |

### Tab and section keys

- `lib/nav/tabs.mjs` is the ONE source of the tab keys (`TAB_KEYS`) and of the legacy-section map
  (`SECTION_TAB`); the page derives each tab's section list from it (`sectionsOf`) and bakes both as `NAV`
  for core.js.
- Panels, sections, baked globals and scripts always stay in the build (the shared
  `components/Bake.astro` renders once from `web/pages/index.astro`, outside every section; Tablas is
  server-rendered from `lib/nutrition/reference.mjs` and needs no bake or script).

### `page.hideTabs` (resolved by `resolveNav`)

| Key | Effect |
| --- | --- |
| top-level (`home`/`entreno`/`health`/`nutricion`) | removes that nav button |
| section (`hoy`/`load`/`calendar`/`sessions`/`dash`/`dia`/`tablas`) | renders that section `hidden` |
| `registro` (deprecated, `DEPRECATED_SECTIONS` in `lib/nav/tabs.mjs`) | still accepted (an existing personal plan may carry it) and a no-op — never counts towards hiding Nutrition |

- Nutrition and Training are made ONLY of sections (they carry `sections` in `resolveNav`): each
  disappears when ALL its sections are hidden — hiding `dash` alone hides only the dashboard, Training
  stays.
- The visible tab on load is the first remaining one; hiding every tab fails the build.
- `setTab('<legacy key>')` opens the hosting tab and scrolls to the section (`setTab('dash')` opens
  Training).
- The intake rings read today's target from Resumen de hoy ([`nutrition.md`](nutrition.md)), whatever
  `page.hideTabs` hides; the "today you eat" card drops its link when Nutrition is hidden.
- Taps open the **detail sheet** ([`detail-views.md`](detail-views.md)), never a jump into another tab,
  so they work whatever `page.hideTabs` hides (core.js `jumpOr` remains as API, unused by any card).

## URL hash & navigation

### Tab hash

- The open tab lives in the hash (`#home` / `#entreno` / `#health` / `#nutricion`), so a reload, a
  bookmark and the midnight rollover reopen it. core.js `setTab` writes it with `history.replaceState`
  (never `pushState`: Back does not walk through tabs, it keeps closing the detail sheet).
- A legacy section key writes its HOSTING tab's hash; a hidden tab (no nav button) is never written;
  nothing is written while the sheet is open (its `#detail/…` owns the URL).
- `window.HCNav.hash()` = the current tab's hash, read by detail.js.
- core.js runs in one function scope; its page globals are only `setTab`, `jump`, `jumpOr`, `currentTab`
  (read by today-date.js) and `HCNav`.
- `jump(id)` scrolls smoothly, instantly when the viewer prefers reduced motion
  (`prefers-reduced-motion: reduce`, read per jump).
- Every history / location access is in a try/catch (a sandboxed frame still switches tabs).

### On load and on `hashchange`

| Hash | On load | On `hashchange` |
| --- | --- | --- |
| visible tab | opens that tab | switches tab |
| none, hidden or unknown | opens the default tab (the one the server rendered); the URL is replaced to match | switches nothing |
| sheet deep link (`#detail/…`, view keys) | left to detail.js; its HOST tab is shown underneath | switches nothing (never fights detail.js's popstate) |
| `ANCHOR_TAB` anchor (`#monitor` → `health`) | shows its tab, keeps the hash, scrolls to the block | same |
| `#d=YYYY-MM-DD` | shows Home and KEEPS the hash | same |

- Host tabs: `DETAIL_TAB` / `VIEW_TAB` in `lib/nav/tabs.mjs`, baked in `NAV` — Health metrics → `health`,
  `workouts` / `load-*` → `entreno`, `food-add` → `nutricion`, `hoy-session` / `tonight` / `dash-edit` →
  `home`, `profile` → none = the default tab. A test pins every `DETAIL_KEYS` key.
- A deep link that opens NO sheet (`#detail/<unknown or no-data metric>`, a bad view key) is replaced by
  the tab hash once detail.js has run (when its initial open did not happen).
- `#food-add` is left alone: its view registers only after the food API answers (async) and detail.js does
  not reopen it then, so it stays in the URL until the next tab tap or sheet close.

### Past day of Home

- `#d=YYYY-MM-DD` (`DAY_HASH` in `lib/nav/tabs.mjs`, baked as `NAV.day`; `parseDayHash` / `dayHash` for
  tests). client/today-date.js validates the day and replaces an out-of-reach one with `#home`.
- While a past day is selected Home's hash is that day — `setTab('home')` and `HCNav.hash()` (a closed
  sheet) write `#d=…`, not `#home` — so a reload, Back to Home and the midnight rollover keep the day.

### No element id equals a tab key

The browser would scroll a `#<tab>` load to it: the Home advice host is `#home-advice` and the Health host
`#health-body` (a content test checks the built page).

## Look & typography

Dark, data-first design language: colour carries meaning, never decoration. Which token an element uses
(card radius / padding, the hero-number scale, section vs caps type) is in
[`design-system.md`](design-system.md), enforced by `web/test/design-system.test.mjs`.

### Colour tokens

All colours are tokens in `web/src/styles/tokens.css`; the palette is sampled from a reference fitness app.

| Token(s) | Role |
| --- | --- |
| `--ground-top` → `--ground-mid` → `--ground` | the blue-grey page gradient |
| `--card-bg` = `--surface`, `--card-radius`, `--card-pad` | flat cards: one radius and padding, no gradient, no shadow; no border on Home's cards, Health's recovery card and the eat card (`.sc-card`, `.eat-card`, `.wp`) |
| `--surface-2` / `--rail` / `--track` | nested tiles / inset troughs / dial and bar tracks |
| `--ink` (white), `--muted`, `--faint` | the three text tiers |
| `--good` / `--mid` / `--low` · `--up` / `--down` | state · better / worse deltas |
| `--trend` · `--strain` · `--sleep` | neutral data lines / sparklines · load · sleep |
| `--accent` | ACTIONS only (white: filled buttons with black `--on-accent` ink, active nav, focus) |
| `--link` | inline text links (`.lnk`) |

### Contrast

- The tokens.css header lists every text token's WCAG ratio on `--surface`;
  `web/test/tokens-contrast.test.mjs` recomputes them (AA 4.5:1 on `--surface` and `--ground`).
- Two documented exceptions keep the reference value: `--low` (3.89:1 on a card) is for large numbers,
  dials, bars and dots only — small red text uses `--low-ink`; on a nested tile (`--surface-2`) `--faint`
  and `--strain` are AA-large only, so small text there prefers `--muted`.

### Layout

- Wide screens (>= 900 px): the background stays full-bleed; the top bar, tab panels and footer are ONE
  centred column capped at `--content-max` (960 px — a little wider than the 760 px detail sheets).
- No multi-column page grids on desktop ("too compressed"): every tab is the phone's stack, wider. Only a
  card's own inner layout may split (Nutrition's summary card: kcal dial | day type + macro bars).
  `web/test/desktop.test.mjs` pins the 960 px column and the absence of multi-column grids.
- Desktop details: Home's three dials are one centred group (`--dial-size` 168 px, a fixed 72 px gap) with
  the gym / run / bike pills centred under the load dial; its monitor tiles take their natural height with
  the value one size up; Tonight's dashed line is capped at 560 px, centred; Training's 30-day calendar is
  capped at 640 px, centred, tiles 48 px tall ([`training.md`](training.md)); `--fs-2xs` (auxiliary text)
  goes from 10.5 to 11.5 px.

### Native controls & mobile

- Dark native controls: `color-scheme: dark` (`:root` + a `<meta name="color-scheme">`) and a
  `theme-color` meta read at build time from `--ground-top` (the top of the page background; a test pins
  them equal).
- No `apple-mobile-web-app-*` metas (a home-screen app would draw the top bar under the status bar).
- Phones (< 900 px): every text input / select / textarea is `--fs-input` (16px), so iOS never zooms into a
  focused field — one `:is()` rule in `base.css` that out-ranks the form-control classes
  (`web/test/mobile.test.mjs`).
- Small pills keep their look with a centred 44px `::before` hit band (the load dial's modality switch,
  `.chip.dial-mod`).

### Icons & labels

- Nav tab icons are inline SVG line icons keyed by tab (`TAB_ICONS` in `web/layouts/Plan.astro`, same
  drawing as the day-type icons; the active tab paints icon + label white) — no emoji.
- Headings and labels (`h2`, dial labels, the date pill, the "+" rows) are caps; the dock's tab labels are
  small sentence case.
- Caps labels are bold (`--label-weight` 700), `--label-track` (+0.08em), sized by the caps role tokens.

### Fonts

| | Text: `--sans` = "HC Text" | Numbers: `--num` = "HC Num" |
| --- | --- | --- |
| Source | **Inter 4.1 (variable, SIL OFL 1.1, no Reserved Font Name)** | **D-DIN Bold, SIL OFL 1.1** |
| Subset | ~26 KB: Basic Latin + Latin-1 (every Spanish letter and sign) + the typographic signs the page prints | ~1.5 KB numerals only: digits, + - , . % × h space |
| Rebuild | `node scripts/subset-text-font.mjs path/to/InterVariable.ttf` (from the official `Inter-4.1.zip` release of rsms/inter; harfbuzz through the `subset-font` devDependency; deterministic output) | `python3 scripts/subset-num-font.py D-DIN-Bold.ttf` (needs `fonttools` + `brotli`) |
| Licence | `web/src/fonts/OFL-Inter.txt` | `web/src/fonts/OFL.txt` |

- Text: one code-point list in `web/src/fonts/text-font-ranges.mjs` feeds both the subset and the
  `@font-face` `unicode-range` (emoji and ✓ fall back to the system sans); weight axis cut to 400–800
  (every weight the CSS uses), optical size pinned to 14, and NO `tnum` feature — body sets `tabular-nums`
  for the numerals, and Inter's tabular set also widens the hyphen, colon and space, which gaps running
  text, so text figures stay proportional and aligned numbers use `--num`.
- Named "HC Text" (like "HC Num") so a locally installed full Inter never mixes with the subset; the OFL
  forbids the Reserved Font Name "D-DIN" on a modified version, so the numerals subset is renamed too.
- Both are inlined as base64 `@font-face` by `web/layouts/Plan.astro` (`?inline` import), so the page stays
  one file with zero font requests; the text font adds ~35 KB to the page.
- The output guard test pins both `@font-face` rules (family, weight range, `unicode-range`), that each
  committed woff2 is what gets inlined, and the base64 budgets (numerals 40 KB, text 48 KB).
- Never embed a commercial font or copy another product's name, logo or icons.
