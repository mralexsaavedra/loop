# LAN page + on-demand refresh

`services/plan-web` + `services/health-ingest`: sync trigger protocol, refresh.sh, freshness line, security and exposure, health + tokens.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

## LAN page + on-demand refresh — `services/plan-web` + `services/health-ingest`

Besides opening the built file locally, `services/plan-web` serves `web/dist/personal/index.html` on the LAN
(nginx, `./site` only), gzipped (server level: the page, CSS / JS / JSON, ≥ 1 KB, level 5, `Vary`;
the four proxied ingest routes are `gzip off` — their responses reflect request input next to stored
data, a BREACH-style oracle; pinned by `scripts/plan-web-config.test.mjs`; rollout `docker compose
up -d` in `services/plan-web`). `refresh.sh` rebuilds and publishes it hourly (cron) AND on demand, under a
**sequence protocol** (no clock comparison anywhere):

- **Trigger.** The page's Sync button (`POST /api/sync`, proxied by plan-web nginx) or the last
  Shortcut step (`POST <page address>/api/sync`, also through plan-web, `docs/ios-shortcut.md`) hits health-ingest
  `POST /sync`. A new click gets the next `trigger_seq` (persisted in `sync_status`; resumed at startup
  from max(DB, trigger file), never backwards) and answers `202 {seq, coalesced:false}`; it kicks the
  shared Strava pull (timer loop, `POST /sync` and `POST /sync/strava` share ONE in-flight run) unless
  the last success is < 5 min old, then, once the pull settles (≤ 90 s), writes `seq\n` ATOMICALLY to
  `services/health-ingest/trigger/refresh` (temp file + rename, `O_NOFOLLOW`, a symlinked target is
  refused; container `/trigger`, gitignored, uid 1000 must own it). **Coalescing, never 429, never
  dropped:** a click while a trigger is still pending (write not done, so the rebuild will see any new
  data) gets `{seq:<current>, coalesced:true}`; a click within 60 s of the last COMPLETED write
  (window measured from the rename, so a slow pull cannot yield two writes seconds apart) gets a NEW seq, `{seq, coalesced:true, deferred:true}`, and ONE trigger write is scheduled for
  the end of the window (later clicks reuse it), so a Shortcut payload POSTed right after a rebuild
  is still published (the deferred run pulls Strava only if its own 5 min cooldown allows). Cost stays
  ≤ 1 rebuild/min and ≤ 1 Strava pull/5 min and nobody can lock the user out. Nothing new is
  persisted; SIGTERM flushes a pending deferred write and awaits an in-flight run (2 s, then writes
  the persisted seq directly; 3 s hard cap); after a crash, boot finds the DB seq ahead of the trigger
  file and writes it once (5 s after boot, ≥ 60 s after the last recorded write), so a waiting page
  completes (it times out after 5 min: 60 s + ≤ 90 s pull + rebuild fits). A failed trigger write is exposed as `lastTriggerError: "trigger_write"` +
  `lastTriggerErrorSeq`. The host's `services/plan-web/systemd/plan-web-refresh.path` (PathModified,
  also fires on the rename) starts `plan-web-refresh.service` (oneshot as the repo owner,
  `User=REPO_OWNER` placeholder, hardened: `NoNewPrivileges`, `ProtectSystem=strict` +
  `ReadWritePaths=<clone>`, `ProtectHome=read-only`, `PrivateTmp`, npm cache via `CacheDirectory`;
  `PLAN_WEB_WAIT_LOCK=1` so it waits for a running cron refresh). Units ship with
  `/path/to/health-coach` + `REPO_OWNER` placeholders; the ordered install steps (trigger dir +
  chown BEFORE compose up → ingest rebuild → first `npm ci` by hand → verify checkout is `main` →
  plan-web up → units → smoke test) are in `services/plan-web/README.md`.
- **refresh.sh** keeps its resilience rules (failed sync still rebuilds, flock, `npm ci` only on a
  lockfile change, a failed build keeps the last good page). Each pass records the trigger seq it
  started from; a successful publish writes `site/status.json` = `{publishedAt, commit, branch,
  processedSeq}` atomically (`processedSeq` never goes backwards; the last good fragment is kept in
  `services/plan-web/.refresh-state`, outside `./site`). After a pass it re-reads the trigger and runs
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
  plan-web nginx proxies EXACTLY `/api/sync` + `/api/sync/status` (exact-match, method-restricted)
  plus the food log prefix `/api/food/*` → ingest `/food/*` (GET / POST / PUT / DELETE, 16 KB, the
  `X-HC-Food` header forwarded; see "Nutrition v2 part 2"), the journal prefix `/api/journal/*` →
  ingest `/journal/*` (GET / PUT, 16 KB, the `X-HC-Journal` header forwarded; `docs/journal.md`) and EXACTLY `POST /ingest/health-auto-export`
  → the same ingest route (the iOS Shortcut upload when plan-web is the public entry and ingest is not
  exposed: `Authorization` / `Automation-Name` / `Content-Type` forwarded, no `Bearer` token → `401`
  before the body is read, ingest checks the bearer, `client_max_body_size 8m` ≤ ingest's
  `MAX_BODY_BYTES` default); every other `/api/` or `/ingest/`
  path 404, never `/export/*` or `/sync/strava` (pinned by `scripts/plan-web-config.test.mjs`).
  Static device manuals: EXACTLY `/manuales/<MANUAL_FILE_RE>` (a quoted regex location; GET / HEAD,
  `types { }` + `default_type application/pdf`, `Content-Disposition: inline`, `X-Content-Type-Options:
  nosniff`, `Content-Security-Policy: default-src 'none'; object-src 'self'` (not `sandbox`, which
  blocks the browsers' built-in PDF viewer), `Cache-Control: no-cache` re-added since a location `add_header` drops the server one,
  `autoindex off`, `try_files $uri =404`); every other `/manuales/` path 404; NOT in any SSO bypass
  (behind the tunnel it stays behind SSO). A
  server-level guard (next to the Host check) answers `400` when the RAW path (before `?`) holds `..`,
  `%2e`, `%2f`, `%5c` (any case) or `//`, so an SSO proxy matching bypass rules on the raw path cannot
  be walked to the page (`/ingest/%2e%2e/index.html`). Behind an SSO tunnel (one resource →
  plan-web:8090), bypass SSO for exactly `/ingest/*` and `/api/sync` (EXACT, never a prefix), verify
  from outside that `/ingest/%2e%2e/status.json` does not return the file, keep `INGEST_TOKEN` (it also
  guards `/export/*`) ≥ 32 random bytes, and
  add the public host to `PLAN_WEB_EXTRA_HOSTS` + `FOOD_ALLOWED_HOSTS` (`services/plan-web/README.md`,
  "Exposing behind an SSO tunnel"). Every path
  (the page included) answers only a Host that is an IP literal, `localhost` or a name in
  `PLAN_WEB_EXTRA_HOSTS`, else `421` (DNS rebinding; how to add a name: "Nutrition v2 part 2" →
  Security). A public
  reverse proxy in front of ingest must forward ONLY `/ingest/*` and `/sync` (`/sync/status`
  optional), never `/export/*`, `/sync/strava`, `/food/*` or `/journal/*`.
- **Health + tokens.** `/healthz` stays 200 but adds `degraded: true` when Strava is configured and its
  PERSISTED last success is > 6 h old or missing (a restart does not reset it). A refresh token rotated
  by Strava is stored in `strava_token` (3 save attempts with backoff; on failure it is kept in memory,
  status shows `strava_token_save`, and the save is retried next refresh) and preferred over
  `STRAVA_REFRESH_TOKEN` (the bootstrap); a failed store read is retried next refresh; a rejected
  stored token falls back to the env one once. Rolling this out needs an ingest rebuild
  (`docker compose up -d --build`, runs the idempotent `sql/003_sync.sql`).
- **HR-stream backfill.** After each successful Strava pull the loop fetches at most 10 activity HR
  streams (newest first, never more than 30 per 15 min / 300 per 24 h, counted in
  `strava_activity_hr`), stores only seconds per bpm (`hr_hist`, never the stream) and exports it on
  `GET /export/strava` for the per-workout HR zones; details and limits in
  `services/health-ingest/README.md` ("Per-workout HR zones"). Each streams request times out after
  15 s; a 429 stops the batch, but a 5xx / timeout of one activity only skips it with a per-activity
  back-off (30 min × 2^(attempts − 1), cap 24 h) and the 5th failure marks it `failed`, so one bad
  activity can not block the rest. Rollout: `docker compose up -d --build health-ingest` (runs the
  idempotent `sql/008_strava_hr.sql` and `sql/009_strava_hr_retry.sql`), then `npm run sync` once the
  backfill has run.
