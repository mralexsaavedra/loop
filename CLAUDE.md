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
     devices double-counts — summing inflates the NEAT figure).
     Between exports, `npm run sync` (`data/apple-health/sync-shortcut.js`; how to build the Shortcut and
     every payload key: `docs/ios-shortcut.md` — keep its key table in sync with the `METRICS` table) pulls iOS Shortcut
     payloads from the optional `services/health-ingest` service (`GET /export/raw`) and merges
     hrv/rhr/vo2max/weight/bodyfat/leanmass/waist/steps/energy/dietary/sleep/respiratory/
     walking-HR/wrist-temp/hr-recovery into those CSVs: export rows always win,
     Shortcut rows are rebuilt each run and fill only dates the export lacks — so re-run sync after
     `extract.js`. Sync is incremental (local gitignored `extract/.shortcut-cache.json` of deduped
     samples + last payload id; `npm run sync -- --full` rebuilds it). Daily totals: the latest
     payload wins, and each payload's oldest (window-truncated) day is ignored. They are tagged `source=Shortcut` except body comp (keeps the real scale source
     for the latest-source logic) and energy (no source column); `_meta.json` `shortcutSync.owned`
     lists every date sync wrote. Shortcut steps = MAX of per-device day totals (`steps_watch`,
     `steps_phone`; source `Shortcut Watch`/`Shortcut iPhone`), mirroring max-per-device — a
     merged iOS `steps` total sums the devices (double-counts), so that key is ignored.
     Unreachable service → exits non-zero without touching files. Row helpers are shared in
     `samples.js`, so both paths format rows identically.
   - Nutrition: `data/nutrition/food-log.md` — the daily food log + rationale notes only.
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
  from `web/src/i18n/date-templates.mjs`, not Intl, whose ICU builds disagree), and `detailAttrs`
  (the detail-sheet opener markup, see "Detail views"). The client scripts read these instead of
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
| 🏠 Inicio (`home`) | TODAY: Sleep / Recovery / Load dials; health monitor; today's timeline (last night's sleep + the day's workouts); the advice sentence; "today you eat" card (today's day type + goal and target kcal/macros, link to Nutrición); programmed session (`hoy`) |
| 🏃 Entreno (`entreno`) | per-modality load cards + caveats (`load`: `#score-load`, the detail behind the load dial); 30-day activity calendar + cumulative training time (`calendar`: `#train-activity`); running table, cycling table, load vs recovery (`sessions`: `#health-train`); Entrenamiento dashboard (`dash`) |
| 💗 Salud (`health`) | recovery (`#hl-recovery`, with the recovery detail card `#score-recovery`, then the recovery trends); sleep (`#hl-sleep`); body composition; daily activity; energy expenditure |
| 🍽️ Nutrición (`nutricion`) | today (`dia`: Resumen de hoy + intake rings, Registrar (the FOOD LOG, LAN page only; its add sheet's "Del plan" tab logs Plan de hoy's meals), Plan de hoy (a `<details>` fold, collapsed by default), Avituallamiento on bike days — see "Nutrition v2" and "Nutrition v2 part 2" below); Mis productos + Mis recetas (collapsible, LAN page only, no section key: rendered with `dia`); Tablas (`tablas`, collapsible: FIXED reference values per natural unit, never portions — see "Choosable blocks and Tablas" below) — there is no train/rest toggle: Resumen de hoy's day type is the one selector. The former Constructor de día / Day builder (`registro`) was removed: the food log replaces it |

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
cumulative chart (rest of the row, height-capped at 240 px) in ONE row (`.act-pair`). Nav tab icons are inline SVG line icons keyed by tab (`TAB_ICONS` in `web/layouts/Plan.astro`,
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
  so browser Back closes the sheet; a page opened with that hash opens the view — only for an OWN key
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
  and the kcal chip at once. No `HCNutri` or no options → the section is omitted.

- **Sources** (all optional, merged by `lib/profile/profile.mjs` `loadProfile` → `buildProfile`;
  manual wins over Strava for the same field):
  1. `profile/profile.json` (gitignored; tracked template `profile/profile.example.json`, synthetic):
     `birthdate` (YYYY-MM-DD), `heightCm`, `devices: [{name, type: watch|bike-computer|ems|other,
     since?: YYYY-MM}]`, `supplements: [{name, dose?, meal}]` (see "Nutrition v2"), optional
     `name` / `city` overrides. Validated by `validateManual`: at build
     time a malformed file is IGNORED with a `WARNING:` naming the reason (the page still builds from
     the Strava + derived data); `npm run check` (`build-web.mjs --check`, `checkManualProfile`)
     FAILS on it with the same reason.
  2. `data/profile/strava-profile.json` + `data/profile/avatar.jpg` (gitignored), written by
     `data/profile/sync-profile.js` (`npm run sync:profile`, last step of `npm run sync`) from the
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
  merged into a manual entry of the same name); Suplementos / Supplements (name, dose, meal; omitted
  when there are none); Strava (focus + snapshot date). Nothing known at all
  → only the onboarding hint (copy `profile.example.json`, run `npm run sync`). Styles:
  `web/src/styles/profile.css` (tokens only).

## Nutrition plan — data pipeline & published artifact

**Two files, merged in memory (by both `generate.js` and the Astro build, from the same
`lib/nutrition/macros.mjs`):**
- `data/nutrition/ingredients.json` (TRACKED, **public** food DB) — the reusable
  `{ "ingredients": { … } }` of per-100 g/ml/ud base foods (`verified:true` = real product
  label, `false` = DB estimate; each carries `name` + `note` + a food category `cat`, see "Choosable
  blocks"). `name` is localized, `{es, en}`
  (a plain string stays valid for backward compat), resolved by the BUILD locale wherever a food is
  named — Plan de hoy, Tablas, plan-tables.md (generate.js: `LOCALE` env → `plan.locale` → en), the
  food log's "Del plan" — by `lib/nutrition/names.mjs` `ingName` / `lineName`; an ingredient without a
  name is a `npm run check` WARNING (the page then shows its key), a malformed one an error, and a test
  asserts every tracked ingredient has es + en names. This is shareable and is the
  one piece of the plan that goes public. It may hold MORE foods than any single plan uses — e.g. the
  25 generic LOG-ONLY basics (`swap: false`: yogur natural, queso fresco / batido, pan de barra / de
  molde, jamón cocido, tomate, lechuga, pepino, aguacate, nueces, almendras, cacahuetes, aceitunas,
  mantequilla, azúcar, café solo, bebida de avena, atún en aceite, sardinas, pechuga de pavo, tortilla
  de trigo, cereales, galletas María, chocolate 70%) with average BEDCA values (kcal from the macros
  with EU factors, BEDCA's query API returns no energy row) or USDA FoodData Central ones (carbs = by
  difference − fibre) when BEDCA lacks the food, `verified: false` and the source id in `note`; the
  food log searches EVERY food of the file (see "Nutrition v2 part 2").
  Optional NATURAL-UNIT metadata per food (`lib/nutrition/units.mjs`, validated by
  `validateIngredientMeta` inside `npm run check`): `piece: { name: {es, en}, plural?: {es, en}, amt,
  g?, typical? }` — the food's natural piece, `amt` in the food's own unit (g / ml; a `ud` food's piece
  is its unit, amt 100, with `g` = its grams reference), `typical: true` = a typical weight (medium
  fruit, a tablespoon, an egg ~50 g), NOT a weighed label — a tablespoon's weight is PER FOOD (its own
  `piece.amt`: olive oil 10 g, allioli / mayonesa 15 g); and `weighed: raw | dry |
  cooked` (how the plan weighs it: meat raw, rice / pasta / oats dry, potato / legumes cooked).
- `data/nutrition/plan-data.json` (GITIGNORED, **personal** plan) — the owner's actual diet:
  `data`/`dayPlan`/`extras`/`extrasDisplay`/`quesoKeys`/`vegKeys`/`legumeKeys`/`legumePlate`/
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
`web/src/client/intake.js` draws four rings (kcal, protein, carbs, fat) against TODAY's target
(`window.nutriTarget()` from client/nutri-day.js: the goal × day type picked above; on bike days the
MEALS target = day target − ride fuel, with the fuel on its own line "+ X kcal en la bici"), falling
back to the plan's training-day total when that hook is absent or throws. The rings show ONLY when that day is within the
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
(`lib/nutrition/today.mjs` `buildNutriToday`, in `web/src/tabs/Dia.astro`, ~10.6 KB on the example with the block lists) +
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
  (`targetFor`) are no longer read by the page (they fed the removed day builder); generate.js keeps
  exporting `targetFor`. Likewise `extrasDisplay`, `indulgeKeys`, `alcoholKeys`, `mealReplaceKeys` and
  `page.notes['registro.*']` / `page.offPlanPlaceholder` stay valid in a plan but render nothing.
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
  block). `solveScale` = WATER-FILLING (`waterFill`): one common factor for every carb-flex line so the
  meals hit (target − ride fuel), clamped to `SCALE_MIN`–`SCALE_MAX` (0.6–2.0×); a line that would
  pass its cap is HELD at the cap and the factor is re-solved over the lines still free, until stable (a
  cap beats `SCALE_MIN`: a written amount above its cap shrinks to it); rounded to 2 decimals and
  labelled with 2 decimals ("×1.45"); with every line held the factor is the largest cap reached.
  `capped` = some line is at its cap, `allCapped` = every flex line is (and no manual block, which has
  no cap); `qn` / `planFor` `flexN` = each flex part's numeric line amounts (`[null]` for a manual
  block). DISCRETE lines — whole units (`ud`, whole units) and countable g / ml foods (an
  ingredient with a `piece`, rounded to HALF pieces — `PIECE_GRID` in `lib/nutrition/units.mjs`, one
  unit = `UD_AMT` (100), both baked as `NUTRI.scale.grid` / `.ud`; the model line carries `[…, step,
  ingredient key]`, `lib/nutrition/amounts.mjs` `modelLine` / `stepAmount`; its layout is named ONCE as
  `LINE` with accessors `lineUnit` / `lineAmt` / `lineMac` / `lineStep` / `lineKey` / `pieceOf(pieces, l)` /
  `scaleLine`, mirrored in nutri-day.js — never read by a bare index) — round first at that factor, then the factor is
  RE-SOLVED (water-filling again) on the remaining g / ml parts so the day still lands within tolerance; a
  rounded amount never passes its cap (`capAmount` steps DOWN on the line's grid); with only `ud` parts flexible the
  remainder is reported honestly (plus a one-line note). Amounts round to 5 g / 5 ml (never below one
  step; a `manual` block scales as a whole and shows "×1.30") and the totals are recomputed from the
  ROUNDED amounts. The rest is `rem` (target − ride fuel −
  meals, kcal): beyond `REMAINDER_TOLERANCE_K` (75) the page says it ("~X kcal short: add ~Y g of
  carbs" / on bike days "add them to the ride fuel" / "over: trim fat or extras"); when nothing can grow
  any more (`allCapped`, or the factor at `SCALE_MAX`) a shortfall suggests a snack instead of a bigger
  plate ("Faltan ~X kcal: añade un tentempié (p. ej. fruta o un bocadillo)" / "~X kcal short: add a
  snack (e.g. fruit or a sandwich)", `remSnack`; bike days keep the ride-fuel line). The example plan
  is short on most goal × day types with caps (its base day carries too few carb parts for 2500–3400
  kcal): `lib/nutrition/today.test.mjs` allows a remainder only when nothing can grow. Protein and fat are
  NOT scaled: a plan more than `MACRO_TOLERANCE_G` (15 g) off the target says so. `planFor(bake, goal,
  dayType, minutes)` gives one plan for a ride of `minutes` (meals target `mt` = target − ride fuel,
  the fuel being all carbs); the page bakes only `{base, t}` per (goal, day type) + the two models and
  runs a line-by-line port of `solveScale` / `planFor` (parity test), so a new ride duration re-scales
  Plan de hoy. `buildDayPlans` precomputes the 12 plans at the default ride minutes for the table in
  `plan-tables.md` ("Daily targets by goal and day type"). Item parts show their `q`
  only when it states an amount (a "—" placeholder is replaced by the recipe amounts); an `{ing}`
  part shows its `label`, else the ingredient's `name`, else its key — give `{ing}` parts a `label`
  (a composite's components: the recipe line's `label`, else the ingredient's `name`, else its key).
  A countable food shows pieces with the grams reference (`fmtPieces`: "1½ medium bananas (~180 g)"
  on the half-piece grid, "~2 bread rolls (80 g)" off it; "2 eggs (~100 g)"); `fmt.pieces` bakes only
  the pieces a baked line can format (fixed parts are pre-formatted).
- **Choosable blocks** — `lib/nutrition/blocks.mjs`: a dayPlan part that points at an option list
  (`{use, tier?, match}`: `data.proteina`, `data.carboComida.train`, `data.postre`, `data.desayuno`…)
  is a BLOCK when that list holds ≥ 2 eatable options (none rows excluded); its default = the part's
  `match`. Lists of one stay fixed (fixed `{ing}` parts are FOOD blocks, below). Stable ids: block id = `<meal key>/<use>`
  (meal key = the meal's `slot`, else `mealSlot` from its name, else its name; the TIER is not in the
  id, so a pick follows the day across train / rest; a repeat in the same meal key gets `#2`…; ids are
  slot / list-based, not meal-based: two meals sharing a slot (or name) and a list get their ids BY ORDER
  in the day, so reordering such meals moves a stored pick to the other one);
  option key = the item's `n`, else `cap`, else `l` (ONE rule, `lib/nutrition/names.mjs` `itemName`, also
  the baked option name and the Tablas row name; a repeated key gets " (2)"). Swap rules
  (`swapOption`, pure: the picked option as the part that replaces the default + its flex entry or fixed
  macros; `applyPicks` only keeps the books): PROTEIN-role lists (`BLOCK_ROLES`: proteina, anclaje, postentreno — explicit in lib,
  never from emoji / labels) scale the picked option to the SAME protein grams as the default
  (`swapFactor`, clamped `PROTEIN_SCALE_MIN`–`MAX` 0.5–2.0, amounts rounded like every scaled amount;
  a manual block shows "×1.73"); every other list takes the option's own recipe amounts. A pick in a
  carb-flex part stays flex only when the option is itself flex-able (`lib/nutrition/flex.mjs`
  `isFlexItem`: every line a carb / fruit food or a carb STAPLE by share, ≥ 60 % of its kcal from carbs;
  a `manual` block never is), else it becomes a fixed part; then `solveScale` re-solves the WHOLE day (same clamp, rounding, remainder
  notes). `planFor(bake, goal, dayType, minutes, picks)` returns `view` (the meals to display) and
  `picks` (the effective ones); no effective pick (none, the default key, an unknown id / key) = the
  base model untouched, byte for byte. Bake: `lists[<use>[.<tier>]]` = options `{k, n, gr?, ln | mb,
  q?, c?, pr, fx?}` (line macros to 2 decimals; `gr` = the item's `t` / `cat`; `fx: true` = a carb staple,
  absent = not; the block's `fx` is a boolean too) + per base day
  `blocks[id] = {L, r, d, fx}` and an `id` on each block part; NUTRI grew from ~5.6 KB to ~10.6 KB on
  the example. The page (nutri-day.js) ports `swapOption` / `applyPicks` / `swapFactor` / `fmtPieces` line by line
  (parity test over every single pick + combinations). Plan de hoy renders a block's name as a
  compact `<select class="mp-pick">` (≥ 44 px, `<optgroup>`s by `gr`: lean / moderate / fatty, fruit /
  yogurt…, aria-label "Change <item> (<meal>)"); a change keeps the pick for TODAY in localStorage
  (`hc.nutri.picks` = `{date, picks: {<id>: <key>}}`, expires the next day, every access wrapped;
  picking the default drops it), re-renders and refocuses that select; with picks a one-line note +
  "Back to the base plan" (`#nutri-picks-reset`). `HCNutri.setPick(id, key)` / `resetPicks()` exist
  for tests. Food-API recipes as extra breakfast options were NOT added (they exist only at view
  time on the LAN, so they cannot be part of the baked lists and the parity design).
- **Food blocks — every fixed `{ing}` part is choosable** (the owner: "no tiene sentido que me marques
  que tengo que comer calabacín sí o sí"). Every ingredient of `ingredients.json` carries a food
  category `cat` from a small CLOSED set (`lib/nutrition/categories.mjs` `FOOD_CATS`: protein, carb,
  legume, fruit, veg, dairy, cheese, fat, sweet, drink, sauce, other — cheese (tranchete, mozzarella) is
  its own category so it is never offered in place of the coffee's milk; `npm run check`: an unknown `cat` is an
  error, a missing one a warning — that food then stays a fixed part; the key `none` is reserved; a test
  pins that every tracked ingredient has one). A fixed `{ing}` part whose food has a category is a FOOD
  block: its options are every ingredient of the SAME category (default = its own food, shown under the
  part's `label`; the others by their localized `ingName`, sorted by name) plus, only where skipping is
  sensible (`CAT_RULES[cat].skip`: fruit, veg, dairy, cheese, sweet, drink, sauce), a "none" option (key `none`,
  "Sin verdura" / "No vegetables"…, `T.plan.none[cat]`). A category with one food and no "none" (e.g.
  `other`: baking powder) stays fixed; a LOG-ONLY basic (`swap: false` on the ingredient: the generic
  foods added for the food log's basics, see "Nutrition v2 part 2") is never an option and a part of one
  stays fixed (a non-boolean `swap` is a `npm run check` error), so adding basics never changes Plan de
  hoy; `manual` blocks never are blocks; the components INSIDE a
  composite option (breakfast "C — Tostadas", "Yogur + avellanas + miel") stay as they are (the option
  is chosen as a whole); list blocks keep their behaviour. Swap rule per category = ONE explicit table
  (`CAT_RULES[cat].by`, tested): protein → the same protein grams; carb / legume / fruit / sweet → the
  same carb grams; fat → the same fat grams; dairy / cheese / drink / sauce → the same kcal; veg / other → the
  same grams (veg is ~free). `ingAmount`: from the default's WEIGHT (a `ud` food through its piece's
  grams, `gf`), the factor that keeps that macro (or kcal) equal, clamped to the protein swaps' 0.5–2×
  (`PROTEIN_SCALE_MIN`–`MAX`, so a dense whey swapped for chicken lands at 2× and protein may then fall
  short — the macro note says so), rounded like every scaled amount (`stepAmount`: 5 g / 5 ml, half
  pieces for a countable food, whole units). `swapIng` returns the picked food as the part (a carb-flex
  part stays flex only when the new food is itself flex-able, `isFlexItem`, else it becomes fixed); "none" = a zeroed part `{l: '', z: 1, m: [0, 0, 0, 0]}` (no amount, no flex entry); then
  `solveScale` re-solves the WHOLE day exactly as for list picks. Ids: `<meal key>/<default ingredient
  key>` with the same `#n` rule — ONE counter shared with the list ids, so lunch and dinner's
  courgette are `lunch/calabacin` and `dinner/calabacin`, a second courgette in one meal
  `lunch/calabacin#2`, and the after-lunch coffee (no slot) `Café (tras comer)/leche`; option key = the
  ingredient key (or `none`); a stale / foreign pick is ignored as before. Bake: blocks reference foods
  by key only — per base day `blocks[id] = {I: category, d: default key, a: default amount, fx, n?:
  the part's label}` + ONE catalogue `NUTRI.foods = {cats: {<cat>: [keys]}, ings: {<key>: {n, l: model
  line at its per amount, fx?, gf?}}, rules: {<cat>: CAT_RULES[cat]}}` for the categories some block
  uses; `fmt.pieces` covers every countable food in it. NUTRI on the example went from ~10.5 KB to
  ~17.9 KB (foods ~5.3 KB; budget test 20 KB); the owner's plan ~18.9 → ~24.5 KB. The page ports
  `ingAmount` / `swapIng` / `isOption` line by line (parity: every food block × option incl. none in
  both locales, a synthetic sweep of every category rule, every single pick + combinations through
  `planFor` / `applyPicks`); the no-pick path is byte-for-byte unchanged (`PINNED_TOTALS` for all 12
  plans). UI: the same `.mp-pick` select (no optgroups), in main cards and on Añadidos rows; a "none"
  row keeps its select (muted, `.mp-none`) and shows no amount; `HCNutri.todayPlan()` leaves a skipped
  food out (and a meal whose every food is skipped), so the food log's "Del plan" logs what was picked.
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
  `fatMax` = fat + 15 g, `fuelK`, `day` = base day train / rest, label) feeds the intake rings, and
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
  setting (`HCDetail.open('profile', null, { focus: '#pf-goal input:checked' })`), then the plan line
  (meals total; on bike days "meals + ride fuel = total"), remainder / macro notes, then the intake
  rings — which step aside (host hidden) when the logged day is today, since the dial shows it. Inicio's
  "today you eat" card (`#eat-body`) shows the same day type, goal and target.
- **Plan de hoy** — only THREE main meals are cards: a meal whose slot (`mealSlot`: its own `slot`,
  else from its name) is breakfast / lunch / dinner (`lib/nutrition/slots.mjs` `MAIN_SLOTS` /
  `isMainMeal`, baked as `NUTRI.mainSlots`; the page's `isMainMeal` is pinned to lib by a test). Every
  other meal (pre / post workout, snack, protein anchor, an after-lunch coffee, cooking oil, any meal
  with no slot) is a compact ROW of ONE "Añadidos" / "Extras" card after the main cards (`.meal
  .meal-addons`, rows `.addon`: name as a small caps label + kcal in `--num`, then its item rows with
  the scaled arrows, its block select and its supplement lines; the card's kcal = the sum of its rows;
  no add-ons → no card). Display grouping ONLY: the meals are walked in day order (flex index,
  supplements' "first meal of the slot") and no number moves — a test pins `planFor`'s totals for all
  12 plans and checks the cards add up to the day. Restrained cards (no accent border): meal name as a caps label, kcal big in
  `--num`; item rows = name left, amount right; a scaled portion carries a small muted ↑ / ↓ with an
  aria-label (`solveScale` / `planFor` return `qa` / `flexAmts` per-line amounts and `dir` /
  `flexDir`); a composite item (several recipe lines, no amount of its own; baked with `c` names and,
  when fixed, `a` amounts) lists its components as sub-rows (name · amount), never "82 g + 20 g";
  a muted P / C / F (es: G) mini line; the carb factor ("×1.6 vs the base plan", "(the maximum
  applied)" when clamped; "×1.19 vs the base plan; some portions are at their maximum" when a line is
  capped; "Every carb portion is at its maximum" with no factor when all are). The block is a native
  `<details class="nutri-block sec-fold nutri-fold" id="nutri-plan-fold">`, COLLAPSED by default: the
  summary = the heading + the plan's total kcal (`#nutri-plan-kcal`, written on every refresh); the
  open state is a per-viewer convenience (`hc.nutri.planOpen` '1' / '0', every access wrapped, saved on
  `toggle`). The plan renders while collapsed, so the selects and "Del plan" never depend on it being
  open. Avituallamiento stays after it, never collapsed. **`HCNutri.todayPlan()`** hands that same plan (block picks included:
  it reads `x.view`), read-only, to the food log's "Del plan" tab: `[{name, slot, kcal, p, c, g, items: [{name, amount, kcal, p, c, g,
  components?}]}]` from `current()` (goal × day type × ride minutes through `planFor`, never
  re-computed in food.js); meal totals exactly as Plan de hoy prints them (whole numbers); an item at
  its scaled amount with kcal whole and macros to 1 decimal — a fixed part's macros are baked on the
  part (`m`, from `buildDayPlans`), a flex part's come from `solveScale`'s `qm` (`planFor`
  `flexMac`, at the ROUNDED amount); a composite has `amount: null` and its `components` (name,
  amount). A fresh copy each call; `null` when there are no meals (or on a throw).
- **Supplements** — optional `supplements: [{ name, dose?, meal }]` in `profile/profile.json`
  (`meal` = breakfast | lunch | preworkout | postworkout | dinner | snack, `lib/nutrition/slots.mjs`
  `MEAL_SLOTS`; validated by `validateManual`). A discreet "name dose" line under the first meal of
  that slot (no macros; a small pill SVG icon, no emoji; a preworkout / postworkout / snack supplement
  sits on that add-on's row in the Añadidos card); ones whose slot is not in today's plan are listed under "Other supplements
  today" with their slot. A meal's slot = its own `slot` field, else guessed from its es / en name
  (`mealSlot`: desayuno / breakfast, comida / lunch, pre / post-entreno / workout, cena / dinner,
  merienda / snack / anclaje). They are also listed in the profile sheet.
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
- **Tablas = fixed reference values** — `lib/nutrition/reference.mjs` `buildReference(nut, {lang,
  words})`, server-rendered by `web/src/tabs/Tablas.astro` through `components/RefTable.astro` (no
  bake, no client script: `client/tablas.js`, `BreakfastTable.astro` and the DATA / EXTRAS /
  QUESO_KEYS / VEG_KEYS / FRUIT_SUMMARY / I18N_TABLAS globals are gone). Same sections / lists, NO
  portions: each food per its NATURAL unit (`refUnit`): a piece with its grams reference ("1 medium
  banana (~120 g)", a typical weight tagged "typical weight"), oil per tablespoon, else "100 g" /
  "100 ml" + how it is weighed ("100 g dry", "100 g raw"); a composite option = a group row + one row
  per component food; a `manual` option = "1 serving (<its q>)". A carb list's train / rest tiers
  collapse to ONE table (no train / rest portion columns); same-named options collapse only when their
  reference rows are equal (the same food at another amount), otherwise both rows show (`listRows`). A one-line note at the top says today's
  amounts are in Plan de hoy; the generic notes (dict `tablas.*`) and the example plan's
  `page.notes['tablas.*']` no longer talk about portions. plan-tables.md (generate.js) keeps "Daily
  targets by goal and day type" and writes the same reference rows ("Food reference (fixed values per
  natural unit)"; legumes per 100 g cooked instead of a ~300 g plate).
- **Migration** — `node scripts/migrate-plan-v2.mjs [--dry-run] [--reset-flex] [--include-fruit]
  [--file <path>]` upgrades an existing personal plan-data.json in place, idempotently: adds
  `targets.byGoal` (defaults) when absent, marks `flex: "carb"` on dayPlan parts that are carb STAPLES
  (an `{ing}` in `STAPLE_KEYS` — rice, pasta, bread, potato, oats, couscous / quinoa, wheat wraps — or a
  `{use, match}` item whose recipe uses only those; fruit, honey, jam, juice only with `--include-fruit`;
  mixed items and `manual` blocks stay fixed; a part that already has a `flex` key is left alone), sets
  `page.goal: "maintain"` when absent. `--reset-flex` re-derives the markers of an already-migrated
  plan (removes a `flex: "carb"` the current set no longer covers, marks unmarked staples, never touches
  `flex: null`). A non-object `targets` / `page` is an error. Every run prints the carb factor +
  remainder per (goal, day type). Backs up to `plan-data.json.pre-v2-<local date>.bak` first (never
  overwriting a backup), writes atomically (temp + rename, 2-space JSON), writes nothing when nothing
  changes. Then `npm run check && npm run generate` and re-publish.

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
  the sum of its ingredients (amounts in each product's unit): kind `serving` ÷ servings, kind
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
  XOR cooked_weight_g, ingredients JSONB `[{productId, amount}]`, archived), `food_log` (the owner's
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
  byte-identical. Nothing of the log is kept in the browser. **Registrar**: the day total, then FOUR
  restrained group cards — Desayuno / Comida / Cena / Añadidos (en: Extras) — (`slots.mjs` `MEAL_GROUPS`
  + `mealGroup`, baked in `FOOD_CONST` as `groups` / `mainSlots` / `addonGroup` / `addonSlot`; label,
  amount, kcal in `--num`, P / C / G line, a 44 px delete button with an aria-label, "+ Añadir" per
  group). The stored slot enum is UNCHANGED (`food_log.meal` = the six `MEAL_SLOTS`, no schema change):
  entries stored as preworkout / postworkout / snack show in Añadidos with a tiny muted slot tag
  (`.fe-slot`). **Add sheet**: a registered detail-sheet view
  (`window.HCViews['food-add']`, deep link `#food-add`, registered only once the API answered; focus
  trap / Esc / Back from detail.js, whose Tab trap now includes form fields and whose
  `HCDetail.open(key, date, {opener})` returns focus to the tapped button): meal select = the four
  groups (Desayuno / Comida / Cena / Añadido; a main group is stored as its slot, Añadido as `snack`
  unless the "Del plan" pick is a plan add-on with its own preworkout / postworkout slot, which it
  keeps; a fresh sheet guesses the group by the viewer's hour: < 11 breakfast, < 16 lunch, < 20
  Añadido, else dinner), tabs Mis
  productos (search, grouped by store) / Mis recetas / Del plan (es "Del plan", en "From plan") /
  Rápido (label + kcal + optional macros), amount in g / ml / servings (servings only with a serving
  size; a per-serving recipe in servings, a batch one in grams of cooked food), live preview from the
  ported formula, `aria-live` results; save closes it, re-renders Registrar and announces "Añadido:
  …". **Del plan** = today's Plan de hoy meals — WITH the viewer's block picks — from `HCNutri.todayPlan()` (read when the sheet
  opens, so it follows today's goal, day type and ride minutes): the plan meals as toggle chips — the
  main meals, then each add-on, like Plan de hoy (the first meal of the sheet's group is preselected —
  Añadido → the first add-on — and follows that select; a pick already in the group stays), then a
  radio list — the whole meal (default) or one of its items (composites list their components) —
  with the kcal / macros preview; saving logs ONE `quick` entry: label "Plan · <meal name>" (an item:
  "Plan · <item> (<amount>)", capped to `nameMax`) with all four macros (no schema change: the
  `food_log` snapshot already stores quick macros), through the same request-id / ambiguous-retry /
  "save anyway" (Atwater) flow. No hook, an empty plan or a throw → the tab is omitted (the tab bar
  holds 3 or 4 tabs). **Basics in the Mis productos tab**: the search box also looks in `FOOD_BASICS`
  (baked by `Dia.astro`, ~9.5 KB for 104 foods; the box shows even with no product yet). An EMPTY search
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
  cooked macros; editor = name, kind, servings or cooked weight, ingredient rows (product select +
  amount, add / remove) and a live preview. Errors = one line from the coarse codes ("offline" → the
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
  and intake.js do not re-check the date. A macro NO entry states is `null` (a dash, never "0 / 150 g"
  or 0 %); `missing[m]` = at least one entry lacks it, so a non-null value is a minimum and the bar /
  ring shows "≥ 40" (the rings add a one-line note). ONE logged entry today is enough: the dial, bars
  and rings then show the page's food log for today instead of the Apple Health intake (labelled
  "Registrado hoy en esta página" / the rings' "Registrado hoy"). After every add / delete food.js calls
  `HCNutri.refresh()` (re-renders Resumen de hoy, which refreshes the rings, in its own try/catch). A page left open past midnight reloads the log on `visibilitychange`.
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
Apple Health uses, so they land in the same `bike` bucket. Strava rows are ALWAYS kept, also on
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
exits non-zero with a message saying so, touching no files.

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
`#health` (Salud: recovery with `#score-recovery` right under its heading, sleep, body composition,
activity, energy — in that order) and `#health-train` (Entreno: running, cycling, load vs recovery).

**Today first.** Every trend card's headline is the NEWEST value with its date (a daily total dated
the viewer's today reads "today, so far" / "hoy, en curso", decided client-side); the 30-day mean
(`avg30`, `avg30Of`: mean of the daily values over the last 30 days — for the daily TOTALS of
`dailyTrend` the 30 days ending the day BEFORE the latest, since the build cannot know whether that
day is complete) and the Δ (`d30Of`) form the context line under it; a non-finite value is never
printed and a card that throws is skipped, never blanking the tab;
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
  night, but within only 60 min when they start after the night's end from 05:00 on
  (`AFTER_END_GAP_MIN`), so a 09:00 nap after a 06:30 wake-up is not absorbed). Naps (incl. one that
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

## Home tab — "Inicio / Home" dials, health monitor, timeline; recovery + load detail

`lib/score/*` (same single-source pattern) feeds the first tab; `web/src/client/score.js` renders it
(dials + advice on Inicio; the recovery card into Salud's `#score-recovery` and the per-modality load
cards + caveats into Entreno's `#score-load` — glance vs detail),
`buildScores(extractDir)` bakes `SCORES` (only `asOf` dates — staleness is computed client-side, so
consecutive builds are byte-identical). The tab is first and active by default; the visible panel is
derived from the FILTERED nav list (`activeTabKey`), so `page.hideTabs: ["home"]` hands over to the next
tab and hiding every tab is a build error.

**Today first, trend as context** (Bevel/Whoop-style, but no invented 0-100 scale): every headline
is the newest day, and the trend is the line under it.

- **Recovery** is in MAD units, never a 0-100 grade: HRV (daytime SDNN), resting HR, sleep duration and
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
  `components/HealthMonitor.astro` + `client/monitor.js`, under the dials): cards for respiratory
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
  fallback, and every host write (`#home`, `#home-dials`, `#score-recovery`, `#score-load`, the advice)
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
(nginx, `./site` only). `refresh.sh` rebuilds and publishes it hourly (cron) AND on demand, under a
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
  `X-HC-Food` header forwarded; see "Nutrition v2 part 2"); every other `/api/` path 404. Every path
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
