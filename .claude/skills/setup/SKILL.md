---
name: setup
description: "Trigger: setup, install, instalar, configurar, get started, empezar, first run, level 1, level 2, level 3, Docker, Strava, Shortcut. Walks the user through installing this repo one level at a time, checking state at every step."
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
for f in profile/about-me.md profile/baseline.md profile/coaches.md profile/profile.json \
  data/nutrition/plan-data.json data/training/training-data.json data/apple-health/export.xml \
  data/apple-health/extract/_meta.json web/dist/personal/index.html services/health-ingest/.env; do
  test -e "$f" && echo "yes $f" || echo "no  $f"; done
command -v docker >/dev/null && docker compose version || echo "docker: no"
curl -s -m 3 -o /dev/null -w 'ingest /healthz %{http_code}\n' http://127.0.0.1:8088/healthz
curl -s -m 3 -o /dev/null -w 'plan-web %{http_code}\n' http://127.0.0.1:8090/status.json
```

Report a short checklist (`000` = not running) and propose the next level. Node below `engines` →
stop until upgraded.

## Level 1 — Apple Health + Claude (local)

1. `npm ci`.
2. **Apple Health export** (iPhone): Health → profile picture (top right) → *Export All Health Data* →
   Export → send the zip to the computer. Unzip; put `export.xml` in `data/apple-health/`.
   Run `node data/apple-health/extract.mjs`; verify `data/apple-health/extract/_meta.json` exists.
3. **Onboarding**: no `profile/about-me.md` → run `docs/onboarding.md` (writes `profile/about-me.md`,
   `profile/baseline.md`, `profile/coaches.md`).
4. **Seeds** (skip any that exist): `data/nutrition/plan-data.example.json` →
   `data/nutrition/plan-data.json`; optional `data/training/training-data.example.json` →
   `data/training/training-data.json` (`docs/training.md`), `profile/profile.example.json` →
   `profile/profile.json`. `npm run check`.
5. `npm run generate`; open `web/dist/personal/index.html` (`open` on macOS, `xdg-open` on Linux; it is
   self-contained, no server).
6. Offer the first analysis: the `/analysis` skill (`.claude/skills/analysis/SKILL.md`).

## Level 2 — food log + live page on the LAN (Docker)

Needs a Linux host with Docker (compose), systemd and Node 22. Follow the ordered install in
`services/plan-web/README.md` → Install (host); env reference in `services/health-ingest/README.md`.

1. Env file from the example, secrets generated in place and never shown:
   ```sh
   cd services/health-ingest && cp -n .env.example .env && chmod 600 .env
   sed -i.tmp "s/^INGEST_TOKEN=.*/INGEST_TOKEN=$(openssl rand -hex 32)/; s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env && rm .env.tmp
   grep -c 'replace-me' .env   # must print 0
   ```
2. The plan-web install steps in order (`services/plan-web/README.md` → Install (host), steps 1–10: the
   trigger and `site/` dirs BEFORE `docker compose up`, the first `refresh.sh` by hand, the crontab line, the
   systemd units; the clone stays on `main`). Check the host first: Linux with systemd, `flock`, Node 22 —
   on macOS / Windows stop and say Level 2 needs a Linux box. Each `sudo` step: show it and let the user run it.
3. Verify: `curl -s http://127.0.0.1:8088/healthz` → 200; the plan-web smoke test from its README.
4. `npm run sync`: each `WARNING:` line names a source not refreshed; report it.

## Level 3 — live sync and knowledge base

- **iOS Shortcut**: walk `docs/ios-shortcut.md` (prerequisites, build, Verify section) one action at a
  time. The user copies the token from `services/health-ingest/.env` on their own screen.
- **Strava**: `docs/data-pipeline.md` → Strava sync; credentials per `services/health-ingest/README.md`
  → Strava. The user creates their own API app at <https://www.strava.com/settings/api>, runs the
  authorization flow, and types `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`
  into `services/health-ingest/.env` themselves. Then `docker compose up -d` there, `npm run sync`.
- **Knowledge base**: `docs/knowledge-base.md`, `knowledge/README.md`. `yt-dlp` is optional; content is
  for personal use only. Ingest with `scripts/ingest-youtube.mjs`, then register each source in
  `profile/coaches.md`.

## Close

Re-run Step 0, show the new checklist, name the next level (or "done").
