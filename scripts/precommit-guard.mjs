#!/usr/bin/env node
/**
 * The opt-in git pre-commit hook's check (scripts/git-hooks/pre-commit; docs/guard-hook.md → Git pre-commit
 * hook). Same rule as the Claude Code guard hook (.claude/hooks/guard-health-data.js): never commit personal
 * data, which in this repo means anything .gitignore ignores. That hook judges shell commands and exports no
 * path-level check, so this one asks git directly about what is STAGED:
 *   1) a staged file (added, copied, modified, renamed) that HEAD's ignore rules match: it got in with
 *      `git add -f` or after a .gitignore edit. The rules are HEAD's tracked .gitignore files (plus the
 *      clone's info/exclude), materialised in a scratch repo and asked with `git check-ignore --no-index`,
 *      so neither an unstaged working-tree edit nor a staged one can loosen what is judged;
 *   2) a staged .gitignore that drops an ignore pattern or adds a `!` negation compared with HEAD, or a
 *      staged DELETION of a .gitignore (it could un-ignore personal files; adding patterns is fine). Lines are
 *      compared as git reads them: a leading space is part of the pattern (an indented rule is a dropped one),
 *      unescaped trailing spaces are not;
 *   3) when a .gitignore is staged: an untracked file on disk that HEAD's rules ignore and the staged rules no
 *      longer do (a reordered `!` line, a rule moved to a nested .gitignore), both asked with check-ignore.
 * Exit 1 with the offending paths and how to unstage them; 0 otherwise. `git commit --no-verify` skips it.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMain } from './lib/is-main.mjs';

// A hook runs with GIT_DIR / GIT_INDEX_FILE / … pointing at the committing repo; the scratch repo must not.
const REPO_ENV = /^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE)$/;

function git(cwd, args, input, env) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input, env, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

const isGitignore = (p) => /(^|\/)\.gitignore$/.test(p);

/** The staged changes, renames split into a deletion + an addition: {paths (added / copied / modified),
 * deleted}. */
function stagedChanges(cwd) {
  const r = git(cwd, ['diff', '--cached', '--name-status', '--no-renames', '-z']);
  if (r.status !== 0) throw new Error(`git diff --cached failed: ${r.stderr.trim()}`);
  const f = r.stdout.split('\0');
  const paths = [], deleted = [];
  for (let i = 0; i + 1 < f.length; i += 2) {
    if (!f[i]) break;
    (f[i] === 'D' ? deleted : paths).push(f[i + 1]);
  }
  return { paths, deleted };
}

/** The ignore rules of a tree in a scratch repo: its .gitignore files at their paths + this clone's info/exclude.
 * `from` = 'HEAD' (the index's on a first commit) or 'index' (the staged rules). Returns the scratch dir (the
 * caller removes it) and the git env. */
function materialiseRules(cwd, from = 'HEAD') {
  const hasHead = from === 'HEAD' && git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']).status === 0;
  const list = hasHead ? git(cwd, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']) : git(cwd, ['ls-files', '-z']);
  if (list.status !== 0) throw new Error(`git ls-tree failed: ${list.stderr.trim()}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-precommit-rules-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !REPO_ENV.test(k)));
  const init = git(dir, ['init', '-q'], undefined, env);
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr.trim()}`);
  for (const p of list.stdout.split('\0').filter(isGitignore)) {
    const show = git(cwd, ['show', `${hasHead ? 'HEAD' : ''}:${p}`]);
    if (show.status !== 0) continue;
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), show.stdout);
  }
  const exclude = git(cwd, ['rev-parse', '--git-path', 'info/exclude']);
  const excludeFrom = exclude.status === 0 ? path.resolve(cwd, exclude.stdout.trim()) : null;
  if (excludeFrom && fs.existsSync(excludeFrom)) {
    fs.mkdirSync(path.join(dir, '.git', 'info'), { recursive: true });
    fs.copyFileSync(excludeFrom, path.join(dir, '.git', 'info', 'exclude'));
  }
  return { dir, env };
}

/** The `paths` a scratch rules repo ignores (git check-ignore --no-index). */
function ignoredBy(rules, paths) {
  if (paths.length === 0) return [];
  const r = git(rules.dir, ['check-ignore', '--no-index', '--stdin', '-z'], paths.join('\0') + '\0', rules.env);
  if (r.status > 1) throw new Error(`git check-ignore failed: ${r.stderr.trim()}`);
  return r.stdout.split('\0').filter(Boolean);
}

/** Runs `fn(rules)` on HEAD's (or the index's) materialised rules, then removes the scratch repo. */
function withRules(cwd, from, fn) {
  const rules = materialiseRules(cwd, from);
  try { return fn(rules); } finally { fs.rmSync(rules.dir, { recursive: true, force: true }); }
}

/** The staged paths HEAD's ignore rules match: personal files that only a force-add or a rule edit could stage. */
function stagedIgnored(cwd, paths) {
  if (paths.length === 0) return [];
  return withRules(cwd, 'HEAD', (rules) => ignoredBy(rules, paths));
}

/**
 * The untracked files on disk (whole untracked directories as `dir/`) that HEAD's rules ignore but the STAGED
 * rules no longer do: the semantic check behind the line comparison below (a reordered `!` line, a rule moved
 * to a nested .gitignore with another scope). Only when a .gitignore is staged.
 */
function unignoredOnDisk(cwd, { paths, deleted }) {
  if (![...paths, ...deleted].some(isGitignore)) return [];
  const others = git(cwd, ['ls-files', '-z', '--others', '--directory', '--no-empty-directory']);
  if (others.status !== 0) throw new Error(`git ls-files failed: ${others.stderr.trim()}`);
  const untracked = others.stdout.split('\0').filter(Boolean);
  const headIgnored = withRules(cwd, 'HEAD', (rules) => ignoredBy(rules, untracked));
  if (headIgnored.length === 0) return [];
  const stillIgnored = new Set(withRules(cwd, 'index', (rules) => ignoredBy(rules, headIgnored)));
  return headIgnored.filter((p) => !stillIgnored.has(p));
}

/** A .gitignore line as git reads it: a trailing CR and UNESCAPED trailing spaces dropped; a leading space is
 * kept (it is part of the pattern, so an indented rule is a different, non-matching one). */
function gitPattern(line) {
  let l = line.endsWith('\r') ? line.slice(0, -1) : line;
  while (l.endsWith(' ') && !l.endsWith('\\ ')) l = l.slice(0, -1);
  return l;
}
const patterns = (text) => text.split('\n').map(gitPattern).filter((l) => l && !l.startsWith('#'));

/** Per staged .gitignore: the patterns it drops and the `!` negations it adds, compared with HEAD; a staged
 * deletion drops every pattern (`deleted: true`). */
function loosenedGitignores(cwd, { paths, deleted }) {
  const out = [];
  const before = (p) => {
    const head = git(cwd, ['show', `HEAD:${p}`]);
    return head.status === 0 ? patterns(head.stdout) : [];
  };
  for (const p of deleted.filter(isGitignore)) out.push({ file: p, deleted: true, removed: before(p).filter((l) => !l.startsWith('!')), negations: [] });
  for (const p of paths.filter(isGitignore)) {
    const was = before(p);
    const after = patterns(git(cwd, ['show', `:${p}`]).stdout);
    const removed = was.filter((l) => !l.startsWith('!') && !after.includes(l));
    const negations = after.filter((l) => l.startsWith('!') && !was.includes(l));
    if (removed.length || negations.length) out.push({ file: p, deleted: false, removed, negations });
  }
  return out;
}

function main() {
  const cwd = process.cwd();
  const staged = stagedChanges(cwd);
  const ignored = stagedIgnored(cwd, staged.paths);
  const loosened = loosenedGitignores(cwd, staged);
  const unignored = unignoredOnDisk(cwd, staged);
  if (!ignored.length && !loosened.length && !unignored.length) return 0;
  const lines = ['pre-commit (scripts/git-hooks): this commit would add personal data, which this repo never commits', '(CLAUDE.md → Repo rules; docs/guard-hook.md).', ''];
  if (ignored.length) {
    lines.push('Staged files that HEAD\'s .gitignore rules ignore (personal by definition; they got in with `git add -f` or a .gitignore edit):');
    for (const p of ignored) lines.push(`  ${p}`);
    lines.push(`Unstage them: git restore --staged -- ${ignored.map((p) => JSON.stringify(p)).join(' ')}`, '');
  }
  for (const g of loosened) {
    if (g.deleted) {
      lines.push(`${g.file} is deleted, which drops every ignore rule it holds:`);
      for (const l of g.removed) lines.push(`  removes  ${l}`);
      lines.push(`Keep it: git restore --staged --worktree -- ${JSON.stringify(g.file)}`, '');
      continue;
    }
    lines.push(`${g.file} loosens the ignore rules compared with HEAD:`);
    for (const l of g.removed) lines.push(`  removes  ${l}`);
    for (const l of g.negations) lines.push(`  adds     ${l}`);
    lines.push(`Keep its patterns (adding new ones is fine), or unstage it: git restore --staged -- ${g.file}`, '');
  }
  if (unignored.length) {
    lines.push('The staged .gitignore rules no longer ignore these files on disk, which HEAD\'s rules ignore:');
    for (const p of unignored) lines.push(`  ${p}`);
    lines.push('Restore the rule (order matters: the last matching line wins), or unstage the .gitignore files: git restore --staged -- <file>', '');
  }
  lines.push('If you are sure none of it is personal: git commit --no-verify.');
  process.stderr.write(lines.join('\n') + '\n');
  return 1;
}

if (isMain(import.meta.url)) process.exit(main());
