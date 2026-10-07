# Health tab — Salud

Body composition, activity, energy (incl. the power-meter ride correction), running / cycling tables, recovery and sleep.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Health tab — "Salud / Health" body & recovery pipeline

`lib/health/{read,stats,aggregate}.mjs` (same single-source pattern) compute the stacked sections
from the Apple Health extract CSVs (all OPTIONAL — absent CSVs render an empty state, never fail the
build); `web/src/client/health.js` renders them into TWO hosts, each with its own empty state and
its own try/catch (a throw in one half renders that half's empty state, never blanks the other):
`#health-body` (Salud, under the health monitor list `#monitor` that leads the tab — `client/monitor.js`,
see `docs/home-tab.md` "Health monitor": recovery with `#score-recovery` right under its heading, sleep, body composition,
activity, energy — in that order) and `#health-train` (Entreno: running, cycling, load vs recovery).

**Today first.** Every trend card's headline is the NEWEST value with its date (a daily total dated
the viewer's today reads "today, so far" / "hoy, en curso", decided client-side); the 30-day mean
(`avg30`, `avg30Of`: mean of the daily values over the last 30 days — for the daily TOTALS of
`dailyTrend` the 30 days ending the day BEFORE the latest, since the build cannot know whether that
day is complete) and the Δ (`d30Of`) form the context line under it; a non-finite value is never
printed and a card that throws is skipped, never blanking the tab; a card whose newest value is
more than `STALE_DAYS` (3) before the viewer's today is greyed (`mtrend-stale`) with a "sin datos
recientes" / "no recent data" note, decided client-side like the monitor and the dials (waist, dated
in its title, is exempt: a sparse manual measurement);
sparklines are unchanged (7-day rolling). HRV's headline is the newest DAY's mean; sleep's is last night (`sleep.latest`), with the 30-night mean as context;
expenditure's is the newest day's TDEE (`tdeeLatest`; a day counts only with BOTH active and basal energy, never basal alone). Each recovery trend carries an `hl-<key>`
anchor for Inicio's health monitor.

- **Body composition** — `weight.csv` + `bodyfat.csv` + `leanmass.csv`. Weight trend is a 7-day
  rolling average (it mixes scales/apps, so the raw series is noisy). Body fat and lean mass use
  ONLY the most recent source and are flagged bioimpedance ±3–5%. IMPORTANT: the source tag does
  NOT isolate a scale switch (the same app re-tags an old scale's readings, which can show as an
  overnight jump of several points), so their Δ + sparkline use only the last `BODYCOMP_WINDOW` (150) days
  to avoid celebrating that artifact as real change.
  **Waist** (`waist.csv`, cm; written by extract.js from `WaistCircumference` and by the
  Shortcut `waist` key) is a sparse manual tape measurement: every reading is a point (no rolling
  average), the headline carries its measurement date, Δ = latest vs first. No waist data → the
  section shows a hint on how to start logging it instead.
- **Activity (NEAT + movement)** — `steps-daily.csv` (NEAT), `exercise-minutes-daily.csv`,
  `distance-daily.csv`, `flights-daily.csv`. Each is a daily total → latest day (headline) + 30-day
  average and Δ vs the prior 30 days (context), 7-day rolling sparkline (generic `dailyTrend`). All four are deduped
  max-per-device by extract.js (iPhone + Watch overlap → summing double-counts, like steps);
  near-zero step/distance days (device not carried) are dropped as missing data.
- **Energy** — `active-energy-daily.csv` + `basal-energy-daily.csv` give expenditure (TDEE,
  7-day rolling); `dietary-daily.csv` gives intake AND the macro split (protein/carbs/fat, g + %
  kcal). Data honesty: intake logging is sparse and abandoned, so the balance (deficit/surplus)
  AND the macro split are shown ONLY when intake was logged within the last 14 days of the newest
  expenditure day and ≥7 logged days exist in the 90 days ending at that day; otherwise
  the page shows expenditure alone and says intake can't be scored. Implausible basal readings
  (double-counts / no-wear) are dropped via a sane band.
  **Power-meter ride correction** (`lib/health/ride-energy.mjs`, `readActiveEnergy` = the ONE active-
  energy reader of the Salud card AND the detail sheet's `energy`): a ride a bike computer recorded
  with a power meter, and the Watch did not, is under-counted by the Watch's Active Energy (real
  case: 2,311 kJ ride, Watch 1,821 kcal over the ride hours). Corrected active(day) = Watch day total
  − Watch energy during the ride + ride kJ × `KJ_TO_KCAL` (1.0: 1 kcal = 4.184 kJ × ~24 % gross
  efficiency ≈ 1 kJ mechanical). Watch-during-ride = the `active-energy-hourly.csv` buckets
  overlapping the ride window [start, start + elapsed], each spanning its clock hour and prorated by
  overlap minutes; everything compared as instants (DST- and host-timezone-safe); a ride crossing
  midnight splits its energy by time across the two local days, each midnight placed with the
  offset of that day's 00:00 bucket (the ride's offset only without one); overlapping power rides
  (a duplicate upload, a nested ride) are clustered by interval union and count once, the largest
  kJ wins. The Watch day in the formula = max(daily row, sum of that day's hourly buckets): the
  buckets are parts of the same Watch's day, so a daily row below their sum is a stale payload and
  would otherwise understate the result. Applied ONLY when: the ride (`rides.csv`) has
  kJ > 0 AND `device_watts === true` (a blank flag = an old ingest image = no correction; Strava's
  estimated watts never count), a start with offset and an elapsed time; the hourly buckets cover
  the WHOLE window (one missing hour = no correction, and the day is flagged `uncovered`: the Salud
  card says "salida con potenciómetro sin corregir: faltan datos por horas del reloj" on such a
  headline day + a note counting them in the 30-day window (`latestUncovered` / `uncoveredDays`), the
  detail day panel says so too (`metrics.energy.uncov`, 1 / null)); the day has a Watch total; and the corrected
  value is HIGHER (never lowers a day, so a Watch-recorded ride stays as measured). Café stops inside
  the elapsed window are replaced too (small, conservative). The raw value stays visible:
  active-energy-daily.csv is untouched, a corrected row carries `watch` / `rideKcal` /
  `watchDuring`; `aggEnergy` adds `latestCorrected` (the headline card says "incluye la salida
  medida con potenciómetro") and `correctedDays` in the 30-day window (a note); the detail sheet bakes
  `metrics.energy.watch` (only when some day was corrected; null elsewhere) and shows "Activa <corrected> kcal
  — reloj 2207 + corrección por potencia" plus the note in the day panel, and the note under the
  header when the newest day is corrected. Nutrition / Inicio read no TDEE. Rollout: rebuild the
  ingest image (`docker compose up -d --build health-ingest`), add the Shortcut key
  (`docs/ios-shortcut.md`), `npm run sync -- --full` once, then `npm run generate`.
- **Running** — `workouts.csv` Running rows (Watch export AND `sync:strava`, via `readRuns`), merged
  per day exactly like the rides, as a RECENT-RUNS table (same row budget, newest first): date,
  distance, time, pace = time / distance (none without a distance), avg HR, relative effort,
  elevation, then the watch running dynamics (power, GCT, vertical osc, stride) LEFT-joined by date
  from `running-daily.csv` (export.xml only — a Strava-only run shows dashes there; a dynamics-only
  day never adds a run; sub-5 km/h dynamics are walks / GPS garbage and are not joined). Count =
  distinct run days.
- **Cycling** — `workouts.csv` rows of any Cycling type (Watch rides and `sync:strava` rides), shown
  right after Running as a RECENT-RIDES table with the same style and row budget (8, newest first) so
  run and bike carry equal weight: date, distance, time (Strava moving time / Watch duration),
  elevation gain, avg HR, relative effort, kJ, plus the ride count. Same-day rows merge into ONE ride
  under the shared same-day rule (`DISPLAY_RULE`: stubs dropped, the Strava copy wins over a Watch copy): sums
  for time/distance/kJ/elevation/RE, duration-weighted avg HR, and the count is distinct ride days. Elevation / RE / kJ come from
  Strava only; a field the source did not record renders as a dash, never 0. When only one of run /
  bike has data, the other shows its empty-state line; with neither, both are omitted.
- **Recovery** — `rhr.csv`, `hrv.csv` (both as the clamped per-day MEDIAN, `score/recovery.mjs`
  `dailySignal`, the same series Inicio's recovery and monitor use), `vo2max.csv`, `sleep-daily.csv`,
  `respiratory-daily.csv`, `wristTemp.csv`, `walking-hr-daily.csv`. Good directions stated on
  screen (↓ resting/walking HR, ↑ HRV, ↑ VO₂max; respiratory & sleeping wrist temp are change-
  not-absolute signals). Sleep adds CONSISTENCY: % of nights ≥ `SLEEP_TARGET` (7.5 h), night-to-
  night spread (sd), and bedtime/wake-time regularity (median ± a ROBUST sd = 1.4826 × MAD, in
  minutes; after-midnight bedtimes wrapped onto a night scale). Sleep bedtime/waketime come from the
  extended `sleep-daily.csv`: extract.js and sync-shortcut.js share `samples.js` `sleepNights`, which
  keeps only the MAIN sleep of each wake-up night (asleep segments chained with gaps < 60 min; the
  longest block whose midpoint falls 20:00-12:00, plus in-window blocks within 3 h of it when they lie
  before it or start before 05:00 on the wake-up date, so a split night with a 3 am wake-up stays one
  night, but within only 60 min when they start after the night's end from 05:00 on AND end at or
  after 10:00 (`AFTER_END_GAP_MIN`), so a 09:00–10:30 nap after a 06:30 wake-up or an afternoon nap
  is not absorbed; a block after the end that ENDS before 10:00 (`FALL_BACK_END_HOUR`) is falling
  back asleep after an early wake-up and joins within 3 h (23:59–03:19 + 05:08–07:32 = one night).
  Accepted trade-off (pinned by a test): a real morning nap that ends before 10:00 within 3 h of the
  wake-up (06:30 wake, 07:30–09:30 nap) now JOINS the night too — the data cannot tell it apart from
  falling back asleep (no awake / stage context beyond the gap). Naps (incl. one that
  crosses 18:00) add neither minutes nor bed/wake times; a nap-only day has no row. Sleeping wrist
  temperature is dated by the same midpoint + 18:00 roll-over rule as a sleep block (`wristTempDate(start,
  end)`; a Shortcut sample with only a start falls back to its start). Known limitation: night-shift
  sleep (a daytime main sleep) falls outside the 20:00-12:00 window and is treated as a nap. No
  migration: rows of `sleep-daily.csv` / `wristTemp.csv` that came from an earlier export keep the old
  convention until `node data/apple-health/extract.js` is re-run on a new export (Shortcut rows are
  rebuilt by every sync). Sleep renders
  as its own Salud section; its heading is the `#hl-sleep` anchor.

Trends render as inline SVG sparklines (CSP-safe). The build is idempotent — no today-relative
values are baked (staleness is computed client-side from the data dates). Aggregation lives in
pure functions (`aggBody`/`aggActivity`/`aggEnergy`/`aggRunning`/`aggRecovery` + helpers
`dailyTrend`/`signalTrend`) so the test suite injects synthetic series without touching disk. The
personal (`LOCALE=es`) build is localized to Spanish (es-ES dates, comma decimals); the example
(`LOCALE=en`, `web/src/i18n/en.mjs` + `*-templates.mjs` en dicts) build is English.
