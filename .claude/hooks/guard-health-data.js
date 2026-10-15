#!/usr/bin/env node
'use strict';

/**
 * PreToolUse guard — enforces the CLAUDE.md repo rule: "Never commit personal / raw health data."
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
 * personal one. A non-builtin git subcommand is expanded as an alias (inline
 * `-c alias.x=…`, then the git config; `!` shell aliases parsed as commands,
 * loops bounded) so an alias cannot hide the force-add. Targets the hook cannot resolve (`$VAR`, `$(...)`, xargs,
 * --pathspec-from-file) are blocked. A small built-in list is the fallback
 * only when git is unavailable.
 *
 * Plain `git add .` / `-A` (no force) and force-adds of tracked or
 * non-ignored files (generators, `.example` seeds, `.gitkeep`) pass.
 *
 * Exit codes: 0 = allow; 2 = block (stderr is surfaced back to the assistant).
 * A malformed payload fails open (exit 0); an unexpected error while judging a
 * well-formed call fails CLOSED (exit 2), so a crash can never let a force-add
 * or a .gitignore edit through.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Fallback personal-data path fragments, used ONLY when git cannot answer (not
// installed, cwd missing or not a repo); the primary check asks git, so this
// list is never consulted in normal operation. It is a hand-maintained SUBSET
// of .gitignore, not a full mirror: a personal path missing here is allowed in
// fallback mode, so add new personal directories here too.
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
  'services/loop-web/site/',
  'services/loop-web/.env',
  'services/loop-ingest/.env',
  'profile/coaches.md',
  'local/',
  // Pre-LOOP folder names: a clone pulled before its migration keeps its runtime files there.
  'services/plan-web/',
  'services/health-ingest/',
  'web/.test-dist/',
];

// Fallback exceptions (the "!" rules in .gitignore), anchored to their
// directory so a generic name (`*.test.js`, `extract.js`) under a personal
// directory never passes. Judged per argument, never per command.
const ALLOWED = [
  /(^|\/)\.gitkeep$/,
  /\.example\.json$/,
  /(^|\/)\.env\.example$/,
  /(^|\/)knowledge\/README\.md$/,
  /(^|\/)data\/apple-health\/(extract|sync-common|sync-shortcut|sync-strava)\.mjs$/,
  /(^|\/)data\/apple-health\/[^/]+\.test\.mjs$/,
  /(^|\/)data\/profile\/sync-(profile|settings)(\.test)?\.mjs$/,
];
const isAllowed = (p) => ALLOWED.some((re) => re.test(p));

function block(reason) {
  process.stderr.write(
    `\u{1F6E1}️  BLOCKED by guard-health-data hook\n\n` +
      `${reason}\n\n` +
      `This repo's rule (CLAUDE.md → Repo rules): never commit personal / raw health data.\n` +
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

// Wrapper commands that run another command, with the options that take an
// argument (so `sudo -u x git …` unwraps to `git`), the ones that change the
// directory the command runs in, and `env -S` (a whole command in one string).
const WRAPPERS = {
  command: {},
  builtin: {},
  exec: { arg: ['-a'] },
  nohup: {},
  time: { arg: ['-f', '--format', '-o', '--output'] },
  nice: { arg: ['-n', '--adjustment'] },
  timeout: { arg: ['-s', '--signal', '-k', '--kill-after'], positional: 1 },
  sudo: {
    arg: ['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from', '-r', '--role',
      '-t', '--type', '-U', '--other-user', '-T', '--command-timeout', '-D', '--chdir'],
    chdir: ['-D', '--chdir'],
  },
  doas: { arg: ['-u', '-C'] },
  env: { arg: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'], chdir: ['-C', '--chdir'], split: ['-S', '--split-string'] },
  rtk: { sub: ['proxy'] },
  then: {},
  do: {},
  else: {},
  '!': {},
  '{': {},
};
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

function expandTilde(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Strip one wrapper's options from the front of `words` (mutated). Returns the
 * directory option (`env -C`, `sudo -D`) and the split string (`env -S`) when given.
 */
function stripWrapperOptions(name, words) {
  const spec = WRAPPERS[name];
  const takesArg = spec.arg || [];
  const found = {};
  const record = (opt, value) => {
    if ((spec.chdir || []).includes(opt)) found.chdir = value || { word: '', dynamic: true };
    if ((spec.split || []).includes(opt)) found.split = value || { word: '', dynamic: true };
  };
  while (words.length) {
    const t = words[0];
    const w = t.word;
    if (w === '--') {
      words.shift();
      break;
    }
    if (w === '-' && name === 'env') {
      words.shift();
      continue;
    }
    if (!w.startsWith('-') || w === '-') break;
    words.shift();
    if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const opt = eq === -1 ? w : w.slice(0, eq);
      if (takesArg.includes(opt)) record(opt, eq === -1 ? words.shift() : { word: w.slice(eq + 1), dynamic: t.dynamic });
      continue;
    }
    for (let k = 1; k < w.length; k++) {
      const opt = '-' + w[k];
      if (takesArg.includes(opt)) {
        const rest = w.slice(k + 1);
        record(opt, rest ? { word: rest, dynamic: t.dynamic } : words.shift());
        break;
      }
    }
  }
  for (let n = 0; n < (spec.positional || 0) && words.length; n++) words.shift();
  if (spec.sub && words.length && spec.sub.includes(words[0].word)) words.shift();
  return found;
}

const PIPE_OR_BACKGROUND = new Set(['|', '|&', '&']);
// Text of a force-add, for commands the hook cannot parse (a shell fed on stdin).
const FORCE_ADD_TEXT = /\bgit\b[\s\S]*\b(add|stage)\b[\s\S]*(^|[\s'"])(-[A-Za-z]*f[A-Za-z]*|--f[a-z]*)([\s'"]|$)/;

/**
 * Walk a command string and collect every force-add target as
 * `{ cwd, spec, unknown }`. `cwd` is null when a preceding `cd` could not be
 * resolved. `unknown` marks targets the hook cannot know (variables, xargs).
 * A `cd` only lasts for the rest of its own shell: it is undone at the end of
 * a `( … )` subshell and has no effect when it runs in a pipeline or in the
 * background (`cd x | …`, `cd x & …`).
 */
function collectForceAdds(cmd, startCwd, out = [], ctx = ROOT_CTX) {
  const segs = [];
  let cur = [];
  let before = null;
  for (const t of tokenize(cmd)) {
    if (t.op) {
      segs.push({ words: cur, before, after: t.op });
      cur = [];
      before = t.op;
    } else {
      cur.push(t);
    }
  }
  segs.push({ words: cur, before, after: null });

  let cwd = startCwd;
  const stack = [];
  for (const seg of segs) {
    if (seg.words.length) {
      const persistent = !PIPE_OR_BACKGROUND.has(seg.before) && !PIPE_OR_BACKGROUND.has(seg.after);
      const moved = inspectCommand(seg.words.slice(), cwd, cmd, out, ctx);
      if (moved !== undefined && persistent) cwd = moved;
    }
    if (seg.after === '(') stack.push(cwd);
    else if (seg.after === ')' && stack.length) cwd = stack.pop();
  }
  return out;
}

const resolveDir = (cwd, dir) => (!dir || dir.dynamic || cwd === null ? null : path.resolve(cwd, expandTilde(dir.word)));

/**
 * Inspect one simple command. Pushes force-add targets to `out`; returns the
 * new cwd for a `cd` / `pushd` (undefined for any other command).
 */
function inspectCommand(words, cwd, fullText, out, ctx = ROOT_CTX) {
  let viaXargs = false;
  let wrapped = false;
  let envConfig = false;
  // Strip assignments and wrapper commands (`FOO=1 env sudo -u x git ...`, `xargs git ...`).
  while (words.length) {
    const w = words[0].word;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      if (/^GIT_CONFIG/.test(w)) envConfig = true; // git config injected via the environment
      words.shift();
    } else if (Object.prototype.hasOwnProperty.call(WRAPPERS, w)) {
      words.shift();
      wrapped = true;
      const found = stripWrapperOptions(w, words);
      if (found.chdir) cwd = resolveDir(cwd, found.chdir);
      if (found.split) {
        if (found.split.dynamic) out.push({ cwd, spec: found.split.word, unknown: true });
        else collectForceAdds([found.split.word, ...words.map((t) => t.word)].join(' '), cwd, out, ctx);
        return undefined;
      }
    } else if (w === 'xargs') {
      viaXargs = true;
      wrapped = true;
      words.shift();
      while (words.length && words[0].word.startsWith('-')) {
        const opt = words.shift().word;
        if (/^-[IdEsLnP]$/.test(opt)) words.shift();
      }
    } else {
      break;
    }
  }
  if (!words.length) return undefined;
  let name = path.basename(words[0].word);
  // An option the tables above do not know may have hidden the real command
  // (`sudo --new-flag value git …`): after a wrapper, jump to a later `git`.
  if (wrapped && !['git', 'cd', 'pushd', 'eval', ...SHELLS].includes(name)) {
    const gi = words.findIndex((t, k) => k > 0 && path.basename(t.word) === 'git');
    if (gi !== -1) {
      words = words.slice(gi);
      name = 'git';
    }
  }
  const args = words.slice(1);

  if (name === 'cd' || name === 'pushd') {
    const target = args.find((a) => !a.word.startsWith('-') || a.word === '-');
    if (!target) return os.homedir();
    if (target.word === '-') return null;
    return resolveDir(cwd, target);
  }

  if (name === 'eval') {
    const text = args.map((a) => a.word).join(' ');
    if (args.some((a) => a.dynamic)) {
      if (/\bgit\b/.test(text)) out.push({ cwd, spec: text, unknown: true });
    } else {
      collectForceAdds(text, cwd, out, ctx);
    }
    return undefined;
  }

  if (SHELLS.has(name)) {
    const ci = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a.word));
    if (ci !== -1) {
      if (args[ci + 1] && args[ci + 1].dynamic) out.push({ cwd, spec: args[ci + 1].word, unknown: true });
      else if (args[ci + 1]) collectForceAdds(args[ci + 1].word, cwd, out, ctx);
      return undefined;
    }
    // No -c: the shell reads a script file or its stdin (`echo '…' | bash`, a
    // here-string). The commands are invisible here, so any force-add text in
    // the surrounding command blocks.
    const readsStdin = !args.some((a) => !a.word.startsWith('-')) || args.some((a) => /^-[A-Za-z]*s[A-Za-z]*$/.test(a.word));
    if (readsStdin && FORCE_ADD_TEXT.test(fullText)) {
      out.push({ cwd, spec: `(commands fed to ${name} on stdin)`, unknown: true });
    }
    return undefined;
  }

  if (name !== 'git') return undefined;
  inspectGit(args, cwd, out, {
    ...ctx,
    viaXargs: ctx.viaXargs || viaXargs,
    envConfig: ctx.envConfig || envConfig,
  });
  return undefined;
}

// --- git: global options, aliases, add / stage -----------------------------------

// The root of every walk: no alias seen yet, no git config from the environment.
const ROOT_CTX = { aliases: new Map(), chain: [], chainText: [], viaXargs: false, envConfig: false };
// Alias expansions followed before giving up (git itself stops at a loop).
const ALIAS_MAX_DEPTH = 10;
// Text of a force-add inside an alias value (no `git` word: `add -f`).
const ALIAS_FORCE_TEXT = /\b(add|stage)\b[\s\S]*(^|[\s'"])(-[A-Za-z]*f[A-Za-z]*|--f[a-z]*)([\s'"]|$)/;

let builtinsCache;
/** git's builtin commands (an alias never shadows one); null = git cannot answer. */
function gitBuiltins() {
  if (builtinsCache === undefined) {
    const res = spawnSync('git', ['--list-cmds=builtins'], { encoding: 'utf8' });
    builtinsCache =
      res.error || res.status !== 0 ? null : new Set(res.stdout.split('\n').map((l) => l.trim()).filter(Boolean));
  }
  return builtinsCache;
}

/**
 * The value of `alias.<name>` in the git config seen from `cwd` (repo, global,
 * system): `{ value }`, `{ missing: true }`, `{ nogit: true }` (git not
 * installed) or `{ unknown: true }` (git failed to answer).
 */
function lookupAlias(cwd, name, configOpts) {
  const res = spawnSync('git', [...configOpts, 'config', '--get', `alias.${name}`], {
    cwd,
    encoding: 'utf8',
  });
  if (res.error) return res.error.code === 'ENOENT' ? { nogit: true } : { unknown: true };
  if (res.status === 0) return { value: res.stdout.replace(/\n$/, '') };
  if (res.status === 1) return { missing: true };
  return { unknown: true };
}

/** Re-quote a parsed word for a shell command line (unknown words stay unknown). */
const shellWord = (t) => (t.dynamic ? ' "$UNRESOLVED_ARGUMENT"' : ` '${t.word.replace(/'/g, "'\\''")}'`);

/**
 * Inspect the arguments of one `git` invocation (after the `git` word): global
 * options (`-C`, `-c`, `--config-env`, …), then the subcommand. `add` / `stage`
 * are judged directly; any other non-builtin subcommand is expanded as an alias
 * (inline `-c alias.x=…` first, then the git config) and the expansion judged
 * the same way, so `git -c alias.x='add -f' x …` cannot hide a force-add.
 */
function inspectGit(args, cwd, out, ctx) {
  let gitCwd = cwd;
  const aliases = new Map(ctx.aliases);
  const configOpts = []; // options that change which config git reads
  const setConfig = (kv, fromEnv) => {
    if (!kv) return;
    const eq = kv.word.indexOf('=');
    const m = /^alias\.(.+)$/i.exec(eq === -1 ? kv.word : kv.word.slice(0, eq));
    if (!m) return;
    // --config-env takes the value from a variable the hook cannot see.
    if (fromEnv || kv.dynamic || eq === -1) aliases.set(m[1].toLowerCase(), { unknown: true });
    else aliases.set(m[1].toLowerCase(), { value: kv.word.slice(eq + 1) });
  };
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i].word;
    if (a === '-C') {
      gitCwd = resolveDir(gitCwd, args[++i]);
    } else if (a === '-c') {
      setConfig(args[++i], false);
    } else if (a === '--config-env') {
      setConfig(args[++i], true);
    } else if (a.startsWith('--config-env=')) {
      setConfig({ word: a.slice('--config-env='.length), dynamic: args[i].dynamic }, true);
    } else if (a === '--git-dir' || a === '--work-tree') {
      const v = args[++i];
      if (v) configOpts.push(`${a}=${v.word}`);
    } else if (a.startsWith('--git-dir=') || a.startsWith('--work-tree=')) {
      configOpts.push(a);
    } else if (['--namespace', '--exec-path', '--super-prefix'].includes(a)) {
      i++;
    } else if (!a.startsWith('-')) {
      break;
    } // else: another global option (--no-pager, --bare, -p, ...)
  }
  const sub = args[i] && args[i].word;
  if (!sub) return;
  const rest = args.slice(i + 1);
  if (sub === 'add' || sub === 'stage') inspectAdd(rest, gitCwd, out, ctx.viaXargs);
  else expandAlias(sub, rest, gitCwd, out, { ...ctx, aliases }, configOpts);
}

/** Expand `git <sub> <rest…>` when `sub` is an alias, and judge the expansion. */
function expandAlias(sub, rest, gitCwd, out, ctx, configOpts) {
  const builtins = gitBuiltins();
  if (builtins && builtins.has(sub)) return; // git never lets an alias shadow a builtin
  const name = sub.toLowerCase(); // config variable names are case-insensitive
  const unresolved = (why) => out.push({ cwd: gitCwd, spec: `git alias "${sub}" (${why})`, unknown: true });

  if (ctx.chain.includes(name) || ctx.chain.length >= ALIAS_MAX_DEPTH) {
    // git refuses an alias loop, but fail closed when any step hides a force-add
    if (ctx.chainText.some((t) => ALIAS_FORCE_TEXT.test(t))) unresolved('alias loop expanding to a force-add');
    return;
  }
  let entry = ctx.aliases.get(name);
  if (!entry) {
    if (ctx.envConfig) return unresolved('git config set through GIT_CONFIG_* variables');
    // With an unknown cwd only the global / system config can be read, and a
    // repo-local alias of that name may still exist: fail closed if none is found.
    entry = lookupAlias(gitCwd === null ? path.parse(process.cwd()).root : gitCwd, name, configOpts);
    if (gitCwd === null && entry.missing) return unresolved('directory cannot be resolved');
  }
  if (entry.missing || entry.nogit) return;
  if (entry.unknown) return unresolved('value cannot be resolved before running');

  const text = entry.value;
  const next = { ...ctx, chain: [...ctx.chain, name], chainText: [...ctx.chainText, text] };
  if (text.startsWith('!')) {
    // A shell alias: git runs `sh -c '<text> "$@"'` from the top of the work
    // tree, and passes its -c config on to any git it starts.
    let top = gitCwd;
    if (gitCwd !== null) {
      const res = git(gitCwd, ['rev-parse', '--show-toplevel']);
      if (!res.error && res.status === 0 && res.stdout.trim()) top = res.stdout.trim();
    }
    const shellText = text.slice(1) + rest.map(shellWord).join('');
    const before = out.length;
    collectForceAdds(shellText, top, out, next);
    if (out.length === before && FORCE_ADD_TEXT.test(shellText)) unresolved('shell alias text looks like a force-add');
    return;
  }
  // git splits a plain alias like a shell would, but `;`, `|`, `&&` are just words to it.
  const tokens = tokenize(text);
  if (tokens.some((t) => t.op)) {
    if (ALIAS_FORCE_TEXT.test(text)) unresolved('alias text looks like a force-add');
    return;
  }
  inspectGit([...tokens, ...rest], gitCwd, out, next);
}

/** Judge the arguments of `git add` / `git stage` and push its force-add targets. */
function inspectAdd(addArgs, gitCwd, out, viaXargs) {
  let force = false;
  let all = false;
  let unknownSource = viaXargs;
  const specs = [];
  let endOfOptions = false;
  for (const a of addArgs) {
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
  if (!force) return;
  if (unknownSource) out.push({ cwd: gitCwd, spec: '(pathspecs read from stdin/file)', unknown: true });
  if (!specs.length && all) out.push({ cwd: gitCwd, spec: ':/', unknown: false });
  for (const s of specs) out.push({ cwd: gitCwd, spec: s.word, unknown: s.dynamic || gitCwd === null });
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
    if (isAllowed(c)) return false;
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

/**
 * true when one simple command of the line writes, truncates, removes, renames or hides a .gitignore.
 * Rewriting a .gitignore from the shell is never needed (the editor tools are guarded with a precise
 * diff check), and a truncated or deleted one un-ignores every personal file at once, so any such
 * command is refused, whatever paths it names. Reading one (cat, grep, sed -n, git diff, cp FROM it)
 * stays allowed.
 */
/** Split a command line into simple commands at ; && || | and newlines outside quotes. */
function simpleCommands(command) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"') { cur += c + (command[++i] ?? ''); continue; }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === '\\') { cur += c + (command[++i] ?? ''); continue; }
    if (c === ';' || c === '\n' || c === '|' || (c === '&' && command[i + 1] === '&')) {
      out.push(cur);
      cur = '';
      if ((c === '|' || c === '&') && command[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function modifiesGitignore(command) {
  return simpleCommands(command).some((seg) => {
    if (!/\.gitignore\b/.test(seg)) return false;
    if (/(^|[^<>&\d])>>?\s*[^\s|;&]*\.gitignore\b/.test(seg)) return true; // > or >> into it
    if (/\b(tee|truncate|rm|unlink|shred|mv|update-index)\b/.test(seg)) return true;
    if (/\b(sed|perl)\b/.test(seg) && /\s-[A-Za-z]*i/.test(seg)) return true; // in-place edit
    if (/\b(cp|ln|install|rsync)\b/.test(seg) && /\.gitignore\s*$/.test(seg.trim())) return true; // as destination
    return false;
  });
}

function checkShellGitignore(command) {
  if (modifiesGitignore(command)) {
    block(
      'Detected a shell command that writes, truncates, removes or renames a .gitignore.\n' +
        'A changed .gitignore can un-ignore personal data; edit it with the editor tools (checked diff) instead.'
    );
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
  } catch (err) {
    // A missing file is a new .gitignore; any other read error (EISDIR,
    // EACCES, …) must not be mistaken for an empty file: rethrow, fail closed.
    if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) throw err;
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
      return !isAllowed(p) && PERSONAL.some((f) => p.includes(f) || f.startsWith(p.replace(/\/?\*?$/, '') + '/'));
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

function evaluate(payload) {
  const baseCwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const input = payload.tool_input || {};

  if (payload.tool_name === 'Bash') {
    const command = input.command;
    if (typeof command !== 'string' || !command) return;
    checkForceAdds(command, baseCwd);
    checkShellGitignore(command);
  } else if (['Edit', 'Write', 'MultiEdit'].includes(payload.tool_name)) {
    checkGitignoreEdit(payload.tool_name, input, baseCwd);
  }
}

function main() {
  const payload = readPayload();
  if (!payload) process.exit(0); // malformed payload: fail open
  try {
    evaluate(payload);
  } catch (err) {
    // A crash must never let the call through (Claude Code treats any exit
    // code other than 2 as non-blocking): fail closed with a clear message.
    const detail = String((err && (err.code || err.message)) || err).replace(/[\u0000-\u001f]/g, '?').slice(0, 200);
    block(`The guard hit an internal error while checking this call (${detail}), so it fails closed.`);
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { tokenize, collectForceAdds };
