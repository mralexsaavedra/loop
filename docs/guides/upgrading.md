# Updating your install

How to bring a running install up to date with the latest `main`, and how to back up your data first. Run
everything from the root of your clone. A second install (another person on the same host) is updated the
same way inside its own clone.

## Before you start: back up the database

Your food log, recipes, journal, settings and Strava history live in the data service's database. A copy
takes a few seconds:

```sh
mkdir -p backups
docker exec loop-db pg_dump -U health health > "backups/loop-db-$(date +%F).sql"
```

`backups/` is gitignored. On a second install the container carries its name (`loop-db-second` for
`HC_INSTANCE=second`). To restore a copy into an empty database:
`docker exec -i loop-db psql -U health -d health < backups/loop-db-YYYY-MM-DD.sql`.

## Update

1. **Get the new code.** The page only publishes from `main`, so stay on it:

   ```sh
   git checkout main && git pull
   ```

2. **Dependencies.** `npm ci` (the hourly refresh also does it on its own when the lockfile changed).

3. **The data service.** Rebuild it from your clone; on start it applies any new database migrations:

   ```sh
   (cd services/loop-ingest && docker compose up -d --build)
   ```

   Or, on a release, run the published image instead of building (`mralexandersaavedra/loop-ingest`, the version
   comes from the clone; set `HC_VERSION` in `.env` to pin another):

   ```sh
   (cd services/loop-ingest && docker compose pull loop-ingest && docker compose up -d)
   ```

4. **The page service.** Recreate it so it picks up a changed nginx configuration or compose file:

   ```sh
   (cd services/loop-web && docker compose up -d)
   ```

   `up -d` (not `restart`) is what applies a changed `docker-compose.yml`, such as the container hardening
   below; `docker compose ps` should then show `healthy` for every container.

5. **Rebuild the page now** instead of waiting for the hourly run: press **Sync** on the page, or run
   `services/loop-web/refresh.sh` by hand.

Using the page without the LAN services (Level 1 only)? Steps 1–2, then `npm run generate`.

## Check

- `curl -s localhost:8088/healthz` answers `200` (use your `INGEST_PORT` if you changed it).
- `services/loop-web/site/status.json` shows the new `commit` and no `error`.
- The page opens and its freshness line is green.

If something is off, see [troubleshooting](troubleshooting.md). Release notes live in
[`CHANGELOG.md`](../../CHANGELOG.md).

## Release notes for existing installs

### The robustness release (migrations ledger, container hardening)

Nothing to change in your `.env` files: no new variable is required. Back up first (above), then run the
**Update** steps; in detail:

- **Step 3** recreates `loop-db` and `loop-ingest` with the hardening (read-only root filesystem, dropped
  capabilities, limits, rotated logs) and creates the migrations ledger on the first start: the service
  re-runs each existing `sql/` file once (they are idempotent; no row changes) and records it in
  `schema_migrations`. The logs show eleven `migration_applied` lines on that first start and none after.
  Check: `docker exec loop-db psql -U health -d health -c "SELECT count(*) FROM schema_migrations"` answers
  `11`. The database password is now passed to the service as its own field, so a `POSTGRES_PASSWORD`
  holding `@ : / ? # %` works too (it used to stop the service with `Invalid URL`).
- **Step 4** recreates `loop-web` with the hardening, its healthcheck and the new nginx rules (rate limits on
  `/api/*` and `/ingest/*`, the write check bound to the page's own address). Behind an SSO tunnel, keep the
  public host in both `PLAN_WEB_EXTRA_HOSTS` and `FOOD_ALLOWED_HOSTS` (as before).
- **Optional, the refresh unit**: the template gained more systemd hardening. To use it, install the unit
  again ([`services/loop-web/README.md`](../../services/loop-web/README.md), Install step 8: the same
  `sed ... | sudo tee` loop), then `sudo systemctl daemon-reload`. The installed unit keeps working if you
  skip this.
- **Optional, the git pre-commit hook** against committing personal data:
  `git config core.hooksPath scripts/git-hooks` ([`docs/guard-hook.md`](../guard-hook.md)).

A second install does the same in its own clone; its containers carry the `HC_INSTANCE` suffix, so every
`docker exec` above names `loop-db-<instance>` (e.g. `loop-db-second`) instead of `loop-db`.

## Moving from the pre-LOOP names

Installs created before 2026-10-15 run under the old names (`services/health-ingest`, `services/plan-web`, containers
`health-db` / `health-ingest` / `plan-web`, volume `health-ingest_health-db-data`, units `plan-web-refresh.*`). Pulling
the rename moves the code but not your runtime files or your data, so do this once, in order (a second install adds
its `-<instance>` suffix to every container, project and volume name):

1. **Back up with the old name**:
   `docker exec health-db pg_dump -U health health > "backups/health-db-$(date +%F).sql"`, and note the row counts
   (`docker exec health-db psql -U health -d health -c "SELECT count(*) FROM food_log"`, and the same for the other
   tables you rely on).
2. **Stop the old stacks**, keeping the volume (never `-v`):
   `sudo systemctl disable --now plan-web-refresh.path`, comment out the `refresh.sh` crontab line, then
   `docker compose -p health-ingest down` and `docker compose -p plan-web down`.
3. **Pull** and **move the runtime files** into the new folders:
   `services/health-ingest/{.env,trigger}` -> `services/loop-ingest/`,
   `services/plan-web/{.env,site,.refresh-state}` -> `services/loop-web/` (skip what does not exist).
4. **Copy the data** into the new, explicitly named volume:
   `docker volume create loop-db-data`, then
   `docker run --rm -v health-ingest_health-db-data:/from -v loop-db-data:/to alpine sh -c 'cp -a /from/. /to/'`.
5. **Start the new stacks**: `cd services/loop-ingest && docker compose up -d --build`, then
   `cd ../loop-web && docker compose up -d`; compare the row counts (`docker exec loop-db psql ...`).
6. **Install the renamed units** and point the crontab line at `services/loop-web/refresh.sh`
   ([`services/loop-web/README.md`](../../services/loop-web/README.md), steps 7-8), then remove the old
   `plan-web-refresh.*` unit files.
7. Keep the old volume until the page, the food log and the Strava status look right; then
   `docker volume rm health-ingest_health-db-data`.
