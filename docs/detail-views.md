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
  opener. Map: sleep dial → sleep; recovery dial → recovery; each load dial → its `load-<m>`; monitor
  cards → their signal; the HRV monitor tile → hrv; the "My day" outlook bar (advice) → recovery;
  activity rows → that day (sleep, or `load-<m>` / `workouts` for "other"), the programmed-session row
  → the registered `hoy-session` view (client/training-today.js); the "Tonight" card → the registered
  `tonight` view (the bedtime rule + a button to the sleep sheet, client/home-week.js); the "My plan"
  rows → sleep / workouts; each "My dashboard" row → its metric, and "Customize" → the registered
  `dash-edit` view (client/home-dash.js; its buttons re-open the view through `HCDetail.open` with
  `focus` on the control just used). These two scripts register their views at DOMContentLoaded, so
  `#tonight` / `#dash-edit` do not deep-link at page load (they are not in `NAV.viewTab`);
  every Salud trend card → its metric (expenditure → energy); the Salud recovery card → a History
  button (the card holds a `<details>` fold, so it is not itself a button); Entreno load cards →
  `load-<m>`; the calendar and cumulative time → workouts (a day cell → that day); run / ride rows →
  that day in `load-run` / `load-bike` (the row is a mouse target, its date cell a real button). Every
  opener shows the same chevron, pointer, focus ring and ≥ 44px target (`web/src/styles/detail.css`);
  the chevron is centred on a one-line opener and pinned to the header row (top-right) of a tall card.
- **The sheet** (`detail.js`, one renderer, per-view try/catch with a message fallback, no NaN ever
  printed): header = metric, latest value + date, the band / target / typical day in words. The
  header NEVER contradicts the card it opens from: recovery = the dial's headline (`head`: last
  night's value + day band + "Last night" / the night's date, the 7-day trend as the secondary line
  coloured by the TREND band; the chart's zone is the trend band at ±`cutTrend`, the daily points use
  the day band); load = the dial's today logic (today's RE vs the typical day; a session without RE;
  else "no session yet today" + the last session; a gated modality shows its gate copy — the copy is
  imported from `score-templates.mjs`, so the words are the dial's). The dials carry no caption on
  Inicio, so their former captions live in these headers: the sleep target ("Target 7.5 h"), "Last
  night" / the night's date / "no sleep data" / "no recent complete night" and the 7-day trend
  (recovery), and for load the ring scale ("half the ring = your typical training day"), the 7-day vs
  42-day trend + band and the sessions-without-effort note (`loadContext`, read from the baked `DIALS`
  global; no `DIALS`, or a gated modality → no trend line); weight / energy = the cards'
  7-day rolling average (`roll`, also the chart line) with the latest reading / day underneath; a
  daily total's newest day, when it is the viewer's today, is "Today, in progress" (neutral
  `partial` colour in the header, chart and calendar, never compared with the median); training time
  shows the newest day in range ("Rest" on a rest day). The band note says colours are the CURRENT
  range (static, as of the newest day), except recovery, scored per day; a signal / total / sleep /
  recovery metric whose own last day is > 3 days before the view end says so. A
  30 d / 90 d / 1 yr switch; an inline SVG chart (points for signals, bars for totals and load, the
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
