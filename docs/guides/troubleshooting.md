# Troubleshooting

Fixes for the common problems when you run the LOOP server at home. Each section names a symptom, what to
**check** (1–3 places or commands), and the **fix**. Commands assume a server installed from the images
([`README.md` → Setup](../../README.md#setup)), run in the folder holding its `docker-compose.yml`, with the default
ports (page 8090, data service 8088). An older host-mode install (the services run from a clone at
`/path/to/loop`) differs where a **Host mode** line says so.

## The page shows old data, or a source is amber / red

**Check**

- Tap the dot in the top bar: it lists the age of each source ("Atajo", "Strava", "Página"). Amber means
  older than 24 h, red older than 72 h.
- `curl -s http://<server-ip>:8090/status.json` — `publishedAt` and `commit` are the last good build; an `error`
  field means the last run stopped early (next section). Host mode: `cat /path/to/loop/services/loop-web/site/status.json`.
- `docker compose exec loop-server cat /data/extract/_meta.json` — `exportLastDate` is a partial day;
  `shortcutSync.owned` lists the dates the Shortcut wrote (in a coach clone or host mode: `loop-data/extract/_meta.json`).

**Fix**

- Press **Sync** on the page, or wait for the hourly rebuild.
- If only "Atajo" is old, the phone has not sent anything: see "The Shortcut runs but nothing arrives".
- If only "Strava" is old, see "Strava stays empty".
- In a coach clone, `npm run sync` pulls the server's latest data (host mode or local only: `npm run sync` then
  `npm run generate`).

## The Sync button does nothing or shows "No se pudo actualizar"

**Check**

- `curl -s http://<server-ip>:8090/api/sync/status` — `lastTriggerError` names what failed on the data service side.
- The `error` code in `status.json` (above): `build`, `sanity` or `lock` (host mode adds `branch` and `install`).
- `docker compose logs -f loop-server` while you press Sync (the build's output). Host mode:
  `journalctl -u loop-web-refresh.service -f` (the `refresh.sh` output).

**Fix**

- `build` / `sanity`: the log names the step that failed. A failed build keeps the last good page online.
- `lock`: another refresh was still running; press Sync again in a minute.
- No Sync button or freshness dot at all: the page cannot reach `/api/sync/status` (opened as a file,
  the example build, or the data service is down). That is expected outside the LAN page.
- **Host mode:**
  - `branch`: only `main` is published. Check with `git -C /path/to/loop rev-parse --abbrev-ref HEAD` and switch
    back to `main`; do feature work in a separate git worktree.
  - `trigger_write`: the trigger directory must belong to the container user:
    `sudo chown 1000:1000 /path/to/loop/services/loop-ingest/trigger`.
  - Nothing happens at all: the systemd path unit is missing or stopped.
    `sudo systemctl enable --now loop-web-refresh.path` (install steps in the loop-web README, step 8).
  - `install` / `build`: run `/path/to/loop/services/loop-web/refresh.sh` by hand and read the error.

## The Apple Health export in `files/import/` is not imported

**Check**

- `docker compose exec loop-server cat /data/import-state.json` — `file`, `importedAt` and `exportLastDate` of the
  last import; a `lastError` with its `code` when the newest file failed.
- `docker compose logs loop-server | grep import:health` — one line per attempt.

**Fix**

- No state file and `no import folder` in the log: the zip is not in the files folder the server reads
  (`HC_FILES_LOCATION` in `.env`, default `./files`, so `files/import/` next to `docker-compose.yml`). Press
  **Sync** after copying it (or wait for the hourly run).
- `corrupt`, `truncated` or `no-export`: the zip was damaged or still being copied; export again from the iPhone and
  copy it again (it is retried on the next run).
- `too-large`: the export is over `HC_IMPORT_MAX_BYTES` (10 GiB by default); raise it in `.env`, then
  `docker compose up -d`. A first import that times out: raise `HC_IMPORT_TIMEOUT` (seconds) the same way.
- A zip the container cannot read (copied with mode `600` by another user; the server runs as the image's `node`
  user, uid 1000): `chmod 644 files/import/<the zip>`, then press **Sync**.
- To import the same zip again: `docker compose exec loop-server npm run import:health -- --force`.

## The Shortcut runs but nothing arrives

**Check**

- The Shortcut's URL: `http://<server-ip>:8090/ingest/health-auto-export` (or
  `https://<your-host>/ingest/health-auto-export` behind a tunnel). Any other `/ingest/*` path is a 404.
- The response: `202` means stored; `401` means the token does not match (the service logs each one as
  `"event":"unauthorized"` with a running `count`, never the token); `400` with `"code":"nul_character"`
  means the payload holds a `\u0000` character, which the database cannot store.
- `curl -s localhost:8088/sync/status` — `lastShortcutAt` should move after each run.
- An error on the iPhone itself ("Puedes permitir su ejecución en Ajustes", "No se ha encontrado ninguna
  muestra"): [`docs/ios-shortcut.md` → Troubleshooting](../ios-shortcut.md#troubleshooting).

**Fix**

- `401`: the `Authorization` header must be `Bearer <INGEST_TOKEN>`; on the server,
  `grep '^INGEST_TOKEN=' .env` and copy it on your own screen (host mode: `services/loop-ingest/.env`).
- Keys are empty: check the *Source is* (*Origen es*) filters name **your** devices, one search per
  device (two filters in one search are combined with AND and return nothing).
- A type is missing from the list: iOS 26 renamed some (Active Energy → *Active Calories*, Resting
  Energy → *Resting Calories*); VO2 max is *Cardio Fitness*.
- Runs at night send nothing: Health data is locked while the phone is locked. Trigger the automation
  on opening an app you use daily.
- Very large payloads: loop-web and the service accept up to 8 MB on that path. Shorten the heart-rate window (1 day).
- New keys never show up (host mode or a local-only clone): run `npm run sync -- --full` once.

## Strava stays empty

**Check**

- `curl -s localhost:8088/sync/status` — `stravaConfigured` must be `true`; `lastStravaOkAt` should have
  a time; `lastStravaError` shows a code (`strava_auth`, `strava_network`, `strava_other`,
  `strava_token_save`).
- `curl -s localhost:8088/healthz` — `degraded: true` means the last successful pull is over 6 h old or
  never happened.

**Fix**

- `stravaConfigured: false`: fill `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` and `STRAVA_REFRESH_TOKEN`
  in `.env`, then `docker compose up -d` (host mode: `services/loop-ingest/.env`, `docker compose up -d` in that folder).
- `strava_auth`, or `401` / `invalid_grant` while exchanging the code: the code was used or expired.
  Authorize again with `scope=read,activity:read_all,profile:read_all` and exchange the new code at once:
  `docker compose exec loop-server node services/loop-ingest/scripts/strava-auth.js --print`, then put the printed
  line in `.env` and `docker compose up -d` (host mode: `node scripts/strava-auth.js` in `services/loop-ingest`).
  Leave every scope ticked on the consent screen; without `profile:read_all` bikes and shoes stay empty.
- Then press **Sync** (a coach clone: `npm run sync`).
- A long history fills in over a few runs: the first pull stores each page of 100 activities as it
  arrives, and when Strava's rate limit (`rateLimited: true` in `docker compose logs loop-server`) stops
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
  name to both `PLAN_WEB_EXTRA_HOSTS` and `FOOD_ALLOWED_HOSTS` in `.env`, then `docker compose up -d` (host mode:
  the first in `services/loop-web/.env`, the second in `services/loop-ingest/.env`, `docker compose up -d` in both
  folders).

## A coach clone does not get the server's data

**Check**

- `npm run sync` prints `Client mode: ...` and a `Mirror: ...` line when it reaches a server from the images.
- An `ERROR: ... (HTTP 401)` line: the clone's `INGEST_TOKEN` is not the server's.
- A connection error: the clone cannot reach `INGEST_URL`.

**Fix**

- `401`: set `INGEST_TOKEN` to the value in the server's `.env`.
- From another computer, the data port must be on the LAN: `INGEST_BIND` in the server's `.env` defaults to
  `127.0.0.1` (loopback only); set it to the server's LAN IP and run `docker compose up -d` there
  ([Network and bind address](../lan-services.md#network-and-bind-address)), or run the coach on the server itself
  with `INGEST_URL=http://127.0.0.1:8088`.
- More cases (an empty manifest, too many removals): [`docs/data-pipeline.md` → Coach as a client](../data-pipeline.md#coach-as-a-client-of-a-loop-server).

## The build fails on a fresh clone

**Check**

- The error line: `build-web: <file> not found.` names the missing input.
- `node -v` — needs v22.12 or newer.

**Fix**

- Copy the seeds (`mkdir -p loop-data/cache` first; `loop-data/` is the gitignored data root): `data/nutrition/plan-data.example.json` → `loop-data/cache/plan.json` (optionally
  `data/training/training-data.example.json` → `loop-data/cache/training.json` and `profile/profile.example.json`
  → `loop-data/cache/profile.json`), then `npm ci && npm run generate`.
- Just want to look? `npm run build:example` builds the demo page from synthetic data, no personal files.

## A second install shows the other person's data, or the wrong port

**Check**

- `docker ps` — each install needs its own containers (`loop-server-second`, `loop-web-second`, …).
- `HC_INSTANCE`, `INGEST_PORT` and `PLAN_WEB_PORT` in that install's `.env`.
- `docker network ls --filter name=loop-net`: one network per install.

**Fix**

- Give the second install its own folder, name and ports in its `.env` (for example `HC_INSTANCE=second`,
  `INGEST_PORT=8089`, `PLAN_WEB_PORT=8091`), then `docker compose up -d` there
  ([`docs/lan-services.md` → A second install](../lan-services.md#a-second-install)).
- **Host mode:** the same `HC_INSTANCE` in both of the clone's `.env` files (`services/loop-ingest/.env` with
  `INGEST_PORT`, `services/loop-web/.env` with `PLAN_WEB_PORT`; it names the `loop-net-<name>` network the page
  proxies over), `docker compose up -d` in both folders, the ingest one first; `npm run sync` and `refresh.sh` read
  `INGEST_PORT` from the clone's own ingest `.env`. Rename that install's systemd units
  (`loop-web-refresh-second.path` / `.service`) so they do not replace the first install's, and stagger the cron
  minutes on a small host.

## Containers are down, unhealthy, or out of date after an update

**Check**

- `docker compose ps` (host mode: in `services/loop-ingest` and in `services/loop-web`).
- `curl -s localhost:8088/healthz` — `200` when the database answers; `degraded: true` only concerns
  Strava (see above).

**Fix**

- Out of date: [`upgrading.md`](upgrading.md) (`docker compose pull && docker compose up -d`, after a backup).
- `loop-web` is not started: it waits until `loop-server` is healthy; `docker compose logs loop-server` says why it
  is not.
- A container that will not start: `docker compose logs <container>`. The data service refuses to start with an
  `INGEST_TOKEN` shorter than 32 characters, with `invalid <NAME>=...` when a numeric variable
  (`STRAVA_SYNC_MINUTES`, `MAX_BODY_BYTES`, `PORT`) is set to something that is not a plain number in range, and with
  `migration <file> was changed after it was applied` when a file under `services/loop-ingest/sql/` was edited after
  it ran (a clone only): restore it (`git checkout -- services/loop-ingest/sql/<file>`) and put the change in a new
  migration ([`services/loop-ingest/README.md` → Database migrations](../../services/loop-ingest/README.md#database-migrations)).
- `docker compose up` stops with `set INGEST_PORT in docker/.env`: add `INGEST_PORT=8088` (or your port) to `.env`;
  it is required, so the port is never left to chance (host mode: `set INGEST_PORT in services/loop-ingest/.env`).
- loop-web restarting with `bind() to 0.0.0.0:80 failed (13: Permission denied)` (a Docker older than 20.10):
  add `NET_BIND_SERVICE` to loop-web's `cap_add` in `docker-compose.yml`. Another `Permission denied` or
  `Read-only file system` in a container's logs: report it with that log line.
- **Docker ignores ufw** (and firewalld): a published port is reachable from every network the host is on,
  whatever the firewall says. On a host with a public address (a VPS, a router-exposed machine), keep
  `INGEST_BIND=127.0.0.1` and set `PLAN_WEB_BIND` to the LAN IP in `.env`, then `docker compose up -d`
  ([`docs/lan-services.md` → Network and bind address](../lan-services.md#network-and-bind-address)).
- The page or the API answers `429`: nginx's rate limit on the proxied routes (generous; see
  [`services/loop-web/README.md`](../../services/loop-web/README.md) → Rate limits); a script looping on
  `/api/*` is the usual cause.
- **Host mode:**
  - After pulling new code on `main` (`git -C /path/to/loop pull`), rebuild the ingest service
    (`docker compose up -d --build` in `services/loop-ingest`; it applies new database migrations) and
    recreate loop-web (`docker compose up -d --force-recreate` in `services/loop-web`). `refresh.sh` reinstalls npm
    packages on its own when the lockfile changed.
  - `loop-db` stops with `could not find a network matching network mode loop-ingest_default` after an update:
    the update that moved the services to `loop-net` needs `docker compose up -d --build --force-recreate` in
    `services/loop-ingest` once ([upgrading](upgrading.md)).
  - loop-web stops with `network loop-net declared as external, but could not be found`: start the ingest stack
    first (`docker compose up -d` in `services/loop-ingest` creates the network), then loop-web. The page loads but
    Sync, the food log and the journal answer `502` / `504`: the ingest container is down or not on `loop-net`
    (`docker network inspect loop-net` lists both containers).
  - On a host with a public address: `INGEST_BIND=127.0.0.1` in `services/loop-ingest/.env` (loop-web does not use
    that port) and `PLAN_WEB_BIND` in `services/loop-web/.env`, then `docker compose up -d` in each folder.

## Still stuck?

- [LOOP server reference](../lan-services.md) — the images, the sync protocol, error codes and security.
- [iOS Shortcut](../ios-shortcut.md) — every payload key, Gotchas, Troubleshooting and Verify.
- [loop-ingest README](../../services/loop-ingest/README.md) — endpoints, Strava, configuration.
- [loop-web README](../../services/loop-web/README.md) — host mode: install steps, smoke test, second install.
