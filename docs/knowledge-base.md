# Knowledge base + expert subagents

Transcript ingest, Hyprogram sync, and the three read-only coach subagents.

> Area design doc (moved out of `CLAUDE.md` on 2026-10-07). Read it before changing this area and keep
> it in sync with the code in the same commit. Section names quoted in the text ("Nutrition v2 part 2",
> "Detail views"…) are listed in `CLAUDE.md` → Architecture map.

## Knowledge base + expert subagents

`knowledge/` holds transcripts of expert content (third-party, personal use): EVERYTHING in it but
`knowledge/README.md` is gitignored — never commit, publish or `git add -f` it. Layout per source:
`knowledge/<domain>/<source>/manifest.json` (one entry per video: title, date, duration, `subs` =
manual | auto | none, file, words, fetchedAt) + `raw/<YYYY-MM-DD>-<id>.md` (header, then `[mm:ss]`
paragraphs of ~30–60 s, rolling auto-caption repeats removed); optional `index.md`, `temas/*.md`,
`videos/*.md` syntheses on top.

- **Ingest** — `node scripts/ingest-youtube.mjs --channel <url> --out knowledge/<domain>/<source>
  [--tabs videos,streams] [--limit N] [--lang es]`: incremental (skips manifest ids), subtitles only
  (never media), manual subtitles over automatic captions (the ORIGINAL-language track, never a
  machine translation), polite pacing + 2 retries, manifest written atomically after each video.
  External `yt-dlp` (`$YT_DLP` → PATH → `~/.local/bin/yt-dlp`). Pure parts (VTT → paragraphs,
  track choice, naming, manifest merge, flags) in `scripts/youtube-transcript.mjs`, unit-tested.
  Re-run it to pick up new uploads.
- **Hyprogram sync** — `node scripts/sync-hyprogram.mjs [--dry-run] [--limit N]`: pulls the owner's
  current "HP Hybrid" program (a login-gated Next.js app, NextAuth credentials) into
  `knowledge/hybrid/hyprogram/` — `raw/<id>.json` (an ALLOWLIST of the rendered fields only —
  id, date, titles, sections' wod / coach notes; file named from a safe id, else the ISO date),
  `semanas/<YYYY-Www>.md` (faithful Spanish render of each day: sections, WOD, coach notes) and
  `manifest.json` (incremental, per-date `fetchedAt`). Read-only GETs on the owner's own account;
  polite (~1.5 s apart) and it early-stops at the edge of the rolling access window (only a recent
  block of days is viewable). Credentials live in `data/training/.env.hyprogram` (gitignored, 0600:
  `HYPROGRAM_EMAIL`, `HYPROGRAM_PASSWORD`; `HYPROGRAM_ENV` overrides the path, only to a file named `.env.hyprogram`; a group / world-readable
  mode is a warning) and are NEVER logged; the cookie is only sent to the pinned hyprogram.com origin,
  the session counts only when `/api/auth/session` returns a user, and errors stay coarse
  (`auth_failed`, `http_403`), never echoing tokens. Pure parts
  (ProseMirror → Markdown, PII strip, week/date math, fetch plan, manifest) in
  `scripts/hyprogram-lib.mjs`, unit-tested. `hybrid-coach` reads the output. Re-run to extend the
  history as new weeks unlock.
- **Shared by the three coach subagents** — `tools: Read, Grep, Glob` (no Bash: anything that needed
  a shell is done with Read / Grep). The SAME "Shared rules" block in each (reply in the user's
  language, Spanish by default; not-a-doctor note on health topics; never read `.env*` / credentials;
  sponsor / affiliate bias flagged; auto-caption numbers "verificar") — edit it in all three at once.
  The SAME "Owner facts" table: weight = the newest `weight.csv` rows (+ the last 7 days as context;
  mixes scales), height / birthdate / devices / supplements / events = `profile/profile.json`, goal +
  target weight = `data/profile/settings.json` (missing → unknown; `fetchedAt` > 3 days old → may be
  stale), stable context = `profile/about-me.md`; never numbers from profile prose (live files win);
  freshness checked against TODAY from the conversation context (`_meta.json` `exportLastDate`, each
  CSV's newest date; > 3 days flagged); days to each event computed from TODAY. **Routing**:
  fuelling, hydration, electrolytes, supplements and body-composition nutrition belong to
  `nutrition-coach`, also when the question comes from cycling or HYROX; the training coaches answer
  only the training part and hand off ("para la nutrición, pregunta al nutrition-coach") and vice
  versa; the frontmatter descriptions say the same.
- **`cycling-coach` subagent** (`.claude/agents/cycling-coach.md`, read-only) — DELEGATE to it any
  cycling TRAINING / power / FTP / zones / periodization / bike fit / gear / Garmin Edge / EMS suit
  question (on-bike fuelling → `nutrition-coach`). FTP is stored nowhere: unknown → it says so and
  never estimates one, working from the power curve / kJ / HR as Edu does and suggesting a test.
  Gear manuals: `data/gear/garmin-edge-540-manual-es.txt`, `data/gear/vitalcontrol-sem-42-manual.md`.
  It lists Edu's commercial ties (226ERS, Umbral, Canyon / Mondraker, Gobik, Whoop affiliate,
  Hammerhead, Garmin…, from `knowledge/cycling/talavera/index.md`). It applies the expert's criteria from `knowledge/cycling/talavera/` (Eduardo
  Talavera), cites every claim with the video title + `&t=<seconds>s` URL, marks automatic-caption
  numbers "verify in the video", separates "what the expert says" from `analysis/methodology.md` /
  evidence (contradictions flagged), and grounds advice in the owner's data. A new expert = a new
  ingest folder + a subagent whose only source-specific part is its "Knowledge source" section.
- **`hybrid-coach` subagent** (`.claude/agents/hybrid-coach.md`, read-only) — DELEGATE to it any
  HYROX / hybrid TRAINING question (running + strength + conditioning, Hyrox stations, race strategy,
  programming, comparing a program with what he did); race nutrition → `nutrition-coach`, cycling →
  `cycling-coach`. Hyprogram: synced by cron (Sun 21:15 / Mon 06:15) into
  `knowledge/hybrid/hyprogram/semanas/`; nothing before 2026-09-21 is available (rolling window); the
  `temas/` syntheses have no Hyprogram section yet, so it reads `semanas/` directly. The HYROX station
  weights table (`temas/estaciones-y-tecnica.md`, marked verificar) is never stated as fact: it
  points to the current official rulebook. Same rules as `cycling-coach` (podcast claims cited with `&t=<seconds>s`, programs
  by file / month / week; auto-caption numbers and sponsor bias flagged; sources vs methodology kept
  apart; never writes files), grounded read-only in `workouts.csv` (runs, gym,
  other), `running-daily.csv`, HRV / RHR / sleep, race dates from `profile.json` `events` and
  `profile/about-me.md` (which program he followed when). Its knowledge, `knowledge/hybrid/`: optional `index.md` + `temas/*.md`
  (cross-source syntheses); `hyprodcast/` (a Hyrox podcast: the YouTube ingest layout above +
  `videos/*.md` summaries); `ferry/` (coach Ferry, the owner's program Dec 2025 – Jun 2026:
  `index.md`, `metodo-ferry.md`, `months/<YYYY-MM>-ferry.md` transcribed from the PDFs);
  `training-culture/hybrid-6-semanas.md` (a 6-week block); `hyprogram/` (the current Hyprogram
  "HP Hybrid" program, from 2026-07-01, kept in sync by `scripts/sync-hyprogram.mjs` above —
  `semanas/<YYYY-Www>.md` + `raw/*.json`).
- **`nutrition-coach` subagent** (`.claude/agents/nutrition-coach.md`, read-only) — DELEGATE to it any
  sports nutrition / supplementation question, including the nutrition side of a cycling or HYROX
  question (daily diet for training, fat loss and body composition, protein, carbs around training,
  on-bike / race fuelling, hydration and electrolytes, supplements, gut training);
  cycling training stays with `cycling-coach`, HYROX training with `hybrid-coach`. EVIDENCE first: a
  practitioner never outranks the evidence base. Every claim cited (evidence = document + URL +
  section; videos = `&t=<seconds>s`), "what Andrea says" kept apart from the evidence, contradictions,
  sponsor / brand bias and auto-caption numbers flagged. Spain context (AESAN supplement limits,
  products sold in Spain, BEDCA foods), anti-doping / contamination warnings (WADA, third-party-tested
  batches), not a doctor (refers to a physician / dietitian-nutritionist for medical conditions,
  medication interactions and eating-disorder signals), no crash diets (`analysis/methodology.md`
  safe ranges). Grounded read-only in `plan-data.json` + `ingredients.json`, the owner facts above
  (incl. `profile/profile.json` supplements and `data/profile/settings.json`), `profile/about-me.md`, the extract (weight, `dietary-daily.csv`, energy) and the
  Nutrición rules above; the food log as daily sums from `data/nutrition/foodlog-daily.csv` (the
  `sync:foodlog` export; missing → it says the sync has not run). Spanish replies; never writes files. Its knowledge, `knowledge/nutrition/`: optional
  `index.md` + `temas/*.md` (cross-source syntheses); `evidencia/` (AIS Sports Supplement Framework,
  IOC 2018 supplement consensus, ISSN position stands, AESAN, WADA — the evidence base); `ferrandis/`
  (Andrea Ferrandis, dietitian-nutritionist, YouTube: the ingest layout above + `videos/*.md` cards —
  the practitioner source); `nutrics/` (Javi Aoiz – Nutrics podcast: single episodes the owner adds
  as real-practice examples, same layout, each card already contrasted with the evidence; a single
  video is added by hand: `yt-dlp --skip-download` subtitles → `scripts/youtube-transcript.mjs`
  paragraphs → `raw/<date>-<id>.md` + a `manifest.json` entry + a `videos/` card); it also reads `knowledge/cycling/talavera/temas/nutricion-en-bici.md` +
  `hidratacion-y-sales.md` and `knowledge/hybrid/temas/nutricion-y-suplementacion.md`.
