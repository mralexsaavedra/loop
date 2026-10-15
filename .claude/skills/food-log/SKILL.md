---
name: food-log
description: "Trigger: log food, registrar comida, regístrame, he comido, hoy como / ceno, add this product, crear producto desde la etiqueta, receta, macros left, cuántas calorías me quedan. Logs what the user ate on the LAN page's food log through its /food/* API, creates products from a label and recipes, and reports the day's totals."
---

# Food log for the user

The food log lives in the LAN service (`services/loop-ingest`), the same one the page's "+" sheet uses. You
write to it through the page's own address, so what you log appears on the page at once. Reference:
[`docs/nutrition-food-log.md`](../../../docs/nutrition-food-log.md) and the API table in
[`services/loop-ingest/README.md`](../../../services/loop-ingest/README.md).

## Calling the API

- Base URL: the address the user opens the page on (default `http://localhost:8090`; the `PLAN_WEB_PORT` and, when set, the `PLAN_WEB_BIND` address in
  `services/loop-web/.env` replace the port and `localhost`), path `/api/food/…`. Writes
  also send `Content-Type: application/json`.
- Every call sends the header `x-hc-food: 1`; without it the service answers `403`. No token is needed for
  `/food/*` (LAN-only trust model). Never print or echo `INGEST_TOKEN` or any secret.
- A write carries a fresh `requestId` (a UUID): a retry with the same id is answered with the stored row, so a
  network retry never logs twice.
- Dates are the user's local `YYYY-MM-DD`. Meals: `breakfast`, `lunch`, `preworkout`, `postworkout`, `dinner`,
  `snack`.

## Logging — look like the user picked it

The log must read exactly as if the user had used the page, so never invent a duplicate food.

1. **Their products first:** `GET /api/food/products`. A match → `POST /api/food/log` with
   `{date, meal, refType: "product", refId, amount, unit: "g" | "ml", requestId}`.
2. **Then the basics** (`data/nutrition/ingredients.json`, the page's built-in foods). A basic is logged as a
   quick entry labelled like the page labels it, `"<Name> · <amount> <unit>"` (e.g. `"Patata · 400 g"`), with the
   basic's per-100 values scaled to the amount: `{refType: "quick", label, kcal, protein, carbs, fat}`. A quick
   entry OMITS `amount`, `unit` and `refId` (sending them → `400 invalid`, field `refId` / `amount` / `unit`). A basic marked
   `"basic": false` duplicates one of the user's products: log the product instead.
3. **Their recipes:** `GET /api/food/recipes`; a `serving` recipe is logged in servings, a `batch` one in grams of
   the cooked dish (`refType: "recipe"`).
4. **Nothing fits** (a restaurant dish, a home-cooked plate): a quick entry with an honest estimate and a plain
   label, and say it is an estimate. If they will eat it again, offer to create a product or recipe instead.

Entries store a SNAPSHOT of the macros: after correcting a product or recipe, delete (`DELETE /api/food/log/:id`)
and re-log the affected entries. A photo of a plate: name every component you see, estimate amounts, and ask
before logging what you cannot see (bread, oil, sauce).

## Products and recipes

- **Product from a label photo:** `POST /api/food/products` with `{name, brand?, store, unit: "g" | "ml",
  per100: {kcal, protein, carbs, fat}, servingSize?, source: "label"}`. `store` is required: `mercadona`, `dia`,
  `eroski` or `other`. Copy the label's per-100 column; the service refuses kcal that disagree with the macros
  (`400 atwater`) unless `force: true` (alcohol, polyols). Check first that the product does not already exist.
- **Recipe:** `POST /api/food/recipes` with `{name, kind: "serving" | "batch", servings? | cookedWeightG?,
  ingredients}`; an ingredient is a product `{productId, amount}` or a basic snapshot `{basic, name, unit, amount,
  per100}` (per ONE unit for a `ud` food such as an egg). For a batch, ask for the weight of the whole cooked dish.

## Reporting the day

`GET /api/food/log?date=YYYY-MM-DD` returns the entries and `totals`. Compare them with the day's target — the
goal from `data/profile/settings.json` and the day type the page detects (its "Hoy comes" card, or
`data/nutrition/plan-tables.md`) — and give kcal and protein left in one or two lines. Ground any advice in
`analysis/methodology.md`.
