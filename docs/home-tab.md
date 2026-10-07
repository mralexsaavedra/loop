# Home tab — Inicio

Dials, advice, eat card, health monitor, timeline; recovery and load scoring; the shared same-day merge rule; workouts.csv columns.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Home tab — "Inicio / Home" dials, advice, eat card, health monitor, timeline; recovery + load detail

Top to bottom (`web/src/tabs/Home.astro`, which also renders `components/EatCard.astro`): dials
(`#home-dials`) → the advice sentence (`#home-advice`) → the "today you eat" card → the health monitor
(`#monitor`) → today's timeline (`#timeline`) → the programmed session (`hoy`). The conclusion and
today's eating sit right under the dials; the per-signal detail follows (`web/test/content.test.mjs`
pins the order).

**Collapsed dial row** (`#home-mini`, first in `Home.astro`): once the dials scroll above the viewport
(an IntersectionObserver on `#home-dials`, `score.js`), a frosted strip fixed at the top shows the
three dials again as mini rings + labels (Sleep · Recovery · Load). Every `dialFig` call also queues
its mini item from the SAME svg string, colour class, label and detail opener (`HC.detailAttrs`), so
nothing is recomputed and a tap opens the same detail as the dial; the load items carry `data-dmod`,
so the modality switch (`scMod`) moves them too. Off it is `visibility: hidden` (out of the tab order
and the accessibility tree); the slide / fade is dropped under `prefers-reduced-motion`; with no data
or without IntersectionObserver it stays off.

`lib/score/*` (same single-source pattern) feeds the first tab; `web/src/client/score.js` renders it
(dials + advice on Inicio; the recovery card into Salud's `#score-recovery` and the per-modality load
cards + caveats into Entreno's `#score-load` — glance vs detail),
`buildScores(extractDir)` bakes `SCORES` (only `asOf` dates — staleness is computed client-side, so
consecutive builds are byte-identical). The tab is first and active by default; the visible panel is
derived from the FILTERED nav list (`activeTabKey`), so `page.hideTabs: ["home"]` hands over to the next
tab and hiding every tab is a build error.

**Today first, trend as context** (Bevel/Whoop-style, but no invented 0-100 scale): every headline
is the newest day, and the trend is the line under it.

- **Recovery** is in units of the owner's typical spread (scaled MAD), never a 0-100 grade; ONE unit
  key, `RECOVERY_UNIT` (`lib/score/advice-copy.mjs`, re-exported by score-templates: en "SD", es
  "desv."; dict `recovery.unit`), builds every recovery string — advice, dial, Salud card, monitor note,
  detail sheet — and the Salud card explains it in one line (`recovery.unitNote`: "typical spread" /
  "variación típica"); no unit literal in score.js: HRV (daytime SDNN), resting HR, sleep duration and
  sleep regularity vs a median/MAD baseline (42 days ending asOf-1), z clamped ±3, weights
  .40/.25/.25/.10. Band: ≥ +0.5 above / within ±0.5 at / ≤ -0.5 below baseline (`BAND_CUTOFF` in
  `recovery.mjs`). Headline = `today`, the composite of the asOf day alone (last night), same
  baseline; a single day is noisier than the 7-day mean (measured σ_daily 0.782 vs σ_7 0.328,
  `MEASURED_SIGMA`), so its band is cut at `DAY_BAND_CUTOFF` = `BAND_CUTOFF` × σ_daily/σ_7 ≈ 1.2 (same
  false-flip rate). `today` is `null` unless the components present that day carry ≥ 0.60 of the
  weight AND include HRV or RHR (a sleep-only night is too thin), in which case the page says "no data
  for last night" and shows the trend instead; `today.sleep` is false when that day has no
  sleep-duration reading, and the page then labels it by date + "no sleep data", never "last night".
  Context = `trend7` (mean composite of the 7 days ending asOf) and `trendDir` = `delta7` (this
  week's trend7 − last week's): two non-overlapping 7-day means differ with noise √2 × σ_7 ≈ 0.46,
  so it is cut at `TREND_DIR_CUTOFF` = `BAND_CUTOFF` × √2 ≈ 0.7: up / steady / down. The recovery
  detail card (Salud `#score-recovery`, Whoop-style) spans the full grid row: headline (last night's
  composite as the big number + band word; the 7-day trend is a small secondary line) | 14-day
  sparkline | compact contributors (state dot, name, latest value + unit, baseline · MAD · n for HRV,
  RHR, sleep duration, sleep regularity), side by side on wide screens and stacked on phones; the
  confidence + SDNN chips stay on one line and the raw last-14-days lists fold into a `<details>`
  ("Last 14 days" / "Últimos 14 días"). Gated ("insufficient")
  unless components with ≥ 14 baseline days carry ≥ 0.60 of the weight, include HRV or RHR, and there
  are ≥ 7 composite days in the last 14. "Last night" is the newest COMPLETE day among asOf and the 2
  days before it (`MAX_TODAY_FALLBACK_DAYS`): it needs a sleep-duration reading AND a resting-HR value
  AND — only when HRV is a scored component (the user has an HRV baseline) — an HRV day with ≥
  max(min(3, usual), 50% of usual) samples (`completeDay`; usual = median daily sample count over the
  baseline; only plausible samples inside the HRV clamp range count, identical rows once), plus ≥ 0.60
  of the weight. A user without Watch HRV is scored on sleep + resting HR. A partial newest day (e.g.
  no RHR yet) falls back to the previous complete one, labelled by its date, and stays in the trend and
  baselines; with no complete day in those 3 the headline is the trend with a "no recent complete
  night" note. The monitor cards and Salud's HRV headline keep per-signal
  completeness (HRV sample floor only).
- **Load** is PER MODALITY (gym / run / bike; `other` is shown raw, never scored) and Relative-Effort-only
  (Strava `suffer_score`; Apple rows have no RE and are counted as `unscored`). Same-day rows follow
  the shared rule below (junk dropped, one source, then SUM). The series starts at the first date with any RE
  (`reEpoch`); acute 7d vs chronic 42d EWMA; a modality gates ("baselineBuilding") under 28 days since the
  epoch, under 8 non-zero days, or chronic < 1. The 0-100 `relScore` exists only within a modality.
  A day whose rows in a modality are ALL unscored is MISSING, not rest: both EWMAs carry forward
  over it without decay, and a modality whose last 7 days hold such sessions says so on its card and
  load dial's detail sheet header ("includes N sessions without effort data"). Trend bands: ramping ≥ +30%, above ≥
  +10%, steady, below ≤ −10%, well below < −30% (never "detraining": the data cannot tell a deload
  or missing effort data from fitness loss).
  Today first: `typical` = the median of the NON-ZERO days in the 42 days before asOf (asOf
  excluded; `value: null` under 6 such days — `TYPICAL_WINDOW_DAYS` / `MIN_TYPICAL_DAYS` in
  `load.mjs`). `recent` = the session days of the last `RECENT_DAYS` (14) ending asOf, each
  `{date, re, unscored}` (only dates with valid non-junk rows in that modality; `unscored` = rows
  without RE), and `last` = the newest day with RE > 0. The VIEWER's today is picked client-side from
  `recent`, so nothing today-relative is baked.
- **Health monitor** (`lib/score/monitor.mjs`, baked as `SCORES.monitor` even when `hasData` is false;
  `components/HealthMonitor.astro` + `client/monitor.js`, under the dials, advice and eat card): cards for respiratory
  rate, resting HR, HRV, sleeping wrist temperature and sleep duration. Each = the newest daily value
  (per-day median of plausibility-clamped samples) + unit, its date when it is not from the viewer's
  today, and Normal / High / Low (es: Normal / Alto / Bajo) vs a personal band = median ± 1.5 × scaled
  MAD (`robustBaseline`, floored per signal) over the 42 days BEFORE that value; < 14 baseline days →
  value + "building baseline", no band; a missing series → "No data". A vertical range bar (inline
  SVG, geometry baked as fractions) marks the band and the value. Band = median ± 2 × scaled MAD
  (`BAND_K`: ~5% false flags per card; HRV in log space like `recovery.mjs`, so asymmetric in ms).
  Tone: HRV high = good / low = bad, RHR high = bad / low = good, short sleep = bad; respiratory rate
  and wrist temp are change signals, so out of band is `watch` (`--mid`), never `--low`. A card whose
  OWN date is > 3 days before the viewer's today is greyed with "no recent data" and no tone; the
  whole block greys when its newest date is > 3 days old. Display units come from the i18n dict. A
  card that throws falls back to its empty state.
- **Dials** (top of the tab: Sleep / Recovery / Load) only VISUALISE baked values — no new metric and
  no percentage. `web/src/view/dial.mjs` (`buildDials(scores, health)`, unit-tested, baked as `DIALS`)
  pre-computes the ring geometry; `score.js` only formats numbers and joins SVG strings. Layout: three
  equal full rings in a row (≈ 92 px at a 390 px viewport), each starting at 12 o'clock and filling
  clockwise, round caps, a thin stroke (7 of 120 units ≈ 6 % of the diameter) on `--track`; the value
  INSIDE (D-DIN number, small unit) and an uppercase "LABEL ›" BELOW; the dials sit on the page
  ground, not in a card. No caption under them: each dial's words live in its detail sheet header
  (see `docs/detail-views.md`) and in its accessible name. Only a stale-data warning stays under the
  dials (`.dial-stale`, one short line: `staleNote`), plus the compact caveat lines below.
  Recovery: ring = −3…+3 MAD, three faint zones on the track cut at ±`BAND_CUTOFF`, filled from
  12 o'clock to last night's composite (`today`, zones cut at ±`DAY_BAND_CUTOFF`; falls back to
  `trend7`, zones at ±`BAND_CUTOFF`), a tick at 6 o'clock marks the baseline (0); the centre = the
  signed value + the unit (sd), the ring coloured by that band; the band word, "Last night" (or the
  night's date) / "no recent complete night" are in the accessible name, and the sheet header adds
  "no sleep data" and the 7-day trend. Sleep: fill = the sleep-duration component's newest night /
  the stated target (`health.recovery.sleep.target`, 7.5 h), capped at a full ring; the target is in
  the accessible name and the sleep sheet ("Target 7.5 h"). Load: ONE dial with a gym/run/bike
  switch — compact pills right-aligned under the load dial (kept on Inicio rather than in the load
  sheet: the sheet is one modality's history, while the switch decides which ring Inicio shows) — that opens
  (client-side, from the viewer's today) on the modality with a session today, GATED OR NOT (a gated
  one opens in its greyed gated state, no number; gated modalities bake their `days` without
  geometry) — highest RE first, ties by modality order (gym, run, bike), a session without RE still
  beats none — else on the baked `defaultKey` (first ungated modality), for the VIEWER's today, picked client-side from the baked `recent` days (each
  with its pre-computed fill): a session with RE → centre = today's RE, fill = RE / typical day (ring
  midpoint = the typical training day, a full ring = 2×, no zones; the typical-day tick at 6 o'clock);
  rows today but no RE → "No effort data" (never rest); no rows today → "No session yet". The load
  sheet header carries the day line ("Today: RE 28 · typical day ~42" or "No session yet today · last
  session <date>: RE <n>"), the ring scale and the acute/chronic context ("7-day vs 42-day load: -6% ·
  steady", + "includes N sessions without effort data"). A gated modality (`baselineBuilding`, or
  `fewDays` when there is no typical day) is greyed with no number (its reason is in the sheet). Each
  dial block / card renders through a try/catch with an empty-state
  fallback, and every host write (`#home-advice`, `#home-dials`, `#score-recovery`, `#score-load`, the advice)
  is isolated, so one throw never blanks Inicio or the other hosts; with no score data every host gets
  the empty state. Stale data (> 3 days) greys a dial; the fill
  animation is off under `prefers-reduced-motion`. Nutrición's kcal dial keeps the former 270° open
  arc (`OPEN_ARC` in `dial.mjs`, baked as `NUTRI_ARC`) until that tab moves to the ring language.
- **Today's timeline** (`lib/score/timeline.mjs`, baked as `SCORES.timeline` even when `hasData` is
  false; `#timeline` + `client/timeline.js`, under the monitor): per day, last night's sleep
  (`sleep-daily.csv`, dated the wake-up day) and that day's workouts by Home modality (gym / run /
  bike / other) with minutes and RE when the source recorded it. Rows follow the shared same-day
  rule (`DISPLAY_RULE`: stubs dropped, one source, same-day rows of one modality merge; the row says "N parts"). Only the last 3 data days are
  baked; the client shows the viewer's today, else the newest earlier day under "Latest day · <date>"
  with "nothing logged yet today", greyed when > 3 days old; when the viewer's clock is EARLIER than
  every baked day (clock / timezone skew) → the newest baked day under its date (no "nothing logged"
  line, not greyed); no baked days → empty state. No sleep
  that night → "No sleep recorded", never 0 h.
- **Advice** is one descriptive sentence per rule (`lib/score/advice.mjs`, copy in `advice-copy.mjs`),
  never an instruction; hidden when data is insufficient or stale (> 3 days). The rules still read the
  7-day trend, and every sentence names that window ("Over the last 7 days recovery has…") so it reads
  as the context under last night's headline.
- Caveats shown on the page: RE is HR-derived (credits the metcon more than heavy sets), modalities are
  not comparable, "gym" is the Watch auto-label, no comparable load before the RE epoch, same-day rows
  are summed (a real two-a-day is indistinguishable), HRV is daytime SDNN, not medical advice. They
  live with each dial's detail (the caveats card in Entreno's `load` section; the recovery card in
  Salud) and must stay reachable wherever the dial is shown: when `page.hideTabs` hides Entreno (or
  its `load` section), score.js writes a compact load caveat line under the dials on Inicio
  (`dials.load.caveatLine`); when it hides Salud, a compact recovery line (`dials.recovery.caveatLine`).
- **One same-day merge rule** (`lib/training/sessions.mjs` `mergeSameDay(rows, keyFn, { dropJunk, dropStub })`),
  used by EVERY workouts.csv reader: the load series, the timeline, the Entreno calendar/cumulative
  time, the workouts dashboard, the running/cycling tables and Salud's load vs recovery (the key is
  the physical modality — Inicio's gym / run / bike / other — or one constant for a single-family
  table; Entreno buckets the surviving rows into its five display buckets afterwards). Per (date, key): drop invalid rows (`dur <= 0`); then the short-row filter depends on the
  reader — LOAD scoring (default) drops junk (`isJunk`: `dur <= 11` AND `re` null or ≤ 2), while the
  DISPLAY readers (timeline, calendar/cumulative, dashboard, run/ride tables) pass `DISPLAY_RULE` and
  drop only stubs (`isStub`: `dur < STUB_MAX_MIN` = 3, accidental Watch starts) — Watch rows and no-HR
  Strava rows have `re` null by design, so the junk rule would hide real 9-10 min sessions from the
  pages that list sessions (they still add no load); then ONE source per session, because several
  apps mirror the SAME workout into Apple Health (workouts.csv carries Watch, Hevy, Zepp, ROXFIT, Nike,
  the Strava app's HealthKit copy "Strava" and sync:strava's "Strava API" rows): rows are grouped by
  `source`; fragments of ONE source are kept together (the Watch splits sessions); across sources one
  source's rows are kept, never a sum, by `SOURCE_PRECEDENCE` (`/^Strava API\b/i` > `/^Strava\b(?! API\b)/i` >
  `/^Apple\s+Watch\b/i` (anchored; `\s` matches the no-break space Health writes in the device name) > any
  other app; within one rank the longest total wins, then the group with HR, then with RE, then source
  name ascending — deterministic, never file order) — sync:strava keeps every Strava
  row, so this is THE dedupe. A higher-precedence source replaces a lower one only when its total
  duration is ≥ `SUPERSEDE_MIN_COVERAGE` (0.5) × the lower one's total; below that they are most
  likely different sessions and both source groups are kept. Known limitation: rows carry no start
  time, so a higher-precedence copy covering ≥ 0.5 of a lower source's total can absorb a genuine
  SECOND session of that lower source; planned fix = add `start_time` to workouts.csv and match copies
  by time overlap. When the kept source has no HR (or no
  RE) and a replaced copy does, the kept rows inherit it (HR duration-weighted, max of max; RE spread
  by duration), so HR-based readers (load vs recovery) keep the session. The load coverage counts
  replaced rows as `superseded`; then
  the remaining rows are summed as ONE session (a session logged in parts adds up; a real two-a-day
  is indistinguishable).
- **workouts.csv has 12 columns** (`… ,distance_km,relative_effort,kilojoules,elevation_m`), written by
  both `extract.js` and `sync-strava.js` from the shared `WORKOUTS_HEADER`. The three trailing columns
  are Strava-only (export rows leave them empty). Every reader is POSITIONAL and tolerates shorter
  rows, so a file mixing 9-, 11- and 12-column rows (older runs under a newer header) reads fine:
  an absent column is null. Re-running `node data/apple-health/extract.js` (needs `export.xml`)
  re-emits every export row at full width. Rollout for a new Strava field (e.g. `elevation_m` from
  `total_elevation_gain`): rebuild the ingest image (`docker compose up -d --build health-ingest`;
  without it `/export/strava` lacks the field and the column stays blank) → `npm run sync:strava` →
  `npm run generate`.
