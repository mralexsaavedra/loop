# Public template

Worktree: `/root/health-coach-pub`. Owner keeps working in this same repo; it goes public at the end (owner flips visibility).

## Objective

Make this repo safe and useful as a public template without losing anything personal: personal bits move to
gitignored files, newcomers get a tiered setup (L1 Apple Health + onboarding + /analysis, L2 food log + LAN page,
L3 Shortcut, Strava, own knowledge base).

## Why

Publication audit 2026-10-07 (441 commits, read-only): no secrets / identity / health metrics in tracked files or
history. Blockers: Hyprogram scraper (paid, login-gated, ToS), `DEFAULT_BY_GOAL` ships the owner's kcal targets,
owner-specific coach agents, `odd/` internal notes, owner-only CLAUDE.md sections, broken README Engram link.

## Constraints

- Nothing personal is lost: the owner's workflows (Hyprogram sync, coaches' sources, LAN page) keep working.
- Never commit personal data. Docs in sync with code. Conventional commits, no attribution.
- One PR per slice, stacked to main; Claude may merge (owner preference). Visibility flip = owner.

## Checklist

- [x] T1 Hyprogram sync out of git (gitignored local dir, still runnable by the owner) + generic `DEFAULT_BY_GOAL` (route: delegated writer)
- [ ] T2 Coach agents as templates: owner sources / gear / program from a gitignored config (route: delegated writer)
- [ ] T3 Cleanup: `odd/` gitignored, owner-only CLAUDE.md sections to a local file, README tiers + Engram link + notes (route: delegated writer)
- [ ] T4 `/setup` skill: guided install by tier (route: delegated writer)
- [ ] T5 Final check: gitleaks over full history + fresh-clone `npm ci && build:example && test` (route: delegated verifier)

## Progress / evidence

- T1 (route: delegated writer; trigger: 2+ non-trivial files). `57dae22` chore(hyprogram): the three sync
  files left git; owner copies live untracked in the main clone at `local/hyprogram/` (`/local/` gitignored),
  ROOT fixed to `../..`; offline check there: lib tests 23/23, missing-credentials path exits 2 with no network.
  Docs / hybrid-coach / settings deny generalized. `0838c01` fix(nutrition): `DEFAULT_BY_GOAL` + example
  `byGoal` = generic 70 kg seed (maintain 2300/2700/3100/3600, 125 P / 65 F; cut 1950/2350/3100/3600,
  140 / 55; bulk 2600/3000/3400/3900, 125 / 70); RED observed on new targets tests, then GREEN.
  Owner plan copied into the worktree: `npm run generate` before/after → plan-tables.md and personal build
  byte-identical; copy deleted. `npm run check` 0, `npm test` 1619/1619, hook tests 64/64.
  Pending for the owner after merge: crontab still calls `scripts/sync-hyprogram.mjs` (point it at
  `local/hyprogram/sync-hyprogram.mjs`); `profile/about-me.md` names the old path; the shared coach
  rules (all three agents) still name the `.env.hyprogram` file — T2.

## Next step

T2.
