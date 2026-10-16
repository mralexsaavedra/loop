---
name: setup
description: "Trigger: setup, install, instalar, configurar, get started, empezar, first run, level 1, level 2, level 3, Docker, Strava, Shortcut, update, upgrade, actualizar, second install, segunda instalación, not working, no funciona. Walks the user through installing this repo one level at a time, checking state at every step; also updating an install, adding a second one, and troubleshooting."
---

# Guided setup by level

Run it WITH the user, in the user's language. The levels are defined in `README.md` → Setup; the
detail lives in the linked docs: read them, do not copy them into chat.

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
  loop-data/cache/plan.json loop-data/cache/training.json loop-data/files/import/export.xml loop-data/import-state.json \
  loop-data/extract/_meta.json web/dist/personal/index.html services/loop-ingest/.env; do
  test -e "$f" && echo "yes $f" || echo "no  $f"; done
# personal files at the old paths (a clone from before the data root loop-data/): counts only
npm run -s migrate:data-root -- --dry-run
command -v docker >/dev/null && docker compose version || echo "docker: no"
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
running) and propose the next level. The dry run says "would move N files" → the clone predates `loop-data/`:
before anything else, `npm run migrate:data-root` (`docs/guides/upgrading.md` → Your personal files move to
`loop-data/`). Node below `engines` →
stop until upgraded.

## Level 1 — Apple Health + Claude (local)

1. `npm ci`.
2. **Apple Health export** (iPhone): Health → profile picture (top right) → *Export All Health Data* →
   Export → send the zip to the computer. Put the zip, as it is (no unzipping), in `loop-data/files/import/`
   (`mkdir -p loop-data/files/import`) and run `npm run import:health`; verify `loop-data/extract/_meta.json`
   exists (`loop-data/import-state.json` records the import; exit 1 = a damaged or incomplete zip: export again).
   A later export: drop the new zip there and run it again (the same zip twice is skipped).
   Manual way, still valid: unzip, put `export.xml` (`exportación.xml` on a Spanish iPhone, renamed) in that folder,
   `node data/apple-health/extract.mjs`.
3. **Onboarding**: no `profile/about-me.md` → run `docs/onboarding.md` (writes `profile/about-me.md`,
   `profile/baseline.md`, `profile/coaches.md`).
4. **Seeds** (skip any that exist; `mkdir -p loop-data/cache`, `cp -n`): `data/nutrition/plan-data.example.json` →
   `loop-data/cache/plan.json`; optional `data/training/training-data.example.json` →
   `loop-data/cache/training.json` (`docs/training.md`), `profile/profile.example.json` →
   `loop-data/cache/profile.json`. `npm run check`.
5. `npm run generate`; open `web/dist/personal/index.html` (`open` on macOS, `xdg-open` on Linux; it is
   self-contained, no server).
6. Goal without Level 2: ask their goal (cut / maintain / bulk) and target weight and write
   `loop-data/profile/settings.json` = `{"goal": "...", "targetWeightKg": N}` (gitignored; Level 2's sync
   overwrites it later). Spanish speaker? set `"locale": "es"` in `loop-data/cache/plan.json` and regenerate.
7. Offer the first analysis: the `/analysis` skill (`.claude/skills/analysis/SKILL.md`).

## Level 2 — food log + live page on the LAN (Docker)

Needs a Linux host with Docker (compose), systemd and Node 22. Follow the ordered install in
`services/loop-web/README.md` → Install (host); env reference in `services/loop-ingest/README.md`.

1. Env file from the example, secrets generated in place and never shown:
   ```sh
   cd services/loop-ingest && cp -n .env.example .env && chmod 600 .env
   sed -i.tmp "s/^INGEST_TOKEN=.*/INGEST_TOKEN=$(openssl rand -hex 32)/; s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env && rm .env.tmp
   grep -c 'replace-me' .env   # must print 0
   ```
2. The loop-web install steps in order (`services/loop-web/README.md` → Install (host), steps 1–10: the
   trigger and `site/` dirs BEFORE `docker compose up`, the first `refresh.sh` by hand, the crontab line, the
   systemd units; the clone stays on `main`). Check the host first: Linux with systemd, `flock`, Node 22 —
   on macOS / Windows stop and say Level 2 needs a Linux box. Each `sudo` step: show it and let the user run it.
3. Verify: `curl -s -o /dev/null -w '%{http_code}\n' "http://$IA:$IP/healthz"` → 200; the loop-web smoke test from its README.
   The page's own onboarding assistant then opens on the first visit (no profile and no goal on the
   server): a user without Claude Code sets up profile and targets there (`docs/profile.md`).
4. `npm run documents -- push all`: imports the profile, plan and program files into the data service (from now
   on the coach edits a file and pushes it; `docs/data-pipeline.md` → Owner documents). A refused file lists
   the rules it breaks: fix it and push again.
5. `npm run sync`: each `WARNING:` line names a source not refreshed; report it.

## Level 3 — live sync and knowledge base

- **iOS Shortcut**: `docs/ios-shortcut.md`. First pick the address (*Where the phone sends the data*:
  home Wi-Fi `http://<server-ip>:8090` unless they want to sync away from home), then import the
  ready-made Shortcut and walk its edit list (URL, token, every *Source is* filter), or build it one
  action at a time; finish with the Verify section. A watch that is not an Apple Watch (Xiaomi, Garmin,
  Amazfit…): its app must write to Apple Health and the filters point at that app (same doc, "Another watch
  or band"). The user copies the token from
  `services/loop-ingest/.env` on their own screen.
- **Strava**: `docs/data-pipeline.md` → Strava sync; credentials per `services/loop-ingest/README.md`
  → Strava. Walk "Getting the Strava credentials" there step by step (API app,
  authorize URL, copy the code, token exchange — easiest with `node scripts/strava-auth.js` from
  `services/loop-ingest`, which writes the refresh token into `.env` itself); the user types
  `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` into `services/loop-ingest/.env` themselves. Then `docker compose up -d` there, `npm run sync`.
  On a loop-server install (`docker/`, preview) the two values go into `docker/.env`, then
  `docker compose up -d` and `docker compose exec loop-server node services/loop-ingest/scripts/strava-auth.js --print`,
  which prints the `STRAVA_REFRESH_TOKEN=` line the user pastes into `docker/.env` (then `docker compose up -d`).
- **Knowledge base**: `docs/knowledge-base.md`, `knowledge/README.md`. `yt-dlp` is optional; content is
  for personal use only. Ingest with `scripts/ingest-youtube.mjs`, then register each source in
  `profile/coaches.md`.

## A coach clone of a loop-server install (preview)

The server (`docker/docker-compose.yml`) owns the data; the clone opened in Claude Code is its client. In the clone:
`INGEST_URL=http://<server>:<INGEST_PORT>` and the server's `INGEST_TOKEN` (env, never shown in the chat), then
`npm run sync`: it must print `Client mode: ...` and a `Mirror: ...` count line (`docs/data-pipeline.md` → Coach as a
client of a LOOP server). A `401` error = wrong token. Documents and manuals go into the server's files folder.

## Updating an install

`docs/guides/upgrading.md`, step by step: pull `main`, `npm ci`, `npm run migrate:data-root` when the dry run
finds files at the old paths (before any Sync), rebuild the data service (it applies new database migrations on
start), restart the page service, refresh, verify. A second install is updated the same
way in its own clone.

## A second install (another person, same host)

`services/loop-web/README.md` → Running a second install: a second clone, its own name (`HC_INSTANCE`) and
ports in both env files, renamed systemd units and a staggered cron line. Check afterwards that `docker ps`
shows both sets of containers and each `site/status.json` its own build.

## Something does not work

`docs/guides/troubleshooting.md`: find the symptom, run its Check commands (with `$IP` / `$WP`), apply the Fix.

## Close

Re-run Step 0, show the new checklist, name the next level (or "done").
