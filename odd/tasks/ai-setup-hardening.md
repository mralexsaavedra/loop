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
- [x] T2 Hook: guard Edit/Write on `.gitignore`; deny reads of `.env*` via permissions (route: delegated writer)
- [x] T3 CLAUDE.md analysis workflow: live facts + freshness, real weight source; methodology §6 report structure + language (route: delegated writer — 2 files, needs reading the agents and reports)
- [x] T4 `/analysis` project skill; trim CLAUDE.md (onboarding → docs, dedupe rules, drop repeated commands) (route: delegated writer)
- [ ] T5 Coach agents: drift test for the shared block; explicit `model:` (route: delegated writer)
- [ ] T7 Hook review follow-ups (advisory findings of the approved review): fail closed on unexpected errors, wrapper option args, subshell `cd` scope, vacuous allow tests, doc/comment fixes (route: delegated writer — hook logic + tests)
- [ ] T6 Local only (no commit): drop `gh pr merge:*` from settings.local.json; refresh skill registry (route: inline)

## Acceptance

- Hook blocks every force-add of an ignored, non-exception path regardless of spelling; tests cover the audit's bypasses; `npm test` green.
- CLAUDE.md and the analysis skill reference only existing files; `npm test` green.

## Progress / evidence

- T1 (route: delegated writer). Tests run against a temp git repo fixture (copy of the real
  `.gitignore` + synthetic files). RED: `node --test .claude/hooks/guard-health-data.test.js` →
  36 tests, 18 fail against the old hook. GREEN: 36/36 pass. `npm test`: 1612 tests, 1607 pass,
  0 fail. New doc `docs/guard-hook.md` (no hook doc existed; CLAUDE.md architecture map row pending,
  outside this writer's edit surface). Commit: `440b017`.
- T2 (route: delegated writer). Hook now also handles Edit/Write/MultiEdit on any `.gitignore`
  (removed patterns blocked; added negations replayed in a scratch git repo); settings matcher
  `Bash|Edit|Write|MultiEdit`; `permissions.deny` `Read(**/.env*)` + explicit
  `Read(./data/training/.env.hyprogram)`. RED: 47 tests, 7 fail before the Edit/Write guard.
  GREEN: 47/47. `npm test`: 1623 tests, 1618 pass, 0 fail. Commit: the `feat(hooks): ...` commit
  following `440b017`.

- T3 (route: delegated writer). CLAUDE.md analysis step 1 now lists the live facts
  (`profile/profile.json`, `data/profile/settings.json`) and freshness sources (`_meta.json`,
  `foodlog-daily.meta.json`) with the "numbers from live files, never from prose" rule; weight source
  is `extract/weight.csv`. methodology §6 matches the 2026-09-28 / 2026-10-07 reports (0. freshness,
  follow-up of previous actions) and says reports are in Spanish. All referenced paths verified in the
  main clone (personal files are gitignored). `npm run check`: exit 0. Commit: `a56d9ac`.
- T4 (route: delegated writer). New project skill `.claude/skills/analysis/SKILL.md` (sync + WARNINGs,
  freshness, live facts, previous-report follow-up, coach delegation, report per methodology §6).
  CLAUDE.md 218 → 142 lines: analysis body → skill pointer + a compact "Data sources" section (live
  facts, freshness, caveat pointers); onboarding → `docs/onboarding.md`; personal-data rules merged
  into Repo rules; bootstrap paragraph → README pointer; food log export caveats moved to
  `docs/nutrition-food-log.md` → Food log export; map rows for onboarding + guard hook. README and the
  hook's rule references updated. `node --test .claude/hooks/guard-health-data.test.js`: 47/47;
  `npm test`: 1623 tests, 1618 pass, 0 fail. Commit: the `feat(analysis): ...` commit after `a56d9ac`.

## Next step

T5. Pending from T1/T2: add a `docs/guard-hook.md` row to the CLAUDE.md architecture map.
