#!/usr/bin/env node
'use strict';

/**
 * PreToolUse guard — enforces the CLAUDE.md HARD RULE: "Never commit raw health data."
 *
 * The rule used to live only in the assistant's memory. This hook makes it
 * mechanical: it inspects every Bash command before it runs and BLOCKS the two
 * ways personal health data could slip past .gitignore —
 *   1) `git add -f/--force` (or `git stage -f`) of a gitignored path, and
 *   2) un-ignoring a personal-data path by editing .gitignore from the shell.
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
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { tokenize, collectForceAdds };
