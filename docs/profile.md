# Profile

Avatar button, profile sheet, profile sources, goal setting, device manuals, the in-page onboarding.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

On this page:

- [Avatar button and sheet wiring](#avatar-button-and-sheet-wiring)
- [The profile sheet](#the-profile-sheet): [goal setting](#goal-setting), [upcoming events](#upcoming-events), [body, gear, devices, supplements, Strava](#body-gear-devices-supplements-strava), [empty state and styles](#empty-state-and-styles)
- [Profile sources](#profile-sources): [`profile.json`](#profilejson-schema-and-validation), [Strava snapshot](#strava-snapshot-strava-profilejson--avatarjpg), [derived weight and age](#derived-weight-and-age)
- [One source of truth per user fact](#one-source-of-truth-per-user-fact): [`settings.json`](#settingsjson), [`onboarding.json`](#onboardingjson)
- [Ingest side: Strava athlete and gear scope](#ingest-side-strava-athlete-and-gear-scope)
- [Build](#build)
- [Device manuals (LAN page only)](#device-manuals-lan-page-only)
- [In-page onboarding (no AI coach needed)](#in-page-onboarding-no-ai-coach-needed): [layout](#layout), [screens](#screens), [errors and screen readers](#errors-and-screen-readers), [keyboard](#keyboard), [sports and day types](#sports-and-day-types), [saving](#saving), [first run and entry points](#first-run-and-entry-points)

## Avatar button and sheet wiring

A Strava / WHOOP-style profile, honest data only.

- **Avatar button** (`web/src/components/Avatar.astro`): a round button in the top bar on every tab — left on a
  phone, at the right end beside Sync from 900 px. Shows the photo, else the initials, else a generic person
  icon; ≥ 44px; NOT a tab.
- **The view**: `web/src/client/profile.js` (inlined before detail.js) registers `window.HCViews.profile`;
  detail.js renders any registered view in the same modal (focus, inert, Esc, Back).
- **Deep link**: `#profile` (instead of `#detail/<metric>`).
- **Focus trap**: the Tab trap also cycles through `<summary>` and a checked radio.
- **Focused open**: `HCDetail.open(key, date, { focus: '<selector>' })` opens a view focused (and scrolled) on
  one of its controls instead of the close button.
- **Header row**: photo / initials / icon, full name, age, location. On the LAN page an **Edit** chip
  (`.chip.pf-edit`, `data-onb-open`) at the end of the row opens the
  [in-page onboarding](#in-page-onboarding-no-ai-coach-needed); it renders only when `I18N_ONB`, the
  `onboarding` view and `HC.lan()` are all present.

## The profile sheet

Order: header → goal → upcoming events → Body → Gear → Devices → Supplements → Strava.

### Goal setting

The FIRST section under the header (also on the onboarding sheet), heading `Objetivo`.

- Three labelled radios `Mantener` / `Bajar` / `Ganar`, each with a one-line description (`"Mantener tu
  peso"`, `"Déficit suave (~−350 kcal/día, sin tocar los días de bici)"`, `"Superávit suave (~+300
  kcal/día)"`).
- **The kcal**: `lib/profile/goal.mjs` `goalOptions(resolveTargets(plan))` — mean goal − maintain over rest +
  gym, rounded to 10; "bike days untouched" only when bike / bikeLong equal maintain. Baked as
  `PROFILE.goals` by `web/pages/index.astro`, never typed.
- **Ownership**: the goal belongs to Nutrition (`client/nutri-day.js`, inlined before profile.js).
  - The checked radio is `HCNutri.state().goal`.
  - A change calls `HCNutri.setGoal`, which writes the key `hc.nutri.goal` (fallback `page.goal`) and refreshes
    the summary, plan, fuelling, Home card, rings and the kcal chip at once.
- No `HCNutri` or no options → the section is omitted.
- **LAN page**: the goal is also stored on the SERVER, and the section adds `Peso objetivo` (target weight), a
  status line and the Progress line (see [`nutrition-food-log.md` → Progress](nutrition-food-log.md#progress)).

### Upcoming events

Heading `Próximas pruebas`; sits right after the goal. Omitted without events.

- Upcoming events soonest first, with `Hoy` / `Mañana` / `Dentro de N días` from `HC.daysOld` on the viewer's
  clock (nothing time-based baked); each row: type · date · location.
- Past events folded in a `<details>` (`Pasadas (n)`, newest first).
- All past → `No hay pruebas próximas.`

### Body, gear, devices, supplements, Strava

| Section | Content |
| --- | --- |
| Body (`Cuerpo`) | Height, latest weight + weigh-in date |
| Gear (`Material`) | Bikes, shoes; km to 1 decimal in `--num`; primary badge; retired ones folded in a `<details>`; a `--mid` hint on active shoes ≥ `SHOE_REPLACE_KM` (700): "consider replacing, ~700–800 km typical life"; the scope note instead when gear is missing ([gear scope](#gear-scope)) |
| Devices (`Dispositivos`) | Manual first; Strava-derived ones deduped by name (case-insensitive), usage merged into a manual entry of the same name (which keeps its `manual`); `hiddenDevices` dropped; a "Manual" link per device with a manual ([device manuals](#device-manuals-lan-page-only)) |
| Supplements (`Suplementos`) | Name, dose, meal; omitted when there are none |
| Strava | Focus + snapshot date |

### Empty state and styles

- Nothing known at all → only the onboarding hint (copy `profile.example.json`, run `npm run sync`).
- Styles: `web/src/styles/profile.css` (tokens only).

## Profile sources

All optional, read by `lib/profile/read.mjs` `loadProfile` and merged by the pure `lib/profile/profile.mjs`
`buildProfile`. Manual wins over Strava for the same field.

### `profile.json` schema and validation

`profile/profile.json` (gitignored; tracked template `profile/profile.example.json`, synthetic).
With the LAN data service, this file mirrors a document in its database: after editing it, run `npm run documents -- push profile` (an edit not pushed is kept, and `npm run sync` warns about it); [`data-pipeline.md` → Owner documents](data-pipeline.md#owner-documents-scriptssync-documentsmjs-first-step-of-npm-run-sync).

| Field | Rule |
| --- | --- |
| `birthdate` | `YYYY-MM-DD` |
| `heightCm` | number |
| `sex` | optional, `male` \| `female`: picks the sex-specific reference curve of the fitness age (see `docs/health-tab.md` "Fitness age"); absent = no fitness age |
| `maxHr` | optional, bpm 100–230: the max HR of the per-workout HR zones (see [`data-pipeline.md` → Per-workout HR zones](data-pipeline.md#per-workout-hr-zones-workout-zonescsv)) |
| `devices` | `[{name, type: watch\|bike-computer\|ems\|other, since?: YYYY-MM, manual?: "<file>.pdf"}]`; `manual` = a bare file name in `data/gear/` (`MANUAL_FILE_RE`: no folders, no `..`) |
| `hiddenDevices` | `[name]`: left out of Devices, case-insensitive, manual and Strava-derived alike; applied at build time, never baked (for a device Strava saw once) |
| `supplements` | `[{name, dose?, meal}]` (see [`nutrition.md` → Supplements](nutrition.md#supplements)) |
| `events` | `[{name, date: YYYY-MM-DD, type?: hyrox\|race\|sportive\|other, location?}]`: upcoming races; baked sorted by date (`EVENT_TYPES`) |
| `name` / `city` | optional overrides |

Validated by `validateManual`:

- **Build**: a malformed file is IGNORED with a `WARNING:` naming the reason; the page still builds from the
  Strava + derived data.
- **`npm run check`** (`build-web.mjs --check`, `checkManualProfile`): FAILS on it with the same reason.

### Strava snapshot (`strava-profile.json` + `avatar.jpg`)

`data/profile/strava-profile.json` + `data/profile/avatar.jpg` (gitignored), written by
`data/profile/sync-profile.mjs` (`npm run sync:profile`, part of `npm run sync`, before the settings sync) from
the ingest service's `GET /export/athlete`.

- **Fields**: name, city / country, photo URL, athlete type (focus), bikes / shoes (name, brand / model, frame
  type, weight, distance in m, retired, primary), `gearScopeMissing`, and devices seen on stored activities
  (`device_name` → count + last day).
- **Device kind** (`deviceType`, from explicit brand + model lines only):

  | Kind | Matches |
  | --- | --- |
  | watch | Apple Watch, Garmin Forerunner / fēnix / Venu / Instinct / vivoactive / Epix |
  | bike computer | Garmin Edge, Wahoo ELEMNT, Hammerhead Karoo, COROS DURA |
  | other | Polar H10 / Verity sensors and anything unknown |

- The snapshot is rewritten only when its content changed.
- **Avatar** (`profile_medium`):
  - Downloaded only from Strava's photo hosts (`AVATAR_HOSTS`: `dgalywyr863hv.cloudfront.net` or
    `*.strava.com`, https, `redirect: 'error'`), streamed with a hard 60 KB cap.
  - Kept only if the response is `image/jpeg` AND starts with the JPEG magic bytes.
  - `avatarSourceUrl` in the snapshot records the URL the saved photo came from, set only after a successful
    download (the photo is written before the JSON).
  - A download is planned whenever it differs from `profileMedium` or the file is missing, so a failed
    download is retried next run and keeps the old photo (warning, exit 0).
  - Strava with no photo → the avatar is removed.
- **Failures**: no token / unreachable service / an ingest image without the endpoint (404) → exit 1, no file
  touched; any other failure → a one-line `ERROR:` and exit 1.
- A broken snapshot file is ignored by the build, never fatal.

### Derived weight and age

- **Weight** = the newest row of `weight.csv` with its date: the page passes `profile.mjs` `newestWeight` over
  `readExtract`'s `series.weight` as `loadProfile({ weight })`, so the file is read once per build.
  `loadProfile` never reads the extract, so omitted = no weigh-in. Never Strava's weight.
- **Age** is computed client-side from `birthdate` on the viewer's clock, so builds stay byte-identical.

## One source of truth per user fact

Read as FILES by the read-only coach subagents (see [`knowledge-base.md`](knowledge-base.md)):

| Fact | Source |
| --- | --- |
| Weight | `weight.csv` (live) |
| Name, sex, height, birthdate, devices, supplements, events | `profile/profile.json` |
| Goal + target weight | `data/profile/settings.json` |
| Stable context (injuries, history, preferences) | `profile/about-me.md` — never numbers in prose |

In the data service, name, sex, birthdate and height are stored ONCE, in the profile document (the database
copy of `profile.json`, [`data-pipeline.md` → Owner documents](data-pipeline.md#owner-documents-scriptssync-documentsmjs-first-step-of-npm-run-sync)),
whoever writes them: the coach's `npm run documents -- push profile` or the page's onboarding wizard, whose save
the service splits (its own fields to `app_profile`, the identity merged into the profile document at the next
revision; `services/loop-ingest/src/profile-db.js`). `GET /food/profile` composes them back, so `onboarding.json`
carries the same values as `profile.json`. An onboarding saved before this layout has its identity moved into
the document when the service starts (a value the document already has wins; the onboarding values it replaces are named in the `profile_identity_moved` log line).

### `settings.json`

`data/profile/settings.json` (gitignored, `data/profile/*`) = `{goal, targetWeightKg, updatedAt, fetchedAt}`.

- Written by `data/profile/sync-settings.mjs` (`npm run sync:settings`, step of `npm run sync` before
  `sync:foodlog`) from the ingest service's `GET /food/settings` (the server-side goal,
  [`nutrition-food-log.md` → Settings](nutrition-food-log.md#settings-goal-target-weight)).
- Request: `INGEST_URL`, `X-HC-Food: 1`, no token; the URL's host must be an IP literal, `localhost` or in
  `FOOD_ALLOWED_HOSTS`.
- Atomic; rewritten only when goal / target / updatedAt changed or the stored `fetchedAt` is from an earlier
  UTC day.
- Unreachable / 404 / 421 / 503 / a malformed body → a `WARNING:` line, the old file kept, exit 0.
- The goal list and target range are copies of `foodlog.mjs` `SETTINGS_GOALS` / `FOOD_LIMITS.targetWeight*`
  (a test pins them).
- The page does not read it (it asks the service directly).

### `onboarding.json`

`data/profile/onboarding.json` (gitignored, `data/profile/*`) = the in-page onboarding document (profile +
accepted nutrition targets of a user without an AI coach).

- Written by `scripts/sync-onboarding.mjs` (`npm run sync:onboarding`, step of `npm run sync` right after the
  settings) from `GET /food/profile` (same layer and headers as the settings; shape check
  `lib/profile/onboarding.mjs`).
- A wizard never completed writes nothing; a missing / old service or a malformed body is a `WARNING:`, the old
  file kept, exit 0.
- **The build uses it** (personal only, `lib/load/inputs.mjs`):
  - its name / sex / birthdate / height win over `profile.json` (`loadProfile({onboarding})`): with the data
    service both come from the same stored values (above), so they agree; devices, events, supplements and max
    HR stay in the file;
  - its accepted targets replace the plan's `targets.byGoal`;
  - the goal setting offers only the goals its safety screen allowed (`goalOptions(targets, allowed)`).
- Targets outside `lib/nutrition/energy.mjs` `checkTargets` hard bounds, or a malformed file → a build
  `WARNING:` and ignored (the plan's own targets are used).
- No file → the page is built from `profile.json` and the plan alone.

## Ingest side: Strava athlete and gear scope

`services/loop-ingest/src/athlete.js`, table `strava_athlete`, `sql/004_athlete.sql` +
`005_athlete_refresh.sql`.

### Refresh

- After a successful Strava pull has been recorded, the sync kicks off a refresh of `GET /athlete` +
  `GET /gear/{id}` (the athlete's gear and every `gear_id` on stored activities, ≤ 20):
  - in the background, not awaited by `POST /sync`; one refresh in flight; Strava calls aborted after 60 s;
  - at most once per 24 h.
- A failure is logged, stored in the row (`last_failure_at`, so a restart does not retry at once), retried
  after 1 h, and never fails the activity pull.
- A transient (5xx / network) `/gear/{id}` failure saves the snapshot with `gear_partial` and refreshes it again
  after 1 h; a 4xx for one id is final.

### `GET /export/athlete`

- Bearer, like every `/export/*`.
- Returns profile fields only — never the athlete id, username, sex, weight or raw payload; photo URLs only
  when `https://`.

### Gear scope

- Strava returns bikes / shoes only for a token with `profile:read_all`; without it `gearScopeMissing: true`
  (coarse flag) and the sheet says how to re-authorize.
- Re-authorize (steps in `services/loop-ingest/README.md`):
  1. back up `.env`;
  2. re-run `services/loop-ingest/scripts/strava-auth.js`;
  3. VERIFY the new token against Strava's token endpoint;
  4. only then back up and delete the stored `strava_token` row (it keeps the old scopes) and the
     `strava_athlete` row (to refresh now).
- Rollback = restore `.env.bak` + the backed-up token row.
- Rollout: `docker compose up -d --build loop-ingest` → `npm run sync` → `npm run generate`.

## Build

- `Avatar.astro` bakes `PROFILE` (the `photo` data URI replaced by a boolean) + `I18N_PROFILE`
  (`web/src/i18n/profile-templates.mjs`, es/en).
- The image is inlined ONCE, in the button's `<img id="avatar-img">`; profile.js copies it from there only if it
  is a `data:image/jpeg;base64,` URI.
- Example mode reads the synthetic `profile/profile.example.json` + `data/demo/strava-profile.json` and never a
  photo (initials).

## Device manuals (LAN page only)

The user's PDFs live in `data/gear/` (gitignored); only the file names are baked.

### Publishing

`scripts/publish-manuals.mjs` (`npm run publish:manuals`, rules in `lib/profile/manuals.mjs`) copies ONLY the
PDFs named by the visible devices' `manual` into `services/loop-web/site/manuales/` and removes everything else
there.

- A file is copied only if it is a regular file directly in `data/gear/` (opened `O_NOFOLLOW`, a symlink
  refused), starts with `%PDF-`, and is ≤ `MAX_MANUAL_BYTES` (50 MB).
- Copies are atomic and skipped when identical.
- A missing / refused file = a warning (exit 0); a broken / invalid profile.json leaves the folder untouched; a
  symlinked output folder = exit 1.
- `refresh.sh` runs it after writing `status.json` (a waiting Sync is already done), under its own 30 s timeout
  (`PLAN_WEB_MANUALS_TIMEOUT`), best effort (logged, never an error code).

### The "Manual" link

- The sheet writes a "Manual" link (`.pf-manual`, ≥ 44 px, `target="_blank" rel="noopener"`, labelled
  `Manual de <device> (PDF, …)`) `hidden`.
- profile.js reveals it only when `HEAD /manuales/<file>` answers 200 with an `application/pdf` type (one probe
  per file per load), so a static copy (e.g. a claude.ai artifact), `file://` and the example build (whose
  synthetic device names a manual) never show it.
- nginx side: see [`services/loop-web/README.md` → Security and exposure model](../services/loop-web/README.md#security-and-exposure-model).

## In-page onboarding (no AI coach needed)

`web/src/client/onboarding.js` registers the `onboarding` view (deep link `#onboarding`; LAN page only, since it
saves to the ingest service). Copy: `web/src/i18n/onboarding-templates.mjs` (`I18N_ONB`, baked by
`components/Avatar.astro`).

### Layout

A full-screen flow in the sheet, one question per screen: a `bare` sheet view with its own header.

- **Header**: ONE back arrow (on the cover it closes) + a segmented progress bar (`.onb-prog`, one segment per
  screen) + "Later".
- **Question**: large (`.onb-q`).
- **Options**: big cards — the `.seg` chip radios / checkboxes stretched by `.onb-card` / `.onb-in`: outlined, a ✓
  on the picked one.
- **Numbers**: large centred numbers for height / weight / target (`.onb-big`).
- **Continue**: pinned at the bottom (`.onb-nav`).
- The cover lists the three parts; the summary's average sits inside a ring (`.onb-ring`).

### Screens

1. **Welcome**, then **name** (optional), **sex**, **date of birth**, **height**, **weight** (prefilled from the
   newest weigh-in) and **activity outside training** (`sedentary` / `light` / `active` = the NEAT factor).
2. **Sports** — every `HC_ENERGY.SPORTS` key as a card (at least one), then one screen per picked sport: its usual
   session length (30 min … 4:00 pills) and times a week (1-7); a new pick starts at 1:00 × 3 (cycling 2:00 × 2).
3. **Safety** — pregnancy / breastfeeding (women), illness or medication, two eating-relationship questions. The
   answers are never saved: only the goals they allow (`goals`); pregnancy or under 18 stop here with a referral.
4. **Goal** — the goals `HC_ENERGY.screenPerson` allows (illness / eating answers offer maintenance only; BMI <
   18.5 removes the cut), then an optional **target weight** for a cut or bulk (`checkTargetWeight`).
5. **Summary**:
   - the week's average kcal for the goal as the hero number (each sport's sessions on its day type, the other
     days rest, more than 7 sessions scaled to 7) and protein;
   - one row per day type the sports reach (`usedDayTypes`) with its sports and kcal;
   - "Adjust the numbers" unfolds the kcal / protein / fat grid (carbs the remainder); `checkTargets` errors on
     those day types block the step, warnings only inform; "Recalculate" drops the edits;
   - the ±10 % disclaimer.
6. **Your data** — five numbered steps:
   1. the shared iOS Shortcut (an "Open" chip);
   2. the page's own origin to put in place of `TU-SERVIDOR`, with a "Copy" chip (`navigator.clipboard`; the
      page never names a data endpoint);
   3. where the token comes from (never shown);
   4. the Strava guide;
   5. the history: a one-off Apple Health export sent as a .zip to whoever runs the server (README → Level 1,
      step 3), the Shortcut keeping it current afterwards.

### Errors and screen readers

- A refused step re-renders with the inline error and an empty live region (`#onb-status`, `role="status"`), then
  sets its first error into that region in place, so it is announced (WCAG 4.1.3): "Pick one.", "Pick at least
  one.", a field's range, or on the summary the first blocking bound with its day ("Rest day: Below the safe
  minimum (1200 kcal).").
- The error `<small>` has an id (`onb-err-<field>`); the field (on a card screen, its first option) carries
  `aria-invalid="true"` and `aria-describedby` pointing at it, and focus moves there.
- Summary grid: each cell's name includes its day type (a visually hidden prefix, "Rest day kcal"); every cell of a
  row is described by that row's messages (`onb-msg-<day>-<n>`), and the cell a `checkTargets` error is about
  (kcal, protein or fat) is `aria-invalid`.

### Keyboard

- Enter in a field or on a card presses the primary button (Start / Continue / Save; Close on a stop) with the
  same checks; a focused button or link clicks itself.
- Esc closes it like every sheet.

### Sports and day types

The document may carry `sports` — `[{sport, minutes, perWeek}]`, one entry per sport.

- **Sports** (`energy.mjs` `SPORTS`): strength, running, cycling, swimming, hybrid = HYROX / CrossFit, team,
  yoga = yoga / pilates, other. The service keeps its own copy, `PROFILE_SPORTS`, pinned by a test.
- **Limits**: minutes 15-600, 1-14 per week.
- **Day type per session** (`dayTypeOfMinutes`, the same cut-offs as `daytype.mjs` `DETECT`):

  | Session length | Day type |
  | --- | --- |
  | < 75 min | short (`gym`) |
  | 75 – < 150 min | long (`bike`) |
  | ≥ 150 min | very long (`bikeLong`) |

- That day type's exercise becomes the time-weighted MET and average length of its sessions (`exerciseFor`);
  day types no sport reaches keep `EXERCISE`. `usedDayTypes` lists the ones a week has.
- Without `sports` the numbers are the `EXERCISE` defaults.
- `HC_ENERGY` is `lib/nutrition/energy.mjs` emitted as a classic global (`lib/nutrition/client.mjs`
  `energySource`), so the page and the build compute the same numbers
  (`web/test/client-globals-build.test.mjs` runs both).

### Saving

"Save and finish":

1. PUTs the document with its `sports` (`/api/food/profile`);
2. saves the goal and target weight through `HCSettings`;
3. presses the page's Sync button, so the next build bakes the accepted targets (the
   [`onboarding.json` precedence](#onboardingjson)).

### First run and entry points

- It opens on its own once, when the server has neither an onboarding document nor a goal and the page was not
  opened on a sheet deep link.
- "Later" is remembered in `localStorage` (`hc.onboarding.later`, a convenience only).
- The profile sheet opens it from the **Edit** chip at the end of its header row (name, age, place) on the LAN
  page.
