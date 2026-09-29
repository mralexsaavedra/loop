#!/usr/bin/env node
/* Generator for the "Health" tab of the plan artifact.
 *
 * Surfaces the body & recovery series that Apple Health already extracts but that
 * had no home in the artifact. One tab, three stacked sections:
 *   - Body composition : weight (rolling-avg trend) + body fat (single recent scale)
 *   - Energy balance   : HISTORICAL intake vs expenditure over the last logged cut
 *   - Recovery         : resting HR, HRV, VO2max, sleep
 *
 * Source: ../apple-health/extract/*.csv (GITIGNORED, OPTIONAL). Every series is
 * optional — a fresh clone with no export renders the empty state instead of failing,
 * exactly like the workouts dashboard (GEN:DASHBOARD).
 *
 * The result is baked into plan-web.html as `var HEALTH = {...}` inside the GEN:HEALTH
 * region (the artifact is a frozen, self-contained snapshot — no fetch). The page
 * renders client-side.
 *
 * Run:   node data/training/generate-health.js          (writes plan-web.html)
 *        node data/training/generate-health.js --check   (validate only, no write)
 *
 * NEVER hand-edit the GEN:HEALTH block — edit the export / extract and regenerate.
 *
 * DATA HONESTY (see CLAUDE.md / methodology) — baked into the on-screen captions:
 *   - weight mixes scales/apps (source column) -> trend uses a 7-day rolling average and
 *     says so; the latest number comes from the most recent reading.
 *   - body fat is bioimpedance (±3-5%) and only comparable WITHIN one scale -> the trend
 *     uses the most recent dominant source only, never mixes two different scales/apps.
 *   - recent daily energy is incomplete (watch not worn all day -> low active/basal), so
 *     expenditure is a multi-day average, never a single day.
 *   - dietary logging stopped (last full day well before today) -> the energy-balance
 *     section is explicitly HISTORICAL, anchored to the last logged window, not "now".
 *   - HRV has several readings per day -> averaged per day before trending.
 *
 * Pure read/stats/aggregate logic now lives in lib/health/{read,stats,aggregate}.mjs
 * (astro-plan-web migration, slice 2) — this file wraps them with the legacy 0-arg
 * calling convention (closed over EXTRACT) and handles the GEN:HEALTH file wiring.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const EXTRACT = path.join(DIR, '..', 'apple-health', 'extract');

const {
  readSeries: readSeriesLib, readTable: readTableLib, readDietary: readDietaryLib,
  readRunning: readRunningLib, readRunDistByDate: readRunDistByDateLib,
  readSleep: readSleepLib, readWorkoutLoad: readWorkoutLoadLib,
} = require(path.join(DIR, '..', '..', 'lib', 'health', 'read.mjs'));
const {
  byDayMean, rollAvg, lastDays, downsample, valueDaysAgo, spark,
  meanOf, stdev, median, wrapNight, clockStr, paceStr, dailyTrend, signalTrend,
} = require(path.join(DIR, '..', '..', 'lib', 'health', 'stats.mjs'));
const {
  aggBody, aggActivity, aggRunning, aggEnergy, aggRecovery, aggLoadRecovery,
  buildBody: buildBodyLib, buildActivity: buildActivityLib, buildRunning: buildRunningLib,
  buildEnergy: buildEnergyLib, buildRecovery: buildRecoveryLib, buildLoadRecovery: buildLoadRecoveryLib,
  weekStart, buildHealth: buildHealthLib,
} = require(path.join(DIR, '..', '..', 'lib', 'health', 'aggregate.mjs'));

/* Legacy 0/1-arg wrappers preserving the original calling convention (closed over
   EXTRACT) so this module's public API is unchanged for any existing caller. */
const readSeries = (name, valueCol) => readSeriesLib(EXTRACT, name, valueCol);
const readTable = (name, fields) => readTableLib(EXTRACT, name, fields);
const readDietary = () => readDietaryLib(EXTRACT);
const readRunning = () => readRunningLib(EXTRACT);
const readRunDistByDate = () => readRunDistByDateLib(EXTRACT);
const readSleep = () => readSleepLib(EXTRACT);
const readWorkoutLoad = () => readWorkoutLoadLib(EXTRACT);
const buildBody = () => buildBodyLib(EXTRACT);
const buildActivity = () => buildActivityLib(EXTRACT);
const buildRunning = () => buildRunningLib(EXTRACT);
const buildEnergy = () => buildEnergyLib(EXTRACT);
const buildRecovery = () => buildRecoveryLib(EXTRACT);
const buildLoadRecovery = () => buildLoadRecoveryLib(EXTRACT);
function buildHealth() { return buildHealthLib(EXTRACT); }

function healthBlock() {
  return [
    '    /* GEN:HEALTH START — generated from apple-health extract CSVs by generate-health.js. DO NOT EDIT BY HAND. */',
    '    var HEALTH = ' + JSON.stringify(buildHealth()) + ';',
    '    /* GEN:HEALTH END */',
  ].join('\n');
}

const htmlPath = path.join(DIR, '..', 'nutrition', 'plan-web.html');
/* Pure: replace the GEN:HEALTH region in plan-web.html, return new text. Throws (not
   process.exit) on a missing marker so callers/tests can handle it. */
function buildHtml(html) {
  const re = /[ \t]*\/\* GEN:HEALTH START[\s\S]*?\/\* GEN:HEALTH END \*\//;
  if (!re.test(html)) throw new Error('GEN:HEALTH markers not found in plan-web.html');
  return html.replace(re, healthBlock());
}

function main() {
  fs.writeFileSync(htmlPath, buildHtml(fs.readFileSync(htmlPath, 'utf8')));
  const h = buildHealth();
  const on = Object.keys(h).filter(k => h[k].hasData);
  console.log('Generated: plan-web.html (GEN:HEALTH) — sections with data: ' + (on.length ? on.join(', ') : 'none (no extract CSVs)'));
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const h = buildHealth();
    console.log('Validation OK: HEALTH built — ' + Object.keys(h).map(k => k + '=' + (h[k].hasData ? 'data' : 'empty')).join(', '));
  } else main();
}

module.exports = {
  readSeries, readTable, readDietary, readRunning, readSleep,
  byDayMean, rollAvg, lastDays, downsample, valueDaysAgo, spark,
  meanOf, stdev, median, wrapNight, clockStr, paceStr, dailyTrend, signalTrend,
  aggBody, aggActivity, aggRunning, aggEnergy, aggRecovery, aggLoadRecovery,
  buildBody, buildActivity, buildRunning, buildEnergy, buildRecovery, buildLoadRecovery,
  weekStart, readWorkoutLoad,
  buildHealth, healthBlock, buildHtml,
};
