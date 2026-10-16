# Nutrition — the plan pipeline and the Nutrition tab

Food database, plan file, goals / day types, portion scaling and guide, ride fuelling, intake rings and Tables. Food log, products, recipes, settings, Progress, Consistency and the score: `docs/nutrition-food-log.md`.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

**On this page:** [Food database](#food-database-ingredientsjson) · [Plan file](#the-plan-file-plan-datajson) ·
[Build, check, generated files](#build-check-and-generated-files) · [The Nutrition tab](#the-nutrition-tab) ·
[Goals and day types](#goals-and-day-types) · [Day-type detection](#day-type-detection) ·
[Portion scaling](#portion-scaling) · [Today's summary](#todays-summary) · [Intake rings](#intake-rings) ·
[Portion guide](#portion-guide-todays-plan) · [Supplements](#supplements) · [Ride fuelling](#ride-fuelling) ·
[Balance](#balance) · [Tables](#tables)

## Food database (`ingredients.json`)

Two files are merged in memory, by both `generate.mjs` and the Astro build, from the same
`lib/nutrition/macros.mjs`: this food DB and [the plan file](#the-plan-file-plan-datajson).
`data/nutrition/ingredients.json` is TRACKED and **public** (the one shareable piece of the plan): a
reusable **sample** built around Spanish supermarket products and BEDCA values — replace or extend it with
your own foods and labels; the plan and the food log read whatever it holds.

- `{ "ingredients": { … } }` of per-100 g/ml/ud base foods, each with `name` + `note` + a category `cat`
  (`lib/nutrition/categories.mjs`); `verified: true` = a real product label, `false` = a DB estimate.
- It may hold MORE foods than any plan uses; the food log searches EVERY food of the file.
- `name` is localized, `{es, en}` (a plain string stays valid for backward compat), resolved by the BUILD
  locale wherever a food is named — Today's plan, Tables, plan-tables.md (generate.mjs: `LOCALE` env →
  `plan.locale` → en), the guide's example foods — by `lib/nutrition/names.mjs` `ingName` / `lineName`. No
  name = a `npm run check` WARNING (the page shows its key), a malformed one an error; a test asserts every
  tracked ingredient has es + en names.

### Log-only basics and sourcing rules

Generic LOG-ONLY basics (`swap: false`; 109 in the sample: dairy, bread, charcuterie, veg, nuts, fish /
seafood, meat, wholegrain carbs, canned legumes, drinks, dishes / pastries…) carry `verified: false` and
their source id in `note`; prepared dishes say their values vary by recipe.

| Source | When | Values |
| --- | --- | --- |
| BEDCA averages | default | kcal from the macros with EU factors 4/4/9, fibre 2, alcohol 7 — never BEDCA's own energy row; when two entries of one food disagree, the one whose macros match its energy |
| USDA FoodData Central | BEDCA lacks the food | FDC energy, carbs = by difference − fibre |
| label sold in Spain | branded drinks only (Coca-Cola, Aquarius, Cola Cao…) | Open Food Facts barcode in `note` |

Drinks with alcohol (`cerveza`, `cerveza1906`, `clara`) carry kcal above their macros (alcohol 7 kcal/g);
`cerveza00tostada`'s macros are derived from its kcal (the source lists only kcal).

### Optional per-food fields

- `piece: { name: {es, en}, plural?: {es, en}, amt, g?, typical? }` (`lib/nutrition/units.mjs`, validated
  by `validateIngredientMeta` in `npm run check`) — the natural piece, `amt` in the food's own unit (g /
  ml); a `ud` food's piece is its unit, amt 100, `g` = its grams reference. `typical: true` = a typical
  weight (medium fruit, a tablespoon, an egg ~50 g), NOT a weighed label. A tablespoon's weight is PER FOOD
  (allioli / mayonesa 15 g); olive oil has NO piece (per 100 ml, logged in ml).
- `weighed: raw | dry | cooked` — how the plan weighs it: meat raw, rice / pasta / oats dry, potato /
  legumes cooked.
- `maxAmt` — the [portion cap](#portion-caps).
- `basic: false` (boolean, validated by `validateIngredientCats`; default true) — hides a food from the food
  log's basics search and recipe picker, keeping it for the plan and the portion guide. A per-user choice
  for a food you log as your own product (My products), so the add sheet lists no generic duplicate. The
  sample sets it on 18 foods (confitura, jamón serrano, gambas, salpicón, tranchete, mozzarella, salsa de
  tomate, soja, allioli, mayonesa, pisto, chocolate 85%, helado, napolitana, palomitas, panecillo, patatas
  horno, tomate frito); `lib/nutrition/basics.mjs` bakes them with `h: 1`.

## The plan file (`plan-data.json`)

`data/nutrition/plan-data.json` (GITIGNORED, **personal**) = `data`/`dayPlan`/`extras`/`quesoKeys`/
`vegKeys`/`legumeKeys`/`legumePlate`/`page`. Each item's `recipe` (`[{ing, amt}]`) references
`ingredients.json` keys; macros are COMPUTED, never hand-typed. Items with no single label use a `manual`
macro block (legumes, soup, pintxo), kept verbatim. **To change a plan number, edit `plan-data.json`
(servings/day plan) or `ingredients.json` (a food's macros/label) — never the generated files.**
With the LAN data service, this file mirrors a document in its database: after editing it, run `npm run documents -- push plan` (an edit not pushed is kept, and `npm run sync` warns about it); [`data-pipeline.md` → Owner documents](data-pipeline.md#owner-documents-scriptssync-documentsmjs-first-step-of-npm-run-sync).
`npm run check` (`validateNutrition`) reports a malformed plan as validation messages, never a crash: `data`
and `extras` must be objects (`{}` when the plan has none), and every breakfast in `data.desayuno` but the
`none` row needs a `recipe` (the breakfast tables list its ingredients, so a `manual` block is refused there).

### `targets.byGoal`

`targets.byGoal[goal][dayType] = { kcal, p, f }` (optional, validated by `validateTargets` inside
`validateNutrition`). Carbs are the REMAINDER ((kcal − 4p − 9f) / 4, never typed); protein + fat above
kcal is an error. A missing cell falls back to `DEFAULT_BY_GOAL` (`lib/nutrition/targets.mjs`), a generic
EXAMPLE seed (a 70 kg reference adult per `analysis/methodology.md` §2; the example plan copies it); set
all twelve cells once you know your TDEE.

| Goal | rest / gym / bike / bikeLong kcal | P / F g |
| --- | --- | --- |
| maintain | 2300 / 2700 / 3100 / 3600 | 125 / 65 |
| cut | 1950 / 2350 / 3100 / 3600 (≈ −15 % on rest and gym, ride days kept fuelled) | 140 / 55 |
| bulk | 2600 / 3000 / 3400 / 3900 (+300 kcal) | 125 / 70 |

- Default goal = `page.goal`, else `maintain`. A plan without `targets.byGoal` / `page.goal` uses these
  code defaults, and scaling is decided by food category, so old plans need no migration.
- **Precedence:** the in-page onboarding's accepted targets (`data/profile/onboarding.json`, when they pass
  `checkTargets`; its height 120–230 cm and weight 30–250 kg, the wizard's own `validatePerson` bounds, are
  checked when it is synced, and the profile fields it supplies must also pass `validateManual` or the build
  warns and keeps `profile.json`) > the plan's `targets.byGoal` > `DEFAULT_BY_GOAL` (`lib/load/inputs.mjs`; docs/profile.md).

### Computed starting targets (`lib/nutrition/energy.mjs`)

For the in-page onboarding, in the `targets.byGoal` shape; a ±10 % estimate — recalibrate with the 7-day
weight trend after 2–3 weeks.

- Mifflin-St Jeor BMR × NEAT (`sedentary` 1.2 / `light` 1.3 / `active` 1.4) + each day type's net exercise
  ((MET − 1) × kg × h: gym 6 × 1 h, ride 7 × 2 h, long ride 7 × 3.5 h). Cut −15 % except the long ride,
  bulk +10 %, kcal to the nearest 50; protein 2.0 g/kg cut / 1.8 otherwise, fat 0.8 g/kg; floors 1500 kcal
  (men) / 1200 (women).
- The protein and fat kg are a **reference weight** (`referenceKg`): the current weight up to BMI 25, the weight
  at BMI 25 above it (to 10 g), because fat-free mass, not fat, drives protein needs; fat never drops below
  0.5 g per kg of CURRENT weight (rounded up to the gram, so a decimal weight never lands under it).
  `checkTargets` measures protein, the fat range and carbs per reference kg and the fat floor (`fatMin`) per
  current kg. Same factors for men and women (the position stands give no sex-specific
  g/kg); sex enters through the BMR and the kcal floor.
- `screenPerson` withholds numbers under 18 or in pregnancy / lactation, offers only maintenance on an
  illness / medication or eating-risk answer, drops the cut under BMI 18.5; `checkTargetWeight` refuses a
  target BMI < 18.5.
- `checkTargets` bounds an edited cell — errors: floor, deficit > 20 %, surplus > 15 % (over maintenance, or over
  the floor when the floor is higher, so a day `computeTargets` raised to the floor always passes), > 1 % body weight /
  week, protein outside 1.2–2.4 g/kg, fat < 0.5 g/kg; warnings: protein outside 1.6–2.2, fat > 1.0, carbs
  outside rest 3–5 / gym 5–7 / bike 6–10 / long 8–12 g/kg where energy is not cut on purpose.

### Other plan fields

- `validation.kcalBand = { train: [min, max], rest: [min, max] }` — overrides `npm run check`'s day-total
  kcal band (default train 2000–2800 / rest 1700–2400).
- `fuel.items` — [own fuel items](#own-fuel-items).
- Read by nothing: `targets.train` / `targets.rest`. IGNORED legacy keys (accepted, `npm run check` warns
  about each, safe to delete; `LEGACY_PLAN_KEYS` in `macros.mjs`): `extrasDisplay`, `indulgeKeys`,
  `alcoholKeys`, `mealReplaceKeys`, `page.notes['registro.*']`, `page.offPlanPlaceholder`.

## Build, check and generated files

- `data/nutrition/generate.mjs` only VALIDATES the merged plan and writes `plan-tables.md` (atomically); it
  emits no HTML. A missing or malformed `ingredients.json` / `plan-data.json` is one `ERROR:` line and exit 1;
  an unknown flag (`--chek`) exits 2 before anything is read or written (`--help` for the usage). Importing it
  reads nothing: `load()` reads the two files.
- `npm run generate` (= `node data/nutrition/generate.mjs && node scripts/build-web.mjs`, idempotent):
  validate, write `plan-tables.md`, build `web/dist/personal/index.html`.
- `npm run check` — validators only: `generate.mjs --check` (unknown-ingredient refs, every `{ing}` line's
  `amt` a number > 0, every meal an object with a `parts` array, day totals vs the kcal band, Atwater, ambiguous
  matches) + `build-web.mjs --check` (training-data.json integrity). Ingredients
  unused by the plan are a non-fatal WARNING (expected for a shared DB).
- `npm test` — `node --test`, zero deps beyond `astro`; `pretest` builds the example (+ personal, if
  present) fixtures the web/ tests read.
- **Never** hand-edit `plan-tables.md`, `web/dist/`, or re-type macros in `food-log.md`.
- `plan-tables.md` holds: the Legumes and Verified product labels tables; "Daily targets by goal and day
  type" (kcal, P, F, C, meals kcal, ride fuel, carb factor, remainder — `buildDayPlans` precomputes the 12
  plans at the default ride minutes); "Food reference (fixed values per natural unit)", the
  [Tables](#tables) rows (legumes per 100 g cooked instead of a ~300 g plate).

**Fresh-clone bootstrap.** `ingredients.json` and the `.example` seeds are tracked. Copy
`data/nutrition/plan-data.example.json` → `plan-data.json` and `data/training/training-data.example.json` →
`training-data.json`, edit both, then `npm ci && npm run generate`. The real `plan-data.json` /
`training-data.json` / `plan-tables.md` / `web/dist/personal/` stay gitignored. `npm run build:example`
builds from the tracked seeds plus the synthetic demo extract `data/demo/extract/` — no personal files; a
pipeline sanity check on a bare clone.

**Viewing the plan.** Edit the JSON → `npm run generate` → open `web/dist/personal/index.html`, or let the
LAN page pick it up ([`lan-services.md`](lan-services.md)). The output is one CSP-safe file (no external
refs, no `<script type="module">`, every script `is:inline`), so a static copy works anywhere.

## The Nutrition tab

- **Header** — a centred uppercase title ("NUTRICIÓN") + ⓘ (`#nu-intro`, `I18N_NUTRI.head`: the tab intro
  and shared caveats), in `web/src/tabs/Dia.astro` outside the `dia` section, so it stays when only Tables
  is shown. Every section header is the shared `.hs-head` row (sentence-case `.hs-lbl` + optional ⓘ,
  `health.css`).
- **`dia` section** (key kept for `page.hideTabs`): Today's summary, Log food, Today's plan, Ride fuelling;
  then Balance, Score, Progress, Consistency (`docs/nutrition-food-log.md`).
- **One bake** — nutri-day.js (`web/src/client/nutri-day.js`) renders the blocks from `NUTRI`
  (`lib/nutrition/today.mjs` `buildNutriToday`, in `Dia.astro`) + `I18N_NUTRI`
  (`web/src/i18n/nutri-templates.mjs`, es/en). `NUTRI` = `{…, base: {<day>: {sl, fixed, flex}}, guide:
  {roles, defaults, oil, fallback, extras, done, covered}}`, ~3.6 KB on the example (budget 8 KB,
  `lib/nutrition/today.test.mjs`).
- Everything time-based is decided on the viewer's clock, so builds stay byte-identical; each block renders
  in its own try/catch (a one-line message on failure).

## Goals and day types

`lib/nutrition/targets.mjs`: **day types** `rest`, `gym` (a gym or run session, ~1 h), `bike` (a ride
~2 h), `bikeLong` (> 2.5 h); **goals** `maintain`, `cut`, `bulk` ([targets](#targetsbygoal)). The goal is
set in the profile sheet (server-side on the LAN page: "Settings" in `docs/nutrition-food-log.md`); the day
type in [Today's summary](#todays-summary).

- **Today's target is the ONE source for the tab**: `window.nutriTarget()` = the MEALS target (`k, p, c,
  g`, `fatMax` = fat + 15 g, `fuelK`, `day` = base day train / rest, label).
- `HCNutri.targetFor(date)` = the same shape for an earlier logged day (labelled "Objetivo / Comidas de ese
  día"), or `null` when its day type is unknown.
- Every goal / day type / ride change calls `window.intakeRefresh()` directly (a failure shows a one-line
  message, never a stale ring).

## Day-type detection

`lib/nutrition/daytype.mjs` is the ONE implementation; `lib/nutrition/client.mjs` emits it as `HC_DAYTYPE`
(its `CLIENT` descriptor) for nutri-day.js — no copy. `DAYTYPE_CASES` / `DAYINPUT_CASES` test it in the
lib, the page and the built page.

| Input | Rule (`DETECT`) |
| --- | --- |
| done gym / run (`SCORES.timeline`, same-day rows merged per modality) | ≥ 20 min → gym (shorter = a stub) |
| done `other` (walks, tennis…) | ≥ 45 min only, as gym |
| done ride | < 30 min = commute (ignored); 30–74 → gym; ≥ 75 → bike; ≥ 150 → bikeLong |
| programmed `TRAINING[today]` | `kind: "bike"` by optional `durationMin`, same ride thresholds (absent = bike); other kinds → gym |
| none | rest |

- A zero / junk duration is dropped. `training-data.json` accepts `kind: "bike"` + `durationMin`.
- **Per-person sports** — the onboarding's `sports` add endurance modalities (`enduranceOf`: running →
  `run`, swimming → `other`), baked as `NUTRI.detect.endurance` only when there are some: such a session,
  done or programmed with `durationMin`, of ≥ 75 min is a bike day and ≥ 150 min a bikeLong day (minutes
  travel as `rideMin`, so fuelling follows); shorter ones keep their rule.
- The MOST DEMANDING of done and programmed wins (gym done + long ride programmed → bikeLong); a tie goes
  to what was done (real ride minutes).
- A day beyond the 3 baked timeline days detects from `DETAIL.sessions` (`daytype.mjs` `dayInputFor`).
- **Manual override** — goal and override in localStorage (`hc.nutri.goal`, `hc.nutri.dayType` =
  `{date, type, auto}`, so it expires the next day), every access wrapped; label "(auto)" / "(elegido)"
  with a "use the detected one" button. An override LESS demanding than a type detected later that day
  (`auto` rose since: picked gym, then a long ride synced) is dropped on load with a one-line note
  (`Detectada salida larga: cambiado a Bici larga`); a more demanding one or a deliberate downgrade stays.

## Portion scaling

`lib/nutrition/scale.mjs`. Plans keep two base days; `BASE_DAY` maps rest → `dayPlan.rest`, gym / bike /
bikeLong → `dayPlan.train`. Base macros come from the engine (ingredients.json, never hand-typed).

### Carb-flex parts

Only CARB-FLEX parts (`lib/nutrition/flex.mjs` `isFlexPart`) scale. `flex: null` opts a part OUT; `flex:
"carb"` opts it IN (also a manual block, scaled whole); otherwise by FOOD CATEGORY — an `{ing}` part whose
food is carb / fruit or a sweet carb staple (honey, jam: ≥ 60 % kcal from carbs; never chocolate, ice
cream, pastries; `autoFlexIng`), or a `{use, match}` item whose recipe lines are ALL such foods (a mixed
composite, a manual block or an uncategorized food stays fixed). Spreading carbs over every carb / fruit
part stops one plate absorbing the day (e.g. a large dry-pasta portion on a maintain gym day). Protein and
fat are NOT scaled (Extras takes what the main meals leave; `MACRO_TOLERANCE_G` (15 g) only feeds the
rings' `fatMax`).

### Portion caps

`maxAmt` (optional, in `ingredients.json`, in a recipe `amt`'s scale: g / ml, or `UD_AMT` per unit), baked
on the model line (`LINE.CAP`; `lineCap` / `capFactor` / `capAmount` in `lib/nutrition/amounts.mjs`);
`npm run check` (`validateIngredientCaps`) requires a finite positive number of at least one rounding step
(a unit, half a piece, 5 g) and at most `MAX_AMT_LIMIT` 2000. A test requires a cap on every carb / fruit
food and sweet staple. Tracked caps: rice / pasta (dry) 150 g, oats 100 g, potato / sweet potato 400 g,
gnocchi / oven chips / pre-fried sweet potato 300 g, bread roll 135 g (3 rolls), seeded bread 125 g (3
slices), honey / jam 30 g, fruit ~1.5–2 pieces (banana 240, apple 270, orange 260, pear 255, peach 300,
nectarine 280, flat peach 200, kiwi 150, plum 130; pineapple 250, watermelon 400, melon 350, grapes 200,
strawberries 250, blueberries 150 g).

### The solve

- Each base day is baked as a SCALING MODEL (`planModel`: per meal the fixed macros, the flex lines `[unit,
  amt, k, p, c, g]` or a manual block).
- `solveScale` = WATER-FILLING (`waterFill`, `lib/nutrition/fill.mjs`, `{clamp: [SCALE_MIN, SCALE_MAX],
  start: 1}`): one common factor for every flex line so the meals hit (target − ride fuel), clamped to
  0.6–2.0×. A line that would pass its cap is HELD there and the factor re-solved over the free lines until
  stable (a cap beats `SCALE_MIN`: an amount above its cap shrinks to it). Rounded and labelled to 2
  decimals ("×1.45"); with every line held, the largest cap reached. `capped` = some line at its cap,
  `allCapped` = every flex line (and no manual block, which has no cap).
- DISCRETE lines — whole units (`ud`) and countable g / ml foods (a `piece`, HALF-piece grid `PIECE_GRID`
  in `lib/nutrition/units.mjs`; one unit = `UD_AMT` (100); baked as `NUTRI.scale.grid` / `.ud`) — round
  first, then the factor is RE-SOLVED on the remaining g / ml parts so the day lands within tolerance. A
  rounded amount never passes its cap (`capAmount` steps DOWN on the grid); with only `ud` parts flexible
  the remainder is reported honestly (+ a one-line note).
- Amounts round to 5 g / 5 ml (never below one step); a `manual` block scales whole ("×1.30"); totals are
  recomputed from the ROUNDED amounts.
- Model line `[…, step, ingredient key]` (`amounts.mjs` `modelLine` / `stepAmount`); its layout is named
  ONCE as `LINE` with accessors `lineUnit` / `lineAmt` / `lineMac` / `lineStep` / `lineKey` /
  `pieceOf(pieces, l)` / `scaleLine`, mirrored in nutri-day.js — never read by a bare index.
- `rem` = target − ride fuel − meals (kcal): listed per (goal, day type) in plan-tables.md, handed to
  Extras by the guide (the example plan's capped plates miss most goal × day types, so its Extras are
  large).

### `planFor` and the bake

- `planFor(bake, goal, dayType, minutes)` = one plan for a ride of `minutes` (`mt` = target − ride fuel,
  the fuel all carbs) → `{base, t, minutes, fuelK, fuelC, mt, meals (each plan meal's [k, p, c, g],
  whole), tot, factor, clamp, udOnly, capped, allCapped, rem}`.
- The page bakes only `{base, t}` per (goal, day type) + the two models (`{sl (each meal's slot), fixed,
  flex}`) and runs `solveScale` / `planFor` itself (`HC_SCALE`, emitted by `lib/nutrition/client.mjs` with
  what they call from `amounts.mjs`, `units.mjs`, `fill.mjs`, `fuel.mjs`; no copy), so a new ride duration
  re-scales the budgets.
- `planModel` names parts (`label`, else the ingredient's `name`, else its key); `solveScale` formats
  amounts (`q`); a countable food shows pieces + grams (`fmtPieces`: "1½ medium bananas (~180 g)" on the
  half-piece grid, "~2 bread rolls (80 g)" off it; "2 eggs (~100 g)"); `fmt.pieces` bakes only the pieces
  a baked flex line can format.

## Today's summary

- **Day-type pills** — real radios, server-rendered (labelled, ≥ 44 px), the block's only control; short
  labels `dayShort` (`Descanso · Gym · Bici · Bici larga`), `.chip` pills (design-system.md → Components),
  the picked one white-filled; text only at every width (with icons the four need ~370 px and wrap at
  360–390 px). Full `dayTypes` names stay for sentences and the pill title; the DETECTED pill gets
  `.seg-auto`, a small dot.
- **Per-person names** — with onboarding `sports`, `web/src/i18n/day-labels.mjs`: pills only for the day
  types their week has (`shownDayTypes`), named after its sports, most frequent first, two names then
  "+N", the usual length in the full name ("Correr ~1,5 h"); sport-neutral `sportText` wording for the
  auto-switch note, ride line and fuelling labels. Without sports the dictionary is untouched.
- **kcal ring** — Home's dial language (`.nt-ring` around the shared `.dial-ring` / `.dial-svg` /
  `.dial-track` / `.dial-fill` / `.dial-num`; `view/dial.mjs` `arcPath(0, 1)` baked as `NUTRI_ARC`, 12
  o'clock, clockwise, round caps, thin stroke): kcal EATEN today in `--num` (dash with no intake) over
  "/ target kcal". One state colour: none = `--track` only, ok = ≤ 110 % of target (`--up`), over
  (`--down`, ring full).
- **Macro rows** — Protein / Carbs / Fat: UPPERCASE label, "eaten / target g" in `--num`, a thin bar
  (> 110 % `--down`; missing macro = dash + empty bar).
- Ring and rows fill ONLY from intake logged on the viewer's today (`INTAKE.latest` dated today; the page
  food log `window.foodTotals` wins when it has entries; a macro some entries lack is a minimum "≥"), and
  follow the [boot wait](#boot-wait).
- ⓘ `#nutri-sum-info` (written by nutri-day.js each render): where intake comes from, "a half-logged day
  looks short", "carbs are the rest of the kcal".
- **Goal chip** — muted ≥ 44 px button under the ring (`#nutri-goal-chip`) opening the profile sheet on its
  goal (`HCDetail.open('profile', null, { focus: '#pf-goal input:checked' })`).
- Then on bike days the plan line ("meals + ride fuel = total", meals = the guide's meals target), then the
  intake rings — hidden when the logged day is today (the ring shows it). Home's "today you eat" card
  (`#eat-body`) shows the same day type, goal and target.

## Intake rings

`lib/nutrition/intake.mjs` `intakeFrom(inputs, targets)` (over the build's one `lib/extract/read.mjs`
`readExtract`) bakes the most recent LOGGED day of `dietary-daily.csv` (kcal > 0) + the plan's base day
totals (the bake keeps only `target.train`, the fallback without `HCNutri`). `web/src/client/intake.js`
draws four rings (kcal, protein, carbs, fat).

- **Target** = THAT day's `window.HCNutri.targetFor(date)`: today = `nutriTarget()`; a past day = its own
  detected day type (timeline + programme, its recorded ride minutes) × the current goal, never today's
  override. Bike days: meals target = day target − ride fuel, the fuel on its own line (`+ X kcal en la
  bici`). An undeterminable past day (`null`) renders NO rings; a missing / throwing hook falls back to
  the plan's training-day total.
- **Shown** only when that day is within the last 3 days of the viewer's clock (client-side); else NOTHING
  (host hidden, no help text). A ring never fills from the target (a missing macro = empty ring + dash).
  The viewer's today is labelled in progress (`Hoy, en curso` / "Today, so far").
- **Never logged** (`INTAKE.latest` null, build time) → no rings host and NO help line: the ring and rows
  already show the target, and on the LAN page the food log is the way to log — do not point at an Apple
  Health food app.
- **Apple Health source** — a food app writing to Apple Health + the Shortcut `diet_kcal` / `diet_protein`
  / `diet_carbs` / `diet_fat` keys, folded by sync into one `dietary-daily.csv` row per day (export rows
  win).
- **LAN page** (`HCFood.ready()`) — the food log is the ONE source: today's log (`window.foodTotals`) when
  it has entries, else the newest food-log day in the window (`HCFood.recentDay(INTAKE.freshDays)`: one
  lazy `GET /food/log/summary`, re-read after any add / delete or on a new day), labelled by its date with
  its `targetFor`. Nothing logged → no rings, never the Apple Health day; same while today's log is not
  loaded (`HCFood.groupTotals()` null).

### Boot wait

- While the food API boot request is in flight (`HCFood.pending()`) the rings render NOTHING; answer → the
  food log, failure → the Apple Health day. Past `INTAKE.bootGraceMs` (`INTAKE_BOOT_GRACE_MS`, 2500 ms,
  baked) the Apple Health day renders anyway (a hanging fetch) and a late answer still switches.
- Today's summary ring + rows share the wait (`window.intakeWaiting()`, owned by intake.js, one grace
  timer): empty track + "— / target" while waiting; answered → food log only; failure / grace over → Apple
  Health day.
- nutri-day.js is inlined before the food scripts and intake.js after them, so intake.js re-renders Today's
  summary (`HCNutri.refresh`) at load and when the grace ends; consecutive inline scripts run before first
  paint, so the Apple Health day never flashes.

## Portion guide (Today's plan)

An orientative "how much can I eat", not a menu. `lib/nutrition/guide.mjs` is the ONE implementation, run
by nutri-day.js as `HC_GUIDE` (emitted by `lib/nutrition/client.mjs`; `GUIDE_CASES` / `DAYCAP_CASES` test
it in the lib, the page and the built page). Always four groups — Breakfast, Lunch, Dinner + Extras
(`Desayuno`, `Comida`, `Cena`) — whatever the day type; goal and day type change only amounts.

### Budgets (`guideBudgets`)

- Today's solve (`planFor`: goal × day type × ride minutes, caps and water-fill) → a main meal's budget
  (kcal, P, C, F) = the solved macros of its slot's plan meals (`mealSlot` via the baked `base[day].sl`;
  two meals of one slot add up; no meal = zero budget).
- A COOKING-OIL meal (no slot, every part `fat`-category: `oilMeals`, baked as `NUTRI.guide.oil`) splits
  evenly between lunch and dinner (lunch takes the rounded half; wholly into the one the plan has; Extras
  if neither), so oil logged with lunch does not drain it early.
- **Extras** = meals target (target − ride fuel) − the three main budgets: the add-ons (pre / post workout,
  a protein anchor, an after-lunch coffee…) plus what the capped plates leave; a macro the main meals
  already pass clamps at 0 and the card says so. The four groups sum to the meals target (= the fold
  summary's kcal).

### Main meal rows

- A plate by parts: Protein ~X g (= meal P), Carbs ~Y g, Veg `libre`, Fat ~Z g.
- Each macro row = ONE example food in a native `<select class="gd-pick sel">` (the shared select pill,
  docs/design-system.md → Select; ≥ 44 px; aria-label `Ejemplo de Proteína para Comida`; `style="--pick:N"`
  = the chosen name's length, so the width fits it, capped at the row; a long amount ("2½ bread rolls
  (~112.5 g)") wraps under it, right-aligned).
- **Amount** (`exampleAmount`) = grams ÷ the food's macro per 100 of its amount scale, in its natural unit
  (pieces + grams for a countable food via `fmtPieces`, whole units, a tablespoon for a sauce with that
  piece, else g / ml on the 5 g grid, olive oil in ml), never past `maxAmt`: then `~150 g (máx.)` +
  `+ completa con otra fuente`.
- **Options** (`roleOptions`): every basic of the role's categories (protein: protein; carbs: carb + legume
  + fruit; fat: fat; log-only `swap: false` included) from FOOD_BASICS (the ONE food table, baked for the
  food log; entries carry `c` = category, `x` = portion cap; budget `web/test/food-build.test.mjs`) + the
  user's products when the food API answered (view time, `<optgroup>` `Mis productos`), sorted by folded
  name.
- **Default** = the base plan's food for that role in that meal (`mealDefaults`: the role-category line
  supplying most of the macro, baked as `NUTRI.guide.defaults`), else `GUIDE_FALLBACK` (pollo / arroz /
  aceite de oliva).
- Picks persist per viewer, not daily (`hc.nutri.guide` = `{picks: {<slot>.<role>: 'b:<key>' |
  'p:<id>'}}`, every access wrapped); an unlisted pick (a product without the API) shows the default and
  stays stored; the obsolete `hc.nutri.picks` is cleared on load. Each example covers ITS macro only (a
  muted note says so).

### Extras card

`~N kcal para extras hoy`; muted `Incluye café, tentempiés y pre/post-entreno`; a muted hint with costs
from the food DB (`EXTRAS_EXAMPLES` → `NUTRI.guide.extras`: un plátano ~106, un yogur ~79, un batido de
proteína (30 g) ~114 kcal); `Repártelo antes y después de entrenar` on gym / bike day types; its P / C / G
line. No item list, no selects.

### Live link with the food log (LAN page)

`window.HCFood.groupTotals()` = today's sums `{meals: {breakfast, lunch, dinner}, addon}` (null without the
API).

| Element | Shows |
| --- | --- |
| main meal | `✓ N kcal registradas` at ≥ 90 % of its kcal (`DONE_SHARE`); `en curso: N kcal` when partial |
| macro row | what is LEFT (budget − logged, floor 0, `de 45 g` once logged), example amount recomputed; ≤ 10 % left (`COVERED_SHARE`) → `✓ cubierto` |
| Extras | budget − logged add-ons (`(de N)`) |
| under the guide | `Te queda hoy: kcal · P · C · G` (meals target − everything logged, `dayRemaining`) |

- **Day cap** (`capByDay`): a row's left = min(the meal's left, `Te queda hoy`), used by the example amount
  and the "+", so overspending one meal is taken from the others. ≤ 10 % of that macro's day meals target
  left → `✓ cubierto (día)` (no amount, no "+"; a row covered by its own meal keeps `✓ cubierto`). Extras'
  kcal and P / C / G are capped the same way (`✓ cubierto (día)` once the day's kcal are covered).
- **"+"** (`.gd-add`, 44 px, aria-label `Registrar 195 g de Pechuga de pollo en Comida`) on each open row
  logs the example amount into that meal via `HCFood.addGuide`: a basic = ONE quick entry (`basicEntry` /
  `basicLabel`, in pieces when it has them, sent with `force` since the macros are the DB's own); a product
  = a product entry; one request id per pending add, kept across an ambiguous retry.
- Re-renders on every add / delete (the food scripts call `HCNutri.refresh()`) and on goal / day type /
  ride changes. Without the API: budgets only, no "+", no `Te queda`.

### Layout

- Flat `--surface` cards (no border, no shadow): caps meal name, kcal budget big in `--num`, macro rows
  (caps label left, "~45 g" in `--num` right; select + amount + "+" below, a long amount wrapping
  right-aligned at 360 px), the muted P / C / F (es: G) line. ≥ 900 px keeps the single column.
- A native `<details class="nutri-block sec-fold nutri-fold" id="nutri-plan-fold">`, COLLAPSED by default;
  summary (a flat `--surface` row like every Nutrition fold — My products, My recipes, Tables: UPPERCASE
  label, optional figure, chevron; `layout.css`) = heading + meals target (`#nutri-plan-kcal`, written each
  refresh). Open state per viewer (`hc.nutri.planOpen` '1' / '0', wrapped, saved on `toggle`); the guide
  renders while collapsed. Ride fuelling follows, never collapsed, under the shared `.hs-head` label.
- Styles: `.gd-*` in `web/src/styles/nutri.css` (tokens only: `--good` = covered / done, `--mid` = a portion
  at its maximum, `--accent` = the "+").

## Supplements

Optional `supplements: [{ name, dose?, meal }]` in `profile/profile.json` (`meal` = breakfast | lunch |
preworkout | postworkout | dinner | snack, `lib/nutrition/slots.mjs` `MEAL_SLOTS`; validated by
`validateManual`), also listed in the profile sheet. A discreet "name dose" line (no macros; a small pill
SVG icon, no emoji) under the guide card of that slot: breakfast / lunch / dinner in their card, other
slots in Extras with the slot name (`Electrolitos (Pre-entreno)`). A plan meal's slot = its `slot` field,
else guessed from its es / en name (`mealSlot`: desayuno / breakfast, comida / lunch, pre / post-entreno /
workout, cena / dinner, merienda / snack / anclaje).

## Ride fuelling

Bike day types only. `lib/nutrition/fuel.mjs` is the ONE implementation, run by nutri-day.js as `HC_FUEL`
(emitted by `lib/nutrition/client.mjs`), pinned by `FUEL_CASES`. Orientative, not medical advice.

| Step | Guidance |
| --- | --- |
| Before | 2–3 h before ~1–2 g/kg carbs; last hour 30–60 g easy carbs |
| During | bike 60 g/h, bikeLong 60–90 g/h; fluids 500–750 ml/h; sodium ~300–600 mg/h, more in heat (ranges, no weather data) |
| After | within 1 h ~1–1.2 g/kg carbs + 30–40 g protein |

- g/kg uses the latest weigh-in (`profile.weight`, else rates only). Carbs in practical units (gel ~25 g,
  banana ~25 g, bar ~40 g, a 500 ml bottle at 6–8 % ≈ 30–40 g) + a mix idea (a bottle per hour + gels).
- Duration = today's recorded ride (real minutes, shown, not pickable), else a picker (1–6 h, default 2 h /
  3.5 h) kept per date and day type (`hc.nutri.rideMin` = `{date, type, min}`, expires the next day).
- On-bike carbs count inside the day total (plan point = range midpoint × hours), so the duration
  re-scales the meals.
- A 3-step timeline (`.fuel-steps`), one key number per step in `--num` (carbs before, g/h during, carbs
  after).

### Own fuel items

Optional `fuel.items: [{ name: {es, en} | string, carbs: <g per piece, 0–100>, fat?: <g ≥ 0>, kind?: "fast"
| "slow" }]` in the plan, validated by `npm run check` (`validateFuelItems`, from `validateNutrition`: a
malformed item is an error naming the field), baked localized as `NUTRI.fuel.items = [{n, c, f, k}]` only
when present (absent = generic output). Personal items live only in the gitignored plan-data.json; the
example plan has none (tests use synthetic items).

- During shows the PIECE MIX (`fuel.mjs` `ownDuring`, via `HC_FUEL`, pinned by `FUEL_CASES`): eating starts
  at min 30 (`OWN_START_MIN`; the first half hour runs on the carbs eaten before); target = during-rate
  midpoint × (minutes − 30) / 60; n whole pieces spread evenly from min 30 — before half the ride the first
  `slow` item, after it the first `fast` one (fallback: an item without kind, then the first); n (≤ one
  piece per 10 min) = the total closest to the target, never above the during range top.
- The line names the total, a "~X g more from a drink or a banana" gap to the plan point (day accounting
  unchanged) and the 6–8 % bottle as the alternative; the generic gel / bar equivalents and the bottles +
  gels mix are then hidden. Before's last hour names k fast pieces inside 30–60 g, closest to 45 g.

## Balance

`client/health.js` `renderBalance` renders `HEALTH.energy` (lib/health/aggregate.mjs `aggEnergy`) into
`#nutri-balance`, after Ride fuelling and before Progress (Salud keeps the expenditure row).

- `.hs-head` "BALANCE" + ⓘ (window, days, "historical", the macro clause); the window as a caption ("31 May
  – 29 Jun · 30 days logged") — ONE fixed window: a single paired window of up to 90 days anchored to the
  newest expenditure day, no W / M / 6M switch.
- Three shared metric rows (`HC.metricRow`: avg intake, avg burn — opens the expenditure sheet —, deficit /
  surplus a day), then the average macro split as one stacked bar + counted legend (Training's `.act-bar` /
  `.act-legend`, `.nb-m-p` / `-c` / `-f` = `--up` / `--strain` / `--mid`; widths normalised so rounded
  percentages leave no gap).
- Too few logged days → a short empty line, "intake can't be scored" (with the last logged day) behind the
  ⓘ; no expenditure at all → host hidden.

## Tables

Fixed reference values, NO portions: `lib/nutrition/reference.mjs` `buildReference(nut, {lang, words})`,
server-rendered by `web/src/tabs/Tablas.astro` through `components/RefTable.astro` (no bake, no client
script). Same sections / lists as the plan.

- Each food per NATURAL unit (`refUnit`): a piece with its grams ("1 medium banana (~120 g)", a typical
  weight tagged "typical weight"), a tablespoon sauce per tablespoon, else "100 g" / "100 ml" (olive oil
  "100 ml") + how it is weighed ("100 g dry", "100 g raw"). A composite option = a group row + one row per
  component; a `manual` option = "1 serving (<its q>)".
- A list section with no rows (only the "none" option) is not rendered (no empty accordion). A carb list's
  train / rest tiers collapse to ONE table; same-named options collapse only when their reference rows are
  equal (the same food at another amount), else both show (`listRows`).
- A top note says today's amounts are in Today's plan; the generic notes (dict `tablas.*`) and the example
  plan's `page.notes['tablas.*']` do not talk about portions. plan-tables.md writes the same rows.
