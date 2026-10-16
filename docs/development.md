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
suite and dependencies (`npm run test:services`).

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Full suite (`node --test`); `pretest` builds the example (+ personal, if present) fixtures |
| `npm run test:services` | The `services/loop-ingest` suite (not part of `npm test`, which stays dependency-free): `npm ci` there from its lockfile, then its `node --test` |
| `TEST_DATABASE_URL=postgres://… npm run test:pg` | The data service against a real Postgres (`services/loop-ingest/test/pg/`): the real migrations on a fresh empty database per file, the ledger + lock, the main DB paths. Needs a Postgres 17 where the user may `CREATE DATABASE` (a throwaway `docker run --rm -e POSTGRES_PASSWORD=x -p 127.0.0.1:5544:5432 postgres:17-alpine` does); without the variable the tests skip. CI runs it in the `postgres` job |
| `npm run check` | Validators only, no build (plan, ingredients, `loop-data/cache/training.json`, `loop-data/cache/profile.json`) |
| `npm run lint` | ESLint over the whole repo ([`eslint.config.mjs`](../eslint.config.mjs)): correctness rules only (unused / undefined names, redeclarations, useless assignments), never formatting; CI runs it |
| `npm run typecheck` | TypeScript over `lib/**/*.mjs`, `data/**/*.mjs` and `scripts/*.mjs` (tests excluded) as JavaScript ([`jsconfig.json`](../jsconfig.json), `checkJs`, no emit): a wrong property, argument count or shape fails; types come from JSDoc (`@param`, `@type`, `@returns`), never `// @ts-ignore`; CI runs it |
| `npm run build:example` | Example page from the tracked seeds + the synthetic demo extract, no personal files |
| `node scripts/build-web.mjs [--mode personal\|example] [--locale es\|en] [--outdir <dir>] [--check]` | Build one page variant into `web/dist/<mode>/index.html` (`--help` for the flags) |
| `npm run test:css:update` | Regenerate `web/test/fixtures/css-expected.json` from the example build after a deliberate CSS change (keeps key order, appends new, drops stale; `-- --check` writes nothing) |
| `npm run golden:bake` | Compare every build-time bake (`web/src/bakes.mjs`) for the example + an empty extract against `web/test/fixtures/bake-golden.*.json` (`-- --update` rewrites them after a deliberate change; `-- --personal` writes/compares the gitignored `web/test/.golden/` personal golden, paths only, exit 2 without personal inputs; `-- --personal --root <clone>` reads that clone's data + golden with this checkout's code, read-only there) |
| `npm run migrate:data-root` | Move a clone's personal files from the old paths into the data root `loop-data/` (backup tarball, copy, sha256 verify, then remove; `-- --dry-run` writes nothing) — [Where the data files live](#where-the-data-files-live) |
| `npm run import:health` | Import the newest Apple Health export zip (or `export.xml`) in `<files>/import/` into the extract via `extract.mjs --source` (skipped when already imported, `-- --force` re-imports; state in `<data root>/import-state.json`) — [`data-pipeline.md` → Apple Health export and extract](data-pipeline.md#apple-health-export-and-extract) |
| `HC_SITE_DIR=<dir> node scripts/refresh.mjs [--seq N] [--wait-lock]` | The loop-server image's page refresh (the container port of `services/loop-web/refresh.sh`): the Apple Health import (`scripts/import-health.mjs`, non-fatal, under `HC_IMPORT_TIMEOUT`, default 1800 s), sync (non-fatal), validate + build the personal page (under a timeout), sanity check, atomic publish into `HC_SITE_DIR` with `status.json` (`commit` = the image version: `HC_VERSION`, else `package.json`; error codes `build` / `sanity` / `lock`), then the device manuals. The ingest service runs it in container mode ([`services/loop-ingest/README.md`](../services/loop-ingest/README.md#container-mode)); `--help` for the env variables |
| `npm run demo:data` | Regenerate the synthetic demo extract `data/demo/extract/` (`scripts/make-demo-data.mjs`; `-- --end YYYY-MM-DD --days N --seed N`, `--days` a whole number 2-3650) |
| `npm run gen:food-calc` | Regenerate `services/loop-ingest/src/food-calc.js` from `lib/nutrition/foodlog.mjs` (a test fails while it is stale) |
| `npm run gen:journal-calc` | Regenerate `services/loop-ingest/src/journal-calc.js` from `lib/journal/journal.mjs` (a test fails while it is stale) |

The everyday commands (`npm run generate`, `npm run sync`, the extractor) are in [`CLAUDE.md`](../CLAUDE.md) and
the README.

## Tests

- `npm test` runs the `*.test.mjs` files of `lib/`, `web/`, `scripts/` and `data/{nutrition,apple-health,profile}/`,
  plus the Claude Code hooks (`.claude/hooks/*.test.js`: the guard hook, the skills and the coach subagents).
- Database migrations (`services/loop-ingest/sql/`) run once each and are recorded in `schema_migrations` with a
  checksum. **Never edit an applied migration; add a new file** (and list it in `src/migrations.js`): the
  service refuses to start when a recorded file changed
  ([`services/loop-ingest/README.md` → Database migrations](../services/loop-ingest/README.md#database-migrations)).
- Each rule gets a test through the public interface; a changed command, option or message updates its help
  text and docs in the same commit.
- Lib code that also runs in the page is emitted from the lib itself (`lib/nutrition/client.mjs` and friends),
  never copied: `web/test/client-copies.test.mjs` fails on a hand-kept copy, and
  `web/test/client-globals-build.test.mjs` runs the emitted globals against the lib.

## Generated files

Never hand-edit them; change the source and regenerate:

| File | Source | Regenerate |
| --- | --- | --- |
| `data/nutrition/plan-tables.md`, `web/dist/` | the plan JSONs + `ingredients.json` | `npm run generate` |
| `data/demo/extract/` | `scripts/make-demo-data.mjs` | `npm run demo:data` |
| `services/loop-ingest/src/food-calc.js` | `lib/nutrition/foodlog.mjs` | `npm run gen:food-calc` |
| `services/loop-ingest/src/journal-calc.js` | `lib/journal/journal.mjs` | `npm run gen:journal-calc` |
| `web/test/fixtures/css-expected.json` | the example build's CSS | `npm run test:css:update` |
| `web/test/fixtures/bake-golden.*.json` | `web/src/bakes.mjs` | `npm run golden:bake -- --update` |

A runnable `scripts/*.mjs` guards its CLI with `if (isMain(import.meta.url))` from `scripts/lib/is-main.mjs`
(realpath compare, so symlinks and relative paths work; importing never runs main). The sync scripts,
`scripts/build-web.mjs`, `data/nutrition/generate.mjs`, `data/apple-health/extract.mjs` and the dev scripts
(`publish-manuals`, `make-demo-data`, `gen-food-calc`, `gen-journal-calc`, `update-css-fixture`) parse their
flags with `parseCli` / `runCli` (`data/apple-health/sync-common.mjs`); `scripts/golden-bake.mjs` keeps its own
parser with the same rules. `--help` prints the usage, and an unknown flag (a typo such as `--chek`, `--mod`
or `--updte`), a flag without its value or a stray argument exits 2 before anything is read or written.
Numeric flags are validated the same way (`make-demo-data --days abc` exits 2 instead of writing empty CSVs).

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
  scripts (`web/src/client/*.js`) are classic scripts sharing one global scope: a new global another script or
  the build provides goes into `BAKED` / `SHARED` in `eslint.config.mjs`, never an `eslint-disable`.
- Shared helpers have one home: calendar dates (`dayDiff`, `addDays`, `weekStart`, `isIsoDate`, UTC math) are
  [`lib/date.mjs`](../lib/date.mjs); `lib/` never imports from `data/` (`lib/fs-boundary.test.mjs`). The page's
  classic client scripts cannot import modules: they keep their local-calendar twins in `web/src/client/util.js`.
- If you run the LAN services from this clone, keep it on `main`: the refresh only publishes from `main`. Do
  feature work in a separate `git worktree`.
- Never commit personal data (`CLAUDE.md` → Repo rules); `data/demo/` is tracked and must stay synthetic.

## Releasing

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs `npm run lint`, `npm run typecheck`, `npm test`,
`npm run test:services` and (job `postgres`, a Postgres 17 service container) `npm run test:pg` on every push to `main` and every pull request; a fresh clone needs no personal data to pass. A `vX.Y.Z` tag runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which publishes the data service image
`mralexandersaavedra/loop-ingest` to Docker Hub for `linux/amd64` and `linux/arm64` as `X.Y.Z`, `X.Y` and `latest`.
[`scripts/release.test.mjs`](../scripts/release.test.mjs) keeps the pieces below in step, so a drift fails the suite.

One-time repository settings: the variable `DOCKERHUB_USERNAME` and the secret `DOCKERHUB_TOKEN` (a Docker Hub
access token with read/write scope, never the account password); and, once the repository is public, **Settings →
Code security → Private vulnerability reporting** on, the channel [`SECURITY.md`](../SECURITY.md) points to (GitHub
offers it only on public repositories).

Checklist for a release:

1. Bump `version` in `package.json` and `services/loop-ingest/package.json` (`npm install --package-lock-only` in
   both, so the lock files carry it too), and the `HC_VERSION` default in `services/loop-ingest/docker-compose.yml`.
2. Add a `## [X.Y.Z] - YYYY-MM-DD` section at the top of [`CHANGELOG.md`](../CHANGELOG.md) with what changed for
   someone running an install.
3. Merge to `main` with CI green.
4. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow refuses a tag that differs from
   `package.json`.
5. Check the image on Docker Hub, then on an install: `docker compose pull && docker compose up -d` in
   `services/loop-ingest` ([`docs/guides/upgrading.md`](guides/upgrading.md)).

Base images (`node`, `postgres`, `nginx`) and the GitHub Actions are pinned by digest or commit SHA, with the
readable tag beside them; Dependabot ([`.github/dependabot.yml`](../.github/dependabot.yml)) proposes the updates
weekly, together with the npm dependencies.

The `loop-server` and `loop-web` images (preview, [`lan-services.md` → Server image](lan-services.md#server-image-preview--docker))
are not released yet: `docker build -f docker/loop-server.Dockerfile --build-arg VERSION=<x.y.z> .` and
`docker build -f docker/loop-web.Dockerfile --build-arg VERSION=<x.y.z> .` from the repo root build them locally
(`loop-server`: only production dependencies, `astro` and `esbuild` are `dependencies` because the page build runs in
the image; `loop-web`: nginx with `services/loop-web/nginx.conf.template` and `hosts.sh` copied in, so a change to
the audited config reaches both stacks). `scripts/loop-server-compose.test.mjs` / `scripts/dockerignore.test.mjs` pin
both Dockerfiles, the compose file and the default-deny build context; `docker compose -f docker/docker-compose.yml
up -d --build` with a `docker/.env` runs the whole stack from a clone.

## Contributor-only tools

- `.claude/skills/frontend-design` is a vendored skill (from `anthropics/skills`, pinned in `skills-lock.json`,
  files in `.agents/skills/`) for UI work on the page. End users never need it.
- `scripts/make-logo.mjs path/to/Syncopate-Bold.ttf` regenerates the logo assets in `web/src/assets/`
  ([`plan-page.md`](plan-page.md)). It needs `fontkitten` and `sharp`, which `package.json` does NOT declare
  (they arrive as Astro's own dependencies with `npm ci`); without them it prints one `ERROR:` line naming
  both and exits 1.
- Owner-specific setup notes belong in a gitignored `CLAUDE.local.md`, which Claude Code loads next to
  `CLAUDE.md`.
