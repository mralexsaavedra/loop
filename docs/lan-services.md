# LAN page + on-demand refresh

`services/loop-web` + `services/loop-ingest`: sync trigger protocol, refresh.sh, freshness line, security and exposure, health + tokens.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

## LAN page + on-demand refresh — `services/loop-web` + `services/loop-ingest`

Besides opening the built file locally, `services/loop-web` serves `web/dist/personal/index.html` on the LAN
(nginx, `./site` only), gzipped (server level: the page, CSS / JS / JSON, ≥ 1 KB, level 5, `Vary`;
the five proxied ingest routes (`/api/sync`, `/api/sync/status`, `/api/food/`, `/api/journal/`,
`/ingest/health-auto-export`) are `gzip off` — their responses reflect request input next to stored
data, a BREACH-style oracle; pinned by `scripts/loop-web-config.test.mjs`; rollout `docker compose
up -d` in `services/loop-web`). `refresh.sh` rebuilds and publishes it hourly (cron) AND on demand, under a
**sequence protocol** (no clock comparison anywhere):

- **Trigger and sequence protocol.** The page's Sync button and the
  Shortcut's last step `POST <page address>/api/sync` (loop-web nginx) → loop-ingest `POST /sync`, which numbers
  the click (`trigger_seq`), pulls Strava (at most once per 5 min) and writes the seq atomically to
  `services/loop-ingest/trigger/refresh`; a systemd path unit runs `refresh.sh`, which publishes `processedSeq`
  in `site/status.json`, and the page reloads once that covers its seq. Clicks coalesce (the service never
  refuses or drops one, only nginx's rate limit answers `429` to a runaway client; at most one rebuild per
  minute). Each side is documented once:
  - service side (seq persistence, coalescing and deferred writes, shutdown and crash recovery, `/sync/status`):
    [`services/loop-ingest/README.md` → On-demand refresh](../services/loop-ingest/README.md);
  - host side (`refresh.sh` passes, `status.json` and its error codes, the systemd units and their hardening,
    the ordered install steps): [`services/loop-web/README.md` → How a refresh works](../services/loop-web/README.md).
- **refresh.sh** keeps its resilience rules (failed sync still rebuilds, flock, `npm ci` only on a
  lockfile change, a failed build keeps the last good page). Each pass records the trigger seq it
  started from; a successful publish writes `site/status.json` = `{publishedAt, commit, branch,
  processedSeq}` atomically (`processedSeq` never goes backwards; the last good fragment is kept in
  `services/loop-web/.refresh-state`, outside `./site`). After a pass it re-reads the trigger and runs
  again (max 3 passes) if the seq advanced, so clicks during a run are never lost. Early exits add
  `{error, errorSeq}` WITHOUT touching `publishedAt`/`processedSeq`: codes `branch` (branch guard,
  still exit 0, unless `PLAN_WEB_ALLOW_BRANCH=1`), `install`, `build`, `sanity`, `lock` (on-demand lock
  wait timed out; a cron skip is not an error). `sync` / `generate` run under `PLAN_WEB_STEP_TIMEOUT`
  (300 s), `npm ci` under `PLAN_WEB_CI_TIMEOUT` (900 s). No git `safe.directory` override (the unit
  runs as the repo owner).
- **Freshness line** (`web/src/client/freshness.js`, copy `web/src/i18n/sync-templates.mjs`, markup
  in `layouts/Plan.astro` above the nav): at view time it reads `GET /api/sync/status` and
  `/status.json`; the top bar shows a dot + the Shortcut age ("hace 5 min"), and the per-source line
  "Atajo: hace 5 min · Strava: hace 2 h · Página: hace 1 min" (> 24 h `--mid` + a short hint, > 72 h
  `--low`; the dot takes the worst level) is the summary's title / aria-label and fills the popover a
  tap on it toggles (Esc / a tap outside closes it). Sync POSTs, then polls both every 5 s: `processedSeq >= seq`
  → reload; `errorSeq >= seq` (status.json) or `lastTriggerErrorSeq >= seq` (ingest) → fail fast with
  "No se pudo actualizar: <reason>" (`errors` map; unknown code → generic reason); 5 min → "No se pudo
  actualizar, reintenta". The block ships `hidden` and stays hidden when `/api/sync/status` is
  unreachable (example build, file://, the claude.ai artifact, a clone without ingest). Nothing
  time-based is baked, so builds stay byte-identical.
- **Security + exposure.** `POST /sync` and `GET /sync/status` are UNAUTHENTICATED on purpose (a
  static page cannot hold a secret): the trigger only schedules work the services already do on a
  timer, reads no body and returns only a seq; status returns timestamps, seqs and COARSE codes
  (`strava_auth`, `strava_network`, `strava_other`, `strava_token_save`, `trigger_write`), cached 5 s,
  never health data or raw error text (messages stay in logs; tests pin the key set and no leaks).
  loop-web nginx proxies EXACTLY `/api/sync` + `/api/sync/status` (exact-match, method-restricted;
  `POST /api/sync` deliberately needs no custom CSRF header, unlike `/api/food/*` and `/api/journal/*`: a
  cross-site form can at most queue a page rebuild and a Strava pull, it reads and changes no data (the answer is
  only a sequence number) and calls within a minute coalesce, while a required header would break the iOS
  Shortcut's header-less step 5)
  plus the food log prefix `/api/food/*` → ingest `/food/*` (GET / POST / PUT / DELETE, 16 KB, the
  `X-HC-Food` header forwarded; see [`nutrition-food-log.md` → Security](nutrition-food-log.md#security)), the journal prefix `/api/journal/*` →
  ingest `/journal/*` (GET / PUT, 16 KB, the `X-HC-Journal` header forwarded; `docs/journal.md`) and EXACTLY `POST /ingest/health-auto-export`
  → the same ingest route (the iOS Shortcut upload when loop-web is the public entry and ingest is not
  exposed: `Authorization` / `Automation-Name` / `Content-Type` forwarded, no `Bearer` token → `401`
  before the body is read, ingest checks the bearer, `client_max_body_size 8m` = ingest's
  `MAX_BODY_BYTES` default, 8 MB; a payload holding `\u0000` is a `400 nul_character`, which jsonb cannot
  store); every other `/api/` or `/ingest/`
  path 404, never `/export/*` or `/sync/strava` (pinned by `scripts/loop-web-config.test.mjs`).
  Static device manuals: EXACTLY `/manuales/<MANUAL_FILE_RE>` (a quoted regex location; GET / HEAD,
  `types { }` + `default_type application/pdf`, `Content-Disposition: inline`, `X-Content-Type-Options:
  nosniff`, `Content-Security-Policy: default-src 'none'; object-src 'self'` (not `sandbox`, which
  blocks the browsers' built-in PDF viewer), `Cache-Control: no-cache` re-added since a location `add_header` drops the server one,
  `autoindex off`, `try_files $uri =404`); every other `/manuales/` path 404; NOT in any SSO bypass
  (behind the tunnel it stays behind SSO). A
  server-level guard (next to the Host check) answers `400` when the RAW path (before `?`) holds `..`,
  `%2e`, `%2f`, `%5c` (any case) or `//`, so an SSO proxy matching bypass rules on the raw path cannot
  be walked to the page (`/ingest/%2e%2e/index.html`). Behind an SSO tunnel (one resource →
  loop-web:8090), bypass SSO for exactly `/ingest/*` and `/api/sync` (EXACT, never a prefix), verify
  from outside that `/ingest/%2e%2e/status.json` does not return the file, keep `INGEST_TOKEN` (it also
  guards `/export/*`) ≥ 32 random bytes, and
  add the public host to `PLAN_WEB_EXTRA_HOSTS` + `FOOD_ALLOWED_HOSTS` (`services/loop-web/README.md`,
  "Exposing behind an SSO tunnel"). Every path
  (the page included) answers only a Host that is an IP literal, `localhost` or a name in
  `PLAN_WEB_EXTRA_HOSTS`, else `421` (DNS rebinding; how to add a name: [`nutrition-food-log.md` → Security](nutrition-food-log.md#security)).
  The ingest service itself is never exposed: loop-web is the only entry (it reaches the service over the
  `loop-net` Docker network, never through the published ingest port), and nothing forwards `/export/*`,
  `/sync/strava`, or the ingest port. Docker-published ports bypass ufw / firewalld: on a host with a public
  address set `INGEST_BIND=127.0.0.1` and `PLAN_WEB_BIND` to the LAN IP (both optional, unset = every address;
  [Network and bind address](#network-and-bind-address)). Every failed bearer check is logged as a counted
  `unauthorized` event (path, reason, client address; never the token). Response headers on every path:
  nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CSP `frame-ancestors 'none'`, COOP and
  CORP `same-origin`, and a `Permissions-Policy` turning off camera, microphone, geolocation, payment and USB.
- **Container hardening.** All three containers run read-only (tmpfs for what they write), with every
  capability dropped but the few their entrypoints need (`loop-db`: `CHOWN`, `DAC_READ_SEARCH`, `SETUID`,
  `SETGID`; `loop-web`: `CHOWN`, `SETUID`, `SETGID`; `loop-ingest`: none), `no-new-privileges`, memory / CPU /
  process limits and json-file logs rotated at 3 x 10 MB; `loop-web` has a healthcheck on `/nginx-health`
  (nginx answers it, no proxy). Details: each service's README; pinned by `scripts/loop-web-config.test.mjs`.
- **Rate limits.** nginx `limit_req` on the five proxied locations only (`429` over the burst, per client
  address): `/api/sync`, `/api/sync/status`, `/api/food/*`, `/api/journal/*` share 10 r/s, burst 60;
  `/ingest/health-auto-export` 60 r/min, burst 20. The page, `status.json` and `/manuales/` are never limited
  (pinned by `scripts/loop-web-config.test.mjs`).
- **Health + tokens.** `/healthz` stays 200 but adds `degraded: true` when Strava is configured and its
  PERSISTED last success is > 6 h old or missing (a restart does not reset it). A refresh token rotated
  by Strava is stored in `strava_token` (3 save attempts with backoff; on failure it is kept in memory,
  status shows `strava_token_save`, and the save is retried next refresh) and preferred over
  `STRAVA_REFRESH_TOKEN` (the bootstrap); a failed store read is retried next refresh; a rejected
  stored token falls back to the env one once. Concurrent callers share one in-flight token refresh. The
  activity pull walks ascending from a cursor (newest stored start − 7 days, or 0 on an empty database) and
  upserts each page of 100 as it arrives, so a first pull of a long history stopped by a `429` resumes from
  what it stored on the next run. Rolling this out needs an ingest rebuild
  (`docker compose up -d --build`, runs the idempotent `sql/003_sync.sql`).
- **HR-stream backfill.** After each successful Strava pull the loop fetches at most 10 activity HR
  streams (newest first, never more than 30 per 15 min / 300 per 24 h, counted in
  `strava_activity_hr`), stores only seconds per bpm (`hr_hist`, never the stream) and exports it on
  `GET /export/strava` for the per-workout HR zones; details and limits in
  `services/loop-ingest/README.md` ("Per-workout HR zones"). Each streams request times out after
  15 s; a 429 stops the batch, but a 5xx / timeout of one activity only skips it with a per-activity
  back-off (30 min × 2^(attempts − 1), cap 24 h) and the 5th failure marks it `failed`, so one bad
  activity can not block the rest. Rollout: `docker compose up -d --build loop-ingest` (runs the
  idempotent `sql/008_strava_hr.sql` and `sql/009_strava_hr_retry.sql`), then `npm run sync` once the
  backfill has run.

### Network and bind address

The ingest compose file names its default network `loop-net${HC_INSTANCE:+-${HC_INSTANCE}}` (`loop-net`, or
`loop-net-second` for a second install); loop-web joins that same name as an `external` network, and its nginx
proxies to `http://loop-ingest/...`: an `upstream` holding `loop-ingest:8088 resolve`, which Docker's embedded DNS
(`resolver 127.0.0.11`) looks up at run time, with `Host: loop-ingest` on the hop (an allowed name in the ingest
Host check; `host.docker.internal`, the hop's name before `loop-net`, still passes). So the proxy never depends on
the ingest port published on the host: that publish (`INGEST_PORT`, required) only serves the host's own sync
scripts and `refresh.sh`, which call `http://localhost:<INGEST_PORT>`. Hence the binds:

- `INGEST_BIND=127.0.0.1` (`services/loop-ingest/.env`) is the recommended hardening: loopback only, so nothing on
  the LAN reaches `/export/*`, `/sync/strava` or the food log except through loop-web's nginx. A LAN IP works too
  (LAN clients then reach the service directly; the bearer routes still need the token). Unset = every address,
  as before. Docker-published ports bypass ufw / firewalld, so this is the only filter on them.
- `PLAN_WEB_BIND` (`services/loop-web/.env`) is the page's address: the LAN IP on a host with a public address,
  unset otherwise.
- Before `loop-net`, nginx went through `host.docker.internal` (the Docker bridge gateway), which a `127.0.0.1` or
  LAN-IP publish does not cover: that combination cut the page off from its data.

**Start order.** The ingest stack first: `docker compose up -d` there creates `loop-net`; loop-web without it stops
with `network loop-net declared as external, but could not be found`. nginx starts and serves the page while the
ingest container is down (the proxied routes answer `502` / `504` meanwhile) and follows the container's new
address after it is recreated (within the resolver's 10 s).

**An existing install upgrades** with `docker compose up -d --build --force-recreate` in `services/loop-ingest`
(both containers move to `loop-net` and compose removes the old `loop-ingest_default`; without
`--force-recreate` compose keeps `loop-db` and it fails with `could not find a network matching network mode
loop-ingest_default`, which the same command with `--force-recreate` repairs), then `docker compose up -d
--force-recreate` in `services/loop-web` ([upgrading](guides/upgrading.md)). loop-web's old `loop-web_default`
network is left unused: `docker network rm loop-web_default` (a second install's is
`loop-web-<instance>_default`). `INGEST_PORT` in `services/loop-web/.env` is no longer read and can be deleted. Pinned by `scripts/loop-web-config.test.mjs` (both
compose files agree on the name, no `host.docker.internal` proxy left).
