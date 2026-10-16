# Knowledge base + expert subagents

Transcript ingest, private program syncs, and the four read-only coach subagents.

> **Reference** — how this area is built, for anyone changing it (keep it in sync with the code in the same
> commit). Setting up or using the page? Start at the [documentation index](README.md).

The coach agent files are the source of truth for what each coach does, reads and cites — this page
only covers the parts around them:

| Coach | Owns | File |
| --- | --- | --- |
| `cycling-coach` | cycling TRAINING (power, FTP, zones, periodization, bike fit, gear, devices) | [`.claude/agents/cycling-coach.md`](../.claude/agents/cycling-coach.md) |
| `hybrid-coach` | HYROX / hybrid TRAINING (stations, compromised running, race strategy, programs) | [`.claude/agents/hybrid-coach.md`](../.claude/agents/hybrid-coach.md) |
| `nutrition-coach` | ANY nutrition, also for cycling / HYROX (diet, fuelling, hydration, supplements, body composition) | [`.claude/agents/nutrition-coach.md`](../.claude/agents/nutrition-coach.md) |
| `training-coach` | TRAINING for every other sport (running, swimming, strength, team sports, yoga / pilates…) | [`.claude/agents/training-coach.md`](../.claude/agents/training-coach.md) |

The training coaches answer only the training part of a question and hand nutrition off to
`nutrition-coach`, and vice versa; the frontmatter descriptions say the same, so Claude Code routes
by them. The coach table in `CLAUDE.md` mirrors it.

## Knowledge base layout

`knowledge/` holds transcripts of expert content (third-party, personal use): EVERYTHING in it but
`knowledge/README.md` is gitignored — never commit, publish or `git add -f` it. Layout per source:
`knowledge/<domain>/<source>/manifest.json` (one entry per video: title, date, duration, `subs` =
manual | auto | none, file, words, fetchedAt) + `raw/<YYYY-MM-DD>-<id>.md` (header, then `[mm:ss]`
paragraphs of ~30–60 s, rolling auto-caption repeats removed); optional `index.md`, `topics/*.md`
(any folder name the config gives, e.g. `temas/`) and `videos/*.md` syntheses on top. The default
domain folder of each coach is listed in [`knowledge/README.md`](../knowledge/README.md).

## Ingest

- **YouTube** — `node scripts/ingest-youtube.mjs --channel <url> --out knowledge/<domain>/<source>
  [--tabs videos,streams] [--limit N] [--lang es]`: incremental (skips manifest ids), subtitles only
  (never media), manual subtitles over automatic captions (the ORIGINAL-language track, never a
  machine translation), polite pacing + 2 retries, manifest written atomically after each video.
  External `yt-dlp` (`$YT_DLP` → PATH → `~/.local/bin/yt-dlp`). Pure parts (VTT → paragraphs,
  track choice, naming, manifest merge, flags) in `scripts/youtube-transcript.mjs`, unit-tested.
  Re-run it to pick up new uploads. A single video can be added by hand: `yt-dlp --skip-download`
  subtitles → `scripts/youtube-transcript.mjs` paragraphs → `raw/<date>-<id>.md` + a
  `manifest.json` entry.
- **Private program syncs** — a script that pulls the user's own training program from a
  login-gated service (personal account, third-party terms) is private tooling: it lives in the
  gitignored `local/` folder (never published), writes into the gitignored knowledge folder (e.g.
  `knowledge/hybrid/<program>/`), and keeps its credentials in a gitignored `.env.*` file the Read
  tool is denied. Its unit tests run by hand (`node --test local/<tool>/*.test.mjs`), not from
  `npm test`. `profile/about-me.md` says where the current program lives, so the coach can read it.

## Config contract — `profile/coaches.md`

The coaches are generic templates: every user-specific fact lives in the gitignored
`profile/coaches.md`, built from the tracked [`profile/coaches.example.md`](../profile/coaches.example.md)
(onboarding walks it with the user, `docs/onboarding.md`). Each coach reads `## Common` + the
section named after it FIRST; missing file or section → it says so and answers from the evidence
base, `analysis/methodology.md` and the user's data only, never inventing or imitating a source.
A new source = an ingest folder under `knowledge/` + a row in the config; no agent edit. Stale facts
(weight, goal, event dates) never go in the config — they stay in the live files the shared "User
facts" table names.

| Section | Keys |
| --- | --- |
| `## Common` | **Language** (default reply language), **Locale / jurisdiction**, **Section labels** (optional) |
| `## cycling-coach` | **Knowledge sources** table (name, short name, type, folder, how to cite), **Commercial ties**, **FTP stance** (optional), **Gear** table (device → manual under `loop-data/files/manuals/`) |
| `## hybrid-coach` | **Knowledge folder** (default `knowledge/hybrid/`), **Knowledge sources** in reading order (syntheses, podcasts, past programs, current program), events / rulebook pointers |
| `## nutrition-coach` | **Knowledge folder** (default `knowledge/nutrition/`), **Evidence folder** (default `<knowledge folder>/evidence/`, `evidencia/` also found), evidence base list, **Practitioner sources** table, **Cross-domain passages** (optional), **Jurisdiction rules** |
| `## training-coach` | **Sports**, **Knowledge folder** (default `knowledge/training/`), **Knowledge sources** table (optional; name, short name, sport, folder, how to cite), **Commercial ties** |

The coaches search transcripts with keywords in the user's language AND in English, and check
freshness by grepping each CSV for TODAY's month prefix (`^<YYYY-MM>`), then the previous month's.

## The test

`.claude/hooks/coach-agents.test.js` (run by `npm test`) takes every `.claude/agents/*-coach.md` on
disk and fails when:

- the span from "## Shared rules (identical in every coach subagent)" up to "## Knowledge source"
  (shared rules + "User facts" table) differs byte-for-byte between the coaches — edit it in all of
  them at once;
- a frontmatter lacks `model: inherit` (deliberate: the coaches run on the session model, so
  citation fidelity — quotes, timestamps, doses — is never traded for a cheaper model) or
  `tools: Read, Grep, Glob` (read-only, no shell);
- a coach does not read `profile/coaches.md`, or says "the owner" / "his" instead of "the user";
- a coach, this doc or `knowledge/README.md` names a user-specific source / device / program (a list
  of SHA-256 token hashes in the test, so the test names nobody);
- `profile/coaches.example.md` is not tracked or lacks the `## <coach>` section of a coach, or
  `profile/coaches.md` is not ignored.

## How to add a coach

1. Copy the closest coach file to `.claude/agents/<sport>-coach.md` (the `-coach.md` suffix is what
   the test looks for); set `name`, a `description` that makes the routing clear (what it owns,
   where the rest goes), and keep `tools: Read, Grep, Glob` and `model: inherit`.
2. Keep the "## Shared rules" … "User facts" block byte-identical; change only the intro, the
   routing paragraph and the sections from "## Knowledge source" on.
3. Add a `## <sport>-coach` section to `profile/coaches.example.md` (and to your own
   `profile/coaches.md`), with a **Knowledge folder** default and a sources table.
4. Add the routing row to the coach table in `CLAUDE.md`, and a hand-off line in the coaches that
   should send questions to it.
5. Run `node --test .claude/hooks/coach-agents.test.js` — it picks the new file up on its own.
