# health-ingest

Phase 1 of the self-hosted health stack: a raw landing zone for personal health
data, so that keeping the dataset fresh requires no manual work.

Two sources feed it:

- **Apple Health**, pushed from the iPhone by [Health Auto Export][hae] over HTTP.
- **Strava**, pulled from its API (not implemented yet).

## Why raw first

Health Auto Export does not publish its JSON schema. Rather than parse a guessed
shape, the service stores every payload verbatim in `raw_payload` together with
the automation headers the app sends. The normalizer is written afterwards,
against real samples.

Nothing is discarded, so re-normalizing later is a query, not a re-import.

## Endpoints

| Method | Path                          | Auth   | Response |
| ------ | ----------------------------- | ------ | -------- |
| GET    | `/healthz`                    | none   | `200` when the database answers |
| POST   | `/ingest/health-auto-export`  | bearer | `202` with the stored row id |
| POST   | `/sync/strava`                | bearer | `200` with the activity count; `409` when unconfigured |
| GET    | `/export/raw`                 | bearer | `200` with `[{id, received_at, payload}]`; `400` on a bad query |
| GET    | `/export/strava`              | bearer | `200` with `[{id, start_local, sport_type, moving_time, elapsed_time, distance, average_heartrate, max_heartrate, suffer_score, kilojoules, total_elevation_gain}]`; `400` on a bad query |

Bearer token is compared in constant time; it is the entire security boundary
for the endpoint, because Health Auto Export can only send a static header.

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
`npm run sync:strava`.

## Strava

Optional. Without `STRAVA_*` credentials the service runs Apple Health ingestion
alone and `/sync/strava` answers `409`.

When configured, activities are pulled every `STRAVA_SYNC_MINUTES` and upserted
into `strava_activity` by id. Each run re-reads a seven-day overlap window, so an
activity edited after upload — renamed, or given a description by the coach — is
picked up on the next pass rather than frozen at its first version.

Only the refresh token is durable; access tokens are refreshed in memory with a
60-second slack. A failed or rate-limited sync is logged and never takes the
ingest endpoint down with it.

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
at `apps:8088`.

Two caveats:

1. If the proxy enforces its own interactive authentication on the resource,
   Health Auto Export cannot complete it — it is not a browser. Either leave the
   resource unauthenticated and rely on the bearer token, or use a proxy
   mechanism that accepts a static header or query token.
2. Apple only allows reading HealthKit while the iPhone is unlocked, so schedule
   frequent daytime syncs rather than an overnight one.

[hae]: https://apps.apple.com/app/id1115567069
