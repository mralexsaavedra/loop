#!/usr/bin/env sh
# Pull fresh Shortcut data, regenerate the plan page and publish it to ./site.
# Meant for cron; a failed sync (ingest service down) still regenerates from
# the CSVs already on disk.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
cd "$REPO" || exit 1

npm run -s sync || echo "refresh: sync failed, regenerating from existing CSVs" >&2
npm run -s generate || { echo "refresh: generate failed, keeping previous page" >&2; exit 1; }

mkdir -p "$HERE/site"
cp data/nutrition/plan-web.html "$HERE/site/.index.html.tmp"
mv "$HERE/site/.index.html.tmp" "$HERE/site/index.html"
echo "refresh: published $(date -Iseconds)"
