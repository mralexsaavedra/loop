# iOS Shortcut: send Apple Health data to the dashboard

A personal iOS Shortcut reads recent samples from Apple Health and POSTs them, as one JSON
object, to your self-hosted `health-ingest` service. `npm run sync` then merges them into the
extract CSVs, so the dashboard stays fresh between full `export.xml` drops.

## Quick path

1. Run the ingest service (`services/health-ingest`) somewhere your phone can reach over HTTPS.
2. Build the Shortcut below: one **Find Health Samples** per payload key, each turned into text,
   then one **Get Contents of URL** POST, and (optional) a second POST to `/sync` that refreshes
   the page right away.
3. Add a personal automation that runs it when you open an app you use every day.
4. On your computer: `npm run sync && npm run generate`.

Export rows always win: Shortcut rows only fill dates your last `export.xml` does not cover.

## Install the ready-made Shortcut

Instead of building it from scratch, import the author's copy:
**[Salud → servidor (iCloud link)](https://www.icloud.com/shortcuts/ceb66eea36fc434a9d2f910421dd18aa)**.
It has every key in the table below wired up; you still need the prerequisites (the ingest service and
your token). After importing, edit three things before the first run:

1. **Step 4** (*Get Contents of URL*, the POST): replace `TU-SERVIDOR` in
   `https://TU-SERVIDOR/ingest/health-auto-export` with your host, and `TU_TOKEN` in the
   `Authorization: Bearer TU_TOKEN` header with your `INGEST_TOKEN`.
2. **Step 5** (the refresh): `https://TU-SERVIDOR/api/sync` → your plan-web host. Delete the action if
   you do not run plan-web.
3. **Every *Source is* filter**: it points to the author's watch (*Apple Watch de Alexander*); pick
   yours. A filter left on a device you do not own returns no samples, so those keys arrive empty.

Then add the personal automation (Quick path, step 3): automations are not shared with the Shortcut.
The shared copy uses the Spanish UI and the default automation name `atajo-salud`.

## Prerequisites

| You need | Where it comes from |
|----------|---------------------|
| The ingest service running | `services/health-ingest` (`docker compose up -d`), see its README |
| A public HTTPS URL for it | Your reverse proxy or tunnel. The phone POSTs to `https://<your-host>/ingest/health-auto-export`. When `services/plan-web` is your public entry, `<your-host>` is the plan-web host: it proxies exactly that route (and `/api/sync`) to ingest, which stays unexposed (see "Through plan-web" below) |
| The bearer token | `INGEST_TOKEN` in `services/health-ingest/.env` (generate with `openssl rand -hex 32`) |
| An automation name | Any label. The sync reads payloads for `SHORTCUT_AUTOMATION` (default `atajo-salud`), so use that value or set the env var to yours |

Keep the token out of screenshots and shared Shortcuts. Anyone holding it can write to your
ingest service.

## Build the Shortcut

Repeat steps 1 to 3 for every key you want (see the key table). Steps 4 and 5 run once at the end.

1. **Find Health Samples** where *Type* is the metric (e.g. *Heart Rate Variability*).
   - *Start Date is in the last* N days (see "Window" in the table).
   - Keys marked **Group by Day**: set *Group By* to *Day*.
   - Keys marked **filter by source**: add *Source is* the device (see gotchas).
2. **Repeat with Each** item in *Health Samples*, and inside it a **Text** action with one line
   in the key's format, built from the sample's properties:
   - *Start Date*, formatted as **ISO 8601** with time (e.g. `2030-01-02T08:00:00+01:00`).
   - *Value* (the number, not *Name*).
   - *Source* (Spanish UI: *Origen*) only for keys that take a third field.
   - Sleep only: *End Date* (ISO 8601) and the sample *Value* (the stage, e.g. `Core`).
3. After **End Repeat**, **Combine Text** (*Repeat Results*) with **New Lines**. That string is
   the value for the key.
4. **Get Contents of URL**:
   - URL: `https://<your-host>/ingest/health-auto-export`
   - Method: `POST`
   - Headers: `Authorization` = `Bearer <INGEST_TOKEN>`, `Automation-Name` = `atajo-salud`
     (or your `SHORTCUT_AUTOMATION`)
   - Request Body: **JSON**, one *Text* field per key, set to the combined text from step 3.

The service answers `202` with the stored row id. A `401` means the token does not match.

5. **Get Contents of URL** (Spanish UI: *Obtener contenido de URL*), right after step 4:
   - URL: `https://<your-host>/sync`
   - Method: `POST`
   - No headers and no body needed.

   This only **triggers a refresh**: the ingest service pulls Strava and the host rebuilds the
   plan page (see `services/plan-web/README.md`), so the page shows what you just sent within a
   minute or two instead of at the next hourly run. It sends and returns no health data (only a
   sequence number), needs no token, and never refuses: a call within a minute of the last refresh
   queues ONE follow-up refresh at the end of that minute (`"coalesced": true, "deferred": true`), so
   the payload you just sent is never skipped. Skip this step if you do not
   run `services/plan-web`.

   Your public reverse proxy must forward `/sync` for this step (and `/ingest/*` for step 4),
   and nothing else from the ingest service: never `/export/*` (see
   `services/health-ingest/README.md`, exposure model).

### Through plan-web (ingest not exposed)

When the public entry is `services/plan-web` (e.g. behind an SSO tunnel) instead of the ingest
service, point both steps at the plan-web host:

- step 4: `https://<your-host>/ingest/health-auto-export` (same headers; plan-web forwards
  `Authorization` and `Automation-Name`, and ingest still checks the token)
- step 5: `https://<your-host>/api/sync` (not `/sync`)

Behind an SSO proxy, bypass authentication for exactly those two paths (`/ingest/*` and
`/api/sync`); everything else (the page, the food log) stays behind the login. The `/api/sync`
rule must be an EXACT path match, not a prefix. After setup, check from outside the LAN that
`https://<your-host>/ingest/%2e%2e/status.json` and `https://<your-host>/ingest/../status.json`
(`curl --path-as-is`) do NOT return the file (`400` or the SSO redirect): plan-web refuses
dot-segments and encoded slashes in the raw path. `INGEST_TOKEN` also guards `/export/*`, so
keep it at least 32 random bytes and out of screenshots. plan-web proxies
only `POST /ingest/health-auto-export` of the ingest routes (any other `/ingest/*` path is a 404)
and never `/export/*`. Never expose the ingest port itself. Setup:
`services/plan-web/README.md`, "Exposing behind an SSO tunnel".

Example body (two lines per key shown):

```json
{
  "hrv":         "2030-01-02T08:00:00+01:00;42.1\n2030-01-02T14:10:00+01:00;47.8",
  "bodyfat":     "2030-01-02T07:00:00+01:00;18.4;My Scale",
  "steps_watch": "2030-01-01T00:00:00+01:00;9120\n2030-01-02T00:00:00+01:00;4310",
  "diet_kcal":   "2030-01-01T00:00:00+01:00;2240\n2030-01-02T00:00:00+01:00;1180",
  "sleep":       "2030-01-01T23:30:00+01:00;2030-01-02T01:00:00+01:00;Core"
}
```

## Payload keys

Every key is optional: send only what you track. Formats: **point** = `ISO;value[;source]`,
**day total** = `ISO;value` (one line per day), **hour total** = `ISO;value` (one line per clock
hour), **samples** = `ISO;value` (one line per raw sample, no grouping), **sleep** =
`ISO-start;ISO-end;stage`.
Decimal commas (`42,1`) are accepted.

| Key | Health type (English UI) | Format | Group by Day | Source / Origen | Window | Writes |
|-----|--------------------------|--------|:------------:|-----------------|--------|--------|
| `hrv` | Heart Rate Variability | point | no | no | 7 days | `hrv.csv` |
| `rhr` | Resting Heart Rate | point | no | no | 7 days | `rhr.csv` |
| `vo2max` | Cardio Fitness (VO₂ max) | point | no | no | 30 days | `vo2max.csv` |
| `weight` | Weight | point | no | optional 3rd field (the scale) | 30 days | `weight.csv` |
| `bodyfat` | Body Fat Percentage | point | no | **yes**, 3rd field (the scale) | 30 days | `bodyfat.csv` |
| `leanmass` | Lean Body Mass | point | no | **yes**, 3rd field (the scale) | 30 days | `leanmass.csv` |
| `waist` | Waist Circumference (cm) | point | no | no | 90 days | `waist.csv` |
| `wrist_temp` | Sleeping Wrist Temperature | point | no | no | 7 days | `wristTemp.csv` |
| `hr_recovery` | Cardio Recovery | point | no | no | 7 days | `hr-recovery.csv` |
| `steps_watch` | Steps, *Source is* your watch | day total | **yes** | **filter** by source | 8 days | `steps-daily.csv` |
| `steps_phone` | Steps, *Source is* your iPhone | day total | **yes** | **filter** by source | 8 days | `steps-daily.csv` |
| `active_energy` | Active Energy (iOS 26: *Active Calories*), *Source is* your watch | day total | **yes** | **filter** by source | 8 days | `active-energy-daily.csv` |
| `active_energy_hourly` | Active Energy, *Source is* your watch | hour total | no: **Group by Hour** | **filter** by source | 3 days | `active-energy-hourly.csv` |
| `basal_energy` | Resting Energy (iOS 26: *Resting Calories*), *Source is* your watch | day total | **yes** | **filter** by source | 8 days | `basal-energy-daily.csv` |
| `exercise_watch` | Exercise Minutes (Apple Exercise Time), *Source is* your watch | day total (minutes) | **yes** | **filter** by source | 8 days | `exercise-minutes-daily.csv` |
| `distance_watch` | Walking + Running Distance, *Source is* your watch | day total (km) | **yes** | **filter** by source | 8 days | `distance-daily.csv` |
| `flights_watch` | Flights Climbed, *Source is* your watch | day total | **yes** | **filter** by source | 8 days | `flights-daily.csv` |
| `respiratory` | Respiratory Rate | day total (mean) | **yes** | no | 8 days | `respiratory-daily.csv` |
| `walking_hr` | Walking Heart Rate Average | day total (mean) | **yes** | no | 8 days | `walking-hr-daily.csv` |
| `diet_kcal` | Dietary Energy | day total | **yes** | no | 8 days | `dietary-daily.csv` (kcal) |
| `diet_protein` | Protein | day total | **yes** | no | 8 days | `dietary-daily.csv` (protein_g) |
| `diet_carbs` | Carbohydrates | day total | **yes** | no | 8 days | `dietary-daily.csv` (carbs_g) |
| `diet_fat` | Total Fat | day total | **yes** | no | 8 days | `dietary-daily.csv` (fat_g) |
| `sleep` | Sleep (Sleep Analysis) | sleep | no | no | 3 days | `sleep-daily.csv` |
| `hr_t` | Heart Rate, *Source is* your watch | samples: Start Dates (ISO 8601), one per line | no: **no grouping** | **filter** by source | 1 day | `hr-hourly.csv` |
| `hr_v` | the same search | samples: Values (bpm), same line order as `hr_t` | no: **no grouping** | **filter** by source | 1 day | `hr-hourly.csv` |
| `hr_samples` | the same search (older, loop-based alternative to `hr_t` + `hr_v`) | samples (`ISO;bpm`) | no: **no grouping** | **filter** by source | 1 day | `hr-hourly.csv` |

What the sync does with each shape:

- **Point keys** keep one row per sample. `rhr` is deduped by timestamp only (Apple rewrites the
  day's resting HR at the same timestamp; the latest payload wins). `weight` takes an optional 3rd
  field, the scale or app (*Source* / *Origen*), stored as the row's source like `bodyfat`; without
  it the row says `Shortcut`. A weight stamped exactly at midnight (local `00:00:00`, or `00:00:00`
  UTC such as `02:00:00+02:00`) with no body-fat sample within 10 minutes is dropped as a phantom
  date-only entry (the Health profile weight, or a manual entry without a time): a smart scale
  writes body fat with every weigh-in, so a real weigh-in is kept. `bodyfat` accepts a fraction (`0.184`) or a percent
  (`18.4`); `waist` accepts cm, or metres (`0.84`), which it converts. Send it in **centimetres**:
  the metres check (value below 3) cannot tell inches from cm, so `33` in would be stored as 33 cm.
- **Day totals**: the oldest day of each key is dropped (a "last N days" query starts mid-day, so
  that day is partial; the four `diet_*` keys share one oldest day, since they fold into one row), and the latest payload wins for a day. A `0` on `respiratory`/`walking_hr`
  (from *Fill Missing*) means no data. Steps keep the **max** of watch and phone per day.
- **Hour totals** (`active_energy_hourly`): one row per clock hour; the stamp is the hour's first
  sample (e.g. `2030-01-02T09:07:12+01:00;275.3`) and is stored as the hour start. The oldest hour
  of each payload is dropped (the window starts mid-hour) and the latest payload wins an hour.
  It is used only to correct ride days: when a bike computer with a power meter records a ride the
  Watch did not, the Watch's energy during the ride hours is replaced by the ride's power-based
  energy (Strava kJ), never lowering a day (`docs/health-tab.md`, Energy).
- **Heart-rate samples** (`hr_t` + `hr_v`, or `hr_samples`): every Watch heart-rate sample of the
  window. `hr_t` holds one Start Date per line (`2030-01-02T09:07:12+01:00`) and `hr_v` the Value
  on the same line number (`72`, `72 count/min`, `72 lpm` or `72,5`: the leading number is the
  bpm); the sync pairs them by line number. If the two lists have a different number of lines (a
  blank line counts unless it is blank in both), the payload's lists are dropped whole and
  `npm run sync` prints a `WARNING`, so a sample is never paired with another one's value. The
  older `hr_samples` key (one `2030-01-02T09:07:12+01:00;72` line per sample) is still accepted;
  a payload may carry both, and they are merged. Runs overlap, so samples are deduped by their **exact
  timestamp** across payloads (the later payload wins); a value outside 25–240 bpm is dropped as a
  glitch. Only **hourly aggregates** reach `hr-hourly.csv` (average, max, min, count, covered
  minutes and a per-bpm histogram of the time outside Strava activities; see
  `docs/data-pipeline.md`), never the raw samples. They feed the day strain dial (`docs/home-tab.md`).
- **Dietary**: the four `diet_*` keys become one row per day. A day without `diet_kcal`, or with
  0 kcal, is skipped; a missing macro stays blank. These feed the intake rings in Nutrición.
- **Exercise / distance / flights** (`exercise_watch`, `distance_watch`, `flights_watch`): Watch
  day totals, same rules as the other day totals; a `0` day (*Fill Missing*, or the watch was not
  worn) is no data, as in the export. `distance_watch` is stored in **km**: send km (`6.2`), or a
  value with its unit (`6200 m`, `3.9 mi`); a bare number above 100 is read as metres (`100` = 100 km,
  `101` = 101 m). Decimal commas work, and with both separators the last one is the decimal
  (`1.234,5 m`); a repeated single separator (`1.234.567`) is rejected.
- **The export's last day is partial**: `export.xml` is taken during a day, so its rows for that
  day are incomplete. For the day totals (steps, energy, exercise, distance, flights, dietary) the
  Shortcut row wins on that date, and the export row is dropped when no Shortcut row exists.
- **Sleep**: only asleep stages (Core / Deep / REM / Asleep, English or Spanish names) build the
  night and its hours; a segment starting after 18:00 belongs to the next morning's night. Every
  stage also fills its own `sleep-daily.csv` column (REM / deep / core / unspecified / awake / in bed,
  see `docs/data-pipeline.md` → Sleep), so keep *all* stages in the sample search, Awake and In Bed
  included (In Bed comes from the iPhone, not the watch).

### Building `active_energy_hourly`

Duplicate your `active_energy` search and change only the grouping:

1. **Find Health Samples**: *Type* Active Energy (iOS 26: *Active Calories*), *Source is* your
   watch (the same filter as `active_energy`), *Start Date is in the last* **3 days**, *Group By*
   **Hour** (not Day).
2. **Repeat with Each** → **Text** `<Start Date ISO 8601>;<Value>`, then **Combine Text** with new
   lines, like every other key.
3. Add a JSON field `active_energy_hourly` with that text to the POST body.

3 days × 24 hours is at most ~72 lines, so it adds little to the payload. After adding it run
`npm run sync -- --full` once (or only the Shortcut part, `npm run sync:shortcut -- --full`; see Verify).

### Building `hr_t` and `hr_v` (heart-rate samples)

A day is a few hundred samples, and thousands on a workout day (the Watch samples every few seconds
while it records one), so build this key **without a loop**: two lists taken straight from the
search result, paired by line number on the sync side.

1. **Find Health Samples** (*Buscar muestras de Salud*): *Type* **Heart Rate** (*Frecuencia
   cardiaca*), *Source is* your watch, *Start Date is in the last* **1 day**, **no** *Group By*
   (raw samples).
2. **Text** (*Texto*) with the magic variable **Health Samples** (*Muestras de Salud*); tap it and
   pick the property **Start Date** (*Fecha de inicio*), *Date Format* (*Formato de fecha*)
   **ISO 8601**. Then **Combine Text** (*Combinar texto*) with **New Lines** (*Saltos de línea*).
   Add that text to the POST body as the JSON field `hr_t`.
3. **Text** (*Texto*) with the magic variable **Health Samples** (*Muestras de Salud*) › **Value**
   (*Valor*), then **Combine Text** (*Combinar texto*) with **New Lines** (*Saltos de línea*). Add
   it as the JSON field `hr_v`. A unit after the number (`72 count/min`, `72 lpm`) is fine.

Both lists come from the same search, so they always have the same length and order. The older
recipe (**Repeat with Each** (*Repetir con cada*) → **Text** `<Start Date ISO 8601>;<Value>` →
**Combine Text** → field `hr_samples`) is still accepted, but it loops once per sample and is very
slow on workout days. A workout day of about 5,000 samples is roughly 150 KB of `hr_t` plus 25 KB
of `hr_v`, well under the ingest service's 32 MB body limit (`MAX_BODY_BYTES`). The 1-day
window overlaps between runs on purpose: the sync dedupes by timestamp, so nothing is counted
twice and a missed run leaves no gap as long as the next one comes within a day. After adding it
run `npm run sync -- --full` once.

### Building `exercise_watch`, `distance_watch` and `flights_watch`

Three searches, each a copy of your `steps_watch` search with another type:

1. **Find Health Samples**: *Type* **Exercise Minutes** (Spanish: *Minutos de ejercicio*),
   **Walking + Running Distance** (*Distancia andando + corriendo*) or **Flights Climbed**
   (*Pisos subidos*); *Source is* your watch; *Start Date is in the last* **8 days**; *Group By*
   **Day**.
2. **Repeat with Each** → **Text** `<Start Date ISO 8601>;<Value>`, then **Combine Text** with new
   lines.
3. Add the JSON fields `exercise_watch`, `distance_watch`, `flights_watch` to the POST body. Leave
   the distance unit at kilometres in the Health app (or send the value with `m` / `mi`).

Then run `npm run sync -- --full` once.

## Gotchas

| Symptom | Cause and fix |
|---------|---------------|
| Resting / active energy far too high on one day (e.g. 3,600 kcal resting) | A day-grouped search sums every source, while the Health app shows one source per period. Filter the `basal_energy` and `active_energy` searches by your watch (*Source is*). The next payload rewrites the affected days. |
| Steps look doubled | A day-grouped *Steps* search sums iPhone + Watch. Use two searches filtered by source, sent as `steps_watch` and `steps_phone`. The legacy merged `steps` key is ignored on purpose. |
| A search with two *Source is* filters returns nothing | Multiple filters in one search are combined with **AND**, never OR. One search per device. |
| The value column holds text like `18,4 %` or `70 kg` | You used the sample's *Name*, which is the formatted value. Use *Value* for the number; *Source* (*Origen*) is the device or app. |
| No `vo2max` type in the list | Health calls it *Cardio Fitness* (Spanish: *Capacidad aeróbica*). |
| A key is missing from the payload | Normal: a query with no results produces empty text, and empty keys are skipped. |
| The automation runs but sends nothing | Health data is locked while the phone is locked, so a time-of-day trigger at night finds no samples. Trigger on **opening an app** you use daily (with *Run Immediately*), which only fires on an unlocked phone. |
| Old days change after a sync | Expected: the latest payload corrects day totals, and export rows replace Shortcut rows once a new `export.xml` covers those dates. |

## Verify

```bash
npm run sync        # prints rows added per key; exits non-zero if the service is unreachable
npm run generate    # rebuilds the page
```

`data/apple-health/extract/_meta.json` → `shortcutSync.owned` lists every date the sync wrote
per CSV. `npm run sync -- --full` rebuilds the local sample cache from every stored payload.

**After adding new keys** (e.g. `waist`, `diet_*`): run `npm run sync -- --full` once. The
incremental sync only parses payloads newer than the cache, so keys already sitting in cached
payloads are picked up only by a full rebuild. For Strava elevation, rebuild the ingest image
(`docker compose up -d --build health-ingest`) before `npm run sync:strava`; the sync warns when
no activity carries elevation.

## Next step

Once data flows, open the Salud tab: waist, the intake rings and the recovery signals fill in
as soon as their keys arrive. Metric definitions live in `docs/health-tab.md`.
