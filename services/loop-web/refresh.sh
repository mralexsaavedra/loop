#!/usr/bin/env sh
# Pull fresh Shortcut/Strava data, rebuild the Astro plan page and publish it
# to ./site. Run hourly by cron and on demand by the systemd path unit
# (systemd/loop-web-refresh.path, fired by the ingest service's POST /sync).
#
# Sequence protocol (the page's Sync button waits on it, no clocks involved):
#   - POST /sync writes a sequence number to the trigger file
#     (services/loop-ingest/trigger/refresh, one line: `seq`);
#   - each pass records the seq it STARTED from and, after a successful
#     publish, writes site/status.json =
#       {publishedAt, commit, branch, processedSeq}
#     (processedSeq never goes backwards);
#   - after a pass it re-reads the trigger file and runs again (at most
#     MAX_PASSES in total) if the seq advanced meanwhile, so a click during a
#     run is never lost, whatever systemd's PathModified re-arming does;
#   - an early exit (branch guard, npm ci / generate / sanity failure, lock
#     timeout) adds {error: <code>, errorSeq} to status.json WITHOUT touching
#     publishedAt/processedSeq, so the page fails fast with a clear message.
#     Codes: branch, install, build, sanity, lock.
#
# Resilience rules (see spec: Resilient serving on build failure):
#   - a failed sync (ingest service down) still rebuilds from the CSVs
#     already on disk (sync failure is non-fatal);
#   - a slow/overlapping run never runs twice at once (flock); cron skips
#     when busy (the running pass re-checks the seq), the on-demand unit
#     (PLAN_WEB_WAIT_LOCK=1) waits its turn;
#   - sync and generate each run under `timeout` (PLAN_WEB_STEP_TIMEOUT,
#     default 300 s), npm ci under its own PLAN_WEB_CI_TIMEOUT (default
#     900 s: a cold install is slow). Do the FIRST `npm ci` by hand before
#     enabling the units;
#   - `npm ci` only runs when package-lock.json actually changed (fast
#     no-op re-runs on every other cron tick);
#   - a failed `npm ci`, failed generate, or invalid build output all keep
#     serving the last good page untouched — nothing is copied to ./site
#     unless the new build is verified sane first;
#   - device manuals are published after status.json, under a 30 s timeout
#     (PLAN_WEB_MANUALS_TIMEOUT), best effort (a failure there is logged,
#     never an error code, never delays a waiting Sync);
#   - only `main` is published: another checked-out branch (a review or a
#     half-done change) is skipped unless PLAN_WEB_ALLOW_BRANCH=1.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
cd "$REPO" || exit 1

log() { echo "refresh: $*" >&2; }

STEP_TIMEOUT=${PLAN_WEB_STEP_TIMEOUT:-300}
CI_TIMEOUT=${PLAN_WEB_CI_TIMEOUT:-900}
MANUALS_TIMEOUT=${PLAN_WEB_MANUALS_TIMEOUT:-30}
MAX_PASSES=3
TRIGGER_FILE=${PLAN_WEB_TRIGGER_FILE:-$REPO/services/loop-ingest/trigger/refresh}
SITE="$HERE/site"
# The last successful publish as a JSON fragment, kept OUTSIDE ./site (nginx
# serves every file there). Error writes reuse it so they never touch it.
STATE="$HERE/.refresh-state"

step() { limit=$1; shift; timeout -k 10 "$limit" "$@"; }

# The trigger file's seq: one line of 1-15 digits, anything else (missing,
# garbled, the old timestamp format) reads as 0.
read_seq() {
  line=$(head -n 1 "$TRIGGER_FILE" 2>/dev/null) || line=
  case "$line" in
    '' | *[!0-9]*) echo 0; return ;;
  esac
  if [ ${#line} -gt 15 ]; then echo 0; return; fi
  line=$(echo "$line" | sed 's/^0*//')
  echo "${line:-0}"
}

processed_seq() {
  seq=$(sed -n 's/.*"processedSeq":\([0-9][0-9]*\).*/\1/p' "$STATE" 2>/dev/null)
  echo "${seq:-0}"
}

# status.json = the last good publish (if any) + optional extra members, atomically.
write_status() {
  body=$(cat "$STATE" 2>/dev/null || true)
  if [ -n "$1" ]; then body=${body:+$body,}$1; fi
  mkdir -p "$SITE" &&
    printf '{%s}\n' "$body" > "$SITE/.status.json.tmp" &&
    mv "$SITE/.status.json.tmp" "$SITE/status.json"
}

# fail <code> <seq> <log message>
fail() {
  code=$1 seq=$2
  shift 2
  log "$*"
  write_status "\"error\":\"$code\",\"errorSeq\":$seq" || log "could not write status.json"
}

# Only characters git allows in a ref and that are safe inside a JSON string.
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null | tr -cd 'A-Za-z0-9._/-')
BRANCH=${BRANCH:-unknown}
if [ "$BRANCH" != "main" ] && [ "${PLAN_WEB_ALLOW_BRANCH:-0}" != "1" ]; then
  # exit 0: an expected state for cron, not a crash; the page still learns why.
  fail branch "$(read_seq)" "checked-out branch '$BRANCH' is not main, skipping (set PLAN_WEB_ALLOW_BRANCH=1 to publish it)"
  exit 0
fi

# Serialize concurrent runs (a slow run must never overlap a fresh one).
exec 9>"$HERE/.refresh.lock"
if [ "${PLAN_WEB_WAIT_LOCK:-0}" = "1" ]; then
  if ! flock -w "${PLAN_WEB_LOCK_WAIT:-900}" 9; then
    fail lock "$(read_seq)" "previous run still active after waiting, giving up"
    exit 1
  fi
elif ! flock -n 9; then
  # not an error: the running pass re-reads the trigger seq when it finishes
  log "previous run still active, skipping"
  exit 0
fi

# One sync + build + publish pass. $1 = the trigger seq it started from.
refresh_once() {
  start=$1
  step "$STEP_TIMEOUT" npm run -s sync || log "sync failed, rebuilding from existing CSVs"

  # Only reinstall deps when package-lock.json actually changed since the last
  # successful install — the stamp is written ONLY after npm ci succeeds, so a
  # failed install is retried next run instead of being silently skipped.
  mkdir -p node_modules
  STAMP="node_modules/.lock-stamp"
  NEW_HASH=$(sha256sum package-lock.json)
  OLD_HASH=$(cat "$STAMP" 2>/dev/null || true)
  if [ "$NEW_HASH" != "$OLD_HASH" ]; then
    if step "$CI_TIMEOUT" npm ci --no-audit --no-fund; then
      echo "$NEW_HASH" > "$STAMP"
    else
      fail install "$start" "npm ci failed, keeping previous page"
      return 1
    fi
  fi

  if ! step "$STEP_TIMEOUT" npm run -s generate; then
    fail build "$start" "generate failed, keeping previous page"
    return 1
  fi

  OUT="web/dist/personal/index.html"
  if [ ! -s "$OUT" ] || ! grep -q '</html>' "$OUT"; then
    fail sanity "$start" "build output missing/empty/invalid ($OUT), keeping previous page"
    return 1
  fi

  mkdir -p "$SITE"
  if ! { cp "$OUT" "$SITE/.index.html.tmp" && mv "$SITE/.index.html.tmp" "$SITE/index.html"; }; then
    fail sanity "$start" "copy to site failed, keeping previous page"
    return 1
  fi

  prev=$(processed_seq)
  processed=$start
  if [ "$prev" -gt "$processed" ]; then processed=$prev; fi
  COMMIT=$(git rev-parse --short HEAD 2>/dev/null | tr -cd '0-9a-f')
  PUBLISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '"publishedAt":"%s","commit":"%s","branch":"%s","processedSeq":%s' \
    "$PUBLISHED_AT" "${COMMIT:-unknown}" "$BRANCH" "$processed" > "$STATE.tmp" &&
    mv "$STATE.tmp" "$STATE" &&
    write_status '' || { log "could not write status.json"; return 1; }
  log "published $PUBLISHED_AT (processedSeq $processed)"

  # Device manuals (profile.json devices[].manual, PDFs from data/gear/) into
  # site/manuales/, served by nginx as /manuales/<file>.pdf. Runs AFTER
  # status.json (a waiting Sync has already completed) under its own short
  # timeout; best effort: a failure is logged, never an error code.
  step "$MANUALS_TIMEOUT" npm run -s publish:manuals -- --out "$SITE/manuales" ||
    log "publishing device manuals failed, page published anyway"
}

passes=0
rc=0
while :; do
  passes=$((passes + 1))
  start=$(read_seq)
  if refresh_once "$start"; then rc=0; else rc=1; fi
  now=$(read_seq)
  if [ "$now" -gt "$start" ] && [ "$passes" -lt "$MAX_PASSES" ]; then
    log "trigger advanced ($start -> $now) during the run, refreshing again"
    continue
  fi
  break
done
exit "$rc"
