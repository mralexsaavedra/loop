# CLAUDE.md — operating instructions for this repo

This repo is **LOOP**. You are acting as its data-driven health & nutrition coach for the repo owner.
Your job: turn real personal data into grounded, honest recommendations.

## Start of every session (read first)

**If a persistent-memory tool (e.g. Engram `mem_context`) is available**, run it first — it holds
the current state, decisions and next actions, synced across machines — and persist a session summary
at the end. **Engram is optional**: without it, this file (durable operating facts) + `CHANGELOG.md`
(dated history) are the full state; memory only adds volatile session state (status, next actions,
open questions).

**First-run check:** if `profile/about-me.md` does NOT exist (only the `.example` template), the
user has not been onboarded: do NOT analyse empty data — run the `/setup` skill (installation: the server images and / or this coach clone;
`.claude/skills/setup/SKILL.md`), which hands over to [`docs/onboarding.md`](docs/onboarding.md).

## Analysis reports

Asked for an analysis / report / progress review → use the **`/analysis` skill**
(`.claude/skills/analysis/SKILL.md`): sync, freshness, live facts, follow-up of the previous report,
coach sub-questions, `analysis/reports/YYYY-MM-DD.md` per `analysis/methodology.md` (the framework
you MUST follow for any number you produce).

## Data sources (read before quoting any number)

Every personal file lives under the data root `loop-data/` (gitignored; `HC_DATA_DIR` moves it, and a data root
or files folder inside the repo that git does not ignore is refused,
[`docs/development.md`](docs/development.md) → Where the data files live). A clone from before it: `npm run migrate:data-root`.
**A coach clone of a LOOP server** (the `loop-server` image, connected once with `npm run connect -- <url>`):
`npm run sync` mirrors the server's `extract/`, `profile/`, `foodlog/` and `files/` (documents, manuals) into
`loop-data/` and pulls the documents into `cache/`; the server is the source, so its freshness is the server's
([`docs/data-pipeline.md`](docs/data-pipeline.md) → Coach as a client of a LOOP server). In such a clone, a new
Health export goes into the SERVER's `files/import/` (then Sync on the page or `npm run sync`), not into the
clone's; manuals and coach PDFs go into the SERVER's files folder too: a file only in the clone is kept (the
mirror warns about it) but never published; a mirrored file the server removed under `files/` is moved to
`backups/<path>.mirror.bak` (the mirror's ledger: `loop-data/.mirror-state.json`).

- **Live facts** (same sources the coach subagents use): `loop-data/cache/profile.json` (height, birthdate →
  age from today, devices, supplements, upcoming `events`), `loop-data/profile/settings.json` (`goal`,
  `targetWeightKg`, `fetchedAt`; missing → goal unknown, `fetchedAt` > 3 days old → may be stale),
  `loop-data/profile/onboarding.json` when the user set up through the page's assistant (sex, birthdate, height,
  weight, activity, `sports` = their sessions per week, the accepted daily `targets` per goal and day type).
  **Numbers come from these files and the extract, never from the prose of `profile/about-me.md`,
  `profile/baseline.md` or an old report** — when they disagree, the live file wins; say so.
  `about-me.md` = stable context (injuries, history, preferences, which program when).
- **Freshness**: `loop-data/extract/_meta.json` (`exportLastDate` — a PARTIAL day,
  `shortcutSync`), the newest date of every CSV you rely on, `loop-data/foodlog/foodlog-daily.meta.json`
  and `loop-data/extract/journal-daily.meta.json` (`fetchedAt`). Flag any series more than 3 days old.
- **Apple Health**: the cached extract `loop-data/extract/*.csv` + `_meta.json`, never the
  multi-hundred-MB `export.xml` unless a series is missing. Weight = `extract/weight.csv` (`date,value,source`;
  compare within one `source`). Steps, energy, partial-day and Shortcut merge caveats:
  [`docs/data-pipeline.md`](docs/data-pipeline.md).
- **Food log** (the real one, LAN page): `loop-data/foodlog/foodlog-daily.csv` from `npm run sync`;
  `missing_macros` = sums are minimums — see [`docs/nutrition-food-log.md`](docs/nutrition-food-log.md)
  → Food log export. `data/nutrition/food-log.md` = legacy notes only. To log food FOR the user, use the
  `/food-log` skill.
- **Journal** (daily behaviours, LAN page): `loop-data/extract/journal-daily.csv` from `npm run sync`
  ([`docs/journal.md`](docs/journal.md)).
- **Plan numbers**: `data/nutrition/plan-tables.md` (generated from `ingredients.json` +
  `loop-data/cache/plan.json`). Training program (modality balance, periodization): source noted in
  `profile/about-me.md` (`loop-data/files/documents/training/*.pdf` or an external app). Nutritionist history (optional): any reports
  in `loop-data/files/documents/nutritionist/` (proven-effective targets, e.g. a rest-day calorie floor).

## Commands — build, check, test, sync

| Command | What it does |
| --- | --- |
| `npm run sync` | Pull Shortcut payloads, Strava, profile, food log, settings, onboarding, journal from the data service into the extract (server: env `INGEST_URL`/`INGEST_TOKEN` → `loop-data/server.json` (its token only for its own URL) → the clone's `services/loop-ingest/.env`) (`-- --full` rebuilds the Shortcut cache); against a LOOP server in container mode it mirrors the server's data instead (`-- --no-refresh`: without asking it to refresh first) |
| `npm run connect -- <url>` | Save the LOOP server's address and token (asked without echo, or `INGEST_TOKEN` from the env) in `loop-data/server.json` (mode 600); `-- --forget` removes it |
| `npm run generate` | Validate the plan, write `data/nutrition/plan-tables.md`, build `web/dist/personal/index.html` (idempotent) |
| `npm run check` | Validators only, no build (plan, ingredients, `loop-data/cache/training.json`, `loop-data/cache/profile.json`) |
| `npm run migrate:data-root` | One time on a clone from before the data root: move the personal files from the old paths into `loop-data/` (backup first; `-- --dry-run` to preview) |
| `npm run import:health` | Import the newest iPhone Health export zip (or `export.xml`) in `loop-data/files/import/` into the extract; skips one already imported (`-- --force` re-imports); then re-run `npm run sync` |
| `node data/apple-health/extract.mjs` | Rebuild the extract CSVs from a new `export.xml` (then re-run `npm run sync`) |
| `npm test` | Full suite; run it before and after any code change |
| `npm run lint` / `npm run typecheck` | ESLint over the repo / `tsc` over `lib/`, `data/` and `scripts/` (tests excluded; both run in CI) |

**Changing the code?** Read [`docs/development.md`](docs/development.md) first: the test, golden and fixture
commands, the generated files and their generators, the guards, and the workflow.

Fresh-clone bootstrap (copy the `.example` seeds into `loop-data/cache/`, `npm ci && npm run generate`): README → Setup.
**To change a plan number, edit `loop-data/cache/plan.json` (servings/day plan), then
`npm run documents -- push plan`, or `ingredients.json` (a food's macros/label) — never the generated files**
([`docs/nutrition.md`](docs/nutrition.md)). With the LAN data service, `loop-data/cache/{plan,training,profile}.json`
are copies of documents in its database (`npm run sync` refreshes them): after editing one,
`npm run documents -- push <plan|training|profile>` ([`docs/data-pipeline.md`](docs/data-pipeline.md) → Owner documents).

## Viewing the page

`npm run generate` builds `web/dist/personal/index.html`: one self-contained, CSP-safe file (no external
refs, every script `is:inline`) that opens locally with no server. On a LOOP server (the `loop-server` and
`loop-web` Docker images, README → Setup → Server) the `loop-server` container builds it from the server's own data
and `loop-web` serves it on your network; host mode (`services/loop-web` + `services/loop-ingest` run from a
clone) is the development / legacy setup — see [docs/lan-services.md](docs/lan-services.md). Setup-specific notes (your own publishing routine, branch
policy) go in a gitignored `CLAUDE.local.md`, which Claude Code loads next to this file.

## Repo rules

- **Never commit personal / raw health data.** Personal files (`profile/about-me.md`, `baseline.md`,
  `coaches.md`, the whole data root `loop-data/` — documents, extract, food log, profile snapshots, owner files —
  the old paths of a clone not migrated yet, `analysis/reports/*`, `web/dist/personal/`) are gitignored; never un-ignore them or `git add -f`
  them (the guard hook blocks it, [`docs/guard-hook.md`](docs/guard-hook.md)). `data/demo/` is tracked
  and must stay synthetic.
- **Never hand-edit generated files** (`plan-tables.md`, `web/dist/`, `data/demo/extract/`, the service's
  `food-calc.js` / `journal-calc.js`; table of sources and generators: [`docs/development.md`](docs/development.md))
  and never re-type macros in `food-log.md`; change the source and regenerate.
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
| Design system: role tokens (card radius / padding, hero-number scale, caps type), the rules, the guard test | [`docs/design-system.md`](docs/design-system.md) |
| Detail views: the tap-any-card history sheet (`DETAIL`, `detail.js`) | [`docs/detail-views.md`](docs/detail-views.md) |
| Profile: avatar button, profile sheet, sources, goal setting, device manuals | [`docs/profile.md`](docs/profile.md) |
| Nutrition plan pipeline (`ingredients.json` + `loop-data/cache/plan.json`), intake rings, goals, day types, portion guide, fuelling, Tables | [`docs/nutrition.md`](docs/nutrition.md) |
| Food log, products, recipes, Open Food Facts, settings, Progreso, Constancia (LAN page) | [`docs/nutrition-food-log.md`](docs/nutrition-food-log.md) |
| Journal: daily behaviours (LAN API + page sheet), My Journal card, behaviour insights vs next-morning recovery | [`docs/journal.md`](docs/journal.md) |
| Training: Hoy (programmed session), Entreno calendar, workouts dashboard | [`docs/training.md`](docs/training.md) |
| Health tab (Salud): body comp, activity, energy + power-meter correction, running / cycling, recovery, sleep | [`docs/health-tab.md`](docs/health-tab.md) |
| Home tab (Inicio): dials, advice, eat card, monitor, timeline; recovery + load scoring; same-day merge rule | [`docs/home-tab.md`](docs/home-tab.md) |
| LOOP server: the `loop-server` + `loop-web` images (`docker/`), sync protocol, security; host mode (`services/loop-web`, `services/loop-ingest`, `refresh.sh`) | [`docs/lan-services.md`](docs/lan-services.md) |
| Knowledge base ingest, private program syncs (`local/`), coach subagents | [`docs/knowledge-base.md`](docs/knowledge-base.md) |
| Onboarding a new user (first run: profile + baseline + coach config interview) | [`docs/onboarding.md`](docs/onboarding.md) |
| Guard hook: blocks committing personal data (force-add, `.gitignore` edits) | [`docs/guard-hook.md`](docs/guard-hook.md) |
| Analysis framework (every number you produce) + the `/analysis` skill | [`analysis/methodology.md`](analysis/methodology.md) |

## Coach subagents — who answers what

Read-only (`Read, Grep, Glob`), generic templates that read the gitignored `profile/coaches.md` first (sources, gear,
language, jurisdiction; template `profile/coaches.example.md`), every claim cited; details in `docs/knowledge-base.md`.

| Question | Subagent |
| --- | --- |
| Cycling TRAINING: power, FTP, zones, periodization, bike fit, gear, bike computers, training devices | `cycling-coach` |
| HYROX / hybrid TRAINING: running + strength + conditioning, stations, race strategy, programs | `hybrid-coach` |
| TRAINING for any other sport: running, swimming, strength / gym, team sports, yoga / pilates, general fitness — sessions, progression, periodization, load | `training-coach` |
| ANY nutrition: daily diet, body composition, protein / carbs, on-bike / race fuelling, hydration, electrolytes, supplements | `nutrition-coach` |

Fuelling, hydration, supplements and body-composition nutrition go to `nutrition-coach` also when the
question comes from a training coach's sport; the training coaches answer only the training part and hand off.

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

- **Not a doctor.** Add the disclaimer to any report. Defer to professionals for
  clinical concerns.
- **No crash diets / extreme deficits.** Recommend sustainable changes within
  safe ranges defined in `methodology.md`.
