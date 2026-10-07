# Guard hook (`guard-health-data`)

The Claude Code PreToolUse hook that makes the repo rule "never commit personal / raw health data"
mechanical.

> Area design doc. Read it before changing `.claude/hooks/` or the hook wiring in
> `.claude/settings.json`, and keep it in sync with the code in the same commit.

## Files

- `.claude/hooks/guard-health-data.js` — the hook. Reads the tool-call payload on stdin; exit `0` = allow,
  exit `2` = block (stderr is shown to the assistant). A malformed payload fails open (exit `0`); an
  unexpected exception or fs / child-process error while judging a well-formed call fails **closed**
  (exit `2`, "internal error" message) — Claude Code treats any other non-zero exit as non-blocking, so
  a crash must never mean "allow". An existing `.gitignore` that cannot be read (anything but
  `ENOENT`) is such an error, never "empty".
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
   wrappers (`env`, `sudo`, `doas`, `nice`, `time`, `timeout`, `exec`, `command`, `rtk [proxy]`, …)
   **with their option arguments** (`sudo -u x`, `env -u NAME`, `nice -n 10`, `timeout -s KILL 5`, …,
   from a per-wrapper table). `env -C <dir>` / `sudo -D <dir>` move that command's cwd; `env -S '…'` is
   parsed as a command. After a wrapper, an unknown option cannot hide the command: if the unwrapped
   name is not a known one, the hook jumps to the next `git` word.
   `eval '…'` is parsed as a command (with a `$…` argument mentioning `git`: unresolvable → blocked).
   A shell without `-c` reads a script or its stdin (`echo '…' | bash`): the commands are invisible, so
   force-add text anywhere in the surrounding command blocks.
2. The effective cwd starts at the payload `cwd` and follows `cd` / `pushd` and `git -C <dir>`, with
   shell scoping: a `cd` inside `( … )` applies inside the subshell and is undone after it, and a `cd`
   in a pipeline or background job (`cd x | …`, `cd x & …`) does not move later commands.
3. For every `git add` / `git stage` with a force flag (`-f`, `--force`, an abbreviation such as `--forc`,
   or a combined short flag like `-fA`, in any position), **each pathspec is judged on its own**:
   - `git check-ignore -q --no-index -- <spec>` — a literal path is ignored even if it does not exist yet
     (created earlier in the same command);
   - `git ls-files -o -i --exclude-standard --directory -- <spec>` — a directory, `.`, glob or `:/` magic
     targets every untracked ignored file under it;
   - `-A` / `--all` with no pathspec counts as `:/` (the whole tree).
   Any ignored target blocks the whole command. An allowed argument never cancels another one.
4. **Git aliases** cannot hide the force-add. A subcommand that is not a git builtin (`git --list-cmds=builtins`;
   git never lets an alias shadow a builtin, so `-c alias.status=…` is ignored) is looked up as an alias:
   inline `-c alias.<name>=…` first (last one wins, names case-insensitive), then
   `git config --get alias.<name>` in the effective cwd (repo, global, system; `--git-dir` / `--work-tree`
   passed along). The expansion is judged like the original command:
   - a plain alias (`add -f`, another alias name, `-C dir add -f`) is split and re-parsed as git arguments
     with the remaining words appended, so `git hcplain -f <path>` with `hcplain = add` is a force-add too;
   - a `!` shell alias is parsed as a shell command run from the work-tree top, with the remaining words
     appended as `"$@"` would be, and it inherits the inline aliases (git passes `-c` config on);
   - nested aliases are followed up to 10 levels; a loop stops there and blocks only when a step of the
     chain looks like a force-add (git itself refuses the loop).
   Fail-closed cases: an alias value from `--config-env` or a `$…` value, git config injected with
   `GIT_CONFIG_*` assignments, a plain alias containing shell operators that looks like a force-add, a
   shell alias whose text looks like a force-add but yields no parseable target, and an alias lookup
   git cannot answer. A non-builtin subcommand that is not an alias (an external `git-foo`, a typo) passes.
   Not covered: `help.autocorrect` running a mistyped `add`, and `export GIT_CONFIG_*` in an earlier
   command.
5. Targets the hook cannot know before the command runs are blocked: a `$VAR` / `$(…)` / backtick
   argument, `xargs git add -f`, `--pathspec-from-file`, or a `cd` to an unresolvable directory.
6. Fallback when git cannot answer (not installed, cwd missing or not a repo): a small hand-maintained
   list of personal fragments (`PERSONAL`, a subset of `.gitignore`, not a mirror: add new personal
   directories there too) and exceptions (`ALLOWED`, regexes anchored to their directory, e.g.
   `data/apple-health/*.test.js`, never a generic `.test.js` suffix), still evaluated per argument; a
   parent directory of a personal fragment (`data`, `.`) counts as personal.

Allowed: plain `git add .` / `-A` without force, force-adds of tracked or non-ignored files
(generators, `.example` seeds, `.gitkeep`, `sync-*.js`, `knowledge/README.md`), and aliases that do not
expand to a force-add of an ignored path (`log --oneline`, `!echo …`).

## Bash: `.gitignore` rewrites from the shell

A shell write to `.gitignore` (`>`, `>>`, `tee`, `truncate`, or `sed` on it) that mentions any `PERSONAL`
fragment is blocked. No exception name cancels the match: editing `.gitignore` from the shell is never
needed.

## Edit / Write / MultiEdit on a `.gitignore`

For any file named `.gitignore` (root or nested; a relative `file_path` resolves against the payload
`cwd`), the hook computes the content after the edit (Write = new content; Edit / MultiEdit = the
replacements applied in order; an edit whose `old_string` is missing is left to fail on its own) and:

1. **Blocks removed ignore patterns** — any non-comment, non-negation line present before and missing
   after, compared as a multiset: rewording a pattern or deleting one of two copies counts as a removal;
   moving a line unchanged does not (order matters only against negations, and step 2's replay catches
   a move that un-ignores something). Removing a `!` negation or editing a comment is allowed (it can
   only ignore more).
2. **Blocks negations that un-ignore something** — it lists the untracked ignored paths under the
   edited file's directory (`ls-files -oi --directory`), keeps those a `.gitignore` ignores
   (`check-ignore -v`; `info/exclude` and the global excludes file are unaffected), then replays the
   rules in a scratch repo (`mkdtemp` + `git init`) holding every `.gitignore` of the repo with the
   edited one replaced, plus empty stand-ins for those paths. Any path git no longer reports as
   ignored blocks the edit. A negation that matches no existing ignored file is allowed.
3. Fallback when git is unavailable: an added `!` line that mentions a `PERSONAL` fragment (or a parent
   directory of one) and is not an `ALLOWED` exception is blocked.

Adding new ignore patterns is always allowed.
