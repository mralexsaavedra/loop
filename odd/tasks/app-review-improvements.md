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
- [x] T7 Split food.js (route: delegated writer; parent swept stale comments inline)
- [x] T6 CLAUDE.md restructure (route: delegated writer; parent repointed 4 stale refs)
- [x] T11 Backup clutter (owner: move to backups/ and keep the newest; route: inline)

## Progress / evidence

- T1: `data/nutrition/sync-foodlog.js` → gitignored `foodlog-daily.csv` (+ `.meta.json`), 120-day window, wired into sync-all + `sync:foodlog`; nutrition-coach reads it. RED: module missing + SCRIPTS pin; GREEN: 13/13 new, `npm test` 1582/1582 (writer), parent re-ran new test 13/13. Per-entry detail skipped (1 request per date). Engram mirror: pending (ambiguous active sessions). Commit d5c781a. Review: tier high (process boundary), consent granted, 4 lenses approved, acknowledged (lineage review-1a6eee42b5502cc2). Reviewed boundary → d5c781a.

- T3: legacy `targetFor`, `extraKeys`/`extraNames`/`indulge`/`alcoholKeys`/`mealReplaceKeys` removed from macros.mjs + generate.js; legacy plan keys now a `npm run check` WARNING (`LEGACY_PLAN_KEYS`), never an error; example plan stripped (example build byte-identical). RED: legacy-fields test failed with subset errors; GREEN after fix. `npm test` 1578/1578 (writer); parent re-ran `npm run check` OK with 5 warnings on the personal plan. Note: migrate-plan-data.mjs still writes those keys → T5. Commit c8fbafb. Review: tier high (process boundary in generate.js), consent granted, 4 lenses approved, acknowledged (lineage review-c2fb2e8778a25d24). Reviewed boundary → c8fbafb.
- Delivery: running count after T3 ≈ 750 authored lines (> 400) → chain strategy asked to owner → `stacked-to-main` (2026-10-07).

- T5: deleted migrate-plan-data / migrate-plan-v2 (+ tests; nothing imported them; targets.mjs falls back to DEFAULT_BY_GOAL / maintain, verified by writer). CLAUDE.md + README shortened. No RED (deletion). Parent ran `npm test`: 1545/1545. Commit c41ccad. Review: tier medium (slice budget), consent granted, 1 lens (reliability) approved, acknowledged. Reviewed boundary → c41ccad.

- T9: `LATE_NIGHT_HOUR = 4` in slots.mjs baked as `FOOD_CONST.lateNightHour`; before 04:00 Registrar opens on yesterday (auto view, expires at 04:00 on visibility), guessMeal → dinner; today-only hooks untouched. RED 3 fails → GREEN 75/75; `npm test` 1550/1550 (writer); parent re-ran food.test 75/75.

- T10: `slimStyle` (esbuild css, whitespace only) applied by an `astro:build:done` integration; CSS 105.7k → 75.9k chars; personal page 528/149 KB → 497/140 KB (raw/gzip); deterministic (cmp identical). RED 3 fails → GREEN 30/30; `npm test` 1553/1553 (writer); parent re-ran css-slim test. Commits cd7cfe7 (T9), 03b6d9f (T10): each under_budget; reviewed together as slice 2 tail (c41ccad..03b6d9f): medium, consent granted, reliability lens approved, acknowledged. Reviewed boundary → 03b6d9f.

- T2: `HCFood.recentDay(days)` from `/food/log/summary` (lazy, refreshed on add/delete); LAN rings = food log only (today, else newest logged day in 3 days, else none); static page unchanged; `INTAKE.target.rest` dropped. RED 8 → GREEN 105/105; `npm test` 1561/1561; example build deterministic. Follow-up (not done): brief Apple Health flash on LAN boot before the food API answers (pre-existing for today too); `I18N_INTAKE.targetLbl.rest` possibly unused. Commit deae1c9; reviewed as slice 3 (medium, consent granted, reliability approved, acknowledged). Boundary → deae1c9.

- T8: training-dash (6) + training-today (10) client tests; ingest `server.js` refactored to export `createHandler(deps)` + `main()` only as entry point (Docker CMD unchanged), `test/server.test.js` (8) + `test/limits.test.js` (3). No RED (existing code), no bugs found. Root `npm test` 1577/1577; parent re-ran ingest `node --test` 205/205. db.js untested (needs pg). Commit bf4aa50; slice 4 review: medium (slice budget), consent granted, reliability approved, acknowledged. Boundary → bf4aa50. Rollout note: server.js changed → picked up on the next ingest image rebuild.

- T7: food.js (1727) → food-core (536) / food-sheet (328) / food-catalog (544) / food-log (439), shared via `window.HCFoodInternal`; public `HCFood` surface unchanged; tests load `FOOD_SOURCE` (client-util.mjs). Pure move: `npm test` 1577 before = 1577 after (parent re-ran after comment sweep). Example page +4.8 KB raw / +1 KB gzip (namespace export, slimScript does not rename). Deterministic. Commit 832e4ef. Review: medium (slice budget), consent granted, START stopped `lens_context_budget_exceeded` (3715 lines; a pure move cannot be split meaningfully) → UNREVIEWED, proof = identical green suite. Boundary stays bf4aa50 for review purposes.

- T6: CLAUDE.md 1723 → 210 lines (rules, commands, publish, architecture map, subagent routing); area design verbatim in docs/{data-pipeline,plan-page,detail-views,profile,nutrition,nutrition-food-log,training,health-tab,home-tab,lan-services,knowledge-base}.md; 15 history sentences → CHANGELOG 2026-10-07. Lost-lines check: 25/1648 not verbatim, all deliberate (1 real omission caught and restored). No RED (doc move). `npm test` 1577/1577 (parent re-ran). Commit 31db448. Review: high (process boundary: SYNC_NOTE string), consent granted, START stopped `lens_context_budget_exceeded` (3386 lines, a verbatim move) → UNREVIEWED.

- T11: `/backups/` gitignored (verified with check-ignore); newest backup per file moved to backups/<same path> (6 kept), 18 older ones deleted; services/health-ingest/.env.bak kept in place; CLAUDE.md repo rule added.

## Slices (stacked to main)

- Slice 1 `feat/app-review-improvements`: d5c781a (T1), c8fbafb (T3).
- Slice 2 `feat/app-review-cleanup` (based on slice 1): T5, T9, T10.
- Slice 3 `feat/app-review-intake-source`: T2.
- Slice 4 `feat/app-review-tests`: T8.
- Slice 5 `feat/app-review-food-split`: T7.
- Slice 6 `feat/app-review-claude-md`: T6.


## Follow-ups (2026-10-07, owner: "haz lo que queda pendiente")

- `npm run sync`: OK; foodlog-daily.csv written (5 logged days 2026-06-10..2026-10-07).
- Ingest image rebuild: deferred to merge (server.js has no behaviour change; sync-foodlog uses the already-deployed /food/log/summary).
- Legacy keys in personal plan-data.json: removal DENIED by the permission classifier → left to the owner.
- Engram mirror: saved via `engram save --project health-coach` (#5797); MCP save fails with ambiguous active sessions.
- Ring boot flash: fixed on `fix/intake-boot-flash` (delegated writer): `HCFood.pending()` + `INTAKE.bootGraceMs` (2500, from lib); rings hidden while the food API boot is in flight, Apple Health after the grace or on failure, food log on answer; LAN with today's log not loaded → no rings. RED 3+3 → GREEN; `npm test` 1585/1585; example build deterministic. Known residue (not fixed): Resumen de hoy's kcal dial / bars (nutri-day.js renders before the food scripts load) can still briefly show an Apple Health TODAY intake — only reachable when Apple Health has food logged today (last such day 2026-09-28).

## Next step

All tasks done. Owner decides push / PRs (6 stacked slices).
