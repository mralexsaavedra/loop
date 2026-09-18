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

Bearer token is compared in constant time; it is the entire security boundary
for the endpoint, because Health Auto Export can only send a static header.

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
