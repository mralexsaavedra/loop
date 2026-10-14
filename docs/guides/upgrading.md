# Updating your install

How to bring a running install up to date with the latest `main`, and how to back up your data first. Run
everything from the root of your clone. A second install (another person on the same host) is updated the
same way inside its own clone.

## Before you start: back up the database

Your food log, recipes, journal, settings and Strava history live in the data service's database. A copy
takes a few seconds:

```sh
mkdir -p backups
docker exec health-db pg_dump -U health health > "backups/health-db-$(date +%F).sql"
```

`backups/` is gitignored. On a second install the container carries its name (`health-db-second` for
`HC_INSTANCE=second`). To restore a copy into an empty database:
`docker exec -i health-db psql -U health -d health < backups/health-db-YYYY-MM-DD.sql`.

## Update

1. **Get the new code.** The page only publishes from `main`, so stay on it:

   ```sh
   git checkout main && git pull
   ```

2. **Dependencies.** `npm ci` (the hourly refresh also does it on its own when the lockfile changed).

3. **The data service.** Rebuild it; on start it applies any new database migrations:

   ```sh
   (cd services/health-ingest && docker compose up -d --build)
   ```

4. **The page service.** Restart it so it picks up a changed nginx configuration:

   ```sh
   (cd services/plan-web && docker compose up -d)
   ```

5. **Rebuild the page now** instead of waiting for the hourly run: press **Sync** on the page, or run
   `services/plan-web/refresh.sh` by hand.

Using the page without the LAN services (Level 1 only)? Steps 1–2, then `npm run generate`.

## Check

- `curl -s localhost:8088/healthz` answers `200` (use your `INGEST_PORT` if you changed it).
- `services/plan-web/site/status.json` shows the new `commit` and no `error`.
- The page opens and its freshness line is green.

If something is off, see [troubleshooting](troubleshooting.md). Release notes live in
[`CHANGELOG.md`](../../CHANGELOG.md).
