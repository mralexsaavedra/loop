# Changelog

Dated history of structural work on this repo. **Current state lives in Engram**
(`mem_context`, synced across the owner's machines); durable operating facts live in
`CLAUDE.md`. This file is the append-only narrative of what changed and why.

## 2026-10-01 — Plan de hoy adds an automatic snack when the meals fall short

With realistic portion caps the owner's five meals often end below today's target (maintain gym −209,
bike −229, bikeLong −299 meal kcal; bulk −366…−599) and the page only said "add a snack". Now
`planFor` adds one: after the capped carb solve, a shortfall beyond the 75 kcal tolerance gets a
"Tentempié" / "Snack" add-on sized to it (`lib/nutrition/snack.mjs`). Six tracked options built from
the public food DB incl. the log-only basics (fruit + yogurt, banana + quark, yogurt + cereal, toast
with oil and tomato, turkey sandwich, nuts), each a small recipe scaled as a whole by one factor with
snack-sized line caps (water-filling, half pieces, 5 g); default = the first that covers the
shortfall, a pick persists in `hc.nutri.picks` (`snack/auto`). A plan with its own snack-slot meal
(merienda, protein anchor) gets the snack inside it, never a second one. Totals, macro notes and "Del
plan" include it. Bike days: the ride fuel keeps only what fits the top of its g/h range (nothing for
`bike`, fixed at 60 g/h, so "add 60 g more to the ride" no longer contradicts Avituallamiento); the
rest becomes the snack. The example plan's shortfalls drop from 95–835 kcal to ≤ 48 kcal on most days
(bulk gym / bike / bikeLong keep 214–304 kcal: the largest snack at its caps, plus the ride's headroom).

## 2026-10-01 — Food log basics: log an egg without creating a product

The owner wanted to log generic foods (egg, milk…) without first creating a product in Mis productos.
The add sheet's product search now also looks in the public food DB (`ingredients.json`, baked as
`FOOD_BASICS` by `lib/nutrition/basics.mjs`): an empty search lists only his products, typing adds a
"Básicos" group after them (accent- and case-insensitive, "platano" finds "Plátano"), marked "valor
medio". A pick takes an amount in the food's natural unit (1 piece / 100 g / 100 ml, pieces ↔ grams for
countable foods) with a live preview, and is saved as ONE quick entry with its four macros and the
amount in the label ("Huevo · 2 ud (~100 g)") — no DB change, the same idempotent request-id flow. The
formula lives in `lib/nutrition/foodlog.mjs` (`basicEntry`, `basicLabel`, …) with a parity-tested port in
food.js. 25 common basics were added to the food DB with average BEDCA values (USDA FoodData Central
where BEDCA lacks the food; quark: typical Spanish label values, no table entry), `verified: false`,
the source in each note; they carry `swap: false`, a new flag that keeps a log-only food out of Plan de
hoy's food blocks, so the plan's options, NUTRI (still < 20 KB) and every plan number are unchanged.
Cooked chickpeas and lentils already existed. Page bake +~9.5 KB (104 basics).

## 2026-10-01 — Realistic portions: caps, water-filling, Registrar first

The owner's maintain gym day (3050 kcal) asked for 235 g of dry pasta at lunch: only the 2–3 parts
marked `flex: "carb"` scaled, so every extra carb piled onto them. Now every carb / fruit food (and a
sweet carb staple such as honey or jam) is carb-flex by its category (`lib/nutrition/flex.mjs`;
`flex: null` opts out), and an optional per-food `maxAmt` in the tracked `ingredients.json` caps a
portion (pasta / rice dry 150 g, oats 100 g, potato 400 g, gnocchi 300 g, bread ~3 pieces, fruit
~1.5–2 pieces, honey / jam 30 g), validated by `npm run check`. The solver became water-filling: one
common factor, a part past its cap held there and the factor re-solved over the rest until stable,
same clamps, rounding and ud re-solve, ported line by line to the page (parity tests). When nothing
can grow the remainder suggests a snack, not a bigger plate, and the factor line says when portions
are at their maximum. The example plan's numbers changed on purpose (PINNED_TOTALS re-pinned): its
carb parts now stop at realistic portions (largest potato 660–770 g → 400 g), so most of its 12 plans
end 95–835 kcal short and say so. Nutrición now opens on Resumen de hoy, then Registrar, then Plan de
hoy collapsed in a `<details>` (open state per viewer), then Avituallamiento. Cheese (tranchete,
mozzarella) moved from `dairy` to its own `cheese` category so it is never offered for milk. Tablas'
"Reference" header is left-aligned like its cells.

## 2026-10-01 — Every food in Plan de hoy is choosable (food categories)

The owner objected to imposed fixed foods ("no tiene sentido que me marques que tengo que comer
calabacín sí o sí"): only `{use, match}` parts were selects, while `{ing}` parts — courgette at lunch /
dinner, the milk in the after-lunch coffee, the pear of the protein anchor, the pre-workout's milk +
bread roll + honey, the cooking oil — were fixed. Every ingredient of the tracked `ingredients.json` now
has a food category (`cat`, closed set in the new `lib/nutrition/categories.mjs`, validated by
`npm run check`), and a fixed `{ing}` part is a FOOD block: a select of the foods of its category,
plus "none" for veg / fruit / sweet / dairy / drink / sauce. One explicit rule table says what a swap
keeps equal (protein grams, carb grams, fat grams, kcal or the same weight), clamped 0.5–2× like the
protein swaps; the whole day is then re-solved by the carb-flex engine. Generic: no personal-plan
migration. The page ports it line by line (parity tests); the no-pick plan is unchanged byte for byte
(pinned totals of the 12 plans; on the owner's plan all 36 plan × ride cases checked identical);
"Del plan" logs what was picked and leaves skipped foods out. NUTRI on the example: ~10.5 → ~17.9 KB.

## 2026-10-01 — Three main meals + one "Añadidos" group (Plan de hoy, Registrar)

The owner disliked separate full cards for small things ("Café (tras comer)" on rest days,
"Pre-entreno" on training days). Plan de hoy and the food log now show only three main meals —
Desayuno, Comida, Cena — plus ONE "Añadidos" / "Extras" group for everything else (pre / post
workout, protein anchor, after-lunch coffee, cooking oil, snacks). `lib/nutrition/slots.mjs` holds the
classification (`MAIN_SLOTS`, `isMainMeal`, `MEAL_GROUPS`, `mealGroup`, `ADDON_SLOT`), baked for the page.
Plan de hoy renders add-ons as compact rows of one card (kcal = the sum of its rows; block selects,
scaled arrows and supplement lines kept); Registrar shows four groups, add-on entries tagged with their
stored slot; the add sheet's meal select offers the four groups (Añadido → `snack`, or a plan add-on's
own pre / post workout slot) and "Del plan" lists the main meals then each add-on. Display only: the
food-log slot enum and schema are unchanged, and a test pins `planFor`'s totals for all 12 plans.

## 2026-10-01 — Plan de hoy by blocks; Tablas = fixed reference values

The owner never knows in advance what he will eat, but Plan de hoy showed one fixed day and the variety
of his option lists only lived in the removed day builder; Tablas meanwhile showed old train / rest
portions that contradicted the scaled plan. Now a dayPlan part that points at an option list is a
choosable BLOCK (`lib/nutrition/blocks.mjs`): a compact select in its meal card lists that list's
options (grouped like the tables); protein lists (proteina, anclaje, postentreno) scale the pick to
the default's protein grams, every other list takes the option's own amounts, and the carb-flex
engine re-solves the whole day so it still lands on target − ride fuel. Picks persist per viewer for
the day (`hc.nutri.picks`), the page ports the logic line by line (parity tests over every pick), and
`HCNutri.todayPlan()` — hence the food log's "Del plan" — logs what was chosen. Countable foods got
natural-unit metadata in the public `ingredients.json` (`piece`, `weighed`, validated by `npm run
check`): Plan de hoy shows them in pieces with the grams reference and rounds their scaled amounts to
half pieces. Tablas is now server-rendered reference values per natural unit (`lib/nutrition/
reference.mjs`), with no portions and one table per carb list; plan-tables.md writes the same rows.
The example plan's protein / anchor / rest breakfast parts became blocks (same numbers; rest rice
130 g so the bulk day still fits without the breakfast's flex bread). Food-API recipes as extra
breakfast options were left out (view-time only, outside the baked lists).

## 2026-10-01 — Day builder removed; the food log logs the plan ("Del plan")

The Constructor de día (section `registro`) was redundant next to the food log, so it is gone with
its script, copy, styles and builder-only bakes. Its replacement is a "Del plan" tab in Registrar's
add sheet: today's Plan de hoy meals, exactly as the page shows them (same goal, day type and ride
minutes, read through `HCNutri.todayPlan()`), logged in one entry per meal or per item as a quick
entry with its four macros (no database change). The Tablas tables are now painted by
`client/tablas.js`, and the shared bake renders once from `pages/index.astro`. `page.hideTabs:
["registro"]` keeps building as a deprecated no-op. The builder fold's "no food logged" hint is
dropped on purpose (the dial shows the target; the food log is the way to log).

## 2026-09-30 — Nutrition v2, part 2: food log, my products, my recipes

The owner logs what he eats from the LAN page. Nutrición gains Registrar (today's log by meal slot,
right after Plan de hoy) with an add sheet (his products grouped Mercadona / Dia / Eroski / other, his
recipes, or a quick label + kcal), and two folds next to the day builder: Mis productos (barcode or
text lookup on Open Food Facts, done by the ingest service; every value confirmed or typed from the
label before saving, missing ones flagged, never guessed) and Mis recetas (per-serving recipes such
as tortitas or a shake, batch recipes such as lentejas weighed cooked; macros always computed from
the products). Today's log fills the kcal dial, the macro bars and the rings; without entries the
Apple Health intake shows as before.

Storage and API live in `services/health-ingest` (`sql/006_food.sql`, `/food/*`; log entries keep a
macro snapshot so later product edits never rewrite history), reached through plan-web's new
`/api/food/` proxy. The routes are unauthenticated and LAN-only like `/sync`: a required
`X-HC-Food` header plus JSON bodies force a CORS preflight the service never approves, bodies are
capped at 16 KB, writes rate limited, errors coarse codes; a public proxy must never forward
`/food/*`. The UI ships hidden and appears only when the API answers at view time, so the claude.ai
artifact and the example build are unchanged and builds stay byte-identical. One macro formula
(`lib/nutrition/foodlog.mjs`) with parity-tested ports in the service and the page. Rollout: rebuild
the ingest image, restart plan-web, regenerate. Out of scope: label OCR, supermarket scraping, CSV
export of the log for the analysis pipeline (next slice), Apple Health write-back.

Review fixes, same day: plan-web answers only an IP literal, `localhost` or a listed name
(`PLAN_WEB_EXTRA_HOSTS`) on every path, and the food API repeats the Host check plus an Origin check
on writes, closing DNS rebinding. Numbers are rounded before their bounds; a failed food migration
only disables `/food/*` (503); adds carry a request id so a retry never duplicates; a double-tapped
delete is quiet; a macro no entry states shows a dash and a partly-known one is marked "≥". The
Open Food Facts client caches upstream failures briefly and shares concurrent lookups; the shared
limits and the recipe-basis step live once in `lib/nutrition/foodlog.mjs`; the detail sheet's Tab trap
skips controls that cannot take focus.

## 2026-09-30 — Nutrition v2, part 1: goals, day types, scaled plan, ride fuelling

Nutrición opens on today. A goal (maintain / cut / bulk) and a day type (rest, gym or run, a ~2 h
ride, a ride over 2.5 h — detected from today's workouts or programmed session, overridable for the
day) pick one of 12 targets (`targets.byGoal`, carbs as the remainder, approved defaults when
absent). Plan de hoy scales the plan's carb-flex parts by one clamped factor to hit it and says what
is left over; ride days add before / during / after fuelling ranges (orientative); supplements from
`profile.json` sit under their meal. Registro is now "Constructor de día" / "Day builder". Existing
personal plans upgrade with `scripts/migrate-plan-v2.mjs` (dated backup, idempotent). Logging and a
product catalogue are part 2.

The goal later moved out of the way (owner feedback: too prominent): Resumen de hoy keeps only the
day-type selector and shows the goal as a small chip next to today's kcal; the chip opens the profile
sheet, whose new "Objetivo" setting (first section) sets it, with each option's kcal/day change vs
maintain derived from the targets. Same storage key (`hc.nutri.goal`), same refresh path.

Review fixes, same day: only real training raises the day type (walks, commutes and stubs no longer
make a rest day a gym day); the ride's minutes re-scale the meals (the page re-solves from a baked
scaling model, a picked duration is kept for the day); whole-unit portions round first and the gram
portions absorb the rest; the train/rest toggle is gone — the day builder and the intake rings use
today's target (on ride days the meals part, with the ride fuel on its own line); a lighter manual
day type gives way to a harder one detected later, with a note. The migration marks staples only
(fruit and honey opt-in) and `--reset-flex` re-derives the markers of an already-migrated plan.

## 2026-09-30 — Profile sheet (avatar button)

A round avatar at the right of the top bar (photo, initials or a generic icon) opens a
Strava / WHOOP-style profile in the existing detail sheet (`#profile`): name, age (computed on the
viewer's device), city, height, latest weigh-in, Strava bikes and shoes with kilometres (a gentle
replace hint on shoes past ~700 km, retired gear folded) and devices (manual + seen on Strava
activities). The ingest service now keeps a 24 h Strava athlete + gear snapshot and serves it at
`GET /export/athlete`; `npm run sync` pulls it and the avatar into gitignored `data/profile/`;
`profile/profile.json` (template `profile.example.json`) holds the manual fields and wins over
Strava. Gear needs the `profile:read_all` scope; without it the page says how to re-authorize.

## 2026-09-30 — On-demand page refresh + data freshness

The LAN page no longer waits for the hourly cron: a Sync button (and a last Shortcut step) calls
health-ingest `POST /sync` (unauthenticated), which assigns a persisted sequence number, pulls
Strava (at most once per 5 min) and atomically writes the seq to a trigger file; a systemd path unit
on the host runs `refresh.sh` (as the repo owner, hardened). Repeated clicks coalesce onto the
pending seq (at most one rebuild per minute, never a `429`); a call inside the 60 s window after
a finished write gets a new, deferred seq written when the window closes, so a Shortcut payload sent
right after a rebuild is never left unpublished. `refresh.sh` publishes
`site/status.json` `{publishedAt, commit, branch, processedSeq}`, re-runs (max 3 passes) when the seq
advanced mid-run, reports early exits as coarse codes (`branch`, `install`, `build`, `sanity`,
`lock`) without touching the last good publish, publishes only `main` and time-boxes each step
(`npm ci` 900 s). The page waits for `processedSeq >= seq` (no clock comparison) and fails fast
with a reason. The header shows how old the Shortcut, Strava and page data are (`GET /sync/status`,
timestamps + coarse codes only, cached 5 s). Strava refresh-token rotation is persisted with
retries; `/healthz` flags Strava stale 6 h after its last persisted success.
Details: `CLAUDE.md` (LAN page + on-demand refresh), `services/plan-web/README.md`.

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
