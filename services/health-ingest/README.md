# health-ingest

Phase 1 of the self-hosted health stack: a raw landing zone for personal health
data, so that keeping the dataset fresh requires no manual work.

Two sources feed it:

- **Apple Health**, pushed from the iPhone by [Health Auto Export][hae] over HTTP.
- **Strava**, pulled from its API on a timer (and on demand, see `POST /sync`).

## Why raw first

Health Auto Export does not publish its JSON schema. Rather than parse a guessed
shape, the service stores every payload verbatim in `raw_payload` together with
the automation headers the app sends. The normalizer is written afterwards,
against real samples.

Nothing is discarded, so re-normalizing later is a query, not a re-import.

## Endpoints

| Method | Path                          | Auth   | Response |
| ------ | ----------------------------- | ------ | -------- |
| GET    | `/healthz`                    | none   | `200` when the database answers; `degraded: true, reason: "strava_stale"` when Strava is configured and its last PERSISTED success is older than 6 h (or it never succeeded) |
| POST   | `/sync`                       | none   | `202` `{ok, seq, coalesced, deferred?, strava?}`; never refuses (repeated clicks coalesce or defer) |
| GET    | `/sync/status`                | none   | `200` `{lastShortcutAt, lastStravaOkAt, lastStravaError, lastTriggerAt, lastTriggerError, lastTriggerErrorSeq, triggerSeq, stravaConfigured}` (coarse codes only, cached 5 s) |
| POST   | `/ingest/health-auto-export`  | bearer | `202` with the stored row id |
| POST   | `/sync/strava`                | bearer | `200` with the activity count; `409` when unconfigured |
| GET    | `/export/raw`                 | bearer | `200` with `[{id, received_at, payload}]`; `400` on a bad query |
| GET    | `/export/strava`              | bearer | `200` with `[{id, start_local, sport_type, moving_time, elapsed_time, distance, average_heartrate, max_heartrate, suffer_score, kilojoules, total_elevation_gain, start_utc, device_watts, hr_hist}]`; `400` on a bad query |
| GET    | `/food/products`              | header | `200` `{products}`: active products (per-100 macros, store, serving size) |
| POST / PUT / DELETE | `/food/products[/:id]` | header | create `201` / edit `200` / archive `200`; `409 barcode_exists`, `400 atwater` unless `force` |
| GET    | `/food/recipes`               | header | `200` `{recipes}` with macros COMPUTED from the products + basic snapshots (`perServing` or `per100` cooked) |
| POST / PUT / DELETE | `/food/recipes[/:id]`  | header | create / edit / archive, same rules; `400 atwater` (a basic snapshot) unless `force` |
| GET    | `/food/log?date=YYYY-MM-DD`   | header | `200` `{date, entries, totals}` |
| POST / DELETE | `/food/log[/:id]`      | header | add `201` `{entry, totals}` (macros snapshotted; a retry with the same `requestId` answers `200` with the stored row) / delete `200` |
| GET    | `/food/off?barcode=` / `?q=`  | header | `200` `{product}` / `{results}` from Open Food Facts, normalized; nothing saved |
| GET    | `/food/log/summary?from=&to=` | header | `200` `{from, to, days: [{date, k, p, c, f, n, missing, groups}]}`: per-day sums of the stored snapshots (≤ 120 days; a macro no entry states is `null`) |
| GET / PUT | `/food/settings`           | header | `200` `{settings: {goal, targetWeightKg, updatedAt}}`; PUT = partial update `{goal?, targetWeightKg?}` (`null` clears the target); `503 settings_unavailable` when its migration failed |
| GET    | `/export/athlete`             | bearer | `200` with the latest athlete snapshot: `{fetchedAt, firstname, lastname, city, state, country, profile, profileMedium, measurementPreference, athleteType, bikes, shoes, gearScopeMissing, devices}` (nulls / empty lists when nothing is stored) |

Bearer token is compared in constant time; it is the entire security boundary
for the endpoint, because Health Auto Export can only send a static header.
`header` = no token, but the request must carry `X-HC-Food: 1` (see "Food log" below).

## On-demand refresh: `POST /sync` and `GET /sync/status`

The plan page's **Sync** button (through plan-web's nginx, `/api/sync`) and the
last step of the iOS Shortcut call `POST /sync`. It uses a **sequence
protocol**: no clock is compared anywhere.

1. A new click gets the next **trigger sequence** (`trigger_seq`, persisted in
   `sync_status`; at startup it resumes from the max of the DB value and the
   trigger file, so it never goes backwards). The answer is `202 {seq, coalesced: false}`.
2. It kicks the Strava pull, unless the last successful pull is less than
   5 min old. The timer loop, `POST /sync` and `POST /sync/strava` share ONE
   in-flight run, so they never overlap.
3. Once the pull settles (at most 90 s), it writes `seq` to
   `$TRIGGER_DIR/refresh` (`/trigger/refresh`, bind-mounted from
   `./trigger/refresh`) **atomically**: a temp file in the same directory,
   opened `O_CREAT|O_EXCL|O_NOFOLLOW`, then renamed over the target. A symlink
   at the target is refused. A failed pull still writes it, so the page
   rebuilds from what is stored.

The host watches that file with a systemd path unit and runs
`services/plan-web/refresh.sh`, which publishes `processedSeq` in its
`status.json`; the page reloads once `processedSeq >= seq` (details and install
steps: `services/plan-web/README.md`).

**Coalescing instead of rate limiting, and nothing dropped.**

- A click while the previous trigger is still pending (pull + write not done)
  gets `202 {seq: <current>, coalesced: true}` and causes no work: the rebuild
  has not started, so it will include whatever just arrived.
- A click within 60 s of the last completed write may carry
  newer data (the Shortcut POSTs its payload, then calls `/sync`, seconds after
  a Sync click). It gets a NEW seq, `202 {seq, coalesced: true, deferred: true}`,
  and ONE trigger write is scheduled for the end of the 60 s window. Later
  clicks in the window reuse that seq. The deferred run pulls Strava only if
  its own 5 min cooldown allows.

There is no `429`, so nobody can lock the user out, and cost stays bounded: at
most one trigger write (= one rebuild) per minute and one Strava pull per 5 min.
The 60 s window runs from the write's completion, not from the click, so a slow
Strava pull cannot produce two writes seconds apart. Nothing new is persisted
(the deferred seq is an ordinary `trigger_seq`). On `SIGTERM`/`SIGINT` a pending
deferred write is flushed at once (no Strava pull) and an in-flight run is
awaited for up to 2 s; past that the persisted seq is written directly, so the
trigger file and the DB agree (all bounded to 3 s). If the process dies without
that, the DB seq is ahead of the trigger file: at boot the service writes it
once (after 5 s, and no earlier than 60 s after the last recorded write), so
the host rebuild processes it and a waiting page completes.

`GET /sync/status` feeds the page's freshness line and the Sync button:
the newest payload's `received_at`, the last Strava success, the last Strava
failure as a **coarse code** (`strava_auth`, `strava_network`, `strava_other`,
or `strava_token_save` when a rotated refresh token could not be stored),
the last trigger time, `lastTriggerError` (`trigger_write`) with the seq it
failed for, the current `triggerSeq`, and whether Strava is configured. Raw
error messages only go to the logs. The snapshot is cached for 5 s. State is
kept in memory and in the single-row `sync_status` table (`sql/003_sync.sql`),
so a restart keeps it; a failed DB read at startup is retried on the next
status request.

**Why these two routes have no token.** The page is a static file and cannot
hold a secret. `POST /sync` only schedules work the service already does on a
timer, reads no body and returns only a sequence number. `GET /sync/status`
returns timestamps, sequence numbers and codes, never health data, raw errors
or the payload itself (tests pin the exact key set and that no error text
leaks). The data endpoints (`/ingest`, `/export`, `/sync/strava`) keep the
bearer token.

**Exposure model.** A public reverse proxy in front of this service should
forward ONLY `/ingest/*` and `POST /sync` (the Shortcut's last step);
`/sync/status` is optional. Never expose `/export/*`, `/sync/strava` or
`/food/*`. The LAN plan-web nginx proxies only `/api/sync`, `/api/sync/status`
and `/api/food/*`.

**Deploy order.** Create the trigger directory and hand it to the container's
`node` user (uid 1000) BEFORE `docker compose up`, or Docker creates it
root-owned: `mkdir -p trigger && sudo chown 1000:1000 trigger`. Then
`docker compose up -d --build` (runs the idempotent `003_sync.sql`). The full
host sequence is in `services/plan-web/README.md`. A failed write is logged
(`trigger_write_failed`), exposed as `trigger_write`, and never fails the request.

**Strava token persistence.** A rotated refresh token is saved with up to 3
attempts and growing backoff; if all fail it is kept in memory, status reports
`strava_token_save`, and the save is retried on the next refresh. A failed read
of the stored token is retried on the next refresh too (the env token is used
meanwhile).

## Food log: `/food/*`

The LAN plan page's Nutrición tab logs what the user eats (Registrar), keeps their
supermarket products (Mis productos: Mercadona / Dia / Eroski / other) and their
own recipes (Mis recetas), through plan-web's `/api/food/` proxy. Tables in
`sql/006_food.sql` (idempotent, runs on every start): `food_product`,
`food_recipe`, `food_log`.

- **Settings** (`sql/007_settings.sql`, table `app_settings`, ONE row): the
  user's goal (`maintain` / `cut` / `bulk`) and target weight (35–250 kg,
  1 decimal), so every device that opens the page agrees. Its own optional
  migration group: a failure only answers `503 settings_unavailable` on
  `/food/settings` (the food log keeps working, and the other way round). Same
  layers as every `/food/*` route (Host, Origin, `X-HC-Food`, JSON, body cap,
  write rate limit); unknown keys and out-of-range values are `400 invalid`.
  Same LAN trust model as the food log: any device on the LAN that talks to the
  service directly can read and change them (no secret on a static page), so
  never forward `/food/*` from a public proxy.
- **Summary** (`GET /food/log/summary`): per-day sums (`daySummaries`, the
  shared formula) and entries per Registrar group (breakfast / lunch / dinner /
  addon) for the page's adherence view; read-only, at most 120 days, at most
  20,000 rows read, and 30 reads / min per client address (`429 rate_limited`).

- **Products** hold per-100 g / ml kcal, protein, carbs and fat from the label or
  Open Food Facts, confirmed by the user (`source`: `off` / `label` / `manual`),
  plus an optional serving size (one yogurt) and barcode (unique among active
  products). Delete = archive, so recipes and old entries keep their reference.
- **Recipes** list their ingredients in the `ingredients` JSONB column, each either a
  product `{productId, amount}` (amount in the product's unit) or a BASIC of the public
  food DB (`data/nutrition/ingredients.json`, the page's FOOD_BASICS) as a SNAPSHOT
  `{basic, name, unit, amount, per100: {kcal, protein, carbs, fat}}`: `basic` = the
  DB key (`^[a-z0-9][a-z0-9_-]{0,63}$`), `unit` = `g` / `ml` / `ud`, `per100` = per
  100 g / ml, or per ONE unit for a `ud` food (whose `amount` is a count of units).
  The page sends the snapshot; the service validates it strictly (unknown keys
  refused, name ≤ 120, macros finite, ≥ 0, ≤ 900 kcal / 100 g, kept to 2 decimals,
  amount ≤ 10000) and refuses one whose kcal disagree with its macros with
  `400 atwater` unless the body says `force: true` (alcohol, polyols; `force` is not
  stored). The snapshot never changes when ingredients.json does. No migration:
  product-only rows are read and written exactly as before. A recipe may be made of
  basics only; archiving a product keeps the recipes that use it computed (re-saving
  one with that product is still `400 unknown_product`). Kind
  `serving` (tortitas, crepes, a shake: N servings) or `batch` (lentejas: total
  cooked weight, macros per 100 g cooked). Macros are always COMPUTED
  (`src/food-calc.js`, a port of `lib/nutrition/foodlog.mjs`, pinned by a parity
  test), never typed.
- **Log entries** carry the user's LOCAL date (sent by the page), a meal slot
  (`breakfast`, `lunch`, `preworkout`, `postworkout`, `dinner`, `snack`) and a
  SNAPSHOT of their macros taken at log time, so editing a product later never
  rewrites history. A quick entry (`refType: quick`) is a label + kcal with
  optional macros; unknown macros stay `null`, never 0, and the day totals flag
  them (`missing`).
- **Validation**: strict JSON (unknown keys refused), body ≤ 16 KB (`413`),
  strings trimmed and capped, per-100 kcal ≤ 900 and macros ≤ 100 g, dates must
  round trip, and a label whose kcal disagree with 4 p + 4 c + 9 f by more than
  25 % (or 10 kcal) answers `400 atwater` unless the body says `force: true`
  (fibre / polyols make real labels deviate; the page offers "save anyway").
  Errors are coarse codes `{error, field?}`, never raw DB text.
- **Open Food Facts** (`GET /food/off`, `src/off.js`): server side only, with a
  descriptive User-Agent, an 8 s timeout, no redirects, a 1 MB response cap, an
  in-memory 24 h LRU cache and token buckets (≤ 10 searches / min, ≤ 100 product
  reads / min; over → `429 off_rate_limited` without calling OFF). Only
  normalized fields are returned; a nutriment OFF lacks is `null` with
  `complete: false`, and the page asks the user to fill it from the label.
  Nothing from OFF is stored until the user saves the product.

**Why no token, and what keeps other websites out.** Like `/sync`, a static
page cannot hold a secret, so `/food/*` is unauthenticated and meant for the LAN
ONLY. Layers, in order:

1. **Host** (DNS rebinding): the `Host` must be an IP literal (v4 or bracketed
   v6), `localhost`, `host.docker.internal` (the plan-web proxy hop) or a name in
   `FOOD_ALLOWED_HOSTS`, else `421 misdirected`. plan-web's nginx refuses other
   names first (see its README).
2. **Origin** on writes: when the browser sends one, its host must pass the same
   check, else `403 forbidden_origin`.
3. `X-HC-Food: 1` on every request (`403`) and `Content-Type: application/json`
   on writes (`415`): from another site both need a CORS preflight, which this
   service never approves (no CORS headers at all).

Together they stop a website opened in a LAN browser from reading or writing
the log; they do not stop a device ON the LAN that calls the service directly
(the LAN-only trust model). Writes share one rate limit of 60 / min per client
address; behind plan-web every request comes from nginx, so it is one shared
budget. **A public reverse proxy must NEVER forward `/food/*`** (same list as
`/export/*`).

**Isolated migration.** `006_food.sql` runs as an optional group: if it fails,
the service logs `food_migration_failed` and keeps ingesting, syncing and
pulling Strava; only `/food/*` answers `503 food_unavailable` until a restart
runs it successfully.

**Adding a migration.** Every `sql/` file is idempotent and runs on every start
(there is no applied-migrations table, so a rollout is just a restart). List a
new file in `src/migrations.js` (`CORE_MIGRATIONS` or an `OPTIONAL_MIGRATIONS`
group); `test/migrations.test.js` fails if a file is missing, listed twice or out
of numeric order.

**Idempotent adds.** The page sends a `requestId` (a UUID) with each add and
reuses it when it retries after a timeout or a lost answer; a unique index on
`food_log.request_id` makes the retry return the stored row instead of a
duplicate.

**Rollout.** `docker compose up -d --build health-ingest` (runs `006_food.sql`),
then restart plan-web so its nginx picks up the `/api/food/` proxy
(`services/plan-web/README.md`).

## iOS Shortcut ingestion

A plain iOS Shortcut can feed the same endpoint as Health Auto Export: it runs
"Find Health Samples" queries, joins each result into a newline-separated string
and POSTs one JSON object to `/ingest/health-auto-export` with the bearer token
and an `Automation-Name` header (stored in `raw_payload.automation`).

```json
{
  "hrv":    "2030-01-02T08:00:00+01:00;42.1\n…",
  "rhr":    "2030-01-02T00:05:00+01:00;55\n…",
  "weight": "2030-01-02T07:00:00+01:00;70.3\n…",
  "sleep":  "2030-01-01T23:30:00+01:00;2030-01-02T01:00:00+01:00;Core\n…"
}
```

Point metrics (hrv, rhr, vo2max, weight, bodyfat, leanmass, waist, wrist_temp,
hr_recovery) are
`start;value[;source]` (body fat / lean mass carry the scale's source), day-grouped values from the phone (active/basal energy, respiratory and
walking_hr means where `0` = no data, dietary intake as `diet_kcal` / `diet_protein` /
`diet_carbs` / `diet_fat`, and steps sent
per device as `steps_watch` / `steps_phone`, because a merged steps total sums the
devices) are `start;value`, sleep is `start;end;stage`. The full key table and a
step-by-step build are in [`docs/ios-shortcut.md`](../../docs/ios-shortcut.md). A key is omitted or empty when its query
returned nothing. Runs may overlap (rolling window); the reader dedups.

### Reading payloads back: `GET /export/raw`

| Query        | Meaning |
| ------------ | ------- |
| `automation` | required; matches the `Automation-Name` header |
| `since_id`   | return rows with `id >` this (default `0`) |
| `limit`      | page size, default 500, max 1000 |

Rows come back oldest first; page by passing the last `id` as `since_id`. Same
constant-time bearer check as ingest, and only counts are logged. The repo's
`npm run sync` (`data/apple-health/sync-shortcut.js`) uses it to merge Shortcut
samples into the Apple Health extract CSVs (export rows win; Shortcut rows fill
only dates the export does not cover, tagged `source=Shortcut`).

### Reading Strava activities back: `GET /export/strava`

| Query        | Meaning |
| ------------ | ------- |
| `since_id`   | return rows with `id >` this (default `0`) |
| `limit`      | page size, default 500, max 1000 |

Rows come back oldest first, one per stored `strava_activity`, with only the
fields the workout sync needs — never the activity `name` or the full stored
payload. `start_local` is read from the JSON payload (`start_date_local`)
rather than the `start_local` column, because the upsert in `sync.js` never
refreshes that column on an edit. Same constant-time bearer check as every
other endpoint here, and only counts are logged. The repo's
`data/apple-health/sync-strava.js` uses it to merge Strava activities into the
Apple Health extract CSVs the same way the Shortcut sync does (export rows
win; Strava rows fill only dates the export does not cover, tagged
`source=Strava API`).

If the image predates this endpoint, `GET /export/strava` answers `404` — the
`health-ingest` container needs a rebuild/restart (`docker compose up -d
--build health-ingest`) before the Strava sync can run. The same applies when a
new field is added to the response (e.g. `total_elevation_gain`, which feeds the
`elevation_m` column of `workouts.csv`): an un-rebuilt image still answers, but
without the field, so the column stays blank until the rebuild and the next
`npm run sync:strava` (which prints a stale-image warning when no activity carries
elevation). Likewise `start_utc` (Strava's UTC `start_date`) and `device_watts` (true only for a
real power meter) feed `rides.csv` and the power-meter correction of the Watch's active energy on
ride days; without them the sync warns and the correction stays off.

### Per-workout HR zones: the HR-stream backfill (`hr_hist`)

After each successful activity pull (and after the athlete refresh, so the two never overlap) the
sync loop runs ONE bounded batch of the HR-stream backfill (`src/hr-zones.js`, table
`strava_activity_hr` from `sql/008_strava_hr.sql`, a core migration): for activities that have
heart rate (`has_heartrate` / `average_heartrate`) and no stored row yet, newest first, it calls
`GET /activities/{id}/streams?keys=time,heartrate&key_by_type=true` and stores only an aggregate —
seconds spent at each whole bpm (`hr_hist`, `{"142": 37, ...}`), never the raw stream. Each sample
owns the time until the next one; a gap over 30 s (pause, dropout), a non-increasing time and a
missing or implausible (< 30 / > 250 bpm) reading add nothing. `GET /export/strava` returns it as
`hr_hist` (null until the backfill reaches the activity, or when it has no HR); the repo's
`sync-strava.js` cuts the zones (% of max HR) from it, so a change of max HR never needs a refetch.

**Rate limits.** Strava allows 100 requests / 15 min and 1000 / day per app, shared with the
activity pull (1-2 calls per run) and the daily athlete refresh. The backfill fetches at most
**10 streams per run**, and never more than **30 in the last 15 min** or **300 in the last 24 h**,
counted from `strava_activity_hr.fetched_at` (a restart does not reset the budget). With the 30-min
loop that is ~300 activities a day: a history of ~1000 activities with HR fills in about 3-4 days,
then each new activity is picked up by the next run. Every definite answer is stored and never asked
again (`ok`, `no_hr` = no HR stream, `not_found` = 404). The streams of a private activity need the
`activity:read_all` scope the service already asks for.

**Failures and back-off** (`sql/009_strava_hr_retry.sql`). Each streams request is aborted after
**15 s** (`STREAMS_TIMEOUT_MS`). A **429** is app-wide: it stops the whole batch and records nothing
(`strava_hr_backfill_failed`, `rateLimited: true`). A **transient** failure of one activity — a 5xx,
a network error or the timeout — only skips that activity: it is stored as status `retry` with
`attempts` + 1 and `last_error_at` (`strava_hr_activity_failed` in the log) and the batch goes on with
the next activity. A `retry` row is due again **30 min × 2^(attempts − 1)** after its last failure
(30 min, 1 h, 2 h, 4 h; capped at 24 h); the **5th** failure stores status **`failed`** and the
activity is never asked again (it has no `hr_hist`, so its day panel shows no zones). A failed call
still sets `fetched_at`, so it counts against the budget. Any other error (token refresh, 401, the
database) stops the batch without recording anything. None of this ever fails the activity sync or
its status. To list or re-arm given-up activities:
`SELECT activity_id, attempts, last_error_at FROM strava_activity_hr WHERE status = 'failed'`;
deleting a row makes the backfill fetch it again.

Strava also exposes the athlete's own heart-rate zones (`GET /athlete/zones`, needs
`profile:read_all`); they are NOT used: the page applies one documented % of max HR model
(docs/training.md) so the zones stay comparable with the reference.

**Rollout.** `docker compose up -d --build health-ingest` (runs the idempotent `008_strava_hr.sql`
and `009_strava_hr_retry.sql`);
the backfill starts on the next sync run. An older image keeps answering `/export/strava` without
`hr_hist`, and the page simply shows no zones.

### Reading the athlete profile back: `GET /export/athlete`

The sync loop also refreshes a snapshot of the Strava **athlete** (name, city/state/country,
profile photo URLs, measurement preference, athlete type) and their **gear** at most once per
24 h (`src/athlete.js`, table `strava_athlete` from `sql/004_athlete.sql` +
`sql/005_athlete_refresh.sql`). It starts in the background AFTER a successful activity pull has
been recorded, so `POST /sync` and the status never wait on it: `GET /athlete`, then `GET /gear/{id}`
for every bike / shoe on the athlete plus every `gear_id` seen on stored activities (brand, model,
frame type, weight, distance in metres, retired flag). Only one refresh runs at a time, and its
Strava calls are aborted after 60 s. A failed refresh is logged (`strava_athlete_failed`), its time
is stored in the row (`last_failure_at`, so a restart does not retry at once), it is retried after
1 h, and it never fails the activity sync or its status. When a `GET /gear/{id}` fails transiently
(5xx / network) the snapshot is still saved, flagged `gear_partial`, and refreshed again after 1 h
instead of 24 h; a 4xx for one gear id (missing scope, not the athlete's) is a final answer.

The response carries profile fields only: never the athlete id, username, sex, body weight or the
raw payload (the repo takes body weight from the scale). `devices` is derived from the stored
activities' `device_name` (`[{name, count, lastUsed}]`, `lastUsed` = the local start day of the
newest activity); summary activities normally carry it, and an activity without it is simply not
counted. Photo URLs are returned only when they are `https://` (Strava sends a relative
placeholder path when the athlete has no photo). The repo's `npm run sync`
(`data/profile/sync-profile.js`) reads it into the gitignored `data/profile/`.

**Gear needs the `profile:read_all` scope.** Strava returns `bikes` / `shoes` (and
`measurement_preference`) on `GET /athlete` only for a token granted `profile:read_all`. With a
`read,activity:read_all` token they are absent: the service then sets `gearScopeMissing: true`
(coarse flag, never an error) and still tries `GET /gear/{id}` for the gear ids seen on
activities. To grant the scope (nothing the running service uses changes until step 4, so every
step before it can be abandoned safely):

1. Back up `.env`: `cp .env .env.bak`.
2. Run `node scripts/strava-auth.js` (it asks for
   `scope=read,activity:read_all,profile:read_all`; the authorize URL is
   `https://www.strava.com/oauth/authorize?client_id=<id>&response_type=code&redirect_uri=http://localhost/exchange_token&approval_prompt=force&scope=read,activity:read_all,profile:read_all`)
   and let it write the new refresh token into `.env`. Check the URL Strava redirects to: its
   `scope=` parameter must include `profile:read_all` (the consent screen lets you untick it).
3. Verify the new token BEFORE dropping the stored one. With the values from `.env` (type them or
   `set -a; . ./.env; set +a` in a subshell; never paste them into a shared log):
   ```bash
   curl -s -X POST https://www.strava.com/oauth/token \
     -d client_id="$STRAVA_CLIENT_ID" -d client_secret="$STRAVA_CLIENT_SECRET" \
     -d grant_type=refresh_token -d refresh_token="$STRAVA_REFRESH_TOKEN" | grep -o '"token_type":"Bearer"'
   ```
   It must print `"token_type":"Bearer"`; an `errors` / `invalid` body means the token in `.env` is
   wrong, so stop here and restore `.env.bak`. If the response carries a `refresh_token` different
   from the one in `.env`, Strava rotated it: put the new value in `.env` (the old one no longer works).
4. Back up, then drop the stored rotated token, which still carries the OLD scopes and would
   otherwise keep winning over `.env` (it is not rejected, just narrower):
   ```bash
   docker exec health-db psql -U health -d health -c "DROP TABLE IF EXISTS strava_token_backup; CREATE TABLE strava_token_backup AS TABLE strava_token"
   docker exec health-db psql -U health -d health -c "DELETE FROM strava_token"
   ```
5. Force a fresh snapshot instead of waiting 24 h:
   `docker exec health-db psql -U health -d health -c "DELETE FROM strava_athlete"`, then restart
   (`docker compose up -d --force-recreate health-ingest`, which also re-reads `.env`).
6. Check it worked: `curl -s localhost:8088/sync/status` must show no `lastStravaError`
   `strava_auth` after the first pull, and `GET /export/athlete` must carry `gearScopeMissing: false`.
   Then `docker exec health-db psql -U health -d health -c "DROP TABLE strava_token_backup"`.

**Rollback** (step 6 shows `strava_auth`): restore the old credentials and restart:
`cp .env.bak .env`, then
`docker exec health-db psql -U health -d health -c "INSERT INTO strava_token SELECT * FROM strava_token_backup ON CONFLICT (id) DO NOTHING"`
and `docker compose up -d --force-recreate health-ingest`. The service is back on the old token and
the old scopes; re-run the steps from 2 when ready. Before step 4 nothing needs rolling back (the
stored token is untouched): just `cp .env.bak .env`.

`GET /export/athlete` needs an image rebuild (`docker compose up -d --build health-ingest`,
which also runs the idempotent `004_athlete.sql`); an older image answers `404` and the profile
sync keeps its previous files.

After adding new Shortcut keys (e.g. `waist`, `diet_*`), run `npm run sync -- --full` once so
payloads already in the local cache are re-parsed; send `waist` in centimetres (see
`docs/ios-shortcut.md`).

## Strava

Optional. Without `STRAVA_*` credentials the service runs Apple Health ingestion
alone and `/sync/strava` answers `409`.

When configured, activities are pulled every `STRAVA_SYNC_MINUTES` and upserted
into `strava_activity` by id. Each run re-reads a seven-day overlap window, so an
activity edited after upload — renamed, or given a description by the coach — is
picked up on the next pass rather than frozen at its first version.

Access tokens are refreshed in memory with a 60-second slack. The refresh token
is the durable credential, and Strava may **rotate** it on any refresh: the
service stores the rotated value in the single-row `strava_token` table and
prefers it over `STRAVA_REFRESH_TOKEN`, which stays the bootstrap for a fresh
database. If the stored token is rejected (for example after you re-authorized
and put a new token in `.env`), the env token is tried once. A failing store
never blocks a refresh. The token is never returned by any endpoint or logged.
A failed or rate-limited sync is logged and never takes the ingest endpoint
down with it.

To obtain the credentials: create an application at
<https://www.strava.com/settings/api>, then run the authorization-code flow once
to exchange it for a refresh token.

## Configuration

Copy `.env.example` to `.env` and fill it in (`openssl rand -hex 32` for the
token). `.env` is gitignored and must stay that way.

| Variable            | Meaning |
| ------------------- | ------- |
| `INGEST_TOKEN`      | Bearer token; refuses to start under 32 characters |
| `POSTGRES_*`        | Database credentials |
| `INGEST_PORT`       | Host port; the reverse proxy target points here |
| `MAX_BODY_BYTES`    | Upload ceiling, default 32 MB |
| `TRIGGER_DIR`       | Where `POST /sync` writes `refresh`; compose sets `/trigger` (bind mount of `./trigger`) |
| `FOOD_ALLOWED_HOSTS` | Extra host names (comma / space separated) the `/food/*` Host + Origin checks accept besides IP literals, `localhost` and `host.docker.internal`; empty by default. Mirror plan-web's `PLAN_WEB_EXTRA_HOSTS` |

## Running

```sh
docker compose up -d --build
curl -s localhost:8088/healthz
npm test
```

## Exposing it

**Plain HTTP on the LAN.** The service itself speaks plain HTTP: on the local
network, the bearer token and every health payload travel unencrypted and are
readable by anyone on that network. That is acceptable only on a trusted home
network. For anything else (guest/shared Wi-Fi, VPN-less remote access, the
internet), put it behind a TLS-terminating reverse proxy and rotate the token
(`openssl rand -hex 32`, update `.env` and the clients) if it may have been exposed.

The iPhone must reach the endpoint from outside the LAN. Point the reverse proxy
at `<your-host>:8088` (the `INGEST_PORT` in `.env`).

Two caveats:

1. If the proxy enforces its own interactive authentication on the resource,
   Health Auto Export cannot complete it — it is not a browser. Either leave the
   resource unauthenticated and rely on the bearer token, or use a proxy
   mechanism that accepts a static header or query token.
2. Apple only allows reading HealthKit while the iPhone is unlocked, so schedule
   frequent daytime syncs rather than an overnight one.

[hae]: https://apps.apple.com/app/id1115567069
