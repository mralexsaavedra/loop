# Development

How to change the code safely: the commands, the tests and the guards that keep the page correct and personal
data out of git. Using the project rather than changing it? Start at the [documentation index](README.md).

## On this page

- [Setup](#setup)
- [Commands](#commands)
- [Tests](#tests)
- [Generated files](#generated-files)
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
| `npm run check` | Validators only, no build (plan, ingredients, `training-data.json`, `profile/profile.json`) |
| `npm run build:example` | Example page from the tracked seeds + the synthetic demo extract, no personal files |
| `node scripts/build-web.mjs [--mode personal\|example] [--locale es\|en]` | Build one page variant into `web/dist/<mode>/index.html` |
| `npm run test:css:update` | Regenerate `web/test/fixtures/css-expected.json` from the example build after a deliberate CSS change (keeps key order, appends new, drops stale; `-- --check` writes nothing) |
| `npm run golden:bake` | Compare every build-time bake (`web/src/bakes.mjs`) for the example + an empty extract against `web/test/fixtures/bake-golden.*.json` (`-- --update` rewrites them after a deliberate change; `-- --personal` writes/compares the gitignored `web/test/.golden/` personal golden, paths only, exit 2 without personal inputs; `-- --personal --root <clone>` reads that clone's data + golden with this checkout's code, read-only there) |
| `npm run demo:data` | Regenerate the synthetic demo extract `data/demo/extract/` (`scripts/make-demo-data.mjs`) |
| `npm run gen:food-calc` | Regenerate `services/loop-ingest/src/food-calc.js` from `lib/nutrition/foodlog.mjs` (a test fails while it is stale) |
| `npm run gen:journal-calc` | Regenerate `services/loop-ingest/src/journal-calc.js` from `lib/journal/journal.mjs` (a test fails while it is stale) |

The everyday commands (`npm run generate`, `npm run sync`, the extractor) are in [`CLAUDE.md`](../CLAUDE.md) and
the README.

## Tests

- `npm test` runs the `*.test.mjs` files of `lib/`, `web/`, `scripts/` and `data/{nutrition,apple-health,profile}/`,
  plus the Claude Code hooks (`.claude/hooks/*.test.js`: the guard hook, the skills and the coach subagents).
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
(realpath compare, so symlinks and relative paths work; importing never runs main).

## Guards

| Guard | What it keeps true | Doc |
| --- | --- | --- |
| Guard hook (`.claude/hooks/guard-health-data.js`) | No force-adding ignored personal files, no un-ignoring them in `.gitignore` | [`guard-hook.md`](guard-hook.md) |
| Design system test | Role tokens, one picked style, chevrons, card radius / padding | [`design-system.md`](design-system.md) |
| Inline CSS budget (`web/test/css-slim.test.mjs`) | The slimmed inline CSS stays under its budget | [`plan-page.md`](plan-page.md) |
| Phone inputs (`web/test/mobile.test.mjs`) | Text inputs are ≥ 16 px on phones (no iOS zoom) | [`plan-page.md`](plan-page.md) |
| Page content (`web/test/content.test.mjs`) | The built page names no data endpoint (`/ingest/`, `/export/`) | [`lan-services.md`](lan-services.md) |
| i18n parity | Every English string has its Spanish twin and the reverse | — |

## Workflow

- Read the area's doc in `docs/` before changing it, and keep the doc in sync with the code in the same commit.
  Dated history goes to [`CHANGELOG.md`](../CHANGELOG.md), never into the docs.
- If you run the LAN services from this clone, keep it on `main`: the refresh only publishes from `main`. Do
  feature work in a separate `git worktree`.
- Never commit personal data (`CLAUDE.md` → Repo rules); `data/demo/` is tracked and must stay synthetic.

## Releasing

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs `npm test` and `npm run test:services` on every
push to `main` and every pull request; a fresh clone needs no personal data to pass. A `vX.Y.Z` tag runs
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

## Contributor-only tools

- `.claude/skills/frontend-design` is a vendored skill (from `anthropics/skills`, pinned in `skills-lock.json`,
  files in `.agents/skills/`) for UI work on the page. End users never need it.
- Owner-specific setup notes belong in a gitignored `CLAUDE.local.md`, which Claude Code loads next to
  `CLAUDE.md`.
