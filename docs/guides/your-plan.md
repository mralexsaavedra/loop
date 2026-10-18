> **English** · [Español](your-plan.es.md)

# Make the plan yours

How to put your own nutrition targets, meals, foods, goal and training program into the page.
Everything you edit here is personal and gitignored: it never leaves your machine through git.

## 1. Pick how you set your starting targets

Your daily targets (calories, protein, fat) depend on your goal and on the kind of day. There are two
ways to get them:

1. **The page's setup assistant** (needs the LAN page, Level 2). It asks one question per screen:
   sex, date of birth, height, weight, activity, the sports you do (session length, times a week) and
   your goal. It computes your targets and saves them for you. See [Profile → In-page
   onboarding](../profile.md#in-page-onboarding-no-ai-coach-needed).
2. **Editing the plan file** yourself (section 2 below), or asking Claude Code to do it.

**Which one wins:** when the assistant has saved its targets, they replace the `targets.byGoal` numbers
of your plan file. The rest of the plan file (meals, servings) still applies. If you never use the
assistant, the plan file's targets are used.

## 2. Edit the nutrition plan file

1. Copy the example: `data/nutrition/plan-data.example.json` → `loop-data/cache/plan.json` (`mkdir -p loop-data/cache`
   first; `loop-data/` is the gitignored folder that holds your personal data).
2. Open `loop-data/cache/plan.json`. Two parts matter most.
3. Running the LAN data service? Save each change in it with `npm run documents -- push plan`; otherwise the
   next `npm run sync` keeps your edit but warns that it is not in the database yet ([Owner documents](../data-pipeline.md#owner-documents-scriptssync-documentsmjs-first-step-of-npm-run-sync)).

**`targets.byGoal`** — the daily targets per goal (`maintain`, `cut`, `bulk`) and day type:

| Day type | Meaning |
| --- | --- |
| `rest` | no training |
| `gym` | a gym or run session, about 1 h |
| `bike` | a ride of about 2 h |
| `bikeLong` | a ride over 2.5 h |

If you set up through the assistant, the page shows these day types with the names of your own sports.
Each cell holds `kcal`, `p` (protein, g) and `f` (fat, g); carbs are what is left:

```json
"byGoal": {
  "cut": {
    "rest":     { "kcal": 1950, "p": 140, "f": 55 },
    "gym":      { "kcal": 2350, "p": 140, "f": 55 },
    "bike":     { "kcal": 3100, "p": 140, "f": 55 },
    "bikeLong": { "kcal": 3600, "p": 140, "f": 55 }
  }
}
```

**`dayPlan`** — what you eat: `rest` is used on rest days, `train` on every training day type. Each
meal lists its parts, a food from the food database and an amount in that food's unit:

```json
{ "name": "Breakfast", "parts": [
  { "ing": "avena",  "amt": 60,  "label": "Oats", "flex": "carb" },
  { "ing": "claras", "amt": 150, "label": "Egg whites" }
] }
```

Parts marked `"flex": "carb"` are scaled by the page so the day lands on your calorie target. The
`data` section holds the options for each meal (breakfasts, proteins, carbs...) the same way.

3. Change a number (a target, an `amt`), save.
4. Run `npm run check` — it validates the plan and tells you what is wrong, without building.
5. Run `npm run generate` — it rebuilds the tables and the page (`web/dist/personal/index.html`).

Want the page in Spanish? Add `"locale": "es"` to `loop-data/cache/plan.json` and generate again.

**Never edit the generated files** (`data/nutrition/plan-tables.md`, anything in `web/dist/`): the next
`npm run generate` overwrites them. Change `loop-data/cache/plan.json` and regenerate.

## 3. Foods

- **The built-in food database** is `data/nutrition/ingredients.json` (tracked, shared). Every `ing`
  key in your plan must exist there. Each food has its macros per 100 g / ml or per unit:

  ```json
  "gambas": { "per": 100, "unit": "g", "verified": true,
    "name": { "es": "Gamba pelada cruda (Hacendado, agua añadida)", "en": "Raw peeled prawns (Hacendado, added water)" },
    "k": 72, "p": 16, "c": 0.4, "g": 0.5 }
  ```

  `k` = kcal, `p` = protein, `c` = carbs, `g` = fat. To fix a food's macros, edit it here and regenerate.
- **Your own products and recipes** live on the LAN page's food log, not in a file: add a product from
  its label (or Open Food Facts), build a recipe from your products, and log what you eat. The database
  foods also appear there as ready-made basics. See [Food log](../nutrition-food-log.md).

## 4. Goal and target weight

1. Open the profile sheet (the avatar button) on the page and pick your goal: maintain, lose (cut) or
   gain (bulk). The page switches its targets at once.
2. On the LAN page you can also set a target weight; both are stored on the server.
3. `npm run sync` copies them into `loop-data/profile/settings.json`, which Claude reads for its analyses.

No server? Create `loop-data/profile/settings.json` yourself:

```json
{ "goal": "cut", "targetWeightKg": 70 }
```

## 5. The training plan

1. Copy `data/training/training-data.example.json` → `loop-data/cache/training.json` (optional:
   without it the page simply shows no programmed session). With the LAN data service, save each change with
   `npm run documents -- push training` ([Owner documents](../data-pipeline.md#owner-documents-scriptssync-documentsmjs-first-step-of-npm-run-sync)).
2. Add one entry per date (`YYYY-MM-DD`). `kind` is `gym`, `run` or `bike`; `durationMin` is optional
   (minutes); `focus` is a short label; `blocks` hold the session:

   ```json
   "days": {
     "2026-01-05": {
       "kind": "gym",
       "focus": "Squat + metcon",
       "blocks": [ { "label": "A", "title": "BACK SQUAT EVERY 3' × 5", "lines": ["3 reps @ RPE7"] } ]
     }
   }
   ```

3. Run `npm run check`, then `npm run generate`.

What the page does with it: shows today's programmed session, and uses it to pick the day type of your
nutrition targets. A bike session sets the day by its length (75 min or more = `bike`, 150 min or more =
`bikeLong`); a workout you actually record can raise it. A date with no entry is a rest day.

Have a coach's PDF or an app's sessions? Claude Code can transcribe them (see below).

## 6. With Claude Code

Open `claude` in the repo folder and just ask:

- "Lower my cut rest-day calories to 1900 and regenerate."
- "Transcribe this week from `loop-data/files/documents/training/my-program.pdf` into loop-data/cache/training.json."
- "Log 200 g of chicken breast for lunch" — the `/food-log` skill logs it on the LAN page's food log.
- "Add this product from the label" (with a photo) — also `/food-log`.

## How it's built

- [Nutrition plan pipeline](../nutrition.md)
- [Training](../training.md)
- [Food log, products, recipes](../nutrition-food-log.md)
