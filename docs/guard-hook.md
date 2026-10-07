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
- `.claude/settings.json` — wires the hook as a `PreToolUse` command hook on `Bash|Edit|Write|MultiEdit`,
  and denies `Read(**/.env*)` (plus `Read(./data/training/.env.hyprogram)` spelled out, redundant with
  the glob but explicit for the Hyprogram credentials). The deny covers the Read tool only, not `cat` in
  Bash.

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

## Edit / Write / MultiEdit on a `.gitignore`

For any file named `.gitignore` (root or nested; a relative `file_path` resolves against the payload
`cwd`), the hook computes the content after the edit (Write = new content; Edit / MultiEdit = the
replacements applied in order; an edit whose `old_string` is missing is left to fail on its own) and:

1. **Blocks removed ignore patterns** — any non-comment, non-negation line present before and missing
   after (multiset compare, so rewording or moving a pattern also counts). Removing a `!` negation or
   editing a comment is allowed (it can only ignore more).
2. **Blocks negations that un-ignore something** — it lists the untracked ignored paths under the
   edited file's directory (`ls-files -oi --directory`), keeps those a `.gitignore` ignores
   (`check-ignore -v`; `info/exclude` and the global excludes file are unaffected), then replays the
   rules in a scratch repo (`mkdtemp` + `git init`) holding every `.gitignore` of the repo with the
   edited one replaced, plus empty stand-ins for those paths. Any path git no longer reports as
   ignored blocks the edit. A negation that matches no existing ignored file is allowed.
3. Fallback when git is unavailable: an added `!` line that mentions a `PERSONAL` fragment (or a parent
   directory of one) and is not an `ALLOWED` exception is blocked.

Adding new ignore patterns is always allowed.
