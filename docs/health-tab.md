# Health tab

Body composition, activity, energy (incl. the power-meter ride correction), running / cycling tables, recovery and sleep.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

On this page:

- [Pipeline and hosts](#pipeline-and-hosts)
- [Layout](#layout)
- [Metric rows](#metric-rows)
- [Recovery](#recovery)
- [Fitness](#fitness): [fitness age](#fitness-age)
- [Sleep](#sleep): [main-sleep night rule](#main-sleep-night-rule)
- [Body composition](#body-composition)
- [Activity](#activity)
- [Energy](#energy): [power-meter ride correction](#power-meter-ride-correction)
- [Section notes](#section-notes)
- [Training tab cards](#training-tab-cards): [running](#running), [cycling](#cycling), [load vs recovery](#load-vs-recovery)
- [Build properties](#build-properties)

## Pipeline and hosts

- `lib/health/{read,stats,aggregate}.mjs` (single-source pattern) compute the stacked sections from the
  Apple Health extract CSVs.
- Every CSV is OPTIONAL: an absent CSV renders an empty state, never fails the build.
- The page bakes `HEALTH` with the pure `aggregate.mjs` `healthFrom(inputs)` over the build's one
  `lib/extract/read.mjs` `readExtract`.
- `web/src/client/health.js` renders into TWO hosts, each with its own empty state and its own try/catch
  (a throw in one half renders that half's empty state, never blanks the other). It also fills
  Nutrition's balance host:

| Host | Tab | Holds |
| --- | --- | --- |
| `#health-body` | Health | the sections below |
| `#health-train` | Training | running, cycling, load vs recovery ([Training tab cards](#training-tab-cards)) |
| `#nutri-balance` | Nutrition | the intake balance + macro split ([Energy](#energy)) |

## Layout

What it shows: the tab title, the health monitor, then one section per body / recovery topic.

Files: `web/src/tabs/Salud.astro` + `health.js`. Top to bottom:

1. **Title**: centred UPPERCASE (`SALUD` / `HEALTH`) with its ⓘ toggle right beside it.
   - A `1fr | title | 1fr` grid, so the ⓘ never sits pinned at the far right over the monitor's own ⓘ.
   - `#hs-intro`: the tab intro + how to read a row; the button is `HC.infoBtn`'s markup written by
     `health.js` into the `#hs-intro-i` slot.
   - The title's `text-indent` balances the tracking after its last letter, so the glyphs sit truly centred.
   - Same header on Training and Nutrition.
2. **Glow**: a green glow at the top of the page (`.hs-glow`, a radial ellipse of `--up` at 24 % via
   `color-mix`, absolute behind the content, only while the panel shows).
3. **Top bar**: Health, Training and Nutrition open on the title alone; the avatar and date pill show on
   Home only (`docs/plan-page.md`, top bar); the freshness / Sync controls stay.
4. **Health monitor** list (`#monitor`, `client/monitor.js`, see `docs/home-tab.md` "Health monitor"); its
   header reads title → "n out of range" chip → ⓘ at the end. The chip counts only fresh cards: out of
   range, else "Within range", else "Building baseline" (fresh cards with no band yet, e.g. a new device),
   else "No data". A row whose signal has no reading at all says "Your device does not record it"
   (`I18N_DETAIL.unrecorded`) and its sheet says the same; sleep keeps 2 decimals
   (`lib/score/monitor.mjs`), so its h:mm matches the sleep score's.
5. **Sections of `#health-body`**, in this order: [Recovery](#recovery), [Fitness](#fitness),
   [Sleep](#sleep), [Body composition](#body-composition), [Activity](#activity), [Energy](#energy).
   - Each is a `<section class="hs-sec" id="hl-<key>">` with the shared sentence-case section heading
     (`.hs-lbl`, [design-system.md](design-system.md) → Components), an ⓘ toggle and a list of metric rows.

- On ≥ 900 px the sections stay the phone's single column, just wider (the page's 960 px column,
  `docs/plan-page.md`).

## Metric rows

What it shows: one row per metric — the newest value with its 30-day context. Rows, not cards (text diet).

- Row = the shared `HC.metricRow` (the same `.db-*` row as Home's "My dashboard"):
  icon · UPPERCASE name · the NEWEST value + unit · a marker · a small line under the value.
- Icons: each row its own, from the one set in `util.js`. Sleep's rows: the moon for last night, a target
  for nights ≥ target, the regularity lines for the spread, a bed, a sun for wake time, then REM a wave,
  deep the moon, core the stages steps, awake a clock, efficiency bars.

### Small line and marker

| Metric kind | Small line | Marker |
| --- | --- | --- |
| Dense series | the 30-day baseline (`avg30`, `avg30Of`: mean of the daily values over the last 30 days) | ▲ / ▼ vs the baseline, a grey • within ±2 % |
| Daily TOTALS of `dailyTrend` | the baseline over the 30 days ending the day BEFORE the latest (the build cannot know whether that day is complete) | as above |
| Sleep | the 30-night mean | as above |
| Sparse measurement | its change "Δ +1.2": `d30Of` for weight, the scale-window Δ for body fat / lean mass, latest − first for VO₂max and waist | by the sign of the Δ |

- Colour by the metric's good direction: `--up` teal = better, `--down` orange = worse, `--ink` for no
  good direction (respiratory rate, wrist temp, weight, expenditure). Never a grey arrow — the trend glyph,
  design-system.md → Components.

### Row states

- **Partial day**: a daily total dated the viewer's today adds "today, so far" (`hoy, en curso`) and gets
  no marker (decided client-side).
- **Stale**: a row whose newest value is more than `STALE_DAYS` (3, `lib/stale.mjs`) before the viewer's
  today is greyed (`db-stale`) with "no recent data" (`sin datos recientes`) and no marker. Waist, dated
  in its own line, is exempt (a sparse manual measurement).
- **Accessibility**: the date, the baseline and the direction word are in the row's `aria-label`.
- **Robustness**: a non-finite value is never printed; a row that throws is skipped, never blanking the tab.

### Value sources

| Row | Value |
| --- | --- |
| HRV | the newest DAY's mean |
| Sleep | last night (`sleep.latest`) |
| Expenditure | the newest day's TDEE (`tdeeLatest`; a day counts only with BOTH active and basal energy, never basal alone) |

- Each recovery signal row carries an `hl-<key>` anchor.
- Every row opens its detail sheet (`docs/detail-views.md`: chart, W / M / 6M / 1Y, calendar), which
  holds the history.

## Recovery

What it shows: last night's recovery %, then any recovery signal the health monitor does not already list.

- **Recovery card**: `#score-recovery`, filled by `score.js`, borderless and without a title of its own
  (the section heading names it); the card head keeps the as-of date, History and its ⓘ.
  - Headline: last night's recovery % (the unit attached to the number at ~55 % of its size, "99%") with
    the % band word, or the SD value under 21 prior nights.
  - A night carried from an earlier day keeps its date above, and the number + band word are dimmed
    (`HC.carried`, `docs/design-system.md` → Carried values). Health's metric rows are "latest per metric"
    lists, each dated in its own line, so they keep only the stale grey.
  - Its long lines join this section's ⓘ block (also what the sparkline shows: no caption under it); its
    raw "Last 14 days" lists fold behind a quiet disclosure line (see `docs/home-tab.md`).
- **Signal rows**: only those among resting HR, HRV, respiratory rate and wrist temperature that the
  monitor does NOT list (the monitor shows them at the top, so they are not repeated). With today's
  monitor that leaves no rows.

### Inputs

| CSV | Notes |
| --- | --- |
| `rhr.csv`, `hrv.csv` | both as the per-day MEDIAN of the plausible samples (artefacts dropped) (`score/recovery.mjs` `dailySignal`), the same series Home's recovery and monitor use |
| `vo2max.csv`, `walking-hr-daily.csv` | rows in [Fitness](#fitness); VO₂max as one value per day, the MEAN of the day's rows (`score/fitness-age.mjs` `vo2maxDaily`), the same series the fitness age card and its detail sheet use |
| `sleep-daily.csv` | rows in [Sleep](#sleep) |
| `respiratory-daily.csv`, `wristTemp.csv` | change-not-absolute signals |

- Respiratory rate, sleeping wrist temperature and walking HR use the same per-day series as the Inicio
  monitor and the detail sheet (`score/monitor.mjs` `signalDaily`): samples outside the signal's plausibility
  range dropped, then the day MEDIAN (walking HR: 30 bpm to `MAX_HR_MAX` 230), so a stray sample or a
  duplicate row cannot move the row the way a day mean would.

- Good directions, stated behind the section's ⓘ: ↓ resting / walking HR, ↑ HRV, ↑ VO₂max; respiratory
  rate and sleeping wrist temp are change-not-absolute signals.
- Sleeping wrist temperature is dated by the same midpoint + 18:00 roll-over rule as a sleep block
  (`wristTempDate(start, end)`; a Shortcut sample with only a start falls back to its start).

## Fitness

What it shows: the fitness-age ring, chronological age and its 90-day change, then VO₂max and walking HR.

### Fitness age

- **Score**: `lib/score/fitness-age.mjs` bakes `SCORES.fitnessAge` (`buildScoresFrom(inputs, { sex: profile.sex })`).
  - The age whose healthy-population MEAN VO₂max (Loe et al. 2013, PLoS ONE,
    doi:10.1371/journal.pone.0064319, Table 2: HUNT3 Fitness Study, per sex and 10-year group) equals the
    latest `vo2max.csv` day.
  - A day with several rows (a watch estimate and its Shortcut copy) reads as their mean (`vo2maxDaily`), the
    one per-day series of this card, the VO₂max row and the detail sheet: the row order is the files' merge
    order, not a time of day, so "the later row" would be arbitrary.
  - Interpolated between group midpoints 25 … 65, and 75 for 70+.
  - Clamped (`bound` below / above → "< 25" / "> 75").
  - Formula, table and limits: `analysis/methodology.md` §4.
  - Also bakes the day's value / date / source (several sources joined with " + "), and the fitness age of the newest reading on or before
    latest − 30 / − 90 days.
- **Block**: `client/health.js` `fitnessAgeBlock` leads the Fitness section.
  - A large full ring (the dial figure classes, `.fa` in `styles/health.css`): `--up` when younger than the
    chronological age, `--down` when older, grey when equal; the fitness age in whole years and
    "FITNESS AGE" inside.
  - Under it: "N years younger / older" ("At least N" at a bound) and the VO₂max it comes from
    (value · date · source).
  - Rows: "Chronological age" (`HC.ageOn(PROFILE.birthdate)` on the viewer's clock, so builds stay
    byte-identical) and "Fitness age, 90 days" (else 30; Δ vs then, lower = better; none when either end
    is clamped).
- **Opens**: the ring and the trend row open the `fitnessAge` detail sheet (`docs/detail-views.md`); Home's
  My dashboard can show it as an optional row (`docs/home-tab.md`).
- **No number**, one line with the reason instead, when the profile has no `sex` (`docs/profile.md`), no
  `birthdate`, or there is no VO₂max reading.
- A motivational comparison with a smartwatch estimate, not a medical measure.

## Sleep

What it shows: last night, sleep consistency, and the newest staged night's stages.

- Rows, in order: last night, % nights ≥ target, night-to-night ±, bedtime / wake time.
- When the extract has stages: REM / deep / core / awake hours of the newest staged night with their % of
  asleep, and sleep efficiency, each vs the mean of the staged nights among the last 30 (`aggRecovery`
  `sleep.stages`, formulas from `lib/score/sleep.mjs`, explained in a second ⓘ note).
- Consistency:

| Measure | Rule |
| --- | --- |
| Nights on target | % of nights ≥ `SLEEP_TARGET` (7.5 h) |
| Night-to-night spread | sd |
| Bedtime / wake-time regularity | median ± a ROBUST sd = 1.4826 × MAD, in minutes; after-midnight bedtimes wrapped onto a night scale |

- Sleep renders as its own Health section; its heading is the `#hl-sleep` anchor.
- Estimated nights (a band that writes only "in bed", [data-pipeline.md → Sleep](data-pipeline.md#sleep-sleep-dailycsv)):
  their hours are time in bed. When the newest night is one, last night's row reads "estimated (in bed)"
  before its 30-night mean (`sleep.latestEstimated`), and the ⓘ adds a note with how many of the last 30
  nights are estimated (`sleep.estimatedNights`). Both keys exist only when true / non-zero. Such nights
  count in the mean, the nights on target, the spread and the bed / wake regularity (their bed / wake
  times are real); they have no stages or efficiency (blank columns), and recovery's sleep duration and
  consistency read them like any night ([home-tab.md → Recovery](home-tab.md)).

### Main-sleep night rule

Bedtime / wake time come from the extended `sleep-daily.csv`: `extract.mjs` and `sync-shortcut.mjs` share
`lib/extract/samples.mjs` `sleepNights`, which keeps only the MAIN sleep of each wake-up night.

- Asleep segments are chained with gaps < 60 min.
- The main block: the longest block whose midpoint falls 20:00–12:00.
- In-window blocks join it within 3 h when they lie before it or start before 05:00 on the wake-up date
  (a split night with a 3 am wake-up stays one night).
- A block that starts after the night's end from 05:00 on AND ends at or after 10:00 joins only within
  60 min (`AFTER_END_GAP_MIN`), so a 09:00–10:30 nap after a 06:30 wake-up or an afternoon nap is not
  absorbed.
- A block after the end that ENDS before 10:00 (`FALL_BACK_END_HOUR`) is falling back asleep after an early
  wake-up and joins within 3 h (23:59–03:19 + 05:08–07:32 = one night).
- Accepted trade-off (pinned by a test): a real morning nap that ends before 10:00 within 3 h of the
  wake-up (06:30 wake, 07:30–09:30 nap) JOINS the night too — the data cannot tell it apart from falling
  back asleep (no awake / stage context beyond the gap).
- Naps (incl. one that crosses 18:00) add neither minutes nor bed / wake times; a nap-only day has no row.
- Known limitation: night-shift sleep (a daytime main sleep) falls outside the 20:00–12:00 window and is
  treated as a nap.
- No migration: rows of `sleep-daily.csv` / `wristTemp.csv` that came from an earlier export keep the
  convention they were written with until `node data/apple-health/extract.mjs` is re-run on a new export
  (Shortcut rows are rebuilt by every sync).

## Body composition

What it shows: weight, body fat, lean mass, waist.

| Metric | Source | Rule |
| --- | --- | --- |
| Weight | `weight.csv` | 7-day rolling average (it mixes scales / apps, so the raw series is noisy) |
| Body fat, lean mass | `bodyfat.csv`, `leanmass.csv` | ONLY the most recent source; flagged bioimpedance ±3–5 %; Δ + sparkline over the last `BODYCOMP_WINDOW` (150) days only |
| Waist | `waist.csv`, cm | every reading a point (no rolling average); the headline carries its measurement date; Δ = latest vs first |

- Why the body-comp window: the source tag does NOT isolate a scale switch (the same app re-tags an old
  scale's readings, which can show as an overnight jump of several points), so the window avoids
  celebrating that artifact as real change.
- Waist is a sparse manual tape measurement, written by `extract.mjs` from `WaistCircumference` and by the
  Shortcut `waist` key. No waist data → the section shows a hint on how to start logging it.

## Activity

What it shows: steps (NEAT), exercise minutes, distance, flights.

- Sources: `steps-daily.csv` (NEAT), `exercise-minutes-daily.csv`, `distance-daily.csv`, `flights-daily.csv`.
- Each is a daily total (generic `dailyTrend`): latest day (headline) + 30-day average and Δ vs the prior
  30 days (context), 7-day rolling sparkline.
- All four are deduped max-per-device by `extract.mjs` (iPhone + Watch overlap → summing double-counts).
- Near-zero step / distance days (device not carried) are dropped as missing data.

## Energy

What it shows: expenditure only (TDEE). The intake balance + macro split render in Nutrition → Balance
(`docs/nutrition.md`).

| Input | Gives |
| --- | --- |
| `active-energy-daily.csv` + `basal-energy-daily.csv` | expenditure (TDEE, 7-day rolling) |
| `dietary-daily.csv` | intake AND the macro split (protein / carbs / fat, g + % kcal) |

- Health shows the expenditure row alone.
- Balance (deficit / surplus) and macro split: rendered by the same `client/health.js` in host
  `#nutri-balance` on Nutrition. Data honesty: intake logging is sparse and abandoned, so both are baked
  ONLY when intake was logged within the last 14 days (`INTAKE_MAX_AGE_DAYS`) of the newest expenditure
  day AND ≥ 7 logged days (`BALANCE_MIN_DAYS`) exist in the 90 days (`BALANCE_WINDOW`) ending at that day.
  Otherwise that card says intake can't be scored.
- Implausible basal readings (double-counts / no-wear) are dropped via a sane band (`BASAL_LO` 1200 –
  `BASAL_HI` 2800 kcal, `lib/health/aggregate.mjs`).
- Nutrition / Home read no TDEE.

### Power-meter ride correction

A ride a bike computer recorded with a power meter, and the Watch did not, is under-counted by the Watch's
Active Energy (real case: 2,311 kJ ride, Watch 1,821 kcal over the ride hours).

- Code: pure core `lib/health/ride-energy.mjs`; `readActiveEnergy` in `lib/health/read.mjs` = the ONE
  active-energy reader of the Health card AND the detail sheet's `energy`.
- Formula: corrected active(day) = Watch day total − Watch energy during the ride + ride kJ × `KJ_TO_KCAL`
  (1.0: 1 kcal = 4.184 kJ × ~24 % gross efficiency ≈ 1 kJ mechanical).
- Watch-during-ride = the `active-energy-hourly.csv` buckets overlapping the ride window
  [start, start + elapsed], each spanning its clock hour and prorated by overlap minutes.
- Time handling: everything compared as instants (DST- and host-timezone-safe). A ride crossing midnight
  splits its energy by time across the two local days, each midnight placed with the offset of that day's
  00:00 bucket (the ride's offset only without one).
- Overlapping power rides (a duplicate upload, a nested ride) are clustered by interval union and count
  once; the largest kJ wins.
- Watch day in the formula = max(daily row, sum of that day's hourly buckets): the buckets are parts of the
  same Watch's day, so a daily row below their sum is a stale payload and would otherwise understate the
  result.
- Café stops inside the elapsed window are replaced too (small, conservative).

Applied ONLY when all hold:

| Condition | Otherwise |
| --- | --- |
| the ride (`rides.csv`) has kJ > 0 AND `device_watts === true` | no correction (a blank flag = an old ingest image; Strava's estimated watts never count) |
| a start with offset and an elapsed time | no correction |
| the hourly buckets cover the WHOLE window | no correction (one missing hour), and the day is flagged `uncovered` |
| the day has a Watch total | no correction |
| the corrected value is HIGHER | no correction (never lowers a day, so a Watch-recorded ride stays as measured) |

What the page shows:

- **Uncovered**: the Health card says `salida con potenciómetro sin corregir: faltan datos por horas del
  reloj` on such a headline day + a note counting them in the 30-day window (`latestUncovered` /
  `uncoveredDays`); the detail day panel says so too (`metrics.energy.uncov`, 1 / null).
- **Corrected**: the raw value stays visible — `active-energy-daily.csv` is untouched, a corrected row
  carries `watch` / `rideKcal` / `watchDuring`.
  - `aggEnergy` adds `latestCorrected` (the headline card says "includes the ride measured by the power
    meter" / `incluye la salida medida con potenciómetro`) and `correctedDays` in the 30-day window (a note).
  - The detail sheet bakes `metrics.energy.watch` (only when some day was corrected; null elsewhere) and
    shows "Active <corrected> kcal — watch 2207 + power-meter correction" (`reloj {watch} + corrección por
    potencia`) plus the note in the day panel, and the note under the header when the newest day is
    corrected.
- Enabling it on an install: rebuild the ingest image (`docker compose up -d --build loop-ingest`), add
  the Shortcut key (`docs/ios-shortcut.md`), `npm run sync -- --full` once, then `npm run generate`.

## Section notes

Section intros and caveats sit behind each section's ⓘ (`hs-info-<key>`, hidden in the DOM, so nothing is
lost). The tab intro sits behind the title's ⓘ.

| Section | ⓘ holds |
| --- | --- |
| Recovery | the good-directions / consistency note |
| Fitness | the fitness-age reference note (Loe 2013 citation, mean-based, smartwatch estimate, not medical) + a short VO₂max / walking HR note |
| Sleep | the consistency note |
| Body composition | the "How to read this" note (scale mix, bioimpedance ±3–5 %, single-scale Δ), the "n readings in the last 150 days" of body fat and lean mass, and the waist note (or how to start logging it) |
| Activity | the NEAT note |
| Energy | the power-meter notes (headline day corrected / uncovered, days in the window) and the expenditure-only caveat (`energyTdeeNote`, which points to Nutrition → Balance); the balance note lives with the balance |

## Training tab cards

`health.js` also renders `#health-train` on the Training tab, after the Activity card (`docs/training.md`).

### Running

What it shows: RECENT-RUNS list rows, newest first.

- Source: `workouts.csv` Running rows (Watch export AND `sync:strava`, via `readRuns`), merged per day
  exactly like the rides.
- Row (`HC.metricRow`): icon · the date (UPPERCASE) · the distance big on the right with time and pace =
  time / distance (none without a distance) under it. Same row budget as rides (`RECENT_SESSIONS_SHOWN`, 8).
- Text diet: no small line under the date. Avg HR, relative effort and elevation are in the row's
  `aria-label` and the day it opens; the watch running dynamics (power, GCT, vertical osc, stride) in that
  day's panel (`docs/detail-views.md`).
- Running dynamics are LEFT-joined by date from `running-daily.csv` (export.xml only): a Strava-only run
  simply has none; a dynamics-only day never adds a run; dynamics below 5 km/h (`RUN_MIN_KMH`) are walks /
  GPS garbage and are not joined.
- Count = distinct run days, in the section's ⓘ with the source notes.
- A row opens that day in `load-run`.

### Cycling

What it shows: RECENT-RIDES list rows right after Running, same style and row budget (8, newest first), so
run and bike carry equal weight.

- Source: `workouts.csv` rows of any Cycling type (Watch rides and `sync:strava` rides).
- ONE row template: nothing under the date; the distance with time (Strava moving time / Watch duration)
  and elevation gain under it, then a second small line avg HR · relative effort · kJ (`base2`; the ride's
  work is shown nowhere else, so it stays on the row). All of it also in the row's `aria-label`.
- Ride count and source notes in the section's ⓘ; a row opens that day in `load-bike`.
- Same-day merge, under the shared same-day rule (`DISPLAY_RULE`: stubs dropped, the Strava copy wins over
  a Watch copy):

| Field | Merge |
| --- | --- |
| time, distance, kJ, elevation, RE | sum |
| avg HR | duration-weighted |
| count | distinct ride days |

- Elevation / RE / kJ come from Strava only; a field the source did not record is left out of the row's
  small lines (a missing distance is a dash), never 0.
- When only one of run / bike has data, the other shows its empty-state line; with neither, both are omitted.

### Load vs recovery

What it shows: weekly cardiovascular load next to HRV and resting HR in heavy vs easy weeks
(`HEALTH.loadRecovery`, `aggLoadRecovery`), after Cycling.

- **Bars**: weekly cardiovascular-load bars (the reference's trend bars: each week's value on top, a 100 px
  track over a faint quarter grid, the first and last week under it; flat `--strain`).
  - Load = minutes × mean HR ÷ 100.
  - The last complete Monday–Sunday weeks, up to 12 (`LR_WEEKS`), complete by the calendar up to the
    Watch's newest day (`trainingThrough`), so rest days after the last session do not hold its week back.
- **Rows**: HRV and resting HR in the higher-load weeks, with the easy weeks' value as the small line and
  ▲▼• for higher-load vs easy, coloured by the signal's good direction (↑ HRV, ↓ resting HR: lower HRV in
  heavy weeks is ▼ orange — expected, the ⓘ explains what to watch).
- The index hint and the association-not-causation note sit behind the section's ⓘ.

## Build properties

- The aggregates still bake a 7-day rolling `spark` series per trend; Health does not draw it (rows only —
  the detail sheet charts the history).
- Idempotent build: no today-relative values are baked (staleness is computed client-side from the data
  dates).
- Aggregation lives in pure functions (`aggBody` / `aggActivity` / `aggEnergy` / `aggRunning` /
  `aggRecovery` + helpers `dailyTrend` / `signalTrend`), so the test suite injects synthetic series without
  touching disk.
- Locale: the personal (`LOCALE=es`) build is Spanish (es-ES dates, comma decimals); the example
  (`LOCALE=en`, `web/src/i18n/en.mjs` + `*-templates.mjs` en dicts) build is English.
