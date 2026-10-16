# Training tab — today's session and the calendar

Programmed session (Hoy), activity calendar and the executed-workouts dashboard. Strava sync rules: `docs/data-pipeline.md`.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

On this page:

- [Pipeline](#pipeline)
- [Training tab layout](#training-tab-layout)
- [Title and intro](#title-and-intro)
- [Load summary](#load-summary)
- [Activity card](#activity-card): [window and switch](#window-and-switch), [counting rules](#counting-rules), [data date](#data-date), [calendar](#calendar)
- [Running, cycling, load vs recovery](#running-cycling-load-vs-recovery)
- [Intensity (HR)](#intensity-hr)
- [Per-workout HR zones](#per-workout-hr-zones)
- [Today's session (Hoy)](#todays-session-hoy): [training-data.json is optional](#training-datajson-is-optional), [the Hoy section is optional and source-agnostic](#the-hoy-section-is-optional-and-source-agnostic)
- [Program source](#program-source)
- [Fresh-clone bootstrap and checks](#fresh-clone-bootstrap-and-checks)

## Pipeline

The single-file build carries two training data sets, same single-source pattern as nutrition:

| Data | Lib | Baked as | Rendered by |
| --- | --- | --- | --- |
| Programmed sessions | `lib/training/program.mjs` | page-level JSON global | `web/src/tabs/Hoy.astro`, `client/training-today.js` |
| Executed-workout aggregation | `lib/training/dashboard.mjs` (pure `dashboardFrom(inputs)`) | `DASH` | `web/src/tabs/Entrenos.astro`, `client/training-dash.js` |
| Activity card | `lib/training/activity.mjs` (pure `activityFrom(inputs)`) | `ACTIVITY` + `I18N_ACTIVITY` | `client/training-activity.js` |

- Executed workouts come from `lib/extract/read.mjs` `readExtract`'s `trainingRows`, the build's one
  `workouts.csv` read; `lib/training/read.mjs` holds the training file reads `readExtract` calls.
- The programmed session is not a Training block: it is a row of Home's "Today's activities"
  ([Today's session](#todays-session-hoy)).
- Strava sync (`npm run sync:strava`): see `docs/data-pipeline.md` → Strava sync.

## Training tab layout

Hosts live in `web/src/tabs/TrainingDetail.astro` (hosts only) and `Entrenos.astro`. Top to bottom:

| # | Block | Section key (`data-section`) | Host | Client |
| --- | --- | --- | --- | --- |
| 1 | Title + ⓘ | — | `#tr-intro` | — |
| 2 | Load summary | `load` | `#score-load` | `score.js` `loadHtml` |
| 3 | Activity card | `calendar` | `#train-activity` | `training-activity.js` |
| 4 | Running, cycling, load vs recovery | `sessions` | `#health-train` | `health.js` |
| 5 | Intensity (HR) | `dash` | `#train-dash` | `training-dash.js` |

## Title and intro

What it shows: a centred uppercase title with an ⓘ.

- `#tr-intro` (hidden): the tab intro, how to read a card and the data caveats every block shares.
- Built server-side from `activity-templates.mjs` `head`, never baked for the client.

## Load summary

What it shows: per modality (gym / run / bike), the last scored session's Relative Effort and its
7-day vs 42-day trend.

- Header: "LOAD" with its own ⓘ (`#ld-info`): the as-of date, how to read a card, one line per modality
  with the relative score / the trend band or why it is gated / sessions without effort, other
  activities, coverage, the RE epoch and the caveats list.
- Three compact cards (gym / run / bike), each:
  - the LAST scored session's Relative Effort big, in `--strain`;
  - a small ring = the dial's own baked arc for that session (`DIALS.load.modalities[].days[].fill`, the
    typical-day tick);
  - "LOAD · <date>" (`today` when it is the viewer's today);
  - a 7-day vs 42-day pill (`lib/score/load.mjs` bands):

| Pill | Meaning |
| --- | --- |
| grey • | steady |
| teal ▲▼ | above / below usual |
| orange ▲▼ | ramping / well below |

- A gated modality shows "—" and the dial's "Building" word (also when its trend is ok but the dial is gated).
- The pill sits on the card's bottom edge (`.ld-foot`), so the three align when a "LOAD · 6 OCT" label wraps.
- A card without a value ("—": no session in the data) has no pill (a "▼ -64%" beside "—" would read as a value).
- A card opens that modality's deep-dive (`load-<m>`).
- These cards are where per-modality Relative Effort lives, since Home's third dial is the day strain
  (`docs/home-tab.md`): the strain dial has no modality pills, and its deep-dive links back to the three
  `load-<m>` pages.

## Activity card

What it shows: one card for training time, sessions, training days, the modality split and the 30-day
calendar.

- Source: `#train-activity`, `lib/training/activity.mjs` → `ACTIVITY`, read by the pure
  `activityFrom(inputs)` over the same `readExtract` inputs, baked in TrainingDetail with `I18N_ACTIVITY`;
  `client/training-activity.js` renders it.
- Header: "ACTIVITY" with an ⓘ (`#act-info`): how each number is counted, the distinct-days / duration
  note, the Watch-label caveat.
- Body, top to bottom:
  1. TOTAL TIME of the chosen window, with a neutral pill vs the window of the same length before it (an
     `--ink` ▲▼ or a grey • when steady, and %). "no prior period" when that window starts before the
     first session (`first`) or outside the baked days; "no training the … before" when it holds none.
  2. The W / M / 6M switch ([below](#window-and-switch)).
  3. Three tiles: SESSIONS (one per day and modality) · DAYS (distinct training days) · PER WEEK (the
     total over n/7 weeks).
  4. The modality split as ONE stacked horizontal SVG bar (widths in attributes, largest first) with a
     legend "N× name share · time" — always named, never colour alone (colours below).
  5. The compact calendar (always the last 30 days, [below](#calendar)).

| Modality | Split colour |
| --- | --- |
| gym | `--strain` |
| strength | `--strain-ink` |
| run | `--up` |
| bike | `--mid` |
| other | `--faint` |

- Openers: the total and the calendar open the `workouts` sheet, a day cell that day; the switch sits
  outside every opener.

### Window and switch

- The shared segmented control `.dt-range` (as in the trend sheets): W / M / 6M = 7 / 30 / 182 days, the
  detail sheet's ranges.
- M by default; the choice is kept per viewer in `localStorage` `hc-act-range` (optional); the pressed
  button keeps focus.
- Only the last 367 data days are baked (`BAKE_DAYS`: 6M twice + 3 days of viewer slack), one entry per
  active day.

### Counting rules

Same rules as the dashboard:

- duration, not kcal;
- DISTINCT days;
- the dashboard modality buckets;
- the shared same-day rule (`lib/training/sessions.mjs` `DISPLAY_RULE`: stubs under 3 min
  (`STUB_MAX_MIN`) dropped, one source per date + bucket, then summed).

### Data date

- `asOf` = the last session or `trainingThrough` (the newest Watch HRV / resting HR / sleep / hourly HR
  day, `lib/training/through.mjs`), whichever is later, so rest days are not stale data.
- The client ends every window at the VIEWER's today, except:

| Case | Window ends at |
| --- | --- |
| data date more than 3 days old | the data date, greyed, with the short stale marker `HC.staleMark` ("Data 10 d old ⓘ", a tap opens the sentence) |
| data date AFTER the viewer's today (clock / timezone skew) | the data date, so the newest sessions stay visible |

### Calendar

- Monday-first weeks, ONE sequential hue (`--strain`) in five levels by total minutes: none, < 30,
  30–59, 60–89, 90+. An SVG `<title>` per cell.
- Phones: a fixed-size SVG (max 280 px wide).
- Wide screens (`matchMedia('(min-width: 900px)')`, re-rendered when the breakpoint is crossed): the same
  days, levels, titles and day openers render as an HTML `.cal-grid`:
  - 7 equal columns (`repeat(7, 1fr)`), at most 640 px wide and centred in the card;
  - weekday letters centred over their column;
  - `width: 100%` + `aspect-ratio: 1` tiles capped at `max-height: 48px` (a ~85 × 48 px rounded tile, the
    month ~250 px tall);
  - legend below, centred with the grid.
- Everything else in the card stays stacked.

## Running, cycling, load vs recovery

`#health-train`, rendered by `client/health.js`: see `docs/health-tab.md` → Training tab cards.

## Intensity (HR)

What it shows: per modality, the mean and peak HR over a fixed 12-week window — what is left of the
executed-sessions dashboard.

- Section `dash`, `tabs/Entrenos.astro`, `client/training-dash.js`.
- Source (OPTIONAL): `loop-data/extract/workouts.csv`.
- `lib/training/dashboard.mjs` aggregates it into `DASH`: over 12 weeks (`WEEKS`), per modality the
  minutes + mean / peak HR, and how many sessions carry HR. Only what the page reads is baked (no weekly
  volume, 4-week summary or split %).
- Header: "INTENSITY (HR)" with an ⓘ (`#int-info`): the minute-weighted mean, how many sessions carry HR,
  the window and data date, the strength caveat.
- One `HC.metricRow` per modality with HR, highest first: its own icon (strength a dumbbell, gym a bolt,
  run, bike; other cardio a neutral clock), the mean HR, the peak as the small line.
- No zone bars: the per-workout zones are per session, and a modality total would need a W / M / 6M
  switch of its own.
- The HR is a fixed 12-week aggregate (not per W / M / 6M), so it stays a compact card of its own instead
  of joining the Activity card.
- No data or no HR: nothing is drawn (the Activity card holds the empty state).
- Volume, frequency and the modality split belong to the Activity card (same same-day rule, so the
  numbers agree).

Data-honesty rules baked in:

- Use DURATION, not kcal (blank on recent exports).
- Count DISTINCT DAYS, not raw rows (the Watch fragments one session into several records), after the
  shared same-day `DISPLAY_RULE` (stubs dropped, a Watch copy of a Strava session counted once).
- The modality buckets (strength / hiit / run / bike / other) reflect the WATCH's auto-labels, which
  over-tag HIIT and under-count strength — the Activity card's ⓘ says so.
- The `hiit` bucket is LABELLED `Gimnasio` / "Gym" (display only, same bucket) so it matches Home's gym
  load card; `strength` keeps its own label.

## Per-workout HR zones

What it shows: for one session, the time in each HR zone (session / day panel).

- Where: a run / ride row of Training and the load deep-dive open the day panel of `load-<m>` / `workouts`
  (`docs/detail-views.md`). Each session there with Strava HR zones (`workout-zones.csv`,
  `docs/data-pipeline.md` "Per-workout HR zones") gets the reference's activity-detail block.
- Block:
  - a "HEART-RATE ZONES" header with avg / max HR;
  - rows ZONE 5…0: the bpm range at the max HR used, the % of the zoned time, the duration (m:ss) and a
    horizontal bar in the zone colour, warm → cool (`--low`, `--down`, `--mid`, `--good`, `--strain`,
    `--faint`);
  - an ⓘ "About the zones" fold with the model and the max HR + its source.
- Model (the reference's, `lib/training/hr-zones.mjs`), % of max HR:

| Zone | % of max HR |
| --- | --- |
| Z0 | < 50 % |
| Z1 | 50–60 |
| Z2 | 60–70 |
| Z3 | 70–80 |
| Z4 | 80–90 |
| Z5 | ≥ 90 % |

- Max HR = `loop-data/cache/profile.json` `maxHr` if set, else the highest HR Strava recorded in the last 12
  months.
- Several Strava activities of the same date + modality are summed.
- No zones for that session (a Watch-only session, an activity the backfill has not reached, no HR, no
  file): no block.

## Today's session (Hoy)

What it shows: the programmed session for today, as a row of Home's "Today's activities" (not a block).

- `client/training-today.js` renders the session into `#train-today` inside the `hoy` section
  (`tabs/Hoy.astro`, a hidden source: `.hoy-src`).
- It sets `window.HCProgram = {date, kind, focus}` for `client/timeline.js` (the row) and registers the
  `hoy-session` detail view (the same markup in the sheet; deep link `#hoy-session`, `VIEW_TAB` → home).
- `page.hideTabs: ["hoy"]` hides the section; then neither the row nor the view exist.
- Source: `loop-data/cache/training.json` (GITIGNORED, personal, and OPTIONAL — see below): the
  programmed sessions keyed by ISO date (`days["YYYY-MM-DD"]`); a date with no entry renders as a rest /
  unprogrammed day.
- The build bakes it into a page-level JSON global; the page picks "today" client-side with `new Date()`.
- The page is a build-time snapshot, so the baked program must cover the current date — regenerate when a
  new block lands.
- Program files are often exported / named by a training partner, not the coach — never infer the coach's
  identity from a filename; take it from `profile/about-me.md`.

### training-data.json is optional

`loop-data/cache/training.json` itself is OPTIONAL for the personal build.

- Absent file → the build still succeeds: `lib/load/inputs.mjs` degrades to an empty program
  (`{days:{}}`), and Hoy renders every day as a rest / unprogrammed day (the same empty state a real file
  with no sessions produces).
- The executed-workout blocks (Activity card, Intensity (HR)) are unaffected (they read Apple Health
  `workouts.csv`, not this file).
- `npm run check` treats a genuinely absent file as "nothing to validate", not an error — it fails only if
  the file exists but is malformed / empty.
- Distinct from `page.hideTabs: ["hoy"]`, which hides the SECTION; leaving the file absent keeps the
  section visible but permanently in its empty state.

### The Hoy section is optional and source-agnostic

- The program can come from any dated source (coach PDFs, a spreadsheet, or a login-gated training app
  whose content can't be scraped).
- If the user's program lives in an external app they open directly, a dated copy here is redundant: set
  `page.hideTabs: ["hoy"]` in `loop-data/cache/plan.json` to hide the section on Home (the markup + baked training
  data stay fully wired, just `hidden`; remove the entry to reactivate).
- Keep the section visible in the example build (`plan-data.example.json` has no `hideTabs`) as a working
  example.
- Which program / app the user actually uses is personal → it lives in `profile/about-me.md`
  (gitignored), never in a tracked file.

## Program source

Whatever the user's coach / app provides: a coach PDF, a spreadsheet, or a login-gated training app.

| Source | How it gets into `loop-data/cache/training.json` |
| --- | --- |
| Can't be fetched (a login-gated app) | the user pastes / screenshots the sessions and you transcribe them |
| PDF grids in `loop-data/files/documents/training/*.pdf` (spreadsheet-style weekly grids) | render pages to PNG (`pdftoppm -png -r 130`) and read the grid visually (`pdftotext` interleaves the day columns) |

## Fresh-clone bootstrap and checks

- Copy `data/training/training-data.example.json` → `loop-data/cache/training.json`, edit in the real program, then
  `npm run generate` (part of the shared bootstrap, README → Setup; one `npm run generate` builds all 4
  tabs together).
- With the LAN data service, this file mirrors a document in its database: after editing it, run `npm run documents -- push training` (an edit not pushed is kept, and `npm run sync` warns about it); [`data-pipeline.md` → Owner documents](data-pipeline.md#owner-documents-scriptssync-documentsmjs-first-step-of-npm-run-sync).
- Optional: skipping it (or deleting `loop-data/cache/training.json` later) still builds, with Hoy permanently in its
  rest / unprogrammed state.
- `npm run check` validates `loop-data/cache/training.json` when it exists (`build-web.mjs --check`).
- `npm test` covers the training lib with its own unit tests plus the build-output / i18n / hide-tabs
  integration tests.
