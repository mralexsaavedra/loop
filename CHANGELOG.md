# Changelog

Dated history of structural work on this repo. **Current state lives in Engram**
(`mem_context`, synced across the owner's machines); durable operating facts live in
`CLAUDE.md`. This file is the append-only narrative of what changed and why.

## 2026-07-01 — Whoop redesign, design tokens & per-run distance

Full visual redesign of the published artifact to a Whoop-style dark dashboard, a tokenized
design system, and a new per-run distance metric.

- **Whoop dark theme** across all tabs: dark-always `:root` (dropped the light media query),
  recovery-green accent `#15E26A` + strain-blue for volume/load, the lean/mod/fat zone colors
  reused, hero numbers in a monospace stack, accent glows + a radial-gradient atmosphere. Pure
  `<style>` rewrite — every class name kept, no GEN region touched.
- **Navigation restructured**: the top pill tabs became a fixed **bottom tab-bar on mobile**
  (icon over label) and a fixed full-height **left sidebar on desktop** (≥900px), with the
  content full-bleed (no max-width cap). The Entreno/Descanso toggle moved out of the nav into
  the content flow. Each tab split into `.tico`/`.tlbl` spans; `id`/`onclick`/`aria` preserved
  so `setTab`/`setDay` are untouched.
- **Design system fully tokenized**: brand colors as `--accent-rgb`/`--strain-rgb` triples so
  `rgba()` glows track a single source; consolidated **type (11 steps), radius (6), space (12)**
  scales replacing 22 ad-hoc font sizes / 11 radii / ~94 spacing literals. Layout-shell
  dimensions (sidebar width, `calc/clamp/env`) deliberately left literal.
- **Per-run distance**: `extract.js` now reads each workout's `DistanceWalkingRunning` child
  stat → `workouts.csv` gains a `distance_km` column (appended, so `generate-training.js` column
  indices are unaffected). `generate-health.js` joins running-workout km by date into the
  **Salud → Carrera** table (new Dist column, which also now spans the full desktop width).
  Distance shows `—` on days with no matching running workout — honest, not guessed.
- Desktop grids fill the width (auto-fit) on Salud tiles, Mi día meals and the Registro form
  (centered). Verified: `npm run check` OK, `npm test` 61/61 (+1 for the distance join),
  GEN 14/14. Both `plan-web.html` (es) and `plan-web.template.html` (en) updated; artifact
  republished.

## 2026-06-30 — Per-workout HR → intensity + load-vs-recovery

Made the training data carry intensity, not just duration, and used it for the one analytical
view Strava can't build for a strength/HIIT athlete.

- `extract.js` now keeps each `<Workout>` OPEN across lines (`handleWorkoutOpen/Stat/Close`) to
  read its child `<WorkoutStatistics>`: per-workout HR (`hr_avg/hr_min/hr_max`, bpm) and the
  energy the opening tag drops on newer exports. `workouts.csv` gains 3 HR columns; 305/387
  sessions carry HR (Apple-Watch-era).
- **Entrenos** gains an *Intensity (HR)* section: duration-weighted mean HR + peak per modality
  (`aggregateDashboard` → `modality[].avgHr/peakHr` + `intensity{}`). HR honestly under-reads
  strength (avg 89 vs run 153), said on-screen — never folded into a single "load" number.
- **Salud** gains a 6th section, *Load vs recovery*: weekly cardiovascular load index
  (`Σ(min × avgHR) / 100`) vs weekly HRV + resting HR, with a high- vs low-load split
  (`aggLoadRecovery`). `generate-health.js` reads `workouts.csv` directly rather than importing
  `generate-training.js` (which throws without `training-data.json` — would break fresh clones).
- Honesty baked into captions: cardiovascular (not total) load, few weeks, association not
  causation. Tests: +2 training, +3 health (59 green). Both `plan-web.html` (es) and
  `plan-web.template.html` (en) updated.

## 2026-06-30 — Plan artifact split into 3 tabs

The artifact had grown into one long scroll mixing two different tasks: *consulting* the
plan (what to eat, equivalence tables) vs *logging* what was eaten. Reorganized into tabs.

- Three `<div class="tab-panel" data-tab="…">`: **🍽️ Mi día** (day-plan cards), **📋 Registro**
  (the builder + Copiar para Claude), **📊 Tablas** (equivalences + suplementación + cómo usarlo).
- Sticky tab bar (`.toggle.tabs`) above the Entreno/Descanso day toggle; the day toggle shows
  on Mi día + Registro and hides on Tablas (irrelevant there).
- `setTab(name, scrollTop)` switches panels + aria state; `jump(id)` now finds the target's
  panel via `closest('.tab-panel')`, switches to it, then opens + scrolls — so the meal links
  on Mi día (Proteína, carbo…) navigate correctly to their accordion on Tablas.
- Tab wrappers live OUTSIDE the GEN regions (markers intact). Verified byte-identical after
  `npm run generate`, `<div>` balanced 194/194, `npm test` 8/8. Republished to the artifact URL.

## 2026-06-30 — Food check-in: "Copiar para Claude" on the day-builder

Closed the biggest data gap (food logging stopped 2025-11-26) by turning the existing
day-builder in `plan-web.html` into a food log instead of adding a separate section.

- Renamed "Arma tu día" → **"Registro de comida"**; intro reframed to "mark what you ate
  → copy → paste into chat."
- Added a free-text **"Fuera de plan / notas"** field (`#bld-notes`) for off-plan/social
  meals the builder's plan-only dropdowns can't represent (the real blind spot: pintxos,
  restaurants, weekend).
- Added **"📋 Copiar para Claude"** (`#bld-copy`): exports a plain-text block — day type,
  each selected meal, nonzero extras, the notes, and the COMPUTED totals vs target — to the
  clipboard (`navigator.clipboard` + `execCommand` fallback + a visible readonly textarea).
- Live calculator, **no persistence** (chosen over a localStorage accumulator): copy the
  current day in the moment. Photos still go straight to chat.
- All additions live OUTSIDE the GEN regions (logic inside the builder IIFE: `LAST` totals
  captured in `recalc()`, `XN` extras-name map, `buildDayText()`/`copyDay()`). Verified
  byte-identical after `npm run generate`; `npm test` 8/8. Republished to the artifact URL.
- Why the builder, not a new section: it already computes exact macros from real labels —
  reusing it avoids duplicate logging surfaces and gives precise data instead of estimates.

## 2026-06-30 — Closed the last duplicated source of truth (verified labels)

Repo deep-review found the verified per-100 g product labels were maintained in TWO
places: `food-log.md` ("source of truth for packaged foods") AND `plan-data.json`
(`ingredients`, verified:true). Values matched but were two hand-copies that could drift.

- Added `name` + `note` to the 30 verified `ingredients` in `plan-data.json` (transcribed
  faithfully from the food-log table; macros untouched — asserted by the migration script).
- `generate.js` now emits a **"Verified product labels"** table into `plan-tables.md` from
  those entries → the labels render from the single source.
- `food-log.md` table replaced with a pointer to `plan-tables.md`. Only the non-plan
  reference rows (2 soups, electrolytes, creatine — no recipe macros) stay in food-log.
- Single source of truth now holds for labels too.

## 2026-06-30 — Single source of truth CLOSED 100%

Last hand-written data in `plan-web.html` is now generated:
- **Day-summary cards** (both `.day-panel`) ← `dayPlan`, between `<!-- GEN:DAYPLAN -->`.
  Each meal lists `parts`: raw `{ing,amt}` OR a reference `{use, tier?, match}` to a table
  item (matched by `n`/`l`) → day cards are LINKED to the tables. `resolvePart()` + `dayPanel()`.
- **Extras stepper labels** ← `extrasDisplay`, between `<!-- GEN:EXTRAS -->`. kcal pulled
  from resolved EXTRAS; `bump('key')`/`id="x-key"` preserved. `extraRow()`.
- Day totals now COMPUTED (train ~2,440 / 175P / 312C / 56G; rest ~2,031 / 165P / 225C /
  54G) — honest sums of referenced parts, not typed estimates (old hand figures were
  2,570/2,150). Rest-day protein ~165 g is a touch under the ~170 g target — user can pick
  higher-protein options to close it.
- Five GEN regions total: DATA, BREAKFAST, DAYPLAN, EXTRAS (+ plan-tables.md).

## 2026-06-30 — Breakfast detail tables generated

The "☕ Desayunos" A/B/C component tables in `plan-web.html` were still hand-written HTML (a
surviving second source that drifted). Now generated between `<!-- GEN:BREAKFAST -->` markers.
Presentation in `plan-data.json`: each `desayuno` item carries `tier` (🟢/🟡/🔴) + `cap`;
recipe lines may carry display-only `label`, `q` (quantity override), `group`+`glabel` (merge
lines into one row), and `link` (a `jump()` target → row renders as an interactive button).
`resolve()` strips `tier`/`cap` so the JS DATA items stay `{l,k,p,c,g}`.

## 2026-06-30 — Plan artifact is a published snapshot

What the user views is a claude.ai artifact (frozen snapshot). Editing local files does NOT
update it — a plan change must propagate through three layers (edit JSON → run generate.js →
re-publish the artifact to the same URL). See CLAUDE.md "Nutrition plan — data pipeline &
published artifact" for the live URL and steps.

## 2026-06-27 — Deeper single source: ingredient layer

`plan-data.json` gained an `ingredients` layer (per-100 g/ml/ud base foods, each flagged
`verified:true` for a real product label vs `false` for a DB estimate). Each plan item carries
a `recipe` (`[{ing, amt}]`) instead of inline macros; `generate.js` COMPUTES per-serving
k/p/c/g from `ingredient*amt`. Change a label or a serving gram in ONE place → it propagates.

- Items with no single label stay as `manual` macro blocks (the two legume "plato hondo"
  rows + the soup row + `pintxo`).
- Rounding: kcal → integer, macros → 1 decimal (.0 dropped). Generator is idempotent.
- Reconciliation — building the ingredient layer exposed real source inconsistencies; 4
  material divergences resolved with the owner:
  - **anclaje Atún:** serving 130 g → **100 g** to hold the ~25 g anchor (130 g of 25 g/100 g
    tuna was really 32.5 g P — the old 25 was wrong).
  - **protein Claras:** **400 ml → 370 ml** to hold ~40 g (egg white is ~10.8 g P/100 ml).
  - breakfast B (37 g P) and Huevos enteros (468 kcal): accepted as accurate.
  - ~66 sub-gram precision drifts accepted (computed > old hand-rounded — the point of the refactor).

## 2026-06-26 — Nutrition plan single source of truth established

Per-serving food tables had been duplicated across `food-log.md` and `plan-web.html`. Created
ONE source (`plan-data.json`) + a generator (`generate.js`) that regenerates the `DATA`/`EXTRAS`
JS block in `plan-web.html` and `plan-tables.md`. `food-log.md` kept as the hand-written
notebook (daily log, rationale, day-plan structure, breakfast detail, non-duplicate tables);
its duplicated per-serving tables were replaced with pointers to `plan-tables.md`.

## (initial) — Scaffolding

Repo created and git-initialized. Structure, `CLAUDE.md`, `analysis/methodology.md` in place.
Reframed "24/7 Claude" → persistent context + scheduled/on-demand runs. Apple Health is
iOS/HealthKit-only → analysis via exported XML. Privacy: raw health data gitignored, stays local.
