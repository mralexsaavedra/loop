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
- **Node.js** — only for the nutrition tooling (`npm run generate`, `npm run check`,
  `npm test`). Zero runtime dependencies.
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
   - Nutrition: copy `data/nutrition/food-log.example.md` → `food-log.md` and log meals there.
   - Weight: tracked automatically from Apple Health, or copy
     `data/weight/weight-log.example.md` → `weight-log.md` and log there.
   - Plan UI (optional): to get the interactive plan page, copy
     `data/nutrition/plan-web.template.html` → `plan-web.html` and
     `data/nutrition/plan-data.example.json` → `plan-data.json`. Edit your foods,
     servings and targets in the JSON, then run `npm run generate` — it computes the
     macros and rewrites `plan-web.html` (and `plan-tables.md`) from that single source.
     Both copies are gitignored and stay local; the `.template` / `.example` seeds are tracked.
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
