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
- [x] T5 Coach agents: drift test for the shared block; explicit `model:` (route: delegated writer)
- [x] T7 Hook review follow-ups (advisory findings of the approved review): fail closed on unexpected errors, wrapper option args, subshell `cd` scope, vacuous allow tests, doc/comment fixes (route: delegated writer — hook logic + tests)
- [x] T6 Local only (no commit): skill registry refreshed (11 skills); `gh pr merge:*` KEPT — owner wants Claude to merge PRs (route: inline)

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
  `npm test`: 1623 tests, 1618 pass, 0 fail. Commit: `0e0f4df`.
- T5 (route: delegated writer). `.claude/hooks/coach-agents.test.js` (placed there because
  `.claude/hooks/*.test.js` is the only `npm test` glob inside this task's edit surface; `package.json`
  was out of scope) asserts the "## Shared rules" … "## Knowledge source" span is byte-identical in the
  three coaches and pins `model: inherit` + read-only tools. RED: 1/2 fail before `model: inherit`; a
  simulated one-character drift in `hybrid-coach.md` fails the identity test (reverted). GREEN: 2/2.
  `docs/knowledge-base.md` documents the test and the `model: inherit` choice. Commit: `3a98299`.
- T7 (route: delegated writer). Hook: evaluation wrapped in try/catch → an unexpected exception /
  fs / child-process error blocks (exit 2, "internal error"); an unreadable existing `.gitignore` is
  an error, not empty (malformed stdin still fails open). Per-wrapper option tables (`sudo -u`,
  `env -u/-C/-S`, `nice -n`, `timeout`, `time -f`, `doas`, `rtk proxy`) plus a jump to the next `git`
  after any wrapper. `cd` scoped to `( … )` subshells and ignored in pipelines / background jobs.
  R1-002 (shell handling): `eval '…'` parsed; a shell fed on stdin (`… | bash`) blocks when the
  command carries force-add text. Fallback `ALLOWED` = anchored regexes (no generic `.test.js` /
  `extract.js`); `PERSONAL` comment says subset, not mirror. Allow tests assert their preconditions
  (target exists and is not ignored; Edit `old_string` present). `docs/guard-hook.md` synced (incl. the
  multiset wording). RED: 56 tests, 8 fail. GREEN: 56/56. `npm run check`: exit 0. `npm test`:
  1634 tests, 1629 pass, 0 fail. Commit: `7d81b8a`.

## Reviews

- Slice 1 (T1–T2, `440b017..fd08dfc`): high risk, consent granted, 4 lenses approved, acknowledged.
- Slice 2 (T3–T5, T7, `a56d9ac..0ab54a7`): high risk, consent granted, 4 lenses approved, acknowledged.
- Advisory follow-ups (non-blocking): `FORCE_ADD_TEXT` fallback regex may over-match stdin-fed shells
  (guard-health-data.js:290-291); `eval` with dynamic args (:384-392); git alias hiding a force-add
  (`git -c alias.x='add -f' x`).

## Next step

All tasks done; PR to main. Follow-ups above are optional.
