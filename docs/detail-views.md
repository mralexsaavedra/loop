# Detail views

The full-screen drill-down sheet behind every card.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Detail views — tap any card, see every day

WHOOP's drill-down, honest version: a tap on a card opens a full-screen sheet (a large centred panel
from 900px) with that metric's history. No new score: the sheet only shows the card's own series.

- **Data** — `lib/detail/detail.mjs` `buildDetail(extractDir)` bakes ONE global `DETAIL` (in
  `components/DetailSheet.astro`, with `I18N_DETAIL` from `web/src/i18n/detail-templates.mjs`):
  `{asOf, days: 365, metrics: {<key>: {kind, dir, dec, start, v, …}}, sessions}`. Each metric = an ISO
  `start` + a `v` array, one slot per calendar day of the last 365 days ending at the newest data date
  (never the build clock, so builds stay byte-identical), `null` = no data that day (never 0), rounded to
  the card's precision. Keys (`DETAIL_KEYS`): sleep, recovery, hrv, rhr, respiratory, wristTemp,
  walkingHr, vo2max, steps, exercise, distance, flights, energy, weight, bodyfat, lean, waist, workouts,
  load-gym, load-run, load-bike; a key without data is simply absent (the view shows its empty state).
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
  also carries bed / wake times and the 7.5 h target; `recovery` = for each day, the composite the
  dial showed THAT morning (`recoveryFromInputs` with the inputs cut at that day, its own baseline, not
  today's) + that day's 7-day trend (`t7`), `cut` = `DAY_BAND_CUTOFF`, `cutTrend` = `BAND_CUTOFF`, and
  `head` = the dial's own headline (`recoveryHead`, from the same full-input `recoveryFromInputs`
  call: mode today/trend, date, value, band, sleep, trend {value, band, dir}); `workouts` = minutes
  per day after the display rule, zero-filled (rest) from the first session up to `asOf` (a day after
  asOf is missing); `load-<m>` = RE per day after the load rule (`null` = sessions without RE), with
  the card's typical day (the same `typicalDay` value the load dial puts at its ring midpoint),
  calendar cuts at 0.5 / 1 / 1.5 typical days, and the dial's `gate` (null / `baselineBuilding` /
  `fewDays`) + `last` scored session; `sessions` = one entry per date + modality after
  `mergeSameDay` DISPLAY_RULE (minutes, km, elevation, avg HR, RE, parts, source; the source is the
  precedence family, so "Apple Watch de <name>" is written "Apple Watch"). Size: ~26 KB on the demo,
  ~62 KB on a real year; the whole feature adds ~71 KB to the demo page.
- **Openers** — `HC.detailAttrs(key, date?, {plain?})` writes `data-detail` [+ `data-date`] + a
  button role and tab stop (`plain`: data attributes only, for a real `<button>`, an SVG cell or a
  table row). One delegated click / Enter / Space listener in `web/src/client/detail.js` handles every
  opener. Map: sleep dial → sleep; recovery dial → recovery; each load dial → its `load-<m>`; Salud monitor
  rows → their signal; the HRV monitor tile → hrv; the "My day" outlook bar (advice) → recovery;
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
  opener shows the same chevron, pointer, focus ring and ≥ 44px target (`web/src/styles/detail.css`);
  the chevron is centred on a one-line opener and pinned to the header row (top-right) of a tall card.
- **Dial deep-dive pages** (`web/src/client/deepdive.js`, inlined right before `detail.js`, which calls
  `window.HCDeep.render(key, m, end, X)` with its own helpers `X`, so both files read one set of rules
  and copy): the sheets of the three Inicio dials — `sleep`, `recovery`, `load-<m>` — are laid out as
  one page, top to bottom:
  1. **Header** "‹ TODAY ⓘ": the back arrow IS the sheet's close button (`data-dt-act="close"`, focus
     lands on it, Esc / Back still work); the metric title stays the dialog's label as a visually
     hidden `h2#dt-title`; ⓘ (`data-dt-act="info"`, `aria-expanded` / `aria-controls="dd-info"`)
     toggles the long-notes block in place, collapsed by default.
  2. **ⓘ block** (`#dd-info`, hidden): the band / cut rules (`bandText`: the recovery day and trend
     cuts, the per-day note, the sleep band, the typical day), the load sessions-without-effort note,
     the sleep "stages are not in the extract" note.
  3. **Hero ring**: ≈ 67 % of the width (max 320 px), the dial's OWN baked arcs (`DIALS`, so it can
     never disagree with Inicio) drawn with a 6.4-unit stroke (≈ 5.9 % of the 108-unit diameter),
     from 12 o'clock clockwise, round caps, on `--track`; inside: the value (D-DIN, 52–72 px) + small
     unit + the uppercase label. Colour: recovery = ONE state colour, its band (`--good` / `--mid` /
     `--low`), sleep = `--sleep`, load = `--strain` with a white tick at the typical day
     (`DIALS.load.tick`). Off states show the dial's word in an empty ring (recovery "No baseline",
     load "Building" / "No session yet" / "No effort data"); stale data (> 3 days) greys it like the
     dial. No `DIALS` global: the number still shows (from `DETAIL`), the ring has no fill.
  4. **Contributors card** (a caret notch points up to the ring; ≤ 4 rows: icon + UPPERCASE name +
     value + marker): the dial's own inputs, each "today vs the prior 30 days" (`HCDeep.compare`):
     today's value vs the middle half (p25–p75) of the values on the 30 days before it — the Salud
     totals' "usual day" idea; fewer than 7 prior values → the value without a marker. Above / below
     → ▲ / ▼, teal (`--up`) when better and orange (`--down`) when worse by the metric's good
     direction, grey for a metric without one (bedtime, wake time, load); inside → a grey dot; the
     words ("better than usual"…) are screen-reader text. A legend pill "▲▼ Today vs prior 30 days"
     closes the card when a marker shows. A row without a value that day is hidden (never 0 or a
     dash). Rows: recovery = the composite's inputs on the night it scores (`head.date`) — HRV,
     resting HR, hours of sleep (sleep consistency, its fourth input at 10 %, has no daily series in
     `DETAIL`: not shown); sleep = last night's hours, the delta vs the target (no marker), bedtime
     (an after-midnight bedtime counts as late evening, 00:30 = 24.5) and wake time (no efficiency or
     stages in the extract: not shown); load = today's RE (only on a day with RE, compared with the
     prior 30 days' training days only), the 7-day vs 42-day trend (`DIALS`), the sessions of the
     last 7 days, the typical training day.
  5. **Insight card** (`--ground` fill inside a 1.5 px teal → indigo stroke, `--insight-a/b`): the
     dial's former captions in 2–4 plain lines — recovery "Last night · <band>" (or the night's date,
     "no sleep data", "no recent complete night") + the 7-day trend coloured by the TREND band; sleep
     the target + last night vs it; load the day line ("Today: RE 28 · typical day ~42" or "No
     session yet today · last session …"), the ring scale and the 7-day vs 42-day trend + band (from
     the baked `DIALS`; no `DIALS` or gated → no trend line); a gated modality shows its gate copy.
     Then "VIEW TREND →" (`data-dt-act="trend"`, a button: scrolls to the period block and focuses
     the pressed W / M / 6M / 1Y button). Its text is the `--link` → `--link-end` gradient (blue →
     violet) clipped to the glyphs, solid `--link` where `background-clip: text` is unsupported: on
     `--ground` both ends pass AA for small text (8.29 / 4.61), on a card the violet end would not
     (3.91), so the gradient only ever sits on the insight card (`tokens-contrast.test.mjs`).
  6. **Weekly trends** ("Weekly trends" title, one card per input): 7 bars for the 7 days ending at
     the view's last day (the viewer's today, `HCDeep.weekOf`), the value on top, the weekday letter
     under each bar, today's column lighter (`.dd-now`); a day without data = "—" and no bar.
     Recovery: the composite per day on the dial's −3…+3 scale, each bar in its own day band's state
     colour (good / mid / low), then HRV and resting HR (`--trend`) and sleep (`--sleep`); sleep:
     hours (`--sleep`); load: RE per day and the modality's minutes per day from the sessions
     (`--strain`; a day after the data's `asOf` is unknown, not rest). Bars are proportional to the
     week's largest value.
  7. The rest of the sheet below, unchanged (period + chart, calendar, day).
  The copy is the dial's own (`score-templates.mjs` via `I18N_DETAIL.rec` / `load` / `deep`).
- **The sheet** (`detail.js`, one renderer, per-view try/catch with a message fallback, no NaN ever
  printed): header = metric, latest value + date, the band / target / typical day in words (the dial
  pages above replace this header). The header NEVER contradicts the card it opens from; the
  recovery chart's zone is the trend band at ±`cutTrend`, the daily points use the day band; weight / energy = the cards'
  7-day rolling average (`roll`, also the chart line) with the latest reading / day underneath; a
  daily total's newest day, when it is the viewer's today, is "Today, in progress" (neutral
  `partial` colour in the header, chart and calendar, never compared with the median); training time
  shows the newest day in range ("Rest" on a rest day). The band note says colours are the CURRENT
  range (static, as of the newest day), except recovery, scored per day; a signal / total / sleep /
  recovery metric whose own last day is > 3 days before the view end says so. The trend view: a
  W · M · 6M · 1Y switch (7 / 30 / 182 / 365 days, `RANGES`; opens on M; es S · M · 6M · 1A) beside
  "AVERAGE" = the mean of the days with data in the window (a daily total's partial today left out; a
  missing day skipped, never 0) and a delta pill vs the previous window of the same length (▲▼ + % —
  absolute in sd for recovery — `--up` / `--down` by the metric's good direction, neutral • when
  within 1 % / 0.05 sd or for a metric without a direction). A window longer than the data is clamped
  to the metric's first day (the toggle stays; chart and average start there, the pill says "Data
  since <date>"); no previous window wholly inside the data → "No earlier period to compare"
  (`periodStats`, exposed as `HCDetail.periodStats(key, end, days)`); the chart's existing band is the
  typical range. An inline SVG chart (points for signals, bars for totals and load, the
  7-day average line that breaks where fewer than 3 of 7 days have data, the band shaded, target /
  typical dashed; a missing day is a gap); a Monday-first month calendar (es/en weekday letters) with
  prev / next bounded by the baked range, each day coloured by state tokens (`dayState`): signals vs
  their band by good direction (good / normal / bad; change signals `watch`), totals likewise (energy:
  neutral hi / lo), sleep good ≥ target / mid / bad below the band, recovery by the day cut, training
  volume in four `--strain` shades, sparse readings "measured", missing = empty; the picked day below
  (default: the newest day with data): overnight views → the whole night (asleep h vs target, bed –
  wake, recovery, HRV, RHR, respiratory, wrist temp; sleep says stages / awake time are not in the
  extract), totals → value vs the median (energy + active / basal), sparse → vs the previous reading,
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
