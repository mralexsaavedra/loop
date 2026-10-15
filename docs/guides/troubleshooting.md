# Troubleshooting

Fixes for the common problems when you run the page and the LAN services at home. Each section names
a symptom, what to **check** (1–3 places or commands), and the **fix**. Commands assume the clone is at
`/path/to/loop`, the page on port 8090 and the ingest service on port 8088 (the defaults).

## The page shows old data, or a source is amber / red

**Check**

- Tap the dot in the top bar: it lists the age of each source ("Atajo", "Strava", "Página"). Amber means
  older than 24 h, red older than 72 h.
- `cat /path/to/loop/services/loop-web/site/status.json` — `publishedAt` and `commit` are the
  last good build; an `error` field means the last run stopped early (next section).
- `data/apple-health/extract/_meta.json` — `exportLastDate` is a partial day; `shortcutSync.owned`
  lists the dates the Shortcut wrote.

**Fix**

- Press **Sync** on the page, or wait for the hourly cron rebuild.
- If only "Atajo" is old, the phone has not sent anything: see "The Shortcut runs but nothing arrives".
- If only "Strava" is old, see "Strava stays empty".
- Working on the command line instead: `npm run sync` then `npm run generate`.

## The Sync button does nothing or shows "No se pudo actualizar"

**Check**

- `curl -s localhost:8090/api/sync/status` — `lastTriggerError: "trigger_write"` means the ingest
  container could not write the trigger file.
- The `error` code in `services/loop-web/site/status.json`: `branch`, `install`, `build`, `sanity` or
  `lock`.
- `journalctl -u loop-web-refresh.service -f` while you press Sync (the `refresh.sh` output).

**Fix**

- `branch`: only `main` is published. Check with
  `git -C /path/to/loop rev-parse --abbrev-ref HEAD` and switch back to `main`; do feature work
  in a separate git worktree.
- `trigger_write`: the trigger directory must belong to the container user:
  `sudo chown 1000:1000 /path/to/loop/services/loop-ingest/trigger`.
- Nothing happens at all: the systemd path unit is missing or stopped.
  `sudo systemctl enable --now loop-web-refresh.path` (install steps in the loop-web README, step 8).
- `install` / `build`: run `/path/to/loop/services/loop-web/refresh.sh` by hand and read the
  error. A failed build keeps the last good page online.
- `lock`: another refresh was still running; press Sync again in a minute.
- No Sync button or freshness dot at all: the page cannot reach `/api/sync/status` (opened as a file,
  the example build, or ingest is down). That is expected outside the LAN page.

## The Shortcut runs but nothing arrives

**Check**

- The Shortcut's URL: `http://<server-ip>:8090/ingest/health-auto-export` (or
  `https://<your-host>/ingest/health-auto-export` behind a tunnel). Any other `/ingest/*` path is a 404.
- The response: `202` means stored; `401` means the token does not match (the service logs each one as
  `"event":"unauthorized"` with a running `count`, never the token); `400` with `"code":"nul_character"`
  means the payload holds a `\u0000` character, which the database cannot store.
- `curl -s localhost:8088/sync/status` — `lastShortcutAt` should move after each run.

**Fix**

- `401`: the `Authorization` header must be `Bearer <INGEST_TOKEN>`; on the server,
  `grep INGEST_TOKEN services/loop-ingest/.env` and copy it on your own screen.
- Keys are empty: check the *Source is* (*Origen es*) filters name **your** devices, one search per
  device (two filters in one search are combined with AND and return nothing).
- A type is missing from the list: iOS 26 renamed some (Active Energy → *Active Calories*, Resting
  Energy → *Resting Calories*); VO2 max is *Cardio Fitness*.
- Runs at night send nothing: Health data is locked while the phone is locked. Trigger the automation
  on opening an app you use daily.
- Very large payloads: loop-web and the service accept up to 8 MB on that path. Shorten the heart-rate window (1 day).
- New keys never show up: run `npm run sync -- --full` once.

## Strava stays empty

**Check**

- `curl -s localhost:8088/sync/status` — `stravaConfigured` must be `true`; `lastStravaOkAt` should have
  a time; `lastStravaError` shows a code (`strava_auth`, `strava_network`, `strava_other`,
  `strava_token_save`).
- `curl -s localhost:8088/healthz` — `degraded: true` means the last successful pull is over 6 h old or
  never happened.

**Fix**

- `stravaConfigured: false`: fill `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` and `STRAVA_REFRESH_TOKEN`
  in `services/loop-ingest/.env`, then `docker compose up -d` in that folder.
- `strava_auth`, or `401` / `invalid_grant` while exchanging the code: the code was used or expired.
  Authorize again with `scope=read,activity:read_all,profile:read_all` and exchange the new code at once
  (`node scripts/strava-auth.js` in `services/loop-ingest`). Leave every scope ticked on the consent
  screen; without `profile:read_all` bikes and shoes stay empty.
- Then pull it locally: `npm run sync:strava` (or the full `npm run sync`).
- A long history fills in over a few runs: the first pull stores each page of 100 activities as it
  arrives, and when Strava's rate limit (`rateLimited: true` in `docker compose logs loop-ingest`) stops
  it, the next run (every `STRAVA_SYNC_MINUTES`) continues from the newest stored activity.

## The food log or the "+" sheet cannot reach the server

**Check**

- Are you on the home network, opening the page from loop-web (`http://<server-ip>:8090`)? The food log
  is LAN only and does not work from the local file.
- `curl -s -H 'X-HC-Food: 1' localhost:8090/api/food/products` — should list products. Without the
  header it answers `403`.
- `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: <the name you use>' localhost:8090/` — `421`
  means that host name is not allowed.

**Fix**

- IP addresses work out of the box. To open the page by name (`plan.lan` or a tunnel host), add the
  name to `PLAN_WEB_EXTRA_HOSTS` in `services/loop-web/.env` **and** to `FOOD_ALLOWED_HOSTS` in
  `services/loop-ingest/.env`, then `docker compose up -d` in both folders.

## The build fails on a fresh clone

**Check**

- The error line: `build-web: <file> not found.` names the missing input.
- `node -v` — needs v22.12 or newer.

**Fix**

- Copy the seeds: `data/nutrition/plan-data.example.json` → `plan-data.json` (optionally
  `data/training/training-data.example.json` → `training-data.json` and `profile/profile.example.json`
  → `profile.json`), then `npm ci && npm run generate`.
- Just want to look? `npm run build:example` builds the demo page from synthetic data, no personal files.

## A second install shows the other person's data, or the wrong port

**Check**

- `docker ps` — each install needs its own containers (`loop-ingest-second`, `loop-web-second`, …).
- `HC_INSTANCE` and `INGEST_PORT` in that clone's `services/loop-ingest/.env`, and `HC_INSTANCE`,
  `PLAN_WEB_PORT`, `INGEST_PORT` in its `services/loop-web/.env`.

**Fix**

- Give the second clone its own name and ports in both `.env` files (for example `HC_INSTANCE=second`,
  `INGEST_PORT=8089`, `PLAN_WEB_PORT=8091`), then `docker compose up -d` in both folders. `npm run sync`
  and `refresh.sh` read `INGEST_PORT` from the clone's own ingest `.env`.
- Rename that install's systemd units (`loop-web-refresh-second.path` / `.service`) so they do not
  replace the first install's, and stagger the cron minutes on a small host.

## Containers are down, unhealthy, or out of date after an update

**Check**

- `docker compose ps` in `services/loop-ingest` and in `services/loop-web`.
- `curl -s localhost:8088/healthz` — `200` when the database answers; `degraded: true` only concerns
  Strava (see above).

**Fix**

- After pulling new code on `main` (`git -C /path/to/loop pull`), rebuild the ingest service
  (`docker compose up -d --build` in `services/loop-ingest`; it applies new database migrations) and
  restart loop-web (`docker compose up -d` in `services/loop-web`). `refresh.sh` reinstalls npm packages
  on its own when the lockfile changed.
- A container that will not start: `docker compose logs` in its folder. The ingest service refuses to
  start with an `INGEST_TOKEN` shorter than 32 characters, and with `migration <file> was changed after it
  was applied` when a file under `services/loop-ingest/sql/` was edited after it ran: restore it
  (`git checkout -- services/loop-ingest/sql/<file>`) and put the change in a new migration
  ([`services/loop-ingest/README.md` → Database migrations](../../services/loop-ingest/README.md#database-migrations)).
- loop-web restarting with `bind() to 0.0.0.0:80 failed (13: Permission denied)` (a Docker older than 20.10):
  add `NET_BIND_SERVICE` to `cap_add` in `services/loop-web/docker-compose.yml`. Another `Permission denied`
  or `Read-only file system` in a container's logs after the hardening: report it with that log line.
- `docker compose up` stops with `set INGEST_PORT in services/loop-ingest/.env`: add `INGEST_PORT=8088` (or
  your port) to that file; it is required, so the port is never left to chance.
- **Docker ignores ufw** (and firewalld): a published port is reachable from every network the host is on,
  whatever the firewall says. On a host with a public address (a VPS, a router-exposed machine), set
  `INGEST_BIND` in `services/loop-ingest/.env` and `PLAN_WEB_BIND` in `services/loop-web/.env` to the LAN IP
  (or `127.0.0.1` for ingest when only this host uses it), then `docker compose up -d` in each folder.
- The page or the API answers `429`: nginx's rate limit on the proxied routes (generous; see
  [`services/loop-web/README.md`](../../services/loop-web/README.md) → Rate limits); a script looping on
  `/api/*` is the usual cause.

## Still stuck?

- [LAN services reference](../lan-services.md) — the sync protocol, error codes and security.
- [iOS Shortcut](../ios-shortcut.md) — every payload key, Gotchas and Verify.
- [loop-web README](../../services/loop-web/README.md) — install steps, smoke test, second install.
- [loop-ingest README](../../services/loop-ingest/README.md) — endpoints, Strava, configuration.
