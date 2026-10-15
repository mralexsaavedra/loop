# Data pipeline — Apple Health extract, Shortcut sync, Strava sync

How the raw sources become the CSVs in `data/apple-health/extract/` that every page and analysis reads.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

**On this page**

- [Apple Health extract + iOS Shortcut sync](#apple-health-extract--ios-shortcut-sync)
  - [Apple Health export and extract](#apple-health-export-and-extract)
  - [Energy source precedence](#energy-source-precedence)
  - [The export's partial last day](#the-exports-partial-last-day)
  - [Shortcut merge into the extract](#shortcut-merge-into-the-extract)
  - [Energy hourly (`active-energy-hourly.csv`)](#energy-hourly-active-energy-hourlycsv)
  - [Heart-rate hourly (`hr-hourly.csv`)](#heart-rate-hourly-hr-hourlycsv)
  - [Module notes](#module-notes)
  - [Sleep (`sleep-daily.csv`)](#sleep-sleep-dailycsv)
- [Strava sync](#strava-sync)
  - [`rides.csv`](#ridescsv)
  - [Per-workout HR zones (`workout-zones.csv`)](#per-workout-hr-zones-workout-zonescsv)
- [Journal export (`scripts/sync-journal.mjs`, part of `npm run sync`)](#journal-export-scriptssync-journalmjs-part-of-npm-run-sync)

## Apple Health extract + iOS Shortcut sync

### Apple Health export and extract

- **Read the cached extract first**: `data/apple-health/extract/*.csv` (weight, bodyfat, rhr, vo2max,
  hrv, steps-daily, active/basal-energy-daily, dietary-daily, sleep-daily, workouts) + `_meta.json`
  (ranges, row counts, caveats).
- Regenerate after a new export is dropped: `node data/apple-health/extract.mjs` (no flags; `--help` prints the
  usage, any other argument exits 2 before reading the export).
- The raw `export.xml` is ~700 MB — only stream/grep it directly for a series not in the cache.
- **Body metrics** carry a `source` column. Weight mixes scales — compare body fat within one scale only.
- **Source cells** (`source` of the readings, steps, sleep and workouts) go through one helper,
  `csvSource` in `lib/extract/samples.mjs`, on both the export and the Shortcut path: XML entities (`&amp;`,
  `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&#NNN;`, `&#xHH;`) are decoded once, then every comma and line break becomes
  a space (the CSVs are unquoted), so `Scale, Kitchen &amp; Co` is `Scale  Kitchen & Co` from either path. A
  name with no comma, line break or entity is unchanged. An extract written before this rule keeps its old
  cells (a comma-named source shifted the columns; entities stayed encoded) until
  `node data/apple-health/extract.mjs` is re-run.
- **Steps** are deduped to max-per-device per day. Summing devices double-counts (it inflates the NEAT
  figure).

### Energy source precedence

Active / basal energy: per DAY and type ONE source wins and only its sum is written, never a sum
across sources (each device / app writes its own estimate of the same burn; RENPHO's weigh-in BMR
as Basal Energy doubled basal). Precedence lives in `lib/extract/samples.mjs` `energySource` / `pickEnergySource`:

| Rank | Source | Match |
| --- | --- | --- |
| 1 | Apple Watch | `APPLE_WATCH_RE`, the same anchored `/^Apple\s+Watch\b/i` as `sessions.mjs` (pinned by a test) |
| 2 | A dedicated wrist-wearable app | `ENERGY_WEARABLES`: Zepp / Zepp Life, Mi Fit / Mi Fitness, Amazfit, Garmin Connect, Polar Flow, Fitbit, Huawei Health (older history from another app, e.g. before an Apple Watch, is covered too) |
| 3 | The iPhone | `/^iPhone\b/i` |
| — | Everything else: EXCLUDED | Scales (RENPHO, OKOK, Withings / Health Mate, which serves both scales and watches) and training / nutrition apps (Hevy, Nike *, Strava, YAZIO, Merge, Training, ROXFIT…) |

- Two sources of one rank on a day → the larger total (then name ascending).
- A day with excluded sources only has NO row.
- `_meta.json` `energySources` = days won per family and type
  (`{active: {"Apple Watch": n, "Zepp": n, "iPhone": n}, basal: {…}}`).

### The export's partial last day

- The export's LAST date is a PARTIAL day (`export.xml` is taken mid-day).
- `_meta.json` `exportLastDate` = `<ExportDate>`, else the newest record date.
- The daily TOTAL series (steps, active / basal energy, exercise, distance, flights, dietary) skip it;
  means, points, sleep and workouts keep it.
- These rules need a re-run of `node data/apple-health/extract.mjs` on the export to take effect.
- The Shortcut sync takes over that date for daily totals (see below).

### Shortcut merge into the extract

Between exports, `npm run sync` (`data/apple-health/sync-shortcut.mjs`) pulls iOS Shortcut payloads
from the optional `services/loop-ingest` service (`GET /export/raw`) and merges
hrv/rhr/vo2max/weight/bodyfat/leanmass/waist/steps/energy/dietary/sleep/respiratory/walking-HR/
wrist-temp/hr-recovery/exercise/distance/flights into those CSVs. How to build the Shortcut and every
payload key: [`docs/ios-shortcut.md`](ios-shortcut.md) — keep its key table in sync with the `METRICS`
table.

**Export vs Shortcut**

- Export rows win. Shortcut rows are rebuilt each run and fill only dates the export lacks — so re-run
  sync after `extract.mjs`.
- EXCEPT the export's partial last day: for a daily-total metric (`total: true` in `METRICS`)
  `exportLastDate` is treated like a sync-owned date. The Shortcut total wins it, and the export row is
  dropped when there is none (a 971-step / 1-min export morning never beats a complete Shortcut day).

**Incremental cache and tagging**

- Sync is incremental: a local gitignored `extract/.shortcut-cache.json` of deduped samples + the last
  payload id. `npm run sync -- --full` rebuilds it (needed once after adding a key, since the
  incremental sync only parses payloads newer than the cache).
- Payloads (and Strava activities) are fetched in keyset pages (`fetchPages` in `sync-common.mjs`): a full
  page whose last id is missing or not greater than the previous `since_id` stops the sync with
  `unexpected paging cursor`, and 10 000 pages is a hard cap, so a misbehaving service can never loop it.
- Rows are tagged `source=Shortcut`, except body comp (keeps the real scale source for the
  latest-source logic) and energy (no source column).
- `_meta.json` `shortcutSync.owned` lists every date sync wrote, per CSV. It is written FIRST (before the CSVs and the
  cache), like the Strava sync's: a crash mid-write leaves a ledger that already owns those dates, so the next
  run drops and rebuilds the Shortcut rows instead of keeping them as export rows.

**Point keys** (one row per sample)

- `rhr` is deduped by TIMESTAMP only: Apple rewrites the day's RHR at the same stamp; the latest
  payload wins; an older cache is re-keyed in place.
- `weight` takes an optional 3rd field (the scale / app), kept as the row's source like `bodyfat`
  (no field → `Shortcut`).
- Phantom weights (`dropPhantomWeights`): a weight stamped EXACTLY 00:00:00 local or 00:00:00 UTC
  (e.g. `02:00:00+02:00`) with no body-fat sample (any source) within ±10 min is dropped as a phantom
  date-only entry (the Health profile weight / a manual entry without a time). A smart scale writes
  body fat with every weigh-in, so a real weigh-in is kept.
- `bodyfat` accepts a fraction (`0.184`) or a percent (`18.4`).
- `waist` accepts cm, or metres (`0.84`), which it converts. The metres check (value below 3) cannot
  tell inches from cm, so `33` in would be stored as 33 cm.

**Day totals** (one row per day)

- The latest payload wins a day.
- Each payload's oldest (window-truncated) day is ignored: a "last N days" query starts mid-day, so
  that day is partial. The four `diet_*` keys share one oldest day, since they fold into one row.
- A `0` on `respiratory` / `walking_hr` (from *Fill Missing*) means no data.
- Steps = MAX of the per-device day totals (`steps_watch`, `steps_phone`; source
  `Shortcut Watch` / `Shortcut iPhone`), mirroring max-per-device. A merged iOS `steps` total sums the
  devices (double-counts), so that key is ignored.
- Dietary: the four `diet_*` keys become one row per day. A day without `diet_kcal`, or with 0 kcal,
  is skipped; a missing macro stays blank.
- `exercise_watch` / `distance_watch` / `flights_watch` = Watch-filtered day totals →
  `exercise-minutes-daily.csv` / `distance-daily.csv` / `flights-daily.csv`. Same daily-total rules;
  a 0 day = no data, like the export.

**Parsing values**

- Decimal commas (`42,1`) are accepted.
- Distance is stored in km, accepting a `km` / `m` / `mi` unit (`6.2`, `6200 m`, `3.9 mi`). A bare
  number > 100 is read as metres (`100` = 100 km, `101` = 101 m).
- With both separators the last one is the decimal (`1.234,5 m`); a repeated single separator
  (`1.234.567`) is rejected.
- Counts (steps, flights, exercise minutes) are whole numbers, so one kind of separator followed by
  exactly three digits is a thousands group: `12.345` / `12,345` steps = 12 345, `1.234.567` = 1 234 567
  (`12,5` is still 12.5).

**Sleep**: only asleep stages build the night (rules under [Sleep](#sleep-sleep-dailycsv)); a segment
starting after 18:00 belongs to the next morning's night.

### Energy hourly (`active-energy-hourly.csv`)

`active_energy_hourly` (Watch-only Active Energy, Group by HOUR, 3 days) → `active-energy-hourly.csv`.

| Column | Meaning |
| --- | --- |
| `date` | Date |
| `hour_start` | The hour start as ISO with offset (the payload stamps the hour's first sample, e.g. `2030-01-02T09:07:12+01:00;275.3`) |
| `kcal` | Active energy in that hour |
| `source` | `Shortcut` |

- One row per clock hour, keyed by local hour + offset, so a DST fall-back night keeps both 02:00 hours.
- Each payload's oldest, window-truncated HOUR is dropped; the latest payload wins an hour.
- Tagged `Shortcut`, so every row is rebuilt each run — the export never writes this file.
- It only feeds the power-meter ride correction (Health tab → Energy): the Watch's energy during the
  ride hours is replaced by the ride's power-based energy (Strava kJ), never lowering a day.

### Heart-rate hourly (`hr-hourly.csv`)

**Input.** `hr_t` + `hr_v` (Watch Heart Rate, NO grouping, 1 day) or the older `hr_samples`
(`ISO;bpm` lines); a payload may carry both, and they are unioned.

- `hr_t` / `hr_v` are two parallel lists of Start Dates and Values, zipped by line number.
- A value's leading number is the bpm (`72`, `72 count/min`, `72 lpm` or `72,5`).
- Lists of different lengths are dropped whole with a sync `WARNING`, never mis-paired. A blank line
  counts unless it is blank in both.
- Samples are deduped by their exact instant across payloads (the later payload wins) and must be
  25–240 bpm.
- The raw samples stay in the local cache; the CSV is rebuilt every run from the whole cache.

**Output** (`lib/health/hr-hourly.mjs`): one row of aggregates per clock hour, keyed by local hour +
offset (like the energy hours).

| Column | Meaning |
| --- | --- |
| `date`, `hour_start` | Date and hour start (ISO with offset) |
| `avg`, `max`, `min`, `n` | Aggregates of the hour's samples |
| `covered_min` | Each sample covers the time until the next sample, at most 10 min (the newest covers nothing), all of it in the hour the sample falls in |
| `act_min` | The part of `covered_min` inside a Strava activity window (`workout-zones.csv` `start` + `elapsed_s`) |
| `hist` | Covered seconds per whole bpm outside activities (`bpm:s` pairs, space-separated; < 50 bpm omitted: always zone 0) |
| `source` | The row's source |

- The activity exclusion is why `npm run sync` runs the Strava sync BEFORE the Shortcut sync.
- Readers: day strain (`lib/score/strain.mjs`, `analysis/methodology.md`) reads `hist`; the stress
  estimate (`lib/score/stress.mjs`) reads `avg`, `covered_min`, `act_min` and `hist` per waking hour.
- The older `hr_hourly` key (hourly sums) is ignored.

### Module notes

- Unreachable service → the sync exits non-zero without touching files.
- Row helpers are shared in `lib/extract/samples.mjs`, so both paths (extract and sync) format rows identically.
- Every sync script (`data/apple-health/sync-*.mjs`, `data/nutrition/sync-foodlog.mjs`,
  `data/profile/sync-*.mjs`, `scripts/sync-*.mjs`) shares `sync-common.mjs`: `fetchJson` (one timed GET),
  `writeAtomic` (temp file + rename), the service `.env` (`INGEST_ENV_FILE` when set, else
  `services/loop-ingest/.env`, for `INGEST_TOKEN` / `INGEST_PORT`) and one command line (`parseCli` /
  `runCli`): `--help` prints the usage and exits 0; an unknown flag or a stray argument prints `ERROR:` +
  the usage and exits 2 before any request or write; a failure `main` did not handle prints one `ERROR:`
  line and exits 1. Each script's exported `main` returns its exit code (never `process.exit`) and takes its
  `env`, `log`, `error`, `fetchImpl` and output dir as injectable options, so a test calls it in-process. The
  Shortcut and Strava syncs share `_meta.json` under one lockfile (`withLock`, `_meta.json.lock` holding the
  pid): it is released only by the process whose pid it holds, and a lock older than 2 min is reclaimed by
  an atomic rename that only one process can win (a fresh lock that took its place is put back). The
  food-log sync warns `unexpected response` for a body it cannot read (the service was reached) and
  `could not read the food log` when the service is not. Only the Shortcut sync takes a flag (`--full`); `npm run sync -- --full` passes it to
  that script alone.
- `extract.mjs` runs only as the entry point (`isMain`), and writes every CSV and `_meta.json` atomically.
- `writeAtomic` (`sync-common.mjs`) writes a `.tmp` next to the file and renames it; a failed write or rename
  removes the `.tmp` (it holds personal data) before the error goes up.

### Sleep (`sleep-daily.csv`)

`date,asleep_hours,source,bedtime,waketime,rem_h,deep_h,core_h,unspec_h,awake_h,inbed_h`, one row
per wake-up night, written identically by `extract.mjs` and the Shortcut sync (`samples.mjs`
`sleepNights` / `sleepRow`).

- Only ASLEEP segments (Core / Deep / REM / Asleep-unspecified, English or Spanish Shortcut names) build
  the night: blocks under 60 min apart, the main sleep inside 20:00–12:00, naps excluded, max minutes
  across sources per night.
- `asleep_hours` (the union of the main sleep's asleep intervals) and `bedtime` / `waketime` (first
  asleep start / last asleep end, decimal local hour) are unchanged by the stage columns.
- Awake / InBed records never create a night or make a source win.

Stage columns (hours, blank = unknown):

| Column | Meaning |
| --- | --- |
| `rem_h` / `deep_h` / `core_h` | The winning source's main-sleep minutes per stage; blank on an unstaged night (Asleep-unspecified only) |
| `unspec_h` | Asleep-unspecified (and pre-iOS 16 `Asleep`) minutes — older Watch data and third-party trackers (Zepp, Mi Fit), kept separate, not folded into core |
| `awake_h` | That source's Awake records clipped to the sleep window (bedtime → waketime) |
| `inbed_h` | The sleep window united with ANY source's overlapping InBed records (the iPhone writes InBed from the bedtime schedule, the Watch never does), so without an InBed record it is the window itself (asleep + the awake time inside it) |

- Readers (`lib/health/read.mjs` `readSleep`) are positional: five-column rows (without the stage
  columns) read the stages as `null`.
- Stages need `node data/apple-health/extract.mjs` on a new export (history) and
  `npm run sync -- --full` (Shortcut nights already cached).

## Strava sync

**`npm run sync:strava`, part of `npm run sync`.** Pulls every activity the ingest service
(`services/loop-ingest`) has stored from Strava via `GET /export/strava` and merges translated rows
into `workouts.csv`, tagged `source=Strava API`, so a ride logged only on Strava (no Watch record)
still shows up.

**Type mapping**

- Cycling-family sport types (incl. e-bike and virtual/indoor rides) all translate to the same
  `Cycling` type as Apple Health uses, so they land in the `bike` modality.
- Racket, team and outdoor sports map to the Apple type the Watch writes (Tennis, Squash, Badminton,
  Pickleball, Soccer, Basketball, Volleyball, Golf…; Padel keeps its name), all in the `other`
  modality, so a Watch Tennis row and a Strava Tennis row merge into ONE session (pinned by a test).
- Strava's generic `Workout` maps to `Other`, the Watch's generic label that stays in `GYM_TYPES`
  (the user's gym / metcon label).
- An unknown sport falls back to `Unmapped` (→ `other`, never gym) and is listed in `_meta.json`
  `stravaSync.unmapped`.

**Merge and dedupe**

- Strava rows are ALWAYS kept, also on dates the export covers (Strava is the only source of Relative
  Effort, kJ and elevation). They are rebuilt each run and removed only by their `Strava API` tag.
- Dedupe happens at READ time: every workouts.csv reader goes through `lib/training/sessions.mjs`
  `mergeSameDay`, which keeps ONE source per date + physical modality (Inicio's gym / run / bike /
  other).
- Source order: "Strava API" > "Strava" (the Strava app's HealthKit copy) > Apple Watch > any other
  app, when the winner covers at least half of the loser's minutes (`SUPERSEDE_MIN_COVERAGE`); lower
  coverage = a different session, both counted.

**Accepted limitations**

- A Strava activity deleted upstream is never removed from the local CSV (ingest never deletes).
- An edit made more than 7 days ago is never picked up (the ingest service's Strava loop only re-reads
  a 7-day overlap window).
- `GET /export/strava` requires an ingest image rebuild/restart
  (`docker compose up -d --build loop-ingest`) — an un-rebuilt image answers `404` and the sync exits
  non-zero with a message saying so, touching no files.

### `rides.csv`

The same pull writes `rides.csv` (gitignored, rebuilt from scratch every run, one row per
cycling-family activity):

| Column | Meaning |
| --- | --- |
| `date` | Date |
| `start` | The local start as ISO WITH its UTC offset (Strava `start_date_local` − `start_date`) |
| `elapsed_s` | Elapsed time (moving time when absent) |
| `kilojoules` | Strava kJ |
| `device_watts` | `true` only for a real power meter |
| `source` | The row's source |

- A separate file, not new workouts.csv columns: the window is Strava-only data with one reader (the
  energy correction), so extract.mjs, the positional workouts readers and the demo generator stay
  untouched.
- It needs `start_utc` + `device_watts` from `GET /export/strava` (an ingest image rebuild). An older
  image leaves `start` / `device_watts` blank, the sync prints a stale-image warning, and no ride
  corrects anything.
- `_meta.json`: `rows.rides` and `stravaSync.rides` = `{rows, power (device_watts true + kJ), withStart
  (start with offset)}`, plus a sentence in the Strava sync note.

### Per-workout HR zones (`workout-zones.csv`)

The same pull writes `workout-zones.csv` (gitignored, rebuilt from scratch every run, sorted by local
start; readers are positional):

`date,activity_id,type,max_hr,max_hr_source,hr_avg,hr_max,z0_s,z1_s,z2_s,z3_s,z4_s,z5_s,source,start,elapsed_s`

- `type` = the workouts.csv type.
- `start` = local ISO start with its offset, blank when the ingest image does not export `start_date`;
  `elapsed_s` = elapsed, else moving time. Together they are the activity window `hr-hourly.csv`
  leaves out (day strain).
- Built from the per-activity HR histogram `hr_hist` (seconds per whole bpm) that the ingest service
  builds from Strava's HR streams (`services/loop-ingest/README.md` "Per-workout HR zones": at most 10
  streams per sync run, newest first, so a long history fills in over a few days).

Zone model (`lib/training/hr-zones.mjs`, the reference's), % of max HR:

| Zone | Z0 | Z1 | Z2 | Z3 | Z4 | Z5 |
| --- | --- | --- | --- | --- | --- | --- |
| % max HR | < 50 % | 50–60 | 60–70 | 70–80 | 80–90 | ≥ 90 % (above the max counts as Z5) |

- The lower bound is inclusive and the comparison exact (no rounding).
- Max HR = `profile/profile.json` `maxHr` when set (source `profile`, read by `lib/profile/read.mjs`
  `readProfileMaxHr`; an invalid value is warned about and ignored), else the highest Strava
  `max_heartrate` of the 365 days ending at the newest activity (source `observed`; anchored to the
  data, not the clock, so a re-run writes the same bytes). Every row records the max HR it used.
- Because the zones are cut locally from the histogram, a new max HR re-cuts every workout on the next
  sync with no Strava call.
- Back-compat: an activity without `hr_hist` (not fetched yet, no HR) has no row; an ingest image
  without the field at all prints a stale-image warning and the file is not created; a missing file =
  no zones on the page.
- `_meta.json`: `rows['workout-zones']` and `stravaSync.zones = {rows, maxHr, maxHrSource}`.
- Strava's own athlete HR zones (`GET /athlete/zones`, needs `profile:read_all`) are an alternative
  that is NOT used, so the page keeps one documented model.

## Journal export (`scripts/sync-journal.mjs`, part of `npm run sync`)

The behaviour journal the LAN page writes (`docs/journal.md`) is snapshotted into the extract so the
build (`lib/journal/bake.mjs`: the My journal card's checks and the behaviour insights) and read-only
consumers never query Postgres.

- `GET <INGEST_URL>/journal/summary` (header `X-HC-Journal: 1`) for the last 366 days ending on the
  local date → `data/apple-health/extract/journal-daily.csv` (gitignored with the extract).
- Header `date,<behaviour keys…>,notes`, one row per journaled day: `1` / `0` for a yes / no behaviour,
  the drinks count as is, blank = not answered, the note quoted (`lib/journal/journal.mjs`
  `journalCsv` / `parseJournalCsv`).
- Columns are read by header NAME: a behaviour missing from an older file is unanswered, and a column
  this version does not know is kept (written back after the behaviours) but never read as a behaviour.
- Inside the window the server wins (an emptied day disappears); older rows are kept.
- `journal-daily.meta.json` = `{from, to, days, fetchedAt}` (its own file, never `_meta.json`).
- An unreachable / old service (404, 503, 421, 429, a malformed body) = one `WARNING:` line, the old
  files kept, exit 0; only a failed write exits 1.
- The demo extract carries a synthetic `journal-daily.csv` from `scripts/make-demo-data.mjs`.
