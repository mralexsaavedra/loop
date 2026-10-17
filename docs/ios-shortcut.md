# iOS Shortcut: send Apple Health data to the dashboard

A personal iOS Shortcut reads recent samples from Apple Health and POSTs them, as one JSON
object, to your self-hosted LOOP server (its data service, `loop-server`; `loop-ingest` in host mode). The
server's next sync merges them into the extract CSVs, so the page stays fresh between full Apple Health exports.

## Quick path

1. Have the LOOP server running ([`README.md` → Setup → Server](../README.md#server--the-page-the-food-log-and-the-iphone-sync-docker-no-clone);
   host mode: [`services/loop-web/README.md` → Install](../services/loop-web/README.md#install-host)).
2. Import the ready-made Shortcut (below) and point it at your server, or build it yourself (*Build the
   Shortcut*).
3. Add a personal automation that runs it when you open an app you use every day.
4. Nothing else: the Shortcut's last step asks the server to rebuild the page (it also rebuilds every hour). A
   coach clone gets the new data with `npm run sync`.

Export rows always win: Shortcut rows only fill dates your last `export.xml` does not cover.

## Where the phone sends the data

Pick one. Both go through loop-web, which forwards only the two routes the Shortcut needs
(`POST /ingest/health-auto-export` and `POST /api/sync`) to the ingest service.

| Option | URL in the Shortcut | Works | You need |
| --- | --- | --- | --- |
| **A. Home Wi-Fi only (start here)** | `http://<server-ip>:8090` | When the phone is on your home Wi-Fi | Nothing more: the server as installed |
| **B. From anywhere** | `https://<your-host>` | Always | A domain and an HTTPS tunnel or reverse proxy in front of loop-web ([`services/loop-web/README.md` → Exposing behind an SSO tunnel](../services/loop-web/README.md#exposing-behind-an-sso-tunnel)) |

**Option A is enough for most people.** Each payload covers the last 1–30 days (see *Window* in the key
table), so a day away from home is filled the next time the automation runs at home. The trade-off: the
token travels unencrypted over your own Wi-Fi (plain HTTP). Use it only on a network you trust, and move
to option B if you want to sync on the go. Find the server's IP with `hostname -I` on the server, and
give it a fixed IP in your router so the Shortcut keeps working.

## Install the ready-made Shortcut

Instead of building it from scratch, import the author's copy:
**[Salud → servidor (iCloud link)](https://www.icloud.com/shortcuts/ceb66eea36fc434a9d2f910421dd18aa)**.
It has every key in the table below wired up (Spanish UI, automation name `atajo-salud`). After
importing, edit these before the first run:

1. **Step 4** (*Obtener contenido de URL*, the POST):
   - URL: replace `https://TU-SERVIDOR` with your address from the table above, keeping the path:
     `http://192.168.1.50:8090/ingest/health-auto-export` (option A) or
     `https://<your-host>/ingest/health-auto-export` (option B).
   - Header `Authorization`: replace `TU_TOKEN` in `Bearer TU_TOKEN` with your `INGEST_TOKEN`
     (`grep '^INGEST_TOKEN=' .env` in the server's folder, host mode `services/loop-ingest/.env`; copy it on your
     own screen).
2. **Step 5** (the refresh): same address, path `/api/sync`.
3. **The *Origen es* (Source is) filters** — they name the author's devices; set yours:
   - 8 searches filtered by the watch (*Apple Watch de …*): `steps_watch`, `active_energy`,
     `active_energy_hourly`, `basal_energy`, `exercise_watch`, `distance_watch`, `flights_watch`, `hr_t`/`hr_v`;
   - 1 search filtered by the iPhone (*iPhone de …*): `steps_phone`.

   A filter left on a device you do not own returns nothing, so that key arrives empty (no error).

**No Apple Watch?** HRV, resting HR, sleep stages, wrist temperature, respiratory rate and the
heart-rate samples all come from the watch, so recovery, sleep and stress stay empty. Keep the iPhone
and scale keys (`steps_phone`, `weight`, `bodyfat`, `leanmass`, `waist`) and delete the watch-filtered
searches; other wearables that write to Apple Health work only if you point the filters at them.

**Another watch or band (Xiaomi, Garmin, Amazfit, Huawei…)?** It works through Apple Health if its app writes
there:
1. In the watch's app, turn on writing to Apple Health and pick the data (Mi Fitness: its third-party data
   settings → Health; Garmin Connect, Zepp, Huawei Health have the same switch). Then check the app under
   Health → your photo → *Apps*.
2. In the Shortcut, point every watch-filtered search (*Origen es*, the 8 above) at that app instead of
   *Apple Watch de …* (e.g. *Mi Fitness*). The unfiltered keys (`sleep`, `rhr`, `hrv`, `respiratory`,
   `walking_hr`, …) need nothing: they read whatever writes them.
3. **Remove the searches for metrics your device never writes.** A *Find Health Samples* that finds nothing
   stops the whole Shortcut with "No se ha encontrado ninguna muestra" ("No samples found"), so nothing is
   sent. Check what the app writes in Health → your photo → *Apps* → the app → *Data*, and delete each search
   block (and its JSON field) for a type it does not write. Mi Fitness, for example, writes no HRV and no resting
   HR: delete the `hrv` and `rhr` blocks; keep `sleep` and the heart-rate samples (`hr_t` / `hr_v`), and
   point that heart-rate search (*Source is*) at the band's app (e.g. Mi Fitness) instead of a watch.
4. Expect less than with an Apple Watch: steps, energy, heart rate and sleep usually arrive; HRV, wrist
   temperature, respiratory rate and sleep stages depend on the device and its app. A band that writes only
   "in bed" sleep gets ESTIMATED nights (time in bed, labelled on the page; from the Apple Health export only),
   and one without resting HR gets it derived from the night's heart rate: from the export, and from this
   Shortcut's `hr_t` / `hr_v` as long as the Shortcut sends no `rhr`
   ([`docs/data-pipeline.md` → Resting HR](data-pipeline.md#apple-health-export-and-extract)). Without HRV the
   recovery score is partial (resting HR and sleep) and says so; stress stays empty or partial.

**Example: a Xiaomi band through Mi Fitness.** Mi Fitness writes heart rate as hourly buckets and sleep only as
"in bed": no HRV, no resting HR, no VO2 max. Starting from the ready-made Shortcut, a second install for a Mi
Fitness user changed it like this:

| Change | Blocks |
| --- | --- |
| Delete (Mi Fitness never writes them, so each one stops the run) | HRV, resting HR, VO2 max, respiratory rate, sleeping wrist temperature, walking heart rate average, heart rate recovery, exercise time; waist circumference (no tape measure logged); the four dietary blocks (Dietary Energy, Protein, Carbohydrates, Fat: the food is logged in LOOP, not in Health); the distance and flights blocks filtered by the Apple Watch |
| Change the *Origen es* filter from *Apple Watch de …* to **Mi Fitness** | steps (the watch-filtered search) and active energy; the heart-rate search (`hr_t` / `hr_v`), so the server derives resting HR from it |
| Keep as they are | iPhone steps, basal energy, weight, body fat and lean mass (a smart scale), heart rate, sleep |

A metric that the band writes only now and then (Mi Fitness wrote distance twice in months) is better deleted too:
the run stops on every day it is missing.

The Apple Health export (`data/apple-health/extract.mjs`) needs no change: steps, exercise and sleep take the
largest value across sources, and energy picks one source per day ([`docs/data-pipeline.md` → Energy source
precedence](data-pipeline.md#energy-source-precedence)).

Then add the personal automation (*Automatización* → *Crear automatización personal* → *App* → pick an
app you open every day → *Ejecutar inmediatamente* → this Shortcut): automations are not shared with
the Shortcut.

## Prerequisites (building it yourself)

| You need | Where it comes from |
|----------|---------------------|
| The LOOP server running | [`README.md` → Setup → Server](../README.md#server--the-page-the-food-log-and-the-iphone-sync-docker-no-clone) (host mode: [`services/loop-web/README.md` → Install](../services/loop-web/README.md#install-host)) |
| The address | *Where the phone sends the data* above |
| The bearer token | `INGEST_TOKEN` in the server's `.env` (the install generates it; host mode: `services/loop-ingest/.env`) |
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
   - URL: `<your address>/ingest/health-auto-export` (`http://<server-ip>:8090` or `https://<your-host>`, see *Where the phone sends the data*)
   - Method: `POST`
   - Headers: `Authorization` = `Bearer <INGEST_TOKEN>`, `Automation-Name` = `atajo-salud`
     (or your `SHORTCUT_AUTOMATION`)
   - Request Body: **JSON**, one *Text* field per key, set to the combined text from step 3.

The service answers `202` with the stored row id. A `401` means the token does not match.

5. **Get Contents of URL** (Spanish UI: *Obtener contenido de URL*), right after step 4:
   - URL: `<your address>/api/sync`
   - Method: `POST`
   - No headers and no body needed.

   This only **triggers a refresh**: the ingest service pulls Strava and the host rebuilds the
   plan page (see `services/loop-web/README.md`), so the page shows what you just sent within a
   minute or two instead of at the next hourly run. It sends and returns no health data (only a
   sequence number), needs no token, and never refuses: a call within a minute of the last refresh
   queues ONE follow-up refresh at the end of that minute (`"coalesced": true, "deferred": true`), so
   the payload you just sent is never skipped. Skip this step if you do not
   run `services/loop-web`.

   Both steps go through loop-web (`/ingest/health-auto-export` and `/api/sync`); the ingest service
   itself is never exposed (see `services/loop-ingest/README.md`, exposure model).

### Through loop-web (ingest not exposed)

Both options above already go through loop-web. For option B (public entry behind an SSO tunnel),
point both steps at the loop-web host:

- step 4: `https://<your-host>/ingest/health-auto-export` (same headers; loop-web forwards
  `Authorization` and `Automation-Name`, and ingest still checks the token)
- step 5: `https://<your-host>/api/sync` (not `/sync`)

Behind an SSO proxy, bypass authentication for exactly those two paths (`/ingest/*` and
`/api/sync`); everything else (the page, the food log) stays behind the login. The `/api/sync`
rule must be an EXACT path match, not a prefix. After setup, check from outside the LAN that
`https://<your-host>/ingest/%2e%2e/status.json` and `https://<your-host>/ingest/../status.json`
(`curl --path-as-is`) do NOT return the file (`400` or the SSO redirect): loop-web refuses
dot-segments and encoded slashes in the raw path. `INGEST_TOKEN` also guards `/export/*`, so
keep it at least 32 random bytes and out of screenshots. loop-web proxies
only `POST /ingest/health-auto-export` of the ingest routes (any other `/ingest/*` path is a 404)
and never `/export/*`. Never expose the ingest port to the internet (it listens on the LAN only so loop-web can reach it). Setup:
`services/loop-web/README.md`, "Exposing behind an SSO tunnel".

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
| `waist` | Waist Circumference — send it in centimetres | point | no | no | 90 days | `waist.csv` |
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
| `sleep` | Sleep (Sleep Analysis) — keep ALL stages in the search, Awake and In Bed included (In Bed comes from the iPhone) | sleep | no | no | 3 days | `sleep-daily.csv` |
| `hr_t` | Heart Rate, *Source is* your watch (a band: its app, e.g. Mi Fitness) | samples: Start Dates (ISO 8601), one per line | no: **no grouping** | **filter** by source | 1 day | `hr-hourly.csv` |
| `hr_v` | the same search | samples: Values (bpm), same line order as `hr_t` | no: **no grouping** | **filter** by source | 1 day | `hr-hourly.csv` |
| `hr_samples` | the same search (older, loop-based alternative to `hr_t` + `hr_v`) | samples (`ISO;bpm`) | no: **no grouping** | **filter** by source | 1 day | `hr-hourly.csv` |

What the sync does with the data: export rows win and Shortcut rows fill the other dates; day totals
drop each payload's partial oldest day and the latest payload wins; steps keep the max of watch and
phone; a weight stamped exactly at midnight with no body-fat sample nearby is dropped as a phantom entry;
heart-rate samples reach the CSV only as hourly aggregates. Every rule, per key shape: [`docs/data-pipeline.md`
→ Shortcut merge into the extract](data-pipeline.md#shortcut-merge-into-the-extract).

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
   cardiaca*), *Source is* your watch (a band: its app, e.g. **Mi Fitness**), *Start Date is in the
   last* **1 day**, **no** *Group By* (raw samples).
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
of `hr_v`, well under the 8 MB loop-web accepts on that path (ingest's own `MAX_BODY_BYTES` defaults to 8 MB as well). The 1-day
window overlaps between runs on purpose: the sync dedupes by timestamp (a band's several records at one hour-stamp are kept), so nothing is counted
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
| The Shortcut stops with "No se ha encontrado ninguna muestra" ("No samples found") | A *Find Health Samples* whose type your device never writes found nothing, and the next action stops the run, so nothing is sent. Delete that search block and its JSON field (a watch or band other than an Apple Watch: usually HRV and resting HR; see [Another watch or band](#install-the-ready-made-shortcut) and [Troubleshooting](#troubleshooting)). |
| The automation runs but sends nothing | Health data is locked while the phone is locked, so a time-of-day trigger at night finds no samples. Trigger on **opening an app** you use daily (with *Run Immediately*), which only fires on an unlocked phone. |
| Old days change after a sync | Expected: the latest payload corrects day totals, and export rows replace Shortcut rows once a new `export.xml` covers those dates. |

## Troubleshooting

Errors the iPhone shows while the Shortcut runs. The quoted strings are the Spanish iOS interface, as the
ready-made Shortcut shows them; the English labels are in brackets.

**"Puedes permitir su ejecución en Ajustes"** on *Obtener contenido de* (*Get Contents of URL*): iOS blocked the
upload, not the server (nothing reaches it). Allow it in three places, then run the Shortcut again:

1. **Large uploads**: *Ajustes* → *Apps* → *Atajos* → *Avanzado* → turn on **"Permitir compartir grandes cantidades
   de datos"** (Settings → Apps → Shortcuts → Advanced → Allow Sharing Large Amounts of Data). A payload with a
   week of heart-rate samples is large enough to need it.
2. **The server's address, per Shortcut**: in the Shortcut, tap ⓘ → *Privacidad* (Privacy) and allow your server's
   address (e.g. `192.168.1.50`), or tap *Restablecer privacidad* (Reset Privacy) so iOS asks again on the next
   run; then answer **"Permitir siempre"** (Always Allow).
3. **Health access**: *Salud* (Health) → your photo → *Apps* → *Atajos* (Shortcuts) → turn on every category the
   Shortcut reads.

**"No se ha encontrado ninguna muestra"** (No samples found): a search for a type your device never writes found
nothing and stopped the run, so nothing was sent. Delete that block and its JSON field
([Another watch or band](#install-the-ready-made-shortcut), with the Mi Fitness example).

**The upload answers `401`** (the server logs `"event":"unauthorized"` with reason `invalid`): the `Authorization`
header holds another install's token, or a typo. Copy `INGEST_TOKEN` from that server's `.env` again and keep the
form `Bearer <token>`. On a host with two installs, each has its own token and port.

## Verify

On the server, `lastShortcutAt` moves after each run, and the page's freshness dot shows "Atajo" a few minutes old:

```bash
curl -s localhost:8088/sync/status
```

In a coach clone of a LOOP server (the Docker images), `npm run sync` prints `Client mode: ...` and the `Mirror: ...`
line: the server's own refresh parsed the payloads, so the new rows show on the server's page and in
`/sync/status` above, and the mirror copies the updated extract into the clone.

In host mode (development / legacy) or a clone without a server:

```bash
npm run sync        # prints rows added per key; exits non-zero if the service is unreachable
npm run generate    # rebuilds the page (host mode / local only)
```

`loop-data/extract/_meta.json` → `shortcutSync.owned` lists every date the sync wrote
per CSV. `npm run sync -- --full` rebuilds the local sample cache from every stored payload.

**After adding new keys** (e.g. `waist`, `diet_*`): run `npm run sync -- --full` once. The
incremental sync only parses payloads newer than the cache, so keys already sitting in cached
payloads are picked up only by a full rebuild. For Strava elevation, rebuild the ingest image
(`docker compose up -d --build loop-ingest`) before `npm run sync:strava`; the sync warns when
no activity carries elevation.

## Next step

Once data flows, open the Health tab: waist, the intake rings and the recovery signals fill in
as soon as their keys arrive. Metric definitions live in `docs/health-tab.md`.
