> **English** · [Español](upgrading.es.md)

# Updating your install

How to bring an install up to date, and how to back up your data first. A **server** installed from the images
(`docker-compose.yml` + `.env` in a folder of their own, [`README.md` → Setup](../../README.md#setup)) updates by
pulling the new images; a **coach clone** by pulling the code; an older **host-mode** install (the services run from
a clone, [below](#update-a-host-mode-install-development--legacy)) by pulling and rebuilding. A second install is
updated the same way in its own folder or clone.

## Before you start: back up the database

Your food log, recipes, journal, settings, documents and Strava history live in the database. A copy takes a few
seconds; on a server, from the folder holding `docker-compose.yml`:

```sh
(
umask 077
mkdir -p backups
cp .env "backups/env-$(date +%F)"
docker compose exec -T loop-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "backups/loop-db-$(date +%F).sql"
)
```

`umask 077` keeps the copies readable by you only (they hold your health data and your secrets). Keep the copy
of `.env` with the dump: the iOS Shortcut keeps sending the same `INGEST_TOKEN`, and an existing database volume
only accepts the `POSTGRES_PASSWORD` it was created with, so a restore puts that `.env` back first.

To restore a copy into an empty database (a new install, or after `docker compose down -v`): start only the
database and wait until it accepts connections (`--wait`), load the copy, then start the rest. Paste the block
as a whole: the `&&` at each line end stops it at the first error, so the rest never starts on an empty or
half-loaded database (a database that is not empty refuses the copy with `relation ... already exists`, and
nothing changes):

```sh
docker compose up -d --wait loop-db &&
docker compose exec -T loop-db sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/loop-db-YYYY-MM-DD.sql > /dev/null &&
docker compose up -d
```

Keep the Apple Health export zip in `files/import/` too: it is the source of your Health history.

On a host-mode install the same copy is `docker exec loop-db pg_dump -U health health > "backups/loop-db-$(date +%F).sql"`
in the clone (restore, into an empty database:
`docker exec -i loop-db psql -q -v ON_ERROR_STOP=1 -U health -d health < backups/loop-db-YYYY-MM-DD.sql`); on a
second install the container carries its name (`loop-db-second` for `HC_INSTANCE=second`).

## Update the server

1. **Read the release notes** of the new version in [`CHANGELOG.md`](../../CHANGELOG.md): they say when a release
   needs more than the steps below (a new variable in `.env`, a new compose file).
2. **Back up** (above).
3. **Pick the version**: set `HC_VERSION` in `.env` to the new release (e.g. `HC_VERSION=1.0.1`). When the notes
   say the compose file changed, download that release's `docker-compose.yml` over yours (the README's `curl -fsSLO`
   line with the new version in the URL); keep your `.env`.
4. **Pull and restart**:

   ```sh
   docker compose pull && docker compose up -d
   ```

   The data service applies any new database migrations on start, and the page is rebuilt a few seconds later.

## Update a coach clone

```sh
git pull && npm ci
npm run sync
```

The clone stays a client of the server: nothing else to restart.

## Check

- `docker compose ps`: every container `healthy`.
- `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8088/healthz` prints `200` (use your `INGEST_PORT` /
  `INGEST_BIND` if you changed them; without `-o /dev/null -w ...` it prints the JSON body, `{"ok":true,...}`).
- `http://<server-ip>:8090/status.json` shows the new version as `commit` and no `error` (host mode:
  `services/loop-web/site/status.json`, the git commit).
- The page opens and its freshness line is green.

If something is off, see [troubleshooting](troubleshooting.md).

## Update a host-mode install (development / legacy)

Run everything from the root of the clone.

1. **Get the new code.** The page only publishes from `main`, so stay on it:

   ```sh
   git checkout main && git pull
   ```

2. **Dependencies.** `npm ci` (the hourly refresh also does it on its own when the lockfile changed).
   Coming from before the data root `loop-data/`? Move your personal files now, before the next Sync
   ([release note below](#your-personal-files-move-to-loop-data)): `npm run migrate:data-root`.

3. **The data service.** Rebuild it from your clone; on start it applies any new database migrations (its image is
   no longer published, so always `--build`):

   ```sh
   (cd services/loop-ingest && docker compose up -d --build)
   ```

   Coming from before the `loop-net` network, add `--force-recreate` once
   ([release note below](#loop-web-reaches-the-data-service-over-loop-net)).

4. **The page service.** Recreate it so it picks up a changed nginx configuration or compose file:

   ```sh
   (cd services/loop-web && docker compose up -d --force-recreate)
   ```

   `--force-recreate` applies both a changed `docker-compose.yml` (such as the container hardening below) and a
   changed `nginx.conf.template`, which is bind-mounted and rendered only when the container starts: a plain
   `up -d` leaves the container alone when only the template changed. `docker compose ps` should then show
   `healthy` for every container.

5. **Rebuild the page now** instead of waiting for the hourly run: press **Sync** on the page, or run
   `services/loop-web/refresh.sh` by hand.

Using the page without any server (coach, local only)? Steps 1–2, then `npm run generate`.

## Moving a host-mode install to the images

A host-mode install moves to the images in place, from its own clone: the stack in `docker/` reuses the same
database volume (`loop-db-data`, by name), the same ports and the same `INGEST_TOKEN`, so the iOS Shortcut, the
page's address and a coach clone keep working, and the page is rebuilt from the same files. The page is down for a
few minutes (steps 4 to 7). Run every command on the server, from the root of the clone. A second install moves the
same way from its own clone: every name below gains its suffix (`loop-db-second`, `loop-server-data-second`,
`loop-web-refresh-second.path` for `HC_INSTANCE=second`).

1. **Update the clone**:

   ```sh
   git checkout main && git pull && npm ci
   ```

2. **Create `docker/.env`** from the two host-mode files, plus the files folder of the clone:

   ```sh
   (umask 077 && { cat services/loop-ingest/.env; echo; cat services/loop-web/.env; echo; echo 'HC_FILES_LOCATION=../loop-data/files'; } > docker/.env)
   chmod 600 docker/.env
   (cd docker && docker compose config -q) && echo valid
   ```

   The stack reads the same variables as the two host-mode files (`docker/example.env` is their union plus
   `HC_FILES_LOCATION` and a few `HC_*` settings), so the copy carries over the token, the database credentials,
   the ports, `HC_INSTANCE`, the extra hosts and Strava. A variable in both files (`HC_INSTANCE`, or an old
   `INGEST_PORT` left in `services/loop-web/.env`) must hold the same value in both: delete the stale line in
   `docker/.env`. `HC_FILES_LOCATION` is relative to `docker/` (with a custom `HC_DATA_DIR`, give its `files`
   folder); the server only reads it. Never print `docker compose config` without `-q`: it shows your secrets.
   Instead, check the names it resolves, which must be the ones host mode uses today
   (`docker ps --format '{{.Names}} {{.Ports}}'` while it still runs, `docker volume ls`):

   ```sh
   (cd docker && docker compose config --format json) | node -e '
   const c = JSON.parse(require("fs").readFileSync(0, "utf8"));
   for (const v of Object.values(c.volumes)) console.log("volume", v.name);
   for (const [name, s] of Object.entries(c.services)) {
     for (const p of s.ports ?? []) console.log("port", name, `${p.host_ip || "*"}:${p.published}`);
     for (const m of s.volumes ?? []) if (m.type === "bind") console.log("files", name, m.source);
   }'
   ```

   It prints `volume loop-db-data` (the database you already have; the other two volumes are new),
   `port loop-server 127.0.0.1:8088` (your `INGEST_BIND` and `INGEST_PORT`), `port loop-web *:8090` (your
   `PLAN_WEB_PORT`) and the clone's `loop-data/files`. Then get the images: `(cd docker && docker compose build)` builds both from the clone (a few
   minutes); once your version is on Docker Hub, `(cd docker && docker compose pull)` instead.

3. **Back up** everything host mode holds, with the old stack still running:

   ```sh
   (
   umask 077
   mkdir -p backups
   stamp=$(date +%Y%m%dT%H%M)
   docker exec loop-db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "backups/loop-db-before-images-$stamp.dump"
   docker exec -i loop-db pg_restore -l < "backups/loop-db-before-images-$stamp.dump" | tail -n 3
   docker exec loop-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tc "SELECT count(*) FROM food_log"'
   tar -cf "backups/loop-data-before-images-$stamp.tar" --exclude=loop-data/files/import loop-data
   cp -a services/loop-web/site "backups/site-before-images-$stamp"
   cp services/loop-ingest/.env "backups/loop-ingest.env-before-images-$stamp"
   cp services/loop-web/.env "backups/loop-web.env-before-images-$stamp"
   cp docker/.env "backups/docker.env-before-images-$stamp"
   )
   ```

   `pg_restore -l` lists the dump's contents (an error there means a broken dump: stop). Note the food log count
   to compare later. The tarball leaves out `files/import/` (the large Health export stays where it is, and is
   not touched); the copy of `site/` keeps the published page and its `status.json`.

4. **Stop host mode**, keeping its volumes (never `down -v`): in `crontab -e`, put a `#` in front of the
   `refresh.sh` line; then

   ```sh
   sudo systemctl disable --now loop-web-refresh.path loop-web-refresh.service
   (cd services/loop-web && docker compose down)
   (cd services/loop-ingest && docker compose down)
   ```

   Both stacks must be down: the new one uses the same container names (`loop-db`, `loop-web`).

5. **Seed the server's data volume** from the clone's `loop-data/`, so the first build starts from the same
   extract, profile, food log and documents. `up --no-start` creates the volumes (empty) without starting
   anything; the copy belongs to the container's user (uid 1000). Use your `HC_VERSION` as the image tag:

   ```sh
   (cd docker && docker compose up --no-start)
   docker run --rm --user 0 -v loop-server-data:/data -v "$PWD/loop-data:/from:ro" mralexandersaavedra/loop-server:1.0.0 sh -c '
     for p in extract profile foodlog cache import-state.json .mirror-state.json; do
       if [ -e "/from/$p" ]; then cp -a "/from/$p" /data/; fi
     done
     chown -R 1000:1000 /data'
   ```

   Host mode does not import the Health export by itself, so the server would re-import the one in
   `loop-data/files/import/` on its first pass. When that is a plain `export.xml` (and the newest file there),
   record it as already imported:

   ```sh
   docker run --rm --user 0 -v loop-server-data:/data -v "$PWD/loop-data/files:/data/files:ro" mralexandersaavedra/loop-server:1.0.0 node -e '
   const fs = require("fs"), { createHash } = require("crypto");
   const file = "/data/files/import/export.xml", st = fs.statSync(file), h = createHash("sha256");
   fs.createReadStream(file).on("data", (b) => h.update(b)).on("end", () => {
     const meta = JSON.parse(fs.readFileSync("/data/extract/_meta.json", "utf8"));
     const state = { file: "export.xml", sha256: h.digest("hex"), size: st.size, mtimeMs: st.mtimeMs, importedAt: new Date().toISOString(), exportLastDate: meta.exportLastDate ?? null, rows: meta.rows ?? {} };
     fs.writeFileSync("/data/import-state.json", JSON.stringify(state, null, 2) + "\n");
     fs.chownSync("/data/import-state.json", 1000, 1000);
     console.log("recorded", state.file, state.size, "bytes");
   });'
   ```

   A zip there is imported on the first pass instead (a few minutes for a large export).

6. **Make the files readable by the container.** The server runs as uid 1000 and only reads the files folder; a
   file only its owner can read (mode 600, common for PDFs copied by hand) fails with `EACCES` and is skipped
   (a manual not published, a document missing). List and fix them:

   ```sh
   find loop-data/files -type f ! -perm -o=r -print
   find loop-data/files -type f ! -perm -o=r -exec chmod 644 {} +
   find loop-data/files -type d ! -perm -o=rx -exec chmod 755 {} +
   ```

7. **Start the stack** and check it. `--pull never` uses the images you built; with published images, drop it:

   ```sh
   (cd docker && docker compose up -d --pull never --wait)
   (cd docker && docker compose logs -f loop-server)
   ```

   The first pass starts 5 seconds after the start (database migrations first, if any); stop following the logs
   (`Ctrl-C`) when it has published. Then, with your ports:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/
   curl -s http://127.0.0.1:8090/ | grep -o '<html lang="[a-z]*"'
   curl -s http://127.0.0.1:8090/status.json
   curl -s -o /dev/null -w '%{http_code}\n' -H 'X-HC-Food: 1' http://127.0.0.1:8090/api/food/products
   curl -s -o /dev/null -w '%{http_code}\n' -H 'X-HC-Journal: 1' http://127.0.0.1:8090/api/journal/settings
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8090/ingest/health-auto-export
   ss -ltn | grep ':8088 '
   npm run sync
   ```

   Expected: `200` and your page language; `status.json` with the image version as `commit` and no `error`;
   `200` for the food log and the journal; `401` for the Shortcut route without a token (it is there and guarded);
   the data port listening on `127.0.0.1` only (with `INGEST_BIND=127.0.0.1`: from another computer it does not
   answer); and `npm run sync` printing `Client mode:` (the clone is now a client of the server; if it falls back
   to the local syncs, `npm run connect -- http://127.0.0.1:8088` once). A device manual opens at
   `http://<server-ip>:8090/manuales/<file>.pdf`, and the food log count matches the one from step 3. Open the
   page: the same data as before (only the status and version fields change).

8. **Retire the host pieces** once all of that looks right: keep a copy of the units and remove them, then delete
   the commented `refresh.sh` line with `crontab -e`:

   ```sh
   mkdir -p backups/systemd
   sudo mv /etc/systemd/system/loop-web-refresh.path /etc/systemd/system/loop-web-refresh.service backups/systemd/
   sudo systemctl daemon-reload
   ```

   From now on, update with [Update the server](#update-the-server), from `docker/` in the clone.

9. **Rollback**, at any point: the database volume was never removed, so host mode comes back as it was (with
   anything written in the meantime). Put the units back if step 8 moved them
   (`sudo mv backups/systemd/loop-web-refresh.* /etc/systemd/system/ && sudo systemctl daemon-reload`), remove
   the `#` from the `refresh.sh` line with `crontab -e`, then:

   ```sh
   (cd docker && docker compose down)
   (cd services/loop-ingest && docker compose up -d --build)
   (cd services/loop-web && docker compose up -d)
   sudo systemctl enable --now loop-web-refresh.path
   ```

   Restore the dump of step 3 only if the database itself is damaged, into an empty database (as in
   [the restore above](#before-you-start-back-up-the-database)):
   `docker exec -i loop-db sh -c 'pg_restore --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/loop-db-before-images-YYYYMMDDTHHMM.dump`.

## Release notes for existing installs

The notes below concern host-mode installs (the services run from a clone).

### Your personal files move to `loop-data/`

Every personal file of a clone now lives in one gitignored folder, the data root `loop-data/` (`HC_DATA_DIR`
moves it): the Apple Health extract (`loop-data/extract/`), the food log export (`loop-data/foodlog/`), the
profile snapshots (`loop-data/profile/`), the copies of the profile, plan and training documents
(`loop-data/cache/{profile,plan,training}.json`), the Health export (`loop-data/files/import/`), the device
manuals (`loop-data/files/manuals/`) and the coach PDFs (`loop-data/files/documents/`). The old paths are no
longer read. Right after `git pull`, BEFORE the next Sync (a sync writes into `loop-data/`, and a file there that
differs from the old one stops the move):

1. `npm run migrate:data-root -- --dry-run` prints how many files would move (nothing is written).
2. `npm run migrate:data-root` writes a backup tarball `backups/data-root-before-<UTC stamp>.tar`, copies every
   file, verifies each copy by sha256 and only then removes the old ones. A conflict (a target with other
   content) stops it before anything is written, naming each file: keep one version and run it again. A second
   run says there is nothing to move.
3. Press **Sync** (or `services/loop-web/refresh.sh`): the page is built from `loop-data/`.

Edit your documents in their new place from now on (`loop-data/cache/plan.json`, then
`npm run documents -- push plan`). A document file still at its old path makes `npm run sync` and the build print
one `WARNING:` (edits there are ignored). A second install runs the same in its own clone.

### loop-web reaches the data service over `loop-net`

loop-web's nginx now proxies to the data service over the ingest stack's Docker network (`loop-net`, or
`loop-net-<instance>` with `HC_INSTANCE`) instead of the host's published port, so `INGEST_BIND=127.0.0.1` works
and is the recommended hardening ([Network and bind address](../lan-services.md#network-and-bind-address)). The
order matters, because the ingest stack creates the network:

1. `(cd services/loop-ingest && docker compose up -d --build --force-recreate)`: both containers are recreated
   on `loop-net` (once, for this release: a plain `up -d --build` keeps `loop-db` on the removed old network and
   it stops with `could not find a network matching network mode loop-ingest_default`; this command repairs it).
2. `(cd services/loop-web && docker compose up -d --force-recreate)`: loop-web joins it.
3. Optional: `docker network rm loop-web_default` (loop-web's old, now unused network; a second install's is
   `loop-web-<instance>_default`); delete `INGEST_PORT` from `services/loop-web/.env` (no longer read); set
   `INGEST_BIND=127.0.0.1` in `services/loop-ingest/.env` and run `docker compose up -d` there.

Check: `docker network inspect loop-net --format '{{range .Containers}}{{.Name}} {{end}}'` lists `loop-db`,
`loop-ingest` and `loop-web`, and the page's Sync works. A second install does the same in its own clone, with its
own `HC_INSTANCE` in both `.env` files (`loop-net-second` for `HC_INSTANCE=second`).

The data service also refuses to start on an invalid numeric variable (`STRAVA_SYNC_MINUTES=0`,
`MAX_BODY_BYTES=8m`: one `startup_failed` line naming it), so check `docker compose logs loop-ingest` if it does
not come up after step 1.

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
