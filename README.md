# health-coach

A personal, data-driven health and nutrition coaching workspace operated by
[Claude Code](https://claude.com/claude-code). You drop in your own data (Apple Health export, food log,
training program); Claude onboards you, analyses real trends against a documented methodology, and
answers through three coach subagents — and a build step turns everything into one self-contained
dashboard page. **It is not medical advice** (see [Disclaimer](#disclaimer)): it does not replace a
physician or a registered dietitian.

Your data never leaves your disk: every personal file is gitignored, and a guard hook stops Claude from
committing it ([Privacy](#privacy)).

## What you get

| Piece | What it does |
| --- | --- |
| Onboarding | On a fresh clone Claude interviews you and writes your profile, baseline and coach config ([`docs/onboarding.md`](docs/onboarding.md)) |
| `/analysis` skill | Sync → freshness check → trends per [`analysis/methodology.md`](analysis/methodology.md) → a dated report in `analysis/reports/` |
| Coach subagents | `cycling-coach`, `hybrid-coach`, `nutrition-coach`: read-only, cite every claim, configured by your gitignored `profile/coaches.md` ([`docs/knowledge-base.md`](docs/knowledge-base.md)) |
| The page | `npm run generate` → `web/dist/personal/index.html`: Home, Training, Health, Nutrition tabs; tap any card for its history ([`docs/plan-page.md`](docs/plan-page.md)) |
| Guard hook | Blocks force-adding ignored (personal) files and un-ignoring them in `.gitignore` ([`docs/guard-hook.md`](docs/guard-hook.md)) |

`CLAUDE.md` is the operating manual Claude reads every session; per-area design docs live in
[`docs/`](docs/) (index: `CLAUDE.md` → Architecture map).

## Prerequisites

- **[Claude Code](https://claude.com/claude-code).**
- **Node.js `>=22.12`** (`engines` in `package.json`).
- **An iPhone (Apple Health)** for the health data — the export is made on the phone; any OS can run
  the tooling.
- **Docker** — only for Level 2 (the LAN services).
- **[Engram](https://github.com/Gentleman-Programming/engram)** — optional persistent memory across
  sessions. Without it, durable state lives in the tracked files and `CHANGELOG.md`.

## Setup — pick your level

Each level works on its own; stop wherever you like.

### Level 1 — Apple Health + Claude (local only)

1. **Clone and install:** `npm ci`.
2. **Export Apple Health:** iPhone → Health → your photo → *Export All Health Data*. Unzip and put
   `export.xml` in `data/apple-health/`, then run `node data/apple-health/extract.js` (it caches small
   per-metric CSVs; re-run after each new export).
3. **Start Claude Code and say hi.** With no profile yet it runs the onboarding interview and writes
   `profile/about-me.md`, `profile/baseline.md` and `profile/coaches.md` for you (all gitignored).
   Prefer to fill them yourself? Copy each `*.example.md` → `*.md`.
4. **Ask for an analysis** — or type `/analysis`.
5. **See the page:** copy `data/nutrition/plan-data.example.json` → `plan-data.json` (and, optionally,
   `data/training/training-data.example.json` → `training-data.json`, `profile/profile.example.json` →
   `profile.json`), then `npm run generate` and open `web/dist/personal/index.html`.

Optional extras for this level:

| Want | Do | Doc |
| --- | --- | --- |
| Your own nutrition plan | Edit `plan-data.json` (servings, day plan, `targets.byGoal`); the food DB `ingredients.json` ships tracked | [`docs/nutrition.md`](docs/nutrition.md) |
| Today's programmed session | Fill `training-data.json` by date (Claude can transcribe a coach's PDF) | [`docs/training.md`](docs/training.md) |
| Try it with no data | `npm run build:example` — builds from the tracked seeds + a clearly synthetic demo extract (`data/demo/`) | [`data/demo/README.md`](data/demo/README.md) |

### Level 2 — food log + live page on your LAN (Docker)

`services/health-ingest` (food log, products, recipes, settings; Postgres) and `services/plan-web`
(nginx serving the page, rebuilt hourly and on demand from a Sync button). `npm run sync` then pulls the
food log and settings into your local data so `/analysis` can read them.

Setup, security model and install steps: [`docs/lan-services.md`](docs/lan-services.md),
[`services/plan-web/README.md`](services/plan-web/README.md),
[`services/health-ingest/README.md`](services/health-ingest/README.md).

### Level 3 — live sync and your own knowledge base

| Add | What it gives you | Doc |
| --- | --- | --- |
| iOS Shortcut | Pushes recent Apple Health samples between full exports | [`docs/ios-shortcut.md`](docs/ios-shortcut.md) |
| Strava | Rides / runs, Relative Effort for the load dial, your bikes and shoes | [`services/health-ingest/README.md`](services/health-ingest/README.md) |
| Knowledge base | Transcripts of the experts *you* choose, read by the coach subagents | [`docs/knowledge-base.md`](docs/knowledge-base.md), [`knowledge/README.md`](knowledge/README.md) |

The knowledge base ingest (`scripts/ingest-youtube.mjs`) uses the external
[`yt-dlp`](https://github.com/yt-dlp/yt-dlp) — optional; skip it and the coaches answer from the
evidence base and your data. `knowledge/` is gitignored: it is **for personal use only — respect the
creators' rights** and never publish it.

## Privacy

Raw health data is **medical-grade sensitive** and is excluded from git via
`.gitignore`. It lives only on local disk. The tracked tree is **framework + tooling +
`.example` templates only** — never your data. The guard hook
([`docs/guard-hook.md`](docs/guard-hook.md)) blocks Claude from force-adding ignored files or
un-ignoring them.

Before pushing to any remote, confirm nothing personal is staged or in history:

```sh
git status                 # working tree clean of personal data
git log --all --oneline -- profile/ data/   # should show only .example / tooling / .gitkeep
```

If you ever committed real data by accident, rewrite history (e.g. `git filter-repo`)
before going public — `.gitignore` does not retroactively remove data from past commits.

## Disclaimer

Recommendations here are general guidance derived from your data and standard
nutrition/training principles. They are **not** a substitute for a licensed
physician or registered dietitian, especially for any clinical condition,
medication, or prescribed diet.

## License

MIT — see [LICENSE](LICENSE). The license covers the framework and tooling. Any data
you add is yours and stays local (gitignored).
