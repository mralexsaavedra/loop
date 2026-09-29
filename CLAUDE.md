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
   `npm run generate`). The 🏋️ Hoy tab then shows today's programmed session and the
   📈 Entrenos dashboard fills itself from the Apple Health workouts already extracted in
   step 4. Don't block onboarding on this — profile + baseline are enough to start.
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
     devices double-counts — that is why an earlier "15–18k" NEAT figure was inflated).
     Between exports, `npm run sync` (`data/apple-health/sync-shortcut.js`) pulls iOS Shortcut
     payloads from the optional `services/health-ingest` service (`GET /export/raw`) and merges
     hrv/rhr/vo2max/weight/bodyfat/leanmass/steps/energy/sleep/respiratory/walking-HR/wrist-temp/
     hr-recovery into those CSVs: export rows always win,
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
   - Nutritionist history: `data/nutritionist/` — 2023 anthropometric assessments +
     nutrition plans, and `RESUMEN-y-comparativa.md`. Reference for proven-effective
     targets (e.g. the rest-day calorie floor the owner lost fat on).
3. **Analyze per methodology.** Use trends (rolling averages), not single-day noise.
   Compare against previous reports in `analysis/reports/` to track progress.
4. **Write a report** to `analysis/reports/YYYY-MM-DD.md` and summarize the key
   findings + actions in chat.

## The plan page — Astro single-file build

The plan page (all 6 tabs: Mi día, Registro, Tablas, Hoy, Entrenos, Salud) is ONE Astro project
in `web/` that builds to a single self-contained HTML file — no external requests, no
`_astro/` asset directory, CSP-safe. `scripts/build-web.mjs` drives the build:

```
node scripts/build-web.mjs [--mode personal|example] [--locale es|en]   # or DATA_MODE/LOCALE env vars
```

writing `web/dist/<mode>/index.html`. `npm run build` = personal/es (default); `npm run
build:example` = example/en (tracked seeds only, no personal files needed). All pure compute
(macros, training program/dashboard, health aggregation) lives in root `lib/*.mjs`, shared by
the Astro build, `data/nutrition/generate.js`, and the test suite — one source, not three.

- `LOCALE`: env var → `plan.locale` → `en` (the owner's `plan-data.json` sets `locale:"es"`).
- `DATA_MODE=personal|example`: personal reads the gitignored real files; example reads the
  tracked `.example` seeds. Optional data (Apple Health extract CSVs) renders a defined empty
  state when absent, in either mode — the build never fails on missing optional data.
- All personal COPY (page title/kicker/h1/sub/footer, per-slot notes, which nav tabs to hide)
  lives in `plan-data.json`'s `page` block (`page.notes.<slotId>`, `page.hideTabs: ["hoy"]`,
  etc.) — never hardcoded in tracked Astro/JS source, which stays fully generic.

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
the tracked seeds alone — no copying, no personal files, useful to sanity-check the pipeline
on a bare clone.

**To change a plan number, edit `plan-data.json` (servings/day plan) or `ingredients.json`
(a food's macros/label) — never the generated files.**

Run `npm run generate` (or `node data/nutrition/generate.js && node scripts/build-web.mjs`) to
regenerate (idempotent): validates the plan, writes `plan-tables.md` (incl. the Legumes and
Verified product labels tables), then builds `web/dist/personal/index.html`. **Never**
hand-edit `plan-tables.md`, `web/dist/`, or re-type macros in `food-log.md` — the source is
the two JSONs.
- `npm run check` — validators only, no build: `generate.js --check` (unknown-ingredient
  refs, day totals, Atwater, ambiguous matches) + `build-web.mjs --check` (training-data.json
  integrity). Ingredients defined in `ingredients.json` but unused by the current plan are a
  non-fatal WARNING (expected for a shared DB), not an error.
- `npm test` — the full test suite (`node --test`, zero deps beyond `astro`). `pretest`
  builds the example (+ personal, if present) fixtures the web/ tests read.

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

The same single-file build carries two training tabs, computed by `lib/training/program.mjs`
(programmed sessions) and `lib/training/dashboard.mjs` (executed-workout aggregation) and
rendered by `web/src/tabs/{Hoy,Entrenos}.astro`. Same single-source pattern as nutrition.

**🏋️ Hoy / Today — programmed session.** Source: `data/training/training-data.json`
(GITIGNORED, personal) — the programmed sessions keyed by ISO date (`days["YYYY-MM-DD"]`);
a date with no entry renders as a rest / unprogrammed day. The build bakes it into a page-level
JSON global; the page picks "today" client-side with `new Date()`. The artifact is a frozen
snapshot, so the baked program must cover the current date — regenerate + re-publish when a
new block lands. NOTE: program files are often exported/named by a training partner, not the
coach — never infer the coach's identity from a filename; take it from `profile/about-me.md`.

**The Hoy tab is optional and source-agnostic.** The program can come from any dated source
(coach PDFs, a spreadsheet, or a login-gated training app whose content can't be scraped). If
the owner's program lives in an external app they open directly, maintaining a dated copy here
is redundant — set `page.hideTabs: ["hoy"]` in `plan-data.json` to omit the nav button (the
tab panel + baked training data stay fully wired, just unreachable via nav; remove the entry
to reactivate). Keep the tab visible in the example build (`plan-data.example.json` has no
`hideTabs`) as a working example. Which program/app the owner actually uses is personal → it
lives in `profile/about-me.md` (gitignored), never in a tracked file.

**📈 Entrenos / Workouts — executed-sessions dashboard.** Source (OPTIONAL):
`data/apple-health/extract/workouts.csv`. `lib/training/dashboard.mjs` aggregates it
(frequency, weekly volume, modality split). If the CSV is absent (fresh clone), the tab
shows an empty state — it never fails the build. Data-honesty rules are baked in: use DURATION
not kcal (blank on recent exports); count DISTINCT DAYS not raw rows (the Watch fragments one
session into several records); the modality split (strength/hiit/run/other) reflects the
WATCH's auto-labels, which over-tag HIIT and under-count strength — the page says so on-screen.

**Source of the program:** whatever the owner's coach/app provides — a coach PDF, a spreadsheet,
or a login-gated training app. For a source that can't be fetched (a login-gated app), the owner
pastes/screenshots the sessions and you transcribe into `training-data.json`. For PDF grids in
`data/training/*.pdf` (spreadsheet-style weekly grids), transcribe by rendering pages to PNG
(`pdftoppm -png -r 130`) and reading the grid visually (`pdftotext` interleaves the day columns).

**Fresh-clone bootstrap:** copy `data/training/training-data.example.json` →
`training-data.json`, edit in the real program, then `npm run generate` (part of the shared
nutrition bootstrap above — one `npm run generate` builds all 6 tabs together). `npm run
check` validates training-data.json too (`build-web.mjs --check`); `npm test` covers the
training lib with its own unit tests plus the build-output/i18n/hide-tabs integration tests.

## Health tab — "Salud / Health" body & recovery pipeline

`lib/health/{read,stats,aggregate}.mjs` (same single-source pattern) compute the Salud tab's
FIVE stacked sections from the Apple Health extract CSVs (all OPTIONAL — absent CSVs render an
empty state, never fail the build); `web/src/tabs/Salud.astro` + `web/src/client/health.js`
render it.

- **Body composition** — `weight.csv` + `bodyfat.csv` + `leanmass.csv`. Weight trend is a 7-day
  rolling average (it mixes scales/apps, so the raw series is noisy). Body fat and lean mass use
  ONLY the most recent source and are flagged bioimpedance ±3–5%. IMPORTANT: the source tag does
  NOT isolate a scale switch (the same app re-tags an old scale's readings — e.g. 22.8%→14.7%
  overnight in Nov 2025), so their Δ + sparkline use only the last `BODYCOMP_WINDOW` (150) days
  to avoid celebrating that artifact as real change.
- **Activity (NEAT + movement)** — `steps-daily.csv` (NEAT), `exercise-minutes-daily.csv`,
  `distance-daily.csv`, `flights-daily.csv`. Each is a daily total → 30-day average, Δ vs the
  prior 30 days, 7-day rolling sparkline (generic `dailyTrend`). All four are deduped
  max-per-device by extract.js (iPhone + Watch overlap → summing double-counts, like steps);
  near-zero step/distance days (device not carried) are dropped as missing data.
- **Energy** — `active-energy-daily.csv` + `basal-energy-daily.csv` give expenditure (TDEE,
  7-day rolling); `dietary-daily.csv` gives intake AND the macro split (protein/carbs/fat, g + %
  kcal). Data honesty: intake logging is sparse and abandoned, so the balance (deficit/surplus)
  AND the macro split are shown ONLY when ≥7 logged days exist in the recent window; otherwise
  the page shows expenditure alone and says intake can't be scored. Implausible basal readings
  (double-counts / no-wear) are dropped via a sane band.
- **Running** — `running-daily.csv` (RunningSpeed/Power/GroundContactTime/VerticalOscillation/
  StrideLength, per-day means over a run's samples). Coverage is SPARSE (only days with a watch-
  tracked run), so this renders as a RECENT-SESSIONS table (newest first, pace = 60/speed,
  power, GCT, vertical osc, stride), NOT a trend — and says how many sessions exist. Sub-5 km/h
  rows (walks / GPS garbage) are dropped.
- **Recovery** — `rhr.csv`, `hrv.csv` (averaged per day), `vo2max.csv`, `sleep-daily.csv`,
  `respiratory-daily.csv`, `wristTemp.csv`, `walking-hr-daily.csv`. Good directions stated on
  screen (↓ resting/walking HR, ↑ HRV, ↑ VO₂max; respiratory & sleeping wrist temp are change-
  not-absolute signals). Sleep adds CONSISTENCY: % of nights ≥ `SLEEP_TARGET` (7.5 h), night-to-
  night spread (sd), and bedtime/wake-time regularity (median ± sd in minutes; after-midnight
  bedtimes wrapped onto a night scale). Sleep bedtime/waketime come from the extended
  `sleep-daily.csv` (extract.js emits earliest asleep start / latest end per night).

Trends render as inline SVG sparklines (CSP-safe). The build is idempotent — no today-relative
values are baked (staleness is computed client-side from the data dates). Aggregation lives in
pure functions (`aggBody`/`aggActivity`/`aggEnergy`/`aggRunning`/`aggRecovery` + helpers
`dailyTrend`/`signalTrend`) so the test suite injects synthetic series without touching disk. The
personal (`LOCALE=es`) build is localized to Spanish (es-ES dates, comma decimals); the example
(`LOCALE=en`, `web/src/i18n/en.mjs` + `*-templates.mjs` en dicts) build is English.

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
