# Nutrition — food log, products, recipes, settings

The LAN-only food log and its API, products, recipes, the export, plus the server-side goal, Progress, Consistency and the nutrition score. Plan pipeline and portion guide: `docs/nutrition.md`.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

**On this page:** [Food log & entries](#food-log--entries) · [Basics](#basics-quick-entries) ·
[Storage and API](#storage-and-api) · [Open Food Facts](#open-food-facts) · [Security](#security) ·
[The Log food block](#the-log-food-block) · [Add sheet](#add-sheet) · [My products](#my-products) ·
[My recipes](#my-recipes) · [Forms: numbers and errors](#forms-numbers-and-errors) · [Wiring](#wiring) ·
[Retries](#retries) · [Food log export](#food-log-export) · [Settings](#settings-goal-target-weight) ·
[Progress](#progress) · [Consistency](#consistency) · [Nutrition score](#nutrition-score) ·
[Rollout](#rollout)

## Food log & entries

You log what you eat from the LAN page (`services/loop-web`), with your usual supermarket products and your
own recipes; Today's summary fills from that log. Honest data: macros come only from product labels / Open
Food Facts values you confirmed, recipes are computed, unknown macros stay unknown.

### The formula (`lib/nutrition/foodlog.mjs`)

The ONE reference: constants `FOOD_STORES` (mercadona / dia / eroski / other), `FOOD_UNITS` (g / ml),
`ENTRY_UNITS` (+ serving), `FOOD_MEALS` = `slots.mjs` `MEAL_SLOTS`, `RECIPE_KINDS`, `REF_TYPES`; functions
`productEntry`, `recipeBasis`, `recipeEntry`, `entryFromBasis`, `dayTotals`, `atwaterOk`; `FOOD_LIMITS` =
the shared input limits (name / brand / query caps, the barcode pattern, per-100 kcal 900 / macros 100,
entry amount 5000…), baked for the page as `FOOD_CONST.limits` and generated into the service's
food-calc.js.

- **Product entry** = per-100 × amount in the product's own unit, or servings × its `servingSize` (no
  serving size → no serving; never g ↔ ml).
- **Recipe** = the sum of its ingredients (amounts in each product's unit; a basic snapshot per 100 g / ml
  or per unit, see [Recipe basics](#recipe-basics)): kind `serving` ÷ servings, kind `batch` × 100 ÷ total
  COOKED weight (per 100 g cooked). A missing product = incomplete, not loggable.
- Entries round once (kcal whole, macros 1 decimal); day totals sum the rounded snapshots. A macro unknown
  on any entry is flagged in `missing` (the sum is then a minimum).
- **Atwater**: 4p + 4c + 9f within ±25 % of kcal or 10 kcal.

### One formula, three runners

- **Page** — `lib/nutrition/client.mjs` emits the functions (the module's `CLIENT` descriptor) as
  `HC_FOODLOG` (inlined with HC_FMT before util.js, + `num.mjs` `fin` / `roundEps`), read by
  `web/src/client/food-core.js` (`window.HCFood`, no copy). The add sheet's preview uses the same
  functions: a recipe whose products are all listed uses `recipeBasis`, one with an archived product the
  server's computed basis on the recipe row, both through `entryFromBasis` — no fourth copy.
- **Service** — a GENERATED copy, `services/loop-ingest/src/food-calc.js` (built from its own directory, so
  it cannot import `lib/`): `scripts/gen-food-calc.mjs` writes it from the module's `SERVER` descriptor (the
  enums, `FOOD_LIMITS`, the functions' own source + `fin` / `roundEps`, emitted by `lib/build/esm-module.mjs`,
  which deep-freezes every frozen constant with a nested `Object.freeze(…)` per array / object level; no
  basics). The write / `--check` step, shared with `scripts/gen-journal-calc.mjs`, is
  `scripts/lib/generated.mjs`. The running service picks a change up on its next image rebuild.
- **A formula change is made in the lib first, then `npm run gen:food-calc`**: `scripts/gen-food-calc.test.mjs`
  fails while the committed file differs from a regeneration; `lib/nutrition/foodlog.test.mjs`,
  `web/src/client/food.test.mjs` and `web/test/client-globals-build.test.mjs` (the built page) run the lib,
  the committed food-calc.js and the page over `FOODLOG_CASES` (with `SUMMARY_CASES` and `BASIC_CASES`, in the
  test-only `lib/nutrition/foodlog.cases.mjs`).

## Basics (quick entries)

Generic foods, no product needed: `basicModes` / `basicAmount` / `basicEntry` / `basicLabel` /
`basicConvert` in `foodlog.mjs`, over ONE baked basic `{k, n, u: g | ml | ud, m: [kcal, p, c, f] per 100 of
u (a `ud` food: per unit), pc?: {a, r, o, m}, v?: 1 = a verified label}`.

- `lib/nutrition/basics.mjs` `buildBasics(ING, lang)`: every food of ingredients.json with all four macros,
  localized, sorted by the accent-insensitive name in code-unit order; `normName` = the search's
  normalization. Baked as `FOOD_BASICS` by `Dia.astro`, each food with its category `c` and portion cap `x`
  (read by the portion guide; size budget in `web/test/food-build.test.mjs`).
- Modes: `piece` (a countable food, or a `ud` food) or the food's own unit; a `ud` food also in `g` when its
  piece states grams; never g ↔ ml.
- Label = "<name> · <amount> ud (~<g> g)" for pieces, "<name> · <amount> <g|ml>" otherwise (es "ud", en
  "pc", decimal comma in es), capped at `nameMax`.
- ONE implementation, run by food-core.js through `HC_FOODLOG` (`BASIC_CASES` / `runBasicCase` pin its bytes
  in the lib, the page and the built page). The server never computes a quick entry, so food-calc.js has
  none.
- A HIDDEN basic (`h: 1`, from `basic: false` in `ingredients.json`: a food you log as your own product,
  e.g. allioli, jamón serrano, tomate frito) never lists in the add sheet nor the recipe picker
  (`basicMatches` skips it), but stays in FOOD_BASICS so the portion guide still uses it as a category
  example and `findBasic` still resolves an old entry or a guide "+".

## Storage and API

`services/loop-ingest`, `sql/006_food.sql` (idempotent):

| Table | Columns |
| --- | --- |
| `food_product` | per-100 kcal / protein / carbs / fat, store, unit g / ml, serving size?, serving_default (log by serving by default, `sql/014`; only with a serving size), barcode? (unique among ACTIVE products), source off / label / manual, off_code?, archived |
| `food_recipe` | kind, servings XOR cooked_weight_g, ingredients JSONB `[{productId, amount} \| {basic, name, unit, amount, per100}]`, archived |
| `food_log` | the user's LOCAL date sent by the page, meal slot, ref_type product / recipe / quick, ref_id?, label, amount + unit, SNAPSHOT kcal / protein / carbs / fat taken at log time (a later product edit never rewrites history; macros NULL only on a quick entry that did not state them) |

Routes (`src/food.js`):

| Route | Does |
| --- | --- |
| `GET/POST /food/products`, `PUT/DELETE /food/products/:id` | products (DELETE = archive) |
| `GET/POST /food/recipes`, `PUT/DELETE /food/recipes/:id` | recipes (+ computed `perServing` / `per100`) |
| `GET /food/log?date=` | entries + `dayTotals` |
| `POST /food/log` | the entry + the day's totals |
| `DELETE /food/log/:id` | delete an entry |
| `GET /food/log/summary?from&to` | per-day summaries (see [Consistency](#consistency)) |
| `GET /food/off?barcode=<8–14 digits>\|q=<text>` | Open Food Facts lookup |
| `GET/PUT /food/settings` | see [Settings](#settings-goal-target-weight) |

- Strict hand-written validation: unknown keys refused, trimmed + capped strings, per-100 kcal ≤ 900 and
  macros ≤ 100 g, amounts ≤ 5000, dates round-trip (any valid date 2000–2100), recipe macros never accepted
  from the client; `400 atwater` unless `force: true` (the page offers "save anyway"). A log entry whose computed
  snapshot would not fit its columns (kcal > 999 999.9 or a macro > 99 999.9, e.g. many servings of a product
  with a large serving size) is `400 invalid` on `amount`, never a database overflow.
- Errors are coarse `{error, field?}` codes, never DB text: `invalid`, `atwater`, `barcode_exists`,
  `unknown_product`, `unknown_recipe`, `recipe_incomplete`, `unit`, `not_found`, `rate_limited`, `off_*`,
  `payload_too_large`, `internal`. An unknown `/food/*` path is always `404`.
- `src/food-db.js` = the parameterized store (NUMERIC → numbers, the date via `to_char`).
- `006_food.sql` is an OPTIONAL migration group (`src/migrations.js`): if it fails the service logs
  `food_migration_failed` and keeps ingesting / syncing / pulling Strava; only `/food/*` answers
  `503 food_unavailable`.

## Open Food Facts

`src/off.js`, SERVER side only (the page never calls OFF): v2 product API / `cgi/search.pl`.

- User-Agent `loop/1.0 (self-hosted personal food log)` (no personal data); 8 s timeout,
  `redirect: 'error'`, 1 MB response cap.
- In-memory LRU cache (24 h; not-found 1 h; an upstream 429 / 5xx / timeout 60 s); one shared in-flight
  request per identical lookup; token buckets (≤ 10 searches / min, ≤ 100 product reads / min; over →
  `429 off_rate_limited` without calling OFF).
- Only normalized fields leave it: `{code, name (es first), brand, stores, unit, per100 {kcal (kcal, else kJ
  ÷ 4.184), protein, carbs, fat}, servingSize, complete}`; a missing or implausible nutriment is `null`,
  never 0, and `complete: false`. Nothing is stored until the user saves the product (`source: "off"`). No
  `?store=` bias (not trivial with OFF's search).
- Attribution (ODbL): a muted `.food-note` under the product search (`Datos de Open Food Facts (©
  colaboradores de Open Food Facts, licencia ODbL).` / en `products.offCredit`), appended to the OFF intro
  of an OFF-filled form; README → License credits it too.

## Security

The routes are UNAUTHENTICATED (a static page cannot hold a secret) and LAN only. Layers:

1. **DNS rebinding** — loop-web nginx answers EVERY path (page, `status.json`, `/api/*`) only for a Host
   that is an IP literal (v4 / bracketed v6), `localhost` or a name in `PLAN_WEB_EXTRA_HOSTS`
   (`map $host $hc_host_ok` + a server-level `return 421`; `hosts.sh`, mounted as
   `/docker-entrypoint.d/15-hc-hosts.sh`, renders the names into exact map entries). Ingest `/food/*`
   repeats it (IP literal, `localhost`, `loop-ingest` = the proxy hop over the `loop-net` Docker network, which
   nginx sends as `Host` (`host.docker.internal`, its former name, still passes), or `FOOD_ALLOWED_HOSTS`; else
   `421 misdirected`).
2. On writes (`403 forbidden_origin`): `Sec-Fetch-Site`, when sent, must be `same-origin`; an `Origin` header must
   name an allowed host and, behind loop-web, be exactly the host + port the browser asked nginx for (nginx
   forwards it as `X-Forwarded-Host`), so another LAN address or port cannot write. No `Origin` and no
   `Sec-Fetch-Site` (curl, the food-log skill) passes. The SSO tunnel's public host works once it is in
   `FOOD_ALLOWED_HOSTS`.
3. `X-HC-Food: 1` on every request (`403`; the page sends it through `HC.jsonApi`, the fetch wrapper it
   shares with the journal) and `Content-Type: application/json` on writes (`415`) — from
   another site both need a CORS preflight the service never approves (no CORS headers).

Together they keep a website opened in a LAN browser from reading or writing the log; a device ON the LAN
calling the service directly is trusted (the LAN-only model).

- **To add a hostname** (e.g. `http://plan.lan:8090`), only names you control on your own network: on a LOOP
  server (the Docker images), `PLAN_WEB_EXTRA_HOSTS=plan.lan` + `FOOD_ALLOWED_HOSTS=plan.lan` in the server's `.env`,
  then `docker compose up -d`. Host mode (development / legacy): `PLAN_WEB_EXTRA_HOSTS=plan.lan` in
  `services/loop-web/.env` + `FOOD_ALLOWED_HOSTS=plan.lan` in `services/loop-ingest/.env`, then
  `docker compose up -d` in both.
- Text fields refuse U+0000 and the other control characters but tab / line feed / carriage return (`400 invalid`
  with the `field`; Postgres cannot store U+0000). Bodies ≤ 16 KB (`413`); writes ≤ 60 / min per client address (`429`) — behind loop-web every request comes
  from nginx, so it is ONE shared budget.
- loop-web nginx proxies the prefix `/api/food/` → ingest `/food/` (GET / POST / PUT / DELETE, body passed,
  `client_max_body_size 16k`, `X-HC-Food` forwarded, `Host loop-ingest`, `X-Forwarded-Host $http_host`; to
  `loop-ingest:8088` over `loop-net`, [`lan-services.md` → Network and bind address](lan-services.md#network-and-bind-address)). A public reverse proxy
  must NEVER forward `/food/*`.

## The Log food block

### Scripts and bake

- `web/src/client/food-*.js`, four classic scripts inlined in this order after nutri-day.js, before
  intake.js: `food-core.js` (the formula from `HC_FOODLOG`, `parseNum`, the API client, the shared state
  `S` + helpers, handed to the others as `window.HCFoodInternal`), `food-sheet.js` (the add sheet),
  `food-catalog.js` (My products / My recipes), `food-log.js` (Log food + navigator, the event listeners,
  the boot, the public `window.HCFood` / `window.foodTotals`). Tests load them with
  `web/test/client-util.mjs` `FOOD_SOURCE`.
- Copy: `web/src/i18n/food-templates.mjs` es / en, baked as `I18N_FOOD` + `FOOD_CONST` in `Dia.astro`.
  Styles: `web/src/styles/food.css`, tokens only.
- Everything is decided at VIEW time: the Log food block (`#food-log-block`, in `dia` right after Today's
  summary, before Today's plan) and the two folds (`web/src/tabs/Food.astro`: `#food-products`,
  `#food-recipes`, before Tables, rendered only when `dia` is visible, no section key) ship `hidden` and
  appear only when `GET /api/food/products` answers — a static copy (file://) and the example build show
  none of it, and builds stay byte-identical. Nothing of the log is kept in the browser.

### Day navigator

On the block's heading line (`.food-head`: the shared sentence-case heading `.hs-lbl` left, the navigator
right; a row too narrow wraps the navigator under the title; static markup in `Dia.astro`, driven by
food-log.js).

- `‹ <date> ›` = real 44 px buttons (the shared `.nav-btn` with a `.chev`; aria-label `Día anterior` /
  `Día siguiente`), the date in an `aria-live` label (`Hoy` on the viewer's today, else `HC.fmtDate`); next
  disabled on today (no future days); a short `Hoy` button (aria-label `Volver a hoy`) before `‹` only on
  another day.
- The viewed day is NOT persisted (`S.view` null = follow today), EXCEPT late night: before
  `LATE_NIGHT_HOUR` (04:00, `slots.mjs`, baked as `FOOD_CONST.lateNightHour`) it opens on the day before
  (also for a viewer on "today" whose day rolls over), and that automatic view returns to today from 04:00
  on `visibilitychange` (a day picked by hand never moves).
- A past day is read with `GET /api/food/log?date=` on each visit into its own slot (`S.dayLog`, never
  today's `S.log`) and renders the same cards, day total (`Total del día`), delete and "+ Añadir"; a slower
  answer for a day already left is dropped (`viewSeq`); a failed read shows the error + `Reintentar`
  (`day-retry`).
- A sheet opened on a past day logs to that day (its title adds the date); one opened on "today" resolves
  today at EACH save / retry (23:58 → 00:02 logs to the new day), with the same request-id /
  ambiguous-retry / re-read of THAT day. A delete removes its row by id from whatever log of that date is
  current when it commits (a re-read mid-delete cannot bring it back). An add or delete on a past day
  never touches today or calls `HCNutri.refresh()`. `foodTotals` / `groupTotals` / `addGuide` stay
  today-only.

### Groups and entries

- The day total, then FOUR flat `--surface` group cards — Breakfast / Lunch / Dinner / Extras (es `DESAYUNO`
  / `COMIDA` / `CENA` / `AÑADIDOS`; the UPPERCASE label + its kcal) — from `slots.mjs` `MEAL_GROUPS` +
  `mealGroup`, baked in `FOOD_CONST` as `groups` / `mainSlots` / `addonGroup` / `addonSlot`.
- Each entry = a list row (~56 px, 1 px divider): the name with the amount as secondary text, P / C / G as
  the small line under them, the kcal alone on the right in `--num`, a 44 px delete button with an
  aria-label; a quiet UPPERCASE "+ AÑADIR" per group.
- Stored slots = the six `MEAL_SLOTS` (`food_log.meal`): preworkout / postworkout / snack entries show in
  Extras with a tiny muted slot tag (`.fe-slot`).

## Add sheet

A registered detail-sheet view (`window.HCViews['food-add']`, deep link `#food-add`, registered only once
the API answered).

- Focus trap / Esc / Back from detail.js (its Tab trap includes form fields; `HCDetail.open(key, date,
  {opener})` returns focus to the tapped button). Opens with focus in the search field — `#fa-q`, or the
  quick label `#fa-label` on the Quick tab — never on the meal select.
- **Meal select** = the four groups (main groups stored as their slot, Extras as `snack`); a fresh sheet
  guesses by the viewer's hour: < 4 (late night) dinner, < 11 breakfast, < 16 lunch, < 20 Extras, else
  dinner.
- **Tabs** — THE segmented control (`.dt-range.dt-range-fill`; trough `--surface-2`, pressed tab on
  `--track`), one word each, `nowrap` to fit one line at 360 px: Products (search, grouped by store) /
  Recipes / Quick (label + kcal + optional macros).
- **Amount** in g / ml / servings (servings only with a serving size; a per-serving recipe in servings, a
  batch one in grams of cooked food). A product marked **Log by serving by default** (`servingDefault`) starts
  in servings with amount 1; any other product starts in its own unit. Switching a product to servings sets the
  amount to 1, and back to its unit sets one serving in that unit, never reusing the typed number.
- Live preview from the lib formula (`HC_FOODLOG`), `aria-live` results. "SAVE" is THE save button
  (`.save-btn`, design-system.md → Components; also the product and recipe forms' save): closes the sheet,
  re-renders Log food and announces `Añadido: …`.
- The portion guide's "+" logs an example amount (see "Portion guide" in `docs/nutrition.md`).

### Basics in the products tab

The search box also looks in `FOOD_BASICS` (it shows even with no product yet).

- An EMPTY search lists the products only, plus a one-line hint (`Escribe para buscar también en los
  básicos…`). Typing lists the matching products by store, then a `Básicos` / "Basics" group
  (accent- and case-insensitive: lib/nutrition/names.mjs `foldName`, read from HC_GUIDE; names that start
  with the text first; ≤ 25 rows), each row `88 kcal por 100 g · valor medio` (`por ud` for a unit food;
  `etiqueta` / "label values" for a `verified` label). Nothing matching → `Ningún producto coincide.`.
- A pick opens the same amount panel as a product: amount in the NATURAL unit (pieces when the food has a
  `piece` — the option names it, `huevos (~50 g)` —, ml for a liquid, g otherwise), prefilled with 1 piece
  or 100 g / ml (never a "usual" serving), a pieces ↔ g / ml select converting the typed amount
  (`basicConvert`), a live preview = the label to be saved + kcal / P / C / G, and a note that these are
  average table values.
- Save = ONE `quick` entry with the label and all four macros computed client-side, same request-id /
  ambiguous-retry / "save anyway" flow. An unparsable amount is "number" under the field; one over
  `amountMax` or the quick-entry limits (`quickKcalMax` 5000, `quickMacroMax` 500) is
  `fieldErrors.tooBig`; nothing sent.

## My products

- List by store (per-100 line, serving, Edit, Archive with a confirm step).
- Add = barcode or text lookup → OFF cards showing what OFF has (missing values marked) → "Usar este" fills
  the form with the missing fields flagged (`--mid`) → the user confirms every value and the store → save.
  "desde la etiqueta" = the same form empty (`source: "label"`). A new product's store starts on the FIRST
  configured store (`FOOD_STORES[0]`, baked as `FOOD_CONST.stores`), never a hard-coded one.

## My recipes

- List with per-serving / per-100 g cooked macros and the ingredients (`Avena 80 g · Huevo 2 ud VALOR
  MEDIO`); editor = name, kind, servings or cooked weight, ingredient rows (add / remove) and a live
  preview.
- With no product yet the editor still opens (basics only); "add products first" shows only when there
  are no basics either.
- A save answered `atwater` (a basic like beer, jam or baking powder, whose kcal do not match its macros)
  offers "save anyway" (`r-save-force`, `force: true`).

### Recipe basics

- An ingredient row not picked yet is a SEARCH (`frf-ing-<i>` + `frf-list-<i>`) with the add sheet's rules:
  an empty search lists My products (+ the "type to also search the basics" hint); typing lists the
  matching products under `Mis productos`, then `Básicos · valor medio` (FOOD_BASICS, `basicMatches`).
- A pick (`r-pick`) shows the name (+ a `valor medio` tag for a basic) and `Cambiar` (`r-unpick`), the amount
  in the NATURAL unit (pieces first, prefilled 1 piece / 100 g / ml) and, when the food has pieces, a
  pieces ↔ g / ml select (`frf-mode-<i>`, converting with `basicConvert`).
- A basic is saved as a SNAPSHOT `{basic, name, unit, amount, per100}` built by `basicIngredient` (the
  reference, via `HC_FOODLOG`; `BASIC_CASES`): unit = the basic's own unit (g / ml / ud), amount in it (a
  `ud` food = a count of units; pieces of a g / ml food become grams / ml), 1 decimal as stored; per100 =
  FOOD_BASICS `m` (per one unit for `ud`, `BASIC_UD_AMT` = units.mjs `UD_AMT`).
- The formula (`ingredientBasis` / `recipeBasis`, lib + service copy, `FOODLOG_CASES`: product + basic in g
  + basic in units, per serving and batch) adds products and snapshots alike; `rawWeight` = the g / ml
  amounts only; a basic with an unknown macro is `missing` by its key.
- Editing loads a basic back with its stored snapshot (never refreshed from FOOD_BASICS; the table only
  supplies the piece for the toggle), a `ud` food in pieces, other foods in their unit — a piece choice of
  a g / ml food is not stored, so it reopens in grams / ml.

## Forms: numbers and errors

- Every numeric field of the three forms goes through ONE parser (`parseNum(value, units)`, exposed on
  `HCFood`): trimmed, a decimal comma, a trailing unit THAT field takes dropped ("30 g", "250 ml",
  "130 kcal"; another unit is an error, never g ↔ ml); empty or a bare unit ("g") = not set (an optional
  field stays unset, a required one is "required"). The client still sends numbers or null; server
  validation is the same.
- Unit-bearing inputs show their unit as a suffix inside the field (the serving's follows `Se mide en`; an
  ingredient amount's follows its product).
- Validation errors render INLINE under each offending field (`<id>-err`, `aria-invalid`, described by it,
  focus on the first; a server `invalid` with a `field` lands there too).
- The form's status line (`fp-form-msg` / `fr-form-msg`, `role="status"`, with "save anyway") sits inside
  the form under its buttons; the section's own line (`fp-msg` / `fr-msg`: saved, archived) above the
  section body. Errors = one line from the coarse codes ("offline" → the server is unreachable and nothing
  was saved).

## Wiring

- `window.foodTotals()` = `{date, k, p, c, g, n, missing, src: 'log'}` when the API answered and TODAY (the
  viewer's local date) has ≥ 1 entry, else null — the one contract; nutri-day.js and intake.js do not
  re-check the date. TODAY-only whatever day the navigator shows.
- A macro NO entry states is `null` (a dash, never "0 / 150 g" or 0 %); `missing[m]` = at least one entry
  lacks it, so a non-null value is a minimum and the bar / ring shows "≥ 40" (the rings add a one-line
  note).
- ONE logged entry today is enough: the kcal ring, macro rows and rings then show the page's food log for
  today instead of the Apple Health intake (labelled `Registrado hoy en esta página` / the rings'
  `Registrado hoy`).
- `HCFood.recentDay(days)` = the newest day with entries in the last `days` days (today included), same
  shape, for the intake rings.
- Portion guide hooks: `HCFood.groupTotals()` (today's sums per group, `{meals: {breakfast, lunch, dinner:
  {k, p, c, f}}, addon}`, a missing macro counted as 0; null unless the API answered and today's log is
  loaded), `HCFood.products()` (a copy of the active products, null without the API) and
  `HCFood.addGuide({group, food: 'b:<key>' | 'p:<id>', amt})` (a promise; a main group only; always logs
  to today).
- After every add / delete the food scripts call `HCNutri.refresh()` (re-renders Today's summary, which
  refreshes the rings, and the portion guide, in its own try/catch).
- **Boot**: `HCFood.pending()` = `GET /products` has not answered yet (true from load, set synchronously,
  so intake.js sees it on its first render). The dial, bars and rings wait on it through ONE shared wait
  (`window.intakeWaiting()`, intake.js, grace `INTAKE.bootGraceMs`). An answer calls
  `window.intakeRefresh()` (today's log then refreshes Today's summary); a failure calls
  `HCNutri.refresh()` (dial, bars and rings fall back to the Apple Health day). See "Intake rings" in
  `docs/nutrition.md`.
- A page left open past midnight reloads today's log on `visibilitychange`: a viewer on "today" moves to
  the new today, one on a past day stays there (only today's totals refresh).
- `HCFood.state()` is test-only.

## Retries

- Each add carries a `requestId` (`crypto.randomUUID`, else a v4 UUID from `getRandomValues` — plain http on
  the LAN is not a secure context — else `Math.random`); `food_log` has a unique index on it, so a retry of
  the same add returns the stored row (`200`) instead of a duplicate.
- The sheet keeps the id across retries of the same pending add (a new item / tab = a new id), re-reads the
  log after an ambiguous failure (offline, a 15 s timeout, a 5xx) and replaces rather than appends a
  replayed entry.
- A delete answered `404` (already gone) just drops the row.

## Food log export

`npm run sync:foodlog` (part of `npm run sync`): read-only consumers (reports, the `nutrition-coach`
subagent) never query Postgres; they read the snapshot `data/nutrition/sync-foodlog.mjs` writes.

- `loop-data/foodlog/foodlog-daily.csv` (gitignored): one row per LOGGED day (no entry → no row); the last 120
  days are refreshed from the server, older rows are kept. An unknown macro is blank, never 0;
  `missing_macros` lists the macros some entry lacked, so those sums are **minimums**.
- `loop-data/foodlog/foodlog-daily.meta.json`: `{from, to, days, fetchedAt}` — the freshness stamp.
- Unreachable / old service → one `WARNING:` line, the old files kept, exit 0 (only a failed write exits 1).
- `data/nutrition/food-log.md` holds legacy notes + rationale only, not the live log.

## Settings (goal, target weight)

Settings, Progress and Consistency are render-isolated (own try/catch, one-line fallback). Thresholds live in
`lib/` (baked as `NUTRI.progress` / `NUTRI.adherence` / `FOOD_CONST.limits`); every number in the copy is a
placeholder filled from them, never typed.

- **Storage** — `services/loop-ingest/sql/007_settings.sql` (`app_settings`, one row: goal + target weight
  within `FOOD_LIMITS.targetWeight*`) plus `sql/013_settings_locale.sql` (the `locale` column: the page
  language, `es` | `en`, NULL = not chosen), its own optional migration group `settings` (a failure → only
  `/food/settings` answers `503 settings_unavailable`).
- **API** — `GET /food/settings` (`{goal, targetWeightKg, locale, updatedAt}`) and `PUT /food/settings`
  (partial `{goal?, targetWeightKg?, locale?}`, `null` clears the target or the language; `locale` must be
  `es` or `en`, else `400 {error: 'invalid', field: 'locale'}`) sit under the food prefix, so loop-web's
  `/api/food/` proxy and every food layer apply (no nginx change).
- **Page** — `client/settings.js` (`HCSettings`, reuses `HCFood.api`).
  - Without an answer: goal in `hc.nutri.goal`, no target field.
  - With one, the server goal wins (`HCNutri.applyGoal`, cached locally, never sent back) EXCEPT a PENDING
    goal (`HCNutri.setGoal` writes `hc.nutri.goalPending` until a PUT succeeds; retried on the next load
    and on `visibilitychange`; the profile says `pendiente de guardar`). An empty server gets the stored
    local goal once.
  - The GET retries with backoff on offline / timeout / 5xx (3 tries), never on 404 / 503.
  - Profile goal setting: + `Peso objetivo` (`HCSettings.parseTarget` = `HCFood.parseNum(v, ['kg'])` + the
    range, inline error, saved on `change`), one status line, the Progress line.
- **Language** (the page language, LAN page only) — the profile sheet's `Idioma` / `Language` section:
  `Español` / `English` radios, the stored `locale` checked (none stored = the language the page was built
  in). A change calls `HCSettings.saveLocale` (a partial PUT `{locale}`), then presses the page's Sync button:
  `npm run sync` writes it to `settings.json` (`data/profile/sync-settings.mjs`) and the build uses it
  ([`plan-page.md` → Build](plan-page.md), precedence `settings.locale` > `HC_LOCALE` > `plan.locale` > `en`).
  Its own status line: `Guardado. La página se está regenerando en el nuevo idioma: recárgala en un par de
  minutos.` / `Saved. The page is rebuilding in the new language: reload it in a minute or two.`

## Progress

Baked data, every build. `lib/nutrition/progress.mjs` is the ONE implementation (rules and bands in its
header): `lib/nutrition/client.mjs` emits it (its `CLIENT` descriptor) as `HC_PROG` (inlined before
util.js), which `client/progress.js` runs (no copy; `PROGRESS_CASES` test HC_PROG against the module, plus
hand-computed tests).

- **Rate** = least-squares slope of `DETAIL.metrics.weight.roll` over `windowDays`; too few averages →
  `pocos datos`.
- **Status** per goal band (`PROGRESS.bands`, from `analysis/methodology.md`): cut 0.25–0.5, bulk 0.1–0.25
  kg/week, never > `maxPctWeek` of bodyweight; maintain stable within ±`stableKg`, else going up / down.
- **ETA** only on pace = remaining ÷ the OBSERVED rate ±`etaSpread`, as months. Target / ETA only with
  `HCSettings`.
- **Card** (numbers + labels only): `MEDIA DE 7 DÍAS` + the last weigh-in, the average big in `--num`, the
  weekly rate as a pill (`.pg-pill`, `--up` on pace / steady / reached, `--down` otherwise), the status word
  with its dot (the word in white caps, the dot in the status colour — a caps label is never coloured,
  docs/design-system.md), target / kg to go, the ETA.
- ⓘ `#nutri-progress-info` (written by progress.js): the status why, the rate window and "the series mixes
  scales"; the ⓘ hides when there is nothing behind it, and a re-render (a settings change) keeps the block
  open or closed as the viewer left it.
- The card opens the weight sheet, which draws the target dashed (`detail-state.js` `targetOf`). Its accessible
  name carries what it shows (a `role="button"` hides its children): `7-day average 78.0 kg, -0.35 kg/wk. On pace.
  Target weight: … . Estimated arrival … . See the weight history` (`I18N_NUTRI.progress.aria` + the card's lines + `open`).

## Consistency

LAN page only. `GET /food/log/summary?from&to` (≤ `summaryDaysMax` days, ≤ 20,000 rows, 30 reads / min per
client) → per-day `daySummaries` (shared formula, generated into food-calc.js, pinned by `SUMMARY_CASES`).
`lib/nutrition/adherence.mjs` is the ONE implementation: `lib/nutrition/client.mjs` emits (its `CLIENT`
descriptor) `isComplete` / `dayState` / `adherence` as `HC_ADH` (inlined before util.js), which
`client/adherence.js` runs (no copy; `ADHERENCE_CASES` test HC_ADH against the module).

- **Complete day** = ≥ 1 entry in breakfast, lunch and dinner. Means and protein days only over complete
  days with a DETECTED day type (`HCNutri.targetFor` = current goal × that day's type; past days via
  `daytype.mjs` `dayInputFor` over `DETAIL.sessions` + `TRAINING`).
- Counted apart, never compared: unknown type, and an ASSUMED rest day (sleep only, no session:
  `inferred`).
- **UI** — 7 / 14 / 28 switch (compact pills, the day-type pills' style); a card of number tiles (days
  logged / complete days with a thin bar of the window, mean kcal vs target, protein days); a 28-cell strip
  of ≥ 44 px buttons (state in words; a tap = `HCFood.showDay`).
- ⓘ `#adh-info` (the first child of `#food-adherence`; a re-render keeps it open if it was): every note (no
  comparison, minimums, unknown / assumed days), the complete-day rule and the goal note.
- Re-read debounced (`reloadMs`) after every add / delete, and on `visibilitychange` when the day changed
  (the midnight reload of core.js waits while the page is busy).

## Nutrition score

Every page. A day's 0–100 adherence to the viewer's own targets, from the food log. `lib/nutrition/score.mjs`
is the ONE implementation (`NSCORE`, baked as `NUTRI.score`): `lib/nutrition/client.mjs` emits the scoring
functions (its `CLIENT` descriptor) as `HC_NSCORE` (inlined before util.js), which `client/nutri-score.js`
runs (no copy). The client test and `web/test/client-globals-build.test.mjs` (the built page) run it over
`NSCORE_CASES` (band and zero edges, missing and blank macros, today partial, no target / no entries) and
over a whole `scoreSeries`.

### Formula

Against THAT day's meals target (`HCNutri.targetFor`: the current goal × that day's detected day type, the
same target Consistency and the intake rings use; fat = its `g`). Score = the weighted sum, rounded
(components to 0.1 first).

| Component | Weight | 100 points | 0 points |
| --- | --- | --- | --- |
| kcal | 0.4 | within ±`kcal.full` (10 %) | linear to ±`kcal.zero` (35 %) |
| protein | 0.4 | ≥ `protein.full` (90 %); more never penalised | linear to `protein.zero` (50 %) |
| fat | 0.2 | `fat.lo` (60 %) to `fat.hi` (110 %) | linear to `zeroHi` (160 %) / `zeroLo` (30 %) |

**One definition with Consistency**: `kcal.full` IS `ADHERENCE.onBand` and `protein.full` IS
`ADHERENCE.proteinShare`, so a "protein day" there is full credit here; a protein MINIMUM counts only once
it reaches full credit, as there.

### Rules

- No log or no target (unknown day type) → no score, never 0.
- A macro in `missing_macros`, or a blank macro cell the sync did not flag → its component is left out, the
  others re-weighted, the day flagged "incomplete".
- The viewer's today = `partial`: scored by the same math but never SHOWN as a score (the cards show its
  progress, "in progress"; the chart has no point for it; the trend calendar marks it partial — dashed,
  "in progress", never "No data"; the day panel says "In progress"), never in an average.
- Scored but flagged: a main meal missing (`meals` false — Consistency's complete-day rule) and a rest day
  only assumed from sleep (`assumed`).
- Bands: ≥ 85 good, 60–84 mid, < 60 low.

### Data

- `buildFoodlogBake` (`lib/nutrition/read.mjs`, the build-time reader) bakes `INTAKE.log` = `{asOf, days}`:
  the last `NSCORE.days` (90) days of `loop-data/foodlog/foodlog-daily.csv` ending at its newest logged day
  (the example build: the demo extract's synthetic `foodlog-daily.csv`, `scripts/make-demo-data.mjs`), in
  the summary shape (`{date, k, p, f, n, missing: {p, f}, groups}`).
- LF or CRLF; a row with an impossible date, no kcal or no entries is skipped and the build prints one
  warning with the count (never a failed build).
- The page scores at VIEW time (the target depends on the viewer's current goal). On the LAN page each day
  of the live summary (`HCAdherence.state().days`, the last 28 days) replaces the baked one, and every
  summary read re-renders the score (`HCNutriScore.refresh`; the computed series is cached per viewer day,
  so a page left open past midnight recomputes); a goal change re-renders it through `HCNutri.refresh`.

### Score block

`#nutri-score-block` (Dia.astro, between Balance and Progress; hidden without any food log day) — the same
card as Home's (`docs/home-tab.md`).

- Title "NUTRITION" (+ "· INCOMPLETE" / "· IN PROGRESS"), one caps title in one weight.
- **Today logged** heads it alone: its kcal % of target in white (`.ns-now`, "KCAL TODAY"), the progress
  rows ("KCAL", "1,500 / 2,000 kcal", the bar = eaten / target in `--trend`, no points); the newest closed
  day moves to the footer ("Yesterday 56% · 7-day average · 30-day").
- **Otherwise** the newest CLOSED day's score heads it big in its band colour (`de-hi` / `de-mid` / `de-lo` =
  `--good` / `--mid` / `--low`) with "Yesterday" / its date; its rows carry their points as "KCAL · 85 pts"
  (`ptsTpl`), a bar = the points in their band colour; a left-out one reads "not logged".
- Then "7-day average · 30-day" (final scores only) and the 30-day line as Salud's sparkline (`.sc-spark` /
  `.spark`: the line in `--trend` with its area down to the 0 baseline, x by date, gaps bridged; caption
  "Each day's score, last 30 days (0–100)").
- Shows today when logged, else the newest scored day while ≤ `STALE_DAYS` old, else "No recent score".
- ⓘ `#nutri-score-info` (filled from `NUTRI.score`): the formula and rules. A tap opens the `nutrition`
  trend sheet (W = 7 days, M = 30; `docs/detail-views.md`).

## Rollout

- **Food log** — `cd services/loop-ingest && docker compose up -d --build loop-ingest` (runs
  `006_food.sql`), restart loop-web (`docker compose up -d` in `services/loop-web`, new nginx location),
  then `npm run generate` (or wait for the hourly refresh).
- **Settings** — ingest rebuild (`docker compose up -d --build loop-ingest`, runs 007), then
  `npm run generate`.
- Out of scope: label photos / OCR (send them to Claude in chat), scraping any supermarket site, Apple
  Health write-back.
