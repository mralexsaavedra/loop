#!/usr/bin/env node
'use strict';

/**
 * PreToolUse guard — enforces the CLAUDE.md HARD RULE: "Never commit raw health data."
 *
 * The rule used to live only in the assistant's memory. This hook makes it
 * mechanical: it inspects every Bash command before it runs and BLOCKS the two
 * ways personal health data could slip past .gitignore —
 *   1) `git add -f/--force` targeting a gitignored personal-data path, and
 *   2) un-ignoring a personal-data path by editing .gitignore from the shell.
 *
 * High precision by design: it only blocks when a known personal-data path is
 * involved, so ordinary `git add .`, `git add -A`, and legitimate force-adds of
 * tracked exceptions (generators, examples, .gitkeep) pass through untouched.
 *
 * Exit codes: 0 = allow; 2 = block (stderr is surfaced back to the assistant).
 */

const fs = require('fs');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

let payload;
try {
  payload = JSON.parse(readStdin() || '{}');
} catch {
  process.exit(0); // malformed payload — fail open, never block legitimate work
}

if (payload.tool_name !== 'Bash') process.exit(0);
const command = (payload.tool_input && payload.tool_input.command) || '';
if (!command) process.exit(0);

// Personal-data path fragments, derived from .gitignore. A force-add or
// un-ignore touching any of these is treated as a health-data leak.
const PERSONAL = [
  'data/apple-health/',
  'data/weight/',
  'data/nutrition/food-log.md',
  'data/nutrition/plan-web.html',
  'data/nutrition/plan-data.json',
  'data/nutrition/plan-tables.md',
  'data/nutritionist/',
  'data/training/',
  'analysis/reports/',
  'profile/about-me.md',
  'profile/baseline.md',
  '.local.md',
  // Astro build output / test fixtures / served site — all gitignored and all
  // derived from the personal data above (baked JSON globals, rendered
  // copy). Same leak surface as the source files themselves.
  'web/dist/',
  'web/test/.golden/',
  'services/plan-web/site/',
  'web/.test-dist/',
];

// Intentionally tracked exceptions (the "!" rules in .gitignore). Force-adding
// these is legitimate, so their presence cancels a personal-data match.
const ALLOWED = [
  '.gitkeep',
  'extract.js',
  'training-data.example.json',
  'plan-data.example.json',
];

function touchesPersonal(cmd) {
  // Strip shell/regex backslash escapes so an escaped slash (e.g. sed's
  // `profile\/about-me.md`) still matches the plain path fragment.
  const normalized = cmd.replace(/\\/g, '');
  return PERSONAL.some((p) => normalized.includes(p)) && !ALLOWED.some((a) => normalized.includes(a));
}

function block(reason) {
  process.stderr.write(
    `\u{1F6E1}️  BLOCKED by guard-health-data hook\n\n` +
      `${reason}\n\n` +
      `This repo's HARD RULE (CLAUDE.md): never commit raw health data.\n` +
      `If this is genuinely intended, do it yourself in a terminal outside the assistant.\n`
  );
  process.exit(2); // 2 = block the tool call
}

// 1) git add --force targeting personal data
const isGitAdd = /\bgit\s+add\b/.test(command);
const hasForce = /--force\b/.test(command) || /\s-[A-Za-z]*f[A-Za-z]*(?=\s|$)/.test(command);
if (isGitAdd && hasForce && touchesPersonal(command)) {
  block('Detected `git add --force` targeting a personal-data path.');
}

// 2) Un-ignoring personal data by rewriting .gitignore from the shell
const writesGitignore =
  /(>>?|tee|truncate)\s*[^|;&]*\.gitignore/.test(command) ||
  (/\.gitignore/.test(command) && /\bsed\b/.test(command));
if (writesGitignore && touchesPersonal(command)) {
  block('Detected an attempt to un-ignore a personal-data path in .gitignore.');
}

process.exit(0);
