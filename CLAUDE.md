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
  (units from the i18n dict), `MS_PER_DAY`, `STALE_DAYS`. The client scripts read these instead of
  redefining them (a test guards it), and constants come baked from `lib/` (`STALE_DAYS` via
  `HC_CONST`; the calendar's `windowDays` / `levelMin` via `activityBake` into `ACTIVITY`), never as
  client literals. Tests load it with `web/test/client-util.mjs` `loadUtil(ctx)`.
- All personal COPY (page title/kicker/h1/sub/footer, per-slot notes, which tabs/sections to hide)
  lives in `plan-data.json`'s `page` block (`page.notes.<slotId>`, `page.hideTabs: ["hoy"]`,
  etc.) — never hardcoded in tracked Astro/JS source, which stays fully generic.

**Tabs and sections.** Four top-level tabs, one question each (Whoop-style: the glance on Inicio,
the detail one tap away). Nav = fixed bottom bar on narrow screens (four equal buttons that fit a
360px phone, safe-area insets on bottom/left/right), sticky top bar on wide ones. The former tabs
live on as SECTIONS (`data-section="<key>"`, `id="sec-<key>"`):

| Tab (key) | Content, top to bottom |
| --- | --- |
| 🏠 Inicio (`home`) | TODAY: Sleep / Recovery / Load dials; health monitor; today's timeline (last night's sleep + the day's workouts); the advice sentence; "today you eat" card (day toggle + that day's kcal/macros, link to Nutrición); programmed session (`hoy`) |
| 🏃 Entreno (`entreno`) | per-modality load cards + caveats (`load`: `#score-load`, the detail behind the load dial); 30-day activity calendar + cumulative training time (`calendar`: `#train-activity`); running table, cycling table, load vs recovery (`sessions`: `#health-train`); Entrenamiento dashboard (`dash`) |
| 💗 Salud (`health`) | recovery (`#hl-recovery`, with the recovery detail card `#score-recovery`, then the recovery trends); sleep (`#hl-sleep`); body composition; daily activity; energy expenditure |
| 🍽️ Nutrición (`nutricion`) | Mi día plan (`dia`); Registro (`registro`, collapsible); Tablas (`tablas`, collapsible) — the global train/rest toggle shows here, and only while Mi día or Registro is visible |

`lib/nav/tabs.mjs` is the ONE source of the tab keys (`TAB_KEYS`) and of the legacy-section map
(`SECTION_TAB`); the page derives each tab's section list from it (`sectionsOf`) and bakes both as
`NAV` for core.js. `page.hideTabs` semantics (resolved by `resolveNav`): a top-level key
(`home`/`entreno`/`health`/`nutricion`) removes that nav button; a section key (`hoy`/`load`/
`calendar`/`sessions`/`dash`/`dia`/`registro`/`tablas`) renders that section `hidden`. Panels,
sections, baked globals and scripts always stay in the build. Nutrición and Entreno are made ONLY of
sections (they carry `sections` in `resolveNav`): each disappears when ALL its sections are hidden —
hiding `dash` alone hides only the dashboard, Entreno stays; the visible tab on load is the first remaining one;
hiding every tab fails the build. `setTab('<legacy key>')` still works (it opens the hosting tab and
scrolls to the section — `setTab('dash')` opens Entreno). The train/rest toggle is marked `data-off`
when only Tablas is left (`showDayToggle`), and the "today you eat" card drops its link when
Nutrición is hidden.
Taps (core.js `jumpOr`, falling back to the tab when the target has no data; nothing is a link when
its tab is hidden): sleep dial → Salud `#hl-sleep`; recovery dial → Salud `#hl-recovery`; load dial
→ Entreno `#score-load`; a health-monitor card → its Salud trend (`#hl-rhr` / `#hl-hrv` /
`#hl-respiratory` / `#hl-wristTemp` / `#hl-sleep`); a timeline row → `#hl-sleep` (sleep) or
`#score-load` (a workout). The detail cards themselves are not links.

**Look & typography.** Dark, data-first design language: colour carries meaning, never decoration.
All colours are tokens in `web/src/styles/tokens.css` (AA-checked ratios listed in its header):
`--good`/`--mid`/`--low` = state, `--trend` = neutral data lines/sparklines, `--strain` = load,
`--sleep` = sleep, `--accent` = ACTIONS only (buttons, links, active nav, focus). Headings and
labels are caps, semibold, `--label-track` (+0.08em). Numbers use `--num` = "HC Num", a
numerals-only subset (~1.5 KB: digits, + - , . % × h space) of **D-DIN Bold, SIL OFL 1.1**, inlined as
a base64 `@font-face` by `web/layouts/Plan.astro` (`?inline` import) so the page stays one file with
zero font requests. The OFL forbids the Reserved Font Name "D-DIN" on a modified version, so the
subset is renamed; licence text in `web/src/fonts/OFL.txt`. Rebuild it with
`python3 scripts/subset-num-font.py D-DIN-Bold.ttf` (needs `fonttools` + `brotli`); the output guard
test pins that the committed woff2 is what gets inlined and stays under a 40 KB budget. Text stays
the system sans stack (0 bytes). Never embed a commercial font or copy another product's name,
logo, icons or exact brand hex values.

## Nutrition plan — data pipeline & published artifact

**Two files, merged in memory (by both `generate.js` and the Astro build, from the same
`lib/nutrition/macros.mjs`):**
- `data/nutrition/ingredients.json` (TRACKED, **public** food DB) — the reusable
  `{ "ingredients": { … } }` of per-100 g/ml/ud base foods (`verified:true` = real product
  label, `false` = DB estimate; each carries `name` + `note`). This is shareable and is the
  one piece of the plan that goes public. It may hold MORE foods than any single plan uses.
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

**Intake rings (top of Mi día).** `lib/nutrition/intake.mjs` bakes the most recent LOGGED day of
`dietary-daily.csv` (kcal > 0) plus the plan's train/rest day totals (the same numbers Mi día
shows); `web/src/client/intake.js` draws four rings (kcal, protein, carbs, fat) against the target
of the day type picked in the train/rest toggle. The rings show ONLY when that day is within the
last 3 days of the viewer's clock (decided client-side, so builds stay byte-identical); otherwise
an empty state says how to enable them (a food app that writes nutrition to Apple Health + the
Shortcut `diet_kcal`/`diet_protein`/`diet_carbs`/`diet_fat` keys, which sync folds into one
`dietary-daily.csv` row per day, export rows winning). A ring never fills from the target: a macro
missing on the logged day renders an empty ring with a dash. When the logged day is the viewer's
today it is labelled as in progress ("Hoy, en curso" / "Today, so far"), so partial rings are not
read as a finished day. When NO intake was ever logged (`INTAKE.latest` null, decided at build
time), the rings and Registro collapse to ONE line: Mi día renders no rings host and the Registro
fold summary carries the hint (`noneHtml`); with Registro hidden, intake.js writes that line at the
top of Mi día instead.

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
Apple Health uses, so they land in the same `bike` bucket. Accepted limitations: date-level
precedence means a Strava-only activity on a date that ALSO has an Apple Health export row is
dropped (never double-counted, but a mixed day can lose a Strava-only session); a Strava activity
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
expenditure's is the newest day's TDEE (`tdeeLatest`). Each recovery trend carries an `hl-<key>`
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
  AND the macro split are shown ONLY when ≥7 logged days exist in the recent window; otherwise
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
- **Recovery** — `rhr.csv`, `hrv.csv` (averaged per day), `vo2max.csv`, `sleep-daily.csv`,
  `respiratory-daily.csv`, `wristTemp.csv`, `walking-hr-daily.csv`. Good directions stated on
  screen (↓ resting/walking HR, ↑ HRV, ↑ VO₂max; respiratory & sleeping wrist temp are change-
  not-absolute signals). Sleep adds CONSISTENCY: % of nights ≥ `SLEEP_TARGET` (7.5 h), night-to-
  night spread (sd), and bedtime/wake-time regularity (median ± sd in minutes; after-midnight
  bedtimes wrapped onto a night scale). Sleep bedtime/waketime come from the extended
  `sleep-daily.csv` (extract.js emits earliest asleep start / latest end per night). Sleep renders
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
  are ≥ 7 composite days in the last 14.
- **Load** is PER MODALITY (gym / run / bike; `other` is shown raw, never scored) and Relative-Effort-only
  (Strava `suffer_score`; Apple rows have no RE and are counted as `unscored`). Same-day rows follow
  the shared rule below (junk dropped, one source, then SUM). The series starts at the first date with any RE
  (`reEpoch`); acute 7d vs chronic 42d EWMA; a modality gates ("baselineBuilding") under 28 days since the
  epoch, under 8 non-zero days, or chronic < 1. The 0-100 `relScore` exists only within a modality.
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
  ±`BAND_CUTOFF`, with a "no data for last night" note), centre = short band word + signed value in
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
  time, the workouts dashboard and the running/cycling tables (the key is the reader's modality
  bucket). Per (date, key): drop invalid rows (`dur <= 0`); then the short-row filter depends on the
  reader — LOAD scoring (default) drops junk (`isJunk`: `dur <= 11` AND `re` null or ≤ 2), while the
  DISPLAY readers (timeline, calendar/cumulative, dashboard, run/ride tables) pass `DISPLAY_RULE` and
  drop only stubs (`isStub`: `dur < STUB_MAX_MIN` = 3, accidental Watch starts) — Watch rows and no-HR
  Strava rows have `re` null by design, so the junk rule would hide real 9-10 min sessions from the
  pages that list sessions (they still add no load); when a Strava row (`source` "Strava API" or
  legacy "Strava") AND a Watch row exist for the same date and key, and the Strava rows' total
  duration is ≥ `SUPERSEDE_MIN_COVERAGE` (0.5) × the Watch rows' total, keep ONLY the Strava rows
  (they carry RE / elevation / kJ) instead of summing a double-counted session — sync:strava's
  date-level precedence should prevent the pair but has known holes; below that coverage the rows
  are most likely different sessions and both are kept; the load coverage counts superseded rows as
  `superseded`; then
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
