---
name: analysis
description: "Trigger: analysis, análisis, informe, report, progress review, how am I doing, cómo voy, revisión de tendencia. Runs the recurring health / nutrition / training report loop: sync, freshness, live facts, follow-up of the previous report, coach sub-questions, report in analysis/reports/YYYY-MM-DD.md."
---

# Analysis report loop

The framework for every number is `analysis/methodology.md` (§6 = report structure). The data
sources and their caveats are in `CLAUDE.md` → Data sources. Do not copy them here: read them.

## Steps

1. **First-run check.** No `profile/about-me.md` → do not analyse; run the `/setup` skill (it hands over to `docs/onboarding.md`).
2. **Sync.** `npm run sync`. Each `WARNING:` line means that source was NOT refreshed (service
   unreachable / old image / missing token) and its old files were kept: note it for the freshness
   table, do not stop. A non-zero exit means a script failed: report which one.
3. **Freshness.** `data/apple-health/extract/_meta.json` (`exportLastDate`, `shortcutSync`), the
   newest date of every CSV you will use, `data/nutrition/foodlog-daily.meta.json` (`fetchedAt`),
   `data/profile/settings.json` (`fetchedAt`). Anything > 3 days old is flagged; the export's last
   date is a partial day.
4. **Live facts.** Goal + target weight from `settings.json`, events / birthdate / height from
   `profile/profile.json`, weight from `extract/weight.csv` (within one `source`), sports and accepted
   targets from `data/profile/onboarding.json` when it exists, daily behaviours from
   `extract/journal-daily.csv`. Never from the
   prose of `about-me.md`, `baseline.md` or an old report; when they disagree, the live file wins.
5. **Load the data** per `CLAUDE.md` → Data sources; compute trends (rolling averages), not single
   days. Reuse the `lib/` functions the page uses when one exists; say when you did not.
6. **Previous report.** Read the newest `analysis/reports/*.md` (all reports are local, gitignored):
   compare the snapshot and give every one of its actions a status backed by data.
7. **Coach sub-questions.** Delegate the specialised parts and cite their answers:
   nutrition / body composition / fuelling / supplements → `nutrition-coach`; cycling training →
   `cycling-coach`; HYROX / hybrid training → `hybrid-coach`; any other sport's training →
   `training-coach`. They are read-only and cite sources.
8. **Write** `analysis/reports/YYYY-MM-DD.md` (today's date) in the user's language
   (`profile/coaches.md` → Common → Language; else the language they write in), per methodology §6:
   0. freshness & limits, snapshot, trends, follow-up of previous actions, **2–4 actions**,
   disclaimer in that language ("I am not a doctor", device error margins, safety bounds of methodology).
9. **Chat summary.** Key findings + the 2–4 actions, short; link the report path.

## Rules

- Flag missing data instead of guessing; no number without a method in `methodology.md`.
- No crash diets: respect methodology "Safety bounds".
- Never commit the report or any personal file (all gitignored).
