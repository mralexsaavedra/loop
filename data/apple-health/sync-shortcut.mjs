#!/usr/bin/env node
/* iOS Shortcut sync — pulls the payloads an iOS Shortcut POSTed to the self-hosted ingest
 * service (services/loop-ingest) and MERGES them into the Apple Health extract CSVs, so the
 * cache stays fresh between full export.xml drops.
 *
 *   npm run sync              incremental: fetches only payloads newer than the local cache
 *   npm run sync -- --full    ignore the cache, refetch every payload and rebuild it
 *
 * Env    : INGEST_URL (default http://localhost:<INGEST_PORT of this clone's services/loop-ingest/.env>, else :8088), INGEST_TOKEN (falls back to
 *          services/loop-ingest/.env), SHORTCUT_AUTOMATION (default "atajo-salud").
 * Writes : loop-data/extract/<csv of each METRICS entry> + _meta.json + .shortcut-cache.json
 *          (each via temp file + rename; nothing is written if the service can't be read)
 *
 * Payload: one JSON object per run; each metric is a newline-joined string, a key is omitted
 * (or empty) when the query returned nothing. Point: "ISO;value[;source]". Daily total (grouped
 * by day on the phone): "ISO;value". Sleep: "ISO-start;ISO-end;stage".
 * Runs overlap (rolling window), so samples are deduped across ALL payloads.
 *
 * Merge rule: export-derived rows ALWAYS win, except on the export's LAST date for daily totals
 * (_meta.json exportLastDate: export.xml is taken mid-day, so that day is partial — the Shortcut
 * total wins it, or the export row is dropped when there is none). Rows the sync wrote before are rebuilt from
 * scratch every run and added only for DATES the export does not cover. "Rows the sync wrote"
 * = rows tagged source=Shortcut OR on a date in the ownership ledger (_meta.json
 * shortcutSync.owned) — the ledger covers CSVs with no source column (energy) and body-comp rows
 * that keep the scale's real source. extract.mjs rewrites CSVs AND _meta.json together, so a
 * re-extract drops ledger and rows at once; just sync again afterwards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../lib/extract/samples.mjs';
import * as HR from '../../lib/health/hr-hourly.mjs';
import { HOURLY_CSV, HOURLY_HEADER } from '../../lib/health/ride-energy.mjs';
import { ZONES_CSV } from '../../lib/training/hr-zones.mjs';
import * as common from '../../scripts/lib/sync-common.mjs';
import { isMain } from '../../scripts/lib/is-main.mjs';
import { dataPaths } from '../../lib/paths.mjs';

const SHORTCUT_SOURCE = 'Shortcut';
const DEFAULT_AUTOMATION = 'atajo-salud';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// the extract this clone writes (lib/paths.mjs: loop-data/extract, or <HC_DATA_DIR>/extract)
/** @param {NodeJS.ProcessEnv} env @returns {string} */
const defaultOut = (env) => dataPaths({ repoRoot: ROOT, env }).extractDir;

// Per-metric table. Adding a metric = one entry (+ a new `kind` only if its line shape is new).
//   kind point    : "start;value[;source]"   -> one row per sample   (date,value,source)
//   kind daily    : "start;value"            -> one row per day      (already a day total)
//   kind deviceDaily : like daily, but one payload key PER DEVICE (`devices`: key -> source
//                   label); the day's value = MAX across devices, exactly like extract.mjs's
//                   max-per-device dedupe (summing iPhone + Watch double-counts)
//   kind fieldsDaily : like daily, but one payload key PER CSV COLUMN (`fields`: key -> column);
//                   the day's row joins every column (dietary intake: kcal + three macros)
//   kind hourly   : "start;value"            -> one row per CLOCK HOUR (Group by Hour on the phone;
//                   the stamp is the bucket's first sample, normalised to the hour start). Keyed by
//                   local hour + offset, so a DST fall-back night keeps both 02:00 hours.
//   kind interval : "start;end;stage"        -> one row per night    (sleep-daily schema)
//   kind hrSamples : "start;bpm" (ungrouped heart-rate samples) -> one row per CLOCK HOUR of
//                   aggregates (lib/health/hr-hourly.mjs); samples deduped by their exact instant, later
//                   payload wins: a payload's samples at an instant REPLACE the cached ones there, so a
//                   band's several hour-stamped records survive and a re-sent hour never doubles (foldHr).
//                   Also read from the loop-free parallel lists `hr_t` (Start Dates) + `hr_v` (Values),
//                   zipped by index (HR.mergeHrSamples); lists of different lengths are dropped with a warning
//   payloadKeys   : every payload key the metric reads, when not just its own name (hrSamples)
//   withSource    : keep the payload's per-sample source in the CSV (else "Shortcut")
//   sourceCol     : index of the CSV source column, null when the schema has none
//   metaKey / rangeKey : the _meta.json rows/ranges keys extract.mjs uses for that CSV.
//   total         : a DAILY TOTAL series (not a mean, not a point): on the export's last date
//                   (_meta.json exportLastDate, a partial day: export.xml is taken mid-day) the
//                   export row never counts as covering the date: a Shortcut row wins it, and the
//                   export row is dropped when there is none (see planSync)
//   dedupKey / prefer : per-metric overrides of DEDUP_KEY / PREFER for the metric's kind
/** @typedef {'point' | 'daily' | 'deviceDaily' | 'fieldsDaily' | 'hourly' | 'interval' | 'hrSamples'} MetricKind */
/** One parsed payload sample; which optional keys it carries depends on its metric's kind (`source`: point
 * withSource, `device`: deviceDaily, `field`: fieldsDaily, `end` + `stage`: interval, whose samples carry no value).
 * @typedef {{start: string, value: number, source?: string | null, device?: string, field?: string, end?: string, stage?: string}} Sample */
/** @typedef {(date: string, v: number, source?: string) => string} RowFn a value row (daily, deviceDaily, hourly: date = the hour stamp) */
/** @typedef {(date: string, f: Record<string, number>) => string} FieldsRowFn a fieldsDaily row from its column -> value map */
/**
 * @typedef {object} MetricDef one METRICS entry (see the table above)
 * @property {MetricKind} kind
 * @property {string} csv
 * @property {string} header
 * @property {string} metaKey
 * @property {string} [rangeKey]
 * @property {string[]} [payloadKeys]
 * @property {boolean} [withSource]
 * @property {number | null} [sourceCol]
 * @property {boolean} [total]
 * @property {boolean} [skipZero]
 * @property {Record<string, string>} [devices]
 * @property {Record<string, string>} [fields]
 * @property {(v: number) => number} [fmt]
 * @property {(v: unknown) => number | null} [parseValue]
 * @property {(start: string, end?: string) => string} [dateOf]
 * @property {(s: Sample) => string} [dedupKey]
 * @property {(a: Sample, b: Sample) => Sample} [prefer]
 * @property {RowFn | FieldsRowFn} [row]
 */
/** @typedef {{id: string | number, payload: unknown}} PayloadItem one /export/raw row */
/** @typedef {{version: number, lastPayloadId: string | null, payloads: number, samples: Record<string, Record<string, Sample>>}} ShortcutCache */
/** @typedef {{text: string, rows: number, dates: string[], added: number, addedDates: string[], written?: boolean}} MergeStat */
/** @typedef {{sourceCol?: number | null, isOwn?: (source: string) => boolean, ownedDates?: string[], exportWins?: boolean}} MergeOpts */
const DAILY_SOURCE_HEADER = 'date,steps,source';
const KCAL_HEADER = 'date,kcal';
// "2030-01-02 09:07:12 +0100" -> "2030-01-02T09:00:00+01:00" (the bucket's clock-hour start, ISO)
const hourStartIso = HR.hourStartIso;
/** @type {Record<string, MetricDef>} */
const METRICS = {
  hrv:      { kind: 'point', csv: 'hrv.csv', header: S.READING_HEADER, metaKey: 'hrv', fmt: v => +v.toFixed(1) },
  // Apple REWRITES the day's resting HR at the same timestamp as the day goes on, so two payloads
  // can carry different values at one stamp: dedupe by timestamp only and keep the latest payload's.
  rhr:      { kind: 'point', csv: 'rhr.csv', header: S.READING_HEADER, metaKey: 'rhr', rangeKey: 'restingHR', fmt: v => +v.toFixed(2),
    dedupKey: s => s.start, prefer: (a, b) => b },
  vo2max:   { kind: 'point', csv: 'vo2max.csv', header: S.READING_HEADER, metaKey: 'vo2max', fmt: v => +v.toFixed(2) },
  // optional 3rd field = the scale / app (like bodyfat); a row without it stays "Shortcut". Phantom
  // profile weights (a date-only midnight sample with no body-fat reading) are dropped: dropPhantomWeights
  weight:   { kind: 'point', csv: 'weight.csv', header: S.READING_HEADER, metaKey: 'weight', rangeKey: 'weight', withSource: true, fmt: v => +v.toFixed(2) },
  // body fat is stored as a PERCENT (extract.mjs converts HealthKit's fraction) -> accept both scales.
  // Real scale source kept: generate-health's body-comp uses the LATEST SOURCE only, so a
  // "Shortcut" tag would cut the series off from the same scale's export history.
  bodyfat:  { kind: 'point', csv: 'bodyfat.csv', header: S.READING_HEADER, metaKey: 'bodyfat', withSource: true, fmt: v => +(v < 1 ? v * 100 : v).toFixed(2) },
  leanmass: { kind: 'point', csv: 'leanmass.csv', header: S.READING_HEADER, metaKey: 'leanmass', withSource: true, fmt: v => +v.toFixed(2) },
  // The legacy merged `steps` key is NOT read: iOS's day grouping summed iPhone + Watch.
  steps:         { kind: 'deviceDaily', csv: 'steps-daily.csv', header: DAILY_SOURCE_HEADER, metaKey: 'steps', rangeKey: 'steps', total: true,
    devices: { steps_watch: `${SHORTCUT_SOURCE} Watch`, steps_phone: `${SHORTCUT_SOURCE} iPhone` },
    parseValue: v => parseCount(v), row: (/** @type {string} */ date, /** @type {number} */ v, /** @type {string | undefined} */ source) => `${date},${Math.round(v)},${source}` },
  active_energy: { kind: 'daily', csv: 'active-energy-daily.csv', header: KCAL_HEADER, metaKey: 'active_energy', sourceCol: null, total: true,
    row: (/** @type {string} */ date, /** @type {number} */ v) => `${date},${Math.round(v)}` },
  // Watch active energy per clock hour (Watch-only search, Group by Hour). Not an export series:
  // it only feeds lib/health/ride-energy.mjs, which replaces the Watch's energy during a ride a
  // power meter measured. Source column = "Shortcut", so every row is rebuilt each run.
  active_energy_hourly: { kind: 'hourly', csv: HOURLY_CSV, header: HOURLY_HEADER, metaKey: 'active_energy_hourly', sourceCol: 3,
    row: (/** @type {string} */ st, /** @type {number} */ v) => `${S.day(st)},${hourStartIso(st)},${v.toFixed(1)},${SHORTCUT_SOURCE}` },
  basal_energy:  { kind: 'daily', csv: 'basal-energy-daily.csv', header: KCAL_HEADER, metaKey: 'basal_energy', sourceCol: null, total: true,
    row: (/** @type {string} */ date, /** @type {number} */ v) => `${date},${Math.round(v)}` },
  // Sleeping wrist temperature: one sample per night, dated by the wake-up night exactly like
  // extract.mjs and sleep-daily.csv (samples.mjs wristTempDate: a 23:xx and a 00:xx start agree).
  wrist_temp:  { kind: 'point', csv: 'wristTemp.csv', header: S.READING_HEADER, metaKey: 'wristTemp', dateOf: S.wristTempDate, fmt: v => +v.toFixed(2) },
  // Cardio Recovery (bpm drop 1 min after a workout): one row per workout sample (per-day means
  // would hide which session it was; readers can average). extract.mjs writes the same CSV.
  hr_recovery: { kind: 'point', csv: 'hr-recovery.csv', header: S.READING_HEADER, metaKey: 'hrRecovery', fmt: v => +v.toFixed(1) },
  // day-grouped means (extract.mjs: per-day mean of all samples); "fill missing" 0 rows = no data
  respiratory: { kind: 'daily', csv: 'respiratory-daily.csv', header: 'date,brpm', metaKey: 'respiratory', sourceCol: null, skipZero: true,
    row: (/** @type {string} */ date, /** @type {number} */ v) => `${date},${v.toFixed(1)}` },
  walking_hr:  { kind: 'daily', csv: 'walking-hr-daily.csv', header: 'date,bpm', metaKey: 'walking_hr', sourceCol: null, skipZero: true,
    row: (/** @type {string} */ date, /** @type {number} */ v) => `${date},${v.toFixed(0)}` },
  // Waist circumference in cm (a Shortcut on a metric phone reports cm; a value under 3 is metres
  // and is converted). Sparse, manual measurements -> one row per sample, like weight.
  waist:    { kind: 'point', csv: 'waist.csv', header: S.READING_HEADER, metaKey: 'waist', fmt: v => +(v < 3 ? v * 100 : v).toFixed(1) },
  // Food intake logged by a nutrition app that writes to Health: FOUR day-grouped payload keys
  // (`fields`: key -> CSV column) folded into ONE dietary-daily.csv row per day, the exact schema
  // extract.mjs writes. A day without kcal (or 0 kcal = "fill missing") is no data; a macro missing
  // on a logged day stays blank, never 0.
  dietary:  { kind: 'fieldsDaily', csv: 'dietary-daily.csv', header: 'date,kcal,protein_g,carbs_g,fat_g', metaKey: 'dietary', rangeKey: 'dietary', sourceCol: null, total: true,
    fields: { diet_kcal: 'kcal', diet_protein: 'protein', diet_carbs: 'carbs', diet_fat: 'fat' },
    row: (/** @type {string} */ date, /** @type {Record<string, number>} */ f) => [date, Math.round(f.kcal), ...['protein', 'carbs', 'fat'].map(k => (f[k] != null ? f[k].toFixed(1) : ''))].join(',') },
  sleep:    { kind: 'interval', csv: 'sleep-daily.csv', header: S.SLEEP_HEADER, metaKey: 'sleep' },
  // Heart-rate samples (Heart Rate, Source = the watch or a band's app, NO grouping, last 1 day): only hourly
  // aggregates reach the CSV (lib/health/hr-hourly.mjs), the raw samples live in the local cache. Feeds day
  // strain (lib/score/strain.mjs). Tagged "Shortcut", so every row is rebuilt each run.
  hr_samples: { kind: 'hrSamples', payloadKeys: ['hr_samples', HR.HR_TIMES_KEY, HR.HR_VALUES_KEY], csv: HR.HR_HOURLY_CSV, header: HR.HR_HOURLY_HEADER, metaKey: 'hr_hourly', sourceCol: 9 },
  // Watch-filtered day totals (one search per key, *Source is* the watch, Group by Day), the same
  // CSVs extract.mjs writes (max-per-device there; the Watch is the device that logs these fully).
  // No source column -> ownership via the ledger, like energy. A 0 day (Fill Missing, watch not worn)
  // is no data: extract.mjs only writes days with samples, so it has no zero rows either.
  exercise_watch: { kind: 'daily', csv: 'exercise-minutes-daily.csv', header: 'date,minutes', metaKey: 'exercise', sourceCol: null, skipZero: true, total: true,
    parseValue: v => parseCount(v), row: (/** @type {string} */ date, /** @type {number} */ v) => `${date},${Math.round(v)}` },
  // km. Accepts a unit ("5,1 km", "5400 m", "3 mi"); a bare number above 100 is metres (no one walks
  // + runs 100 km in a day, and a real total under 100 m is a not-worn day the Salud floor drops anyway)
  distance_watch: { kind: 'daily', csv: 'distance-daily.csv', header: 'date,km', metaKey: 'distance', rangeKey: 'distance', sourceCol: null, skipZero: true, total: true,
    parseValue: v => parseKm(v), row: (/** @type {string} */ date, /** @type {number} */ v) => `${date},${v.toFixed(2)}` },
  flights_watch: { kind: 'daily', csv: 'flights-daily.csv', header: 'date,flights', metaKey: 'flights', sourceCol: null, skipZero: true, total: true,
    parseValue: v => parseCount(v), row: (/** @type {string} */ date, /** @type {number} */ v) => `${date},${Math.round(v)}` },
};
// "Shortcut" or a device-tagged "Shortcut <device>" (steps) -> a row this sync wrote
/** @param {string | null | undefined} src */
const isShortcutSource = src => src === SHORTCUT_SOURCE || (src || '').startsWith(SHORTCUT_SOURCE + ' ');
/** @param {MetricDef} def @returns {number | null} */
const sourceColOf = def => (def.sourceCol === undefined ? 2 : def.sourceCol);

// Shortcut sleep stages (English + Spanish-localized) -> samples.mjs stage keys (asleep: core / deep /
// rem / unspec; not asleep: awake / inbed). Unknown stages are ignored (never counted as sleep).
/** @type {Record<string, string>} */
const SLEEP_STAGES = {
  core: 'core', deep: 'deep', rem: 'rem', asleep: 'unspec', asleepunspecified: 'unspec',
  principal: 'core', ligero: 'core', profundo: 'deep', dormido: 'unspec', sueno: 'unspec',
  awake: 'awake', inbed: 'inbed', despierto: 'awake', encama: 'inbed',
};
// NFD splits accents off ("sueño" -> "suen" + U+0303); drop the combining marks U+0300-U+036F
/** @param {unknown} s */
const stageKey = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').toLowerCase();
/** @param {unknown} stage @returns {string | null} */
const sleepStageOf = stage => SLEEP_STAGES[stageKey(stage)] || null;

// A decimal comma or dot. With BOTH separators the LAST one is the decimal and the other a thousands
// separator ("1.234,5" / "1,234.5" -> 1234.5); one kind repeated ("1.234.567") is ambiguous -> null.
/** @param {unknown} v @returns {number | null} */
function parseNumber(v) {
  let s = String(v ?? '').trim();
  const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
  if (dots && commas) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('');
    if (dec === ',') s = s.replace(',', '.');
  } else if (dots > 1 || commas > 1) return null;
  else s = s.replace(',', '.');
  return S.num(s);
}
// A COUNT (steps, flights, exercise minutes: whole numbers): a separator followed by exactly three digits
// is a thousands group, never a decimal ("12.345" / "12,345" steps -> 12345, "1.234.567" -> 1234567), since a
// count never has three decimals; anything else reads as parseNumber does ("12,5" -> 12.5).
/** @param {unknown} v @returns {number | null} */
function parseCount(v) {
  const s = String(v ?? '').trim();
  // one kind of separator only ("1.234,567" is not a count)
  if (/^\d{1,3}(\.\d{3})+$/.test(s) || /^\d{1,3}(,\d{3})+$/.test(s)) return S.num(s.replace(/[.,]/g, ''));
  return parseNumber(s);
}
// a distance in km: "6.2" / "6,2 km" -> 6.2, "5400 m" -> 5.4, "3 mi" -> 4.83; a bare number > 100 = metres
/** @type {Record<string, number>} */
const KM_PER = { km: 1, m: 0.001, mi: 1.609344 };
const DISTANCE_METRES_ABOVE = 100;
/** @param {unknown} v @returns {number | null} */
function parseKm(v) {
  const m = /^([\d.,]+)\s*(km|m|mi)?$/i.exec(String(v ?? '').trim());
  const n = m ? parseNumber(m[1]) : null;
  if (n == null) return null;
  const unit = /** @type {RegExpExecArray} */ (m)[2]; // n is set only when m matched
  if (unit) return n * KM_PER[unit.toLowerCase()];
  return n > DISTANCE_METRES_ABOVE ? n / 1000 : n;
}
// a real source name, or null when the field is empty or a formatted value ("14,6 %", "60 kg")
/** @param {unknown} v @returns {string | null} */
const parseSource = v => {
  const s = String(v ?? '').trim();
  return s && !/^[\d\s.,]+\s*(%|kg|lb|lbs)?$/i.test(s) ? s : null;
};

// line parsers per kind -> sample or null (malformed lines are skipped)
/** @type {Record<string, (line: string, def?: MetricDef) => Sample | null>} */
const PARSERS = {
  point(line, def) {
    const [ts, val, src] = line.split(';');
    const start = S.isoToExportStamp(ts);
    const value = parseNumber(val);
    if (!start || value == null) return null;
    return def?.withSource ? { start, value, source: parseSource(src) } : { start, value };
  },
  hourly(line) { return PARSERS.daily(line); },
  hrSamples(line) { return HR.parseSample(line); },
  daily(line, def) {
    const [ts, val] = line.split(';');
    const start = S.isoToExportStamp(ts);
    const value = (def && def.parseValue ? def.parseValue : parseNumber)(val);
    return start && value != null ? { start, value } : null;
  },
  interval(line) {
    const [ts, te, stage] = line.split(';');
    const start = S.isoToExportStamp(ts), end = S.isoToExportStamp(te);
    // a sleep segment has no value: the interval kind reads only start / end / stage
    return start && end && stage ? /** @type {Sample} */ (/** @type {unknown} */ ({ start, end, stage: stage.trim() })) : null;
  },
};
/** @type {Record<MetricKind, (s: Sample) => string>} */
const DEDUP_KEY = {
  point: s => `${s.start}|${s.value}`,
  daily: s => S.day(s.start),
  hourly: s => `${s.start.slice(0, 13)}|${s.start.slice(20)}`,
  deviceDaily: s => `${S.day(s.start)}|${s.device}`,
  fieldsDaily: s => `${S.day(s.start)}|${s.field}`,
  interval: s => `${s.start}|${s.end}|${s.stage}`,
  hrSamples: s => String(S.absMs(s.start)),
};
// which of two duplicates to keep (a = already cached, b = from a LATER payload):
//   daily totals -> the latest payload (it corrects an earlier inflated/partial value; each
//                   payload's truncated oldest day is dropped before this, see foldPayloads)
//   sourced points -> the one with a source; everything else -> the first seen
/** @type {Record<MetricKind, (a: Sample, b: Sample) => Sample>} */
const PREFER = {
  point: (a, b) => (a.source == null && b.source != null ? b : a),
  daily: (a, b) => b,
  hourly: (a, b) => b,
  deviceDaily: (a, b) => b,
  fieldsDaily: (a, b) => b,
  interval: a => a,
  hrSamples: (a, b) => b,
};
/** @param {MetricKind} kind */
const isDailyKind = kind => kind === 'daily' || kind === 'deviceDaily' || kind === 'fieldsDaily';

// A "last N days" query starts mid-day, so the OLDEST date of each daily series (per device for
// steps) is a truncated total. Drop it: the previous run delivered that day complete. The dietary
// keys fold into one row and share one query window, so their oldest day is computed across the
// whole group: a macro with no entry on the window start keeps its first (complete) day.
const seriesOf = (/** @type {Sample} */ s) => s.device || '';
/** @param {Sample[]} samples @returns {Sample[]} */
function dropTruncatedOldest(samples) {
  /** @type {Map<string, string>} */
  const oldest = new Map(); // series -> oldest date
  for (const s of samples) {
    const k = seriesOf(s), d = S.day(s.start);
    if (!oldest.has(k) || d < /** @type {string} */ (oldest.get(k))) oldest.set(k, d);
  }
  return samples.filter(s => S.day(s.start) !== oldest.get(seriesOf(s)));
}

// Same idea per HOUR: a "last 3 days" hourly query starts mid-hour, so only its oldest bucket is
// truncated (the previous run delivered that hour complete). The newest bucket is still filling
// up; a later payload replaces it (latest wins).
/** @param {Sample[]} samples @returns {Sample[]} */
function dropTruncatedOldestHour(samples) {
  if (!samples.length) return samples;
  const oldest = samples.reduce((a, b) => (S.absMs(b.start) < S.absMs(a.start) ? b : a));
  const k = DEDUP_KEY.hourly(oldest);
  return samples.filter(s => DEDUP_KEY.hourly(s) !== k);
}

// one payload object -> { metric: [sample] } for known metrics only; payload-level problems (the
// hr_t / hr_v lists of different lengths) are pushed onto `warnings` as strings
/** @param {unknown} payload @param {string[]} [warnings] @returns {Record<string, Sample[]>} */
function parsePayload(payload, warnings = []) {
  /** @type {Record<string, Sample[]>} */
  const out = {};
  if (!payload || typeof payload !== 'object') return out;
  const lines = (/** @type {unknown} */ raw) => (typeof raw === 'string' ? raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : []);
  for (const [metric, def] of Object.entries(METRICS)) {
    /** @param {Record<string, string> | undefined} keys @param {'device' | 'field'} tag @returns {Sample[]} */
    const perKey = (keys, tag) => Object.entries(/** @type {Record<string, string>} */ (keys)).flatMap(([key, label]) =>
      /** @type {Sample[]} */ (lines(/** @type {Record<string, unknown>} */ (payload)[key]).map(l => PARSERS.daily(l, def)).filter(Boolean)).map(s => ({ ...s, [tag]: label })));
    const samples = def.kind === 'deviceDaily' ? perKey(def.devices, 'device')
      : def.kind === 'fieldsDaily' ? perKey(def.fields, 'field')
        : def.kind === 'hrSamples' ? hrSamplesOf(payload, warnings)
          : /** @type {Sample[]} */ (lines(/** @type {Record<string, unknown>} */ (payload)[metric]).map(l => PARSERS[def.kind](l, def)).filter(Boolean));
    if (samples.length) out[metric] = samples;
  }
  return out;
}

// hr_samples lines + the zipped hr_t / hr_v lists of one payload (lib/health/hr-hourly.mjs)
/** @param {unknown} payload @param {string[]} warnings @returns {Sample[]} */
function hrSamplesOf(payload, warnings) {
  const { samples, warning } = HR.mergeHrSamples(payload);
  if (warning) warnings.push(warning);
  return samples;
}

// ---- sample cache ------------------------------------------------------------------------
// The deduped samples of every payload seen so far + the last payload id, kept locally so each
// run fetches only NEW payloads. It is independent of the CSVs (rows are rebuilt from it), so an
// extract.mjs re-run never invalidates it. `npm run sync -- --full` rebuilds it from scratch.
const CACHE_FILE = '.shortcut-cache.json';
const CACHE_VERSION = 1;
/** @returns {ShortcutCache} */
const emptyCache = () => ({ version: CACHE_VERSION, lastPayloadId: null, payloads: 0, samples: {} });
/** @param {string | number} id @param {string | null} last */
const idAfter = (id, last) => last == null || BigInt(id) > BigInt(last);

// Pure: fold payload rows [{id, payload}] (any order) into a cache. Payloads at or below
// lastPayloadId are skipped, so re-folding the same rows is a no-op. Parse warnings are pushed onto
// `warnings` ("payload <id>: ..."), never stored in the cache.
/** @param {ShortcutCache} cache @param {PayloadItem[]} items @param {string[]} [warnings] @returns {ShortcutCache} */
function foldPayloads(cache, items, warnings = []) {
  /** @type {ShortcutCache} */
  const out = JSON.parse(JSON.stringify(cache));
  // a metric whose dedupe key changed (rhr: timestamp+value -> timestamp) is re-keyed in place, in
  // cache order (= fold order), so an older cache needs no --full rebuild
  for (const [metric, def] of Object.entries(METRICS)) {
    const old = out.samples[metric];
    if (!def.dedupKey || !old) continue;
    /** @type {Record<string, Sample>} */
    const re = {};
    // a metric with its own dedupKey sets prefer too (rhr)
    const prefer = /** @type {(a: Sample, b: Sample) => Sample} */ (def.prefer);
    for (const s of Object.values(old)) { const k = def.dedupKey(s); re[k] = k in re ? prefer(re[k], s) : s; }
    out.samples[metric] = re;
  }
  const fresh = items.filter(i => idAfter(i.id, out.lastPayloadId))
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  for (const item of fresh) {
    /** @type {string[]} */
    const itemWarnings = [];
    const parsedPayload = parsePayload(item.payload, itemWarnings);
    for (const w of itemWarnings) warnings.push(`payload ${item.id}: ${w}`);
    for (const [metric, parsed] of Object.entries(parsedPayload)) {
      const def = METRICS[metric], kind = def.kind;
      if (kind === 'hrSamples') { foldHr(out.samples[metric] || (out.samples[metric] = {}), parsed); continue; }
      // zeros still mark the window start, so drop the truncated oldest day BEFORE the zeros
      let samples = isDailyKind(kind) ? dropTruncatedOldest(parsed) : kind === 'hourly' ? dropTruncatedOldestHour(parsed) : parsed;
      if (def.skipZero) samples = samples.filter(x => x.value > 0);
      const seen = out.samples[metric] || (out.samples[metric] = {});
      const keyOf = def.dedupKey || DEDUP_KEY[kind], prefer = def.prefer || PREFER[kind];
      for (const s of samples) {
        const k = keyOf(s);
        seen[k] = k in seen ? prefer(seen[k], s) : s;
      }
    }
    out.lastPayloadId = String(item.id);
    out.payloads++;
  }
  return out;
}
// Heart-rate samples of one payload into the cache map. Key = the instant (epoch ms) for the first
// value there, `<ms>#<k>` for the k-th further one: a Watch never repeats an instant, so its cache is
// keyed exactly as before (one value per instant, later payload wins). A band such as Mi Fitness
// stamps several records of an hour at hh:00:00: the payload's whole set at that instant replaces the
// cached set (exact repeats from an overlapping payload never double; equal values are kept).
/** @param {Record<string, Sample>} seen @param {Sample[]} samples */
function foldHr(seen, samples) {
  /** @type {Map<string, Sample[]>} */
  const groups = new Map();
  for (const s of samples) { const k = DEDUP_KEY.hrSamples(s); const g = groups.get(k); if (g) g.push(s); else groups.set(k, [s]); }
  for (const [k, g] of groups) {
    g.forEach((s, i) => { seen[i ? `${k}#${i}` : k] = s; });
    for (let i = g.length; `${k}#${i}` in seen; i++) delete seen[`${k}#${i}`];
  }
}
// ---- phantom profile weights --------------------------------------------------------------
// A weight entered by DATE only (the Health profile, or a manual entry without a time) is stored at
// local midnight, and seen from another offset at 00:00 UTC (e.g. 02:00:00 +0200). A smart scale
// writes body fat within seconds of its weight. So a Shortcut weight whose stamp is EXACTLY 00:00:00
// local or 00:00:00 UTC AND that has no body-fat sample (any source) within +/-10 min is treated as a
// phantom and dropped. Narrow on purpose: a real weigh-in at exactly midnight on a scale without body
// fat would be lost too (accepted: rare; the next weigh-in fills the trend). Shortcut-side only, since
// the export's per-sample time is not kept in weight.csv / bodyfat.csv.
const PHANTOM_BODYFAT_WINDOW_MS = 10 * 60000;
const isMidnightLike = (/** @type {string} */ st) => st.slice(11, 19) === '00:00:00' || S.absMs(st) % 86400000 === 0;
/** @param {Sample[] | null | undefined} weights @param {Sample[] | null | undefined} bodyfat @returns {Sample[]} */
function dropPhantomWeights(weights, bodyfat) {
  const bf = (bodyfat || []).map(s => S.absMs(s.start));
  return (weights || []).filter(w => {
    if (!isMidnightLike(w.start)) return true;
    const t = S.absMs(w.start);
    return bf.some(b => Math.abs(b - t) <= PHANTOM_BODYFAT_WINDOW_MS);
  });
}
/** @type {Record<string, (all: Record<string, Sample[]>) => Sample[]>} */
const PRUNE = { weight: all => dropPhantomWeights(all.weight, all.bodyfat) };

// ---- derived resting HR (a band that writes heart rate but no resting HR) -------------------
// The export's rule (samples.mjs derivedRestingHr, same function and thresholds) on the cached
// heart-rate samples, ONLY while the Shortcut has never delivered a measured resting HR (no rhr point
// in the cache, which keeps every payload's): an Apple Watch Shortcut sends its rhr, so its rhr.csv
// never changes. Rows are tagged "Shortcut (derived)" (owned: rebuilt every run) and, like every
// Shortcut row, fill only dates with no export row, so a measured (or export-derived) value wins.
const DERIVED_RHR_SOURCE = SHORTCUT_SOURCE + S.DERIVED_SUFFIX;
/** @param {Record<string, Sample[]>} all @returns {{date: string, line: string}[]} */
function derivedRhrRows(all) {
  if ((all.rhr || []).length) return [];
  return S.derivedRestingHr((all.hr_samples || []).map(s => ({ start: s.start, value: s.value, source: SHORTCUT_SOURCE })))
    .map(r => ({ date: r.date, line: S.readingRow({ date: r.date, value: /** @type {(v: number) => number} */ (METRICS.rhr.fmt)(r.value), source: r.source }) }));
}
/** @type {Record<string, (all: Record<string, Sample[]>) => {date: string, line: string}[]>} */
const DERIVE = { rhr: derivedRhrRows };

/** @param {ShortcutCache} cache @returns {Record<string, Sample[]>} */
const samplesOf = cache => Object.fromEntries(Object.entries(cache.samples).map(([m, byKey]) => [m, Object.values(byKey)]));

// many payload objects -> { metric: [unique sample] } (convenience over foldPayloads)
/** @param {unknown[]} payloads */
function collectSamples(payloads) {
  return samplesOf(foldPayloads(emptyCache(), payloads.map((payload, i) => ({ id: String(i + 1), payload }))));
}

// total minutes covered by the union of intervals (overlaps counted once), shared with
// samples.mjs sleepNights: the Shortcut carries no per-sample source, so all its segments are one
// source and overlapping devices are never double-counted.
const unionMinutes = S.unionMinutes;

/** @param {Sample} a @param {Sample} b */
const byStart = (a, b) => (S.absMs(a.start) - S.absMs(b.start)) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

// samples of one metric -> [{date, line}] in the exact CSV format extract.mjs writes. ctx.windows =
// the Strava activity windows (lib/health/hr-hourly.mjs activityWindows) the heart-rate histogram leaves out.
/** @param {string} metric @param {Sample[]} samples @param {{windows?: import('../../lib/health/hr-hourly.mjs').ActivityWindow[]}} [ctx]
 * @returns {{date: string, line: string}[]} */
function buildRows(metric, samples, ctx = {}) {
  const def = METRICS[metric];
  if (def.kind === 'hrSamples') return HR.hourlyRows(samples, ctx.windows || [], SHORTCUT_SOURCE);
  if (def.kind === 'point') {
    /** @type {(start: string, end?: string) => string} */
    const dateOf = def.dateOf || S.day;
    const fmt = /** @type {(v: number) => number} */ (def.fmt); // every point metric has one
    return [...samples].sort(byStart).map(s => {
      const date = dateOf(s.start, s.end);
      return { date, line: S.readingRow({ date, value: fmt(s.value), source: (def.withSource && s.source && S.csvSource(s.source)) || SHORTCUT_SOURCE }) };
    });
  }
  if (def.kind === 'deviceDaily') {
    // max across devices per day; ties -> first listed device; all-zero day = no data
    /** @type {Array<string | undefined>} */
    const rank = Object.values(/** @type {Record<string, string>} */ (def.devices));
    const row = /** @type {RowFn} */ (def.row);
    /** @type {Map<string, Sample>} */
    const best = new Map();
    for (const s of samples) {
      const date = S.day(s.start), cur = best.get(date);
      if (!cur || s.value > cur.value || (s.value === cur.value && rank.indexOf(s.device) < rank.indexOf(cur.device))) best.set(date, s);
    }
    // every key of best has a sample
    const at = (/** @type {string} */ d) => /** @type {Sample} */ (best.get(d));
    return [...best.keys()].sort().filter(d => at(d).value > 0)
      .map(date => ({ date, line: row(date, at(date).value, at(date).device) }));
  }
  if (def.kind === 'fieldsDaily') {
    /** @type {Map<string, Record<string, number>>} */
    const days = new Map(); // date -> { column: value }
    for (const s of samples) {
      const date = S.day(s.start);
      days.set(date, { ...days.get(date), [/** @type {string} */ (s.field)]: s.value });
    }
    const row = /** @type {FieldsRowFn} */ (def.row);
    const at = (/** @type {string} */ d) => /** @type {Record<string, number>} */ (days.get(d));
    return [...days.keys()].sort().filter(d => at(d).kcal > 0)
      .map(date => ({ date, line: row(date, at(date)) }));
  }
  if (def.kind === 'hourly') {
    const row = /** @type {RowFn} */ (def.row);
    return [...samples].sort(byStart).map(s => ({ date: S.day(s.start), line: row(s.start, s.value) }));
  }
  if (def.kind === 'daily') {
    const row = /** @type {RowFn} */ (def.row);
    return [...samples].sort(byStart).map(s => { const date = S.day(s.start); return { date, line: row(date, s.value) }; });
  }
  // sleep: main sleep per wake-up night from the asleep stages, naps excluded; Awake / InBed add
  // only their stage columns (samples.mjs sleepNights, the same rule as extract.mjs)
  const segs = samples.map(s => ({ start: s.start, end: /** @type {string} */ (s.end), source: SHORTCUT_SOURCE, stage: sleepStageOf(s.stage) })).filter(s => s.stage);
  // no in-bed estimate here: one 'Shortcut' source cannot leave the iPhone's Sleep Schedule out (export only)
  return S.sleepNights(segs, { estimateInBed: false }).map(n => ({ date: n.date, line: S.sleepRow(n.date, n.minutes, n.source, n.ck, n.stages) }));
}

// Merge shortcut rows into an existing CSV text (null = no file). Rows the sync wrote before
// (source=Shortcut, or a date in ownedDates) are dropped first — rebuilt every run — then rows
// are added only for dates with no export row. Stable sort keeps export rows' original order.
// Thin wrapper over sync-common's generic mergeCsv: this script's own ownership rule
// (isShortcutSource) is the default unless a caller overrides it.
/** @param {string | null} existingText @param {string} header @param {{date: string, line: string}[]} rows @param {MergeOpts} [opts] @returns {MergeStat} */
function mergeCsv(existingText, header, rows, opts = {}) {
  return common.mergeCsv(existingText, header, rows, { isOwn: isShortcutSource, ...opts });
}

const range = (/** @type {string[]} */ dates) => (dates.length ? `${dates[0]}..${dates[dates.length - 1]}` : 'n/a');
const SYNC_NOTE = 'iOS Shortcut rows (npm run sync) fill only dates the export does not cover and are rebuilt on every sync; they are tagged source=Shortcut, except body fat / lean mass (real scale source) and energy (no source column) — shortcutSync.owned lists every date the sync wrote per CSV. Shortcut sleep = union of the main-sleep asleep intervals per wake-up night (naps excluded, samples.mjs sleepNights), plus the stage columns (REM / deep / core / unspecified / awake / in bed, same rule as extract.mjs); in-bed-only nights are never estimated here (export only: the payload has no per-sample source to leave the iPhone\'s Sleep Schedule out); Shortcut energy = iOS day totals; Shortcut steps = MAX(watch, phone) day totals, source = "Shortcut Watch"/"Shortcut iPhone" (mirrors max-per-device; the legacy merged steps key double-counted and is ignored). Shortcut active_energy_hourly = Watch active energy per clock hour (active-energy-hourly.csv, Shortcut-only; feeds the power-meter ride correction in lib/health/ride-energy.mjs). Shortcut hr_samples = ungrouped Watch heart-rate samples, as "ISO;bpm" lines and/or the loop-free parallel lists hr_t (Start Dates) + hr_v (Values) zipped by index (lists of different lengths are dropped with a sync warning, never mis-paired) (deduped by exact timestamp, 25-240 bpm) aggregated per clock hour into hr-hourly.csv (avg/max/min/n, covered minutes = each sample until the next, max 10 min; act_min + the per-bpm histogram leave the Strava activity windows of workout-zones.csv out; feeds day strain, lib/score/strain.mjs). Shortcut dietary = diet_kcal/diet_protein/diet_carbs/diet_fat day totals joined into one row per day (no kcal = no row). Shortcut exercise/distance/flights = Watch-filtered day totals (exercise_watch/distance_watch/flights_watch; 0 = no data; distance in km). Day totals: the export\'s last date (exportLastDate, a partial day) is never treated as covered: the Shortcut row wins it, and the export row is dropped when there is none.';

const DERIVED_RHR_NOTE = `rhr.csv rows with source "${DERIVED_RHR_SOURCE}" are resting HR DERIVED from the Shortcut heart-rate samples (hr_samples / hr_t + hr_v) with the export's rule (samples.mjs derivedRestingHr: lowest 30-min rolling mean, >= 4 samples, 00:00-07:00, >= 3 clock hours), written only while the Shortcut has never delivered a measured resting HR (rhr key) and only on dates with no export row.`;

// Pure: refresh the rows/ranges extract.mjs wrote for the touched CSVs + record the sync.
// Deterministic (no timestamps) so re-running an unchanged sync rewrites identical bytes.
/**
 * @param {Record<string, any>} meta the parsed _meta.json (untrusted JSON: only the keys below are touched)
 * @param {Record<string, MergeStat>} stats
 * @param {{payloads: number, lastPayloadId: string | null, derivedRhr?: boolean}} info
 * @returns {Record<string, any>}
 */
function updateMeta(meta, stats, info) {
  const out = JSON.parse(JSON.stringify(meta));
  out.rows = out.rows || {};
  out.ranges = out.ranges || {};
  /** @type {Record<string, number>} */
  const added = {};
  /** @type {Record<string, string>} */
  const ranges = {};
  /** @type {Record<string, string[]>} */
  const owned = {};
  for (const [metric, st] of Object.entries(stats)) {
    const def = METRICS[metric];
    if (st.written === false) continue; // CSV absent and nothing to add -> leave meta alone
    out.rows[def.metaKey] = st.rows;
    if (def.rangeKey) out.ranges[def.rangeKey] = range(st.dates);
    added[metric] = st.added;
    ranges[metric] = range(st.addedDates);
    owned[def.csv] = st.addedDates;
  }
  out.shortcutSync = { payloads: info.payloads, lastPayloadId: info.lastPayloadId, added, ranges, owned };
  out.notes = Array.isArray(out.notes) ? out.notes : [];
  for (const n of out.notes.filter((/** @type {unknown} */ n) => /iOS Shortcut|source=Shortcut/.test(/** @type {string} */ (n)) && n !== SYNC_NOTE)) out.notes.splice(out.notes.indexOf(n), 1);
  if (!out.notes.includes(SYNC_NOTE)) out.notes.push(SYNC_NOTE);
  // the derived-RHR note only while rhr.csv carries such rows (an Apple Watch _meta.json is unchanged)
  out.notes = out.notes.filter((/** @type {unknown} */ n) => n !== DERIVED_RHR_NOTE);
  if (info.derivedRhr) out.notes.push(DERIVED_RHR_NOTE);
  return out;
}

/** @param {(name: string) => string | null} readFile @param {boolean} full @returns {{cache: ShortcutCache, text: string | null}} */
function readCache(readFile, full) {
  const text = full ? null : readFile(CACHE_FILE);
  if (text == null) return { cache: emptyCache(), text: null };
  /** @type {any} parsed JSON, checked just below */
  let cache;
  try { cache = JSON.parse(text); } catch { cache = null; }
  if (!cache || cache.version !== CACHE_VERSION || typeof cache.samples !== 'object') {
    throw new Error(`${CACHE_FILE} is unreadable or from another version; rebuild it with: npm run sync -- --full`);
  }
  return { cache, text };
}

// Pure planner: NEW payload rows [{id, payload}] + a reader (name -> text|null) -> files to
// write (CSVs, _meta.json, the sample cache). { full: true } ignores the existing cache.
/** @param {PayloadItem[]} items @param {(name: string) => string | null} readFile @param {{full?: boolean}} [opts] */
function planSync(items, readFile, { full = false } = {}) {
  const prev = readCache(readFile, full);
  /** @type {string[]} */
  const warnings = [];
  const cache = foldPayloads(prev.cache, items, warnings);
  const samples = samplesOf(cache);
  const metaText = readFile('_meta.json');
  const prevMeta = metaText != null ? JSON.parse(metaText) : null;
  const ledger = (prevMeta && prevMeta.shortcutSync && prevMeta.shortcutSync.owned) || {};
  // the export's last date is a PARTIAL day: for daily totals it is treated like a sync-owned date
  // (its export row is dropped, the Shortcut row, if any, fills it)
  const partialDay = prevMeta && typeof prevMeta.exportLastDate === 'string' ? [prevMeta.exportLastDate] : [];
  /** @type {Record<string, string>} */
  const writes = {};
  /** @type {Record<string, MergeStat>} */
  const stats = {};
  // sync-all runs the Strava sync FIRST, so its workout-zones.csv windows are current here
  const ctx = { windows: HR.activityWindows(readFile(ZONES_CSV)) };
  for (const [metric, def] of Object.entries(METRICS)) {
    const existing = readFile(def.csv);
    const rows = buildRows(metric, PRUNE[metric] ? PRUNE[metric](samples) : samples[metric] || [], ctx);
    if (DERIVE[metric]) rows.push(...DERIVE[metric](samples));
    const merged = mergeCsv(existing, def.header, rows, { sourceCol: sourceColOf(def), ownedDates: [...(ledger[def.csv] || []), ...(def.total ? partialDay : [])] });
    stats[metric] = merged;
    if (existing == null && !rows.length) { merged.written = false; continue; } // never create an empty CSV
    if (merged.text !== existing) writes[def.csv] = merged.text;
  }
  const cacheText = JSON.stringify(cache) + '\n';
  if (cacheText !== prev.text && (prev.text != null || cache.payloads > 0)) writes[CACHE_FILE] = cacheText;
  if (prevMeta || Object.keys(writes).length) {
    const base = prevMeta || { extractedFrom: null, rows: {}, ranges: {}, notes: [] };
    const derivedRhr = stats.rhr && stats.rhr.written !== false && (stats.rhr.text || '').includes(`,${DERIVED_RHR_SOURCE}\n`);
    const meta = updateMeta(base, stats, { payloads: cache.payloads, lastPayloadId: cache.lastPayloadId, derivedRhr });
    const text = JSON.stringify(meta, null, 2) + '\n';
    if (text !== metaText) writes['_meta.json'] = text;
  }
  return { writes, stats, cache, warnings };
}

const { writeAtomic } = common;

// plan + apply against a directory of extract CSVs (used by main and the contract test)
// _meta.json (the ownership ledger) is written FIRST, as sync-strava.mjs does: a crash after it leaves
// a ledger that lists every date this sync owns, so the next run still drops and rebuilds those
// Shortcut rows from the cache; written last, a crash would leave Shortcut rows the ledger does not
// know, which the next merge would keep as export rows. _meta.json is shared with sync-strava.mjs
// (both scripts can touch the same extract/ dir), so the whole read-plan-write sequence runs under an
// exclusive lock to prevent a lost update. opts.writeAtomic is injectable for tests.
/**
 * @param {string} dir @param {PayloadItem[]} items
 * @param {{writeAtomic?: (file: string, text: string) => void, full?: boolean}} [opts]
 * @returns {ReturnType<typeof planSync>}
 */
function syncDir(dir, items, opts = {}) {
  const { writeAtomic: write = writeAtomic, ...planOpts } = opts;
  fs.mkdirSync(dir, { recursive: true }); // the lockfile itself needs the directory to exist
  return common.withLock(path.join(dir, '_meta.json.lock'), () => {
    const readFile = (/** @type {string} */ name) => { const p = path.join(dir, name); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
    const plan = planSync(items, readFile, planOpts);
    const names = Object.keys(plan.writes).sort((a, b) => (a === '_meta.json' ? -1 : b === '_meta.json' ? 1 : 0));
    for (const name of names) write(path.join(dir, name), plan.writes[name]);
    return plan;
  });
}

const { resolveToken } = common;

// page through GET /export/raw from since_id until a short page
/**
 * @param {{baseUrl: string, token: string, automation: string, sinceId?: string, limit?: number, timeoutMs?: number, fetchImpl?: typeof fetch}} opts
 * @returns {Promise<PayloadItem[]>} the service's rows, unchecked
 */
function fetchAllPayloads({ baseUrl, token, automation, sinceId = '0', limit = 500, timeoutMs = 15000, fetchImpl = fetch }) {
  return /** @type {Promise<PayloadItem[]>} */ (common.fetchPages({
    baseUrl, token, sinceId, limit, timeoutMs, fetchImpl,
    buildUrl: (/** @type {{baseUrl: string, since: unknown, limit: unknown}} */ { baseUrl: base, since, limit: lim }) =>
      `${base}/export/raw?automation=${encodeURIComponent(automation)}&since_id=${since}&limit=${lim}`,
  }));
}

const USAGE = `Usage: node data/apple-health/sync-shortcut.mjs [--full]

Merges the iOS Shortcut payloads stored by the ingest service into the Apple Health extract.
  --full       ignore the local cache, refetch every payload and rebuild it
  -h, --help   this help
Env: INGEST_URL, INGEST_TOKEN (else from the service .env), INGEST_ENV_FILE (default
services/loop-ingest/.env), SHORTCUT_AUTOMATION (default "atajo-salud").`;

// The CLI entry (runCli passes the parsed flags); env / log / error / fetchImpl / outDir are injectable for
// tests. Returns the exit code: 1 on a missing token, a bad cache or an unreachable service (no file touched).
/**
 * @param {{full?: boolean, env?: NodeJS.ProcessEnv, log?: (msg: string) => void, error?: (msg: string) => void, fetchImpl?: typeof fetch, outDir?: string}} [opts]
 * @returns {Promise<number>}
 */
async function main({ full = false, env = process.env, log = console.log, error = console.error, fetchImpl = fetch, outDir = defaultOut(env) } = {}) {
  const baseUrl = common.readBaseUrl(env);
  const automation = env.SHORTCUT_AUTOMATION || DEFAULT_AUTOMATION;
  const token = common.readIngestToken(env);
  if (!token) {
    error('ERROR: no ingest token. Set INGEST_TOKEN or create services/loop-ingest/.env. No files touched.');
    return 1;
  }
  const readFile = (/** @type {string} */ name) => { const p = path.join(outDir, name); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
  let sinceId;
  try {
    sinceId = readCache(readFile, full).cache.lastPayloadId || '0';
  } catch (err) {
    error(`ERROR: ${/** @type {Error} */ (err).message}. No files touched.`);
    return 1;
  }
  /** @type {PayloadItem[]} */
  let items;
  try {
    items = await fetchAllPayloads({ baseUrl, token, automation, sinceId, fetchImpl });
  } catch (err) {
    error(`ERROR: could not read from the ingest service at ${baseUrl} (${/** @type {{message?: string, cause?: {code?: string}}} */ (err).cause?.code || /** @type {Error} */ (err).message}). Is it running? No files touched.`);
    return 1;
  }
  const { writes, stats, cache, warnings } = syncDir(outDir, items, { full });
  log(`Synced ${items.length} new "${automation}" payload(s)${full ? ' (full rebuild)' : ''}; ${cache.payloads} cached → ${outDir}`);
  for (const [metric, st] of Object.entries(stats)) {
    log(`  ${metric}: ${st.added} shortcut row(s) for ${range(st.addedDates)}; ${st.rows} rows total`);
  }
  for (const w of warnings) log(`  WARNING: ${w}`);
  if (!Object.keys(writes).length) log('  (no changes)');
  return 0;
}

if (isMain(import.meta.url)) common.runCli((/** @type {{full?: boolean}} */ { full }) => main({ full }), { guardDataRoot: true, usage: USAGE, options: { full: { type: 'boolean' } } });

export {
  METRICS, SHORTCUT_SOURCE, sleepStageOf,
  parseNumber, parseCount, parsePayload, collectSamples, unionMinutes, buildRows, mergeCsv, updateMeta,
  planSync, resolveToken, fetchAllPayloads,
  CACHE_FILE, emptyCache, foldPayloads, writeAtomic, syncDir, dropPhantomWeights, main,
};
