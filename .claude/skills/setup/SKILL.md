---
name: setup
description: "Trigger: setup, install, instalar, configurar, get started, empezar, first run, server, servidor, coach, Docker, docker compose, Strava, Shortcut, update, upgrade, actualizar, second install, segunda instalación, not working, no funciona. Walks the user through installing LOOP (the server from the Docker images, the coach clone, or both) one step at a time, checking state at every step; also updating an install, adding a second one, and troubleshooting."
---

# Guided setup: server and coach

Run it WITH the user, in the user's language. The two install paths are defined in `README.md` → Setup:
the **server** (`docker/docker-compose.yml` + `docker/.env.example` in a folder of their own, the published
`loop-server` and `loop-web` images; no clone needed) and the **coach** (this clone, opened in Claude Code, a client
of the server). The detail lives in the linked docs: read them, do not copy them into chat.

## Rules

- **One step at a time.** Say what the step does, run or hand it over, then WAIT for the user.
- **Check, don't assume.** Verify every step with a command and report the observed result.
- **On failure, stop**: show the error, explain it, propose the fix from the doc. Never improvise.
- **Phone / website steps**: give the exact taps or clicks, then wait for "done".
- **Secrets**: never print, echo, `cat` or log them; never ask the user to paste one in chat. Generate
  them in place or let the user type them into the env file themselves.
- **Personal files**: never overwrite one (`cp -n`); to replace, first back it up to
  `backups/<same path>.<label>.bak`. Never commit them (the guard hook, `docs/guard-hook.md`, blocks
  force-adds).

## Step 0 — detect state (read-only)

```sh
node -v; node -p "require('./package.json').engines.node"
test -d node_modules && echo "deps: yes" || echo "deps: no"
for f in profile/about-me.md profile/baseline.md profile/coaches.md loop-data/cache/profile.json \
  loop-data/cache/plan.json loop-data/cache/training.json loop-data/import-state.json \
  loop-data/extract/_meta.json web/dist/personal/index.html services/loop-ingest/.env; do
  test -e "$f" && echo "yes $f" || echo "no  $f"; done
# personal files at the old paths (a clone from before the data root loop-data/): counts only
npm run -s migrate:data-root -- --dry-run
command -v docker >/dev/null && docker compose version || echo "docker: no"
# LOOP containers on this host (names, images and state only): loop-server + loop-web = the images,
# loop-ingest = host mode
command -v docker >/dev/null && docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}' | grep -E '^loop-(db|server|web|ingest)'
```

Ask where the server's folder is (the one holding its `docker-compose.yml` and `.env`) when a `loop-server`
container runs; read ports and binds from that `.env` with the same digits-only filter as below, never a whole line.
For a host-mode install (`loop-ingest` container, `services/loop-ingest/.env` in this clone):

```sh
# the ports each install uses (not secrets; defaults 8088 / 8090 when the env files do not set them)
# (only the digits of that one line ever come out)
IP=$(grep -sE '^[[:space:]]*INGEST_PORT=' services/loop-ingest/.env | head -1 | cut -d= -f2 | tr -dc 0-9); IP=${IP:-8088}
WP=$(grep -sE '^[[:space:]]*PLAN_WEB_PORT=' services/loop-web/.env | head -1 | cut -d= -f2 | tr -dc 0-9); WP=${WP:-8090}
# an optional bind address (INGEST_BIND / PLAN_WEB_BIND) replaces 127.0.0.1; only address characters come out
IA=$(grep -sE '^[[:space:]]*INGEST_BIND=' services/loop-ingest/.env | head -1 | cut -d= -f2 | tr -dc '0-9a-fA-F.:'); IA=${IA:-127.0.0.1}
WA=$(grep -sE '^[[:space:]]*PLAN_WEB_BIND=' services/loop-web/.env | head -1 | cut -d= -f2 | tr -dc '0-9a-fA-F.:'); WA=${WA:-127.0.0.1}
case "$IA" in *:*) IA="[$IA]";; esac; case "$WA" in *:*) WA="[$WA]";; esac
curl -s -m 3 -o /dev/null -w "ingest /healthz %{http_code}\n" "http://$IA:$IP/healthz"
curl -s -m 3 -o /dev/null -w "loop-web %{http_code}\n" "http://$WA:$WP/status.json"
```

Use `$IP` / `$WP` (never a hard-coded port) in every later check. Report a short checklist (`000` = not
running) and propose the next path (server first when the user wants the page or the Shortcut; coach when they
want analyses). The dry run says "would move N files" → the clone predates `loop-data/`: before anything else,
`npm run migrate:data-root` (`docs/guides/upgrading.md` → Your personal files move to `loop-data/`). Node below
`engines` → stop until upgraded.

## Server — the images (no clone needed)

Needs a machine that stays on with Docker Compose (`linux/amd64` or `linux/arm64`). Follow `README.md` → Setup →
Server step by step; reference: `docs/lan-services.md` → The stack.

1. A folder of its own with `docker-compose.yml` and `.env` (from `.env.example`) of the release, and the files
   folder created BEFORE the first start (`mkdir -p files/import files/manuals files/documents`; Docker would
   create it root-owned). From this clone the two files are `docker/docker-compose.yml` and `docker/.env.example`
   (copy them out; `cp -n`).
2. Secrets generated in place and never shown:
   ```sh
   chmod 600 .env
   sed -i.tmp "s/^INGEST_TOKEN=.*/INGEST_TOKEN=$(openssl rand -hex 32)/; s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env && rm .env.tmp
   grep -cE '^(INGEST_TOKEN|POSTGRES_PASSWORD)=$' .env   # must print 0
   ```
   Walk the rest of `.env` with them: `INGEST_BIND` (`127.0.0.1` unless a coach on another computer syncs from it),
   `PLAN_WEB_BIND` (the LAN IP on a host with a public address), `HC_INSTANCE` + ports for a second install.
3. `docker compose up -d`, then `docker compose ps` (three `healthy`) and the `/healthz` check (`200`).
4. The page at `http://<server-ip>:<PLAN_WEB_PORT>`: its onboarding assistant opens on the first visit (no profile
   and no goal on the server): a user without Claude Code sets up profile and targets there (`docs/profile.md`).
5. Apple Health history: the export zip, as it is, into `files/import/`, then Sync on the page; verify with
   `docker compose exec loop-server cat /data/import-state.json` (`lastError` = a damaged zip: export again).

## Coach — this clone

1. `npm ci`.
2. Connect to the server: the user runs `npm run connect -- http://<server>:<INGEST_PORT>` in their own terminal;
   it asks for the server's `INGEST_TOKEN` without echoing it (never in the chat, never in shell history) and saves
   `loop-data/server.json` (mode 600), so every later sync finds the server (`npm run connect -- --forget` removes
   it). Then `npm run sync`: it must print `Client mode: ...` and a `Mirror: ...` count line (`docs/data-pipeline.md` → Coach as a client of a LOOP server).
   A `401` error = wrong token; a connection error from another computer = `INGEST_BIND` is loopback only on the
   server (`README.md` → Setup → Coach, step 3). Documents and manuals go into the server's files folder (a file
   only in the clone is kept but never published).
3. **Onboarding**: no `profile/about-me.md` → run `docs/onboarding.md` (writes `profile/about-me.md`,
   `profile/baseline.md`, `profile/coaches.md`).
4. `npm run documents -- push all` when the clone has profile, plan or program files the server does not: imports
   them into the data service (from then on the coach edits a file and pushes it; `docs/data-pipeline.md` → Owner
   documents). A refused file lists the rules it breaks: fix it and push again.
5. Offer the first analysis: the `/analysis` skill (`.claude/skills/analysis/SKILL.md`).

### Coach without a server (local only)

1. `npm ci`.
2. **Apple Health export** (iPhone): Health → profile picture (top right) → *Export All Health Data* →
   Export → send the zip to the computer. Put the zip, as it is (no unzipping), in `loop-data/files/import/`
   (`mkdir -p loop-data/files/import`) and run `npm run import:health`; verify `loop-data/extract/_meta.json`
   exists (`loop-data/import-state.json` records the import; exit 1 = a damaged or incomplete zip: export again).
   A later export: drop the new zip there and run it again (the same zip twice is skipped).
   Manual way, still valid: unzip, put `export.xml` (`exportación.xml` on a Spanish iPhone, renamed) in that folder,
   `node data/apple-health/extract.mjs`.
3. **Onboarding** as above.
4. **Seeds** (skip any that exist; `mkdir -p loop-data/cache`, `cp -n`): `data/nutrition/plan-data.example.json` →
   `loop-data/cache/plan.json`; optional `data/training/training-data.example.json` →
   `loop-data/cache/training.json` (`docs/training.md`), `profile/profile.example.json` →
   `loop-data/cache/profile.json`. `npm run check`.
5. `npm run generate`; open `web/dist/personal/index.html` (`open` on macOS, `xdg-open` on Linux; it is
   self-contained, no server).
6. Goal without a server: ask their goal (cut / maintain / bulk) and target weight and write
   `loop-data/profile/settings.json` = `{"goal": "...", "targetWeightKg": N}` (gitignored; a server's sync
   overwrites it later). Spanish speaker? set `"locale": "es"` in `loop-data/cache/plan.json` and regenerate.
7. Offer the first analysis.

## Extras — Shortcut, Strava, knowledge base

- **iOS Shortcut**: `docs/ios-shortcut.md`. First pick the address (*Where the phone sends the data*:
  home Wi-Fi `http://<server-ip>:8090` unless they want to sync away from home), then import the
  ready-made Shortcut and walk its edit list (URL, token, every *Source is* filter), or build it one
  action at a time; finish with the Verify section. A watch that is not an Apple Watch (Xiaomi, Garmin,
  Amazfit…): its app must write to Apple Health and the filters point at that app (same doc, "Another watch
  or band"). An error on the phone: same doc, Troubleshooting. The user copies the token from the server's
  `.env` on their own screen.
- **Strava**: credentials per `services/loop-ingest/README.md` → Strava ("Getting the Strava credentials": API app,
  authorize URL, copy the code). The user types `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` into the server's
  `.env` themselves, then `docker compose up -d` and
  `docker compose exec loop-server node services/loop-ingest/scripts/strava-auth.js --print`, which prints the
  `STRAVA_REFRESH_TOKEN=` line the user pastes into `.env` (then `docker compose up -d`). Host mode:
  `node scripts/strava-auth.js` from `services/loop-ingest` writes it into `services/loop-ingest/.env` itself.
- **Knowledge base**: `docs/knowledge-base.md`, `knowledge/README.md`. `yt-dlp` is optional; content is
  for personal use only. Ingest with `scripts/ingest-youtube.mjs`, then register each source in
  `profile/coaches.md`.

## Host mode (development / legacy)

The services run from this clone (`services/loop-ingest` + `services/loop-web`, the page built on the host by
`services/loop-web/refresh.sh`, a systemd path unit and a cron line). Only for development or an install not yet
moved to the images: needs Linux with systemd, `flock` and Node 22. Follow the ordered install in
`services/loop-web/README.md` → Install (host) (steps 1–10; env reference in `services/loop-ingest/README.md`), with
the env file from `services/loop-ingest/.env.example` and secrets generated in place as above; the clone stays on
`main`. Each `sudo` step: show it and let the user run it. Verify: `/healthz` → 200 and the loop-web smoke test from
its README; then `npm run documents -- push all` and `npm run sync` (each `WARNING:` line names a source not
refreshed; report it).

## Updating an install

`docs/guides/upgrading.md`, step by step. A server: back up the database, set `HC_VERSION` in `.env`,
`docker compose pull && docker compose up -d`, verify. A coach clone: `git pull && npm ci`, `npm run sync`. Host
mode: pull `main`, `npm ci`, `npm run migrate:data-root` when the dry run finds files at the old paths (before any
Sync), rebuild the data service (it applies new database migrations on start), restart the page service, refresh,
verify. A second install is updated the same way in its own folder or clone.

## A second install (another person, same host)

`docs/lan-services.md` → A second install: a second folder with its own `.env`, its own name (`HC_INSTANCE`) and
ports. Check afterwards that `docker ps` shows both sets of containers and each page's `status.json` its own build.
Host mode: `services/loop-web/README.md` → Running a second install (a second clone, both env files, renamed
systemd units, a staggered cron line).

## Something does not work

`docs/guides/troubleshooting.md`: find the symptom, run its Check commands (with `$IP` / `$WP`), apply the Fix.

## Close

Re-run Step 0, show the new checklist, propose the next path (server or coach) or the next step of the current
one (or "done").
