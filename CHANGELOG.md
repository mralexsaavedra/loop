# Changelog

Dated history of structural work on this repo. **Current state lives in Engram**
(`mem_context`, synced across the owner's machines); durable operating facts live in
`CLAUDE.md` and the area docs in `docs/`. This file is the append-only narrative of what changed and why.


## 2026-10-08 — Salud: no repeated signals, tidier headers

- Recovery no longer repeats resting HR / HRV / respiratory rate / wrist temp under its card when the
  health monitor at the top already lists them (a signal the monitor lacks keeps its row). The raw
  "Last 14 days" fold is a quiet disclosure line instead of an empty box; the page ⓘ sits beside the
  title and the monitor's "n out of range" chip right after its title.

## 2026-10-08 — Desktop: one centred 960 px column

- Wide screens (>= 900 px) are the phone's single column, wider: `--content-max` 1160 → 960 px, and the
  last multi-column grids are gone (Salud sections, Nutrición meals and Plan de hoy, the recovery card's
  3 columns, the 720 px cap on Progreso / Constancia). Inicio's dials are one centred group with the
  load pills under the load dial; monitor tiles at natural height; Tonight's line and Entreno's
  calendar are capped and centred; `--fs-2xs` one step up. Phones unchanged.

## 2026-10-08 — Entreno calendar spans the card on desktop

- The multi-column desktop layouts from #76 were reverted (too compressed); only the Entreno → Activity
  30-day calendar changes on wide screens (>= 900 px): an HTML grid across the card's full width,
  7 equal columns, tiles capped at 64 px tall, instead of a 280 px SVG at the left of an empty card.
  Phones keep the SVG (390 px screenshot pixel-identical before/after).

## 2026-10-08 — Plan page restyle P7: text diet

- Card text follows one rule: a number + an uppercase label per tile, prose only in the insight card,
  explanations behind an ⓘ or in a detail sheet — nothing removed, only moved.
- Inicio: the Today's activities merge note went behind the card's ⓘ; the programmed row carries its
  whole focus in an aria-label. Salud: the recovery card keeps value, band, one short trend line and
  compact contributors, its long lines join the Recovery ⓘ; monitor rows print the bare range and a
  short date; the title's ⓘ is the shared `HC.infoBtn`. Entreno: run rows lost the 2–3-line small line,
  the watch running dynamics now close the opened day's panel, and a dated sheet scrolls to that day.
  Nutrición: the Progreso ⓘ keeps its state across a re-render.
- One `--dock-room` token pads the page end and sets `scroll-padding-bottom` so the floating dock never
  covers a focused or jumped-to element; `DASH` bakes only what the Intensity rows read.

## 2026-10-08 — Plan page restyle P6b: Nutrición

- Nutrición opens like Salud / Entreno: a centred uppercase title with an ⓘ (the tab intro and the
  shared caveats); every block is headed by the shared UPPERCASE label row, its notes behind an ⓘ.
- Resumen de hoy: the 270° kcal dial became a full ring in the Inicio dial language — the kcal eaten
  today inside over "/ target", one state colour (track only / on track / past 110 %) — and
  `OPEN_ARC` left `view/dial.mjs` (nothing else used it). Macro bars became three compact rows
  (eaten / target), the day type compact pills; where the intake comes from moved behind the ⓘ.
- Balance (moved from Salud's Energía): intake average vs expenditure, deficit / surplus a day as
  metric rows and the average macro split as a stacked bar over the one baked window (labelled; no
  W / M / 6M, the bake has a single window). Salud's Energía keeps the expenditure row only.
- Registrar entries became list rows in flat group cards (name + amount, macros as the small line,
  kcal on the right); Progreso became a number card (average, rate pill, status word, target / ETA)
  and Constancia number tiles with a thin bar, their explanations behind the section ⓘ. Plan de hoy,
  Mis productos, Mis recetas and Tablas folds are flat rows. Same data and calculations.

## 2026-10-07 — Plan page restyle P6a: Entreno

- Entreno opens like Salud: a centred uppercase title with an ⓘ (the tab intro, how to read a card,
  the caveats every block shares).
- Load summary: one compact card per modality (gym / run / bike) — the last scored session's Relative
  Effort big in strain blue, a small ring from the dial's own arc, "LOAD · date", a 7-day vs 42-day
  pill (grey steady, teal above / below, orange ramping / well below); a tap opens that modality's
  deep-dive. The relative score, coverage, other activities and the caveats moved behind its ⓘ.
- The overlapping views merged into ONE Activity card: the 30-day calendar, the cumulative training
  time and the workouts dashboard's weekly volume + modality split became total time for a W / M / 6M
  window (vs the window before), sessions / days / per week, a stacked modality bar with counts and
  the compact calendar. `ACTIVITY` bakes 367 days and the first session date. The dashboard section
  keeps only Intensity (HR) as metric rows (no zones in the extract, so no zone bars).
- Running and Cycling tables became list rows (date + secondary numbers, distance big with time and
  pace / climb); "Load vs recovery" became a bar card plus HRV / resting HR rows with ▲▼. Every note
  sits behind its section's ⓘ. Same data, no new metric.

## 2026-10-07 — Plan page restyle P5: Salud

- Salud reads like a health tab: a centred uppercase title with an ⓘ (the intro) over a soft green
  glow, then the health monitor list (moved out of Inicio's "See metrics" fold: status chip, one row
  per signal with ▲ / ▼ / • vs the personal range; Inicio's tile now jumps to Salud, `#monitor`
  deep-links there), then Recovery, Fitness (new: VO₂max + walking HR, out of Recovery), Sleep, Body
  composition, Activity and Energy as metric rows (the "My dashboard" row, shared as `HC.metricRow`):
  the newest value, the 30-day baseline or Δ, a direction-aware marker. Same data, no new metric.
- Text diet: every section intro and caveat moved behind its section's ⓘ; sparklines left the cards
  (the detail sheet holds the history). The intake balance + macro cards stay under Energy until P6.
- `#tonight` and `#dash-edit` now deep-link (VIEW_TAB). Docs: `docs/health-tab.md`,
  `docs/home-tab.md`, `docs/detail-views.md`, `docs/plan-page.md`.

## 2026-10-07 — Plan page restyle P4: dial deep-dive pages

- The sleep, recovery and load detail sheets are deep-dive pages (`web/src/client/deepdive.js`, called
  by `detail.js`): "‹ TODAY ⓘ" header (back = close; the band / cut notes collapsed under ⓘ), a hero
  ring drawn from the dial's own baked arcs (`DIALS`; load adds a white typical-day tick,
  `DIALS.load.tick`), a contributors card (the dial's inputs, each today vs the p25–p75 of the prior
  30 days, direction-aware ▲▼; rows without a value hidden), an insight card with the dial's former
  captions + a "View trend →" link to the history chart, and "Weekly trends" (7 bars per input).
  Same data: no new metric. Docs: `docs/detail-views.md`.
- The recovery dial (Inicio and hero) fills with ONE state colour by its band (at baseline =
  `--mid`, was the blue `--trend` with green / red zone arcs on the track); the zone arcs are gone.
- CTA link gradient (`--link` → `--link-end`) only on the insight card's `--ground` fill, where both
  ends pass AA for small text (8.29 / 4.61); inline CSS budget raised to 100 KB (≈ 92 KB used).
- `home-week.js` / `home-dash.js` moved from `Home.astro` into the layout's end-of-body script list
  (before `deepdive.js` / `detail.js`) and render at once instead of at `DOMContentLoaded`.

## 2026-10-07 — Plan page restyle P3b: the rest of Inicio

- "Tonight" card after the eat card: recommended bedtime ↔ usual wake time. Bedtime = the median wake
  clock of the last 14 nights − the 7.5 h sleep target (`lib/score/tonight.mjs`, baked as
  `SCORES.tonight`; hidden under 7 nights). The rule lives in the sheet the card opens, not on it.
- "My plan": a collapsible weekly card (Monday–Sunday of the viewer's week) with up to four goals —
  nights ≥ the sleep target (5), training days vs the programmed days or the usual week, days with food
  logged (7) and days on the kcal target (5; both LAN only) — each hidden when its data is missing or
  stale. Rendered by `client/home-week.js`, inlined with the Inicio panel.
- "My dashboard": single-row metric cards (RHR, HRV, sleep, weight, steps by default; VO2max, walking
  HR, exercise minutes available) with the latest value, the 30-day baseline and a ▲▼ vs it; a row opens
  its detail sheet. "Customize" shows / hides and reorders them (stored in localStorage, works without
  it). `client/home-dash.js`.
- Detail sheet trend view: the 30 d / 90 d / 1 yr switch becomes W · M · 6M · 1Y with the period's
  average and a delta pill vs the previous period; a window longer than the data is clamped to its
  first day.

## 2026-10-07 — Plan page restyle P3a: Inicio layout

- Dials: three equal full rings (start at 12 o'clock, fill clockwise, thin stroke, round caps), the
  value inside (number + small unit) and "LABEL ›" below; same values, bands and colours. The
  captions under them ("last night", the 7-day trend, the sleep target, the load scale and the
  acute/chronic line) moved to each dial's detail sheet header; only a stale-data line stays. The
  gym / run / bike switch is now compact pills under the load dial. Nutrición's kcal dial keeps the
  old 270° arc for now.
- Inicio order: dials → monitor tiles (out-of-range summary + HRV; HRV left out without a fresh value)
  → "My day" (the advice as a one-tap outlook bar, then "Today's activities": sleep with bed / wake
  time, workouts, and today's programmed session as a "Plan" row that opens the session sheet) →
  "today you eat" → the full monitor grid folded under "See metrics" (moves to Salud in P5). The
  standalone timeline, monitor and programmed-session blocks are gone from the page flow.

## 2026-10-07 — Plan page restyle P2: navigation shell

- Bottom dock at every width: a floating rounded tab bar (icon + small label, active white / inactive
  grey) and, to its right, a white circular "+" whose popover lists only actions this page can really
  run (add food = the food log's add sheet, Sync = the top bar's Sync; both LAN only). With none (example
  build, static copy) the "+" is not shown. The wide-screen sticky top nav is gone.
- Top bar: avatar left, a centred "TODAY" date pill (full date kept for assistive tech), freshness +
  Sync right. No day stepping yet: the page has no global "view another day".
- Inicio: a collapsed row of three mini rings (Sleep · Recovery · Load) appears at the top once the
  dials scroll away, reusing the dials' own svg and detail openers.
- The hero header (kicker / h1 / subtitle) is no longer drawn; `page.h1` stays the one, visually hidden
  h1.

## 2026-10-07 — Plan page restyle P1: palette and text font (no layout change)

- Colour tokens re-sampled from a reference fitness app: blue-grey page gradient, flat cards (no
  gradient / shadow), tile and inset levels, white / grey text tiers, new score hues, `--up` / `--down`
  deltas, `--track` for dial tracks. `--accent` (actions) is now white with black ink; inline links use
  `--link`. The red state colour fails AA as small text on a card, so it is kept for large numbers and
  graphics and small red text moved to a new `--low-ink`; a new test recomputes every ratio in the
  tokens header.
- Text font: an inlined ~26 KB subset of Inter 4.1 (variable 400–800, SIL OFL 1.1), "HC Text", built by
  `scripts/subset-text-font.mjs` (`subset-font` devDependency); D-DIN stays for numbers. Example page
  431 KB → 466 KB. Labels share `--label-track` / `--label-weight` (700).

## 2026-10-07 — Public template: personal pieces out of the tracked tree

- The repo becomes usable as a public template; every personal piece stays on the owner's disk, gitignored.
- A private training-program sync moved to the ignored `local/`; the built-in `DEFAULT_BY_GOAL` targets
  became a generic 70 kg seed.
- The coach subagents became generic templates that read the ignored `profile/coaches.md` (sources,
  gear, language, jurisdiction); onboarding now builds it.
- The owner's working notes (`odd/`) left the index and are ignored; owner-only operating notes
  (publishing routine, branch policy, the retired artifact flow) moved from `CLAUDE.md` and
  `docs/nutrition.md` to the ignored `CLAUDE.local.md`.
- README restructured for newcomers: prerequisites and setup levels (1 Apple Health + Claude, 2 LAN
  services, 3 Shortcut / Strava / own knowledge base); test fixtures use fictional devices.

## 2026-10-07 — CLAUDE.md restructure: history moved from CLAUDE.md

- `CLAUDE.md` (~1,720 lines, loaded every session) was cut to the per-session operating rules plus an
  Architecture map; each area's design moved verbatim to `docs/<area>.md` (data-pipeline, plan-page,
  detail-views, profile, nutrition, nutrition-food-log, training, health-tab, home-tab, lan-services,
  knowledge-base). New rule: read an area's doc before changing it and keep it in sync in the same commit.
- History sentences that only described what used to exist moved here (live constraints such as the
  deprecated `registro` key stayed in the docs):
  - Energy precedence: this superseded a Watch-only rule (2026-10-01) that dropped every pre-Watch day.
  - Strava sync: an unknown sport used to fall back to `Other`, which filed tennis as gym load; it now falls back to `Unmapped`.
  - Salud: HRV's headline used to be the 7-day rolling value; it is now the newest day's mean.
  - Salud running table: it used to read only `running-daily.csv`, which froze the table at the last export; it now reads `workouts.csv`.
  - Food log add sheet: the former "Del plan" tab (it logged Plan de hoy's menu) is gone: the portion guide's "+" logs an example amount instead.
  - `data/nutrition/generate.js` no longer emits any HTML (the Astro build does).
  - `targets.train` / `targets.rest` fed the removed day builder; its `targetFor` is gone.
  - plan-tables.md "Daily targets by goal and day type": the Snack column went with the automatic snack.
  - Plan de hoy: the choosable blocks, the Añadidos card that changed by day type and the automatic snack were removed when it became a portion guide.
  - 2026-10-06: the generic coffee basics (cortado, café con leche) were dropped from the Extras examples: the owner logs his coffees as his own recipes.
  - Resumen de hoy: the remainder and macro-off notes are gone: the guide's Extras absorbs them.
  - Tablas: the generic notes and the example plan's `page.notes['tablas.*']` no longer talk about portions.
  - The retired one-shot migration scripts (`scripts/migrate-plan-data.mjs`, last in 76b9c3b; `scripts/migrate-plan-v2.mjs`, last in 22cfabd) live in git history.
  - The former Constructor de día / Day builder (`registro`) was removed: the food log replaces it.
  - The old global train/rest toggle (and core.js `setDay`) is gone: the intake rings read today's target from Resumen de hoy.

## 2026-10-06 — food log: switching to servings sets the amount to 1

- Add sheet, product picked: changing the unit select to `serving` sets the amount to 1; changing it
  back to the product's g / ml sets one serving in that unit (`servingSize`, decimal comma in es). A
  number typed for one unit was kept for the other (25 g became 25 servings). Basics and recipes
  unchanged (`food.js` `switchProductUnit`, test in `food.test.mjs`).

## 2026-10-06 — Avituallamiento in the owner's own fuel items

- New optional plan field `fuel.items` (`{name, carbs per piece, fat?, kind?: fast | slow}`), validated
  by `npm run check` and baked localized into `NUTRI.fuel.items` only when present.
- On bike days Durante turns the during-ride carbs into whole pieces of those items: from min 30, slow
  items in the first half and fast ones after, the count closest to rate × (minutes − 30), never above
  the range top; it shows the total, the gap to the day's plan point and the 6–8 % bottle as an
  alternative. Antes' last hour names fast pieces within 30–60 g. Reference `lib/nutrition/fuel.mjs`,
  client port in `nutri-day.js`, parity over `FUEL_CASES`.
- Without items the page is unchanged (generic gels / bars / bottles). Personal items stay in the
  gitignored plan-data.json.

## 2026-10-06 — food DB: olive oil in ml

- Owner preference (like black coffee, 2026-10-05): olive oil is measured and logged in ml, not tablespoons.
- `aceiteoliva` is now per 100 ml (824 kcal, 91.6 g fat = the per-100 g values × density 0.916 g/ml) with no
  `piece`, so the food log, the portion guide and Tablas use ml; the example plan's oil amounts were converted (g ÷ 0.916).

## 2026-10-06 — Plan de hoy: rows capped by what the day still allows

- Real case: 72.6 g fat logged vs a 65 g day target, yet Cena offered "Grasa ~11 g de 23" and a "+"
  tablespoon of olive oil; each meal only looked at its own budget.
- `lib/nutrition/guide.mjs` `dayRemaining` (the "Te queda hoy" sum, now shared) + `capByDay`
  (`DAYCAP_CASES`), ported in `web/src/client/nutri-day.js`: a macro row shows min(meal left, day
  left); at ≤ 10 % of the day's meals target left it is "✓ cubierto (día)" / "✓ covered (day)" with no
  example amount and no "+". Extras' kcal and P / C / G are capped likewise. Without the food API
  nothing changes.

## 2026-10-06 — food DB: drop the generic coffee basics

- `cortado` and `cafeconleche` removed from `data/nutrition/ingredients.json` (107 log-only basics
  left): the owner logs his coffees as his own server-side recipes. `cafe` and `leche` stay.
- The cortado is also gone from the portion guide's Extras examples (plátano, yogur, batido remain).

## 2026-10-05 — food log: black coffee in ml

- `cafe` (Café solo) in `data/nutrition/ingredients.json` loses its typical "cup" piece (50 ml), so
  the add sheet logs it in ml by default. A cup size varies too much, and the piece mode as the
  default led to a "130 cups (~6500 ml)" entry when 130 ml was meant. A test pins it.

## 2026-10-05 — profile: hidden devices + device manuals on the LAN page

- **`hiddenDevices`** in `profile/profile.json` — a list of names left out of the profile sheet's
  Dispositivos list (case-insensitive, manual and Strava-derived entries alike; the Strava snapshot
  is untouched). For a device that shows up only because Strava saw it once (a borrowed bike
  computer). The names are applied at build time and never baked.
- **Device manuals** — a device entry may carry `manual: "<file>.pdf"` (a bare file name,
  `MANUAL_FILE_RE` in `lib/profile/profile.mjs`: no folders, no `..`), the owner's own PDF in
  `data/gear/` (gitignored). A manual entry merged with a Strava-derived one keeps it. Only the file
  name is baked in `PROFILE`.
- **Publishing** — `scripts/publish-manuals.mjs` (`npm run publish:manuals`, rules in
  `lib/profile/manuals.mjs`) copies ONLY the referenced PDFs into `services/plan-web/site/manuales/`
  and removes anything else there; a source must be a regular file directly in `data/gear/` (opened
  with `O_NOFOLLOW`: a symlink is refused), start with `%PDF-` and stay ≤ 50 MB; a missing / refused
  file is a warning; a broken profile.json leaves the folder as it is. `refresh.sh` runs it after
  `status.json` is written, under a 30 s timeout (`PLAN_WEB_MANUALS_TIMEOUT`), best effort (never an
  error code, never delays a waiting Sync).
- **plan-web nginx** — `location ~ "^/manuales/<same pattern>"`: GET / HEAD only, `application/pdf`
  (no extension types), `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
  default-src 'none'; object-src 'self'` (CSP `sandbox` would block the built-in PDF viewer), no listing;
  everything else under `/manuales/` is a 404. The Host allow-list and raw-path guard apply; behind
  the SSO tunnel it stays behind SSO (never a bypass rule). Validated with `nginx -t` and curl in a
  throwaway `nginx:alpine` container.
- **Profile sheet** — a "Manual" link (≥ 44 px, new tab, `rel="noopener"`) per device with a manual,
  rendered `hidden` and revealed at view time only when `HEAD /manuales/<file>` answers 200 with a
  PDF content type, so the claude.ai artifact, `file://` and the example build never show it; builds
  stay byte-identical.
- Rollout: merge → `docker compose up -d` in `services/plan-web` (new nginx location) → edit
  `profile/profile.json` → next refresh (or `npm run publish:manuals`).

## 2026-10-05 — profile: one source of truth per owner fact (events, settings snapshot, coaches)

- **Events in `profile/profile.json`** — optional `events: [{name, date: YYYY-MM-DD, type?: hyrox |
  race | sportive | other, location?}]`, validated by `validateManual` (`EVENT_TYPES` in
  `lib/profile/profile.mjs`), baked sorted by date. The profile sheet lists them as "Próximas pruebas /
  Upcoming events" right after the goal: upcoming soonest first with "Hoy" / "Mañana" / "Dentro de N
  días" computed on the viewer's clock (nothing time-based baked, builds stay byte-identical), past
  ones folded in a `<details>`, the section omitted when there are none. The synthetic example
  profile carries two events.
- **Settings snapshot** — `data/profile/sync-settings.js` (`npm run sync:settings`, last step of
  `npm run sync`) reads the ingest service's `GET /food/settings` (`X-HC-Food: 1`, no token) and
  writes `data/profile/settings.json` = `{goal, targetWeightKg, updatedAt, fetchedAt}` atomically,
  only when the content changed or `fetchedAt` is from an earlier UTC day. Unreachable / 404 / 421 /
  503 / a malformed body → a `WARNING:` line, the old file kept, exit 0 (never fails the sync).
  Why: the goal and target weight live in Postgres behind the LAN page, which the read-only coach
  subagents cannot reach — now they read a file.
- **Coach subagents** (`cycling-coach`, `hybrid-coach`, `nutrition-coach`) — the same "Shared rules"
  block in all three (user's language, not-a-doctor, never read `.env*`, sponsor / affiliate bias,
  auto-caption numbers "verificar") and the same "Owner facts" table: weight from the newest
  `weight.csv` rows (+ 7-day context), height / birthdate / devices / supplements / events from
  `profile.json`, goal + target from `settings.json` (missing / stale by `fetchedAt` said so), stable
  context from `about-me.md`; never numbers from profile prose; data freshness checked against TODAY
  (> 3 days flagged); days to each event from TODAY. `Bash` removed (`tools: Read, Grep, Glob`).
  Routing made explicit: fuelling, hydration, supplements and body-composition nutrition belong to
  `nutrition-coach`; the training coaches hand off ("para la nutrición, pregunta al nutrition-coach")
  and vice versa. `cycling-coach`: Edu's commercial ties listed, never estimates an unknown FTP
  (power curve / kJ / HR + a suggested test), adds the VitalControl SEM 42 EMS manual.
  `hybrid-coach`: Hyprogram synced by cron (Sun 21:15 / Mon 06:15), nothing before 2026-09-21
  (rolling window), read `semanas/` directly; the HYROX station weights table is "verificar" — point
  to the current official rulebook.

## 2026-10-05 — knowledge: Hyprogram "HP Hybrid" sync

- **`scripts/sync-hyprogram.mjs`** — pulls the owner's current training program ("HP Hybrid", at
  hyprogram.com) into `knowledge/hybrid/hyprogram/` for `hybrid-coach`. The site is a Next.js app
  behind NextAuth credential login (AWS Cognito server-side; no public client secret, no SRP needed);
  the script logs in with the owner's own account, then reads the program through the same-origin app
  API the web client uses (`/api/workouts/important_days` for the programmed dates,
  `/api/workouts/get_by_date` per day — athletes can view only a rolling recent window, so it
  early-stops at the window edge). Output: `raw/<id>.json` (the workout JSON, per-user data stripped),
  `semanas/<YYYY-Www>.md` (faithful Spanish render — sections, WOD, coach notes, loads, RPE, running
  distances) and `manifest.json` (incremental, per-date `fetchedAt`). Flags `--dry-run` / `--limit N`.
- **Security / etiquette** — credentials in `data/training/.env.hyprogram` (gitignored, 0600;
  `HYPROGRAM_ENV` overrides the path), read in-process and never logged; no password, token or cookie
  ever printed or written to disk; coarse errors only (`auth_failed`, `http_403`). Read-only GETs,
  sequential ~1.5 s apart, nothing on the account modified. `knowledge/*` stays gitignored.
- **Pure core** — `scripts/hyprogram-lib.mjs` (ProseMirror → Markdown, PII strip, ISO-week math,
  fetch-plan selection, manifest merge) with `scripts/hyprogram-lib.test.mjs` (`node --test`, zero
  deps). First real sync fetched 15 days (2026-09-21 → 2026-10-10, block "PREPARATORIO ESPECÍFICO"),
  3 week files.

## 2026-10-04 — knowledge: a nutrition-coach subagent

- **`nutrition-coach` subagent** (`.claude/agents/`) — read-only sports nutrition and supplementation
  coach over `knowledge/nutrition/` (`evidencia/`: AIS framework, IOC 2018, ISSN position stands,
  AESAN, WADA — the evidence base, which outranks influencers; `ferrandis/`: Andrea Ferrandis YouTube
  cards + transcripts, the practitioner source; optional `index.md` + `temas/`) plus the nutrition
  topics of the cycling and hybrid knowledge bases. Every claim cited, "Andrea dice" kept apart from
  the evidence, contradictions / sponsor bias / auto-caption numbers flagged, Spain context (AESAN
  limits, BEDCA, products sold in Spain), anti-doping warnings, not-a-doctor referrals and the
  methodology's safe deficit ranges. Grounded read-only in the plan (`plan-data.json` +
  `ingredients.json`), profile supplements and the Apple Health extract; it says the Postgres food log
  is out of its reach. Training questions stay with `cycling-coach` / `hybrid-coach`.

## 2026-10-02 — knowledge: a hybrid-coach subagent

- **`hybrid-coach` subagent** (`.claude/agents/`) — read-only HYROX / hybrid coach over
  `knowledge/hybrid/` (the HYP(R)ODCAST transcripts, coach Ferry's Dec 2025 – Jun 2026 program, the
  Training Culture 6-week block, the current Hyprogram "HP Hybrid" program once synced). Same rules as
  `cycling-coach`: every claim cited (podcast `&t=<seconds>s`, programs by file / month / week),
  auto-caption numbers and sponsor bias flagged, sources kept apart from `analysis/methodology.md`,
  advice grounded in the owner's workouts, running dynamics and recovery, and a program-vs-reality
  comparison when asked. Cycling questions stay with `cycling-coach`.

## 2026-10-02 — knowledge: YouTube transcript ingest + a cycling-coach subagent

- **Knowledge base** — new `knowledge/` folder, gitignored except its README: transcripts of
  third-party expert content stay local (personal use), one folder per source with a
  `manifest.json` and `raw/<date>-<id>.md` transcripts.
- **`scripts/ingest-youtube.mjs`** — repeatable, incremental channel ingest over an external
  `yt-dlp`: lists the videos / streams tabs (no shorts), downloads only the subtitles (manual over
  the original-language automatic captions; a machine-translated track is never used), converts VTT
  to `[mm:ss]` paragraphs with the rolling auto-caption repeats removed, records every video (also
  `subs: none`) atomically, paces requests and retries. Pure helpers in
  `scripts/youtube-transcript.mjs` with synthetic-VTT unit tests.
- **`cycling-coach` subagent** (`.claude/agents/`) — read-only coach that applies the first
  source's criteria (cycling coach Eduardo Talavera), cites title + timestamped URL for every claim,
  keeps "what the expert says" apart from `analysis/methodology.md`, and grounds advice in the
  owner's ride data.

## 2026-10-02 — nutrition: server-side goal + target weight, weight progress, food log adherence

- **Settings on the server** — `sql/007_settings.sql` (`app_settings`, one row, its own optional
  migration group) + `GET / PUT /food/settings` behind every food-route layer (no nginx change). The
  LAN page's goal now lives on the server (phone and Mac agree; the server copy wins, `hc.nutri.goal`
  is the offline cache, a stored local goal is pushed once to an empty server); the profile sheet
  gains "Peso objetivo" (kg, inline errors, saved on blur). Without the API nothing changes.
- **Progreso** — weight vs the goal from the baked 7-day average: rate = least-squares slope over 28
  days (≥ 8 averages over ≥ 21 days, else "pocos datos"), status vs the goal's band from
  `analysis/methodology.md` (cut 0.25–0.5, bulk 0.1–0.25 kg/week, never > 1 % of bodyweight a week;
  maintain stable within ±0.1), kg to go + an ETA from the observed rate ±20 % (LAN, with a target),
  "mixes scales: trend only". Tap → the weight sheet, target dashed. (The first draft used 0.25–0.5
  for bulk too — a brief error, fixed in review.)
- A goal picked while the server is unreachable stays pending (`hc.nutri.goalPending`) and is retried;
  assumed rest days (sleep, no session) are labelled and kept out of the adherence means.
- **Constancia** — `GET /food/log/summary` (per-day sums + entries per group, ≤ 120 days; shared
  `daySummaries`, service copy pinned) → logged / complete days (breakfast + lunch + dinner), mean
  kcal vs target and protein days over complete days only, 7 / 14 / 28-day switch and a 28-day strip
  that opens Registrar on a day. Past days get their day type from `DETAIL.sessions` (`dayInputFor`);
  an unknown type is counted apart, never compared.
- Rollout: ingest rebuild (`docker compose up -d --build health-ingest`), then `npm run generate`.

## 2026-10-02 — web: slimmer inlined scripts; advice and today's eating first on Inicio

- **Inlined client scripts lose their comments** — `web/layouts/Plan.astro` now inlines every
  `web/src/client/*.js` through `web/src/slim-script.mjs` `slimScript` (esbuild `transformSync`; esbuild is
  declared at the exact version astro / vite already lock): whitespace and every comment out,
  identifiers and syntax untouched, still classic scripts. Example page: 539,126 → 425,229 bytes raw
  (−21 %), 149,988 → 116,931 gzip (−22 %); inline script 416 → 302 KB. Sources keep their comments.
  Build-output tests that located a script by slicing its raw source now compare against
  `slimScript(source)` (the WHOLE script, a stronger check than its first 200 characters); regexes over
  built code tolerate the re-printed quotes / whitespace. Builds stay byte-identical.
- **Inicio order** — dials → advice sentence → "today you eat" card → health monitor → timeline →
  programmed session (was dials → monitor → timeline → advice → eat card). `Home.astro` now renders
  the eat card itself; ids, openers and the monitor's sleep card are unchanged.

## 2026-10-02 — web: past-day intake target, one date format, one recovery unit

Three consistency fixes from an audit of the page, each pinned by tests.

- **Intake rings judge a past day against THAT day** — when the newest logged day (within the last 3)
  was not the viewer's today, the rings still measured it against today's goal × day type. New
  `HCNutri.targetFor(date)` (client/nutri-day.js): today = `nutriTarget()`; a past day = its own
  detected day type (the same `detectDayType` port over `SCORES.timeline` + `TRAINING`, its recorded
  ride minutes for the fuel) × the current goal, labelled "Objetivo / Comidas de ese día"; today's
  manual override and picked ride minutes never leak into it. When the day type cannot be determined
  (no timeline row and no programmed session) it returns `null` and the rings are HIDDEN: a ring is a
  fraction of a target, and a guessed target would colour the day over / under for no reason.
- **One date format** — every user-visible date in the client scripts goes through `HC.fmtDate`
  ("Tue 29 Sep" / "mar 29 sept"): the monitor card date, the timeline heading, the dials' and cards'
  "as of", the recovery night label, the load caption's "last session", the pre-epoch note, the
  calendar cell titles and stale note (raw ISO before), and the Salud sparkline axes / run and ride
  tables, the workouts dashboard, the programmed session and the intake rings (`toLocaleDateString`
  before, whose ICU output varies by browser). ISO stays in data attributes. A guard test fails on any
  `toLocale*String` / `Intl.DateTimeFormat` / `DATE_LOCALE` under `web/src/client`; the test harness
  bakes `I18N_DATE` like the page.
- **One recovery unit** — the dial and the sheet said "sd", the Salud card and the advice "MAD".
  `RECOVERY_UNIT` (en "SD", es "desv.", `lib/score/advice-copy.mjs`) now builds every recovery string
  (advice, dial, card, monitor note, detail sheet); score.js reads `recovery.unit`, and the card adds
  one line: "SD = typical spread: values are in units of your own typical day-to-day variation over
  the last 42 days, not a grade." (es "variación típica"). The advice snapshot was updated on purpose.

## 2026-10-02 — web: the open tab lives in the URL hash

A reload on Nutrición opened Inicio: `setTab` persisted nothing. The open top-level tab now lives in
the hash (`#home` / `#entreno` / `#health` / `#nutricion`), so a reload, a bookmark and the midnight
rollover's reload reopen it.

- `core.js` `setTab` writes the tab hash with `history.replaceState` (never `pushState`: Back does
  not walk through tabs, it keeps closing the detail sheet); a legacy section key writes its hosting
  tab; a tab hidden by `page.hideTabs` is never written, and nothing is written while the sheet is
  open (its `#detail/…` owns the URL). On load a tab hash opens that tab; no hash, a hidden or an
  unknown one opens the default tab and the URL is replaced to match. `hashchange` to a visible tab
  hash switches tab; sheet hashes are left to detail.js, so the two listeners never fight.
- A deep link (`#detail/<metric>[/<date>]`, `#food-add`) opens its host tab underneath
  (`lib/nav/tabs.mjs` `DETAIL_TAB` / `VIEW_TAB`, baked in `NAV`, a test pins every `DETAIL_KEYS` key;
  `#profile` keeps the default tab). Closing a deep-linked sheet rewrites the URL to that tab hash
  (`window.HCNav.hash()`) instead of clearing it.
- Every history / location access is wrapped: a sandboxed frame still switches tabs.
- No element id may equal a tab key, or `/#home` would scroll past the dials to the advice host: the
  Inicio advice host is now `#home-advice` and the Salud host `#health-body` (a content test checks
  the built page). A deep link that opens no sheet (unknown metric, no data, bad date, a view the page
  lacks) is replaced by the tab hash at load; `#food-add` is left alone because its view registers
  only after the food API answers.

## 2026-10-02 — 82 everyday Spanish foods as log-only basics

The owner lives in Spain and logs from the food log's Basics search; many everyday foods (fish of the
day, charcuterie, a caña, a croqueta) were missing. 82 log-only basics (`swap: false`, `verified:
false`) were added to `data/nutrition/ingredients.json`: fish / seafood 14, meat / charcuterie 11,
dairy 9, carbs 9, veg 11, legumes 5, nuts / seeds 4, drinks 11, dishes / pastries 8.

- **Sources** — BEDCA (fetched from its query API) for 68 of them, kcal from the macros with EU factors
  (4/4/9, fibre 2, alcohol 7 for the wines, beer and vermouth); where two BEDCA entries of one food
  disagree (dorada, bonito), the one whose macros match its own energy. USDA FoodData Central for 7
  foods BEDCA lacks or leaves incomplete (picos, cuscús, harina — no fat value in BEDCA —, rice / corn
  cakes, textured soy, hummus): FDC energy, carbs by difference − fibre. Label values of the product
  sold in Spain (Open Food Facts barcode in the note) for 6 branded drinks: clara (Hacendado shandy),
  tinto de verano (La Casera), Coca-Cola, Coca-Cola Zero, Aquarius (the current recipe: BEDCA's entry is
  the older, sweeter one) and Cola Cao powder. Café con leche is computed from the DB's café + leche,
  like the cortado. Prepared dishes note that values vary by recipe.
- **Metadata** — typical `piece` weights (`typical: true`) for countable foods (caña 200 ml, copa de
  vino 125 ml, can 330 ml, croqueta 30 g, magdalena 30 g, cruasán 60 g, churro 20 g, ¼ pizza 100 g,
  flan 100 g, natillas / cuajada / kéfir 125 g, garlic clove 5 g, drained cans, a handful of nuts…);
  `weighed` raw / dry / cooked where it matters; `maxAmt` on every new carb food and sweet carb staple
  (natillas, flan, Cola Cao), as the cap test requires. Natillas and flan are `sweet` (they are carb
  staples by the 60 % rule, so they carry caps); sweetcorn is `veg` like peas.
- **Skipped** — secreto ibérico (neither BEDCA nor USDA has it), pan de pueblo (no BEDCA entry of its
  own: the same as the existing white bread), tortilla de patatas (no BEDCA entry; USDA's potato omelet
  has 3 g carbs, not a Spanish tortilla), salmorejo (no source); dry pinto beans (only the dry legume
  in BEDCA; canned chickpeas, lentils and white beans were added, 15–30 % below the cooked ones).
- **Budget** — FOOD_BASICS grew to ~20 KB (188 basics), so its test budget went from 16 KB to 24 KB.
  No plan number changes (log-only foods never enter Plan de hoy).
- **lubina fix** — the existing `lubina` basic cited a wrong FDC id (175137 is cooked coho salmon);
  it now comes from BEDCA 2344 'Lubina': 84 kcal, 18 P, 0 C, 1.3 F (was 97 / 18.4 / 0 / 2).

## 2026-10-02 — web: mobile quick wins

An audit of the page on a phone found five small problems; each is fixed with a guard test.

- **No iOS focus zoom** — iOS Safari zooms into a focused field whose text is under 16px (the food
  forms were 14.5px, the portion guide's and the ride-duration selects 13.5px). Under 900px one rule
  in `base.css` sets every text input / select / textarea (radios excluded) to the new `--fs-input`
  token (16px); its `:is()` selector out-ranks every form-control class rule.
  `web/test/mobile.test.mjs` checks the rule and that no form-control rule is as specific.
- **gzip on plan-web** — the one-file page compresses well; `gzip on` at server level (CSS, JS, JSON;
  text/html is implied), `gzip_min_length 1024`, `gzip_comp_level 5`, `gzip_vary on`. The four
  proxied ingest routes say `gzip off`: their responses reflect request input next to stored data (a
  BREACH-style length oracle) and are small. Rollout: `docker compose up -d` in `services/plan-web`.
- **Midnight rollover** — a page left open past midnight kept yesterday's dials, top-bar date,
  timeline, day type and rings (only the food log followed). core.js now reloads the page once when
  it becomes visible (or is restored from the back-forward cache) on another day than it loaded on
  (`HC.rolloverAction(loadDay, today, busy, hidden)`, pure, unit-tested), and waits while the page is
  busy: the detail sheet open, a Mis productos / Mis recetas editor open, or a text field focused —
  a half-filled form is never lost. A 1 s watcher runs only while waiting (stopped when the page is
  hidden or the clock is back on the load day, re-armed by visibilitychange / pageshow); a reload
  that throws (sandboxed frame) is retried only by a later event.
- **Ride-duration select** — `max-width: 100%` next to its 180px floor, so 16px text never pushes it
  past its card on a 360px phone (the longest option, "5 h 30 min", fits). nginx states the rule
  "every proxying block sets `gzip off`" next to `gzip on`, and the config test enforces it for every
  `proxy_pass`, not a fixed list.
- **Load-dial switch** — the gym / run / bike pills were 30px tall. They keep the compact look; a
  centred `::before` band makes the hit area 44px tall (and the pill at least 44px wide), and a
  wrapped row sits 14px lower so two bands never overlap.
- **Dark controls** — `<meta name="color-scheme" content="dark">`, `:root { color-scheme: dark }`
  (dark native select popups, scrollbars, autofill) and a `theme-color` read at build time from the
  `--ground-top` token (the top of the page background). Skipped on purpose:
  `apple-mobile-web-app-capable` + `black-translucent` — a home-screen app would draw the wide-screen
  sticky nav (`top: 0`) and the optional header under the status bar, which carry no top safe-area
  inset.

## 2026-10-02 — plan-web: the Shortcut upload route

The owner exposes plan-web publicly through an SSO tunnel and keeps the ingest service unexposed, so
the iOS Shortcut must reach ingest through plan-web.

- **nginx** — `location = /ingest/health-auto-export` (exact, POST only) → ingest's same route:
  `Authorization`, `Automation-Name` and `Content-Type` forwarded (ingest checks the bearer),
  a request without a `Bearer` token refused with `401` before the body is read,
  `client_max_body_size 8m` (≤ ingest's `MAX_BODY_BYTES` default; the Shortcut sends a few hundred KB),
  a 1 MB in-memory body buffer, 60 s send / read timeouts; under the same server-level Host allowlist
  (421). Any other
  `/ingest/*` path stays 404; `/export/*` and `/sync/strava` are still never proxied
  (`scripts/plan-web-config.test.mjs`).
- **Hardening (security review)** — a server-level guard next to the Host check answers `400` when the
  raw path (before `?`) holds `..`, `%2e`, `%2f`, `%5c` (any case) or `//`: an SSO proxy may match its
  bypass rules on the raw path while nginx serves the normalized one (`/ingest/%2e%2e/index.html` →
  the page). No path the page, food log or Shortcut uses contains them (food ids are numeric, search
  text and dates are in the query string).
- **Docs** — `docs/ios-shortcut.md` ("Through plan-web": `https://<your-host>/ingest/health-auto-export`
  + `https://<your-host>/api/sync`, bypass SSO for exactly those two paths) and
  `services/plan-web/README.md` ("Exposing behind an SSO tunnel": one resource → plan-web:8090, bypass
  `/ingest/*` and `/api/sync` (exact, never a prefix), the public host in `PLAN_WEB_EXTRA_HOSTS` +
  `FOOD_ALLOWED_HOSTS`, an outside check that `/ingest/%2e%2e/status.json` is refused, `INGEST_TOKEN`
  ≥ 32 random bytes since it also guards `/export/*`).
  Rollout: `docker compose up -d` in `services/plan-web`.

## 2026-10-02 — Tablas: no empty sections

- **Tablas** — a list section (desayunos, carbo, proteína, anclaje, post-entreno, fruta, postre,
  verduras, quesos) renders only when it has rows; a plan whose list holds only the "none" option no
  longer shows an empty accordion. The owner removed his composite options (breakfasts, post-workout
  combos) from his personal plan, which left two such sections. Pinned on both builds
  (`web/test/content.test.mjs`; the personal check skips without a personal build).

## 2026-10-02 — Registrar: a day navigator

The owner logged meals the day before and could not see them: Registrar only read the viewer's today.

- **Page** — `‹ <date> ›` at the top of Registrar (static markup in `Dia.astro`: real 44 px buttons
  "Día anterior" / "Día siguiente", an `aria-live` label "Hoy" or `HC.fmtDate`, next disabled on
  today, "Volver a hoy" only on another day). A past day loads `GET /api/food/log?date=` and renders
  the same four group cards, day total ("Total del día"), delete and "+ Añadir"; the add sheet logs to
  that day (its title names the date) with the same request-id / ambiguous-retry / re-read flow. The
  viewed day is not persisted: the page always opens on today.
- **Contracts unchanged** — today's log stays in its own slot, so `window.foodTotals()`,
  `HCFood.groupTotals()` and `HCFood.addGuide` remain TODAY-only; an add / delete on a past day leaves
  today and Resumen de hoy untouched. A slower answer for a day already left is dropped (one read
  sequence per past day). The midnight reload moves a viewer on "today" to the new today and keeps a
  viewer on a past day there, refreshing today's totals.
- **Review fixes** — a sheet opened on "today" resolves the date at each save (one opened at 23:58 and
  saved at 00:02 logs to the new day); a delete drops its row by id from the CURRENT log of that date,
  so a re-read while it was in flight cannot resurrect it; a failed past-day read offers "Reintentar".
- **Layout** — the navigator sits on Registrar's heading line (title left, navigator right) instead of
  a row of its own; the back-to-today button is a short "Hoy" (aria-label "Volver a hoy") before `‹`.
- **Server** — none: `POST /food/log` already accepts any valid date (2000–2100). No rebuild needed;
  `npm run generate` (or the hourly refresh) publishes it.

## 2026-10-01 — Recipes can use the public basics

The owner asked to build recipes with generic foods (huevo, plátano, leche…) without first adding them
to Mis productos.

- **Model** — a recipe ingredient is a product `{productId, amount}` or a basic SNAPSHOT `{basic, name,
  unit, amount, per100}` taken from FOOD_BASICS when the recipe is saved (per 100 g / ml, per unit for a
  `ud` food), so a later ingredients.json change never alters a saved recipe. `food_recipe.ingredients`
  is JSONB: no migration, old rows read and write unchanged.
- **Formula** — `ingredientBasis` + `recipeBasis` (lib reference, ingest copy, page copy) add products
  and snapshots with one formula; new `FOODLOG_CASES` (mixed recipe per serving and batch, basics only,
  a broken snapshot) and `basicIngredient` `BASIC_CASES` pin all copies. New shared constants
  `RECIPE_BASIC_UNITS`, `BASIC_UD_AMT`, `FOOD_LIMITS.basicKeyPattern`.
- **Service** — strict validation of a basic (key pattern, name, unit, amount, per-100 bounds, 2
  decimals), `400 atwater` on a snapshot unless `force: true` (not stored); routes, security layers and
  the 16 KB cap unchanged (a 20-ingredient recipe with long names is ~2.6 KB; the 40-ingredient worst case, every string at its cap, ~12 KB).
- **Page** — each ingredient row is a search ("Mis productos", then "Básicos · valor medio"), natural
  units with the pieces ↔ g / ml toggle, "valor medio" tags in the list and the editor, "save anyway"
  on `atwater`, a recipe of basics only allowed.
- Rollout: rebuild the ingest image (`docker compose up -d --build health-ingest`), then
  `npm run generate`.

## 2026-10-01 — Daily energy: one source per day by precedence

The Watch-only energy rule below (fallback to every source only when the whole export had no Watch
energy) dropped ~1,300 days of the owner's history: active-energy-daily went from 1,622 to 321 rows,
because before the Apple Watch (late 2025) energy came from Zepp, Mi Fit and the iPhone. It is
SUPERSEDED: per day and type extract.js now picks ONE source by precedence — Apple Watch > a
dedicated wrist-wearable app (Zepp, Mi Fit, Amazfit, Garmin Connect, Polar Flow, Fitbit, Huawei
Health) > iPhone — and writes only its sum, never a sum across sources. Scales (RENPHO's BMR) and
training / nutrition apps (Hevy, Nike, Strava, YAZIO, Merge…) never count; a day with only those has
no row. The whole-export fallback is gone (the iPhone rank covers phone-only users). `_meta.json`
`energySources` now counts the days each source family won per type. Needs a re-run of
`node data/apple-health/extract.js` on the export.

## 2026-10-01 — Data-integrity fixes from the real-data audit

A read-only audit of the owner's extract found eight ways bad rows reached the page; each is fixed
in code, with synthetic tests.

- **Partial last export day** — export.xml taken early on 2026-08-20 left a 971-step / 1-min / 103 kcal
  day that beat complete Shortcut totals ("export rows always win"). extract.js now records
  `exportLastDate` (`<ExportDate>`, else the newest record date) in `_meta.json` and skips that date
  in the daily TOTAL series; the Shortcut sync treats it as a sync-owned date for `total: true`
  metrics (Shortcut row wins, export row dropped when there is none).
- **New Shortcut keys** `exercise_watch` / `distance_watch` / `flights_watch` (Watch-filtered day
  totals → exercise-minutes / distance / flights CSVs; distance in km, `m` / `mi` accepted).
- **Stale Salud trend cards** are greyed with "sin datos recientes" past `STALE_DAYS`, client-side.
- **Weight source + phantom weights** — `weight` takes an optional source field like `bodyfat`; an
  exact-midnight (local or UTC) Shortcut weight with no body fat within ±10 min is dropped.
- **Energy** — extract.js sums only Apple Watch sources (RENPHO's weigh-in BMR doubled basal); a day
  without Watch energy is missing; a phone-only export keeps every source.
- **Strava sports** — tennis and other racket / team / outdoor sports map to Apple types in `other`
  (a Watch + Strava tennis day is one session); unknown sports fall back to `Unmapped`, no longer
  `Other` (gym). `Other` stays gym: the Watch's generic label, also Strava's `Workout`.
- **Sleep** — falling back asleep after an early wake-up (a block ending before 10:00, gap ≤ 3 h)
  joins the night; later-ending naps keep the 60-min cap.
- **RHR** — deduped by timestamp only (Apple rewrites the day's value at the same stamp).

Owner actions: re-run `node data/apple-health/extract.js` on export.xml (energy + partial day), add
the three Shortcut keys and the weight source field (`docs/ios-shortcut.md`), then
`npm run sync -- --full` and `npm run generate`.

## 2026-10-01 — Power-meter ride days correct the Watch's active energy

A ride recorded by a bike computer with a power meter (and not by the Watch) was under-counted by
the Watch's Active Energy (real case: a 2,311 kJ ride, 1,821 Watch kcal over the ride hours, a 2,207
kcal day). Now corrected active(day) = Watch day − Watch energy during the ride + ride kJ ×
`KJ_TO_KCAL` (1.0), only for rides with kJ AND `device_watts: true`, only when the Watch's hourly
buckets cover the whole ride window, and only when it RAISES the day (`lib/health/ride-energy.mjs`;
buckets prorated by overlap, instants compared so DST and the host timezone do not matter, a ride over
midnight split by time, duplicate overlapping rides counted once). Inputs: a new Shortcut key
`active_energy_hourly` (Watch-only, Group by Hour, 3 days → `active-energy-hourly.csv`, oldest hour of
each payload dropped, latest payload wins) and a new `rides.csv` from `sync:strava` (local start with
offset, elapsed s, kJ, device_watts) — a separate file rather than new workouts.csv columns, since the
window is Strava-only data with one reader. `GET /export/strava` now also returns `start_utc` and
`device_watts` (ingest image rebuild needed; an old image leaves them blank, the sync warns and nothing
is corrected). `readActiveEnergy` is the one reader of the Salud expenditure card and the detail
sheet's `energy`: the raw CSV stays untouched, the card says "incluye la salida medida con
potenciómetro" on a corrected headline day (+ a note with the corrected days of the window), and the
detail day panel shows "reloj <n> + corrección por potencia" under Activa. Note: with proration the
literal case lands near 2,744 kcal for an even-ish hourly split, not the full-hour 2,697 (the partial
first / last ride hours keep part of the Watch's energy).

Follow-up after review (same day): the Watch day in the formula is max(daily row, sum of that day's
hourly buckets), so a stale daily total cannot skew a correction; each midnight of a ride over
midnight is placed with the offset of that day's 00:00 bucket (DST); overlapping power rides are
clustered by interval union (a nested ride no longer slips through); a power-ride day the hourly
data does not cover is flagged and the Salud card / detail day panel say it was not corrected;
`_meta.json` records rides.csv (`rows.rides`, `stravaSync.rides`). Also fixed a pre-existing bug:
`npm run sync -- --full` passed `--full` to node itself (args before the script path) and aborted;
`scripts/sync-all.mjs` now forwards arguments after the script.

## 2026-10-01 — Plan de hoy becomes a portion guide (trial, branch `feat/portion-guide`)

Owner feedback: Plan de hoy is useful only as an orientative "how much can I eat"; the menu structure
was not (add-ons that changed by day type — coffee on rest days, pre / post on gym days —, option lists
that could never be complete, imposed items). Plan de hoy now shows ALWAYS the same four blocks —
Desayuno, Comida, Cena + Extras — and the day type / goal only change the amounts
(`lib/nutrition/guide.mjs`, ported line by line in nutri-day.js with parity tests). Each main meal's
budget = the solved plan meals of its slot (`planFor`, caps and water-fill as before, no picks); Extras =
the meals target − the three (it absorbs the add-ons and whatever capped plates leave over; never
negative). A main meal is a plate by parts: protein / carbs / vegetables (free) / fat, each macro with
ONE example food from a native select (the public basics of its categories + the owner's products when
the food API answers) and the amount of it that supplies the macro, in its natural unit, capped at its
`maxAmt` ("(máx.) + completa con otra fuente"). Defaults = the food the base plan uses there, else
chicken / rice / olive oil; picks persist per viewer (`hc.nutri.guide`). Extras = a budget line + example
costs (a new tracked `cortado` basic, BEDCA / USDA average) and "split it before and after training" on
training days. With the food log (LAN page) every meal shows what is left, "✓ covered" rows, "Left
today", and a "+" per macro row logs the example amount (`HCFood.addGuide`). Removed: the choosable
blocks (`lib/nutrition/blocks.mjs`), the automatic snack (`lib/nutrition/snack.mjs`), the Añadidos card,
`hc.nutri.picks`, `HCNutri.todayPlan()`, the add sheet's "Del plan" tab, the remainder / macro-off notes
of Resumen de hoy (the bike-day "meals + ride fuel" line stays), the per-category swap rules
(`CAT_RULES`), `isFlexItem`, and plan-tables.md's Snack column. NUTRI on the example: ~19.7 KB → ~3.6 KB;
FOOD_BASICS +1.7 KB (each food's category and portion cap). Avituallamiento, Tablas and the food log's
Registrar are unchanged.

## 2026-10-01 — Plan de hoy adds an automatic snack when the meals fall short

With realistic portion caps the owner's five meals often end below today's target (maintain gym −209,
bike −229, bikeLong −299 meal kcal; bulk −366…−599) and the page only said "add a snack". Now
`planFor` adds one: after the capped carb solve, a shortfall beyond the 75 kcal tolerance gets a
"Tentempié" / "Snack" add-on sized to it (`lib/nutrition/snack.mjs`). Six tracked options built from
the public food DB incl. the log-only basics (fruit + yogurt, banana + quark, yogurt + cereal, toast
with oil and tomato, turkey sandwich, nuts), each a small recipe scaled as a whole by one factor with
snack-sized line caps (water-filling, half pieces, 5 g); default = the first that covers the
shortfall, a pick persists in `hc.nutri.picks` (`snack/auto`). A plan with its own snack-slot meal
(merienda, protein anchor) gets the snack inside it, never a second one. Totals, macro notes and "Del
plan" include it. Bike days: the ride fuel keeps only what fits the top of its g/h range (nothing for
`bike`, fixed at 60 g/h, so "add 60 g more to the ride" no longer contradicts Avituallamiento); the
rest becomes the snack. The example plan's shortfalls drop from 95–835 kcal to ≤ 48 kcal on most days
(bulk gym / bike / bikeLong keep 214–304 kcal: the largest snack at its caps, plus the ride's headroom).

## 2026-10-01 — Food log basics: log an egg without creating a product

The owner wanted to log generic foods (egg, milk…) without first creating a product in Mis productos.
The add sheet's product search now also looks in the public food DB (`ingredients.json`, baked as
`FOOD_BASICS` by `lib/nutrition/basics.mjs`): an empty search lists only his products, typing adds a
"Básicos" group after them (accent- and case-insensitive, "platano" finds "Plátano"), marked "valor
medio". A pick takes an amount in the food's natural unit (1 piece / 100 g / 100 ml, pieces ↔ grams for
countable foods) with a live preview, and is saved as ONE quick entry with its four macros and the
amount in the label ("Huevo · 2 ud (~100 g)") — no DB change, the same idempotent request-id flow. The
formula lives in `lib/nutrition/foodlog.mjs` (`basicEntry`, `basicLabel`, …) with a parity-tested port in
food.js. 25 common basics were added to the food DB with average BEDCA values (USDA FoodData Central
where BEDCA lacks the food; quark: typical Spanish label values, no table entry), `verified: false`,
the source in each note; they carry `swap: false`, a new flag that keeps a log-only food out of Plan de
hoy's food blocks, so the plan's options, NUTRI (still < 20 KB) and every plan number are unchanged.
Cooked chickpeas and lentils already existed. Page bake +~9.5 KB (104 basics).

## 2026-10-01 — Realistic portions: caps, water-filling, Registrar first

The owner's maintain gym day (3050 kcal) asked for 235 g of dry pasta at lunch: only the 2–3 parts
marked `flex: "carb"` scaled, so every extra carb piled onto them. Now every carb / fruit food (and a
sweet carb staple such as honey or jam) is carb-flex by its category (`lib/nutrition/flex.mjs`;
`flex: null` opts out), and an optional per-food `maxAmt` in the tracked `ingredients.json` caps a
portion (pasta / rice dry 150 g, oats 100 g, potato 400 g, gnocchi 300 g, bread ~3 pieces, fruit
~1.5–2 pieces, honey / jam 30 g), validated by `npm run check`. The solver became water-filling: one
common factor, a part past its cap held there and the factor re-solved over the rest until stable,
same clamps, rounding and ud re-solve, ported line by line to the page (parity tests). When nothing
can grow the remainder suggests a snack, not a bigger plate, and the factor line says when portions
are at their maximum. The example plan's numbers changed on purpose (PINNED_TOTALS re-pinned): its
carb parts now stop at realistic portions (largest potato 660–770 g → 400 g), so most of its 12 plans
end 95–835 kcal short and say so. Nutrición now opens on Resumen de hoy, then Registrar, then Plan de
hoy collapsed in a `<details>` (open state per viewer), then Avituallamiento. Cheese (tranchete,
mozzarella) moved from `dairy` to its own `cheese` category so it is never offered for milk. Tablas'
"Reference" header is left-aligned like its cells.

## 2026-10-01 — Every food in Plan de hoy is choosable (food categories)

The owner objected to imposed fixed foods ("no tiene sentido que me marques que tengo que comer
calabacín sí o sí"): only `{use, match}` parts were selects, while `{ing}` parts — courgette at lunch /
dinner, the milk in the after-lunch coffee, the pear of the protein anchor, the pre-workout's milk +
bread roll + honey, the cooking oil — were fixed. Every ingredient of the tracked `ingredients.json` now
has a food category (`cat`, closed set in the new `lib/nutrition/categories.mjs`, validated by
`npm run check`), and a fixed `{ing}` part is a FOOD block: a select of the foods of its category,
plus "none" for veg / fruit / sweet / dairy / drink / sauce. One explicit rule table says what a swap
keeps equal (protein grams, carb grams, fat grams, kcal or the same weight), clamped 0.5–2× like the
protein swaps; the whole day is then re-solved by the carb-flex engine. Generic: no personal-plan
migration. The page ports it line by line (parity tests); the no-pick plan is unchanged byte for byte
(pinned totals of the 12 plans; on the owner's plan all 36 plan × ride cases checked identical);
"Del plan" logs what was picked and leaves skipped foods out. NUTRI on the example: ~10.5 → ~17.9 KB.

## 2026-10-01 — Three main meals + one "Añadidos" group (Plan de hoy, Registrar)

The owner disliked separate full cards for small things ("Café (tras comer)" on rest days,
"Pre-entreno" on training days). Plan de hoy and the food log now show only three main meals —
Desayuno, Comida, Cena — plus ONE "Añadidos" / "Extras" group for everything else (pre / post
workout, protein anchor, after-lunch coffee, cooking oil, snacks). `lib/nutrition/slots.mjs` holds the
classification (`MAIN_SLOTS`, `isMainMeal`, `MEAL_GROUPS`, `mealGroup`, `ADDON_SLOT`), baked for the page.
Plan de hoy renders add-ons as compact rows of one card (kcal = the sum of its rows; block selects,
scaled arrows and supplement lines kept); Registrar shows four groups, add-on entries tagged with their
stored slot; the add sheet's meal select offers the four groups (Añadido → `snack`, or a plan add-on's
own pre / post workout slot) and "Del plan" lists the main meals then each add-on. Display only: the
food-log slot enum and schema are unchanged, and a test pins `planFor`'s totals for all 12 plans.

## 2026-10-01 — Plan de hoy by blocks; Tablas = fixed reference values

The owner never knows in advance what he will eat, but Plan de hoy showed one fixed day and the variety
of his option lists only lived in the removed day builder; Tablas meanwhile showed old train / rest
portions that contradicted the scaled plan. Now a dayPlan part that points at an option list is a
choosable BLOCK (`lib/nutrition/blocks.mjs`): a compact select in its meal card lists that list's
options (grouped like the tables); protein lists (proteina, anclaje, postentreno) scale the pick to
the default's protein grams, every other list takes the option's own amounts, and the carb-flex
engine re-solves the whole day so it still lands on target − ride fuel. Picks persist per viewer for
the day (`hc.nutri.picks`), the page ports the logic line by line (parity tests over every pick), and
`HCNutri.todayPlan()` — hence the food log's "Del plan" — logs what was chosen. Countable foods got
natural-unit metadata in the public `ingredients.json` (`piece`, `weighed`, validated by `npm run
check`): Plan de hoy shows them in pieces with the grams reference and rounds their scaled amounts to
half pieces. Tablas is now server-rendered reference values per natural unit (`lib/nutrition/
reference.mjs`), with no portions and one table per carb list; plan-tables.md writes the same rows.
The example plan's protein / anchor / rest breakfast parts became blocks (same numbers; rest rice
130 g so the bulk day still fits without the breakfast's flex bread). Food-API recipes as extra
breakfast options were left out (view-time only, outside the baked lists).

## 2026-10-01 — Day builder removed; the food log logs the plan ("Del plan")

The Constructor de día (section `registro`) was redundant next to the food log, so it is gone with
its script, copy, styles and builder-only bakes. Its replacement is a "Del plan" tab in Registrar's
add sheet: today's Plan de hoy meals, exactly as the page shows them (same goal, day type and ride
minutes, read through `HCNutri.todayPlan()`), logged in one entry per meal or per item as a quick
entry with its four macros (no database change). The Tablas tables are now painted by
`client/tablas.js`, and the shared bake renders once from `pages/index.astro`. `page.hideTabs:
["registro"]` keeps building as a deprecated no-op. The builder fold's "no food logged" hint is
dropped on purpose (the dial shows the target; the food log is the way to log).

## 2026-09-30 — Nutrition v2, part 2: food log, my products, my recipes

The owner logs what he eats from the LAN page. Nutrición gains Registrar (today's log by meal slot,
right after Plan de hoy) with an add sheet (his products grouped Mercadona / Dia / Eroski / other, his
recipes, or a quick label + kcal), and two folds next to the day builder: Mis productos (barcode or
text lookup on Open Food Facts, done by the ingest service; every value confirmed or typed from the
label before saving, missing ones flagged, never guessed) and Mis recetas (per-serving recipes such
as tortitas or a shake, batch recipes such as lentejas weighed cooked; macros always computed from
the products). Today's log fills the kcal dial, the macro bars and the rings; without entries the
Apple Health intake shows as before.

Storage and API live in `services/health-ingest` (`sql/006_food.sql`, `/food/*`; log entries keep a
macro snapshot so later product edits never rewrite history), reached through plan-web's new
`/api/food/` proxy. The routes are unauthenticated and LAN-only like `/sync`: a required
`X-HC-Food` header plus JSON bodies force a CORS preflight the service never approves, bodies are
capped at 16 KB, writes rate limited, errors coarse codes; a public proxy must never forward
`/food/*`. The UI ships hidden and appears only when the API answers at view time, so the claude.ai
artifact and the example build are unchanged and builds stay byte-identical. One macro formula
(`lib/nutrition/foodlog.mjs`) with parity-tested ports in the service and the page. Rollout: rebuild
the ingest image, restart plan-web, regenerate. Out of scope: label OCR, supermarket scraping, CSV
export of the log for the analysis pipeline (next slice), Apple Health write-back.

Review fixes, same day: plan-web answers only an IP literal, `localhost` or a listed name
(`PLAN_WEB_EXTRA_HOSTS`) on every path, and the food API repeats the Host check plus an Origin check
on writes, closing DNS rebinding. Numbers are rounded before their bounds; a failed food migration
only disables `/food/*` (503); adds carry a request id so a retry never duplicates; a double-tapped
delete is quiet; a macro no entry states shows a dash and a partly-known one is marked "≥". The
Open Food Facts client caches upstream failures briefly and shares concurrent lookups; the shared
limits and the recipe-basis step live once in `lib/nutrition/foodlog.mjs`; the detail sheet's Tab trap
skips controls that cannot take focus.

## 2026-09-30 — Nutrition v2, part 1: goals, day types, scaled plan, ride fuelling

Nutrición opens on today. A goal (maintain / cut / bulk) and a day type (rest, gym or run, a ~2 h
ride, a ride over 2.5 h — detected from today's workouts or programmed session, overridable for the
day) pick one of 12 targets (`targets.byGoal`, carbs as the remainder, approved defaults when
absent). Plan de hoy scales the plan's carb-flex parts by one clamped factor to hit it and says what
is left over; ride days add before / during / after fuelling ranges (orientative); supplements from
`profile.json` sit under their meal. Registro is now "Constructor de día" / "Day builder". Existing
personal plans upgrade with `scripts/migrate-plan-v2.mjs` (dated backup, idempotent). Logging and a
product catalogue are part 2.

The goal later moved out of the way (owner feedback: too prominent): Resumen de hoy keeps only the
day-type selector and shows the goal as a small chip next to today's kcal; the chip opens the profile
sheet, whose new "Objetivo" setting (first section) sets it, with each option's kcal/day change vs
maintain derived from the targets. Same storage key (`hc.nutri.goal`), same refresh path.

Review fixes, same day: only real training raises the day type (walks, commutes and stubs no longer
make a rest day a gym day); the ride's minutes re-scale the meals (the page re-solves from a baked
scaling model, a picked duration is kept for the day); whole-unit portions round first and the gram
portions absorb the rest; the train/rest toggle is gone — the day builder and the intake rings use
today's target (on ride days the meals part, with the ride fuel on its own line); a lighter manual
day type gives way to a harder one detected later, with a note. The migration marks staples only
(fruit and honey opt-in) and `--reset-flex` re-derives the markers of an already-migrated plan.

## 2026-09-30 — Profile sheet (avatar button)

A round avatar at the right of the top bar (photo, initials or a generic icon) opens a
Strava / WHOOP-style profile in the existing detail sheet (`#profile`): name, age (computed on the
viewer's device), city, height, latest weigh-in, Strava bikes and shoes with kilometres (a gentle
replace hint on shoes past ~700 km, retired gear folded) and devices (manual + seen on Strava
activities). The ingest service now keeps a 24 h Strava athlete + gear snapshot and serves it at
`GET /export/athlete`; `npm run sync` pulls it and the avatar into gitignored `data/profile/`;
`profile/profile.json` (template `profile.example.json`) holds the manual fields and wins over
Strava. Gear needs the `profile:read_all` scope; without it the page says how to re-authorize.

## 2026-09-30 — On-demand page refresh + data freshness

The LAN page no longer waits for the hourly cron: a Sync button (and a last Shortcut step) calls
health-ingest `POST /sync` (unauthenticated), which assigns a persisted sequence number, pulls
Strava (at most once per 5 min) and atomically writes the seq to a trigger file; a systemd path unit
on the host runs `refresh.sh` (as the repo owner, hardened). Repeated clicks coalesce onto the
pending seq (at most one rebuild per minute, never a `429`); a call inside the 60 s window after
a finished write gets a new, deferred seq written when the window closes, so a Shortcut payload sent
right after a rebuild is never left unpublished. `refresh.sh` publishes
`site/status.json` `{publishedAt, commit, branch, processedSeq}`, re-runs (max 3 passes) when the seq
advanced mid-run, reports early exits as coarse codes (`branch`, `install`, `build`, `sanity`,
`lock`) without touching the last good publish, publishes only `main` and time-boxes each step
(`npm ci` 900 s). The page waits for `processedSeq >= seq` (no clock comparison) and fails fast
with a reason. The header shows how old the Shortcut, Strava and page data are (`GET /sync/status`,
timestamps + coarse codes only, cached 5 s). Strava refresh-token rotation is persisted with
retries; `/healthz` flags Strava stale 6 h after its last persisted success.
Details: `CLAUDE.md` (LAN page + on-demand refresh), `services/plan-web/README.md`.

## 2026-07-01 — Whoop redesign, design tokens & per-run distance

Full visual redesign of the published artifact to a Whoop-style dark dashboard, a tokenized
design system, and a new per-run distance metric.

- **Whoop dark theme** across all tabs: dark-always `:root` (dropped the light media query),
  recovery-green accent `#15E26A` + strain-blue for volume/load, the lean/mod/fat zone colors
  reused, hero numbers in a monospace stack, accent glows + a radial-gradient atmosphere. Pure
  `<style>` rewrite — every class name kept, no GEN region touched.
- **Navigation restructured**: the top pill tabs became a fixed **bottom tab-bar on mobile**
  (icon over label) and a fixed full-height **left sidebar on desktop** (≥900px), with the
  content full-bleed (no max-width cap). The Entreno/Descanso toggle moved out of the nav into
  the content flow. Each tab split into `.tico`/`.tlbl` spans; `id`/`onclick`/`aria` preserved
  so `setTab`/`setDay` are untouched.
- **Design system fully tokenized**: brand colors as `--accent-rgb`/`--strain-rgb` triples so
  `rgba()` glows track a single source; consolidated **type (11 steps), radius (6), space (12)**
  scales replacing 22 ad-hoc font sizes / 11 radii / ~94 spacing literals. Layout-shell
  dimensions (sidebar width, `calc/clamp/env`) deliberately left literal.
- **Per-run distance**: `extract.js` now reads each workout's `DistanceWalkingRunning` child
  stat → `workouts.csv` gains a `distance_km` column (appended, so `generate-training.js` column
  indices are unaffected). `generate-health.js` joins running-workout km by date into the
  **Salud → Carrera** table (new Dist column, which also now spans the full desktop width).
  Distance shows `—` on days with no matching running workout — honest, not guessed.
- Desktop grids fill the width (auto-fit) on Salud tiles, Mi día meals and the Registro form
  (centered). Verified: `npm run check` OK, `npm test` 61/61 (+1 for the distance join),
  GEN 14/14. Both `plan-web.html` (es) and `plan-web.template.html` (en) updated; artifact
  republished.

## 2026-06-30 — Per-workout HR → intensity + load-vs-recovery

Made the training data carry intensity, not just duration, and used it for the one analytical
view Strava can't build for a strength/HIIT athlete.

- `extract.js` now keeps each `<Workout>` OPEN across lines (`handleWorkoutOpen/Stat/Close`) to
  read its child `<WorkoutStatistics>`: per-workout HR (`hr_avg/hr_min/hr_max`, bpm) and the
  energy the opening tag drops on newer exports. `workouts.csv` gains 3 HR columns; 305/387
  sessions carry HR (Apple-Watch-era).
- **Entrenos** gains an *Intensity (HR)* section: duration-weighted mean HR + peak per modality
  (`aggregateDashboard` → `modality[].avgHr/peakHr` + `intensity{}`). HR honestly under-reads
  strength (avg 89 vs run 153), said on-screen — never folded into a single "load" number.
- **Salud** gains a 6th section, *Load vs recovery*: weekly cardiovascular load index
  (`Σ(min × avgHR) / 100`) vs weekly HRV + resting HR, with a high- vs low-load split
  (`aggLoadRecovery`). `generate-health.js` reads `workouts.csv` directly rather than importing
  `generate-training.js` (which throws without `training-data.json` — would break fresh clones).
- Honesty baked into captions: cardiovascular (not total) load, few weeks, association not
  causation. Tests: +2 training, +3 health (59 green). Both `plan-web.html` (es) and
  `plan-web.template.html` (en) updated.

## 2026-06-30 — Plan artifact split into 3 tabs

The artifact had grown into one long scroll mixing two different tasks: *consulting* the
plan (what to eat, equivalence tables) vs *logging* what was eaten. Reorganized into tabs.

- Three `<div class="tab-panel" data-tab="…">`: **🍽️ Mi día** (day-plan cards), **📋 Registro**
  (the builder + Copiar para Claude), **📊 Tablas** (equivalences + suplementación + cómo usarlo).
- Sticky tab bar (`.toggle.tabs`) above the Entreno/Descanso day toggle; the day toggle shows
  on Mi día + Registro and hides on Tablas (irrelevant there).
- `setTab(name, scrollTop)` switches panels + aria state; `jump(id)` now finds the target's
  panel via `closest('.tab-panel')`, switches to it, then opens + scrolls — so the meal links
  on Mi día (Proteína, carbo…) navigate correctly to their accordion on Tablas.
- Tab wrappers live OUTSIDE the GEN regions (markers intact). Verified byte-identical after
  `npm run generate`, `<div>` balanced 194/194, `npm test` 8/8. Republished to the artifact URL.

## 2026-06-30 — Food check-in: "Copiar para Claude" on the day-builder

Closed the biggest data gap (food logging stopped 2025-11-26) by turning the existing
day-builder in `plan-web.html` into a food log instead of adding a separate section.

- Renamed "Arma tu día" → **"Registro de comida"**; intro reframed to "mark what you ate
  → copy → paste into chat."
- Added a free-text **"Fuera de plan / notas"** field (`#bld-notes`) for off-plan/social
  meals the builder's plan-only dropdowns can't represent (the real blind spot: pintxos,
  restaurants, weekend).
- Added **"📋 Copiar para Claude"** (`#bld-copy`): exports a plain-text block — day type,
  each selected meal, nonzero extras, the notes, and the COMPUTED totals vs target — to the
  clipboard (`navigator.clipboard` + `execCommand` fallback + a visible readonly textarea).
- Live calculator, **no persistence** (chosen over a localStorage accumulator): copy the
  current day in the moment. Photos still go straight to chat.
- All additions live OUTSIDE the GEN regions (logic inside the builder IIFE: `LAST` totals
  captured in `recalc()`, `XN` extras-name map, `buildDayText()`/`copyDay()`). Verified
  byte-identical after `npm run generate`; `npm test` 8/8. Republished to the artifact URL.
- Why the builder, not a new section: it already computes exact macros from real labels —
  reusing it avoids duplicate logging surfaces and gives precise data instead of estimates.

## 2026-06-30 — Closed the last duplicated source of truth (verified labels)

Repo deep-review found the verified per-100 g product labels were maintained in TWO
places: `food-log.md` ("source of truth for packaged foods") AND `plan-data.json`
(`ingredients`, verified:true). Values matched but were two hand-copies that could drift.

- Added `name` + `note` to the 30 verified `ingredients` in `plan-data.json` (transcribed
  faithfully from the food-log table; macros untouched — asserted by the migration script).
- `generate.js` now emits a **"Verified product labels"** table into `plan-tables.md` from
  those entries → the labels render from the single source.
- `food-log.md` table replaced with a pointer to `plan-tables.md`. Only the non-plan
  reference rows (2 soups, electrolytes, creatine — no recipe macros) stay in food-log.
- Single source of truth now holds for labels too.

## 2026-06-30 — Single source of truth CLOSED 100%

Last hand-written data in `plan-web.html` is now generated:
- **Day-summary cards** (both `.day-panel`) ← `dayPlan`, between `<!-- GEN:DAYPLAN -->`.
  Each meal lists `parts`: raw `{ing,amt}` OR a reference `{use, tier?, match}` to a table
  item (matched by `n`/`l`) → day cards are LINKED to the tables. `resolvePart()` + `dayPanel()`.
- **Extras stepper labels** ← `extrasDisplay`, between `<!-- GEN:EXTRAS -->`. kcal pulled
  from resolved EXTRAS; `bump('key')`/`id="x-key"` preserved. `extraRow()`.
- Day totals now COMPUTED (train ~2,440 / 175P / 312C / 56G; rest ~2,031 / 165P / 225C /
  54G) — honest sums of referenced parts, not typed estimates (old hand figures were
  2,570/2,150). Rest-day protein ~165 g is a touch under the ~170 g target — user can pick
  higher-protein options to close it.
- Five GEN regions total: DATA, BREAKFAST, DAYPLAN, EXTRAS (+ plan-tables.md).

## 2026-06-30 — Breakfast detail tables generated

The "☕ Desayunos" A/B/C component tables in `plan-web.html` were still hand-written HTML (a
surviving second source that drifted). Now generated between `<!-- GEN:BREAKFAST -->` markers.
Presentation in `plan-data.json`: each `desayuno` item carries `tier` (🟢/🟡/🔴) + `cap`;
recipe lines may carry display-only `label`, `q` (quantity override), `group`+`glabel` (merge
lines into one row), and `link` (a `jump()` target → row renders as an interactive button).
`resolve()` strips `tier`/`cap` so the JS DATA items stay `{l,k,p,c,g}`.

## 2026-06-30 — Plan artifact is a published snapshot

What the user views is a claude.ai artifact (frozen snapshot). Editing local files does NOT
update it — a plan change must propagate through three layers (edit JSON → run generate.js →
re-publish the artifact to the same URL). See CLAUDE.md "Nutrition plan — data pipeline &
published artifact" for the live URL and steps.

## 2026-06-27 — Deeper single source: ingredient layer

`plan-data.json` gained an `ingredients` layer (per-100 g/ml/ud base foods, each flagged
`verified:true` for a real product label vs `false` for a DB estimate). Each plan item carries
a `recipe` (`[{ing, amt}]`) instead of inline macros; `generate.js` COMPUTES per-serving
k/p/c/g from `ingredient*amt`. Change a label or a serving gram in ONE place → it propagates.

- Items with no single label stay as `manual` macro blocks (the two legume "plato hondo"
  rows + the soup row + `pintxo`).
- Rounding: kcal → integer, macros → 1 decimal (.0 dropped). Generator is idempotent.
- Reconciliation — building the ingredient layer exposed real source inconsistencies; 4
  material divergences resolved with the owner:
  - **anclaje Atún:** serving 130 g → **100 g** to hold the ~25 g anchor (130 g of 25 g/100 g
    tuna was really 32.5 g P — the old 25 was wrong).
  - **protein Claras:** **400 ml → 370 ml** to hold ~40 g (egg white is ~10.8 g P/100 ml).
  - breakfast B (37 g P) and Huevos enteros (468 kcal): accepted as accurate.
  - ~66 sub-gram precision drifts accepted (computed > old hand-rounded — the point of the refactor).

## 2026-06-26 — Nutrition plan single source of truth established

Per-serving food tables had been duplicated across `food-log.md` and `plan-web.html`. Created
ONE source (`plan-data.json`) + a generator (`generate.js`) that regenerates the `DATA`/`EXTRAS`
JS block in `plan-web.html` and `plan-tables.md`. `food-log.md` kept as the hand-written
notebook (daily log, rationale, day-plan structure, breakfast detail, non-duplicate tables);
its duplicated per-serving tables were replaced with pointers to `plan-tables.md`.

## (initial) — Scaffolding

Repo created and git-initialized. Structure, `CLAUDE.md`, `analysis/methodology.md` in place.
Reframed "24/7 Claude" → persistent context + scheduled/on-demand runs. Apple Health is
iOS/HealthKit-only → analysis via exported XML. Privacy: raw health data gitignored, stays local.
