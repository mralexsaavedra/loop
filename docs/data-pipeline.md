# Data pipeline — Apple Health extract, Shortcut sync, Strava sync

How the raw sources become the CSVs in `data/apple-health/extract/` that every page and analysis reads.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Apple Health extract + iOS Shortcut sync

- Apple Health: **read the cached extract first** — `data/apple-health/extract/*.csv`
(weight, bodyfat, rhr, vo2max, hrv, steps-daily, active/basal-energy-daily,
dietary-daily, sleep-daily, workouts) + `_meta.json` (ranges, row counts, caveats).
Regenerate after a new export is dropped: `node data/apple-health/extract.js`. The
raw `export.xml` is ~700 MB — only stream/grep it directly for a series not in the
cache. Caveats: body metrics carry a `source` column (weight mixes scales — compare
body fat within one scale only); steps are deduped to max-per-device per day (summing
devices double-counts — summing inflates the NEAT figure). Active / basal energy: per DAY and
type ONE source wins and only its sum is written, never a sum across sources (each device / app
writes its own estimate of the same burn; RENPHO's weigh-in BMR as Basal Energy doubled basal).
Precedence (`samples.js` `energySource` / `pickEnergySource`): 1. Apple Watch (`APPLE_WATCH_RE`,
the same anchored `/^Apple\s+Watch\b/i` as `sessions.mjs`, pinned by a test); 2. a dedicated
wrist-wearable app (`ENERGY_WEARABLES`: Zepp / Zepp Life, Mi Fit / Mi Fitness, Amazfit, Garmin
Connect, Polar Flow, Fitbit, Huawei Health — the owner's pre-Watch history came from Zepp and Mi
Fit); 3. the iPhone (`/^iPhone\b/i`); everything else is EXCLUDED — scales (RENPHO, OKOK,
Withings / Health Mate, which serves both scales and watches) and training / nutrition apps
(Hevy, Nike *, Strava, YAZIO, Merge, Training, ROXFIT…). Two sources of one rank on a day → the
larger total (then name ascending). A day with excluded sources only has NO row. `_meta.json`
`energySources` = days won per family and type (`{active: {"Apple Watch": n, "Zepp": n,
"iPhone": n}, basal: {…}}`). The export's LAST date is a
PARTIAL day (export.xml is taken mid-day): `_meta.json` `exportLastDate` = `<ExportDate>`, else
the newest record date, and the daily TOTAL series (steps, active / basal energy, exercise,
distance, flights, dietary) skip it (means, points, sleep and workouts keep it). These need a
re-run of `node data/apple-health/extract.js` on the export to take effect.
Between exports, `npm run sync` (`data/apple-health/sync-shortcut.js`; how to build the Shortcut and
every payload key: `docs/ios-shortcut.md` — keep its key table in sync with the `METRICS` table) pulls iOS Shortcut
payloads from the optional `services/health-ingest` service (`GET /export/raw`) and merges
hrv/rhr/vo2max/weight/bodyfat/leanmass/waist/steps/energy/dietary/sleep/respiratory/
walking-HR/wrist-temp/hr-recovery/exercise/distance/flights into those CSVs: export rows win,
Shortcut rows are rebuilt each run and fill only dates the export lacks — so re-run sync after
`extract.js`. EXCEPT the export's partial last day: for a daily-total metric (`total: true` in
`METRICS`) `exportLastDate` is treated like a sync-owned date — the Shortcut total wins it, and
the export row is dropped when there is none (a 971-step / 1-min export morning never beats a
complete Shortcut day). `exercise_watch` / `distance_watch` / `flights_watch` = Watch-filtered
day totals → `exercise-minutes-daily.csv` / `distance-daily.csv` / `flights-daily.csv` (same
daily-total rules; a 0 day = no data, like the export; distance stored in km, accepting a
`km` / `m` / `mi` unit, a bare number > 100 read as metres). `rhr` is deduped by TIMESTAMP only
(Apple rewrites the day's RHR at the same stamp; the latest payload wins; an older cache is
re-keyed in place). `weight` takes an optional 3rd field (the scale / app), kept as the row's
source like `bodyfat` (no field → `Shortcut`); a weight stamped EXACTLY 00:00:00 local or
00:00:00 UTC with no body-fat sample (any source) within ±10 min is dropped as a phantom
date-only entry (`dropPhantomWeights`: the Health profile weight / a manual entry without a
time; a smart scale writes body fat with every weigh-in). Sync is incremental (local gitignored `extract/.shortcut-cache.json` of deduped
samples + last payload id; `npm run sync -- --full` rebuilds it). Daily totals: the latest
payload wins, and each payload's oldest (window-truncated) day is ignored. They are tagged `source=Shortcut` except body comp (keeps the real scale source
for the latest-source logic) and energy (no source column); `_meta.json` `shortcutSync.owned`
lists every date sync wrote. Shortcut steps = MAX of per-device day totals (`steps_watch`,
`steps_phone`; source `Shortcut Watch`/`Shortcut iPhone`), mirroring max-per-device — a
merged iOS `steps` total sums the devices (double-counts), so that key is ignored.
`active_energy_hourly` (Watch-only Active Energy, Group by HOUR, 3 days) → `active-energy-hourly.csv`
(`date,hour_start,kcal,source`, one row per clock hour, `hour_start` = the hour start as ISO with
offset; keyed by local hour + offset so a DST fall-back night keeps both 02:00 hours; each
payload's oldest, window-truncated HOUR is dropped and the latest payload wins an hour; tagged
`Shortcut`, so every row is rebuilt each run — the export never writes this file). It only feeds
the power-meter ride correction (Health tab → Energy).
`hr_samples` (Watch Heart Rate, NO grouping, 1 day; `docs/ios-shortcut.md`) →
`hr-hourly.csv` (`date,hour_start,avg,max,min,n,covered_min,act_min,hist,source`; `lib/health/hr-hourly.cjs`).
Samples are deduped by their exact instant across payloads (the later payload wins) and must be
25–240 bpm; the raw samples stay in the local cache, the CSV holds one row of aggregates per clock
hour (keyed by local hour + offset, like the energy hours), rebuilt every run from the whole cache.
Each sample covers the time until the next sample, at most 10 min (the newest covers nothing),
all of it in the hour the sample falls in: `covered_min`. The part inside a Strava activity window
(`workout-zones.csv` `start` + `elapsed_s`) is `act_min` and is left out of `hist` = covered
seconds per whole bpm (`bpm:s` pairs, space-separated; < 50 bpm omitted: always zone 0). That
exclusion is why `npm run sync` runs the Strava sync BEFORE the Shortcut sync. Day strain
(`lib/score/strain.mjs`, `analysis/methodology.md`) reads `hist`; the stress estimate
(`lib/score/stress.mjs`) reads `avg`, `covered_min`, `act_min` and `hist` per waking hour; the older `hr_hourly` key
(hourly sums) is ignored.
Unreachable service → exits non-zero without touching files. Row helpers are shared in
`samples.js`, so both paths format rows identically.

### Sleep (`sleep-daily.csv`)

`date,asleep_hours,source,bedtime,waketime,rem_h,deep_h,core_h,unspec_h,awake_h,inbed_h`, one row
per wake-up night, written identically by `extract.js` and the Shortcut sync (`samples.js`
`sleepNights` / `sleepRow`). Only ASLEEP segments (Core / Deep / REM / Asleep-unspecified, English or
Spanish Shortcut names) build the night: blocks under 60 min apart, the main sleep inside 20:00–12:00,
naps excluded, max minutes across sources per night. `asleep_hours` (the union of the main sleep's
asleep intervals) and `bedtime` / `waketime` (first asleep start / last asleep end, decimal local hour)
are unchanged by the stage columns. Stage columns (hours, blank = unknown):

- `rem_h` / `deep_h` / `core_h`: the winning source's main-sleep minutes per stage; blank on an
  unstaged night (Asleep-unspecified only). `unspec_h`: Asleep-unspecified (and pre-iOS 16 `Asleep`)
  minutes — older Watch data and third-party trackers (Zepp, Mi Fit), kept separate, not folded into core.
- `awake_h`: that source's Awake records clipped to the sleep window (bedtime → waketime).
- `inbed_h`: the sleep window united with ANY source's overlapping InBed records (the iPhone writes
  InBed from the bedtime schedule, the Watch never does), so without an InBed record it is the window
  itself (asleep + the awake time inside it). Readers (`lib/health/read.mjs` `readSleep`) are
  positional: rows written before the stage columns existed have five columns and read as `null`.
  Awake / InBed records never create a night or make a source win. Stages need `node
  data/apple-health/extract.js` on a new export (history) and `npm run sync -- --full` (Shortcut nights
  already cached).

## Strava sync

**Strava sync (`npm run sync:strava`, part of `npm run sync`).** Pulls every activity the
ingest service (`services/health-ingest`) has stored from Strava via `GET /export/strava` and
merges translated rows into `workouts.csv`, tagged `source=Strava API`, so a ride logged only on
Strava (no Watch record) still shows up — normally grouped into the `bike` modality. Cycling-family
sport types (incl. e-bike and virtual/indoor rides) all translate to the same `Cycling` type as
Apple Health uses, so they land in the same `bike` bucket. Racket, team and outdoor sports map to the
Apple type the Watch writes (Tennis, Squash, Badminton, Pickleball, Soccer, Basketball, Volleyball,
Golf…; Padel keeps its name), all in the `other` modality, so a Watch Tennis row and a Strava Tennis
row merge into ONE session (pinned by a test). Strava's generic `Workout` maps to `Other`, the
Watch's generic label that stays in `GYM_TYPES` (the owner's gym / metcon label). An unknown sport
falls back to `Unmapped` (→ `other`, never gym) and is listed in `_meta.json` `stravaSync.unmapped`. Strava rows are ALWAYS kept, also on
dates the export covers (Strava is the only source of Relative Effort, kJ and elevation), and are
rebuilt each run and removed only by their `Strava API` tag. Dedupe happens at READ time: every
workouts.csv reader goes through `lib/training/sessions.mjs` `mergeSameDay`, which keeps ONE source
per date + physical modality (Inicio's gym / run / bike / other): "Strava API" > "Strava" (the Strava
app's HealthKit copy) > Apple Watch > any other app, when the winner covers at least half of the
loser's minutes (`SUPERSEDE_MIN_COVERAGE`); lower coverage = a different session, both counted. Accepted limitations: a Strava activity
deleted upstream is never removed from the local CSV (ingest never deletes); an edit made more
than 7 days ago is never picked up (the ingest service's Strava loop only re-reads a 7-day
overlap window). `GET /export/strava` requires an ingest image rebuild/restart
(`docker compose up -d --build health-ingest`) — an un-rebuilt image answers `404` and the sync
exits non-zero with a message saying so, touching no files. The same pull also writes
`rides.csv` (`date,start,elapsed_s,kilojoules,device_watts,source`, gitignored, rebuilt from scratch
every run, one row per cycling-family activity): `start` = the local start as ISO WITH its UTC offset
(Strava `start_date_local` − `start_date`), `elapsed_s` = elapsed time (moving time when absent),
`device_watts` = `true` only for a real power meter. A separate file, not new workouts.csv columns:
the window is Strava-only data with one reader (the energy correction), so extract.js, the
positional workouts readers and the demo generator stay untouched. It needs `start_utc` +
`device_watts` from `GET /export/strava` (added with this change → ingest image rebuild); an older
image leaves `start` / `device_watts` blank, the sync prints a stale-image warning, and no ride
corrects anything. `_meta.json` records it: `rows.rides` and `stravaSync.rides` = `{rows, power
(device_watts true + kJ), withStart (start with offset)}`, plus a sentence in the Strava sync note.

**Per-workout HR zones (`workout-zones.csv`).** The same pull writes `workout-zones.csv`
(`date,activity_id,type,max_hr,max_hr_source,hr_avg,hr_max,z0_s,z1_s,z2_s,z3_s,z4_s,z5_s,source,start,elapsed_s`,
gitignored; `start` = local ISO start with its offset, blank when the ingest image does not export
`start_date`, and `elapsed_s` = elapsed, else moving time, were appended for day strain: they are the
activity window `hr-hourly.csv` leaves out; readers are positional, rebuilt from scratch every run, sorted by local start; `type` = the workouts.csv type)
from the per-activity HR histogram `hr_hist` (seconds per whole bpm) that the ingest service builds
from Strava's HR streams (`services/health-ingest/README.md` "Per-workout HR zones": at most 10
streams per sync run, newest first, so a long history fills in over a few days). Zone model
(`lib/training/hr-zones.cjs`, the reference's): % of max HR — Z0 < 50 %, Z1 50–60, Z2 60–70,
Z3 70–80, Z4 80–90, Z5 ≥ 90 % (above the max counts as Z5); the lower bound is inclusive and the
comparison exact (no rounding). Max HR = `profile/profile.json` `maxHr` when set (source `profile`;
an invalid value is warned about and ignored), else the highest Strava `max_heartrate` of the 365
days ending at the newest activity (source `observed`; anchored to the data, not the clock, so a
re-run writes the same bytes); every row records the max HR it used. Because the zones are cut
locally from the histogram, a new max HR re-cuts every workout on the next sync with no Strava call.
Back-compat: an activity without `hr_hist` (not fetched yet, no HR) has no row; an ingest image
without the field at all prints a stale-image warning and the file is not created; a missing file
= no zones on the page. `_meta.json`: `rows['workout-zones']` and `stravaSync.zones = {rows, maxHr,
maxHrSource}`. Strava's own athlete HR zones (`GET /athlete/zones`, needs `profile:read_all`) are an
alternative that is NOT used, so the page keeps one documented model.

## Journal export (`scripts/sync-journal.mjs`, part of `npm run sync`)

The behaviour journal the LAN page writes (`docs/journal.md`) is snapshotted into the extract so the
build (`lib/journal/bake.mjs`: the My journal card's checks and the behaviour insights) and read-only
consumers never query Postgres. `GET <INGEST_URL>/journal/summary` (header `X-HC-Journal: 1`) for the
last 366 days ending on the local date → `data/apple-health/extract/journal-daily.csv` (gitignored with
the extract): header `date,<behaviour keys…>,notes`, one row per journaled day, `1` / `0` for a yes / no
behaviour, the drinks count as is, blank = not answered, the note quoted (`lib/journal/journal.mjs`
`journalCsv` / `parseJournalCsv`). Inside the window the server wins (an emptied day disappears);
older rows are kept. `journal-daily.meta.json` = `{from, to, days, fetchedAt}` (its own file, never
`_meta.json`). An unreachable / old service (404, 503, 421, 429, a malformed body) = one `WARNING:` line,
the old files kept, exit 0; only a failed write exits 1. The demo extract carries a synthetic
`journal-daily.csv` from `scripts/make-demo-data.mjs`.
