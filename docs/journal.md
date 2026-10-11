# Journal — daily behaviours, LAN page only

You answer a short daily journal (did I drink, have caffeine late, use a screen in bed…) from
the LAN page; the build relates each behaviour to the next morning's recovery. Same shape as the food
log (`docs/nutrition-food-log.md`): LAN-only API in `services/health-ingest`, a page client that shows
nothing without that API, and a sync into a gitignored CSV for read-only consumers.

> Area design doc. Read it before changing this area and keep it in sync with the code in the same
> commit.

## Behaviours

`lib/journal/journal.mjs` is the ONE reference (`JOURNAL_GROUPS`, `JOURNAL_BEHAVIORS`,
`JOURNAL_LIMITS`); `services/health-ingest/src/journal-calc.js` is a LITERAL copy (the service is built
from its own directory) pinned equal by `lib/journal/journal.test.mjs`. Behaviour list,
stored answer key → kind:

| Group | Key | Kind |
| --- | --- | --- |
| day | `caffeine_late` (caffeine after 16:00), `nap`, `mobility` (mobility / stretching) | yes / no |
| night | `alcohol` (drinks) | count 0–20 (0 = no) |
| night | `late_meal` (dinner < 2 h before sleep), `screen_in_bed`, `evening_supplements` | yes / no |
| status | `stressful_day` (hard / stressful day), `ill` (feeling ill) | yes / no |

A key is stored history: renaming one orphans its answers. A missing key (or `null`) = not answered;
a day is "journaled" when at least one behaviour is answered (`isJournaled`).

## Storage + API (`services/health-ingest`)

- `sql/010_journal.sql` (idempotent): `journal_day` (date PK = the user's LOCAL date sent by the page,
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
- Validation by hand: unknown keys refused (`400 invalid` + `field`, e.g. `answers.coffee`; the behaviour
  lookup is a `Map`, so `__proto__` / `constructor` are unknown too), notes keep their line breaks, dates
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

- **Bake**: `SCORES.journal` (`lib/journal/read.mjs` over the pure `lib/journal/bake.mjs`, through
  `lib/score/index.mjs`) carries the
  behaviour list, groups and limits; copy in `I18N_SCORE.home.journal` (es / en). Styles:
  `web/src/styles/journal.css` (tokens only; the card reuses `.sc-card`, `.tn-h`; the behaviour insights button `.jr-ins` is a real action, a pill button, not a CTA link).
- **Gating** like the food log: the script asks `GET /api/journal/settings` (header `X-HC-Journal: 1`,
  15 s timeout) and, on an answer, `GET /api/journal/summary` for the 7 days ending on the viewer's
  today (`Date.now()`, never baked). Only then: the sheet registers (`HCViews.journal`, deep link
  `#journal`, an ASYNC view in `detail.js`), the "+" popover lists "Complete your journal"
  (`nav-actions.js`) and the card renders. No API (example build, `file://`, a static copy, an old
  service) → nothing new shows and nothing is stored in the browser.
- **My journal card** (`#my-journal`, Inicio, between Tonight and My plan): "MY JOURNAL" + a chevron, 7
  day columns (weekday + a check circle, `--up` = journaled); a column opens the sheet on that day.
  Without the API the card still shows when the build baked a journal (`SCORES.journal.recent`, the
  journaled dates of the 14 days ending at the newest journal day; when that day is older than the
  7-day window the card shows the journal's own last week instead of an empty one): read-only columns, no chevron, and
  the "BEHAVIOR INSIGHTS" button when insights exist (the example build shows it from the demo data).
- **Sheet**: the strip of the same 7 days (the picked day ringed; a tap switches day, dropping an
  unsaved draft), "What's happening today?" (or "What happened on <date>?"), the switched-ON behaviours
  in DAYTIME / NIGHTTIME / STATUS rows with a ✕ / ✓ pair (✓ pressed = `--trend` fill; pressing the
  pressed button again = not answered), the drinks as ✕ (= 0) + a − n + stepper (0..`countMax`;
  unanswered reads a dimmed "0", `.jr-n-none` — formerly "–", which read as a minus), notes
  (≤ 500), a "Behaviors" fold with THE switch per behaviour (`HC.switchBtn`) (`PUT /api/journal/settings` at
  once; answers of a switched-off behaviour are kept), a status line (coarse errors; "offline" = nothing
  saved) and the sticky "SAVE JOURNAL" pill (THE save button `.save-btn`, design-system.md → Components): `PUT /api/journal/day` with the whole day, then the sheet
  closes and the card re-renders. One save at a time: while it is in flight the pill is disabled, the
  note read-only and every edit refused (nothing typed under a request is lost silently). Closing the
  sheet drops an unsaved draft: the next open starts from the saved day. Desktop: the same sheet as a
  centred panel (single column).

## Sync + behaviour insights (build time)

- `scripts/sync-journal.mjs` (in `npm run sync`) writes `journal-daily.csv` + `journal-daily.meta.json`
  into the extract (`docs/data-pipeline.md` → Journal export). The example build reads the synthetic
  `data/demo/extract/journal-daily.csv` (`scripts/make-demo-data.mjs`, its own PRNG).
- `lib/journal/read.mjs` `journalBake(extractDir)` reads `journal-daily.csv` (`readJournal`) and, when there
  are journaled days, `hrv.csv` / `rhr.csv` / `sleep-daily.csv`, then calls the pure
  `lib/journal/bake.mjs` `journalFromInputs({journal, hrv, rhr, sleep})` → `SCORES.journal`: the behaviour list + `recent` +
  `insights = {asOf, from, days, rows}` over the journaled days of the 90 days ending at `asOf` (the
  newest journal day).
- **Formula** (`behaviorInsights`, `lib/journal/journal.mjs`): for each behaviour, the journal day D
  counts as "yes" (a yes answer, or ≥ 1 drink) or "no"; its value is the recovery % of the NEXT
  morning D+1 = `recoveryFromInputs(...).today.pct` (the recovery dial's percentile: that night's
  composite ranked among the 90 days before it) with every input cut at D+1, exactly what the dial
  showed that morning (`morningRecovery`). A morning that was not a complete night (the dial fell back
  to an older one) or has under 21 prior days has no score and the day counts on neither side.
  `diff = mean(yes) − mean(no)` in recovery points (1 decimal). Shown only when BOTH sides have ≥
  `insightMinDays` (5) days, else `need_data` with the counts.
- **View** (`HCViews['journal-insights']`, every build with insights; "Journal insights"): the window
  line + ⓘ (the formula, and that it is an ASSOCIATION, not causation), "Recovery impact", a HURTS / %
  IMPACT / HELPS legend, then one row per behaviour, best first: UPPERCASE name, the signed difference
  (`+12%` `--up` better / `−6%` `--down` worse / under 1 point `--muted`), a bar from a centre dot
  (half the bar = max(20, the largest |diff| shown)); the need-more-data behaviours share ONE last card
  (`.ji-empty`, "NEED MORE DATA" + "Alcohol · 1 yes · 31 no" per behaviour). With NO behaviour scored yet
  that card is the sheet's empty state, without the legend: what is needed (≥ `insightMinDays` days per
  side, each followed by a morning with a recovery score) and how many days count so far (the largest
  yes + no) — formerly a column of identical "Need more data" cards (DS6).
