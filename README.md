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

## How to use it

1. **Fill your profile.** Copy the templates `profile/about-me.example.md` →
   `profile/about-me.md` and `profile/baseline.example.md` → `profile/baseline.md`, then
   fill them in. The `.md` (non-example) names are gitignored — they stay local. Without
   this, any analysis is guessing.
2. **Drop your data.**
   - Apple Health: iPhone → Health app → your photo → *Export All Health Data*.
     Unzip and place `export.xml` in `data/apple-health/`. Claude caches it into small
     per-metric CSVs via `node data/apple-health/extract.js` (re-run when you drop a new export).
   - Nutrition: copy `data/nutrition/food-log.example.md` → `food-log.md` and log meals there.
   - Weight: tracked automatically from Apple Health, or copy
     `data/weight/weight-log.example.md` → `weight-log.md` and log there.
3. **Ask Claude to run an analysis.** It reads `CLAUDE.md` (which starts by recalling
   prior context from Engram), follows `analysis/methodology.md`, and writes a report to
   `analysis/reports/`.

## Privacy

Raw health data is **medical-grade sensitive** and is excluded from git via
`.gitignore`. It lives only on local disk. Before pushing this repo to any remote
or server, confirm no personal data is staged: `git status`.

## Disclaimer

Recommendations here are general guidance derived from your data and standard
nutrition/training principles. They are **not** a substitute for a licensed
physician or registered dietitian, especially for any clinical condition,
medication, or prescribed diet.
