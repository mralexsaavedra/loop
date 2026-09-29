#!/usr/bin/env sh
# Pull fresh Shortcut data, rebuild the Astro plan page and publish it to
# ./site. Meant for cron. Resilience rules (see spec: Resilient serving on
# build failure):
#   - a failed sync (ingest service down) still rebuilds from the CSVs
#     already on disk (sync failure is non-fatal);
#   - a slow/overlapping run never runs twice at once (flock);
#   - `npm ci` only runs when package-lock.json actually changed (fast
#     no-op re-runs on every other cron tick);
#   - a failed `npm ci`, failed generate, or invalid build output all keep
#     serving the last good page untouched — nothing is copied to ./site
#     unless the new build is verified sane first.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
cd "$REPO" || exit 1

log() { echo "refresh: $*" >&2; }

# Serialize concurrent cron runs (a slow run must never overlap a fresh one).
exec 9>"$HERE/.refresh.lock"
if ! flock -n 9; then
  log "previous run still active, skipping"
  exit 0
fi

npm run -s sync || log "sync failed, rebuilding from existing CSVs"

# Only reinstall deps when package-lock.json actually changed since the last
# successful install — the stamp is written ONLY after npm ci succeeds, so a
# failed install is retried next run instead of being silently skipped.
mkdir -p node_modules
STAMP="node_modules/.lock-stamp"
NEW_HASH=$(sha256sum package-lock.json)
OLD_HASH=$(cat "$STAMP" 2>/dev/null || true)
if [ "$NEW_HASH" != "$OLD_HASH" ]; then
  if npm ci --no-audit --no-fund; then
    echo "$NEW_HASH" > "$STAMP"
  else
    log "npm ci failed, keeping previous page"
    exit 1
  fi
fi

if ! npm run -s generate; then
  log "generate failed, keeping previous page"
  exit 1
fi

OUT="web/dist/personal/index.html"
if [ ! -s "$OUT" ] || ! grep -q '</html>' "$OUT"; then
  log "build output missing/empty/invalid ($OUT), keeping previous page"
  exit 1
fi

mkdir -p "$HERE/site"
cp "$OUT" "$HERE/site/.index.html.tmp" && mv "$HERE/site/.index.html.tmp" "$HERE/site/index.html"
log "published $(date -Iseconds)"
