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
   paste/screenshot the sessions), see `docs/training.md` — then
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
     type ONE source wins and only its sum is written, never a sum across sources. The export's LAST
     date is a PARTIAL day (`_meta.json` `exportLastDate`); daily totals skip it. Between exports,
     `npm run sync` merges iOS Shortcut payloads (export rows win; re-run sync after `extract.js`).
     Full source precedence, partial-day and Shortcut merge rules: `docs/data-pipeline.md`; the
     Shortcut itself and every payload key: `docs/ios-shortcut.md`.
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
     Read it for any plan number; to CHANGE one, see "Commands" below and `docs/nutrition.md`.
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

## Commands — build, check, test, sync

| Command | What it does |
| --- | --- |
| `npm run generate` | Validate the plan, write `data/nutrition/plan-tables.md`, build `web/dist/personal/index.html` (idempotent) |
| `npm run check` | Validators only, no build (plan, ingredients, `training-data.json`, `profile/profile.json`) |
| `npm test` | Full suite (`node --test`); `pretest` builds the example (+ personal, if present) fixtures |
| `npm run build:example` | Example page from the tracked seeds + the synthetic demo extract (`data/demo/`), no personal files |
| `npm run sync` | Pull Shortcut payloads, Strava, profile, food log, settings from `services/health-ingest` into the extract (`-- --full` rebuilds the Shortcut cache) |
| `node data/apple-health/extract.js` | Rebuild the extract CSVs from a new `export.xml` (then re-run `npm run sync`) |
| `node scripts/build-web.mjs [--mode personal\|example] [--locale es\|en]` | Build one page variant into `web/dist/<mode>/index.html` |

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

## Publishing the artifact

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

## Repo rules

- **Never commit personal data.** Personal files (`profile/about-me.md`, `baseline.md`, `profile.json`, `plan-data.json`,
  `training-data.json`, the extract, `data/profile/*`, `web/dist/personal/`, `artifact.local.md`) are
  gitignored; never un-ignore them or `git add -f` them. `data/demo/` is tracked and must stay synthetic.
- **Never hand-edit generated files** (`plan-tables.md`, `web/dist/`, `data/demo/extract/` — re-run
  `npm run demo:data`); change the source (the JSONs, the generator) and regenerate.
- **`knowledge/` is gitignored** except `knowledge/README.md` (third-party transcripts, personal use):
  never commit, publish or `git add -f` it.
- **Before changing an area, read its doc in `docs/`; keep the doc in sync with the code in the same
  commit.** Dated history goes to `CHANGELOG.md`, not to the docs or this file.
- **Backups of personal files** go to `backups/<same path>.<label>.bak` (gitignored), never next to the
  original; keep only the newest one per file.

## Architecture map

One line per area; the design detail lives in the linked doc (read it on demand).

| Area | Doc |
| --- | --- |
| Apple Health extract, iOS Shortcut sync, Strava sync, `rides.csv` | [`docs/data-pipeline.md`](docs/data-pipeline.md) |
| iOS Shortcut: how to build it, every payload key | [`docs/ios-shortcut.md`](docs/ios-shortcut.md) |
| Plan page: Astro single-file build, shared client helpers, tabs & sections, URL hash, look & typography | [`docs/plan-page.md`](docs/plan-page.md) |
| Detail views: the tap-any-card history sheet (`DETAIL`, `detail.js`) | [`docs/detail-views.md`](docs/detail-views.md) |
| Profile: avatar button, profile sheet, sources, goal setting, device manuals | [`docs/profile.md`](docs/profile.md) |
| Nutrition plan pipeline (`ingredients.json` + `plan-data.json`), intake rings, Nutrición v2 part 1 (goals, day types, portion guide, fuelling, Tablas) | [`docs/nutrition.md`](docs/nutrition.md) |
| Nutrition v2 parts 2–3: food log, products, recipes, Open Food Facts, settings, Progreso, Constancia (LAN page) | [`docs/nutrition-food-log.md`](docs/nutrition-food-log.md) |
| Training: Hoy (programmed session), Entreno calendar, workouts dashboard | [`docs/training.md`](docs/training.md) |
| Health tab (Salud): body comp, activity, energy + power-meter correction, running / cycling, recovery, sleep | [`docs/health-tab.md`](docs/health-tab.md) |
| Home tab (Inicio): dials, advice, eat card, monitor, timeline; recovery + load scoring; same-day merge rule | [`docs/home-tab.md`](docs/home-tab.md) |
| LAN page + on-demand refresh: `services/plan-web`, `services/health-ingest`, sync protocol, security | [`docs/lan-services.md`](docs/lan-services.md) |
| Knowledge base ingest, Hyprogram sync, coach subagents | [`docs/knowledge-base.md`](docs/knowledge-base.md) |
| Analysis framework (every number you produce) | [`analysis/methodology.md`](analysis/methodology.md) |

## Coach subagents — who answers what

Read-only (`Read, Grep, Glob`), Spanish by default, every claim cited; details in `docs/knowledge-base.md`.

| Question | Subagent |
| --- | --- |
| Cycling TRAINING: power, FTP, zones, periodization, bike fit, gear, Garmin Edge, EMS suit | `cycling-coach` |
| HYROX / hybrid TRAINING: running + strength + conditioning, stations, race strategy, programs | `hybrid-coach` |
| ANY nutrition: daily diet, body composition, protein / carbs, on-bike / race fuelling, hydration, electrolytes, supplements | `nutrition-coach` |

Fuelling, hydration, supplements and body-composition nutrition go to `nutrition-coach` also when the
question comes from cycling or HYROX; the training coaches answer only the training part and hand off.

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
