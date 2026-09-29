# iOS Shortcut: send Apple Health data to the dashboard

A personal iOS Shortcut reads recent samples from Apple Health and POSTs them, as one JSON
object, to your self-hosted `health-ingest` service. `npm run sync` then merges them into the
extract CSVs, so the dashboard stays fresh between full `export.xml` drops.

## Quick path

1. Run the ingest service (`services/health-ingest`) somewhere your phone can reach over HTTPS.
2. Build the Shortcut below: one **Find Health Samples** per payload key, each turned into text,
   then one **Get Contents of URL** POST.
3. Add a personal automation that runs it when you open an app you use every day.
4. On your computer: `npm run sync && npm run generate`.

Export rows always win: Shortcut rows only fill dates your last `export.xml` does not cover.

## Prerequisites

| You need | Where it comes from |
|----------|---------------------|
| The ingest service running | `services/health-ingest` (`docker compose up -d`), see its README |
| A public HTTPS URL for it | Your reverse proxy or tunnel. The phone POSTs to `https://<your-host>/ingest/health-auto-export` |
| The bearer token | `INGEST_TOKEN` in `services/health-ingest/.env` (generate with `openssl rand -hex 32`) |
| An automation name | Any label. The sync reads payloads for `SHORTCUT_AUTOMATION` (default `atajo-salud`), so use that value or set the env var to yours |

Keep the token out of screenshots and shared Shortcuts. Anyone holding it can write to your
ingest service.

## Build the Shortcut

Repeat steps 1 to 3 for every key you want (see the key table). Step 4 runs once at the end.

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
**day total** = `ISO;value` (one line per day), **sleep** = `ISO-start;ISO-end;stage`.
Decimal commas (`42,1`) are accepted.

| Key | Health type (English UI) | Format | Group by Day | Source / Origen | Window | Writes |
|-----|--------------------------|--------|:------------:|-----------------|--------|--------|
| `hrv` | Heart Rate Variability | point | no | no | 7 days | `hrv.csv` |
| `rhr` | Resting Heart Rate | point | no | no | 7 days | `rhr.csv` |
| `vo2max` | Cardio Fitness (VO₂ max) | point | no | no | 30 days | `vo2max.csv` |
| `weight` | Weight | point | no | no | 30 days | `weight.csv` |
| `bodyfat` | Body Fat Percentage | point | no | **yes**, 3rd field (the scale) | 30 days | `bodyfat.csv` |
| `leanmass` | Lean Body Mass | point | no | **yes**, 3rd field (the scale) | 30 days | `leanmass.csv` |
| `waist` | Waist Circumference (cm) | point | no | no | 90 days | `waist.csv` |
| `wrist_temp` | Sleeping Wrist Temperature | point | no | no | 7 days | `wristTemp.csv` |
| `hr_recovery` | Cardio Recovery | point | no | no | 7 days | `hr-recovery.csv` |
| `steps_watch` | Steps, *Source is* your watch | day total | **yes** | **filter** by source | 8 days | `steps-daily.csv` |
| `steps_phone` | Steps, *Source is* your iPhone | day total | **yes** | **filter** by source | 8 days | `steps-daily.csv` |
| `active_energy` | Active Energy | day total | **yes** | no | 8 days | `active-energy-daily.csv` |
| `basal_energy` | Resting Energy | day total | **yes** | no | 8 days | `basal-energy-daily.csv` |
| `respiratory` | Respiratory Rate | day total (mean) | **yes** | no | 8 days | `respiratory-daily.csv` |
| `walking_hr` | Walking Heart Rate Average | day total (mean) | **yes** | no | 8 days | `walking-hr-daily.csv` |
| `diet_kcal` | Dietary Energy | day total | **yes** | no | 8 days | `dietary-daily.csv` (kcal) |
| `diet_protein` | Protein | day total | **yes** | no | 8 days | `dietary-daily.csv` (protein_g) |
| `diet_carbs` | Carbohydrates | day total | **yes** | no | 8 days | `dietary-daily.csv` (carbs_g) |
| `diet_fat` | Total Fat | day total | **yes** | no | 8 days | `dietary-daily.csv` (fat_g) |
| `sleep` | Sleep (Sleep Analysis) | sleep | no | no | 3 days | `sleep-daily.csv` |

What the sync does with each shape:

- **Point keys** keep one row per sample. `bodyfat` accepts a fraction (`0.184`) or a percent
  (`18.4`); `waist` accepts cm, or metres (`0.84`), which it converts.
- **Day totals**: the oldest day of each key is dropped (a "last N days" query starts mid-day, so
  that day is partial), and the latest payload wins for a day. A `0` on `respiratory`/`walking_hr`
  (from *Fill Missing*) means no data. Steps keep the **max** of watch and phone per day.
- **Dietary**: the four `diet_*` keys become one row per day. A day without `diet_kcal`, or with
  0 kcal, is skipped; a missing macro stays blank. These feed the intake rings in Nutrición.
- **Sleep**: only asleep stages count (English or Spanish names); a segment starting after 18:00
  belongs to the next morning's night.

## Gotchas

| Symptom | Cause and fix |
|---------|---------------|
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

## Next step

Once data flows, open the Salud tab: waist, the intake rings and the recovery signals fill in
as soon as their keys arrive. Metric definitions live in `CLAUDE.md` (Health tab section).
