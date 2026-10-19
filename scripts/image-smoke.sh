#!/usr/bin/env bash
# Image smoke test: builds the loop-server and loop-web images from this clone for linux/amd64 (never pushed) and
# runs a minimal compose stack of docker/docker-compose.yml (empty database, empty files folder, random secrets,
# both ports on 127.0.0.1), then checks what a fresh install must do:
#   1. loop-server answers GET /healthz
#   2. its first build publishes: GET /status.json through loop-web carries publishedAt
#   3. GET / through loop-web is 200 and the page is over 100 KB (102400 bytes)
# and always takes the stack down with its volumes (down -v), pass or fail. CI runs it (.github/workflows/ci.yml,
# job images), and so does a release before anything is pushed (release.yml calls ci.yml). docs/development.md -> CI.
#
# Env (all optional): SMOKE_INSTANCE (HC_INSTANCE suffix, default smoke), SMOKE_VERSION (the image tag built and run,
# default smoke: never a release tag), SMOKE_INGEST_PORT (default 18088), SMOKE_WEB_PORT (default 18090),
# SMOKE_TIMEOUT (seconds to wait for the first publish, default 600), SMOKE_PLATFORM (the platform to build, default
# linux/amd64; CI also runs it on a native arm64 runner with linux/arm64).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTANCE="${SMOKE_INSTANCE:-smoke}"
VERSION="${SMOKE_VERSION:-smoke}"
INGEST_PORT="${SMOKE_INGEST_PORT:-18088}"
WEB_PORT="${SMOKE_WEB_PORT:-18090}"
TIMEOUT="${SMOKE_TIMEOUT:-600}"
PLATFORM="${SMOKE_PLATFORM:-linux/amd64}"
case "${VERSION}" in
  [0-9]*) echo "SMOKE_VERSION=${VERSION}: use a non-release tag (it is built and tagged locally)" >&2; exit 2 ;;
esac

umask 077
WORK="$(mktemp -d)"
mkdir -p "${WORK}/files"
chmod 755 "${WORK}" "${WORK}/files" # read-only bind mount for the image's node user
cat > "${WORK}/.env" <<EOF
HC_VERSION=${VERSION}
HC_INSTANCE=${INSTANCE}
INGEST_TOKEN=$(openssl rand -hex 32)
POSTGRES_USER=loop
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=loop
INGEST_PORT=${INGEST_PORT}
INGEST_BIND=127.0.0.1
PLAN_WEB_PORT=${WEB_PORT}
PLAN_WEB_BIND=127.0.0.1
HC_FILES_LOCATION=${WORK}/files
HC_REFRESH_MINUTES=60
EOF

compose() { docker compose -p "loop-${INSTANCE}" --env-file "${WORK}/.env" -f "${ROOT}/docker/docker-compose.yml" "$@"; }
cleanup() {
  local code=$?
  if [ "${code}" -ne 0 ]; then
    echo "--- smoke failed (exit ${code}): the stack's logs ---" >&2
    compose logs --no-color --tail 200 >&2 || true
  fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "${WORK}"
  exit "${code}"
}
trap cleanup EXIT

echo "Building loop-server and loop-web :${VERSION} for ${PLATFORM} (not pushed)"
DOCKER_DEFAULT_PLATFORM="${PLATFORM}" compose build
echo "Starting the stack (instance ${INSTANCE}, ports 127.0.0.1:${INGEST_PORT} and 127.0.0.1:${WEB_PORT})"
compose up -d --wait --wait-timeout 300

curl -fsS "http://127.0.0.1:${INGEST_PORT}/healthz" >/dev/null
echo "ok: loop-server /healthz"

deadline=$(( $(date +%s) + TIMEOUT ))
until curl -fsS "http://127.0.0.1:${WEB_PORT}/status.json" 2>/dev/null | grep -Eq '"publishedAt": ?"'; do
  if [ "$(date +%s)" -ge "${deadline}" ]; then
    echo "no published status.json after ${TIMEOUT} s" >&2
    exit 1
  fi
  sleep 5
done
echo "ok: the first build published (/status.json has publishedAt)"

code="$(curl -sS -o "${WORK}/index.html" -w '%{http_code}' "http://127.0.0.1:${WEB_PORT}/")"
size="$(wc -c < "${WORK}/index.html" | tr -d ' ')"
if [ "${code}" != 200 ] || [ "${size}" -le 102400 ]; then
  echo "GET / answered ${code} with ${size} bytes (expected 200 and more than 102400)" >&2
  exit 1
fi
echo "ok: GET / 200, ${size} bytes"
echo "Image smoke test passed"
