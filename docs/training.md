# Training — Hoy + Entreno

Programmed session (Hoy), activity calendar and the executed-workouts dashboard. Strava sync rules: `docs/data-pipeline.md`.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Training tabs — "Hoy / Today" + "Entrenos / Workouts" pipeline

The same single-file build carries two training sections (programmed session in Inicio — a row of "Today's activities" —,
Entrenamiento at the bottom of Entreno — they were tabs before the tab layout), computed by `lib/training/program.mjs`
(programmed sessions) and `lib/training/dashboard.mjs` (executed-workout aggregation) and
rendered by `web/src/tabs/{Hoy,Entrenos}.astro`. Same single-source pattern as nutrition.

**🏃 Entreno tab, above the dashboard** (`web/src/tabs/TrainingDetail.astro`, hosts only): the
per-modality load cards + caveats (`#score-load`, client/score.js), then the **30-day activity
calendar** and **cumulative training time** (`#train-activity`, `lib/training/activity.mjs` →
`ACTIVITY`, baked in TrainingDetail with `I18N_ACTIVITY`; client/training-activity.js), then running,
cycling and load vs recovery (`#health-train`, client/health.js). The calendar/cumulative follow the
dashboard's rules: duration not kcal, DISTINCT days, dashboard modality buckets, and the shared
same-day rule (`lib/training/sessions.mjs` `DISPLAY_RULE`: stubs under 3 min dropped, one source per
date + bucket, then summed); the workouts dashboard uses the same rule, so its days/minutes agree. Only the last 63 data days are baked (two 30-day windows + 3 days of viewer slack), one entry
per active day; the client ends both windows at the VIEWER's today, or at the data date when that is
more than 3 days old (greyed, with a note) or AFTER the viewer's today (clock / timezone skew, so the
newest sessions stay visible). Calendar = Monday-first weeks, ONE sequential hue
(`--strain`) in five levels by total minutes (none, < 30, 30–59, 60–89, 90+), an SVG `<title>` per
cell; cumulative = the running sum of daily minutes, last 30 days (`--strain`) vs the previous 30
(dashed `--faint`), totals written in the legend, a hover target per day.

**🏋️ Hoy / Today — programmed session.** On Inicio it is a row of "Today's activities", not a
block: `client/training-today.js` renders the session into `#train-today` inside the `hoy` section
(`tabs/Hoy.astro`, a hidden source: `.hoy-src`), sets `window.HCProgram = {date, kind, focus}` for
`client/timeline.js` (the row) and registers the `hoy-session` detail view (the same markup in the
sheet; deep link `#hoy-session`, `VIEW_TAB` → home). `page.hideTabs: ["hoy"]` hides the section, and
then neither the row nor the view exist. Source: `data/training/training-data.json`
(GITIGNORED, personal, and OPTIONAL — see below) — the programmed sessions keyed by ISO
date (`days["YYYY-MM-DD"]`); a date with no entry renders as a rest / unprogrammed day. The
build bakes it into a page-level JSON global; the page picks "today" client-side with `new
Date()`. The artifact is a frozen snapshot, so the baked program must cover the current date —
regenerate + re-publish when a new block lands. NOTE: program files are often exported/named by
a training partner, not the coach — never infer the coach's identity from a filename; take it
from `profile/about-me.md`.

**`training-data.json` itself is OPTIONAL for the personal build.** If it does not exist at
all, the build still succeeds — `lib/load/inputs.mjs` degrades to an empty program
(`{days:{}}`), and Hoy renders every day as a rest/unprogrammed day (same empty state a real
file with no sessions produces); Entrenos is unaffected (it reads Apple Health `workouts.csv`,
not this file). `npm run check` likewise treats a genuinely absent file as "nothing to
validate" rather than an error — it only fails if the file exists but is malformed/empty. This
is distinct from `page.hideTabs: ["hoy"]` below, which hides the SECTION; leaving the file
absent keeps the section visible but permanently in its empty state.

**The Hoy section is optional and source-agnostic.** The program can come from any dated source
(coach PDFs, a spreadsheet, or a login-gated training app whose content can't be scraped). If
the owner's program lives in an external app they open directly, maintaining a dated copy here
is redundant — set `page.hideTabs: ["hoy"]` in `plan-data.json` to hide the section in Inicio
(the markup + baked training data stay fully wired, just `hidden`; remove the entry to
reactivate). Keep the section visible in the example build (`plan-data.example.json` has no
`hideTabs`) as a working example. Which program/app the owner actually uses is personal → it
lives in `profile/about-me.md` (gitignored), never in a tracked file.

**📈 Entrenos / Workouts — executed-sessions dashboard.** Source (OPTIONAL):
`data/apple-health/extract/workouts.csv`. `lib/training/dashboard.mjs` aggregates it
(frequency, weekly volume, modality split). If the CSV is absent (fresh clone), the tab
shows an empty state — it never fails the build. Data-honesty rules are baked in: use DURATION
not kcal (blank on recent exports); count DISTINCT DAYS not raw rows (the Watch fragments one
session into several records) after the shared same-day `DISPLAY_RULE` (stubs dropped, a Watch copy
of a Strava session counted once — same totals as the calendar); the modality split (strength/hiit/run/bike/other) reflects the
WATCH's auto-labels, which over-tag HIIT and under-count strength — the page says so on-screen. The
`hiit` bucket is LABELLED "Gimnasio"/"Gym" (display only, same bucket) so it matches Inicio's gym
load card; `strength` keeps its own label.

Strava sync (`npm run sync:strava`): see `docs/data-pipeline.md` → Strava sync.

**Source of the program:** whatever the owner's coach/app provides — a coach PDF, a spreadsheet,
or a login-gated training app. For a source that can't be fetched (a login-gated app), the owner
pastes/screenshots the sessions and you transcribe into `training-data.json`. For PDF grids in
`data/training/*.pdf` (spreadsheet-style weekly grids), transcribe by rendering pages to PNG
(`pdftoppm -png -r 130`) and reading the grid visually (`pdftotext` interleaves the day columns).

**Fresh-clone bootstrap:** copy `data/training/training-data.example.json` →
`training-data.json`, edit in the real program, then `npm run generate` (part of the shared
nutrition bootstrap above — one `npm run generate` builds all 4 tabs together). This step is
optional — skipping it (or deleting `training-data.json` later) still builds, with Hoy
permanently in its rest/unprogrammed state. `npm run check` validates training-data.json when
it exists (`build-web.mjs --check`); `npm test` covers the training lib with its own unit tests
plus the build-output/i18n/hide-tabs integration tests.
