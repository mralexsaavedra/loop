# Nutrition — plan pipeline and Nutrición (part 1)

Plan data pipeline, the published artifact, intake rings, goals / day types / portion guide / fuelling / Tablas. Food log, products, recipes and settings: `docs/nutrition-food-log.md`.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Nutrition plan — data pipeline & published artifact

**Two files, merged in memory (by both `generate.mjs` and the Astro build, from the same
`lib/nutrition/macros.mjs`):**
- `data/nutrition/ingredients.json` (TRACKED, **public** food DB) — the reusable
  **sample** (it ships built around Spanish supermarket products and BEDCA values: replace or extend it
  with your own foods and labels; the plan and food log read whatever it holds)
  `{ "ingredients": { … } }` of per-100 g/ml/ud base foods (`verified:true` = real product
  label, `false` = DB estimate; each carries `name` + `note` + a food category `cat`, see
  `lib/nutrition/categories.mjs`). `name` is localized, `{es, en}`
  (a plain string stays valid for backward compat), resolved by the BUILD locale wherever a food is
  named — Plan de hoy, Tablas, plan-tables.md (generate.mjs: `LOCALE` env → `plan.locale` → en), the
  portion guide's example foods — by `lib/nutrition/names.mjs` `ingName` / `lineName`; an ingredient without a
  name is a `npm run check` WARNING (the page then shows its key), a malformed one an error, and a test
  asserts every tracked ingredient has es + en names. This is shareable and is the
  one piece of the plan that goes public. It may hold MORE foods than any single plan uses — e.g. the
  107 generic LOG-ONLY basics (`swap: false`: the first 25 — yogur natural, queso fresco / batido, pan de
  barra / de molde, jamón cocido, tomate, lechuga, pepino, aguacate, nueces, almendras, cacahuetes,
  aceitunas, mantequilla, azúcar, café solo, bebida de avena, atún en aceite, sardinas, pechuga de pavo,
  tortilla de trigo, cereales, galletas María, chocolate 70% —, lubina, and 81 everyday Spanish
  foods added 2026-10-02: fish / seafood, meat / charcuterie, dairy, wholegrain carbs, veg, canned
  legumes, nuts, drinks, dishes / pastries) with average BEDCA values (kcal from the macros with EU
  factors 4/4/9, fibre 2, alcohol 7 — never BEDCA's own energy row; when two BEDCA entries of one food
  disagree, the one whose macros match its energy) or USDA FoodData Central ones (FDC energy, carbs = by
  difference − fibre) when BEDCA lacks the food, or, for branded drinks only (Coca-Cola, Aquarius, Cola
  Cao…), the label values of the product sold in Spain (Open Food Facts barcode in `note`);
  `verified: false` and the source id in `note`; prepared dishes say their values vary by recipe; the
  food log searches EVERY food of the file (see "Nutrition v2 part 2").
  Optional NATURAL-UNIT metadata per food (`lib/nutrition/units.mjs`, validated by
  `validateIngredientMeta` inside `npm run check`): `piece: { name: {es, en}, plural?: {es, en}, amt,
  g?, typical? }` — the food's natural piece, `amt` in the food's own unit (g / ml; a `ud` food's piece
  is its unit, amt 100, with `g` = its grams reference), `typical: true` = a typical weight (medium
  fruit, a tablespoon, an egg ~50 g), NOT a weighed label — a tablespoon's weight is PER FOOD (its own
  `piece.amt`: allioli / mayonesa 15 g; olive oil has NO piece, it is per 100 ml and logged in ml); and `weighed: raw | dry |
  cooked` (how the plan weighs it: meat raw, rice / pasta / oats dry, potato / legumes cooked).
  Optional `basic: false` (a boolean, validated by `validateIngredientCats`; default true) hides a food from the
  food log's basics search and recipe picker while keeping it in the DB for the plan and the portion guide. It is a
  per-user choice: set it on a food you log as one of your own products (Mis productos), so the add sheet does not
  list a generic duplicate. The sample sets it on 18 foods (confitura, jamón serrano, gambas,
  salpicón, tranchete, mozzarella, salsa de tomate, soja, allioli, mayonesa, pisto, chocolate 85%, helado,
  napolitana, palomitas, panecillo, patatas horno, tomate frito); `lib/nutrition/basics.mjs` bakes them with `h: 1`.
  Drinks with alcohol (`cerveza`, `cerveza1906`, `clara`) carry kcal above their macros (alcohol 7 kcal/g);
  `cerveza00tostada`'s macros are derived from its kcal (the source lists only kcal).
- `data/nutrition/plan-data.json` (GITIGNORED, **personal** plan) — the user's actual diet:
  `data`/`dayPlan`/`extras`/`quesoKeys`/`vegKeys`/`legumeKeys`/`legumePlate`/
  `page`. Each item's `recipe` (`[{ing, amt}]`) references ingredient keys from
  `ingredients.json`; macros are COMPUTED, never hand-typed. Items with no single label use a
  `manual` macro block (legumes, soup, pintxo) — kept verbatim.

`data/nutrition/generate.mjs` now only VALIDATES the merged plan and writes `plan-tables.md`
(the human-readable reference tables) — it emits no HTML. It fails with a clear
error if `ingredients.json` is missing.

**Fresh-clone bootstrap:** `ingredients.json` ships in the clone (tracked). Copy
`data/nutrition/plan-data.example.json` → `plan-data.json` and
`data/training/training-data.example.json` → `training-data.json` (edit both in your real
plan/program), then `npm ci && npm run generate`. The real `plan-data.json` /
`training-data.json` / `plan-tables.md` / `web/dist/personal/` stay gitignored (personal);
`ingredients.json` and the `.example` seeds are tracked. `npm run build:example` builds from
the tracked seeds plus the tracked synthetic demo extract in `data/demo/extract/` — no copying,
no personal files, useful to sanity-check the pipeline on a bare clone.

**To change a plan number, edit `plan-data.json` (servings/day plan) or `ingredients.json`
(a food's macros/label) — never the generated files.**

Run `npm run generate` (or `node data/nutrition/generate.mjs && node scripts/build-web.mjs`) to
regenerate (idempotent): validates the plan, writes `plan-tables.md` (incl. the Legumes and
Verified product labels tables), then builds `web/dist/personal/index.html`. **Never**
hand-edit `plan-tables.md`, `web/dist/`, or re-type macros in `food-log.md` — the source is
the two JSONs.
- `npm run check` — validators only, no build: `generate.mjs --check` (unknown-ingredient
  refs, day totals, Atwater, ambiguous matches) — the day-total kcal sanity band defaults to
  train 2000–2800 / rest 1700–2400 and a plan can override it with optional
  `validation.kcalBand = { train: [min, max], rest: [min, max] }` in `plan-data.json` — + `build-web.mjs --check` (training-data.json
  integrity). Ingredients defined in `ingredients.json` but unused by the current plan are a
  non-fatal WARNING (expected for a shared DB), not an error.
- `npm test` — the full test suite (`node --test`, zero deps beyond `astro`). `pretest`
  builds the example (+ personal, if present) fixtures the web/ tests read.

**Intake rings (in Resumen de hoy).** `lib/nutrition/intake.mjs` `intakeFrom(inputs, targets)` (over the build's
one `lib/extract/read.mjs` `readExtract`) bakes the
most recent LOGGED day of `dietary-daily.csv` (kcal > 0) plus the plan's train/rest base day totals (a fallback);
`web/src/client/intake.js` draws four rings (kcal, protein, carbs, fat) against THAT day's target
(`window.HCNutri.targetFor(date)` from client/nutri-day.js: today = `nutriTarget()`, the goal × day
type picked above; a past day = its own detected day type (timeline + programme, its recorded ride
minutes) × the current goal, never today's override; on bike days the MEALS target = day target −
ride fuel, with the fuel on its own line "+ X kcal en la bici"). A past day whose type cannot be
determined (no timeline row, no programmed session → `null`) renders NO rings — no honest target to
fill against. It falls back to the plan's training-day total when the hook is absent or throws. The rings show ONLY when that day is within the
last 3 days of the viewer's clock (decided client-side, so builds stay byte-identical); otherwise
the block renders NOTHING (host hidden, no help text). On the LAN page (`HCFood.ready()`) the food
log is the ONE source: today's log (`window.foodTotals`, see "Nutrition v2 part 2") when it has
entries, else the most recent food-log day in the same window (`HCFood.recentDay(INTAKE.freshDays)`:
one lazy `GET /food/log/summary` over the window, re-read after any add / delete or on a new day),
labelled by its date with that day's `targetFor`; nothing logged there → no rings, never the Apple
Health day; nor while today's log is not loaded (read failed / in flight: `HCFood.groupTotals()` null).
While the food API boot request is in flight (`HCFood.pending()`) the rings render NOTHING (no flash of
the Apple Health day); its answer → the food log, its failure → the Apple Health day, and past
`INTAKE.bootGraceMs` (`INTAKE_BOOT_GRACE_MS`, 2500 ms, baked) without an answer the Apple Health day
renders anyway (a fetch hanging in a sandboxed artifact) and a late answer still switches.
Resumen de hoy's kcal ring + macro rows follow the SAME wait (`window.intakeWaiting()`, owned by
intake.js, one grace timer): while waiting they show the empty track + "— / target"; answered → the food log
only (never the Apple Health day); failure / grace over → the Apple Health day. nutri-day.js is inlined
before the food scripts, so intake.js (inlined after them) re-renders Resumen de hoy (`HCNutri.refresh`)
at load and when the grace ends; consecutive inline scripts run before the first paint, so the Apple
Health day never flashes.
The bake keeps only `target.train` (the fallback without `HCNutri`).
Intake arrives from a food app that writes nutrition to Apple Health + the
Shortcut `diet_kcal`/`diet_protein`/`diet_carbs`/`diet_fat` keys, which sync folds into one
`dietary-daily.csv` row per day, export rows winning. A ring never fills from the target: a macro
missing on the logged day renders an empty ring with a dash. When the logged day is the viewer's
today it is labelled as in progress ("Hoy, en curso" / "Today, so far"), so partial rings are not
read as a finished day. When NO intake was ever logged (`INTAKE.latest` null, decided at build
time), Resumen de hoy renders no rings host and NO help line. The one-line hint that lived in the day
builder's fold summary ("No food logged: the intake rings appear once a food app writes to Apple
Health", `noneHtml`) was dropped on purpose with the builder: the ring and macro rows already show the
target with empty tracks, and on the LAN page the food log (Registrar, with its own empty state) is
the way to log; pointing at an Apple Health food app is no longer the recommended path.

## Nutrition v2 — goals, day types, portion scaling, ride fuelling, supplements

Part 1 of the Nutrición redesign: compute + display (food logging, the write endpoint and the
product catalogue are part 2, next section). The `dia` section (key kept for `page.hideTabs`) holds, top
to bottom: Resumen de hoy, Registrar (the food log, part 2), Plan de hoy and Avituallamiento — the
nutrition blocks all client-rendered by `web/src/client/nutri-day.js` from ONE bake, `NUTRI`
(`lib/nutrition/today.mjs` `buildNutriToday`, in `web/src/tabs/Dia.astro`, ~3.6 KB on the example) +
`I18N_NUTRI` (`web/src/i18n/nutri-templates.mjs`, es/en). The day-type radios are server-rendered
(labelled, ≥ 44 px) and are the only control in Resumen de hoy (the goal is set in the profile sheet); everything time-based is decided on the viewer's clock,
so builds stay byte-identical. Each block renders in its own try/catch (a one-line message on failure).

- **Day types (4) and goals (3)** — `lib/nutrition/targets.mjs`: `rest`, `gym` (a gym or run session,
  ~1 h), `bike` (a ride ~2 h), `bikeLong` (> 2.5 h); `maintain`, `cut`, `bulk`. Plan schema (all
  optional, validated by `validateTargets` inside `validateNutrition`): `targets.byGoal[goal][dayType]
  = { kcal, p, f }`; carbs are the REMAINDER ((kcal − 4p − 9f) / 4, never typed; a cell whose protein
  + fat exceed kcal is an error). A missing cell falls back to `DEFAULT_BY_GOAL`, a generic EXAMPLE seed
  for new users (a 70 kg reference adult per `analysis/methodology.md` §2: maintain 2300 / 2700 / 3100 /
  3600 kcal with 125 P / 65 F; cut 1950 / 2350 / 3100 / 3600 with 140 / 55, ≈ −15 % on rest and gym,
  ride days kept fuelled; bulk 2600 / 3000 / 3400 / 3900 with 125 / 70, +300 kcal — rest / gym / bike /
  bikeLong; the example plan copies it), so an old plan keeps working. Your own `plan-data.json`
  `targets.byGoal` overrides it cell by cell; set all twelve cells once you know your TDEE. Default goal = `page.goal` (else maintain).
  **Computed starting targets** (`lib/nutrition/energy.mjs`, for the in-page onboarding): Mifflin-St Jeor
  BMR × NEAT (`sedentary` 1.2 / `light` 1.3 / `active` 1.4) + the net exercise of each day type
  ((MET − 1) × kg × h: gym 6 × 1 h, ride 7 × 2 h, long ride 7 × 3.5 h); cut −15 % except the long ride,
  bulk +10 %, kcal to the nearest 50; protein 2.0 g/kg cut / 1.8 otherwise, fat 0.8 g/kg; floors 1500 kcal
  (men) / 1200 (women). `screenPerson` withholds numbers under 18 or in pregnancy / lactation, offers only
  maintenance on an illness / medication or eating-risk answer, drops the cut under BMI 18.5;
  `checkTargetWeight` refuses a target BMI < 18.5; `checkTargets` bounds an edited cell (errors: floor,
  deficit > 20 %, surplus > 15 %, > 1 % body weight / week, protein outside 1.2–2.4 g/kg, fat < 0.5 g/kg;
  warnings: protein outside 1.6–2.2, fat > 1.0, carbs outside rest 3–5 / gym 5–7 / bike 6–10 / long
  8–12 g/kg where energy is not cut on purpose). Output has the `targets.byGoal` shape. A ±10 % estimate:
  recalibrate with the 7-day weight trend after 2–3 weeks. **Precedence:** the in-page onboarding's accepted
  targets (`data/profile/onboarding.json`, when they pass `checkTargets`) > the plan's `targets.byGoal` >
  `DEFAULT_BY_GOAL` (`lib/load/inputs.mjs`; docs/profile.md). `targets.train` / `targets.rest`
  are read by nothing. Likewise
  `extrasDisplay`, `indulgeKeys`, `alcoholKeys`, `mealReplaceKeys` and `page.notes['registro.*']` /
  `page.offPlanPlaceholder` are IGNORED legacy keys: accepted, never an error, and `npm run check`
  warns about each (`LEGACY_PLAN_KEYS` in `macros.mjs`; safe to delete from a plan).
- **Portion scaling** — `lib/nutrition/scale.mjs`: plans keep their two base days; `BASE_DAY` maps
  rest → `dayPlan.rest`, gym / bike / bikeLong → `dayPlan.train`. CARB-FLEX parts (`lib/nutrition/flex.mjs`
  `isFlexPart`) scale, every other part stays fixed: `flex: null` opts a part OUT; an explicit
  `flex: "carb"` opts it IN (also a manual block, scaled whole); otherwise by FOOD CATEGORY — an `{ing}`
  part whose food is carb / fruit, or a sweet carb staple (honey, jam: ≥ 60 % kcal from carbs; never
  chocolate, ice cream, pastries) (`autoFlexIng`), and a `{use, match}` item whose recipe lines are ALL
  such foods (a mixed composite, a manual block or a food without category stays fixed). Spreading the
  carbs over every carb / fruit part — not just the 2–3 marked ones — is what stops one plate absorbing
  the day (e.g. a large dry-pasta portion on a maintain gym day). **Portion caps**: an ingredient may
  carry `maxAmt` (optional, `data/nutrition/ingredients.json`, in the same scale as a recipe `amt`: g /
  ml, or `UD_AMT` per unit), baked on the model line (`LINE.CAP`, `lineCap` / `capFactor` /
  `capAmount` in `lib/nutrition/amounts.mjs`) and validated by `npm run check` (`validateIngredientCaps`:
  a finite positive number, at least one rounding step — a unit, half a piece, 5 g — and at most
  `MAX_AMT_LIMIT` 2000). Tracked caps: rice / pasta (dry) 150 g, oats 100 g, potato / sweet potato 400 g,
  gnocchi / oven chips / pre-fried sweet potato 300 g, bread roll 135 g (3 rolls), seeded bread 125 g
  (3 slices), honey / jam 30 g, fruit ~1.5–2 pieces (banana 240, apple 270, orange 260, pear 255, peach
  300, nectarine 280, flat peach 200, kiwi 150, plum 130; pineapple 250, watermelon 400, melon 350,
  grapes 200, strawberries 250, blueberries 150 g); a test requires a cap on every carb / fruit food and
  sweet staple. The base day's macros come from the existing engine
  (ingredients.json, never hand-typed) and are baked as a compact SCALING MODEL per base day
  (`planModel`: per meal the fixed macros, the flex parts' lines `[unit, amt, k, p, c, g]` or a manual
  block). `solveScale` = WATER-FILLING (`waterFill`, `lib/nutrition/fill.mjs`, `{clamp: [SCALE_MIN, SCALE_MAX], start: 1}`): one common factor for every carb-flex line so the
  meals hit (target − ride fuel), clamped to `SCALE_MIN`–`SCALE_MAX` (0.6–2.0×); a line that would
  pass its cap is HELD at the cap and the factor is re-solved over the lines still free, until stable (a
  cap beats `SCALE_MIN`: a written amount above its cap shrinks to it); rounded to 2 decimals and
  labelled with 2 decimals ("×1.45"); with every line held the factor is the largest cap reached.
  `capped` = some line is at its cap, `allCapped` = every flex line is (and no manual block, which has
  no cap). DISCRETE lines — whole units (`ud`, whole units) and countable g / ml foods (an
  ingredient with a `piece`, rounded to HALF pieces — `PIECE_GRID` in `lib/nutrition/units.mjs`, one
  unit = `UD_AMT` (100), both baked as `NUTRI.scale.grid` / `.ud`; the model line carries `[…, step,
  ingredient key]`, `lib/nutrition/amounts.mjs` `modelLine` / `stepAmount`; its layout is named ONCE as
  `LINE` with accessors `lineUnit` / `lineAmt` / `lineMac` / `lineStep` / `lineKey` / `pieceOf(pieces, l)` /
  `scaleLine`, mirrored in nutri-day.js — never read by a bare index) — round first at that factor, then the factor is
  RE-SOLVED (water-filling again) on the remaining g / ml parts so the day still lands within tolerance; a
  rounded amount never passes its cap (`capAmount` steps DOWN on the line's grid); with only `ud` parts flexible the
  remainder is reported honestly (plus a one-line note). Amounts round to 5 g / 5 ml (never below one
  step; a `manual` block scales as a whole and shows "×1.30") and the totals are recomputed from the
  ROUNDED amounts. The rest is `rem` (target − ride fuel − meals, kcal): plan-tables.md lists it per
  (goal, day type); Plan de hoy's portion guide hands it to Extras (with caps the example plan's plates
  cannot reach most goal × day types, so its Extras budgets are large). Protein and fat are
  NOT scaled (the guide's Extras takes what the main meals leave of them; `MACRO_TOLERANCE_G` (15 g) only
  feeds the rings' `fatMax`). `planFor(bake, goal,
  dayType, minutes)` gives one plan for a ride of `minutes` (meals target `mt` = target − ride fuel,
  the fuel being all carbs); the page bakes only `{base, t}` per (goal, day type) + the two models and
  runs `solveScale` / `planFor` themselves (`HC_SCALE`, emitted by `lib/nutrition/client.mjs` with what they call
  from `amounts.mjs`, `units.mjs`, `fill.mjs`, `fuel.mjs`; no copy), so a new ride duration re-scales
  the guide's budgets. `planFor` returns `{base, t, minutes, fuelK, fuelC, mt, meals (each plan meal's
  [k, p, c, g], whole), tot, factor, clamp, udOnly, capped, allCapped, rem}`; the bake per base day is
  `{sl (each meal's slot), fixed, flex}`. `buildDayPlans` precomputes the 12 plans at the default ride minutes for the table in
  `plan-tables.md` ("Daily targets by goal and day type": kcal, P, F, C, meals kcal, ride fuel, carb
  factor, remainder). `planModel` names parts (`label`,
  else the ingredient's `name`, else its key) and `solveScale` formats the scaled amounts (`q`); a
  countable food shows pieces with the grams reference (`fmtPieces`: "1½ medium bananas (~180 g)" on the
  half-piece grid, "~2 bread rolls (80 g)" off it; "2 eggs (~100 g)"); `fmt.pieces` bakes only the
  pieces a baked flex line can format.
- **Plan de hoy = a PORTION GUIDE** (an orientative "how much can I eat", not a menu) —
  `lib/nutrition/guide.mjs` = the ONE implementation, run by nutri-day.js as `HC_GUIDE` (emitted by
  `lib/nutrition/client.mjs`; `GUIDE_CASES` / `DAYCAP_CASES` test it in the lib, the page and the built page). ALWAYS
  the same four meal groups, every day type: Desayuno, Comida, Cena + Extras; day type and goal only change
  the amounts. **Budgets**: today's plan solve (`planFor`: goal × day type × ride minutes, caps and
  water-fill, no picks) → each main meal's budget (kcal, P, C, F) = the solved macros of the plan meals
  of its slot (`mealSlot` via the baked `base[day].sl`; two meals of one slot add up, a slot with no meal
  is a zero budget); a COOKING-OIL meal (no slot, every part a `fat`-category food: `oilMeals`, baked
  per base day as `NUTRI.guide.oil`) is split evenly between the lunch and dinner budgets (lunch takes
  the rounded half; wholly into the one the plan has; Extras if neither), so oil logged with lunch does
  not drain that meal early; **Extras** = the MEALS target (target − ride fuel) − the three main budgets,
  so it absorbs the add-ons (pre / post workout, a protein anchor, any other unslotted meal such as an
  after-lunch coffee) and whatever the capped plates leave over (`guideBudgets`; a macro the main meals already pass clamps at
  0 and the card says so, never negative). The four meal groups add up to the meals target, which is also the
  fold summary's kcal. **A main meal = a plate by parts**: Proteína ~X g (= meal P), Carbohidrato ~Y g
  (carbs), Verdura "libre", Grasa ~Z g (fat); each macro row = ONE example food (a native `<select
  class="gd-pick sel">`, the shared select pill (docs/design-system.md → Select), ≥ 44 px, aria-label "Ejemplo de Proteína para Comida"; `style="--pick:N"` = the chosen food's name length, so the CSS asks for that width, capped at the row, and a long amount ("2½ bread rolls (~112.5 g)") wraps under the select, right-aligned, instead of cutting the name) + the amount of that food
  that supplies the macro (`exampleAmount`: grams ÷ the food's macro per 100 of its amount scale, in its
  natural unit — pieces with the grams reference for a countable food (`fmtPieces`), whole units, a
  tablespoon for a sauce with that piece, else g / ml (olive oil in ml) on the 5 g grid —, never past its `maxAmt`: then "~150 g (máx.)" + "+
  completa con otra fuente"). Options = every basic of the role's categories (`roleOptions`; protein:
  protein; carbs: carb + legume + fruit; fat: fat — log-only `swap: false` basics included) from
  FOOD_BASICS (the ONE food table, baked for the food log; each entry now carries `c` = category and `x`
  = portion cap), plus the user's products from the food API when it answered (view time only,
  `<optgroup>` "Mis productos"), sorted by the folded name. Default example = the food the base plan uses
  for that role in that meal (`mealDefaults`: the role-category recipe line that supplies most of that
  macro, baked per base day as `NUTRI.guide.defaults`), else `GUIDE_FALLBACK` (pollo / arroz / aceite de
  oliva). A pick persists per viewer, not daily (`hc.nutri.guide` = `{picks: {<slot>.<role>: 'b:<key>' |
  'p:<id>'}}`, every access wrapped; an unlisted pick — a product without the API — shows the default and
  stays stored; the orphaned `hc.nutri.picks` of the removed choosable blocks is cleared on load). Each example covers ITS macro only (a muted note says so: the guide is orientative).
  **Extras card**: "~N kcal para extras hoy", a muted "Incluye café, tentempiés y pre/post-entreno"
  line, a muted hint with example costs computed from the food DB
  (`EXTRAS_EXAMPLES` → `NUTRI.guide.extras`: un plátano ~106, un yogur ~79, un batido de proteína (30 g)
  ~114 kcal), "Repártelo antes y después de entrenar" on gym / bike day types, its P / C / G line; no item
  list, no selects. **Live link with Registrar** (LAN page, `window.HCFood.groupTotals()` = today's
  sums per group `{meals: {breakfast, lunch, dinner}, addon}`, null without the API): a main meal shows
  "✓ N kcal registradas" at ≥ 90 % of its kcal budget (`DONE_SHARE`), "en curso: N kcal" when partial;
  each macro row shows what is LEFT (budget − logged, floor 0, "de 45 g" once something is logged) and
  recomputes the example amount for it; a row with ≤ 10 % left (`COVERED_SHARE`) is "✓ cubierto"; Extras
  = budget − logged add-ons ("(de N)"); "Te queda hoy: kcal · P · C · G" (meals target − everything
  logged, `dayRemaining`) under the guide. **Day cap**: a row's left = min(the meal's own left, what
  the day still allows = "Te queda hoy", `capByDay`), and the example amount and the "+" use that capped
  left, so overspending one meal is taken from the others; when the DAY has ≤ 10 % of that macro's
  meals target left the row is "✓ cubierto (día)" (no example amount, no "+"; a row covered by its own
  meal keeps "✓ cubierto"). Extras' remaining kcal and P / C / G line are capped the same way, and it
  reads "✓ cubierto (día)" when the day's kcal are covered. Each open macro row gets a "+" (`.gd-add`, 44 px, aria-label "Registrar
  195 g de Pechuga de pollo en Comida") that logs that example amount into that meal through
  `HCFood.addGuide` (a basic = ONE quick entry with `basicEntry` / `basicLabel`, in pieces when the food
  has them, sent with `force` since the macros are the DB's own; a product = a product entry; one request
  id per pending add, kept across an ambiguous retry). The guide re-renders on every add / delete (the food scripts
  calls `HCNutri.refresh()`) and on goal / day type / ride changes; without the API: budgets only, no
  "+", no "Te queda". `NUTRI` = `{…, base: {<day>: {sl, fixed, flex}}, guide: {roles, defaults, oil,
  fallback, extras, done, covered}}`: a few KB on the example (budget: `lib/nutrition/today.test.mjs`,
  8 KB); FOOD_BASICS carries `c` and `x` (budget: `web/test/food-build.test.mjs`).
- **Day-type detection** (`lib/nutrition/daytype.mjs` = the ONE implementation: `lib/nutrition/client.mjs` emits it as
  `HC_DAYTYPE` (from the module's `CLIENT` descriptor), which nutri-day.js runs — no copy; `DAYTYPE_CASES` / `DAYINPUT_CASES` test it in the lib, the
  page and the built page): today's workouts from `SCORES.timeline`
  (same-day rows already merged per modality). Only real training counts (`DETECT`): gym / run ≥ 20 min
  → gym (shorter = a stub); `other` (walks, tennis…) only ≥ 45 min, as gym; a ride < 30 min is a commute
  (ignored), 30–74 min → gym, ≥ 75 min → bike, ≥ 150 min → bikeLong; a zero / junk duration is dropped.
  Then the programmed session in `TRAINING[today]` (`kind: "bike"` by optional `durationMin` with the
  same ride thresholds, absent = bike; any other kind → gym); else rest. Per person, the in-page
  onboarding's `sports` add endurance modalities (`enduranceOf`: running → `run`, swimming → `other`),
  baked as `NUTRI.detect.endurance` only when there are some: a session of those modalities, done or
  programmed with `durationMin`, of ≥ 75 min is a bike day and ≥ 150 min a bikeLong day like a ride (its
  minutes travel as `rideMin`, so fuelling follows); shorter ones keep their rule. The MOST
  DEMANDING of done and programmed wins (a gym morning with a long ride programmed → bikeLong; a tie
  goes to what was done, whose ride minutes are real). `training-data.json` accepts `kind: "bike"` +
  `durationMin` for this. The manual override and the goal are kept in localStorage (`hc.nutri.goal`,
  `hc.nutri.dayType` = `{date, type, auto}`, so the override expires the next day), every access
  wrapped; the label says "(auto)" / "(elegido)", with a "use the detected one" button. An override
  LESS demanding than a type detected later that day (`auto` rose since it was picked: picked gym,
  then a long ride synced) is dropped on load with a one-line note ("Detectada salida larga: cambiado
  a Bici larga"); a more demanding one (planning a ride) or a deliberate downgrade stays. Today's
  target is the ONE source for Nutrición: `window.nutriTarget()` = the MEALS target (`k, p, c, g`,
  `fatMax` = fat + 15 g, `fuelK`, `day` = base day train / rest, label) feeds the intake rings
  (`HCNutri.targetFor(date)` = the same shape for an earlier logged day, labelled "Objetivo / Comidas de
  ese día", or `null` when its day type is unknown; a day beyond the 3 baked timeline days detects its
  type from `DETAIL.sessions` — `daytype.mjs` `dayInputFor`, see "Nutrition v2 part 3"), and
  every goal / day type / ride change calls `window.intakeRefresh()` directly (a failure shows a
  one-line message, never a stale ring).
- **Nutrición header** — the tab opens like Salud / Entreno: a centred uppercase title ("NUTRICIÓN")
  with an ⓘ (`#nu-intro`, `I18N_NUTRI.head`) holding the tab intro and the shared caveats; it sits in
  `web/src/tabs/Dia.astro` outside the `dia` section, so it stays when only Tablas is shown. Every
  section header below is the shared `.hs-head` row (the sentence-case section heading `.hs-lbl` + optional ⓘ, `health.css`).
- **Resumen de hoy** — the day type as compact pills (real radios, short labels `dayShort`: Descanso ·
  Gym · Bici · Bici larga, `.chip` pills (design-system.md → Components), the picked one white-filled; text only at every width
  (2026-10-09: with icons the four pills need ~370 px and wrap to two rows at 360–390 px, so the
  1440 px-only icons were dropped rather than shown at one width and not the other); the full `dayTypes` names stay for sentences
  and the pill title; the DETECTED type's pill gets `.seg-auto`, a small dot; a person with onboarding `sports`
  gets `web/src/i18n/day-labels.mjs`: pills only for the day types their week has (`shownDayTypes`), each named after
  its sports, most frequent first, two names then "+N", with the usual length in the full name ("Correr ~1,5 h"),
  and sport-neutral `sportText` wording for the auto-switch note, the ride line and the fuelling labels; without
  sports the dictionary is untouched), then the kcal ring in the
  Inicio dial language (`.nt-ring` around the shared `.dial-ring` / `.dial-svg` / `.dial-track` /
  `.dial-fill` / `.dial-num`: the full ring of `view/dial.mjs` `arcPath(0, 1)` baked as `NUTRI_ARC`,
  12 o'clock, clockwise, round caps, thin stroke). Inside: the kcal EATEN today in `--num` (a dash
  with no intake) over a small "/ target kcal". ONE state colour: none = the `--track` only, ok =
  eaten ≤ 110 % of the target (`--up`), over = past it (`--down`, the ring full). Then three compact
  macro rows (Protein / Carbs / Fat: UPPERCASE label, "eaten / target g" in `--num`, a thin bar; > 110 %
  `--down`, a missing macro = a dash and an empty bar). Ring and rows fill ONLY from intake logged on
  the viewer's today (`INTAKE.latest` dated today; today's page food log, `window.foodTotals`, wins over
  `INTAKE` when it has entries, a macro some entries lack is a minimum "≥"). Where that intake comes
  from, the "half-logged day looks short" caveat and "carbs are the rest of the kcal" sit behind the
  section's ⓘ (`#nutri-sum-info`, written by `client/nutri-day.js` on every render). The goal is a
  muted chip under the ring (a ≥ 44 px button, `#nutri-goal-chip`) that opens the profile sheet
  focused on its Objetivo setting (`HCDetail.open('profile', null, { focus: '#pf-goal input:checked' })`),
  then on bike days the plan line ("meals + ride fuel = total", meals = the guide's meals target; the
  guide's Extras absorbs the remainder), then the intake rings — which step aside (host hidden) when
  the logged day is today, since the ring shows it. Inicio's "today you eat" card (`#eat-body`) shows
  the same day type, goal and target.
- **Balance** (moved from Salud's Energía) — `client/health.js` `renderBalance` renders
  `HEALTH.energy` (lib/health/aggregate.mjs `aggEnergy`) into `#nutri-balance`, after Avituallamiento
  and before Progreso: a `.hs-head` "BALANCE" with an ⓘ (the balance note: window, days, "historical",
  the macro clause), the window as a caption ("31 May – 29 Jun · 30 days logged" — ONE fixed window:
  the bake carries a single paired window of up to 90 days anchored to the newest expenditure day, so
  there is no W / M / 6M switch), three shared metric rows (`HC.metricRow`: avg intake, avg burn — opens
  the expenditure sheet —, deficit / surplus a day), then the average macro split as one stacked bar +
  counted legend (Entreno's `.act-bar` / `.act-legend`, `.nb-m-p` / `-c` / `-f` = `--up` / `--strain` /
  `--mid`; widths normalised so rounded percentages leave no gap). Too few logged days → a short empty
  line, "intake can't be scored" (with the last logged day) behind the ⓘ; no expenditure at all → the
  host stays hidden. Same data and numbers as the former Salud cards; Salud keeps the expenditure row.
- **Plan de hoy — layout** — flat `--surface` cards (no border, no shadow): meal name as a caps label, its kcal
  budget big in `--num`, the macro rows (caps label left, "~45 g" in `--num` right; the example select
  below with the amount and the "+"; a long amount wraps under the select at 360 px, right-aligned), the
  muted P / C / F (es: G) mini line. Wide screens (>= 900 px) keep the single column (no multi-column
  flow). The block is a native
  `<details class="nutri-block sec-fold nutri-fold" id="nutri-plan-fold">`, COLLAPSED by default: the
  summary (a flat `--surface` row like every Nutrición fold — Mis productos, Mis recetas, Tablas:
  UPPERCASE label, optional figure, chevron; `layout.css`) = the heading + the meals target (`#nutri-plan-kcal`, written on every refresh); the open
  state is a per-viewer convenience (`hc.nutri.planOpen` '1' / '0', every access wrapped, saved on
  `toggle`); the guide renders while collapsed. Avituallamiento stays after it, never collapsed, under the shared `.hs-head` label. Styles:
  `.gd-*` in `web/src/styles/nutri.css` (tokens only: `--good` = covered / done, `--mid` = a portion at its
  maximum, `--accent` = the "+").
- **Supplements** — optional `supplements: [{ name, dose?, meal }]` in `profile/profile.json`
  (`meal` = breakfast | lunch | preworkout | postworkout | dinner | snack, `lib/nutrition/slots.mjs`
  `MEAL_SLOTS`; validated by `validateManual`). A discreet "name dose" line (no macros; a small pill SVG
  icon, no emoji) under the guide's card of that slot: breakfast / lunch / dinner in their card, every
  other slot in the Extras card with its slot name ("Electrolitos (Pre-entreno)"). A plan meal's slot =
  its own `slot` field, else guessed from its es / en name (`mealSlot`: desayuno / breakfast, comida /
  lunch, pre / post-entreno / workout, cena / dinner, merienda / snack / anclaje). They are also listed
  in the profile sheet.
- **Avituallamiento** (bike day types only; `lib/nutrition/fuel.mjs` = the ONE implementation, run by
  nutri-day.js as `HC_FUEL` (emitted by `lib/nutrition/client.mjs`), pinned by `FUEL_CASES`): Antes (2–3 h before ~1–2 g/kg carbs; last hour
  30–60 g easy carbs), Durante (bike 60 g/h, bikeLong 60–90 g/h; fluids 500–750 ml/h; sodium ~300–600
  mg/h, more in heat — ranges, no weather data), Después (within 1 h ~1–1.2 g/kg carbs + 30–40 g
  protein). g/kg uses the latest weigh-in (`profile.weight`, else rates only). Duration = today's
  recorded ride, else a picker (1–6 h, default 2 h / 3.5 h); carbs in practical units (gel ~25 g,
  banana ~25 g, bar ~40 g, a 500 ml bottle at 6–8 % ≈ 30–40 g) and a mix idea (a bottle per hour +
  gels). The on-bike carbs count inside the day total (plan point = the range midpoint × hours), so
  the duration also re-scales the meals. A recorded ride uses its real minutes (shown, not pickable);
  a picked duration is kept per date and day type (`hc.nutri.rideMin` = `{date, type, min}`, expires
  the next day). Rendered as a 3-step timeline (Antes → Durante → Después, `.fuel-steps`) with one key
  number per step in `--num` (carbs before, g/h during, carbs after). It says it is orientative, not
  medical advice.
  **Own fuel items** (optional plan field `fuel.items: [{ name: {es, en} | string, carbs: <g per
  piece, 0–100>, fat?: <g ≥ 0>, kind?: "fast" | "slow" }]`, validated by `npm run check`
  (`validateFuelItems`, called from `validateNutrition`: a malformed item is an error naming the field),
  baked localized as `NUTRI.fuel.items = [{n, c, f, k}]` only when present — absent = the generic
  output): Durante then shows the PIECE MIX (`fuel.mjs` `ownDuring`, run in the page through `HC_FUEL`, pinned by
  `FUEL_CASES`): eating starts at min 30 (`OWN_START_MIN`; the first half hour runs on the carbs eaten
  before), pieces target = the during-rate midpoint × (minutes − 30) / 60; n whole pieces spread evenly
  from min 30, a piece before half the ride = the first `slow` item, from half way the first `fast` one
  (fallback: an item without kind, then the first); n (at most one piece per 10 min) = the total closest
  to that target, never above the during range top; the line names the total, a "~X g more from a drink
  or a banana" gap to the plan point (the day accounting is unchanged) and the 6–8 % bottle as the
  alternative (the generic gel / bar equivalents and the bottles + gels mix are not shown then). Antes'
  last hour names k fast pieces inside 30–60 g, closest to 45 g. Personal items live only in the
  gitignored plan-data.json; the example plan has none (tests use synthetic items).
- **Tablas = fixed reference values** — `lib/nutrition/reference.mjs` `buildReference(nut, {lang,
  words})`, server-rendered by `web/src/tabs/Tablas.astro` through `components/RefTable.astro` (no
  bake, no client script: `client/tablas.js`, `BreakfastTable.astro` and the DATA / EXTRAS /
  QUESO_KEYS / VEG_KEYS / FRUIT_SUMMARY / I18N_TABLAS globals are gone). Same sections / lists, NO
  portions: each food per its NATURAL unit (`refUnit`): a piece with its grams reference ("1 medium
  banana (~120 g)", a typical weight tagged "typical weight"), a tablespoon sauce per tablespoon, else "100 g" /
  "100 ml" (olive oil: "100 ml") + how it is weighed ("100 g dry", "100 g raw"); a composite option = a group row + one row
  per component food; a `manual` option = "1 serving (<its q>)". A list section with no rows (a plan whose list holds only the "none" option) is not
  rendered at all (no empty accordion). A carb list's train / rest tiers
  collapse to ONE table (no train / rest portion columns); same-named options collapse only when their
  reference rows are equal (the same food at another amount), otherwise both rows show (`listRows`). A one-line note at the top says today's
  amounts are in Plan de hoy; the generic notes (dict `tablas.*`) and the example plan's
  `page.notes['tablas.*']` do not talk about portions. plan-tables.md (generate.mjs) keeps "Daily
  targets by goal and day type" and writes the same reference rows ("Food reference (fixed values per
  natural unit)"; legumes per 100 g cooked instead of a ~300 g plate).
- **Old plans** — a plan without `targets.byGoal` / `page.goal` falls back to the code defaults
  (`DEFAULT_BY_GOAL`, goal `maintain`; `lib/nutrition/targets.mjs`), and which parts scale is decided by
  food category, so no migration is needed.

**Viewing the plan.** After a plan change: (1) edit the JSON → (2) run `npm run generate` → (3) open
`web/dist/personal/index.html`, or let the LAN page pick it up ([`lan-services.md`](lan-services.md)).
The build output is a single CSP-safe file (no external refs, no `<script type="module">` — every
script is `is:inline`), so a static copy works anywhere.
