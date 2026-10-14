# Journal — daily behaviours, LAN page only

You answer a short daily journal (did I drink, have caffeine late, use a screen in bed…) from the LAN page; the
build relates each behaviour to the next morning's recovery. Same shape as the food log
(`docs/nutrition-food-log.md`): LAN-only API in `services/health-ingest`, a page client that shows nothing without
that API, and a sync into a gitignored CSV for read-only consumers.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

On this page:

- [Behaviours](#behaviours)
- [Storage](#storage)
- [API](#api): [routes](#routes), [validation](#validation)
- [Security](#security)
- [Rollout](#rollout)
- [Page](#page): [bake and styles](#bake-and-styles), [gating](#gating), [My Journal card](#my-journal-card), [journal sheet](#journal-sheet)
- [Export (sync to the extract)](#export-sync-to-the-extract)
- [Behaviour insights](#behaviour-insights): [inputs](#inputs), [formula](#formula), [insights view](#insights-view)

## Behaviours

`lib/journal/journal.mjs` is the ONE reference (`JOURNAL_GROUPS`, `JOURNAL_BEHAVIORS`, `JOURNAL_LIMITS`).

- **Generated service copy**: `services/health-ingest/src/journal-calc.js` (the service is built from its own
  directory, so it cannot import `lib/`). `scripts/gen-journal-calc.mjs` writes it from the module's `SERVER`
  descriptor via `lib/build/esm-module.mjs`, the same pattern as the food log's `food-calc.js`.
- **Change the lib, then `npm run gen:journal-calc`** (never hand-edit the service file): the root test
  `scripts/gen-journal-calc.test.mjs` fails while the committed file differs from a regeneration.

Behaviour list, stored answer key → kind:

| Group | Key | Kind |
| --- | --- | --- |
| day | `caffeine_late` (caffeine after 16:00), `nap`, `mobility` (mobility / stretching) | yes / no |
| night | `alcohol` (drinks) | count 0–20 (0 = no) |
| night | `late_meal` (dinner < 2 h before sleep), `screen_in_bed`, `evening_supplements` | yes / no |
| status | `stressful_day` (hard / stressful day), `ill` (feeling ill) | yes / no |

`JOURNAL_LIMITS`:

| Limit | Value | Meaning |
| --- | --- | --- |
| `countMax` | 20 | drinks in one day |
| `notesMax` | 500 | characters of the day's note |
| `rangeDaysMax` | 366 | days one `GET /journal/summary` may span |
| `insightMinDays` | 5 | days needed on EACH side (yes / no) before an insight is shown |

- A key is stored history: renaming one orphans its answers.
- A missing key (or `null`) = not answered; a day is "journaled" when at least one behaviour is answered
  (`isJournaled`).

## Storage

`services/health-ingest/sql/010_journal.sql` (idempotent):

| Table | Columns |
| --- | --- |
| `journal_day` | date PK = the user's LOCAL date sent by the page; `answers` JSONB `{key: true \| false \| count}`; `notes` ≤ 500 chars; `updated_at` |
| `journal_settings` | one row: the `disabled` keys, so a new behaviour defaults ON |

- Its own OPTIONAL migration group `journal` (`src/db.js`): a failure logs `journal_migration_failed` and only
  `/journal/*` answers `503 journal_unavailable`.

## API

`src/journal.js` routes, `src/journal-db.js` the parameterized store.

### Routes

| Route | Body / query | Answer |
| --- | --- | --- |
| `GET /journal/day?date=` | — | `{day: {date, answers, notes, updatedAt}}` (an empty day when never journaled) |
| `PUT /journal/day` | `{date, answers, notes?}` | full replace, idempotent upsert; no answer and no note deletes the row (not journaled again) |
| `GET /journal/summary?from&to` | ≤ 366 days, 30 reads / min | `{from, to, days: [{date, answers, notes}]}`, journaled days only |
| `GET /journal/settings` | — | `{behaviors: {key: on}}` |
| `PUT /journal/settings` | `{behaviors: {key: bool}}` | partial merge |

- Answers of a switched-off behaviour are still accepted (the switch only hides the row; history stays).

### Validation

By hand:

- Unknown keys refused (`400 invalid` + `field`, e.g. `answers.coffee`); the behaviour lookup is a `Map`, so
  `__proto__` / `constructor` are unknown too.
- Dates round-trip (2000–2100).
- Yes / no = boolean; the count an integer 0..`countMax`.
- Notes trimmed, keeping their line breaks.

## Security

The food layers (`docs/nutrition-food-log.md` → Security), shared helpers in `src/http.js`:

| Check | Failure |
| --- | --- |
| Host allowlist (the same `FOOD_ALLOWED_HOSTS`) | `421` |
| `Origin` on writes | `403 forbidden_origin` |
| Header `X-HC-Journal: 1` on every request | `403` |
| JSON on writes | `415` |
| Bodies ≤ 16 KB | `413` |
| Writes ≤ 60 / min per client (`JOURNAL_WRITE_LIMIT`); summary reads ≤ 30 / min (`JOURNAL_SUMMARY_LIMIT`) | `429` |

- plan-web nginx proxies `/api/journal/` → ingest `/journal/` (GET / PUT, `client_max_body_size 16k`,
  `X-HC-Journal` forwarded, `Host host.docker.internal`, `gzip off`).
- A public reverse proxy must NEVER forward `/journal/*`.

## Rollout

1. `cd services/health-ingest && docker compose up -d --build health-ingest` (runs `010_journal.sql`).
2. `docker compose up -d` in `services/plan-web` (the nginx location).

## Page

`web/src/client/journal.js`; writing is LAN page only.

### Bake and styles

- `SCORES.journal` (`lib/journal/read.mjs` over the pure `lib/journal/bake.mjs`, through `lib/score/index.mjs`)
  carries the behaviour list, groups and limits.
- Copy in `I18N_SCORE.home.journal` (es / en).
- Styles: `web/src/styles/journal.css` (tokens only; the card reuses `.sc-card`, `.tn-h`; the behaviour insights
  button `.jr-ins` is a real action, a pill button, not a CTA link).

### Gating

Like the food log:

1. The script asks `GET /api/journal/settings` (header `X-HC-Journal: 1`, 15 s timeout).
2. On an answer, `GET /api/journal/summary` for the 7 days ending on the viewer's today (`Date.now()`, never
   baked).
3. Only then: the sheet registers (`HCViews.journal`, deep link `#journal`, an ASYNC view in `detail.js`), the
   "+" popover lists "Complete your journal" (`nav-actions.js`) and the card renders.

No API (example build, `file://`, a static copy, an old service) → nothing new shows and nothing is stored in the
browser.

### My Journal card

`#my-journal`, on Home, between Tonight and My plan.

- **With the API**: "MY JOURNAL" + a chevron, 7 day columns (weekday + a check circle, `--up` = journaled); a
  column opens the sheet on that day.
- **Without the API**, when the build baked a journal (`SCORES.journal.recent`: the journaled dates of the 14
  days ending at the newest journal day):
  - read-only columns, no chevron;
  - when that newest day is older than the 7-day window, the card shows the journal's own last week instead of
    an empty one;
  - the "BEHAVIOR INSIGHTS" button when insights exist (the example build shows it from the demo data).

### Journal sheet

- **Day strip**: the same 7 days (the picked day ringed; a tap switches day, dropping an unsaved draft).
- **Question**: "What's happening today?" (or "What happened on <date>?").
- **Behaviour rows**: the switched-ON behaviours in DAYTIME / NIGHTTIME / STATUS rows.
  - Yes / no: a ✕ / ✓ pair (✓ pressed = `--trend` fill; pressing the pressed button again = not answered).
  - Drinks: ✕ (= 0) + a − n + stepper (0..`countMax`); unanswered reads a dimmed "0" (`.jr-n-none`).
- **Notes** (≤ 500).
- **"Behaviors" fold**: THE switch per behaviour (`HC.switchBtn`), `PUT /api/journal/settings` at once; answers
  of a switched-off behaviour are kept.
- **Status line**: coarse errors; "offline" = nothing saved.
- **Save**: the sticky "SAVE JOURNAL" pill (THE save button `.save-btn`, design-system.md → Components):
  `PUT /api/journal/day` with the whole day, then the sheet closes and the card re-renders.
  - One save at a time: while it is in flight the pill is disabled, the note read-only and every edit refused
    (nothing typed under a request is lost silently).
- Closing the sheet drops an unsaved draft: the next open starts from the saved day.
- Desktop: the same sheet as a centred panel (single column).

## Export (sync to the extract)

- `scripts/sync-journal.mjs` (in `npm run sync`) writes `journal-daily.csv` + `journal-daily.meta.json` into the
  extract ([`data-pipeline.md` → Journal export](data-pipeline.md#journal-export-scriptssync-journalmjs-part-of-npm-run-sync)).
- The example build reads the synthetic `data/demo/extract/journal-daily.csv` (`scripts/make-demo-data.mjs`, its
  own PRNG).

## Behaviour insights

Computed at build time.

### Inputs

- `lib/journal/read.mjs` `readJournal` reads `journal-daily.csv`.
- `lib/extract/read.mjs` `readExtract` hands it, with `hrv.csv` / `rhr.csv` / `sleep-daily.csv`, to the pure
  `lib/journal/bake.mjs` `journalFrom(inputs)` (from `buildScoresFrom`), which calls
  `journalFromInputs({journal, hrv, rhr, sleep})`; the recovery series only matter when a day is journaled.
- Output → `SCORES.journal`: the behaviour list + `recent` + `insights = {asOf, from, days, rows}` over the
  journaled days of the 90 days ending at `asOf` (the newest journal day).

### Formula

`behaviorInsights`, `lib/journal/journal.mjs`:

- For each behaviour, the journal day D counts as "yes" (a yes answer, or ≥ 1 drink) or "no".
- Its value is the recovery % of the NEXT morning D+1 = `recoveryFromInputs(...).today.pct` (the recovery dial's
  percentile: that night's composite ranked among the 90 days before it) with every input cut at D+1, exactly
  what the dial showed that morning (`morningRecovery`).
- A morning that was not a complete night (the dial fell back to an older one) or has under 21 prior days has no
  score, and the day counts on neither side.
- `diff = mean(yes) − mean(no)` in recovery points (1 decimal).
- Shown only when BOTH sides have ≥ `insightMinDays` (5) days, else `need_data` with the counts.

### Insights view

`HCViews['journal-insights']`, every build with insights; "Journal insights".

- **Header**: the window line + ⓘ (the formula, and that it is an ASSOCIATION, not causation), "Recovery
  impact", a HURTS / % IMPACT / HELPS legend.
- **Rows**: one per behaviour, best first — UPPERCASE name, the signed difference (`+12%` `--up` better / `−6%`
  `--down` worse / under 1 point `--muted`), a bar from a centre dot (half the bar = max(20, the largest |diff|
  shown)).
- **Need more data**: those behaviours share ONE last card (`.ji-empty`, "NEED MORE DATA" +
  "Alcohol · 1 yes · 31 no" per behaviour).
- **Empty state** (NO behaviour scored yet): that card is the sheet's empty state, without the legend — what is
  needed (≥ `insightMinDays` days per side, each followed by a morning with a recovery score) and how many days
  count so far (the largest yes + no).
