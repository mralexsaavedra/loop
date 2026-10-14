# Detail views

The full-screen drill-down sheet behind every card.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

A tap on a card opens a full-screen sheet (a large centred panel from 900px) with that metric's history.
No new score: the sheet only shows the card's own series.

**On this page**

- [Files](#files)
- [Registered views](#registered-views)
- [Data: the `DETAIL` bake](#data-the-detail-bake)
- [Openers](#openers)
- [Dial deep-dive pages](#dial-deep-dive-pages)
- [Trend view](#trend-view)
- [Modal & history](#modal--history)

## Files

Classic scripts inlined in this order right after `deepdive.js` (`web/src/client/manifest.mjs`):

| File | Role |
| --- | --- |
| `detail-state.js` | `window.HCDetailState(T, D)`: data / state helpers, no DOM — series access, the view end, the W / M / 6M / 1Y windows + `periodStats`, the cached 7-day line, value formatting, `dayState` + the legend's states (`detail-state.test.mjs`) |
| `detail-chart.js` | `window.HCDetailChart(T, DS)`: the trend chart's SVG + key, `selX` from the geometry it records in the sheet state's `geo`, and the window's breakdown bar (`detail-chart.test.mjs`) |
| `detail.js` | the shell: header, period, calendar and day panel markup, open / close, focus, history, deep links and the public `window.HCDetail` |

- `detail.js` builds one `HCDetailState` + one `HCDetailChart` per page and hands the state helpers to
  `deepdive.js` (`X`).
- Tests load the set through `DETAIL_SOURCE` (`web/test/client-util.mjs`).

## Registered views

- A sheet that is not a `DETAIL` metric (profile, onboarding, tonight, dash-edit, hoy-session, food-add,
  journal, journal-insights) registers with `HC.registerView(<key>, {title(), render() → {head, body,
  info?}})` (`info`: notes collapsed under the shared header ⓘ, `#dd-info`, e.g. Tonight's rule).
- `client/util.js` is the ONLY writer of `window.HCViews` (the registry appears with the first view);
  `detail.js` reads it through `HC.view(<key>)` (own keys only, else null).
- Registering a key again replaces the view (a re-render or API reload of its own script; never a runtime
  throw).
- Ownership is checked statically: `web/src/client/util.test.mjs` scans the client scripts and fails when
  a key is registered by two files, when a `registerView` key is not a string literal, or when any script
  other than util.js writes `HCViews` directly.

## Data: the `DETAIL` bake

`lib/detail/detail.mjs` `detailFrom(inputs, { sex })` (a thin mapper of the build's one
`lib/extract/read.mjs` `readExtract` onto the pure `detailFromInputs`) bakes ONE global `DETAIL` (in
`components/DetailSheet.astro`, with `I18N_DETAIL` from `web/src/i18n/detail-templates.mjs`):

```
{asOf, days: 365, metrics: {<key>: {kind, dir, dec, start, v, …}}, sessions}
```

- Each metric = an ISO `start` + a `v` array, one slot per calendar day of the last 365 days ending at the
  newest data date (never the build clock, so builds stay byte-identical); `null` = no data that day
  (never 0); rounded to the card's precision.
- Keys (`DETAIL_KEYS`): sleep, recovery, hrv, rhr, respiratory, wristTemp, walkingHr, vo2max, fitnessAge,
  steps, exercise, distance, flights, energy, weight, bodyfat, lean, waist, workouts, load-gym, load-run,
  load-bike. A key without data is absent (the view shows its empty state).
- Size: ~26 KB on the demo, ~62 KB on a real year; the whole feature adds ~71 KB to the demo page.

### Per-metric rules

Same readers and rules as the cards.

| Metric(s) | Series and extras |
| --- | --- |
| hrv, rhr, respiratory, wristTemp, sleep | the monitor's clamped day median (`monitor.mjs` `monitorDaily`, partial newest HRV day dropped) with the monitor's personal band (`signalBand`, median ± 2 scaled MADs over the 42 days before the newest day); walkingHr gets the same kind of band |
| daily totals | the Health floors (a < 200-step day is missing) + a "usual day" band = p25–p75 of the 90 days before the newest (`quartileBand`) |
| energy | basal (sane band) + active, with both parts (a day missing either part is missing, never basal alone — the Health expenditure card uses the same rule) + `roll`, the card's calendar 7-day rolling average |
| weight | day means + `roll` (the Health card's calendar 7-day rolling average, only on reading days) + `latest` (the card's latest raw reading) |
| bodyfat, lean | the most recent scale only AND only its last `BODYCOMP_WINDOW` days (`windowDays`), so a scale-switch artefact never shows |
| fitnessAge | each VO2max day mean through `lib/score/fitness-age.mjs` (sparse, `dir` −1, baked only with the profile's `sex`); `lo` / `hi` = the reference curve's clamp bounds (25 / 75): the headline and the My dashboard row read a value at a bound as "≤ 25" / "≥ 75" (the chart and calendar keep the clamped number) |
| sleep | also bed / wake times and the 7.5 h target, and per night (`lib/score/sleep.mjs`) `perf` (sleep performance %, asleep / target × 100 capped at 100), `eff` (efficiency %, asleep / in bed, only where `inbed_h` exists), `cons` (consistency minutes, `recovery.mjs` `sleepConsistency`) and the stage hours `rem` / `deep` / `core` / `awake` / `inbed` — an array no night has (an extract older than the stage columns) is left out |
| recovery | per day, the composite the dial showed THAT morning (`recoveryFromInputs` with the inputs cut at that day, its own baseline, not today's) + that day's 7-day trend (`t7`); `cut` = `DAY_BAND_CUTOFF`, `cutTrend` = `BAND_CUTOFF`; `head` = the dial's own headline (`recoveryHead`, from the same full-input `recoveryFromInputs` call: mode today/trend, date, value, band, sleep, trend {value, band, dir}) |
| workouts | minutes per day after the display rule, zero-filled (rest) from the first session up to `asOf` (a day after asOf is missing) |
| `load-<m>` | RE per day after the load rule (`null` = sessions without RE), the card's typical day (the same `typicalDay` value the load dial puts at its ring midpoint), calendar cuts at 0.5 / 1 / 1.5 typical days, and the dial's `gate` (null / `baselineBuilding` / `fewDays`) + `last` scored session |
| strain | kind `strain`, only when day strain is calibrated (`lib/score/strain.mjs`): the day strain 0–21 of every day with all-day heart rate (one K for every day); calendar shades at 10 / 14 / 18 (the reference's light / moderate / high / all-out bands on our scale); bars in the chart; the day panel lists the day's sessions |

### Metrics outside `DETAIL`

detail-state.js `metric('stress')` / `metric('energy-bank')` / `metric('nutrition')` reads these when `DETAIL`
has no such key. None has a host tab except
`nutrition`.

| Key | Series | Copy / hash | Calendar & chart states | Day panel |
| --- | --- | --- | --- | --- |
| `stress` | `SCORES.stress.metric` (kind `stress`, day averages 0–3, dense from the first scored day, `lib/score/stress.mjs`) | `I18N_DETAIL.metrics.stress`, `#detail/stress[/<date>]` | `slow` / `smedium` / `shigh` (< 1 / 1–2 / ≥ 2; light blue / teal / orange) | "Day average" + band + the minutes per band (when the day is in `SCORES.stress.days`) |
| `energy-bank` (`energy` is the expenditure metric) | `SCORES.energy.metric` (kind `bank`, each day's latest level 0–100, dense from the first valued day of the last 14, `lib/score/energy.mjs`) | `I18N_DETAIL.metrics['energy-bank']`, `#detail/energy-bank[/<date>]` | `good` / `mid` / `bad` (≥ 67 / between / ≤ 33, the recovery `pctBand` via `HC_BAND`) | "Latest level" + band + start / low |
| `nutrition` (`VIEW_METRICS` in `lib/detail/detail.mjs`) | never baked: scored at view time by `client/nutri-score.js` `HCNutriScore.metric()` (kind `nscore`, `dir` 1, one value per day of the last 90 ending at the viewer's today, `days` = the per-day results, `bands` = `NSCORE.bands`), because each day's target follows the viewer's CURRENT goal (`HCNutri.targetFor`, like Constancia) | `I18N_DETAIL.metrics.nutrition`, `#detail/nutrition[/<date>]`; host tab `nutricion` (`DETAIL_TAB`) | `good` / `mid` / `bad` (≥ 85 / 60–84 / < 60); today is `partial`: no chart point, never in the period average (`HCNutriScore.metric` gives it `null`) | the score, each component's eaten / target and points ("75 / 100 pts") — today "In progress" instead of the score and no points (a left-out one: "—" + why) — then the notes that apply (a macro missing, a main meal unlogged, a rest day assumed from sleep) |

- `nutrition` joins the trend picker once a day is scored; it uses the generic trend view, no deep-dive
  page.

### `sessions`

- One entry per date + modality after `mergeSameDay` DISPLAY_RULE: minutes, km, elevation, avg HR, RE,
  parts, source (the precedence family, so "Apple Watch de <name>" is written "Apple Watch").
- When `workout-zones.csv` has that date + modality (`lib/training/read.mjs` `readWorkoutZones`): `z` =
  seconds in HR zone 0–5 summed over its Strava activities (left out when none or all zero) and `hx` =
  their highest max HR.
- `zoneMax` = `{hr, src}`: the max HR the zones were cut with and its source (`profile` / `observed`);
  absent without the file.

## Openers

- `HC.detailAttrs(key, date?, {plain?})` writes `data-detail` [+ `data-date`] + a button role and tab stop
  (`plain`: data attributes only, for a real `<button>`, an SVG cell or a table row).
- One delegated click / Enter / Space listener in `web/src/client/detail.js` handles every opener. It
  ignores a click / Enter on a control inside a card (a, button, summary, input, select, textarea,
  `role="button"`) other than the opener itself.
- Every opener shows the same chevron (the one `.chev` look, `base.css`), pointer, focus ring and ≥ 44px
  target (`web/src/styles/detail.css`); the chevron is centred on a one-line opener and pinned to the
  header row (top-right) of a tall card.
- On a PAST day of Home (the top bar's day stepping, [`home-tab.md`](home-tab.md)) every Home opener — the
  dials, the collapsed row, the stress / HRV tile, "My day" rows — carries THAT day as `data-date`, so its
  sheet opens with that day selected (calendar, chart selection and the day panel, which a dial page
  scrolls to). The dial page's hero ring and insight card stay the latest night / today (the dial's own
  baked values); the strain page instead follows the day it was opened on.

### Opener map

| Opener | Opens |
| --- | --- |
| sleep dial / recovery dial / strain dial | sleep / recovery / strain |
| each load dial (the fallback) | its `load-<m>` |
| Health monitor rows | their signal |
| stress monitor tile, My dashboard's stress card | stress on their day (the tile's HRV fallback → hrv) |
| "My day" outlook bar (advice) | recovery |
| activity rows | that day (sleep, or `load-<m>` / `workouts` for "other") |
| programmed-session row | the registered `hoy-session` view (client/training-today.js) |
| "Tonight" card | the registered `tonight` view (the bedtime + a button to the sleep sheet, the rule behind its ⓘ, client/home-week.js) |
| "My plan" rows | sleep / workouts |
| each "My dashboard" row; "Customize" | its metric; the registered `dash-edit` view (client/home-dash.js; its buttons re-open the view through `HCDetail.open` with `focus` on the control just used) |
| every Health metric row | its metric (expenditure → energy; the sleep consistency rows → sleep) |
| Nutrition → Balance's avg burn row | energy (avg intake and deficit / surplus open nothing: no intake series is baked) |
| Health recovery card | a History button (the card holds a `<details>` fold, so it is not itself a button) |
| Training load cards | `load-<m>` |
| Activity card's total and calendar | workouts (a day cell → that day; its W / M / 6M switch is outside every opener) |
| run / ride rows | that day in `load-run` / `load-bike` (the whole list row is the button) |

- client/home-week.js and client/home-dash.js run in the end-of-body list BEFORE `detail.js`, so the views
  exist when it reads the hash. `#tonight` / `#dash-edit` deep-link like `#hoy-session` (all `VIEW_TAB` →
  `home` in lib/nav/tabs.mjs, baked as `NAV.viewTab`, so core.js shows Home underneath instead of
  rewriting a hash it does not know).

## Dial deep-dive pages

`web/src/client/deepdive.js`, inlined right before `detail.js`, which calls
`window.HCDeep.render(key, m, end, X)` with its own helpers `X`, so both files read one set of rules and
copy. The copy is the dial's own (`score-templates.mjs` via `I18N_DETAIL.rec` / `load` / `deep`).

The sheets of the Home dials — `sleep`, `recovery`, `load-<m>`, plus `strain` — are one page, top to
bottom: header → ⓘ block → hero ring → contributors → insight → weekly trends → history fold. `stress` and
`energy-bank` have their own pages ([below](#strain-stress-and-energy-bank-pages)).

### 1. Header "‹ TODAY ⓘ"

- The ONE sheet header every detail shares (`HC.sheetHead`, `client/util.js`; a `44px | 1fr | 44px` grid).
- The back arrow IS the sheet's close button (`data-dt-act="close"`, focus lands on it; Esc / Back still
  work).
- Centred and uppercase, the DAY the page shows (`h2.sh-title#dt-title`): "Today" (`deep.today`, es "Hoy")
  or its date ("Mon 28 Sep", `HC.fmtDate`).
  - strain = the day it was opened on (Home's day stepping); the others = the view end (the viewer's
    today, or the stale data's last day: the day their hero describes).
  - recovery and sleep = their headline night when that night is OLDER than the viewer's today (a carried
    value, `HC.carried`, [`design-system.md`](design-system.md) → Carried values): the title (weekday
    kept) and the contributor legend ("▲▼ Wed 7 Oct vs prior 30 days") name it, and the hero is dimmed
    (`.carried`, colour kept; stale data keeps the stronger `dd-stale` grey), like the Home dials.
  - load, strain, stress and energy bank read the shown day only and never carry.
- The metric name moves into the ring (its uppercase label) and stays the dialog's label for screen
  readers (`sheetHead({sr})`: a `.sr-only` "Recovery · " before the day).
- ⓘ (`.sh-info`, the same SVG icon as the Health headers' `HC.infoBtn`, `data-dt-act="info"`,
  `aria-expanded` / `aria-controls="dd-info"`) toggles the long-notes block in place, collapsed by default.
  A sheet without notes puts an equal 44px spacer (`.sh-pad`) there so the title stays centred.

### 2. ⓘ block

`#dd-info`, hidden by default:

- the band / cut rules (`bandText`: the recovery day and trend cuts, the per-day note, the sleep band, the
  typical day);
- the recovery % mapping (`rec.pctNote`) and the night's SD line ("Vs your 42-day baseline: +1.1 SD · at
  baseline", `rec.sdLbl`), both only when the hero shows a %;
- the load ring scale + sessions-without-effort note;
- the sleep formulas (`deep.sleepNotes`: performance = asleep ÷ need × 100 capped at 100 with need = the
  target, efficiency = asleep ÷ in bed, consistency minutes, what the stages are).

### 3. Hero ring

- 260 px (≈ 67 % of a 390 px phone; never wider than the sheet), the dial's OWN baked arcs (`DIALS`, so it
  can never disagree with Home), 7.5-unit stroke (of the 120-unit viewBox), from 12 o'clock clockwise,
  round caps, on `--track`.
- Inside: the value (D-DIN, 56–70 px, 70 px on a phone) + small unit + the uppercase label (at most 60 % of
  the ring wide, so "SLEEP PERFORMANCE" takes 2 lines instead of touching the ring).
- Recovery: the dial's % (`DIALS.recovery.pct`, when it scores the same night as `head`) in its % band
  colour, else the SD value. Sleep: the dial's sleep performance % (`DIALS.sleep.pct`, label "SLEEP
  PERFORMANCE"), else last night's hours.
- Colour: recovery = ONE state colour, its band (`--good` / `--mid` / `--low`); sleep = `--sleep`; load =
  `--strain` with a white tick at the typical day (`DIALS.load.tick`).
- Off states show the dial's word in an empty ring (recovery "No baseline", load "Building" / "No session
  yet" / "No effort data"; the typical-day tick dims to a faint hairline, `.dd-off .dd-tick`). Stale data
  (> 3 days) greys it like the dial. No `DIALS` global: the number still shows (from `DETAIL`), the ring has
  no fill.
- **Sleep stages bar** (sleep only, AFTER the insight card: `.dd-stages`, titled "Sleep stages", so the page
  reads dial → contributors → insight like the reference): one stacked horizontal bar of the night — awake
  / REM / core / deep (+ the Asleep-unspecified remainder when ≥ 0.05 h), widths by hours — in shades of
  `--sleep` (REM lighter, deep towards `--link-end`, awake `--faint`), and a legend with each stage's hours
  and, for the asleep stages, its % of the time asleep. No stage arrays in `DETAIL` (older extract) or no
  stages that night → no bar.

### 4. Contributors card

- A caret notch points up to the ring; ≤ 4 rows: icon + UPPERCASE name + value + marker. Row labels use the
  SHORT metric names ("HRV", "Resting HR" — `metrics.*.title`, as the weekly trends).
- Each row = the dial's own input, "today vs the prior 30 days" (`HCDeep.compare`): today's value vs the
  middle half (p25–p75) of the values on the 30 days before it (the Health totals' "usual day" idea); fewer
  than 7 prior values → the value without a marker.
- Markers: above / below → ▲ / ▼ (small ≈ 8 px triangles), teal (`--up`) when better and orange (`--down`)
  when worse by the metric's good direction, `--ink` for a metric without one (bedtime, wake time, load;
  never a grey arrow); inside → a grey dot. The words ("better than usual"…) are screen-reader text.
- A legend pill "▲▼ Today vs prior 30 days" closes the card when a marker shows. A row without a value that
  day is hidden (never 0 or a dash).

| Page | Rows |
| --- | --- |
| recovery | the reference's four on the night it scores (`head.date`), display only (the composite and its weights are unchanged): HRV, resting HR, respiratory rate (`DETAIL` `respiratory`; context, NOT a composite input; no good direction, so an `--ink` ▲ / ▼ outside the usual range and a grey dot inside; the ⓘ says so, `deep.respNote`) and sleep performance % (the sleep metric's baked `perf`). A missing one is hidden (no respiratory reading = 3 rows). Like the hero, they stay on the headline night under day stepping (the day panel opens on the stepped day) |
| sleep | hours vs need as h:mm ("6:54 / 7:30", ▲▼ on the hours), efficiency % (`DETAIL` `eff`), consistency minutes (`cons`, lower = better) and REM + deep ("3:06 · 41%", h:mm · % of asleep); a missing one is hidden and bedtime (an after-midnight bedtime counts as late evening, 00:30 = 24.5) and wake time fill the card up to four rows |
| load | today's RE (only on a day with RE, compared with the prior 30 days' training days only), the 7-day vs 42-day trend (`DIALS`), the sessions of the last 7 days, the typical training day |

### 5. Insight card

- `--ground` fill inside a 1.5 px teal → indigo stroke (`--insight-a/b`): ONE paragraph of 2–3 plain
  sentences built only from numbers the page already shows (`deep.prose`).

| Page | Text |
| --- | --- |
| recovery | Home's outlook sentence first (`window.HCAdvice`, it already carries the 7-day trend), then "Last night your recovery was high." (the % band word ONLY when the hero shows a %, else the SD band "at your baseline" — the SD line lives under ⓘ, so the card never shows two different bands; "On Mon 28 Sep …" for an older night; + "There is no sleep data for that night."). Without the advice: "Over the last 7 days it has been steady (+0.5 SD vs your baseline)."; no recent complete night → the 7-day trend sentence |
| sleep | "Last night you slept 7:32, +0:02 vs your 7:30 target." + the contributors that were worse than usual ("Sleep consistency was worse than your usual.", or "Every contributor was at or better than your usual." when they carry markers) |
| load | the day ("Today's Relative Effort is 28; your typical training day is ~42.", or no session / the last one) + "Over the last 7 days your load has been steady (−6% vs your 42-day average)." (baked `DIALS`; none or gated → no trend sentence; the ring scale is under ⓘ); a gated modality shows its gate copy |
| strain | the band sentence + "Your usual day is 12.4 (median of the prior 30 days)." (the scale's calibration is in ⓘ) |

- Then the page's own CTA (`deep.ctas`: "SEE MY RECOVERY TREND →", sleep / load / strain likewise; the
  stress and energy pages keep "VIEW TREND"; `data-dt-act="trend"`, a button): scrolls to the period block
  and focuses the pressed W / M / 6M / 1Y button.
- It is the shared CTA link (`HC.cta`, `.cta`; [`design-system.md`](design-system.md) → Components); its
  text is the `--link` → `--link-end` gradient (blue → violet) clipped to the glyphs, solid `--link` where
  `background-clip: text` is unsupported. On `--ground` both ends pass AA for small text (8.29 / 4.61); on a
  card the reference violet would not (3.91), so CTAs on cards end in the lighter `--link-end-card`
  (`tokens-contrast.test.mjs`).

### 6. Weekly trends

- "Weekly trends" title, one card per input, a faint horizontal grid in quarters behind the bars.
- Each card's caps title is a button with the chevron at its right edge: the page's own metric (and its
  derived cards) scroll to the trend chart (`data-dt-act="trend"`); another metric's card (HRV, resting HR,
  sleep on the recovery page) opens that metric's trend view (`data-detail`).
- 7 bars for the 7 days ending at the PAGE's day (`weekEnd`: recovery = its headline night, sleep = the
  dial's night, strain = the day it was opened on — each only when within the last week —, load = the view
  end; `HCDeep.weekOf`).
- The value on top, the weekday letter and day of the month under each bar ("T 24"); the last column
  lighter (`.dd-now`) and carrying the hero's value (no empty "today" column while the newest night is
  yesterday's); a day without data = "—" and no bar. Bars are proportional to the week's largest value.

| Page | Cards |
| --- | --- |
| recovery | each night's recovery % — the number the dial showed that morning (`DIALS.days[].recovery.pct`, lib/score/days.mjs; the newest from `DIALS.recovery`) — bar = % of 100, bar AND value in its % band colour (≥ 67 `--good`, ≤ 33 `--low`, else `--mid`, `.dd-v-*`); a week with no % at all (too few prior nights, no `DIALS`) falls back to the composite per day on the dial's −3…+3 scale in its day band's colour; then HRV and resting HR (`--trend`) and sleep (`--sleep`) |
| sleep | hours, performance % (bar = % of 100) and REM + deep hours when `DETAIL` has them (`--sleep`) |
| load | RE per day and the modality's minutes per day from the sessions (`--strain`; a day after the data's `asOf` is unknown, not rest) |

### 7. History fold and the day panel

- Below: the period block + chart, then the month calendar and the day panel FOLDED behind one "HISTORY ·
  Calendar and day detail ⌄" row (`detail.js` `foldHtml`, a `.dd-fold` button with `aria-expanded` /
  `aria-controls="dd-hist"`, `data-dt-act="hist"`, toggled in place without a re-render).
- Collapsed by default, so the page reads like the reference; the last state is remembered for the page
  session (`sessionStorage` `hc-dd-hist`, this load only where storage is refused).
- Every deep-dive page folds (sleep, recovery, strain, load, stress, energy); the trend view keeps its
  calendar open.
- A DATED open (a run / ride row, a timeline row, a stepped Home day: `open(key, date)`) starts with the fold
  open and scrolls the sheet to the day panel (`[data-dt-part="day"]`, `block: start`) after focus lands on
  the back button. An undated open (the dial) starts at the top, and so does a dated stress page (its hero
  IS that day: Home's stress tile opens it on an earlier reading's day).
- A run day's panel ends with the watch running dynamics of that day (`.dt-dyn`, "Running dynamics: 276 W ·
  GCT 242 ms · Osc. 8.3 cm · Stride 1.14 m", read from `HEALTH.running`; a field not recorded is left out,
  none → no line). The Training run row does not print them.
- A session with HR zones (`z`) gets the zones block under its meta line (`zonesHtml`: "HEART-RATE ZONES" +
  avg / max HR, rows ZONE 5…0 with the bpm range from `zoneMax`, % of the zoned time, m:ss and a bar in the
  zone colour, and an ⓘ `<details>` with the model and the max HR; [`training.md`](training.md) "Per-workout
  HR zones"); no `z` → no block.

### Strain, stress and energy bank pages

All three follow the day they were opened on (strain: `X.sel`, else the view end).

**Strain** (key `strain`, client/deepdive.js):

- Hero ring = the day's strain with the Home dial's own arc.
- Contributors = the day's activities + "all day (outside workouts)", each with its share of the strain
  (∝ its load; from `SCORES.strain.days`, the last 14 days).
- Insight = the band sentence and the usual day (median of the prior 30) in one paragraph.
- ⓘ = the formula, the sources, this user's K / p95 / full days / max HR and "our estimate".
- Then the 7-day strain bars and "Relative Effort by modality" links to the `load-<m>` pages.

**Stress** (key `stress`, client/deepdive.js `stressPage`):

- Hero = a 0–3 half gauge in the three band colours with a marker at the latest scored hour, its value, band
  word and "Latest hour 14:00" (no value → an empty gauge + "No data").
- "Hour by hour" = an SVG curve over 00:00–24:00 with the three bands as faint stripes, one dot per scored
  hour in its band colour (joined while consecutive; gaps = sleep, workouts or too few readings).
- "Time in each band" = a stacked bar + one row per band.
- Insight = the day average + band, the band with most time and "an estimate from heart rate only" (under
  the minimum hours: "only n waking hours could be scored").
- ⓘ = the formula, how hours are scored, that day's resting HR / max HR / minimum hours, the limits (no HRV,
  no hourly steps, so movement raises it) and "not a medical measure".

**Energy bank** (client/deepdive.js `energyPage`):

- Hero = a 0–100 half gauge filled to the latest level in its third's colour, the band word and "Latest hour
  23:00".
- "Through the day" = an SVG curve over 00:00–24:00 on the three thirds as faint stripes, from the wake
  level, one step per hour end (a flat stretch = hours without data); blue dots on workout /
  heart-rate-load hours (load drain ≥ 5), orange dots on high-stress hours (≥ 2).
- "What moved it" = start (recovery % at wake), being awake, stress, heart-rate load, calm hours, low.
- Insight = start → latest level, the biggest drain and "our own model, an estimate" (no value: why — no
  recovery % / no wake time).
- ⓘ = it is OUR model (not validated), the formula with the baked constants (`SCORES.energy.C`), the hour
  rules, the inputs (K, max HR) and the limits.

## Trend view

`detail.js`: one renderer, per-view try/catch with a message fallback, no NaN ever printed.

### Header and metric picker

- The shared header titled "‹ TREND VIEW" (`trend.title`, es "Tendencia"); the metric is the dialog's
  screen-reader label (`sheetHead({sr})`); no ⓘ: a spacer.
- The **metric picker**: a native `<select>`, the shared select pill (`.sel` + the turned `.chev.sel-chev`,
  [`design-system.md`](design-system.md) → Select; `.dt-metric`, `data-dt-pick="metric"`), listing every
  baked metric with copy EXCEPT the dial pages (sleep, recovery, strain, `load-<m>`: their own layout,
  reached from the dials). A change re-opens the sheet on that metric with the same range and replaces the
  URL (no new history entry; an unknown value is ignored).
- The latest value + date and the band / target / typical day in words sit under the header's ⓘ
  (`#dd-info.dt-info`, collapsed); the window's average leads and the chart labels the newest value.
- The header NEVER contradicts the card it opens from:
  - recovery: the chart's zone is the trend band at ±`cutTrend`; the daily points use the day band;
  - weight / energy: the cards' 7-day rolling average (`roll`, also the chart line) with the latest reading
    / day underneath;
  - a daily total's newest day, when it is the viewer's today: "Today, in progress" (neutral `partial`
    colour in the header, chart and calendar, never compared with the median);
  - training time: the newest day in range ("Rest" on a rest day).
- The band note says colours are the CURRENT range (static, as of the newest day), except recovery, scored
  per day. A signal / total / sleep / recovery metric whose own last day is > 3 days before the view end says
  so.

### Period switch and window

- A small right-aligned W · M · 6M · 1Y switch (THE segmented control: dark 28 px squares, the pressed one
  grey, each with a 44 × 44 px hit area; 7 / 30 / 182 / 365 days, `RANGES`; opens on M; es S · M · 6M · 1A).
- Under it the window row "‹ 23 Sep – 29 Sep, 26 ›" (`trend.win`): ‹ › (the shared `.nav-btn` + `.chev`,
  like the calendar's month ‹ ›; [`design-system.md`](design-system.md) → Components) step the window back /
  forward by its own length (`state.shift` whole windows back from the view end).
  - › disabled at today; ‹ disabled once the previous window would end before the metric's first day.
  - A new range or metric starts at today.
  - The chart, the average and its delta follow the window; the calendar and the day panel do not.

### Average, delta and sentence

- "AVERAGE" = the mean of the days with data in the window (a daily total's partial today left out; a
  missing day skipped, never 0).
- A delta pill on its own line below, vs the previous window of the same length: ▲▼ + % (absolute in sd for
  recovery), `--up` / `--down` by the metric's good direction; neutral • when within 1 % / 0.05 sd or for a
  metric without a direction.
- ONE plain sentence (`trend.sent`: "Your average Resting HR this week was 53 bpm, about the same as the
  week before (53 bpm)."): higher / lower / about the same by the pill's rule, no judgement (the pill's
  colour carries good / bad). A change that rounds to two equal numbers gets one more decimal; a sleep
  window reads h:mm, which has no decimal to add, so two windows that print the same clock read "about the
  same".
- Short data (`periodStats`, exposed as `HCDetail.periodStats(key, end, days)`):
  - a window longer than the data is clamped to the metric's first day (the toggle stays; chart and average
    start there, the pill says "Data since <date>");
  - a previous window wholly before the data, or starting before it with data on fewer than half its days →
    "No earlier period to compare";
  - one that starts before the data but holds data on at least half its days still compares (a 6-month view
    on 7+ months of data).

### Chart

- Inline SVG on the sheet's ground (no card). Its shaded band is named once top-right ("TYPICAL RANGE",
  `trend.typical`; recovery "BASELINE RANGE", `trend.baseline`; no legend swatch for it).
- Points for signals, bars for totals and load; the 7-day average line breaks where fewer than 3 of 7 days
  have data; the band shaded; target / typical dashed; a missing day is a gap.
- A points chart longer than 60 days (6M, 1Y) draws a dot only for the days OUT of the range (beyond
  recovery's day cut, outside a signal's / sleep's band) and leaves the rest to the 7-day line, its key
  reading "Days out of range" (`chartKey.outside`), so red / green dots never saturate the chart (a metric
  without a band keeps every dot).
- The "Daily" / "Days out of range" key draws one mark per state the window actually drew, with the chart
  marks' own `dt-s-*` classes (`keyMarks`, `.dt-k-pts`), so its swatch is the dots' colours, never a
  stand-in blue (none drawn → no key).
- The window's newest value is ringed and labelled (`.dt-last` / `.dt-lastv`).
- W: every metric but recovery is 7 bars from 0 with each value on top (`.dt-bv`) and "Thu / 9" under each
  bar (`.dt-wdays`) instead of the from / to dates; no 7-day line.
- Labels are HTML over the SVG's box (`.dt-svg`). Y axis: three round, evenly spaced values (step 1 / 2 /
  2.5 / 5 × 10^k; bars from 0) as faint grid lines (`.dt-grid`) and labels in a 36px left gutter (`.dt-yax`,
  HTML so the text never scales with the SVG); the range covers the ticks plus 12 % headroom, so an
  out-of-range day never sits on the chart's edge.
- A day tap re-renders only the calendar and the day panel and moves the chart's selection rect; the 7-day
  line is computed once per (metric, range).

### Days in this period

- Under the chart, "DAYS IN THIS PERIOD" (`breakdownHtml`, `trend.brk`): one stacked horizontal bar of the
  window's days with data by calendar state — the legend's states, order and tints (better / in / worse than
  your range, above / at / below baseline, the sleep, stress, energy and nutrition bands; today in progress
  and missing days left out) — and one row per state with its count ("7x"; a state with none says "0x" and
  has no segment). It follows the window (range + ‹ ›).
- Training volume / load / strain (four shades of one colour), sparse readings and a metric without a band
  get none.
- "LEARN MORE →" (a `.cta`, `data-dt-act="learn"`) opens the header's ⓘ notes (never closes them) and
  scrolls them into view.

### Calendar and day panel

- A Monday-first month calendar (es/en weekday letters), prev / next bounded by the baked range.
- Each day tinted by its state (good / mid / bad tiles: the state hue at 16 % with a 40 % inset ring,
  `--good-rgb` / `--mid-rgb` / `--low-rgb`, never a saturated block) by `dayState`:

| Metric type | State |
| --- | --- |
| signals | vs their band by good direction (good / normal / bad; change signals `watch`) |
| totals | likewise (energy: neutral hi / lo) |
| sleep | good ≥ target / mid / bad below the band |
| recovery | by the day cut |
| training volume | four `--strain` shades |
| sparse readings | "measured" |
| missing | empty |

- The picked day below (default: the newest day with data):

| Metric type | Day panel |
| --- | --- |
| overnight views | the whole night (asleep h vs target, bed – wake, recovery, HRV, RHR, respiratory, wrist temp; sleep adds that night's stages "REM · deep · core · awake" hours and efficiency %, or a no-stages note when the night has none) |
| totals | value vs the median (energy + active / basal) |
| sparse | vs the previous reading |
| workouts / load | that day's sessions |

- The view ends at the VIEWER's today, or at `DETAIL.asOf` when that is > 3 days old (with a note) or
  ahead of the clock.

## Modal & history

### Modal and focus

- `#detail` (role="dialog", aria-modal, labelled by the title) renders in `layouts/Plan.astro`'s `overlay`
  slot OUTSIDE `.wrap`, which goes `inert` while open (page scroll locked); `.wrap` also gets
  `aria-hidden` while open (fallback where `inert` is unsupported).
- Focus moves to the close button and Tab stays inside. Esc / the close button / a tap on the backdrop
  close it and focus returns to the opener (none — a deep link or a forward navigation — → the visible
  tab's heading, given `tabindex="-1"`).
- A control whose re-render removed or disabled it hands focus to the close button.

### History and deep links

- Opening pushes `#detail/<metric>[/<date>]` (picking a day replaces it), so browser Back closes the sheet
  and lands on the tab hash entry underneath (`#nutricion`, see [`plan-page.md`](plan-page.md) → URL hash
  & navigation).
- Closing a deep-linked sheet (no entry of ours) replaces the URL with the current tab hash
  (`window.HCNav.hash()` from core.js; '' without it). core.js has already shown the deep link's host tab
  underneath (`#detail/sleep` → Health), so it closes onto `#health`.
- A page opened with that hash opens the view — only for an OWN key of both `DETAIL.metrics` and the copy
  (no `constructor`), and a date must round-trip (`HC.isoDate` rejects 2026-02-31). A bad or out-of-range
  date falls back to the default day and the URL is replaced to match.
- A re-open while the close's `history.back()` is in flight (`pendingBack`) writes no history until that
  popstate arrives, which then pushes the new sheet's entry instead of closing it.
- A frame that refuses history writes (sandboxed artifact) still gets the sheet, and closing then never
  calls `history.back()` (and leaves no lock / inert / aria-hidden behind).
