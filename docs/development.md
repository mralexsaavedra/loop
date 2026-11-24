# Development

How to change the code safely: the commands, the tests and the guards that keep the page correct and personal
data out of git. Using the project rather than changing it? Start at the [documentation index](README.md).

## On this page

- [Setup](#setup)
- [Commands](#commands)
- [Tests](#tests)
- [Generated files](#generated-files)
- [Where the data files live](#where-the-data-files-live)
- [Guards](#guards)
- [Workflow](#workflow)
- [Releasing](#releasing)
- [Contributor-only tools](#contributor-only-tools)

## Setup

Node `>=22.12` (`package.json` → `engines`), then `npm ci`. `npm test` needs no personal data: it builds the
example page from the tracked seeds and the synthetic demo extract (`data/demo/`). The data service has its own
suite and dependencies (`npm run test:services`). The browser end-to-end tests (`npm run test:e2e`) need
Playwright's browsers once: `npx playwright install chromium webkit` (on a bare Linux also their system libraries,
`npx playwright install-deps chromium webkit` as root).

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Full suite (`node --test`); `pretest` builds the example (+ personal, if present) fixtures |
| `npm run test:services` | The `services/loop-ingest` suite (not part of `npm test`, which stays dependency-free): `npm ci` there from its lockfile, then its `node --test`, then `npm run typecheck:services` |
| `npm run typecheck:services` | TypeScript over `services/loop-ingest/src` (tests excluded) with the same rules as `typecheck` ([`services/loop-ingest/jsconfig.json`](../services/loop-ingest/jsconfig.json) extends the root one); it needs the service's own dependencies (`pg`), so `test:services` runs it after its `npm ci` |
| `TEST_DATABASE_URL=postgres://… npm run test:pg` | The data service against a real Postgres (`services/loop-ingest/test/pg/`): the real migrations on a fresh empty database per file, the ledger + lock, the main DB paths. Needs a Postgres 17 where the user may `CREATE DATABASE` (a throwaway `docker run --rm -e POSTGRES_PASSWORD=x -p 127.0.0.1:5544:5432 postgres:17-alpine` does); without the variable the tests skip. CI runs it in the `postgres` job |
| `npm run test:e2e` | Browser end-to-end tests (Playwright + Chromium, [`playwright.config.mjs`](../playwright.config.mjs)): builds the example page into `web/.e2e-dist/` and runs `e2e/` on a phone and a desktop viewport — [Browser end-to-end tests](#browser-end-to-end-tests). `-- --project static-phone`, `-- -g "<title>"` and `E2E_SKIP_BUILD=1` (exactly `1`: reuse the last build) narrow a run |
| `npm run check` | Validators only, no build (plan, ingredients, `loop-data/cache/training.json`, `loop-data/cache/profile.json`) |
| `npm run lint` | ESLint over the whole repo ([`eslint.config.mjs`](../eslint.config.mjs)): correctness rules only (unused / undefined names, redeclarations, useless assignments), never formatting; CI runs it |
| `npm run typecheck` | TypeScript over `lib/**/*.mjs`, `data/**/*.mjs` and `scripts/*.mjs` (tests excluded) as JavaScript, then the page's module scripts `web/src/client/*.ts` with `strict` ([`web/src/client/tsconfig.json`](../web/src/client/tsconfig.json); docs/plan-page.md → Module scripts); the JavaScript part ([`jsconfig.json`](../jsconfig.json), `checkJs`, no emit): a wrong property, argument count or shape fails; the folders listed in [`jsconfig.strict.json`](../jsconfig.strict.json) are checked again with `strict` (every parameter typed, `null` checked; the list grows a layer at a time until `jsconfig.json` itself is strict); types come from JSDoc (`@param`, `@type`, `@returns`), never `// @ts-ignore`; the shared domain shapes are `@typedef`s next to their vocabulary (`lib/nutrition/foodlog.mjs`: Macros, Product, Ingredient, Recipe, LogEntry, their unions derived from `FOOD_UNITS`, `FOOD_MEALS`…; `lib/profile/onboarding.mjs`: OnboardingProfile); CI runs it |
| `npm run build:example` | Example page from the tracked seeds + the synthetic demo extract, no personal files |
| `node scripts/build-web.mjs [--mode personal\|example] [--locale es\|en] [--outdir <dir>] [--check]` | Build one page variant into `web/dist/<mode>/index.html` (`--help` for the flags) |
| `npm run test:css:update` | Regenerate `web/test/fixtures/css-expected.json` from the example build after a deliberate CSS change (keeps key order, appends new, drops stale; `-- --check` writes nothing) |
| `npm run golden:bake` | Compare every build-time bake (`web/src/bakes.mjs`) for the example + an empty extract against `web/test/fixtures/bake-golden.*.json` (`-- --update` rewrites them after a deliberate change; `-- --personal` writes/compares the gitignored `web/test/.golden/` personal golden, paths only, exit 2 without personal inputs; `-- --personal --root <clone>` reads that clone's data + golden with this checkout's code, read-only there) |
| `npm run migrate:data-root` | Move a clone's personal files from the old paths into the data root `loop-data/` (backup tarball, copy, sha256 verify, then remove; `-- --dry-run` writes nothing) — [Where the data files live](#where-the-data-files-live) |
| `npm run import:health` | Import the newest Apple Health export zip (or `export.xml`) in `<files>/import/` into the extract via `extract.mjs --source` (skipped when already imported, `-- --force` re-imports; state in `<data root>/import-state.json`) — [`data-pipeline.md` → Apple Health export and extract](data-pipeline.md#apple-health-export-and-extract) |
| `HC_SITE_DIR=<dir> node scripts/refresh.mjs [--seq N] [--wait-lock]` | The loop-server image's page refresh (the container port of `services/loop-web/refresh.sh`): the Apple Health import (`scripts/import-health.mjs`, non-fatal, under `HC_IMPORT_TIMEOUT`, default 1800 s), sync (non-fatal), validate + build the personal page (under a timeout), sanity check, atomic publish into `HC_SITE_DIR` with `status.json` (`commit` = the image version: `HC_VERSION`, else `package.json`; error codes `build` / `sanity` / `lock`), then the device manuals. The ingest service runs it in container mode ([`services/loop-ingest/README.md`](../services/loop-ingest/README.md#container-mode)); `--help` for the env variables |
| `npm run connect -- <url>` | Save the LOOP server a coach clone mirrors (`scripts/connect.mjs`): checks `GET <url>/export/files` with the token (`INGEST_TOKEN`, else a hidden terminal prompt), writes `loop-data/server.json` `{url, token}` mode 600; `-- --forget` removes it — [`data-pipeline.md` → Coach as a client](data-pipeline.md#coach-as-a-client-of-a-loop-server) |
| `scripts/image-smoke.sh` | Build both server images (`SMOKE_PLATFORM`, default `linux/amd64`; CI runs `linux/amd64` and `linux/arm64` on native runners; tag `smoke`, never pushed) and smoke-test a minimal compose stack (`SMOKE_BROWSER=1`: also in Chromium, the Playwright project `docker`), then `down -v`; CI job `images` — [Releasing](#releasing) |
| `npm run demo:data` | Regenerate the synthetic demo extract `data/demo/extract/` (`scripts/make-demo-data.mjs`; `-- --end YYYY-MM-DD --days N --seed N`, `--days` a whole number 2-3650) |
| `npm run gen:food-calc` | Regenerate `services/loop-ingest/src/food-calc.js` from `lib/nutrition/foodlog.mjs` (a test fails while it is stale) |
| `npm run gen:journal-calc` | Regenerate `services/loop-ingest/src/journal-calc.js` from `lib/journal/journal.mjs` (a test fails while it is stale) |
| `npm run gen:profile-rules` | Regenerate `services/loop-ingest/src/profile-rules.js` from `lib/profile/onboarding.mjs` (a test fails while it is stale) |

The everyday commands (`npm run generate`, `npm run sync`, the extractor) are in [`CLAUDE.md`](../CLAUDE.md) and
the README.

## Tests

- `npm test` runs the `*.test.mjs` files of `lib/`, `web/`, `scripts/` and `data/{nutrition,apple-health,profile}/`,
  plus the Claude Code hooks (`.claude/hooks/*.test.js`: the guard hook, the skills and the coach subagents).
- `npm test` stays browser-free; the browser tests are `npm run test:e2e` (below).
- Database migrations (`services/loop-ingest/sql/`) run once each and are recorded in `schema_migrations` with a
  checksum. **Never edit an applied migration; add a new file** (and list it in `src/migrations.js`): the
  service refuses to start when a recorded file changed
  ([`services/loop-ingest/README.md` → Database migrations](../services/loop-ingest/README.md#database-migrations)).
- Each rule gets a test through the public interface; a changed command, option or message updates its help
  text and docs in the same commit.
- Lib code that also runs in the page is the lib itself, bundled from each module's `CLIENT` descriptor by
  `web/src/client/lib-globals.ts`, never copied: `web/test/client-copies.test.mjs` fails on a hand-kept copy, and
  `web/test/client-globals-build.test.mjs` runs the built page's globals against the lib.

### Browser end-to-end tests

`npm run test:e2e` runs Playwright ([`playwright.config.mjs`](../playwright.config.mjs), `@playwright/test` pinned in
`devDependencies`) over `e2e/` in two engines: Chromium (Chrome, Edge, Android) and WebKit (Safari, and every browser on
an iPhone), each on a phone profile; the desktop layout runs on Chromium. CI runs it in the job `e2e` and uploads the HTML report and traces when a
test fails (`e2e/.report/`, `e2e/.results/`, both gitignored).

| Project | What it opens | Specs |
| --- | --- | --- |
| `static-phone` (Pixel 7), `static-desktop` (1280 × 800), `webkit-static` (iPhone 15), `webkit-static-es` (iPhone 15, the page built in Spanish, `es-ES` browser) | the example page (tracked seeds + the synthetic demo extract), built by `e2e/global-setup.mjs` into `web/.e2e-dist/<locale>-example/` (one per locale) and opened from `file://`, so every LAN-only feature is off | `e2e/static/`: tabs, dock, keys `1`–`4` and `?`, the URL hash and every deep link (`#detail/<metric>[/<date>]`, view keys, `#d=`, `#monitor`), every visible card's detail sheet on every tab and the ways to close it, the sheet's controls (day, range, window, month, info, learn more, history fold, trend), the ⓘ notes, tab links and folds, both Customize sheets (hide, move, kept after a reload), the Tonight, session and journal-insights views, the profile sheet, the day stepper, layout on both sides of the 900 px breakpoint; in `webkit-static-es` the same specs against the Spanish copy (`<html lang>`, month and date wording) |
| `lan-setup` → `lan-phone` (Pixel 7) → `webkit-lan` (iPhone 15, the same specs, after `lan-phone` because specs own whole days of the shared database) → `lan-last` (Pixel 7); only with `TEST_DATABASE_URL` (`E2E_LAN=0` leaves them out of a run) | the personal page a real data service builds and serves: [`e2e/lan/stack.mjs`](../e2e/lan/stack.mjs) (Playwright's `webServer`) creates a fresh empty database on that Postgres, seeds a synthetic Health extract ending today (the demo generator), runs `services/loop-ingest` in container mode (its real migrations, `scripts/refresh.mjs` building the page into a temporary `HC_SITE_DIR`) and an nginx stand-in on `127.0.0.1:18290` (`E2E_LAN_PORT`) that serves the site with loop-web's security headers and proxies exactly its `/api` routes with their rewrites and headers; everything (processes, database, folders, a build lock a killed build left) is removed on exit, also when it is stopped during startup | `e2e/lan/`: the first-run assistant end to end (`lan-setup`) and its branches (back, Enter, refused steps, the pregnancy and under-18 stops, the medical / eating limits, maintain / cut / bulk, the adjust grid, a failed save, Later, the Edit chip); the food log (quick, basic, product and recipe entries, past days, per-meal add, the add sheet's keyboard, Atwater and Save anyway, 500 / 429 / offline saves, a failed day load and its retry, the empty day, delete); products (label, barcode and text search with Open Food Facts stubbed at the page's `/api/food/off`, log by serving, edit, archive, field errors, cancel); recipes (several products, a basic, batch, edit, archive, cancel); the journal (answers read back, another day, the drink stepper, a failed save, behaviours off and on, insights); the profile (goal, target weight, a refused save); the "+" menu, the freshness popover, Sync and its failures; Home on a past day with the server's data; and last (`lan-last`) the language switch, which rebuilds the shared page in the other locale and, between the two switches, logs and deletes a food entry and saves the journal in that language |
| `docker` (Pixel 7); only with `E2E_DOCKER_URL`, and then the only project | a running Docker stack's loop-web: `scripts/image-smoke.sh` with `SMOKE_BROWSER=1` points it at the stack it started | `e2e/docker/`: what only the published images can break — loop-web's security headers as served, the page clean of console errors and CSP violations, a food entry saved and deleted through nginx, Sync rebuilding the page inside loop-server |

Shared rules ([`e2e/fixtures.mjs`](../e2e/fixtures.mjs), [`e2e/lan/fixtures.mjs`](../e2e/lan/fixtures.mjs)): the
browser clock is fixed to 10:00 (Europe/Madrid) on the demo's last day (`DEMO_DEFAULTS.end` of
`scripts/make-demo-data.mjs`), so the suite does not drift with the calendar (the LAN specs: 12:00 of the real day,
read once per test as the `today` fixture, since the data service stores against its own calendar); and **every
test fails on a console error, an uncaught exception or a CSP violation** (a test that provokes one on purpose, such
as an API answering 400, names it with `pageErrors.allow(<regexp>)`). The LAN specs share one database: name what
you create with `unique()`, assert on your own rows, take a day of your own when a test changes or reads a whole
day (the allocation table at the top of `e2e/lan/fixtures.mjs`), and clean up with `withCleanup()` (a failing
clean-up fails a passing test but never hides the failure that got there). Each test
is its own client of the data service, like one phone: the browser context sends `x-e2e-client` and the stand-in
connects upstream from a loopback address of that test's own, so the service's per-client rate limits apply per
test (on Linux, where all of 127/8 is loopback; elsewhere every test shares one address and a full LAN run can meet
the limits). A Sync is `syncAndReload()` (listens for the reload before the click, `SYNC_RELOAD_MS` / `SYNC_TEST_MS`). The
LAN projects need the data service's dependencies (`npm --prefix services/loop-ingest ci`) and a Postgres the user
may `CREATE DATABASE` on, e.g. the throwaway container of `npm run test:pg`:
`TEST_DATABASE_URL=postgres://postgres:x@127.0.0.1:5544/postgres npm run test:e2e`. Use the page's stable hooks
(ids, `data-*`, ARIA) rather than text or CSS classes, and never write personal data into a spec.

Accessibility: `e2e/static/a11y.spec.mjs` and `e2e/lan/a11y.spec.mjs` run axe-core (`@axe-core/playwright`, pinned in
`devDependencies`) through `expectAccessible()` of [`e2e/a11y.mjs`](../e2e/a11y.mjs) over every tab, one sheet of
every kind, the add-food sheet in each state, the product and recipe forms, the journal, the "+" menu, the profile
with the server settings and each first-run screen, and fail on any WCAG 2.1 A / AA violation (Label in Name
included: [`docs/design-system.md`](design-system.md) → Accessible names of openers). There is no exclusion list: a
violation is fixed in the page.

Left out on purpose: the real Open Food Facts lookup (it calls the internet; the page side is stubbed), the data
service's own refusals that the page cannot send (oversized or non-JSON bodies, foreign origins: its node tests
cover them), drag reordering in the Customize sheets (the ↑ / ↓ buttons drive the same move), device manual links
and the weight progress line (an empty install has neither), and `GET /api/journal/day` / `GET /api/food/products`,
which the page never calls.

## Generated files

Never hand-edit them; change the source and regenerate:

| File | Source | Regenerate |
| --- | --- | --- |
| `data/nutrition/plan-tables.md`, `web/dist/` | the plan JSONs + `ingredients.json` | `npm run generate` |
| `data/demo/extract/` | `scripts/make-demo-data.mjs` | `npm run demo:data` |
| `services/loop-ingest/src/food-calc.js` | `lib/nutrition/foodlog.mjs` | `npm run gen:food-calc` |
| `services/loop-ingest/src/journal-calc.js` | `lib/journal/journal.mjs` | `npm run gen:journal-calc` |
| `services/loop-ingest/src/profile-rules.js` | `lib/profile/onboarding.mjs` | `npm run gen:profile-rules` |
| `web/test/fixtures/css-expected.json` | the example build's CSS | `npm run test:css:update` |
| `web/test/fixtures/bake-golden.*.json` | `web/src/bakes.mjs` | `npm run golden:bake -- --update` |

A runnable `scripts/*.mjs` guards its CLI with `if (isMain(import.meta.url))` from `scripts/lib/is-main.mjs`
(realpath compare, so symlinks and relative paths work; importing never runs main). The sync scripts,
`scripts/build-web.mjs`, `data/nutrition/generate.mjs`, `data/apple-health/extract.mjs` and the dev scripts
(`publish-manuals`, `make-demo-data`, `gen-food-calc`, `gen-journal-calc`, `gen-profile-rules`, `update-css-fixture`) parse their
flags with `parseCli` / `runCli` (`scripts/lib/sync-common.mjs`); `scripts/golden-bake.mjs` keeps its own
parser with the same rules. `--help` prints the usage, and an unknown flag (a typo such as `--chek`, `--mod`
or `--updte`), a flag without its value or a stray argument exits 2 before anything is read or written.
Numeric flags are validated the same way (`make-demo-data --days abc` exits 2 instead of writing empty CSVs).

`scripts/lib/` is the tooling kernel every CLI shares (`sync-common.mjs`, `is-main.mjs`, `data-root-guard.mjs`,
`generated.mjs`). Dependencies between the tooling folders point one way: no non-test module under `scripts/`
imports from `data/`, and `data/` imports from `scripts/` only through `scripts/lib/`
(`scripts/tooling-boundary.test.mjs`; `lib/fs-boundary.test.mjs` keeps `lib/` from importing `data/`).

## Where the data files live

`lib/paths.mjs` is the one place that knows where every personal and generated data file lives:
`dataPaths({ repoRoot, env })` returns them all as absolute paths (pure path math, no `fs`). Every sync, the page
build (`lib/load/inputs.mjs`, `lib/profile/read.mjs`, `lib/nutrition/read.mjs`), `data/nutrition/generate.mjs`,
`data/apple-health/extract.mjs`, the documents CLI (`scripts/lib/documents.mjs`), `publish:manuals`, `golden:bake`
and the test fixture build resolve their defaults through it. Never join `data/...` paths for these files again.

| Env var | Effect |
| --- | --- |
| `HC_DATA_DIR` (unset) | The **data root** is `<repo>/loop-data/` (gitignored, `/loop-data/` in `.gitignore`) |
| `HC_DATA_DIR=<dir>` | The data root is `<dir>` |
| `HC_FILES_DIR=<dir>` | Replaces `<data root>/files` (the owner files folder: Health export, device manuals, coach PDFs; a bind mount) |

The data-root layout: `extract/` (the Apple Health extract + `_meta.json`, `.shortcut-cache.json`, `journal-daily.*`),
`foodlog/` (`foodlog-daily.csv` + `.meta.json`), `profile/` (`settings.json`, `onboarding.json`,
`strava-profile.json`, `avatar.jpg`), `cache/{profile,plan,training}.json` + `cache/.sync-state.json` (the copies
of the database documents and their sync state), `files/import/` (`export.xml`, Health zips), `files/manuals/`
(device manuals the page links), `files/documents/` (training programs, nutritionist and clinical reports; coach-only).

**Migrating a clone from the old paths** (`data/apple-health/extract/`, `data/apple-health/export.xml`,
`data/nutrition/foodlog-daily.*`, `data/profile/*`, `profile/profile.json`, `data/nutrition/plan-data.json`,
`data/training/training-data.json`, `data/profile/documents-sync.json`, `data/gear/`, the coach PDFs in
`data/training/`, `data/nutritionist/`, `data/clinical/`; `legacyPaths` in `lib/paths.mjs`): run
`npm run migrate:data-root` (`-- --dry-run` first to see the counts) right after updating, before the next
`npm run sync`. It writes a backup tarball `backups/data-root-before-<UTC stamp>.tar`, copies every file
(fsync, mtime kept), verifies every copy by sha256 and only then removes the sources; a target that already
exists with other content stops it before anything is written (exit 1, each conflict named), and a second run
has nothing to move. Tracked files and `*.example.json` never move. Until then, `npm run sync` and the page
build print one `WARNING:` per run naming a document file still at its old path (edits there are ignored).

A relative value resolves against the repo root (never the working directory); an empty one is unset. Example
mode always reads the tracked repo files, and `ingredients.json`, `plan-tables.md`, `web/dist/` and `backups/`
stay in the clone. The per-script test hooks (`EXTRACT_DIR`, `SYNC_*_OUT_DIR`, `SYNC_STRAVA_PROFILE`,
`SYNC_DOCUMENTS_ROOT`, `MIGRATE_REPO_ROOT`, an injected `outDir`) still win over the data root. The module header
has the full table; `lib/paths.test.mjs` pins both layouts path by path.

## Guards

| Guard | What it keeps true | Doc |
| --- | --- | --- |
| Guard hook (`.claude/hooks/guard-health-data.js`) | No force-adding ignored personal files, no un-ignoring them in `.gitignore` | [`guard-hook.md`](guard-hook.md) |
| Git pre-commit hook (opt-in: `git config core.hooksPath scripts/git-hooks`) | The same rule for your own commits: no staged ignored file, no staged `.gitignore` that drops a pattern, adds a `!` or is deleted (judged against `HEAD`'s rules) | [`guard-hook.md`](guard-hook.md#git-pre-commit-hook-opt-in) |
| Design system test | Role tokens, one picked style, chevrons, card radius / padding | [`design-system.md`](design-system.md) |
| Inline CSS budget (`web/test/css-slim.test.mjs`) | The slimmed inline CSS (fonts excluded) stays under its budget (110 000 chars; re-measured 2026-10-15 at ≈ 108.9 KB) | [`plan-page.md`](plan-page.md) |
| Phone inputs (`web/test/mobile.test.mjs`) | Text inputs are ≥ 16 px on phones (no iOS zoom) | [`plan-page.md`](plan-page.md) |
| Page content (`web/test/content.test.mjs`) | The built page names no data endpoint (`/ingest/`, `/export/`) | [`lan-services.md`](lan-services.md) |
| i18n parity | Every English string has its Spanish twin and the reverse | — |

## Workflow

- Read the area's doc in `docs/` before changing it, and keep the doc in sync with the code in the same commit.
  Dated history goes to [`CHANGELOG.md`](../CHANGELOG.md), never into the docs.
- Style: [`.editorconfig`](../.editorconfig) (UTF-8, LF, 2 spaces, a final newline) and the style of the file you
  touch (some modules end statements without semicolons); no formatter rewrites the repo. The page's client
  scripts (`web/src/client/*.ts`) are TypeScript module scripts checked by `npm run typecheck`, not ESLint: a new
  page global another script or the build provides is declared in `web/src/client/page-globals.d.ts`, never cast away.
- Shared helpers have one home: calendar dates (`dayDiff`, `addDays`, `weekStart`, `isIsoDate`, UTC math) are
  [`lib/date.mjs`](../lib/date.mjs), the series stats (`roundTo`, `meanOf`, `median`, `rollAvg`…)
  [`lib/stats.mjs`](../lib/stats.mjs); `lib/` never imports from `data/` (`lib/fs-boundary.test.mjs`). The views'
  areas are layered: kernel (`lib/*.mjs`, `format`, `build`, `extract`) < `training` < `score` < `health` / `journal`,
  each importing only from lower layers. The two composition roots, `lib/extract/read.mjs` (`readExtract`) and
  `lib/score/index.mjs` (`buildScoresFrom`), may import any layer, and no lib module imports them (only
  `web/src/bakes.mjs` does). `lib/layers.test.mjs` pins all of it, with an empty list of known exceptions. The page's
  client scripts may import lib modules (each script's bundle inlines what it imports; shared lib code reaches every
  script once through the `HC_*` globals of `web/src/client/lib-globals.ts`); the local-calendar twins of the date
  helpers (the viewer's clock, not UTC) live in `web/src/client/util.ts`.
- If you run the LAN services from this clone, keep it on `main`: the refresh only publishes from `main`. Do
  feature work in a separate `git worktree`.
- Never commit personal data (`CLAUDE.md` → Repo rules); `data/demo/` is tracked and must stay synthetic.

## Releasing

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs `npm run lint`, `npm run typecheck`, `npm test`,
`npm run test:services`, (job `e2e`) `npm run test:e2e`, (job `postgres`, a Postgres 17 service container) `npm run test:pg` and (job `images`)
[`scripts/image-smoke.sh`](../scripts/image-smoke.sh) on every push to `main` and every pull request; a fresh clone
needs no personal data to pass. The image smoke test builds both server images for `linux/amd64` (tag `smoke`, never
pushed), starts a minimal stack of `docker/docker-compose.yml` (empty database and files folder, random secrets, both
ports on `127.0.0.1`) and checks loop-server `GET /healthz`, a first `status.json` with `publishedAt` through
loop-web, `GET /` 200 over 100 KB and, with `SMOKE_BROWSER=1` (CI sets it), the browser smoke of the served page
(Playwright project `docker`), then always runs `down -v`. Locally:
`SMOKE_INSTANCE=mine SMOKE_VERSION=mine SMOKE_INGEST_PORT=18188 SMOKE_WEB_PORT=18190 scripts/image-smoke.sh` (the
`:mine` images stay; `docker image rm` them after). Every checkout sets `persist-credentials: false` and both
workflows keep `permissions: contents: read`; the one exception is the release's last job, `github-release`
(`contents: write`, see below). A `vX.Y.Z` tag runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which first runs that whole CI on the tagged
commit (job `test`: `ci.yml` is a reusable workflow, `workflow_call`) and publishes the two server images to Docker
Hub, `mralexandersaavedra/loop-server` (`docker/loop-server.Dockerfile`) and `mralexandersaavedra/loop-web`
(`docker/loop-web.Dockerfile`), built from the repo root for `linux/amd64` and `linux/arm64`, each architecture on a native GitHub runner
(`ubuntu-24.04` / `ubuntu-24.04-arm`, never QEMU: emulated arm64 crashed Node during `npm ci`) and pushed by digest, then
joined into one multi-arch manifest per image (job `image`, `docker buildx imagetools create`) tagged `X.Y.Z` and
`X.Y` (the OCI `version` label comes from the `VERSION` build argument), plus `latest` only when the version is the
highest `X.Y.Z` tag in the repo: a backport tag (`v1.0.5` after `v1.1.0`) leaves `latest` where it is. Its first job,
`check`, stops the release before anything is built or pushed (the `build` job `needs: [check, test]`, the `image` job `needs: [check, build]`) unless the version is a plain `X.Y.Z` (no pre-release),
the tag equals `v` + the `package.json` version, the tagged commit is on `main`, every `loop-server` / `loop-web`
`image:` line of [`docker/docker-compose.yml`](../docker/docker-compose.yml) uses `${HC_VERSION:-X.Y.Z}` with that
version (no hard-coded tag), `HC_VERSION` in `docker/example.env` is exactly that version, and the first version
heading of `CHANGELOG.md` is `## [X.Y.Z] - YYYY-MM-DD` (a `- UNRELEASED` one is refused). Its last job, `github-release` (`needs: [check, image]`), publishes the GitHub
Release of the tag once both images are out: the body is that version's CHANGELOG section
([`scripts/release-notes.mjs`](../scripts/release-notes.mjs): repo-relative links pointed at the tagged tree, plus
one line naming both images), `latest` only for the highest `X.Y.Z` like the image tag, and a re-run edits the
existing release. The
host-mode data service image (`mralexandersaavedra/loop-ingest`) is no longer published: `services/loop-ingest` still
builds it from a clone (`docker compose up -d --build`). [`scripts/release.test.mjs`](../scripts/release.test.mjs) keeps
the pieces below in step and runs the `check` script against good and bad scratch git repos (the `latest` ordering
included), so a drift fails the suite.

One-time repository settings: the variable `DOCKERHUB_USERNAME` and the secret `DOCKERHUB_TOKEN` (a Docker Hub
access token with read/write scope, never the account password); and, once the repository is public, **Settings →
Code security → Private vulnerability reporting** on, the channel [`SECURITY.md`](../SECURITY.md) points to (GitHub
offers it only on public repositories).

Checklist for a release (the project skill `.claude/skills/release` walks Claude Code through the same steps, plus
updating the installs):

1. Bump `version` in `package.json` and `services/loop-ingest/package.json` (`npm install --package-lock-only` in
   both, so the lock files carry it too), every `HC_VERSION:-` default in `docker/docker-compose.yml` (the two
   images and their two `VERSION` build arguments), `HC_VERSION` in `docker/example.env` and the two `curl` URLs of
   the server quick start in `README.md` and `README.es.md` (`/vX.Y.Z/docker/…`; `scripts/release.test.mjs` checks them).
2. Write the `## [X.Y.Z] - UNRELEASED` section at the top of [`CHANGELOG.md`](../CHANGELOG.md) with what changed for
   someone running an install. While it says `UNRELEASED` the suite passes but the release workflow refuses the tag.
3. **Set the date**: replace `UNRELEASED` with the release day (`## [X.Y.Z] - YYYY-MM-DD`) in the last pull request
   before the tag.
4. Merge to `main` with CI green.
5. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. A failed `check` job publishes nothing: fix the file it
   names on `main`, delete the tag (`git push origin :refs/tags/vX.Y.Z && git tag -d vX.Y.Z`) and tag again.
6. Check both images on Docker Hub (each tag lists `linux/amd64` and `linux/arm64`) and the GitHub Release the
   workflow published, then on an install:
   `docker compose pull && docker compose up -d` next to its `docker-compose.yml`
   ([`docs/guides/upgrading.md`](guides/upgrading.md)).

Base images (`node`, `postgres`, `nginx`) and the GitHub Actions are pinned by digest or commit SHA, with the
readable tag beside them; Dependabot ([`.github/dependabot.yml`](../.github/dependabot.yml)) proposes the updates
weekly for the Dockerfiles and compose files of both `services/` and `docker/`, together with the npm dependencies.

To build the images locally from the repo root: `docker build -f docker/loop-server.Dockerfile --build-arg
VERSION=<x.y.z> .` and `docker build -f docker/loop-web.Dockerfile --build-arg VERSION=<x.y.z> .` (`loop-server`:
only production dependencies, `astro` and `esbuild` are `dependencies` because the page build runs in the image;
`loop-web`: nginx with `services/loop-web/nginx.conf.template` and `hosts.sh` copied in, so a change to the audited
config reaches both stacks). `scripts/loop-server-compose.test.mjs` / `scripts/dockerignore.test.mjs` pin both
Dockerfiles, the compose file and the default-deny build context; `docker compose -f docker/docker-compose.yml up -d
--build` with a `docker/.env` runs the whole stack from a clone ([`lan-services.md`](lan-services.md)).

## Contributor-only tools

- `.claude/skills/frontend-design` is a vendored skill (from `anthropics/skills`, pinned in `skills-lock.json`,
  files in `.agents/skills/`) for UI work on the page. End users never need it.
- `scripts/make-logo.mjs path/to/Syncopate-Bold.ttf` regenerates the logo assets in `web/src/assets/`
  ([`plan-page.md`](plan-page.md)). It needs `fontkitten` and `sharp`, which `package.json` does NOT declare
  (they arrive as Astro's own dependencies with `npm ci`); without them it prints one `ERROR:` line naming
  both and exits 1.
- Owner-specific setup notes belong in a gitignored `CLAUDE.local.md`, which Claude Code loads next to
  `CLAUDE.md`.
