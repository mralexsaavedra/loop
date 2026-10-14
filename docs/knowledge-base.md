# Knowledge base + expert subagents

Transcript ingest, private program syncs, and the three read-only coach subagents.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

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
- **Private program syncs** — a script that pulls the user's own training program from a
  login-gated service (personal account, third-party terms) is private tooling: it lives in the
  gitignored `local/` folder (never published), writes into gitignored `knowledge/hybrid/<program>/`,
  and keeps its credentials in a gitignored `.env.*` file the Read tool is denied. Its unit tests run
  by hand (`node --test local/<tool>/*.test.mjs`), not from `npm test`. `profile/about-me.md` says
  where the current program lives, so `hybrid-coach` can read it.
- **Per-user coach config** — the three coaches are generic templates: every user-specific fact
  (named experts / creators and their folders, how to cite them, their commercial ties, gear
  manuals, past / current program pointers, language, locale / jurisdiction, section labels) lives
  in the gitignored `profile/coaches.md`, built from the tracked `profile/coaches.example.md`
  (onboarding walks it with the user, `docs/onboarding.md`). Each coach reads `## Common` + its own
  section FIRST; missing file or section → it says so and answers from the evidence base,
  `analysis/methodology.md` and the user's data only, never inventing or imitating a source. A new
  source = an ingest folder under `knowledge/` + a row in the config; no agent edit. Stale facts
  (weight, goal, event dates) never go in the config — they stay in the live files below.
- **Shared by the three coach subagents** — `tools: Read, Grep, Glob` (no Bash: anything that needed
  a shell is done with Read / Grep). The SAME "Shared rules" block in each (read the config first;
  reply in the user's language, the config's default else the question's; not-a-doctor note on
  health topics; never read `.env*` / credentials; sponsor / affiliate bias flagged; auto-caption
  numbers "verify") — edit it in all three at once: `.claude/hooks/coach-agents.test.js` (run by
  `npm test`) fails when the span from "## Shared rules" up to "## Knowledge source" (shared rules +
  User facts) differs byte-for-byte between the three, when an agent or this doc names an
  user-specific source / device / program (a list of SHA-256 token hashes in the test, so the test names
  nobody), or when
  `profile/coaches.example.md` is not tracked / `profile/coaches.md` not ignored.
  `model: inherit` in each frontmatter is deliberate: the coaches run on the session model, so
  citation fidelity (quotes, timestamps, doses) is never traded for a cheaper model; the test pins it.
  The SAME "User facts" table: weight = the newest `weight.csv` rows (+ the last 7 days as context;
  mixes scales), height / birthdate / devices / supplements / events = `profile/profile.json`, goal +
  target weight = `data/profile/settings.json` (missing → unknown; `fetchedAt` > 3 days old → may be
  stale), stable context = `profile/about-me.md`, sources / gear / jurisdiction = `profile/coaches.md`;
  never numbers from profile prose (live files win);
  freshness checked against TODAY from the conversation context (`_meta.json` `exportLastDate`, each
  CSV's newest date; > 3 days flagged); days to each event computed from TODAY. **Routing**:
  fuelling, hydration, electrolytes, supplements and body-composition nutrition belong to
  `nutrition-coach`, also when the question comes from cycling or HYROX; the training coaches answer
  only the training part and hand off and vice versa; the frontmatter descriptions say the same.
- **`cycling-coach` subagent** (`.claude/agents/cycling-coach.md`, read-only) — DELEGATE to it any
  cycling TRAINING / power / FTP / zones / periodization / bike fit / gear / bike computer / training
  device question (on-bike fuelling → `nutrition-coach`). FTP is stored nowhere: unknown → it says so
  and never estimates one, working from the power curve / kJ / HR (the config may point to the
  expert's own stance) and suggesting a test. It applies the criteria of the expert(s) in the
  config's `## cycling-coach` table (`knowledge/cycling/<source>/`), lists their commercial ties,
  cites every claim with the video title + `&t=<seconds>s` URL, marks automatic-caption numbers
  "verify in the video", separates "what the expert says" from `analysis/methodology.md` / evidence
  (contradictions flagged), reads the gear manuals the config lists (`data/gear/`, gitignored) and
  grounds advice in the user's data. Its only source-specific part is the config.
- **`hybrid-coach` subagent** (`.claude/agents/hybrid-coach.md`, read-only) — DELEGATE to it any
  HYROX / hybrid TRAINING question (running + strength + conditioning, Hyrox stations, race strategy,
  programming, comparing a program with what the user did); race nutrition → `nutrition-coach`,
  cycling → `cycling-coach`. The current program is read from where `profile/about-me.md` and the
  config say it lives (see "Private program syncs" above), newest week checked against today. Any
  HYROX station weights table in the syntheses is never stated as fact: it points to the current
  official rulebook. Same rules as `cycling-coach` (podcast claims cited with `&t=<seconds>s`,
  programs by file / month / week; auto-caption numbers and sponsor bias flagged; sources vs
  methodology kept apart; never writes files), grounded read-only in `workouts.csv` (runs, gym,
  other), `running-daily.csv`, HRV / RHR / sleep, race dates from `profile.json` `events` and
  `profile/about-me.md` (which program the user followed when). Its knowledge, `knowledge/hybrid/`:
  optional `index.md` + `temas/*.md` (cross-source syntheses), then the sources in the order the
  config lists (podcasts in the YouTube ingest layout above + `videos/*.md` summaries; past programs
  transcribed by month / week; `<program>/` = the current program, possibly kept in sync by a
  private script under `local/`).
- **`nutrition-coach` subagent** (`.claude/agents/nutrition-coach.md`, read-only) — DELEGATE to it any
  sports nutrition / supplementation question, including the nutrition side of a cycling or HYROX
  question (daily diet for training, fat loss and body composition, protein, carbs around training,
  on-bike / race fuelling, hydration and electrolytes, supplements, gut training);
  cycling training stays with `cycling-coach`, HYROX training with `hybrid-coach`. EVIDENCE first: a
  practitioner never outranks the evidence base. Every claim cited (evidence = document + URL +
  section; videos = `&t=<seconds>s`), each practitioner kept apart from the evidence, contradictions,
  sponsor / brand bias and auto-caption numbers flagged. Jurisdiction from the config (supplement
  limits, products sold there, food composition database, professional title — e.g. Spain: AESAN,
  BEDCA), anti-doping / contamination warnings (WADA, third-party-tested batches), not a doctor
  (refers to a physician / dietitian-nutritionist for medical conditions, medication interactions and
  eating-disorder signals), no crash diets (`analysis/methodology.md` safe ranges). Grounded read-only
  in `plan-data.json` + `ingredients.json`, the user facts above (incl. `profile/profile.json`
  supplements and `data/profile/settings.json`), `profile/about-me.md`, the extract (weight,
  `dietary-daily.csv`, energy) and the Nutrición rules above; the food log as daily sums from
  `data/nutrition/foodlog-daily.csv` (the `sync:foodlog` export; missing → it says the sync has not
  run). Never writes files. Its knowledge, `knowledge/nutrition/`: optional `index.md` + `temas/*.md`
  (cross-source syntheses); `evidencia/` (the evidence base: position stands such as AIS, IOC 2018
  supplement consensus, ISSN, WADA, plus the jurisdiction's documents); one folder per practitioner
  source in the config (the ingest layout above + `videos/*.md` cards). A single video can be added
  by hand: `yt-dlp --skip-download` subtitles → `scripts/youtube-transcript.mjs` paragraphs →
  `raw/<date>-<id>.md` + a `manifest.json` entry + a `videos/` card. It also reads the nutrition
  passages of the other knowledge bases that the config lists.
