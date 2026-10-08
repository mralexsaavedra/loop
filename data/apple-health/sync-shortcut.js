#!/usr/bin/env node
/* iOS Shortcut sync — pulls the payloads an iOS Shortcut POSTed to the self-hosted ingest
 * service (services/health-ingest) and MERGES them into the Apple Health extract CSVs, so the
 * cache stays fresh between full export.xml drops.
 *
 *   npm run sync              incremental: fetches only payloads newer than the local cache
 *   npm run sync -- --full    ignore the cache, refetch every payload and rebuild it
 *
 * Env    : INGEST_URL (default http://localhost:8088), INGEST_TOKEN (falls back to
 *          services/health-ingest/.env), SHORTCUT_AUTOMATION (default "atajo-salud").
 * Writes : data/apple-health/extract/<csv of each METRICS entry> + _meta.json + .shortcut-cache.json
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
 * that keep the scale's real source. extract.js rewrites CSVs AND _meta.json together, so a
 * re-extract drops ledger and rows at once; just sync again afterwards.
 */
const fs = require('fs');
const path = require('path');
const S = require('./samples.js');
const HR = require('../../lib/health/hr-hourly.cjs');
const { ZONES_CSV } = require('../../lib/training/hr-zones.cjs');
const common = require('./sync-common.js');

const SHORTCUT_SOURCE = 'Shortcut';
const { DEFAULT_URL, ENV_FILE } = common;
const DEFAULT_AUTOMATION = 'atajo-salud';
const OUT = path.join(__dirname, 'extract');

// Per-metric table. Adding a metric = one entry (+ a new `kind` only if its line shape is new).
//   kind point    : "start;value[;source]"   -> one row per sample   (date,value,source)
//   kind daily    : "start;value"            -> one row per day      (already a day total)
//   kind deviceDaily : like daily, but one payload key PER DEVICE (`devices`: key -> source
//                   label); the day's value = MAX across devices, exactly like extract.js's
//                   max-per-device dedupe (summing iPhone + Watch double-counts)
//   kind fieldsDaily : like daily, but one payload key PER CSV COLUMN (`fields`: key -> column);
//                   the day's row joins every column (dietary intake: kcal + three macros)
//   kind hourly   : "start;value"            -> one row per CLOCK HOUR (Group by Hour on the phone;
//                   the stamp is the bucket's first sample, normalised to the hour start). Keyed by
//                   local hour + offset, so a DST fall-back night keeps both 02:00 hours.
//   kind interval : "start;end;stage"        -> one row per night    (sleep-daily schema)
//   kind hrSamples : "start;bpm" (ungrouped Watch heart-rate samples) -> one row per CLOCK HOUR of
//                   aggregates (lib/health/hr-hourly.cjs); samples deduped by their exact instant, later payload wins
//   withSource    : keep the payload's per-sample source in the CSV (else "Shortcut")
//   sourceCol     : index of the CSV source column, null when the schema has none
//   metaKey / rangeKey : the _meta.json rows/ranges keys extract.js uses for that CSV.
//   total         : a DAILY TOTAL series (not a mean, not a point): on the export's last date
//                   (_meta.json exportLastDate, a partial day: export.xml is taken mid-day) the
//                   export row never counts as covering the date: a Shortcut row wins it, and the
//                   export row is dropped when there is none (see planSync)
//   dedupKey / prefer : per-metric overrides of DEDUP_KEY / PREFER for the metric's kind
const DAILY_SOURCE_HEADER = 'date,steps,source';
const KCAL_HEADER = 'date,kcal';
// "2030-01-02 09:07:12 +0100" -> "2030-01-02T09:00:00+01:00" (the bucket's clock-hour start, ISO)
const hourStartIso = HR.hourStartIso;
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
  // body fat is stored as a PERCENT (extract.js converts HealthKit's fraction) -> accept both scales.
  // Real scale source kept: generate-health's body-comp uses the LATEST SOURCE only, so a
  // "Shortcut" tag would cut the series off from the same scale's export history.
  bodyfat:  { kind: 'point', csv: 'bodyfat.csv', header: S.READING_HEADER, metaKey: 'bodyfat', withSource: true, fmt: v => +(v < 1 ? v * 100 : v).toFixed(2) },
  leanmass: { kind: 'point', csv: 'leanmass.csv', header: S.READING_HEADER, metaKey: 'leanmass', withSource: true, fmt: v => +v.toFixed(2) },
  // The legacy merged `steps` key is NOT read: iOS's day grouping summed iPhone + Watch.
  steps:         { kind: 'deviceDaily', csv: 'steps-daily.csv', header: DAILY_SOURCE_HEADER, metaKey: 'steps', rangeKey: 'steps', total: true,
    devices: { steps_watch: `${SHORTCUT_SOURCE} Watch`, steps_phone: `${SHORTCUT_SOURCE} iPhone` },
    row: (date, v, source) => `${date},${Math.round(v)},${source}` },
  active_energy: { kind: 'daily', csv: 'active-energy-daily.csv', header: KCAL_HEADER, metaKey: 'active_energy', sourceCol: null, total: true,
    row: (date, v) => `${date},${Math.round(v)}` },
  // Watch active energy per clock hour (Watch-only search, Group by Hour). Not an export series:
  // it only feeds lib/health/ride-energy.mjs, which replaces the Watch's energy during a ride a
  // power meter measured. Source column = "Shortcut", so every row is rebuilt each run.
  active_energy_hourly: { kind: 'hourly', csv: 'active-energy-hourly.csv', header: 'date,hour_start,kcal,source', metaKey: 'active_energy_hourly', sourceCol: 3,
    row: (st, v) => `${S.day(st)},${hourStartIso(st)},${v.toFixed(1)},${SHORTCUT_SOURCE}` },
  basal_energy:  { kind: 'daily', csv: 'basal-energy-daily.csv', header: KCAL_HEADER, metaKey: 'basal_energy', sourceCol: null, total: true,
    row: (date, v) => `${date},${Math.round(v)}` },
  // Sleeping wrist temperature: one sample per night, dated by the wake-up night exactly like
  // extract.js and sleep-daily.csv (samples.js wristTempDate: a 23:xx and a 00:xx start agree).
  wrist_temp:  { kind: 'point', csv: 'wristTemp.csv', header: S.READING_HEADER, metaKey: 'wristTemp', dateOf: S.wristTempDate, fmt: v => +v.toFixed(2) },
  // Cardio Recovery (bpm drop 1 min after a workout): one row per workout sample (per-day means
  // would hide which session it was; readers can average). extract.js writes the same CSV.
  hr_recovery: { kind: 'point', csv: 'hr-recovery.csv', header: S.READING_HEADER, metaKey: 'hrRecovery', fmt: v => +v.toFixed(1) },
  // day-grouped means (extract.js: per-day mean of all samples); "fill missing" 0 rows = no data
  respiratory: { kind: 'daily', csv: 'respiratory-daily.csv', header: 'date,brpm', metaKey: 'respiratory', sourceCol: null, skipZero: true,
    row: (date, v) => `${date},${v.toFixed(1)}` },
  walking_hr:  { kind: 'daily', csv: 'walking-hr-daily.csv', header: 'date,bpm', metaKey: 'walking_hr', sourceCol: null, skipZero: true,
    row: (date, v) => `${date},${v.toFixed(0)}` },
  // Waist circumference in cm (a Shortcut on a metric phone reports cm; a value under 3 is metres
  // and is converted). Sparse, manual measurements -> one row per sample, like weight.
  waist:    { kind: 'point', csv: 'waist.csv', header: S.READING_HEADER, metaKey: 'waist', fmt: v => +(v < 3 ? v * 100 : v).toFixed(1) },
  // Food intake logged by a nutrition app that writes to Health: FOUR day-grouped payload keys
  // (`fields`: key -> CSV column) folded into ONE dietary-daily.csv row per day, the exact schema
  // extract.js writes. A day without kcal (or 0 kcal = "fill missing") is no data; a macro missing
  // on a logged day stays blank, never 0.
  dietary:  { kind: 'fieldsDaily', csv: 'dietary-daily.csv', header: 'date,kcal,protein_g,carbs_g,fat_g', metaKey: 'dietary', rangeKey: 'dietary', sourceCol: null, total: true,
    fields: { diet_kcal: 'kcal', diet_protein: 'protein', diet_carbs: 'carbs', diet_fat: 'fat' },
    row: (date, f) => [date, Math.round(f.kcal), ...['protein', 'carbs', 'fat'].map(k => (f[k] != null ? f[k].toFixed(1) : ''))].join(',') },
  sleep:    { kind: 'interval', csv: 'sleep-daily.csv', header: S.SLEEP_HEADER, metaKey: 'sleep' },
  // Watch heart-rate samples (Heart Rate, Source = the watch, NO grouping, last 1 day): only hourly
  // aggregates reach the CSV (lib/health/hr-hourly.cjs), the raw samples live in the local cache. Feeds day
  // strain (lib/score/strain.mjs). Tagged "Shortcut", so every row is rebuilt each run.
  hr_samples: { kind: 'hrSamples', csv: HR.HR_HOURLY_CSV, header: HR.HR_HOURLY_HEADER, metaKey: 'hr_hourly', sourceCol: 9 },
  // Watch-filtered day totals (one search per key, *Source is* the watch, Group by Day), the same
  // CSVs extract.js writes (max-per-device there; the Watch is the device that logs these fully).
  // No source column -> ownership via the ledger, like energy. A 0 day (Fill Missing, watch not worn)
  // is no data: extract.js only writes days with samples, so it has no zero rows either.
  exercise_watch: { kind: 'daily', csv: 'exercise-minutes-daily.csv', header: 'date,minutes', metaKey: 'exercise', sourceCol: null, skipZero: true, total: true,
    row: (date, v) => `${date},${Math.round(v)}` },
  // km. Accepts a unit ("5,1 km", "5400 m", "3 mi"); a bare number above 100 is metres (no one walks
  // + runs 100 km in a day, and a real total under 100 m is a not-worn day the Salud floor drops anyway)
  distance_watch: { kind: 'daily', csv: 'distance-daily.csv', header: 'date,km', metaKey: 'distance', rangeKey: 'distance', sourceCol: null, skipZero: true, total: true,
    parseValue: v => parseKm(v), row: (date, v) => `${date},${v.toFixed(2)}` },
  flights_watch: { kind: 'daily', csv: 'flights-daily.csv', header: 'date,flights', metaKey: 'flights', sourceCol: null, skipZero: true, total: true,
    row: (date, v) => `${date},${Math.round(v)}` },
};
// "Shortcut" or a device-tagged "Shortcut <device>" (steps) -> a row this sync wrote
const isShortcutSource = src => src === SHORTCUT_SOURCE || (src || '').startsWith(SHORTCUT_SOURCE + ' ');
const sourceColOf = def => (def.sourceCol === undefined ? 2 : def.sourceCol);

// Shortcut sleep stages (English + Spanish-localized) -> samples.js stage keys (asleep: core / deep /
// rem / unspec; not asleep: awake / inbed). Unknown stages are ignored (never counted as sleep).
const SLEEP_STAGES = {
  core: 'core', deep: 'deep', rem: 'rem', asleep: 'unspec', asleepunspecified: 'unspec',
  principal: 'core', ligero: 'core', profundo: 'deep', dormido: 'unspec', sueno: 'unspec',
  awake: 'awake', inbed: 'inbed', despierto: 'awake', encama: 'inbed',
};
// NFD splits accents off ("sueño" -> "suen" + U+0303); drop the combining marks U+0300-U+036F
const stageKey = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').toLowerCase();
const sleepStageOf = stage => SLEEP_STAGES[stageKey(stage)] || null;
const isAsleep = stage => ['core', 'deep', 'rem', 'unspec'].includes(sleepStageOf(stage));

// A decimal comma or dot. With BOTH separators the LAST one is the decimal and the other a thousands
// separator ("1.234,5" / "1,234.5" -> 1234.5); one kind repeated ("1.234.567") is ambiguous -> null.
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
// a distance in km: "6.2" / "6,2 km" -> 6.2, "5400 m" -> 5.4, "3 mi" -> 4.83; a bare number > 100 = metres
const KM_PER = { km: 1, m: 0.001, mi: 1.609344 };
const DISTANCE_METRES_ABOVE = 100;
function parseKm(v) {
  const m = /^([\d.,]+)\s*(km|m|mi)?$/i.exec(String(v ?? '').trim());
  const n = m ? parseNumber(m[1]) : null;
  if (n == null) return null;
  if (m[2]) return n * KM_PER[m[2].toLowerCase()];
  return n > DISTANCE_METRES_ABOVE ? n / 1000 : n;
}
// a real source name, or null when the field is empty or a formatted value ("14,6 %", "60 kg")
const parseSource = v => {
  const s = String(v ?? '').trim();
  return s && !/^[\d\s.,]+\s*(%|kg|lb|lbs)?$/i.test(s) ? s : null;
};

// line parsers per kind -> sample or null (malformed lines are skipped)
const PARSERS = {
  point(line, def) {
    const [ts, val, src] = line.split(';');
    const start = S.isoToExportStamp(ts);
    const value = parseNumber(val);
    if (!start || value == null) return null;
    return def.withSource ? { start, value, source: parseSource(src) } : { start, value };
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
    return start && end && stage ? { start, end, stage: stage.trim() } : null;
  },
};
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
const PREFER = {
  point: (a, b) => (a.source == null && b.source != null ? b : a),
  daily: (a, b) => b,
  hourly: (a, b) => b,
  deviceDaily: (a, b) => b,
  fieldsDaily: (a, b) => b,
  interval: a => a,
  hrSamples: (a, b) => b,
};
const isDailyKind = kind => kind === 'daily' || kind === 'deviceDaily' || kind === 'fieldsDaily';

// A "last N days" query starts mid-day, so the OLDEST date of each daily series (per device for
// steps) is a truncated total. Drop it: the previous run delivered that day complete. The dietary
// keys fold into one row and share one query window, so their oldest day is computed across the
// whole group: a macro with no entry on the window start keeps its first (complete) day.
const seriesOf = s => s.device || '';
function dropTruncatedOldest(samples) {
  const oldest = new Map(); // series -> oldest date
  for (const s of samples) {
    const k = seriesOf(s), d = S.day(s.start);
    if (!oldest.has(k) || d < oldest.get(k)) oldest.set(k, d);
  }
  return samples.filter(s => S.day(s.start) !== oldest.get(seriesOf(s)));
}

// Same idea per HOUR: a "last 3 days" hourly query starts mid-hour, so only its oldest bucket is
// truncated (the previous run delivered that hour complete). The newest bucket is still filling
// up; a later payload replaces it (latest wins).
function dropTruncatedOldestHour(samples) {
  if (!samples.length) return samples;
  const oldest = samples.reduce((a, b) => (S.absMs(b.start) < S.absMs(a.start) ? b : a));
  const k = DEDUP_KEY.hourly(oldest);
  return samples.filter(s => DEDUP_KEY.hourly(s) !== k);
}

// one payload object -> { metric: [sample] } for known metrics only
function parsePayload(payload) {
  const out = {};
  if (!payload || typeof payload !== 'object') return out;
  const lines = raw => (typeof raw === 'string' ? raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : []);
  for (const [metric, def] of Object.entries(METRICS)) {
    const perKey = (keys, tag) => Object.entries(keys).flatMap(([key, label]) =>
      lines(payload[key]).map(PARSERS.daily).filter(Boolean).map(s => ({ ...s, [tag]: label })));
    const samples = def.kind === 'deviceDaily' ? perKey(def.devices, 'device')
      : def.kind === 'fieldsDaily' ? perKey(def.fields, 'field')
        : lines(payload[metric]).map(l => PARSERS[def.kind](l, def)).filter(Boolean);
    if (samples.length) out[metric] = samples;
  }
  return out;
}

// ---- sample cache ------------------------------------------------------------------------
// The deduped samples of every payload seen so far + the last payload id, kept locally so each
// run fetches only NEW payloads. It is independent of the CSVs (rows are rebuilt from it), so an
// extract.js re-run never invalidates it. `npm run sync -- --full` rebuilds it from scratch.
const CACHE_FILE = '.shortcut-cache.json';
const CACHE_VERSION = 1;
const emptyCache = () => ({ version: CACHE_VERSION, lastPayloadId: null, payloads: 0, samples: {} });
const idAfter = (id, last) => last == null || BigInt(id) > BigInt(last);

// Pure: fold payload rows [{id, payload}] (any order) into a cache. Payloads at or below
// lastPayloadId are skipped, so re-folding the same rows is a no-op.
function foldPayloads(cache, items) {
  const out = JSON.parse(JSON.stringify(cache));
  // a metric whose dedupe key changed (rhr: timestamp+value -> timestamp) is re-keyed in place, in
  // cache order (= fold order), so an older cache needs no --full rebuild
  for (const [metric, def] of Object.entries(METRICS)) {
    const old = out.samples[metric];
    if (!def.dedupKey || !old) continue;
    const re = {};
    for (const s of Object.values(old)) { const k = def.dedupKey(s); re[k] = k in re ? def.prefer(re[k], s) : s; }
    out.samples[metric] = re;
  }
  const fresh = items.filter(i => idAfter(i.id, out.lastPayloadId))
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  for (const item of fresh) {
    for (const [metric, parsed] of Object.entries(parsePayload(item.payload))) {
      const def = METRICS[metric], kind = def.kind;
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
// ---- phantom profile weights --------------------------------------------------------------
// A weight entered by DATE only (the Health profile, or a manual entry without a time) is stored at
// local midnight, and seen from another offset at 00:00 UTC (e.g. 02:00:00 +0200). A smart scale
// writes body fat within seconds of its weight. So a Shortcut weight whose stamp is EXACTLY 00:00:00
// local or 00:00:00 UTC AND that has no body-fat sample (any source) within +/-10 min is treated as a
// phantom and dropped. Narrow on purpose: a real weigh-in at exactly midnight on a scale without body
// fat would be lost too (accepted: rare; the next weigh-in fills the trend). Shortcut-side only, since
// the export's per-sample time is not kept in weight.csv / bodyfat.csv.
const PHANTOM_BODYFAT_WINDOW_MS = 10 * 60000;
const isMidnightLike = st => st.slice(11, 19) === '00:00:00' || S.absMs(st) % 86400000 === 0;
function dropPhantomWeights(weights, bodyfat) {
  const bf = (bodyfat || []).map(s => S.absMs(s.start));
  return (weights || []).filter(w => {
    if (!isMidnightLike(w.start)) return true;
    const t = S.absMs(w.start);
    return bf.some(b => Math.abs(b - t) <= PHANTOM_BODYFAT_WINDOW_MS);
  });
}
const PRUNE = { weight: all => dropPhantomWeights(all.weight, all.bodyfat) };

const samplesOf = cache => Object.fromEntries(Object.entries(cache.samples).map(([m, byKey]) => [m, Object.values(byKey)]));

// many payload objects -> { metric: [unique sample] } (convenience over foldPayloads)
function collectSamples(payloads) {
  return samplesOf(foldPayloads(emptyCache(), payloads.map((payload, i) => ({ id: String(i + 1), payload }))));
}

// total minutes covered by the union of intervals (overlaps counted once), shared with
// samples.js sleepNights: the Shortcut carries no per-sample source, so all its segments are one
// source and overlapping devices are never double-counted.
const unionMinutes = S.unionMinutes;

const byStart = (a, b) => (S.absMs(a.start) - S.absMs(b.start)) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

// samples of one metric -> [{date, line}] in the exact CSV format extract.js writes. ctx.windows =
// the Strava activity windows (lib/health/hr-hourly.cjs activityWindows) the heart-rate histogram leaves out.
function buildRows(metric, samples, ctx = {}) {
  const def = METRICS[metric];
  if (def.kind === 'hrSamples') return HR.hourlyRows(samples, ctx.windows || [], SHORTCUT_SOURCE);
  if (def.kind === 'point') {
    const dateOf = def.dateOf || S.day;
    return [...samples].sort(byStart).map(s => {
      const date = dateOf(s.start, s.end);
      return { date, line: S.readingRow({ date, value: def.fmt(s.value), source: (def.withSource && s.source && s.source.replace(/,/g, ' ')) || SHORTCUT_SOURCE }) };
    });
  }
  if (def.kind === 'deviceDaily') {
    // max across devices per day; ties -> first listed device; all-zero day = no data
    const rank = Object.values(def.devices);
    const best = new Map();
    for (const s of samples) {
      const date = S.day(s.start), cur = best.get(date);
      if (!cur || s.value > cur.value || (s.value === cur.value && rank.indexOf(s.device) < rank.indexOf(cur.device))) best.set(date, s);
    }
    return [...best.keys()].sort().filter(d => best.get(d).value > 0)
      .map(date => ({ date, line: def.row(date, best.get(date).value, best.get(date).device) }));
  }
  if (def.kind === 'fieldsDaily') {
    const days = new Map(); // date -> { column: value }
    for (const s of samples) {
      const date = S.day(s.start);
      days.set(date, { ...days.get(date), [s.field]: s.value });
    }
    return [...days.keys()].sort().filter(d => days.get(d).kcal > 0)
      .map(date => ({ date, line: def.row(date, days.get(date)) }));
  }
  if (def.kind === 'hourly') {
    return [...samples].sort(byStart).map(s => ({ date: S.day(s.start), line: def.row(s.start, s.value) }));
  }
  if (def.kind === 'daily') {
    return [...samples].sort(byStart).map(s => { const date = S.day(s.start); return { date, line: def.row(date, s.value) }; });
  }
  // sleep: main sleep per wake-up night from the asleep stages, naps excluded; Awake / InBed add
  // only their stage columns (samples.js sleepNights, the same rule as extract.js)
  const segs = samples.map(s => ({ start: s.start, end: s.end, source: SHORTCUT_SOURCE, stage: sleepStageOf(s.stage) })).filter(s => s.stage);
  return S.sleepNights(segs).map(n => ({ date: n.date, line: S.sleepRow(n.date, n.minutes, n.source, n.ck, n.stages) }));
}

// Merge shortcut rows into an existing CSV text (null = no file). Rows the sync wrote before
// (source=Shortcut, or a date in ownedDates) are dropped first — rebuilt every run — then rows
// are added only for dates with no export row. Stable sort keeps export rows' original order.
// Thin wrapper over sync-common's generic mergeCsv: this script's own ownership rule
// (isShortcutSource) is the default unless a caller overrides it.
function mergeCsv(existingText, header, rows, opts = {}) {
  return common.mergeCsv(existingText, header, rows, { isOwn: isShortcutSource, ...opts });
}

const range = dates => (dates.length ? `${dates[0]}..${dates[dates.length - 1]}` : 'n/a');
const SYNC_NOTE = 'iOS Shortcut rows (npm run sync) fill only dates the export does not cover and are rebuilt on every sync; they are tagged source=Shortcut, except body fat / lean mass (real scale source) and energy (no source column) — shortcutSync.owned lists every date the sync wrote per CSV. Shortcut sleep = union of the main-sleep asleep intervals per wake-up night (naps excluded, samples.js sleepNights), plus the stage columns (REM / deep / core / unspecified / awake / in bed, same rule as extract.js); Shortcut energy = iOS day totals; Shortcut steps = MAX(watch, phone) day totals, source = "Shortcut Watch"/"Shortcut iPhone" (mirrors max-per-device; the legacy merged steps key double-counted and is ignored). Shortcut active_energy_hourly = Watch active energy per clock hour (active-energy-hourly.csv, Shortcut-only; feeds the power-meter ride correction in lib/health/ride-energy.mjs). Shortcut hr_samples = ungrouped Watch heart-rate samples (deduped by exact timestamp, 25-240 bpm) aggregated per clock hour into hr-hourly.csv (avg/max/min/n, covered minutes = each sample until the next, max 10 min; act_min + the per-bpm histogram leave the Strava activity windows of workout-zones.csv out; feeds day strain, lib/score/strain.mjs). Shortcut dietary = diet_kcal/diet_protein/diet_carbs/diet_fat day totals joined into one row per day (no kcal = no row). Shortcut exercise/distance/flights = Watch-filtered day totals (exercise_watch/distance_watch/flights_watch; 0 = no data; distance in km). Day totals: the export\'s last date (exportLastDate, a partial day) is never treated as covered: the Shortcut row wins it, and the export row is dropped when there is none.';

// Pure: refresh the rows/ranges extract.js wrote for the touched CSVs + record the sync.
// Deterministic (no timestamps) so re-running an unchanged sync rewrites identical bytes.
function updateMeta(meta, stats, info) {
  const out = JSON.parse(JSON.stringify(meta));
  out.rows = out.rows || {};
  out.ranges = out.ranges || {};
  const added = {}, ranges = {}, owned = {};
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
  for (const n of out.notes.filter(n => /iOS Shortcut|source=Shortcut/.test(n) && n !== SYNC_NOTE)) out.notes.splice(out.notes.indexOf(n), 1);
  if (!out.notes.includes(SYNC_NOTE)) out.notes.push(SYNC_NOTE);
  return out;
}

function readCache(readFile, full) {
  const text = full ? null : readFile(CACHE_FILE);
  if (text == null) return { cache: emptyCache(), text: null };
  let cache;
  try { cache = JSON.parse(text); } catch { cache = null; }
  if (!cache || cache.version !== CACHE_VERSION || typeof cache.samples !== 'object') {
    throw new Error(`${CACHE_FILE} is unreadable or from another version; rebuild it with: npm run sync -- --full`);
  }
  return { cache, text };
}

// Pure planner: NEW payload rows [{id, payload}] + a reader (name -> text|null) -> files to
// write (CSVs, _meta.json, the sample cache). { full: true } ignores the existing cache.
function planSync(items, readFile, { full = false } = {}) {
  const prev = readCache(readFile, full);
  const cache = foldPayloads(prev.cache, items);
  const samples = samplesOf(cache);
  const metaText = readFile('_meta.json');
  const prevMeta = metaText != null ? JSON.parse(metaText) : null;
  const ledger = (prevMeta && prevMeta.shortcutSync && prevMeta.shortcutSync.owned) || {};
  // the export's last date is a PARTIAL day: for daily totals it is treated like a sync-owned date
  // (its export row is dropped, the Shortcut row, if any, fills it)
  const partialDay = prevMeta && typeof prevMeta.exportLastDate === 'string' ? [prevMeta.exportLastDate] : [];
  const writes = {}, stats = {};
  // sync-all runs the Strava sync FIRST, so its workout-zones.csv windows are current here
  const ctx = { windows: HR.activityWindows(readFile(ZONES_CSV)) };
  for (const [metric, def] of Object.entries(METRICS)) {
    const existing = readFile(def.csv);
    const rows = buildRows(metric, PRUNE[metric] ? PRUNE[metric](samples) : samples[metric] || [], ctx);
    const merged = mergeCsv(existing, def.header, rows, { sourceCol: sourceColOf(def), ownedDates: [...(ledger[def.csv] || []), ...(def.total ? partialDay : [])] });
    stats[metric] = merged;
    if (existing == null && !rows.length) { merged.written = false; continue; } // never create an empty CSV
    if (merged.text !== existing) writes[def.csv] = merged.text;
  }
  const cacheText = JSON.stringify(cache) + '\n';
  if (cacheText !== prev.text && (prev.text != null || cache.payloads > 0)) writes[CACHE_FILE] = cacheText;
  if (prevMeta || Object.keys(writes).length) {
    const base = prevMeta || { extractedFrom: null, rows: {}, ranges: {}, notes: [] };
    const meta = updateMeta(base, stats, { payloads: cache.payloads, lastPayloadId: cache.lastPayloadId });
    const text = JSON.stringify(meta, null, 2) + '\n';
    if (text !== metaText) writes['_meta.json'] = text;
  }
  return { writes, stats, cache };
}

const { writeAtomic } = common;

// plan + apply against a directory of extract CSVs (used by main and the contract test)
// _meta.json is shared with sync-strava.js (both scripts can touch the same extract/ dir), so
// the whole read-plan-write sequence runs under an exclusive lock to prevent a lost update.
function syncDir(dir, items, opts = {}) {
  fs.mkdirSync(dir, { recursive: true }); // the lockfile itself needs the directory to exist
  return common.withLock(path.join(dir, '_meta.json.lock'), () => {
    const readFile = name => { const p = path.join(dir, name); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
    const plan = planSync(items, readFile, opts);
    for (const [name, text] of Object.entries(plan.writes)) writeAtomic(path.join(dir, name), text);
    return plan;
  });
}

const { resolveToken } = common;

// page through GET /export/raw from since_id until a short page
function fetchAllPayloads({ baseUrl, token, automation, sinceId = '0', limit = 500, timeoutMs = 15000, fetchImpl = fetch }) {
  return common.fetchPages({
    baseUrl, token, sinceId, limit, timeoutMs, fetchImpl,
    buildUrl: ({ baseUrl: base, since, limit: lim }) =>
      `${base}/export/raw?automation=${encodeURIComponent(automation)}&since_id=${since}&limit=${lim}`,
  });
}

async function main() {
  const baseUrl = process.env.INGEST_URL || DEFAULT_URL;
  const automation = process.env.SHORTCUT_AUTOMATION || DEFAULT_AUTOMATION;
  const envText = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : null;
  const token = resolveToken(process.env, envText);
  if (!token) {
    console.error('ERROR: no ingest token. Set INGEST_TOKEN or create services/health-ingest/.env. No files touched.');
    process.exit(1);
  }
  const full = process.argv.includes('--full');
  const readFile = name => { const p = path.join(OUT, name); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
  let sinceId;
  try {
    sinceId = readCache(readFile, full).cache.lastPayloadId || '0';
  } catch (err) {
    console.error(`ERROR: ${err.message}. No files touched.`);
    process.exit(1);
  }
  let items;
  try {
    items = await fetchAllPayloads({ baseUrl, token, automation, sinceId });
  } catch (err) {
    console.error(`ERROR: could not read from the ingest service at ${baseUrl} (${err.cause?.code || err.message}). Is it running? No files touched.`);
    process.exit(1);
  }
  const { writes, stats, cache } = syncDir(OUT, items, { full });
  console.log(`Synced ${items.length} new "${automation}" payload(s)${full ? ' (full rebuild)' : ''}; ${cache.payloads} cached → ${OUT}`);
  for (const [metric, st] of Object.entries(stats)) {
    console.log(`  ${metric}: ${st.added} shortcut row(s) for ${range(st.addedDates)}; ${st.rows} rows total`);
  }
  if (!Object.keys(writes).length) console.log('  (no changes)');
}

if (require.main === module) main();

module.exports = {
  METRICS, SHORTCUT_SOURCE, SLEEP_STAGES, isAsleep, sleepStageOf,
  parseNumber, parseSource, parsePayload, collectSamples, unionMinutes, buildRows, mergeCsv, updateMeta,
  planSync, resolveToken, fetchAllPayloads,
  CACHE_FILE, emptyCache, foldPayloads, writeAtomic, syncDir, dropPhantomWeights,
};
