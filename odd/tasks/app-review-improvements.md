# App review improvements

Branch: `feat/app-review-improvements` (from `main` @ 8f01718)
Delivery strategy: `ask-on-risk`. Forecast: well over 400 authored lines across the feature → chain strategy to be asked before the slice boundary.

## Objective

Act on the 2026-10-07 read-only review of the app: close the food-log data gap for the analysis agents, remove dead code, cut maintenance load, and fix the small UX / size issues found.

## Scope (owner-approved, "todo")

1. Food log export for analysis (sync to CSV, nutrition-coach reads it, fix stale CLAUDE.md line).
2. Past-day intake rings read the food log on the LAN page (one intake source); drop unused `INTAKE.target.rest`.
3. Remove the removed day builder's validation / exports (`extraKeys`, `indulge`, `alcoholKeys`, `mealReplaceKeys`, legacy `targetFor`) and strip those fields from the example plan.
4. (merged with 3) One `targetFor` name only.
5. Archive the one-time migration scripts and shrink their CLAUDE.md section.
6. Restructure CLAUDE.md: keep invariants, move area design to `docs/<area>.md`, history to CHANGELOG.
7. Split `web/src/client/food.js` into api / sheet / catalog scripts under `HCFood`.
8. Tests for `training-dash.js`, `training-today.js`, ingest `server.js` routing.
9. Late-night food entry: before ~04:00 default to the previous day's dinner.
10. Minify inline CSS like `slimScript`.
11. Local `.bak` clutter: cleanup / history — needs owner confirmation before deleting anything (personal, untracked).

## Constraints

- Never commit personal data; artifacts in English; no AI attribution in commits.
- Each task: tests first where a runnable deterministic test exists; `npm test` green at task close.

## Checklist

- [x] T1 Food log export (route: delegated writer — preparation + 2+ non-trivial files)
- [ ] T2 Past-day rings from food log
- [ ] T3 Remove day-builder leftovers + single `targetFor`
- [ ] T5 Archive migration scripts
- [ ] T9 Late-night entry default
- [ ] T10 Minify inline CSS
- [ ] T8 Missing tests
- [ ] T7 Split food.js
- [ ] T6 CLAUDE.md restructure
- [ ] T11 Backup clutter (ask owner)

## Progress / evidence

- T1: `data/nutrition/sync-foodlog.js` → gitignored `foodlog-daily.csv` (+ `.meta.json`), 120-day window, wired into sync-all + `sync:foodlog`; nutrition-coach reads it. RED: module missing + SCRIPTS pin; GREEN: 13/13 new, `npm test` 1582/1582 (writer), parent re-ran new test 13/13. Per-entry detail skipped (1 request per date). Engram mirror: pending (ambiguous active sessions).

## Next step

T3 (dead day-builder code).
