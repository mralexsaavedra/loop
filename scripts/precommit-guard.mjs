#!/usr/bin/env node
/**
 * The opt-in git pre-commit hook's check (scripts/git-hooks/pre-commit; docs/guard-hook.md → Git pre-commit
 * hook). Same rule as the Claude Code guard hook (.claude/hooks/guard-health-data.js): never commit personal
 * data, which in this repo means anything .gitignore ignores. That hook judges shell commands and exports no
 * path-level check, so this one asks git directly about what is STAGED:
 *   1) a staged file (added, copied, modified, renamed) that the ignore rules match: it got in with
 *      `git add -f` (`git check-ignore --no-index`, so a staged file still counts as ignored);
 *   2) a staged .gitignore that drops an ignore pattern or adds a `!` negation compared with HEAD (it could
 *      un-ignore personal files; adding patterns is fine).
 * Exit 1 with the offending paths and how to unstage them; 0 otherwise. `git commit --no-verify` skips it.
 */
import { spawnSync } from 'node:child_process';
import { isMain } from './lib/is-main.mjs';

function git(cwd, args, input) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

/** Staged paths (added / copied / modified / renamed, never deletions). */
export function stagedPaths(cwd) {
  const r = git(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
  if (r.status !== 0) throw new Error(`git diff --cached failed: ${r.stderr.trim()}`);
  return r.stdout.split('\0').filter(Boolean);
}

/** The staged paths the ignore rules match: personal files that only a force-add could stage. */
export function stagedIgnored(cwd, paths = stagedPaths(cwd)) {
  if (paths.length === 0) return [];
  const r = git(cwd, ['check-ignore', '--no-index', '--stdin', '-z'], paths.join('\0') + '\0');
  if (r.status > 1) throw new Error(`git check-ignore failed: ${r.stderr.trim()}`);
  return r.stdout.split('\0').filter(Boolean);
}

const patterns = (text) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/** Per staged .gitignore: the patterns it drops and the `!` negations it adds, compared with HEAD. */
export function loosenedGitignores(cwd, paths = stagedPaths(cwd)) {
  const out = [];
  for (const p of paths.filter((x) => /(^|\/)\.gitignore$/.test(x))) {
    const head = git(cwd, ['show', `HEAD:${p}`]);
    const before = head.status === 0 ? patterns(head.stdout) : [];
    const after = patterns(git(cwd, ['show', `:${p}`]).stdout);
    const removed = before.filter((l) => !l.startsWith('!') && !after.includes(l));
    const negations = after.filter((l) => l.startsWith('!') && !before.includes(l));
    if (removed.length || negations.length) out.push({ file: p, removed, negations });
  }
  return out;
}

function main() {
  const cwd = process.cwd();
  const paths = stagedPaths(cwd);
  const ignored = stagedIgnored(cwd, paths);
  const loosened = loosenedGitignores(cwd, paths);
  if (!ignored.length && !loosened.length) return 0;
  const lines = ['pre-commit (scripts/git-hooks): this commit would add personal data, which this repo never commits', '(CLAUDE.md → Repo rules; docs/guard-hook.md).', ''];
  if (ignored.length) {
    lines.push('Staged files that .gitignore ignores (personal by definition; they got in with `git add -f`):');
    for (const p of ignored) lines.push(`  ${p}`);
    lines.push(`Unstage them: git restore --staged -- ${ignored.map((p) => JSON.stringify(p)).join(' ')}`, '');
  }
  for (const g of loosened) {
    lines.push(`${g.file} loosens the ignore rules compared with HEAD:`);
    for (const l of g.removed) lines.push(`  removes  ${l}`);
    for (const l of g.negations) lines.push(`  adds     ${l}`);
    lines.push(`Keep its patterns (adding new ones is fine), or unstage it: git restore --staged -- ${g.file}`, '');
  }
  lines.push('If you are sure none of it is personal: git commit --no-verify.');
  process.stderr.write(lines.join('\n') + '\n');
  return 1;
}

if (isMain(import.meta.url)) process.exit(main());
