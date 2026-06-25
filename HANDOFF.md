# Handoff / session state

> Read this at the start of a new session to resume without re-explaining.
> Update it at the end of each working session.

## Context

Owner does sport and wants data-driven health + nutrition coaching from Claude.
This repo holds the persistent context; analysis runs on demand or on a schedule
(NOT a 24/7 service — health data is low-frequency). Will later move to
`~/Developer/homelab` and onto a server.

## Status: scaffolding done, waiting on data

Repo created and git-initialized. Structure, `CLAUDE.md`, and
`analysis/methodology.md` are in place.

## Blocked on owner — needed before first analysis

1. Fill `profile/about-me.md` (age, height, weight, goal, injuries).
2. Export Apple Health → unzip → put `export.xml` in `data/apple-health/`.
3. Decide nutrition logging method — **OPEN QUESTION**: manual markdown log
   (`data/nutrition/food-log.md`) vs meal photos for Claude to estimate.
   Owner stopped using food-tracking apps, so there is currently NO food data —
   intake cannot be judged until this is solved.

## Key decisions made

- "24/7 Claude" reframed → persistent context + scheduled/on-demand runs.
- Apple Health is iOS/HealthKit-only; no web access → analysis via exported XML.
- Privacy: raw health data (export.xml, food-log, weight-log, profile) is
  gitignored, stays local. Never commit medical data, especially before pushing
  to the server.

## Next action when data arrives

Run the analysis workflow in `CLAUDE.md`: read profile + methodology, parse the
export, write the first report to `analysis/reports/`.
