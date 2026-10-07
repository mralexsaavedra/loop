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
- [x] T2 Past-day rings from food log (route: delegated writer)
- [x] T3 Remove day-builder leftovers + single `targetFor` (route: delegated writer — 2+ non-trivial files)
- [x] T5 Archive migration scripts (route: delegated writer; parent fixed 2 stale comments inline)
- [x] T9 Late-night entry default (route: delegated writer)
- [x] T10 Minify inline CSS (route: delegated writer)
- [x] T8 Missing tests (route: delegated writer)
- [ ] T7 Split food.js
- [ ] T6 CLAUDE.md restructure
- [ ] T11 Backup clutter (ask owner)

## Progress / evidence

- T1: `data/nutrition/sync-foodlog.js` → gitignored `foodlog-daily.csv` (+ `.meta.json`), 120-day window, wired into sync-all + `sync:foodlog`; nutrition-coach reads it. RED: module missing + SCRIPTS pin; GREEN: 13/13 new, `npm test` 1582/1582 (writer), parent re-ran new test 13/13. Per-entry detail skipped (1 request per date). Engram mirror: pending (ambiguous active sessions). Commit d5c781a. Review: tier high (process boundary), consent granted, 4 lenses approved, acknowledged (lineage review-1a6eee42b5502cc2). Reviewed boundary → d5c781a.

- T3: legacy `targetFor`, `extraKeys`/`extraNames`/`indulge`/`alcoholKeys`/`mealReplaceKeys` removed from macros.mjs + generate.js; legacy plan keys now a `npm run check` WARNING (`LEGACY_PLAN_KEYS`), never an error; example plan stripped (example build byte-identical). RED: legacy-fields test failed with subset errors; GREEN after fix. `npm test` 1578/1578 (writer); parent re-ran `npm run check` OK with 5 warnings on the personal plan. Note: migrate-plan-data.mjs still writes those keys → T5. Commit c8fbafb. Review: tier high (process boundary in generate.js), consent granted, 4 lenses approved, acknowledged (lineage review-c2fb2e8778a25d24). Reviewed boundary → c8fbafb.
- Delivery: running count after T3 ≈ 750 authored lines (> 400) → chain strategy asked to owner → `stacked-to-main` (2026-10-07).

- T5: deleted migrate-plan-data / migrate-plan-v2 (+ tests; nothing imported them; targets.mjs falls back to DEFAULT_BY_GOAL / maintain, verified by writer). CLAUDE.md + README shortened. No RED (deletion). Parent ran `npm test`: 1545/1545. Commit c41ccad. Review: tier medium (slice budget), consent granted, 1 lens (reliability) approved, acknowledged. Reviewed boundary → c41ccad.

- T9: `LATE_NIGHT_HOUR = 4` in slots.mjs baked as `FOOD_CONST.lateNightHour`; before 04:00 Registrar opens on yesterday (auto view, expires at 04:00 on visibility), guessMeal → dinner; today-only hooks untouched. RED 3 fails → GREEN 75/75; `npm test` 1550/1550 (writer); parent re-ran food.test 75/75.

- T10: `slimStyle` (esbuild css, whitespace only) applied by an `astro:build:done` integration; CSS 105.7k → 75.9k chars; personal page 528/149 KB → 497/140 KB (raw/gzip); deterministic (cmp identical). RED 3 fails → GREEN 30/30; `npm test` 1553/1553 (writer); parent re-ran css-slim test. Commits cd7cfe7 (T9), 03b6d9f (T10): each under_budget; reviewed together as slice 2 tail (c41ccad..03b6d9f): medium, consent granted, reliability lens approved, acknowledged. Reviewed boundary → 03b6d9f.

- T2: `HCFood.recentDay(days)` from `/food/log/summary` (lazy, refreshed on add/delete); LAN rings = food log only (today, else newest logged day in 3 days, else none); static page unchanged; `INTAKE.target.rest` dropped. RED 8 → GREEN 105/105; `npm test` 1561/1561; example build deterministic. Follow-up (not done): brief Apple Health flash on LAN boot before the food API answers (pre-existing for today too); `I18N_INTAKE.targetLbl.rest` possibly unused. Commit deae1c9; reviewed as slice 3 (medium, consent granted, reliability approved, acknowledged). Boundary → deae1c9.

- T8: training-dash (6) + training-today (10) client tests; ingest `server.js` refactored to export `createHandler(deps)` + `main()` only as entry point (Docker CMD unchanged), `test/server.test.js` (8) + `test/limits.test.js` (3). No RED (existing code), no bugs found. Root `npm test` 1577/1577; parent re-ran ingest `node --test` 205/205. db.js untested (needs pg).

## Slices (stacked to main)

- Slice 1 `feat/app-review-improvements`: d5c781a (T1), c8fbafb (T3).
- Slice 2 `feat/app-review-cleanup` (based on slice 1): T5, T9, T10.
- Slice 3 `feat/app-review-intake-source`: T2.
- Slice 4 `feat/app-review-tests`: T8.
- Later slices: T7; T6 — one PR each.


## Next step

T7 (split food.js).
