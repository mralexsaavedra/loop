# Handoff / session state

> Read this at the start of a new session to resume without re-explaining.
> Update it at the end of each working session.

## Context

Owner does sport and wants data-driven health + nutrition coaching from Claude.
This repo holds the persistent context; analysis runs on demand or on a schedule
(NOT a 24/7 service — health data is low-frequency). Will later move to
`~/Developer/homelab` and onto a server.

## Status: scaffolding done, waiting on data

Repo created and git-initialized. Structure, `CLAUDE.md`, and
`analysis/methodology.md` are in place.

## Blocked on owner — needed before first analysis

1. Fill `profile/about-me.md` (age, height, weight, goal, injuries).
2. Export Apple Health → unzip → put `export.xml` in `data/apple-health/`.
3. Decide nutrition logging method — **OPEN QUESTION**: manual markdown log
   (`data/nutrition/food-log.md`) vs meal photos for Claude to estimate.
   Owner stopped using food-tracking apps, so there is currently NO food data —
   intake cannot be judged until this is solved.

## Key decisions made

- "24/7 Claude" reframed → persistent context + scheduled/on-demand runs.
- Apple Health is iOS/HealthKit-only; no web access → analysis via exported XML.
- Privacy: raw health data (export.xml, food-log, weight-log, profile) is
  gitignored, stays local. Never commit medical data, especially before pushing
  to the server.

## Next action when data arrives

Run the analysis workflow in `CLAUDE.md`: read profile + methodology, parse the
export, write the first report to `analysis/reports/`.

## Nutrition plan data — single source of truth (done 2026-06-26)

The plan's per-serving food tables had been duplicated across `food-log.md` and
`plan-web.html`. Now there is ONE source and a generator:

- `data/nutrition/plan-data.json` — **edit here** (gitignored: personal data).
- `data/nutrition/generate.js` — `node data/nutrition/generate.js` regenerates:
  - the `DATA`/`EXTRAS` JS block in `plan-web.html` (between `/* GEN:DATA START/END */`),
  - `data/nutrition/plan-tables.md` (generated reference, gitignored).
- Never hand-edit the generated files. `generate.js` is the only trackable file here
  (plain code, no personal data); the rest are gitignored.
- `food-log.md` stays the hand-written notebook: daily log, rationale notes, verified
  per-100g product labels, day-plan structure, breakfast detail, and the richer tables
  that are NOT duplicates (legumes detail, soup detail, post-workout). Its duplicated
  per-serving tables were replaced with pointers to `plan-tables.md`.

### Resuming in a new session
The files persist on disk (gitignore does not delete them) — the workflow just works.
To pick the work back up, say e.g. "retomemos el generador del plan nutricional" and
Engram recall (topic `nutrition/plan-web-ssot`) restores context.

### Deeper single source — DONE (2026-06-27)
`plan-data.json` now has an `ingredients` layer (78 base foods, per-100g/ml/ud, each
flagged `verified:true` for a real product label vs `verified:false` for a DB estimate;
29 verified / 49 DB). Each plan item carries a `recipe` (`[{ing, amt}]`) instead of
inline macros; `generate.js` COMPUTES per-serving k/p/c/g from `ingredient*amt`. Change
a label or a serving gram in ONE place → it propagates to plan-web.html + plan-tables.md.

- Items with no single label stay as `manual` macro blocks (kept verbatim): the two
  legume "plato hondo" rows + the soup row (genuine ranges) and `pintxo` (generic bar
  estimate). Everything else is computed.
- Rounding: kcal → integer, macros → 1 decimal (.0 dropped). Generator is idempotent.
- Reconciliation: building the ingredient layer exposed real source inconsistencies.
  4 material divergences resolved with the owner:
  - anclaje Atún: serving recomputed 130 g → **100 g** to hold the ~25 g anchor
    (130 g of 25 g/100 g tuna was really 32.5 g P — the old 25 was wrong).
  - protein Claras: **400 ml → 370 ml** to hold ~40 g (egg white is ~10.8 g P/100 ml,
    not the 10 the old serving assumed).
  - breakfast B (37 g P) and Huevos enteros (468 kcal): accepted as the accurate values.
  - ~66 sub-gram precision drifts accepted (computed values are more accurate than the
    old hand-rounded ones — the whole point of the refactor).
- To change a number now: edit `ingredients` (a label) or an item's `recipe.amt` (a
  serving) in `plan-data.json`, then `node data/nutrition/generate.js`. Never hand-edit
  the generated macros in plan-web.html / plan-tables.md.
