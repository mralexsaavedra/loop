# Home tab — Inicio

Dials, advice, eat card, health monitor (tiles here, the full list on Salud), timeline; recovery and load scoring; the shared same-day merge rule; workouts.csv columns.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Home tab — "Inicio / Home" dials, monitor tiles, My day, eat card; recovery + load detail

Top to bottom (`web/src/tabs/Home.astro`, which also renders `components/EatCard.astro`): (under the
top bar from `layouts/Plan.astro`, shared by every tab: avatar · LOOP wordmark · freshness / Sync, plus
the Inicio-only date pill — on a phone on its own row under them, on a wide screen centred in the bar
row with the wordmark on the left and the avatar on the right — see `docs/plan-page.md` → Brand / Top bar) → dials
(`#home-dials`) → the monitor tiles (`#home-tiles`) → "My day" (`#my-day`: a sentence-case section heading, `.hs-lbl.home-h`, the
advice sentence as the outlook bar in `#home-advice`, the energy bank card in `#home-energy`, the
nutrition score card in `#home-nscore`, then "Today's activities" in `#timeline`) → the
"today you eat" card → "Tonight" (`#home-tonight`) → "My journal" (`#my-journal`) → "My plan" (`#my-plan`) → "My dashboard" (`#my-dash`)
→ the programmed session's hidden source section (`hoy`). The full health monitor list is NOT on
Inicio: it leads Salud (see "Health monitor" below). Little
text on the tab: each block's explanation lives in the detail sheet it opens
(`web/test/content.test.mjs` pins the order). "Tonight" and "My plan" are rendered by
`client/home-week.js` and "My dashboard" by `client/home-dash.js`, both in `layouts/Plan.astro`'s
end-of-body script list (after `HC`, the baked globals and `adherence.js`, right before
`deepdive.js` / `detail.js`); they render at once, and their sheets (`tonight`, `dash-edit`) are
registered before `detail.js` runs; `#tonight` / `#dash-edit` deep-link to them (`NAV.viewTab` →
`home`). Without their hosts they render nothing. The monitor summary tile reaches the full list on
Salud with `jump('monitor')` (switches to Salud and scrolls to it).

**Collapsed dial row** (`#home-mini`, first in `Home.astro`): once the dials scroll above the viewport
(an IntersectionObserver on `#home-dials`, `score.js`), a strip fixed at the top shows the
three dials again as mini rings + labels (Sleep · Recovery · Load). A SOLID `--ground-top` fill behind the
whole bar and a `--line-soft` hairline under it (DS6: formerly a fade to transparent, so the content
showed through under the labels); each mini ring draws
its grey `--track` in full even with no value (the 45 % dimming of an empty ring applies to the big
dial only). Every `dialFig` call also queues
its mini item from the SAME svg string, colour class, label and detail opener (`HC.detailAttrs`), so
nothing is recomputed and a tap opens the same detail as the dial; the load items carry `data-dmod`,
so the modality pills of the load deep-dive (`scMod`) move them too. Off it is `visibility: hidden` (out of the tab order
and the accessibility tree); the slide / fade is dropped under `prefers-reduced-motion`; with no data
or without IntersectionObserver it stays off.

`lib/score/*` (same single-source pattern) feeds the first tab; `web/src/client/score.js` renders it
(dials + advice on Inicio; the recovery card into Salud's `#score-recovery` and the per-modality load
summary cards, with the caveats behind its ⓘ, into Entreno's `#score-load` — glance vs detail),
`buildScoresFrom(inputs, {sex})` (pure, over `lib/extract/read.mjs` `readExtract`, called once by
`web/src/bakes.mjs`) bakes `SCORES` (only `asOf` dates — staleness is computed client-side, so
consecutive builds are byte-identical). The tab is first and active by default; the visible panel is
derived from the FILTERED nav list (`activeTabKey`), so `page.hideTabs: ["home"]` hands over to the next
tab and hiding every tab is a build error.

**Today first, trend as context** (Bevel/Whoop-style): every headline is the newest day, and the
trend is the line under it.

- **Recovery %** (the headline, `today.pct`): last night's composite RANKED among the composites of
  the 90 days before it (`PCT_WINDOW_DAYS`), all scored against the same baseline, days with ≥ 0.60
  of the weight only — empirical CDF: share of prior days with a lower composite, ties counted half,
  rounded to an integer 0–100 (`percentileRank`, `lib/score/recovery.mjs`, baked, never computed in
  the browser). Bands (`pctBand`): good (`--good`) ≥ 67, mid (`--mid`) 34–66, low (`--low`) ≤ 33
  (thirds of the user's own distribution). Under 21 prior days (`MIN_PCT_DAYS`) `pct` is null and
  every surface keeps the SD presentation below (the documented fallback). It is a transparent
  mapping of the same composite, not a new metric; the ⓘ says so (`recovery.pctNote`: "% = how last
  night ranks against your previous 90 days"), and the night's SD value + day band stay in the Salud
  card's ⓘ and the deep-dive's ⓘ (`recovery.sdLbl`). The deep-dive contributors show the night's
  HRV, resting HR, respiratory rate (context only, not a composite input) and sleep performance %
  (display only, `docs/detail-views.md`). The 7-day trend and the advice stay in SD (the advice describes the trend, not the night).
- **Recovery** composite is in units of the user's typical spread (scaled MAD); ONE unit
  key, `RECOVERY_UNIT` (`lib/score/advice-copy.mjs`, re-exported by score-templates: en "SD", es
  "desv."; dict `recovery.unit`), builds every recovery string — advice, dial, Salud card, monitor note,
  detail sheet — and the Salud card explains it behind its ⓘ (`recovery.unitNote`: "typical spread" /
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
  detail card (Salud `#score-recovery`, Whoop-style) stacks at every width: headline (last night's
  % + its % band word, e.g. "85% High", or the composite in SD as the fallback; ONE short trend line "7-day +0.5 SD · at baseline") |
  14-day sparkline | the contributors (HRV, RHR, sleep duration, sleep regularity) in THE contributor
  row the recovery sheet uses (`HC.contribRow`: icon, name, latest value + unit, the 7-day ±SD as a small
  sub line, ▲ / ▼ = which way the 7-day mean sits from the baseline coloured by what it means — band
  above = better, below = worse — or • at baseline; no state dots), one under the other; the raw
  last-14-days lists fold into a `<details class="rec-raw">` ("Last 14 days" / "Últimos 14 días"),
  a quiet uppercase disclosure line with a turning chevron (it resets tablas.css's bare details card). Text diet: what
  the baseline is, the full trend sentence with the week-on-week change, each contributor's baseline
  and n, the unit in words, confidence + the SDNN caveat, missing / lowest signal are the card's notes:
  `score.js` writes them into the Salud Recovery section's ⓘ block (`#hs-info-recovery`, in their own
  `.rec-info-notes` child after the section's notes) and only draws its own ⓘ (`#rec-info`) when that
  block is absent. Gated ("insufficient")
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
- **Monitor tiles** (`#home-tiles`, `client/monitor.js`, from the SAME `SCORES.monitor` cards — no
  new metric): two 96 px tiles under the dials. Tile 1 "HEALTH MONITOR ›" = a square status icon (26 px,
  a 16 % tint of its colour: "!" `--down` when any fresh card is High / Low, a check `--up` when at least
  one fresh card is Normal, none without fresh data) left of a status chip — "N out of range", else
  "Within range", else "No data" — over "n/5 metrics" (fresh cards in range / all cards); a card counts only when its own date is ≤ 3 days old. It is a button calling
  `jump('monitor')` (switches to Salud, scrolls to the monitor list at its top; `#monitor` deep-links
  there too, `ANCHOR_TAB` in lib/nav/tabs.mjs: core.js shows Salud and keeps the hash). Tile 2 =
  **STRESS MONITOR ›** when a day has a stress value (`SCORES.stress`, `lib/score/stress.mjs`: a
  heart-rate-only ESTIMATE per waking hour outside workouts and sleep, 0–3, formula in
  `analysis/methodology.md`): the latest scored hour's value in a small square chip and its band word
  (low < 1 light blue `--strain-ink`, medium 1–2 teal `--up`, high ≥ 2 orange `--down`), the hour
  ("14:00", prefixed by the date when the day is not today); today = the newest day with a value when
  it is ≤ 3 days old (a day needs ≥ 6 scored hours, so early in the morning it is yesterday's, dated).
  It opens the stress page (`docs/detail-views.md`) — on the reading's own day when it is not today
  (`data-date`), so the tile and the page agree (formerly the page opened on an empty today, "No data").
  Without a stress value tile 2 falls back to HRV
  (the real baked value, its unit, its status word in its tone colour, its date when not today),
  opening the HRV sheet; without a fresh HRV value either, tile 2 is left out and tile 1 spans the row
  (`.hm-tiles-one`).
- **Health monitor** (`lib/score/monitor.mjs`, baked as `SCORES.monitor` even when `hasData` is false;
  `components/HealthMonitor.astro` + `client/monitor.js`, the FIRST block of Salud, `tabs/Salud.astro`):
  an UPPERCASE "HEALTH MONITOR" label with the same status chip as tile 1 and an ⓘ button (the band
  explanation, collapsed: `#hm-info`), then one shared metric row per signal (`HC.metricRow`, the
  "My dashboard" row: icon · NAME · value + unit · ▲ above / ▼ below / • inside the band, the range
  "lo–hi" as the small line under the value — the word "Normal range" is in the row's aria-label and
  the ⓘ — + the short date "28 Sep" when not last night) for respiratory
  rate, resting HR, HRV, sleeping wrist temperature and sleep duration. Each = the newest daily value
  (per-day median of plausibility-clamped samples) + unit, its date when it is not from the viewer's
  today, and Normal / High / Low (es: Normal / Alto / Bajo) vs a personal band = median ± 1.5 × scaled
  MAD (`robustBaseline`, floored per signal) over the 42 days BEFORE that value; < 14 baseline days →
  value + "building baseline" as the small line, no band, no marker; a missing series → "—" + "No
  data". The status word is in the row's `aria-label`. Band = median ± 2 × scaled MAD
  (`BAND_K`: ~5% false flags per card; HRV in log space like `recovery.mjs`, so asymmetric in ms).
  Tone: HRV high = good / low = bad, RHR high = bad / low = good, short sleep = bad; respiratory rate
  and wrist temp are change signals, so out of band is `watch` (`--mid` marker), never bad; the marker
  is teal `--up` for good, orange `--down` for bad, grey for normal. A row whose
  OWN date is > 3 days before the viewer's today is greyed with "no recent data", no tone, no marker; the
  whole block greys when its newest date is > 3 days old. Display units come from the i18n dict. A
  card that throws falls back to its empty state.
- **Sleep scores** (`lib/score/sleep.mjs`, baked as `SCORES.sleep` = `{need, last}`, null without
  sleep data): last night's `perf` = asleep / need × 100, rounded, capped at 100 — **our need = your
  target** (`SLEEP_TARGET`, 7.5 h; no adaptive need from strain or debt is invented); `eff` = asleep /
  in bed × 100 (capped; null when the night has no `inbed_h`); `cons` = sleep consistency in MINUTES
  (`recovery.mjs` `sleepConsistency`: the mean of |bedtime − median| and |wake − median| over the
  previous 42 nights — the recovery input `sleepCons`; no documented minutes → % mapping exists, so no
  %); `stages` (REM / deep / core / unspecified / awake / in bed hours), `shares` (REM / deep / core %
  of asleep) and `restorative` (REM + deep hours) only on a staged night.
- **Carried values** (`HC.carried`, `docs/design-system.md` → Carried values): any Inicio display that
  stands for today (or the stepped-to day) but shows an EARLIER day's value names that date and is
  dimmed (`.carried`, colour kept; the > 3-day stale grey stays the stronger state): the sleep and
  recovery dials + mini rings ("7 OCT" under the number), the monitor summary tile ("8 OCT" under
  "5/5 metrics": the newest night it counts), the stress and HRV tiles ("8 OCT · 23:00"), the energy bank card
  ("8 OCT · 21:00"; it then opens its page on that day) and "My day" (its "Activities · Thu 8 Oct"
  heading). The tiles and the energy card drop the weekday (half-width); the "My day" heading keeps it.
- **Day stepping** (the top bar's "‹ HOY ›", `client/today-date.js` `window.HCDay`, see
  `docs/plan-page.md` → Top bar): Inicio can show a PAST day (`#d=YYYY-MM-DD`). The blocks that follow
  it re-render on every change (`HCDay.on`); everything else keeps its own scope. TODAY goes through
  the unchanged code path (no selected day), so today's markup is byte-identical to a page without day
  stepping (unit-tested; 390 px screenshot diff in the PR).
  - **Dials + collapsed row** (`score.js` `renderDay`): sleep + recovery = that day's `DIALS.days`
    entry (a day without its own night reads "No data", never another day's value), load = the
    modality's baked `recent` session day (the dial opens on the modality trained THAT day; "No
    session" instead of "No session yet"; a gated modality stays gated, the gate is today's), the
    arias name the date instead of "last night" / "today"; never greyed as stale (it is the day you
    asked for), no stale line; every dial and mini ring opens its deep-dive ON that day (`data-date`).
    The advice outlook bar is hidden (it reads the current 7-day trend).
  - **Monitor tiles** (`monitor.js` `renderTiles`): that day's `SCORES.days` summary (in / out of
    range among the cards fresh ON that day, out of `total`) and that day's stress value
    (`SCORES.stress.days`, the last 14 days; it opens the stress page on that day), else its HRV card
    (dated when its reading is older than the day; it opens the HRV sheet on that day); no entry → "No
    data". The Salud list stays the latest.
  - **"My day"** (`timeline.js` `pastHtml`): "Activities · <date>" with that day's night
    (`DETAIL.metrics.sleep`: hours, bed / wake clock) and workouts (`DETAIL.sessions`: one per date +
    modality after the SAME display rule as `SCORES.timeline`, minutes, RE, parts; a test checks both
    give the same rows); no programmed-session row, never greyed, every row opens its sheet on that day;
    nothing that day → "Nothing logged that day".
  - **Energy bank card** (`energy.js`): that day's `SCORES.energy.days` entry (level, curve, start,
    low) and it opens the energy bank page on that day; a day without a value hides the card.
  - **Nutrition card** (`nutri-score.js`): that day's FINAL score (no average line) and it opens the
    nutrition sheet on that day; a day without a log or a target hides the card.
  - **Eat card** (`nutri-day.js` `renderEat`): "Target for <date>" with that day's DETECTED day type
    (`dayInput` + `detectDayType`, the same detection as `HCNutri.targetFor`) and its plan targets for
    the current goal; a day whose type cannot be told (no session, sleep or programmed session) hides
    the card.
  - **Tonight** is hidden (it is about the coming night). **My plan** stays the viewer's week and **My
    dashboard** the latest values, whatever day is shown.
- **Day history** (`lib/score/days.mjs`, baked as `SCORES.days` = `{from, to, days}`, null without
  overnight data; behind the top bar's day stepping): for each of the last `DAY_HISTORY_DAYS` (= the
  load dial's `RECENT_DAYS`, 14) days ending at the newest overnight date, the inputs are CUT at that
  day and the same scorers run (`recoveryFromInputs`, `monitorFromInputs`), so the newest entry equals
  today's bake and an old day is scored against the baseline and 90-day % window it had then. Per day:
  `rec` = the night scored that morning only when it IS that day (`{value, band, sleep, pct?,
  pctBand?}`; `'gated'` while recovery was gated; null = no complete night that day — never an older
  night under its date), `sleep` = that day's asleep hours (the recovery sleep-duration input, the
  number the sleep dial uses; null while gated), `monitor` = the summary tile on that day (`inR` /
  `out` among the cards fresh on that day — own date ≤ `STALE_DAYS` before it — `total`, and the HRV
  card `{value, dec, status, tone, date}` when fresh). `buildDials` turns each entry into
  `DIALS.days[i]` = `{date, sleep, recovery}` in today's dial shapes (always mode `today`; no trend
  fallback). Load needs no new bake (its `recent` days). ~7 KB on the example page.
- **Dials** (top of the tab: Sleep / Recovery / Load) only VISUALISE baked values — no new metric (the
  recovery % is a rank of the same composite). `web/src/view/dial.mjs` (`buildDials(scores, health)`, unit-tested, baked as `DIALS`)
  pre-computes the ring geometry; `score.js` only formats numbers and joins SVG strings. Layout: three
  equal full rings in a row (≈ 92 px at a 390 px viewport), each starting at 12 o'clock and filling
  clockwise, round caps, a 9.5-unit stroke (of the 120-unit dial ≈ 8 %, the reference's weight) on `--track`; the value
  INSIDE (D-DIN number, small unit) and an uppercase "LABEL ›" BELOW; the dials sit on the page
  ground, not in a card. No caption under them: each dial's words live in its deep-dive page (insight card)
  (see `docs/detail-views.md`) and in its accessible name. Only a stale-data warning stays under the
  dials (`.dial-stale`, one short line: `staleNote`), plus the compact caveat lines below.
  Recovery with a % (`today.pct`): the ring fills to pct % from 12 o'clock, ONE colour = its % band
  (`dial-band-good` / `-mid` / `-low`), no baseline tick, the centre "85" + a small "%"; the mini row
  reuses the same svg. Without a % (fallback):
  ring = −3…+3 MAD, filled from 12 o'clock to last night's composite (`today`; falls back
  to `trend7`), a tick at 6 o'clock marks the baseline (0); the centre = the signed value + the unit
  (sd). The fill takes ONE state colour end to end, its band's: above = `--good`, at = `--mid`,
  below = `--low` (single night cut at ±`DAY_BAND_CUTOFF`, the trend fallback at ±`BAND_CUTOFF`). No
  zone arcs on the track (they tinted part of the ring a second colour). The band word, "Last night"
  (or the night's date) / "no recent complete night" are in the accessible name, and the recovery
  deep-dive page adds "no sleep data" and the 7-day trend. A night CARRIED from an earlier day (today's
  is not complete yet — e.g. no resting HR or too few HRV samples — so `recovery.mjs` falls back up to
  `MAX_TODAY_FALLBACK_DAYS`; or the sleep dial's newest night is not today's) is never shown as today's:
  the carried-value rule (`HC.carried`, `docs/design-system.md` → Carried values) adds that night's date
  under the number (`.carried-date`, "7 OCT": the weekday does not fit inside a 360 px ring) and dims the
  dial (`.carried`, colour kept; the mini ring too; the sleep dial's aria names the date); the deep-dive
  page is titled with that date and dims its hero (`docs/detail-views.md`). A stepped-to past day's own
  night is never marked. Sleep: fill = the sleep-duration component's newest night /
  the stated target (`health.recovery.sleep.target`, 7.5 h), capped at a full ring; `pct` = sleep
  performance (same fraction as a rounded %, `lib/score/sleep.mjs` `sleepPerformance`): the centre shows
  "92" + a small "%" in the sleep colour (the mini row reuses the same svg + accessible name, which
  carries the % and "6:54 of your 7:30 need"); without a `pct` the hours as h:mm ("6:54", no unit); the target is in
  the accessible name and the sleep sheet ("Target: 7:30"). **Day strain** (when calibrated,
  `SCORES.strain.ok`, `lib/score/strain.mjs`; formula in `analysis/methodology.md`): the third dial
  is the day's strain 0–21 — the centre "12.4" (no unit), the label "LOAD ›" / "CARGA ›" in strain
  blue (`.dial-strain`), ring = strain / 21 (`DIALS.strain.days`, the last 14 days, each with its baked
  fill; the client picks the viewer's day, or the stepped-to past day). A day the data does not reach
  yet reads "No data" (never a made-up 0.0). It opens the strain deep-dive (`docs/detail-views.md`);
  there are NO modality pills — per-modality Relative Effort stays in Entreno's load cards and the
  `load-<m>` deep-dives (linked from the strain page). The collapsed row follows (three rings). Without
  a calibrated strain (no `hr-hourly.csv`, no max HR, under 14 full days of all-day heart rate) the
  third dial is the load dial below, unchanged. Load (fallback): ONE dial per modality, one shown, with
  NO pills under the dials (as the reference): the gym / run / bike pills live in the `load-<m>`
  deep-dive, between its contributors and the insight card (`deepdive.js` `modSwitch`, the page's modality pressed, only with two
  or more load series); a pill opens that modality's page and calls `scMod(key)`, which shows that
  modality's dial on Inicio and in the collapsed row. The dial opens
  (client-side, from the viewer's today) on the modality with a session today, GATED OR NOT (a gated
  one opens in its greyed gated state, no number; gated modalities bake their `days` without
  geometry) — highest RE first, ties by modality order (gym, run, bike), a session without RE still
  beats none — else on the baked `defaultKey` (first ungated modality), for the VIEWER's today, picked client-side from the baked `recent` days (each
  with its pre-computed fill): a session with RE → centre = today's RE, fill = RE / typical day (ring
  midpoint = the typical training day, a full ring = 2×, no zones; the typical-day tick at 6 o'clock);
  rows today but no RE → "No effort data" (never rest); no rows today → "No session yet" (a dial word: sentence case, muted, `--fs-label`, as in the deep-dive hero). `DIALS.load.tick`
  = the typical-day mark as a radial line across the hero ring's 7.5-unit stroke (`radialTick(0.5, HERO)`), drawn by the load
  deep-dive's hero ring. The load deep-dive's insight card says the day in a sentence ("Today's Relative Effort is 28; your
  typical training day is ~42.", or no session yet / the last one) and the acute/chronic context ("Over
  the last 7 days your load has been steady (−6% vs your 42-day average)."); the ring scale and "includes
  N sessions without effort data" sit under its ⓘ (docs/detail-views.md). A gated modality (`baselineBuilding`, or
  `fewDays` when there is no typical day) is greyed with no number (its reason is in the sheet). Each
  dial block / card renders through a try/catch with an empty-state
  fallback, and every host write (`#home-advice`, `#home-dials`, `#score-recovery`, `#score-load`, the advice)
  is isolated, so one throw never blanks Inicio or the other hosts; with no score data every host gets
  the empty state. Stale data (> 3 days) greys a dial; the fill
  animation is off under `prefers-reduced-motion`. Nutrición's kcal ring draws the same full ring (no
  open arc any more, see `docs/nutrition.md`).
- **Energy bank** (`lib/score/energy.mjs`, baked as `SCORES.energy`; `#home-energy` +
  `client/energy.js`, between the outlook bar and "Today's activities" in "My day"): OUR intraday
  0–100 estimate, not a validated physiological measure (formula + constants in
  `analysis/methodology.md`): it starts at the wake time at the morning's recovery % and drains per
  awake hour by a baseline, the stress estimate and the heart-rate load (day strain's TRIMP / K),
  recharging in calm hours. Card = `.sc-card.tn.en`: "ENERGY BANK estimate" header (the generic
  opener chevron), the latest level big in D-DIN coloured by its third (the recovery `pctBand` via
  `HC_BAND`: high ≥ 67 `--good`, low ≤ 33 `--low`, middle between `--mid`, `.de-hi/.de-mid/.de-lo` set `--ds`), the latest hour under it, a
  stretched SVG curve from wake to that hour (line + soft area), and "From 99 at 06:47 · low 3".
  Today = the newest day with a value when it is ≤ 3 days old; no bake / no value → the host stays
  hidden. It opens the energy bank page (`docs/detail-views.md`, key `energy-bank`).
- **Nutrition score** (`lib/nutrition/score.mjs` = the reference, scored at view time by
  `client/nutri-score.js`; `#home-nscore`, under the energy bank card in "My day"): the day's 0–100
  adherence to its own targets from the food log (kcal 0.4, protein 0.4, fat 0.2; formula and rules
  in `docs/nutrition-food-log.md` → Nutrition score and `analysis/methodology.md` 5b). Card =
  `.sc-card.tn.en.ns`: ONE caps title "NUTRITION" ("· INCOMPLETE" when a macro is missing, "· IN
  PROGRESS" while today is being logged) — one size and weight, no smaller tag inside (DS4, F16).
  **Today logged** → today heads the card ALONE (DS6: a big red "56% YESTERDAY" beside
  the "TODAY · IN PROGRESS" bars read as today's score): the headline is today's kcal eaten as a % of its
  target in white (`.ns-now`, "22%" over "KCAL TODAY"; no score, no band colour; none without a kcal log),
  beside Nutrición's three macro rows as "KCAL", "1,500 / 2,000 kcal", the bar = eaten / target in the
  neutral `--trend` (`.ns-run`), no points (a mid-day "0%" in red with "KCAL · 0" read as a failed day and
  as "0 kcal"); the newest closed day moves to the footer line: "Yesterday 56% · 7-day average 85%". The
  accessible name says both ("Nutrition today: in progress, 22% of the kcal target, no score yet ·
  Yesterday: nutrition score 56%"; formerly "56% el Ayer"). **Nothing logged today** → the headline is the
  newest CLOSED day while ≤ 3 days old: its score big in D-DIN coloured by its band (≥ 85 `--good`, 60–84
  `--mid`, < 60 `--low`, via `.de-hi/.de-mid/.de-lo`), "Yesterday" or the date under it, its rows with
  their points labelled "KCAL · 85 pts", the bar = the points in their band colour, then "7-day average
  79%" (final scores only). Nothing logged / nothing fresh → hidden. It opens the nutrition trend
  sheet (`docs/detail-views.md`, key `nutrition`). On the LAN page Constancia's live summary
  re-renders it after every add / delete.
- **Today's activities** (`lib/score/timeline.mjs`, baked as `SCORES.timeline` even when `hasData` is
  false; `#timeline` + `client/timeline.js`, under the outlook bar in "My day"): per day, last night's
  sleep (`sleep-daily.csv`, dated the wake-up day, with its bed / wake clock `bed` / `wake` when the
  row has them) and that day's workouts by Home modality (gym / run / bike / other) with minutes and
  RE when the source recorded it. Row = a coloured chip (sleep `--sleep`, workout `--strain`: line
  icon + hours asleep; a workout's RE as a bare number, else its minutes; dark ink), the uppercase
  name, and the details stacked on the right behind a thin bar of the row's colour: bed / wake time for
  sleep; for a workout the minutes (when the chip holds RE) and "N parts". workouts.csv has no start
  time, so a workout has no start / end clock pair (the reference's right column); the row's
  `aria-label` spells it out ("Run · RE 94 · 45 min · 2 parts"). On the viewer's today the programmed session
  (`window.HCProgram` from `client/training-today.js`) is the last row: an outline chip "Plan", its
  focus (one line, ellipsised; the row's `aria-label` carries the whole focus and the session view
  shows it in full), "Programmed" (white caps; the row's bar carries the colour); it opens the session as the `hoy-session` detail view. Nothing matches a
  programmed session to a done workout yet, so it is only listed, never ticked; it is not shown
  under an older day's heading, and with no baked day but a session today the card lists only it. Rows follow the shared same-day
  rule (`DISPLAY_RULE`: stubs dropped, one source, same-day rows of one modality merge; the row says "N parts"). Only the last 3 data days are
  baked; the client shows the viewer's today under "Today's activities", else the newest earlier day
  under "Latest day · <date>" (no filler line), greyed when > 3 days old; when the viewer's clock is
  EARLIER than every baked day (clock / timezone skew) → the newest baked day under its date (not
  greyed); no baked days → a one-line empty state. The header row centres the title on its 44 px ⓘ,
  which overhangs the card padding. No sleep
  that night → "No sleep recorded", never 0 h. The same-day merge note ("RE only comes from Strava")
  sits behind the card header's ⓘ (`#tl-info`, only when the day lists workouts), not under the list.
- **Tonight** (`#home-tonight`, `lib/score/tonight.mjs` baked as `SCORES.tonight`, `client/home-week.js`):
  the recommended bedtime (moon icon) and the usual wake time (alarm icon) joined by a dashed line, D-DIN
  clocks (`--fs-num-card`, 28 px), uppercase captions; the wake side carries a teal state line "● Usual wake" (`--up`,
  where the reference shows its alarm state: the page has no alarm data) and then "Last N nights"
  (the nights the median used). Rule (stated in the sheet the card opens — the registered `tonight` view —
  never on the card): usual wake = the median wake clock (`sleep-daily.csv` `waketime`, the night dated
  the wake-up day) of the nights in the last `TONIGHT_WINDOW` (14) days ending at the newest night with a
  wake time; bedtime = usual wake − the sleep target (`SLEEP_TARGET`, 7.5 h, the sleep dial's). A wake
  clock ≥ 18:00 is unwrapped to a negative hour before the median (23:50 and 00:10 sit together). Fewer
  than `TONIGHT_MIN_NIGHTS` (7) such nights → `null` and the card stays hidden. Data > 3 days old greys
  it. No alarm editing (the page cannot set one); the sheet links to the sleep history (a `.cta` link, "SEE SLEEP HISTORY →").
- **My journal** (`#my-journal`, `client/journal.js`, design in `docs/journal.md`): "MY JOURNAL" + a
  chevron, 7 day columns (the 7 days ending on the viewer's today: weekday + a check circle, `--up` when
  that day is journaled); a column or the chevron opens the journal sheet on that day. Ships hidden.
- **My plan** (`#my-plan`, `client/home-week.js`, `window.HCWeekPlan.weekGoals`): one collapsible
  `<details>` card, flat (no border, no open-state ring), "Weekly plan · N days left · X % accomplished" + a teal progress bar, for the VIEWER's
  week (Monday–Sunday from `Date.now()`, never baked; days left = after today). Expanded: one row per
  goal — uppercase label + its basis, `done/target`, ▲ `--up` on pace / ▼ `--down` behind (on pace =
  done ≥ target × days elapsed / 7), a small bar. % accomplished = the mean of min(1, done / target)
  over the shown rows. Goals, their source and default target (profile.json has no goals block, so
  these are the documented defaults in `GOALS`):

  | Row | Done (this week, up to today) | Target | Source | Hidden when |
  | --- | --- | --- | --- | --- |
  | Nights ≥ 7:30 | nights (dated the wake-up day) asleep ≥ the sleep target | 5 | `DETAIL.metrics.sleep` | no sleep metric, or `DETAIL.asOf` > 3 days old |
  | Training days | distinct dates with a session | the days programmed this week, else the usual week | `DETAIL.sessions` (display rule) + `TRAINING` (training-data.json) | stale as above; no programme AND < 3 complete weeks of data (of the last 6) or a usual week of 0 |
  | Days with food logged | days with ≥ 1 food log entry | 7 | `HCAdherence.state().days` (the Constancia summary, LAN page only) | no summary (static / example page) |
  | Days on kcal target | days whose Constancia state is `on` (complete, within ±10 % of the day's target) | 5 | `HCAdherence.dayState` + `HCNutri.targetFor` | no summary, or no `HCNutri.targetFor` |

  The usual week = the median of the session days per week over the last 6 complete weeks before this
  one (only weeks the data covers). The food rows appear when the summary answers: `client/adherence.js`
  calls `HCWeekPlan.refresh()` after every read (the card keeps its open / closed state). No row → the
  card and its "My plan" heading stay hidden. The sleep row opens the sleep sheet, the training row the
  training-time sheet.
- **My dashboard** (`#my-dash`, `client/home-dash.js`): a section heading with "CUSTOMIZE ✎" on the
  right, then single-row metric cards (60 px) — line icon · UPPERCASE full metric name ("Resting heart
  rate", "Heart rate variability", "Hours of sleep", "Walking heart rate": `home.dash.names`, else the
  detail sheet's title) · the latest value (D-DIN, 22 px) + its unit at about half that size and an
  arrow, the 30-day baseline small under it. Catalogue (`CATALOG`): rhr, hrv, sleep, weight,
  steps (shown by default, `DEFAULT_ON`), vo2max, fitnessAge, walkingHr, exercise (hidden by default;
  fitnessAge in whole years, "≤ 25" / "≥ 75" at the reference curve's bounds, docs/health-tab.md
  "Fitness age"); only keys
  present in the baked `DETAIL.metrics` are listed. Same series and units as the detail sheet
  (`I18N_DETAIL`). Value = the newest day with data up to the viewer's today (a daily total skips
  today, still filling up); sleep shows h:mm. Baseline = the mean of the 30 days before that day, with
  ≥ 7 days of data (≥ 2 readings for a sparse series like weight); no baseline → no arrow. Arrow ▲▼ =
  the value vs the baseline: `--up` when better by the metric's good direction (`dir`), `--down` when
  worse, `--ink` (white) for a metric with no good direction (weight; never a grey arrow), a grey dot within ±2 % (`FLAT_SHARE`). A row older than 3
  days is dimmed; a tap opens that metric's detail sheet. "Customize" opens the registered `dash-edit`
  sheet (detail.js modal): per metric its SHORT name (the trend sheet's title: "HRV", "Resting HR", so
  a row fits 1–2 lines at 360 px; the full name stays in the buttons' accessible names), THE switch (`HC.switchBtn`, `role="switch"` +
  `aria-checked`; design-system.md → Components), compact ↑ / ↓ buttons (the keyboard and screen-reader
  way to move) and, last, the reference app's ≡ drag handle (`.db-grip`, `aria-hidden`). The drag uses
  Pointer Events, so mouse, touch and pen alike: `pointerdown` on a handle (the primary pointer only, a
  mouse only with its main button, and never while a drag is active) calls `setPointerCapture`,
  every `pointermove` puts the row where the pointer is (the DOM row moves live, lifted on `--track`;
  `touch-action: none` on the handle keeps the sheet from scrolling), `pointerup` saves through the same
  `commit()` as ↑ / ↓ (prefs → the dashboard → the sheet re-rendered), `pointercancel` re-renders the saved order.
  Moving the row in the DOM drops the pointer capture (Chromium fires `lostpointercapture` on every live
  reorder), so a lost capture is re-taken while the row is on the page; only when that fails (the pointer
  is gone) or the row left the page does it cancel like `pointercancel`; a re-render of the sheet drops a drag in flight, and a
  drag whose row has left the page (sheet closed, no `pointerup`) is stale and never blocks the next one. Both reorder through the pure `HCDash.move(list, from, to)`. No auto-scroll while dragging (the
  whole catalogue fits a phone screen). Preferences = `localStorage['hc-dash-v1']` `{order, hidden}`; every read / write is in a
  try/catch, unknown, duplicate or unavailable keys are ignored, a catalogue key missing from the stored
  order is appended with its default visibility, and without storage the choice holds in memory for the
  visit. Every metric hidden → a one-line note (the section stays so Customize can bring one back); no
  catalogue metric in `DETAIL` → the section stays hidden.
- **Advice** is one descriptive sentence per rule (`lib/score/advice.mjs`, copy in `advice-copy.mjs`),
  never an instruction; hidden when data is insufficient or stale (> 3 days). It renders as the "My
  day" outlook bar (`.outlook`: full width, 46 px, warm grey → dark gradient, sun icon, ONE line — the
  short title "Your daily outlook" / "Tu panorama del día" (`home.outlook`) — and a chevron) and opens
  the recovery sheet (every rule reads the recovery trend). The sentence is the bar's accessible name
  and leads the recovery deep-dive's insight card (`score.js` exposes it as `window.HCAdvice`, '' on a
  past day or stale data; `deepdive.js` `recoveryLines` prepends it). Without a detail sheet (nothing to
  tap) the bar shows the sentence itself, ellipsised. The rules still read the
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
  both `extract.mjs` and `sync-strava.mjs` from the shared `WORKOUTS_HEADER`. The three trailing columns
  are Strava-only (export rows leave them empty). Every reader is POSITIONAL and tolerates shorter
  rows, so a file mixing 9-, 11- and 12-column rows (older runs under a newer header) reads fine:
  an absent column is null. Re-running `node data/apple-health/extract.mjs` (needs `export.xml`)
  re-emits every export row at full width. Rollout for a new Strava field (e.g. `elevation_m` from
  `total_elevation_gain`): rebuild the ingest image (`docker compose up -d --build health-ingest`;
  without it `/export/strava` lacks the field and the column stays blank) → `npm run sync:strava` →
  `npm run generate`.
