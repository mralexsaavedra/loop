# Home tab

Dials, advice, eat card, health monitor (tiles here, the full list on Salud), timeline; recovery and load scoring; the shared same-day merge rule; workouts.csv columns.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

On this page:

- [Layout and wiring](#layout-and-wiring)
- [Collapsed dial row](#collapsed-dial-row)
- [Dials](#dials)
- [Monitor tiles](#monitor-tiles)
- [My day](#my-day): [daily outlook (advice)](#daily-outlook-advice), [energy bank](#energy-bank), [nutrition score](#nutrition-score), [today's activities](#todays-activities)
- [Today you eat](#today-you-eat)
- [Tonight](#tonight)
- [My journal](#my-journal)
- [My plan](#my-plan)
- [My dashboard](#my-dashboard)
- [Health monitor (on Salud)](#health-monitor-on-salud)
- [Scoring](#scoring): [recovery](#recovery), [load](#load), [sleep scores](#sleep-scores), [day history](#day-history)
- [Carried values](#carried-values)
- [Day stepping](#day-stepping)
- [Caveats](#caveats)
- [Same-day merge rule](#same-day-merge-rule)
- [workouts.csv columns](#workoutscsv-columns)

## Layout and wiring

What it shows: the first tab, today first with the trend as context (Bevel / WHOOP style): every
headline is the newest day, and the trend is the line under it.

Order, top to bottom (`web/src/tabs/Home.astro`, which also renders `components/EatCard.astro`;
`web/test/content.test.mjs` pins it):

| # | Block | Host | Rendered by |
| --- | --- | --- | --- |
| 0 | Top bar (shared): avatar · LOOP wordmark · freshness / Sync, plus the Home-only date pill | `layouts/Plan.astro` | see `docs/plan-page.md` → Brand / Top bar |
| 1 | Collapsed dial row | `#home-mini` | `score.js` |
| 2 | Dials | `#home-dials` | `score.js` |
| 3 | Monitor tiles | `#home-tiles` | `monitor.js` |
| 4 | "My day" (heading `.hs-lbl.home-h`, sentence case) | `#my-day` | — |
| 4a | Outlook bar (advice) | `#home-advice` | `score.js` |
| 4b | Energy bank | `#home-energy` | `energy.js` |
| 4c | Nutrition score | `#home-nscore` | `nutri-score.js` |
| 4d | Today's activities | `#timeline` | `timeline.js` |
| 5 | Today you eat | `EatCard.astro` | `nutri-day.js` |
| 6 | Tonight | `#home-tonight` | `home-week.js` |
| 7 | My journal | `#my-journal` | `journal.js` |
| 8 | My plan | `#my-plan` | `home-week.js` |
| 9 | My dashboard | `#my-dash` | `home-dash.js` |
| 10 | The programmed session's hidden source section | `hoy` | — |

- Date pill placement: on a phone, its own row under the top bar; on a wide screen, centred in the bar
  row with the wordmark left and the avatar right.
- Little text on the tab: each block's explanation lives in the detail sheet it opens.
- The full health monitor list is NOT on Home: it leads Salud ([below](#health-monitor-on-salud)).
- `client/home-week.js` and `client/home-dash.js` load in `layouts/Plan.astro`'s end-of-body script
  list (after `HC`, the baked globals and `adherence.js`, right before `deepdive.js` / `detail.js`).
  They render at once and register their sheets (`tonight`, `dash-edit`) before `detail.js` runs;
  `#tonight` / `#dash-edit` deep-link to them (`NAV.viewTab` → `home`). Without their hosts they
  render nothing.
- Data: `lib/score/*` (single-source pattern). `buildScoresFrom(inputs, {sex})` (pure, over
  `lib/extract/read.mjs` `readExtract`, called once by `web/src/bakes.mjs`) bakes `SCORES` with only
  `asOf` dates — staleness is computed client-side, so consecutive builds are byte-identical.
- `web/src/client/score.js` renders the dials + advice on Home, the recovery card into Salud's
  `#score-recovery`, and the per-modality load summary cards (caveats behind their ⓘ) into Entreno's
  `#score-load` — glance vs detail.
- The tab is first and active by default. The visible panel is derived from the FILTERED nav list
  (`activeTabKey`), so `page.hideTabs: ["home"]` hands over to the next tab; hiding every tab is a
  build error.
- Robustness: each dial block / card renders through a try/catch with an empty-state fallback, and
  every host write (`#home-advice`, `#home-dials`, `#score-recovery`, `#score-load`, the advice) is
  isolated, so one throw never blanks Home or the other hosts. With no score data every host gets the
  empty state.

## Collapsed dial row

What it shows: a strip fixed at the top with the three dials as mini rings + labels (Sleep · Recovery
· Load) once the dials scroll above the viewport.

- Host `#home-mini`, first in `Home.astro`; triggered by an IntersectionObserver on `#home-dials`
  (`score.js`).
- A SOLID `--ground-top` fill behind the whole bar and a `--line-soft` hairline under it.
- Each mini ring draws its grey `--track` in full even with no value (the 45 % dimming of an empty
  ring applies to the big dial only).
- Every `dialFig` call also queues its mini item from the SAME svg string, colour class, label and
  detail opener (`HC.detailAttrs`): nothing is recomputed, and a tap opens the same detail as the dial.
- Load items carry `data-dmod`, so the load deep-dive's modality pills (`window.HCScore.setMod`) move them too.
- Off = `visibility: hidden` (out of the tab order and the accessibility tree). The slide / fade is
  dropped under `prefers-reduced-motion`. With no data or without IntersectionObserver it stays off.

## Dials

What it shows: three rings — Sleep / Recovery / Load (or Day strain) — that only VISUALISE baked
values; no new metric (the recovery % is a rank of the same composite).

### Geometry and common rules

- `web/src/view/dial.mjs` (`buildDials(scores, health)`, unit-tested, baked as `DIALS`) pre-computes
  the ring geometry; `score.js` only formats numbers and joins SVG strings.
- Three equal full rings in a row (≈ 92 px at a 390 px viewport), each starting at 12 o'clock and
  filling clockwise, round caps, a 9.5-unit stroke (of the 120-unit dial ≈ 8 %) on `--track`.
- Value INSIDE (D-DIN number, small unit); an uppercase "LABEL ›" BELOW; the dials sit on the page
  ground, not in a card.
- No caption under them: each dial's words live in its deep-dive page (insight card,
  `docs/detail-views.md`) and in its accessible name. Under the dials only:
  - a stale-data marker (`HC.staleMark`, `.dial-stale`: "Data 5 d old ⓘ" = `staleShort`; a tap opens
    the `staleNote` sentence);
  - the compact caveat lines ([Caveats](#caveats)).
- Stale data (> 3 days) greys a dial. The fill animation is off under `prefers-reduced-motion`.
- Nutrición's kcal ring draws the same full ring (`docs/nutrition.md`).

### Recovery dial

- With a % (`today.pct`): the ring fills to pct % from 12 o'clock, ONE colour = its % band
  (`dial-band-good` / `-mid` / `-low`), no baseline tick; centre "85" + a small "%". The mini row
  reuses the same svg.
- Without a % (fallback): ring = −3…+3 MAD, filled from 12 o'clock to last night's composite (`today`;
  falls back to `trend7`); a tick at 6 o'clock marks the baseline (0); centre = the signed value + the
  unit (sd).
  - The fill takes ONE state colour end to end, its band's: above = `--good`, at = `--mid`, below =
    `--low` (single night cut at ±`DAY_BAND_CUTOFF`, the trend fallback at ±`BAND_CUTOFF`). No zone
    arcs on the track.
- The band word and "Last night" (or the night's date) / "no recent complete night" are in the
  accessible name; the recovery deep-dive page adds "no sleep data" and the 7-day trend.
- A night CARRIED from an earlier day (today's is incomplete, e.g. no resting HR or too few HRV
  samples, so `recovery.mjs` falls back up to `MAX_TODAY_FALLBACK_DAYS`) follows the
  [carried-value rule](#carried-values): `.carried-date` under the number (the weekday does not fit
  inside a 360 px ring), dial and mini ring dimmed; the deep-dive is titled with that date and dims its
  hero (`docs/detail-views.md`). A stepped-to past day's own night is never marked.

### Sleep dial

- Fill = the sleep-duration component's newest night / the stated target
  (`health.recovery.sleep.target`, 7.5 h), capped at a full ring. Without that component (recovery gated, or
  under 14 nights of baseline: a new user, a band worn a few nights) the newest night of the sleep score
  (`SCORES.sleep.last`, an estimated in-bed night included), so a real night never reads "No data".
- `pct` = sleep performance (same fraction as a rounded %, `lib/score/sleep.mjs` `sleepPerformance`):
  centre "92" + a small "%" in the sleep colour. The mini row reuses the same svg + accessible name,
  which carries the % and "6:54 of your 7:30 need".
- Without a `pct`: the hours as h:mm ("6:54", no unit).
- The target is in the accessible name and the sleep sheet ("Target: 7:30"). A newest night that is
  not today's is carried (dated, dimmed; the aria names the date).

### Day strain dial (third dial, when calibrated)

- When `SCORES.strain.ok` (`lib/score/strain.mjs`; formula in `analysis/methodology.md`): the day's
  strain 0–21 — centre "12.4" (no unit), label `LOAD ›` / `CARGA ›` in strain blue (`.dial-strain`),
  ring = strain / 21.
- `DIALS.strain.days` = the last 14 days, each with its baked fill; the client picks the viewer's day,
  or the stepped-to past day. A day the data does not reach yet reads "No data" (never a made-up 0.0).
- Opens the strain deep-dive (`docs/detail-views.md`). NO modality pills: per-modality Relative
  Effort stays in Entreno's load cards and the `load-<m>` deep-dives (linked from the strain page).
  The collapsed row follows (three rings).
- Not calibrated (no `hr-hourly.csv`, no max HR, under 14 full days of all-day heart rate) → the third
  dial is the load dial below, unchanged.

### Load dial (fallback third dial)

- ONE dial per modality, one shown, NO pills under the dials. The gym / run / bike pills live in the
  `load-<m>` deep-dive, between its contributors and the insight card (`deepdive.js` `modSwitch`, the
  page's modality pressed, only with two or more load series); a pill opens that modality's page and,
  through its `data-mod` attribute (`score.js`'s delegated listener), calls `window.HCScore.setMod(key)` (no bare page global; `deepdive.js` feature-detects it), which shows that modality's dial on Home and in the collapsed row.
- Which modality it opens on (client-side, from the VIEWER's today, picked from the baked `recent`
  days, each with its pre-computed fill):
  1. the modality with a session today, GATED OR NOT (a gated one opens greyed, no number; gated
     modalities bake their `days` without geometry) — highest RE first, ties by modality order (gym,
     run, bike); a session without RE still beats none;
  2. else the baked `defaultKey` (first ungated modality).
- Content:

  | Today | Centre | Fill |
  | --- | --- | --- |
  | session with RE | today's RE | RE / typical day (ring midpoint = the typical training day, full ring = 2×, no zones; typical-day tick at 6 o'clock) |
  | rows but no RE | "No effort data" (never rest) | — |
  | no rows | "No session yet" (a dial word: sentence case, muted, `--fs-label`, as in the deep-dive hero) | — |

- `DIALS.load.tick` = the typical-day mark as a radial line across the hero ring's 7.5-unit stroke
  (`radialTick(0.5, HERO)`), drawn by the load deep-dive's hero ring.
- The load deep-dive's insight card says the day in a sentence ("Today's Relative Effort is 28; your
  typical training day is ~42.", or no session yet / the last one) and the acute/chronic context
  ("Over the last 7 days your load has been steady (−6% vs your 42-day average)."); the ring scale and
  "includes N sessions without effort data" sit under its ⓘ (`docs/detail-views.md`).
- A gated modality (`baselineBuilding`, or `fewDays` when there is no typical day) is greyed with no
  number (its reason is in the sheet).

## Monitor tiles

What it shows: two 96 px tiles under the dials (`#home-tiles`, `client/monitor.js`), from the SAME
`SCORES.monitor` cards — no new metric.

### Tile 1 — `HEALTH MONITOR ›`

- A square status icon (26 px, a 16 % tint of its colour): "!" `--down` when any fresh card is High /
  Low; a check `--up` when at least one fresh card is Normal; none without fresh data.
- Right of it, a status chip — "N out of range", else "Within range", else "No data" — over "n/5
  metrics" (fresh cards in range / all cards). A card counts only when its own date is ≤ 3 days old.
- It is a button with `data-jump="monitor"` (`core.js`'s delegated `jump('monitor')`): switches to Salud and scrolls to the monitor list at its
  top. `#monitor` deep-links there too (`ANCHOR_TAB` in `lib/nav/tabs.mjs`: `core.js` shows Salud and
  keeps the hash).

### Tile 2 — `STRESS MONITOR ›`, else HRV

- Stress (when a day has a value, `SCORES.stress`, `lib/score/stress.mjs`: a heart-rate-only ESTIMATE
  per waking hour outside workouts and sleep, 0–3, formula in `analysis/methodology.md`):
  - the latest scored hour's value in a small square chip and its band word:

    | Band | Range | Colour |
    | --- | --- | --- |
    | low | < 1 | light blue `--strain-ink` |
    | medium | 1–2 | teal `--up` |
    | high | ≥ 2 | orange `--down` |

  - the hour ("14:00", prefixed by the date when the day is not today);
  - today = the newest day with a value when it is ≤ 3 days old (a day needs ≥ 6 scored hours, so early
    in the morning it is yesterday's, dated);
  - opens the stress page (`docs/detail-views.md`) on the reading's own day when it is not today
    (`data-date`), so the tile and the page agree.
- No stress value → HRV: the real baked value, its unit, its status word in its tone colour, its date
  when not today; opens the HRV sheet.
- No fresh HRV value either → tile 2 is left out and tile 1 spans the row (`.hm-tiles-one`).

## My day

What it shows: `#my-day`, a sentence-case section heading followed by the outlook bar, the energy bank,
the nutrition score and today's activities.

### Daily outlook (advice)

- One descriptive sentence per rule (`lib/score/advice.mjs`, copy in `advice-copy.mjs`), never an
  instruction; hidden when data is insufficient or stale (> 3 days).
- Renders as the outlook bar (`.outlook`: full width, 46 px, warm grey → dark gradient, sun icon, ONE
  line — the short title `home.outlook` "Your daily outlook" / "Tu panorama del día" — and a chevron);
  opens the recovery sheet (every rule reads the recovery trend).
- The sentence is the bar's accessible name and leads the recovery deep-dive's insight card
  (`score.js` exposes it as `window.HCAdvice`, '' on a past day or stale data; `deepdive.js`
  `recoveryLines` prepends it).
- Without a detail sheet (nothing to tap) the bar shows the sentence itself, ellipsised.
- The rules read the 7-day trend, and every sentence names that window ("Over the last 7 days recovery
  has…") so it reads as the context under last night's headline.

### Energy bank

- `lib/score/energy.mjs`, baked as `SCORES.energy`; `#home-energy` + `client/energy.js`, between the
  outlook bar and "Today's activities".
- OUR intraday 0–100 estimate, not a validated physiological measure (formula + constants in
  `analysis/methodology.md`): starts at the wake time at the morning's recovery %, drains per awake
  hour by a baseline, the stress estimate and the heart-rate load (day strain's TRIMP / K), recharges
  in calm hours.
- Card `.sc-card.tn.en`: "ENERGY BANK estimate" header (generic opener chevron); the latest level big
  in D-DIN coloured by its third (the recovery `pctBand` via `HC_BAND`: high ≥ 67 `--good`, low ≤ 33
  `--low`, middle `--mid`; `.de-hi/.de-mid/.de-lo` set `--ds`); the latest hour under it; a stretched
  SVG curve from wake to that hour (line + soft area); "From 99 at 06:47 · low 3".
- Today = the newest day with a value when it is ≤ 3 days old; no bake / no value → the host stays
  hidden.
- Opens the energy bank page (`docs/detail-views.md`, key `energy-bank`).

### Nutrition score

- `lib/nutrition/score.mjs` = the reference, scored at view time by `client/nutri-score.js`;
  `#home-nscore`, under the energy bank card.
- The day's 0–100 adherence to its own targets from the food log (kcal 0.4, protein 0.4, fat 0.2;
  formula and rules in `docs/nutrition-food-log.md` → Nutrition score and `analysis/methodology.md` 5b).
- Card `.sc-card.tn.en.ns`: ONE caps title "NUTRITION" ("· INCOMPLETE" when a macro is missing, "· IN
  PROGRESS" while today is being logged) — one size and weight, no smaller tag inside.

| State | Headline | Rows | Footer |
| --- | --- | --- | --- |
| Today logged (today heads the card ALONE) | today's kcal eaten as a % of its target in white (`.ns-now`, "22%" over "KCAL TODAY"; no score, no band colour; none without a kcal log) | Nutrición's three macro rows ("KCAL", "1,500 / 2,000 kcal"), bar = eaten / target in neutral `--trend` (`.ns-run`), no points | the newest closed day: "Yesterday 56% · 7-day average 85%" |
| Nothing logged today | the newest CLOSED day while ≤ 3 days old: its score big in D-DIN, band colour (≥ 85 `--good`, 60–84 `--mid`, < 60 `--low`, via `.de-hi/.de-mid/.de-lo`), "Yesterday" or the date under it | rows with their points ("KCAL · 85 pts"), bar = the points in their band colour | "7-day average 79%" (final scores only) |
| Nothing logged / nothing fresh | hidden | — | — |

- When today is logged the accessible name says both ("Nutrition today: in progress, 22% of the kcal
  target, no score yet · Yesterday: nutrition score 56%").
- Opens the nutrition trend sheet (`docs/detail-views.md`, key `nutrition`). On the LAN page
  Constancia's live summary re-renders it after every add / delete.

### Today's activities

- `lib/score/timeline.mjs`, baked as `SCORES.timeline` even when `hasData` is false; `#timeline` +
  `client/timeline.js`, under the outlook bar in "My day".
- Per day: last night's sleep (`sleep-daily.csv`, dated the wake-up day, with its bed / wake clock
  `bed` / `wake` when the row has them) and that day's workouts by Home modality (gym / run / bike /
  other) with minutes and RE when the source recorded it.
- Row = a coloured chip (sleep `--sleep`, workout `--strain`: line icon + hours asleep; a workout's RE
  as a bare number, else its minutes; dark ink), the uppercase name, and the details stacked on the
  right behind a thin bar of the row's colour: bed / wake time for sleep; for a workout the minutes
  (when the chip holds RE) and "N parts".
- workouts.csv has no start time, so a workout has no start / end clock pair; the row's `aria-label`
  spells it out ("Run · RE 94 · 45 min · 2 parts").
- Programmed session (viewer's today only, `window.HCProgram` from `client/training-today.js`): the last
  row — an outline chip "Plan", its focus (one line, ellipsised; the `aria-label` carries the whole
  focus and the session view shows it in full), "Programmed" (white caps; the row's bar carries the
  colour); opens the session as the `hoy-session` detail view. Nothing matches it to a done workout
  yet, so it is only listed, never ticked; it is not shown under an older day's heading; with no baked
  day but a session today the card lists only it.
- Rows follow the [same-day merge rule](#same-day-merge-rule) (`DISPLAY_RULE`: stubs dropped, one
  source, same-day rows of one modality merge; the row says "N parts").
- Only the last 3 data days are baked. Which day the client shows:

  | Case | Shown |
  | --- | --- |
  | viewer's today is baked | today under "Today's activities" |
  | otherwise | the newest earlier day under "Latest day · <date>" (no filler line), greyed when > 3 days old |
  | viewer's clock EARLIER than every baked day (clock / timezone skew) | the newest baked day under its date (not greyed) |
  | no baked days | a one-line empty state |

- No sleep that night → "No sleep recorded", never 0 h.
- The header row centres the title on its 44 px ⓘ, which overhangs the card padding. The same-day merge
  note ("RE only comes from Strava") sits behind that ⓘ (`#tl-info`, only when the day lists
  workouts), not under the list.

## Today you eat

What it shows: today's day type, goal and target (`components/EatCard.astro`, `#eat-body`,
`nutri-day.js` `renderEat`; see `docs/nutrition.md`). Past days: [Day stepping](#day-stepping).

## Tonight

What it shows: the recommended bedtime and the usual wake time (`#home-tonight`,
`lib/score/tonight.mjs` baked as `SCORES.tonight`, `client/home-week.js`).

- Bedtime (moon icon) and usual wake (alarm icon) joined by a dashed line; D-DIN clocks
  (`--fs-num-card`, 28 px), uppercase captions.
- The wake side carries a teal state line "● Usual wake" (`--up`; the page has no alarm data), then
  "Last N nights" (the nights the median used).
- Rule (stated behind the ⓘ of the registered `tonight` sheet the card opens — body = the bedtime +
  the history link — never on the card; the disclaimer sits with it):
  - usual wake = the median wake clock (`sleep-daily.csv` `waketime`, the night dated the wake-up day)
    of the nights in the last `TONIGHT_WINDOW` (14) days ending at the newest night with a wake time;
  - bedtime = usual wake − the sleep target (`SLEEP_TARGET`, 7.5 h, the sleep dial's);
  - a wake clock ≥ 18:00 is unwrapped to a negative hour before the median (23:50 and 00:10 sit
    together);
  - fewer than `TONIGHT_MIN_NIGHTS` (7) such nights → `null` and the card stays hidden.
- Data > 3 days old greys it. No alarm editing (the page cannot set one); the sheet links to the sleep
  history (a `.cta` link, "SEE SLEEP HISTORY →").

## My journal

What it shows: the last 7 days' journaling (`#my-journal`, `client/journal.js`, design in
`docs/journal.md`).

- "MY JOURNAL" + a chevron; 7 day columns (the 7 days ending on the viewer's today: weekday + a check
  circle, `--up` when that day is journaled).
- A column or the chevron opens the journal sheet on that day. Ships hidden.

## My plan

What it shows: the viewer's weekly goals (`#my-plan`, `client/home-week.js`,
`window.HCWeekPlan.weekGoals`).

- One collapsible `<details>` card, flat (no border, no open-state ring): "Weekly plan · N days left ·
  X % accomplished" + a teal progress bar.
- The VIEWER's week: Monday–Sunday from `Date.now()`, never baked; days left = after today.
- Expanded: one row per goal — uppercase label + its basis, `done/target`, ▲ `--up` on pace / ▼
  `--down` behind (on pace = done ≥ target × days elapsed / 7), a small bar.
- % accomplished = the mean of min(1, done / target) over the shown rows.
- Goals (the profile document has no goals block, so these are the documented defaults in `GOALS`):

  | Row | Done (this week, up to today) | Target | Source | Hidden when |
  | --- | --- | --- | --- | --- |
  | Nights ≥ 7:30 | nights (dated the wake-up day) asleep ≥ the sleep target | 5 | `DETAIL.metrics.sleep` | no sleep metric, or `DETAIL.asOf` > 3 days old |
  | Training days | distinct dates with a session | the days programmed this week, else the usual week | `DETAIL.sessions` (display rule) + `TRAINING` (`loop-data/cache/training.json`) | stale as above; no programme AND < 3 complete weeks of data (of the last 6) or a usual week of 0 |
  | Days with food logged | days with ≥ 1 food log entry | 7 | `HCAdherence.state().days` (the Constancia summary, LAN page only) | no summary (static / example page) |
  | Days on kcal target | days whose Constancia state is `on` (complete, within ±10 % of the day's target) | 5 | `HCAdherence.dayState` + `HCNutri.targetFor` | no summary, or no `HCNutri.targetFor` |

- The usual week = the median of the session days per week over the last 6 complete weeks before this
  one (only weeks the data covers).
- The food rows appear when the summary answers: `client/adherence.js` calls `HCWeekPlan.refresh()`
  after every read (the card keeps its open / closed state).
- No row → the card and its "My plan" heading stay hidden.
- The sleep row opens the sleep sheet, the training row the training-time sheet.

## My dashboard

What it shows: user-chosen metric cards with the latest value vs a 30-day baseline (`#my-dash`,
`client/home-dash.js`).

### Cards

- Section heading with "CUSTOMIZE ✎" on the right, then single-row metric cards (60 px): line icon ·
  UPPERCASE full metric name ("Resting heart rate", "Heart rate variability", "Hours of sleep",
  "Walking heart rate": `home.dash.names`, else the detail sheet's title) · the latest value (D-DIN,
  22 px) + its unit at about half that size and an arrow, the 30-day baseline small under it.
- Catalogue (`CATALOG`); only keys present in the baked `DETAIL.metrics` are listed:

  | Default | Keys |
  | --- | --- |
  | shown (`DEFAULT_ON`) | rhr, hrv, sleep, weight, steps, stress (saved prefs without stress get it appended, shown) |
  | hidden | vo2max, fitnessAge, walkingHr, exercise |

- fitnessAge in whole years, "< 25" / "> 75" at the reference curve's bounds (`docs/health-tab.md` →
  Fitness age).
- Same series and units as the detail sheet (`I18N_DETAIL`).
- Value = the newest day with data up to the viewer's today (a daily total skips today, still filling
  up); sleep shows h:mm.
- Baseline = the mean of the 30 days before that day, with ≥ 7 days of data (≥ 2 readings for a
  sparse series like weight); no baseline → no arrow.
- Arrow ▲▼ = the value vs the baseline: `--up` when better by the metric's good direction (`dir`),
  `--down` when worse, `--ink` (white) for a metric with no good direction (weight; never a grey
  arrow); a grey dot within ±2 % (`FLAT_SHARE`).
- A row older than 3 days is dimmed; a tap opens that metric's detail sheet.
- Every metric hidden → a one-line note (the section stays so Customize can bring one back); no
  catalogue metric in `DETAIL` → the section stays hidden.

### Stress card

- `stress` is the one CHART card (`stressCard`): available when `SCORES.stress` has a day with a latest
  scored hour (`now`); shows the newest such day (as the stress tile).
- A caps title, "Latest hour HH:00" (+ the date when not today), the band word + value, then the hourly
  chart (`HC.stressChart`, `client/util.js`, shared with the stress sheet). Opens the stress sheet on
  that day.

### Customize sheet

- "Customize" opens the registered `dash-edit` sheet (`detail.js` modal): the list straight away, no
  intro paragraph, 48 px rows (the 44 px buttons centred).
- Per metric: its SHORT name (the trend sheet's title: "HRV", "Resting HR", so a row fits 1–2 lines at
  360 px; the full name stays in the buttons' accessible names), THE switch (`HC.switchBtn`,
  `role="switch"` + `aria-checked`; `docs/design-system.md` → Components), compact ↑ / ↓ buttons (the
  keyboard and screen-reader way to move) and, last, the ≡ drag handle (`.db-grip`, `aria-hidden`).
- Drag (Pointer Events, so mouse, touch and pen alike):
  - `pointerdown` on a handle (the primary pointer only, a mouse only with its main button, never
    while a drag is active) calls `setPointerCapture`;
  - every `pointermove` puts the row where the pointer is (the DOM row moves live, lifted on
    `--track`; `touch-action: none` on the handle keeps the sheet from scrolling);
  - `pointerup` saves through the same `commit()` as ↑ / ↓ (prefs → the dashboard → the sheet
    re-rendered); `pointercancel` re-renders the saved order;
  - moving the row in the DOM drops the pointer capture (Chromium fires `lostpointercapture` on every
    live reorder), so a lost capture is re-taken while the row is on the page; only when that fails
    (the pointer is gone) or the row left the page does it cancel like `pointercancel`;
  - a re-render of the sheet drops a drag in flight; a drag whose row has left the page (sheet closed,
    no `pointerup`) is stale and never blocks the next one;
  - no auto-scroll while dragging (the whole catalogue fits a phone screen).
- Both drag and ↑ / ↓ reorder through the pure `HCDash.move(list, from, to)`.
- Preferences = `localStorage['hc-dash-v1']` `{order, hidden}`: every read / write is in a try/catch;
  unknown, duplicate or unavailable keys are ignored; a catalogue key missing from the stored order is
  appended with its default visibility; without storage the choice holds in memory for the visit.

## Health monitor (on Salud)

What it shows: the FIRST block of Salud (`tabs/Salud.astro`) — five signals vs a personal band; the
Home tiles summarise it. `lib/score/monitor.mjs`, baked as `SCORES.monitor` even when `hasData` is
false; `components/HealthMonitor.astro` + `client/monitor.js`.

- Header: an UPPERCASE "HEALTH MONITOR" label with the same status chip as tile 1 and an ⓘ button (the
  band explanation, collapsed: `#hm-info`).
- One shared metric row per signal (`HC.metricRow`, the My dashboard row): icon · NAME · value + unit ·
  ▲ above / ▼ below / • inside the band; the range "lo–hi" as the small line under the value (the word
  "Normal range" is in the row's aria-label and the ⓘ); the short date "28 Sep" when not last night.
- Signals: respiratory rate, resting HR, HRV, sleeping wrist temperature, sleep duration.
- Each = the newest daily value (per-day median of the plausible samples; a sample outside the signal's plausibility range is an artefact and is dropped, never clamped, so a lone dropout leaves no day) + unit, its date when
  not from the viewer's today, and Normal / High / Low (es: `Normal` / `Alto` / `Bajo`; the status word
  is in the row's `aria-label`).
- Band = median ± `BAND_K` (2) × scaled MAD (`robustBaseline`, floored per signal) over the 42 days
  BEFORE that value: ~5 % false flags per card; HRV in log space like `recovery.mjs`, so asymmetric in
  ms.
- < 14 baseline days → value + "building baseline" as the small line, no band, no marker; a missing
  series → "—" + "No data".
- Tone:

  | Signal | High | Low |
  | --- | --- | --- |
  | HRV | good | bad |
  | Resting HR | bad | good |
  | Sleep duration | — | short = bad |
  | Respiratory rate, wrist temp | change signals: out of band = `watch` (`--mid` marker), never bad | same |

  Marker: teal `--up` for good, orange `--down` for bad, grey for normal.
- A row whose OWN date is > 3 days before the viewer's today is greyed with "no recent data", no tone,
  no marker; the whole block greys when its newest date is > 3 days old.
- Display units come from the i18n dict. A card that throws falls back to its empty state.

## Scoring

### Recovery

What it shows: last night's recovery as a % rank (headline), with the 7-day trend as context.
`lib/score/recovery.mjs`.

**Composite**

- In units of the user's typical spread (scaled MAD). ONE unit key, `RECOVERY_UNIT`
  (`lib/score/advice-copy.mjs`, re-exported by score-templates: en "SD", es "desv."; dict
  `recovery.unit`), builds every recovery string — advice, dial, Salud card, monitor note, detail
  sheet; no unit literal in `score.js`. The Salud card explains it behind its ⓘ (`recovery.unitNote`:
  "typical spread" / "variación típica").
- Inputs vs a median/MAD baseline (42 days ending asOf-1), z clamped ±3:

  | Input | Weight |
  | --- | --- |
  | HRV (daytime SDNN) | .40 |
  | Resting HR | .25 |
  | Sleep duration | .25 |
  | Sleep regularity | .10 |

- Missing inputs: the composite is the weighted mean over the inputs present, renormalised, and needs
  ≥ 0.6 of the weight. Without HRV (a device that records none, e.g. Mi Fitness, or under 14 days of it)
  recovery is scored on resting HR + sleep duration + regularity (0.25 + 0.25 + 0.1 = 0.6) and the block
  carries exactly one of `noHrv: true` (no HRV reading at all: "no HRV from your device") or
  `hrvPending: true` (HRV readings, but under 14 days of baseline, e.g. a new Watch user: "no HRV baseline
  yet"). The card shows "Partial: no HRV" under the trend line for either; its ⓘ gives the matching note.
  `rhrDerived: true` when the scored day's resting HR is derived from night heart rate
  ([data-pipeline.md → Resting HR](data-pipeline.md#apple-health-export-and-extract)); the ⓘ says so.
  The keys exist only when true, so a Watch user with an HRV baseline gets an unchanged block. Resting HR alone (no sleep) stays
  gated, and "last night" still needs a sleep row (an estimated in-bed night counts).
- Band: ≥ +0.5 above / within ±0.5 at / ≤ -0.5 below baseline (`BAND_CUTOFF`).
- Every band (the trend's and last night's) is taken from the value AS SHOWN, rounded to 2 decimals
  (`shownBand`): an unrounded 0.4996 shown as "0.50" is above, never at. The advice line reads the baked
  `recovery.band` instead of recomputing it.

**Headline (`today`) and "last night"**

- `today` = the composite of the asOf day alone (last night), same baseline. A single day is noisier
  than the 7-day mean (measured σ_daily 0.782 vs σ_7 0.328, `MEASURED_SIGMA`), so its band is cut at
  `DAY_BAND_CUTOFF` = `BAND_CUTOFF` × σ_daily/σ_7 ≈ 1.2 (same false-flip rate).
- `MEASURED_SIGMA` is a **population default**: measured once (`measureSigma`, 90 days) on one user's
  data and used for everyone. The composite is already z-scored per user against their own 42-day
  baseline, so only `DAY_BAND_CUTOFF` depends on it. To check it on an install's own extract:

  ```sh
  node --input-type=module -e "import { readExtract } from './lib/extract/read.mjs';
    import { measureSigma } from './lib/score/recovery.mjs';
    const I = readExtract('loop-data/extract');
    console.log(measureSigma({ hrv: I.series.hrv, rhr: I.series.rhr, sleep: I.sleep }))"
  ```

  `sigmaD` / `sigma7` far from 0.78 / 0.33 would move the single-night cut; there is no per-user
  calibration.
- "Last night" = the newest COMPLETE day among asOf and the 2 days before it
  (`MAX_TODAY_FALLBACK_DAYS`). Complete (`completeDay`) needs:
  - a sleep-duration reading;
  - a resting-HR value;
  - only when HRV is a scored component (the user has an HRV baseline): an HRV day with ≥
    max(min(3, usual), 50% of usual) samples (usual = median daily sample count over the baseline;
    only plausible samples inside the HRV plausibility range count, identical rows once);
  - plus ≥ 0.60 of the weight.
- A user without Watch HRV is scored on sleep + resting HR.
- A partial newest day (e.g. no RHR yet) falls back to the previous complete one, labelled by its
  date, and stays in the trend and baselines. No complete day in those 3 → the headline is the trend
  with a "no recent complete night" note.
- `today` is `null` unless the components present that day carry ≥ 0.60 of the weight AND include HRV
  or RHR (a sleep-only night is too thin); the page then says "no data for last night" and shows the
  trend instead.
- `today.sleep` is always true (a complete day requires sleep); it is kept for the page's label logic,
  which labels a night without a sleep-duration reading by date + "no sleep data", never "last night".
- The monitor cards and Salud's HRV headline keep per-signal completeness (HRV sample floor only).

**Recovery % (`today.pct`, the headline)**

- Last night's composite RANKED among the composites of the 90 days before it (`PCT_WINDOW_DAYS`), all
  scored against the same baseline, days with ≥ 0.60 of the weight only — empirical CDF: share of
  prior days with a lower composite, ties counted half, rounded to an integer 0–100 (`percentileRank`,
  baked, never computed in the browser).
- Bands (`pctBand`, thirds of the user's own distribution): good (`--good`) ≥ 67, mid (`--mid`) 34–66,
  low (`--low`) ≤ 33.
- Under 21 prior days (`MIN_PCT_DAYS`) `pct` is null and every surface keeps the SD presentation (the
  documented fallback).
- A transparent mapping of the same composite, not a new metric; the ⓘ says so (`recovery.pctNote`:
  "% = how last night ranks against your previous 90 days"). The night's SD value + day band stay in
  the Salud card's ⓘ and the deep-dive's ⓘ (`recovery.sdLbl`).
- The deep-dive contributors show the night's HRV, resting HR, respiratory rate (context only, not a
  composite input) and sleep performance % (display only, `docs/detail-views.md`).
- The 7-day trend and the advice stay in SD (the advice describes the trend, not the night).

**Trend**

- `trend7` = mean composite of the 7 days ending asOf.
- `trendDir` = `delta7` (this week's trend7 − last week's). Two non-overlapping 7-day means differ with
  noise √2 × σ_7 ≈ 0.46, so it is cut at `TREND_DIR_CUTOFF` = `BAND_CUTOFF` × √2 ≈ 0.7: up / steady /
  down.

**Gate**

- "insufficient" unless components with ≥ 14 baseline days carry ≥ 0.60 of the weight, include HRV or
  RHR, and there are ≥ 7 composite days in the last 14.

**Salud recovery card** (`#score-recovery`, stacks at every width)

- Headline: last night's % + its % band word (e.g. "85% High"), or the composite in SD as the fallback;
  ONE short trend line "7-day +0.5 SD · at baseline".
- 14-day sparkline.
- Contributors (HRV, RHR, sleep duration, sleep regularity), one under the other, in the contributor
  row the recovery sheet uses (`HC.contribRow`: icon, name, latest value + unit, the 7-day ±SD as a
  small sub line, ▲ / ▼ = which way the 7-day mean sits from the baseline coloured by what it means —
  band above = better, below = worse — or • at baseline; no state dots).
- The raw last-14-days lists fold into a `<details class="rec-raw">` ("Last 14 days" / "Últimos 14
  días"), a quiet uppercase disclosure line with a turning chevron (it resets tablas.css's bare details
  card).
- Notes (what the baseline is, the full trend sentence with the week-on-week change, each contributor's
  baseline and n, the unit in words, confidence + the SDNN caveat, missing / lowest signal): `score.js`
  writes them into the Salud Recovery section's ⓘ block (`#hs-info-recovery`, in their own
  `.rec-info-notes` child after the section's notes) and only draws its own ⓘ (`#rec-info`) when that
  block is absent.

### Load

What it shows: per-modality training load from Strava Relative Effort, today vs the typical day.
`lib/score/load.mjs`.

- PER MODALITY (gym / run / bike; `other` is shown raw, never scored) and Relative-Effort-only (Strava
  `suffer_score`; Apple rows have no RE and are counted as `unscored`).
- Same-day rows follow the [shared rule](#same-day-merge-rule) (junk dropped, one source, then SUM).
- The series starts at the first date with any RE (`reEpoch`); acute 7d vs chronic 42d EWMA.
- Gate ("baselineBuilding"): under 28 days since the epoch, under 8 non-zero days, or chronic < 1.
- The 0-100 `relScore` exists only within a modality.
- A day whose rows in a modality are ALL unscored is MISSING, not rest: both EWMAs carry forward over
  it without decay, and a modality whose last 7 days hold such sessions says so on its card and load
  dial's detail sheet header ("includes N sessions without effort data").
- Trend bands (never "detraining": the data cannot tell a deload or missing effort data from fitness
  loss):

  | Band | Acute vs chronic |
  | --- | --- |
  | ramping | ≥ +30% |
  | above | ≥ +10% |
  | steady | between |
  | below | ≤ −10% |
  | well below | < −30% |

- `asOf` = the last session or `trainingThrough` (`lib/training/through.mjs`: the newest day of the
  Watch's HRV / resting HR / sleep / hourly HR), whichever is later. Days without a session up to it
  are rest (zero load), so a rest week decays the trend and is never greyed as stale data. A
  Strava-only session not yet synced is not seen there (the LAN sync status shows it).
- `typical` = the median of the NON-ZERO days in the 42 days before asOf (asOf excluded; `value: null`
  under 6 such days — `TYPICAL_WINDOW_DAYS` / `MIN_TYPICAL_DAYS`).
- `recent` = the session days of the last `RECENT_DAYS` (14) ending asOf, each `{date, re, unscored}`
  (only dates with valid non-junk rows in that modality; `unscored` = rows without RE); `last` = the
  newest day with RE > 0.
- The VIEWER's today is picked client-side from `recent`, so nothing today-relative is baked.

### Sleep scores

What it shows: last night's sleep performance, efficiency, consistency and stages.
`lib/score/sleep.mjs`, baked as `SCORES.sleep` = `{need, last}`, null without sleep data.

| Field | Definition |
| --- | --- |
| `perf` | asleep / need × 100, rounded, capped at 100 — **our need = your target** (`SLEEP_TARGET`, 7.5 h; no adaptive need from strain or debt is invented) |
| `eff` | asleep / in bed × 100 (capped; null when the night has no `inbed_h`) |
| `cons` | sleep consistency in MINUTES (`recovery.mjs` `sleepConsistency`: the mean of \|bedtime − median\| and \|wake − median\| over the previous 42 nights — the recovery input `sleepCons`; no documented minutes → % mapping exists, so no %) |
| `stages` | REM / deep / core / unspecified / awake / in bed hours (staged night only) |
| `shares` | REM / deep / core % of asleep (staged night only) |
| `restorative` | REM + deep hours (staged night only) |
| `estimated` | `true` only on an estimated (in-bed-only) night: its hours are time in bed, so `perf` and `cons` read it, `eff` / `stages` are null ([data-pipeline.md → Sleep](data-pipeline.md#sleep-sleep-dailycsv)) |

### Day history

What it shows: the per-day scores behind [day stepping](#day-stepping). `lib/score/days.mjs`, baked as
`SCORES.days` = `{from, to, days}`, null without overnight data (~7 KB on the example page).

- For each of the last `DAY_HISTORY_DAYS` (= the load dial's `RECENT_DAYS`, 14) days ending at the
  newest overnight date, the inputs are CUT at that day and the same scorers run
  (`recoveryFromInputs`, `monitorFromInputs`), so the newest entry equals today's bake and an old day
  is scored against the baseline and 90-day % window it had then.
- Per day:

  | Key | Value |
  | --- | --- |
  | `rec` | the night scored that morning only when it IS that day (`{value, band, sleep, pct?, pctBand?}`); `'gated'` while recovery was gated; null = no complete night that day — never an older night under its date |
  | `sleep` | that day's asleep hours (the recovery sleep-duration input, the number the sleep dial uses; without that component, recovery gated or under 14 nights, that day's own sleep row; null when the day has no night) |
  | `monitor` | the summary tile on that day: `inR` / `out` among the cards fresh on that day (own date ≤ `STALE_DAYS` before it), `total`, and the HRV card `{value, dec, status, tone, date}` when fresh |

- `buildDials` turns each entry into `DIALS.days[i]` = `{date, sleep, recovery}` in today's dial shapes
  (always mode `today`; no trend fallback).
- Load needs no new bake (its `recent` days).

## Carried values

What it shows: a Home display that stands for today (or the stepped-to day) but shows an EARLIER day's
value names that date and is dimmed (`HC.carried`, `docs/design-system.md` → Carried values).

- Dimmed = `.carried`, colour kept; the > 3-day stale grey stays the stronger state.

| Display | Date shown |
| --- | --- |
| Sleep and recovery dials + mini rings | "7 OCT" under the number |
| Monitor summary tile | "8 OCT" under "5/5 metrics" (the newest night it counts) |
| Stress and HRV tiles | "8 OCT · 23:00" |
| Energy bank card | "8 OCT · 21:00" (it then opens its page on that day) |
| "My day" | its "Activities · Thu 8 Oct" heading |

- The tiles and the energy card drop the weekday (half-width); the "My day" heading keeps it.

## Day stepping

What it shows: Home for a PAST day (`#d=YYYY-MM-DD`) via the top bar's "‹ HOY ›" (`client/today-date.js`
`window.HCDay`, `docs/plan-page.md` → Top bar).

- The blocks below re-render on every change (`HCDay.on`); everything else keeps its own scope.
- TODAY goes through the unchanged code path (no selected day), so today's markup is byte-identical to
  a page without day stepping (unit-tested).

| Block | On a past day |
| --- | --- |
| Dials + collapsed row (`score.js` `renderDay`) | sleep + recovery = that day's `DIALS.days` entry (a day without its own night reads "No data", never another day's value); load = the modality's baked `recent` session day (the dial opens on the modality trained THAT day; "No session" instead of "No session yet"; a gated modality stays gated, the gate is today's); the arias name the date instead of "last night" / "today"; never greyed as stale, no stale line; every dial and mini ring opens its deep-dive ON that day (`data-date`) |
| Outlook bar | hidden (it reads the current 7-day trend) |
| Monitor tiles (`monitor.js` `renderTiles`) | that day's `SCORES.days` summary (in / out of range among the cards fresh ON that day, out of `total`) and that day's stress value (`SCORES.stress.days`, the last 14 days; opens the stress page on that day), else its HRV card (dated when its reading is older than the day; opens the HRV sheet on that day); no entry → "No data". The Salud list stays the latest |
| "My day" (`timeline.js` `pastHtml`) | "Activities · <date>" with that day's night (`DETAIL.metrics.sleep`: hours, bed / wake clock) and workouts (`DETAIL.sessions`: one per date + modality after the SAME display rule as `SCORES.timeline`, minutes, RE, parts; a test checks both give the same rows); no programmed-session row, never greyed, every row opens its sheet on that day; nothing that day → "Nothing logged that day" |
| Energy bank (`energy.js`) | that day's `SCORES.energy.days` entry (level, curve, start, low); opens the energy bank page on that day; no value → hidden |
| Nutrition score (`nutri-score.js`) | that day's FINAL score (no average line); opens the nutrition sheet on that day; no log or no target → hidden |
| Eat card (`nutri-day.js` `renderEat`) | "Target for <date>" with that day's DETECTED day type (`dayInput` + `detectDayType`, the same detection as `HCNutri.targetFor`) and its plan targets for the current goal; a day whose type cannot be told (no session, sleep or programmed session) hides the card |
| Tonight | hidden (it is about the coming night) |
| My plan / My dashboard | unchanged: the viewer's week / the latest values |

## Caveats

What it shows: the limits of the scores, kept reachable wherever a dial is shown.

- RE is HR-derived (credits the metcon more than heavy sets); modalities are not comparable; "gym" is
  the Watch auto-label; no comparable load before the RE epoch; same-day rows are summed (a real
  two-a-day is indistinguishable); HRV is daytime SDNN; not medical advice.
- They live with each dial's detail: the caveats card in Entreno's `load` section; the recovery card in
  Salud.
- When `page.hideTabs` hides Entreno (or its `load` section), `score.js` writes a compact load caveat
  line under the dials on Home (`dials.load.caveatLine`); when it hides Salud, a compact recovery line
  (`dials.recovery.caveatLine`).

## Same-day merge rule

What it shows: ONE rule (`lib/training/sessions.mjs` `mergeSameDay(rows, keyFn, { dropJunk, dropStub })`)
used by EVERY workouts.csv reader: the load series, the timeline, the Entreno calendar / cumulative
time, the workouts dashboard, the running / cycling tables and Salud's load vs recovery.

- Key = the physical modality (Home's gym / run / bike / other), or one constant for a single-family
  table; Entreno buckets the surviving rows into its five display buckets afterwards.

Per (date, key), in order:

1. **Drop invalid rows** (`dur <= 0`).
2. **Short-row filter**, by reader:

   | Reader | Rule | Drops |
   | --- | --- | --- |
   | LOAD scoring (default) | junk (`isJunk`) | `dur <= 11` AND `re` null or ≤ 2 |
   | DISPLAY readers (timeline, calendar / cumulative, dashboard, run / ride tables), via `DISPLAY_RULE` | stubs only (`isStub`) | `dur < STUB_MAX_MIN` = 3 (accidental Watch starts) |

   Watch rows and no-HR Strava rows have `re` null by design, so the junk rule would hide real 9-10 min
   sessions from the pages that list sessions (they still add no load).
3. **ONE source per session.** Several apps mirror the SAME workout into Apple Health (workouts.csv
   carries Watch, Hevy, Zepp, ROXFIT, Nike, the Strava app's HealthKit copy "Strava" and sync:strava's
   "Strava API" rows):
   - rows are grouped by `source`; fragments of ONE source are kept together (the Watch splits
     sessions);
   - across sources one source's rows are kept, never a sum, by `SOURCE_PRECEDENCE`:
     `/^Strava API\b/i` > `/^Strava\b(?! API\b)/i` > `/^Apple\s+Watch\b/i` (anchored; `\s` matches the
     no-break space Health writes in the device name) > any other app;
   - within one rank: the longest total wins, then the group with HR, then with RE, then source name
     ascending — deterministic, never file order;
   - sync:strava keeps every Strava row, so this is THE dedupe;
   - a higher-precedence source replaces a lower one only when its total duration is ≥
     `SUPERSEDE_MIN_COVERAGE` (0.5) × the lower one's total; below that they are most likely different
     sessions and both source groups are kept;
   - when the kept source has no HR (or no RE) and a replaced copy does, the kept rows inherit it (HR
     duration-weighted, max of max; RE spread by duration), so HR-based readers (load vs recovery) keep
     the session;
   - the load coverage counts replaced rows as `superseded`.
4. **Sum** the remaining rows as ONE session (a session logged in parts adds up; a real two-a-day is
   indistinguishable).

Known limitation: rows carry no start time, so a higher-precedence copy covering ≥ 0.5 of a lower
source's total can absorb a genuine SECOND session of that lower source; planned fix = add `start_time`
to workouts.csv and match copies by time overlap.

## workouts.csv columns

What it shows: the 12-column file (`… ,distance_km,relative_effort,kilojoules,elevation_m`) written by
both `extract.mjs` and `sync-strava.mjs` from the shared `WORKOUTS_HEADER`.

- The three trailing columns are Strava-only (export rows leave them empty).
- Every reader is POSITIONAL and tolerates shorter rows, so a file mixing 9-, 11- and 12-column rows
  reads fine: an absent column is null.
- Re-running `node data/apple-health/extract.mjs` (needs `export.xml`) re-emits every export row at
  full width.
- Rollout for a new Strava field (e.g. `elevation_m` from `total_elevation_gain`):
  1. rebuild the ingest image (`docker compose up -d --build loop-ingest`; without it
     `/export/strava` lacks the field and the column stays blank);
  2. `npm run sync:strava`;
  3. `npm run generate`.
