# plan-web

Serves the personal plan page (`web/dist/personal/index.html`) on the LAN with
nginx, and refreshes it hourly (cron) or on demand (the page's **Sync** button,
or the iOS Shortcut).

| File | Role |
| ---- | ---- |
| `refresh.sh` | Sync data, rebuild, publish into `./site`, write `site/status.json` |
| `docker-compose.yml` | nginx serving `./site` (read-only) and proxying two ingest routes |
| `nginx.conf.template` | nginx config, rendered with `INGEST_PORT` at container start |
| `systemd/plan-web-refresh.path` | Watches the ingest trigger file |
| `systemd/plan-web-refresh.service` | Runs `refresh.sh` when the trigger file changes |

`./site`, `.refresh.lock` and the ingest `trigger/` directory are gitignored.

## How a refresh works

```
Sync button / Shortcut
  -> POST /api/sync (plan-web nginx) -> POST /sync (health-ingest, host port)
       1. pulls Strava now (shared with the timer loop, never overlapping)
       2. writes services/health-ingest/trigger/refresh
  -> systemd plan-web-refresh.path (PathModified) -> plan-web-refresh.service
  -> refresh.sh: npm run sync -> npm ci (only if the lockfile changed) -> npm run generate
  -> site/index.html + site/status.json {publishedAt, commit, branch}
  -> the page sees publishedAt change and reloads
```

The hourly cron keeps running `refresh.sh` as before; both paths share the
same `flock`. Cron skips a tick while a run is active; the on-demand unit sets
`PLAN_WEB_WAIT_LOCK=1` and waits its turn, so a click is never dropped.

### refresh.sh guarantees

- A failed sync (ingest down) still rebuilds from the CSVs on disk.
- `sync`, `npm ci` and `generate` each run under `timeout`
  (`PLAN_WEB_STEP_TIMEOUT`, default 300 s).
- A failed install, failed build or invalid output keeps serving the last good
  page and its `status.json` untouched.
- **Branch guard:** only `main` is published. With another branch checked out
  (a review, a half-done change) the run logs a line and exits 0. Set
  `PLAN_WEB_ALLOW_BRANCH=1` to publish it anyway.
- `status.json` is written atomically after each successful publish.

## The freshness line on the page

The page header shows `Atajo: hace 5 min · Strava: hace 2 h · Página: hace 1 min`
(English build: `Shortcut · Strava · Page`), computed in the browser from
`GET /api/sync/status` and `/status.json`. A source older than 24 h turns
amber with a short hint, older than 72 h red. When `/api/sync/status` is not
reachable (the example build, a `file://` open, a claude.ai artifact, a clone
without the ingest service) the line and the button are not shown at all.

## Security

`POST /sync` and `GET /sync/status` are **unauthenticated** by design: the page
is a static file and cannot hold a secret. That is acceptable because:

- `POST /sync` only schedules work the services already do on a timer. It reads
  no body, returns only the request time, and is limited to **one request per
  60 s globally** (`429` with `Retry-After` otherwise).
- `GET /sync/status` returns timestamps, a short error string and whether Strava
  is configured. Never health data.
- nginx proxies **exactly** those two paths (exact-match locations, method
  restricted). Every other `/api/` path is a 404; the bearer-protected
  `/ingest` and `/export` endpoints are never reachable through plan-web.

Worst case, someone who can reach the page triggers one rebuild per minute.

## Install (host)

Replace `/path/to/health-coach` with your clone's absolute path everywhere below.

1. Create the trigger directory, writable by the ingest container's `node` user
   (uid 1000), then restart the ingest service so it mounts it and runs the new
   migration:

   ```sh
   mkdir -p /path/to/health-coach/services/health-ingest/trigger
   sudo chown 1000:1000 /path/to/health-coach/services/health-ingest/trigger
   cd /path/to/health-coach/services/health-ingest && docker compose up -d --build
   ```

2. Recreate plan-web so it picks up the nginx template, the host-gateway alias
   and `INGEST_PORT` (set `INGEST_PORT` in `services/plan-web/.env` if the
   ingest port is not 8088):

   ```sh
   cd /path/to/health-coach/services/plan-web && docker compose up -d
   ```

3. Install the systemd units (edit the placeholder path first):

   ```sh
   sed 's#/path/to/health-coach#/your/absolute/clone#g' \
     /path/to/health-coach/services/plan-web/systemd/plan-web-refresh.path \
     | sudo tee /etc/systemd/system/plan-web-refresh.path >/dev/null
   sed 's#/path/to/health-coach#/your/absolute/clone#g' \
     /path/to/health-coach/services/plan-web/systemd/plan-web-refresh.service \
     | sudo tee /etc/systemd/system/plan-web-refresh.service >/dev/null
   sudo systemctl daemon-reload
   sudo systemctl enable --now plan-web-refresh.path
   ```

   If `node`/`npm` are not in `/usr/local/bin` or `/usr/bin`, add an
   `Environment=PATH=...` line to the service (see the comment in the unit).

4. Check it end to end:

   ```sh
   curl -s -X POST localhost:8090/api/sync         # 202 {"ok":true,...}
   curl -s localhost:8090/api/sync/status          # timestamps only
   journalctl -u plan-web-refresh.service -f       # refresh.sh output
   cat /path/to/health-coach/services/plan-web/site/status.json
   ```

The ingest port must be reachable from the Docker bridge (the default
`"${INGEST_PORT}:8088"` publish is; a `127.0.0.1:`-only publish is not).

The existing cron entry (e.g. `0 * * * * /path/to/health-coach/services/plan-web/refresh.sh`)
stays as the fallback.
