#!/usr/bin/env sh
# Pull fresh Shortcut/Strava data, rebuild the Astro plan page and publish it
# to ./site. Run hourly by cron and on demand by the systemd path unit
# (systemd/plan-web-refresh.path, fired by the ingest service's POST /sync).
# Resilience rules (see spec: Resilient serving on build failure):
#   - a failed sync (ingest service down) still rebuilds from the CSVs
#     already on disk (sync failure is non-fatal);
#   - a slow/overlapping run never runs twice at once (flock); cron skips
#     when busy, the on-demand unit (PLAN_WEB_WAIT_LOCK=1) waits its turn so
#     a click is never silently dropped;
#   - sync, npm ci and generate each run under `timeout` (PLAN_WEB_STEP_TIMEOUT,
#     default 300 s), so a hung step cannot hold the lock forever;
#   - `npm ci` only runs when package-lock.json actually changed (fast
#     no-op re-runs on every other cron tick);
#   - a failed `npm ci`, failed generate, or invalid build output all keep
#     serving the last good page (and its status.json) untouched — nothing is
#     copied to ./site unless the new build is verified sane first;
#   - only `main` is published: another checked-out branch (a review or a
#     half-done change) is skipped unless PLAN_WEB_ALLOW_BRANCH=1.
# After a successful publish, site/status.json = {publishedAt, commit, branch}
# (written atomically) feeds the page's freshness line and Sync button.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
cd "$REPO" || exit 1

log() { echo "refresh: $*" >&2; }

STEP_TIMEOUT=${PLAN_WEB_STEP_TIMEOUT:-300}
step() { timeout -k 10 "$STEP_TIMEOUT" "$@"; }
# safe.directory: the systemd unit runs as root, possibly on a repo owned by
# another user; git would otherwise refuse ("dubious ownership").
repo_git() { git -c safe.directory="$REPO" "$@"; }

# Only characters git allows in a ref and that are safe inside a JSON string.
BRANCH=$(repo_git rev-parse --abbrev-ref HEAD 2>/dev/null | tr -cd 'A-Za-z0-9._/-')
BRANCH=${BRANCH:-unknown}
if [ "$BRANCH" != "main" ] && [ "${PLAN_WEB_ALLOW_BRANCH:-0}" != "1" ]; then
  log "checked-out branch '$BRANCH' is not main, skipping (set PLAN_WEB_ALLOW_BRANCH=1 to publish it)"
  exit 0
fi

# Serialize concurrent runs (a slow run must never overlap a fresh one).
exec 9>"$HERE/.refresh.lock"
if [ "${PLAN_WEB_WAIT_LOCK:-0}" = "1" ]; then
  if ! flock -w "${PLAN_WEB_LOCK_WAIT:-900}" 9; then
    log "previous run still active after waiting, skipping"
    exit 0
  fi
elif ! flock -n 9; then
  log "previous run still active, skipping"
  exit 0
fi

step npm run -s sync || log "sync failed, rebuilding from existing CSVs"

# Only reinstall deps when package-lock.json actually changed since the last
# successful install — the stamp is written ONLY after npm ci succeeds, so a
# failed install is retried next run instead of being silently skipped.
mkdir -p node_modules
STAMP="node_modules/.lock-stamp"
NEW_HASH=$(sha256sum package-lock.json)
OLD_HASH=$(cat "$STAMP" 2>/dev/null || true)
if [ "$NEW_HASH" != "$OLD_HASH" ]; then
  if step npm ci --no-audit --no-fund; then
    echo "$NEW_HASH" > "$STAMP"
  else
    log "npm ci failed, keeping previous page"
    exit 1
  fi
fi

if ! step npm run -s generate; then
  log "generate failed, keeping previous page"
  exit 1
fi

OUT="web/dist/personal/index.html"
if [ ! -s "$OUT" ] || ! grep -q '</html>' "$OUT"; then
  log "build output missing/empty/invalid ($OUT), keeping previous page"
  exit 1
fi

mkdir -p "$HERE/site"
if ! { cp "$OUT" "$HERE/site/.index.html.tmp" && mv "$HERE/site/.index.html.tmp" "$HERE/site/index.html"; }; then
  log "copy to site failed, keeping previous page"
  exit 1
fi

COMMIT=$(repo_git rev-parse --short HEAD 2>/dev/null | tr -cd '0-9a-f')
PUBLISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"publishedAt":"%s","commit":"%s","branch":"%s"}\n' "$PUBLISHED_AT" "${COMMIT:-unknown}" "$BRANCH" \
  > "$HERE/site/.status.json.tmp" && mv "$HERE/site/.status.json.tmp" "$HERE/site/status.json"
log "published $PUBLISHED_AT"
