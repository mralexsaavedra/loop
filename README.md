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
     After `npm run generate`, the plan page opens on a 🏠 **Home** tab (a 7-day recovery trend in MAD units and per-modality load from Strava Relative Effort; both need the Apple Health extract / Strava sync and show an empty state without them; `workouts.csv` now has 11 columns, see CLAUDE.md for the rollout) and gains a 💗 **Health** tab with five sections built
     straight from this export — body composition (weight, body fat, lean mass), activity (steps/
     NEAT, exercise minutes, distance, flights), energy expenditure + macro split, running
     performance (recent sessions: pace, power, form), and recovery (resting & walking HR, HRV,
     VO₂max, respiratory rate, wrist temp, plus sleep duration AND consistency). The extractor
     auto-discovers whatever your devices logged; absent metrics simply render an empty state, and
     each one carries its own data-honesty caveat.
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
     personal files needed — useful to sanity-check the pipeline on a bare clone.
   - Training (optional): copy `data/training/training-data.example.json` →
     `training-data.json` and fill in your program by date — Claude can transcribe a coach's
     PDF for you. Run `npm run generate` and the plan page gains a 🏋️ **Today** tab (today's
     programmed session) and a 📈 **Workouts** dashboard, built from the Apple Health workouts
     you exported above (frequency, weekly volume, modality — duration-based, since the watch
     leaves calories blank). Your real program stays gitignored; only the example seed is tracked.
     Skipping this step entirely is fine too — the build still succeeds with no
     `training-data.json`; the **Today** tab just stays in its rest/unprogrammed state.
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
