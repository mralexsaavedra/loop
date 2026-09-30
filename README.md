# health-coach

A personal, data-driven health and nutrition coaching workspace, designed to be
read and operated by Claude Code.

The goal: keep a persistent record of training, body metrics, and nutrition so an
AI agent can analyze real trends over time and give grounded recommendations —
instead of generic advice with no data behind it.

## What this is (and is not)

- **Is:** a context + data repository with a documented analysis methodology.
- **Is not:** a 24/7 running service. Health data is low-frequency. This runs
  **on demand** (when you drop new data) or **on a schedule** (e.g. weekly).
- **Is not:** medical advice. See the disclaimer below.

## Requirements

- **[Claude Code](https://claude.com/claude-code)** — the repo is designed to be read and
  operated by it. `CLAUDE.md` is the operating manual the agent reads on each session.
- **Node.js** (`>=22.12`) — for the plan tooling (`npm run generate`, `npm run check`,
  `npm test`), which builds the nutrition plan, the training tabs, and the health dashboard
  into a single self-contained page via [Astro](https://astro.build) (`npm ci` first to
  install it).
- **A persistent-memory tool (optional).** The workflow uses [Engram](https://github.com/)
  for cross-session state if present, but it is **not required** — without it, durable
  state lives entirely in the tracked files and `CHANGELOG.md`.

## How to use it

1. **Let Claude onboard you.** On a fresh clone, just open Claude Code and say hi. It
   detects that no profile exists yet and **interviews you conversationally** — who you are,
   your goal, training, health context, nutrition habits — then writes `profile/about-me.md`
   and `profile/baseline.md` for you (both gitignored, local-only). You don't fill the
   templates by hand; the `.example` files are just the structure Claude follows. (Prefer to
   fill them yourself? Copy `*.example.md` → `*.md` and edit — Claude will use whatever exists.)
2. **Drop your data.**
   - Apple Health: iPhone → Health app → your photo → *Export All Health Data*.
     Unzip and place `export.xml` in `data/apple-health/`. Claude caches it into small
     per-metric CSVs via `node data/apple-health/extract.js` (re-run when you drop a new export).
     After `npm run generate`, the plan page has four tabs. 🏠 **Home** is today at a glance (sleep,
     recovery-trend and load dials, a health monitor, today's timeline of sleep + workouts; recovery
     is in MAD units and load uses Strava Relative Effort, and both show an empty state without the
     Apple Health extract / Strava sync; `workouts.csv` has 12 columns, see CLAUDE.md for the
     rollout). 🏃 **Training** holds the per-modality load detail, a 30-day activity calendar,
     cumulative training time, recent runs and rides, load vs recovery and the workouts dashboard
     (a workout logged by both the Watch and Strava on one day counts once, as the Strava copy, and
     accidental 2-minute Watch stubs are ignored).
     💗 **Health** holds recovery (resting & walking HR, HRV, VO₂max, respiratory rate, wrist temp),
     sleep (duration AND consistency), body composition (weight, body fat, lean mass, waist),
     activity (steps/NEAT, exercise minutes, distance, flights) and energy expenditure + macro split. The extractor
     auto-discovers whatever your devices logged; absent metrics simply render an empty state, and
     each one carries its own data-honesty caveat. **Tap any card** (a dial, a monitor card, a
     timeline row, a trend card, a load card, the calendar, a run or ride) to open its detail view:
     the last 30 days / 90 days / year as a chart with your personal range, a month calendar
     coloured day by day, and the tapped day in full (a night's sleep and signals, a day's sessions,
     a day vs your usual). Browser Back closes it, and `#detail/<metric>/<date>` links straight to it.
   - Apple Health, between exports (optional): an iOS Shortcut can push recent samples to the
     self-hosted `services/health-ingest` service, and `npm run sync` merges them in. Step-by-step
     build, every payload key and the known gotchas: [`docs/ios-shortcut.md`](docs/ios-shortcut.md).
   - Self-hosted page (optional): `services/plan-web` serves the page on your LAN, rebuilds it
     hourly and on demand (a Sync button in the header, or the Shortcut), and shows how fresh the
     Shortcut, Strava and page data are. Setup and the security reasoning:
     [`services/plan-web/README.md`](services/plan-web/README.md).
   - Nutrition: copy `data/nutrition/food-log.example.md` → `food-log.md` and log meals there.
   - Weight: tracked automatically from Apple Health, or copy
     `data/weight/weight-log.example.md` → `weight-log.md` and log there.
   - Plan UI (optional): to get the interactive plan page, copy
     `data/nutrition/plan-data.example.json` → `plan-data.json`. The food database ships
     ready: `data/nutrition/ingredients.json` (TRACKED, public — per-100g/ml/ud macros and
     verified product labels) is reusable and already in the clone. Your personal plan —
     recipes, day structure, protein targets, and page copy — lives in `plan-data.json`
     (gitignored, local-only). Edit your servings and day plan there (referencing
     ingredient keys from `ingredients.json`), then run `npm ci && npm run generate` — it
     MERGES `ingredients.json` + `plan-data.json`, computes the macros, and builds the
     single-file page at `web/dist/personal/index.html` (plus `plan-tables.md`) from that
     single source, via the Astro project in `web/`. `plan-data.json` and `web/dist/` are
     gitignored and stay local; `ingredients.json` and the `.example` seed are tracked.
     `npm run build:example` builds the same page from the tracked seed alone, with no
     personal files needed — useful to sanity-check the pipeline on a bare clone. It reads
     the synthetic demo extract in `data/demo/` (clearly fake, see its README), so every dial
     and section shows what your own data will look like.
   - Profile (optional): copy `profile/profile.example.json` → `profile/profile.json` (birthdate,
     height, devices; gitignored) and run `npm run generate`. The round **avatar** at the top right
     opens your profile: photo or initials, name, age (worked out on your device), city, height,
     latest weigh-in, and — with the ingest service's Strava connection and `npm run sync` — your
     bikes and shoes with their kilometres (a gentle replace hint past ~700 km) and the devices
     seen on your activities. Strava shares gear only with the `profile:read_all` permission; the
     re-authorization steps are in [`services/health-ingest/README.md`](services/health-ingest/README.md).
     `#profile` links straight to it.
   - Training (optional): copy `data/training/training-data.example.json` →
     `training-data.json` and fill in your program by date — Claude can transcribe a coach's
     PDF for you. Run `npm run generate` and the Home tab gains today's
     programmed session; the Training tab's 📈 **Workouts** dashboard is built from the Apple Health workouts
     you exported above (frequency, weekly volume, modality — duration-based, since the watch
     leaves calories blank). Your real program stays gitignored; only the example seed is tracked.
     Skipping this step entirely is fine too — the build still succeeds with no
     `training-data.json`; today's session just stays in its rest/unprogrammed state.
3. **Ask Claude to run an analysis.** It reads `CLAUDE.md`, follows
   `analysis/methodology.md`, and writes a report to `analysis/reports/`.

## Privacy

Raw health data is **medical-grade sensitive** and is excluded from git via
`.gitignore`. It lives only on local disk. The tracked tree is **framework + tooling +
`.example` templates only** — never your data.

Before pushing to any remote, confirm nothing personal is staged or in history:

```sh
git status                 # working tree clean of personal data
git log --all --oneline -- profile/ data/   # should show only .example / tooling / .gitkeep
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
