# plan-web

Serves the personal plan page (`web/dist/personal/index.html`) on the LAN with
nginx, and refreshes it hourly (cron) or on demand (the page's **Sync** button,
or the iOS Shortcut).

| File | Role |
| ---- | ---- |
| `refresh.sh` | Sync data, rebuild, publish into `./site`, write `site/status.json` |
| `docker-compose.yml` | nginx serving `./site` (read-only) and proxying a few exact ingest routes |
| `nginx.conf.template` | nginx config, rendered with `INGEST_PORT` at container start |
| `systemd/plan-web-refresh.path` | Watches the ingest trigger file |
| `systemd/plan-web-refresh.service` | Runs `refresh.sh` (as the repo owner, hardened) when it changes |

`./site` (including `./site/manuales/`, the published device manuals),
`.refresh.lock`, `.refresh-state` and the ingest `trigger/` directory are
gitignored.

## How a refresh works (sequence protocol)

Nothing compares clocks. Every accepted click gets a **sequence number**, and
the page waits until a publish covers it.

```
Sync button / Shortcut
  -> POST /api/sync (plan-web nginx) -> POST /sync (health-ingest, host port)
       202 {seq, coalesced}
       1. pulls Strava now, unless the last successful pull is < 5 min old
       2. writes `seq` atomically to services/health-ingest/trigger/refresh
  -> systemd plan-web-refresh.path (PathModified) -> plan-web-refresh.service
  -> refresh.sh, per pass: remember the trigger seq it starts from ->
       npm run sync -> npm ci (only if the lockfile changed) -> npm run generate
  -> site/index.html + site/status.json {publishedAt, commit, branch, processedSeq}
  -> the page polls every 5 s and reloads once processedSeq >= its seq
```

- **Clicks during a run are never lost.** After each pass `refresh.sh` re-reads
  the trigger file and runs again (at most 3 passes) when the seq advanced,
  whatever systemd's path unit did with the extra change.
- **Repeated clicks coalesce, never dropped.** A click while a trigger is still
  pending gets the current seq back (`{coalesced: true}`) and causes no work.
  A click within 60 s of the last one, after its write, gets a NEW seq
  (`{coalesced: true, deferred: true}`) whose trigger write happens when the
  60 s window closes, so data sent right after a rebuild (the Shortcut's
  payload) is still published; later clicks reuse it. The page's 5 min wait
  covers the 60 s delay plus the rebuild. Nobody is ever refused (no `429`).
- **Failures fail fast.** An early exit adds `{error, errorSeq}` to
  `status.json` without touching `publishedAt`/`processedSeq`; the page shows
  "No se pudo actualizar: <reason>". Codes: `branch`, `install`, `build`,
  `sanity`, `lock`. If ingest could not write the trigger file, its
  `/sync/status` reports `lastTriggerError: "trigger_write"` with the seq, and
  the page fails fast on that too. Otherwise it gives up after 5 min.

The hourly cron keeps running `refresh.sh`; both paths share the same `flock`.
Cron skips a tick while a run is active (not an error: the running pass
re-checks the seq); the on-demand unit sets `PLAN_WEB_WAIT_LOCK=1` and waits
up to 900 s, then reports `lock`.

### refresh.sh guarantees

- A failed sync (ingest down) still rebuilds from the CSVs on disk.
- `sync` and `generate` each run under `timeout` (`PLAN_WEB_STEP_TIMEOUT`,
  default 300 s); `npm ci` has its own `PLAN_WEB_CI_TIMEOUT` (default 900 s).
- A failed install, failed build or invalid output keeps serving the last good
  page; `status.json` keeps its last good publish and only gains the error code.
- **Branch guard:** only `main` is published. With another branch checked out
  the run writes the `branch` code, logs a line and exits 0 (fine for cron).
  Set `PLAN_WEB_ALLOW_BRANCH=1` to publish it anyway.
- `status.json` is written atomically; `processedSeq` never goes backwards.

## The freshness line on the page

The page header shows `Atajo: hace 5 min · Strava: hace 2 h · Página: hace 1 min`
(English build: `Shortcut · Strava · Page`), computed in the browser from
`GET /api/sync/status` and `/status.json`. A source older than 24 h turns
amber with a short hint, older than 72 h red. When `/api/sync/status` is not
reachable (the example build, a `file://` open, a claude.ai artifact, a clone
without the ingest service) the line and the button are not shown at all.

## Security and exposure model

`POST /sync` and `GET /sync/status` are **unauthenticated** by design: the page
is a static file and cannot hold a secret. That is acceptable because:

- `POST /sync` only schedules work the services already do on a timer. It reads
  no body and returns only a sequence number. Cost is bounded without locking
  anyone out: at most **one rebuild per minute** and **one Strava pull per
  5 min**, however many requests arrive.
- `GET /sync/status` returns timestamps, sequence numbers and **coarse codes**
  (`strava_auth`, `strava_network`, `strava_other`, `strava_token_save`,
  `trigger_write`), cached for 5 s. Never health data, never raw error text
  (that stays in the container logs).

The food log (`/api/food/*` -> ingest `/food/*`: Nutrición's Registrar, Mis
productos, Mis recetas) is unauthenticated for the same reason, and LAN only.
Every request must carry `X-HC-Food: 1` and every write a JSON body; from
another site both force a CORS preflight that the ingest service never
approves. nginx forwards the header, allows only GET / POST / PUT / DELETE and
caps bodies at 16 KB (like the service). Never put this server, or `/food/*` on
the ingest side, behind a public proxy.

**DNS rebinding and the Host allowlist.** A hostile page can make its own name
resolve to this server's LAN address and so become same-origin with the plan
page (all health data, and the food log read + write). nginx therefore answers
EVERY path (the page, `status.json`, `/api/*`) only when the request names it
by an IP literal (`http://192.168.1.10:8090`, `http://[fd00::12]:8090`) or
`localhost`; any other name gets `421`. The ingest service repeats the check on
`/food/*` (plus the `Origin` of writes) as defence in depth.

To reach the page by a name too (e.g. `http://plan.lan:8090`):

1. add `PLAN_WEB_EXTRA_HOSTS=plan.lan` (comma / space separated for several) to
   `services/plan-web/.env`, then `docker compose up -d` here; `hosts.sh`
   (mounted as `/docker-entrypoint.d/15-hc-hosts.sh`) turns each valid name into
   one exact map entry and skips anything else with a warning in the logs;
2. add the same names as `FOOD_ALLOWED_HOSTS=plan.lan` to
   `services/health-ingest/.env` and `docker compose up -d health-ingest`
   there, or the food log refuses writes whose `Origin` is that name.

Only list names you control on your own network (a local DNS / hosts entry);
never a public domain someone else can point anywhere.

What each proxy may forward:

| Proxy | Forwards | Never |
| ----- | -------- | ----- |
| **plan-web nginx** (this service) | `POST /api/sync` -> `/sync`, `GET /api/sync/status` -> `/sync/status`, `POST /ingest/health-auto-export` -> the same path (bearer checked by ingest, 8 MB, below ingest's `MAX_BODY_BYTES` default) (exact match, method restricted); `/api/food/*` -> `/food/*` (GET / POST / PUT / DELETE, 16 KB) | anything else under `/api/` or `/ingest/` (404), `/export` |
| **Public reverse proxy** (if any, in front of health-ingest) | `/ingest/*` (bearer token) and `POST /sync` (for the Shortcut's last step); `/sync/status` optional | `/export/*`, `/sync/strava`, `/food/*`, `/healthz` |

`POST /ingest/health-auto-export` is here so the iOS Shortcut can reach ingest
through plan-web when plan-web is the public entry and ingest is not exposed at
all. nginx forwards `Authorization`, `Automation-Name` and `Content-Type`,
refuses a request without a `Bearer` token with `401` before reading the body,
and caps the body at 8 MB (the Shortcut sends a few hundred KB); ingest checks
the token itself (`401`) and its own body limit (`413`).

Every request whose raw path (before `?`) holds `..`, `%2e`, `%2f`, `%5c`
(any case) or `//` gets `400`, before any location. An SSO proxy may match its
bypass rules on the raw path while nginx serves the normalized one
(`/ingest/%2e%2e/index.html` would otherwise be the page); no path the page,
the food log or the Shortcut uses contains those.

### Device manuals (`/manuales/`)

The profile sheet links a device's manual when `profile/profile.json` names
one (`devices[].manual`, a bare PDF file name, e.g.
`"garmin-edge-540-manual-es.pdf"`). The PDFs live in `data/gear/`
(gitignored). After every publish `refresh.sh` runs `npm run -s
publish:manuals` (`scripts/publish-manuals.mjs`), which copies ONLY the
referenced files into `./site/manuales/` and deletes anything else there:
a regular file directly in `data/gear/` (a symlink is refused), starting
with `%PDF-`, at most 50 MB. A missing or refused file is a warning; a failure
never blocks the page. nginx serves exactly `/manuales/<name>.pdf` (the same
name pattern) as `application/pdf`, `Content-Disposition: inline`,
`X-Content-Type-Options: nosniff`, GET / HEAD only, no listing; everything
else under `/manuales/` is a 404, and the Host allowlist and raw-path guard
apply as for every path. The page shows the link only after a `HEAD` of the
file answers 200, so the claude.ai artifact and `file://` show nothing.
Rollout: `docker compose up -d` here (new nginx location), then the next
refresh (or `npm run publish:manuals` by hand) publishes the files.

### Exposing behind an SSO tunnel (e.g. Pangolin)

To reach the page from outside the LAN without opening the ingest service:

1. **One HTTP resource** in the tunnel: `https://<your-host>` -> plan-web
   (port 8090). Nothing points at the ingest port.
2. **SSO on** for the resource, with authentication bypass rules for exactly
   two paths: `/ingest/*` (the Shortcut upload; ingest checks its bearer token,
   and every other `/ingest/*` path is a 404 here) and `/api/sync` (the
   Shortcut's refresh trigger, no data). The `/api/sync` rule must be an EXACT
   path match, never a prefix (`/api/sync*` would also bypass
   `/api/sync/status` and anything a proxy normalizes under it). The page,
   `status.json`, `/api/sync/status` and the food log stay behind the login,
   and so does `/manuales/` (device manuals): it stays behind SSO, never add
   it to a bypass rule.
3. **Allow the public host**: add it to `PLAN_WEB_EXTRA_HOSTS` in
   `services/plan-web/.env` and to `FOOD_ALLOWED_HOSTS` in
   `services/health-ingest/.env`, then `docker compose up -d` in both (see the
   Host allowlist above; without it every request gets `421`).
4. **Point the Shortcut** at `https://<your-host>/ingest/health-auto-export` and
   `https://<your-host>/api/sync` (`docs/ios-shortcut.md`, "Through plan-web").

5. **Verify from outside** (mobile data, not the LAN) that the bypass cannot
   be used to reach the page: both must answer `400` or the SSO redirect, never
   the file:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' 'https://<your-host>/ingest/%2e%2e/status.json'
   curl -s -o /dev/null -w '%{http_code}\n' --path-as-is 'https://<your-host>/ingest/../status.json'
   ```

`INGEST_TOKEN` is now reachable from the internet, and it also guards
`/export/*` on ingest: keep it at least 32 random bytes (`openssl rand -hex 32`)
and out of screenshots and shared Shortcuts.

Never bypass SSO for anything else, and never expose `/export/*` or the ingest
port. The food log then sits behind SSO + the Host / Origin / `X-HC-Food`
checks instead of "LAN only".

## Install (host)

Replace `/path/to/health-coach` with your clone's absolute path and
`REPO_OWNER` with the user that owns the clone. Follow the steps **in order**.

1. **Trigger directory first** (before any `docker compose up`, or Docker creates
   it root-owned and the container cannot write it). It must be writable by the
   ingest container's `node` user (uid 1000):

   ```sh
   mkdir -p /path/to/health-coach/services/health-ingest/trigger
   sudo chown 1000:1000 /path/to/health-coach/services/health-ingest/trigger
   ```

2. **Rebuild the ingest service** so it mounts the directory and runs
   `sql/003_sync.sql` (idempotent):

   ```sh
   cd /path/to/health-coach/services/health-ingest && docker compose up -d --build
   ```

3. **First `npm ci` by hand**, as the repo owner (a cold install can take
   minutes; the unit's timeout is meant for incremental reinstalls):

   ```sh
   cd /path/to/health-coach && npm ci --no-audit --no-fund
   ```

4. **Verify the checkout is `main`** (otherwise every run only writes the
   `branch` code):

   ```sh
   git -C /path/to/health-coach rev-parse --abbrev-ref HEAD   # main
   ```

5. **Recreate plan-web** so it picks up the nginx template, the host-gateway
   alias and `INGEST_PORT` (set `INGEST_PORT` in `services/plan-web/.env` if the
   ingest port is not 8088):

   ```sh
   cd /path/to/health-coach/services/plan-web && docker compose up -d
   ```

6. **Install the systemd units** (fill in both placeholders):

   ```sh
   for u in plan-web-refresh.path plan-web-refresh.service; do
     sed -e 's#/path/to/health-coach#/your/absolute/clone#g' -e 's#REPO_OWNER#youruser#g' \
       /path/to/health-coach/services/plan-web/systemd/$u \
       | sudo tee /etc/systemd/system/$u >/dev/null
   done
   sudo systemctl daemon-reload
   sudo systemctl enable --now plan-web-refresh.path
   ```

   If `node`/`npm` are not in `/usr/local/bin` or `/usr/bin`, add an
   `Environment=PATH=...` line to the service (see the comment in the unit).

7. **Smoke test** end to end:

   ```sh
   curl -s -X POST localhost:8090/api/sync         # 202 {"ok":true,"seq":N,"coalesced":false,...}
   curl -s localhost:8090/api/sync/status          # triggerSeq N, codes only
   curl -s -H 'X-HC-Food: 1' localhost:8090/api/food/products   # {"products":[...]}
   curl -s -o /dev/null -w '%{http_code}\n' localhost:8090/api/food/products   # 403 without the header
   curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' localhost:8090/   # 421: not an allowed Host
   journalctl -u plan-web-refresh.service -f       # refresh.sh output
   cat /path/to/health-coach/services/plan-web/site/status.json   # processedSeq >= N
   ```

The ingest port must be reachable from the Docker bridge (the default
`"${INGEST_PORT}:8088"` publish is; a `127.0.0.1:`-only publish is not).

The existing cron entry (e.g. `0 * * * * /path/to/health-coach/services/plan-web/refresh.sh`,
in the repo owner's crontab) stays as the fallback.

### The service user and the hardening, and their tradeoffs

- **`User=REPO_OWNER`**: the build runs as the user that owns the clone, the
  same one as the cron job. Use `root` only when the clone itself is
  root-owned. Running as the owner is also why `refresh.sh` needs no git
  `safe.directory` override (git only complains about a repo owned by another user).
- **`ProtectSystem=strict` + `ReadWritePaths=<clone>`**: the whole filesystem is
  read-only except the clone, which the build writes (`node_modules`, the
  extract CSVs, `web/dist`, `./site`). Tradeoff: a tool that writes somewhere
  else fails with `EROFS`; add that path to `ReadWritePaths`.
- **`ProtectHome=read-only`**: home directories stay readable (node/npm installed
  with nvm keep working) but not writable; a clone that lives in a home
  directory is still writable through `ReadWritePaths`. npm gets a writable
  cache through `CacheDirectory=` (`/var/cache/plan-web-refresh`), and Astro
  telemetry / npm update checks are off so nothing writes to `$HOME`. If your
  setup needs a writable home, drop `ProtectHome` rather than the other
  settings.
- **`NoNewPrivileges=yes`, `PrivateTmp=yes`**: no setuid escalation, a private
  `/tmp`. No known downside for this build.
