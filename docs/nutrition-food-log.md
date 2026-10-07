# Nutrition — food log, products, recipes, settings (parts 2–3)

The LAN-only food log and its API, plus the server-side goal, Progreso and Constancia. Plan pipeline and portion guide: `docs/nutrition.md`.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Nutrition v2 part 2 — food log, products, recipes (LAN page only)

The owner logs what he eats from the LAN page (`services/plan-web`), with his usual supermarket
products and his own recipes; Resumen de hoy fills from that log. Honest data: macros come only from
product labels / Open Food Facts values the owner confirmed, recipes are computed, unknown macros stay
unknown.

- **Formula** — `lib/nutrition/foodlog.mjs` is the ONE reference (constants `FOOD_STORES`
  mercadona / dia / eroski / other, `FOOD_UNITS` g / ml, `ENTRY_UNITS` + serving, `FOOD_MEALS` =
  `slots.mjs` `MEAL_SLOTS`, `RECIPE_KINDS`, `REF_TYPES`; `productEntry`, `recipeBasis`,
  `recipeEntry`, `entryFromBasis`, `dayTotals`, `atwaterOk`; `FOOD_LIMITS` = the shared input limits —
  name / brand / query caps, the barcode pattern, per-100 kcal 900 / macros 100, entry amount 5000… —
  baked for the page as `FOOD_CONST.limits` and copied into the service's food-calc.js, a test pins them
  equal). A product entry = per-100 × amount in the product's own
  unit, or servings × its `servingSize` (no serving size → no serving; never g ↔ ml). A recipe =
  the sum of its ingredients (amounts in each product's unit; a basic snapshot per 100 g / ml or per unit,
  see "Recipe basics" below): kind `serving` ÷ servings, kind
  `batch` × 100 ÷ total COOKED weight (per 100 g cooked); a missing product = incomplete, not
  loggable. Entries round once (kcal whole, macros 1 decimal) and day totals sum the rounded
  snapshots; a macro unknown on any entry is flagged in `missing` (the sum is then a minimum).
  Atwater: 4p + 4c + 9f within ±25 % of kcal or 10 kcal. Ports: `services/health-ingest/src/food-calc.js`
  (the service is built from its own directory) and `web/src/client/food-core.js` (`window.HCFood`);
  `lib/nutrition/foodlog.test.mjs` and `web/src/client/food.test.mjs` run all three over
  `FOODLOG_CASES`, so a formula change is made in all three (food-calc.js is a LITERAL copy: `var`,
  semicolons). The add sheet's preview goes through the same functions: a recipe whose products are all
  listed uses `recipeBasis`, one with an archived product the server's computed basis on the recipe row,
  both through `entryFromBasis` — no fourth copy. **Basics** (generic foods, no product needed):
  `basicModes` / `basicAmount` / `basicEntry` / `basicLabel` / `basicConvert` in the same file, over
  ONE baked basic `{k, n, u: g | ml | ud, m: [kcal, p, c, f] per 100 of u (a `ud` food: per unit),
  pc?: {a, r, o, m}, v?: 1 = a verified label}` (`lib/nutrition/basics.mjs` `buildBasics(ING, lang)`:
  every food of ingredients.json with all four macros, localized, sorted by the accent-insensitive name
  in code-unit order; `normName` = the search's normalization). Modes: `piece` (a countable food, or a
  `ud` food) or the food's own unit; a `ud` food also in `g` when its piece states grams; never g ↔ ml.
  Label = "<name> · <amount> ud (~<g> g)" for pieces, "<name> · <amount> <g|ml>" otherwise (es "ud",
  en "pc", decimal comma in es), capped at `nameMax`. Only TWO copies: the reference + food-core.js
  (`BASIC_CASES` / `runBasicCase`, pinned by both test files) — the server never computes a quick
  entry, so food-calc.js has none.
- **Storage + API** — `services/health-ingest`: `sql/006_food.sql` (idempotent) = `food_product`
  (per-100 kcal / protein / carbs / fat, store, unit g / ml, serving size?, barcode? unique among
  ACTIVE products, source off / label / manual, off_code?, archived), `food_recipe` (kind, servings
  XOR cooked_weight_g, ingredients JSONB `[{productId, amount} | {basic, name, unit, amount, per100}]`,
  archived), `food_log` (the owner's
  LOCAL date sent by the page, meal slot, ref_type product / recipe / quick, ref_id?, label, amount +
  unit, SNAPSHOT kcal / protein / carbs / fat taken at log time — a later product edit never rewrites
  history; macros NULL only on a quick entry that did not state them). `src/food.js` routes:
  `GET/POST /food/products`, `PUT/DELETE /food/products/:id` (DELETE = archive),
  `GET/POST /food/recipes` (+ computed `perServing` / `per100`), `PUT/DELETE /food/recipes/:id`,
  `GET /food/log?date=` (entries + `dayTotals`), `POST /food/log` (returns the entry + the day's
  totals), `DELETE /food/log/:id`, `GET /food/off?barcode=<8–14 digits>|q=<text>`. Strict hand-written
  validation (unknown keys refused, trimmed + capped strings, per-100 kcal ≤ 900 and macros ≤ 100 g,
  amounts ≤ 5000, dates round-trip, recipe macros never accepted from the client) and `400 atwater`
  unless `force: true` (the page offers "save anyway"). Errors are coarse `{error, field?}` codes
  (`invalid`, `atwater`, `barcode_exists`, `unknown_product`, `unknown_recipe`, `recipe_incomplete`,
  `unit`, `not_found`, `rate_limited`, `off_*`, `payload_too_large`, `internal`), never DB text.
  `src/food-db.js` = the parameterized store (NUMERIC → numbers, the date via `to_char`).
- **Open Food Facts** — `src/off.js`, SERVER side only (the page never calls OFF): v2 product API /
  `cgi/search.pl`, User-Agent `health-coach/1.0 (self-hosted personal food log)` (no personal data),
  8 s timeout, `redirect: 'error'`, 1 MB response cap, in-memory LRU cache (24 h; not-found 1 h; an
  upstream 429 / 5xx / timeout 60 s), one shared in-flight request per identical lookup,
  token buckets (≤ 10 searches / min, ≤ 100 product reads / min; over → `429 off_rate_limited`
  without calling OFF). Only normalized fields leave it: `{code, name (es first), brand, stores, unit,
  per100 {kcal (kcal, else kJ ÷ 4.184), protein, carbs, fat}, servingSize, complete}`; a missing or
  implausible nutriment is `null`, never 0, and `complete: false`. Nothing is stored until the owner
  saves the product (`source: "off"`). No `?store=` bias (not trivial with OFF's search).
- **Security** — the routes are UNAUTHENTICATED (a static page cannot hold a secret) and LAN only.
  Layers: (1) **DNS rebinding** — plan-web nginx answers EVERY path (page, `status.json`, `/api/*`)
  only for a Host that is an IP literal (v4 / bracketed v6), `localhost` or a name listed in
  `PLAN_WEB_EXTRA_HOSTS` (`map $host $hc_host_ok` + a server-level `return 421`; `hosts.sh`, mounted as
  `/docker-entrypoint.d/15-hc-hosts.sh`, renders the names into exact map entries), and ingest
  `/food/*` repeats it (IP literal, `localhost`, `host.docker.internal` = the proxy hop, which nginx
  sends as `Host`, or `FOOD_ALLOWED_HOSTS`; else `421 misdirected`); (2) on writes an `Origin` header
  must name an allowed host (`403 forbidden_origin`); (3) `X-HC-Food: 1` on every request (`403`) and
  `Content-Type: application/json` on writes (`415`) — from another site both need a CORS preflight
  the service never approves (no CORS headers). Together they keep a website opened in a LAN browser
  from reading or writing the log; a device ON the LAN calling the service directly is trusted (the
  LAN-only model). **To add a hostname** (e.g. `http://plan.lan:8090`): `PLAN_WEB_EXTRA_HOSTS=plan.lan`
  in `services/plan-web/.env` + `FOOD_ALLOWED_HOSTS=plan.lan` in `services/health-ingest/.env`, then
  `docker compose up -d` in both; only names you control on your own network. Bodies ≤ 16 KB
  (`413`); writes ≤ 60 / min per client address (`429`) — behind plan-web every request comes from
  nginx, so it is ONE shared budget (a per-client limiter is a later slice). plan-web nginx proxies
  the prefix `/api/food/` → ingest `/food/` (GET / POST / PUT / DELETE, body passed,
  `client_max_body_size 16k`, `X-HC-Food` forwarded, `Host host.docker.internal`). A public reverse
  proxy must NEVER forward `/food/*`. `006_food.sql` is an OPTIONAL migration group
  (`src/migrations.js`): if it fails the service logs `food_migration_failed` and keeps ingesting /
  syncing / pulling Strava, and only `/food/*` answers `503 food_unavailable`.
- **Page** — `web/src/client/food-*.js`, four classic scripts inlined in this order after nutri-day.js, before intake.js:
  `food-core.js` (the formula port, `parseNum`, the API client, the shared state `S` + helpers, handed to
  the others as `window.HCFoodInternal`), `food-sheet.js` (the add sheet), `food-catalog.js` (Mis
  productos / Mis recetas), `food-log.js` (Registrar + navigator, the event listeners, the boot, the
  public `window.HCFood` / `window.foodTotals`); tests load them with `web/test/client-util.mjs`
  `FOOD_SOURCE` (copy
  `web/src/i18n/food-templates.mjs` es / en baked as `I18N_FOOD` + `FOOD_CONST` in `Dia.astro`;
  styles `web/src/styles/food.css`, tokens only). Everything is decided at VIEW time like the
  freshness line: the Registrar block (`#food-log-block`, in `dia` right after Resumen de hoy, before
Plan de hoy) and the
  two folds (`web/src/tabs/Food.astro`: `#food-products`, `#food-recipes`, before Tablas, rendered only
  when `dia` is visible, no section key) ship `hidden` and appear only when `GET /api/food/products`
  answers — so the claude.ai artifact, file:// and the example build show nothing new and builds stay
  byte-identical. Nothing of the log is kept in the browser. **Day navigator** (on Registrar's heading
  line, `.food-head`: the title on the left, its rule filling the gap, the navigator on the right; a row too
  narrow wraps the navigator under the title; static markup in `Dia.astro`, driven by food-log.js): `‹ <date> ›` = real 44 px buttons (aria-label
  "Día anterior" / "Día siguiente"), the date in an `aria-live` label ("Hoy" on the viewer's today, else
  `HC.fmtDate`), next disabled on today (no future days), a short "Hoy" button (aria-label "Volver a hoy") before `‹` only on another day; the viewed
  day is NOT persisted (the page always opens on today; `S.view` null = follow today), EXCEPT late night: before
  `LATE_NIGHT_HOUR` (04:00, `slots.mjs`, baked as `FOOD_CONST.lateNightHour`) it opens on the day before (as if ‹ was
  tapped once; also a viewer on "today" whose day rolls over), and that automatic view returns to today from 04:00 on
  `visibilitychange` (a day picked by hand never moves); `foodTotals` / `groupTotals` / `addGuide` stay today-only. A past day is read
  with `GET /api/food/log?date=` on each visit into its own slot (`S.dayLog`, never today's `S.log`) and
  renders the same cards, day total ("Total del día"), delete and "+ Añadir"; a slower answer for a day
  already left is dropped (`viewSeq`); a failed read shows the error + "Reintentar" (`day-retry`). A
  sheet opened on a past day logs to that day (its title adds the date); one opened on "today" resolves
  today at EACH save / retry (23:58 → 00:02 logs to the new day), same request-id / ambiguous-retry /
  re-read of THAT day; a delete removes its row by id from whatever log of that date is current when it
  commits (a re-read mid-delete cannot bring it back); an add or delete on a past day never touches
  today or calls `HCNutri.refresh()`. The server already accepts any
  valid date (2000–2100). **Registrar**: the day total, then FOUR
  restrained group cards — Desayuno / Comida / Cena / Añadidos (en: Extras) — (`slots.mjs` `MEAL_GROUPS`
  + `mealGroup`, baked in `FOOD_CONST` as `groups` / `mainSlots` / `addonGroup` / `addonSlot`; label,
  amount, kcal in `--num`, P / C / G line, a 44 px delete button with an aria-label, "+ Añadir" per
  group). The stored slot enum is UNCHANGED (`food_log.meal` = the six `MEAL_SLOTS`, no schema change):
  entries stored as preworkout / postworkout / snack show in Añadidos with a tiny muted slot tag
  (`.fe-slot`). **Add sheet**: a registered detail-sheet view
  (`window.HCViews['food-add']`, deep link `#food-add`, registered only once the API answered; focus
  trap / Esc / Back from detail.js, whose Tab trap now includes form fields and whose
  `HCDetail.open(key, date, {opener})` returns focus to the tapped button): meal select = the four
  groups (Desayuno / Comida / Cena / Añadido; a main group is stored as its slot, Añadido as `snack`;
  a fresh sheet guesses the group by the viewer's hour: < 4 (late night) dinner, < 11 breakfast, < 16 lunch, < 20
  Añadido, else dinner), tabs Mis
  productos (search, grouped by store) / Mis recetas / Rápido (label + kcal + optional macros), amount in g / ml / servings (servings only with a serving
  size; a per-serving recipe in servings, a batch one in grams of cooked food; switching a product to
  servings sets the amount to 1, and back to its unit sets one serving in that unit, never reusing the typed number), live preview from the
  ported formula, `aria-live` results; save closes it, re-renders Registrar and announces "Añadido:
  …". The portion guide's "+" logs
  an example amount (see "Plan de hoy = a PORTION GUIDE"). **Basics in the Mis productos tab**: the search box also looks in `FOOD_BASICS`
  (baked by `Dia.astro`, each food with its category `c` and portion cap `x`, which the portion guide reads — size budget in `web/test/food-build.test.mjs`; the box shows even with no product yet). An EMPTY search
  lists the products only, plus a one-line hint ("Escribe para buscar también en los básicos…"); typing
  lists the matching products by store, then a "Básicos" / "Basics" group (accent- and case-insensitive,
  names that start with the text first, ≤ 25 rows), each row "88 kcal por 100 g · valor medio" ("por ud"
  for a unit food; "etiqueta" / "label values" for a `verified` label of the DB); nothing matching →
  "Ningún producto coincide.". A pick opens the same amount panel as a product: amount in the NATURAL unit
  (pieces when the food has a `piece` — the option names it, "huevos (~50 g)" —, ml for a liquid, g
  otherwise), prefilled with 1 piece or 100 g / ml (never a "usual" serving), a pieces ↔ g / ml select
  that converts the typed amount (`basicConvert`), the live preview = the label that will be saved + kcal
  / P / C / G, and a note that these are average table values. Save = ONE `quick` entry (no schema
  change) with the label and all four macros computed client-side, same request-id / ambiguous-retry /
  "save anyway" flow; an unparsable amount is "number" under the field, one over `amountMax` or the
  quick-entry limits (`quickKcalMax` 5000, `quickMacroMax` 500) is `fieldErrors.tooBig`, nothing sent.
  **Mis productos**: list by store
  (per-100 line, serving, Editar, Archivar with a confirm step); add = barcode or text lookup → OFF
  cards showing what OFF has (missing values marked) → "Usar este" fills the form with the missing
  fields flagged (`--mid`) → the owner confirms every value and the store → save; "desde la etiqueta"
  = the same form empty (`source: "label"`). **Mis recetas**: list with per serving / per 100 g
  cooked macros and the ingredients ("Avena 80 g · Huevo 2 ud VALOR MEDIO"); editor = name, kind,
  servings or cooked weight, ingredient rows (add / remove) and a live preview. **Recipe basics**: an
  ingredient row not picked yet is a SEARCH (`frf-ing-<i>` + `frf-list-<i>`) with the add sheet's rules:
  an empty search lists "Mis productos" (+ the "type to also search the basics" hint), typing lists the
  matching products under "Mis productos", then "Básicos · valor medio" (FOOD_BASICS, accent- and
  case-insensitive, `basicMatches`); a pick (`r-pick`) shows the name (+ a "valor medio" tag for a basic)
  and "Cambiar" (`r-unpick`), the amount in the NATURAL unit (pieces first, prefilled 1 piece / 100 g /
  ml) and, when the food has pieces, a pieces ↔ g / ml select (`frf-mode-<i>`, converts the typed amount
  with `basicConvert`). A basic is saved as a SNAPSHOT `{basic, name, unit, amount, per100}` built by
  `basicIngredient` (reference + food-core.js, `BASIC_CASES`): unit = the basic's own unit (g / ml / ud),
  amount in it (a `ud` food = a count of units; pieces of a g / ml food become grams / ml), 1 decimal as
  stored; per100 = FOOD_BASICS `m` (per one unit for `ud`, `BASIC_UD_AMT` = units.mjs `UD_AMT`). The
  formula (`ingredientBasis` / `recipeBasis`, all three copies, `FOODLOG_CASES`: product + basic in g +
  basic in units, per serving and batch) adds products and snapshots alike; `rawWeight` = the g / ml
  amounts only; a basic with an unknown macro is `missing` by its key. Editing loads a basic back with
  its stored snapshot (never refreshed from FOOD_BASICS; the current table only supplies the piece for
  the toggle), a `ud` food in pieces, other foods in their unit — a piece choice of a g / ml food is not
  stored, so it reopens in grams / ml. A save answered `atwater` (a basic like beer, jam or baking
  powder, whose kcal do not match its macros) offers "save anyway" (`r-save-force`, `force: true`). With
  no product yet the editor still opens (basics only); "add products first" shows only when there are
  no basics either. Errors = one line from the coarse codes ("offline" → the
  server is unreachable and nothing was saved). **Numbers**: every numeric field of the three forms goes
  through ONE parser (`parseNum(value, units)`, exposed on `HCFood`): trimmed, a decimal comma, a
  trailing unit THAT field takes dropped ("30 g", "250 ml", "130 kcal"; another unit is an error, never
  g ↔ ml); empty or a bare unit ("g") = not set (an optional field stays unset, a required one is
  "required"); the client still sends numbers or null and the server validation is unchanged.
  Unit-bearing inputs show their unit as a suffix inside the field (the serving's follows "Se mide
  en"; an ingredient amount's follows its product). Validation errors render INLINE under each
  offending field (`<id>-err`, `aria-invalid`, described by it, focus on the first; a server
  `invalid` with a `field` lands there too); the form's status line (`fp-form-msg` / `fr-form-msg`,
  `role="status"`, with "save anyway") sits inside the form under its buttons, and the section's
  own line (`fp-msg` / `fr-msg`: saved, archived) sits above the section body.
- **Wiring** — `window.foodTotals()` = `{date, k, p, c, g, n, missing, src: 'log'}` when the API
  answered and TODAY (the viewer's local date) has ≥ 1 entry, else null — the one contract; nutri-day.js
  and intake.js do not re-check the date. It stays TODAY-only whatever day the navigator shows (as do
  `HCFood.groupTotals()` and `HCFood.addGuide`, which always logs to today). `HCFood.recentDay(days)` = the newest day with entries
in the last `days` days (today included) in the same shape, for the intake rings. `HCFood.pending()` = the boot request
  (`GET /products`) has not answered yet (true from load, set synchronously, so intake.js sees it on its
  first render); its answer or failure calls `window.intakeRefresh()`, so the rings leave that wait. A macro NO entry states is `null` (a dash, never "0 / 150 g"
  or 0 %); `missing[m]` = at least one entry lacks it, so a non-null value is a minimum and the bar /
  ring shows "≥ 40" (the rings add a one-line note). ONE logged entry today is enough: the dial, bars
  and rings then show the page's food log for today instead of the Apple Health intake (labelled
  "Registrado hoy en esta página" / the rings' "Registrado hoy"). After every add / delete the food scripts call
  `HCNutri.refresh()` (re-renders Resumen de hoy, which refreshes the rings, and the portion guide, in its own try/catch). A page left open past midnight reloads today's log on `visibilitychange`: a viewer on "today" moves to
  the new today, one on a past day stays there (only today's totals refresh).
  The portion guide's hooks: `HCFood.groupTotals()` (today's sums per Registrar group, `{meals: {breakfast,
  lunch, dinner: {k, p, c, f}}, addon}`, a missing macro counted as 0; null unless the API answered and
  today's log is loaded), `HCFood.products()` (a copy of the active products, null without the API) and
  `HCFood.addGuide({group, food: 'b:<key>' | 'p:<id>', amt})` (a promise; a main group only).
- **Retries** — each add carries a `requestId` (`crypto.randomUUID`, else a v4 UUID from
  `getRandomValues` — plain http on the LAN is not a secure context — else `Math.random`); `food_log`
  has a unique index on it, so a retry of the same add returns the stored row (`200`) instead of a
  duplicate. The sheet keeps the id across retries of the same pending add (a new item / tab = a new
  id), re-reads the log after an ambiguous failure (offline, a 15 s timeout, a 5xx) and replaces rather
  than appends a replayed entry. A delete answered `404` (already gone) just drops the row.
  `HCFood.state()` is test-only.
- **Rollout** — `cd services/health-ingest && docker compose up -d --build health-ingest` (runs
  `006_food.sql`), restart plan-web (`docker compose up -d` in `services/plan-web`, new nginx
  location), then `npm run generate` (or wait for the hourly refresh). Out of scope: label photos /
  OCR (send them to Claude in chat), scraping any supermarket site, exporting the log to CSV for the
  analysis pipeline (next slice), Apple Health write-back.

## Nutrition v2 part 3 — server-side goal + target weight, Progreso, Constancia

Three render-isolated pieces (own try/catch, one-line fallback). Thresholds live in `lib/` (baked as
`NUTRI.progress` / `NUTRI.adherence` / `FOOD_CONST.limits`); every number in the copy is a placeholder
filled from them, never typed.

- **Settings (LAN page)** — `services/health-ingest/sql/007_settings.sql` (`app_settings`, one row:
  goal + target weight within `FOOD_LIMITS.targetWeight*`), its own optional migration group
  `settings` (a failure → only `/food/settings` answers `503 settings_unavailable`). `GET /food/settings`
  and `PUT /food/settings` (partial `{goal?, targetWeightKg?}`, `null` clears the target) sit under
  the food prefix, so plan-web's `/api/food/` proxy and every food layer apply (no nginx change); an
  unknown `/food/*` path is always `404`. Page: `client/settings.js` (`HCSettings`, reuses
  `HCFood.api`). Without an answer the page is exactly as before (goal in `hc.nutri.goal`, no target
  field). With it the server goal wins (`HCNutri.applyGoal`, cached locally, never sent back) EXCEPT a
  PENDING goal (`HCNutri.setGoal` writes `hc.nutri.goalPending` until a PUT succeeds; retried on the
  next load and on `visibilitychange`; the profile says "pendiente de guardar"); an empty server gets
  the stored local goal once. The GET retries with backoff on offline / timeout / 5xx (3 tries), never
  on 404 / 503. Profile Objetivo: + "Peso objetivo" (`HCSettings.parseTarget` = `HCFood.parseNum(v,
  ['kg'])` + the range, inline error, saved on `change`), one status line, the Progreso line.
- **Progreso** (baked data, every build) — `lib/nutrition/progress.mjs` = the reference (rules and
  bands in its header), ported in `client/progress.js` (`PROGRESS_CASES` parity + hand-computed tests).
  Rate = least-squares slope of `DETAIL.metrics.weight.roll` over `windowDays`; too few averages →
  "pocos datos". Status per goal band (`PROGRESS.bands`, from `analysis/methodology.md`: cut
  0.25–0.5, bulk 0.1–0.25 kg/week, never > `maxPctWeek` of bodyweight; maintain stable within
  ±`stableKg`, else going up / down). ETA only on pace = remaining ÷ the OBSERVED rate ±`etaSpread`,
  as months. Target / ETA only with `HCSettings`. Says the series mixes scales. The card opens the
  weight sheet, which draws the target dashed (`detail.js` `targetOf`).
- **Constancia** (LAN page only) — `GET /food/log/summary?from&to` (≤ `summaryDaysMax` days, ≤ 20,000
  rows, 30 reads / min per client) → per-day `daySummaries` (shared formula, food-calc.js copy pinned
  by `SUMMARY_CASES`). `lib/nutrition/adherence.mjs` = the reference (`ADHERENCE_CASES`), ported in
  `client/adherence.js`. Complete = ≥ 1 entry in breakfast, lunch and dinner; means and protein days
  only over complete days with a DETECTED day type (`HCNutri.targetFor` = current goal × that day's
  type; past days via `daytype.mjs` `dayInputFor` over `DETAIL.sessions` + `TRAINING`). Counted apart,
  never compared: unknown type, and an ASSUMED rest day (sleep only, no session: `inferred`). 7 / 14 /
  28 switch, a 28-cell strip of ≥ 44 px buttons (state in words; a tap = `HCFood.showDay`). Re-read
  debounced (`reloadMs`) after every add / delete, and on `visibilitychange` when the day changed (the
  midnight reload of core.js waits while the page is busy).
- **Rollout** — ingest rebuild (`docker compose up -d --build health-ingest`, runs 007), then
  `npm run generate`.
