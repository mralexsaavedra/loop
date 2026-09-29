#!/usr/bin/env node
/* Generator for the training tabs of the plan artifact:
 *   - "Hoy / Today"  : today's PROGRAMMED session (from training-data.json)
 *   - "Entrenos"      : dashboard of EXECUTED sessions (from Apple Health workouts.csv)
 *
 * Sources:
 *   - training-data.json (GITIGNORED, personal): coach-programmed sessions keyed by
 *     ISO date. A fresh clone copies training-data.example.json -> training-data.json.
 *   - ../apple-health/extract/workouts.csv (GITIGNORED, OPTIONAL): the cached Apple
 *     Health workout export. If absent (fresh clone), the dashboard renders an empty
 *     state instead of failing.
 *
 * Both regions are baked into plan-web.html as plain JS (the artifact is a frozen,
 * self-contained snapshot — no fetch). The page localizes/renders client-side.
 *
 * Run:   node data/training/generate-training.js          (writes plan-web.html)
 *        node data/training/generate-training.js --check   (validate only)
 *
 * NEVER hand-edit the GEN:* blocks — edit the sources and regenerate.
 *
 * DATA HONESTY (see CLAUDE.md / methodology):
 *   - workout energy_kcal is blank on recent exports -> dashboard uses DURATION (minutes).
 *   - the Watch fragments one session into several records -> frequency counts DISTINCT
 *     DAYS, never raw rows; volume sums minutes.
 *   - the Watch auto-labels most gym work (incl. the program's strength blocks) as "HIIT"
 *     and under-logs running -> modality (strength/hiit/run/other) reflects WATCH LABELS;
 *     the page carries a caveat that real strength volume exceeds the "strength" bucket.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const dataPath = path.join(DIR, 'training-data.json');
if (!fs.existsSync(dataPath)) {
  throw new Error(
    'training-data.json not found at ' + dataPath +
    ' — it holds the personal training program (gitignored). ' +
    'Copy training-data.example.json -> training-data.json and edit it.',
  );
}
const TRAIN = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const extractDir = path.join(DIR, '..', 'apple-health', 'extract');
// The existence check above MUST run before this require — a test copies only this
// file (no lib/) into a temp dir to assert the "training-data.json not found" error.
const { validateProgram, trainingBlock: trainingBlockLib } = require(path.join(DIR, '..', '..', 'lib', 'training', 'program.mjs'));
const {
  loadDashboard, dashboardBlock: dashboardBlockLib,
  parseWorkouts, aggregateDashboard, modalityGroup, weekStart,
} = require(path.join(DIR, '..', '..', 'lib', 'training', 'dashboard.mjs'));

/* ---------- integrity validation (programmed sessions) ---------- */
function validate() {
  return validateProgram(TRAIN);
}

/* ---------- serialize programmed sessions to readable JS (legacy GEN:TRAINING block) ---------- */
function trainingBlock() {
  return trainingBlockLib(TRAIN);
}

/* ---------- dashboard: aggregate EXECUTED workouts ---------- */
function dashboardBlock() {
  return dashboardBlockLib(extractDir);
}

const htmlPath = path.join(DIR, '..', 'nutrition', 'plan-web.html');
/* Pure: replace the GEN:TRAINING + GEN:DASHBOARD regions in plan-web.html, return new text.
   Throws (not process.exit) on a missing marker so callers/tests can handle it. */
function buildHtml(html) {
  const regions = [
    [/[ \t]*\/\* GEN:TRAINING START[\s\S]*?\/\* GEN:TRAINING END \*\//, trainingBlock(), 'GEN:TRAINING'],
    [/[ \t]*\/\* GEN:DASHBOARD START[\s\S]*?\/\* GEN:DASHBOARD END \*\//, dashboardBlock(), 'GEN:DASHBOARD'],
  ];
  for (const [re, block, name] of regions) {
    if (!re.test(html)) throw new Error(name + ' markers not found in plan-web.html');
    html = html.replace(re, block);
  }
  return html;
}

function main() {
  validate();
  fs.writeFileSync(htmlPath, buildHtml(fs.readFileSync(htmlPath, 'utf8')));
  const dash = loadDashboard(extractDir);
  console.log(
    'Generated: plan-web.html (GEN:TRAINING + GEN:DASHBOARD) — ' +
    Object.keys(TRAIN.days).length + ' programmed days, dashboard ' +
    (dash.hasData ? 'as of ' + dash.asOf : 'empty (no workouts.csv)'),
  );
}

if (require.main === module) {
  if (process.argv.includes('--check')) { validate(); console.log('Validation OK: training-data.json is consistent.'); }
  else main();
}

module.exports = { TRAIN, validate, buildHtml, trainingBlock, dashboardBlock, parseWorkouts, aggregateDashboard, modalityGroup, weekStart };
