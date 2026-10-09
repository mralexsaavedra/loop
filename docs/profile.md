# Profile

Avatar button, profile sheet, profile sources, device manuals.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Profile — avatar button + profile sheet

Strava / WHOOP-style profile, honest data only, opened from a round **avatar button** in the top bar
on every tab (left on a phone, at the right end beside Sync from 900 px; `web/src/components/Avatar.astro`: the photo, else the initials, else a generic
person icon; ≥ 44px; NOT a tab). It reuses the detail sheet: `web/src/client/profile.js` (inlined
before detail.js) registers `window.HCViews.profile`, and detail.js renders any registered view in
the same modal (focus, inert, Esc, Back) with the deep link `#profile` instead of
`#detail/<metric>`; the Tab trap also cycles through `<summary>` and a checked radio.
`HCDetail.open(key, date, { focus: '<selector>' })` opens a view focused (and scrolled) on one of its
controls instead of the close button.

- **Goal setting ("Objetivo")** — the FIRST section under the header (also on the onboarding sheet):
  three labelled radios Mantener / Bajar / Ganar, each with a one-line description ("Mantener tu
  peso", "Déficit suave (~−350 kcal/día, sin tocar los días de bici)", "Superávit suave (~+300
  kcal/día)"). The kcal come from `lib/profile/goal.mjs` `goalOptions(resolveTargets(plan))` (mean
  goal − maintain over rest + gym, rounded to 10; "bike days untouched" only when bike / bikeLong
  equal maintain), baked as `PROFILE.goals` by `web/pages/index.astro`, never typed. The goal itself
  belongs to Nutrición (`client/nutri-day.js`, inlined before profile.js): the checked radio is
  `HCNutri.state().goal` and a change calls `HCNutri.setGoal`, which writes the SAME key as before
  (`hc.nutri.goal`, fallback `page.goal`) and refreshes the summary, plan, fuelling, Inicio card, rings
  and the kcal chip at once. No `HCNutri` or no options → the section is omitted. On the LAN page the
  goal is also stored on the SERVER and the section adds "Peso objetivo" + a status line + the
  Progreso line (see "Nutrition v2 part 3").

- **Sources** (all optional, merged by `lib/profile/profile.mjs` `loadProfile` → `buildProfile`;
  manual wins over Strava for the same field):
  1. `profile/profile.json` (gitignored; tracked template `profile/profile.example.json`, synthetic):
     `birthdate` (YYYY-MM-DD), `heightCm`, `sex` (optional, `male` | `female`: picks the sex-specific
     reference curve of the fitness age, see docs/health-tab.md "Fitness age"; absent = no fitness age), `maxHr` (optional, bpm 100–230: the max HR of the per-workout
     HR zones, see docs/data-pipeline.md "Per-workout HR zones"), `devices: [{name, type: watch|bike-computer|ems|other,
     since?: YYYY-MM, manual?: "<file>.pdf"}]` (`manual` = a bare file name in `data/gear/`,
     `MANUAL_FILE_RE`: no folders, no `..`; see "Device manuals" below), `hiddenDevices: [name]`
     (left out of Dispositivos, case-insensitive, manual and Strava-derived alike; applied at build
     time, never baked — for a device Strava saw once), `supplements: [{name, dose?, meal}]` (see "Nutrition v2"), `events:
     [{name, date: YYYY-MM-DD, type?: hyrox|race|sportive|other, location?}]` (upcoming races; baked
     sorted by date, `EVENT_TYPES`), optional `name` / `city` overrides. Validated by `validateManual`: at build
     time a malformed file is IGNORED with a `WARNING:` naming the reason (the page still builds from
     the Strava + derived data); `npm run check` (`build-web.mjs --check`, `checkManualProfile`)
     FAILS on it with the same reason.
  2. `data/profile/strava-profile.json` + `data/profile/avatar.jpg` (gitignored), written by
     `data/profile/sync-profile.js` (`npm run sync:profile`, part of `npm run sync`, before the settings sync) from the
     ingest service's `GET /export/athlete`: name, city / country, photo URL, athlete type (focus),
     bikes / shoes (name, brand / model, frame type, weight, distance in m, retired, primary),
     `gearScopeMissing`, and devices seen on stored activities (`device_name` → count + last day;
     the kind is guessed by `deviceType` from explicit brand + model lines only — Apple Watch, Garmin
     Forerunner / fēnix / Venu / Instinct / vivoactive / Epix → watch; Garmin Edge, Wahoo ELEMNT,
     Hammerhead Karoo, COROS DURA → bike computer; Polar H10 / Verity sensors and anything unknown →
     other). The snapshot is rewritten only when its content changed. The avatar (`profile_medium`)
     is downloaded only from Strava's photo hosts (`AVATAR_HOSTS`: `dgalywyr863hv.cloudfront.net` or
     `*.strava.com`, https, `redirect: 'error'`), streamed with a hard 60 KB cap, and kept only if
     the response is `image/jpeg` AND starts with the JPEG magic bytes. `avatarSourceUrl` in the
     snapshot records the URL the saved photo came from, set only after a successful download (the
     photo is written before the JSON); a download is planned whenever it differs from
     `profileMedium` or the file is missing, so a failed download is retried next run and keeps the
     old photo (warning, exit 0). Strava with no photo → the avatar is removed. No token /
     unreachable service / an ingest image without the endpoint (404) → exit 1, no file touched; any
     other failure → a one-line `ERROR:` and exit 1. A broken snapshot file is ignored by the build,
     never fatal.
  3. Derived: weight = the newest row of `weight.csv` with its date (never Strava's weight). The AGE is
     computed client-side from `birthdate` on the viewer's clock, so builds stay byte-identical.
- **One source of truth per owner fact** (read as FILES by the read-only coach subagents, see
  "Knowledge base + expert subagents"): weight = `weight.csv` (live), height / birthdate / devices /
  supplements / events = `profile/profile.json`, goal + target weight = `data/profile/settings.json`,
  stable context (injuries, history, preferences) = `profile/about-me.md` — never numbers in prose.
  `settings.json` (gitignored, `data/profile/*`) = `{goal, targetWeightKg, updatedAt, fetchedAt}`,
  written by `data/profile/sync-settings.js` (`npm run sync:settings`, step of `npm run sync` before `sync:foodlog`)
  from the ingest service's `GET /food/settings` (the server-side goal of "Nutrition v2 part 3";
  `INGEST_URL`, `X-HC-Food: 1`, no token; the URL's host must be an IP literal, `localhost` or in
  `FOOD_ALLOWED_HOSTS`): atomic, rewritten only when goal / target / updatedAt changed or the stored
  `fetchedAt` is from an earlier UTC day; unreachable / 404 / 421 / 503 / a malformed body → a
  `WARNING:` line, the old file kept, exit 0. The goal list and target range are copies of
  `foodlog.mjs` `SETTINGS_GOALS` / `FOOD_LIMITS.targetWeight*` (a test pins them). The page does not
  read it (it asks the service directly).
- **Ingest side** (`services/health-ingest/src/athlete.js`, table `strava_athlete`,
  `sql/004_athlete.sql` + `005_athlete_refresh.sql`): after a successful Strava pull has been
  recorded, the sync kicks off (in the background, not awaited by `POST /sync`; one refresh in
  flight; Strava calls aborted after 60 s) a refresh of `GET /athlete` + `GET /gear/{id}` (the
  athlete's gear and every `gear_id` on stored activities, ≤ 20) at most once per 24 h; a failure is
  logged, stored in the row (`last_failure_at`, so a restart does not retry at once), retried after
  1 h, and never fails the activity pull. A transient (5xx / network) `/gear/{id}` failure saves the
  snapshot with `gear_partial` and refreshes it again after 1 h; a 4xx for one id is final.
  `GET /export/athlete` (bearer, like
  every `/export/*`) returns profile fields only — never the athlete id, username, sex, weight or raw
  payload; photo URLs only when `https://`. Strava returns bikes / shoes only for a token with
  `profile:read_all`; without it `gearScopeMissing: true` (coarse flag) and the sheet says how to
  re-authorize (steps in `services/health-ingest/README.md`: back up `.env`, re-run
  `scripts/strava-auth.js`, VERIFY the new token against Strava's token endpoint, only then back up
  and delete the stored `strava_token` row, which keeps the old scopes, and the `strava_athlete` row
  to refresh now; rollback = restore `.env.bak` + the backed-up token row). Rollout: `docker compose up -d --build health-ingest` → `npm run sync` → `npm run generate`.
- **Build**: `Avatar.astro` bakes `PROFILE` (the `photo` data URI replaced by a boolean — the image
  is inlined ONCE, in the button's `<img id="avatar-img">`, and profile.js copies it from there only
  if it is a `data:image/jpeg;base64,` URI) + `I18N_PROFILE` (`web/src/i18n/profile-templates.mjs`,
  es/en). Example mode reads the synthetic `profile/profile.example.json` +
  `data/demo/strava-profile.json` and never a photo (initials).
- **Sheet**: header (photo / initials / icon, full name, age, location); Cuerpo / Body (height,
  latest weight + weigh-in date); Material / Gear (bikes, shoes; km to 1 decimal in `--num`, primary
  badge, retired ones folded in a `<details>`, a `--mid` hint on active shoes ≥ `SHOE_REPLACE_KM`
  (700): "consider replacing, ~700–800 km typical life"; the scope note instead when gear is missing);
  Dispositivos / Devices (manual first, Strava-derived ones deduped by name, case-insensitive, usage
  merged into a manual entry of the same name, which keeps its `manual`; `hiddenDevices` dropped; a
  "Manual" link per device with a manual, see below); Suplementos / Supplements (name, dose, meal; omitted
  when there are none); Strava (focus + snapshot date). Próximas pruebas / Upcoming events sits right
  after the goal: upcoming soonest first with "Hoy" / "Mañana" / "Dentro de N días" from
  `HC.daysOld` on the viewer's clock (nothing time-based baked), type · date · location, past ones
  folded in a `<details>` ("Pasadas (n)", newest first); "No hay pruebas próximas." when all are past;
  omitted without events. Nothing known at all
  → only the onboarding hint (copy `profile.example.json`, run `npm run sync`). Styles:
  `web/src/styles/profile.css` (tokens only).
- **Device manuals (LAN page only)** — the owner's PDFs live in `data/gear/` (gitignored); only the
  file names are baked. `scripts/publish-manuals.mjs` (`npm run publish:manuals`, rules in
  `lib/profile/manuals.mjs`) copies ONLY the PDFs named by the visible devices' `manual` into
  `services/plan-web/site/manuales/` and removes everything else there: a regular file directly in
  `data/gear/` (opened `O_NOFOLLOW`, a symlink refused), starting with `%PDF-`, ≤ `MAX_MANUAL_BYTES`
  (50 MB); copies atomic and skipped when identical; a missing / refused file = a warning (exit 0); a
  broken / invalid profile.json leaves the folder untouched; a symlinked output folder = exit 1.
  `refresh.sh` runs it after writing `status.json` (a waiting Sync is already done), under its own
  30 s timeout (`PLAN_WEB_MANUALS_TIMEOUT`), best effort (logged, never an error code). The sheet
  writes a "Manual" link (`.pf-manual`, ≥ 44 px, `target="_blank" rel="noopener"`, labelled "Manual de
  <device> (PDF, …)") `hidden`, and profile.js reveals it only when `HEAD /manuales/<file>` answers 200
  with an `application/pdf` type (one probe per file per load), so the claude.ai artifact, `file://`
  and the example build (whose synthetic device names a manual) never show it. nginx side: see "LAN
  page" → Security.
