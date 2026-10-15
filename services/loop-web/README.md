# loop-web

Serves the personal plan page (`web/dist/personal/index.html`) on the LAN with
nginx, and refreshes it hourly (cron) or on demand (the page's **Sync** button,
or the iOS Shortcut).

**Installing it?** [Install (host)](#install-host) comes first, right below; the sections after it explain how
it works.

| File | Role |
| ---- | ---- |
| `refresh.sh` | Sync data, rebuild, publish into `./site`, write `site/status.json` |
| `docker-compose.yml` | nginx serving `./site` (read-only) and proxying a few exact ingest routes over the ingest stack's `loop-net` network |
| `nginx.conf.template` | nginx config, rendered at container start (the Host map from `PLAN_WEB_EXTRA_HOSTS`) |
| `systemd/loop-web-refresh.path` | Watches the ingest trigger file |
| `systemd/loop-web-refresh.service` | Runs `refresh.sh` (as the repo owner, hardened) when it changes |
| `.env.example` | Every variable `docker-compose.yml` reads, commented out (all optional): copy it to `.env` to set one |

| Variable | Meaning |
| -------- | ------- |
| `PLAN_WEB_PORT` | Host port of the page, default `8090` |
| `PLAN_WEB_BIND` | Optional host address to publish `PLAN_WEB_PORT` on (the LAN IP; an IPv6 address in brackets). Empty = every address, as before. **Docker ignores ufw**: see [Security and exposure model](#security-and-exposure-model) |
| `PLAN_WEB_EXTRA_HOSTS` | Extra host names the page may be reached by, besides IP literals and `localhost` ([DNS rebinding and the Host allowlist](#security-and-exposure-model)) |
| `HC_INSTANCE` | A second install on the same host ([Running a second install](#running-a-second-install-another-person-same-host)) |

`./site` (including `./site/manuales/`, the published device manuals),
`.refresh.lock`, `.refresh-state` and the ingest `trigger/` directory are
gitignored.

## Install (host)

### Before you start

| You need | Why |
| --- | --- |
| **A Linux machine that stays on** (a home server or a mini PC) | It hosts the page and the food log for your whole home network |
| **Docker with the compose plugin** (`docker compose version` works) | Both services run in containers |
| **systemd and `sudo`** (any mainstream distro) | The on-demand refresh (the page's Sync button) is a systemd path unit |
| **`flock`** (package `util-linux`, preinstalled on Linux) | `refresh.sh` uses it so two refreshes never overlap |
| **Node.js `>=22.12` and `git` on the host** | `refresh.sh` runs `npm ci` and the build on the host, not in a container |

**macOS / Windows:** not supported as the host. `refresh.sh` needs `flock` and the Sync button needs systemd.
On a Mac you can still use Level 1 (the page as a local file); run Level 2 on a small Linux box instead.

Replace `/path/to/loop` with your clone's absolute path and `REPO_OWNER` with the user that owns the
clone (run `whoami` as that user). Run every step as that user unless it says `sudo`. Follow the steps **in
order**: steps 0–1 must happen before the first `docker compose up`.

0. **Secrets file for the ingest service** (generated in place; never paste the values anywhere):

   ```sh
   cd /path/to/loop/services/loop-ingest
   cp -n .env.example .env && chmod 600 .env
   sed -i.tmp "s/^INGEST_TOKEN=.*/INGEST_TOKEN=$(openssl rand -hex 32)/; s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env && rm .env.tmp
   grep -c 'replace-me' .env   # must print 0
   ```

   `INGEST_TOKEN` is the token the iOS Shortcut sends later; every other variable is documented in
   [`../loop-ingest/README.md`](../loop-ingest/README.md).

1. **Create the two shared directories first.** If they do not exist, `docker compose up` creates them owned
   by root, and then the container (trigger) or `refresh.sh` (site) cannot write them:

   ```sh
   mkdir -p /path/to/loop/services/loop-ingest/trigger /path/to/loop/services/loop-web/site
   sudo chown 1000:1000 /path/to/loop/services/loop-ingest/trigger   # the ingest container's node user
   ```

   `site/` stays owned by you (`REPO_OWNER`): `refresh.sh` writes it, nginx only reads it.

2. **Start the ingest service** (the first run builds the image and creates the database; later runs also apply
   new `sql/*.sql` migrations, idempotent):

   ```sh
   cd /path/to/loop/services/loop-ingest && docker compose up -d --build
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8088/healthz   # 200
   ```

   It also creates the Docker network `loop-net` that loop-web joins in step 5, so this stack always starts
   first ([Network and bind address](../../docs/lan-services.md#network-and-bind-address)).

3. **First `npm ci` by hand**, as the repo owner (a cold install can take
   minutes; the unit's timeout is meant for incremental reinstalls):

   ```sh
   cd /path/to/loop && npm ci --no-audit --no-fund
   ```

4. **Verify the checkout is `main`** (otherwise every run only writes the
   `branch` code):

   ```sh
   git -C /path/to/loop rev-parse --abbrev-ref HEAD   # main
   ```

5. **Start loop-web** (nginx). It reaches the ingest service as `loop-ingest:8088` on the `loop-net` network
   step 2 created, whatever the ingest host port or `INGEST_BIND` (`cp -n .env.example .env` gives a template
   with every optional variable):

   ```sh
   cd /path/to/loop/services/loop-web && docker compose up -d
   ```

   `network loop-net declared as external, but could not be found` means the ingest stack is not up: run step 2
   first.

6. **Build the first page by hand** (until now `site/` is empty, so there is no page yet):

   ```sh
   /path/to/loop/services/loop-web/refresh.sh
   cat /path/to/loop/services/loop-web/site/status.json   # a commit and no "error"
   ```

7. **Hourly rebuild (cron).** Add one line to the repo owner's crontab (`crontab -e`):

   ```cron
   0 * * * * /path/to/loop/services/loop-web/refresh.sh >/dev/null 2>&1
   ```

8. **On-demand refresh (the Sync button): install the systemd units** (fill in both placeholders):

   ```sh
   for u in loop-web-refresh.path loop-web-refresh.service; do
     sed -e 's#/path/to/loop#/your/absolute/clone#g' -e 's#REPO_OWNER#youruser#g' \
       /path/to/loop/services/loop-web/systemd/$u \
       | sudo tee /etc/systemd/system/$u >/dev/null
   done
   sudo systemctl daemon-reload
   sudo systemctl enable --now loop-web-refresh.path
   ```

   If `node`/`npm` are not in `/usr/local/bin` or `/usr/bin`, add an
   `Environment=PATH=...` line to the service (see the comment in the unit).

9. **Smoke test** end to end:

   ```sh
   curl -s -X POST localhost:8090/api/sync         # 202 {"ok":true,"seq":N,"coalesced":false,...}
   curl -s localhost:8090/api/sync/status          # triggerSeq N, codes only
   curl -s -H 'X-HC-Food: 1' localhost:8090/api/food/products   # {"products":[...]}
   curl -s -o /dev/null -w '%{http_code}\n' localhost:8090/api/food/products   # 403 without the header
   curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' localhost:8090/   # 421: not an allowed Host
   journalctl -u loop-web-refresh.service -f       # refresh.sh output
   cat /path/to/loop/services/loop-web/site/status.json   # processedSeq >= N
   ```

10. **Open it from your phone.** On the same Wi-Fi, browse to `http://<server-ip>:8090` (find the IP with
    `hostname -I`). IP addresses work out of the box; to use a name such as `plan.lan`, add it to
    `PLAN_WEB_EXTRA_HOSTS` in `services/loop-web/.env` **and** `FOOD_ALLOWED_HOSTS` in the ingest `.env`, then
    `docker compose up -d` in both. Add the page to the home screen (Share → *Add to Home Screen*).

loop-web never uses the ingest host port: the sync scripts on the host do (`http://localhost:<INGEST_PORT>`), so
`INGEST_BIND=127.0.0.1` in `services/loop-ingest/.env` is the recommended hardening
([Network and bind address](../../docs/lan-services.md#network-and-bind-address)).

### Running a second install (another person, same host)

Each person gets their own clone, database, token, page and Shortcut; nothing is shared. On the same host,
pick a name (`second` below) and two free ports (8089 for the ingest service, 8091 for the page), then:

1. **Clone again** next to the first one and install: `git clone <repo-url> /path/to/loop-second`,
   `cd` into it, `npm ci`.
2. **Follow Install (host) steps 0–10 in the new clone**, with these values:
   - `services/loop-ingest/.env` (after step 0): add `HC_INSTANCE=second` and set `INGEST_PORT=8089`.
   - `services/loop-web/.env` (new file, before step 5):

     ```sh
     printf 'HC_INSTANCE=second\nPLAN_WEB_PORT=8091\n' > services/loop-web/.env
     ```

   - Step 7 (cron): the new clone's path.
   - Step 8 (systemd): rename the units so they do not replace the first install's:

     ```sh
     for u in path service; do
       sed -e 's#/path/to/loop#/path/to/loop-second#g' -e 's#REPO_OWNER#youruser#g' \
           -e 's#loop-web-refresh\.service#loop-web-refresh-second.service#g' \
         services/loop-web/systemd/loop-web-refresh.$u | sudo tee /etc/systemd/system/loop-web-refresh-second.$u >/dev/null
     done
     sudo systemctl daemon-reload && sudo systemctl enable --now loop-web-refresh-second.path
     ```

   - Smoke test and phone: port **8091** instead of 8090 (`curl` the ingest on **8089**).
3. **Check nothing collided:** `docker ps` lists `loop-db-second`, `loop-ingest-second` and
   `loop-web-second` next to the first install's containers, and each `site/status.json` shows its own build.

`HC_INSTANCE` suffixes the compose project, the container names, the database volume
(`loop-db-data-second`) and the network (`loop-net-second`, so each page proxies only to its own service); left empty, the names are the plain ones, so the first install is
untouched. The sync scripts (`npm run sync`, `refresh.sh`) read `INGEST_PORT` from the clone's own
`services/loop-ingest/.env`, so each clone only ever reads its own service. Every install runs its own
hourly build: on a small host (2 CPU / 4 GB) stagger the cron minutes (`0 * * * *` and `30 * * * *`).

Both installs share one data service image tag (`mralexandersaavedra/loop-ingest:<version>`): a `--build` in one clone
also replaces the image the other runs on its next `up`. Keep the clones on the same commit and update both
together, or set a different `HC_VERSION` in the second one's `services/loop-ingest/.env` (e.g. `1.0.0-second`)
when it must build its own.

## How a refresh works (sequence protocol)

Nothing compares clocks. Every accepted click gets a **sequence number**, and
the page waits until a publish covers it.

```
Sync button / Shortcut
  -> POST /api/sync (loop-web nginx) -> POST /sync (loop-ingest:8088 over loop-net)
       202 {seq, coalesced}
       1. pulls Strava now, unless the last successful pull is < 5 min old
       2. writes `seq` atomically to services/loop-ingest/trigger/refresh
  -> systemd loop-web-refresh.path (PathModified) -> loop-web-refresh.service
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
  covers the 60 s delay plus the rebuild. The service never refuses a click; only nginx's rate limit
  (10 r/s, burst 60) answers `429` to a runaway client.
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

Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
and `Content-Security-Policy: frame-ancestors 'none'` (no other site can frame the page that writes your food
log), `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin` (no other
origin shares a window with the page or embeds its responses) and `Permissions-Policy: camera=(),
microphone=(), geolocation=(), payment=(), usb=()` (the page uses none of them), and nginx hides its version
(`server_tokens off`); a block with its own `add_header` repeats the set (`scripts/loop-web-config.test.mjs`).

**Docker ignores ufw.** A port Docker publishes is opened in Docker's own firewall chains, ahead of ufw or
firewalld rules, so a "deny" there does not protect it: both services are reachable from every network the
host is on. On a home server behind a router that is the LAN; on a host with a public address (a VPS, a
machine in the router's DMZ) set the binds: `PLAN_WEB_BIND=192.168.1.10` (the LAN IP) in
`services/loop-web/.env` and `INGEST_BIND=127.0.0.1` in `services/loop-ingest/.env` (loop-web reaches the service
over `loop-net`, never through that port: [Network and bind address](../../docs/lan-services.md#network-and-bind-address)), then `docker compose up -d` in each folder. Unset, both
publish on every address, as before.

**Container hardening** (`docker-compose.yml`, pinned by `scripts/loop-web-config.test.mjs`): a read-only
root filesystem with tmpfs for what nginx and its entrypoint write (`/etc/nginx/conf.d`, where the template and
the Host map are rendered, `/var/cache/nginx`, `/run`, `/tmp`); every capability dropped except `CHOWN`,
`SETUID` and `SETGID` (the master owns the workers' temp dirs and drops them to the `nginx` user; without any of
the three it does not serve); `no-new-privileges`; 128 MB / 0.5 CPU / 128 processes; logs rotated at 3 x 10 MB;
and a healthcheck on `/nginx-health`, which nginx answers itself (`docker ps` shows `healthy`). On a Docker
older than 20.10 a container cannot bind port 80 without `NET_BIND_SERVICE` (the logs say `bind() to
0.0.0.0:80 failed (13: Permission denied)`): add it to `cap_add` there.

**Rate limits** (`limit_req`, per client address, `429` over the burst): the proxied `/api/sync`,
`/api/sync/status`, `/api/food/*` and `/api/journal/*` share 10 requests/s with a burst of 60, and
`/ingest/health-auto-export` gets 60/min with a burst of 20. The page itself, `status.json` and `/manuales/` are
never limited. Behind an SSO tunnel every request arrives from the tunnel's address, so it is one shared
budget, still far above one person's use.

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
`/food/*` (plus the `Origin` of writes, which must be exactly the host and port
the browser asked nginx for, forwarded as `X-Forwarded-Host`) as defence in depth.

To reach the page by a name too (e.g. `http://plan.lan:8090`):

1. add `PLAN_WEB_EXTRA_HOSTS=plan.lan` (comma / space separated for several) to
   `services/loop-web/.env`, then `docker compose up -d` here; `hosts.sh`
   (mounted as `/docker-entrypoint.d/15-hc-hosts.sh`) turns each valid name into
   one exact map entry and skips anything else with a warning in the logs;
2. add the same names as `FOOD_ALLOWED_HOSTS=plan.lan` to
   `services/loop-ingest/.env` and `docker compose up -d loop-ingest`
   there, or the food log refuses writes whose `Origin` is that name.

Only list names you control on your own network (a local DNS / hosts entry);
never a public domain someone else can point anywhere.

What each proxy may forward:

| Proxy | Forwards | Never |
| ----- | -------- | ----- |
| **loop-web nginx** (this service) | `POST /api/sync` -> `/sync`, `GET /api/sync/status` -> `/sync/status`, `POST /ingest/health-auto-export` -> the same path (bearer checked by ingest, 8 MB, ingest's `MAX_BODY_BYTES` default) (exact match, method restricted); `/api/food/*` -> `/food/*` (GET / POST / PUT / DELETE, 16 KB, `X-HC-Food` forwarded); `/api/journal/*` -> `/journal/*` (GET / PUT, 16 KB, `X-HC-Journal` forwarded) | anything else under `/api/` (beyond these four) or `/ingest/` (404), `/export`, `/sync/strava` |

There is no second proxy: loop-ingest's port stays on the LAN (published for loop-web, never forwarded to the
internet), and a public entry (an SSO tunnel) points at loop-web. `POST /ingest/health-auto-export` is here so the iOS Shortcut can reach ingest
through loop-web when loop-web is the public entry and ingest is not exposed at
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
referenced files into `./site/manuales/` (after `status.json`, under a 30 s
timeout, `PLAN_WEB_MANUALS_TIMEOUT`) and deletes anything else there:
a regular file directly in `data/gear/` (a symlink is refused), starting
with `%PDF-`, at most 50 MB. A missing or refused file is a warning; a failure
never blocks the page. nginx serves exactly `/manuales/<name>.pdf` (the same
name pattern) as `application/pdf`, `Content-Disposition: inline`,
`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none';
object-src 'self'` (`sandbox` would block the built-in PDF viewer), GET / HEAD only, no listing; everything
else under `/manuales/` is a 404, and the Host allowlist and raw-path guard
apply as for every path. The page shows the link only after a `HEAD` of the
file answers 200, so the claude.ai artifact and `file://` show nothing.
Rollout: `docker compose up -d` here (new nginx location), then the next
refresh (or `npm run publish:manuals` by hand) publishes the files.

### Exposing behind an SSO tunnel

To reach the page from outside the LAN without opening the ingest service:

1. **One HTTP resource** in the tunnel: `https://<your-host>` -> loop-web
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
   `services/loop-web/.env` and to `FOOD_ALLOWED_HOSTS` in
   `services/loop-ingest/.env`, then `docker compose up -d` in both (see the
   Host allowlist above; without it every request gets `421`).
4. **Point the Shortcut** at `https://<your-host>/ingest/health-auto-export` and
   `https://<your-host>/api/sync` (`docs/ios-shortcut.md`, "Through loop-web").

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

## The service user and the hardening, and their tradeoffs

- **`User=REPO_OWNER`**: the build runs as the user that owns the clone, the
  same one as the cron job. Use `root` only when the clone itself is
  root-owned. Running as the repo owner is also why `refresh.sh` needs no git
  `safe.directory` override (git only complains about a repo owned by another user).
- **`ProtectSystem=strict` + `ReadWritePaths=<clone>`**: the whole filesystem is
  read-only except the clone, which the build writes (`node_modules`, the
  extract CSVs, `web/dist`, `./site`). Tradeoff: a tool that writes somewhere
  else fails with `EROFS`; add that path to `ReadWritePaths`.
- **`ProtectHome=read-only`**: home directories stay readable (node/npm installed
  with nvm keep working) but not writable; a clone that lives in a home
  directory is still writable through `ReadWritePaths`. npm gets a writable
  cache through `CacheDirectory=` (`/var/cache/loop-web-refresh`), and Astro
  telemetry / npm update checks are off so nothing writes to `$HOME`. If your
  setup needs a writable home, drop `ProtectHome` rather than the other
  settings.
- **`NoNewPrivileges=yes`, `PrivateTmp=yes`**: no setuid escalation, a private
  `/tmp`. No known downside for this build.
- **`ProtectKernelTunables`, `ProtectKernelModules`, `ProtectKernelLogs`, `ProtectControlGroups`,
  `RestrictSUIDSGID`, `LockPersonality`, `RestrictRealtime`, `RestrictNamespaces`,
  `SystemCallArchitectures=native`**: the build (git, npm, node, astro / esbuild) needs none of what these
  forbid. Checked with `systemd-analyze verify` and a transient `systemd-run` of the example build under the
  same settings. **`UMask=0022`** is explicit: nginx in the loop-web container reads `./site` as another user,
  so a stricter mask (`0027`) would make the page answer `403`. `MemoryDenyWriteExecute` is deliberately not
  set (node's JIT needs writable, executable memory). To pick up these settings on an installed unit, copy
  the template again (Install step 8 fills the placeholders) and `sudo systemctl daemon-reload`.
- **`ProtectClock`, `ProtectHostname`, `PrivateDevices` (a private `/dev` with only `null`, `zero`,
  `random`, ...), `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`**:
  the build sets no clock or hostname, opens no device and talks only to local sockets, loop-ingest, the npm
  registry and the git remote. There is deliberately no `CapabilityBoundingSet=`: a unit running as root on a
  clone whose directories belong to another user needs `CAP_DAC_OVERRIDE` to create files there (the atomic
  writes of `generate` and the syncs), and as the repo owner the build holds no capability anyway. Tradeoff: without `AF_NETLINK`
  node's `os.networkInterfaces()` throws (`Unknown system error 97`); the example build passes under these
  settings (`systemd-run`), but if a tool fails that way, add `AF_NETLINK` to the list. npm install scripts stay on (astro /
  esbuild fetch their native binary in one), so there is no `--ignore-scripts`.
