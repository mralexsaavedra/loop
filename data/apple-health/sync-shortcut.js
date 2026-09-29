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
 * Merge rule: export-derived rows ALWAYS win. Rows the sync wrote before are rebuilt from
 * scratch every run and added only for DATES the export does not cover. "Rows the sync wrote"
 * = rows tagged source=Shortcut OR on a date in the ownership ledger (_meta.json
 * shortcutSync.owned) — the ledger covers CSVs with no source column (energy) and body-comp rows
 * that keep the scale's real source. extract.js rewrites CSVs AND _meta.json together, so a
 * re-extract drops ledger and rows at once; just sync again afterwards.
 */
const fs = require('fs');
const path = require('path');
const S = require('./samples.js');
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
//   kind interval : "start;end;stage"        -> one row per night    (sleep-daily schema)
//   withSource    : keep the payload's per-sample source in the CSV (else "Shortcut")
//   sourceCol     : index of the CSV source column, null when the schema has none
//   metaKey / rangeKey : the _meta.json rows/ranges keys extract.js uses for that CSV.
const DAILY_SOURCE_HEADER = 'date,steps,source';
const KCAL_HEADER = 'date,kcal';
const METRICS = {
  hrv:      { kind: 'point', csv: 'hrv.csv', header: S.READING_HEADER, metaKey: 'hrv', fmt: v => +v.toFixed(1) },
  rhr:      { kind: 'point', csv: 'rhr.csv', header: S.READING_HEADER, metaKey: 'rhr', rangeKey: 'restingHR', fmt: v => +v.toFixed(2) },
  vo2max:   { kind: 'point', csv: 'vo2max.csv', header: S.READING_HEADER, metaKey: 'vo2max', fmt: v => +v.toFixed(2) },
  weight:   { kind: 'point', csv: 'weight.csv', header: S.READING_HEADER, metaKey: 'weight', rangeKey: 'weight', fmt: v => +v.toFixed(2) },
  // body fat is stored as a PERCENT (extract.js converts HealthKit's fraction) -> accept both scales.
  // Real scale source kept: generate-health's body-comp uses the LATEST SOURCE only, so a
  // "Shortcut" tag would cut the series off from the same scale's export history.
  bodyfat:  { kind: 'point', csv: 'bodyfat.csv', header: S.READING_HEADER, metaKey: 'bodyfat', withSource: true, fmt: v => +(v < 1 ? v * 100 : v).toFixed(2) },
  leanmass: { kind: 'point', csv: 'leanmass.csv', header: S.READING_HEADER, metaKey: 'leanmass', withSource: true, fmt: v => +v.toFixed(2) },
  // The legacy merged `steps` key is NOT read: iOS's day grouping summed iPhone + Watch.
  steps:         { kind: 'deviceDaily', csv: 'steps-daily.csv', header: DAILY_SOURCE_HEADER, metaKey: 'steps', rangeKey: 'steps',
    devices: { steps_watch: `${SHORTCUT_SOURCE} Watch`, steps_phone: `${SHORTCUT_SOURCE} iPhone` },
    row: (date, v, source) => `${date},${Math.round(v)},${source}` },
  active_energy: { kind: 'daily', csv: 'active-energy-daily.csv', header: KCAL_HEADER, metaKey: 'active_energy', sourceCol: null,
    row: (date, v) => `${date},${Math.round(v)}` },
  basal_energy:  { kind: 'daily', csv: 'basal-energy-daily.csv', header: KCAL_HEADER, metaKey: 'basal_energy', sourceCol: null,
    row: (date, v) => `${date},${Math.round(v)}` },
  // Sleeping wrist temperature: one sample per night, dated by its START date exactly like
  // extract.js (no sleep-night roll-over), so a 23:xx and a 00:xx sample land on different dates.
  wrist_temp:  { kind: 'point', csv: 'wristTemp.csv', header: S.READING_HEADER, metaKey: 'wristTemp', fmt: v => +v.toFixed(2) },
  // Cardio Recovery (bpm drop 1 min after a workout): one row per workout sample (per-day means
  // would hide which session it was; readers can average). extract.js writes the same CSV.
  hr_recovery: { kind: 'point', csv: 'hr-recovery.csv', header: S.READING_HEADER, metaKey: 'hrRecovery', fmt: v => +v.toFixed(1) },
  // day-grouped means (extract.js: per-day mean of all samples); "fill missing" 0 rows = no data
  respiratory: { kind: 'daily', csv: 'respiratory-daily.csv', header: 'date,brpm', metaKey: 'respiratory', sourceCol: null, skipZero: true,
    row: (date, v) => `${date},${v.toFixed(1)}` },
  walking_hr:  { kind: 'daily', csv: 'walking-hr-daily.csv', header: 'date,bpm', metaKey: 'walking_hr', sourceCol: null, skipZero: true,
    row: (date, v) => `${date},${v.toFixed(0)}` },
  sleep:    { kind: 'interval', csv: 'sleep-daily.csv', header: S.SLEEP_HEADER, metaKey: 'sleep' },
};
// "Shortcut" or a device-tagged "Shortcut <device>" (steps) -> a row this sync wrote
const isShortcutSource = src => src === SHORTCUT_SOURCE || (src || '').startsWith(SHORTCUT_SOURCE + ' ');
const sourceColOf = def => (def.sourceCol === undefined ? 2 : def.sourceCol);

// Shortcut sleep stages (English + Spanish-localized). true = asleep, false = not asleep.
// Unknown stages are ignored (never counted as sleep).
const SLEEP_STAGES = {
  core: true, deep: true, rem: true, asleep: true, asleepunspecified: true,
  principal: true, ligero: true, profundo: true, dormido: true, sueno: true,
  awake: false, inbed: false, despierto: false, encama: false,
};
// NFD splits accents off ("sueño" -> "suen" + U+0303); drop the combining marks U+0300-U+036F
const stageKey = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').toLowerCase();
const isAsleep = stage => SLEEP_STAGES[stageKey(stage)] === true;

const parseNumber = v => S.num(String(v ?? '').trim().replace(',', '.'));
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
  daily(line) {
    const [ts, val] = line.split(';');
    const start = S.isoToExportStamp(ts);
    const value = parseNumber(val);
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
  deviceDaily: s => `${S.day(s.start)}|${s.device}`,
  interval: s => `${s.start}|${s.end}|${s.stage}`,
};
// which of two duplicates to keep (a = already cached, b = from a LATER payload):
//   daily totals -> the latest payload (it corrects an earlier inflated/partial value; each
//                   payload's truncated oldest day is dropped before this, see foldPayloads)
//   sourced points -> the one with a source; everything else -> the first seen
const PREFER = {
  point: (a, b) => (a.source == null && b.source != null ? b : a),
  daily: (a, b) => b,
  deviceDaily: (a, b) => b,
  interval: a => a,
};
const isDailyKind = kind => kind === 'daily' || kind === 'deviceDaily';

// A "last N days" query starts mid-day, so the OLDEST date of each daily series (per device for
// steps) is a truncated total. Drop it: the previous run delivered that day complete.
function dropTruncatedOldest(samples) {
  const oldest = new Map(); // series -> oldest date
  for (const s of samples) {
    const k = s.device || '', d = S.day(s.start);
    if (!oldest.has(k) || d < oldest.get(k)) oldest.set(k, d);
  }
  return samples.filter(s => S.day(s.start) !== oldest.get(s.device || ''));
}

// one payload object -> { metric: [sample] } for known metrics only
function parsePayload(payload) {
  const out = {};
  if (!payload || typeof payload !== 'object') return out;
  const lines = raw => (typeof raw === 'string' ? raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : []);
  for (const [metric, def] of Object.entries(METRICS)) {
    const samples = def.kind === 'deviceDaily'
      ? Object.entries(def.devices).flatMap(([key, device]) =>
        lines(payload[key]).map(PARSERS.daily).filter(Boolean).map(s => ({ ...s, device })))
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
  const fresh = items.filter(i => idAfter(i.id, out.lastPayloadId))
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  for (const item of fresh) {
    for (const [metric, parsed] of Object.entries(parsePayload(item.payload))) {
      const def = METRICS[metric], kind = def.kind;
      // zeros still mark the window start, so drop the truncated oldest day BEFORE the zeros
      let samples = isDailyKind(kind) ? dropTruncatedOldest(parsed) : parsed;
      if (def.skipZero) samples = samples.filter(x => x.value > 0);
      const seen = out.samples[metric] || (out.samples[metric] = {});
      for (const s of samples) {
        const k = DEDUP_KEY[kind](s);
        seen[k] = k in seen ? PREFER[kind](seen[k], s) : s;
      }
    }
    out.lastPayloadId = String(item.id);
    out.payloads++;
  }
  return out;
}
const samplesOf = cache => Object.fromEntries(Object.entries(cache.samples).map(([m, byKey]) => [m, Object.values(byKey)]));

// many payload objects -> { metric: [unique sample] } (convenience over foldPayloads)
function collectSamples(payloads) {
  return samplesOf(foldPayloads(emptyCache(), payloads.map((payload, i) => ({ id: String(i + 1), payload }))));
}

// total minutes covered by the union of intervals (overlaps counted once). The Shortcut carries
// no per-sample source, so this stands in for extract.js's "max across sources": for a single
// device it equals the plain sum; for overlapping devices it avoids the double count.
function unionMinutes(intervals) {
  const iv = intervals.map(i => [S.absMs(i.start), S.absMs(i.end)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, curA = null, curB = null;
  for (const [a, b] of iv) {
    if (curB == null || a > curB) { if (curB != null) total += curB - curA; curA = a; curB = b; }
    else if (b > curB) curB = b;
  }
  if (curB != null) total += curB - curA;
  return total / 60000;
}

const byStart = (a, b) => (S.absMs(a.start) - S.absMs(b.start)) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

// samples of one metric -> [{date, line}] in the exact CSV format extract.js writes
function buildRows(metric, samples) {
  const def = METRICS[metric];
  if (def.kind === 'point') {
    return [...samples].sort(byStart).map(s => {
      const date = S.day(s.start);
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
  if (def.kind === 'daily') {
    return [...samples].sort(byStart).map(s => { const date = S.day(s.start); return { date, line: def.row(date, s.value) }; });
  }
  // sleep: asleep stages only, grouped by wake-up night (same rule as extract.js)
  const nights = new Map();
  for (const s of samples) {
    if (!isAsleep(s.stage) || !(S.minutesBetween(s.start, s.end) > 0)) continue;
    const night = S.sleepNight(s.start);
    const arr = nights.get(night) || [];
    arr.push(s);
    nights.set(night, arr);
  }
  return [...nights.keys()].sort().map(date => {
    const segs = nights.get(date);
    const ck = { start: segs[0].start, end: segs[0].end };
    for (const s of segs) {
      if (S.absMs(s.start) < S.absMs(ck.start)) ck.start = s.start;
      if (S.absMs(s.end) > S.absMs(ck.end)) ck.end = s.end;
    }
    return { date, line: S.sleepRow(date, unionMinutes(segs), SHORTCUT_SOURCE, ck) };
  });
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
const SYNC_NOTE = 'iOS Shortcut rows (npm run sync) fill only dates the export does not cover and are rebuilt on every sync; they are tagged source=Shortcut, except body fat / lean mass (real scale source) and energy (no source column) — shortcutSync.owned lists every date the sync wrote per CSV. Shortcut sleep = union of asleep intervals per night; Shortcut energy = iOS day totals; Shortcut steps = MAX(watch, phone) day totals, source = "Shortcut Watch"/"Shortcut iPhone" (mirrors max-per-device; the legacy merged steps key double-counted and is ignored).';

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
  const writes = {}, stats = {};
  for (const [metric, def] of Object.entries(METRICS)) {
    const existing = readFile(def.csv);
    const rows = buildRows(metric, samples[metric] || []);
    const merged = mergeCsv(existing, def.header, rows, { sourceCol: sourceColOf(def), ownedDates: ledger[def.csv] || [] });
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
  METRICS, SHORTCUT_SOURCE, SLEEP_STAGES, isAsleep,
  parseNumber, parseSource, parsePayload, collectSamples, unionMinutes, buildRows, mergeCsv, updateMeta,
  planSync, resolveToken, fetchAllPayloads,
  CACHE_FILE, emptyCache, foldPayloads, writeAtomic, syncDir,
};
