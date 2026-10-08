# Training — Hoy + Entreno

Programmed session (Hoy), activity calendar and the executed-workouts dashboard. Strava sync rules: `docs/data-pipeline.md`.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Training tabs — "Hoy / Today" + "Entrenos / Workouts" pipeline

The same single-file build carries two training sections (programmed session in Inicio — a row of "Today's activities" —,
the `dash` section at the bottom of Entreno — they were tabs before the tab layout), computed by `lib/training/program.mjs`
(programmed sessions) and `lib/training/dashboard.mjs` (executed-workout aggregation) and
rendered by `web/src/tabs/{Hoy,Entrenos}.astro`. Same single-source pattern as nutrition.

**🏃 Entreno tab, above the intensity block** (`web/src/tabs/TrainingDetail.astro`, hosts only): a
centred uppercase title with an ⓘ (`#tr-intro`, hidden: the tab intro, how to read a card and the
data caveats every block shares; built server-side from `activity-templates.mjs` `head`, never baked
for the client), then the **load summary** (`#score-load`, client/score.js `loadHtml`): a "LOAD"
header with its own ⓘ (`#ld-info`: the as-of date, how to read a card, one line per modality with the
relative score / the trend band or why it is gated / sessions without effort, other activities,
coverage, the RE epoch and the caveats list — moved, not dropped) over three compact cards (gym / run /
bike): the LAST scored session's Relative Effort big in `--strain`, a small ring = the dial's own baked
arc for that session (`DIALS.load.modalities[].days[].fill`, the typical-day tick), "LOAD · <date>"
(`today` when it is the viewer's today) and a 7-day vs 42-day pill — grey • steady, teal ▲▼ above /
below usual, orange ▲▼ ramping / well below (`lib/score/load.mjs` bands); a gated modality shows "—"
and the dial's "Building" word. A card opens that modality's deep-dive (`load-<m>`). Then the
**Activity card** (`#train-activity`, `lib/training/activity.mjs` → `ACTIVITY`, baked in TrainingDetail
with `I18N_ACTIVITY`; client/training-activity.js) — ONE card for what used to be the 30-day calendar,
the cumulative training time and the dashboard's weekly volume + modality split: an "ACTIVITY" header
with an ⓘ (`#act-info`: how each number is counted, the distinct-days / duration note, the Watch-label
caveat), then TOTAL TIME of the chosen window with a neutral pill vs the window of the same length
before it (▲▼• and %; "no prior period" when that window starts before the first session — `first` —
or outside the baked days; "no training the … before" when it holds none), a W / M / 6M switch (7 /
30 / 182 days, the detail sheet's ranges; M by default, the choice kept per viewer in
`localStorage` `hc-act-range`, optional; the pressed button keeps focus), three tiles SESSIONS (one per
day and modality) · DAYS (distinct training days) · PER WEEK (the total over n/7 weeks), the modality
split as ONE stacked horizontal SVG bar (widths in attributes, largest first) with a legend "N× name
share · time" (gym `--strain`, strength `--strain-ink`, run `--up`, bike `--mid`, other `--faint`;
always named, never colour alone), then the compact calendar (always the last 30 days). The total and
the calendar open the `workouts` sheet, a day cell that day; the switch sits outside every opener.
Then running, cycling and load vs recovery (`#health-train`, client/health.js). The card follows the
dashboard's rules: duration not kcal, DISTINCT days, dashboard modality buckets, and the shared
same-day rule (`lib/training/sessions.mjs` `DISPLAY_RULE`: stubs under 3 min dropped, one source per
date + bucket, then summed). Only the last 367 data days are baked (6M twice + 3 days of viewer slack),
one entry per active day; the client ends every window at the VIEWER's today, or at the data date when
that is more than 3 days old (greyed, with a note) or AFTER the viewer's today (clock / timezone skew,
so the newest sessions stay visible). Calendar = Monday-first weeks, ONE sequential hue (`--strain`) in
five levels by total minutes (none, < 30, 30–59, 60–89, 90+), an SVG `<title>` per cell. Phones get
a fixed-size SVG (max 280 px wide); on wide screens (`matchMedia('(min-width: 900px)')`, re-rendered
when the breakpoint is crossed) the same days, levels, titles and day openers render as an HTML
`.cal-grid`: 7 equal columns (`repeat(7, 1fr)`), at most 640 px wide and centred in the card, weekday
letters centred over their column, `width: 100%` + `aspect-ratio: 1` tiles capped at `max-height: 48px`
(a ~85 × 48 px rounded tile, the month ~250 px tall), legend below, centred with the grid. Everything else in the card stays stacked.

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

**📈 Intensity (HR) — what is left of the executed-sessions dashboard** (`dash` section,
`tabs/Entrenos.astro`, client/training-dash.js). Source (OPTIONAL):
`data/apple-health/extract/workouts.csv`. `lib/training/dashboard.mjs` aggregates it (`DASH`: over 12
weeks, per modality the minutes + mean / peak HR, and how many sessions carry HR; only what the page
reads is baked — no weekly volume, 4-week summary or split %). The page draws only the HR part:
an "INTENSITY (HR)" header with an ⓘ (`#int-info`: the minute-weighted mean, how many sessions carry HR,
the window and data date, the strength caveat) over one `HC.metricRow` per modality with HR — the mean
HR, the peak as the small line, highest first. The extract has no heart-rate zones, so no zone bars
are drawn, and the HR is a fixed 12-week aggregate (not per W / M / 6M), so it stays a compact card of
its own instead of joining the Activity card. No data or no HR: nothing is drawn (the Activity card
holds the empty state). Volume, frequency and the modality split are the Activity card's now (same
same-day rule, so the numbers agree). Data-honesty rules stay baked in: use DURATION not kcal (blank on
recent exports); count DISTINCT DAYS not raw rows (the Watch fragments one session into several
records) after the shared same-day `DISPLAY_RULE` (stubs dropped, a Watch copy of a Strava session
counted once); the modality buckets (strength/hiit/run/bike/other) reflect the WATCH's auto-labels,
which over-tag HIIT and under-count strength — the Activity card's ⓘ says so. The `hiit` bucket is
LABELLED "Gimnasio"/"Gym" (display only, same bucket) so it matches Inicio's gym load card; `strength`
keeps its own label.

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
