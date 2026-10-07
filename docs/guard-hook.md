# Guard hook (`guard-health-data`)

The Claude Code PreToolUse hook that makes the hard rule "never commit raw health data" mechanical.

> Area design doc. Read it before changing `.claude/hooks/` or the hook wiring in
> `.claude/settings.json`, and keep it in sync with the code in the same commit.

## Files

- `.claude/hooks/guard-health-data.js` — the hook. Reads the tool-call payload on stdin; exit `0` = allow,
  exit `2` = block (stderr is shown to the assistant). A malformed payload fails open (exit `0`).
- `.claude/hooks/guard-health-data.test.js` — `node --test` suite (part of `npm test`). Every case runs
  against a temporary git repo (`mkdtemp` + `git init`) with a copy of the real `.gitignore` and synthetic
  files, so it never depends on personal files existing. Commands in it are built from word arrays, so
  the file holds no literal force-add string (the live hook also guards the assistant's own shell).
- `.claude/settings.json` — wires the hook as a `PreToolUse` command hook on `Bash`.

## Bash: force-add of ignored paths

In this repo **gitignored = personal by definition**, so the hook asks git instead of keeping a path list:

1. The command is tokenized (quotes, escapes, `&&` / `||` / `;` / `|` / `&`, subshells, `bash -c '…'`,
   redirections, comments). Each simple command is inspected after stripping `VAR=…` assignments and
   wrappers (`env`, `sudo`, `command`, `rtk`, …).
2. The effective cwd starts at the payload `cwd` and follows `cd` / `pushd` and `git -C <dir>`.
3. For every `git add` / `git stage` with a force flag (`-f`, `--force`, an abbreviation such as `--forc`,
   or a combined short flag like `-fA`, in any position), **each pathspec is judged on its own**:
   - `git check-ignore -q --no-index -- <spec>` — a literal path is ignored even if it does not exist yet
     (created earlier in the same command);
   - `git ls-files -o -i --exclude-standard --directory -- <spec>` — a directory, `.`, glob or `:/` magic
     targets every untracked ignored file under it;
   - `-A` / `--all` with no pathspec counts as `:/` (the whole tree).
   Any ignored target blocks the whole command. An allowed argument never cancels another one.
4. Targets the hook cannot know before the command runs are blocked: a `$VAR` / `$(…)` / backtick
   argument, `xargs git add -f`, `--pathspec-from-file`, or a `cd` to an unresolvable directory.
5. Fallback when git cannot answer (not installed, cwd missing or not a repo): a small built-in list of
   personal fragments (`PERSONAL`) and exception suffixes (`ALLOWED`), still evaluated per argument; a
   parent directory of a personal fragment (`data`, `.`) counts as personal.

Allowed: plain `git add .` / `-A` without force, and force-adds of tracked or non-ignored files
(generators, `.example` seeds, `.gitkeep`, `sync-*.js`, `knowledge/README.md`).

## Bash: `.gitignore` rewrites from the shell

A shell write to `.gitignore` (`>`, `>>`, `tee`, `truncate`, or `sed` on it) that mentions any `PERSONAL`
fragment is blocked. No exception name cancels the match: editing `.gitignore` from the shell is never
needed.
