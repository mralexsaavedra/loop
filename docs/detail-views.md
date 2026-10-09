# Detail views

The full-screen drill-down sheet behind every card.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Detail views — tap any card, see every day

WHOOP's drill-down, honest version: a tap on a card opens a full-screen sheet (a large centred panel
from 900px) with that metric's history. No new score: the sheet only shows the card's own series.

- **Data** — `lib/detail/detail.mjs` `buildDetail(extractDir, { sex })` bakes ONE global `DETAIL` (in
  `components/DetailSheet.astro`, with `I18N_DETAIL` from `web/src/i18n/detail-templates.mjs`):
  `{asOf, days: 365, metrics: {<key>: {kind, dir, dec, start, v, …}}, sessions}`. Each metric = an ISO
  `start` + a `v` array, one slot per calendar day of the last 365 days ending at the newest data date
  (never the build clock, so builds stay byte-identical), `null` = no data that day (never 0), rounded to
  the card's precision. Keys (`DETAIL_KEYS`): sleep, recovery, hrv, rhr, respiratory, wristTemp,
  walkingHr, vo2max, fitnessAge, steps, exercise, distance, flights, energy, weight, bodyfat, lean, waist,
  workouts, load-gym, load-run, load-bike; a key without data is simply absent (the view shows its empty
  state). `fitnessAge` = each VO2max day mean through `lib/score/fitness-age.mjs` (sparse, `dir` −1,
  baked only with the profile's `sex`), with `lo` / `hi` = the reference curve's clamp bounds (25 / 75):
  the sheet's headline and the My dashboard row read a value at a bound as "≤ 25" / "≥ 75" (that age
  or beyond; the chart and the calendar keep the clamped number).
  Same readers and rules as the cards: HRV / RHR / respiratory / wrist temp / sleep = the monitor's
  clamped day median (`monitor.mjs` `monitorDaily`, partial newest HRV day dropped) with the monitor's
  personal band (`signalBand`, median ± 2 scaled MADs over the 42 days before the newest day; walking
  HR gets the same kind of band); daily totals keep the Salud floors (a < 200-step day is missing) and
  get a "usual day" band = p25–p75 of the 90 days before the newest (`quartileBand`); energy = basal
  (sane band) + active, with both parts (a day missing either part is missing, never basal alone —
  the Salud expenditure card uses the same rule) + `roll`, the card's calendar 7-day rolling average;
  weight = day means + `roll` (the Salud card's calendar 7-day rolling average, only on reading days)
  + `latest` (the card's latest raw reading); body fat / lean mass = the most recent scale only AND
  only its last `BODYCOMP_WINDOW` days (`windowDays`), so a scale-switch artefact never shows; sleep
  also carries bed / wake times and the 7.5 h target, and per night (`lib/score/sleep.mjs`) `perf`
  (sleep performance %, asleep / target × 100 capped at 100), `eff` (efficiency %, asleep / in bed,
  only where `inbed_h` exists), `cons` (consistency minutes, `recovery.mjs` `sleepConsistency`) and the
  stage hours `rem` / `deep` / `core` / `awake` / `inbed` — an array no night has (an extract older
  than the stage columns) is left out; `recovery` = for each day, the composite the
  dial showed THAT morning (`recoveryFromInputs` with the inputs cut at that day, its own baseline, not
  today's) + that day's 7-day trend (`t7`), `cut` = `DAY_BAND_CUTOFF`, `cutTrend` = `BAND_CUTOFF`, and
  `head` = the dial's own headline (`recoveryHead`, from the same full-input `recoveryFromInputs`
  call: mode today/trend, date, value, band, sleep, trend {value, band, dir}); `workouts` = minutes
  per day after the display rule, zero-filled (rest) from the first session up to `asOf` (a day after
  asOf is missing); `load-<m>` = RE per day after the load rule (`null` = sessions without RE), with
  the card's typical day (the same `typicalDay` value the load dial puts at its ring midpoint),
  calendar cuts at 0.5 / 1 / 1.5 typical days, and the dial's `gate` (null / `baselineBuilding` /
  `fewDays`) + `last` scored session; `strain` (kind `strain`, only when day strain is calibrated,
  `lib/score/strain.mjs`) = the day strain 0–21 of every day with all-day heart rate (one K for every
  day), calendar shades at 10 / 14 / 18 (the reference's light / moderate / high / all-out bands on our
  scale), bars in the chart, and the day panel lists the day's sessions; its deep-dive page (key
  `strain`, client/deepdive.js) is the hero ring = the day's strain with the Inicio dial's own arc,
  contributors = the day's activities + "all day (outside workouts)", each with its share of the
  strain (∝ its load; from `SCORES.strain.days`, the last 14 days), the insight = the band sentence
  and the usual day (median of the prior 30) in one paragraph; ⓘ = the formula, the
  sources, this owner's K / p95 / full days / max HR and "our estimate"; the 7-day strain bars; then
  "Relative Effort by modality" links to the `load-<m>` pages. It follows the day it was opened on
  (`X.sel`); `stress` is NOT a DETAIL key: its series is `SCORES.stress.metric` (kind `stress`, the
  day averages 0–3 dense from the first scored day, `lib/score/stress.mjs`), which detail.js
  `metric('stress')` reads when DETAIL has no such key (copy in `I18N_DETAIL.metrics.stress`, hash
  `#detail/stress[/<date>]`, no host tab). Calendar / chart states `slow` / `smedium` / `shigh` (< 1 /
  1–2 / ≥ 2, light blue / teal / orange), the day panel = "Day average" + band + the minutes per band
  (when the day is in `SCORES.stress.days`). Its page (key `stress`, client/deepdive.js `stressPage`)
  follows the day it was opened on: the hero = a 0–3 half gauge in the three band colours with a
  marker at the latest scored hour, its value, band word and "Latest hour 14:00" (no value → an empty
  gauge + "No data"); "Hour by hour" = an SVG curve over 00:00–24:00 with the three bands as faint
  stripes, one dot per scored hour in its band colour (joined while consecutive; gaps = sleep, workouts
  or too few readings); "Time in each band" = a stacked bar + one row per band; the insight = the day
  average + band, the band with most time and "an estimate from heart rate only" (under the minimum
  hours: "only n waking hours could be scored"); ⓘ = the formula, how hours are scored, that day's
  resting HR / max HR / minimum hours, the limits (no HRV, no hourly steps, so movement raises it) and
  "not a medical measure". `energy-bank` is not a DETAIL key either (`energy` is the expenditure
  metric): its series is `SCORES.energy.metric` (kind `bank`, each day's latest level 0–100, dense from
  the first valued day of the last 14, `lib/score/energy.mjs`), read by detail.js `metric('energy-bank')`
  (copy `I18N_DETAIL.metrics['energy-bank']`, hash `#detail/energy-bank[/<date>]`, no host tab).
  Calendar / chart states `good` / `mid` / `bad` (≥ 67 / 34–66 / < 34); the day panel = "Latest level"
  + band + start / low. Its page (client/deepdive.js `energyPage`) follows the day it was opened on:
  the hero = a 0–100 half gauge filled to the latest level in its third's colour, the band word and
  "Latest hour 23:00"; "Through the day" = an SVG curve over 00:00–24:00 on the three thirds as faint
  stripes, from the wake level, one step per hour end (a flat stretch = hours without data), blue dots
  on workout / heart-rate-load hours (load drain ≥ 5), orange dots on high-stress hours (≥ 2); "What
  moved it" = start (recovery % at wake), being awake, stress, heart-rate load, calm hours, low; the
  insight = start → latest level, the biggest drain and "our own model, an estimate" (no value: why —
  no recovery % / no wake time); ⓘ = it is OUR model (not validated), the formula with the baked
  constants (`SCORES.energy.C`), the hour rules, the inputs (K, max HR) and the limits. `nutrition` is a `VIEW_METRICS` key (`lib/detail/detail.mjs`):
  never baked, the page scores it at view time (`client/nutri-score.js` `HCNutriScore.metric()`: kind
  `nscore`, `dir` 1, one value per day of the last 90 ending at the viewer's today, `days` = the
  per-day results, `bands` = `NSCORE.bands`), because each day's target follows the viewer's CURRENT
  goal (`HCNutri.targetFor`, like Constancia); detail.js `metric('nutrition')` reads it, and it joins
  the trend picker once a day is scored. Host tab `nutricion` (`DETAIL_TAB`), copy
  `I18N_DETAIL.metrics.nutrition`, hash `#detail/nutrition[/<date>]`. Calendar / chart states `good` /
  `mid` / `bad` (≥ 85 / 60–84 / < 60); today is `partial` ("so far": neutral, never in the period
  average, like a daily total); the day panel = the score (+ "So far today"), each component's eaten /
  target and points (a left-out one: "—" + why), then the notes that apply (a macro missing, a main
  meal unlogged, a rest day assumed from sleep). The generic trend view, no deep-dive page. `sessions` = one entry per date + modality after
  `mergeSameDay` DISPLAY_RULE (minutes, km, elevation, avg HR, RE, parts, source; the source is the
  precedence family, so "Apple Watch de <name>" is written "Apple Watch"), plus, when
  `workout-zones.csv` has that date + modality (`lib/training/zones.mjs` `readWorkoutZones`), `z` =
  seconds in HR zone 0–5 summed over its Strava activities (left out when none or all zero) and `hx` =
  their highest max HR; `zoneMax` = `{hr, src}`, the max HR the zones were cut with and its source
  (`profile` / `observed`), absent without the file. Size: ~26 KB on the demo,
  ~62 KB on a real year; the whole feature adds ~71 KB to the demo page.
- **Openers** — `HC.detailAttrs(key, date?, {plain?})` writes `data-detail` [+ `data-date`] + a
  button role and tab stop (`plain`: data attributes only, for a real `<button>`, an SVG cell or a
  table row). One delegated click / Enter / Space listener in `web/src/client/detail.js` handles every
  opener. On a PAST day of Inicio (the top bar's day stepping, `docs/home-tab.md`) every Inicio
  opener — the dials, the collapsed row, the stress / HRV tile, "My day" rows — carries THAT day as `data-date`,
  so its sheet opens with that day selected (calendar, chart selection and the day panel, which a
  dial page scrolls to); the dial page's hero ring and insight card stay the latest night / today (the
  dial's own baked values; the strain page instead follows the day it was opened on). Map: sleep dial → sleep; recovery dial → recovery; the strain dial → strain;
  each load dial (the fallback) → its `load-<m>`; Salud monitor
  rows → their signal; the stress monitor tile → stress (its HRV fallback → hrv); the "My day" outlook bar (advice) → recovery;
  activity rows → that day (sleep, or `load-<m>` / `workouts` for "other"), the programmed-session row
  → the registered `hoy-session` view (client/training-today.js); the "Tonight" card → the registered
  `tonight` view (the bedtime rule + a button to the sleep sheet, client/home-week.js); the "My plan"
  rows → sleep / workouts; each "My dashboard" row → its metric, and "Customize" → the registered
  `dash-edit` view (client/home-dash.js; its buttons re-open the view through `HCDetail.open` with
  `focus` on the control just used). These two scripts run in the end-of-body list BEFORE `detail.js`,
  so the views exist when it reads the hash; `#tonight` / `#dash-edit` deep-link like `#hoy-session`
  (both are `VIEW_TAB` → `home` in lib/nav/tabs.mjs, baked as `NAV.viewTab`, so core.js shows Inicio
  underneath instead of rewriting a hash it does not know);
  every Salud metric row → its metric (expenditure → energy; the sleep consistency rows → sleep); Nutrición → Balance's avg burn row → energy (avg intake and deficit / surplus open nothing: no intake series is baked); the Salud recovery card → a History
  button (the card holds a `<details>` fold, so it is not itself a button); Entreno load cards →
  `load-<m>`; the Activity card's total and calendar → workouts (a day cell → that day; its W / M / 6M
switch is outside every opener); run / ride rows →
  that day in `load-run` / `load-bike` (the whole list row is the button). Every
  opener shows the same chevron (the one `.chev` look, `base.css`), pointer, focus ring and ≥ 44px target (`web/src/styles/detail.css`);
  the chevron is centred on a one-line opener and pinned to the header row (top-right) of a tall card.
- **Dial deep-dive pages** (`web/src/client/deepdive.js`, inlined right before `detail.js`, which calls
  `window.HCDeep.render(key, m, end, X)` with its own helpers `X`, so both files read one set of rules
  and copy): the sheets of the three Inicio dials — `sleep`, `recovery`, `load-<m>` — are laid out as
  one page, top to bottom:
  1. **Header** "‹ TODAY ⓘ" — the ONE sheet header every detail shares (`HC.sheetHead`,
     `client/util.js`; a `44px | 1fr | 44px` grid): the back arrow IS the sheet's close button
     (`data-dt-act="close"`, focus lands on it, Esc / Back still work); centred and uppercase, the DAY
     the page shows (`h2.sh-title#dt-title`): "Today" (`deep.today`, es "Hoy") or its date ("Mon 28
     Sep", `HC.fmtDate`) — strain = the day it was opened on (Inicio's day stepping), the others = the
     view end (the viewer's today, or the stale data's last day: the day their hero describes). The
     metric name moves into the ring (its uppercase label) and stays the dialog's label for screen
     readers (`sheetHead({sr})`: a `.sr-only` "Recovery · " before the day); ⓘ (`.sh-info`, the same SVG icon as the
     Salud headers' `HC.infoBtn`, `data-dt-act="info"`, `aria-expanded` / `aria-controls="dd-info"`)
     toggles the long-notes block in place, collapsed by default. A sheet without notes puts an equal
     44px spacer (`.sh-pad`) there so the title stays centred.
  2. **ⓘ block** (`#dd-info`, hidden): the band / cut rules (`bandText`: the recovery day and trend
     cuts, the per-day note, the sleep band, the typical day), the recovery % mapping (`rec.pctNote`)
     and the night's SD line ("Vs your 42-day baseline: +1.1 SD · at baseline", `rec.sdLbl`), both only
     when the hero shows a %, the load ring scale + sessions-without-effort note, and the sleep formulas
     (`deep.sleepNotes`: performance = asleep ÷ need × 100 capped at 100 with need = the target,
     efficiency = asleep ÷ in bed, consistency minutes, what the stages are).
  3. **Hero ring**: 260 px (≈ 67 % of a 390 px phone; never wider than the sheet), the dial's OWN
     baked arcs (`DIALS`, so it can never disagree with Inicio) drawn with a 7.5-unit stroke (of the
     120-unit viewBox), from 12 o'clock clockwise, round caps, on `--track`; inside: the value (D-DIN,
     56–70 px, 70 px on a phone) + small
     unit + the uppercase label. Recovery shows the dial's % (`DIALS.recovery.pct`, when it scores the
     same night as `head`) with its % band colour, else the SD value. Sleep shows the dial's sleep
     performance % (`DIALS.sleep.pct`, label "SLEEP PERFORMANCE"), else last night's hours.
     Sleep only: a **stages bar** AFTER the insight card (`.dd-stages`, titled "Sleep stages", so the page
     reads dial → contributors → insight like the reference): one stacked horizontal bar of
     the night — awake / REM / core / deep (+ the Asleep-unspecified remainder when ≥ 0.05 h), widths by
     hours — in shades of `--sleep` (REM lighter, deep towards `--link-end`, awake `--faint`), and a
     legend with each stage's hours and, for the asleep stages, its % of the time asleep. No stage
     arrays in `DETAIL` (older extract) or no stages that night → no bar. Colour: recovery = ONE state colour, its band (`--good` / `--mid` /
     `--low`), sleep = `--sleep`, load = `--strain` with a white tick at the typical day
     (`DIALS.load.tick`). Off states show the dial's word in an empty ring (recovery "No baseline",
     load "Building" / "No session yet" / "No effort data"; there the typical-day tick dims to a faint
     hairline, `.dd-off .dd-tick`); stale data (> 3 days) greys it like the
     dial. No `DIALS` global: the number still shows (from `DETAIL`), the ring has no fill.
  4. **Contributors card** (a caret notch points up to the ring; ≤ 4 rows: icon + UPPERCASE name +
     value + marker): the dial's own inputs, each "today vs the prior 30 days" (`HCDeep.compare`):
     today's value vs the middle half (p25–p75) of the values on the 30 days before it — the Salud
     totals' "usual day" idea; fewer than 7 prior values → the value without a marker. Above / below
     → ▲ / ▼ (small ≈ 8 px triangles), teal (`--up`) when better and orange (`--down`) when worse by the metric's good
     direction, grey for a metric without one (bedtime, wake time, load); inside → a grey dot; the
     words ("better than usual"…) are screen-reader text. A legend pill "▲▼ Today vs prior 30 days"
     closes the card when a marker shows. A row without a value that day is hidden (never 0 or a
     dash). Rows: recovery = the reference's four on the night it scores (`head.date`), display only
     (the composite and its weights are unchanged) — HRV, resting HR, respiratory rate (`DETAIL`
     `respiratory`; context, NOT a composite input; no good direction, so a grey ▲ / ▼ outside the
     usual range and a grey dot inside; the ⓘ says so, `deep.respNote`) and sleep performance %
     (the sleep metric's baked `perf`, replacing hours of sleep); a missing one is hidden, so no
     respiratory reading = 3 rows. Like the hero, they stay on the headline night under day stepping
     (the day panel below opens on the stepped day); sleep = hours vs need as h:mm ("6:54 / 7:30", ▲▼ on the hours), efficiency %
     (`DETAIL` `eff`), consistency minutes (`cons`, lower = better) and REM + deep ("3:06 · 41%", h:mm
     · % of asleep); a missing one is hidden and bedtime (an after-midnight bedtime counts as late
     evening, 00:30 = 24.5) and wake time fill the card up to four rows; load = today's RE (only on a day with RE, compared with the
     prior 30 days' training days only), the 7-day vs 42-day trend (`DIALS`), the sessions of the
     last 7 days, the typical training day.
  5. **Insight card** (`--ground` fill inside a 1.5 px teal → indigo stroke, `--insight-a/b`): ONE
     paragraph of 2–3 plain sentences built only from numbers the page already shows (`deep.prose`) —
     recovery: Inicio's outlook sentence first (`window.HCAdvice`, it already carries the 7-day trend),
     then "Last night your recovery was high." (the % band word ONLY when the hero shows a %, else the
     SD band "at your baseline" — the SD line lives under ⓘ, so the card never shows two different
     bands; "On Mon 28 Sep …" for an older night; + "There is no sleep data for that night."); without
     the advice, "Over the last 7 days it has been steady (+0.5 SD vs your baseline)."; no recent
     complete night → the 7-day trend sentence; sleep: "Last night you slept 7:32, +0:02 vs your
     7:30 target." + the contributors that were worse than usual ("Sleep consistency was worse than
     your usual.", or "Every contributor was at or better than your usual." when they carry markers);
     load: the day ("Today's Relative Effort is 28; your typical training day is ~42.", or no session /
     the last one) + "Over the last 7 days your load has been steady (−6% vs your 42-day average)."
     (baked `DIALS`; none or gated → no trend sentence; the ring scale moved under ⓘ); a gated modality
     shows its gate copy; strain: the band sentence + "Your usual day is 12.4 (median of the prior 30
     days)." (the scale's calibration is in ⓘ). Then the page's own CTA (`deep.ctas`: "SEE MY
     RECOVERY TREND →", sleep / load / strain likewise; the stress and energy pages keep "VIEW
     TREND"; `data-dt-act="trend"`, a button: scrolls to the period block and focuses
     the pressed W / M / 6M / 1Y button). It is the shared CTA link (`HC.cta`, `.cta`; design-system.md →
     Components); here its text is the `--link` → `--link-end` gradient (blue →
     violet) clipped to the glyphs, solid `--link` where `background-clip: text` is unsupported: on
     `--ground` both ends pass AA for small text (8.29 / 4.61), on a card the violet end would not
     (3.91), so the gradient only ever sits on the insight card (`tokens-contrast.test.mjs`).
  6. **Weekly trends** ("Weekly trends" title, one card per input): 7 bars for the 7 days ending at
     the PAGE's day (`weekEnd`: recovery = its headline night, sleep = the dial's night, strain = the
     day it was opened on — each only when within the last week —, load = the view end; `HCDeep.weekOf`),
     the value on top, the weekday letter under each bar, that last column lighter (`.dd-now`) and
     carrying the hero's value (no empty "today" column while the newest night is yesterday's); a day
     without data = "—" and no bar. Recovery: each night's recovery % — the number the dial showed that
     morning (`DIALS.days[].recovery.pct`, lib/score/days.mjs; the newest from `DIALS.recovery`) — bar
     = % of 100, bar AND value in its % band colour (≥ 67 `--good`, ≤ 33 `--low`, else `--mid`,
     `.dd-v-*`); a week with no % at all (too few prior nights, no `DIALS`) falls back to the composite
     per day on the dial's −3…+3 scale in its day band's colour; then HRV and resting HR (`--trend`) and sleep (`--sleep`); sleep:
     hours, performance % (bar = % of 100) and REM + deep hours when `DETAIL` has them (`--sleep`); load: RE per day and the modality's minutes per day from the sessions
     (`--strain`; a day after the data's `asOf` is unknown, not rest). Bars are proportional to the
     week's largest value.
  7. The rest of the sheet below: the period block + chart, then the month calendar and the day panel
     FOLDED behind one "HISTORY · Calendar and day detail ⌄" row (`detail.js` `foldHtml`, a
     `.dd-fold` button with `aria-expanded` / `aria-controls="dd-hist"`, `data-dt-act="hist"`,
     toggled in place without a re-render; collapsed by default, so the page reads like the reference;
     the last state is remembered for the page session — `sessionStorage` `hc-dd-hist`, this load only
     where storage is refused). Every deep-dive page folds (sleep, recovery, strain, load, stress,
     energy); the trend view keeps its calendar open. A DATED open (a run /
     ride row, a timeline row, a stepped Inicio day: `open(key, date)`) starts with the fold open and
     scrolls the sheet to the day panel
     (`[data-dt-part="day"]`, `block: start`) after focus lands on the back button; an undated open
     (the dial) starts at the top. A run day's panel ends with the watch running dynamics of that day
     (`.dt-dyn`, "Running dynamics: 276 W · GCT 242 ms · Osc. 8.3 cm · Stride 1.14 m", read from
     `HEALTH.running`; a field not recorded is left out, none → no line): the Entreno run row no
     longer prints them. A session with HR zones (`z`) also gets the zones block under its meta line
     (`zonesHtml`: "HEART-RATE ZONES" + avg / max HR, rows ZONE 5…0 with the bpm range from
     `zoneMax`, % of the zoned time, m:ss and a bar in the zone colour, and an ⓘ `<details>` with the
     model and the max HR; docs/training.md "Per-workout HR zones"); no `z` → no block.
  The copy is the dial's own (`score-templates.mjs` via `I18N_DETAIL.rec` / `load` / `deep`).
- **The sheet** (`detail.js`, one renderer, per-view try/catch with a message fallback, no NaN ever
  printed): header = the shared header above titled "‹ TREND VIEW" (`trend.title`, es "Tendencia"; the
  metric is the dialog's screen-reader label, `sheetHead({sr})`; no ⓘ: a spacer), then the **metric
  picker** — a native `<select>` dressed as a pill with a ⌄ (`.dt-metric`, `data-dt-pick="metric"`)
  listing every baked metric with copy EXCEPT the dial pages (sleep, recovery, strain, `load-<m>`: their
  own layout, reached from the dials); a change re-opens the sheet on that metric with the same range
  and replaces the URL (no new history entry; an unknown value is ignored) — then the latest value +
  date, the band / target / typical day in words (the dial pages above replace this header). The header NEVER contradicts the card it opens from; the
  recovery chart's zone is the trend band at ±`cutTrend`, the daily points use the day band; weight / energy = the cards'
  7-day rolling average (`roll`, also the chart line) with the latest reading / day underneath; a
  daily total's newest day, when it is the viewer's today, is "Today, in progress" (neutral
  `partial` colour in the header, chart and calendar, never compared with the median); training time
  shows the newest day in range ("Rest" on a rest day). The band note says colours are the CURRENT
  range (static, as of the newest day), except recovery, scored per day; a signal / total / sleep /
  recovery metric whose own last day is > 3 days before the view end says so. The trend view: a
  small right-aligned W · M · 6M · 1Y switch (dark 28 px squares, the pressed one grey, each with a
  44 px-tall hit area; 7 / 30 / 182 / 365 days, `RANGES`; opens on M; es S · M · 6M · 1A), under it the
  window row "‹ 23 Sep – 29 Sep, 26 ›" (`trend.win`): ‹ › (the shared `.nav-btn` + `.chev`, like the
  calendar's month ‹ ›; design-system.md → Components) step the window back / forward by its own
  length (`state.shift` whole windows back from the view end; › disabled at today, ‹ disabled once the
  previous window would end before the metric's first day; a new range or metric starts at today;
  the chart, the average and its delta follow the window, the calendar and the day panel do not), then
  "AVERAGE" = the mean of the days with data in the window (a daily total's partial today left out; a
  missing day skipped, never 0) and a delta pill vs the previous window of the same length (▲▼ + % —
  absolute in sd for recovery — `--up` / `--down` by the metric's good direction, neutral • when
  within 1 % / 0.05 sd or for a metric without a direction) on its own line below, then ONE plain
  sentence (`trend.sent`: "Your average Resting HR this week was 53 bpm, about the same as the week
  before (53 bpm)."; higher / lower / about the same by the pill's rule, no judgement — the pill's
  colour carries good / bad; a change that rounds to two equal numbers gets one more decimal). A
  window longer than the data is clamped to the metric's first day (the toggle stays; chart and
  average start there, the pill says "Data since <date>"); a previous window that lies wholly before
  the data, or starts before it and holds data on fewer than half its days → "No earlier period to
  compare"; one that starts before the data but holds data on at least half its days still compares
  (a 6-month view on 7+ months of data) (`periodStats`, exposed as `HCDetail.periodStats(key, end,
  days)`). The latest value and the band / target words no longer lead the view: they sit under the
  header's ⓘ (`#dd-info.dt-info`, collapsed; the window's average leads and the chart labels the
  newest value). The chart sits on the sheet's ground (no card), its shaded band named once top-right
  ("TYPICAL RANGE", `trend.typical`; recovery "BASELINE RANGE", `trend.baseline`; no legend swatch for
  it). An inline SVG chart (points for signals, bars for totals and load, the
  7-day average line that breaks where fewer than 3 of 7 days have data, the band shaded, target /
  typical dashed; a missing day is a gap; a points chart longer than 60 days (6M, 1Y) draws a dot
  only for the days OUT of the range — beyond recovery's day cut, outside a signal's / sleep's band —
  and leaves the rest to the 7-day line, its key reading "Days out of range" (`chartKey.outside`), so
  red / green dots never saturate the chart (a metric without a band keeps every dot); the window's newest value ringed and labelled, `.dt-last` /
  `.dt-lastv`; in W every metric but recovery is 7 bars from 0 with each value on top (`.dt-bv`) and
  "Thu / 9" under each bar (`.dt-wdays`) instead of the from / to dates, no 7-day line; labels are HTML
  over the SVG's box `.dt-svg`) with a Y axis: three round, evenly spaced values (step 1 / 2 /
  2.5 / 5 × 10^k; bars from 0) as faint grid lines (`.dt-grid`) and labels in a 36px left gutter
  (`.dt-yax`, HTML so the text never scales with the SVG); the range covers the ticks plus 12 %
  headroom, so an out-of-range day never sits on the chart's edge; under the chart, "DAYS IN THIS
  PERIOD" (`breakdownHtml`, `trend.brk`): one stacked horizontal bar of the window's days with data by
  calendar state — the legend's states, order and tints (better / in / worse than your range, above /
  at / below baseline, the sleep, stress, energy and nutrition bands; today in progress and missing
  days left out) — and one row per state with its count ("7x", a state with none says "0x" and has no
  segment); it follows the window (range + ‹ ›); "LEARN MORE →" (a `.cta`, `data-dt-act="learn"`) opens the
  header's ⓘ notes (never closes them) and scrolls them into view. Training volume / load / strain
  (four shades of one colour), sparse readings and a metric without a band get none. A Monday-first month calendar
  (es/en weekday letters) with prev / next bounded by the baked range, each day tinted by its state
  (good / mid / bad tiles: the state hue at 16 % with a 40 % inset ring, `--good-rgb` / `--mid-rgb` /
  `--low-rgb`, never a saturated block) by `dayState`: signals vs
  their band by good direction (good / normal / bad; change signals `watch`), totals likewise (energy:
  neutral hi / lo), sleep good ≥ target / mid / bad below the band, recovery by the day cut, training
  volume in four `--strain` shades, sparse readings "measured", missing = empty; the picked day below
  (default: the newest day with data): overnight views → the whole night (asleep h vs target, bed –
  wake, recovery, HRV, RHR, respiratory, wrist temp; sleep adds that night's stages "REM · deep ·
  core · awake" hours and efficiency %, or a no-stages note when the night has none), totals → value vs the median (energy + active / basal), sparse → vs the previous reading,
  workouts / load → that day's sessions. The view ends at the VIEWER's today, or at `DETAIL.asOf` when
  that is > 3 days old (with a note) or ahead of the clock.
- **Modal + history** — `#detail` (role="dialog", aria-modal, labelled by the title) renders in
  `layouts/Plan.astro`'s `overlay` slot OUTSIDE `.wrap`, which goes `inert` while open (page scroll
  locked); focus moves to the close button, Tab stays inside, Esc / the close button / a tap on the
  backdrop close it and focus returns to the opener (none — a deep link or a forward navigation —
  → the visible tab's heading, given `tabindex="-1"`); `.wrap` also gets `aria-hidden` while open
  (fallback where `inert` is unsupported). A control whose re-render removed or disabled it hands
  focus to the close button. Opening pushes `#detail/<metric>[/<date>]` (picking a day replaces it),
  so browser Back closes the sheet and lands on the tab hash entry underneath (`#nutricion`, see "Tabs
  and sections"); closing a deep-linked sheet (no entry of ours) replaces the URL with the current tab
  hash (`window.HCNav.hash()` from core.js; '' without it), and core.js has already shown the deep
  link's host tab underneath (`#detail/sleep` → Salud), so it closes onto `#health`; a page opened with that hash opens the view — only for an OWN key
  of both `DETAIL.metrics` and the copy (no `constructor`), and a date must round-trip
  (`HC.isoDate` rejects 2026-02-31); a bad or out-of-range date falls back to the default day and the
  URL is replaced to match. A re-open while the close's `history.back()` is in flight (`pendingBack`)
  writes no history until that popstate arrives, which then pushes the new sheet's entry instead of
  closing it. A frame that refuses history writes (sandboxed artifact) still gets the sheet, and
  closing then never calls `history.back()` (and leaves no lock / inert / aria-hidden behind). The
  7-day line is computed once per (metric, range); a day tap re-renders only the calendar and the day
  panel and moves the chart's selection rect. The opener delegation ignores a click / Enter on a
  control inside a card (a, button, summary, input, select, textarea, `role="button"`) other than the
  opener itself.
