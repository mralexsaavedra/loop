/* Tests for the iOS Shortcut sync (ingest service -> extract CSVs). Pure functions only,
 * SYNTHETIC fixtures (no real personal values), no network, no disk. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as sync from './sync-shortcut.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  METRICS, SHORTCUT_SOURCE, parseNumber, parseCount, parsePayload, collectSamples, buildRows,
  unionMinutes, mergeCsv, updateMeta, resolveToken, fetchAllPayloads, planSync,
  foldPayloads, emptyCache, CACHE_FILE, writeAtomic, syncDir, dropPhantomWeights, sleepStageOf,
} = sync;
const S_HDR = 'date,value,source';

test('parseNumber() accepts dot and comma decimals', () => {
  assert.equal(parseNumber('12.5'), 12.5);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber(' 60 '), 60);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('x'), null);
});

test('METRICS is a per-metric table covering the implemented metrics', () => {
  assert.deepEqual(Object.keys(METRICS).sort(),
    ['active_energy', 'active_energy_hourly', 'basal_energy', 'bodyfat', 'dietary', 'distance_watch', 'exercise_watch', 'flights_watch', 'hr_recovery', 'hr_samples', 'hrv',
      'leanmass', 'respiratory', 'rhr', 'sleep', 'steps', 'vo2max', 'waist', 'walking_hr', 'weight', 'wrist_temp']);
  for (const m of Object.values(METRICS)) {
    assert.ok(m.csv && m.header && m.kind);
  }
});

test('parsePayload() parses point metrics and sleep intervals, skipping junk', () => {
  const out = parsePayload({
    hrv: '2030-01-02T08:00:00+01:00;40.123\n2030-01-02T09:00:00+01:00;50,5\n\n45.2\nbad;line',
    rhr: '2030-01-02T00:05:00+01:00;55',
    weight: '2030-01-02T07:00:00+01:00;70.30000000000001',
    sleep: '2030-01-01T23:00:00+01:00;2030-01-02T01:00:00+01:00;Core\n2030-01-02T01:00:00+01:00;bad;Deep',
    unknownMetric: '2030-01-02T00:00:00+01:00;1',
  });
  assert.deepEqual(out.hrv, [
    { start: '2030-01-02 08:00:00 +0100', value: 40.123 },
    { start: '2030-01-02 09:00:00 +0100', value: 50.5 },
  ]);
  assert.equal(out.rhr.length, 1);
  assert.equal(out.weight[0].value, 70.30000000000001);
  assert.deepEqual(out.sleep, [
    { start: '2030-01-01 23:00:00 +0100', end: '2030-01-02 01:00:00 +0100', stage: 'Core' },
  ]);
  assert.equal(out.unknownMetric, undefined);
});

test('parsePayload() tolerates a non-object or non-string field', () => {
  assert.deepEqual(parsePayload(null), {});
  assert.deepEqual(parsePayload({ hrv: 42 }), {});
  assert.deepEqual(parsePayload({ test: 'hello' }), {});
});

test('collectSamples() dedups overlapping payloads', () => {
  const p1 = { hrv: '2030-01-02T08:00:00+01:00;40\n2030-01-03T08:00:00+01:00;41',
    sleep: '2030-01-01T23:00:00+01:00;2030-01-02T01:00:00+01:00;Core' };
  const p2 = { hrv: '2030-01-03T08:00:00+01:00;41\n2030-01-04T08:00:00+01:00;42',
    sleep: '2030-01-01T23:00:00+01:00;2030-01-02T01:00:00+01:00;Core\n2030-01-01T23:00:00+01:00;2030-01-02T01:00:00+01:00;Deep' };
  const s = collectSamples([p1, p2]);
  assert.equal(s.hrv.length, 3);
  assert.equal(s.sleep.length, 2, 'same interval with a different stage is a distinct sample');
});

test('unionMinutes() merges overlapping intervals (no double count)', () => {
  const iv = [
    { start: '2030-01-01 23:00:00 +0100', end: '2030-01-02 01:00:00 +0100' },
    { start: '2030-01-02 00:30:00 +0100', end: '2030-01-02 02:00:00 +0100' },
    { start: '2030-01-02 03:00:00 +0100', end: '2030-01-02 04:00:00 +0100' },
  ];
  assert.equal(unionMinutes(iv), 240);
  assert.equal(unionMinutes([]), 0);
});

test('buildRows() formats point metrics like extract.mjs, sorted, tagged Shortcut', () => {
  const rows = buildRows('hrv', [
    { start: '2030-01-03 08:00:00 +0100', value: 41.26 },
    { start: '2030-01-02 08:00:00 +0100', value: 40.04 },
  ]);
  assert.deepEqual(rows, [
    { date: '2030-01-02', line: '2030-01-02,40,' + SHORTCUT_SOURCE },
    { date: '2030-01-03', line: '2030-01-03,41.3,' + SHORTCUT_SOURCE },
  ]);
  const w = buildRows('weight', [{ start: '2030-01-02 07:00:00 +0100', value: 70.30000000000001 }]);
  assert.equal(w[0].line, '2030-01-02,70.3,' + SHORTCUT_SOURCE);
});

test('buildRows() sleep: asleep stages only, night = wake-up date, union minutes, bed/wake clock', () => {
  const rows = buildRows('sleep', [
    { start: '2030-01-01 23:30:00 +0100', end: '2030-01-02 01:00:00 +0100', stage: 'Core' },
    { start: '2030-01-02 01:00:00 +0100', end: '2030-01-02 01:30:00 +0100', stage: 'Awake' },
    { start: '2030-01-02 01:30:00 +0100', end: '2030-01-02 03:00:00 +0100', stage: 'Deep' },
    { start: '2030-01-02 03:00:00 +0100', end: '2030-01-02 07:15:00 +0100', stage: 'REM' },
    { start: '2030-01-02 22:00:00 +0100', end: '2030-01-02 23:00:00 +0100', stage: 'InBed' },
    { start: '2030-01-02 22:30:00 +0100', end: '2030-01-03 06:30:00 +0100', stage: 'Asleep' },
  ]);
  assert.deepEqual(rows, [
    // stage columns: rem, deep, core, unspec, awake (inside the window), in bed (window + InBed)
    { date: '2030-01-02', line: `2030-01-02,7.25,${SHORTCUT_SOURCE},23.5,7.25,4.25,1.50,1.50,0.00,0.50,7.75` },
    // "Asleep" = unspecified: no REM / deep / core / awake; the 22:00 InBed record widens in bed
    { date: '2030-01-03', line: `2030-01-03,8.00,${SHORTCUT_SOURCE},22.5,6.5,,,,8.00,,8.50` },
  ]);
});

test('buildRows() sleep accepts localized stage names and ignores unknown ones', () => {
  const rows = buildRows('sleep', [
    { start: '2030-01-02 00:00:00 +0100', end: '2030-01-02 01:00:00 +0100', stage: 'Profundo' },
    { start: '2030-01-02 01:00:00 +0100', end: '2030-01-02 02:00:00 +0100', stage: 'Despierto' },
    { start: '2030-01-02 02:00:00 +0100', end: '2030-01-02 03:00:00 +0100', stage: 'Whatever' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].line, `2030-01-02,1.00,${SHORTCUT_SOURCE},0,1,0.00,1.00,0.00,0.00,0.00,1.00`);
});

test('buildRows() sleep maps Spanish stage names to their stage columns', () => {
  const rows = buildRows('sleep', [
    { start: '2030-01-01 23:00:00 +0100', end: '2030-01-02 01:00:00 +0100', stage: 'Principal' },
    { start: '2030-01-02 01:00:00 +0100', end: '2030-01-02 01:30:00 +0100', stage: 'Despierto' },
    { start: '2030-01-02 01:30:00 +0100', end: '2030-01-02 02:30:00 +0100', stage: 'Profundo' },
    { start: '2030-01-02 02:30:00 +0100', end: '2030-01-02 04:00:00 +0100', stage: 'REM' },
    { start: '2030-01-02 04:00:00 +0100', end: '2030-01-02 06:00:00 +0100', stage: 'Ligero' },
    { start: '2030-01-02 06:00:00 +0100', end: '2030-01-02 07:00:00 +0100', stage: 'Sueño' },
    { start: '2030-01-01 22:30:00 +0100', end: '2030-01-02 07:30:00 +0100', stage: 'En cama' },
  ]);
  assert.equal(rows[0].line, `2030-01-02,7.50,${SHORTCUT_SOURCE},23,7,1.50,1.00,4.00,1.00,0.50,9.00`);
});

test('sleepStageOf(): Shortcut stage names (English + Spanish) -> stage keys; unknown = null', () => {
  assert.deepEqual(['Core', 'Deep', 'REM', 'Asleep', 'AsleepUnspecified', 'Awake', 'InBed', 'Ligero', 'Profundo', 'Dormido', 'En cama', 'Despierto', 'x']
    .map(sleepStageOf), ['core', 'deep', 'rem', 'unspec', 'unspec', 'awake', 'inbed', 'core', 'deep', 'unspec', 'inbed', 'awake', null]);
});

const HDR = 'date,value,source';
test('mergeCsv(): export rows win, shortcut rows fill only missing dates, sorted', () => {
  const existing = [HDR, '2030-01-01,40,Watch', '2030-01-02,41,Watch', ''].join('\n');
  const rows = [
    { date: '2030-01-02', line: '2030-01-02,99,Shortcut' },
    { date: '2030-01-03', line: '2030-01-03,42,Shortcut' },
    { date: '2030-01-03', line: '2030-01-03,43,Shortcut' },
  ];
  const r = mergeCsv(existing, HDR, rows);
  assert.equal(r.text, [HDR, '2030-01-01,40,Watch', '2030-01-02,41,Watch',
    '2030-01-03,42,Shortcut', '2030-01-03,43,Shortcut', ''].join('\n'));
  assert.equal(r.added, 2);
  assert.equal(r.rows, 4);
  assert.deepEqual(r.dates, ['2030-01-01', '2030-01-02', '2030-01-03']);
});

test('mergeCsv() is idempotent (re-run replaces its own previous rows)', () => {
  const existing = [HDR, '2030-01-01,40,Watch', ''].join('\n');
  const rows = [{ date: '2030-01-02', line: '2030-01-02,42,Shortcut' }];
  const once = mergeCsv(existing, HDR, rows).text;
  const twice = mergeCsv(once, HDR, rows).text;
  assert.equal(twice, once);
});

test('mergeCsv() drops stale shortcut rows once an export covers that date', () => {
  // simulates: sync added 01-02, then a new export (re-extract) delivered 01-02 itself
  const existing = [HDR, '2030-01-01,40,Watch', '2030-01-02,41,Watch', ''].join('\n');
  const r = mergeCsv(existing, HDR, [{ date: '2030-01-02', line: '2030-01-02,99,Shortcut' }]);
  assert.equal(r.added, 0);
  assert.ok(!r.text.includes('Shortcut'));
});

test('mergeCsv() creates the file content when no CSV exists yet', () => {
  const r = mergeCsv(null, HDR, [{ date: '2030-01-02', line: '2030-01-02,42,Shortcut' }]);
  assert.equal(r.text, HDR + '\n2030-01-02,42,Shortcut\n');
});

test('mergeCsv() keeps export rows in their original order within a date', () => {
  const existing = [HDR, '2030-01-01,2,B', '2030-01-01,1,A', ''].join('\n');
  const r = mergeCsv(existing, HDR, []);
  assert.equal(r.text, existing);
});

test('updateMeta() refreshes row counts + ranges and records the sync, deterministically', () => {
  const meta = { rows: { hrv: 1, weight: 1, steps: 9 }, ranges: { weight: 'a..b', steps: 'x..y' }, notes: ['n1'] };
  const stats = {
    hrv: { rows: 3, added: 2, dates: ['2030-01-01', '2030-01-03'], addedDates: ['2030-01-02', '2030-01-03'] },
    weight: { rows: 2, added: 1, dates: ['2030-01-01', '2030-01-05'], addedDates: ['2030-01-05'] },
  };
  const out = updateMeta(meta, stats, { payloads: 4, lastPayloadId: '12' });
  assert.equal(out.rows.hrv, 3);
  assert.equal(out.rows.weight, 2);
  assert.equal(out.rows.steps, 9);
  assert.equal(out.ranges.weight, '2030-01-01..2030-01-05');
  assert.equal(out.ranges.steps, 'x..y');
  assert.deepEqual(out.shortcutSync.added, { hrv: 2, weight: 1 });
  assert.equal(out.shortcutSync.ranges.hrv, '2030-01-02..2030-01-03');
  assert.equal(out.shortcutSync.lastPayloadId, '12');
  assert.equal(out.notes.filter(n => /Shortcut/.test(n)).length, 1);
  const again = updateMeta(out, stats, { payloads: 4, lastPayloadId: '12' });
  assert.deepEqual(again, out, 'idempotent: no duplicated note, no timestamps');
  assert.equal(meta.rows.hrv, 1, 'input not mutated');
});

test('resolveToken() prefers env, falls back to the .env file text', () => {
  assert.equal(resolveToken({ INGEST_TOKEN: 'fromenv' }, 'INGEST_TOKEN=fromfile'), 'fromenv');
  assert.equal(resolveToken({}, '# c\nOTHER=1\nINGEST_TOKEN="fromfile"\n'), 'fromfile');
  assert.equal(resolveToken({}, null), null);
});

function fakeFetch(pages, calls) {
  return async (url, opts) => {
    calls.push({ url: String(url), auth: opts.headers.authorization });
    const since = Number(new URL(url).searchParams.get('since_id'));
    const body = pages.filter(p => Number(p.id) > since).slice(0, 2);
    return { ok: true, status: 200, json: async () => body };
  };
}

test('fetchAllPayloads() pages by since_id until a short page', async () => {
  const pages = [1, 2, 3].map(id => ({ id: String(id), received_at: 't', payload: { hrv: '' } }));
  const calls = [];
  const out = await fetchAllPayloads({ baseUrl: 'http://h:1', token: 'tok', automation: 'a', limit: 2, fetchImpl: fakeFetch(pages, calls) });
  assert.deepEqual(out.map(p => p.id), ['1', '2', '3']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].auth, 'Bearer tok');
  assert.match(calls[0].url, /\/export\/raw\?automation=a&since_id=0&limit=2$/);
});

test('fetchAllPayloads() throws on a non-OK response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(fetchAllPayloads({ baseUrl: 'http://h', token: 't', automation: 'a', fetchImpl }), /401/);
});

test('planSync() computes every CSV + meta without touching disk', () => {
  const payloads = [
    { id: '1', payload: { hrv: '2030-01-03T08:00:00+01:00;42', rhr: '2030-01-03T00:05:00+01:00;50' } },
    { id: '2', payload: { hrv: '2030-01-03T08:00:00+01:00;42\n2030-01-01T08:00:00+01:00;30' } },
  ];
  const files = {
    'hrv.csv': [HDR, '2030-01-01,40,Watch', ''].join('\n'),
    '_meta.json': JSON.stringify({ rows: {}, ranges: {}, notes: [] }),
  };
  const plan = planSync(payloads, name => files[name] ?? null);
  assert.equal(plan.writes['hrv.csv'], [HDR, '2030-01-01,40,Watch', '2030-01-03,42,Shortcut', ''].join('\n'));
  assert.equal(plan.writes['rhr.csv'], [HDR, '2030-01-03,50,Shortcut', ''].join('\n'));
  assert.equal(plan.stats.hrv.added, 1);
  assert.equal(plan.stats.weight.added, 0);
  const meta = JSON.parse(plan.writes['_meta.json']);
  assert.equal(meta.rows.hrv, 2);
  assert.equal(meta.ranges.restingHR, '2030-01-03..2030-01-03');
  assert.equal(meta.shortcutSync.lastPayloadId, '2');
});

test('planSync() writes nothing at all when there is no data and no file', () => {
  const plan = planSync([], () => null);
  assert.deepEqual(plan.writes, {});
});

test('planSync() creates _meta.json (with the ownership ledger) when it is missing', () => {
  const plan = planSync([{ id: '1', payload: { rhr: '2030-01-03T00:05:00+01:00;50' } }], () => null);
  const meta = JSON.parse(plan.writes['_meta.json']);
  assert.deepEqual(meta.shortcutSync.owned['rhr.csv'], ['2030-01-03']);
});

// ---- body composition (point + source) --------------------------------------------------

test('parsePayload() reads an optional per-sample source; malformed sources become null', () => {
  const out = parsePayload({
    bodyfat: '2030-01-02T07:00:00+01:00;14.6;Scale App\n2030-01-03T07:00:00+01:00;14.5;14,5 %\n2030-01-04T07:00:00+01:00;14.4',
    leanmas: '2030-01-02T07:00:00+01:00;60.1;Scale App',
    weight: '',
  });
  assert.deepEqual(out.bodyfat, [
    { start: '2030-01-02 07:00:00 +0100', value: 14.6, source: 'Scale App' },
    { start: '2030-01-03 07:00:00 +0100', value: 14.5, source: null },
    { start: '2030-01-04 07:00:00 +0100', value: 14.4, source: null },
  ]);
  assert.equal(out.leanmass, undefined, 'misspelled key is ignored');
  assert.equal(out.weight, undefined, 'empty string = no data');
});

test('collectSamples() keeps the sourced copy of a duplicated sample', () => {
  const bad = { bodyfat: '2030-01-02T07:00:00+01:00;14.6;14,6 %' };
  const good = { bodyfat: '2030-01-02T07:00:00+01:00;14.6;Scale App' };
  const s = collectSamples([bad, good]);
  assert.equal(s.bodyfat.length, 1);
  assert.equal(s.bodyfat[0].source, 'Scale App');
});

test('buildRows() bodyfat: percent scale (fractions converted), real source kept', () => {
  const rows = buildRows('bodyfat', [
    { start: '2030-01-02 07:00:00 +0100', value: 0.146, source: 'Scale App' },
    { start: '2030-01-03 07:00:00 +0100', value: 14.5, source: 'Scale, Inc' },
    { start: '2030-01-04 07:00:00 +0100', value: 14.4, source: null },
  ]);
  assert.deepEqual(rows.map(r => r.line), [
    '2030-01-02,14.6,Scale App',
    '2030-01-03,14.5,Scale  Inc',
    '2030-01-04,14.4,' + SHORTCUT_SOURCE,
  ]);
});

test('buildRows() writes the source through csvSource: the same cell as extract.mjs (commas, entities)', () => {
  const rows = buildRows('weight', [
    { start: '2030-01-02 07:00:00 +0100', value: 70.5, source: 'Alex, Watch' },
    { start: '2030-01-03 07:00:00 +0100', value: 70.4, source: 'Scale, Kitchen &amp; Co' },
  ]);
  assert.deepEqual(rows.map(r => r.line), ['2030-01-02,70.5,Alex  Watch', '2030-01-03,70.4,Scale  Kitchen & Co']);
});

test('buildRows() leanmass keeps kg with 2 decimals and the real source', () => {
  const rows = buildRows('leanmass', [{ start: '2030-01-02 07:00:00 +0100', value: 60.123456, source: 'Scale App' }]);
  assert.equal(rows[0].line, '2030-01-02,60.12,Scale App');
});

// ---- daily totals (already grouped by day on the phone) ---------------------------------

test('parsePayload() + buildRows() daily totals map to the extract daily schemas', () => {
  const p = parsePayload({
    active_energy: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:00:00+01:00;500.6',
    basal_energy: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:00:00+01:00;1700,2',
  });
  assert.deepEqual(buildRows('active_energy', p.active_energy.slice(1)).map(r => r.line), ['2030-01-02,501']);
  assert.deepEqual(buildRows('basal_energy', p.basal_energy.slice(1)).map(r => r.line), ['2030-01-02,1700']);
  assert.equal(METRICS.active_energy.header, 'date,kcal');
  assert.equal(METRICS.steps.header, 'date,steps,source');
});

test('collectSamples() daily totals: latest payload wins; each payload\'s oldest (truncated) day is ignored', () => {
  const s = collectSamples([
    { active_energy: '2030-01-02T00:03:00+01:00;900\n2030-01-03T00:01:00+01:00;100' },
    { active_energy: '2030-01-02T09:00:00+01:00;400\n2030-01-03T00:01:00+01:00;700' },
  ]);
  assert.deepEqual(buildRows('active_energy', s.active_energy).map(r => r.line), ['2030-01-03,700']);
});

// ---- hourly active energy (Watch only, grouped by HOUR on the phone) ---------------------
// feeds lib/health/ride-energy.mjs: the Watch energy during a ride a bike computer recorded

test('active_energy_hourly: one row per clock hour, hour start normalised, tagged Shortcut', () => {
  const s = collectSamples([{
    active_energy_hourly: '2030-01-02T08:41:00+01:00;12\n2030-01-02T09:07:12+01:00;275,3\n2030-01-02T10:00:05+01:00;301.26',
  }]);
  // the oldest bucket (08 h: the 3-day window starts mid-hour) is dropped
  assert.deepEqual(buildRows('active_energy_hourly', s.active_energy_hourly).map(r => r.line), [
    '2030-01-02,2030-01-02T09:00:00+01:00,275.3,Shortcut',
    '2030-01-02,2030-01-02T10:00:00+01:00,301.3,Shortcut',
  ]);
  assert.equal(METRICS.active_energy_hourly.header, 'date,hour_start,kcal,source');
  assert.equal(METRICS.active_energy_hourly.csv, 'active-energy-hourly.csv');
});

test('active_energy_hourly: the latest payload wins an hour; each payload\'s oldest hour is ignored', () => {
  const s = collectSamples([
    { active_energy_hourly: '2030-01-02T07:30:00+01:00;5\n2030-01-02T09:07:00+01:00;100\n2030-01-02T10:02:00+01:00;40' },
    // later run: 09 h is its truncated oldest bucket (ignored), 10 h is now complete
    { active_energy_hourly: '2030-01-02T09:50:00+01:00;20\n2030-01-02T10:01:00+01:00;300\n2030-01-02T11:00:00+01:00;0' },
  ]);
  assert.deepEqual(buildRows('active_energy_hourly', s.active_energy_hourly).map(r => r.line), [
    '2030-01-02,2030-01-02T09:00:00+01:00,100.0,Shortcut',
    '2030-01-02,2030-01-02T10:00:00+01:00,300.0,Shortcut',
    '2030-01-02,2030-01-02T11:00:00+01:00,0.0,Shortcut',
  ]);
});

test('hr_samples: deduped by exact timestamp across overlapping payloads (the later payload wins), 25-240 bpm only', () => {
  const s = collectSamples([
    { hr_samples: '2030-01-02T09:00:00+01:00;60\n2030-01-02T09:05:00+01:00;70\n2030-01-02T09:06:00+01:00;300' },
    // the next run overlaps: 09:05 is re-sent with a corrected value, 09:10 is new, 20 bpm is a glitch
    { hr_samples: '2030-01-02T09:05:00+01:00;72\n2030-01-02T09:10:00+01:00;80\n2030-01-02T09:12:00+01:00;20' },
  ]);
  assert.deepEqual(s.hr_samples.map(x => x.value).sort(), [60, 72, 80]);
  const [line] = buildRows('hr_samples', s.hr_samples).map(r => r.line);
  assert.equal(line, '2030-01-02,2030-01-02T09:00:00+01:00,70.7,80,60,3,10.0,0.0,60:300 72:300,Shortcut');
  assert.equal(METRICS.hr_samples.csv, 'hr-hourly.csv');
});

test('hr_t + hr_v (loop-free parallel lists): zipped by index into hr_samples, unioned with hr_samples lines', () => {
  const s = collectSamples([
    { hr_samples: '2030-01-02T09:00:00+01:00;60' },
    { hr_t: '2030-01-02T09:05:00+01:00\n2030-01-02T09:10:00+01:00', hr_v: '72 count/min\n80,5 lpm' },
  ]);
  assert.deepEqual(s.hr_samples.map(x => x.value).sort(), [60, 72, 80.5]);
  assert.deepEqual(parsePayload({ hr_t: '2030-01-02T09:05:00+01:00', hr_v: '72' }).hr_samples, [{ start: '2030-01-02 09:05:00 +0100', value: 72 }]);
});

test('hr_t / hr_v of different lengths: the lists are dropped (hr_samples kept) and planSync returns a warning', () => {
  const warnings = [];
  const out = parsePayload({ hr_samples: '2030-01-02T09:00:00+01:00;60', hr_t: '2030-01-02T09:05:00+01:00\n2030-01-02T09:10:00+01:00', hr_v: '72' }, warnings);
  assert.deepEqual(out.hr_samples.map(x => x.value), [60]);
  assert.equal(warnings.length, 1);
  const plan = planSync([{ id: '7', payload: { hr_t: '2030-01-02T09:05:00+01:00\n2030-01-02T09:10:00+01:00', hr_v: '72' } }], () => null);
  assert.equal(plan.writes['hr-hourly.csv'], undefined);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /^payload 7: hr_t \/ hr_v have 2 vs 1 lines/);
  assert.deepEqual(planSync([{ id: '8', payload: { hr_samples: '2030-01-02T09:00:00+01:00;60' } }], () => null).warnings, []);
  // the warning never reaches the cache file
  assert.ok(!JSON.stringify(plan.cache).includes('warning'));
});

test('hr_samples: the old hr_hourly key (hourly SUMS) is ignored', () => {
  const s = collectSamples([{ hr_hourly: '2030-01-02T09:00:00+01:00;4200' }]);
  assert.equal(s.hr_hourly, undefined);
  assert.equal(s.hr_samples, undefined);
});

test('planSync(): hr-hourly.csv leaves the Strava activity windows (workout-zones.csv) out of the histogram', () => {
  const zones = 'date,activity_id,type,max_hr,max_hr_source,hr_avg,hr_max,z0_s,z1_s,z2_s,z3_s,z4_s,z5_s,source,start,elapsed_s\n' +
    '2030-01-02,1,Running,190,observed,150,170,0,0,0,0,0,0,Strava API,2030-01-02T09:05:00+01:00,300\n';
  const files = { 'workout-zones.csv': zones };
  const plan = planSync([{ id: '1', payload: { hr_samples: '2030-01-02T09:00:00+01:00;90\n2030-01-02T09:10:00+01:00;95\n2030-01-02T09:11:00+01:00;96' } }], n => files[n] ?? null);
  const csv = plan.writes['hr-hourly.csv'];
  assert.equal(csv.split('\n')[0], 'date,hour_start,avg,max,min,n,covered_min,act_min,hist,source');
  assert.equal(csv.split('\n')[1], '2030-01-02,2030-01-02T09:00:00+01:00,93.7,96,90,3,11.0,5.0,90:300 95:60,Shortcut');
  assert.equal(JSON.parse(plan.writes['_meta.json']).rows.hr_hourly, 1);
});

test('active_energy_hourly: a DST fall-back night keeps both 02:00 hours (keyed by offset)', () => {
  const s = collectSamples([{
    active_energy_hourly: '2030-10-27T01:10:00+02:00;1\n2030-10-27T02:10:00+02:00;30\n2030-10-27T02:05:00+01:00;40',
  }]);
  assert.deepEqual(buildRows('active_energy_hourly', s.active_energy_hourly).map(r => r.line), [
    '2030-10-27,2030-10-27T02:00:00+02:00,30.0,Shortcut',
    '2030-10-27,2030-10-27T02:00:00+01:00,40.0,Shortcut',
  ]);
});

test('planSync() writes active-energy-hourly.csv and rebuilds it every run (no export rows exist)', () => {
  const files = { 'active-energy-hourly.csv': 'date,hour_start,kcal,source\n2030-01-01,2030-01-01T09:00:00+01:00,999.0,Shortcut\n' };
  const plan = planSync([{ id: '1', payload: { active_energy_hourly: '2030-01-02T08:10:00+01:00;1\n2030-01-02T09:10:00+01:00;250' } }],
    name => (name in files ? files[name] : null));
  assert.equal(plan.writes['active-energy-hourly.csv'],
    'date,hour_start,kcal,source\n2030-01-02,2030-01-02T09:00:00+01:00,250.0,Shortcut\n');
});

// ---- steps: per-device day totals, max-per-device like extract.mjs ----------------------

const WATCH = METRICS.steps.devices.steps_watch;
const PHONE = METRICS.steps.devices.steps_phone;

test('steps = MAX(watch, phone) per day, source = the winning device', () => {
  const s = collectSamples([{
    steps_watch: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:03:00+01:00;8000.4\n2030-01-03T00:01:00+01:00;3000\n2030-01-04T00:00:00+01:00;0',
    steps_phone: '2030-01-01T00:00:00+01:00;1\n2030-01-02T07:00:00+01:00;6000\n2030-01-03T08:00:00+01:00;5000\n2030-01-05T09:00:00+01:00;4000',
  }]);
  assert.deepEqual(buildRows('steps', s.steps).map(r => r.line), [
    `2030-01-02,8000,${WATCH}`,
    `2030-01-03,5000,${PHONE}`,
    `2030-01-05,4000,${PHONE}`,
  ]);
  assert.ok(WATCH.startsWith(SHORTCUT_SOURCE) && PHONE.startsWith(SHORTCUT_SOURCE));
});

test('steps: a day with only zeros is no data; a tie goes to the watch', () => {
  const s = collectSamples([{
    steps_watch: '2030-01-02T00:00:00+01:00;0\n2030-01-03T00:00:00+01:00;500',
    steps_phone: '2030-01-02T00:00:00+01:00;0\n2030-01-03T00:00:00+01:00;500',
  }]);
  assert.deepEqual(buildRows('steps', s.steps).map(r => r.line), [`2030-01-03,500,${WATCH}`]);
});

test('steps: the legacy merged `steps` key (double-counted) is ignored', () => {
  const s = collectSamples([
    { steps: '2030-01-02T00:03:00+01:00;99999' },
    { steps_watch: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:03:00+01:00;7000' },
  ]);
  assert.deepEqual(buildRows('steps', s.steps).map(r => r.line), [`2030-01-02,7000,${WATCH}`]);
  assert.deepEqual(collectSamples([{ steps: '2030-01-02T00:03:00+01:00;99999' }]), {});
});

test('steps: latest payload per device, then max across devices', () => {
  const s = collectSamples([
    { steps_watch: '2030-01-01T00:00:00+01:00;1\n2030-01-02T09:00:00+01:00;2000', steps_phone: '2030-01-01T00:00:00+01:00;1\n2030-01-02T09:00:00+01:00;2500' },
    { steps_watch: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:01:00+01:00;9000', steps_phone: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:01:00+01:00;2600' },
  ]);
  assert.deepEqual(buildRows('steps', s.steps).map(r => r.line), [`2030-01-02,9000,${WATCH}`]);
});

test('mergeCsv() also drops device-tagged Shortcut rows without a ledger', () => {
  const H = 'date,steps,source';
  const existing = [H, '2030-01-01,5000,Watch', `2030-01-02,100,${WATCH}`, ''].join('\n');
  const r = mergeCsv(existing, H, []);
  assert.equal(r.text, [H, '2030-01-01,5000,Watch', ''].join('\n'));
});

// ---- ownership ledger (rows without a Shortcut tag) ------------------------------------

test('mergeCsv() strips previously owned dates even without a source tag', () => {
  const H = 'date,kcal';
  const existing = [H, '2030-01-01,500', '2030-01-02,100', ''].join('\n');
  const r = mergeCsv(existing, H, [{ date: '2030-01-02', line: '2030-01-02,600' }],
    { sourceCol: null, ownedDates: ['2030-01-02'] });
  assert.equal(r.text, [H, '2030-01-01,500', '2030-01-02,600', ''].join('\n'));
  assert.deepEqual(r.addedDates, ['2030-01-02']);
});

test('planSync() updates a growing partial day and stays idempotent via the ledger', () => {
  const H = 'date,kcal';
  const files = { 'active-energy-daily.csv': [H, '2030-01-01,500', ''].join('\n'), '_meta.json': '{"rows":{},"ranges":{},"notes":[]}' };
  const read = name => files[name] ?? null;
  const apply = plan => Object.assign(files, plan.writes);
  apply(planSync([{ id: '1', payload: { active_energy: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:00:00+01:00;100' } }], read));
  apply(planSync([{ id: '1', payload: { active_energy: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:00:00+01:00;100' } },
    { id: '2', payload: { active_energy: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:00:00+01:00;600' } }], read));
  assert.equal(files['active-energy-daily.csv'], [H, '2030-01-01,500', '2030-01-02,600', ''].join('\n'));
  const again = planSync([{ id: '1', payload: { active_energy: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:00:00+01:00;100' } },
    { id: '2', payload: { active_energy: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:00:00+01:00;600' } }], read);
  assert.deepEqual(again.writes, {}, 'second identical run changes nothing');
});

test('planSync() keeps real-source bodyfat rows replaceable via the ledger', () => {
  const H = 'date,value,source';
  const files = { 'bodyfat.csv': [H, '2030-01-01,15,Scale App', ''].join('\n'), '_meta.json': '{"rows":{},"ranges":{},"notes":[]}' };
  const read = name => files[name] ?? null;
  Object.assign(files, planSync([{ id: '1', payload: { bodyfat: '2030-01-02T07:00:00+01:00;14.6;Scale App' } }], read).writes);
  Object.assign(files, planSync([{ id: '2', payload: { bodyfat: '2030-01-02T07:00:00+01:00;14.6;Scale App\n2030-01-02T19:00:00+01:00;14.8;Scale App' } }], read).writes);
  assert.equal(files['bodyfat.csv'], [H, '2030-01-01,15,Scale App', '2030-01-02,14.6,Scale App', '2030-01-02,14.8,Scale App', ''].join('\n'));
});

// ---- daily totals: latest payload wins, except each payload's truncated oldest day -------

const daily = (...pairs) => pairs.map(([d, v]) => `${d}T00:00:00+01:00;${v}`).join('\n');
const activeRows = cache => buildRows('active_energy', Object.values(cache.samples.active_energy)).map(r => r.line);

test('foldPayloads(): a later lower value corrects an earlier inflated one', () => {
  const c = foldPayloads(emptyCache(), [
    { id: '1', payload: { active_energy: daily(['2030-01-01', 100], ['2030-01-02', 5000], ['2030-01-03', 400]) } },
    { id: '2', payload: { active_energy: daily(['2030-01-01', 90], ['2030-01-02', 800], ['2030-01-03', 450]) } },
  ]);
  assert.deepEqual(activeRows(c), ['2030-01-02,800', '2030-01-03,450']);
});

test('foldPayloads(): a truncated oldest day never overwrites a full one', () => {
  const c = foldPayloads(emptyCache(), [
    { id: '1', payload: { active_energy: daily(['2030-01-01', 100], ['2030-01-02', 900], ['2030-01-03', 400]) } },
    { id: '2', payload: { active_energy: daily(['2030-01-02', 300], ['2030-01-03', 700], ['2030-01-04', 50]) } },
  ]);
  assert.deepEqual(activeRows(c), ['2030-01-02,900', '2030-01-03,700', '2030-01-04,50']);
});

test('foldPayloads(): truncation is per device series for steps', () => {
  const c = foldPayloads(emptyCache(), [
    { id: '1', payload: { steps_watch: daily(['2030-01-01', 10], ['2030-01-02', 9000]), steps_phone: daily(['2030-01-02', 10]) } },
    { id: '2', payload: { steps_watch: daily(['2030-01-02', 20], ['2030-01-03', 1]), steps_phone: daily(['2030-01-02', 30], ['2030-01-03', 5000]) } },
  ]);
  // watch 01-02: full 9000 (payload 1) survives the later truncated 20; phone's 01-02 is truncated in both
  assert.deepEqual(buildRows('steps', Object.values(c.samples.steps)).map(r => r.line),
    [`2030-01-02,9000,${WATCH}`, `2030-01-03,5000,${PHONE}`]);
});

test('foldPayloads(): skips payloads at or below lastPayloadId (re-fold is a no-op)', () => {
  const items = [{ id: '1', payload: { active_energy: daily(['2030-01-01', 1], ['2030-01-02', 500]) } },
    { id: '2', payload: { active_energy: daily(['2030-01-01', 1], ['2030-01-02', 600]) } }];
  const c = foldPayloads(emptyCache(), items);
  assert.equal(c.lastPayloadId, '2');
  assert.equal(c.payloads, 2);
  assert.deepEqual(foldPayloads(c, items), c);
  assert.deepEqual(foldPayloads(c, [items[0]]), c, 'an old payload replayed out of order changes nothing');
});

test('planSync() reads the cache and only folds new payloads; --full ignores it', () => {
  const files = {};
  const read = name => files[name] ?? null;
  Object.assign(files, planSync([{ id: '1', payload: { rhr: '2030-01-02T00:05:00+01:00;50' } }], read).writes);
  assert.ok(files[CACHE_FILE]);
  Object.assign(files, planSync([{ id: '2', payload: { rhr: '2030-01-03T00:05:00+01:00;51' } }], read).writes);
  assert.equal(files['rhr.csv'], ['date,value,source', '2030-01-02,50,Shortcut', '2030-01-03,51,Shortcut', ''].join('\n'));
  const full = planSync([{ id: '2', payload: { rhr: '2030-01-03T00:05:00+01:00;51' } }], read, { full: true });
  assert.equal(full.writes['rhr.csv'], ['date,value,source', '2030-01-03,51,Shortcut', ''].join('\n'));
});

test('planSync() refuses a corrupt cache (suggests --full) instead of guessing', () => {
  assert.throws(() => planSync([], name => (name === CACHE_FILE ? '{not json' : null)), /--full/);
});

// ---- fetch: incremental + timeout ------------------------------------------------------

test('fetchAllPayloads() starts from the given since_id', async () => {
  const calls = [];
  await fetchAllPayloads({ baseUrl: 'http://h', token: 't', automation: 'a', sinceId: '7', fetchImpl: fakeFetch([], calls) });
  assert.match(calls[0].url, /since_id=7&/);
});

test('fetchAllPayloads() aborts a hung request with a clear timeout error', async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(fetchAllPayloads({ baseUrl: 'http://h', token: 't', automation: 'a', timeoutMs: 20, fetchImpl }), /timed out/);
});

// ---- disk: atomic writes + the extract.mjs <-> sync contract ---------------------------

test('writeAtomic() replaces the file and leaves no temp file behind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-atomic-'));
  const f = path.join(dir, 'a.csv');
  fs.writeFileSync(f, 'old\n');
  writeAtomic(f, 'new\n');
  assert.equal(fs.readFileSync(f, 'utf8'), 'new\n');
  assert.deepEqual(fs.readdirSync(dir), ['a.csv']);
  fs.rmSync(dir, { recursive: true });
});

test('contract: a re-extract drops Shortcut rows + ledger, the next sync restores them from cache', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-contract-'));
  const Q = 'HKQuantityTypeIdentifier';
  fs.writeFileSync(path.join(dir, 'export.xml'), [
    '<ExportDate value="2030-01-03 08:00:00 +0100"/>', // 01-01 is a complete day, not the partial last one
    `<Record type="${Q}HeartRateVariabilitySDNN" sourceName="W" startDate="2030-01-01 08:00:00 +0100" endDate="2030-01-01 08:00:00 +0100" value="40"/>`,
    // a real Watch name: energy counts only Watch / wearable / iPhone sources (samples.mjs energySource)
    `<Record type="${Q}ActiveEnergyBurned" sourceName="Apple Watch de Demo" startDate="2030-01-01 10:00:00 +0100" endDate="2030-01-01 10:05:00 +0100" value="300"/>`,
    '</HealthData>',
  ].join('\n') + '\n');
  const extract = () => execFileSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { stdio: 'ignore', env: { ...process.env, EXTRACT_DIR: dir } });
  const out = path.join(dir, 'extract');
  const read = f => fs.readFileSync(path.join(out, f), 'utf8');
  const items = [{ id: '1', payload: {
    hrv: '2030-01-01T09:00:00+01:00;99\n2030-01-02T08:00:00+01:00;42',
    active_energy: daily(['2029-12-31', 1], ['2030-01-01', 999], ['2030-01-02', 500]),
  } }];

  extract();
  syncDir(out, items);
  const hrvSynced = read('hrv.csv'), energySynced = read('active-energy-daily.csv');
  assert.equal(hrvSynced, 'date,value,source\n2030-01-01,40,W\n2030-01-02,42,Shortcut\n', 'export wins on 01-01');
  assert.equal(energySynced, 'date,kcal\n2030-01-01,300\n2030-01-02,500\n');
  assert.ok(JSON.parse(read('_meta.json')).shortcutSync);

  extract(); // a new export drop rewrites CSVs + _meta.json, leaves the cache alone
  assert.ok(!read('hrv.csv').includes('Shortcut'));
  assert.equal(read('active-energy-daily.csv'), 'date,kcal\n2030-01-01,300\n');
  assert.equal(JSON.parse(read('_meta.json')).shortcutSync, undefined);
  assert.ok(fs.existsSync(path.join(out, CACHE_FILE)));

  syncDir(out, []); // nothing new on the server -> rebuilt from the cache alone
  assert.equal(read('hrv.csv'), hrvSynced);
  assert.equal(read('active-energy-daily.csv'), energySynced);
  assert.deepEqual(syncDir(out, []).writes, {}, 'second sync is a no-op');
  fs.rmSync(dir, { recursive: true });
});

// ---- DST fall-back (Europe/Madrid, last Sunday of October: +02:00 -> +01:00) --------------

test('sleep across the DST fall-back: real minutes, one night, wall-clock bed/wake', () => {
  const s = collectSamples([{ sleep: [
    '2026-10-24T23:30:00+02:00;2026-10-25T02:30:00+02:00;Core', // 3 h in summer time
    '2026-10-25T02:00:00+01:00;2026-10-25T06:00:00+01:00;Deep', // 4 h after clocks go back
  ].join('\n') }]);
  assert.deepEqual(buildRows('sleep', s.sleep).map(r => r.line), [`2026-10-25,7.00,${SHORTCUT_SOURCE},23.5,6,0.00,4.00,3.00,0.00,0.00,7.50`]); // in bed = the 7.5 h window (a 30 min gap)
});

test('vo2max: point samples without a source merge into vo2max.csv tagged Shortcut', () => {
  const s = collectSamples([{ vo2max: '2030-01-02T10:00:00+01:00;45.123\n2030-01-05T10:00:00+01:00;45,6' }]);
  assert.deepEqual(buildRows('vo2max', s.vo2max).map(r => r.line),
    [`2030-01-02,45.12,${SHORTCUT_SOURCE}`, `2030-01-05,45.6,${SHORTCUT_SOURCE}`]);
  const H = 'date,value,source';
  const r = mergeCsv([H, '2030-01-02,44,Watch', ''].join('\n'), METRICS.vo2max.header, buildRows('vo2max', s.vo2max));
  assert.equal(r.text, [H, '2030-01-02,44,Watch', `2030-01-05,45.6,${SHORTCUT_SOURCE}`, ''].join('\n'));
  assert.equal(METRICS.vo2max.csv, 'vo2max.csv');
});

// ---- recovery signals ------------------------------------------------------------------

test('respiratory: day-grouped mean -> date,brpm (1 decimal); 0 = no data; oldest day dropped', () => {
  const s = collectSamples([{ respiratory: daily(['2030-01-01', 15], ['2030-01-02', 14.46], ['2030-01-03', 0], ['2030-01-04', 15.25]) }]);
  assert.deepEqual(buildRows('respiratory', s.respiratory).map(r => r.line), ['2030-01-02,14.5', '2030-01-04,15.3']);
  assert.equal(METRICS.respiratory.header, 'date,brpm');
  assert.equal(METRICS.respiratory.csv, 'respiratory-daily.csv');
  assert.equal(METRICS.respiratory.sourceCol, null);
});

test('walking_hr: day-grouped mean -> date,bpm (integer)', () => {
  const s = collectSamples([{ walking_hr: daily(['2030-01-01', 90], ['2030-01-03', 95.6], ['2030-01-05', 0]) }]);
  assert.deepEqual(buildRows('walking_hr', s.walking_hr).map(r => r.line), ['2030-01-03,96']);
  assert.equal(METRICS.walking_hr.header, 'date,bpm');
  assert.equal(METRICS.walking_hr.csv, 'walking-hr-daily.csv');
});

test('wrist_temp: dated by the wake-up night (like sleep and extract.mjs), one row per sample', () => {
  const s = collectSamples([{ wrist_temp: '2030-01-01T23:10:00+01:00;36.123\n2030-01-03T00:20:00+01:00;36,4' }]);
  assert.deepEqual(buildRows('wrist_temp', s.wrist_temp).map(r => r.line),
    [`2030-01-02,36.12,${SHORTCUT_SOURCE}`, `2030-01-03,36.4,${SHORTCUT_SOURCE}`]);
  assert.equal(METRICS.wrist_temp.csv, 'wristTemp.csv');
});

test('hr_recovery: one row per workout sample -> hr-recovery.csv', () => {
  const s = collectSamples([{ hr_recovery: '2030-01-02T19:00:00+01:00;25.26\n2030-01-02T20:00:00+01:00;30' }]);
  assert.deepEqual(buildRows('hr_recovery', s.hr_recovery).map(r => r.line),
    [`2030-01-02,25.3,${SHORTCUT_SOURCE}`, `2030-01-02,30,${SHORTCUT_SOURCE}`]);
  assert.equal(METRICS.hr_recovery.csv, 'hr-recovery.csv');
  assert.equal(METRICS.hr_recovery.metaKey, 'hrRecovery', 'same rows key extract.mjs writes');
});

test('extract.mjs writes hr-recovery.csv in the same schema the sync uses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-hrr-'));
  fs.writeFileSync(path.join(dir, 'export.xml'),
    '<Record type="HKQuantityTypeIdentifierHeartRateRecoveryOneMinute" sourceName="W" startDate="2030-01-02 19:00:00 +0100" endDate="2030-01-02 19:01:00 +0100" value="25.26"/>\n</HealthData>\n');
  execFileSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { stdio: 'ignore', env: { ...process.env, EXTRACT_DIR: dir } });
  const out = path.join(dir, 'extract');
  assert.equal(fs.readFileSync(path.join(out, 'hr-recovery.csv'), 'utf8'), 'date,value,source\n2030-01-02,25.3,W\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, '_meta.json'), 'utf8')).rows.hrRecovery, 1);
  fs.rmSync(dir, { recursive: true });
});

// ---- waist circumference ----------------------------------------------------------------

test('waist: point samples in cm -> waist.csv (1 decimal, tagged Shortcut); metres are converted', () => {
  const s = collectSamples([{ waist: '2030-01-02T08:00:00+01:00;84.26\n2030-01-09T08:00:00+01:00;0,835' }]);
  assert.deepEqual(buildRows('waist', s.waist).map(r => r.line),
    [`2030-01-02,84.3,${SHORTCUT_SOURCE}`, `2030-01-09,83.5,${SHORTCUT_SOURCE}`]);
  assert.equal(METRICS.waist.csv, 'waist.csv');
  assert.equal(METRICS.waist.header, 'date,value,source');
});

test('extract.mjs writes waist.csv (cm) in the same schema the sync uses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-waist-'));
  fs.writeFileSync(path.join(dir, 'export.xml'), [
    '<Record type="HKQuantityTypeIdentifierWaistCircumference" sourceName="Health" unit="cm" startDate="2030-01-02 08:00:00 +0100" endDate="2030-01-02 08:00:00 +0100" value="84.26"/>',
    '<Record type="HKQuantityTypeIdentifierWaistCircumference" sourceName="Health" unit="m" startDate="2030-01-09 08:00:00 +0100" endDate="2030-01-09 08:00:00 +0100" value="0.835"/>',
    '<Record type="HKQuantityTypeIdentifierWaistCircumference" sourceName="Health" unit="in" startDate="2030-01-16 08:00:00 +0100" endDate="2030-01-16 08:00:00 +0100" value="33"/>',
    '</HealthData>',
    '',
  ].join('\n'));
  execFileSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { stdio: 'ignore', env: { ...process.env, EXTRACT_DIR: dir } });
  const out = path.join(dir, 'extract');
  assert.equal(fs.readFileSync(path.join(out, 'waist.csv'), 'utf8'),
    'date,value,source\n2030-01-02,84.3,Health\n2030-01-09,83.5,Health\n2030-01-16,83.8,Health\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, '_meta.json'), 'utf8')).rows.waist, 3);
  fs.rmSync(dir, { recursive: true });
});

// ---- dietary intake: four day-grouped keys -> one dietary-daily.csv row per day -----------

const DIET_H = 'date,kcal,protein_g,carbs_g,fat_g';

test('dietary: diet_kcal/protein/carbs/fat day totals merge into one dietary-daily.csv row per day', () => {
  const s = collectSamples([{
    diet_kcal: daily(['2030-01-01', 300], ['2030-01-02', 2104.6], ['2030-01-03', 1850]),
    diet_protein: daily(['2030-01-01', 20], ['2030-01-02', 151.26], ['2030-01-03', 140]),
    diet_carbs: daily(['2030-01-01', 30], ['2030-01-02', 220], ['2030-01-03', 190.04]),
    diet_fat: daily(['2030-01-01', 5], ['2030-01-02', 70.56]),
  }]);
  assert.deepEqual(buildRows('dietary', s.dietary).map(r => r.line), [
    '2030-01-02,2105,151.3,220.0,70.6',
    '2030-01-03,1850,140.0,190.0,',
  ], 'oldest (truncated) day of the group dropped; a macro missing on a day stays blank, never 0');
  assert.equal(METRICS.dietary.csv, 'dietary-daily.csv');
  assert.equal(METRICS.dietary.header, DIET_H, 'the exact schema extract.mjs writes');
  assert.equal(METRICS.dietary.sourceCol, null);
});

test('dietary: a day without kcal (or with 0 kcal) is no data; latest payload wins per key', () => {
  const s = collectSamples([
    { diet_kcal: daily(['2030-01-01', 1], ['2030-01-02', 900], ['2030-01-03', 0]), diet_protein: daily(['2030-01-01', 1], ['2030-01-04', 50]) },
    { diet_kcal: daily(['2030-01-01', 5], ['2030-01-02', 950], ['2030-01-03', 0], ['2030-01-05', 2000]), diet_protein: daily(['2030-01-01', 1], ['2030-01-05', 160]) },
  ]);
  assert.deepEqual(buildRows('dietary', s.dietary).map(r => r.line), [
    '2030-01-02,950,,,',
    '2030-01-05,2000,160.0,,',
  ], '01-02 corrected by the later payload; 01-03 (0 kcal) and 01-04 (protein only) are no data');
});

test('dietary: the truncated oldest day is shared by the whole key group, not computed per key', () => {
  // protein has no entry on the window start (01-01), so its first entry (01-02) is a complete
  // day — dropping it per key would lose a real macro.
  const s = collectSamples([{
    diet_kcal: daily(['2030-01-01', 300], ['2030-01-02', 2000], ['2030-01-03', 1900]),
    diet_protein: daily(['2030-01-02', 150], ['2030-01-03', 140]),
  }]);
  assert.deepEqual(buildRows('dietary', s.dietary).map(r => r.line), [
    '2030-01-02,2000,150.0,,',
    '2030-01-03,1900,140.0,,',
  ]);
});

test('dietary: export rows win; Shortcut rows fill only dates the export lacks and stay replaceable via the ledger', () => {
  const payload = { diet_kcal: daily(['2030-01-01', 1], ['2030-01-02', 2000], ['2030-01-03', 2100]), diet_protein: daily(['2030-01-01', 1], ['2030-01-02', 150], ['2030-01-03', 155]) };
  const files = { 'dietary-daily.csv': [DIET_H, '2030-01-02,1900,140.0,200.0,60.0', ''].join('\n') };
  const plan = planSync([{ id: '1', payload }], name => files[name] ?? null);
  assert.equal(plan.writes['dietary-daily.csv'], [DIET_H, '2030-01-02,1900,140.0,200.0,60.0', '2030-01-03,2100,155.0,,', ''].join('\n'));
  const meta = JSON.parse(plan.writes['_meta.json']);
  assert.deepEqual(meta.shortcutSync.owned['dietary-daily.csv'], ['2030-01-03']);
  // a second sync over the file it wrote is idempotent (its own row is rebuilt, not duplicated)
  const files2 = { ...files, ...plan.writes };
  const again = planSync([], name => files2[name] ?? null);
  assert.equal(again.writes['dietary-daily.csv'], undefined);
});

// ---- docs drift guard --------------------------------------------------------------------

test('docs/ios-shortcut.md documents every payload key the sync reads (and no retired one)', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'ios-shortcut.md'), 'utf8');
  const keys = Object.entries(METRICS).flatMap(([metric, def]) =>
    def.payloadKeys || (def.devices ? Object.keys(def.devices) : def.fields ? Object.keys(def.fields) : [metric]));
  const rows = new Set([...doc.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map(m => m[1]));
  assert.deepEqual([...rows].sort(), [...keys].sort(), 'the key table must list exactly the keys in METRICS');
});

// ---- extract.mjs <-> sync parity for sleep (naps) and wrist temperature -------------------

test('extract.mjs and the Shortcut sync write identical sleep rows (nap excluded) and wrist-temp dates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-sleep-'));
  const iv = [
    ['2030-01-01T23:30:00+01:00', '2030-01-02T03:00:00+01:00', 'Core'],
    ['2030-01-02T03:00:00+01:00', '2030-01-02T04:30:00+01:00', 'Awake'],
    ['2030-01-01T23:00:00+01:00', '2030-01-02T07:15:00+01:00', 'InBed'],
    ['2030-01-02T04:30:00+01:00', '2030-01-02T07:00:00+01:00', 'REM'],
    ['2030-01-02T17:40:00+01:00', '2030-01-02T18:40:00+01:00', 'Core'], // nap across 18:00
    ['2030-01-03T00:00:00+01:00', '2030-01-03T07:30:00+01:00', 'Deep'],
  ];
  const stamp = t => t.replace('T', ' ').replace(/([+-]\d{2}):(\d{2})$/, ' $1$2');
  const xmlStage = { Core: 'HKCategoryValueSleepAnalysisAsleepCore', REM: 'HKCategoryValueSleepAnalysisAsleepREM', Deep: 'HKCategoryValueSleepAnalysisAsleepDeep',
    Awake: 'HKCategoryValueSleepAnalysisAwake', InBed: 'HKCategoryValueSleepAnalysisInBed' };
  fs.writeFileSync(path.join(dir, 'export.xml'), [
    ...iv.map(([a, b, st]) => `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="${SHORTCUT_SOURCE}" startDate="${stamp(a)}" endDate="${stamp(b)}" value="${xmlStage[st]}"/>`),
    `<Record type="HKQuantityTypeIdentifierAppleSleepingWristTemperature" sourceName="${SHORTCUT_SOURCE}" startDate="2030-01-01 23:40:00 +0100" endDate="2030-01-02 07:00:00 +0100" value="36.1"/>`,
    '</HealthData>',
    '',
  ].join('\n'));
  execFileSync(process.execPath, [path.join(__dirname, 'extract.mjs')], { stdio: 'ignore', env: { ...process.env, EXTRACT_DIR: dir } });
  const out = path.join(dir, 'extract');
  const sync = collectSamples([{ sleep: iv.map(x => x.join(';')).join('\n'), wrist_temp: '2030-01-01T23:40:00+01:00;36.1' }]);
  const csvOf = (header, rows) => [header, ...rows.map(r => r.line)].join('\n') + '\n';
  const exportSleep = fs.readFileSync(path.join(out, 'sleep-daily.csv'), 'utf8');
  assert.equal(exportSleep, csvOf(METRICS.sleep.header, buildRows('sleep', sync.sleep)));
  assert.match(exportSleep, /^2030-01-02,6\.00,/m, 'the nap adds no minutes');
  assert.match(exportSleep, /^2030-01-02,6\.00,[^,]*,23\.5,7,2\.50,0\.00,3\.50,0\.00,1\.50,8\.25$/m, 'stage columns from the export values');
  assert.equal(fs.readFileSync(path.join(out, 'wristTemp.csv'), 'utf8'), csvOf(METRICS.wrist_temp.header, buildRows('wrist_temp', sync.wrist_temp)));
  fs.rmSync(dir, { recursive: true });
});


// ---- RHR: Apple rewrites the day's value at the SAME timestamp -> dedupe by timestamp only ----

test('rhr: samples dedupe by timestamp only; the latest payload wins a rewritten value', () => {
  const s = collectSamples([
    { rhr: '2030-01-02T00:05:00+01:00;55\n2030-01-03T00:05:00+01:00;52' },
    { rhr: '2030-01-02T00:05:00+01:00;53' }, // Apple recomputed the 2nd's RHR at the same stamp
  ]);
  assert.equal(s.rhr.length, 2);
  assert.deepEqual(buildRows('rhr', s.rhr).map(r => r.line), [
    '2030-01-02,53,' + SHORTCUT_SOURCE,
    '2030-01-03,52,' + SHORTCUT_SOURCE,
  ]);
  // other point metrics still keep two values at one stamp (timestamp + value key)
  assert.equal(collectSamples([{ hrv: '2030-01-02T08:00:00+01:00;40' }, { hrv: '2030-01-02T08:00:00+01:00;41' }]).hrv.length, 2);
});

// ---- weight: optional 3rd field (source) + phantom profile-weight guard -------------------

test('weight: an optional 3rd field is kept as the source; rows without it stay Shortcut', () => {
  const s = collectSamples([{ weight: '2030-01-02T07:10:00+01:00;80.4;My Scale\n2030-01-03T07:00:00+01:00;80.1\n2030-01-04T07:00:00+01:00;80;80 kg' }]);
  assert.deepEqual(buildRows('weight', s.weight).map(r => r.line), [
    '2030-01-02,80.4,My Scale',
    '2030-01-03,80.1,' + SHORTCUT_SOURCE,
    '2030-01-04,80,' + SHORTCUT_SOURCE, // a formatted value in the source field is ignored
  ]);
});

test('weight: a midnight date-only sample with no body-fat reading within 10 min is a phantom and dropped', () => {
  const plan = planSync([{ id: '1', payload: {
    weight: [
      '2030-01-02T00:00:00+01:00;90', // local midnight, no body fat -> phantom
      '2030-01-03T01:00:00+01:00;91', // 00:00 UTC (date-only entry seen from +01:00) -> phantom
      '2030-01-04T00:00:00+01:00;80.2;My Scale', // midnight but the scale wrote body fat 3 min later -> real
      '2030-01-05T07:00:00+01:00;80.0', // a normal weigh-in
    ].join('\n'),
    bodyfat: '2030-01-04T00:03:00+01:00;18.1;My Scale',
  } }], () => null);
  assert.equal(plan.writes['weight.csv'], [S_HDR, '2030-01-04,80.2,My Scale', '2030-01-05,80,' + SHORTCUT_SOURCE, ''].join('\n'));
});

test('dropPhantomWeights(): only exact midnight stamps (local or UTC) are candidates; body fat beyond 10 min does not rescue', () => {
  const w = (start, value = 80) => ({ start, value });
  const out = dropPhantomWeights([
    w('2030-01-02 00:00:30 +0100'), // not exact -> kept
    w('2030-01-03 00:00:00 +0100'), // body fat 11 min later -> still phantom
    w('2030-01-04 02:00:00 +0200'), // = 00:00 UTC -> phantom
  ], [{ start: '2030-01-03 00:11:00 +0100', value: 18 }]);
  assert.deepEqual(out.map(x => x.start), ['2030-01-02 00:00:30 +0100']);
  assert.deepEqual(dropPhantomWeights([w('2030-01-04 02:00:00 +0200')], undefined), []);
});

test('rhr: a cache written under the old timestamp+value key is re-keyed (no --full needed)', () => {
  const old = { ...emptyCache(), lastPayloadId: '1', payloads: 1, samples: { rhr: {
    '2030-01-02 00:05:00 +0100|55': { start: '2030-01-02 00:05:00 +0100', value: 55 },
    '2030-01-02 00:05:00 +0100|53': { start: '2030-01-02 00:05:00 +0100', value: 53 },
  } } };
  const c = foldPayloads(old, []);
  assert.deepEqual(Object.values(c.samples.rhr), [{ start: '2030-01-02 00:05:00 +0100', value: 53 }]);
});

// ---- exercise / distance / flights: Watch-filtered day totals --------------------------

test('exercise_watch / distance_watch / flights_watch write the extract.mjs daily schemas', () => {
  const s = collectSamples([{
    exercise_watch: '2030-01-01T00:00:00+01:00;3\n2030-01-02T00:00:00+01:00;42.4\n2030-01-03T00:00:00+01:00;0',
    distance_watch: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:00:00+01:00;7,456\n2030-01-03T00:00:00+01:00;0',
    flights_watch: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:00:00+01:00;11\n2030-01-03T00:00:00+01:00;0',
  }]);
  // oldest (window-truncated) day dropped; a 0 day (Fill Missing / not worn) is no data, like the export
  assert.deepEqual(buildRows('exercise_watch', s.exercise_watch).map(r => r.line), ['2030-01-02,42']);
  assert.deepEqual(buildRows('distance_watch', s.distance_watch).map(r => r.line), ['2030-01-02,7.46']);
  assert.deepEqual(buildRows('flights_watch', s.flights_watch).map(r => r.line), ['2030-01-02,11']);
  assert.equal(METRICS.exercise_watch.csv, 'exercise-minutes-daily.csv');
  assert.equal(METRICS.exercise_watch.header, 'date,minutes');
  assert.equal(METRICS.distance_watch.csv, 'distance-daily.csv');
  assert.equal(METRICS.distance_watch.header, 'date,km');
  assert.equal(METRICS.flights_watch.csv, 'flights-daily.csv');
  assert.equal(METRICS.flights_watch.header, 'date,flights');
});

test('distance_watch: km by default; metres (value > 100, or an "m" unit) and miles are converted', () => {
  const s = collectSamples([{ distance_watch: [
    '2030-01-01T00:00:00+01:00;1',
    '2030-01-02T00:00:00+01:00;6.2',
    '2030-01-03T00:00:00+01:00;6200',
    '2030-01-04T00:00:00+01:00;5400 m',
    '2030-01-05T00:00:00+01:00;5,1 km',
    '2030-01-06T00:00:00+01:00;2 mi',
  ].join('\n') }]);
  assert.deepEqual(buildRows('distance_watch', s.distance_watch).map(r => r.line), [
    '2030-01-02,6.20', '2030-01-03,6.20', '2030-01-04,5.40', '2030-01-05,5.10', '2030-01-06,3.22',
  ]);
});

test('exercise_watch: latest payload wins a day; export rows win, Shortcut fills only missing dates', () => {
  const files = { 'exercise-minutes-daily.csv': 'date,minutes\n2030-01-02,50\n', '_meta.json': '{"rows":{},"ranges":{},"notes":[]}' };
  const plan = planSync([
    { id: '1', payload: { exercise_watch: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:00:00+01:00;20\n2030-01-03T00:00:00+01:00;10' } },
    { id: '2', payload: { exercise_watch: '2030-01-02T00:00:00+01:00;1\n2030-01-03T00:00:00+01:00;35' } },
  ], name => files[name] ?? null);
  assert.equal(plan.writes['exercise-minutes-daily.csv'], 'date,minutes\n2030-01-02,50\n2030-01-03,35\n');
  const meta = JSON.parse(plan.writes['_meta.json']);
  assert.deepEqual(meta.shortcutSync.owned['exercise-minutes-daily.csv'], ['2030-01-03']);
  assert.equal(meta.rows.exercise, 2);
});

// ---- the export's LAST date is a partial day for daily totals --------------------------

test('planSync(): on the export\'s last date (exportLastDate) a Shortcut day total beats the partial export row', () => {
  const meta = JSON.stringify({ exportLastDate: '2030-01-03', rows: {}, ranges: {}, notes: [] });
  const files = {
    '_meta.json': meta,
    'steps-daily.csv': 'date,steps,source\n2030-01-02,9000,Watch\n2030-01-03,971,Watch\n',
    'exercise-minutes-daily.csv': 'date,minutes\n2030-01-02,40\n2030-01-03,1\n',
    'active-energy-daily.csv': 'date,kcal\n2030-01-02,600\n2030-01-03,103\n',
    'basal-energy-daily.csv': 'date,kcal\n2030-01-02,1800\n2030-01-03,918\n',
    'rhr.csv': 'date,value,source\n2030-01-03,50,Watch\n',
  };
  const plan = planSync([{ id: '1', payload: {
    steps_watch: '2030-01-01T00:00:00+01:00;1\n2030-01-02T00:00:00+01:00;9100\n2030-01-03T00:00:00+01:00;12000',
    exercise_watch: '2030-01-01T00:00:00+01:00;1\n2030-01-03T00:00:00+01:00;55',
    active_energy: '2030-01-01T00:00:00+01:00;1\n2030-01-03T00:00:00+01:00;750',
    rhr: '2030-01-03T00:05:00+01:00;49',
  } }], name => files[name] ?? null);
  assert.equal(plan.writes['steps-daily.csv'], `date,steps,source\n2030-01-02,9000,Watch\n2030-01-03,12000,${WATCH}\n`, 'export still wins a complete day');
  assert.equal(plan.writes['exercise-minutes-daily.csv'], 'date,minutes\n2030-01-02,40\n2030-01-03,55\n');
  assert.equal(plan.writes['active-energy-daily.csv'], 'date,kcal\n2030-01-02,600\n2030-01-03,750\n');
  // no Shortcut row for basal on that date -> the partial export row is dropped, never kept
  assert.equal(plan.writes['basal-energy-daily.csv'], 'date,kcal\n2030-01-02,1800\n');
  assert.equal(plan.writes['rhr.csv'], undefined, 'point series keep the export row (not a day total)');
  const owned = JSON.parse(plan.writes['_meta.json']).shortcutSync.owned;
  assert.deepEqual(owned['active-energy-daily.csv'], ['2030-01-03']);
});

test('planSync(): without exportLastDate in _meta.json, export rows win every date as before', () => {
  const files = { '_meta.json': '{"rows":{},"ranges":{},"notes":[]}', 'basal-energy-daily.csv': 'date,kcal\n2030-01-03,918\n' };
  const plan = planSync([{ id: '1', payload: { basal_energy: '2030-01-02T00:00:00+01:00;1\n2030-01-03T00:00:00+01:00;1800' } }], name => files[name] ?? null);
  assert.equal(plan.writes['basal-energy-daily.csv'], undefined);
});

test('every daily-total metric is flagged total (the partial-export-day rule); means and points are not', () => {
  const totals = Object.entries(METRICS).filter(([, d]) => d.total).map(([m]) => m).sort();
  assert.deepEqual(totals, ['active_energy', 'basal_energy', 'dietary', 'distance_watch', 'exercise_watch', 'flights_watch', 'steps']);
});

test('distance_watch heuristic boundary: bare 100 is km, bare 101 is metres; "3,5" is 3.5 km', () => {
  const s = collectSamples([{ distance_watch: [
    '2030-01-01T00:00:00+01:00;1',
    '2030-01-02T00:00:00+01:00;100',
    '2030-01-03T00:00:00+01:00;101',
    '2030-01-04T00:00:00+01:00;3,5',
    '2030-01-05T00:00:00+01:00;1.234,5 m',
  ].join('\n') }]);
  assert.deepEqual(buildRows('distance_watch', s.distance_watch).map(r => r.line), [
    '2030-01-02,100.00', '2030-01-03,0.10', '2030-01-04,3.50', '2030-01-05,1.23',
  ]);
});

test('parseNumber() reads thousands separators by the LAST separator; ambiguous repeats are rejected', () => {
  assert.equal(parseNumber('1.234,5'), 1234.5);
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('3,5'), 3.5);
  assert.equal(parseNumber('3.5'), 3.5);
  assert.equal(parseNumber('1.234.567'), null);
  assert.equal(parseNumber('1,234,567'), null);
});

// ---- main() returns its exit code (runCli sets it): called in-process, the runner is never killed ----

function mainHarness (prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const out = [], err = [];
  const env = { INGEST_ENV_FILE: path.join(dir, 'no-such.env'), INGEST_URL: 'http://127.0.0.1:9' };
  const refused = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  const answer = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  const blocked = path.join(dir, 'a-file');
  fs.writeFileSync(blocked, 'x');
  return {
    dir, env, refused, answer, out, err,
    io: { log: (s) => out.push(s), error: (s) => err.push(s) },
    unwritable: path.join(blocked, 'sub'), // a path under a regular file: every write fails
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('main() in-process: missing token / bad cache / unreachable service -> returns 1, nothing written', async () => {
  const h = mainHarness('sync-shortcut-main-');
  try {
    const outDir = path.join(h.dir, 'extract');
    assert.equal(await sync.main({ env: h.env, ...h.io, fetchImpl: h.refused, outDir }), 1);
    assert.match(h.err.pop(), /no ingest token/);
    const env = { ...h.env, INGEST_TOKEN: 't' };
    assert.equal(await sync.main({ env, ...h.io, fetchImpl: h.refused, outDir }), 1);
    assert.match(h.err.pop(), /could not read from the ingest service .*ECONNREFUSED/);
    assert.ok(!fs.existsSync(outDir));
    fs.mkdirSync(outDir);
    fs.writeFileSync(path.join(outDir, sync.CACHE_FILE), '{not json');
    assert.equal(await sync.main({ env, ...h.io, fetchImpl: h.answer(200, []), outDir }), 1);
    assert.match(h.err.pop(), /unreadable or from another version/);
    assert.deepEqual(fs.readdirSync(outDir), [sync.CACHE_FILE]);
  } finally { h.cleanup(); }
});

test('main() in-process: no new payloads -> returns 0', async () => {
  const h = mainHarness('sync-shortcut-main-');
  try {
    assert.equal(await sync.main({ env: { ...h.env, INGEST_TOKEN: 't' }, ...h.io, fetchImpl: h.answer(200, []), outDir: path.join(h.dir, 'extract') }), 0);
    assert.match(h.out[0], /Synced 0 new/);
  } finally { h.cleanup(); }
});

test('syncDir writes _meta.json (the ownership ledger) FIRST; a failure after it leaves the ledger listing the dates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-order-'));
  const items = [{ id: '1', payload: { hrv: '2030-01-02T08:00:00+01:00;42' } }];
  const order = [];
  syncDir(dir, items, { writeAtomic: (file) => order.push(path.basename(file)) });
  assert.equal(order[0], '_meta.json');
  assert.ok(order.includes('hrv.csv') && order.includes(CACHE_FILE));

  // the CSV write fails after the ledger write: the ledger already owns the date
  assert.throws(() => syncDir(dir, items, {
    writeAtomic: (file, text) => { if (path.basename(file) !== '_meta.json') throw new Error('disk full'); writeAtomic(file, text); },
  }), /disk full/);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8'));
  assert.deepEqual(meta.shortcutSync.owned['hrv.csv'], ['2030-01-02']);
  assert.equal(fs.existsSync(path.join(dir, 'hrv.csv')), false);
  fs.rmSync(dir, { recursive: true });
});

test('integer metrics (steps, flights, exercise minutes): one separator + exactly three digits is a thousands group', () => {
  assert.equal(parseCount('12.345'), 12345);
  assert.equal(parseCount('12,345'), 12345);
  assert.equal(parseCount('1.234.567'), 1234567);
  assert.equal(parseCount('12.345,0'), 12345);
  assert.equal(parseCount('8432'), 8432);
  assert.equal(parseCount('12,5'), 12.5, 'not three digits: still a decimal');
  assert.equal(parseCount('x'), null);
  const p = parsePayload({
    steps_watch: '2030-01-02T00:00:00+01:00;12.345',
    steps_phone: '2030-01-02T00:00:00+01:00;1,204',
    flights_watch: '2030-01-02T00:00:00+01:00;12',
    exercise_watch: '2030-01-02T00:00:00+01:00;1.020',
  });
  assert.deepEqual(p.steps.map((s) => [s.device, s.value]), [['Shortcut Watch', 12345], ['Shortcut iPhone', 1204]]);
  assert.equal(p.flights_watch[0].value, 12);
  assert.equal(p.exercise_watch[0].value, 1020);
  // a non-integer metric keeps the decimal reading
  assert.equal(parsePayload({ respiratory: '2030-01-02T00:00:00+01:00;14,500' }).respiratory[0].value, 14.5);
});

test('sleep: in-bed estimation is export-only — a Shortcut payload with only InBed segments (a band + the iPhone\'s Sleep Schedule, one "Shortcut" source) yields no night', () => {
  const s = collectSamples([{ sleep: [
    '2030-01-01T23:40:00+01:00;2030-01-02T07:40:00+01:00;En cama', // the band
    '2030-01-02T23:00:00+01:00;2030-01-03T07:00:00+01:00;InBed', // the iPhone's bedtime window
  ].join('\n') }]);
  assert.deepEqual(buildRows('sleep', s.sleep), []);
  // asleep data still builds its night as before
  const w = collectSamples([{ sleep: '2030-01-01T23:00:00+01:00;2030-01-02T07:00:00+01:00;Core' }]);
  assert.equal(buildRows('sleep', w.sleep).length, 1);
});
