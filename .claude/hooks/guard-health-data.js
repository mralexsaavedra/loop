#!/usr/bin/env node
'use strict';

/**
 * PreToolUse guard — enforces the CLAUDE.md HARD RULE: "Never commit raw health data."
 *
 * The rule used to live only in the assistant's memory. This hook makes it
 * mechanical: it inspects every Bash command and every Edit / Write / MultiEdit
 * before it runs and BLOCKS the ways personal health data could slip past
 * .gitignore —
 *   1) `git add -f/--force` (or `git stage -f`) of a gitignored path,
 *   2) un-ignoring a personal-data path by editing .gitignore from the shell, and
 *   3) an Edit / Write / MultiEdit of any .gitignore that removes an ignore
 *      pattern or adds a `!` negation that would un-ignore a currently ignored
 *      path (replayed against git in a scratch repo; adding patterns is fine).
 *
 * In this repo gitignored = personal by definition, so (1) asks git itself:
 * every pathspec of a force-add is resolved against the effective cwd (the
 * payload `cwd`, moved by any `cd` / `git -C` earlier in the same command) and
 * checked with `git check-ignore --no-index` and `git ls-files -oi`, so a
 * directory argument (`data`, `.`) counts as every ignored file under it.
 * Each argument is judged on its own: an allowed argument never cancels a
 * personal one. Targets the hook cannot resolve (`$VAR`, `$(...)`, xargs,
 * --pathspec-from-file) are blocked. A small built-in list is the fallback
 * only when git is unavailable.
 *
 * Plain `git add .` / `-A` (no force) and force-adds of tracked or
 * non-ignored files (generators, `.example` seeds, `.gitkeep`) pass.
 *
 * Exit codes: 0 = allow; 2 = block (stderr is surfaced back to the assistant).
 * A malformed payload fails open (exit 0).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Fallback personal-data path fragments (mirrors .gitignore), used ONLY when
// git cannot answer (not installed, cwd not a repo). The primary check is git.
const PERSONAL = [
  'data/apple-health/',
  'data/weight/',
  'data/nutrition/food-log.md',
  'data/nutrition/plan-web.html',
  'data/nutrition/plan-data.json',
  'data/nutrition/plan-tables.md',
  'data/nutrition/foodlog-daily.',
  'data/nutritionist/',
  'data/training/',
  'data/clinical/',
  'data/gear/',
  'data/profile/',
  'analysis/reports/',
  'profile/about-me.md',
  'profile/baseline.md',
  'profile/profile.json',
  'knowledge/',
  'backups/',
  'apple_health_export/',
  '.local.md',
  '.bak',
  // Astro build output / test fixtures / served site — derived from the
  // personal data above (baked JSON globals, rendered copy).
  'web/dist/',
  'web/test/.golden/',
  'services/plan-web/site/',
  'services/plan-web/.env',
  'web/.test-dist/',
];

// Fallback exceptions (the "!" rules in .gitignore): an argument whose path
// ends with one of these is not personal. Judged per argument, never per command.
const ALLOWED = [
  '.gitkeep',
  '.example.json',
  '.env.example',
  'knowledge/README.md',
  'extract.js',
  'samples.js',
  'sync-common.js',
  'sync-shortcut.js',
  'sync-strava.js',
  'sync-profile.js',
  'sync-settings.js',
  '.test.js',
];

function block(reason) {
  process.stderr.write(
    `\u{1F6E1}️  BLOCKED by guard-health-data hook\n\n` +
      `${reason}\n\n` +
      `This repo's HARD RULE (CLAUDE.md): never commit raw health data.\n` +
      `If this is genuinely intended, do it yourself in a terminal outside the assistant.\n`
  );
  process.exit(2); // 2 = block the tool call
}

// --- shell parsing -------------------------------------------------------------

const OPS = ['&&', '||', '|&', ';;', '|', ';', '&', '(', ')'];

/**
 * Minimal POSIX-ish tokenizer: words (quotes and escapes resolved) and
 * control operators. A word built from `$...` / backticks outside single
 * quotes is flagged `dynamic` (its value is unknown to the hook).
 */
function tokenize(cmd) {
  const tokens = [];
  let word = null;
  let skipNext = false; // next word is a redirection target
  const startWord = () => {
    if (!word) word = { word: '', dynamic: false };
  };
  const endWord = () => {
    if (word) {
      if (skipNext) skipNext = false;
      else tokens.push(word);
      word = null;
    }
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === ' ' || c === '\t') {
      endWord();
    } else if (c === '\n') {
      endWord();
      tokens.push({ op: ';' });
    } else if (c === '#' && !word) {
      while (i < cmd.length && cmd[i] !== '\n') i++;
      i--;
    } else if (c === "'") {
      startWord();
      const j = cmd.indexOf("'", i + 1);
      const end = j === -1 ? cmd.length : j;
      word.word += cmd.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      startWord();
      i++;
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < cmd.length && '"\\$`\n'.includes(cmd[i + 1])) {
          if (cmd[i + 1] !== '\n') word.word += cmd[i + 1];
          i += 2;
          continue;
        }
        if (cmd[i] === '$' || cmd[i] === '`') word.dynamic = true;
        word.word += cmd[i];
        i++;
      }
    } else if (c === '\\') {
      if (cmd[i + 1] === '\n') {
        i++;
        continue;
      }
      startWord();
      if (i + 1 < cmd.length) word.word += cmd[++i];
    } else if (c === '$' || c === '`') {
      startWord();
      word.dynamic = true;
      if (c === '`') {
        const j = cmd.indexOf('`', i + 1);
        const end = j === -1 ? cmd.length : j;
        word.word += cmd.slice(i, end + 1);
        i = end;
      } else if (cmd[i + 1] === '(' || cmd[i + 1] === '{') {
        const open = cmd[i + 1];
        const close = open === '(' ? ')' : '}';
        let depth = 0;
        let j = i + 1;
        for (; j < cmd.length; j++) {
          if (cmd[j] === open) depth++;
          else if (cmd[j] === close && --depth === 0) break;
        }
        word.word += cmd.slice(i, j + 1);
        i = j;
      } else {
        word.word += c;
      }
    } else if (c === '>' || c === '<') {
      // Redirection: drop a pure fd prefix (`2>`), the operator and its target.
      if (word && !word.dynamic && /^\d+$/.test(word.word)) word = null;
      endWord();
      let j = i + 1;
      while (j < cmd.length && '<>|'.includes(cmd[j])) j++;
      if (cmd[j] === '&') {
        j++;
        while (j < cmd.length && /[\d-]/.test(cmd[j])) j++;
      } else {
        skipNext = true;
      }
      i = j - 1;
    } else {
      const op = OPS.find((o) => cmd.startsWith(o, i));
      if (op) {
        endWord();
        tokens.push({ op });
        i += op.length - 1;
      } else {
        startWord();
        word.word += c;
      }
    }
  }
  endWord();
  return tokens;
}

/** Split tokens into simple commands (arrays of word tokens). */
function segments(tokens) {
  const out = [];
  let cur = [];
  for (const t of tokens) {
    if (t.op) {
      if (cur.length) out.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const WRAPPERS = new Set(['command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'sudo', 'env', 'rtk', 'then', 'do', 'else', '!', '{']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

function expandTilde(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Walk a command string and collect every force-add target as
 * `{ cwd, spec, unknown }`. `cwd` is null when a preceding `cd` could not be
 * resolved. `unknown` marks targets the hook cannot know (variables, xargs).
 */
function collectForceAdds(cmd, startCwd, out = []) {
  let cwd = startCwd;
  for (const seg of segments(tokenize(cmd))) {
    const words = seg.slice();
    let viaXargs = false;
    // Strip assignments and wrapper commands (`FOO=1 env sudo git ...`, `xargs git ...`).
    while (words.length) {
      const w = words[0].word;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || WRAPPERS.has(w)) {
        words.shift();
        while (words.length && words[0].word.startsWith('-')) words.shift();
      } else if (w === 'xargs') {
        viaXargs = true;
        words.shift();
        while (words.length && words[0].word.startsWith('-')) {
          const opt = words.shift().word;
          if (/^-[IdEsLnP]$/.test(opt)) words.shift();
        }
      } else {
        break;
      }
    }
    if (!words.length) continue;
    const name = path.basename(words[0].word);
    const args = words.slice(1);

    if (name === 'cd' || name === 'pushd') {
      const target = args.find((a) => !a.word.startsWith('-') || a.word === '-');
      if (!target) cwd = os.homedir();
      else if (target.dynamic || target.word === '-' || cwd === null) cwd = null;
      else cwd = path.resolve(cwd, expandTilde(target.word));
      continue;
    }

    if (SHELLS.has(name)) {
      const ci = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a.word));
      if (ci !== -1 && args[ci + 1]) {
        if (args[ci + 1].dynamic) out.push({ cwd, spec: args[ci + 1].word, unknown: true });
        else collectForceAdds(args[ci + 1].word, cwd, out);
      }
      continue;
    }

    if (name !== 'git') continue;
    let gitCwd = cwd;
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i].word;
      if (a === '-C') {
        const dir = args[++i];
        if (!dir || dir.dynamic || gitCwd === null) gitCwd = null;
        else gitCwd = path.resolve(gitCwd, expandTilde(dir.word));
      } else if (['-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'].includes(a)) {
        i++;
      } else if (!a.startsWith('-')) {
        break;
      } // else: another global option (--no-pager, --git-dir=..., -p, ...)
    }
    const sub = args[i] && args[i].word;
    if (sub !== 'add' && sub !== 'stage') continue;

    let force = false;
    let all = false;
    let unknownSource = viaXargs;
    const specs = [];
    let endOfOptions = false;
    for (const a of args.slice(i + 1)) {
      const w = a.word;
      if (!endOfOptions && w === '--') {
        endOfOptions = true;
      } else if (!endOfOptions && w.startsWith('--')) {
        const optName = w.slice(2).split('=')[0];
        if (optName.length && 'force'.startsWith(optName)) force = true;
        else if (optName === 'all') all = true;
        else if (optName.startsWith('pathspec-from-file')) unknownSource = true;
      } else if (!endOfOptions && /^-[A-Za-z]+$/.test(w)) {
        if (w.includes('f')) force = true;
        if (w.includes('A')) all = true;
      } else {
        specs.push(a);
      }
    }
    if (!force) continue;
    if (unknownSource) out.push({ cwd: gitCwd, spec: '(pathspecs read from stdin/file)', unknown: true });
    if (!specs.length && all) out.push({ cwd: gitCwd, spec: ':/', unknown: false });
    for (const s of specs) out.push({ cwd: gitCwd, spec: s.word, unknown: s.dynamic || gitCwd === null });
  }
  return out;
}

// --- ignore checks -------------------------------------------------------------

function git(cwd, args) {
  const res = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return res.error ? { error: res.error } : res;
}

/**
 * true  = the pathspec targets at least one gitignored path,
 * false = it does not,
 * null  = git could not answer (unavailable, cwd missing or not a repo).
 */
function targetsIgnored(cwd, spec) {
  if (!fs.existsSync(cwd)) return null;
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (top.error || top.status !== 0) return null;
  // A literal path, existing or not yet created (e.g. by an earlier step of
  // the same command), checked against the ignore rules alone.
  if (!spec.startsWith(':')) {
    const ci = git(cwd, ['check-ignore', '-q', '--no-index', '--', spec]);
    if (ci.status === 0) return true;
  }
  // Any pathspec (directory, `.`, glob, magic): untracked ignored files under it.
  const ls = git(cwd, ['ls-files', '-z', '-o', '-i', '--exclude-standard', '--directory', '--', spec]);
  if (ls.error) return null;
  if (ls.status === 0) return ls.stdout.length > 0;
  return false; // e.g. a path outside the repository: `git add` itself refuses it
}

function normalize(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Fallback when git is unavailable: the built-in fragment list, per argument. */
function fallbackPersonal(baseCwd, cwd, spec) {
  const rel = normalize(path.relative(baseCwd, path.resolve(cwd, spec)));
  return [rel, normalize(spec)].some((c) => {
    if (c === '' || c === '.' || c === ':/') return true; // the whole tree
    const dir = c.replace(/\/+$/, '');
    if (PERSONAL.some((p) => p.startsWith(dir + '/'))) return true; // a parent dir of personal data
    if (ALLOWED.some((a) => c.endsWith(a))) return false;
    return PERSONAL.some((p) => c.includes(p));
  });
}

function checkForceAdds(command, baseCwd) {
  const offending = [];
  for (const t of collectForceAdds(command, baseCwd)) {
    if (t.unknown || t.cwd === null) {
      offending.push(`${t.spec} (target cannot be resolved before running)`);
      continue;
    }
    let ignored = targetsIgnored(t.cwd, t.spec);
    if (ignored === null) ignored = fallbackPersonal(baseCwd, t.cwd, t.spec);
    if (ignored) offending.push(t.spec);
  }
  if (offending.length) {
    block(
      'Detected `git add --force` targeting gitignored (personal) data:\n' +
        offending.map((o) => `  - ${o}`).join('\n') +
        '\nIn this repo every gitignored path is personal by definition.'
    );
  }
}

// --- .gitignore rewrites from the shell ----------------------------------------

function mentionsPersonal(cmd) {
  // Strip shell/regex backslash escapes so an escaped slash (e.g. sed's
  // `profile\/about-me.md`) still matches the plain path fragment. No
  // exception name cancels a match: rewriting .gitignore from the shell is
  // never needed (the editor tools are guarded with a precise diff check).
  const normalized = cmd.replace(/\\/g, '');
  return PERSONAL.some((p) => normalized.includes(p));
}

function checkShellGitignore(command) {
  const writesGitignore =
    /(>>?|tee|truncate)\s*[^|;&]*\.gitignore/.test(command) ||
    (/\.gitignore/.test(command) && /\bsed\b/.test(command));
  if (writesGitignore && mentionsPersonal(command)) {
    block('Detected an attempt to un-ignore a personal-data path in .gitignore.');
  }
}

// --- Edit / Write / MultiEdit on a .gitignore ------------------------------------

/** The file content after the tool call, or null when the edit would not apply. */
function contentAfter(toolName, input, before) {
  const applyEdit = (text, e) => {
    if (!e || typeof e.old_string !== 'string' || typeof e.new_string !== 'string') return null;
    if (e.old_string === '' || !text.includes(e.old_string)) return null; // the tool itself fails
    return e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string);
  };
  if (toolName === 'Write') return typeof input.content === 'string' ? input.content : null;
  if (toolName === 'Edit') return applyEdit(before, input);
  if (toolName === 'MultiEdit') {
    if (!Array.isArray(input.edits)) return null;
    let text = before;
    for (const e of input.edits) {
      text = applyEdit(text, e);
      if (text === null) return null;
    }
    return text;
  }
  return null;
}

/** Pattern lines of a .gitignore (no blanks, no comments). */
function patternLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Lines in `a` missing from `b`, counted as a multiset. */
function missingLines(a, b) {
  const counts = new Map();
  for (const l of b) counts.set(l, (counts.get(l) || 0) + 1);
  const out = [];
  for (const l of a) {
    const n = counts.get(l) || 0;
    if (n > 0) counts.set(l, n - 1);
    else out.push(l);
  }
  return out;
}

const nulSplit = (s) => s.split('\0').filter(Boolean);

/**
 * Paths that are ignored today (by a .gitignore) and would stop being ignored
 * with `newContent` written to `file`. null = git could not answer.
 */
function wouldUnignore(file, newContent) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) return []; // a brand-new directory holds nothing ignored yet
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  if (top.error || top.status !== 0) return null;
  const root = top.stdout.trim();
  const relDir = normalize(path.relative(root, dir)) || '.';
  if (relDir.startsWith('..')) return [];

  // Untracked ignored paths under the edited file's directory (ignored
  // directories collapsed to `dir/`), kept only when a .gitignore ignores them
  // (info/exclude and the global excludes file are not affected by the edit).
  const ls = git(root, ['ls-files', '-z', '-o', '-i', '--exclude-standard', '--directory', '--', relDir]);
  if (ls.error || ls.status !== 0) return null;
  const listed = nulSplit(ls.stdout);
  if (!listed.length) return [];
  const verbose = spawnSync('git', ['-C', root, 'check-ignore', '-v', '-z', '--stdin'], {
    input: listed.join('\0') + '\0',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (verbose.error || (verbose.status !== 0 && verbose.status !== 1)) return null;
  const fields = verbose.stdout.split('\0');
  const atRisk = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [source, , pattern, pathname] = fields.slice(i, i + 4);
    if (path.basename(source) === '.gitignore' && !pattern.startsWith('!')) atRisk.push(pathname);
  }
  if (!atRisk.length) return [];

  // Replay the ignore rules in a scratch repo: every .gitignore of the repo,
  // the edited one replaced by its new content, and empty stand-ins for the
  // at-risk paths. Anything git no longer reports as ignored is un-ignored.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-gitignore-'));
  try {
    const init = spawnSync('git', ['init', '-q', scratch], { encoding: 'utf8' });
    if (init.error || init.status !== 0) return null;
    const ignores = git(root, ['ls-files', '-z', '-c', '-o', '--exclude-standard', '--', ':(glob)**/.gitignore']);
    if (ignores.error || ignores.status !== 0) return null;
    for (const rel of nulSplit(ignores.stdout)) {
      const dest = path.join(scratch, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(root, rel), dest);
    }
    const editedDest = path.join(scratch, path.relative(root, file));
    fs.mkdirSync(path.dirname(editedDest), { recursive: true });
    fs.writeFileSync(editedDest, newContent);
    for (const rel of atRisk) {
      const dest = path.join(scratch, rel);
      if (rel.endsWith('/')) fs.mkdirSync(dest, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, '');
      }
    }
    const check = spawnSync('git', ['-C', scratch, 'check-ignore', '-z', '--stdin'], {
      input: atRisk.join('\0') + '\0',
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (check.error || (check.status !== 0 && check.status !== 1)) return null;
    const stillIgnored = new Set(nulSplit(check.stdout).map((p) => p.replace(/\/+$/, '')));
    return atRisk.filter((p) => !stillIgnored.has(p.replace(/\/+$/, '')));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function checkGitignoreEdit(toolName, input, baseCwd) {
  if (typeof input.file_path !== 'string' || !input.file_path) return;
  const file = path.resolve(baseCwd, input.file_path);
  if (path.basename(file) !== '.gitignore') return;
  let before = '';
  try {
    before = fs.readFileSync(file, 'utf8');
  } catch {
    before = '';
  }
  const after = contentAfter(toolName, input, before);
  if (after === null) return;
  const oldLines = patternLines(before);
  const newLines = patternLines(after);

  const removed = missingLines(oldLines, newLines).filter((l) => !l.startsWith('!'));
  if (removed.length) {
    block(
      'Detected a .gitignore edit that removes ignore pattern(s):\n' +
        removed.map((l) => `  - ${l}`).join('\n') +
        '\nAdding patterns is fine; removing one could expose personal data.'
    );
  }

  const unignored = wouldUnignore(file, after);
  if (unignored === null) {
    // git unavailable: static check of the added negations.
    const added = missingLines(newLines, oldLines).filter((l) => l.startsWith('!'));
    const risky = added.filter((l) => {
      const p = normalize(l.slice(1).replace(/^\//, ''));
      return !ALLOWED.some((a) => p.endsWith(a)) && PERSONAL.some((f) => p.includes(f) || f.startsWith(p.replace(/\/?\*?$/, '') + '/'));
    });
    if (risky.length) {
      block('Detected a .gitignore negation that could un-ignore personal data:\n' + risky.map((l) => `  - ${l}`).join('\n'));
    }
  } else if (unignored.length) {
    block(
      'Detected a .gitignore edit that would un-ignore currently ignored (personal) path(s):\n' +
        unignored.slice(0, 20).map((p) => `  - ${p}`).join('\n') +
        (unignored.length > 20 ? `\n  … and ${unignored.length - 20} more` : '')
    );
  }
}

// --- main ----------------------------------------------------------------------

function readPayload() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  try {
    const p = JSON.parse(raw || '{}');
    return p && typeof p === 'object' ? p : null;
  } catch {
    return null; // malformed payload — fail open, never block legitimate work
  }
}

function main() {
  const payload = readPayload();
  if (!payload) process.exit(0);
  const baseCwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const input = payload.tool_input || {};

  if (payload.tool_name === 'Bash') {
    const command = input.command;
    if (typeof command !== 'string' || !command) process.exit(0);
    checkForceAdds(command, baseCwd);
    checkShellGitignore(command);
  } else if (['Edit', 'Write', 'MultiEdit'].includes(payload.tool_name)) {
    checkGitignoreEdit(payload.tool_name, input, baseCwd);
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { tokenize, collectForceAdds };
