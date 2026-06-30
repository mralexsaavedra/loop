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
const csvPath = path.join(DIR, '..', 'apple-health', 'extract', 'workouts.csv');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = { gym: 1, run: 1 };

/* ---------- integrity validation (programmed sessions) ---------- */
function validate() {
  const errors = [];
  if (!TRAIN.days || typeof TRAIN.days !== 'object') {
    throw new Error('training-data.json must contain a top-level "days" object.');
  }
  const keys = Object.keys(TRAIN.days);
  if (!keys.length) errors.push('"days" is empty — add at least one programmed session.');
  for (const date of keys) {
    if (!ISO.test(date)) { errors.push(`day key "${date}" is not an ISO date (YYYY-MM-DD)`); continue; }
    if (isNaN(Date.parse(date + 'T00:00:00'))) { errors.push(`day key "${date}" is not a real calendar date`); continue; }
    const day = TRAIN.days[date];
    if (day.kind && !KINDS[day.kind]) errors.push(`${date}: kind "${day.kind}" must be one of gym|run`);
    if (!day.focus || typeof day.focus !== 'string') errors.push(`${date}: missing "focus" text`);
    if (!Array.isArray(day.blocks) || !day.blocks.length) { errors.push(`${date}: "blocks" must be a non-empty array`); continue; }
    day.blocks.forEach((b, i) => {
      if (!b.title || typeof b.title !== 'string') errors.push(`${date} block ${i}: missing "title"`);
      if (b.label != null && typeof b.label !== 'string') errors.push(`${date} block ${i}: "label" must be a string`);
      if (!Array.isArray(b.lines) || !b.lines.length) errors.push(`${date} block ${i}: "lines" must be a non-empty array`);
      else if (!b.lines.every(l => typeof l === 'string')) errors.push(`${date} block ${i}: every line must be a string`);
    });
  }
  if (errors.length) throw new Error('training-data.json validation failed:\n  - ' + errors.join('\n  - '));
  return { ok: true };
}

/* ---------- serialize programmed sessions to readable JS ---------- */
function jsStr(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
}
function jsArr(arr) { return '[' + arr.map(jsStr).join(',') + ']'; }
function jsBlock(b) {
  const parts = [];
  if (b.label != null) parts.push('label:' + jsStr(b.label));
  parts.push('title:' + jsStr(b.title));
  parts.push('lines:' + jsArr(b.lines));
  return '{' + parts.join(',') + '}';
}
function jsDay(day) {
  const parts = [];
  if (day.kind) parts.push('kind:' + jsStr(day.kind));
  parts.push('focus:' + jsStr(day.focus));
  parts.push('blocks:[' + day.blocks.map(jsBlock).join(',') + ']');
  return '{' + parts.join(',') + '}';
}

function trainingBlock() {
  const dates = Object.keys(TRAIN.days).sort();
  const dayLines = dates.map(d => '      ' + jsStr(d) + ':' + jsDay(TRAIN.days[d]));
  const meta = {
    program: TRAIN.program || '',
    coach: TRAIN.coach || '',
    source: TRAIN.source || '',
    first: dates[0] || '',
    last: dates[dates.length - 1] || '',
    count: dates.length,
  };
  const metaParts = Object.keys(meta).map(k =>
    k === 'count' ? k + ':' + meta[k] : k + ':' + jsStr(meta[k]),
  );
  return [
    '    /* GEN:TRAINING START — generated from training-data.json by generate-training.js. DO NOT EDIT BY HAND.',
    '       Edit data/training/training-data.json and run `node data/training/generate-training.js`. */',
    '    var TRAINING = {',
    dayLines.join(',\n'),
    '    };',
    '    var TRAINING_META = {' + metaParts.join(',') + '};',
    '    /* GEN:TRAINING END */',
  ].join('\n');
}

/* ---------- dashboard: aggregate EXECUTED workouts ---------- */
const isoDate = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
function weekStart(date) { // Monday-based ISO week start for a 'YYYY-MM-DD' string
  const dt = new Date(date + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return isoDate(dt);
}
function modalityGroup(type) {
  if (/Running/i.test(type)) return 'run';
  if (/TraditionalStrength|FunctionalStrength/i.test(type)) return 'strength';
  if (/HighIntensityInterval|CrossTraining|Other/i.test(type)) return 'hiit';
  if (/Cycling|Rowing|Walking|Hiking|Pilates|Elliptical|Swim/i.test(type)) return 'other';
  return 'hiit'; // unknown gym-ish work -> conditioning bucket
  // NOTE: the Watch labels most gym work (incl. the program's strength blocks) as HIIT,
  // so 'strength' under-counts real strength volume — surfaced as a caveat in the page.
}
function parseWorkouts(text) {
  return text.trim().split('\n').slice(1).filter(Boolean).map(l => {
    const p = l.split(',');
    return { date: p[0], type: p[1] || '', dur: parseFloat(p[2]) || 0 };
  }).filter(r => ISO.test(r.date));
}
const WEEKS = 12; // dashboard window
function aggregateDashboard(rows) {
  if (!rows || !rows.length) return { hasData: false };
  const dates = rows.map(r => r.date).sort();
  const asOf = dates[dates.length - 1];
  const anchorWeek = weekStart(asOf);
  const start = new Date(anchorWeek + 'T00:00:00');
  start.setDate(start.getDate() - 7 * (WEEKS - 1));
  const startKey = isoDate(start);
  const win = rows.filter(r => r.date >= startKey && r.date <= asOf);
  // weekly buckets (emit every slot, including zero-activity weeks)
  const wk = {};
  win.forEach(r => { const k = weekStart(r.date); (wk[k] = wk[k] || { min: 0, days: new Set() }); wk[k].min += r.dur; wk[k].days.add(r.date); });
  const weeks = [];
  for (let i = 0; i < WEEKS; i++) {
    const d = new Date(start); d.setDate(d.getDate() + 7 * i); const k = isoDate(d); const b = wk[k];
    weeks.push({ w: k, days: b ? b.days.size : 0, min: b ? Math.round(b.min) : 0 });
  }
  // recent 4 weeks (28 days back from asOf)
  const r4 = new Date(asOf + 'T00:00:00'); r4.setDate(r4.getDate() - 27);
  const recentRows = rows.filter(r => r.date >= isoDate(r4) && r.date <= asOf);
  const recentDays = new Set(recentRows.map(r => r.date));
  const recent = {
    daysPerWeek: Math.round(recentDays.size / 4 * 10) / 10,
    minPerWeek: Math.round(recentRows.reduce((s, r) => s + r.dur, 0) / 4),
    sessions: recentDays.size,
  };
  // modality split by minutes over the window (Watch auto-labels — see caveat in page)
  const mg = { strength: 0, hiit: 0, run: 0, other: 0 };
  win.forEach(r => { mg[modalityGroup(r.type)] += r.dur; });
  const tot = Object.values(mg).reduce((a, b) => a + b, 0) || 1;
  const modality = Object.keys(mg)
    .map(k => ({ key: k, min: Math.round(mg[k]), pct: Math.round(100 * mg[k] / tot) }))
    .filter(m => m.min > 0)
    .sort((a, b) => b.min - a.min);
  return { hasData: true, asOf, weeks: WEEKS, weeklyMin: weeks, recent, modality };
}
function loadDashboard() {
  if (!fs.existsSync(csvPath)) return { hasData: false };
  return aggregateDashboard(parseWorkouts(fs.readFileSync(csvPath, 'utf8')));
}
function dashboardBlock() {
  return [
    '    /* GEN:DASHBOARD START — generated from apple-health workouts.csv by generate-training.js. DO NOT EDIT BY HAND. */',
    '    var DASH = ' + JSON.stringify(loadDashboard()) + ';',
    '    /* GEN:DASHBOARD END */',
  ].join('\n');
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
  const dash = loadDashboard();
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
