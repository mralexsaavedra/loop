# AI setup hardening

Worktree: `/root/health-coach-ai`, branch `chore/ai-setup-hardening` (main clone stays on `main`).

## Objective

Fix the weaknesses found in the 2026-10-07 audit of the repo's Claude Code setup (CLAUDE.md, coach
subagents, guard hook, settings, skills).

## Problem / why

- The `guard-health-data` hook matches path substrings in the command, so `git add -f data`,
  `git add -f analysis`, `cd <dir> && git add -f <file>` pass, and one allowed fragment anywhere
  in the command cancels every personal match. Several gitignored personal paths (`knowledge/`,
  `foodlog-daily.csv`, `backups/`, `data/gear/`) are not listed. Only Bash is guarded.
- CLAUDE.md's analysis workflow drifted from the coach agents (live facts, freshness) and points
  at a dead weight source; `analysis/methodology.md` §6 predates the current report structure.
- CLAUDE.md loads 209 lines every session, incl. an onboarding section for an onboarded owner.

## Scope (owner: "haz todo en orden")

## Constraints

- Never commit personal data; never weaken the hook. Docs in sync with code in the same commit.
- Conventional commits, no attribution lines. Push / PR / merge are the owner's.

## Checklist

- [x] T1 Hook: resolve force-add targets with `git check-ignore`, per-argument allow-list, honour `cd`; tests (route: delegated writer — non-trivial hook logic + tests)
- [ ] T2 Hook: guard Edit/Write on `.gitignore`; deny reads of `.env*` via permissions (route: delegated writer)
- [ ] T3 CLAUDE.md analysis workflow: live facts + freshness, real weight source; methodology §6 report structure + language (route: delegated writer — 2 files, needs reading the agents and reports)
- [ ] T4 `/analysis` project skill; trim CLAUDE.md (onboarding → docs, dedupe rules, drop repeated commands) (route: delegated writer)
- [ ] T5 Coach agents: drift test for the shared block; explicit `model:` (route: delegated writer)
- [ ] T6 Local only (no commit): drop `gh pr merge:*` from settings.local.json; refresh skill registry (route: inline)

## Acceptance

- Hook blocks every force-add of an ignored, non-exception path regardless of spelling; tests cover the audit's bypasses; `npm test` green.
- CLAUDE.md and the analysis skill reference only existing files; `npm test` green.

## Progress / evidence

- T1 (route: delegated writer). Tests run against a temp git repo fixture (copy of the real
  `.gitignore` + synthetic files). RED: `node --test .claude/hooks/guard-health-data.test.js` →
  36 tests, 18 fail against the old hook. GREEN: 36/36 pass. `npm test`: 1612 tests, 1607 pass,
  0 fail. New doc `docs/guard-hook.md` (no hook doc existed; CLAUDE.md architecture map row pending,
  outside this writer's edit surface). Commit: see `git log` (`fix(hooks): ...`).

## Next step

T2.
