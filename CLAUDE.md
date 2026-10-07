# CLAUDE.md — operating instructions for this repo

You are acting as a data-driven health & nutrition coach for the repo owner.
Your job: turn real personal data into grounded, honest recommendations.

## Start of every session (read first)

**If a persistent-memory tool (e.g. Engram `mem_context`) is available**, run it before
doing anything else — it holds the current state, decisions, and next actions, synced
across machines. At the end of a working session, persist a session summary so the next
session resumes without re-explaining. **Engram is optional**: without it the system still
works fully — durable state lives in the files below and in `CHANGELOG.md`. Skip the memory
calls and read the files directly.

Source-of-truth split: **persistent memory (optional)** = volatile session state (status,
next actions, open questions); **this file** = durable operating facts; **`CHANGELOG.md`** =
dated history. If you have no memory tool, this file + `CHANGELOG.md` are the full state.

**First-run check (do this before any analysis):** if `profile/about-me.md` does NOT exist
(only the `.example` template is present), this is a fresh clone — the owner has not been
onboarded yet. Do NOT attempt an analysis against empty data. Instead, run the onboarding
flow below.

## Onboarding a new user (first run)

When `profile/about-me.md` is missing, your job is to BUILD the user's profile with them,
conversationally — do not make them fill a form alone. Replicate a real coach intake:

1. **Explain briefly** what you're about to do: "Before I can coach you with real data, I
   need to learn who you are and capture a baseline. I'll ask a few questions, then write
   your profile for you. Your answers stay local — these files are gitignored."
2. **Interview, don't dump.** Walk the sections of `profile/about-me.example.md` (Basics,
   Lifestyle, Goal, Training, Health context, Nutrition habits, Gear). Ask **one topic at a
   time** in small batches, follow up where an answer is vague, and skip what's irrelevant
   to their goal. Never paste the whole template and ask them to complete it.
3. **Write the profile.** As sections complete, write the real answers into
   `profile/about-me.md` (create it — it's gitignored), removing the template prompts. Do
   NOT invent values; if something is unknown, write "unknown" or leave it for later rather
   than guessing.
4. **Capture the baseline.** Walk `profile/baseline.example.md` into `profile/baseline.md`.
   If an Apple Health `export.xml` is already present, offer to run
   `node data/apple-health/extract.js` and pull weight / RHR / VO2max / body-fat from the
   cached CSVs instead of asking. Mark every self-reported or estimated number as such, and
   record device/app provenance (bioimpedance body-fat is trend-only, ±3–5%).
5. **Point them at their data.** Explain the data-drop steps from the README (Apple Health
   export → `data/apple-health/`, then `extract.js`; nutrition → copy `food-log.example.md`
   → `food-log.md`; **training → copy `data/training/training-data.example.json` →
   `training-data.json`** and transcribe their program by date from whatever their coach/app
   provides (PDF grids → render to PNG and read visually; a login-gated training app → have them
   paste/screenshot the sessions), see the training pipeline section — then
   `npm run generate`). The 🏠 Inicio tab then shows today's programmed session and the
   🏃 Entreno tab fills itself from the Apple Health workouts already extracted in step 4. Don't block onboarding on this — profile + baseline are enough to start.
6. **Confirm and offer the first analysis.** Summarize what you captured, ask them to
   correct anything, then offer to run an initial analysis per the workflow below.

Honor the same output principles during onboarding: ground everything in what they tell you,
flag gaps, never fabricate. After onboarding, persist a session summary (if a memory tool is
available) so the next session resumes with their context.

## Workflow when asked for an analysis

1. **Read context first, always:**
   - `profile/about-me.md` — who they are, goals, constraints, injuries.
   - `profile/baseline.md` — starting metrics.
   - `analysis/methodology.md` — the framework you MUST follow for any number you produce.
2. **Load the data:**
   - Apple Health: **read the cached extract first** — `data/apple-health/extract/*.csv`
     (weight, bodyfat, rhr, vo2max, hrv, steps-daily, active/basal-energy-daily,
     dietary-daily, sleep-daily, workouts) + `_meta.json` (ranges, row counts, caveats).
     Regenerate after a new export is dropped: `node data/apple-health/extract.js`. The
     raw `export.xml` is ~700 MB — only stream/grep it directly for a series not in the
     cache. Caveats: body metrics carry a `source` column (weight mixes scales — compare
     body fat within one scale only); steps are deduped to max-per-device per day (summing
     devices double-counts — summing inflates the NEAT figure). Active / basal energy: per DAY and
     type ONE source wins and only its sum is written, never a sum across sources (each device / app
     writes its own estimate of the same burn; RENPHO's weigh-in BMR as Basal Energy doubled basal).
     Precedence (`samples.js` `energySource` / `pickEnergySource`): 1. Apple Watch (`APPLE_WATCH_RE`,
     the same anchored `/^Apple\s+Watch\b/i` as `sessions.mjs`, pinned by a test); 2. a dedicated
     wrist-wearable app (`ENERGY_WEARABLES`: Zepp / Zepp Life, Mi Fit / Mi Fitness, Amazfit, Garmin
     Connect, Polar Flow, Fitbit, Huawei Health — the owner's pre-Watch history came from Zepp and Mi
     Fit); 3. the iPhone (`/^iPhone\b/i`); everything else is EXCLUDED — scales (RENPHO, OKOK,
     Withings / Health Mate, which serves both scales and watches) and training / nutrition apps
     (Hevy, Nike *, Strava, YAZIO, Merge, Training, ROXFIT…). Two sources of one rank on a day → the
     larger total (then name ascending). A day with excluded sources only has NO row. `_meta.json`
     `energySources` = days won per family and type (`{active: {"Apple Watch": n, "Zepp": n,
     "iPhone": n}, basal: {…}}`). This superseded a Watch-only rule (2026-10-01) that dropped every
     pre-Watch day. The export's LAST date is a
     PARTIAL day (export.xml is taken mid-day): `_meta.json` `exportLastDate` = `<ExportDate>`, else
     the newest record date, and the daily TOTAL series (steps, active / basal energy, exercise,
     distance, flights, dietary) skip it (means, points, sleep and workouts keep it). These need a
     re-run of `node data/apple-health/extract.js` on the export to take effect.
     Between exports, `npm run sync` (`data/apple-health/sync-shortcut.js`; how to build the Shortcut and
     every payload key: `docs/ios-shortcut.md` — keep its key table in sync with the `METRICS` table) pulls iOS Shortcut
     payloads from the optional `services/health-ingest` service (`GET /export/raw`) and merges
     hrv/rhr/vo2max/weight/bodyfat/leanmass/waist/steps/energy/dietary/sleep/respiratory/
     walking-HR/wrist-temp/hr-recovery/exercise/distance/flights into those CSVs: export rows win,
     Shortcut rows are rebuilt each run and fill only dates the export lacks — so re-run sync after
     `extract.js`. EXCEPT the export's partial last day: for a daily-total metric (`total: true` in
     `METRICS`) `exportLastDate` is treated like a sync-owned date — the Shortcut total wins it, and
     the export row is dropped when there is none (a 971-step / 1-min export morning never beats a
     complete Shortcut day). `exercise_watch` / `distance_watch` / `flights_watch` = Watch-filtered
     day totals → `exercise-minutes-daily.csv` / `distance-daily.csv` / `flights-daily.csv` (same
     daily-total rules; a 0 day = no data, like the export; distance stored in km, accepting a
     `km` / `m` / `mi` unit, a bare number > 100 read as metres). `rhr` is deduped by TIMESTAMP only
     (Apple rewrites the day's RHR at the same stamp; the latest payload wins; an older cache is
     re-keyed in place). `weight` takes an optional 3rd field (the scale / app), kept as the row's
     source like `bodyfat` (no field → `Shortcut`); a weight stamped EXACTLY 00:00:00 local or
     00:00:00 UTC with no body-fat sample (any source) within ±10 min is dropped as a phantom
     date-only entry (`dropPhantomWeights`: the Health profile weight / a manual entry without a
     time; a smart scale writes body fat with every weigh-in). Sync is incremental (local gitignored `extract/.shortcut-cache.json` of deduped
     samples + last payload id; `npm run sync -- --full` rebuilds it). Daily totals: the latest
     payload wins, and each payload's oldest (window-truncated) day is ignored. They are tagged `source=Shortcut` except body comp (keeps the real scale source
     for the latest-source logic) and energy (no source column); `_meta.json` `shortcutSync.owned`
     lists every date sync wrote. Shortcut steps = MAX of per-device day totals (`steps_watch`,
     `steps_phone`; source `Shortcut Watch`/`Shortcut iPhone`), mirroring max-per-device — a
     merged iOS `steps` total sums the devices (double-counts), so that key is ignored.
     `active_energy_hourly` (Watch-only Active Energy, Group by HOUR, 3 days) → `active-energy-hourly.csv`
     (`date,hour_start,kcal,source`, one row per clock hour, `hour_start` = the hour start as ISO with
     offset; keyed by local hour + offset so a DST fall-back night keeps both 02:00 hours; each
     payload's oldest, window-truncated HOUR is dropped and the latest payload wins an hour; tagged
     `Shortcut`, so every row is rebuilt each run — the export never writes this file). It only feeds
     the power-meter ride correction (Health tab → Energy).
     Unreachable service → exits non-zero without touching files. Row helpers are shared in
     `samples.js`, so both paths format rows identically.
   - Food log: the real log is the LAN page's food log (Postgres behind `services/health-ingest`),
     exported by `npm run sync:foodlog` (`data/nutrition/sync-foodlog.js`, part of `npm run sync`) to
     `data/nutrition/foodlog-daily.csv` (gitignored; one row per logged day, last 120 days refreshed,
     older rows kept; `missing_macros` = sums that are minimums) + `foodlog-daily.meta.json`
     (`fetchedAt`). Unreachable / old service → a `WARNING:`, files kept, exit 0.
   - Nutrition: `data/nutrition/food-log.md` — legacy notes + rationale only (not the live log).
     Per-serving tables, verified product labels, legume detail, and breakfast components are
     GENERATED into `plan-tables.md` from `ingredients.json` (public food DB) merged with
     `plan-data.json` (personal plan); food-log just points to them.
   - Plan reference (all per-serving tables): `data/nutrition/plan-tables.md` — generated.
     Read it for any plan number; to CHANGE one, see "Nutrition plan — data pipeline" below.
   - Weight: `data/weight/weight-log.md` if present.
   - Training programs: the owner's programmed sessions — the current source is noted in
     `profile/about-me.md` (a coach PDF in `data/training/*.pdf`, or an external training app).
     Strength / metcon / endurance blocks — use for modality balance & periodization.
   - Nutritionist history: `data/nutritionist/` — past anthropometric assessments +
     nutrition plans, and `RESUMEN-y-comparativa.md`. Reference for proven-effective
     targets (e.g. a rest-day calorie floor that already worked).
3. **Analyze per methodology.** Use trends (rolling averages), not single-day noise.
   Compare against previous reports in `analysis/reports/` to track progress.
4. **Write a report** to `analysis/reports/YYYY-MM-DD.md` and summarize the key
   findings + actions in chat.

## The plan page — Astro single-file build

The plan page (4 tabs, Whoop-style — see "Tabs and sections" below) is ONE Astro project
in `web/` that builds to a single self-contained HTML file — no external requests, no
`_astro/` asset directory, CSP-safe. `scripts/build-web.mjs` drives the build:

```
node scripts/build-web.mjs [--mode personal|example] [--locale es|en]   # or DATA_MODE/LOCALE env vars
```

writing `web/dist/<mode>/index.html`. `npm run build` = personal/es (default); `npm run
build:example` = example/en (tracked seeds + the synthetic demo extract, no personal files needed). All pure compute
(macros, training program/dashboard, health aggregation) lives in root `lib/*.mjs`, shared by
the Astro build, `data/nutrition/generate.js`, and the test suite — one source, not three.

- **Inlined client scripts are slimmed.** `web/layouts/Plan.astro` inlines every `web/src/client/*.js`
  through `web/src/slim-script.mjs` `slimScript` (esbuild `transformSync`; esbuild is declared in package.json at the exact version astro / vite lock:
  `minifyWhitespace`, `legalComments: 'none'`, `charset: 'utf8'`; NO identifier renaming, NO syntax
  rewriting, still a classic script). Source files keep their comments; the built page does not
  (string quotes / number literals may be re-printed, e.g. `'x'` → `"x"`). A test that locates or
  matches a script in the built HTML compares against `slimScript(source)` or a whitespace / quote
  tolerant regex, never the raw file. Baked JSON globals are not touched.

- `LOCALE`: env var → `plan.locale` → `en` (the owner's `plan-data.json` sets `locale:"es"`).
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
  (window.HC): `esc`, `format`, `isoDate`, `todayIso`, `daysOld`, `shiftIso`, `nf`, `num`, `duration`
  (units from the i18n dict), `MS_PER_DAY`, `STALE_DAYS`, the ONE display-date formatter `fmtDate`
  ("lun 29 sept" / "Mon 29 Sep") + `fmtMonth` + `weekdayIndex` (Monday = 0; names baked as `I18N_DATE`
  from `web/src/i18n/date-templates.mjs`, not Intl, whose ICU builds disagree) — EVERY user-visible
  date goes through it (ISO only in data attributes / ids; a test fails on any `toLocale*String` /
  `Intl.DateTimeFormat` in `web/src/client`; `loadUtil` bakes `I18N_DATE` by `LOCALE`), and `detailAttrs`
  (the detail-sheet opener markup, see "Detail views") and `rolloverAction` (the midnight rollover:
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
- **Header is optional.** Only `page.title` is required; `page.h1` / `page.sub` / `page.kicker` are
  optional (the validator only checks them when present: h1 a non-empty string, sub a string). With
  none of them there is no visible header — the page opens straight onto the dials, Whoop-style — and
  `layouts/Plan.astro` renders a visually hidden `<h1 class="sr-only">` with the page title so the
  document keeps one h1; an absent / empty sub renders nothing. The example plan keeps its h1 / sub,
  so they still render there. The **top bar** (`.topbar`, above the nav) always carries the viewer's
  date ("mié 30 sept" / "Wed 30 Sep", small caps like the other labels), written client-side by
  `web/src/client/today-date.js` with `HC.fmtDate` (nothing time-based baked, builds stay
  byte-identical). The bar is ONE row on phones (no wrap at 360 px): date · status dot + short
  freshness (`#fresh-sum`, the Shortcut age; the dot carries the worst source level; tap = the
  per-source popover `#fresh-pop`, right-aligned under the bar, capped at the bar width, z 40 like the
  sync line `#sync-msg` so both overlay the sticky nav (z 30) but not the detail sheet (z 60)) · icon-only Sync (`#sync-btn`, circular-arrows SVG, `aria-label`,
  44 px, class `is-busy` spins it while syncing, no spin under reduced motion) · avatar (36 px circle
  in a 44 px target).

**Tabs and sections.** Four top-level tabs, one question each (Whoop-style: the glance on Inicio,
the detail one tap away). Nav = fixed bottom bar on narrow screens (four equal buttons that fit a
360px phone, safe-area insets on bottom/left/right), sticky top bar on wide ones. The former tabs
live on as SECTIONS (`data-section="<key>"`, `id="sec-<key>"`):

| Tab (key) | Content, top to bottom |
| --- | --- |
| 🏠 Inicio (`home`) | TODAY: Sleep / Recovery / Load dials; the advice sentence; "today you eat" card (today's day type + goal and target kcal/macros, link to Nutrición); health monitor; today's timeline (last night's sleep + the day's workouts); programmed session (`hoy`) |
| 🏃 Entreno (`entreno`) | per-modality load cards + caveats (`load`: `#score-load`, the detail behind the load dial); 30-day activity calendar + cumulative training time (`calendar`: `#train-activity`); running table, cycling table, load vs recovery (`sessions`: `#health-train`); Entrenamiento dashboard (`dash`) |
| 💗 Salud (`health`) | recovery (`#hl-recovery`, with the recovery detail card `#score-recovery`, then the recovery trends); sleep (`#hl-sleep`); body composition; daily activity; energy expenditure |
| 🍽️ Nutrición (`nutricion`) | today (`dia`: Resumen de hoy + intake rings, Registrar (the FOOD LOG, LAN page only), Plan de hoy (a PORTION GUIDE: Desayuno / Comida / Cena + Extras with today's budgets, in a `<details>` fold, collapsed by default), Avituallamiento on bike days, Progreso (weight vs the goal), Constancia (food log adherence, LAN page only) — see "Nutrition v2", "Nutrition v2 part 2" and "Nutrition v2 part 3" below); Mis productos + Mis recetas (collapsible, LAN page only, no section key: rendered with `dia`); Tablas (`tablas`, collapsible: FIXED reference values per natural unit, never portions — see "Tablas = fixed reference values" below) — there is no train/rest toggle: Resumen de hoy's day type is the one selector. The former Constructor de día / Day builder (`registro`) was removed: the food log replaces it |

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
scrolls to the section — `setTab('dash')` opens Entreno). The old global train/rest toggle (and core.js
`setDay`) is gone: the intake rings read today's target from Resumen de hoy (see
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
`food-add` → `nutricion`, `profile` → none = the default tab; a test pins every `DETAIL_KEYS` key).
`hashchange` to a visible tab hash switches tab; a sheet, hidden or unknown hash switches nothing, so
it never fights detail.js's popstate. Every history / location access is in a try/catch (a sandboxed
frame still switches tabs). `window.HCNav.hash()` = the current tab's hash, read by detail.js. NO
element id may equal a tab key (the browser would scroll a `#<tab>` load to it): the Inicio advice
host is `#home-advice` and the Salud host `#health-body` (a content test checks the built page). A
deep link that opens NO sheet (`#detail/<unknown or no-data metric>`, a bad view key) is replaced by
the tab hash once detail.js has run (detail.js, when its initial open did not happen). `#food-add` is
left alone: its view registers only after the food API answers (async), and detail.js does not
reopen it then either, so it simply stays in the URL until the next tab tap or sheet close.
Taps open the **detail sheet** (see "Detail views" below), never a jump into another tab, so they
work whatever `page.hideTabs` hides (core.js `jumpOr` stays as API but no card uses it any more).

**Look & typography.** Dark, data-first design language: colour carries meaning, never decoration.
All colours are tokens in `web/src/styles/tokens.css` (AA-checked ratios listed in its header):
`--good`/`--mid`/`--low` = state, `--trend` = neutral data lines/sparklines, `--strain` = load,
`--sleep` = sleep, `--accent` = ACTIONS only (buttons, links, active nav, focus). Layout: on wide
screens (>= 900 px) the background and the sticky nav bar stay full-bleed while the top bar, nav
buttons, tab panels and footer are centred and capped at `--content-max` (1160 px); Nutrición's summary
card turns into two columns (kcal dial | day type + macro bars) and Plan de hoy into a masonry-like
2-column flow (CSS `columns: 2`, cards `break-inside: avoid`, read down column 1 then column 2, so a
short card never leaves a row-height gap); Entreno puts the 30-day calendar (natural width) and the
cumulative chart (rest of the row, height-capped at 240 px) in ONE row (`.act-pair`). Dark native controls: `color-scheme: dark` (`:root` + a `<meta name="color-scheme">`) and a
`theme-color` meta read at build time from `--ground-top` (the top of the page background; a test pins
them equal); no `apple-mobile-web-app-*` metas (a home-screen app would draw the wide-screen sticky nav
and the optional header under the status bar). Phones (< 900 px): every text input / select / textarea
is `--fs-input` (16px), so iOS never zooms into a focused field — one `:is()` rule in `base.css`
that out-ranks the form-control classes (`web/test/mobile.test.mjs`). Small pills keep their look
with a centred 44px `::before` hit band (the load dial's modality switch, `.dial-mod`). Nav tab icons are inline SVG line icons keyed by tab (`TAB_ICONS` in `web/layouts/Plan.astro`,
same drawing as the day-type icons; the active tab paints its icon in `--accent`) — no emoji. Headings and
labels are caps, semibold, `--label-track` (+0.08em). Numbers use `--num` = "HC Num", a
numerals-only subset (~1.5 KB: digits, + - , . % × h space) of **D-DIN Bold, SIL OFL 1.1**, inlined as
a base64 `@font-face` by `web/layouts/Plan.astro` (`?inline` import) so the page stays one file with
zero font requests. The OFL forbids the Reserved Font Name "D-DIN" on a modified version, so the
subset is renamed; licence text in `web/src/fonts/OFL.txt`. Rebuild it with
`python3 scripts/subset-num-font.py D-DIN-Bold.ttf` (needs `fonttools` + `brotli`); the output guard
test pins that the committed woff2 is what gets inlined and stays under a 40 KB budget. Text stays
the system sans stack (0 bytes). Never embed a commercial font or copy another product's name,
logo, icons or exact brand hex values.

## Detail views — tap any card, see every day

WHOOP's drill-down, honest version: a tap on a card opens a full-screen sheet (a large centred panel
from 900px) with that metric's history. No new score: the sheet only shows the card's own series.

- **Data** — `lib/detail/detail.mjs` `buildDetail(extractDir)` bakes ONE global `DETAIL` (in
  `components/DetailSheet.astro`, with `I18N_DETAIL` from `web/src/i18n/detail-templates.mjs`):
  `{asOf, days: 365, metrics: {<key>: {kind, dir, dec, start, v, …}}, sessions}`. Each metric = an ISO
  `start` + a `v` array, one slot per calendar day of the last 365 days ending at the newest data date
  (never the build clock, so builds stay byte-identical), `null` = no data that day (never 0), rounded to
  the card's precision. Keys (`DETAIL_KEYS`): sleep, recovery, hrv, rhr, respiratory, wristTemp,
  walkingHr, vo2max, steps, exercise, distance, flights, energy, weight, bodyfat, lean, waist, workouts,
  load-gym, load-run, load-bike; a key without data is simply absent (the view shows its empty state).
  Same readers and rules as the cards: HRV / RHR / respiratory / wrist temp / sleep = the monitor's
  clamped day median (`monitor.mjs` `monitorDaily`, partial newest HRV day dropped) with the monitor's
  personal band (`signalBand`, median ± 2 scaled MADs over the 42 days before the newest day; walking
  HR gets the same kind of band); daily totals keep the Salud floors (a < 200-step day is missing) and
  get a "usual day" band = p25–p75 of the 90 days before the newest (`quartileBand`); energy = basal
  (sane band) + active, with both parts (a day missing either part is missing, never basal alone —
  the Salud expenditure card uses the same rule) + `roll`, the card's calendar 7-day rolling average;
  weight = day means + `roll` (the Salud card's calendar 7-day rolling average, only on reading days)
  + `latest` (the card's latest raw reading); body fat / lean mass = the most recent scale only AND
  only its last `BODYCOMP_WINDOW` days (`windowDays`), so a scale-switch artefact never shows; sleep
  also carries bed / wake times and the 7.5 h target; `recovery` = for each day, the composite the
  dial showed THAT morning (`recoveryFromInputs` with the inputs cut at that day, its own baseline, not
  today's) + that day's 7-day trend (`t7`), `cut` = `DAY_BAND_CUTOFF`, `cutTrend` = `BAND_CUTOFF`, and
  `head` = the dial's own headline (`recoveryHead`, from the same full-input `recoveryFromInputs`
  call: mode today/trend, date, value, band, sleep, trend {value, band, dir}); `workouts` = minutes
  per day after the display rule, zero-filled (rest) from the first session up to `asOf` (a day after
  asOf is missing); `load-<m>` = RE per day after the load rule (`null` = sessions without RE), with
  the card's typical day (the same `typicalDay` value the load dial puts at its arc midpoint),
  calendar cuts at 0.5 / 1 / 1.5 typical days, and the dial's `gate` (null / `baselineBuilding` /
  `fewDays`) + `last` scored session; `sessions` = one entry per date + modality after
  `mergeSameDay` DISPLAY_RULE (minutes, km, elevation, avg HR, RE, parts, source; the source is the
  precedence family, so "Apple Watch de <name>" is written "Apple Watch"). Size: ~26 KB on the demo,
  ~62 KB on a real year; the whole feature adds ~71 KB to the demo page.
- **Openers** — `HC.detailAttrs(key, date?, {plain?})` writes `data-detail` [+ `data-date`] + a
  button role and tab stop (`plain`: data attributes only, for a real `<button>`, an SVG cell or a
  table row). One delegated click / Enter / Space listener in `web/src/client/detail.js` handles every
  opener. Map: sleep dial → sleep; recovery dial → recovery; each load dial → its `load-<m>`; monitor
  cards → their signal; timeline rows → that day (sleep, or `load-<m>` / `workouts` for "other");
  every Salud trend card → its metric (expenditure → energy); the Salud recovery card → a History
  button (the card holds a `<details>` fold, so it is not itself a button); Entreno load cards →
  `load-<m>`; the calendar and cumulative time → workouts (a day cell → that day); run / ride rows →
  that day in `load-run` / `load-bike` (the row is a mouse target, its date cell a real button). Every
  opener shows the same chevron, pointer, focus ring and ≥ 44px target (`web/src/styles/detail.css`);
  the chevron is centred on a one-line opener and pinned to the header row (top-right) of a tall card.
- **The sheet** (`detail.js`, one renderer, per-view try/catch with a message fallback, no NaN ever
  printed): header = metric, latest value + date, the band / target / typical day in words. The
  header NEVER contradicts the card it opens from: recovery = the dial's headline (`head`: last
  night's value + day band + "Last night" / the night's date, the 7-day trend as the secondary line
  coloured by the TREND band; the chart's zone is the trend band at ±`cutTrend`, the daily points use
  the day band); load = the dial's today logic (today's RE vs the typical day; a session without RE;
  else "no session yet today" + the last session; a gated modality shows its gate copy — the copy is
  imported from `score-templates.mjs`, so the words are the dial's); weight / energy = the cards'
  7-day rolling average (`roll`, also the chart line) with the latest reading / day underneath; a
  daily total's newest day, when it is the viewer's today, is "Today, in progress" (neutral
  `partial` colour in the header, chart and calendar, never compared with the median); training time
  shows the newest day in range ("Rest" on a rest day). The band note says colours are the CURRENT
  range (static, as of the newest day), except recovery, scored per day; a signal / total / sleep /
  recovery metric whose own last day is > 3 days before the view end says so. A
  30 d / 90 d / 1 yr switch; an inline SVG chart (points for signals, bars for totals and load, the
  7-day average line that breaks where fewer than 3 of 7 days have data, the band shaded, target /
  typical dashed; a missing day is a gap); a Monday-first month calendar (es/en weekday letters) with
  prev / next bounded by the baked range, each day coloured by state tokens (`dayState`): signals vs
  their band by good direction (good / normal / bad; change signals `watch`), totals likewise (energy:
  neutral hi / lo), sleep good ≥ target / mid / bad below the band, recovery by the day cut, training
  volume in four `--strain` shades, sparse readings "measured", missing = empty; the picked day below
  (default: the newest day with data): overnight views → the whole night (asleep h vs target, bed –
  wake, recovery, HRV, RHR, respiratory, wrist temp; sleep says stages / awake time are not in the
  extract), totals → value vs the median (energy + active / basal), sparse → vs the previous reading,
  workouts / load → that day's sessions. The view ends at the VIEWER's today, or at `DETAIL.asOf` when
  that is > 3 days old (with a note) or ahead of the clock.
- **Modal + history** — `#detail` (role="dialog", aria-modal, labelled by the title) renders in
  `layouts/Plan.astro`'s `overlay` slot OUTSIDE `.wrap`, which goes `inert` while open (page scroll
  locked); focus moves to the close button, Tab stays inside, Esc / the close button / a tap on the
  backdrop close it and focus returns to the opener (none — a deep link or a forward navigation —
  → the visible tab's heading, given `tabindex="-1"`); `.wrap` also gets `aria-hidden` while open
  (fallback where `inert` is unsupported). A control whose re-render removed or disabled it hands
  focus to the close button. Opening pushes `#detail/<metric>[/<date>]` (picking a day replaces it),
  so browser Back closes the sheet and lands on the tab hash entry underneath (`#nutricion`, see "Tabs
  and sections"); closing a deep-linked sheet (no entry of ours) replaces the URL with the current tab
  hash (`window.HCNav.hash()` from core.js; '' without it), and core.js has already shown the deep
  link's host tab underneath (`#detail/sleep` → Salud), so it closes onto `#health`; a page opened with that hash opens the view — only for an OWN key
  of both `DETAIL.metrics` and the copy (no `constructor`), and a date must round-trip
  (`HC.isoDate` rejects 2026-02-31); a bad or out-of-range date falls back to the default day and the
  URL is replaced to match. A re-open while the close's `history.back()` is in flight (`pendingBack`)
  writes no history until that popstate arrives, which then pushes the new sheet's entry instead of
  closing it. A frame that refuses history writes (sandboxed artifact) still gets the sheet, and
  closing then never calls `history.back()` (and leaves no lock / inert / aria-hidden behind). The
  7-day line is computed once per (metric, range); a day tap re-renders only the calendar and the day
  panel and moves the chart's selection rect. The opener delegation ignores a click / Enter on a
  control inside a card (a, button, summary, input, select, textarea, `role="button"`) other than the
  opener itself.

## Profile — avatar button + profile sheet

Strava / WHOOP-style profile, honest data only, opened from a round **avatar button** at the right
end of the top bar (`web/src/components/Avatar.astro`: the photo, else the initials, else a generic
person icon; ≥ 44px; NOT a tab). It reuses the detail sheet: `web/src/client/profile.js` (inlined
before detail.js) registers `window.HCViews.profile`, and detail.js renders any registered view in
the same modal (focus, inert, Esc, Back) with the deep link `#profile` instead of
`#detail/<metric>`; the Tab trap also cycles through `<summary>` and a checked radio.
`HCDetail.open(key, date, { focus: '<selector>' })` opens a view focused (and scrolled) on one of its
controls instead of the close button.

- **Goal setting ("Objetivo")** — the FIRST section under the header (also on the onboarding sheet):
  three labelled radios Mantener / Bajar / Ganar, each with a one-line description ("Mantener tu
  peso", "Déficit suave (~−320 kcal/día, sin tocar los días de bici)", "Superávit suave (~+300
  kcal/día)"). The kcal come from `lib/profile/goal.mjs` `goalOptions(resolveTargets(plan))` (mean
  goal − maintain over rest + gym, rounded to 10; "bike days untouched" only when bike / bikeLong
  equal maintain), baked as `PROFILE.goals` by `web/pages/index.astro`, never typed. The goal itself
  belongs to Nutrición (`client/nutri-day.js`, inlined before profile.js): the checked radio is
  `HCNutri.state().goal` and a change calls `HCNutri.setGoal`, which writes the SAME key as before
  (`hc.nutri.goal`, fallback `page.goal`) and refreshes the summary, plan, fuelling, Inicio card, rings
  and the kcal chip at once. No `HCNutri` or no options → the section is omitted. On the LAN page the
  goal is also stored on the SERVER and the section adds "Peso objetivo" + a status line + the
  Progreso line (see "Nutrition v2 part 3").

- **Sources** (all optional, merged by `lib/profile/profile.mjs` `loadProfile` → `buildProfile`;
  manual wins over Strava for the same field):
  1. `profile/profile.json` (gitignored; tracked template `profile/profile.example.json`, synthetic):
     `birthdate` (YYYY-MM-DD), `heightCm`, `devices: [{name, type: watch|bike-computer|ems|other,
     since?: YYYY-MM, manual?: "<file>.pdf"}]` (`manual` = a bare file name in `data/gear/`,
     `MANUAL_FILE_RE`: no folders, no `..`; see "Device manuals" below), `hiddenDevices: [name]`
     (left out of Dispositivos, case-insensitive, manual and Strava-derived alike; applied at build
     time, never baked — for a device Strava saw once), `supplements: [{name, dose?, meal}]` (see "Nutrition v2"), `events:
     [{name, date: YYYY-MM-DD, type?: hyrox|race|sportive|other, location?}]` (upcoming races; baked
     sorted by date, `EVENT_TYPES`), optional `name` / `city` overrides. Validated by `validateManual`: at build
     time a malformed file is IGNORED with a `WARNING:` naming the reason (the page still builds from
     the Strava + derived data); `npm run check` (`build-web.mjs --check`, `checkManualProfile`)
     FAILS on it with the same reason.
  2. `data/profile/strava-profile.json` + `data/profile/avatar.jpg` (gitignored), written by
     `data/profile/sync-profile.js` (`npm run sync:profile`, part of `npm run sync`, before the settings sync) from the
     ingest service's `GET /export/athlete`: name, city / country, photo URL, athlete type (focus),
     bikes / shoes (name, brand / model, frame type, weight, distance in m, retired, primary),
     `gearScopeMissing`, and devices seen on stored activities (`device_name` → count + last day;
     the kind is guessed by `deviceType` from explicit brand + model lines only — Apple Watch, Garmin
     Forerunner / fēnix / Venu / Instinct / vivoactive / Epix → watch; Garmin Edge, Wahoo ELEMNT,
     Hammerhead Karoo, COROS DURA → bike computer; Polar H10 / Verity sensors and anything unknown →
     other). The snapshot is rewritten only when its content changed. The avatar (`profile_medium`)
     is downloaded only from Strava's photo hosts (`AVATAR_HOSTS`: `dgalywyr863hv.cloudfront.net` or
     `*.strava.com`, https, `redirect: 'error'`), streamed with a hard 60 KB cap, and kept only if
     the response is `image/jpeg` AND starts with the JPEG magic bytes. `avatarSourceUrl` in the
     snapshot records the URL the saved photo came from, set only after a successful download (the
     photo is written before the JSON); a download is planned whenever it differs from
     `profileMedium` or the file is missing, so a failed download is retried next run and keeps the
     old photo (warning, exit 0). Strava with no photo → the avatar is removed. No token /
     unreachable service / an ingest image without the endpoint (404) → exit 1, no file touched; any
     other failure → a one-line `ERROR:` and exit 1. A broken snapshot file is ignored by the build,
     never fatal.
  3. Derived: weight = the newest row of `weight.csv` with its date (never Strava's weight). The AGE is
     computed client-side from `birthdate` on the viewer's clock, so builds stay byte-identical.
- **One source of truth per owner fact** (read as FILES by the read-only coach subagents, see
  "Knowledge base + expert subagents"): weight = `weight.csv` (live), height / birthdate / devices /
  supplements / events = `profile/profile.json`, goal + target weight = `data/profile/settings.json`,
  stable context (injuries, history, preferences) = `profile/about-me.md` — never numbers in prose.
  `settings.json` (gitignored, `data/profile/*`) = `{goal, targetWeightKg, updatedAt, fetchedAt}`,
  written by `data/profile/sync-settings.js` (`npm run sync:settings`, step of `npm run sync` before `sync:foodlog`)
  from the ingest service's `GET /food/settings` (the server-side goal of "Nutrition v2 part 3";
  `INGEST_URL`, `X-HC-Food: 1`, no token; the URL's host must be an IP literal, `localhost` or in
  `FOOD_ALLOWED_HOSTS`): atomic, rewritten only when goal / target / updatedAt changed or the stored
  `fetchedAt` is from an earlier UTC day; unreachable / 404 / 421 / 503 / a malformed body → a
  `WARNING:` line, the old file kept, exit 0. The goal list and target range are copies of
  `foodlog.mjs` `SETTINGS_GOALS` / `FOOD_LIMITS.targetWeight*` (a test pins them). The page does not
  read it (it asks the service directly).
- **Ingest side** (`services/health-ingest/src/athlete.js`, table `strava_athlete`,
  `sql/004_athlete.sql` + `005_athlete_refresh.sql`): after a successful Strava pull has been
  recorded, the sync kicks off (in the background, not awaited by `POST /sync`; one refresh in
  flight; Strava calls aborted after 60 s) a refresh of `GET /athlete` + `GET /gear/{id}` (the
  athlete's gear and every `gear_id` on stored activities, ≤ 20) at most once per 24 h; a failure is
  logged, stored in the row (`last_failure_at`, so a restart does not retry at once), retried after
  1 h, and never fails the activity pull. A transient (5xx / network) `/gear/{id}` failure saves the
  snapshot with `gear_partial` and refreshes it again after 1 h; a 4xx for one id is final.
  `GET /export/athlete` (bearer, like
  every `/export/*`) returns profile fields only — never the athlete id, username, sex, weight or raw
  payload; photo URLs only when `https://`. Strava returns bikes / shoes only for a token with
  `profile:read_all`; without it `gearScopeMissing: true` (coarse flag) and the sheet says how to
  re-authorize (steps in `services/health-ingest/README.md`: back up `.env`, re-run
  `scripts/strava-auth.js`, VERIFY the new token against Strava's token endpoint, only then back up
  and delete the stored `strava_token` row, which keeps the old scopes, and the `strava_athlete` row
  to refresh now; rollback = restore `.env.bak` + the backed-up token row). Rollout: `docker compose up -d --build health-ingest` → `npm run sync` → `npm run generate`.
- **Build**: `Avatar.astro` bakes `PROFILE` (the `photo` data URI replaced by a boolean — the image
  is inlined ONCE, in the button's `<img id="avatar-img">`, and profile.js copies it from there only
  if it is a `data:image/jpeg;base64,` URI) + `I18N_PROFILE` (`web/src/i18n/profile-templates.mjs`,
  es/en). Example mode reads the synthetic `profile/profile.example.json` +
  `data/demo/strava-profile.json` and never a photo (initials).
- **Sheet**: header (photo / initials / icon, full name, age, location); Cuerpo / Body (height,
  latest weight + weigh-in date); Material / Gear (bikes, shoes; km to 1 decimal in `--num`, primary
  badge, retired ones folded in a `<details>`, a `--mid` hint on active shoes ≥ `SHOE_REPLACE_KM`
  (700): "consider replacing, ~700–800 km typical life"; the scope note instead when gear is missing);
  Dispositivos / Devices (manual first, Strava-derived ones deduped by name, case-insensitive, usage
  merged into a manual entry of the same name, which keeps its `manual`; `hiddenDevices` dropped; a
  "Manual" link per device with a manual, see below); Suplementos / Supplements (name, dose, meal; omitted
  when there are none); Strava (focus + snapshot date). Próximas pruebas / Upcoming events sits right
  after the goal: upcoming soonest first with "Hoy" / "Mañana" / "Dentro de N días" from
  `HC.daysOld` on the viewer's clock (nothing time-based baked), type · date · location, past ones
  folded in a `<details>` ("Pasadas (n)", newest first); "No hay pruebas próximas." when all are past;
  omitted without events. Nothing known at all
  → only the onboarding hint (copy `profile.example.json`, run `npm run sync`). Styles:
  `web/src/styles/profile.css` (tokens only).
- **Device manuals (LAN page only)** — the owner's PDFs live in `data/gear/` (gitignored); only the
  file names are baked. `scripts/publish-manuals.mjs` (`npm run publish:manuals`, rules in
  `lib/profile/manuals.mjs`) copies ONLY the PDFs named by the visible devices' `manual` into
  `services/plan-web/site/manuales/` and removes everything else there: a regular file directly in
  `data/gear/` (opened `O_NOFOLLOW`, a symlink refused), starting with `%PDF-`, ≤ `MAX_MANUAL_BYTES`
  (50 MB); copies atomic and skipped when identical; a missing / refused file = a warning (exit 0); a
  broken / invalid profile.json leaves the folder untouched; a symlinked output folder = exit 1.
  `refresh.sh` runs it after writing `status.json` (a waiting Sync is already done), under its own
  30 s timeout (`PLAN_WEB_MANUALS_TIMEOUT`), best effort (logged, never an error code). The sheet
  writes a "Manual" link (`.pf-manual`, ≥ 44 px, `target="_blank" rel="noopener"`, labelled "Manual de
  <device> (PDF, …)") `hidden`, and profile.js reveals it only when `HEAD /manuales/<file>` answers 200
  with an `application/pdf` type (one probe per file per load), so the claude.ai artifact, `file://`
  and the example build (whose synthetic device names a manual) never show it. nginx side: see "LAN
  page" → Security.

## Nutrition plan — data pipeline & published artifact

**Two files, merged in memory (by both `generate.js` and the Astro build, from the same
`lib/nutrition/macros.mjs`):**
- `data/nutrition/ingredients.json` (TRACKED, **public** food DB) — the reusable
  `{ "ingredients": { … } }` of per-100 g/ml/ud base foods (`verified:true` = real product
  label, `false` = DB estimate; each carries `name` + `note` + a food category `cat`, see
  `lib/nutrition/categories.mjs`). `name` is localized, `{es, en}`
  (a plain string stays valid for backward compat), resolved by the BUILD locale wherever a food is
  named — Plan de hoy, Tablas, plan-tables.md (generate.js: `LOCALE` env → `plan.locale` → en), the
  portion guide's example foods — by `lib/nutrition/names.mjs` `ingName` / `lineName`; an ingredient without a
  name is a `npm run check` WARNING (the page then shows its key), a malformed one an error, and a test
  asserts every tracked ingredient has es + en names. This is shareable and is the
  one piece of the plan that goes public. It may hold MORE foods than any single plan uses — e.g. the
  107 generic LOG-ONLY basics (`swap: false`: the first 25 — yogur natural, queso fresco / batido, pan de
  barra / de molde, jamón cocido, tomate, lechuga, pepino, aguacate, nueces, almendras, cacahuetes,
  aceitunas, mantequilla, azúcar, café solo, bebida de avena, atún en aceite, sardinas, pechuga de pavo,
  tortilla de trigo, cereales, galletas María, chocolate 70% —, lubina, and 81 everyday Spanish
  foods added 2026-10-02: fish / seafood, meat / charcuterie, dairy, wholegrain carbs, veg, canned
  legumes, nuts, drinks, dishes / pastries) with average BEDCA values (kcal from the macros with EU
  factors 4/4/9, fibre 2, alcohol 7 — never BEDCA's own energy row; when two BEDCA entries of one food
  disagree, the one whose macros match its energy) or USDA FoodData Central ones (FDC energy, carbs = by
  difference − fibre) when BEDCA lacks the food, or, for branded drinks only (Coca-Cola, Aquarius, Cola
  Cao…), the label values of the product sold in Spain (Open Food Facts barcode in `note`);
  `verified: false` and the source id in `note`; prepared dishes say their values vary by recipe; the
  food log searches EVERY food of the file (see "Nutrition v2 part 2").
  Optional NATURAL-UNIT metadata per food (`lib/nutrition/units.mjs`, validated by
  `validateIngredientMeta` inside `npm run check`): `piece: { name: {es, en}, plural?: {es, en}, amt,
  g?, typical? }` — the food's natural piece, `amt` in the food's own unit (g / ml; a `ud` food's piece
  is its unit, amt 100, with `g` = its grams reference), `typical: true` = a typical weight (medium
  fruit, a tablespoon, an egg ~50 g), NOT a weighed label — a tablespoon's weight is PER FOOD (its own
  `piece.amt`: allioli / mayonesa 15 g; olive oil has NO piece, it is per 100 ml and logged in ml); and `weighed: raw | dry |
  cooked` (how the plan weighs it: meat raw, rice / pasta / oats dry, potato / legumes cooked).
- `data/nutrition/plan-data.json` (GITIGNORED, **personal** plan) — the owner's actual diet:
  `data`/`dayPlan`/`extras`/`quesoKeys`/`vegKeys`/`legumeKeys`/`legumePlate`/
  `page`. Each item's `recipe` (`[{ing, amt}]`) references ingredient keys from
  `ingredients.json`; macros are COMPUTED, never hand-typed. Items with no single label use a
  `manual` macro block (legumes, soup, pintxo) — kept verbatim.

`data/nutrition/generate.js` now only VALIDATES the merged plan and writes `plan-tables.md`
(the human-readable reference tables) — it no longer emits any HTML. It fails with a clear
error if `ingredients.json` is missing.

**Fresh-clone bootstrap:** `ingredients.json` ships in the clone (tracked). Copy
`data/nutrition/plan-data.example.json` → `plan-data.json` and
`data/training/training-data.example.json` → `training-data.json` (edit both in your real
plan/program), then `npm ci && npm run generate`. The real `plan-data.json` /
`training-data.json` / `plan-tables.md` / `web/dist/personal/` stay gitignored (personal);
`ingredients.json` and the `.example` seeds are tracked. `npm run build:example` builds from
the tracked seeds plus the tracked synthetic demo extract in `data/demo/extract/` — no copying,
no personal files, useful to sanity-check the pipeline on a bare clone.

**To change a plan number, edit `plan-data.json` (servings/day plan) or `ingredients.json`
(a food's macros/label) — never the generated files.**

Run `npm run generate` (or `node data/nutrition/generate.js && node scripts/build-web.mjs`) to
regenerate (idempotent): validates the plan, writes `plan-tables.md` (incl. the Legumes and
Verified product labels tables), then builds `web/dist/personal/index.html`. **Never**
hand-edit `plan-tables.md`, `web/dist/`, or re-type macros in `food-log.md` — the source is
the two JSONs.
- `npm run check` — validators only, no build: `generate.js --check` (unknown-ingredient
  refs, day totals, Atwater, ambiguous matches) — the day-total kcal sanity band defaults to
  train 2000–2800 / rest 1700–2400 and a plan can override it with optional
  `validation.kcalBand = { train: [min, max], rest: [min, max] }` in `plan-data.json` — + `build-web.mjs --check` (training-data.json
  integrity). Ingredients defined in `ingredients.json` but unused by the current plan are a
  non-fatal WARNING (expected for a shared DB), not an error.
- `npm test` — the full test suite (`node --test`, zero deps beyond `astro`). `pretest`
  builds the example (+ personal, if present) fixtures the web/ tests read.

**Intake rings (in Resumen de hoy).** `lib/nutrition/intake.mjs` bakes the most recent LOGGED day of
`dietary-daily.csv` (kcal > 0) plus the plan's train/rest base day totals (a fallback);
`web/src/client/intake.js` draws four rings (kcal, protein, carbs, fat) against THAT day's target
(`window.HCNutri.targetFor(date)` from client/nutri-day.js: today = `nutriTarget()`, the goal × day
type picked above; a past day = its own detected day type (timeline + programme, its recorded ride
minutes) × the current goal, never today's override; on bike days the MEALS target = day target −
ride fuel, with the fuel on its own line "+ X kcal en la bici"). A past day whose type cannot be
determined (no timeline row, no programmed session → `null`) renders NO rings — no honest target to
fill against. It falls back to the plan's training-day total when the hook is absent or throws. The rings show ONLY when that day is within the
last 3 days of the viewer's clock (decided client-side, so builds stay byte-identical); otherwise
the block renders NOTHING (host hidden, no help text). On the LAN page, today's own food log
(`window.foodTotals`, see "Nutrition v2 part 2") takes the place of the Apple Health day whenever it
has entries.
Intake arrives from a food app that writes nutrition to Apple Health + the
Shortcut `diet_kcal`/`diet_protein`/`diet_carbs`/`diet_fat` keys, which sync folds into one
`dietary-daily.csv` row per day, export rows winning. A ring never fills from the target: a macro
missing on the logged day renders an empty ring with a dash. When the logged day is the viewer's
today it is labelled as in progress ("Hoy, en curso" / "Today, so far"), so partial rings are not
read as a finished day. When NO intake was ever logged (`INTAKE.latest` null, decided at build
time), Resumen de hoy renders no rings host and NO help line. The one-line hint that lived in the day
builder's fold summary ("No food logged: the intake rings appear once a food app writes to Apple
Health", `noneHtml`) was dropped on purpose with the builder: the dial and bars already show the
target with empty tracks, and on the LAN page the food log (Registrar, with its own empty state) is
the way to log; pointing at an Apple Health food app is no longer the recommended path.

## Nutrition v2 — goals, day types, portion scaling, ride fuelling, supplements

Part 1 of the Nutrición redesign: compute + display (food logging, the write endpoint and the
product catalogue are part 2, next section). The `dia` section (key kept for `page.hideTabs`) holds, top
to bottom: Resumen de hoy, Registrar (the food log, part 2), Plan de hoy and Avituallamiento — the
nutrition blocks all client-rendered by `web/src/client/nutri-day.js` from ONE bake, `NUTRI`
(`lib/nutrition/today.mjs` `buildNutriToday`, in `web/src/tabs/Dia.astro`, ~3.6 KB on the example) +
`I18N_NUTRI` (`web/src/i18n/nutri-templates.mjs`, es/en). The day-type radios are server-rendered
(labelled, ≥ 44 px) and are the only control in Resumen de hoy (the goal is set in the profile sheet); everything time-based is decided on the viewer's clock,
so builds stay byte-identical. Each block renders in its own try/catch (a one-line message on failure).

- **Day types (4) and goals (3)** — `lib/nutrition/targets.mjs`: `rest`, `gym` (a gym or run session,
  ~1 h), `bike` (a ride ~2 h), `bikeLong` (> 2.5 h); `maintain`, `cut`, `bulk`. Plan schema (all
  optional, validated by `validateTargets` inside `validateNutrition`): `targets.byGoal[goal][dayType]
  = { kcal, p, f }`; carbs are the REMAINDER ((kcal − 4p − 9f) / 4, never typed; a cell whose protein
  + fat exceed kcal is an error). A missing cell falls back to `DEFAULT_BY_GOAL` (the owner-approved
  numbers: maintain 2500 / 3050 / 3550 / 4200 kcal with 150 P / 60 F; cut 2150 / 2700 / 3550 / 4200
  with 160 / 55; bulk 2800 / 3350 / 3850 / 4500 with 150 / 70 — rest / gym / bike / bikeLong), so an
  old plan keeps working. Default goal = `page.goal` (else maintain). `targets.train` / `targets.rest`
  are read by nothing (they fed the removed day builder; its `targetFor` is gone). Likewise
  `extrasDisplay`, `indulgeKeys`, `alcoholKeys`, `mealReplaceKeys` and `page.notes['registro.*']` /
  `page.offPlanPlaceholder` are IGNORED legacy keys: accepted, never an error, and `npm run check`
  warns about each (`LEGACY_PLAN_KEYS` in `macros.mjs`; safe to delete from a plan).
- **Portion scaling** — `lib/nutrition/scale.mjs`: plans keep their two base days; `BASE_DAY` maps
  rest → `dayPlan.rest`, gym / bike / bikeLong → `dayPlan.train`. CARB-FLEX parts (`lib/nutrition/flex.mjs`
  `isFlexPart`) scale, every other part stays fixed: `flex: null` opts a part OUT; an explicit
  `flex: "carb"` opts it IN (also a manual block, scaled whole); otherwise by FOOD CATEGORY — an `{ing}`
  part whose food is carb / fruit, or a sweet carb staple (honey, jam: ≥ 60 % kcal from carbs; never
  chocolate, ice cream, pastries) (`autoFlexIng`), and a `{use, match}` item whose recipe lines are ALL
  such foods (a mixed composite, a manual block or a food without category stays fixed). Spreading the
  carbs over every carb / fruit part — not just the 2–3 marked ones — is what stops one plate absorbing
  the day (the owner's 235 g of dry pasta on a maintain gym day). **Portion caps**: an ingredient may
  carry `maxAmt` (optional, `data/nutrition/ingredients.json`, in the same scale as a recipe `amt`: g /
  ml, or `UD_AMT` per unit), baked on the model line (`LINE.CAP`, `lineCap` / `capFactor` /
  `capAmount` in `lib/nutrition/amounts.mjs`) and validated by `npm run check` (`validateIngredientCaps`:
  a finite positive number, at least one rounding step — a unit, half a piece, 5 g — and at most
  `MAX_AMT_LIMIT` 2000). Tracked caps: rice / pasta (dry) 150 g, oats 100 g, potato / sweet potato 400 g,
  gnocchi / oven chips / pre-fried sweet potato 300 g, bread roll 135 g (3 rolls), seeded bread 125 g
  (3 slices), honey / jam 30 g, fruit ~1.5–2 pieces (banana 240, apple 270, orange 260, pear 255, peach
  300, nectarine 280, flat peach 200, kiwi 150, plum 130; pineapple 250, watermelon 400, melon 350,
  grapes 200, strawberries 250, blueberries 150 g); a test requires a cap on every carb / fruit food and
  sweet staple. The base day's macros come from the existing engine
  (ingredients.json, never hand-typed) and are baked as a compact SCALING MODEL per base day
  (`planModel`: per meal the fixed macros, the flex parts' lines `[unit, amt, k, p, c, g]` or a manual
  block). `solveScale` = WATER-FILLING (`waterFill`, `lib/nutrition/fill.mjs`, `{clamp: [SCALE_MIN, SCALE_MAX], start: 1}`): one common factor for every carb-flex line so the
  meals hit (target − ride fuel), clamped to `SCALE_MIN`–`SCALE_MAX` (0.6–2.0×); a line that would
  pass its cap is HELD at the cap and the factor is re-solved over the lines still free, until stable (a
  cap beats `SCALE_MIN`: a written amount above its cap shrinks to it); rounded to 2 decimals and
  labelled with 2 decimals ("×1.45"); with every line held the factor is the largest cap reached.
  `capped` = some line is at its cap, `allCapped` = every flex line is (and no manual block, which has
  no cap). DISCRETE lines — whole units (`ud`, whole units) and countable g / ml foods (an
  ingredient with a `piece`, rounded to HALF pieces — `PIECE_GRID` in `lib/nutrition/units.mjs`, one
  unit = `UD_AMT` (100), both baked as `NUTRI.scale.grid` / `.ud`; the model line carries `[…, step,
  ingredient key]`, `lib/nutrition/amounts.mjs` `modelLine` / `stepAmount`; its layout is named ONCE as
  `LINE` with accessors `lineUnit` / `lineAmt` / `lineMac` / `lineStep` / `lineKey` / `pieceOf(pieces, l)` /
  `scaleLine`, mirrored in nutri-day.js — never read by a bare index) — round first at that factor, then the factor is
  RE-SOLVED (water-filling again) on the remaining g / ml parts so the day still lands within tolerance; a
  rounded amount never passes its cap (`capAmount` steps DOWN on the line's grid); with only `ud` parts flexible the
  remainder is reported honestly (plus a one-line note). Amounts round to 5 g / 5 ml (never below one
  step; a `manual` block scales as a whole and shows "×1.30") and the totals are recomputed from the
  ROUNDED amounts. The rest is `rem` (target − ride fuel − meals, kcal): plan-tables.md lists it per
  (goal, day type); Plan de hoy's portion guide hands it to Extras (with caps the example plan's plates
  cannot reach most goal × day types, so its Extras budgets are large). Protein and fat are
  NOT scaled (the guide's Extras takes what the main meals leave of them; `MACRO_TOLERANCE_G` (15 g) only
  feeds the rings' `fatMax`). `planFor(bake, goal,
  dayType, minutes)` gives one plan for a ride of `minutes` (meals target `mt` = target − ride fuel,
  the fuel being all carbs); the page bakes only `{base, t}` per (goal, day type) + the two models and
  runs a line-by-line port of `solveScale` / `planFor` (parity test), so a new ride duration re-scales
  the guide's budgets. `planFor` returns `{base, t, minutes, fuelK, fuelC, mt, meals (each plan meal's
  [k, p, c, g], whole), tot, factor, clamp, udOnly, capped, allCapped, rem}`; the bake per base day is
  `{sl (each meal's slot), fixed, flex}`. `buildDayPlans` precomputes the 12 plans at the default ride minutes for the table in
  `plan-tables.md` ("Daily targets by goal and day type": kcal, P, F, C, meals kcal, ride fuel, carb
  factor, remainder — the Snack column went with the automatic snack). `planModel` names parts (`label`,
  else the ingredient's `name`, else its key) and `solveScale` formats the scaled amounts (`q`); a
  countable food shows pieces with the grams reference (`fmtPieces`: "1½ medium bananas (~180 g)" on the
  half-piece grid, "~2 bread rolls (80 g)" off it; "2 eggs (~100 g)"); `fmt.pieces` bakes only the
  pieces a baked flex line can format.
- **Plan de hoy = a PORTION GUIDE** (the owner: an orientative "how much can I eat", not a menu; the
  choosable blocks, the Añadidos card that changed by day type and the automatic snack were removed) —
  `lib/nutrition/guide.mjs` = the reference, ported line by line in nutri-day.js (parity tests). ALWAYS
  the same four meal groups, every day type: Desayuno, Comida, Cena + Extras; day type and goal only change
  the amounts. **Budgets**: today's plan solve (`planFor`: goal × day type × ride minutes, caps and
  water-fill, no picks) → each main meal's budget (kcal, P, C, F) = the solved macros of the plan meals
  of its slot (`mealSlot` via the baked `base[day].sl`; two meals of one slot add up, a slot with no meal
  is a zero budget); a COOKING-OIL meal (no slot, every part a `fat`-category food: `oilMeals`, baked
  per base day as `NUTRI.guide.oil`) is split evenly between the lunch and dinner budgets (lunch takes
  the rounded half; wholly into the one the plan has; Extras if neither), so oil logged with lunch does
  not drain that meal early; **Extras** = the MEALS target (target − ride fuel) − the three main budgets,
  so it absorbs the add-ons (pre / post workout, a protein anchor, any other unslotted meal such as an
  after-lunch coffee) and whatever the capped plates leave over (`guideBudgets`; a macro the main meals already pass clamps at
  0 and the card says so, never negative). The four meal groups add up to the meals target, which is also the
  fold summary's kcal. **A main meal = a plate by parts**: Proteína ~X g (= meal P), Carbohidrato ~Y g
  (carbs), Verdura "libre", Grasa ~Z g (fat); each macro row = ONE example food (a native `<select
  class="gd-pick">`, ≥ 44 px, aria-label "Ejemplo de Proteína para Comida") + the amount of that food
  that supplies the macro (`exampleAmount`: grams ÷ the food's macro per 100 of its amount scale, in its
  natural unit — pieces with the grams reference for a countable food (`fmtPieces`), whole units, a
  tablespoon for a sauce with that piece, else g / ml (olive oil in ml) on the 5 g grid —, never past its `maxAmt`: then "~150 g (máx.)" + "+
  completa con otra fuente"). Options = every basic of the role's categories (`roleOptions`; protein:
  protein; carbs: carb + legume + fruit; fat: fat — log-only `swap: false` basics included) from
  FOOD_BASICS (the ONE food table, baked for the food log; each entry now carries `c` = category and `x`
  = portion cap), plus the owner's products from the food API when it answered (view time only,
  `<optgroup>` "Mis productos"), sorted by the folded name. Default example = the food the base plan uses
  for that role in that meal (`mealDefaults`: the role-category recipe line that supplies most of that
  macro, baked per base day as `NUTRI.guide.defaults`), else `GUIDE_FALLBACK` (pollo / arroz / aceite de
  oliva). A pick persists per viewer, not daily (`hc.nutri.guide` = `{picks: {<slot>.<role>: 'b:<key>' |
  'p:<id>'}}`, every access wrapped; an unlisted pick — a product without the API — shows the default and
  stays stored; the orphaned `hc.nutri.picks` of the removed choosable blocks is cleared on load). Each example covers ITS macro only (a muted note says so: the guide is orientative).
  **Extras card**: "~N kcal para extras hoy", a muted "Incluye café, tentempiés y pre/post-entreno"
  line, a muted hint with example costs computed from the food DB
  (`EXTRAS_EXAMPLES` → `NUTRI.guide.extras`: un plátano ~106, un yogur ~79, un batido de proteína (30 g)
  ~114 kcal; the generic coffee basics (cortado, café con leche) were dropped 2026-10-06: the owner logs
  his coffees as his own recipes), "Repártelo antes y después de entrenar" on gym / bike day types, its P / C / G line; no item
  list, no selects. **Live link with Registrar** (LAN page, `window.HCFood.groupTotals()` = today's
  sums per group `{meals: {breakfast, lunch, dinner}, addon}`, null without the API): a main meal shows
  "✓ N kcal registradas" at ≥ 90 % of its kcal budget (`DONE_SHARE`), "en curso: N kcal" when partial;
  each macro row shows what is LEFT (budget − logged, floor 0, "de 45 g" once something is logged) and
  recomputes the example amount for it; a row with ≤ 10 % left (`COVERED_SHARE`) is "✓ cubierto"; Extras
  = budget − logged add-ons ("(de N)"); "Te queda hoy: kcal · P · C · G" (meals target − everything
  logged, `dayRemaining`) under the guide. **Day cap**: a row's left = min(the meal's own left, what
  the day still allows = "Te queda hoy", `capByDay`), and the example amount and the "+" use that capped
  left, so overspending one meal is taken from the others; when the DAY has ≤ 10 % of that macro's
  meals target left the row is "✓ cubierto (día)" (no example amount, no "+"; a row covered by its own
  meal keeps "✓ cubierto"). Extras' remaining kcal and P / C / G line are capped the same way, and it
  reads "✓ cubierto (día)" when the day's kcal are covered. Each open macro row gets a "+" (`.gd-add`, 44 px, aria-label "Registrar
  195 g de Pechuga de pollo en Comida") that logs that example amount into that meal through
  `HCFood.addGuide` (a basic = ONE quick entry with `basicEntry` / `basicLabel`, in pieces when the food
  has them, sent with `force` since the macros are the DB's own; a product = a product entry; one request
  id per pending add, kept across an ambiguous retry). The guide re-renders on every add / delete (food.js
  calls `HCNutri.refresh()`) and on goal / day type / ride changes; without the API: budgets only, no
  "+", no "Te queda". `NUTRI` = `{…, base: {<day>: {sl, fixed, flex}}, guide: {roles, defaults, oil,
  fallback, extras, done, covered}}`: a few KB on the example (budget: `lib/nutrition/today.test.mjs`,
  8 KB); FOOD_BASICS carries `c` and `x` (budget: `web/test/food-build.test.mjs`).
- **Day-type detection** (`lib/nutrition/daytype.mjs` = the reference; nutri-day.js ports it over the
  baked `DETECT` and a test runs both over `DAYTYPE_CASES`): today's workouts from `SCORES.timeline`
  (same-day rows already merged per modality). Only real training counts (`DETECT`): gym / run ≥ 20 min
  → gym (shorter = a stub); `other` (walks, tennis…) only ≥ 45 min, as gym; a ride < 30 min is a commute
  (ignored), 30–74 min → gym, ≥ 75 min → bike, ≥ 150 min → bikeLong; a zero / junk duration is dropped.
  Then the programmed session in `TRAINING[today]` (`kind: "bike"` by optional `durationMin` with the
  same ride thresholds, absent = bike; any other kind → gym); else rest. The MOST
  DEMANDING of done and programmed wins (a gym morning with a long ride programmed → bikeLong; a tie
  goes to what was done, whose ride minutes are real). `training-data.json` accepts `kind: "bike"` +
  `durationMin` for this. The manual override and the goal are kept in localStorage (`hc.nutri.goal`,
  `hc.nutri.dayType` = `{date, type, auto}`, so the override expires the next day), every access
  wrapped; the label says "(auto)" / "(elegido)", with a "use the detected one" button. An override
  LESS demanding than a type detected later that day (`auto` rose since it was picked: picked gym,
  then a long ride synced) is dropped on load with a one-line note ("Detectada salida larga: cambiado
  a Bici larga"); a more demanding one (planning a ride) or a deliberate downgrade stays. Today's
  target is the ONE source for Nutrición: `window.nutriTarget()` = the MEALS target (`k, p, c, g`,
  `fatMax` = fat + 15 g, `fuelK`, `day` = base day train / rest, label) feeds the intake rings
  (`HCNutri.targetFor(date)` = the same shape for an earlier logged day, labelled "Objetivo / Comidas de
  ese día", or `null` when its day type is unknown; a day beyond the 3 baked timeline days detects its
  type from `DETAIL.sessions` — `daytype.mjs` `dayInputFor`, see "Nutrition v2 part 3"), and
  every goal / day type / ride change calls `window.intakeRefresh()` directly (a failure shows a
  one-line message, never a stale ring).
- **Resumen de hoy** — the day type as ONE row of 4 equal segments (real radios, inline SVG line
  icons, short labels `dayShort`: Descanso · Gym · Bici · Bici larga; the full `dayTypes` names stay
  for sentences and the segment title; the DETECTED type's segment gets `.seg-auto`, a small dot), then
  a 270° kcal dial (`.nt-dial`, the Inicio dials' arc baked as `NUTRI_ARC` from `view/dial.mjs`
  `arcPath(0, 1)`; target kcal centred in `--num`). The dial and the three macro bars (Protein /
  Carbs / Fat, grams in `--num`) fill ONLY from intake logged on the viewer's today (`INTAKE.latest`
  dated today: fill = logged / target via `pathLength` 100, `--trend`, > 110 % `--mid`, a missing macro
  = an empty bar with a dash; today's page food log, `window.foodTotals`, wins over `INTAKE` when it has
  entries, with its own note); otherwise the empty track + the target. The goal is a muted chip under
  the dial (a ≥ 44 px button, `#nutri-goal-chip`) that opens the profile sheet focused on its Objetivo
  setting (`HCDetail.open('profile', null, { focus: '#pf-goal input:checked' })`), then on bike days the
  plan line ("meals + ride fuel = total", meals = the guide's meals target; the remainder and macro-off
  notes are gone: the guide's Extras absorbs them), then the intake
  rings — which step aside (host hidden) when the logged day is today, since the dial shows it. Inicio's
  "today you eat" card (`#eat-body`) shows the same day type, goal and target.
- **Plan de hoy — layout** — restrained cards (no accent border): meal name as a caps label, its kcal
  budget big in `--num`, the macro rows (caps label left, "~45 g" in `--num` right; the example select
  below with the amount and the "+"; a long amount wraps under the select at 360 px, right-aligned), the
  muted P / C / F (es: G) mini line. On wide screens (>= 900 px) the four meal-group cards flow into two
  masonry-like CSS columns (`columns: 2`, cards `break-inside: avoid`). The block is a native
  `<details class="nutri-block sec-fold nutri-fold" id="nutri-plan-fold">`, COLLAPSED by default: the
  summary = the heading + the meals target (`#nutri-plan-kcal`, written on every refresh); the open
  state is a per-viewer convenience (`hc.nutri.planOpen` '1' / '0', every access wrapped, saved on
  `toggle`); the guide renders while collapsed. Avituallamiento stays after it, never collapsed. Styles:
  `.gd-*` in `web/src/styles/nutri.css` (tokens only: `--good` = covered / done, `--mid` = a portion at its
  maximum, `--accent` = the "+").
- **Supplements** — optional `supplements: [{ name, dose?, meal }]` in `profile/profile.json`
  (`meal` = breakfast | lunch | preworkout | postworkout | dinner | snack, `lib/nutrition/slots.mjs`
  `MEAL_SLOTS`; validated by `validateManual`). A discreet "name dose" line (no macros; a small pill SVG
  icon, no emoji) under the guide's card of that slot: breakfast / lunch / dinner in their card, every
  other slot in the Extras card with its slot name ("Electrolitos (Pre-entreno)"). A plan meal's slot =
  its own `slot` field, else guessed from its es / en name (`mealSlot`: desayuno / breakfast, comida /
  lunch, pre / post-entreno / workout, cena / dinner, merienda / snack / anclaje). They are also listed
  in the profile sheet.
- **Avituallamiento** (bike day types only; `lib/nutrition/fuel.mjs` = the reference, ported in
  nutri-day.js over the baked `FUEL`, pinned by a test): Antes (2–3 h before ~1–2 g/kg carbs; last hour
  30–60 g easy carbs), Durante (bike 60 g/h, bikeLong 60–90 g/h; fluids 500–750 ml/h; sodium ~300–600
  mg/h, more in heat — ranges, no weather data), Después (within 1 h ~1–1.2 g/kg carbs + 30–40 g
  protein). g/kg uses the latest weigh-in (`profile.weight`, else rates only). Duration = today's
  recorded ride, else a picker (1–6 h, default 2 h / 3.5 h); carbs in practical units (gel ~25 g,
  banana ~25 g, bar ~40 g, a 500 ml bottle at 6–8 % ≈ 30–40 g) and a mix idea (a bottle per hour +
  gels). The on-bike carbs count inside the day total (plan point = the range midpoint × hours), so
  the duration also re-scales the meals. A recorded ride uses its real minutes (shown, not pickable);
  a picked duration is kept per date and day type (`hc.nutri.rideMin` = `{date, type, min}`, expires
  the next day). Rendered as a 3-step timeline (Antes → Durante → Después, `.fuel-steps`) with one key
  number per step in `--num` (carbs before, g/h during, carbs after). It says it is orientative, not
  medical advice.
  **Own fuel items** (optional plan field `fuel.items: [{ name: {es, en} | string, carbs: <g per
  piece, 0–100>, fat?: <g ≥ 0>, kind?: "fast" | "slow" }]`, validated by `npm run check`
  (`validateFuelItems`, called from `validateNutrition`: a malformed item is an error naming the field),
  baked localized as `NUTRI.fuel.items = [{n, c, f, k}]` only when present — absent = the generic
  output): Durante then shows the PIECE MIX (`fuel.mjs` `ownDuring`, ported in nutri-day.js, pinned by
  `FUEL_CASES`): eating starts at min 30 (`OWN_START_MIN`; the first half hour runs on the carbs eaten
  before), pieces target = the during-rate midpoint × (minutes − 30) / 60; n whole pieces spread evenly
  from min 30, a piece before half the ride = the first `slow` item, from half way the first `fast` one
  (fallback: an item without kind, then the first); n (at most one piece per 10 min) = the total closest
  to that target, never above the during range top; the line names the total, a "~X g more from a drink
  or a banana" gap to the plan point (the day accounting is unchanged) and the 6–8 % bottle as the
  alternative (the generic gel / bar equivalents and the bottles + gels mix are not shown then). Antes'
  last hour names k fast pieces inside 30–60 g, closest to 45 g. Personal items live only in the
  gitignored plan-data.json; the example plan has none (tests use synthetic items).
- **Tablas = fixed reference values** — `lib/nutrition/reference.mjs` `buildReference(nut, {lang,
  words})`, server-rendered by `web/src/tabs/Tablas.astro` through `components/RefTable.astro` (no
  bake, no client script: `client/tablas.js`, `BreakfastTable.astro` and the DATA / EXTRAS /
  QUESO_KEYS / VEG_KEYS / FRUIT_SUMMARY / I18N_TABLAS globals are gone). Same sections / lists, NO
  portions: each food per its NATURAL unit (`refUnit`): a piece with its grams reference ("1 medium
  banana (~120 g)", a typical weight tagged "typical weight"), a tablespoon sauce per tablespoon, else "100 g" /
  "100 ml" (olive oil: "100 ml") + how it is weighed ("100 g dry", "100 g raw"); a composite option = a group row + one row
  per component food; a `manual` option = "1 serving (<its q>)". A list section with no rows (a plan whose list holds only the "none" option) is not
  rendered at all (no empty accordion). A carb list's train / rest tiers
  collapse to ONE table (no train / rest portion columns); same-named options collapse only when their
  reference rows are equal (the same food at another amount), otherwise both rows show (`listRows`). A one-line note at the top says today's
  amounts are in Plan de hoy; the generic notes (dict `tablas.*`) and the example plan's
  `page.notes['tablas.*']` no longer talk about portions. plan-tables.md (generate.js) keeps "Daily
  targets by goal and day type" and writes the same reference rows ("Food reference (fixed values per
  natural unit)"; legumes per 100 g cooked instead of a ~300 g plate).
- **Old plans** — a plan without `targets.byGoal` / `page.goal` falls back to the code defaults
  (`DEFAULT_BY_GOAL`, goal `maintain`; `lib/nutrition/targets.mjs`), and which parts scale is decided by
  food category, so no migration is needed. The retired one-shot migration scripts
  (`scripts/migrate-plan-data.mjs`, last in 76b9c3b; `scripts/migrate-plan-v2.mjs`, last in 22cfabd) live in git history.

**The plan the owner actually views is a claude.ai artifact (frozen snapshot).** The owner's
personal artifact URL lives in **`data/nutrition/artifact.local.md`** (gitignored, never
committed) — **read that file before re-publishing** so you never have to ask for the URL
again; it is also mirrored in persistent memory for other machines, but the local file is the
deterministic source. The first time you publish (no `artifact.local.md` yet), create a new
artifact from `web/dist/personal/index.html` and write its URL into that file. Editing local
files does NOT update the published artifact. After a plan change: (1) edit the JSON → (2) run
`npm run generate` → (3) re-publish via the Artifact tool with
`file_path=web/dist/personal/index.html` and `url=<the URL from artifact.local.md>` (favicon
🥗, keep stable), then hard-reload (Cmd/Ctrl+Shift+R). The build output is artifact-ready
(CSP-safe, no external refs, no `<script type="module">` — every script is `is:inline`).

## Nutrition v2 part 2 — food log, products, recipes (LAN page only)

The owner logs what he eats from the LAN page (`services/plan-web`), with his usual supermarket
products and his own recipes; Resumen de hoy fills from that log. Honest data: macros come only from
product labels / Open Food Facts values the owner confirmed, recipes are computed, unknown macros stay
unknown.

- **Formula** — `lib/nutrition/foodlog.mjs` is the ONE reference (constants `FOOD_STORES`
  mercadona / dia / eroski / other, `FOOD_UNITS` g / ml, `ENTRY_UNITS` + serving, `FOOD_MEALS` =
  `slots.mjs` `MEAL_SLOTS`, `RECIPE_KINDS`, `REF_TYPES`; `productEntry`, `recipeBasis`,
  `recipeEntry`, `entryFromBasis`, `dayTotals`, `atwaterOk`; `FOOD_LIMITS` = the shared input limits —
  name / brand / query caps, the barcode pattern, per-100 kcal 900 / macros 100, entry amount 5000… —
  baked for the page as `FOOD_CONST.limits` and copied into the service's food-calc.js, a test pins them
  equal). A product entry = per-100 × amount in the product's own
  unit, or servings × its `servingSize` (no serving size → no serving; never g ↔ ml). A recipe =
  the sum of its ingredients (amounts in each product's unit; a basic snapshot per 100 g / ml or per unit,
  see "Recipe basics" below): kind `serving` ÷ servings, kind
  `batch` × 100 ÷ total COOKED weight (per 100 g cooked); a missing product = incomplete, not
  loggable. Entries round once (kcal whole, macros 1 decimal) and day totals sum the rounded
  snapshots; a macro unknown on any entry is flagged in `missing` (the sum is then a minimum).
  Atwater: 4p + 4c + 9f within ±25 % of kcal or 10 kcal. Ports: `services/health-ingest/src/food-calc.js`
  (the service is built from its own directory) and `web/src/client/food.js` (`window.HCFood`);
  `lib/nutrition/foodlog.test.mjs` and `web/src/client/food.test.mjs` run all three over
  `FOODLOG_CASES`, so a formula change is made in all three (food-calc.js is a LITERAL copy: `var`,
  semicolons). The add sheet's preview goes through the same functions: a recipe whose products are all
  listed uses `recipeBasis`, one with an archived product the server's computed basis on the recipe row,
  both through `entryFromBasis` — no fourth copy. **Basics** (generic foods, no product needed):
  `basicModes` / `basicAmount` / `basicEntry` / `basicLabel` / `basicConvert` in the same file, over
  ONE baked basic `{k, n, u: g | ml | ud, m: [kcal, p, c, f] per 100 of u (a `ud` food: per unit),
  pc?: {a, r, o, m}, v?: 1 = a verified label}` (`lib/nutrition/basics.mjs` `buildBasics(ING, lang)`:
  every food of ingredients.json with all four macros, localized, sorted by the accent-insensitive name
  in code-unit order; `normName` = the search's normalization). Modes: `piece` (a countable food, or a
  `ud` food) or the food's own unit; a `ud` food also in `g` when its piece states grams; never g ↔ ml.
  Label = "<name> · <amount> ud (~<g> g)" for pieces, "<name> · <amount> <g|ml>" otherwise (es "ud",
  en "pc", decimal comma in es), capped at `nameMax`. Only TWO copies: the reference + food.js
  (`BASIC_CASES` / `runBasicCase`, pinned by both test files) — the server never computes a quick
  entry, so food-calc.js has none.
- **Storage + API** — `services/health-ingest`: `sql/006_food.sql` (idempotent) = `food_product`
  (per-100 kcal / protein / carbs / fat, store, unit g / ml, serving size?, barcode? unique among
  ACTIVE products, source off / label / manual, off_code?, archived), `food_recipe` (kind, servings
  XOR cooked_weight_g, ingredients JSONB `[{productId, amount} | {basic, name, unit, amount, per100}]`,
  archived), `food_log` (the owner's
  LOCAL date sent by the page, meal slot, ref_type product / recipe / quick, ref_id?, label, amount +
  unit, SNAPSHOT kcal / protein / carbs / fat taken at log time — a later product edit never rewrites
  history; macros NULL only on a quick entry that did not state them). `src/food.js` routes:
  `GET/POST /food/products`, `PUT/DELETE /food/products/:id` (DELETE = archive),
  `GET/POST /food/recipes` (+ computed `perServing` / `per100`), `PUT/DELETE /food/recipes/:id`,
  `GET /food/log?date=` (entries + `dayTotals`), `POST /food/log` (returns the entry + the day's
  totals), `DELETE /food/log/:id`, `GET /food/off?barcode=<8–14 digits>|q=<text>`. Strict hand-written
  validation (unknown keys refused, trimmed + capped strings, per-100 kcal ≤ 900 and macros ≤ 100 g,
  amounts ≤ 5000, dates round-trip, recipe macros never accepted from the client) and `400 atwater`
  unless `force: true` (the page offers "save anyway"). Errors are coarse `{error, field?}` codes
  (`invalid`, `atwater`, `barcode_exists`, `unknown_product`, `unknown_recipe`, `recipe_incomplete`,
  `unit`, `not_found`, `rate_limited`, `off_*`, `payload_too_large`, `internal`), never DB text.
  `src/food-db.js` = the parameterized store (NUMERIC → numbers, the date via `to_char`).
- **Open Food Facts** — `src/off.js`, SERVER side only (the page never calls OFF): v2 product API /
  `cgi/search.pl`, User-Agent `health-coach/1.0 (self-hosted personal food log)` (no personal data),
  8 s timeout, `redirect: 'error'`, 1 MB response cap, in-memory LRU cache (24 h; not-found 1 h; an
  upstream 429 / 5xx / timeout 60 s), one shared in-flight request per identical lookup,
  token buckets (≤ 10 searches / min, ≤ 100 product reads / min; over → `429 off_rate_limited`
  without calling OFF). Only normalized fields leave it: `{code, name (es first), brand, stores, unit,
  per100 {kcal (kcal, else kJ ÷ 4.184), protein, carbs, fat}, servingSize, complete}`; a missing or
  implausible nutriment is `null`, never 0, and `complete: false`. Nothing is stored until the owner
  saves the product (`source: "off"`). No `?store=` bias (not trivial with OFF's search).
- **Security** — the routes are UNAUTHENTICATED (a static page cannot hold a secret) and LAN only.
  Layers: (1) **DNS rebinding** — plan-web nginx answers EVERY path (page, `status.json`, `/api/*`)
  only for a Host that is an IP literal (v4 / bracketed v6), `localhost` or a name listed in
  `PLAN_WEB_EXTRA_HOSTS` (`map $host $hc_host_ok` + a server-level `return 421`; `hosts.sh`, mounted as
  `/docker-entrypoint.d/15-hc-hosts.sh`, renders the names into exact map entries), and ingest
  `/food/*` repeats it (IP literal, `localhost`, `host.docker.internal` = the proxy hop, which nginx
  sends as `Host`, or `FOOD_ALLOWED_HOSTS`; else `421 misdirected`); (2) on writes an `Origin` header
  must name an allowed host (`403 forbidden_origin`); (3) `X-HC-Food: 1` on every request (`403`) and
  `Content-Type: application/json` on writes (`415`) — from another site both need a CORS preflight
  the service never approves (no CORS headers). Together they keep a website opened in a LAN browser
  from reading or writing the log; a device ON the LAN calling the service directly is trusted (the
  LAN-only model). **To add a hostname** (e.g. `http://plan.lan:8090`): `PLAN_WEB_EXTRA_HOSTS=plan.lan`
  in `services/plan-web/.env` + `FOOD_ALLOWED_HOSTS=plan.lan` in `services/health-ingest/.env`, then
  `docker compose up -d` in both; only names you control on your own network. Bodies ≤ 16 KB
  (`413`); writes ≤ 60 / min per client address (`429`) — behind plan-web every request comes from
  nginx, so it is ONE shared budget (a per-client limiter is a later slice). plan-web nginx proxies
  the prefix `/api/food/` → ingest `/food/` (GET / POST / PUT / DELETE, body passed,
  `client_max_body_size 16k`, `X-HC-Food` forwarded, `Host host.docker.internal`). A public reverse
  proxy must NEVER forward `/food/*`. `006_food.sql` is an OPTIONAL migration group
  (`src/migrations.js`): if it fails the service logs `food_migration_failed` and keeps ingesting /
  syncing / pulling Strava, and only `/food/*` answers `503 food_unavailable`.
- **Page** — `web/src/client/food.js` (inlined after nutri-day.js, before intake.js; copy
  `web/src/i18n/food-templates.mjs` es / en baked as `I18N_FOOD` + `FOOD_CONST` in `Dia.astro`;
  styles `web/src/styles/food.css`, tokens only). Everything is decided at VIEW time like the
  freshness line: the Registrar block (`#food-log-block`, in `dia` right after Resumen de hoy, before
Plan de hoy) and the
  two folds (`web/src/tabs/Food.astro`: `#food-products`, `#food-recipes`, before Tablas, rendered only
  when `dia` is visible, no section key) ship `hidden` and appear only when `GET /api/food/products`
  answers — so the claude.ai artifact, file:// and the example build show nothing new and builds stay
  byte-identical. Nothing of the log is kept in the browser. **Day navigator** (on Registrar's heading
  line, `.food-head`: the title on the left, its rule filling the gap, the navigator on the right; a row too
  narrow wraps the navigator under the title; static markup in `Dia.astro`, driven by food.js): `‹ <date> ›` = real 44 px buttons (aria-label
  "Día anterior" / "Día siguiente"), the date in an `aria-live` label ("Hoy" on the viewer's today, else
  `HC.fmtDate`), next disabled on today (no future days), a short "Hoy" button (aria-label "Volver a hoy") before `‹` only on another day; the viewed
  day is NOT persisted (the page always opens on today; `S.view` null = follow today), EXCEPT late night: before
  `LATE_NIGHT_HOUR` (04:00, `slots.mjs`, baked as `FOOD_CONST.lateNightHour`) it opens on the day before (as if ‹ was
  tapped once; also a viewer on "today" whose day rolls over), and that automatic view returns to today from 04:00 on
  `visibilitychange` (a day picked by hand never moves); `foodTotals` / `groupTotals` / `addGuide` stay today-only. A past day is read
  with `GET /api/food/log?date=` on each visit into its own slot (`S.dayLog`, never today's `S.log`) and
  renders the same cards, day total ("Total del día"), delete and "+ Añadir"; a slower answer for a day
  already left is dropped (`viewSeq`); a failed read shows the error + "Reintentar" (`day-retry`). A
  sheet opened on a past day logs to that day (its title adds the date); one opened on "today" resolves
  today at EACH save / retry (23:58 → 00:02 logs to the new day), same request-id / ambiguous-retry /
  re-read of THAT day; a delete removes its row by id from whatever log of that date is current when it
  commits (a re-read mid-delete cannot bring it back); an add or delete on a past day never touches
  today or calls `HCNutri.refresh()`. The server already accepts any
  valid date (2000–2100). **Registrar**: the day total, then FOUR
  restrained group cards — Desayuno / Comida / Cena / Añadidos (en: Extras) — (`slots.mjs` `MEAL_GROUPS`
  + `mealGroup`, baked in `FOOD_CONST` as `groups` / `mainSlots` / `addonGroup` / `addonSlot`; label,
  amount, kcal in `--num`, P / C / G line, a 44 px delete button with an aria-label, "+ Añadir" per
  group). The stored slot enum is UNCHANGED (`food_log.meal` = the six `MEAL_SLOTS`, no schema change):
  entries stored as preworkout / postworkout / snack show in Añadidos with a tiny muted slot tag
  (`.fe-slot`). **Add sheet**: a registered detail-sheet view
  (`window.HCViews['food-add']`, deep link `#food-add`, registered only once the API answered; focus
  trap / Esc / Back from detail.js, whose Tab trap now includes form fields and whose
  `HCDetail.open(key, date, {opener})` returns focus to the tapped button): meal select = the four
  groups (Desayuno / Comida / Cena / Añadido; a main group is stored as its slot, Añadido as `snack`;
  a fresh sheet guesses the group by the viewer's hour: < 4 (late night) dinner, < 11 breakfast, < 16 lunch, < 20
  Añadido, else dinner), tabs Mis
  productos (search, grouped by store) / Mis recetas / Rápido (label + kcal + optional macros), amount in g / ml / servings (servings only with a serving
  size; a per-serving recipe in servings, a batch one in grams of cooked food; switching a product to
  servings sets the amount to 1, and back to its unit sets one serving in that unit, never reusing the typed number), live preview from the
  ported formula, `aria-live` results; save closes it, re-renders Registrar and announces "Añadido:
  …". The former "Del plan" tab (it logged Plan de hoy's menu) is gone: the portion guide's "+" logs
  an example amount instead (see "Plan de hoy = a PORTION GUIDE"). **Basics in the Mis productos tab**: the search box also looks in `FOOD_BASICS`
  (baked by `Dia.astro`, each food with its category `c` and portion cap `x`, which the portion guide reads — size budget in `web/test/food-build.test.mjs`; the box shows even with no product yet). An EMPTY search
  lists the products only, plus a one-line hint ("Escribe para buscar también en los básicos…"); typing
  lists the matching products by store, then a "Básicos" / "Basics" group (accent- and case-insensitive,
  names that start with the text first, ≤ 25 rows), each row "88 kcal por 100 g · valor medio" ("por ud"
  for a unit food; "etiqueta" / "label values" for a `verified` label of the DB); nothing matching →
  "Ningún producto coincide.". A pick opens the same amount panel as a product: amount in the NATURAL unit
  (pieces when the food has a `piece` — the option names it, "huevos (~50 g)" —, ml for a liquid, g
  otherwise), prefilled with 1 piece or 100 g / ml (never a "usual" serving), a pieces ↔ g / ml select
  that converts the typed amount (`basicConvert`), the live preview = the label that will be saved + kcal
  / P / C / G, and a note that these are average table values. Save = ONE `quick` entry (no schema
  change) with the label and all four macros computed client-side, same request-id / ambiguous-retry /
  "save anyway" flow; an unparsable amount is "number" under the field, one over `amountMax` or the
  quick-entry limits (`quickKcalMax` 5000, `quickMacroMax` 500) is `fieldErrors.tooBig`, nothing sent.
  **Mis productos**: list by store
  (per-100 line, serving, Editar, Archivar with a confirm step); add = barcode or text lookup → OFF
  cards showing what OFF has (missing values marked) → "Usar este" fills the form with the missing
  fields flagged (`--mid`) → the owner confirms every value and the store → save; "desde la etiqueta"
  = the same form empty (`source: "label"`). **Mis recetas**: list with per serving / per 100 g
  cooked macros and the ingredients ("Avena 80 g · Huevo 2 ud VALOR MEDIO"); editor = name, kind,
  servings or cooked weight, ingredient rows (add / remove) and a live preview. **Recipe basics**: an
  ingredient row not picked yet is a SEARCH (`frf-ing-<i>` + `frf-list-<i>`) with the add sheet's rules:
  an empty search lists "Mis productos" (+ the "type to also search the basics" hint), typing lists the
  matching products under "Mis productos", then "Básicos · valor medio" (FOOD_BASICS, accent- and
  case-insensitive, `basicMatches`); a pick (`r-pick`) shows the name (+ a "valor medio" tag for a basic)
  and "Cambiar" (`r-unpick`), the amount in the NATURAL unit (pieces first, prefilled 1 piece / 100 g /
  ml) and, when the food has pieces, a pieces ↔ g / ml select (`frf-mode-<i>`, converts the typed amount
  with `basicConvert`). A basic is saved as a SNAPSHOT `{basic, name, unit, amount, per100}` built by
  `basicIngredient` (reference + food.js, `BASIC_CASES`): unit = the basic's own unit (g / ml / ud),
  amount in it (a `ud` food = a count of units; pieces of a g / ml food become grams / ml), 1 decimal as
  stored; per100 = FOOD_BASICS `m` (per one unit for `ud`, `BASIC_UD_AMT` = units.mjs `UD_AMT`). The
  formula (`ingredientBasis` / `recipeBasis`, all three copies, `FOODLOG_CASES`: product + basic in g +
  basic in units, per serving and batch) adds products and snapshots alike; `rawWeight` = the g / ml
  amounts only; a basic with an unknown macro is `missing` by its key. Editing loads a basic back with
  its stored snapshot (never refreshed from FOOD_BASICS; the current table only supplies the piece for
  the toggle), a `ud` food in pieces, other foods in their unit — a piece choice of a g / ml food is not
  stored, so it reopens in grams / ml. A save answered `atwater` (a basic like beer, jam or baking
  powder, whose kcal do not match its macros) offers "save anyway" (`r-save-force`, `force: true`). With
  no product yet the editor still opens (basics only); "add products first" shows only when there are
  no basics either. Errors = one line from the coarse codes ("offline" → the
  server is unreachable and nothing was saved). **Numbers**: every numeric field of the three forms goes
  through ONE parser (`parseNum(value, units)`, exposed on `HCFood`): trimmed, a decimal comma, a
  trailing unit THAT field takes dropped ("30 g", "250 ml", "130 kcal"; another unit is an error, never
  g ↔ ml); empty or a bare unit ("g") = not set (an optional field stays unset, a required one is
  "required"); the client still sends numbers or null and the server validation is unchanged.
  Unit-bearing inputs show their unit as a suffix inside the field (the serving's follows "Se mide
  en"; an ingredient amount's follows its product). Validation errors render INLINE under each
  offending field (`<id>-err`, `aria-invalid`, described by it, focus on the first; a server
  `invalid` with a `field` lands there too); the form's status line (`fp-form-msg` / `fr-form-msg`,
  `role="status"`, with "save anyway") sits inside the form under its buttons, and the section's
  own line (`fp-msg` / `fr-msg`: saved, archived) sits above the section body.
- **Wiring** — `window.foodTotals()` = `{date, k, p, c, g, n, missing, src: 'log'}` when the API
  answered and TODAY (the viewer's local date) has ≥ 1 entry, else null — the one contract; nutri-day.js
  and intake.js do not re-check the date. It stays TODAY-only whatever day the navigator shows (as do
  `HCFood.groupTotals()` and `HCFood.addGuide`, which always logs to today). A macro NO entry states is `null` (a dash, never "0 / 150 g"
  or 0 %); `missing[m]` = at least one entry lacks it, so a non-null value is a minimum and the bar /
  ring shows "≥ 40" (the rings add a one-line note). ONE logged entry today is enough: the dial, bars
  and rings then show the page's food log for today instead of the Apple Health intake (labelled
  "Registrado hoy en esta página" / the rings' "Registrado hoy"). After every add / delete food.js calls
  `HCNutri.refresh()` (re-renders Resumen de hoy, which refreshes the rings, and the portion guide, in its own try/catch). A page left open past midnight reloads today's log on `visibilitychange`: a viewer on "today" moves to
  the new today, one on a past day stays there (only today's totals refresh).
  The portion guide's hooks: `HCFood.groupTotals()` (today's sums per Registrar group, `{meals: {breakfast,
  lunch, dinner: {k, p, c, f}}, addon}`, a missing macro counted as 0; null unless the API answered and
  today's log is loaded), `HCFood.products()` (a copy of the active products, null without the API) and
  `HCFood.addGuide({group, food: 'b:<key>' | 'p:<id>', amt})` (a promise; a main group only).
- **Retries** — each add carries a `requestId` (`crypto.randomUUID`, else a v4 UUID from
  `getRandomValues` — plain http on the LAN is not a secure context — else `Math.random`); `food_log`
  has a unique index on it, so a retry of the same add returns the stored row (`200`) instead of a
  duplicate. The sheet keeps the id across retries of the same pending add (a new item / tab = a new
  id), re-reads the log after an ambiguous failure (offline, a 15 s timeout, a 5xx) and replaces rather
  than appends a replayed entry. A delete answered `404` (already gone) just drops the row.
  `HCFood.state()` is test-only.
- **Rollout** — `cd services/health-ingest && docker compose up -d --build health-ingest` (runs
  `006_food.sql`), restart plan-web (`docker compose up -d` in `services/plan-web`, new nginx
  location), then `npm run generate` (or wait for the hourly refresh). Out of scope: label photos /
  OCR (send them to Claude in chat), scraping any supermarket site, exporting the log to CSV for the
  analysis pipeline (next slice), Apple Health write-back.

## Nutrition v2 part 3 — server-side goal + target weight, Progreso, Constancia

Three render-isolated pieces (own try/catch, one-line fallback). Thresholds live in `lib/` (baked as
`NUTRI.progress` / `NUTRI.adherence` / `FOOD_CONST.limits`); every number in the copy is a placeholder
filled from them, never typed.

- **Settings (LAN page)** — `services/health-ingest/sql/007_settings.sql` (`app_settings`, one row:
  goal + target weight within `FOOD_LIMITS.targetWeight*`), its own optional migration group
  `settings` (a failure → only `/food/settings` answers `503 settings_unavailable`). `GET /food/settings`
  and `PUT /food/settings` (partial `{goal?, targetWeightKg?}`, `null` clears the target) sit under
  the food prefix, so plan-web's `/api/food/` proxy and every food layer apply (no nginx change); an
  unknown `/food/*` path is always `404`. Page: `client/settings.js` (`HCSettings`, reuses
  `HCFood.api`). Without an answer the page is exactly as before (goal in `hc.nutri.goal`, no target
  field). With it the server goal wins (`HCNutri.applyGoal`, cached locally, never sent back) EXCEPT a
  PENDING goal (`HCNutri.setGoal` writes `hc.nutri.goalPending` until a PUT succeeds; retried on the
  next load and on `visibilitychange`; the profile says "pendiente de guardar"); an empty server gets
  the stored local goal once. The GET retries with backoff on offline / timeout / 5xx (3 tries), never
  on 404 / 503. Profile Objetivo: + "Peso objetivo" (`HCSettings.parseTarget` = `HCFood.parseNum(v,
  ['kg'])` + the range, inline error, saved on `change`), one status line, the Progreso line.
- **Progreso** (baked data, every build) — `lib/nutrition/progress.mjs` = the reference (rules and
  bands in its header), ported in `client/progress.js` (`PROGRESS_CASES` parity + hand-computed tests).
  Rate = least-squares slope of `DETAIL.metrics.weight.roll` over `windowDays`; too few averages →
  "pocos datos". Status per goal band (`PROGRESS.bands`, from `analysis/methodology.md`: cut
  0.25–0.5, bulk 0.1–0.25 kg/week, never > `maxPctWeek` of bodyweight; maintain stable within
  ±`stableKg`, else going up / down). ETA only on pace = remaining ÷ the OBSERVED rate ±`etaSpread`,
  as months. Target / ETA only with `HCSettings`. Says the series mixes scales. The card opens the
  weight sheet, which draws the target dashed (`detail.js` `targetOf`).
- **Constancia** (LAN page only) — `GET /food/log/summary?from&to` (≤ `summaryDaysMax` days, ≤ 20,000
  rows, 30 reads / min per client) → per-day `daySummaries` (shared formula, food-calc.js copy pinned
  by `SUMMARY_CASES`). `lib/nutrition/adherence.mjs` = the reference (`ADHERENCE_CASES`), ported in
  `client/adherence.js`. Complete = ≥ 1 entry in breakfast, lunch and dinner; means and protein days
  only over complete days with a DETECTED day type (`HCNutri.targetFor` = current goal × that day's
  type; past days via `daytype.mjs` `dayInputFor` over `DETAIL.sessions` + `TRAINING`). Counted apart,
  never compared: unknown type, and an ASSUMED rest day (sleep only, no session: `inferred`). 7 / 14 /
  28 switch, a 28-cell strip of ≥ 44 px buttons (state in words; a tap = `HCFood.showDay`). Re-read
  debounced (`reloadMs`) after every add / delete, and on `visibilitychange` when the day changed (the
  midnight reload of core.js waits while the page is busy).
- **Rollout** — ingest rebuild (`docker compose up -d --build health-ingest`, runs 007), then
  `npm run generate`.

## Training tabs — "Hoy / Today" + "Entrenos / Workouts" pipeline

The same single-file build carries two training sections (programmed session in Inicio,
Entrenamiento at the bottom of Entreno — they were tabs before the tab layout), computed by `lib/training/program.mjs`
(programmed sessions) and `lib/training/dashboard.mjs` (executed-workout aggregation) and
rendered by `web/src/tabs/{Hoy,Entrenos}.astro`. Same single-source pattern as nutrition.

**🏃 Entreno tab, above the dashboard** (`web/src/tabs/TrainingDetail.astro`, hosts only): the
per-modality load cards + caveats (`#score-load`, client/score.js), then the **30-day activity
calendar** and **cumulative training time** (`#train-activity`, `lib/training/activity.mjs` →
`ACTIVITY`, baked in TrainingDetail with `I18N_ACTIVITY`; client/training-activity.js), then running,
cycling and load vs recovery (`#health-train`, client/health.js). The calendar/cumulative follow the
dashboard's rules: duration not kcal, DISTINCT days, dashboard modality buckets, and the shared
same-day rule (`lib/training/sessions.mjs` `DISPLAY_RULE`: stubs under 3 min dropped, one source per
date + bucket, then summed); the workouts dashboard uses the same rule, so its days/minutes agree. Only the last 63 data days are baked (two 30-day windows + 3 days of viewer slack), one entry
per active day; the client ends both windows at the VIEWER's today, or at the data date when that is
more than 3 days old (greyed, with a note) or AFTER the viewer's today (clock / timezone skew, so the
newest sessions stay visible). Calendar = Monday-first weeks, ONE sequential hue
(`--strain`) in five levels by total minutes (none, < 30, 30–59, 60–89, 90+), an SVG `<title>` per
cell; cumulative = the running sum of daily minutes, last 30 days (`--strain`) vs the previous 30
(dashed `--faint`), totals written in the legend, a hover target per day.

**🏋️ Hoy / Today — programmed session.** Source: `data/training/training-data.json`
(GITIGNORED, personal, and OPTIONAL — see below) — the programmed sessions keyed by ISO
date (`days["YYYY-MM-DD"]`); a date with no entry renders as a rest / unprogrammed day. The
build bakes it into a page-level JSON global; the page picks "today" client-side with `new
Date()`. The artifact is a frozen snapshot, so the baked program must cover the current date —
regenerate + re-publish when a new block lands. NOTE: program files are often exported/named by
a training partner, not the coach — never infer the coach's identity from a filename; take it
from `profile/about-me.md`.

**`training-data.json` itself is OPTIONAL for the personal build.** If it does not exist at
all, the build still succeeds — `lib/load/inputs.mjs` degrades to an empty program
(`{days:{}}`), and Hoy renders every day as a rest/unprogrammed day (same empty state a real
file with no sessions produces); Entrenos is unaffected (it reads Apple Health `workouts.csv`,
not this file). `npm run check` likewise treats a genuinely absent file as "nothing to
validate" rather than an error — it only fails if the file exists but is malformed/empty. This
is distinct from `page.hideTabs: ["hoy"]` below, which hides the SECTION; leaving the file
absent keeps the section visible but permanently in its empty state.

**The Hoy section is optional and source-agnostic.** The program can come from any dated source
(coach PDFs, a spreadsheet, or a login-gated training app whose content can't be scraped). If
the owner's program lives in an external app they open directly, maintaining a dated copy here
is redundant — set `page.hideTabs: ["hoy"]` in `plan-data.json` to hide the section in Inicio
(the markup + baked training data stay fully wired, just `hidden`; remove the entry to
reactivate). Keep the section visible in the example build (`plan-data.example.json` has no
`hideTabs`) as a working example. Which program/app the owner actually uses is personal → it
lives in `profile/about-me.md` (gitignored), never in a tracked file.

**📈 Entrenos / Workouts — executed-sessions dashboard.** Source (OPTIONAL):
`data/apple-health/extract/workouts.csv`. `lib/training/dashboard.mjs` aggregates it
(frequency, weekly volume, modality split). If the CSV is absent (fresh clone), the tab
shows an empty state — it never fails the build. Data-honesty rules are baked in: use DURATION
not kcal (blank on recent exports); count DISTINCT DAYS not raw rows (the Watch fragments one
session into several records) after the shared same-day `DISPLAY_RULE` (stubs dropped, a Watch copy
of a Strava session counted once — same totals as the calendar); the modality split (strength/hiit/run/bike/other) reflects the
WATCH's auto-labels, which over-tag HIIT and under-count strength — the page says so on-screen. The
`hiit` bucket is LABELLED "Gimnasio"/"Gym" (display only, same bucket) so it matches Inicio's gym
load card; `strength` keeps its own label.

**Strava sync (`npm run sync:strava`, part of `npm run sync`).** Pulls every activity the
ingest service (`services/health-ingest`) has stored from Strava via `GET /export/strava` and
merges translated rows into `workouts.csv`, tagged `source=Strava API`, so a ride logged only on
Strava (no Watch record) still shows up — normally grouped into the `bike` modality. Cycling-family
sport types (incl. e-bike and virtual/indoor rides) all translate to the same `Cycling` type as
Apple Health uses, so they land in the same `bike` bucket. Racket, team and outdoor sports map to the
Apple type the Watch writes (Tennis, Squash, Badminton, Pickleball, Soccer, Basketball, Volleyball,
Golf…; Padel keeps its name), all in the `other` modality, so a Watch Tennis row and a Strava Tennis
row merge into ONE session (pinned by a test). Strava's generic `Workout` maps to `Other`, the
Watch's generic label that stays in `GYM_TYPES` (the owner's gym / metcon label). An unknown sport
falls back to `Unmapped` (→ `other`, never gym; it used to be `Other`, which filed tennis as gym
load) and is listed in `_meta.json` `stravaSync.unmapped`. Strava rows are ALWAYS kept, also on
dates the export covers (Strava is the only source of Relative Effort, kJ and elevation), and are
rebuilt each run and removed only by their `Strava API` tag. Dedupe happens at READ time: every
workouts.csv reader goes through `lib/training/sessions.mjs` `mergeSameDay`, which keeps ONE source
per date + physical modality (Inicio's gym / run / bike / other): "Strava API" > "Strava" (the Strava
app's HealthKit copy) > Apple Watch > any other app, when the winner covers at least half of the
loser's minutes (`SUPERSEDE_MIN_COVERAGE`); lower coverage = a different session, both counted. Accepted limitations: a Strava activity
deleted upstream is never removed from the local CSV (ingest never deletes); an edit made more
than 7 days ago is never picked up (the ingest service's Strava loop only re-reads a 7-day
overlap window). `GET /export/strava` requires an ingest image rebuild/restart
(`docker compose up -d --build health-ingest`) — an un-rebuilt image answers `404` and the sync
exits non-zero with a message saying so, touching no files. The same pull also writes
`rides.csv` (`date,start,elapsed_s,kilojoules,device_watts,source`, gitignored, rebuilt from scratch
every run, one row per cycling-family activity): `start` = the local start as ISO WITH its UTC offset
(Strava `start_date_local` − `start_date`), `elapsed_s` = elapsed time (moving time when absent),
`device_watts` = `true` only for a real power meter. A separate file, not new workouts.csv columns:
the window is Strava-only data with one reader (the energy correction), so extract.js, the
positional workouts readers and the demo generator stay untouched. It needs `start_utc` +
`device_watts` from `GET /export/strava` (added with this change → ingest image rebuild); an older
image leaves `start` / `device_watts` blank, the sync prints a stale-image warning, and no ride
corrects anything. `_meta.json` records it: `rows.rides` and `stravaSync.rides` = `{rows, power
(device_watts true + kJ), withStart (start with offset)}`, plus a sentence in the Strava sync note.

**Source of the program:** whatever the owner's coach/app provides — a coach PDF, a spreadsheet,
or a login-gated training app. For a source that can't be fetched (a login-gated app), the owner
pastes/screenshots the sessions and you transcribe into `training-data.json`. For PDF grids in
`data/training/*.pdf` (spreadsheet-style weekly grids), transcribe by rendering pages to PNG
(`pdftoppm -png -r 130`) and reading the grid visually (`pdftotext` interleaves the day columns).

**Fresh-clone bootstrap:** copy `data/training/training-data.example.json` →
`training-data.json`, edit in the real program, then `npm run generate` (part of the shared
nutrition bootstrap above — one `npm run generate` builds all 4 tabs together). This step is
optional — skipping it (or deleting `training-data.json` later) still builds, with Hoy
permanently in its rest/unprogrammed state. `npm run check` validates training-data.json when
it exists (`build-web.mjs --check`); `npm test` covers the training lib with its own unit tests
plus the build-output/i18n/hide-tabs integration tests.

## Health tab — "Salud / Health" body & recovery pipeline

`lib/health/{read,stats,aggregate}.mjs` (same single-source pattern) compute the stacked sections
from the Apple Health extract CSVs (all OPTIONAL — absent CSVs render an empty state, never fail the
build); `web/src/client/health.js` renders them into TWO hosts, each with its own empty state and
its own try/catch (a throw in one half renders that half's empty state, never blanks the other):
`#health-body` (Salud: recovery with `#score-recovery` right under its heading, sleep, body composition,
activity, energy — in that order) and `#health-train` (Entreno: running, cycling, load vs recovery).

**Today first.** Every trend card's headline is the NEWEST value with its date (a daily total dated
the viewer's today reads "today, so far" / "hoy, en curso", decided client-side); the 30-day mean
(`avg30`, `avg30Of`: mean of the daily values over the last 30 days — for the daily TOTALS of
`dailyTrend` the 30 days ending the day BEFORE the latest, since the build cannot know whether that
day is complete) and the Δ (`d30Of`) form the context line under it; a non-finite value is never
printed and a card that throws is skipped, never blanking the tab; a card whose newest value is
more than `STALE_DAYS` (3) before the viewer's today is greyed (`mtrend-stale`) with a "sin datos
recientes" / "no recent data" note, decided client-side like the monitor and the dials (waist, dated
in its title, is exempt: a sparse manual measurement);
sparklines are unchanged (7-day rolling). HRV's headline is the newest DAY's mean (it used to be the
7-day rolling value); sleep's is last night (`sleep.latest`), with the 30-night mean as context;
expenditure's is the newest day's TDEE (`tdeeLatest`; a day counts only with BOTH active and basal energy, never basal alone). Each recovery trend carries an `hl-<key>`
anchor for Inicio's health monitor.

- **Body composition** — `weight.csv` + `bodyfat.csv` + `leanmass.csv`. Weight trend is a 7-day
  rolling average (it mixes scales/apps, so the raw series is noisy). Body fat and lean mass use
  ONLY the most recent source and are flagged bioimpedance ±3–5%. IMPORTANT: the source tag does
  NOT isolate a scale switch (the same app re-tags an old scale's readings, which can show as an
  overnight jump of several points), so their Δ + sparkline use only the last `BODYCOMP_WINDOW` (150) days
  to avoid celebrating that artifact as real change.
  **Waist** (`waist.csv`, cm; written by extract.js from `WaistCircumference` and by the
  Shortcut `waist` key) is a sparse manual tape measurement: every reading is a point (no rolling
  average), the headline carries its measurement date, Δ = latest vs first. No waist data → the
  section shows a hint on how to start logging it instead.
- **Activity (NEAT + movement)** — `steps-daily.csv` (NEAT), `exercise-minutes-daily.csv`,
  `distance-daily.csv`, `flights-daily.csv`. Each is a daily total → latest day (headline) + 30-day
  average and Δ vs the prior 30 days (context), 7-day rolling sparkline (generic `dailyTrend`). All four are deduped
  max-per-device by extract.js (iPhone + Watch overlap → summing double-counts, like steps);
  near-zero step/distance days (device not carried) are dropped as missing data.
- **Energy** — `active-energy-daily.csv` + `basal-energy-daily.csv` give expenditure (TDEE,
  7-day rolling); `dietary-daily.csv` gives intake AND the macro split (protein/carbs/fat, g + %
  kcal). Data honesty: intake logging is sparse and abandoned, so the balance (deficit/surplus)
  AND the macro split are shown ONLY when intake was logged within the last 14 days of the newest
  expenditure day and ≥7 logged days exist in the 90 days ending at that day; otherwise
  the page shows expenditure alone and says intake can't be scored. Implausible basal readings
  (double-counts / no-wear) are dropped via a sane band.
  **Power-meter ride correction** (`lib/health/ride-energy.mjs`, `readActiveEnergy` = the ONE active-
  energy reader of the Salud card AND the detail sheet's `energy`): a ride a bike computer recorded
  with a power meter, and the Watch did not, is under-counted by the Watch's Active Energy (real
  case: 2,311 kJ ride, Watch 1,821 kcal over the ride hours). Corrected active(day) = Watch day total
  − Watch energy during the ride + ride kJ × `KJ_TO_KCAL` (1.0: 1 kcal = 4.184 kJ × ~24 % gross
  efficiency ≈ 1 kJ mechanical). Watch-during-ride = the `active-energy-hourly.csv` buckets
  overlapping the ride window [start, start + elapsed], each spanning its clock hour and prorated by
  overlap minutes; everything compared as instants (DST- and host-timezone-safe); a ride crossing
  midnight splits its energy by time across the two local days, each midnight placed with the
  offset of that day's 00:00 bucket (the ride's offset only without one); overlapping power rides
  (a duplicate upload, a nested ride) are clustered by interval union and count once, the largest
  kJ wins. The Watch day in the formula = max(daily row, sum of that day's hourly buckets): the
  buckets are parts of the same Watch's day, so a daily row below their sum is a stale payload and
  would otherwise understate the result. Applied ONLY when: the ride (`rides.csv`) has
  kJ > 0 AND `device_watts === true` (a blank flag = an old ingest image = no correction; Strava's
  estimated watts never count), a start with offset and an elapsed time; the hourly buckets cover
  the WHOLE window (one missing hour = no correction, and the day is flagged `uncovered`: the Salud
  card says "salida con potenciómetro sin corregir: faltan datos por horas del reloj" on such a
  headline day + a note counting them in the 30-day window (`latestUncovered` / `uncoveredDays`), the
  detail day panel says so too (`metrics.energy.uncov`, 1 / null)); the day has a Watch total; and the corrected
  value is HIGHER (never lowers a day, so a Watch-recorded ride stays as measured). Café stops inside
  the elapsed window are replaced too (small, conservative). The raw value stays visible:
  active-energy-daily.csv is untouched, a corrected row carries `watch` / `rideKcal` /
  `watchDuring`; `aggEnergy` adds `latestCorrected` (the headline card says "incluye la salida
  medida con potenciómetro") and `correctedDays` in the 30-day window (a note); the detail sheet bakes
  `metrics.energy.watch` (only when some day was corrected; null elsewhere) and shows "Activa <corrected> kcal
  — reloj 2207 + corrección por potencia" plus the note in the day panel, and the note under the
  header when the newest day is corrected. Nutrition / Inicio read no TDEE. Rollout: rebuild the
  ingest image (`docker compose up -d --build health-ingest`), add the Shortcut key
  (`docs/ios-shortcut.md`), `npm run sync -- --full` once, then `npm run generate`.
- **Running** — `workouts.csv` Running rows (Watch export AND `sync:strava`, via `readRuns`), merged
  per day exactly like the rides, as a RECENT-RUNS table (same row budget, newest first): date,
  distance, time, pace = time / distance (none without a distance), avg HR, relative effort,
  elevation, then the watch running dynamics (power, GCT, vertical osc, stride) LEFT-joined by date
  from `running-daily.csv` (export.xml only — a Strava-only run shows dashes there; a dynamics-only
  day never adds a run; sub-5 km/h dynamics are walks / GPS garbage and are not joined). Count =
  distinct run days. It used to read only `running-daily.csv`, which froze the table at the last
  export.
- **Cycling** — `workouts.csv` rows of any Cycling type (Watch rides and `sync:strava` rides), shown
  right after Running as a RECENT-RIDES table with the same style and row budget (8, newest first) so
  run and bike carry equal weight: date, distance, time (Strava moving time / Watch duration),
  elevation gain, avg HR, relative effort, kJ, plus the ride count. Same-day rows merge into ONE ride
  under the shared same-day rule (`DISPLAY_RULE`: stubs dropped, the Strava copy wins over a Watch copy): sums
  for time/distance/kJ/elevation/RE, duration-weighted avg HR, and the count is distinct ride days. Elevation / RE / kJ come from
  Strava only; a field the source did not record renders as a dash, never 0. When only one of run /
  bike has data, the other shows its empty-state line; with neither, both are omitted.
- **Recovery** — `rhr.csv`, `hrv.csv` (both as the clamped per-day MEDIAN, `score/recovery.mjs`
  `dailySignal`, the same series Inicio's recovery and monitor use), `vo2max.csv`, `sleep-daily.csv`,
  `respiratory-daily.csv`, `wristTemp.csv`, `walking-hr-daily.csv`. Good directions stated on
  screen (↓ resting/walking HR, ↑ HRV, ↑ VO₂max; respiratory & sleeping wrist temp are change-
  not-absolute signals). Sleep adds CONSISTENCY: % of nights ≥ `SLEEP_TARGET` (7.5 h), night-to-
  night spread (sd), and bedtime/wake-time regularity (median ± a ROBUST sd = 1.4826 × MAD, in
  minutes; after-midnight bedtimes wrapped onto a night scale). Sleep bedtime/waketime come from the
  extended `sleep-daily.csv`: extract.js and sync-shortcut.js share `samples.js` `sleepNights`, which
  keeps only the MAIN sleep of each wake-up night (asleep segments chained with gaps < 60 min; the
  longest block whose midpoint falls 20:00-12:00, plus in-window blocks within 3 h of it when they lie
  before it or start before 05:00 on the wake-up date, so a split night with a 3 am wake-up stays one
  night, but within only 60 min when they start after the night's end from 05:00 on AND end at or
  after 10:00 (`AFTER_END_GAP_MIN`), so a 09:00–10:30 nap after a 06:30 wake-up or an afternoon nap
  is not absorbed; a block after the end that ENDS before 10:00 (`FALL_BACK_END_HOUR`) is falling
  back asleep after an early wake-up and joins within 3 h (23:59–03:19 + 05:08–07:32 = one night).
  Accepted trade-off (pinned by a test): a real morning nap that ends before 10:00 within 3 h of the
  wake-up (06:30 wake, 07:30–09:30 nap) now JOINS the night too — the data cannot tell it apart from
  falling back asleep (no awake / stage context beyond the gap). Naps (incl. one that
  crosses 18:00) add neither minutes nor bed/wake times; a nap-only day has no row. Sleeping wrist
  temperature is dated by the same midpoint + 18:00 roll-over rule as a sleep block (`wristTempDate(start,
  end)`; a Shortcut sample with only a start falls back to its start). Known limitation: night-shift
  sleep (a daytime main sleep) falls outside the 20:00-12:00 window and is treated as a nap. No
  migration: rows of `sleep-daily.csv` / `wristTemp.csv` that came from an earlier export keep the old
  convention until `node data/apple-health/extract.js` is re-run on a new export (Shortcut rows are
  rebuilt by every sync). Sleep renders
  as its own Salud section; its heading is the `#hl-sleep` anchor.

Trends render as inline SVG sparklines (CSP-safe). The build is idempotent — no today-relative
values are baked (staleness is computed client-side from the data dates). Aggregation lives in
pure functions (`aggBody`/`aggActivity`/`aggEnergy`/`aggRunning`/`aggRecovery` + helpers
`dailyTrend`/`signalTrend`) so the test suite injects synthetic series without touching disk. The
personal (`LOCALE=es`) build is localized to Spanish (es-ES dates, comma decimals); the example
(`LOCALE=en`, `web/src/i18n/en.mjs` + `*-templates.mjs` en dicts) build is English.

## Home tab — "Inicio / Home" dials, advice, eat card, health monitor, timeline; recovery + load detail

Top to bottom (`web/src/tabs/Home.astro`, which also renders `components/EatCard.astro`): dials
(`#home-dials`) → the advice sentence (`#home-advice`) → the "today you eat" card → the health monitor
(`#monitor`) → today's timeline (`#timeline`) → the programmed session (`hoy`). The conclusion and
today's eating sit right under the dials; the per-signal detail follows (`web/test/content.test.mjs`
pins the order).

`lib/score/*` (same single-source pattern) feeds the first tab; `web/src/client/score.js` renders it
(dials + advice on Inicio; the recovery card into Salud's `#score-recovery` and the per-modality load
cards + caveats into Entreno's `#score-load` — glance vs detail),
`buildScores(extractDir)` bakes `SCORES` (only `asOf` dates — staleness is computed client-side, so
consecutive builds are byte-identical). The tab is first and active by default; the visible panel is
derived from the FILTERED nav list (`activeTabKey`), so `page.hideTabs: ["home"]` hands over to the next
tab and hiding every tab is a build error.

**Today first, trend as context** (Bevel/Whoop-style, but no invented 0-100 scale): every headline
is the newest day, and the trend is the line under it.

- **Recovery** is in units of the owner's typical spread (scaled MAD), never a 0-100 grade; ONE unit
  key, `RECOVERY_UNIT` (`lib/score/advice-copy.mjs`, re-exported by score-templates: en "SD", es
  "desv."; dict `recovery.unit`), builds every recovery string — advice, dial, Salud card, monitor note,
  detail sheet — and the Salud card explains it in one line (`recovery.unitNote`: "typical spread" /
  "variación típica"); no unit literal in score.js: HRV (daytime SDNN), resting HR, sleep duration and
  sleep regularity vs a median/MAD baseline (42 days ending asOf-1), z clamped ±3, weights
  .40/.25/.25/.10. Band: ≥ +0.5 above / within ±0.5 at / ≤ -0.5 below baseline (`BAND_CUTOFF` in
  `recovery.mjs`). Headline = `today`, the composite of the asOf day alone (last night), same
  baseline; a single day is noisier than the 7-day mean (measured σ_daily 0.782 vs σ_7 0.328,
  `MEASURED_SIGMA`), so its band is cut at `DAY_BAND_CUTOFF` = `BAND_CUTOFF` × σ_daily/σ_7 ≈ 1.2 (same
  false-flip rate). `today` is `null` unless the components present that day carry ≥ 0.60 of the
  weight AND include HRV or RHR (a sleep-only night is too thin), in which case the page says "no data
  for last night" and shows the trend instead; `today.sleep` is false when that day has no
  sleep-duration reading, and the page then labels it by date + "no sleep data", never "last night".
  Context = `trend7` (mean composite of the 7 days ending asOf) and `trendDir` = `delta7` (this
  week's trend7 − last week's): two non-overlapping 7-day means differ with noise √2 × σ_7 ≈ 0.46,
  so it is cut at `TREND_DIR_CUTOFF` = `BAND_CUTOFF` × √2 ≈ 0.7: up / steady / down. The recovery
  detail card (Salud `#score-recovery`, Whoop-style) spans the full grid row: headline (last night's
  composite as the big number + band word; the 7-day trend is a small secondary line) | 14-day
  sparkline | compact contributors (state dot, name, latest value + unit, baseline · MAD · n for HRV,
  RHR, sleep duration, sleep regularity), side by side on wide screens and stacked on phones; the
  confidence + SDNN chips stay on one line and the raw last-14-days lists fold into a `<details>`
  ("Last 14 days" / "Últimos 14 días"). Gated ("insufficient")
  unless components with ≥ 14 baseline days carry ≥ 0.60 of the weight, include HRV or RHR, and there
  are ≥ 7 composite days in the last 14. "Last night" is the newest COMPLETE day among asOf and the 2
  days before it (`MAX_TODAY_FALLBACK_DAYS`): it needs a sleep-duration reading AND a resting-HR value
  AND — only when HRV is a scored component (the user has an HRV baseline) — an HRV day with ≥
  max(min(3, usual), 50% of usual) samples (`completeDay`; usual = median daily sample count over the
  baseline; only plausible samples inside the HRV clamp range count, identical rows once), plus ≥ 0.60
  of the weight. A user without Watch HRV is scored on sleep + resting HR. A partial newest day (e.g.
  no RHR yet) falls back to the previous complete one, labelled by its date, and stays in the trend and
  baselines; with no complete day in those 3 the headline is the trend with a "no recent complete
  night" note. The monitor cards and Salud's HRV headline keep per-signal
  completeness (HRV sample floor only).
- **Load** is PER MODALITY (gym / run / bike; `other` is shown raw, never scored) and Relative-Effort-only
  (Strava `suffer_score`; Apple rows have no RE and are counted as `unscored`). Same-day rows follow
  the shared rule below (junk dropped, one source, then SUM). The series starts at the first date with any RE
  (`reEpoch`); acute 7d vs chronic 42d EWMA; a modality gates ("baselineBuilding") under 28 days since the
  epoch, under 8 non-zero days, or chronic < 1. The 0-100 `relScore` exists only within a modality.
  A day whose rows in a modality are ALL unscored is MISSING, not rest: both EWMAs carry forward
  over it without decay, and a modality whose last 7 days hold such sessions says so on its card and
  dial caption ("includes N sessions without effort data"). Trend bands: ramping ≥ +30%, above ≥
  +10%, steady, below ≤ −10%, well below < −30% (never "detraining": the data cannot tell a deload
  or missing effort data from fitness loss).
  Today first: `typical` = the median of the NON-ZERO days in the 42 days before asOf (asOf
  excluded; `value: null` under 6 such days — `TYPICAL_WINDOW_DAYS` / `MIN_TYPICAL_DAYS` in
  `load.mjs`). `recent` = the session days of the last `RECENT_DAYS` (14) ending asOf, each
  `{date, re, unscored}` (only dates with valid non-junk rows in that modality; `unscored` = rows
  without RE), and `last` = the newest day with RE > 0. The VIEWER's today is picked client-side from
  `recent`, so nothing today-relative is baked.
- **Health monitor** (`lib/score/monitor.mjs`, baked as `SCORES.monitor` even when `hasData` is false;
  `components/HealthMonitor.astro` + `client/monitor.js`, under the dials, advice and eat card): cards for respiratory
  rate, resting HR, HRV, sleeping wrist temperature and sleep duration. Each = the newest daily value
  (per-day median of plausibility-clamped samples) + unit, its date when it is not from the viewer's
  today, and Normal / High / Low (es: Normal / Alto / Bajo) vs a personal band = median ± 1.5 × scaled
  MAD (`robustBaseline`, floored per signal) over the 42 days BEFORE that value; < 14 baseline days →
  value + "building baseline", no band; a missing series → "No data". A vertical range bar (inline
  SVG, geometry baked as fractions) marks the band and the value. Band = median ± 2 × scaled MAD
  (`BAND_K`: ~5% false flags per card; HRV in log space like `recovery.mjs`, so asymmetric in ms).
  Tone: HRV high = good / low = bad, RHR high = bad / low = good, short sleep = bad; respiratory rate
  and wrist temp are change signals, so out of band is `watch` (`--mid`), never `--low`. A card whose
  OWN date is > 3 days before the viewer's today is greyed with "no recent data" and no tone; the
  whole block greys when its newest date is > 3 days old. Display units come from the i18n dict. A
  card that throws falls back to its empty state.
- **Dials** (top of the tab: Sleep / Recovery / Load) only VISUALISE baked values — no new metric and
  no percentage. `web/src/view/dial.mjs` (`buildDials(scores, health)`, unit-tested, baked as `DIALS`)
  pre-computes the 270° arc geometry; `score.js` only formats numbers and joins SVG strings.
  Recovery: arc = −3…+3 MAD, three tinted zones cut at ±`BAND_CUTOFF`, fill from baseline to a marker
  at last night's composite (`today`, zones cut at ±`DAY_BAND_CUTOFF`; falls back to `trend7`, zones at
  ±`BAND_CUTOFF`, with a "no recent complete night" note), centre = short band word + signed value in
  sd, coloured by that band; under it "Last night" (or the night's date, + "no sleep data" when the
  night has no sleep reading) and "7-day trend: steady · +0.5 sd". Sleep: fill = the
  sleep-duration component's newest night / the stated target (`health.recovery.sleep.target`, 7.5 h),
  capped at a full arc, target labelled on screen. Load: ONE dial with a gym/run/bike switch that opens
  (client-side, from the viewer's today) on the modality with a session today, GATED OR NOT (a gated
  one opens in its greyed gated state, no number; gated modalities bake their `days` without
  geometry) — highest RE first, ties by modality order (gym, run, bike), a session without RE still
  beats none — else on the baked `defaultKey` (first ungated modality), for the VIEWER's today, picked client-side from the baked `recent` days (each
  with its pre-computed arc): a session with RE → centre = today's RE, position = RE / typical day (arc
  midpoint = the typical training day, end = 2×, no zones), caption "Today: RE 28 · typical day ~42";
  rows today but no RE → "No effort data" (never rest); no rows today → "No session yet today" with "last session
  <date>: RE <n>" as context. Every caption keeps acute/chronic as context ("7-day vs 42-day load: -6% ·
  steady"). A gated modality (`baselineBuilding`, or `fewDays` when there is no typical day) is greyed
  with its copy and no number. Each dial block / card renders through a try/catch with an empty-state
  fallback, and every host write (`#home-advice`, `#home-dials`, `#score-recovery`, `#score-load`, the advice)
  is isolated, so one throw never blanks Inicio or the other hosts; with no score data every host gets
  the empty state. Stale data (> 3 days) greys a dial; the fill
  animation is off under `prefers-reduced-motion`.
- **Today's timeline** (`lib/score/timeline.mjs`, baked as `SCORES.timeline` even when `hasData` is
  false; `#timeline` + `client/timeline.js`, under the monitor): per day, last night's sleep
  (`sleep-daily.csv`, dated the wake-up day) and that day's workouts by Home modality (gym / run /
  bike / other) with minutes and RE when the source recorded it. Rows follow the shared same-day
  rule (`DISPLAY_RULE`: stubs dropped, one source, same-day rows of one modality merge; the row says "N parts"). Only the last 3 data days are
  baked; the client shows the viewer's today, else the newest earlier day under "Latest day · <date>"
  with "nothing logged yet today", greyed when > 3 days old; when the viewer's clock is EARLIER than
  every baked day (clock / timezone skew) → the newest baked day under its date (no "nothing logged"
  line, not greyed); no baked days → empty state. No sleep
  that night → "No sleep recorded", never 0 h.
- **Advice** is one descriptive sentence per rule (`lib/score/advice.mjs`, copy in `advice-copy.mjs`),
  never an instruction; hidden when data is insufficient or stale (> 3 days). The rules still read the
  7-day trend, and every sentence names that window ("Over the last 7 days recovery has…") so it reads
  as the context under last night's headline.
- Caveats shown on the page: RE is HR-derived (credits the metcon more than heavy sets), modalities are
  not comparable, "gym" is the Watch auto-label, no comparable load before the RE epoch, same-day rows
  are summed (a real two-a-day is indistinguishable), HRV is daytime SDNN, not medical advice. They
  live with each dial's detail (the caveats card in Entreno's `load` section; the recovery card in
  Salud) and must stay reachable wherever the dial is shown: when `page.hideTabs` hides Entreno (or
  its `load` section), score.js writes a compact load caveat line under the dials on Inicio
  (`dials.load.caveatLine`); when it hides Salud, a compact recovery line (`dials.recovery.caveatLine`).
- **One same-day merge rule** (`lib/training/sessions.mjs` `mergeSameDay(rows, keyFn, { dropJunk, dropStub })`),
  used by EVERY workouts.csv reader: the load series, the timeline, the Entreno calendar/cumulative
  time, the workouts dashboard, the running/cycling tables and Salud's load vs recovery (the key is
  the physical modality — Inicio's gym / run / bike / other — or one constant for a single-family
  table; Entreno buckets the surviving rows into its five display buckets afterwards). Per (date, key): drop invalid rows (`dur <= 0`); then the short-row filter depends on the
  reader — LOAD scoring (default) drops junk (`isJunk`: `dur <= 11` AND `re` null or ≤ 2), while the
  DISPLAY readers (timeline, calendar/cumulative, dashboard, run/ride tables) pass `DISPLAY_RULE` and
  drop only stubs (`isStub`: `dur < STUB_MAX_MIN` = 3, accidental Watch starts) — Watch rows and no-HR
  Strava rows have `re` null by design, so the junk rule would hide real 9-10 min sessions from the
  pages that list sessions (they still add no load); then ONE source per session, because several
  apps mirror the SAME workout into Apple Health (workouts.csv carries Watch, Hevy, Zepp, ROXFIT, Nike,
  the Strava app's HealthKit copy "Strava" and sync:strava's "Strava API" rows): rows are grouped by
  `source`; fragments of ONE source are kept together (the Watch splits sessions); across sources one
  source's rows are kept, never a sum, by `SOURCE_PRECEDENCE` (`/^Strava API\b/i` > `/^Strava\b(?! API\b)/i` >
  `/^Apple\s+Watch\b/i` (anchored; `\s` matches the no-break space Health writes in the device name) > any
  other app; within one rank the longest total wins, then the group with HR, then with RE, then source
  name ascending — deterministic, never file order) — sync:strava keeps every Strava
  row, so this is THE dedupe. A higher-precedence source replaces a lower one only when its total
  duration is ≥ `SUPERSEDE_MIN_COVERAGE` (0.5) × the lower one's total; below that they are most
  likely different sessions and both source groups are kept. Known limitation: rows carry no start
  time, so a higher-precedence copy covering ≥ 0.5 of a lower source's total can absorb a genuine
  SECOND session of that lower source; planned fix = add `start_time` to workouts.csv and match copies
  by time overlap. When the kept source has no HR (or no
  RE) and a replaced copy does, the kept rows inherit it (HR duration-weighted, max of max; RE spread
  by duration), so HR-based readers (load vs recovery) keep the session. The load coverage counts
  replaced rows as `superseded`; then
  the remaining rows are summed as ONE session (a session logged in parts adds up; a real two-a-day
  is indistinguishable).
- **workouts.csv has 12 columns** (`… ,distance_km,relative_effort,kilojoules,elevation_m`), written by
  both `extract.js` and `sync-strava.js` from the shared `WORKOUTS_HEADER`. The three trailing columns
  are Strava-only (export rows leave them empty). Every reader is POSITIONAL and tolerates shorter
  rows, so a file mixing 9-, 11- and 12-column rows (older runs under a newer header) reads fine:
  an absent column is null. Re-running `node data/apple-health/extract.js` (needs `export.xml`)
  re-emits every export row at full width. Rollout for a new Strava field (e.g. `elevation_m` from
  `total_elevation_gain`): rebuild the ingest image (`docker compose up -d --build health-ingest`;
  without it `/export/strava` lacks the field and the column stays blank) → `npm run sync:strava` →
  `npm run generate`.

## LAN page + on-demand refresh — `services/plan-web` + `services/health-ingest`

Besides the claude.ai artifact, `services/plan-web` serves `web/dist/personal/index.html` on the LAN
(nginx, `./site` only), gzipped (server level: the page, CSS / JS / JSON, ≥ 1 KB, level 5, `Vary`;
the four proxied ingest routes are `gzip off` — their responses reflect request input next to stored
data, a BREACH-style oracle; pinned by `scripts/plan-web-config.test.mjs`; rollout `docker compose
up -d` in `services/plan-web`). `refresh.sh` rebuilds and publishes it hourly (cron) AND on demand, under a
**sequence protocol** (no clock comparison anywhere):

- **Trigger.** The page's Sync button (`POST /api/sync`, proxied by plan-web nginx) or the last
  Shortcut step (`POST https://<your-host>/sync`, `docs/ios-shortcut.md`) hits health-ingest
  `POST /sync`. A new click gets the next `trigger_seq` (persisted in `sync_status`; resumed at startup
  from max(DB, trigger file), never backwards) and answers `202 {seq, coalesced:false}`; it kicks the
  shared Strava pull (timer loop, `POST /sync` and `POST /sync/strava` share ONE in-flight run) unless
  the last success is < 5 min old, then, once the pull settles (≤ 90 s), writes `seq\n` ATOMICALLY to
  `services/health-ingest/trigger/refresh` (temp file + rename, `O_NOFOLLOW`, a symlinked target is
  refused; container `/trigger`, gitignored, uid 1000 must own it). **Coalescing, never 429, never
  dropped:** a click while a trigger is still pending (write not done, so the rebuild will see any new
  data) gets `{seq:<current>, coalesced:true}`; a click within 60 s of the last COMPLETED write
  (window measured from the rename, so a slow pull cannot yield two writes seconds apart) gets a NEW seq, `{seq, coalesced:true, deferred:true}`, and ONE trigger write is scheduled for
  the end of the window (later clicks reuse it), so a Shortcut payload POSTed right after a rebuild
  is still published (the deferred run pulls Strava only if its own 5 min cooldown allows). Cost stays
  ≤ 1 rebuild/min and ≤ 1 Strava pull/5 min and nobody can lock the owner out. Nothing new is
  persisted; SIGTERM flushes a pending deferred write and awaits an in-flight run (2 s, then writes
  the persisted seq directly; 3 s hard cap); after a crash, boot finds the DB seq ahead of the trigger
  file and writes it once (5 s after boot, ≥ 60 s after the last recorded write), so a waiting page
  completes (it times out after 5 min: 60 s + ≤ 90 s pull + rebuild fits). A failed trigger write is exposed as `lastTriggerError: "trigger_write"` +
  `lastTriggerErrorSeq`. The host's `services/plan-web/systemd/plan-web-refresh.path` (PathModified,
  also fires on the rename) starts `plan-web-refresh.service` (oneshot as the repo owner,
  `User=REPO_OWNER` placeholder, hardened: `NoNewPrivileges`, `ProtectSystem=strict` +
  `ReadWritePaths=<clone>`, `ProtectHome=read-only`, `PrivateTmp`, npm cache via `CacheDirectory`;
  `PLAN_WEB_WAIT_LOCK=1` so it waits for a running cron refresh). Units ship with
  `/path/to/health-coach` + `REPO_OWNER` placeholders; the ordered install steps (trigger dir +
  chown BEFORE compose up → ingest rebuild → first `npm ci` by hand → verify checkout is `main` →
  plan-web up → units → smoke test) are in `services/plan-web/README.md`.
- **refresh.sh** keeps its resilience rules (failed sync still rebuilds, flock, `npm ci` only on a
  lockfile change, a failed build keeps the last good page). Each pass records the trigger seq it
  started from; a successful publish writes `site/status.json` = `{publishedAt, commit, branch,
  processedSeq}` atomically (`processedSeq` never goes backwards; the last good fragment is kept in
  `services/plan-web/.refresh-state`, outside `./site`). After a pass it re-reads the trigger and runs
  again (max 3 passes) if the seq advanced, so clicks during a run are never lost. Early exits add
  `{error, errorSeq}` WITHOUT touching `publishedAt`/`processedSeq`: codes `branch` (branch guard,
  still exit 0, unless `PLAN_WEB_ALLOW_BRANCH=1`), `install`, `build`, `sanity`, `lock` (on-demand lock
  wait timed out; a cron skip is not an error). `sync` / `generate` run under `PLAN_WEB_STEP_TIMEOUT`
  (300 s), `npm ci` under `PLAN_WEB_CI_TIMEOUT` (900 s). No git `safe.directory` override (the unit
  runs as the owner).
- **Freshness line** (`web/src/client/freshness.js`, copy `web/src/i18n/sync-templates.mjs`, markup
  in `layouts/Plan.astro` above the nav): at view time it reads `GET /api/sync/status` and
  `/status.json`; the top bar shows a dot + the Shortcut age ("hace 5 min"), and the per-source line
  "Atajo: hace 5 min · Strava: hace 2 h · Página: hace 1 min" (> 24 h `--mid` + a short hint, > 72 h
  `--low`; the dot takes the worst level) is the summary's title / aria-label and fills the popover a
  tap on it toggles (Esc / a tap outside closes it). Sync POSTs, then polls both every 5 s: `processedSeq >= seq`
  → reload; `errorSeq >= seq` (status.json) or `lastTriggerErrorSeq >= seq` (ingest) → fail fast with
  "No se pudo actualizar: <reason>" (`errors` map; unknown code → generic reason); 5 min → "No se pudo
  actualizar, reintenta". The block ships `hidden` and stays hidden when `/api/sync/status` is
  unreachable (example build, file://, the claude.ai artifact, a clone without ingest). Nothing
  time-based is baked, so builds stay byte-identical.
- **Security + exposure.** `POST /sync` and `GET /sync/status` are UNAUTHENTICATED on purpose (a
  static page cannot hold a secret): the trigger only schedules work the services already do on a
  timer, reads no body and returns only a seq; status returns timestamps, seqs and COARSE codes
  (`strava_auth`, `strava_network`, `strava_other`, `strava_token_save`, `trigger_write`), cached 5 s,
  never health data or raw error text (messages stay in logs; tests pin the key set and no leaks).
  plan-web nginx proxies EXACTLY `/api/sync` + `/api/sync/status` (exact-match, method-restricted)
  plus the food log prefix `/api/food/*` → ingest `/food/*` (GET / POST / PUT / DELETE, 16 KB, the
  `X-HC-Food` header forwarded; see "Nutrition v2 part 2") and EXACTLY `POST /ingest/health-auto-export`
  → the same ingest route (the iOS Shortcut upload when plan-web is the public entry and ingest is not
  exposed: `Authorization` / `Automation-Name` / `Content-Type` forwarded, no `Bearer` token → `401`
  before the body is read, ingest checks the bearer, `client_max_body_size 8m` ≤ ingest's
  `MAX_BODY_BYTES` default); every other `/api/` or `/ingest/`
  path 404, never `/export/*` or `/sync/strava` (pinned by `scripts/plan-web-config.test.mjs`).
  Static device manuals: EXACTLY `/manuales/<MANUAL_FILE_RE>` (a quoted regex location; GET / HEAD,
  `types { }` + `default_type application/pdf`, `Content-Disposition: inline`, `X-Content-Type-Options:
  nosniff`, `Content-Security-Policy: default-src 'none'; object-src 'self'` (not `sandbox`, which
  blocks the browsers' built-in PDF viewer), `Cache-Control: no-cache` re-added since a location `add_header` drops the server one,
  `autoindex off`, `try_files $uri =404`); every other `/manuales/` path 404; NOT in any SSO bypass
  (behind the tunnel it stays behind SSO). A
  server-level guard (next to the Host check) answers `400` when the RAW path (before `?`) holds `..`,
  `%2e`, `%2f`, `%5c` (any case) or `//`, so an SSO proxy matching bypass rules on the raw path cannot
  be walked to the page (`/ingest/%2e%2e/index.html`). Behind an SSO tunnel (one resource →
  plan-web:8090), bypass SSO for exactly `/ingest/*` and `/api/sync` (EXACT, never a prefix), verify
  from outside that `/ingest/%2e%2e/status.json` does not return the file, keep `INGEST_TOKEN` (it also
  guards `/export/*`) ≥ 32 random bytes, and
  add the public host to `PLAN_WEB_EXTRA_HOSTS` + `FOOD_ALLOWED_HOSTS` (`services/plan-web/README.md`,
  "Exposing behind an SSO tunnel"). Every path
  (the page included) answers only a Host that is an IP literal, `localhost` or a name in
  `PLAN_WEB_EXTRA_HOSTS`, else `421` (DNS rebinding; how to add a name: "Nutrition v2 part 2" →
  Security). A public
  reverse proxy in front of ingest must forward ONLY `/ingest/*` and `/sync` (`/sync/status`
  optional), never `/export/*`, `/sync/strava` or `/food/*`.
- **Health + tokens.** `/healthz` stays 200 but adds `degraded: true` when Strava is configured and its
  PERSISTED last success is > 6 h old or missing (a restart does not reset it). A refresh token rotated
  by Strava is stored in `strava_token` (3 save attempts with backoff; on failure it is kept in memory,
  status shows `strava_token_save`, and the save is retried next refresh) and preferred over
  `STRAVA_REFRESH_TOKEN` (the bootstrap); a failed store read is retried next refresh; a rejected
  stored token falls back to the env one once. Rolling this out needs an ingest rebuild
  (`docker compose up -d --build`, runs the idempotent `sql/003_sync.sql`).

## Knowledge base + expert subagents

`knowledge/` holds transcripts of expert content (third-party, personal use): EVERYTHING in it but
`knowledge/README.md` is gitignored — never commit, publish or `git add -f` it. Layout per source:
`knowledge/<domain>/<source>/manifest.json` (one entry per video: title, date, duration, `subs` =
manual | auto | none, file, words, fetchedAt) + `raw/<YYYY-MM-DD>-<id>.md` (header, then `[mm:ss]`
paragraphs of ~30–60 s, rolling auto-caption repeats removed); optional `index.md`, `temas/*.md`,
`videos/*.md` syntheses on top.

- **Ingest** — `node scripts/ingest-youtube.mjs --channel <url> --out knowledge/<domain>/<source>
  [--tabs videos,streams] [--limit N] [--lang es]`: incremental (skips manifest ids), subtitles only
  (never media), manual subtitles over automatic captions (the ORIGINAL-language track, never a
  machine translation), polite pacing + 2 retries, manifest written atomically after each video.
  External `yt-dlp` (`$YT_DLP` → PATH → `~/.local/bin/yt-dlp`). Pure parts (VTT → paragraphs,
  track choice, naming, manifest merge, flags) in `scripts/youtube-transcript.mjs`, unit-tested.
  Re-run it to pick up new uploads.
- **Hyprogram sync** — `node scripts/sync-hyprogram.mjs [--dry-run] [--limit N]`: pulls the owner's
  current "HP Hybrid" program (a login-gated Next.js app, NextAuth credentials) into
  `knowledge/hybrid/hyprogram/` — `raw/<id>.json` (an ALLOWLIST of the rendered fields only —
  id, date, titles, sections' wod / coach notes; file named from a safe id, else the ISO date),
  `semanas/<YYYY-Www>.md` (faithful Spanish render of each day: sections, WOD, coach notes) and
  `manifest.json` (incremental, per-date `fetchedAt`). Read-only GETs on the owner's own account;
  polite (~1.5 s apart) and it early-stops at the edge of the rolling access window (only a recent
  block of days is viewable). Credentials live in `data/training/.env.hyprogram` (gitignored, 0600:
  `HYPROGRAM_EMAIL`, `HYPROGRAM_PASSWORD`; `HYPROGRAM_ENV` overrides the path, only to a file named `.env.hyprogram`; a group / world-readable
  mode is a warning) and are NEVER logged; the cookie is only sent to the pinned hyprogram.com origin,
  the session counts only when `/api/auth/session` returns a user, and errors stay coarse
  (`auth_failed`, `http_403`), never echoing tokens. Pure parts
  (ProseMirror → Markdown, PII strip, week/date math, fetch plan, manifest) in
  `scripts/hyprogram-lib.mjs`, unit-tested. `hybrid-coach` reads the output. Re-run to extend the
  history as new weeks unlock.
- **Shared by the three coach subagents** — `tools: Read, Grep, Glob` (no Bash: anything that needed
  a shell is done with Read / Grep). The SAME "Shared rules" block in each (reply in the user's
  language, Spanish by default; not-a-doctor note on health topics; never read `.env*` / credentials;
  sponsor / affiliate bias flagged; auto-caption numbers "verificar") — edit it in all three at once.
  The SAME "Owner facts" table: weight = the newest `weight.csv` rows (+ the last 7 days as context;
  mixes scales), height / birthdate / devices / supplements / events = `profile/profile.json`, goal +
  target weight = `data/profile/settings.json` (missing → unknown; `fetchedAt` > 3 days old → may be
  stale), stable context = `profile/about-me.md`; never numbers from profile prose (live files win);
  freshness checked against TODAY from the conversation context (`_meta.json` `exportLastDate`, each
  CSV's newest date; > 3 days flagged); days to each event computed from TODAY. **Routing**:
  fuelling, hydration, electrolytes, supplements and body-composition nutrition belong to
  `nutrition-coach`, also when the question comes from cycling or HYROX; the training coaches answer
  only the training part and hand off ("para la nutrición, pregunta al nutrition-coach") and vice
  versa; the frontmatter descriptions say the same.
- **`cycling-coach` subagent** (`.claude/agents/cycling-coach.md`, read-only) — DELEGATE to it any
  cycling TRAINING / power / FTP / zones / periodization / bike fit / gear / Garmin Edge / EMS suit
  question (on-bike fuelling → `nutrition-coach`). FTP is stored nowhere: unknown → it says so and
  never estimates one, working from the power curve / kJ / HR as Edu does and suggesting a test.
  Gear manuals: `data/gear/garmin-edge-540-manual-es.txt`, `data/gear/vitalcontrol-sem-42-manual.md`.
  It lists Edu's commercial ties (226ERS, Umbral, Canyon / Mondraker, Gobik, Whoop affiliate,
  Hammerhead, Garmin…, from `knowledge/cycling/talavera/index.md`). It applies the expert's criteria from `knowledge/cycling/talavera/` (Eduardo
  Talavera), cites every claim with the video title + `&t=<seconds>s` URL, marks automatic-caption
  numbers "verify in the video", separates "what the expert says" from `analysis/methodology.md` /
  evidence (contradictions flagged), and grounds advice in the owner's data. A new expert = a new
  ingest folder + a subagent whose only source-specific part is its "Knowledge source" section.
- **`hybrid-coach` subagent** (`.claude/agents/hybrid-coach.md`, read-only) — DELEGATE to it any
  HYROX / hybrid TRAINING question (running + strength + conditioning, Hyrox stations, race strategy,
  programming, comparing a program with what he did); race nutrition → `nutrition-coach`, cycling →
  `cycling-coach`. Hyprogram: synced by cron (Sun 21:15 / Mon 06:15) into
  `knowledge/hybrid/hyprogram/semanas/`; nothing before 2026-09-21 is available (rolling window); the
  `temas/` syntheses have no Hyprogram section yet, so it reads `semanas/` directly. The HYROX station
  weights table (`temas/estaciones-y-tecnica.md`, marked verificar) is never stated as fact: it
  points to the current official rulebook. Same rules as `cycling-coach` (podcast claims cited with `&t=<seconds>s`, programs
  by file / month / week; auto-caption numbers and sponsor bias flagged; sources vs methodology kept
  apart; never writes files), grounded read-only in `workouts.csv` (runs, gym,
  other), `running-daily.csv`, HRV / RHR / sleep, race dates from `profile.json` `events` and
  `profile/about-me.md` (which program he followed when). Its knowledge, `knowledge/hybrid/`: optional `index.md` + `temas/*.md`
  (cross-source syntheses); `hyprodcast/` (a Hyrox podcast: the YouTube ingest layout above +
  `videos/*.md` summaries); `ferry/` (coach Ferry, the owner's program Dec 2025 – Jun 2026:
  `index.md`, `metodo-ferry.md`, `months/<YYYY-MM>-ferry.md` transcribed from the PDFs);
  `training-culture/hybrid-6-semanas.md` (a 6-week block); `hyprogram/` (the current Hyprogram
  "HP Hybrid" program, from 2026-07-01, kept in sync by `scripts/sync-hyprogram.mjs` above —
  `semanas/<YYYY-Www>.md` + `raw/*.json`).
- **`nutrition-coach` subagent** (`.claude/agents/nutrition-coach.md`, read-only) — DELEGATE to it any
  sports nutrition / supplementation question, including the nutrition side of a cycling or HYROX
  question (daily diet for training, fat loss and body composition, protein, carbs around training,
  on-bike / race fuelling, hydration and electrolytes, supplements, gut training);
  cycling training stays with `cycling-coach`, HYROX training with `hybrid-coach`. EVIDENCE first: a
  practitioner never outranks the evidence base. Every claim cited (evidence = document + URL +
  section; videos = `&t=<seconds>s`), "what Second says" kept apart from the evidence, contradictions,
  sponsor / brand bias and auto-caption numbers flagged. Spain context (AESAN supplement limits,
  products sold in Spain, BEDCA foods), anti-doping / contamination warnings (WADA, third-party-tested
  batches), not a doctor (refers to a physician / dietitian-nutritionist for medical conditions,
  medication interactions and eating-disorder signals), no crash diets (`analysis/methodology.md`
  safe ranges). Grounded read-only in `plan-data.json` + `ingredients.json`, the owner facts above
  (incl. `profile/profile.json` supplements and `data/profile/settings.json`), `profile/about-me.md`, the extract (weight, `dietary-daily.csv`, energy) and the
  Nutrición rules above; the food log as daily sums from `data/nutrition/foodlog-daily.csv` (the
  `sync:foodlog` export; missing → it says the sync has not run). Spanish replies; never writes files. Its knowledge, `knowledge/nutrition/`: optional
  `index.md` + `temas/*.md` (cross-source syntheses); `evidencia/` (AIS Sports Supplement Framework,
  IOC 2018 supplement consensus, ISSN position stands, AESAN, WADA — the evidence base); `ferrandis/`
  (Second Ferrandis, dietitian-nutritionist, YouTube: the ingest layout above + `videos/*.md` cards —
  the practitioner source); it also reads `knowledge/cycling/talavera/temas/nutricion-en-bici.md` +
  `hidratacion-y-sales.md` and `knowledge/hybrid/temas/nutricion-y-suplementacion.md`.

## Output principles

- **Ground every claim in their data.** If the data does not support a statement,
  say so. Do not invent macros or calories you cannot derive.
- **Flag missing data explicitly.** If nutrition data is absent, you cannot judge
  intake — say that plainly instead of guessing.
- **Trends over snapshots.** One heavy day or one missed workout is noise.
- **Actionable + few.** 2–4 concrete changes per report, not a wall of advice.
- **Honest, not flattering.** If a trend is going the wrong way for their goal,
  say it directly and explain why.

## Hard rules

- **Never commit raw health data.** It is gitignored. Do not un-ignore it or
  `git add -f` personal metrics.
- **Not a doctor.** Add the disclaimer to any report. Defer to professionals for
  clinical concerns.
- **No crash diets / extreme deficits.** Recommend sustainable changes within
  safe ranges defined in `methodology.md`.
