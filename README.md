# LOOP

[![CI](https://github.com/mralexsaavedra/loop/actions/workflows/ci.yml/badge.svg)](https://github.com/mralexsaavedra/loop/actions/workflows/ci.yml)
[![Docker Hub](https://img.shields.io/docker/v/mralexandersaavedra/loop-ingest?sort=semver&label=docker%20hub)](https://hub.docker.com/r/mralexandersaavedra/loop-ingest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A personal, data-driven health and nutrition coaching workspace operated by
[Claude Code](https://claude.com/claude-code). You drop in your own data (Apple Health export, food log,
training program); Claude onboards you, analyses real trends against a documented methodology, and
answers through four coach subagents — and a build step turns everything into one self-contained
dashboard page. **It is not medical advice** (see [Disclaimer](#disclaimer)): it does not replace a
physician or a registered dietitian.

Your data never leaves your disk: every personal file is gitignored, and a guard hook stops Claude from
committing it ([Privacy](#privacy)).

<p align="center">
  <img src="docs/screenshots/home.png" width="200" alt="Home tab: sleep, recovery and load dials, health and stress monitors, today's nutrition">
  <img src="docs/screenshots/training.png" width="200" alt="Training tab: load per modality, activity time, 30-day calendar">
  <img src="docs/screenshots/health.png" width="200" alt="Health tab: health monitor and recovery trend">
  <img src="docs/screenshots/nutrition.png" width="200" alt="Nutrition tab: day type, calories ring, macros against the goal">
</p>

## Why this exists

Recovery wearables are great at telling you how your body is doing — sleep, recovery, strain, stress — and
say nothing about what you ate. Food trackers count your macros and know nothing about last night's
sleep or today's ride. And neither can *do* anything with the other half.

Inspired by WHOOP-style recovery apps, this repo puts both halves in one place, in plain files on your own
disk:

- **A WHOOP-style dashboard** (the page is called **LOOP**): sleep, recovery, training load,
  stress, heart-rate variability, body composition — every card opens its own history.
- **Plus the food log** those apps are missing: what you ate, against targets that follow your goal
  (cut / maintain / bulk) and the day's training (rest, gym, ride, long ride).
- **Plus an agent that can read all of it.** Because everything is local files and a small local API,
  Claude Code sees the whole picture at once: sleep, HRV, every workout, every meal, your goal, your
  next race. So it can do things no single app can:
  - build next week's sessions knowing your load, your recovery and how many weeks are left to the race;
  - tell you what to eat tonight from the macros you have left and the products you actually buy —
    and log it for you;
  - write a weekly report that follows up on last week's actions with numbers, not vibes.
- **Specialist subagents.** One generalist is not enough: `cycling-coach`, `hybrid-coach` (HYROX),
  `training-coach` (any other sport) and `nutrition-coach` each answer only their own field, read the sources *you* chose for that field, and
  cite every claim. Add your own as a Markdown file in `.claude/agents/`.

It can also run **in the background**: the LAN services (Level 2) sync Apple Health, Strava and the food
log on their own and rebuild the page every hour, and a Claude Code session on an always-on machine next
to them keeps working with the same data — plus [Engram](https://github.com/Gentleman-Programming/engram)
memory, so it remembers your decisions between sessions.

*LOOP is an independent project, not affiliated with or endorsed by WHOOP.*

### What a day with it looks like

Real exchanges, in the author's own setup:

| You say | The agent |
| --- | --- |
| "I'm having 3 chicken drumsticks with skin for lunch" | Logs them in the food log (skin and bone accounted for), then tells you how much fat is left for dinner |
| "Tonight 200 g of this turkey sausage" + a photo of the label | Creates the product from the label, logs it, compares it with a regular pork sausage |
| "Strava ruined my average, I stopped 30 min at the bike shop" | Reads the ride's streams, finds the stop, gives the real moving average |
| "How did today go, training and food?" | Crosses the ride (power, HR) with the day's intake and flags what was short |
| "Analysis" | Runs `/analysis`: sync, freshness, trends, follow-up of the last report's actions, 2–4 new ones |

### Screenshots

Real data from the author's page (the profile sheet is left out). Every card opens a history view:

<p align="center">
  <img src="docs/screenshots/recovery.png" width="160" alt="Recovery detail: today's score and its contributors">
  <img src="docs/screenshots/sleep.png" width="160" alt="Sleep detail: performance, hours vs need, stages">
  <img src="docs/screenshots/bike-load.png" width="160" alt="Bike load detail: the ride and its heart-rate zones">
  <img src="docs/screenshots/stress.png" width="160" alt="Stress detail: hour-by-hour stress and time per level">
  <img src="docs/screenshots/hrv-trend.png" width="160" alt="HRV trend: 30-day chart against the usual range">
  <img src="docs/screenshots/nutrition-score.png" width="160" alt="Nutrition score trend and calendar">
</p>

Want to see it without your own data? `npm run build:example` builds the same page from a synthetic demo
dataset.

## What you get

| Piece | What it does |
| --- | --- |
| Onboarding | On a fresh clone Claude interviews you and writes your profile, baseline and coach config ([`docs/onboarding.md`](docs/onboarding.md)) |
| `/analysis` skill | Sync → freshness check → trends per [`analysis/methodology.md`](analysis/methodology.md) → a dated report in `analysis/reports/` |
| Coach subagents | `cycling-coach`, `hybrid-coach`, `training-coach`, `nutrition-coach`: read-only, cite every claim, configured by your gitignored `profile/coaches.md` ([`docs/knowledge-base.md`](docs/knowledge-base.md)) |
| The page | `npm run generate` → `web/dist/personal/index.html`: Home, Training, Health, Nutrition tabs; tap any card for its history ([a tour of the page](docs/guides/page-tour.md)) |
| Guard hook | Blocks force-adding ignored (personal) files and un-ignoring them in `.gitignore` ([`docs/guard-hook.md`](docs/guard-hook.md)) |

`CLAUDE.md` is the operating manual Claude reads every session. Every guide and reference doc is listed
in the [documentation index](docs/README.md).

## Prerequisites

- **[Claude Code](https://claude.com/claude-code).**
- **Node.js `>=22.12`** (`engines` in `package.json`).
- **An iPhone (Apple Health)** for the health data — the export is made on the phone; any OS can run
  the tooling.
- **Docker on a Linux machine that stays on** — only for Level 2 (the LAN services).
- **[Engram](https://github.com/Gentleman-Programming/engram)** — optional persistent memory across
  sessions. Without it, durable state lives in the tracked files and `CHANGELOG.md`.

## Setup — pick your level

Each level works on its own; stop wherever you like. Or run `/setup` in Claude Code and it walks you
through it: it checks what is already in place, then goes one step at a time.

### Level 1 — Apple Health + Claude (local only)

1. **Install the tools** (once): [Node.js 22 LTS](https://nodejs.org/) (`node -v` prints `v22.12` or
   newer), [git](https://git-scm.com/downloads) and [Claude Code](https://claude.com/claude-code).
2. **Get the code:**

   ```sh
   git clone https://github.com/mralexsaavedra/loop.git
   cd loop
   npm ci
   ```

3. **Export Apple Health:** iPhone → Health → your photo → *Export All Health Data*. Put the zip, as it is, in
   `loop-data/files/import/` (`mkdir -p loop-data/files/import` first; `loop-data/` is the gitignored folder that
   holds all your personal data), then run `npm run import:health` (it caches small per-metric CSVs; re-run after each
   new export, the same zip twice is skipped). Unzipped it yourself? Put `export.xml` there and run
   `node data/apple-health/extract.mjs`. No export yet? See the demo first: `npm run build:example` and open `web/dist/example/index.html`.
4. **Start Claude Code and say hi** (`claude` inside the folder). With no profile yet it runs the
   onboarding interview and writes `profile/about-me.md`, `profile/baseline.md` and `profile/coaches.md`
   for you (all gitignored). Prefer to fill them yourself? Copy each `*.example.md` → `*.md`.
5. **Ask for an analysis** — or type `/analysis`.
6. **See the page:** `mkdir -p loop-data/cache`, copy `data/nutrition/plan-data.example.json` → `loop-data/cache/plan.json` (and, optionally,
   `data/training/training-data.example.json` → `loop-data/cache/training.json`, `profile/profile.example.json` →
   `loop-data/cache/profile.json`), then `npm run generate` and open `web/dist/personal/index.html`.

**Your goal for Claude's analyses** (cut / maintain / bulk and a target weight) normally comes from the
Level 2 settings. Without the server, tell Claude during onboarding, or create
`loop-data/profile/settings.json` yourself (gitignored):

```json
{ "goal": "cut", "targetWeightKg": 70 }
```

The page itself keeps the goal you pick in it, in the browser.

**Language:** the page is in English unless `loop-data/cache/plan.json` says `"locale": "es"` (Spanish); then run
`npm run generate` again.

Optional extras for this level:

| Want | Do | Doc |
| --- | --- | --- |
| Your own nutrition plan | Edit `loop-data/cache/plan.json` (servings, day plan, `targets.byGoal`); the food DB `ingredients.json` ships tracked | [`docs/guides/your-plan.md`](docs/guides/your-plan.md) |
| Today's programmed session | Fill `loop-data/cache/training.json` by date (Claude can transcribe a coach's PDF) | [`docs/guides/your-plan.md`](docs/guides/your-plan.md) → The training plan |
| Try it with no data | `npm run build:example`, then open `web/dist/example/index.html` (synthetic demo data; its days end on 28 Sep 2026, so open any card to see the history) | [`data/demo/README.md`](data/demo/README.md) |

### Level 2 — food log + live page on your LAN (Docker)

What you get: the page at `http://<server-ip>:8090` from any phone or computer at home, a food log you fill
from the page, and a Sync button that rebuilds the page with your latest data (it also rebuilds every hour).
Under the hood: two small Docker services, `services/loop-web` (serves the page) and `services/loop-ingest`
(stores your food log, settings and incoming data).

**Needs a Linux machine that stays on** (a home server or a mini PC) with Docker, systemd and Node.js;
macOS and Windows are not supported as the host.

**No Claude Code? The page sets you up.** On a fresh server the page opens an assistant that asks one
question at a time — you, the sports you do, your goal and a short safety check — and works out your starting
calories and macros for each kind of day. You can adjust them before saving and reopen it from your profile.
Everything on the page works without Claude Code; only the reports, the coaches and the agent need it.

1. **Install:** [`services/loop-web/README.md` → Install (host)](services/loop-web/README.md#install-host) —
   eleven numbered steps (0–10), from the secrets file to opening the page on your phone.
2. Keeping it up to date: [`docs/guides/upgrading.md`](docs/guides/upgrading.md); something not working:
   [`docs/guides/troubleshooting.md`](docs/guides/troubleshooting.md).
3. Reference when you need it: the food log API and every setting
   ([`services/loop-ingest/README.md`](services/loop-ingest/README.md)); how the refresh and the
   security model work ([`docs/lan-services.md`](docs/lan-services.md)).

### Level 3 — live sync and your own knowledge base

| Add | What it gives you | Doc |
| --- | --- | --- |
| iOS Shortcut | Pushes recent Apple Health samples between full exports. [Import the ready-made one](https://www.icloud.com/shortcuts/ceb66eea36fc434a9d2f910421dd18aa) and set your server, token and watch | [`docs/ios-shortcut.md`](docs/ios-shortcut.md) → Install the ready-made Shortcut |
| Strava | Rides / runs, Relative Effort for the load dial, your bikes and shoes | [`services/loop-ingest/README.md` → Getting the Strava credentials](services/loop-ingest/README.md#getting-the-strava-credentials-once-5-minutes) |
| Knowledge base | Transcripts of the experts *you* choose, read by the coach subagents | [`docs/knowledge-base.md`](docs/knowledge-base.md), [`knowledge/README.md`](knowledge/README.md) |

The knowledge base ingest (`scripts/ingest-youtube.mjs`) uses the external
[`yt-dlp`](https://github.com/yt-dlp/yt-dlp) — optional; skip it and the coaches answer from the
evidence base and your data. `knowledge/` is gitignored: it is **for personal use only — respect the
creators' rights** and never publish it.

## Privacy

Raw health data is **medical-grade sensitive** and is excluded from git via
`.gitignore`. It lives only on local disk. The tracked tree is **framework + tooling +
`.example` templates only** — never your data. (The one exception is deliberate: `docs/screenshots/`
holds the author's own page, published by choice.) The guard hook
([`docs/guard-hook.md`](docs/guard-hook.md)) blocks Claude from force-adding ignored files or
un-ignoring them.

Before pushing to any remote, confirm nothing personal is staged or in history:

```sh
git status                 # working tree clean of personal data
git log --all --name-only --format= -- profile/ data/ loop-data/ | sort -u   # should list only .example / tooling / .gitkeep / the synthetic data/demo
```

If you ever committed real data by accident, rewrite history (e.g. `git filter-repo`)
before going public — `.gitignore` does not retroactively remove data from past commits.

## Disclaimer

Recommendations here are general guidance derived from your data and standard
nutrition/training principles. They are **not** a substitute for a licensed
physician or registered dietitian, especially for any clinical condition,
medication, or prescribed diet.

## License

MIT — see [LICENSE](LICENSE). The license covers the framework and tooling. Any data
you add is yours and stays local (gitignored).

Food data from [Open Food Facts](https://world.openfoodfacts.org), © Open Food Facts contributors,
available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
The LAN page's product search (barcode / name) queries it live and credits it under the search and on
an Open Food Facts–filled product form.
