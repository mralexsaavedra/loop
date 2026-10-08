# Journal — daily behaviours, LAN page only

The owner answers a short daily journal (did I drink, have caffeine late, use a screen in bed…) from
the LAN page; the build relates each behaviour to the next morning's recovery. Same shape as the food
log (`docs/nutrition-food-log.md`): LAN-only API in `services/health-ingest`, a page client that shows
nothing without that API, and a sync into a gitignored CSV for read-only consumers.

> Area design doc. Read it before changing this area and keep it in sync with the code in the same
> commit.

## Behaviours

`lib/journal/journal.mjs` is the ONE reference (`JOURNAL_GROUPS`, `JOURNAL_BEHAVIORS`,
`JOURNAL_LIMITS`); `services/health-ingest/src/journal-calc.js` is a LITERAL copy (the service is built
from its own directory) pinned equal by `lib/journal/journal.test.mjs`. Owner-approved list
(2026-10-08), stored answer key → kind:

| Group | Key | Kind |
| --- | --- | --- |
| day | `caffeine_late` (caffeine after 16:00), `nap`, `mobility` (mobility / stretching) | yes / no |
| night | `alcohol` (drinks) | count 0–20 (0 = no) |
| night | `late_meal` (dinner < 2 h before sleep), `screen_in_bed`, `evening_supplements` | yes / no |
| status | `stressful_day` (hard / stressful day), `ill` (feeling ill) | yes / no |

A key is stored history: renaming one orphans its answers. A missing key (or `null`) = not answered;
a day is "journaled" when at least one behaviour is answered (`isJournaled`).

## Storage + API (`services/health-ingest`)

- `sql/010_journal.sql` (idempotent): `journal_day` (date PK = the owner's LOCAL date sent by the page,
  `answers` JSONB `{key: true | false | count}`, `notes` ≤ 500 chars, `updated_at`) and
  `journal_settings` (one row: the `disabled` keys, so a new behaviour defaults ON). Its own OPTIONAL
  migration group `journal` (`src/db.js`): a failure logs `journal_migration_failed` and only
  `/journal/*` answers `503 journal_unavailable`.
- `src/journal.js` routes, `src/journal-db.js` the parameterized store:
  - `GET /journal/day?date=` → `{day: {date, answers, notes, updatedAt}}` (an empty day when never
    journaled);
  - `PUT /journal/day` `{date, answers, notes?}` = full replace, idempotent upsert; no answer and no
    note deletes the row (not journaled again);
  - `GET /journal/summary?from&to` (≤ 366 days, 30 reads / min) → `{from, to, days: [{date, answers,
    notes}]}`, journaled days only;
  - `GET /journal/settings` → `{behaviors: {key: on}}`; `PUT /journal/settings` `{behaviors: {key:
    bool}}` = partial merge. Answers of a switched-off behaviour are still accepted (the switch only
    hides the row; history stays).
- Validation by hand: unknown keys refused (`400 invalid` + `field`, e.g. `answers.coffee`), dates
  round-trip (2000–2100), yes / no = boolean, the count an integer 0..`countMax`, notes trimmed.
- Security = the food layers (`docs/nutrition-food-log.md` → Security), shared helpers exported by
  `src/food.js`: Host allowlist (`421`; the same `FOOD_ALLOWED_HOSTS`), `Origin` on writes (`403
  forbidden_origin`), the header `X-HC-Journal: 1` on every request (`403`), JSON on writes (`415`),
  bodies ≤ 16 KB (`413`), writes ≤ 60 / min per client (`429`). plan-web nginx proxies `/api/journal/`
  → ingest `/journal/` (GET / PUT, `client_max_body_size 16k`, `X-HC-Journal` forwarded, `Host
  host.docker.internal`, `gzip off`). A public reverse proxy must NEVER forward `/journal/*`.
- **Rollout**: `cd services/health-ingest && docker compose up -d --build health-ingest` (runs
  `010_journal.sql`), then `docker compose up -d` in `services/plan-web` (new nginx location).

## Page (`web/src/client/journal.js`, LAN page only for writing)

- **Bake**: `SCORES.journal` (`lib/journal/bake.mjs`, through `lib/score/index.mjs`) carries the
  behaviour list, groups and limits; copy in `I18N_SCORE.home.journal` (es / en). Styles:
  `web/src/styles/journal.css` (tokens only; the card reuses `.sc-card`, `.tn-h`, `.tn-more`).
- **Gating** like the food log: the script asks `GET /api/journal/settings` (header `X-HC-Journal: 1`,
  15 s timeout) and, on an answer, `GET /api/journal/summary` for the 7 days ending on the viewer's
  today (`Date.now()`, never baked). Only then: the sheet registers (`HCViews.journal`, deep link
  `#journal`, an ASYNC view in `detail.js`), the "+" popover lists "Complete your journal"
  (`nav-actions.js`) and the card renders. No API (example build, `file://`, a static copy, an old
  service) → nothing new shows and nothing is stored in the browser.
- **My journal card** (`#my-journal`, Inicio, between Tonight and My plan): "MY JOURNAL" + a chevron, 7
  day columns (weekday + a check circle, `--up` = journaled); a column opens the sheet on that day.
- **Sheet**: the strip of the same 7 days (the picked day ringed; a tap switches day, dropping an
  unsaved draft), "What's happening today?" (or "What happened on <date>?"), the switched-ON behaviours
  in DAYTIME / NIGHTTIME / STATUS rows with a ✕ / ✓ pair (✓ pressed = `--trend` fill; pressing the
  pressed button again = not answered), the drinks as ✕ (= 0) + a − n + stepper (0..`countMax`), notes
  (≤ 500), a "Behaviors" fold with an on / off toggle per behaviour (`PUT /api/journal/settings` at
  once; answers of a switched-off behaviour are kept), a status line (coarse errors; "offline" = nothing
  saved) and the sticky "SAVE JOURNAL" pill: `PUT /api/journal/day` with the whole day, then the sheet
  closes and the card re-renders. Desktop: the same sheet as a centred panel (single column).
