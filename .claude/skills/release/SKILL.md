---
name: release
description: "Trigger: release, new version, nueva versión, publicar versión, sacar versión, tag, bump version, cut a release, publish images. Walks the maintainer through a LOOP release end to end: version bump in every file, CHANGELOG, pull request with CI green, tag, the release workflow (both images + the GitHub Release), then updating the installs."
---

# Releasing a new LOOP version

The source of truth is [`docs/development.md`](../../../docs/development.md) → Releasing (what the workflow checks and
why). This skill is the order to do it in, so nothing is forgotten. Stop and report at the first failing step; never
skip a check to get the tag out.

## 0. Before starting

- Work in a branch or worktree, never on the clone that runs an install. `main` is protected: a pull request merges
  only with CI green, and force pushes / branch deletion are refused.
- Pick the version (semver): a fix-only release bumps PATCH, new behaviour MINOR. Plain `X.Y.Z`, no suffix.

## 1. Bump the version everywhere (one commit, `chore(release): X.Y.Z`)

- `package.json` and `services/loop-ingest/package.json` (`version`), and both lock files: the root `version` and the
  `packages[""].version` entry (`npm install --package-lock-only` in both folders does it).
- `docker/docker-compose.yml`: the four `HC_VERSION:-` defaults (two images, two `VERSION` build arguments).
- `docker/example.env`: `HC_VERSION=X.Y.Z` (the env template; named so that no `.env*` deny rule blocks it).
- `README.md` and `README.es.md`: the two `curl` URLs of the server quick start (`/vX.Y.Z/docker/…`).
- `CHANGELOG.md`: a `## [X.Y.Z] - YYYY-MM-DD` section at the top, dated the release day, written for someone running
  an install (what changed for them, not the commits). It becomes the GitHub Release body word for word
  (`scripts/release-notes.mjs`), so keep links repo-relative.

Then `node --test scripts/release.test.mjs scripts/release-notes.test.mjs` must pass (it checks every file above), and
`npm test`, `npm run lint`, `npm run typecheck`.

## 2. Pull request and merge

- Open the pull request (the release commit may ride with the fixes it ships). Wait for every CI check: `test`,
  `postgres`, `images (ubuntu-24.04, linux/amd64)`, `images (ubuntu-24.04-arm, linux/arm64)`. A run cancelled by a
  newer push is not a failure: watch the newest run.
- Merge with CI green; update every local clone with `git pull --ff-only`.

## 3. Tag and watch the release

- `git tag -a vX.Y.Z -m vX.Y.Z origin/main && git push origin vX.Y.Z` (the tag must be on `main`).
- Watch `.github/workflows/release.yml` to the end: `check` → `test` → `build` (native amd64 and arm64 runners) →
  `image` (one multi-arch manifest, `X.Y.Z`, `X.Y`, and `latest` only for the highest version) → `github-release`.
- A failed `check` publishes nothing: fix the file it names on `main`. Moving the tag needs a remote tag delete,
  which is the maintainer's call (destructive): ask, never do it on your own.
- Confirm: `docker manifest inspect mralexandersaavedra/loop-server:X.Y.Z` (and `loop-web`) list `amd64` and `arm64`,
  and `gh release view vX.Y.Z` shows the CHANGELOG section.

## 4. Update the installs (only with the maintainer's OK: it restarts containers)

For each install, as [`docs/guides/upgrading.md`](../../../docs/guides/upgrading.md) says:

1. Back up its database first (`pg_dump -Fc` from its `loop-db` container into its `backups/`).
2. `docker compose pull && docker compose up -d` in its `docker/` folder.
3. Trigger a refresh (`POST /api/sync` on the page) and check `status.json`: `commit` is `X.Y.Z`, no `error`.

A maintainer with personal installs keeps their list (folders, ports, backups) in the gitignored `CLAUDE.local.md`;
read it for this step.

## 5. Close

Report the version, the merged pull request, the release URL, both images, and each install's `status.json`.
