# Handoff / session state

> Read this FIRST when starting a session — it is the current state, so you can resume
> without re-explaining. This file holds **what is true NOW + next actions**. Dated history
> lives in `CHANGELOG.md`. Update this file at the end of each working session.

## Context

Owner (Alex, 31M, hybrid/Hyrox athlete) wants data-driven health + nutrition coaching from
Claude. This repo is the persistent context; analysis runs **on demand or on a schedule**
(NOT a 24/7 service — health data is low-frequency). Planned: move to `~/Developer/homelab`
and onto a server.

## Current state

- **Profile + baseline filled** (`profile/about-me.md`, `profile/baseline.md`).
- **Apple Health export in place** (`data/apple-health/export.xml`, ~712 MB — stream/grep by
  record type, never load whole). Dietary logging stopped 2025-11-26 → no recent intake data.
- **Training PDFs** (`data/training/`) and **nutritionist reports** (`data/nutritionist/`)
  available — both were used in the first report; include them when analyzing.
- **First full report:** `analysis/reports/2026-06-25.md`.
- **Nutrition plan** fully modeled and SINGLE-SOURCED in `data/nutrition/plan-data.json`.

## How the nutrition plan pipeline works

- Edit **only** `plan-data.json`: `ingredients` (per-100 g/ml/ud labels; `verified:true` = real
  product photo, `false` = DB estimate) and each item's `recipe` (`[{ing, amt}]`).
  `generate.js` COMPUTES per-serving k/p/c/g from `ingredient*amt`.
- Items with no single label use a `manual` macro block (legumes, soup, pintxo) — kept verbatim.
- `node data/nutrition/generate.js` rewrites 5 regions: `DATA`, `BREAKFAST`, `DAYPLAN`, `EXTRAS`
  in `plan-web.html` + the whole `plan-tables.md` (incl. the Verified product labels table).
- **Never** hand-edit generated files (`plan-web.html`, `plan-tables.md`) or re-type macros in
  `food-log.md`. One source = `plan-data.json`. Generator is idempotent.

## Published artifact — RE-PUBLISH after plan edits

What the user actually views is a claude.ai artifact (frozen snapshot):
`https://claude.ai/code/artifact/84b97ad3-3f68-47c8-b730-d71378c2af92`
(org `ffac77f1-6286-482c-b3b4-d0df2ed0b78d`). Editing local files does NOT update it. A plan
change must propagate through three layers:
1. edit `plan-data.json` (source);
2. `node data/nutrition/generate.js` → regenerates `plan-web.html` + `plan-tables.md`;
3. RE-PUBLISH: Artifact tool with `file_path=data/nutrition/plan-web.html` and `url=<the URL
   above>` to redeploy to the SAME link (favicon 🥗, keep stable), then tell the user to
   hard-reload (Cmd/Ctrl+Shift+R). plan-web.html is artifact-ready (CSP-safe, no external refs).

## Open questions / next actions

- **Nutrition logging method going forward — still TBD.** Owner stopped using tracking apps;
  a protein-focused check is the leaning, method not decided. Intake can't be judged daily until solved.
- **Running volume** — report flagged 9 runs vs 185 HIIT since Jan. Confirm whether it's a
  logging gap (Sat long runs not tagged "Running") or genuinely low volume, before build phase ends.
- **Repo review (2026-06-30)** surfaced more refactors beyond the two already done (labels
  single-source ✅, HANDOFF cleanup ✅). Remaining: wire/remove the 3 unused legume ingredients;
  add tests for `generate.js` (Strict TDD); add a `package.json` with `generate`/`check` scripts;
  add tracked profile/food-log templates; cache the Apple Health export to speed analyses;
  update `CLAUDE.md` workflow to list training/nutritionist PDFs; fix stale day totals in food-log.

## Privacy (hard rule)

Raw health data — `export.xml`, `food-log.md`, `weight-log.md`, `plan-data.json`,
`plan-tables.md`, `plan-web.html`, `profile/`, `analysis/reports/` — is gitignored and stays
local. Never commit medical data, especially before pushing to the server. Only `generate.js`
and the framework docs (`CLAUDE.md`, `README.md`, `methodology.md`, `HANDOFF.md`, `CHANGELOG.md`)
are tracked.

## Key decisions (durable)

- "24/7 Claude" → persistent context + scheduled/on-demand runs.
- Apple Health is iOS/HealthKit-only → analysis via exported XML.
- Weight/body-fat: standardize on the RENPHO scale, morning fasted; trust the trend, not the
  absolute number (bioimpedance ±3–5%). Body-fat 22.8%→14.7% Nov 2025 was a scale switch, not real loss.
